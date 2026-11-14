"""
Wearable features for NHANES 2011-2014 adults 60+: the open dataset we train the watch model on.

Why this dataset: it's the only open data where the SAME people wore a wrist tracker for a week
AND took the cognition tests our games copy (DSST, CERAD word recall, animal naming).
There is no open Apple Watch dataset with cognition scores; the big Apple studies don't share
person-level data.

Sources (all open, no login):
  * CDC NHANES PAXDAY/PAXHD (wrist ActiGraph GT3X+, 7 days, 24 h/day).
  * PhysioNet "Minute level step counts ... NHANES 2011-2014" v1.0.2 (Koffman & Muschelli 2026,
    doi:10.13026/d7sw-f662): minute steps from the open stepcount (self-supervised) algorithm and
    NHANES' own wake / sleep / non-wear prediction for every minute.
  * NHANES exam pulse (BPXPLS): seated 60-second pulse, our stand-in for watch resting heart rate.

Per person we compute only things a consumer watch also reports, so the model can be applied to
someone's Apple Watch / Fitbit / Garmin export:
  steps_day        mean daily steps on valid days (>= 10 h awake wear, NHANES days 2-8)
  sleep_hours_dev  mean nightly sleep-wear hours, noon to noon (how watches assign a night)
  sleep_sd         night-to-night SD of that (regularity; lower = more regular)
  resting_hr       exam pulse, beats/min
People need >= 3 valid days and >= 3 valid nights (PhysioNet's suggested inclusion rule).
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
PN = RAW / "physionet_steps"
STEPS_FILE = PN / "nhanes_1440_scsslsteps.csv.xz"
WEAR_FILE = PN / "nhanes_1440_PAXPREDM.csv.xz"
WEARABLE_FEATURES = ["steps_day", "sleep_hours_dev", "sleep_sd", "resting_hr"]
MIN_WAKE_WEAR = 600        # minutes
MIN_DAYS = 3


def _minute_matrix(path: Path, keep: set[int]) -> pd.DataFrame:
    """Rows = (SEQN, day); 1440 minute columns. Filtered to `keep` while streaming (files are large)."""
    parts = []
    for ch in pd.read_csv(path, chunksize=4000, dtype={"SEQN": "int64"}, na_values=["NA"]):
        ch = ch[ch["SEQN"].isin(keep)]
        if len(ch):
            parts.append(ch)
    df = pd.concat(parts, ignore_index=True)
    return df.set_index(["SEQN", "PAXDAYM"]).sort_index()


def build_person_features(seqns: set[int]) -> pd.DataFrame:
    wear = _minute_matrix(WEAR_FILE, seqns)
    steps = _minute_matrix(STEPS_FILE, seqns)
    mins = [c for c in wear.columns if c.startswith("min_")]
    W = wear[mins].to_numpy(dtype=float)            # 1 wake wear, 2 sleep wear, 3 non-wear, 4 unknown
    S = steps.reindex(wear.index)[mins].to_numpy(dtype=float)
    idx = wear.index.to_frame(index=False)
    idx["wake_wear"] = (W == 1).sum(axis=1)
    idx["steps"] = np.nansum(np.where(W == 1, S, 0.0), axis=1)   # count steps only while awake & worn
    idx["sleep_pm"] = (W[:, 720:] == 2).sum(axis=1)               # noon -> midnight of this day
    idx["sleep_am"] = (W[:, :720] == 2).sum(axis=1)               # midnight -> noon of this day
    idx["nonwear_pm"] = (W[:, 720:] == 3).sum(axis=1)
    idx["nonwear_am"] = (W[:, :720] == 3).sum(axis=1)

    rows = []
    for seqn, g in idx.groupby("SEQN"):
        g = g.set_index("PAXDAYM").sort_index()
        valid = g[(g.index >= 2) & (g.index <= 8) & (g["wake_wear"] >= MIN_WAKE_WEAR)]
        nights = []
        for d in g.index:
            if d + 1 in g.index:
                # a night = evening of day d + morning of day d+1; skip nights with > 1 h off-wrist
                if g.at[d, "nonwear_pm"] + g.at[d + 1, "nonwear_am"] <= 60:
                    nights.append((g.at[d, "sleep_pm"] + g.at[d + 1, "sleep_am"]) / 60)
        nights = [h for h in nights if 2 <= h <= 14]
        rows.append({"SEQN": seqn, "valid_days": len(valid), "valid_nights": len(nights),
                     "steps_day": valid["steps"].mean() if len(valid) >= MIN_DAYS else np.nan,
                     "sleep_hours_dev": np.mean(nights) if len(nights) >= MIN_DAYS else np.nan,
                     "sleep_sd": np.std(nights, ddof=1) if len(nights) >= MIN_DAYS else np.nan})
    out = pd.DataFrame(rows)
    log.info("wearable features: %d people, %d with >= %d valid days, %d with >= %d valid nights",
             len(out), out["steps_day"].notna().sum(), MIN_DAYS, out["sleep_hours_dev"].notna().sum(), MIN_DAYS)
    return out


def pulse(sfx: str) -> pd.DataFrame:
    p = RAW / f"BPX_{sfx}.xpt"
    df = pd.read_sas(p, encoding="latin-1")[["SEQN", "BPXPLS"]]
    df["resting_hr"] = pd.to_numeric(df["BPXPLS"], errors="coerce").where(lambda s: s.between(35, 150))
    return df[["SEQN", "resting_hr"]].assign(SEQN=lambda d: d["SEQN"].astype("int64"))


def build_wearable_table() -> pd.DataFrame:
    """NHANES 60+ cognition table (same as the main model) joined to wearable features."""
    from neurotrail.nhanes import build_table
    base = build_table()
    base["SEQN"] = base["SEQN"].astype("int64")
    feats = build_person_features(set(base["SEQN"]))
    hr = pd.concat([pulse(s) for s in ("G", "H")])
    df = base.merge(feats, on="SEQN", how="left").merge(hr, on="SEQN", how="left")
    df["cog_composite"] = _composite(df)
    return df


def _composite(df: pd.DataFrame) -> pd.Series:
    """Mean z-score of DSST, CERAD learning, CERAD delayed recall and animal fluency (needs >= 3 of 4)."""
    cols = ["dsst", "cerad_learning", "cerad_delayed", "animal_fluency"]
    z = (df[cols] - df[cols].mean()) / df[cols].std()
    return z.mean(axis=1).where(z.notna().sum(axis=1) >= 3)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    t = build_wearable_table()
    print(t[WEARABLE_FEATURES + ["valid_days", "valid_nights"]].describe().T.round(2))
