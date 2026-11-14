"""
Train and validate the watch-data model on real NHANES 2011-2014 wrist-tracker data (adults 60+).

Questions it answers, each reported with its uncertainty:
  1. PREDICTION. Do watch-style numbers (daily steps, sleep regularity, resting pulse) add anything
     to predicting cognition beyond age, sex, education and income? Repeated 5-fold CV, paired
     against a demographics-only model. Outcomes: DSST, and a 4-test composite (DSST, CERAD
     learning, CERAD delayed recall, animal fluency).
  2. ASSOCIATION. How many DSST points separate, e.g., 3,000 vs 7,000 steps/day, adjusted for
     demographics (survey-weighted, cluster-robust SEs)? Then again adjusting for health conditions
     too, to show how much is confounding. Cross-sectional: sick people walk less, so this is NOT
     proof that walking more raises scores. The app says so.
  3. NORMS. Survey-weighted percentiles of each watch measure by age band and sex, so the app can
     say "your steps are at the 62nd percentile for women 70-79".

Raw device sleep hours are kept for research output only: the NHANES tracker records sleep-posture
wear time (mean 8.3 h), consumer watches record time asleep (usually ~1 h less), so comparing
absolute hours would be misleading. Night-to-night regularity (SD) transfers better.

Run:  python models/train_wearable.py      (needs data/raw: see data/download_data.py)
Outputs: models/artifacts/wearable_metrics.json, wearable_norms.json, wearable_gbm.joblib
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
from sklearn.metrics import r2_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from models.train_cognition import SEEDS, cv_predict, make_gbm  # noqa: E402
from neurotrail.nhanes import DEMOGRAPHIC  # noqa: E402
from neurotrail.wearable_nhanes import build_wearable_table  # noqa: E402

ART = ROOT / "models" / "artifacts"
log = logging.getLogger("train_wearable")
APPLIED = ["steps_day", "sleep_sd", "resting_hr"]          # what we apply to a user's watch data
HEALTH = ["sbp", "diabetes", "current_smoker", "bmi", "phq9", "stroke", "heart_disease"]
KNOT = 4.0   # thousand steps/day. Steps are piecewise-linear: the quintiles show the whole gap sits below ~4k.
# (label, {column: change}) ; steps changes are split across the two pieces of the piecewise term
CONTRASTS = [
    ("2,000 → 4,000 steps/day", {"steps_lo": 2.0}),
    ("4,000 → 7,000 steps/day", {"steps_hi": 3.0}),
    ("7,000 → 10,000 steps/day", {"steps_hi": 3.0}),
    ("Irregular sleep (SD 2 h) → regular (SD 0.75 h)", {"sleep_sd": -1.25}),
    ("Resting pulse 80 → 65 bpm", {"resting_hr": -15.0}),
]
SOURCES = {
    "nhanes_pax": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2011/DataFiles/PAXDAY_G.htm",
    "physionet_steps": "https://doi.org/10.13026/d7sw-f662",
    "steps_algorithms_paper": "https://doi.org/10.1249/MSS.0000000000003616",
    "nhanes_steps_paper": "https://doi.org/10.1249/MSS.0000000000004009",
}


def prediction(df: pd.DataFrame, outcome: str) -> dict:
    d = df.drop(columns=["dsst"] if outcome != "dsst" else []).dropna(subset=[outcome])
    d = d.reset_index(drop=True).rename(columns={outcome: "dsst"})   # cv_predict reads the "dsst" column
    d = d[d[APPLIED].notna().any(axis=1)].reset_index(drop=True)   # people with some watch data
    y = d["dsst"].to_numpy()
    base, full, gains = [], [], []
    for s in SEEDS:
        a = r2_score(y, cv_predict(d, DEMOGRAPHIC, "gbm", s))
        b = r2_score(y, cv_predict(d, DEMOGRAPHIC + APPLIED, "gbm", s))
        base.append(a); full.append(b); gains.append(b - a)
    out = {"n": int(len(d)), "r2_demographics": float(np.mean(base)), "r2_with_watch": float(np.mean(full)),
           "delta_r2": {"mean": float(np.mean(gains)), "min": float(np.min(gains)), "max": float(np.max(gains))}}
    log.info("%-14s n=%d  R2 demo %.3f → +watch %.3f  (ΔR2 %.3f, range %.3f to %.3f)", outcome, out["n"],
             out["r2_demographics"], out["r2_with_watch"], *out["delta_r2"].values())
    return out


def association(df: pd.DataFrame, outcome: str, adjust: list[str], label: str) -> dict:
    d = df.copy()
    k = d["steps_day"] / 1000
    d["steps_lo"], d["steps_hi"] = k.clip(upper=KNOT), (k - KNOT).clip(lower=0)
    expos = ["steps_lo", "steps_hi", "sleep_sd", "resting_hr"]
    use = adjust + expos
    d = d.dropna(subset=use + [outcome, "weight"])
    d = d[d["weight"] > 0]
    X = sm.add_constant(d[use].astype(float))
    fit = sm.WLS(d[outcome], X, weights=d["weight"] / d["weight"].mean()).fit(
        cov_type="cluster", cov_kwds={"groups": pd.factorize(d["cluster"])[0]})
    draws = np.random.default_rng(0).multivariate_normal(fit.params.to_numpy(), fit.cov_params().to_numpy(), 20000)
    names = list(fit.params.index)
    res = []
    for lab, change in CONTRASTS:
        pts = sum(draws[:, names.index(c)] * dv for c, dv in change.items())
        col = next(iter(change))
        res.append({"label": lab, "change": change, "points": float(np.median(pts)),
                    "ci": [float(np.percentile(pts, 2.5)), float(np.percentile(pts, 97.5))],
                    "p_value": float(fit.pvalues[col])})
        log.info("  %-48s %+5.2f [%+.2f, %+.2f] p=%.3g", lab, res[-1]["points"], *res[-1]["ci"], res[-1]["p_value"])
    return {"label": label, "outcome": outcome, "n": int(fit.nobs), "age_coef": float(fit.params["age"]),
            "contrasts": res}


def steps_by_quintile(df: pd.DataFrame, adjust: list[str]) -> list[dict]:
    """Adjusted mean DSST by step quintile: shows the shape (does it plateau?)."""
    d = df.dropna(subset=["steps_day", "dsst", "weight"] + adjust).copy()
    d["q"] = pd.qcut(d["steps_day"], 5, labels=False)
    X = sm.add_constant(pd.concat([d[adjust], pd.get_dummies(d["q"], prefix="q", drop_first=True, dtype=float)], axis=1))
    fit = sm.WLS(d["dsst"], X, weights=d["weight"] / d["weight"].mean()).fit(
        cov_type="cluster", cov_kwds={"groups": pd.factorize(d["cluster"])[0]})
    ci = fit.conf_int()
    out = []
    for q in range(5):
        r = d[d["q"] == q]["steps_day"]
        k = f"q_{q}"
        out.append({"quintile": q + 1, "steps_from": float(r.min()), "steps_to": float(r.max()),
                    "vs_lowest": 0.0 if q == 0 else float(fit.params[k]),
                    "ci": [0.0, 0.0] if q == 0 else [float(ci.loc[k, 0]), float(ci.loc[k, 1])]})
    return out


def wquantiles(x: np.ndarray, w: np.ndarray, qs) -> list[float]:
    o = np.argsort(x); x, w = x[o], w[o]
    c = (np.cumsum(w) - 0.5 * w) / w.sum()
    return [float(np.interp(q, c, x)) for q in qs]


def norms(df: pd.DataFrame) -> dict:
    qs = [i / 100 for i in range(1, 100)]
    bands = [(60, 69), (70, 79), (80, 120)]
    out = {"percentiles": list(range(1, 100)), "groups": {}}
    for f in ["steps_day", "sleep_sd", "resting_hr", "sleep_hours_dev"]:
        out["groups"][f] = {}
        for lo, hi in bands:
            for fem, sx in ((0.0, "male"), (1.0, "female")):
                g = df[(df["age"].between(lo, hi)) & (df["female"] == fem)].dropna(subset=[f, "weight"])
                g = g[g["weight"] > 0]
                if len(g) >= 50:
                    out["groups"][f][f"{sx}_{lo}"] = {"n": int(len(g)), "q": [round(v, 2) for v in wquantiles(g[f].to_numpy(), g["weight"].to_numpy(), qs)]}
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    df = build_wearable_table()
    have = df[APPLIED].notna().any(axis=1)
    log.info("NHANES 60+ with cognition: %d; with watch data: %d", len(df), int(have.sum()))
    m = {"n_cognition": int(len(df)), "n_with_watch": int(have.sum()), "features_applied": APPLIED,
         "sources": SOURCES,
         "describe": df[["steps_day", "sleep_hours_dev", "sleep_sd", "resting_hr"]].describe().round(2).to_dict()}
    log.info("\nPREDICTION (repeated 5-fold CV)")
    m["prediction"] = {o: prediction(df, o) for o in ("dsst", "cog_composite")}
    log.info("\nASSOCIATION, demographics-adjusted (DSST points)")
    m["assoc_demo"] = association(df, "dsst", DEMOGRAPHIC, "Adjusted for age, sex, education, income")
    log.info("\nASSOCIATION, + health conditions (DSST points)")
    m["assoc_health"] = association(df, "dsst", DEMOGRAPHIC + HEALTH,
                                    "Also adjusted for BP, diabetes, smoking, BMI, depression, stroke, heart disease")
    log.info("\nASSOCIATION, 4-test composite (SD units), + health conditions")
    m["assoc_composite"] = association(df, "cog_composite", DEMOGRAPHIC + HEALTH, "4-test composite, fully adjusted")
    m["steps_quintiles"] = steps_by_quintile(df, DEMOGRAPHIC)
    m["steps_quintiles_health"] = steps_by_quintile(df, DEMOGRAPHIC + HEALTH)
    for q in m["steps_quintiles"] + m["steps_quintiles_health"]:
        log.info("  steps Q%d %5.0f–%5.0f: %+.2f DSST vs Q1 [%+.2f, %+.2f]", q["quintile"], q["steps_from"], q["steps_to"], q["vs_lowest"], *q["ci"])

    d = df[have]
    final = make_gbm(0).fit(d[DEMOGRAPHIC + APPLIED], d["dsst"])
    joblib.dump({"model": final, "features": DEMOGRAPHIC + APPLIED}, ART / "wearable_gbm.joblib")
    (ART / "wearable_metrics.json").write_text(json.dumps(m, indent=2))
    (ART / "wearable_norms.json").write_text(json.dumps(norms(df)))
    log.info("\nwrote wearable_metrics.json, wearable_norms.json, wearable_gbm.joblib")


if __name__ == "__main__":
    main()
