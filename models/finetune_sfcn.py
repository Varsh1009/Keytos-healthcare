"""
Fine-tune the pretrained SFCN brain-age model (Peng et al. 2021, Medical Image Analysis 68:101871;
code + weights: github.com/ha-ha-ha-han/UKBiobank_deep_pretrain, MIT license) on OASIS-1.

Pretrained model: UK Biobank, 12,949 training subjects aged 44-80, T1 brain-extracted and linearly
registered to the FSL MNI152 1 mm grid, input 160 x 192 x 160 = centre crop of 182 x 218 x 182,
intensity = volume / whole-volume mean, output = log-probabilities over 40 one-year bins (42-82).

Our scans are skull-stripped, N4-corrected and on the FSL MNI152 2 mm grid (same space, same LAS
voxel order). We upsample 2 mm -> 1 mm (trilinear) only to match the input shape: this adds no detail.

Fine-tuning (same folds and protocol as every model, results/splits.json):
  * Head replaced by a single regression output (standardized age) covering our 18-96 range.
  * Stage 1: freeze everything except the last block (conv_5) and the new head.
  * Stage 2: unfreeze everything, 10x lower learning rate, early stopping on an inner validation
    split taken from the training fold only. Batch-norm statistics stay frozen (tiny batches).
  * Augmentation: shifts up to 2 voxels, intensity scaling +-10% (no left-right flips).
Outputs: models/checkpoints/sfcn_ft/fold{k}.pt, results/oof_sfcn_ft.csv, results/metrics_sfcn_ft.json,
         results/train_log_sfcn_ft.json, results/sfcn_pretrained_check.json

Run:  python models/finetune_sfcn.py --check-pretrained   # zero-shot sanity check of preprocessing
      python models/finetune_sfcn.py [--smoke]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
import urllib.request
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "models"))
from neurotrail.brainage_nets import SFCN, SFCN_BINS, sfcn_prep  # noqa: E402
from eval_brainage import evaluate, mae, pearson_r  # noqa: E402
from splits import DEMENTIA_FOLD, fold_column, scan_table, train_test_indices  # noqa: E402
from train_utils import DEV, _autocast, fit, inner_split, predict  # noqa: E402

log = logging.getLogger("sfcn")
RESULTS = ROOT / "results"
WEIGHTS = ROOT / "models" / "pretrained" / "sfcn_ukb_run_20190719_00_epoch_best_mae.p"
WEIGHTS_URL = "https://github.com/ha-ha-ha-han/UKBiobank_deep_pretrain/raw/master/brain_age/run_20190719_00_epoch_best_mae.p"
WEIGHTS_SHA256 = "f9197c92486a8dba7fd87bb9f2ecc4f42f7c9628b9150d1b95c8a5ac10721ad3"


def pretrained_state() -> dict:
    if not WEIGHTS.exists():
        WEIGHTS.parent.mkdir(parents=True, exist_ok=True)
        log.info("downloading SFCN weights from %s", WEIGHTS_URL)
        with urllib.request.urlopen(WEIGHTS_URL, timeout=120) as r:
            WEIGHTS.write_bytes(r.read())
    digest = hashlib.sha256(WEIGHTS.read_bytes()).hexdigest()
    if digest != WEIGHTS_SHA256:
        raise RuntimeError(f"SFCN weights hash mismatch ({digest}); delete {WEIGHTS} and retry")
    return torch.load(WEIGHTS, map_location="cpu", weights_only=True)


def load_volumes(df: pd.DataFrame) -> torch.Tensor:
    """Raw 2 mm intensities divided by the whole-volume mean (fp16-safe); sfcn_prep re-normalizes at 1 mm."""
    vols = []
    for p in df["path"]:
        v = np.nan_to_num(np.asanyarray(nib.load(p).dataobj, dtype=np.float32))
        vols.append(v / max(float(v.mean()), 1e-6))
    X = torch.from_numpy(np.stack(vols).astype(np.float16))
    return X.pin_memory() if DEV.type == "cuda" else X


def augment(x: torch.Tensor) -> torch.Tensor:
    out = torch.empty_like(x)
    for i in range(len(x)):
        sh = [int(s) for s in torch.randint(-2, 3, (3,))]
        out[i] = torch.roll(x[i], shifts=sh, dims=[1, 2, 3])
    return out * torch.empty(len(x), 1, 1, 1, 1, device=x.device).uniform_(0.9, 1.1)


@torch.no_grad()
def check_pretrained(df: pd.DataFrame, X: torch.Tensor) -> dict:
    """Zero-shot: the untouched UK Biobank model on our upsampled scans (validates preprocessing)."""
    m = SFCN(output_dim=40)
    m.load_pretrained(pretrained_state())
    m.to(DEV).eval()
    centres = torch.arange(SFCN_BINS[0], SFCN_BINS[1], dtype=torch.float32, device=DEV) + 0.5
    normal = np.where(((df["session"] == "MR1") & (df["status"] == "cognitively normal")).to_numpy())[0]
    preds = []
    for i in range(0, len(normal), 2):
        xb = sfcn_prep(X[torch.as_tensor(normal[i:i + 2])].to(DEV).float().unsqueeze(1))
        with _autocast():
            lp = m(xb).float()
        preds.append((lp.exp() @ centres).cpu().numpy())
    pred, age = np.concatenate(preds), df["Age"].to_numpy(float)[normal]
    ukb = (age >= 44) & (age <= 80)
    out = {"what": "untouched UK Biobank SFCN, cognitively normal OASIS-1 MR1 scans",
           "n_44_80": int(ukb.sum()), "mae_44_80": mae(age[ukb], pred[ukb]), "r_44_80": pearson_r(age[ukb], pred[ukb]),
           "mean_error_44_80": float(np.mean(pred[ukb] - age[ukb])),
           "n_all": int(len(age)), "mae_all": mae(age, pred), "r_all": pearson_r(age, pred),
           "pred_range": [float(pred.min()), float(pred.max())]}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "sfcn_pretrained_check.json").write_text(json.dumps(out, indent=2))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-pretrained", action="store_true")
    ap.add_argument("--smoke", action="store_true", help="fold 0, 1+1 epochs; writes nothing")
    ap.add_argument("--epochs1", type=int, default=8)
    ap.add_argument("--epochs2", type=int, default=40)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--folds", type=int, nargs="+", default=[0, 1, 2, 3, 4])
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    torch.backends.cudnn.benchmark = True
    t0 = time.time()
    df = scan_table()
    df["fold"] = fold_column(df)
    ages = df["Age"].to_numpy(float)
    X = load_volumes(df)
    log.info("Loaded %d volumes %s in %.0fs (device %s)", len(X), tuple(X.shape[1:]), time.time() - t0, DEV)
    if a.check_pretrained:
        log.info(json.dumps(check_pretrained(df, X), indent=1))
        return

    state = pretrained_state()
    rescans = np.where(df["session"] == "MR2")[0]
    dement = np.where(df["fold"] == DEMENTIA_FOLD)[0]
    ck_dir = ROOT / "models" / "checkpoints" / "sfcn_ft"
    pred = np.full(len(df), np.nan)
    dem_preds, train_log = [], []
    folds = [0] if a.smoke else a.folds
    e1, e2 = (1, 1) if a.smoke else (a.epochs1, a.epochs2)
    for k in folds:
        tri, tei = train_test_indices(df, k)
        held = np.r_[tei, rescans[df["fold"].to_numpy()[rescans] == k]]
        tr, va = inner_split(tri, ages, seed=k)
        model = SFCN(output_dim=1)
        model.load_pretrained(state)
        model.grad_checkpoint = True
        t1 = time.time()
        # Stage 1: only the last block + new head learn.
        for name, p in model.named_parameters():
            p.requires_grad = name.startswith(("feature_extractor.conv_5", "classifier"))
        s1 = fit(model, X, ages, tr, va, augment=augment, epochs=e1, batch=a.batch, lr=a.lr, min_epochs=e1,
                 patience=e1, seed=k, params=[p for p in model.parameters() if p.requires_grad], prep=sfcn_prep,
                 bn_eval=True, label=f"f{k} stage1")
        # Stage 2: everything learns, 10x lower learning rate, early stopping.
        for p in model.parameters():
            p.requires_grad = True
        s2 = fit(model, X, ages, tr, va, augment=augment, epochs=e2, batch=a.batch, lr=a.lr / 10, min_epochs=min(10, e2),
                 patience=10, seed=k, prep=sfcn_prep, bn_eval=True, label=f"f{k} stage2")
        p_held = predict(model, X, held, batch=4, prep=sfcn_prep)
        pred[held] = p_held
        dem_preds.append(predict(model, X, dement, batch=4, prep=sfcn_prep))
        info = {"fold": k, "stage1": s1, "stage2": s2, "n_train": len(tr), "n_val": len(va),
                "test_mae": mae(ages[tei], p_held[:len(tei)]), "minutes": round((time.time() - t1) / 60, 1),
                "max_gpu_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2) if DEV.type == "cuda" else None}
        train_log.append(info)
        log.info("  fold %d: stage1 val %.2f, stage2 val %.2f, held-out MAE %.2f, %.1f min, GPU %s GB", k,
                 s1["val_mae"], s2["val_mae"], info["test_mae"], info["minutes"], info["max_gpu_gb"])
        if a.smoke:
            log.info("smoke test done; nothing written")
            return
        ck_dir.mkdir(parents=True, exist_ok=True)
        torch.save({"state": model.state_dict(), "y_mean": model.y_mean, "y_std": model.y_std, "arch": "SFCN-reg",
                    "pretrained": WEIGHTS_URL, **info}, ck_dir / f"fold{k}.pt")

    if len(folds) < 5:
        log.info("partial run (folds %s); OOF not written", folds)
        return
    pred[dement] = np.mean(dem_preds, axis=0)
    pd.DataFrame({"subject_id": df["subject"], "scan_id": df["ID"], "fold": df["fold"], "age": ages, "sex": df["M/F"],
                  "cdr": df["CDR"], "pred_age": pred, "pred_std": np.nan}).to_csv(RESULTS / "oof_sfcn_ft.csv", index=False)
    (RESULTS / "train_log_sfcn_ft.json").write_text(json.dumps(
        {"model": "sfcn_ft", "epochs1": e1, "epochs2": e2, "lr_stage1": a.lr, "lr_stage2": a.lr / 10, "batch": a.batch,
         "device": str(DEV), "total_minutes": round((time.time() - t0) / 60, 1), "runs": train_log}, indent=1))
    m = evaluate("sfcn_ft")
    log.info("sfcn_ft: MAE %.2f r %.3f AUC %.3f ICC %.3f SDC %.2f", m["mae"], m["r"], m["clinical_validity"]["auc"],
             m["test_retest"]["icc_3_1"], m["test_retest"]["smallest_detectable_change"])


if __name__ == "__main__":
    main()
