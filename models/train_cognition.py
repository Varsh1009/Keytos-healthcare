"""
Train and validate the NeuroTrail cognition models on real NHANES 2011-2014 data.

Two models, two jobs:

1. PREDICTION (gradient-boosted trees). How well do demographics plus modifiable risk
   factors predict DSST processing-speed score in adults 60+? Evaluated with
   repeated 5-fold cross-validation. Compared against a demographics-only
   baseline so we can say exactly how much the modifiable factors add.

2. ASSOCIATION (survey-weighted linear regression, cluster-robust SEs).
   Gives each modifiable factor an interpretable effect in DSST points with
   a 95% CI, adjusted for age, sex, education and income. Dividing by the
   age coefficient converts points into "years of cognitive aging"
   (CI by Monte Carlo from the coefficient covariance). These are
   cross-sectional associations, not causal effects, and the app says so.

Also reports fairness: prediction error by race/ethnicity and sex.

Outputs go to models/artifacts/.
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import KFold

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurotrail.nhanes import DEMOGRAPHIC, FEATURES, MODIFIABLE, build_table  # noqa: E402

ART = ROOT / "models" / "artifacts"
ART.mkdir(parents=True, exist_ok=True)
log = logging.getLogger("train_cognition")
SEEDS = (0, 1, 2, 3, 4)
# Gradient-boosted trees with native missing-value handling (no imputation needed).
GBM_PARAMS = dict(max_iter=400, learning_rate=0.03, max_leaf_nodes=15, min_samples_leaf=40,
                  l2_regularization=1.0)


def make_gbm(seed: int) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(random_state=seed, **GBM_PARAMS)


def cv_predict(df: pd.DataFrame, feats: list[str], kind: str, seed: int) -> np.ndarray:
    """Out-of-fold predictions for one 5-fold split."""
    pred = np.zeros(len(df))
    X, y = df[feats], df["dsst"].to_numpy()
    for tr, te in KFold(5, shuffle=True, random_state=seed).split(X):
        if kind == "gbm":
            m = make_gbm(seed).fit(X.iloc[tr], y[tr])
            pred[te] = m.predict(X.iloc[te])
        else:  # linear baseline: median-impute using training fold only
            med = X.iloc[tr].median()
            m = LinearRegression().fit(X.iloc[tr].fillna(med), y[tr])
            pred[te] = m.predict(X.iloc[te].fillna(med))
    return pred


def evaluate(df: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    configs = {
        "linear_demographics": (DEMOGRAPHIC, "linear"),
        "gbm_demographics": (DEMOGRAPHIC, "gbm"),
        "gbm_full": (FEATURES, "gbm"),
    }
    y = df["dsst"].to_numpy()
    res, oof = {}, {}
    for name, (feats, kind) in configs.items():
        r2s, maes = [], []
        for s in SEEDS:
            p = cv_predict(df, feats, kind, s)
            r2s.append(r2_score(y, p)); maes.append(mean_absolute_error(y, p))
            if s == 0:
                oof[name] = p
        res[name] = {"r2_mean": float(np.mean(r2s)), "r2_sd": float(np.std(r2s)),
                     "mae_mean": float(np.mean(maes)), "mae_sd": float(np.std(maes)),
                     "n_features": len(feats)}
        log.info("%-22s R2 %.3f ± %.3f  MAE %.2f ± %.2f", name, np.mean(r2s), np.std(r2s),
                 np.mean(maes), np.std(maes))
    # Paired gain of modifiable factors over demographics, per seed.
    gains = []
    for s in SEEDS:
        gains.append(r2_score(y, cv_predict(df, FEATURES, "gbm", s))
                     - r2_score(y, cv_predict(df, DEMOGRAPHIC, "gbm", s)))
    res["delta_r2_full_vs_demographics"] = {"mean": float(np.mean(gains)),
                                            "min": float(np.min(gains)),
                                            "max": float(np.max(gains))}
    res["baseline_predict_mean_mae"] = float(mean_absolute_error(y, np.full_like(y, y.mean())))
    out = df[["SEQN", "age", "female", "race_eth", "dsst"]].copy()
    for k, v in oof.items():
        out[f"pred_{k}"] = v
    return res, out


def fairness(oof: pd.DataFrame) -> dict:
    """MAE of the full model by subgroup, with n. Flags groups with n < 100."""
    out = {}
    err = (oof["dsst"] - oof["pred_gbm_full"]).abs()
    signed = oof["pred_gbm_full"] - oof["dsst"]
    for col in ("race_eth", "female"):
        g = {}
        for k, idx in oof.groupby(col).groups.items():
            name = {0.0: "male", 1.0: "female"}.get(k, k) if col == "female" else k
            g[str(name)] = {"n": int(len(idx)), "mae": float(err[idx].mean()),
                            "mean_bias": float(signed[idx].mean()),
                            "low_n_warning": bool(len(idx) < 100)}
        out[col] = g
    return out


# Contrasts reported in the app: (label, column, from, to). Effects are for
# moving the factor from the risk value to the target value.
CONTRASTS = [
    ("Systolic BP 150 → 120 mmHg", "sbp", 150.0, 120.0),
    ("Diabetes → no diabetes", "diabetes", 1.0, 0.0),
    ("Smoker → non-smoker", "current_smoker", 1.0, 0.0),
    ("Inactive (0) → 150 active min/week", "active_min_week", 0.0, 150.0),
    ("Depression score 10 → 2 (PHQ-9)", "phq9", 10.0, 2.0),
    ("Sleep 5 h → 7 h", "sleep_hours", 5.0, 7.0),
    ("Sitting 600 → 360 min/day", "sedentary_min_day", 600.0, 360.0),
    ("Hearing trouble → no trouble", "hearing_trouble", 1.0, 0.0),
]


def association(df: pd.DataFrame, cols: list[str], label: str) -> dict:
    """Weighted least squares with cluster-robust SEs (strata x PSU)."""
    d = df.copy()
    d["sleep_dev"] = (d["sleep_hours"] - 7).abs()  # U-shape: distance from 7 h
    use = [c if c != "sleep_hours" else "sleep_dev" for c in cols]
    d = d.dropna(subset=use + ["dsst", "weight"])
    d = d[d["weight"] > 0]
    X = sm.add_constant(d[use].astype(float))
    w = d["weight"] / d["weight"].mean()
    fit = sm.WLS(d["dsst"], X, weights=w).fit(cov_type="cluster",
                                             cov_kwds={"groups": pd.factorize(d["cluster"])[0]})
    rng = np.random.default_rng(0)
    draws = rng.multivariate_normal(fit.params.to_numpy(), fit.cov_params().to_numpy(), 20000)
    names = list(fit.params.index)
    age_draw = draws[:, names.index("age")]
    contrasts = []
    for lab, col, a, b in CONTRASTS:
        key = "sleep_dev" if col == "sleep_hours" else col
        if key not in names:
            continue
        da, db = (abs(a - 7), abs(b - 7)) if col == "sleep_hours" else (a, b)
        pts = draws[:, names.index(key)] * (db - da)
        years = pts / -age_draw  # DSST points per year of age is negative
        contrasts.append({
            "label": lab, "column": col, "from": a, "to": b,
            "dsst_points": float(np.median(pts)),
            "dsst_ci": [float(np.percentile(pts, 2.5)), float(np.percentile(pts, 97.5))],
            "years": float(np.median(years)),
            "years_ci": [float(np.percentile(years, 2.5)), float(np.percentile(years, 97.5))],
            "p_value": float(fit.pvalues[key]),
        })
    return {
        "label": label, "n": int(fit.nobs), "r2": float(fit.rsquared),
        "age_coef": float(fit.params["age"]),
        "age_ci": [float(x) for x in fit.conf_int().loc["age"]],
        "coefs": {k: float(v) for k, v in fit.params.items()},
        "cov": fit.cov_params().to_numpy().tolist(), "names": names,
        "contrasts": contrasts,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    df = build_table()
    metrics, oof = evaluate(df)
    metrics["fairness"] = fairness(oof)
    metrics["n"] = int(len(df))
    metrics["dsst_mean"] = float(df["dsst"].mean())
    metrics["dsst_sd"] = float(df["dsst"].std())

    # Final prediction model on all data (used by the app).
    final = make_gbm(0).fit(df[FEATURES], df["dsst"])
    joblib.dump({"model": final, "features": FEATURES}, ART / "cognition_gbm.joblib")
    # Permutation importance on held-out folds would be ideal; use a held-out split here.
    from sklearn.inspection import permutation_importance
    from sklearn.model_selection import train_test_split
    Xtr, Xte, ytr, yte = train_test_split(df[FEATURES], df["dsst"], test_size=0.25, random_state=0)
    held = make_gbm(0).fit(Xtr, ytr)
    pi = permutation_importance(held, Xte, yte, n_repeats=20, random_state=0, scoring="r2")
    imp = pd.Series(pi.importances_mean, index=FEATURES)
    metrics["permutation_importance_r2_drop"] = imp.sort_values(ascending=False).to_dict()

    adj = DEMOGRAPHIC
    main_cols = adj + [c for c in MODIFIABLE if c not in ("hearing_trouble", "hba1c", "bp_med",
                                                         "total_chol", "hdl", "bmi",
                                                         "stroke", "heart_disease")]
    assoc_main = association(df, main_cols, "NHANES 2011-2014, adults 60+")
    assoc_hear = association(df[df["cycle"] == "G"], main_cols + ["hearing_trouble"],
                             "NHANES 2011-2012 (hearing asked this cycle only)")
    for a in (assoc_main, assoc_hear):
        log.info("\n%s  n=%d  R2=%.3f  age=%.3f pts/yr", a["label"], a["n"], a["r2"], a["age_coef"])
        for c in a["contrasts"]:
            log.info("  %-38s %+5.2f pts [%+.2f, %+.2f]  ≈ %+.1f yrs [%+.1f, %+.1f]  p=%.3g",
                     c["label"], c["dsst_points"], *c["dsst_ci"], c["years"], *c["years_ci"],
                     c["p_value"])

    # Reference distribution for percentiles in the app (by sex x age band).
    ref = df[["age", "female", "educ", "dsst", "cerad_learning", "cerad_delayed", "animal_fluency"]].copy()
    ref.to_csv(ART / "nhanes_dsst_reference.csv", index=False)
    oof.to_csv(ART / "cognition_oof_predictions.csv", index=False)
    (ART / "cognition_metrics.json").write_text(json.dumps(metrics, indent=2))
    (ART / "cognition_associations.json").write_text(
        json.dumps({"main": assoc_main, "hearing": assoc_hear}, indent=2))
    log.info("\nfairness: %s", json.dumps(metrics["fairness"], indent=1))


if __name__ == "__main__":
    main()
