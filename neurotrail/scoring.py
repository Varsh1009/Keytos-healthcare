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
                "active_min_week": "Activity (self-report)", "phq9": "Mood (PHQ-9)",
                "sleep_dev": "Sleep (distance from 7 h)", "sedentary_min_day": "Sitting time"}


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


def lever_age(profile: dict) -> dict:
    """
    Years of processing-speed aging associated with the player's modifiable
    factors versus healthy targets, from the NHANES survey-weighted model.

    years = sum_k beta_k (x_user_k - x_target_k) / (-beta_age)
    Positive = your current factors go with slower speed typical of an older
    person. 95% CI by Monte Carlo over the coefficient covariance.
    """
    draws, names = _draws()
    age_b = draws[:, names.index("age")]
    x = {
        "sbp": float(np.clip(profile["sbp"], 90, 200)),
        "diabetes": float(profile["diabetes"]),
        "current_smoker": float(profile["current_smoker"]),
        "active_min_week": float(np.clip(profile["active_min_week"], 0, 3000)),
        "phq9": float(np.clip(profile["phq9"], 0, 27)),
        "sleep_dev": abs(float(np.clip(profile["sleep_hours"], 2, 12)) - 7),
        "sedentary_min_day": float(np.clip(profile["sedentary_min_day"], 0, 1140)),
    }
    # Only factors with a statistically significant NHANES association (p<0.05)
    # enter the headline total. Null associations (e.g. self-reported activity,
    # sitting time) are shown but excluded, because their point estimates are
    # noise or confounded (people with more education sit more and score higher).
    per, total = {}, np.zeros(len(draws))
    for k, v in x.items():
        pts = draws[:, names.index(k)] * (v - TARGETS[k])
        yrs = -(pts / -age_b)  # flip so "older" is positive
        sig = _p_value(k) < 0.05
        if sig:
            total += yrs
        per[k] = {"label": LEVER_LABELS[k], "value": v, "target": TARGETS[k],
                  "years": float(np.median(yrs)),
                  "ci": [float(np.percentile(yrs, 2.5)), float(np.percentile(yrs, 97.5))],
                  "significant": bool(sig), "in_total": bool(sig)}
    return {"years": float(np.median(total)),
            "ci": [float(np.percentile(total, 2.5)), float(np.percentile(total, 97.5))],
            "per_factor": dict(sorted(per.items(), key=lambda kv: -kv[1]["years"])),
            "age_coef": associations()["age_coef"], "n": associations()["n"],
            "rule": "Total sums factors with p<0.05 in NHANES; others shown, not counted."}


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
