"""Ensemble weights, intervals and the confidence label (models/ensemble.py)."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))
import ensemble as ENS  # noqa: E402

RULES = {"high_width": 8.0, "low_width": 14.0, "max_disagreement": 10.0}
ARGS = dict(rules=RULES, sim_cutoff=0.39, sim_comfort=0.5, age_range=(18, 94))


def test_weights_sum_to_one_and_favour_the_better_model():
    age = np.array([20.0, 40, 60, 80])
    w = ENS.inverse_mae2_weights({"good": age + 2, "bad": age + 4}, age)
    assert sum(w.values()) == pytest.approx(1.0)
    assert w["good"] == pytest.approx(0.8)                 # (1/4) / (1/4 + 1/16)


def test_interval_contains_the_mean_and_disagreement_widens_it():
    age = np.linspace(20, 90, 60)
    rng = np.random.default_rng(0)
    P = np.column_stack([age + rng.normal(0, 3, 60), age + rng.normal(0, 5, 60)])
    S = np.full_like(P, np.nan)
    fit = ENS.fit_ensemble(P, S, age, ["a", "b"])
    assert sum(fit["weights"].values()) == pytest.approx(1.0) and fit["scale"] > 0
    mean, sd = ENS.apply_ensemble(np.array([[50.0, 50.0], [40.0, 60.0]]), np.full((2, 2), np.nan), ["a", "b"], fit)
    lo, hi = mean - 1.96 * sd, mean + 1.96 * sd
    assert (lo < mean).all() and (mean < hi).all()
    assert sd[1] > sd[0]                                    # models disagreeing -> wider interval


def test_confidence_label_rules():
    assert ENS.confidence_label(6, 0.8, 50, 2, **ARGS)[0] == "high"
    assert ENS.confidence_label(10, 0.8, 50, 2, **ARGS)[0] == "medium"          # moderate width
    assert ENS.confidence_label(6, 0.45, 50, 2, **ARGS)[0] == "medium"          # near the similarity cutoff
    assert ENS.confidence_label(16, 0.8, 50, 2, **ARGS)[0] == "low"             # wide
    assert ENS.confidence_label(6, 0.8, 99, 2, **ARGS)[0] == "low"              # outside training ages
    label, reasons = ENS.confidence_label(6, 0.8, 50, 12, **ARGS)               # models disagree
    assert label == "low" and any("disagree" in r for r in reasons)
    assert ENS.confidence_label(6, 0.8, None, 2, **ARGS)[0] == "high"           # age unknown is allowed
