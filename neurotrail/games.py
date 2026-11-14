"""
Brain Gym: eight tap- and voice-friendly games, each a digital version of a classic neuropsychological task.

Honesty rules for every game card:
  * Only Speed Sprint has randomized-trial evidence linked to dementia outcomes (ACTIVE, with boosters).
  * The others are measurement tasks. Brain-training reviews find gains on trained tasks but little
    transfer to everyday cognition (Simons et al. 2016), so they're framed as tracking, not treatment.
  * Word Recall and Animal Naming use the same task formats NHANES gave adults 60+, so scores can be
    shown against real NHANES percentiles. Digital administration differs, and the app says so.
"""
from __future__ import annotations

import random
from functools import lru_cache
from pathlib import Path

import pandas as pd

ART = Path(__file__).resolve().parents[1] / "models" / "artifacts"
SIMONS = "https://pubmed.ncbi.nlm.nih.gov/27697851/"
ACTIVE = "https://pubmed.ncbi.nlm.nih.gov/41669119/"
GAME_SPARKS = 15

# Speed Sprint: short 15-second rounds with levels. Pass = hit the goal with >= 80% accuracy -> next level.
SPEED_SECONDS = 15
PASS_ACCURACY = 0.8
SPEED_LEVELS = [   # symbols on the key, correct answers needed in 15 s, does the key reshuffle every 4 correct?
    {"level": 1, "symbols": 4, "target": 6, "shuffle": False},
    {"level": 2, "symbols": 6, "target": 7, "shuffle": False},
    {"level": 3, "symbols": 9, "target": 8, "shuffle": False},
    {"level": 4, "symbols": 9, "target": 9, "shuffle": False},
    {"level": 5, "symbols": 9, "target": 9, "shuffle": True},
    {"level": 6, "symbols": 9, "target": 10, "shuffle": True},
    {"level": 7, "symbols": 9, "target": 11, "shuffle": True},
    {"level": 8, "symbols": 9, "target": 12, "shuffle": True},
]
for _L in SPEED_LEVELS:
    _L["goal"] = f"{_L['target']} correct · {_L['symbols']} symbols" + (" · key shuffles" if _L["shuffle"] else "")
LEVEL_UP_SPARKS = 10   # bonus each time a player clears a level for the first time (any game)

# Every other game: 8 levels, rounds of 15-20 seconds. "target" is the pass mark for the round's score
# (higher is better unless the game says lower); max_errors / min_accuracy add a second condition.
LEVELS = {
    "recall": [{"level": i + 1, "words": n, "seconds": 15, "target": n, "max_errors": 1,
                "goal": f"find all {n} words · 1 wrong tap allowed"} for i, n in enumerate(range(3, 11))],
    "fluency": [{"level": i + 1, "seconds": 15, "target": n, "goal": f"name {n} different animals"}
                for i, n in enumerate(range(3, 11))],
    "trails": [{"level": i + 1, "count": n, "mode": m, "seconds": t, "target": t, "max_errors": 2,
                "goal": f"{'1→2→3' if m == 'A' else '1→A→2→B'} · {n} dots in {t} s"}
               for i, (n, m, t) in enumerate([(6, "A", 15), (9, "A", 15), (12, "A", 18), (6, "B", 15),
                                              (8, "B", 18), (10, "B", 20), (12, "B", 20), (14, "B", 20)])],
    "stroop": [{"level": i + 1, "seconds": 15, "target": n, "match": m, "shuffle": i >= 5, "min_accuracy": 0.8,
                "goal": f"{n} correct · 80%+ right" + (" · buttons move" if i >= 5 else "")}
               for i, (n, m) in enumerate([(6, .5), (7, .4), (8, .3), (9, .2), (10, 0), (10, 0), (11, 0), (12, 0)])],
    "corsi": [{"level": i + 1, "length": n, "tries": 3, "target": 2, "goal": f"repeat {n} blocks · 2 of 3 tries"}
              for i, n in enumerate(range(2, 10))],
    "reaction": [{"level": i + 1, "trials": 6, "target": ms, "nogo": i >= 4, "max_errors": 1,
                  "goal": f"median under {ms} ms" + (" · don't tap red" if i >= 4 else "")}
                 for i, ms in enumerate([450, 420, 390, 360, 380, 350, 320, 300])],
    # Read Aloud: read a passage of at least `words` words before time runs out. Speech recognition can miss
    # a word or two, so the pass mark is 85% of the words heard, in order.
    "readaloud": [{"level": i + 1, "words": n, "seconds": t, "target": round(n * 0.85),
                   "goal": f"read {n} words aloud in {t} s"}
                  for i, (n, t) in enumerate([(12, 15), (16, 15), (20, 15), (24, 18), (28, 18), (32, 20),
                                              (36, 20), (40, 20)])],
    # Voice Check: talk about a topic until the timer ends. Score = flow % (time talking rather than in pauses
    # of 1/4 s or more, from neurotrail/voice.py). "finished" = you kept talking until near the end.
    "voice": [{"level": i + 1, "seconds": t, "target": n, "goal": f"talk {t} s · {n}%+ flow (few long pauses)"}
              for i, (t, n) in enumerate([(15, 60), (15, 65), (20, 65), (20, 70), (25, 70), (25, 75), (30, 75), (30, 80)])],
}


def level_passed(gid: str, level: int, score: float, detail: dict) -> bool:
    """Did a round at this level pass? Score vs target, plus the level's error / accuracy rule."""
    L = LEVELS[gid][level - 1]
    ok = score >= L["target"] if GAME_BY_ID[gid]["better"] == "higher" else score <= L["target"]
    errors = detail.get("errors", 0) or 0
    if "max_errors" in L:
        ok = ok and errors <= L["max_errors"]
    if "min_accuracy" in L:
        ok = ok and score / max(1, score + errors) >= L["min_accuracy"]
    return bool(ok and detail.get("finished", True))


def level_summary(gid: str, rows: list[dict]) -> dict:
    """Current level = highest level passed + 1 (capped). `rows` are game_results rows for this game;
    only levelled rounds count (classic NHANES-style rounds have no level)."""
    if gid == "speed":
        return speed_summary(rows)
    Ls = LEVELS[gid]
    lv = [r for r in rows if r["detail"].get("level")]
    passed = max((r["detail"]["level"] for r in lv if r["detail"].get("passed")), default=0)
    level = min(len(Ls), passed + 1)
    here = [r["score"] for r in lv if r["detail"]["level"] == level]
    pick = max if GAME_BY_ID[gid]["better"] == "higher" else min
    return {"levels": Ls, "top": len(Ls), "passed": passed, "level": level, "rule": Ls[level - 1],
            "best_here": pick(here) if here else None, "plays": len(lv),
            **_best_played(lv, "score", GAME_BY_ID[gid]["better"], lambda r: r["detail"]["level"])}


def rank_key(gid: str, summary: dict) -> tuple:
    """Leaderboard order: more levels cleared, then highest level played, then the best score there."""
    b = summary["best_played"]
    better_high = GAME_BY_ID[gid]["better"] == "higher" if gid in GAME_BY_ID else True
    return (summary["passed"], summary["top_played"] or 0, float("-inf") if b is None else (b if better_high else -b))


def speed_passed(r: dict) -> bool:
    """Did this round clear its level? Rounds from before levels existed (level None) never count."""
    if not r.get("level"):
        return False
    goal = SPEED_LEVELS[r["level"] - 1]["target"]
    return r["correct"] >= goal and r["correct"] / max(1, r["correct"] + r["wrong"]) >= PASS_ACCURACY


def speed_summary(rounds: list[dict]) -> dict:
    """Current level (highest passed + 1, capped at the top level) and bests, from 15-second rounds only."""
    timed = [r for r in rounds if r.get("level")]
    passed = max((r["level"] for r in timed if speed_passed(r)), default=0)
    level = min(len(SPEED_LEVELS), passed + 1)
    here = [r["correct"] for r in timed if r["level"] == level]
    return {"seconds": SPEED_SECONDS, "pass_accuracy": PASS_ACCURACY, "levels": SPEED_LEVELS,
            "top": len(SPEED_LEVELS), "passed": passed, "level": level, "rule": SPEED_LEVELS[level - 1],
            "best_here": max(here, default=None), "best": max((r["correct"] for r in timed), default=None),
            "plays": len(timed), **_best_played(timed, "correct", "higher")}


def _best_played(rows: list[dict], key: str, better: str, lvl=lambda r: r["level"]) -> dict:
    """Highest level played and the best score there (what the leaderboard shows)."""
    if not rows:
        return {"top_played": None, "best_played": None}
    top = max(lvl(r) for r in rows)
    sc = [r[key] for r in rows if lvl(r) == top]
    return {"top_played": top, "best_played": (max if better == "higher" else min)(sc)}
# Brain map (Games page): "region" is the brain-board area the skill leans on most. Real tasks use whole
# networks; we light the best-known hub, and the page says so.

GAMES = [
    {"id": "speed", "kind": "Speed", "region": "speed",
     "region_why": "Keeps the symbol key in mind while you match as fast as you can.", "title": "Speed Sprint", "icon": "⚡", "color": "#FFC83D", "domain": "Processing speed",
     "test": "Digit Symbol Substitution Test (DSST)", "how": "Match each symbol to its number in 15-second rounds. Hit the goal to unlock the next level: more symbols, then a key that reshuffles.",
     "unit": "correct", "better": "higher",
     "evidence": "The only game with trial evidence: ACTIVE speed training with boosters → dementia HR 0.75 (0.59–0.95).",
     "url": ACTIVE, "norm": None},
    {"id": "recall", "kind": "Memory", "region": "sleep",
     "region_why": "The hippocampus in the inner temporal lobe stores new memories, and it is the first area Alzheimer's affects.", "title": "Word Recall", "icon": "📝", "color": "#59F0FF", "domain": "Verbal memory",
     "test": "CERAD word-list learning + delayed recall (used in NHANES)",
     "how": "Words flash one by one. Then you have 15 seconds to tap every one of them in a grid with other words mixed in. Each level adds a word.",
     "unit": "words found", "better": "higher",
     "evidence": "NHANES gave this task format to 2,972 adults 60+; we show where you'd fall. Different words, digital, so it's approximate.",
     "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2011/DataFiles/CFQ_G.htm", "norm": "cerad_learning"},
    {"id": "fluency", "kind": "Language", "region": "smoke",
     "region_why": "The left inferior frontal gyrus (Broca's area) searches for words and says them.", "title": "Animal Naming", "icon": "🐾", "color": "#3DDC97", "domain": "Language & executive function",
     "test": "Animal fluency (used in NHANES)", "how": "Say (or type) as many different animals as you can in 15 seconds. Each level needs one more.",
     "unit": "animals", "better": "higher",
     "evidence": "NHANES norms from 2,949 adults 60+ (spoken to an examiner). Voice mode is closest; typing is slower.",
     "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2011/DataFiles/CFQ_G.htm", "norm": "animal_fluency"},
    {"id": "trails", "kind": "Attention", "region": "connect",
     "region_why": "The temporoparietal junction moves your attention from one target to the next.", "title": "Trail Connect", "icon": "🔗", "color": "#B388FF", "domain": "Attention & task switching",
     "test": "Trail Making Test, parts A and B", "how": "Connect the dots in order before the timer runs out: 1→2→3… on early levels, then switch 1→A→2→B→3… The next dot is always shown at the top.",
     "unit": "seconds", "better": "lower",
     "evidence": "Classic clinical test of switching. Measurement only: brain-training gains rarely transfer (Simons 2016).",
     "url": SIMONS, "norm": None},
    {"id": "stroop", "kind": "Self-control", "region": "bp",
     "region_why": "The anterior cingulate notices the word and the ink don't match, so you hold back the wrong answer.", "title": "Color Clash", "icon": "🎨", "color": "#FF7A6E", "domain": "Inhibition",
     "test": "Stroop color-word test", "how": "A color word appears in a different ink. Tap the INK color, not the word, as many times as you can in 15 seconds.",
     "unit": "correct", "better": "higher",
     "evidence": "Measures inhibitory control (the Stroop effect). Measurement, not a proven treatment (Simons 2016).",
     "url": SIMONS, "norm": None},
    {"id": "corsi", "kind": "Memory", "region": "labs",
     "region_why": "The precuneus keeps a mental map of where things were in space.", "title": "Memory Grid", "icon": "🟦", "color": "#4FC3F7", "domain": "Visuospatial working memory",
     "test": "Corsi block-tapping span", "how": "Watch the blocks light up, then tap them in the same order. Get 2 of 3 right to pass; each level adds a block.",
     "unit": "sequences right (of 3)", "better": "higher",
     "evidence": "Standard working-memory span task. Measurement, not a proven treatment (Simons 2016).",
     "url": SIMONS, "norm": None},
    {"id": "reaction", "kind": "Reflexes", "region": "steps",
     "region_why": "The primary motor cortex sends the 'tap now' signal to your finger.", "title": "Reflex", "icon": "⏱️", "color": "#F06292", "domain": "Reaction time",
     "test": "Simple reaction time", "how": "Tap the moment the circle turns green, 6 times. From level 5, some circles turn red: don't tap those!",
     "unit": "ms (median)", "better": "lower",
     "evidence": "Simple reaction time slows with age. Measurement only.",
     "url": SIMONS, "norm": None},
    {"id": "readaloud", "kind": "Language", "region": "hearing",
     "region_why": "The superior temporal gyrus (auditory cortex and Wernicke's area) processes speech sounds, including your own voice as you read.",
     "title": "Read Aloud", "icon": "📖", "color": "#59F0FF", "domain": "Reading fluency",
     "test": "Oral reading rate (read-aloud speech task)",
     "how": "Read the passage out loud before the timer runs out. Each word lights up as we hear it. Each level adds more words.",
     "unit": "words read", "better": "higher",
     "evidence": "People with mild cognitive impairment read and speak more slowly, with more pauses (Tóth 2018). Measurement only, not a treatment.",
     "url": "https://pubmed.ncbi.nlm.nih.gov/29165085/", "norm": None},
    # Same id as the Voice page's daily row, so doing either one counts as "played today".
    {"id": "voice", "kind": "Language", "region": "smoke",
     "region_why": "The left inferior frontal gyrus (Broca's area) plans the words and sounds of fluent speech.",
     "title": "Voice Check", "icon": "🎙️", "color": "#7C8CFF", "domain": "Speech flow",
     "test": "Spontaneous-speech timing (speech tempo and silent pauses)",
     "how": "A topic appears: talk about it until the timer ends. We measure your flow, the share of time you're talking rather than in long pauses. Higher levels talk longer with fewer pauses.",
     "unit": "% flow", "better": "higher",
     "evidence": "In Tóth 2018, people with mild cognitive impairment paused more and spoke more slowly in spontaneous speech. Measurement only, not a treatment.",
     "url": "https://pubmed.ncbi.nlm.nih.gov/29165085/", "norm": None},
]
GAME_BY_ID = {g["id"]: g for g in GAMES}
# Level-up bonuses are stored as their own rows (game "levelup") so they never mix with game scores.
GAME_BY_ID["levelup"] = {"id": "levelup", "title": "Level up", "better": "higher", "norm": None}
# The hand check (✋ Hands tab) stores one row per hand per check; score = finger taps per second.
GAME_BY_ID["hands"] = {"id": "hands", "title": "Hand check", "better": "higher", "norm": None}

WORD_LISTS = [
    ["candle", "river", "garden", "ticket", "mirror", "button", "saddle", "forest", "pencil", "island"],
    ["basket", "doctor", "window", "lemon", "anchor", "pillow", "tiger", "bridge", "hammer", "violin"],
    ["blanket", "castle", "orange", "rocket", "kettle", "meadow", "wallet", "parrot", "ladder", "cherry"],
]
DISTRACTORS = ["carpet", "valley", "engine", "harbor", "trumpet", "spoon", "jacket", "planet", "turtle", "cabinet",
               "pepper", "helmet", "fountain", "lantern", "monkey", "statue", "tunnel", "barrel", "compass", "pebble"]

# Read Aloud passages are built from these sentences (no digits: speech recognition writes "7" for "seven").
READ_EASY = [
    "The sun came up over the quiet hill.", "A small dog ran across the green park.",
    "We packed a lunch and went to the lake.", "My friend baked fresh bread this morning.",
    "The red bus stops at the end of our street.", "She put the warm cup of tea on the table.",
    "Birds sang in the tall tree by the door.", "He found his keys under the old blue chair.",
    "The wind blew the leaves along the road.", "They walked home slowly as the sky turned pink.",
    "A cat sat on the wall and watched the rain.", "We read a good book by the fire last night.",
]
READ_HARD = [
    "The museum opened a remarkable exhibition about ancient sailing ships.",
    "Every autumn the orchard fills with visitors gathering ripe apples.",
    "Our neighbor practices the violin patiently before breakfast.",
    "A gentle thunderstorm rolled across the valley in the afternoon.",
    "The librarian recommended a mysterious novel about a lighthouse.",
    "Fresh vegetables from the market make a wonderful evening soup.",
    "The photographer waited quietly for the perfect golden light.",
    "Children collected colorful shells along the sandy shoreline.",
    "My grandmother remembers dancing at the village celebration.",
    "The careful gardener protected the young tomatoes from frost.",
]


def read_passage(level: int, rng: random.Random | None = None) -> dict:
    """Random sentences for this level, at least the level's word count long."""
    L = LEVELS["readaloud"][max(1, min(level, len(LEVELS["readaloud"]))) - 1]
    pool = list(READ_EASY if L["level"] <= 4 else READ_HARD)
    (rng or random).shuffle(pool)
    out: list[str] = []
    while sum(len(s.split()) for s in out) < L["words"]:
        out.append(pool[len(out) % len(pool)])
    text = " ".join(out)
    return {"level": L["level"], "text": text, "words": len(text.split())}


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

