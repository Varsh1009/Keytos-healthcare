"""
One source of truth for every number the app, README and demo quote: models/artifacts/facts.json.
Reads the trained-model artifacts; computes the age-band checks that decided what was removed.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ART = Path(__file__).resolve().parents[1] / "models" / "artifacts"


def main() -> None:
    cog = json.loads((ART / "cognition_metrics.json").read_text())
    assoc = json.loads((ART / "cognition_associations.json").read_text())["main"]
    nw = json.loads((ART / "brainage_metrics.json").read_text())
    cnn = json.loads((ART / "mri_cnn_metrics.json").read_text())
    tis = json.loads((ART / "tissue_norms.json").read_text())
    reg = json.loads((ART / "region_norms.json").read_text())

    # CNN brain age by age band vs predicting the band mean (normals, out-of-fold)
    d = pd.read_csv(ART / "mri_cnn_predictions.csv")
    n = d[(d["status"] == "cognitively normal") & (d["session"] == "MR1")]
    bands = {}
    for lo, hi in ((18, 40), (40, 60), (60, 120)):
        b = n[(n["Age"] >= lo) & (n["Age"] < hi)]
        bands[f"{lo}-{hi - 1 if hi < 120 else '96'}"] = {
            "n": int(len(b)), "mae": float((b["brain_age"] - b["Age"]).abs().mean()),
            "guess_mean_mae": float((b["Age"] - b["Age"].mean()).abs().mean())}

    # Old region intensity index: healthy 60+ with any region z < -2 (leave-one-out)
    rv = pd.read_csv(ART / "region_values.csv")
    rcols = [c for c in rv.columns if c.startswith("c") or c in ("hippocampus", "amygdala", "thalamus", "caudate", "putamen",
                                                                   "pallidum", "accumbens", "brainstem", "ventricles")]
    h60 = rv[(rv["status"] == "normal") & (rv["session"] == "MR1") & (rv["Age"] >= 60)]
    old_flag = float((h60[rcols] < -2).any(axis=1).mean() * 100)

    facts = {
        "nhanes": {"surveyed_60plus_with_dsst": cog["n"], "complete_cases": assoc["n"], "r2_full": cog["gbm_full"]["r2_mean"],
                   "r2_demographics": cog["linear_demographics"]["r2_mean"], "delta_r2": cog["delta_r2_full_vs_demographics"]["mean"],
                   "fairness_mean_bias": {g: v["mean_bias"] for g, v in cog["fairness"]["race_eth"].items()},
                   "contrasts": [{k: c[k] for k in ("label", "dsst_points", "dsst_ci", "p_value")} for c in assoc["contrasts"]]},
        "oasis": {"people": 416, "rescans": 20, "volumes": 436, "normal_first_sessions": nw["n_normal"], "dementia": nw["n_dementia"],
                  "rescan_note": "20 young adults aged 19-34, same scanner, days apart"},
        "nwbv_model": {"mae": nw[nw["chosen_model"]]["mae_mean"], "auc": nw["clinical_validity"]["auc"],
                       "auc_ci": nw["clinical_validity"]["auc_ci"]},
        "teaching_view": tis["nwbv_teaching"],
        "removed": [
            {"what": "3D CNN brain age", "why": f"In people 60+ it was no better than guessing the average age "
             f"(error {bands['60-96']['mae']:.2f} vs {bands['60-96']['guess_mean_mae']:.2f} years). Its overall 7.1-year error came from the wide 18-96 age range.",
             "bands": bands, "auc": cnn["clinical_validity"]["auc"]},
            {"what": "Region intensity index (57 regions)", "why": f"It flagged {old_flag:.0f}% of healthy adults 60+ with at least one 'abnormal' region, "
             "and missed ventricle enlargement entirely.", "healthy60_flagged_pct": old_flag},
            {"what": "Our 3 MRI tissue measures (hippocampus, ventricles, overall)", "why": "None reached our bar (dementia AUC >= 0.70 and repeat-scan ICC >= 0.90).",
             "measures": {k: {"auc": v["auc"], "icc": v["icc"]} for k, v in tis["measures"].items() if k != "nWBV"}},
            {"what": "'Years older' and 'brain age' wording", "why": "A single survey snapshot can't tell you how old your brain is."},
            {"what": "NHANES percentiles for our digital games", "why": "Different words, timing and format from the NHANES interview; you're compared only with yourself."},
        ],
        "measured_alzheimers_map_note": "Earlier region map partly reflected fluid next to brain folds, not tissue loss; kept only as an exploratory note.",
        "db_tables": 11,
    }
    (ART / "facts.json").write_text(json.dumps(facts, indent=1))
    print(json.dumps({"bands": bands, "old_flag_pct": old_flag, "teaching": tis["nwbv_teaching"]}, indent=1))


if __name__ == "__main__":
    main()
