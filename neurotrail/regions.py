"""
Region-by-region brain measurements on real MRI (Harvard-Oxford atlas, MNI 2 mm).

For every scan we compute, in each atlas region, a *tissue index*: the mean of the brain-normalized T1
intensity inside the region. In a skull-stripped, MNI-registered T1, losing brain tissue (atrophy)
means more cerebrospinal fluid (dark) inside a region, so the index drops. For the ventricles (fluid
spaces) a lower index means the ventricles are larger. This is a simple, transparent proxy, not
FreeSurfer volumetry; we validate it on the real OASIS scans (dementia vs age-matched normals).

Norms: for each region, linear regression of the index on age, age^2 and sex in cognitively normal
OASIS-1 adults (first sessions). A new scan's region score is a z-score vs people of the same age
and sex.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import nibabel as nib
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "models" / "artifacts"
NL = str(ROOT / "data" / "raw" / "nilearn")

# Deep (subcortical) structures: Harvard-Oxford sub atlas label names, left+right merged.
DEEP = {
    "hippocampus": ("Hippocampus", ["Left Hippocampus", "Right Hippocampus"], "Memory: forming new memories"),
    "amygdala": ("Amygdala", ["Left Amygdala", "Right Amygdala"], "Emotion and fear, emotional memories"),
    "thalamus": ("Thalamus", ["Left Thalamus", "Right Thalamus"], "Relay station for senses and alertness"),
    "caudate": ("Caudate", ["Left Caudate", "Right Caudate"], "Planning movements, habits and goals"),
    "putamen": ("Putamen", ["Left Putamen", "Right Putamen"], "Smooth, automatic movement"),
    "pallidum": ("Pallidum", ["Left Pallidum", "Right Pallidum"], "Controls the strength of movement"),
    "accumbens": ("Nucleus accumbens", ["Left Accumbens", "Right Accumbens"], "Reward and motivation"),
    "brainstem": ("Brainstem", ["Brain-Stem"], "Breathing, heartbeat, sleep; holds the substantia nigra"),
    "ventricles": ("Lateral ventricles", ["Left Lateral Ventricle", "Right Lateral Ventricle"], "Fluid spaces; they get bigger when brain tissue shrinks"),
}

# Plain-language functions for the 48 Harvard-Oxford cortical regions (grouped by keyword).
FUNC = [
    ("Frontal Pole", "Planning ahead and complex decisions"), ("Frontal Orbital", "Decisions, reward and social behavior"),
    ("Frontal Medial", "Self-control and decision-making"), ("Superior Frontal", "Self-awareness and working memory"),
    ("Middle Frontal", "Attention and working memory"), ("Inferior Frontal", "Speech production (Broca's area)"),
    ("Precentral", "Moving your body (primary motor cortex)"), ("Postcentral", "Touch and body sense"),
    ("Juxtapositional", "Starting movements"), ("Insular", "Body signals, taste and emotion"),
    ("Temporal Pole", "Knowing what words and faces mean"), ("Superior Temporal", "Hearing and understanding speech"),
    ("Heschl", "Hearing (primary auditory cortex)"), ("Planum", "Processing sounds and language"),
    ("Middle Temporal", "Word meaning and memory"), ("Inferior Temporal", "Recognizing objects and faces"),
    ("Fusiform", "Recognizing faces and words"), ("Parahippocampal", "Memory for places and events"),
    ("Cingulate Gyrus, anterior", "Attention, emotion and error checking"), ("Cingulate Gyrus, posterior", "Memory and self-reflection"),
    ("Paracingulate", "Thinking about others' minds"), ("Subcallosal", "Mood regulation"),
    ("Precuneous", "Memory, imagery and self-awareness"), ("Superior Parietal", "Spatial attention and reaching"),
    ("Supramarginal", "Language and body awareness"), ("Angular", "Reading, math and meaning"),
    ("Opercular", "Speech, taste and touch"), ("Lateral Occipital", "Seeing shapes and objects"),
    ("calcarine", "Vision (primary visual cortex)"), ("Cuneal", "Basic vision"), ("Lingual", "Vision and reading"),
    ("Occipital", "Vision"),
]


def _func(name: str) -> str:
    for key, f in FUNC:
        if key.lower() in name.lower():
            return f
    return ""


@lru_cache
def atlas():
    """Returns (cortical label volume, sub label volume, cort names, sub names) in RAS index order."""
    from nilearn import datasets
    c = datasets.fetch_atlas_harvard_oxford("cort-maxprob-thr25-2mm", data_dir=NL)
    s = datasets.fetch_atlas_harvard_oxford("sub-maxprob-thr25-2mm", data_dir=NL)
    load = lambda m: np.asanyarray((m if hasattr(m, "shape") else nib.load(m)).dataobj).astype(int)
    return load(c.maps), load(s.maps), list(c.labels), list(s.labels)


@lru_cache
def regions() -> list[dict]:
    cort, sub, cn, sn = atlas()
    out = []
    for i, n in enumerate(cn):
        if i == 0:
            continue
        rid = "c" + str(i)
        out.append({"id": rid, "name": n.replace(" (formerly Supplementary Motor Cortex)", "").replace(" (includes H1 and H2)", ""),
                    "kind": "cortex", "function": _func(n), "mask": ("cort", [i])})
    for rid, (name, labs, func) in DEEP.items():
        out.append({"id": rid, "name": name, "kind": "fluid" if rid == "ventricles" else "deep",
                    "function": func, "mask": ("sub", [sn.index(l) for l in labs])})
    return out


@lru_cache
def masks() -> dict[str, np.ndarray]:
    cort, sub, _, _ = atlas()
    return {r["id"]: np.isin(cort if r["mask"][0] == "cort" else sub, r["mask"][1]) for r in regions()}


def to_ras(v_las: np.ndarray) -> np.ndarray:
    """OASIS / training arrays are LAS (x flipped); the atlas is RAS."""
    return v_las[::-1, :, :]


def measure(v_las: np.ndarray) -> dict[str, float]:
    from .mri import normalize
    v = to_ras(normalize(v_las))
    return {rid: float(v[m].mean()) for rid, m in masks().items() if m.sum() > 20}


@lru_cache
def norms() -> dict:
    return json.loads((ART / "region_norms.json").read_text())


def zscores(vals: dict[str, float], age: float, female: bool) -> dict[str, float]:
    N = norms()["regions"]
    out = {}
    for rid, v in vals.items():
        n = N.get(rid)
        if not n:
            continue
        b = n["coef"]
        pred = b[0] + b[1] * age + b[2] * age ** 2 + b[3] * float(female)
        out[rid] = float((v - pred) / n["sd"])
    return out


def public_regions() -> list[dict]:
    return [{k: r[k] for k in ("id", "name", "kind", "function")} for r in regions()]
