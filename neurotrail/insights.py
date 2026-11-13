"""
Personal insights: which of YOUR habits go with better results on YOUR checks.

Population models (NHANES) say what tends to matter for people like you. This module asks the
within-person question instead: on days you slept 7+ hours, walked more, talked with someone or
did something enjoyable, did your checks go better than on your other days?

Method (kept simple and honest):
  1. Each check's scores are put on your own scale. With 4+ plays we first remove the practice
     effect (scores rise just from repetition) by fitting score ~ log(play number), so "getting
     used to the game" isn't mistaken for a habit effect. Lower-is-better checks are flipped.
  2. Each day gets one "check score": the mean of that day's standardized results.
  3. For each habit, days are split into habit / no habit and compared with a Welch t-test.
  4. Confidence: "clear pattern" (Holm-adjusted p < .05 across the habits tested, 5+ days in each
     group), "early hint" (p < .20, 3+ days each), otherwise "no clear difference yet". Always framed as a pattern in your data, not proof:
     a cold, stress or time of day can drive both.

Day-level sleep sits on the day you report it ("hours you slept last night"), so it is matched to
the checks you play that same day. Within-person sleep-cognition links have research support, e.g.
nights shorter than a person's own average predicting slower next-day processing speed (journal Sleep).
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from scipy import stats

from . import db
from .games import GAME_BY_ID

MIN_PLAYS_PER_CHECK = 3      # a check needs this many plays before it can be standardized
MIN_DAYS_EACH = 3            # days needed on each side of a comparison
DAYS_TO_UNLOCK = 6           # days with checks + habit info before the first insight is attempted
SLEEP_GOOD = 7.0
EXCLUDED_GAMES = {"speed", "voice"}   # speed comes from speed_rounds (every round); voice isn't a score

CHECK_NAMES = {"speed": "Speed Sprint", "recall": "Word Recall", "recall_delayed": "Delayed recall",
               "fluency": "Animal Naming", "trails": "Trail Connect", "stroop": "Color Clash",
               "corsi": "Memory Grid", "reaction": "Reflex"}
CHECK_UNITS = {"speed": "correct", "recall": "words", "recall_delayed": "words", "fluency": "animals",
               "trails": "s", "stroop": "correct", "corsi": "span", "reaction": "ms"}


# ------------------------------------------------------------------ outcomes: standardized check scores
def _plays(player: str) -> dict[str, list[tuple[str, float]]]:
    """{check id: [(date, score), ...] in play order}."""
    out: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for r in db.rounds(player):
        out["speed"].append((r["date"], float(r["correct"])))
    for g in db.games(player):
        gid = "recall_delayed" if g["game"] == "recall" and g["detail"].get("delayed") else g["game"]
        if gid in EXCLUDED_GAMES or gid not in GAME_BY_ID:
            continue
        out[gid].append((g["date"], float(g["score"])))
    return out


def _standardize(scores: list[float], higher_better: bool) -> list[float]:
    """Practice-adjusted z-scores on the person's own scale (positive = better than usual)."""
    y = np.asarray(scores, float)
    if len(y) >= 4:
        x = np.log(np.arange(1, len(y) + 1))
        slope, icept = np.polyfit(x, y, 1)
        resid = y - (icept + slope * x)
    else:
        resid = y - y.mean()
    sd = resid.std(ddof=1) if len(y) > 1 else 0.0
    if not sd or not math.isfinite(sd):
        return [0.0] * len(y)
    z = resid / sd
    return list(z if higher_better else -z)


def day_scores(player: str) -> tuple[dict[str, float], dict[str, dict[str, list[float]]]]:
    """({date: mean standardized check score}, {check: {date: [raw scores]}})."""
    per_day: dict[str, list[float]] = defaultdict(list)
    raw: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for gid, plays in _plays(player).items():
        if len(plays) < MIN_PLAYS_PER_CHECK:
            continue
        z = _standardize([s for _, s in plays], GAME_BY_ID[gid]["better"] == "higher")
        for (d, s), zi in zip(plays, z):
            per_day[d].append(zi)
            raw[gid][d].append(s)
    return {d: float(np.mean(v)) for d, v in per_day.items()}, raw


# ------------------------------------------------------------------ exposures: what you did each day
def day_habits(player: str) -> dict[str, dict]:
    """{date: {"sleep": hours|None, "steps": n|None, "connect": bool, "joy": bool, "habits": n}}."""
    out: dict[str, dict] = defaultdict(lambda: {"sleep": None, "steps": None, "connect": False, "joy": False, "habits": 0})
    for d, v in db.days(player).items():                      # phone / watch imports
        if v.get("sleep_hours") is not None:
            out[d]["sleep"] = float(v["sleep_hours"])
        if v.get("steps") is not None:
            out[d]["steps"] = float(v["steps"])
    for l in db.logs(player):                                 # what you logged in the app wins
        d = out[l["date"]]
        d["habits"] += 1
        if l["quest"] == "sleep" and l["value"] is not None:
            d["sleep"] = float(l["value"])
        elif l["quest"] == "steps" and l["value"] is not None:
            d["steps"] = float(l["value"])
        elif l["quest"] == "connect":
            d["connect"] = True
        elif l["quest"] == "joy":
            d["joy"] = True
    return dict(out)


def _round_to(x: float, step: int) -> int:
    return int(step * round(x / step))


# ------------------------------------------------------------------ comparisons
def _compare(yes: list[float], no: list[float]) -> dict:
    diff = float(np.mean(yes) - np.mean(no))
    if len(yes) >= 2 and len(no) >= 2 and (np.var(yes) + np.var(no)) > 0:
        p = float(stats.ttest_ind(yes, no, equal_var=False).pvalue)
    else:
        p = 1.0
    if not math.isfinite(p):
        p = 1.0
    n_min = min(len(yes), len(no))
    level = ("clear" if p < .05 and n_min >= 5 else "hint" if p < .20 else "none")
    return {"diff_sd": round(diff, 2), "p": round(p, 3), "n_yes": len(yes), "n_no": len(no), "level": level}


def _example(raw: dict, yes_days: set, no_days: set) -> dict | None:
    """A concrete number for one check played on both kinds of day (prefer Speed Sprint)."""
    order = ["speed"] + [g for g in raw if g != "speed"]
    for gid in order:
        if gid not in raw:
            continue
        a = [s for d, ss in raw[gid].items() if d in yes_days for s in ss]
        b = [s for d, ss in raw[gid].items() if d in no_days for s in ss]
        if len(a) >= 2 and len(b) >= 2:
            ma, mb = float(np.mean(a)), float(np.mean(b))
            better = GAME_BY_ID[gid]["better"] == "higher"
            pct = (ma - mb) / abs(mb) * 100 * (1 if better else -1) if mb else 0.0
            return {"check": CHECK_NAMES.get(gid, gid), "unit": CHECK_UNITS.get(gid, ""), "with": round(ma, 1),
                    "without": round(mb, 1), "better_pct": round(pct), "lower_is_better": not better}
    return None


def personal_insights(player: str) -> dict:
    scores, raw = day_scores(player)
    habits = day_habits(player)
    check_days = sorted(scores)
    known_days = [d for d in check_days if d in habits]
    # Progress counts every day with a game and a habit, even before a game has the 3 plays it needs to be scored.
    played_days = {d for plays in _plays(player).values() for d, _ in plays}
    progress = max(len(known_days), len(played_days & habits.keys()))
    status = {"check_days": len(played_days), "days_with_both": progress, "days_needed": DAYS_TO_UNLOCK}
    if len(known_days) < DAYS_TO_UNLOCK:
        status["days_with_both"] = min(progress, DAYS_TO_UNLOCK - 1)   # never show "0 days to go" while still locked
        return {"ready": False, "status": status, "insights": []}

    steps_days = [habits[d]["steps"] for d in known_days if habits[d]["steps"] is not None]
    step_cut = max(3000, _round_to(float(np.median(steps_days)), 500)) if len(steps_days) >= 2 * MIN_DAYS_EACH else 6000
    rules = [
        ("sleep", "😴", f"slept {SLEEP_GOOD:g}+ hours", "sleep", lambda h: None if h["sleep"] is None else h["sleep"] >= SLEEP_GOOD),
        ("steps", "👟", f"walked {step_cut:,}+ steps", "steps", lambda h: None if h["steps"] is None else h["steps"] >= step_cut),
        ("connect", "💬", "talked with someone", "connect", lambda h: h["connect"]),
        ("joy", "🎯", "did something you enjoy", "joy", lambda h: h["joy"]),
    ]
    out = []
    for key, icon, phrase, habit, rule in rules:
        flags = {d: rule(habits[d]) for d in known_days}
        yes_d = {d for d, f in flags.items() if f is True}
        no_d = {d for d, f in flags.items() if f is False}
        if len(yes_d) < MIN_DAYS_EACH or len(no_d) < MIN_DAYS_EACH:
            out.append({"key": key, "icon": icon, "habit": habit, "phrase": phrase, "level": "more_data",
                        "n_yes": len(yes_d), "n_no": len(no_d)})
            continue
        c = _compare([scores[d] for d in yes_d], [scores[d] for d in no_d])
        direction = "better" if c["diff_sd"] > 0 else "worse"
        if c["level"] == "none":
            head = f"No clear difference yet on days you {phrase}"
        else:
            head = f"Your checks went {direction} on days you {phrase}"
        out.append({"key": key, "icon": icon, "habit": habit, "phrase": phrase, "headline": head, "direction": direction,
                    "example": _example(raw, yes_d, no_d), **c})

    # Several habits are tested at once, so a "clear pattern" must survive a Holm correction;
    # otherwise one in ~20 flukes would be announced as clear. Downgraded results stay "early hints".
    tested = sorted((i for i in out if "p" in i), key=lambda i: i["p"])
    for k, i in enumerate(tested):
        i["p_adjusted"] = round(min(1.0, max(i["p"] * (len(tested) - j) for j, _ in enumerate(tested[:k + 1]))), 3)
        if i["level"] == "clear" and i["p_adjusted"] >= .05:
            i["level"] = "hint"

    rank = {"clear": 0, "hint": 1, "none": 2, "more_data": 3}
    out.sort(key=lambda i: (rank[i["level"]], -abs(i.get("diff_sd", 0))))
    return {"ready": True, "status": status, "insights": out,
            "note": "Patterns in your own data, not proof of cause. A cold, stress or the time of day can affect "
                    "both your habits and your scores. Practice gains are removed before comparing."}
