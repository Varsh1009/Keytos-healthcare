"""
MRI brain-age model on real OASIS data, with honest validation.

Data: OASIS-1 cross-sectional (416 people aged 18-96, one MRI session each,
plus 20 repeat scans of the same person within 90 days) and OASIS-2
longitudinal (150 people aged 60-96, 373 sessions).

Features are MRI-derived summaries that OASIS computed from the scans:
  nWBV = normalized whole-brain volume (brain tissue / intracranial volume)
  eTIV = estimated total intracranial volume, plus sex.
This is a deliberately simple brain-age model. Image-based CNNs do better
(MAE ~2-4 years); we report exactly what this one achieves.

What we measure:
  1. Accuracy on cognitively normal people (repeated 5-fold CV): MAE, r.
  2. Age-bias correction of the brain-age gap (standard practice).
  3. Clinical validity: is the gap larger in people with dementia
     (CDR >= 0.5) than age-matched normals? AUC and Mann-Whitney test.
  4. Test-retest reliability on the 20 real repeat scans.
  5. Longitudinal atrophy: % nWBV change per year by group (OASIS-2),
     mixed-effects model with a random intercept per person.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, roc_auc_score
from sklearn.model_selection import KFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import PolynomialFeatures, StandardScaler

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "oasis"
ART = ROOT / "models" / "artifacts"
ART.mkdir(parents=True, exist_ok=True)
log = logging.getLogger("train_brainage")
FEATS = ["nWBV", "eTIV", "female"]
SEEDS = (0, 1, 2, 3, 4)


def load_cross() -> pd.DataFrame:
    d = pd.read_csv(RAW / "oasis_cross-sectional.csv")
    d["female"] = (d["M/F"] == "F").astype(float)
    d["subject"] = d["ID"].str[:9]
    d["session"] = d["ID"].str[-3:]
    # OASIS-1: participants without a CDR are young/middle-aged volunteers
    # who were not clinically rated; OASIS describes them as nondemented.
    d["status"] = np.where(d["CDR"].fillna(0) >= 0.5, "dementia (CDR≥0.5)", "cognitively normal")
    return d


def make_model(kind: str):
    if kind == "poly_linear":
        return make_pipeline(StandardScaler(), PolynomialFeatures(2, include_bias=False),
                             LinearRegression())
    return HistGradientBoostingRegressor(max_iter=300, learning_rate=0.03, max_leaf_nodes=8,
                                         min_samples_leaf=15, random_state=0)


def cv_preds(d: pd.DataFrame, kind: str, seed: int) -> np.ndarray:
    p = np.zeros(len(d))
    for tr, te in KFold(5, shuffle=True, random_state=seed).split(d):
        m = make_model(kind).fit(d.iloc[tr][FEATS], d.iloc[tr]["Age"])
        p[te] = m.predict(d.iloc[te][FEATS])
    return p


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cross = load_cross()
    base = cross[cross["session"] == "MR1"].reset_index(drop=True)
    normal = base[base["status"] == "cognitively normal"].reset_index(drop=True)
    dem = base[base["status"] != "cognitively normal"].reset_index(drop=True)
    log.info("OASIS-1: %d first sessions, %d normal, %d dementia", len(base), len(normal), len(dem))

    metrics: dict = {"n_normal": int(len(normal)), "n_dementia": int(len(dem))}
    best_kind, best_mae = None, np.inf
    for kind in ("poly_linear", "gbm"):
        maes, rs = [], []
        for s in SEEDS:
            p = cv_preds(normal, kind, s)
            maes.append(mean_absolute_error(normal["Age"], p))
            rs.append(stats.pearsonr(normal["Age"], p)[0])
        metrics[kind] = {"mae_mean": float(np.mean(maes)), "mae_sd": float(np.std(maes)),
                         "r_mean": float(np.mean(rs))}
        log.info("%-12s MAE %.2f ± %.2f yrs  r=%.3f", kind, np.mean(maes), np.std(maes), np.mean(rs))
        if np.mean(maes) < best_mae:
            best_kind, best_mae = kind, np.mean(maes)
    metrics["chosen_model"] = best_kind
    metrics["baseline_mae_predict_mean"] = float(mean_absolute_error(
        normal["Age"], np.full(len(normal), normal["Age"].mean())))

    # Out-of-fold brain age for normals; bias correction fitted on those.
    normal["brain_age"] = cv_preds(normal, best_kind, 0)
    normal["gap_raw"] = normal["brain_age"] - normal["Age"]
    slope, intercept = np.polyfit(normal["Age"], normal["gap_raw"], 1)
    metrics["bias_correction"] = {"slope": float(slope), "intercept": float(intercept)}

    def corrected_gap(age: pd.Series, brain_age: pd.Series) -> pd.Series:
        return (brain_age - age) - (slope * age + intercept)

    normal["gap"] = corrected_gap(normal["Age"], normal["brain_age"])
    final = make_model(best_kind).fit(normal[FEATS], normal["Age"])
    dem["brain_age"] = final.predict(dem[FEATS])
    dem["gap"] = corrected_gap(dem["Age"], dem["brain_age"])

    # Clinical validity, age-matched: compare to normals aged >= min dementia age.
    old = normal[normal["Age"] >= dem["Age"].min()]
    y = np.r_[np.zeros(len(old)), np.ones(len(dem))]
    g = np.r_[old["gap"], dem["gap"]]
    auc = roc_auc_score(y, g)
    u = stats.mannwhitneyu(dem["gap"], old["gap"], alternative="greater")
    rng = np.random.default_rng(0)
    boots = []
    for _ in range(2000):
        i = rng.integers(0, len(y), len(y))
        if 0 < y[i].sum() < len(i):
            boots.append(roc_auc_score(y[i], g[i]))
    metrics["clinical_validity"] = {
        "n_normal_age_matched": int(len(old)), "n_dementia": int(len(dem)),
        "mean_gap_normal": float(old["gap"].mean()), "mean_gap_dementia": float(dem["gap"].mean()),
        "auc": float(auc), "auc_ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
        "mannwhitney_p": float(u.pvalue),
        "age_normal_mean": float(old["Age"].mean()), "age_dementia_mean": float(dem["Age"].mean()),
    }
    log.info("Gap normal(60+-matched) %.2f vs dementia %.2f yrs  AUC %.3f [%.3f, %.3f]  p=%.2g",
             old["gap"].mean(), dem["gap"].mean(), auc, *metrics["clinical_validity"]["auc_ci"], u.pvalue)

    # Test-retest: model fit WITHOUT the 20 rescanned people, applied to both sessions.
    rescanned = cross.loc[cross["session"] == "MR2", "subject"]
    tr = normal[~normal["subject"].isin(rescanned)]
    m_rt = make_model(best_kind).fit(tr[FEATS], tr["Age"])
    pairs = cross[cross["subject"].isin(rescanned)].pivot(index="subject", columns="session",
                                                          values=FEATS + ["Age"])
    p1 = m_rt.predict(pd.DataFrame({f: pairs[(f, "MR1")] for f in FEATS}))
    p2 = m_rt.predict(pd.DataFrame({f: pairs[(f, "MR2")] for f in FEATS}))
    diff = p2 - p1
    k = np.c_[p1, p2]
    ms_b = k.mean(axis=1).var(ddof=1) * 2
    ms_w = ((k - k.mean(axis=1, keepdims=True)) ** 2).sum() / len(k)
    icc = (ms_b - ms_w) / (ms_b + ms_w)
    metrics["test_retest"] = {
        "n_pairs": int(len(diff)), "mean_abs_diff_years": float(np.abs(diff).mean()),
        "sd_diff_years": float(diff.std(ddof=1)),
        "smallest_detectable_change_years": float(1.96 * np.sqrt(2) * diff.std(ddof=1) / np.sqrt(2)),
        "icc_1_1": float(icc),
        "nwbv_mean_abs_diff": float(np.abs(pairs[("nWBV", "MR2")] - pairs[("nWBV", "MR1")]).mean()),
    }
    log.info("Test-retest (n=%d): mean |Δ| %.2f yrs, SD Δ %.2f, ICC %.3f", len(diff),
             np.abs(diff).mean(), diff.std(ddof=1), icc)

    # Longitudinal atrophy (OASIS-2).
    lon = pd.read_csv(RAW / "oasis_longitudinal.csv")
    lon["years"] = lon["MR Delay"] / 365.25
    lon["female"] = (lon["M/F"] == "F").astype(float)
    lon["nWBV_pct"] = lon["nWBV"] * 100
    base_age = lon.groupby("Subject ID")["Age"].transform("min")
    lon["age0"] = base_age - base_age.mean()
    # Random intercept per person (a random-slope model did not converge on n=150).
    mm = smf.mixedlm("nWBV_pct ~ years * C(Group, Treatment('Nondemented')) + age0 + female",
                     lon, groups=lon["Subject ID"]).fit(reml=True)
    if not mm.converged:
        raise RuntimeError("Mixed model did not converge; refusing to report its estimates.")
    fe, ci = mm.params, mm.conf_int()
    # Robustness check: per-person OLS slope of nWBV on years, compared by group.
    slopes = (lon.groupby("Subject ID")
                 .apply(lambda s: np.polyfit(s["years"], s["nWBV_pct"], 1)[0] if s["years"].nunique() > 1 else np.nan)
                 .rename("slope").to_frame().join(lon.groupby("Subject ID")["Group"].first()))
    slope_summary = {grp: {"n": int(s["slope"].notna().sum()), "median": float(s["slope"].median())}
                     for grp, s in slopes.groupby("Group")}
    kw = stats.kruskal(*[s["slope"].dropna() for _, s in slopes.groupby("Group")])
    rate_nd = fe["years"]
    rates = {"Nondemented": [rate_nd, *ci.loc["years"]]}
    for grp in ("Demented", "Converted"):
        key = f"years:C(Group, Treatment('Nondemented'))[T.{grp}]"
        rates[grp] = [rate_nd + fe[key], float(mm.pvalues[key])]
    mean_nwbv = lon["nWBV_pct"].mean()
    metrics["longitudinal"] = {
        "n_subjects": int(lon["Subject ID"].nunique()), "n_sessions": int(len(lon)),
        "nondemented_nwbv_pts_per_year": float(rates["Nondemented"][0]),
        "nondemented_ci": [float(rates["Nondemented"][1]), float(rates["Nondemented"][2])],
        "demented_nwbv_pts_per_year": float(rates["Demented"][0]),
        "demented_vs_nd_p": float(rates["Demented"][1]),
        "converted_nwbv_pts_per_year": float(rates["Converted"][0]),
        "converted_vs_nd_p": float(rates["Converted"][1]),
        "mean_nwbv_pct": float(mean_nwbv),
        "model": "linear mixed model, random intercept per person, REML; converged",
        "per_person_slope_median": slope_summary,
        "per_person_slope_kruskal_p": float(kw.pvalue),
    }
    log.info("Per-person slope medians: %s  Kruskal p=%.3g", slope_summary, kw.pvalue)
    log.info("Atrophy (nWBV %%-points/yr): ND %.3f [%.3f, %.3f]  Dem %.3f (p=%.3g)  Conv %.3f (p=%.3g)",
             rates["Nondemented"][0], rates["Nondemented"][1], rates["Nondemented"][2],
             rates["Demented"][0], rates["Demented"][1], rates["Converted"][0], rates["Converted"][1])

    joblib.dump({"model": final, "features": FEATS, "slope": slope, "intercept": intercept,
                 "kind": best_kind, "age_range": [float(normal["Age"].min()), float(normal["Age"].max())]},
                ART / "brainage.joblib")
    out = pd.concat([normal.assign(cv=True), dem.assign(cv=False)])[
        ["ID", "Age", "female", "nWBV", "eTIV", "MMSE", "CDR", "status", "brain_age", "gap", "cv"]]
    out.to_csv(ART / "brainage_predictions.csv", index=False)
    lon[["Subject ID", "Group", "Visit", "years", "Age", "nWBV", "CDR", "MMSE"]].to_csv(
        ART / "oasis_longitudinal_clean.csv", index=False)
    (ART / "brainage_metrics.json").write_text(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
