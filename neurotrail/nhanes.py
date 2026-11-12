"""
Build the NHANES 2011-2014 analysis table: cognition (DSST) + risk factors.

Every variable is coded from the official CDC codebooks. NHANES uses
7/9, 77/99, 777/999, 7777/9999 for "refused" / "don't know"; those become NaN.

Why DSST? The Digit Symbol Substitution Test measures processing speed,
attention and working memory. It is sensitive to age-related decline and is
the most widely used NHANES cognitive outcome.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
CYCLES = ("G", "H")  # 2011-2012, 2013-2014

DEMOGRAPHIC = ["age", "female", "educ", "income_pir"]
MODIFIABLE = [
    "sbp", "bp_med", "diabetes", "hba1c", "current_smoker", "drinks_per_day",
    "active_min_week", "sedentary_min_day", "sleep_hours", "phq9", "bmi",
    "total_chol", "hdl", "hearing_trouble", "stroke", "heart_disease",
]
FEATURES = DEMOGRAPHIC + MODIFIABLE

FEATURE_LABELS = {
    "age": "Age (years)", "female": "Female", "educ": "Education level (1-5)",
    "income_pir": "Income-to-poverty ratio", "sbp": "Systolic BP (mmHg)",
    "bp_med": "Takes BP medication", "diabetes": "Diagnosed diabetes",
    "hba1c": "HbA1c (%)", "current_smoker": "Current smoker",
    "drinks_per_day": "Drinks per drinking day", "active_min_week": "Active minutes / week",
    "sedentary_min_day": "Sitting minutes / day", "sleep_hours": "Sleep hours / night",
    "phq9": "Depression score (PHQ-9)", "bmi": "BMI", "total_chol": "Total cholesterol (mg/dL)",
    "hdl": "HDL cholesterol (mg/dL)", "hearing_trouble": "Self-reported hearing trouble",
    "stroke": "History of stroke", "heart_disease": "History of heart disease",
}


def _read(stem: str, sfx: str, cols: list[str]) -> pd.DataFrame:
    path = RAW / f"{stem}_{sfx}.xpt"
    if not path.exists():
        log.warning("missing %s; columns will be NaN", path.name)
        return pd.DataFrame(columns=["SEQN"] + cols)
    df = pd.read_sas(path)
    keep = ["SEQN"] + [c for c in cols if c in df.columns]
    return df[keep]


def _clean(s: pd.Series, missing: tuple[float, ...]) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce").round(6)
    return s.mask(s.isin(missing))


def _yes(s: pd.Series) -> pd.Series:
    """NHANES yes/no items: 1=yes, 2=no, 7/9 = missing."""
    s = _clean(s, (7, 9))
    return s.map({1.0: 1.0, 2.0: 0.0})


def _minutes(flag: pd.Series, days: pd.Series, mins: pd.Series) -> pd.Series:
    """Weekly minutes for one activity block: 0 if flag says 'no'."""
    flag = _clean(flag, (7, 9))
    days = _clean(days, (77, 99))
    mins = _clean(mins, (7777, 9999))
    out = days * mins
    return out.where(flag != 2, 0.0)


def build_cycle(sfx: str) -> pd.DataFrame:
    demo = _read("DEMO", sfx, ["RIDAGEYR", "RIAGENDR", "DMDEDUC2", "INDFMPIR",
                               "RIDRETH3", "WTMEC2YR", "SDMVSTRA", "SDMVPSU"])
    cfq = _read("CFQ", sfx, ["CFDDS", "CFDAST", "CFDCSR", "CFDCST1", "CFDCST2", "CFDCST3"])
    bpx = _read("BPX", sfx, ["BPXSY1", "BPXSY2", "BPXSY3", "BPXSY4"])
    bpq = _read("BPQ", sfx, ["BPQ050A"])
    diq = _read("DIQ", sfx, ["DIQ010"])
    ghb = _read("GHB", sfx, ["LBXGH"])
    smq = _read("SMQ", sfx, ["SMQ020", "SMQ040"])
    alq = _read("ALQ", sfx, ["ALQ101", "ALQ110", "ALQ120Q", "ALQ130"])
    paq = _read("PAQ", sfx, ["PAQ635", "PAQ640", "PAD645", "PAQ650", "PAQ655", "PAD660",
                             "PAQ665", "PAQ670", "PAD675", "PAD680"])
    slq = _read("SLQ", sfx, ["SLD010H"])
    dpq = _read("DPQ", sfx, [f"DPQ0{i}0" for i in range(1, 10)])
    bmx = _read("BMX", sfx, ["BMXBMI"])
    tch = _read("TCHOL", sfx, ["LBXTC"])
    hdl = _read("HDL", sfx, ["LBDHDD"])
    auq = _read("AUQ", sfx, ["AUQ054"])
    mcq = _read("MCQ", sfx, ["MCQ160B", "MCQ160C", "MCQ160E", "MCQ160F"])

    df = cfq
    for part in (demo, bpx, bpq, diq, ghb, smq, alq, paq, slq, dpq, bmx, tch, hdl, auq, mcq):
        df = df.merge(part, on="SEQN", how="left")

    out = pd.DataFrame({"SEQN": df["SEQN"], "cycle": sfx})
    out["dsst"] = pd.to_numeric(df["CFDDS"], errors="coerce")
    out["animal_fluency"] = pd.to_numeric(df["CFDAST"], errors="coerce")
    # CERAD word list: 3 learning trials (0-10 each) and delayed recall (0-10)
    trials = df[["CFDCST1", "CFDCST2", "CFDCST3"]].apply(pd.to_numeric, errors="coerce")
    out["cerad_learning"] = trials.sum(axis=1, min_count=3)
    out["cerad_delayed"] = pd.to_numeric(df["CFDCSR"], errors="coerce")
    out["age"] = df["RIDAGEYR"]
    out["female"] = (df["RIAGENDR"] == 2).astype(float)
    out["educ"] = _clean(df["DMDEDUC2"], (7, 9))
    out["income_pir"] = pd.to_numeric(df["INDFMPIR"], errors="coerce")
    out["race_eth"] = df["RIDRETH3"].map({1: "Mexican American", 2: "Other Hispanic",
                                          3: "Non-Hispanic White", 4: "Non-Hispanic Black",
                                          6: "Non-Hispanic Asian", 7: "Other/Multiracial"})
    out["weight"] = df["WTMEC2YR"]
    out["cluster"] = df["SDMVSTRA"].astype(str) + "_" + df["SDMVPSU"].astype(str) + "_" + sfx

    sbp = df[["BPXSY1", "BPXSY2", "BPXSY3", "BPXSY4"]].apply(pd.to_numeric, errors="coerce")
    out["sbp"] = sbp.where(sbp > 0).mean(axis=1)
    out["bp_med"] = _yes(df["BPQ050A"]).fillna(0.0).where(df["BPQ050A"].notna() | sbp.notna().any(axis=1))
    out["diabetes"] = _clean(df["DIQ010"], (7, 9)).map({1.0: 1.0, 2.0: 0.0, 3.0: 0.0})
    out["hba1c"] = pd.to_numeric(df["LBXGH"], errors="coerce")

    ever = _yes(df["SMQ020"])
    now = _clean(df["SMQ040"], (7, 9))
    out["current_smoker"] = np.where(ever == 0, 0.0, np.where(now.isin([1, 2]), 1.0,
                                     np.where(now == 3, 0.0, np.nan)))

    drinks = _clean(df["ALQ130"], (777, 999))
    never = (_yes(df["ALQ101"]) == 0) & (_yes(df["ALQ110"]) != 1)
    none_last_year = _clean(df["ALQ120Q"], (777, 999)) == 0
    out["drinks_per_day"] = drinks.where(~(never | none_last_year), 0.0)

    walk = _minutes(df["PAQ635"], df["PAQ640"], df["PAD645"])
    vig = _minutes(df["PAQ650"], df["PAQ655"], df["PAD660"])
    mod = _minutes(df["PAQ665"], df["PAQ670"], df["PAD675"])
    # Moderate-equivalent minutes: vigorous counts double (WHO convention).
    out["active_min_week"] = (walk + mod + 2 * vig).clip(upper=3000)
    out["sedentary_min_day"] = _clean(df["PAD680"], (7777, 9999))
    out["sleep_hours"] = _clean(df["SLD010H"], (77, 99))

    phq = df[[f"DPQ0{i}0" for i in range(1, 10)]].apply(lambda s: _clean(s, (7, 9)))
    out["phq9"] = phq.sum(axis=1, min_count=9)
    out["bmi"] = pd.to_numeric(df["BMXBMI"], errors="coerce")
    out["total_chol"] = pd.to_numeric(df["LBXTC"], errors="coerce")
    out["hdl"] = pd.to_numeric(df["LBDHDD"], errors="coerce")
    hear = _clean(df["AUQ054"], (77, 99)) if "AUQ054" in df else pd.Series(np.nan, index=df.index)
    # 1 excellent, 2 good, 3 a little trouble, 4 moderate, 5 a lot, 6 deaf
    out["hearing_trouble"] = (hear >= 3).astype(float).where(hear.notna())
    out["stroke"] = _yes(df["MCQ160F"])
    out["heart_disease"] = pd.concat([_yes(df[c]) for c in ("MCQ160B", "MCQ160C", "MCQ160E")],
                                     axis=1).max(axis=1)
    return out


def build_table() -> pd.DataFrame:
    """All participants aged 60+ with a valid DSST score, both cycles."""
    df = pd.concat([build_cycle(s) for s in CYCLES], ignore_index=True)
    n0 = len(df)
    df = df[df["dsst"].notna() & (df["age"] >= 60)].reset_index(drop=True)
    log.info("NHANES: %d cognition records, %d with valid DSST and age 60+", n0, len(df))
    return df


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    t = build_table()
    print(t.shape)
    print(t[FEATURES + ["dsst"]].describe().T.round(2))
    print(t[FEATURES].isna().mean().round(3))
