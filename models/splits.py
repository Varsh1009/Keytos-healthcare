"""
Fixed subject-level 5-fold splits shared by every brain-age model.

Who is in which fold:
  * Cognitively normal people (CDR 0 or not rated), first session (MR1): 5 folds, stratified
    by 10-year age bin so every fold has a similar age spread (fixed seed).
  * Repeat scans (MR2) always sit in the same fold as that person's first scan.
  * Dementia participants (CDR >= 0.5) are never trained on: fold = -1, scored by all fold models.

The file is created once and then only loaded, so every model sees identical folds.
Run:  python models/splits.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold

ROOT = Path(__file__).resolve().parents[1]
MRI = ROOT / "data" / "raw" / "oasis_mri"
RESULTS = ROOT / "results"
SPLITS = RESULTS / "splits.json"
N_FOLDS, SEED = 5, 0
DEMENTIA_FOLD = -1


def scan_table() -> pd.DataFrame:
    """One row per real MRI file: scan/subject IDs, session, age, sex, CDR and status (no volumes loaded)."""
    meta = pd.read_csv(MRI / "oasis_cross-sectional.csv")
    rows = []
    for f in sorted(MRI.glob("**/*.nii*")):
        m = re.search(r"(OAS1_\d{4}_MR\d)", f.name)
        if m:
            rows.append({"ID": m.group(1), "file": f.name, "path": str(f)})
    df = pd.DataFrame(rows).merge(meta, on="ID", how="left")
    df["subject"] = df["ID"].str[:9]
    df["session"] = df["ID"].str[-3:]
    df["female"] = (df["M/F"] == "F").astype(float)
    df["status"] = np.where(df["CDR"].fillna(0) >= 0.5, "dementia (CDR≥0.5)", "cognitively normal")
    return df


def make_splits(df: pd.DataFrame) -> dict:
    first = df[df["session"] == "MR1"]
    normal = first[first["status"] == "cognitively normal"]
    bins = (normal["Age"] // 10).astype(int).to_numpy()
    fold_of = {}
    skf = StratifiedKFold(N_FOLDS, shuffle=True, random_state=SEED)
    for k, (_, te) in enumerate(skf.split(normal, bins)):
        for s in normal["subject"].iloc[te]:
            fold_of[s] = k
    for s in first.loc[first["status"] != "cognitively normal", "subject"]:
        fold_of[s] = DEMENTIA_FOLD
    return {
        "n_folds": N_FOLDS, "seed": SEED,
        "method": "StratifiedKFold on 10-year age bins of cognitively normal MR1 subjects; "
                  "repeat scans follow their subject; dementia subjects fold -1 (never trained on)",
        "fold_of_subject": dict(sorted(fold_of.items())),
    }


def load_splits() -> dict:
    """Load results/splits.json, creating it on first use."""
    if SPLITS.exists():
        return json.loads(SPLITS.read_text())
    RESULTS.mkdir(exist_ok=True)
    sp = make_splits(scan_table())
    SPLITS.write_text(json.dumps(sp, indent=1))
    return sp


def fold_column(df: pd.DataFrame) -> np.ndarray:
    """Fold for each row of a scan table (repeat scans inherit their subject's fold)."""
    f = load_splits()["fold_of_subject"]
    return df["subject"].map(f).fillna(DEMENTIA_FOLD).astype(int).to_numpy()


def train_test_indices(df: pd.DataFrame, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Row indices for fold k: train = normal MR1 scans in other folds, test = normal MR1 scans in fold k."""
    fold = fold_column(df)
    normal_first = ((df["session"] == "MR1") & (df["status"] == "cognitively normal")).to_numpy()
    return np.where(normal_first & (fold != k) & (fold >= 0))[0], np.where(normal_first & (fold == k))[0]


if __name__ == "__main__":
    df = scan_table()
    sp = load_splits()
    df["fold"] = fold_column(df)
    nf = df[(df["session"] == "MR1") & (df["fold"] >= 0)]
    print(nf.groupby("fold")["Age"].agg(["count", "mean", "std"]).round(1))
    print("dementia (fold -1):", int((df["fold"] == -1).sum()), " repeat scans:", int((df["session"] == "MR2").sum()))
