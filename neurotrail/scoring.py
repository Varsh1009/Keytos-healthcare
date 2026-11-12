"""
Turn the trained models into numbers a player sees. Nothing here is made up:
each function reads model artifacts trained on NHANES or OASIS.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ART = Path(__file__).resolve().parents[1] / "models" / "artifacts"

# Targets used for the "lever" calculation (guideline-style healthy values).
TARGETS = {"sbp": 120.0, "diabetes": 0.0, "current_smoker": 0.0, "active_min_week": 150.0,
           "phq9": 0.0, "sleep_dev": 0.0, "sedentary_min_day": 360.0}
LEVER_LABELS = {"sbp": "Blood pressure", "diabetes": "Diabetes", "current_smoker": "Smoking",
                "active_min_week": "Activity (self-report)", "phq9": "Mood (PHQ-8)",
                "sleep_dev": "Sleep (outside 6-8 h)", "sedentary_min_day": "Sitting time"}


@lru_cache
def associations() -> dict:
    return json.loads((ART / "cognition_associations.json").read_text())["main"]


@lru_cache
def metrics(name: str) -> dict:
    return json.loads((ART / f"{name}_metrics.json").read_text())


@lru_cache
def brainage_model() -> dict:
    return joblib.load(ART / "brainage.joblib")


@lru_cache
def _draws(n: int = 20000) -> tuple[np.ndarray, list[str]]:
    a = associations()
    rng = np.random.default_rng(42)
    return rng.multivariate_normal(np.array([a["coefs"][k] for k in a["names"]]),
                                   np.array(a["cov"]), n), a["names"]


def _size(points: float) -> str:
    return "Bigger" if points >= 2 else "Medium" if points >= 0.75 else "Smaller" if points > 0.1 else "On target"


def lever_age(profile: dict) -> dict:
    """
    "What matters most for you": for each modifiable factor, how many points lower people scored
    on the NHANES processing-speed test (DSST) at your value vs the healthy target, after adjusting
    for age, sex, education and income (survey-weighted, cross-sectional association).

    Safety floors so nobody is rewarded for unhealthy extremes:
      * blood pressure: no credit below 120 (low BP can cause falls); unknown BP is left out.
      * mood: PHQ scores 0-4 count as on target.
      * sleep: 6-8 hours counts as on target (dead zone of 1 h around 7 h).
    Only factors significant in NHANES (p<0.05) count; the others are shown greyed.
    No "years" are shown to users; points are the unit.
    """
    draws, names = _draws()
    sbp = profile.get("sbp")
    x = {
        "sbp": None if sbp is None else max(float(np.clip(sbp, 90, 200)), 120.0),
        "diabetes": float(bool(profile["diabetes"])),
        "current_smoker": float(bool(profile["current_smoker"])),
        "active_min_week": float(np.clip(profile.get("active_min_week") or 0, 0, 3000)),
        "phq9": None if profile.get("phq9") is None else max(float(np.clip(profile["phq9"], 0, 27)), 4.0),
        "sleep_dev": max(abs(float(np.clip(profile["sleep_hours"], 2, 12)) - 7) - 1, 0.0),
        "sedentary_min_day": float(np.clip(profile.get("sedentary_min_day") or 360, 0, 1140)),
    }
    target = {**TARGETS, "phq9": 4.0}
    per, total = {}, np.zeros(len(draws))
    for k, v in x.items():
        sig = _p_value(k) < 0.05
        if v is None:
            per[k] = {"label": LEVER_LABELS[k], "value": None, "target": target[k], "points": None, "ci": None,
                      "significant": bool(sig), "known": False, "size": "Unknown"}
            continue
        lower = -draws[:, names.index(k)] * (v - target[k])     # points lower than at target (positive = worse)
        if sig:
            total += lower
        p = float(np.median(lower))
        per[k] = {"label": LEVER_LABELS[k], "value": v, "target": target[k], "points": p,
                  "ci": [float(np.percentile(lower, 2.5)), float(np.percentile(lower, 97.5))],
                  "significant": bool(sig), "known": True, "size": _size(p) if sig else "Not shown in data"}
    order = sorted(per.items(), key=lambda kv: (not kv[1]["significant"], not kv[1]["known"], -(kv[1]["points"] or 0)))
    return {"points": float(np.median(total)),
            "ci": [float(np.percentile(total, 2.5)), float(np.percentile(total, 97.5))],
            "per_factor": dict(order), "n": associations()["n"],
            "age_coef": associations()["age_coef"],
            "rule": "Points = how much lower people scored on a speed test (DSST) at your value vs the healthy target, "
                    "in NHANES 2011-2014 adults 60+. Only factors with a clear link (p<0.05) count."}


def _p_value(key: str) -> float:
    col = "sleep_hours" if key == "sleep_dev" else key
    for c in associations()["contrasts"]:
        if c["column"] == col:
            return c["p_value"]
    return 1.0


def brain_age(age: float, female: bool, nwbv: float, etiv: float) -> dict:
    """OASIS-trained brain age with bias-corrected gap and honest error bars."""
    m = brainage_model()
    X = pd.DataFrame([{"nWBV": nwbv, "eTIV": etiv, "female": float(female)}])
    ba = float(m["model"].predict(X)[0])
    gap = (ba - age) - (m["slope"] * age + m["intercept"])
    bm = metrics("brainage")
    return {"brain_age": ba, "gap": float(gap),
            "sdc": bm["test_retest"]["smallest_detectable_change_years"],
            "mae": bm[bm["chosen_model"]]["mae_mean"],
            "in_range": m["age_range"][0] <= age <= m["age_range"][1]}


def dsst_percentile(score: float, age: float, female: bool) -> float | None:
    """Percentile of a paper-DSST score among NHANES adults of the same sex, age ±5."""
    ref = pd.read_csv(ART / "nhanes_dsst_reference.csv")
    r = ref[(ref["female"] == float(female)) & (ref["age"].between(age - 5, age + 5))]
    if len(r) < 50:
        return None
    return float((r["dsst"] < score).mean() * 100)
