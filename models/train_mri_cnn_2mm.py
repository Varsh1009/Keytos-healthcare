"""
Higher-resolution 3D CNN brain age at native 2 mm (the baseline downsamples to 4 mm).

Same protocol as every model here (results/splits.json, CDR-0 MR1 training only, subject-level folds):
  * Input: z-scored brain, fixed crop 86 x 102 x 84 of the 2 mm MNI grid (no tissue cut).
  * BrainAgeCNN2mm: baseline design + one more stride-2 block, batch norm, dropout before the head.
  * Augmentation (training only): random shifts up to 2 voxels, intensity scaling +-10%.
    Left-right flips are OFF by default (brains are slightly asymmetric); --flip turns them on.
  * Smooth-L1 loss, AdamW, cosine schedule, early stopping on an inner validation split taken from
    the training fold only.
  * 3 seeds per fold. Normal people: mean (and SD) of their held-out fold's seeds. Repeat scans: same
    fold models. Dementia participants: all 15 models (none saw them).
Outputs: models/checkpoints/cnn_2mm[_flip]/fold{k}_seed{s}.pt, results/oof_cnn_2mm[_flip].csv,
         results/train_log_cnn_2mm[_flip].json, results/metrics_cnn_2mm[_flip].json

Run:  python models/train_mri_cnn_2mm.py [--flip] [--seeds 3] [--smoke]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "models"))
from neurotrail.brainage_nets import CROP_2MM, BrainAgeCNN2mm, crop_2mm  # noqa: E402
from neurotrail.mri import normalize  # noqa: E402
from eval_brainage import evaluate  # noqa: E402
from splits import DEMENTIA_FOLD, fold_column, scan_table, train_test_indices  # noqa: E402
from train_utils import DEV, fit, inner_split, predict  # noqa: E402

log = logging.getLogger("cnn_2mm")
RESULTS = ROOT / "results"


def make_augment(flip: bool):
    def augment(x: torch.Tensor) -> torch.Tensor:
        out = torch.empty_like(x)
        for i in range(len(x)):
            xi = x[i]
            if flip and torch.rand(1) < 0.5:
                xi = torch.flip(xi, dims=[1])                       # left-right (x axis)
            sh = [int(s) for s in torch.randint(-2, 3, (3,))]
            out[i] = torch.roll(xi, shifts=sh, dims=[1, 2, 3])
        return out * torch.empty(len(x), 1, 1, 1, 1, device=x.device).uniform_(0.9, 1.1)
    return augment


def load_volumes(df: pd.DataFrame) -> torch.Tensor:
    vols = [crop_2mm(normalize(np.asanyarray(nib.load(p).dataobj, dtype=np.float32))) for p in df["path"]]
    X = torch.from_numpy(np.stack(vols).astype(np.float16))
    return X.to(DEV) if DEV.type == "cuda" else X


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--flip", action="store_true", help="add left-right flip augmentation")
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--smoke", action="store_true", help="fold 0, seed 0, 3 epochs; writes nothing")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    name = "cnn_2mm_flip" if a.flip else "cnn_2mm"
    ck_dir = ROOT / "models" / "checkpoints" / name
    t0 = time.time()

    df = scan_table()
    df["fold"] = fold_column(df)
    ages = df["Age"].to_numpy(float)
    X = load_volumes(df)
    log.info("Loaded %d volumes %s on %s in %.0fs", len(X), tuple(X.shape[1:]), DEV, time.time() - t0)
    rescans = np.where(df["session"] == "MR2")[0]
    dement = np.where(df["fold"] == DEMENTIA_FOLD)[0]

    seeds = [0] if a.smoke else list(range(a.seeds))
    folds = [0] if a.smoke else list(range(5))
    epochs = 3 if a.smoke else a.epochs
    per_scan: dict[int, list[float]] = {}
    train_log = []
    for k in folds:
        tri, tei = train_test_indices(df, k)
        held = np.r_[tei, rescans[df["fold"].to_numpy()[rescans] == k]]
        for s in seeds:
            tr, va = inner_split(tri, ages, seed=1000 * s + k)
            model = BrainAgeCNN2mm()
            t1 = time.time()
            info = fit(model, X, ages, tr, va, augment=make_augment(a.flip), epochs=epochs, seed=1000 * s + k,
                       label=f"f{k}s{s}")
            p_held, p_dem = predict(model, X, held), predict(model, X, dement)
            for i, p in zip(np.r_[held, dement], np.r_[p_held, p_dem]):
                per_scan.setdefault(int(i), []).append(float(p))
            test_mae = float(np.mean(np.abs(p_held[:len(tei)] - ages[tei])))
            info |= {"fold": k, "seed": s, "n_train": len(tr), "n_val": len(va), "test_mae": test_mae,
                     "minutes": round((time.time() - t1) / 60, 2)}
            train_log.append(info)
            log.info("  fold %d seed %d: val MAE %.2f, held-out MAE %.2f, %.1f min", k, s, info["val_mae"], test_mae, info["minutes"])
            if a.smoke:
                log.info("smoke test done; nothing written")
                return
            ck_dir.mkdir(parents=True, exist_ok=True)
            torch.save({"state": model.state_dict(), "y_mean": model.y_mean, "y_std": model.y_std, "arch": "BrainAgeCNN2mm",
                        "crop": [[c.start, c.stop] for c in CROP_2MM], "fold": k, "seed": s, "flip_aug": a.flip, **info},
                       ck_dir / f"fold{k}_seed{s}.pt")

    pred = np.array([np.mean(per_scan[i]) for i in range(len(df))])
    std = np.array([np.std(per_scan[i], ddof=1) if len(per_scan[i]) > 1 else np.nan for i in range(len(df))])
    RESULTS.mkdir(exist_ok=True)
    pd.DataFrame({"subject_id": df["subject"], "scan_id": df["ID"], "fold": df["fold"], "age": ages, "sex": df["M/F"],
                  "cdr": df["CDR"], "pred_age": pred, "pred_std": std}).to_csv(RESULTS / f"oof_{name}.csv", index=False)
    (RESULTS / f"train_log_{name}.json").write_text(json.dumps(
        {"model": name, "seeds": seeds, "epochs_max": epochs, "device": str(DEV),
         "total_minutes": round((time.time() - t0) / 60, 1), "runs": train_log}, indent=1))
    m = evaluate(name)
    log.info("%s: MAE %.2f r %.3f AUC %.3f ICC %.3f SDC %.2f", name, m["mae"], m["r"], m["clinical_validity"]["auc"],
             m["test_retest"]["icc_3_1"], m["test_retest"]["smallest_detectable_change"])


if __name__ == "__main__":
    main()
