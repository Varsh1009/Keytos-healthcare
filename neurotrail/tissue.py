"""
Three atlas-based MRI tissue measures (replacing the earlier intensity index).

Each scan is skull-stripped, N4-corrected and registered to MNI 2 mm, so Harvard-Oxford masks line up.
Per scan we fit a 3-class Gaussian mixture (CSF / grey matter / white matter) to brain intensities
and use the soft posterior maps (less partial-volume error than hard labels).

  hippo_gm   mean grey-matter probability inside the hippocampus masks   (lower  = more atrophy)
  vent_csf   mean CSF probability in the lateral ventricles, dilated 1 voxel (higher = larger ventricles)
  bpf        brain parenchymal fraction (GM+WM)/(GM+WM+CSF) in the brain  (lower  = more atrophy)
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_dilation
from sklearn.mixture import GaussianMixture

from . import regions as R

ART = Path(__file__).resolve().parents[1] / "models" / "artifacts"
MEASURES = {
    "hippo_gm": {"name": "Hippocampus tissue", "plain": "how much grey matter is in the memory center", "bad": "low"},
    "vent_csf": {"name": "Ventricle size", "plain": "how much fluid fills the brain's inner spaces", "bad": "high"},
    "bpf": {"name": "Overall brain tissue", "plain": "how much of the skull space is brain tissue", "bad": "low"},
}


@lru_cache
def _masks():
    _, sub, _, sn = R.atlas()
    hip = np.isin(sub, [sn.index("Left Hippocampus"), sn.index("Right Hippocampus")])
    ven = np.isin(sub, [sn.index("Left Lateral Ventricle"), sn.index("Right Lateral Ventricle")])
    return hip, binary_dilation(ven, iterations=1)


def measure(v_las: np.ndarray) -> dict[str, float]:
    v = np.nan_to_num(v_las[::-1, :, :].astype(np.float32))      # LAS -> RAS (atlas orientation)
    brain = v > 0
    x = v[brain].reshape(-1, 1)
    rng = np.random.default_rng(0)
    sample = x[rng.choice(len(x), min(60000, len(x)), replace=False)]
    gmm = GaussianMixture(3, random_state=0, n_init=2).fit(sample)
    order = np.argsort(gmm.means_.ravel())                       # CSF < GM < WM in T1
    post = np.zeros((3,) + v.shape, np.float32)
    post[:, brain] = gmm.predict_proba(x)[:, order].T
    csf, gm, wm = post
    hip, ven = _masks()
    return {"hippo_gm": float(gm[hip].mean()),
            "vent_csf": float(csf[ven].mean()),
            "bpf": float((gm[brain] + wm[brain]).sum() / brain.sum())}


@lru_cache
def norms() -> dict:
    return json.loads((ART / "tissue_norms.json").read_text())


def score(vals: dict[str, float], age: float, female: bool) -> dict[str, dict]:
    """z vs healthy people of the same age and sex (age-dependent SD), in the disease direction."""
    N = norms()
    out = {}
    for k, v in vals.items():
        n = N["measures"][k]
        b, s = n["coef"], n["sd_coef"]
        pred = b[0] + b[1] * age + b[2] * age ** 2 + b[3] * float(female)
        sd = max(1e-6, s[0] + s[1] * age)
        z = (v - pred) / sd
        toward = -z if MEASURES[k]["bad"] == "low" else z           # positive = toward atrophy
        out[k] = {"value": v, "z": float(z), "toward_atrophy": float(toward),
                  "flag": bool(toward > N["threshold"]) and n["shown"], "shown": n["shown"]}
    return out
