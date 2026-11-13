"""
Volume-only brain age (nWBV, eTIV, sex; the model chosen in models/train_brainage.py) re-run on the
shared folds in results/splits.json, so it can be compared with and ensembled with the CNNs.

Normal people: their held-out fold model. Repeat scans: the same fold model (features from that
session). Dementia participants: mean of the 5 fold models (none saw them).
Outputs: results/oof_volume.csv, results/metrics_volume.json.  Run:  python models/oof_volume_model.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "models"))
from eval_brainage import evaluate  # noqa: E402
from splits import DEMENTIA_FOLD, fold_column, scan_table, train_test_indices  # noqa: E402
from train_brainage import FEATS, make_model  # noqa: E402


def main() -> None:
    df = scan_table()
    df["fold"] = fold_column(df)
    kind = json.loads((ROOT / "models" / "artifacts" / "brainage_metrics.json").read_text())["chosen_model"]
    pred = np.full(len(df), np.nan)
    dem = np.where(df["fold"] == DEMENTIA_FOLD)[0]
    dem_preds = []
    for k in range(5):
        tr, te = train_test_indices(df, k)
        m = make_model(kind).fit(df.iloc[tr][FEATS], df.iloc[tr]["Age"])
        held = np.where((df["fold"] == k).to_numpy())[0]          # test MR1 + their repeat scans
        pred[held] = m.predict(df.iloc[held][FEATS])
        dem_preds.append(m.predict(df.iloc[dem][FEATS]))
    pred[dem] = np.mean(dem_preds, axis=0)
    out = ROOT / "results" / "oof_volume.csv"
    pd.DataFrame({"subject_id": df["subject"], "scan_id": df["ID"], "fold": df["fold"], "age": df["Age"],
                  "sex": df["M/F"], "cdr": df["CDR"], "pred_age": pred, "pred_std": np.nan}).to_csv(out, index=False)
    m = evaluate("volume")
    print(f"volume ({kind}): MAE {m['mae']:.2f} r {m['r']:.3f} AUC {m['clinical_validity']['auc']:.3f} "
          f"ICC {m['test_retest']['icc_3_1']:.3f} SDC {m['test_retest']['smallest_detectable_change']:.2f}")


if __name__ == "__main__":
    main()
