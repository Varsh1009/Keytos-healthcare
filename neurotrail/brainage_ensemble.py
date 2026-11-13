"""
Upgraded MRI brain-age inference for the app: several image models, a calibrated 95% interval and a
confidence label. Everything learned (weights, residual SD, interval scale, bias line) comes from
results/<config>_config.json and results/metrics_<config>.json, written by models/ensemble.py.

MRI_MODEL picks what the app uses. "baseline_4mm" is the original 4 mm CNN; switching to it restores
the original behaviour if anything breaks (set NEUROTRAIL_MRI_MODEL or edit the constant below).

No leakage for OASIS samples: a cognitively normal training scan is scored only by the models of the
fold that never saw that person, with that fold's weights and bias line. Dementia scans and new uploads
(nobody's training data) use every fold model and the values fitted on all normal people.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch

from .brainage_nets import CROP_2MM, SFCN, SFCN_FULL, SFCN_SHAPE, BrainAgeCNN2mm, crop_2mm, sfcn_prep
from .mri import SHAPE, BrainAgeCNN, check_format, downsample, normalize

ROOT = Path(__file__).resolve().parents[1]
ART, CKPT, RESULTS = ROOT / "models" / "artifacts", ROOT / "models" / "checkpoints", ROOT / "results"
CHOICES = ("ensemble", "baseline_4mm", "cnn_2mm", "sfcn_ft")
MRI_MODEL = os.environ.get("NEUROTRAIL_MRI_MODEL", "ensemble")
LABELS = {"baseline_4mm": "4 mm CNN (baseline)", "cnn_2mm": "2 mm CNN", "sfcn_ft": "SFCN (UK Biobank, fine-tuned)"}
MULTI_SEED = {"cnn_2mm"}          # models whose out-of-fold pred_std is the spread across seeds
Z95 = 1.96
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def config_name(choice: str) -> str:
    return "ensemble" if choice == "ensemble" else f"cal_{choice}"


@lru_cache
def config(choice: str) -> dict:
    name = config_name(choice)
    cfg = json.loads((RESULTS / f"{name}_config.json").read_text())
    cfg["metrics"] = json.loads((RESULTS / f"metrics_{name}.json").read_text())
    return cfg


def available(choice: str = MRI_MODEL) -> bool:
    try:
        return all(len(members(m)) > 0 for m in config(choice)["models"])
    except (FileNotFoundError, KeyError):
        return False


# ------------------------------------------------------------------ model members (fold, model)
@lru_cache
def members(name: str) -> list[tuple[int, torch.nn.Module]]:
    out = []
    if name == "baseline_4mm":
        files = [(k, ART / f"mri_cnn_fold{k}.pt") for k in range(5)]
    elif name == "cnn_2mm":
        files = [(k, f) for k in range(5) for f in sorted((CKPT / "cnn_2mm").glob(f"fold{k}_seed*.pt"))]
    elif name == "sfcn_ft":
        files = [(k, CKPT / "sfcn_ft" / f"fold{k}.pt") for k in range(5)]
    else:
        raise ValueError(name)
    for k, f in files:
        if not f.exists():
            continue
        ck = torch.load(f, map_location="cpu", weights_only=False)
        m = {"baseline_4mm": BrainAgeCNN, "cnn_2mm": BrainAgeCNN2mm}.get(name, lambda: SFCN(output_dim=1))()
        m.load_state_dict(ck["state"])
        m.y_mean, m.y_std = ck["y_mean"], ck["y_std"]
        out.append((k, m.to(DEV).eval()))
    return out


def model_input(name: str, v: np.ndarray) -> torch.Tensor:
    if name == "baseline_4mm":
        return torch.from_numpy(downsample(normalize(v))).float()[None, None].to(DEV)
    if name == "cnn_2mm":
        return torch.from_numpy(crop_2mm(normalize(v))).float()[None, None].to(DEV)
    x = np.nan_to_num(v.astype(np.float32))
    return sfcn_prep(torch.from_numpy(x / max(float(x.mean()), 1e-6))[None, None].to(DEV))


def _cam_to_grid(name: str, cam: torch.Tensor) -> np.ndarray:
    """Grad-CAM map from a model's feature grid back onto the 91 x 109 x 91 scan grid."""
    cam = cam.float().cpu()
    if name == "baseline_4mm":
        return torch.nn.functional.interpolate(cam, size=SHAPE, mode="trilinear", align_corners=False)[0, 0].numpy()
    if name == "cnn_2mm":
        size = tuple(c.stop - c.start for c in CROP_2MM)
        out = np.zeros(SHAPE, np.float32)
        out[CROP_2MM] = torch.nn.functional.interpolate(cam, size=size, mode="trilinear", align_corners=False)[0, 0].numpy()
        return out
    full = torch.zeros((1, 1) + SFCN_FULL)
    s = [(f - c) // 2 for f, c in zip(SFCN_FULL, SFCN_SHAPE)]
    full[:, :, s[0]:s[0] + SFCN_SHAPE[0], s[1]:s[1] + SFCN_SHAPE[1], s[2]:s[2] + SFCN_SHAPE[2]] = \
        torch.nn.functional.interpolate(cam, size=SFCN_SHAPE, mode="trilinear", align_corners=False)
    return torch.nn.functional.interpolate(full, size=SHAPE, mode="trilinear", align_corners=False)[0, 0].numpy()


def run_model(name: str, v: np.ndarray, fold: int | None, cam: bool = False) -> tuple[list[float], np.ndarray | None]:
    """Predicted ages from the eligible members (fold k only, or all) and optionally a mean Grad-CAM."""
    x = model_input(name, v)
    preds, cams = [], []
    for k, m in members(name):
        if fold is not None and k != fold:
            continue
        if not cam:
            with torch.no_grad():
                preds.append(float(m(x).item() * m.y_std + m.y_mean))
            continue
        feats_mod = m.features[-1] if hasattr(m, "features") else m.feature_extractor[-1]
        feats = {}
        h = feats_mod.register_forward_hook(lambda _m, _i, o: feats.__setitem__("a", o))
        out = m(x)
        a = feats["a"]
        a.retain_grad()
        out.sum().backward()
        w = a.grad.mean(dim=(2, 3, 4), keepdim=True)
        cams.append(_cam_to_grid(name, torch.relu((w * a).sum(1, keepdim=True)).detach()))
        preds.append(float(out.item() * m.y_std + m.y_mean))
        h.remove()
        m.zero_grad()
    if not cams:
        return preds, None
    c = np.mean(cams, axis=0)
    c = c / (c.max() + 1e-9)
    c[v <= 0] = 0
    return preds, c


def best_image_model(models: list[str]) -> str:
    maes = {m: json.loads((RESULTS / f"metrics_{m}.json").read_text())["mae"] for m in models
            if (RESULTS / f"metrics_{m}.json").exists()}
    return min(maes, key=maes.get) if maes else models[0]


def estimate(v: np.ndarray, age: float | None, fold: int | None = None, choice: str = MRI_MODEL) -> dict:
    """Brain age, gap, 95% interval, confidence + reasons, per-model estimates and Grad-CAM for one scan."""
    import sys
    sys.path.insert(0, str(ROOT / "models"))
    from ensemble import band, confidence_label  # same rules as the validated pipeline

    fmt = check_format(v)
    if tuple(v.shape) != SHAPE:
        return {"format": fmt}
    cfg = config(choice)
    models = cfg["models"]
    fit = cfg["per_fold"][str(fold)] if fold is not None else cfg["final"]
    cam_model = best_image_model(models)
    per_model, P, S, cam = [], [], [], None
    for name in models:
        preds, c = run_model(name, v, fold, cam=(name == cam_model))
        cam = c if c is not None else cam
        P.append(float(np.mean(preds)))
        S.append(float(np.std(preds, ddof=1)) if len(preds) > 1 and name in MULTI_SEED else np.nan)
        per_model.append({"model": name, "label": LABELS[name], "brain_age": P[-1], "n_models": len(preds)})
    P, S = np.array(P), np.array(S)
    w = np.array([fit["weights"][m] for m in models])
    pred = float(P @ w)
    var_b = float(((P - pred) ** 2) @ w + np.nan_to_num(S ** 2) @ w)
    sd = fit["scale"] * np.sqrt(var_b + fit["residual_sd_by_band"][str(int(band([pred])[0]))] ** 2)
    lo, hi = pred - Z95 * sd, pred + Z95 * sd
    disagreement = float(P.max() - P.min())
    conf, reasons = confidence_label(hi - lo, fmt["similarity"], age, disagreement, cfg["rules"],
                                     cfg["similarity_cutoff"], cfg["similarity_comfort_p5"], tuple(cfg["age_range"]))
    met = cfg["metrics"]
    out = {"format": fmt, "brain_age": pred, "chronological_age": age, "interval_low": float(lo), "interval_high": float(hi),
           "confidence": conf, "confidence_reasons": reasons, "per_model": per_model, "model_disagreement": disagreement,
           "mri_model": choice, "cam_model": cam_model, "mae": met["mae"],
           "sdc": met["test_retest"]["smallest_detectable_change"], "fold_preds": [p["brain_age"] for p in per_model]}
    if age is not None:
        line = met["bias_correction_by_fold"][str(fold)] if fold is not None else met["bias_correction_all_normal"]
        out["age"] = age
        out["gap"] = float(pred - (line["a"] * age + line["b"]))
        out["gap_low"], out["gap_high"] = out["gap"] - (pred - lo), out["gap"] + (hi - pred)
    out["_cam"] = cam
    return out
