"""
Brain Gym: seven tap-friendly games, each a digital version of a classic neuropsychological task.

Honesty rules for every game card:
  * Only Speed Sprint has randomized-trial evidence linked to dementia outcomes (ACTIVE, with boosters).
  * The others are measurement tasks. Brain-training reviews find gains on trained tasks but little
    transfer to everyday cognition (Simons et al. 2016), so they're framed as tracking, not treatment.
  * Word Recall and Animal Naming use the same task formats NHANES gave adults 60+, so scores can be
    shown against real NHANES percentiles. Digital administration differs, and the app says so.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

ART = Path(__file__).resolve().parents[1] / "models" / "artifacts"
SIMONS = "https://pubmed.ncbi.nlm.nih.gov/27697851/"
ACTIVE = "https://pubmed.ncbi.nlm.nih.gov/41669119/"
GAME_SPARKS = 15

GAMES = [
    {"id": "speed", "title": "Speed Sprint", "icon": "⚡", "color": "#FFC83D", "domain": "Processing speed",
     "test": "Digit Symbol Substitution Test (DSST)", "how": "Match each symbol to its number for 90 seconds.",
     "unit": "correct", "better": "higher",
     "evidence": "Tracks your processing speed. Inspired by, not the same as, ACTIVE speed training (visual-attention training in ~10 supervised sessions).",
     "url": ACTIVE, "norm": None},
    {"id": "recall", "title": "Word Recall", "icon": "📝", "color": "#59F0FF", "domain": "Verbal memory",
     "test": "CERAD word-list learning + delayed recall (used in NHANES)",
     "how": "Learn 10 words over 3 trials, then recall them. Come back after 5+ minutes for delayed recall.",
     "unit": "words (of 30)", "better": "higher",
     "evidence": "A word-list memory task like the one NHANES used. Compared only with your own tries.",
     "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2011/DataFiles/CFQ_G.htm", "norm": "cerad_learning"},
    {"id": "fluency", "title": "Animal Naming", "icon": "🐾", "color": "#3DDC97", "domain": "Language & executive function",
     "test": "Animal fluency (used in NHANES)", "how": "Name as many different animals as you can in 60 seconds, by voice or typing.",
     "unit": "animals", "better": "higher",
     "evidence": "A naming task like the one NHANES used. Compared only with your own tries.",
     "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2011/DataFiles/CFQ_G.htm", "norm": "animal_fluency"},
    {"id": "trails", "title": "Trail Connect", "icon": "🔗", "color": "#B388FF", "domain": "Attention & task switching",
     "test": "Trail Making Test, parts A and B", "how": "Tap 1→2→3… as fast as you can, then alternate 1→A→2→B…",
     "unit": "seconds (B − A)", "better": "lower",
     "evidence": "Classic clinical test of switching. Measurement only: brain-training gains rarely transfer (Simons 2016).",
     "url": SIMONS, "norm": None},
    {"id": "stroop", "title": "Color Clash", "icon": "🎨", "color": "#FF7A6E", "domain": "Inhibition",
     "test": "Stroop color-word test", "how": "Tap the INK color, not the word, for 45 seconds.",
     "unit": "correct", "better": "higher",
     "evidence": "Measures inhibitory control (the Stroop effect). Measurement, not a proven treatment (Simons 2016).",
     "url": SIMONS, "norm": None},
    {"id": "corsi", "title": "Memory Grid", "icon": "🟦", "color": "#4FC3F7", "domain": "Visuospatial working memory",
     "test": "Corsi block-tapping span", "how": "Watch the blocks light up, then tap them in the same order. The sequence grows.",
     "unit": "span", "better": "higher",
     "evidence": "Standard working-memory span task. Measurement, not a proven treatment (Simons 2016).",
     "url": SIMONS, "norm": None},
    {"id": "reaction", "title": "Reflex", "icon": "⏱", "color": "#F06292", "domain": "Reaction time",
     "test": "Simple reaction time", "how": "Tap the moment the circle turns green. 8 trials.",
     "unit": "ms (median)", "better": "lower",
     "evidence": "Simple reaction time slows with age. Measurement only.",
     "url": SIMONS, "norm": None},
]
GAME_BY_ID = {g["id"]: g for g in GAMES}
# The voice check stores its daily sparks in game_results under id "voice" (not shown as a game card).
GAME_BY_ID["voice"] = {"id": "voice", "title": "Voice check", "better": "higher", "norm": None}

WORD_LISTS = [
    ["candle", "river", "garden", "ticket", "mirror", "button", "saddle", "forest", "pencil", "island"],
    ["basket", "doctor", "window", "lemon", "anchor", "pillow", "tiger", "bridge", "hammer", "violin"],
    ["blanket", "castle", "orange", "rocket", "kettle", "meadow", "wallet", "parrot", "ladder", "cherry"],
]
DISTRACTORS = ["carpet", "valley", "engine", "harbor", "trumpet", "spoon", "jacket", "planet", "turtle", "cabinet",
               "pepper", "helmet", "fountain", "lantern", "monkey", "statue", "tunnel", "barrel", "compass", "pebble"]


@lru_cache
def _ref() -> pd.DataFrame:
    return pd.read_csv(ART / "nhanes_dsst_reference.csv")


def nhanes_percentile(col: str, score: float, age: float, female: bool) -> dict | None:
    """Percentile of score among real NHANES adults of the same sex and age ±5 years."""
    r = _ref()
    r = r[(r["female"] == float(female)) & r["age"].between(age - 5, age + 5)][col].dropna()
    if len(r) < 50:
        return None
    return {"percentile": float((r < score).mean() * 100 + (r == score).mean() * 50), "n": int(len(r)),
            "median": float(r.median()), "p25": float(r.quantile(.25)), "p75": float(r.quantile(.75)),
            "age_band": [int(max(60, age - 5)), int(min(80, age + 5))]}


@lru_cache
def animals() -> frozenset[str]:
    words = (Path(__file__).with_name("animals.txt")).read_text().split()
    return frozenset(w.strip().lower() for w in words if w.strip())


def score_fluency(entries: list[str]) -> dict:
    """Unique valid animals (plural/singular merged). Unknown words are listed, not counted."""
    A = animals()
    valid, invalid, seen = [], [], set()
    for raw in entries:
        w = raw.strip().lower().replace("-", " ")
        for cand in (w, w.rstrip("s"), w[:-2] if w.endswith("es") else w, w[:-3] + "y" if w.endswith("ies") else w):
            if cand.replace(" ", "") in A or cand in A:
                key = cand.replace(" ", "")
                if key not in seen:
                    seen.add(key)
                    valid.append(raw.strip())
                break
        else:
            if w:
                invalid.append(raw.strip())
    return {"score": len(valid), "valid": valid, "unrecognized": invalid}
