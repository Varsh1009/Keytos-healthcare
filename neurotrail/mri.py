"""
MRI brain-age inference on real scans: model definition, preprocessing checks, Grad-CAM.

Uploads must match the training format to be meaningful: a skull-stripped T1 registered to the
2 mm MNI grid (91 x 109 x 91), like the OASIS-1 processed scans. We check this and tell the user
when a scan doesn't match instead of silently returning a number.
"""
from __future__ import annotations

import io
import json
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np

try:   # PyTorch is only needed for the (retired) CNN; format checks and slice previews work without it
    import torch
    import torch.nn as nn
    _Module = nn.Module
except ImportError:  # pragma: no cover
    torch = nn = None
    _Module = object

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "models" / "artifacts"
SHAPE = (91, 109, 91)


def normalize(v: np.ndarray) -> np.ndarray:
    """Z-score inside the brain mask (voxels > 0), keep background at 0."""
    v = np.nan_to_num(v.astype(np.float32))
    m = v > 0
    if m.sum() < 1000:
        return v
    mu, sd = v[m].mean(), v[m].std() + 1e-6
    out = np.zeros_like(v)
    out[m] = (v[m] - mu) / sd
    return out


def downsample(v: np.ndarray) -> np.ndarray:
    """2 mm -> 4 mm by 2x2x2 block averaging (91x109x91 -> 46x55x46)."""
    v = np.pad(v, [(0, s % 2) for s in v.shape])
    a, b, c = (s // 2 for s in v.shape)
    return v.reshape(a, 2, b, 2, c, 2).mean(axis=(1, 3, 5)).astype(np.float32)


class BrainAgeCNN(_Module):
    """Compact 3D CNN for brain age: 5 conv blocks (stride-2 downsampling) + global average pool."""

    def __init__(self, ch=(16, 32, 64, 128, 128)):
        super().__init__()
        layers, c_in = [], 1
        for i, c in enumerate(ch):
            stride = 1 if i == 0 else 2   # stride-2 convs downsample (no 3D pooling needed)
            layers += [nn.Conv3d(c_in, c, 3, stride=stride, padding=1, bias=False), nn.BatchNorm3d(c), nn.ReLU(inplace=True)]
            c_in = c
        self.features = nn.Sequential(*layers)
        self.head = nn.Sequential(nn.AdaptiveAvgPool3d(1), nn.Flatten(), nn.Dropout(0.3), nn.Linear(c_in, 1))
        self.y_mean, self.y_std = 0.0, 1.0

    def forward(self, x):
        return self.head(self.features(x))


@lru_cache
def ensemble() -> list[BrainAgeCNN]:
    if torch is None:
        raise RuntimeError("PyTorch is not installed (pip install torch) - needed only for the research CNN.")
    models = []
    for k in range(5):
        f = ART / f"mri_cnn_fold{k}.pt"
        if not f.exists():
            continue
        ck = torch.load(f, map_location="cpu", weights_only=False)
        m = BrainAgeCNN()
        m.load_state_dict(ck["state"])
        m.y_mean, m.y_std = ck["y_mean"], ck["y_std"]
        m.eval()
        models.append(m)
    return models


@lru_cache
def metrics() -> dict:
    return json.loads((ART / "mri_cnn_metrics.json").read_text())


@lru_cache
def template() -> np.ndarray:
    return np.load(ART / "mri_template.npy")


def load_upload(data: bytes, filename: str) -> np.ndarray:
    import nibabel as nib
    suffix = ".nii.gz" if filename.lower().endswith(".gz") else ".nii"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(data)
        tmp.flush()
        img = nib.load(tmp.name)
        img = nib.as_closest_canonical(img)   # RAS
        v = np.asanyarray(img.dataobj, dtype=np.float32).squeeze()
        # Training scans (OASIS) are stored LAS (x flipped); match that orientation.
        return v[::-1, :, :] if v.ndim == 3 else v


def check_format(v: np.ndarray) -> dict:
    """Is this scan in the training format? Shape, skull-stripping and template similarity."""
    issues = []
    if v.ndim != 3:
        return {"ok": False, "issues": [f"Expected a 3D volume, got {v.ndim} dimensions."], "similarity": None}
    if tuple(v.shape) != SHAPE:
        issues.append(f"Shape {tuple(v.shape)} isn't the 2 mm MNI grid {SHAPE}; register the scan to MNI 2 mm first.")
        return {"ok": False, "issues": issues, "similarity": None}
    frac = float((v > 0).mean())
    if frac > 0.45:
        issues.append(f"{frac:.0%} of voxels are non-zero; the scan looks not skull-stripped.")
    sim = float(np.corrcoef(normalize(v).ravel(), template().ravel())[0, 1])
    thr = metrics().get("format_check", {}).get("similarity_threshold", 0.3)
    if sim < thr:
        issues.append(f"Low similarity to the training brains (r = {sim:.2f}, below the {thr:.2f} that 99% of "
                      "real training scans reach); results would not be reliable.")
    return {"ok": not issues, "issues": issues, "similarity": sim}


def heldout_fold(file: str) -> int | None:
    """For a cognitively normal training scan, the CV fold whose model never saw that person."""
    import pandas as pd
    from sklearn.model_selection import KFold
    d = pd.read_csv(ART / "mri_cnn_predictions.csv")
    normal = d.index[(d["session"] == "MR1") & (d["status"] == "cognitively normal")].to_numpy()
    subj = d.loc[d["file"] == file, "ID"].str[:9]
    if subj.empty:
        return None
    for k, (_, te) in enumerate(KFold(5, shuffle=True, random_state=0).split(normal)):
        if subj.iloc[0] in set(d.loc[normal[te], "ID"].str[:9]):
            return k
    return None


def predict_with_cam(v: np.ndarray, only: int | None = None) -> dict:
    """Ensemble brain age + Grad-CAM (which voxels raised the predicted age).
    only=k uses just fold k's model (for scans the other folds were trained on)."""
    x = torch.from_numpy(downsample(normalize(v))).float()[None, None]
    preds, cams = [], []
    models = ensemble() if only is None else [ensemble()[only]]
    for m in models:
        feats = {}
        h = m.features[-1].register_forward_hook(lambda _m, _i, o: feats.__setitem__("a", o))
        xx = x.clone().requires_grad_(False)
        out = m(xx)
        a = feats["a"]
        a.retain_grad()
        out.sum().backward()
        w = a.grad.mean(dim=(2, 3, 4), keepdim=True)
        cam = torch.relu((w * a).sum(1, keepdim=True))
        cam = torch.nn.functional.interpolate(cam, size=SHAPE, mode="trilinear", align_corners=False)[0, 0]
        cams.append(cam.detach().numpy())
        preds.append(float(out.item() * m.y_std + m.y_mean))
        h.remove()
        m.zero_grad()
    cam = np.mean(cams, axis=0)
    cam = cam / (cam.max() + 1e-9)
    cam[v <= 0] = 0
    return {"brain_age": float(np.mean(preds)), "fold_preds": preds, "cam": cam}


def slices_png(v: np.ndarray, cam: np.ndarray | None = None) -> dict[str, bytes]:
    """Axial / coronal / sagittal mid-slices as PNGs, with an optional heatmap overlay."""
    from PIL import Image

    def to_img(sl: np.ndarray, hm: np.ndarray | None) -> bytes:
        g = sl - sl.min()
        g = (g / (g.max() + 1e-9) * 255).astype(np.uint8)
        rgb = np.stack([g, g, g], -1).astype(np.float32)
        if hm is not None:
            h = np.clip(hm, 0, 1)[..., None]
            heat = np.concatenate([np.ones_like(h) * 255, h * 200, np.zeros_like(h)], -1)  # orange
            rgb = rgb * (1 - 0.55 * h) + heat * 0.55 * h
        im = Image.fromarray(np.flipud(rgb.astype(np.uint8)).copy()).resize((sl.shape[1] * 3, sl.shape[0] * 3), Image.BICUBIC)
        b = io.BytesIO()
        im.save(b, "PNG")
        return b.getvalue()

    cx, cy, cz = (s // 2 for s in v.shape)
    cuts = {"axial": (v[:, :, cz + 4].T, None if cam is None else cam[:, :, cz + 4].T),
            "coronal": (v[:, cy - 6, :].T, None if cam is None else cam[:, cy - 6, :].T),
            "sagittal": (v[cx - 8, :, :].T, None if cam is None else cam[cx - 8, :, :].T)}
    return {k: to_img(a, b) for k, (a, b) in cuts.items()}


def analyze(v: np.ndarray, age: float | None, only: int | None = None) -> dict:
    fmt = check_format(v)
    if tuple(v.shape) != SHAPE:
        return {"format": fmt}
    r = predict_with_cam(v, only)
    m = metrics()
    out = {"format": fmt, "brain_age": r["brain_age"], "fold_preds": r["fold_preds"],
           "mae": m["mae"], "sdc": m["test_retest"]["smallest_detectable_change"]}
    if age is not None:
        b = m["bias_correction"]
        out["age"] = age
        out["gap"] = float((r["brain_age"] - age) - (b["slope"] * age + b["intercept"]))
    out["_cam"] = r["cam"]
    return out
