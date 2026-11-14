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
STEADI_CHAIR_URL = "https://stacks.cdc.gov/view/cdc/157303/cdc_157303_DS1.pdf"   # CDC STEADI 30-Second Chair Stand form
TABARA = "https://doi.org/10.1161/STROKEAHA.114.006704"
ARAUJO = "https://doi.org/10.1136/bjsports-2021-105360"
DUAL_TASK = "https://doi.org/10.1186/s11556-020-00240-y"

GAMES = [
    {"id": "speed", "title": "Speed Sprint", "icon": "⚡", "color": "#FFC83D", "domain": "Processing speed",
     "test": "Digit Symbol Substitution Test (DSST)", "how": "Match each symbol to its number for 90 seconds.",
     "unit": "correct", "better": "higher",
     "evidence": "The only game with trial evidence: ACTIVE speed training with boosters → dementia HR 0.75 (0.59–0.95).",
     "url": ACTIVE, "norm": None},
    {"id": "recall", "title": "Word Recall", "icon": "📝", "color": "#59F0FF", "domain": "Verbal memory",
     "test": "CERAD word-list learning + delayed recall (used in NHANES)",
     "how": "Learn 10 words over 3 trials, then recall them. Come back after 5+ minutes for delayed recall.",
     "unit": "words (of 30)", "better": "higher",
     "evidence": "NHANES gave this task format to 2,972 adults 60+; we show where you'd fall. Different words, digital, so it's approximate.",
     "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2011/DataFiles/CFQ_G.htm", "norm": "cerad_learning"},
    {"id": "fluency", "title": "Animal Naming", "icon": "🐾", "color": "#3DDC97", "domain": "Language & executive function",
     "test": "Animal fluency (used in NHANES)", "how": "Name as many different animals as you can in 60 seconds, by voice or typing.",
     "unit": "animals", "better": "higher",
     "evidence": "NHANES norms from 2,949 adults 60+ (spoken to an examiner). Voice mode is closest; typing is slower.",
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
    # ---- camera movement tests (pose tracking runs in the browser; video never leaves the device)
    {"id": "chair", "title": "Chair Stand", "icon": "🪑", "color": "#2DD4BF", "domain": "Leg strength & falls", "camera": True,
     "test": "30-Second Chair Stand (CDC STEADI)", "how": "Arms crossed, stand up fully and sit down as many times as you can in 30 seconds.",
     "unit": "stands in 30 s", "better": "higher",
     "evidence": "CDC's fall-risk test for older adults, with age and sex cut-offs. A low score flags fall risk; it isn't a diagnosis.",
     "url": STEADI_CHAIR_URL, "norm": None},
    {"id": "balance", "title": "One-Leg Balance", "icon": "🦩", "color": "#A78BFA", "domain": "Balance", "camera": True,
     "test": "One-leg standing time (eyes open)", "how": "Lift one foot and hold as long as you can, up to 30 seconds.",
     "unit": "seconds", "better": "higher",
     "evidence": "Under 20 s was linked to silent small-vessel brain damage and lower thinking scores (Tabara 2015, ~1,400 adults). Failing 10 s was linked to higher mortality (Araujo 2022).",
     "url": TABARA, "norm": None},
    {"id": "reach", "title": "Reach & Hold Back", "icon": "🖐", "color": "#34D399", "domain": "Movement + self-control", "camera": True,
     "test": "Go/no-go reaching (a dual task)", "how": "Touch green circles with either hand. Don't touch red. 40 seconds.",
     "unit": "points", "better": "higher",
     "evidence": "Combines a thinking rule with movement. Reviews of cognitive-motor training find modest gains in executive function; here it's a measurement.",
     "url": DUAL_TASK, "norm": None},
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


# ---------------------------------------------------------------- movement references
# CDC STEADI 30-Second Chair Stand: a score BELOW these numbers is below average (fall risk).
STEADI_CHAIR = [((60, 64), 14, 12), ((65, 69), 12, 11), ((70, 74), 12, 10), ((75, 79), 11, 10),
                ((80, 84), 10, 9), ((85, 89), 8, 8), ((90, 94), 7, 4)]


def movement_reference(gid: str, score: float, age: float | None, female: bool | None) -> dict | None:
    """A plain-language comparison with a published cut-off, or None. Never a diagnosis."""
    if gid == "chair":
        if age is None or age < 60:
            return {"level": "info", "text": "CDC's chair-stand cut-offs start at age 60, so we only compare you with yourself."}
        band = next((b for b in STEADI_CHAIR if b[0][0] <= age <= b[0][1]), STEADI_CHAIR[-1])
        cut = band[2] if female else band[1]
        who = f"{'women' if female else 'men'} {band[0][0]}–{band[0][1]}"
        if score < cut:
            return {"level": "warn", "text": f"Below the CDC's average for {who} (fewer than {cut} stands). It's a fall-risk flag, not a diagnosis: "
                                             "worth mentioning to your doctor, and strength-and-balance exercise helps."}
        return {"level": "ok", "text": f"At or above the CDC's mark for {who} ({cut} stands)."}
    if gid == "balance":
        if score >= 20:
            return {"level": "ok", "text": "20 seconds or more: past the mark linked to silent small-vessel brain changes in a study of ~1,400 adults (Tabara 2015)."}
        if score >= 10:
            return {"level": "info", "text": "Past 10 s, under 20. Under 20 s went with more silent small-vessel brain changes in one study (Tabara 2015). Best of two tries counts."}
        return {"level": "warn", "text": "Under 10 seconds. In 1,702 people aged 51–75, failing 10 s went with higher mortality (Araujo 2022). "
                                         "One try isn't a diagnosis: retry, and tell your doctor if it keeps happening."}
    return None
