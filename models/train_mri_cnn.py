"""
3D CNN brain-age model trained on REAL MRI scans (Kaggle: ninadaithal/oasis-1-shinohara).

Data: 436 OASIS-1 T1 MRI volumes (downsampled to 4 mm for training), skull-stripped, bias-corrected (N4) and registered to the
2 mm MNI grid (91 x 109 x 91). Labels (age, sex, CDR dementia rating) come from the official
OASIS-1 cross-sectional table, joined on the OASIS subject ID in each filename.

Protocol (no leakage):
  * Train only on cognitively normal people (CDR 0 or not rated), first session (MR1).
  * 5-fold cross-validation split BY SUBJECT. Every normal person gets an out-of-fold prediction
    from a model that never saw their scan.
  * Dementia participants (CDR >= 0.5) are scored by the 5-model ensemble (none saw them).
  * The 20 repeat scans (MR2) are scored by the fold model that held that subject out,
    giving an honest test-retest estimate.
  * Age-bias correction of the brain-age gap fitted on out-of-fold normal predictions.
Outputs: models/artifacts/mri_cnn_fold{k}.pt, mri_cnn_metrics.json, mri_cnn_predictions.csv,
         mri_template.npy (mean normal brain, used to check uploads).
"""
from __future__ import annotations

import json
import logging
import re
import sys
import time
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from scipy import stats
from sklearn.metrics import mean_absolute_error, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
MRI = ROOT / "data" / "raw" / "oasis_mri"
ART = ROOT / "models" / "artifacts"
RESULTS = ROOT / "results"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "models"))
from neurotrail.mri import BrainAgeCNN, downsample, normalize  # noqa: E402
from splits import fold_column, train_test_indices  # noqa: E402  shared folds (results/splits.json)

log = logging.getLogger("mri_cnn")
torch.set_num_threads(8)
# CUDA GPU if present; otherwise CPU (on Apple M3 the small 4 mm CNN runs faster on CPU than on MPS).
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")
EPOCHS, BATCH, LR, SEED = 70, 8, 2e-3, 0


def load_all() -> tuple[np.ndarray, pd.DataFrame]:
    meta = pd.read_csv(MRI / "oasis_cross-sectional.csv")
    files = sorted(MRI.glob("**/*.nii*"))
    rows, vols = [], []
    for f in files:
        m = re.search(r"(OAS1_\d{4}_MR\d)", f.name)
        if not m:
            continue
        vols.append(downsample(normalize(np.asanyarray(nib.load(f).dataobj, dtype=np.float32))))
        rows.append({"ID": m.group(1), "file": f.name})
    df = pd.DataFrame(rows).merge(meta, on="ID", how="left")
    df["subject"] = df["ID"].str[:9]
    df["session"] = df["ID"].str[-3:]
    df["female"] = (df["M/F"] == "F").astype(float)
    df["status"] = np.where(df["CDR"].fillna(0) >= 0.5, "dementia (CDR≥0.5)", "cognitively normal")
    return np.stack(vols).astype(np.float16), df


def augment(x: torch.Tensor) -> torch.Tensor:
    if torch.rand(1) < 0.5:
        x = torch.flip(x, dims=[2])                        # left-right flip
    sh = [int(s) for s in torch.randint(-3, 4, (3,))]       # small shifts (voxels)
    x = torch.roll(x, shifts=sh, dims=[2, 3, 4])
    return x * (1 + 0.05 * torch.randn(x.shape[0], 1, 1, 1, 1, device=x.device))


def train_fold(X: np.ndarray, y: np.ndarray, seed: int) -> BrainAgeCNN:
    torch.manual_seed(seed)
    model = BrainAgeCNN().to(DEV)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=LR, total_steps=EPOCHS * int(np.ceil(len(X) / BATCH)))
    ym, ys = y.mean(), y.std()
    Xt = torch.from_numpy(X)
    yt = torch.from_numpy(((y - ym) / ys).astype(np.float32))
    for ep in range(EPOCHS):
        model.train()
        perm = torch.randperm(len(X))
        tot = 0.0
        for i in range(0, len(X), BATCH):
            b = perm[i:i + BATCH]
            xb = augment(Xt[b].float().unsqueeze(1).to(DEV))
            loss = nn.functional.smooth_l1_loss(model(xb).squeeze(1), yt[b].to(DEV))
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item() * len(b)
        if ep % 10 == 0 or ep == EPOCHS - 1:
            log.info("    epoch %2d  loss %.4f", ep, tot / len(X))
    model.y_mean, model.y_std = float(ym), float(ys)
    return model


@torch.no_grad()
def predict(model: BrainAgeCNN, X: np.ndarray) -> np.ndarray:
    model.eval()
    out = []
    for i in range(0, len(X), 16):
        xb = torch.from_numpy(X[i:i + 16]).float().unsqueeze(1).to(DEV)
        p = (model(xb) + model(torch.flip(xb, dims=[2]))) / 2   # flip test-time augmentation
        out.append(p.squeeze(1).cpu().numpy())
    return np.concatenate(out) * model.y_std + model.y_mean


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    t0 = time.time()
    X, df = load_all()
    log.info("Loaded %d real MRI volumes %s, device=%s", len(X), X.shape[1:], DEV)
    first = df["session"] == "MR1"
    normal = np.where(first & (df["status"] == "cognitively normal"))[0]
    dement = np.where(first & (df["status"] != "cognitively normal"))[0]
    rescans = np.where(df["session"] == "MR2")[0]
    ages = df["Age"].to_numpy(float)
    log.info("normal=%d dementia=%d rescans=%d", len(normal), len(dement), len(rescans))

    oof = np.full(len(df), np.nan)
    fold_of_subject, models, fold_tests = {}, [], []
    for k in range(5):
        tri, tei = train_test_indices(df, k)
        fold_tests.append(tei)
        log.info("fold %d: train %d / test %d", k, len(tri), len(tei))
        m = train_fold(X[tri], ages[tri], SEED + k)
        oof[tei] = predict(m, X[tei])
        for s in df.loc[tei, "subject"]:
            fold_of_subject[s] = k
        torch.save({"state": m.state_dict(), "y_mean": m.y_mean, "y_std": m.y_std}, ART / f"mri_cnn_fold{k}.pt")
        models.append(m)
        log.info("  fold %d MAE %.2f", k, mean_absolute_error(ages[tei], oof[tei]))

    # Ensemble for dementia participants (none of the 5 models saw them).
    ens = np.mean([predict(m, X[dement]) for m in models], axis=0)
    oof[dement] = ens
    # Repeat scans: the fold model that held that subject out.
    for i in rescans:
        k = fold_of_subject.get(df.loc[i, "subject"])
        if k is not None:
            oof[i] = predict(models[k], X[i:i + 1])[0]

    nm = normal
    mae = mean_absolute_error(ages[nm], oof[nm])
    r = stats.pearsonr(ages[nm], oof[nm])[0]
    gap_raw = oof - ages
    slope, intercept = np.polyfit(ages[nm], gap_raw[nm], 1)
    gap = gap_raw - (slope * ages + intercept)

    old = nm[ages[nm] >= ages[dement].min()]
    y = np.r_[np.zeros(len(old)), np.ones(len(dement))]
    g = np.r_[gap[old], gap[dement]]
    auc = roc_auc_score(y, g)
    rng = np.random.default_rng(0)
    boots = [roc_auc_score(y[i], g[i]) for i in (rng.integers(0, len(y), len(y)) for _ in range(2000))
             if 0 < y[i].sum() < len(i)]
    mw = stats.mannwhitneyu(gap[dement], gap[old], alternative="greater")

    pairs = []
    for i in rescans:
        s = df.loc[i, "subject"]
        j = df.index[(df["subject"] == s) & (df["session"] == "MR1")]
        if len(j) and not np.isnan(oof[i]) and not np.isnan(oof[j[0]]):
            pairs.append((oof[j[0]], oof[i]))
    pr = np.array(pairs)
    d = pr[:, 1] - pr[:, 0]
    ms_b = pr.mean(axis=1).var(ddof=1) * 2
    ms_w = ((pr - pr.mean(axis=1, keepdims=True)) ** 2).sum() / len(pr)
    icc = (ms_b - ms_w) / (ms_b + ms_w)

    baseline = mean_absolute_error(ages[nm], np.full(len(nm), ages[nm].mean()))
    nwbv = json.loads((ART / "brainage_metrics.json").read_text())
    metrics = {
        "data": "Kaggle ninadaithal/oasis-1-shinohara: OASIS-1 T1 MRI, skull-stripped, N4, MNI 2 mm (91x109x91)",
        "n_volumes": int(len(df)), "n_normal": int(len(nm)), "n_dementia": int(len(dement)),
        "architecture": "3D CNN on 4 mm input (46x55x46): 5 conv blocks (16-32-64-128-128, stride-2), global avg pool; L-R flip TTA",
        "params": int(sum(p.numel() for p in models[0].parameters())), "epochs": EPOCHS,
        "cv": "5-fold, split by subject; out-of-fold predictions for every normal participant",
        "mae": float(mae), "r": float(r), "baseline_mae_predict_mean": float(baseline),
        "nwbv_model_mae": float(nwbv[nwbv["chosen_model"]]["mae_mean"]),
        "fold_mae": [float(mean_absolute_error(ages[te], oof[te])) for te in fold_tests],
        "splits": "results/splits.json (age-stratified, subject-level)",
        "bias_correction": {"slope": float(slope), "intercept": float(intercept)},
        "clinical_validity": {"auc": float(auc), "auc_ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
                              "mean_gap_dementia": float(gap[dement].mean()), "mean_gap_normal_age_matched": float(gap[old].mean()),
                              "n_normal_age_matched": int(len(old)), "mannwhitney_p": float(mw.pvalue)},
        "test_retest": {"n_pairs": int(len(pr)), "mean_abs_diff": float(np.abs(d).mean()),
                        "sd_diff": float(d.std(ddof=1)), "icc": float(icc),
                        "smallest_detectable_change": float(1.96 * d.std(ddof=1))},
        "train_minutes": round((time.time() - t0) / 60, 1), "device": str(DEV),
    }
    old = ART / "mri_cnn_metrics.json"
    if old.exists() and "format_check" in json.loads(old.read_text()):   # upload-check threshold (same template)
        metrics["format_check"] = json.loads(old.read_text())["format_check"]
    (ART / "mri_cnn_metrics.json").write_text(json.dumps(metrics, indent=2))
    df.assign(brain_age=oof, gap=gap)[["ID", "file", "Age", "female", "CDR", "MMSE", "status", "session", "brain_age", "gap"]] \
        .to_csv(ART / "mri_cnn_predictions.csv", index=False)
    # Shared out-of-fold format for models/eval_brainage.py
    RESULTS.mkdir(exist_ok=True)
    pd.DataFrame({"subject_id": df["subject"], "scan_id": df["ID"], "fold": fold_column(df), "age": ages,
                  "sex": df["M/F"], "cdr": df["CDR"], "pred_age": oof, "pred_std": np.nan}) \
        .to_csv(RESULTS / "oof_baseline_4mm.csv", index=False)
    full = np.stack([normalize(np.asanyarray(nib.load(next(MRI.glob(f"**/{df.loc[i, 'file']}"))).dataobj, dtype=np.float32))
                     for i in nm])
    np.save(ART / "mri_template.npy", full.mean(axis=0))
    log.info(json.dumps({k: v for k, v in metrics.items() if k in ("mae", "r", "baseline_mae_predict_mean", "clinical_validity", "test_retest", "train_minutes")}, indent=1))


if __name__ == "__main__":
    main()
