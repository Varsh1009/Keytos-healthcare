"""Hand-checked examples for the shared brain-age evaluator (models/eval_brainage.py)."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))
import eval_brainage as E  # noqa: E402


def test_mae_and_r():
    assert E.mae([1, 2, 3], [2, 2, 5]) == pytest.approx(1.0)          # (1 + 0 + 2) / 3
    assert E.pearson_r([1, 2, 3], [2, 4, 6]) == pytest.approx(1.0)


def test_bias_correction_line_and_gap():
    a, b = E.fit_bias_correction([20, 40, 60], [30, 40, 50])            # pred = 0.5 age + 20
    assert (a, b) == (pytest.approx(0.5), pytest.approx(20.0))
    assert E.apply_bias_correction([40], [45], a, b)[0] == pytest.approx(5.0)   # 45 - (20 + 20)


def test_dementia_auc_uses_age_matched_normals_only():
    # The 20-year-old normal with a big gap is younger than every dementia case, so it is excluded.
    out = E.dementia_auc(gap=[9, -1, 0, 3, 4], cdr=[0, 0, np.nan, 0.5, 1], age=[20, 72, 75, 72, 80], n_boot=50)
    assert out["auc"] == pytest.approx(1.0)
    assert out["n_normal_age_matched"] == 2 and out["n_dementia"] == 2
    assert out["mean_gap_dementia"] == pytest.approx(3.5)


def test_icc_3_1_hand_example_and_offset_invariance():
    # Two-way ANOVA by hand: MS_rows = 13/6, MS_err = 1/6 -> ICC = (13/6 - 1/6) / (13/6 + 1/6) = 6/7
    assert E.icc_3_1([1, 2, 3], [2, 2, 4]) == pytest.approx(6 / 7)
    # ICC(3,1) is a consistency ICC: a constant shift between sessions does not lower it.
    assert E.icc_3_1([10, 30, 50], [15, 35, 55]) == pytest.approx(1.0)


def test_smallest_detectable_change():
    # SEM = 10 * sqrt(1 - 0.75) = 5; MDC95 = 1.96 * sqrt(2) * 5
    assert E.smallest_detectable_change(0.75, 10) == pytest.approx(1.96 * np.sqrt(2) * 5)


def test_interval_coverage():
    assert E.interval_coverage([1, 5, 10], [0, 6, 9], [2, 7, 11]) == pytest.approx(2 / 3)


def test_evaluate_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "RESULTS", tmp_path)
    rows = []
    for i, age in enumerate([20, 25, 30, 40, 50, 60, 70, 75, 80, 85]):
        rows.append([f"S{i}", f"S{i}_MR1", i % 5, age, "F", 0, age + (2 if i % 2 else -2), 3.0])
    rows += [["S0", "S0_MR2", 0, 20, "F", 0, 19.0, 3.0], ["S1", "S1_MR2", 1, 25, "F", 0, 27.5, 3.0],
             ["S2", "S2_MR2", 2, 30, "F", 0, 28.0, 3.0],
             ["D0", "D0_MR1", -1, 76, "M", 1, 86.0, np.nan], ["D1", "D1_MR1", -1, 82, "M", 0.5, 90.0, np.nan]]
    pd.DataFrame(rows, columns=E.OOF_COLUMNS).to_csv(tmp_path / "oof_toy.csv", index=False)
    m = E.evaluate("toy", tmp_path / "oof_toy.csv")
    assert m["mae"] == pytest.approx(2.0) and m["n_normal"] == 10
    assert m["interval_coverage_95"] == pytest.approx(1.0)              # |error| 2 < 1.96 * 3
    assert m["test_retest"]["n_pairs"] == 3
    assert m["clinical_validity"]["auc"] == pytest.approx(1.0)
    assert (tmp_path / "metrics_toy.json").exists()
