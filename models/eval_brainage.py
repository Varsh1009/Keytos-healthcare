"""
Shared brain-age evaluator: every model is judged with exactly this code.

Input: an out-of-fold CSV with columns
    subject_id, scan_id, fold, age, sex, cdr, pred_age, pred_std
  * fold = CV fold whose model never saw this subject; -1 = dementia (scored by all fold models).
  * pred_std may be empty for single models.

No leakage in the bias correction: for a scan in fold k, the age-bias line is fitted only on
out-of-fold predictions of cognitively normal people in the OTHER folds (dementia scans and new
uploads use the line fitted on all normal people, none of whom are dementia participants).

Run:  python models/eval_brainage.py <model_name> [results/oof_<model_name>.csv]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
OOF_COLUMNS = ["subject_id", "scan_id", "fold", "age", "sex", "cdr", "pred_age", "pred_std"]
Z95 = 1.96


# ------------------------------------------------------------------ basic accuracy
def mae(y_true, y_pred) -> float:
    return float(np.mean(np.abs(np.asarray(y_true, float) - np.asarray(y_pred, float))))


def pearson_r(y_true, y_pred) -> float:
    return float(stats.pearsonr(np.asarray(y_true, float), np.asarray(y_pred, float))[0])


# ------------------------------------------------------------------ age-bias correction
def fit_bias_correction(age, pred) -> tuple[float, float]:
    """Fit pred = a * age + b (on cognitively normal training-fold predictions)."""
    a, b = np.polyfit(np.asarray(age, float), np.asarray(pred, float), 1)
    return float(a), float(b)


def apply_bias_correction(age, pred, a: float, b: float) -> np.ndarray:
    """Corrected brain-age gap = pred - (a * age + b): 0 means 'typical for a healthy person this age'."""
    return np.asarray(pred, float) - (a * np.asarray(age, float) + b)


def corrected_gaps(df: pd.DataFrame) -> tuple[np.ndarray, dict]:
    """Per-scan corrected gap, each fold's line fitted on the other folds' normal OOF predictions."""
    normal = _normal_first(df)
    gap = np.full(len(df), np.nan)
    lines = {}
    for k in sorted(df["fold"].unique()):
        rows = (df["fold"] == k).to_numpy()
        fit = normal & (df["fold"] != k).to_numpy() if k >= 0 else normal
        a, b = fit_bias_correction(df.loc[fit, "age"], df.loc[fit, "pred_age"])
        gap[rows] = apply_bias_correction(df.loc[rows, "age"], df.loc[rows, "pred_age"], a, b)
        lines[int(k)] = {"a": a, "b": b}
    return gap, lines


# ------------------------------------------------------------------ clinical validity
def dementia_auc(gap, cdr, age, n_boot: int = 1000, seed: int = 0) -> dict:
    """AUC of the corrected gap for CDR>0 vs age-matched CDR 0, with a bootstrap 95% CI.
    Age matching = the baseline's method: normals at least as old as the youngest dementia participant."""
    gap, age = np.asarray(gap, float), np.asarray(age, float)
    cdr = np.nan_to_num(np.asarray(cdr, float), nan=0.0)
    dem = cdr > 0
    norm = (cdr == 0) & (age >= age[dem].min())
    y = np.r_[np.zeros(norm.sum()), np.ones(dem.sum())]
    g = np.r_[gap[norm], gap[dem]]
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(n_boot):
        i = rng.integers(0, len(y), len(y))
        if 0 < y[i].sum() < len(i):
            boots.append(roc_auc_score(y[i], g[i]))
    return {"auc": float(roc_auc_score(y, g)),
            "auc_ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
            "mean_gap_dementia": float(gap[dem].mean()), "mean_gap_normal_age_matched": float(gap[norm].mean()),
            "n_dementia": int(dem.sum()), "n_normal_age_matched": int(norm.sum()),
            "mannwhitney_p": float(stats.mannwhitneyu(gap[dem], gap[norm], alternative="greater").pvalue)}


# ------------------------------------------------------------------ reliability
def icc_3_1(scan1_pred, scan2_pred) -> float:
    """ICC(3,1): two-way mixed effects, consistency, single measurement (Shrout & Fleiss)."""
    x = np.column_stack([np.asarray(scan1_pred, float), np.asarray(scan2_pred, float)])
    n, k = x.shape
    grand = x.mean()
    ss_rows = k * ((x.mean(axis=1) - grand) ** 2).sum()
    ss_cols = n * ((x.mean(axis=0) - grand) ** 2).sum()
    ss_err = ((x - grand) ** 2).sum() - ss_rows - ss_cols
    ms_rows, ms_err = ss_rows / (n - 1), ss_err / ((n - 1) * (k - 1))
    return float((ms_rows - ms_err) / (ms_rows + (k - 1) * ms_err))


def smallest_detectable_change(icc: float, sd: float) -> float:
    """MDC95 = 1.96 * sqrt(2) * SEM, with SEM = sd * sqrt(1 - icc)."""
    return float(Z95 * np.sqrt(2) * sd * np.sqrt(max(0.0, 1 - icc)))


def interval_coverage(y_true, lower, upper) -> float:
    y = np.asarray(y_true, float)
    return float(np.mean((y >= np.asarray(lower, float)) & (y <= np.asarray(upper, float))))


# ------------------------------------------------------------------ full evaluation
def _normal_first(df: pd.DataFrame) -> np.ndarray:
    return ((df["cdr"].fillna(0) == 0) & df["scan_id"].str.endswith("MR1") & (df["fold"] >= 0)).to_numpy()


def test_retest(df: pd.DataFrame) -> dict:
    first = df[df["scan_id"].str.endswith("MR1")].set_index("subject_id")["pred_age"]
    second = df[df["scan_id"].str.endswith("MR2")].set_index("subject_id")["pred_age"]
    both = pd.concat([first, second], axis=1, join="inner").dropna().to_numpy()
    icc = icc_3_1(both[:, 0], both[:, 1])
    sd = float(np.sqrt((both[:, 0].var(ddof=1) + both[:, 1].var(ddof=1)) / 2))
    d = both[:, 1] - both[:, 0]
    return {"n_pairs": int(len(both)), "icc_3_1": icc, "sd_predictions": sd,
            "smallest_detectable_change": smallest_detectable_change(icc, sd),
            "mean_abs_diff": float(np.abs(d).mean()), "sd_diff": float(d.std(ddof=1)),
            "sdc_from_diff_sd": float(Z95 * d.std(ddof=1)),
            "note": "repeat scans come from 20 young adults (OASIS-1 reliability subset), so reliability "
                    "is measured at ages ~19-34 only"}


def evaluate(model_name: str, oof_csv: str | Path | None = None) -> dict:
    """Run every metric on one model's out-of-fold CSV; writes results/metrics_<model_name>.json."""
    path = Path(oof_csv) if oof_csv else RESULTS / f"oof_{model_name}.csv"
    df = pd.read_csv(path)
    missing = set(OOF_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"{path} is missing columns {sorted(missing)}")
    if df["pred_age"].isna().any():
        raise ValueError(f"{path}: {int(df['pred_age'].isna().sum())} scans have no prediction")
    nm = _normal_first(df)
    first = df["scan_id"].str.endswith("MR1").to_numpy()
    gap, lines = corrected_gaps(df)
    age, pred = df["age"].to_numpy(float), df["pred_age"].to_numpy(float)
    bins = (age[nm] // 10 * 10).astype(int)
    out = {
        "model": model_name, "oof_csv": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
        "n_scans": int(len(df)), "n_normal": int(nm.sum()),
        "mae": mae(age[nm], pred[nm]), "r": pearson_r(age[nm], pred[nm]),
        "mae_predict_mean": mae(age[nm], np.full(nm.sum(), age[nm].mean())),
        "mae_by_fold": {int(k): mae(age[nm & (df["fold"] == k).to_numpy()], pred[nm & (df["fold"] == k).to_numpy()])
                        for k in sorted(df.loc[nm, "fold"].unique())},
        "mae_by_age_decade": {int(b): mae(age[nm][bins == b], pred[nm][bins == b]) for b in np.unique(bins)},
        "bias_correction_by_fold": lines,
        "bias_correction_all_normal": dict(zip(("a", "b"), fit_bias_correction(age[nm], pred[nm]))),
        "clinical_validity": dementia_auc(gap[first], df.loc[first, "cdr"], age[first]),
        "test_retest": test_retest(df),
    }
    std = df["pred_std"].to_numpy(float)
    if np.isfinite(std[nm]).all():
        out["interval_coverage_95"] = interval_coverage(age[nm], pred[nm] - Z95 * std[nm], pred[nm] + Z95 * std[nm])
        out["mean_interval_width"] = float(np.mean(2 * Z95 * std[nm]))
    else:
        out["interval_coverage_95"] = None
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"metrics_{model_name}.json").write_text(json.dumps(out, indent=2))
    return out


if __name__ == "__main__":
    m = evaluate(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    cv, tr = m["clinical_validity"], m["test_retest"]
    print(f"{m['model']}: MAE {m['mae']:.2f}  r {m['r']:.3f}  AUC {cv['auc']:.3f} "
          f"({cv['auc_ci'][0]:.2f}-{cv['auc_ci'][1]:.2f})  ICC {tr['icc_3_1']:.3f}  "
          f"SDC ±{tr['smallest_detectable_change']:.2f}  coverage {m['interval_coverage_95']}")
