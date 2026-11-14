"""
The Progress page: every source we collect, each kept as its own variable, compared with the
person's OWN starting point.

Sources: watch / phone / tracker days, check-in logs (BP, steps, sleep...), all 7 games, voice
check, hand check, hearing (AirPods / audiogram, sound exposure, check-ins) and MRI brain age.

Rules (the constraints), so the page doesn't claim more than the data supports:
  * No single blended "brain score". Units and evidence differ too much between sources; we show
    each measure and count how many are improving / steady / slipping.
  * Compared with yourself. Baseline = your first stretch of data; "now" = your most recent stretch.
    Daily data: first 28 days vs last 14 days (>= 7 days in each). Games / voice / hands: after
    skipping practice plays, median of your first 3 vs your last 3.
  * Practice effects. Everyone improves on a new game for the first few plays from learning the
    game itself, not from a sharper brain, so those plays never count as baseline.
  * A change has to be bigger than normal day-to-day wobble: half the SD of your own values
    (a common "smallest meaningful change" rule) and at least a fixed floor per measure.
  * Not enough data → "building", with how much more is needed. Old data → "stale".
  * Manual check-ins and the watch can both log steps/sleep: the watch wins for any day it covers.
  * MRI: sample scans you tried aren't yours and are excluded. One scan is a snapshot with
    ±model error; a trend needs 2 scans >= 6 months apart that differ by more than that error.
  * Comparisons with other people (NHANES percentiles) only for measures recorded the same way.
  * Links between sources ("on nights you slept 7 h+, your games...") are patterns in your own
    data, not proof of cause, and need >= 3 days on each side.
"""
from __future__ import annotations

import json
import statistics as st
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from . import db, games as gym
from .wearables import FIELD_INFO

ART = Path(__file__).resolve().parents[1] / "models" / "artifacts"
RES = Path(__file__).resolve().parents[1] / "results"

GROUPS = [
    ("movement", "🚶 Movement", "Watch, phone and your check-ins"),
    ("sleep_heart", "🌙 Sleep & heart", "Watch and your check-ins"),
    ("thinking", "🧩 Thinking games", "Every game you've played"),
    ("speech_hands", "🎙️ Speech & hands", "Voice check and camera hand check"),
    ("hearing", "👂 Hearing", "Hearing tests, sound exposure and Sound Check"),
    ("brain_scan", "🩻 Brain scan", "Your own uploaded MRI scans"),
]
# id -> (group, better, floor for a meaningful change, note)
# better: "higher" | "lower" | ("band", lo, hi) for "in range is best"
WATCH_VARS = {
    "steps": ("movement", "higher", 500, None),
    "exercise_min": ("movement", "higher", 5, None),
    "walking_speed": ("movement", "higher", 0.05, "Gait speed is one of the strongest everyday signs of healthy ageing."),
    "vo2max": ("movement", "higher", 1.0, None),
    "walking_steadiness": ("movement", "higher", 3, None),
    "walking_asymmetry": ("movement", "lower", 1, None),
    "double_support": ("movement", "lower", 1, None),
    "daylight_min": ("movement", "higher", 10, None),
    "sleep_hours": ("sleep_heart", ("band", 7.0, 9.0), 0.25, "Watches measure time asleep; 7–9 h is the usual healthy range."),
    "sleep_sd": ("sleep_heart", "lower", 0.15, None),
    "resting_hr": ("sleep_heart", "lower", 2, None),
    "hrv_ms": ("sleep_heart", "higher", 4, None),
    "spo2": ("sleep_heart", "higher", 0.5, None),
    "resp_rate": ("sleep_heart", "lower", 0.5, None),
    "hearing_pta_db": ("hearing", "lower", 10, "From a hearing test saved to Apple Health (e.g. AirPods Pro hearing test). Under 20 dB is typical hearing."),
    "headphone_db": ("hearing", "lower", 2, "WHO safe-listening guidance: keep the weekly average under 80 dBA."),
    "noise_db": ("hearing", "lower", 2, None),
}
GAME_PRACTICE = 2
DAY_BASE, DAY_RECENT, DAY_MIN = 28, 14, 7
STALE_DAYS = 21


@lru_cache
def _norms() -> dict:
    p = ART / "wearable_norms.json"
    return json.loads(p.read_text()) if p.exists() else {}


@lru_cache
def _wear_metrics() -> dict:
    p = ART / "wearable_metrics.json"
    return json.loads(p.read_text()) if p.exists() else {}


@lru_cache
def _mri_mae() -> float:
    for p in (RES / "metrics_ensemble.json", ART / "mri_cnn_metrics.json"):
        if p.exists():
            return float(json.loads(p.read_text())["mae"])
    return 7.0


def percentile(field: str, value: float, age: float, female: bool) -> dict | None:
    """Where value falls among NHANES adults 60+ of the same sex and age band (survey-weighted)."""
    g = _norms().get("groups", {}).get(field)
    if not g or age < 60:
        return None
    band = 60 if age < 70 else 70 if age < 80 else 80
    row = g.get(f"{'female' if female else 'male'}_{band}")
    if not row:
        return None
    pct = sum(1 for x in row["q"] if x < value)          # q[i] is the (i+1)th percentile
    label = f"{'women' if female else 'men'} " + (f"{band}–{band + 9}" if band < 80 else "80+")
    return {"percentile": max(1, min(99, pct)), "group": label, "n": row["n"]}


def _better_sign(better) -> int:
    return 1 if better == "higher" else -1


def _score_for(better, v: float) -> float:
    """Map a value onto 'higher is better' so changes can be compared one way."""
    if isinstance(better, tuple):
        _, lo, hi = better
        return -(lo - v if v < lo else v - hi if v > hi else 0.0)
    return v * _better_sign(better)


def _trend(points: list[tuple[str, float]], better, floor: float, kind: str, practice: int = 0,
           word: str = "play", today: date | None = None) -> dict:
    today = today or date.today()
    pts = sorted(points, key=lambda x: x[0])   # by time only; same-second plays keep play order
    out = {"n": len(pts), "latest": pts[-1][1] if pts else None, "latest_date": pts[-1][0] if pts else None}
    if not pts:
        return out | {"status": "none"}
    age_days = (today - date.fromisoformat(pts[-1][0][:10])).days      # points may carry a full timestamp
    if age_days > STALE_DAYS:
        out["stale_days"] = age_days
    if kind == "test":                 # occasional tests (hearing): first vs latest, 1 test = snapshot
        if len(pts) < 2:
            return out | {"status": "snapshot"}
        b, r = pts[0][1], pts[-1][1]
        delta = _score_for(better, r) - _score_for(better, b)
        return out | {"baseline": b, "recent": r, "change": r - b, "threshold": floor, "baseline_label": "your first test",
                      "status": "improving" if delta > floor else "slipping" if delta < -floor else "steady"}
    if kind == "daily":
        first = date.fromisoformat(pts[0][0])
        last = date.fromisoformat(pts[-1][0])
        base = [v for d, v in pts if date.fromisoformat(d) < first + timedelta(days=DAY_BASE)]
        recent = [v for d, v in pts if date.fromisoformat(d) > last - timedelta(days=DAY_RECENT)]
        span_ok = (last - first).days >= DAY_BASE + DAY_RECENT - 1
        if not span_ok or len(base) < DAY_MIN or len(recent) < DAY_MIN:
            need = max(0, DAY_BASE + DAY_RECENT - 1 - (last - first).days)
            return out | {"status": "building", "need": f"{need} more days" if need else "a few more days with data"}
        b, r = st.median(base), st.median(recent)
        out |= {"baseline": b, "recent": r, "baseline_label": f"first {DAY_BASE} days", "recent_label": f"last {DAY_RECENT} days"}
    else:
        usable = pts[practice:]
        need = practice + 5 - len(pts)
        if need > 0:
            return out | {"status": "building", "need": f"{need} more {word}{'' if need == 1 else 's'}"}
        base, recent = [v for _, v in usable[:3]], [v for _, v in usable[-3:]]
        b, r = st.median(base), st.median(recent)
        out |= {"baseline": b, "recent": r, "baseline_label": f"your first 3 counted {word}s",
                "recent_label": f"your last 3 {word}s"}
        if practice:
            out["practice_skipped"] = min(practice, len(pts))
    # normal wobble = day-to-day spread WITHIN each period (a real change between periods mustn't inflate it)
    spread = ((st.pvariance(base) + st.pvariance(recent)) / 2) ** 0.5
    thr = max(floor, 0.5 * spread)
    delta = _score_for(better, r) - _score_for(better, b)
    out |= {"change": r - b, "threshold": thr,
            "status": "improving" if delta > thr else "slipping" if delta < -thr else "steady"}
    if out.get("stale_days") and kind == "daily":       # a sensor that stopped syncing; games keep their trend
        out["status"] = "stale"
    return out


def _var(vid, group, label, unit, source, points, better, floor, kind, practice=0, note=None, word="play", **extra) -> dict:
    v = {"id": vid, "group": group, "label": label, "unit": unit, "source": source,
         "better": better if not isinstance(better, tuple) else f"{better[1]:g}–{better[2]:g} {unit}",
         "points": [{"date": d, "value": round(x, 3)} for d, x in sorted(points, key=lambda x: x[0])][-120:], "note": note}
    v |= _trend(points, better, floor, kind, practice, word)
    v |= extra
    v["_spec"] = (kind, sorted(points, key=lambda x: x[0]), better, floor, practice)   # for the combined line
    return v


def _rolling_sleep_sd(days: dict[str, dict]) -> list[tuple[str, float]]:
    nights = sorted((d, v["sleep_hours"]) for d, v in days.items() if "sleep_hours" in v)
    out = []
    for i, (d, _) in enumerate(nights):
        dd = date.fromisoformat(d)
        win = [h for e, h in nights[: i + 1] if date.fromisoformat(e) > dd - timedelta(days=14)]
        if len(win) >= 5 and (i + 1) % 7 == 0:        # one value per week of nights
            out.append((d, st.stdev(win)))
    return out


FORMAT_LABEL = {"classic": "classic test", "old": "older version of the game"}


def game_rows(p, gid: str) -> list[tuple[str, float, str, int | None]]:
    """(timestamp, score, format, level passed or None). Format = "classic", "level N" or "old".
    Old = rounds saved before levels existed (e.g. 90-second Speed Sprint, the old voice-recording rows)."""
    if gid == "speed":
        return [(r["ts"], float(r["correct"]), f"level {r['level']}" if r.get("level") else "old",
                 r["level"] if r.get("level") and gym.speed_passed(r) else None) for r in db.rounds(p.name)]
    out = []
    for r in db.games(p.name, gid):
        d = r["detail"]
        if gid == "voice" and "task" in d:       # voice-recording page rows (speech tempo), not the Voice Check game
            continue
        fmt = "classic" if d.get("classic") else f"level {d['level']}" if d.get("level") else "old"
        out.append((r["ts"], float(r["score"]), fmt, d["level"] if d.get("level") and d.get("passed") else None))
    return out


def pick_format(rows) -> tuple[str, list[tuple[str, float]], int]:
    """The format to trend: the classic test if it has enough plays (fixed difficulty, best for tracking),
    otherwise the format played most. Practice plays are skipped only if this format includes the very
    first plays of the game."""
    count = {}
    for _, _, f, _ in rows:
        count[f] = count.get(f, 0) + 1
    fmt = "classic" if count.get("classic", 0) >= GAME_PRACTICE + 5 else max(count, key=lambda f: (count[f], f == "classic"))
    pts = [(t, v) for t, v, f, _ in rows if f == fmt]
    practice = GAME_PRACTICE if rows[0][2] == fmt else 0
    return fmt, pts, practice


def build(p) -> dict:
    days = db.days(p.name)
    logs = p.logs
    vars_: list[dict] = []
    age, female = float(p.age), bool(p.female)
    wm = _wear_metrics()

    # ---------------- watch + check-ins (watch wins for a day it covers)
    manual = {"steps": "steps", "sleep": "sleep_hours"}
    series = {f: {d: v[f] for d, v in days.items() if f in v} for f in FIELD_INFO}
    from_watch = {f: set(s) for f, s in series.items()}
    for q, f in manual.items():
        for l in logs:
            if l["quest"] == q and l.get("value") is not None and l["date"] not in series[f]:
                series[f][l["date"]] = float(l["value"])
    series["sleep_sd"] = dict(_rolling_sleep_sd({d: {"sleep_hours": v} for d, v in series["sleep_hours"].items()}))
    for f, (group, better, floor, note) in WATCH_VARS.items():
        pts = list(series.get(f, {}).items())
        if not pts:
            continue
        label, unit = ("Steady sleep hours (night-to-night change)", "h") if f == "sleep_sd" else FIELD_INFO[f][1:]
        n_watch = len(from_watch.get(f, ())) if f != "sleep_sd" else None
        src = "watch" if n_watch == len(pts) else "check-ins" if not n_watch else "watch + check-ins"
        if f == "sleep_sd":
            src = "watch" if from_watch["sleep_hours"] else "check-ins"
        kind = "test" if f == "hearing_pta_db" else "game" if f == "sleep_sd" else "daily"
        v = _var(f, group, label, unit, src, pts, better, floor, kind, note=note, word="week")
        ref = v.get("recent", v["latest"])
        # NHANES comparison only where a wrist tracker measured the same thing the same way
        # (resting pulse there was taken by a nurse while seated, so it isn't compared)
        if f in ("steps", "sleep_sd") and ref is not None:
            pc = percentile("steps_day" if f == "steps" else f, ref, age, female)
            if pc:
                pc["text"] = (f"More steps than {pc['percentile']}% of {pc['group']}" if f == "steps" else
                              f"More regular sleep than {100 - pc['percentile']}% of {pc['group']}")
            v["vs_others"] = pc
        if f in ("steps", "sleep_sd", "resting_hr") and ref is not None:
            v["research"] = _research_note(f, ref, wm)
        vars_.append(v)

    bp = [(l["date"], float(l["value"])) for l in logs if l["quest"] == "bp" and l.get("value") is not None]
    if bp:
        vars_.append(_var("bp", "sleep_heart", "Blood pressure (top number)", "mmHg", "check-ins", bp, "lower", 3,
                          "game", note="SPRINT MIND: aiming for 120 lowered mild memory problems by 19%.", word="reading"))

    # ---------------- games (every game; scores only compared within the same mode and level)
    for g in gym.GAMES:
        link = "#/sprint" if g["id"] == "speed" else f"#/game/{g['id']}"
        rows = game_rows(p, g["id"])
        base = {"id": "game_" + g["id"], "group": "thinking", "label": g["title"], "icon": g.get("icon", ""),
                "unit": g["unit"], "source": "game", "link": link, "domain": g.get("domain", "")}
        if not rows:
            vars_.append(base | {"status": "none", "n": 0, "points": []})
            continue
        fmt, pts, practice = pick_format(rows)
        v = _var(base["id"], "thinking", g["title"], g["unit"], "game", pts, g["better"], 0, "game",
                 practice=practice, icon=base["icon"], domain=base["domain"], link=link)
        v["format"] = FORMAT_LABEL.get(fmt, fmt)
        formats = {r[2] for r in rows}
        if len(formats) > 1:
            v["note"] = (f"Trend uses your {v['format']} only ({len(pts)} of {len(rows)} plays). Harder levels and "
                         f"different versions give different scores, so they're never mixed.")
        passed = [r[3] for r in rows if r[3]]
        if passed:
            v["level_reached"] = max(passed)
            v["level_top"] = len(gym.SPEED_LEVELS) if g["id"] == "speed" else len(gym.LEVELS.get(g["id"], [])) or None
        vars_.append(v)

    # ---------------- voice + hands
    voices = db.voices(p.name)
    for key, label, unit, better, floor in (("speech_tempo", "Speech tempo", "syll/s", "higher", 0.15),
                                            ("silent_pause_ratio", "Time spent pausing", "share", "lower", 0.03)):
        for task, tlabel in (("reading", "read aloud"), ("free", "telling a story")):
            pts = [(x["ts"], float(x["metrics"][key])) for x in voices if x["task"] == task and x["metrics"].get(key) is not None]
            if pts:
                vars_.append(_var(f"voice_{key}_{task}", "speech_hands", f"{label} ({tlabel})", unit, "voice check", pts,
                                  better, floor, "game", practice=1, link="#/voice", word="recording",
                                  note="Compared only with your own earlier recordings of the same task."))
    hands = db.games(p.name, "hands")
    for side in ("right", "left"):
        rows = [r for r in hands if r["detail"].get("hand") == side]
        tap = [(r["ts"], float(r["detail"]["results"]["tap"]["rate_hz"])) for r in rows
               if r["detail"].get("results", {}).get("tap", {}).get("rate_hz")]
        trem = [(r["ts"], float(r["detail"]["results"]["steady"]["amplitude_mm"])) for r in rows
                if r["detail"].get("results", {}).get("steady", {}).get("amplitude_mm") is not None]
        if tap:
            vars_.append(_var(f"hand_tap_{side}", "speech_hands", f"Finger taps, {side} hand", "taps/s", "hand check", tap,
                              "higher", 0.3, "game", practice=1, link="#/hands", word="check"))
        if trem:
            vars_.append(_var(f"hand_tremor_{side}", "speech_hands", f"Hand shake at rest, {side} hand", "mm", "hand check",
                              trem, "lower", 1.0, "game", practice=1, link="#/hands", word="check"))

    # ---------------- hearing check-ins (activity, not a measurement)
    hear = [l for l in logs if l["quest"] == "hearing"]
    if hear:
        vars_.append({"id": "hearing_checkins", "group": "hearing", "label": "Sound Check days", "unit": "days",
                      "source": "check-ins", "status": "activity", "n": len(hear), "latest": len(hear),
                      "latest_date": hear[-1]["date"], "points": [],
                      "note": "Wearing hearing aids or getting screened. ACHIEVE found aids helped only higher-risk people."})

    # ---------------- MRI (own uploads only)
    mae = _mri_mae()
    all_mri = sorted(db.mris(p.name), key=lambda m: m["ts"])          # db returns newest first
    scans = [m for m in all_mri if m["format_ok"] and m["gap"] is not None and str(m["source"]).startswith("upload")]
    tried = sum(1 for m in all_mri if not str(m["source"]).startswith("upload"))
    if scans:
        pts = [(m["ts"][:10], float(m["gap"])) for m in scans]
        v = {"id": "mri_gap", "group": "brain_scan", "label": "Brain age minus real age", "unit": "years",
             "source": "MRI upload", "n": len(pts), "latest": pts[-1][1], "latest_date": pts[-1][0],
             "points": [{"date": d, "value": round(x, 2)} for d, x in pts], "error": round(mae, 1), "link": "#/mri",
             "note": f"Model error is about ±{mae:.1f} years, so small gaps mean nothing on their own.",
             "_spec": ("test", pts, "lower", mae, 0)}
        far = [x for d, x in pts if (date.fromisoformat(pts[-1][0]) - date.fromisoformat(d)).days >= 180]
        if far:
            ch = pts[-1][1] - far[0]
            v |= {"baseline": far[0], "recent": pts[-1][1], "change": ch, "threshold": mae,
                  "status": "improving" if ch < -mae else "slipping" if ch > mae else "steady"}
        else:
            v["status"] = "snapshot"
        vars_.append(v)
    elif tried:
        vars_.append({"id": "mri_gap", "group": "brain_scan", "label": "Brain age minus real age", "status": "none",
                      "n": 0, "points": [], "link": "#/mri",
                      "note": f"You tried {tried} sample scan{'s' if tried > 1 else ''}; those belong to OASIS volunteers, so they aren't counted here."})

    # ---------------- coverage, summary, links
    counted = [v for v in vars_ if v["status"] in ("improving", "steady", "slipping")]
    summary = {s: sum(1 for v in counted if v["status"] == s) for s in ("improving", "steady", "slipping")}
    summary["building"] = sum(1 for v in vars_ if v["status"] in ("building", "snapshot"))
    summary["stale"] = sum(1 for v in vars_ if v["status"] == "stale")
    groups = []
    for gid, title, sub in GROUPS:
        gv = [v for v in vars_ if v["group"] == gid]
        c = {s: sum(1 for v in gv if v["status"] == s) for s in ("improving", "steady", "slipping")}
        groups.append({"id": gid, "title": title, "sub": sub, "counts": c, "n": len(gv),
                       "has_data": any(v.get("n") for v in gv)})
    comb = combined(vars_)
    for v in vars_:
        v.pop("_spec", None)
    srcs = db.day_sources(p.name)
    return {"combined": comb, "sample_watch": bool(srcs) and all(x.startswith("Sample") for x in srcs), "groups": groups, "variables": vars_, "summary": summary, "coverage": _coverage(p, days, voices, hands, scans),
            "links": _links(series, p), "rules": RULES, "model": _model_card(wm)}


def _coverage(p, days, voices, hands, scans) -> list[dict]:
    plays = sum(len(db.games(p.name, g["id"])) for g in gym.GAMES if g["id"] != "speed") + len(db.rounds(p.name))
    last = max(days) if days else None
    srcs = sorted({k for v in days.values() for k in v})
    return [
        {"id": "watch", "label": "Watch / phone", "icon": "⌚", "ok": bool(days), "link": "#/data",
         "detail": f"{len(days)} days · last {last}" if days else "Not connected",
         "stale": bool(last) and (date.today() - date.fromisoformat(last)).days > STALE_DAYS, "fields": srcs},
        {"id": "games", "label": "Games", "icon": "🧩", "ok": plays > 0, "link": "#/gym", "detail": f"{plays} plays"},
        {"id": "checkins", "label": "Check-ins", "icon": "✅", "ok": bool(p.logs), "link": "#/play", "detail": f"{len(p.logs)} logged"},
        {"id": "voice", "label": "Voice", "icon": "🎙️", "ok": bool(voices), "link": "#/voice", "detail": f"{len(voices)} recordings"},
        {"id": "hands", "label": "Hand check", "icon": "✋", "ok": bool(hands), "link": "#/hands", "detail": f"{len(hands)} checks"},
        {"id": "hearing", "label": "Hearing", "icon": "👂", "ok": any("hearing_pta_db" in v or "headphone_db" in v for v in days.values()),
         "link": "#/data", "detail": "Hearing test / headphone levels" if any("hearing_pta_db" in v or "headphone_db" in v for v in days.values()) else "Via Apple Health"},
        {"id": "mri", "label": "MRI scan", "icon": "🩻", "ok": bool(scans), "link": "#/mri", "detail": f"{len(scans)} of your own" if scans else "None uploaded"},
    ]


def _links(series: dict, p) -> list[dict]:
    """Within-person patterns: game performance after good vs short sleep, and on active vs quiet days."""
    sleep, steps = series.get("sleep_hours", {}), series.get("steps", {})
    plays = []                                   # (date, z-score within that game AND format, higher = better)
    for g in gym.GAMES:
        rows = game_rows(p, g["id"])
        if not rows:
            continue
        _, pts, practice = pick_format(rows)
        pts = pts[practice:]
        if len(pts) < 4:
            continue
        vals = [v for _, v in pts]
        m, s = st.mean(vals), st.pstdev(vals) or 1.0
        plays += [(d[:10], (v - m) / s * (1 if g["better"] == "higher" else -1)) for d, v in pts]
    out = []
    for name, cond, src in (("sleep", lambda d: sleep.get(d), "the night before"),
                            ("steps", lambda d: steps.get(d), "that day")):
        good, bad = [], []
        cut = 7.0 if name == "sleep" else (st.median(steps.values()) if steps else None)
        if cut is None:
            continue
        for d, z in plays:
            x = cond(d)
            if x is None:
                continue
            (good if x >= cut else bad).append(z)
        if len(good) >= 3 and len(bad) >= 3:
            diff = st.mean(good) - st.mean(bad)
            what = f"7 h+ of sleep {src}" if name == "sleep" else f"{int(cut):,}+ steps {src}"
            size = "a lot" if abs(diff) >= 0.8 else "noticeably" if abs(diff) >= 0.5 else "a little" if abs(diff) >= 0.2 else None
            few = " Only a few plays so far, so take it lightly." if min(len(good), len(bad)) < 6 else ""
            out.append({"id": name, "n_good": len(good), "n_bad": len(bad), "diff_sd": round(diff, 2),
                        "text": (f"You did {size} {'better' if diff > 0 else 'worse'} in your games on days with {what} "
                                 f"({len(good)} plays) than on other days ({len(bad)} plays).{few}") if size else
                                f"Your game scores were about the same on days with and without {what}."})
    return out


def _research_note(f: str, v: float, wm: dict) -> str | None:
    if not wm:
        return None
    c = {x["label"]: x for x in wm.get("assoc_health", {}).get("contrasts", [])}
    if f == "steps":
        lo = c.get("2,000 → 4,000 steps/day")
        if lo and v < 4000:
            return (f"In NHANES (2,977 adults 60+ wearing a wrist tracker), going from 2,000 to 4,000 steps a day went with "
                    f"{lo['points']:+.1f} points on the speed test (DSST), after adjusting for health. That's an association, not proof.")
        return "In NHANES, above about 4,000 steps a day, speed-test scores didn't differ by step count. Keep it up for heart and mood."
    if f == "sleep_sd":
        r = c.get("Irregular sleep (SD 2 h) → regular (SD 0.75 h)")
        if r:
            return (f"In NHANES, a regular sleep schedule (spread 0.75 h vs 2 h) went with {r['points']:+.1f} DSST points after "
                    f"adjusting for health. An association, not proof.")
    if f == "resting_hr":
        return "In NHANES, resting pulse wasn't linked to thinking scores once age and health were accounted for."
    return None


def _model_card(wm: dict) -> dict | None:
    if not wm:
        return None
    pr = wm["prediction"]["dsst"]
    return {"n": wm["n_with_watch"], "r2_demo": round(pr["r2_demographics"], 3), "r2_watch": round(pr["r2_with_watch"], 3),
            "sources": wm["sources"],
            "text": (f"Trained on {wm['n_with_watch']:,} NHANES adults 60+ who wore a wrist tracker for a week and took the "
                     f"same thinking tests as our games. Watch numbers added {pr['delta_r2']['mean'] * 100:.0f}% of explained "
                     f"variance on top of age, sex and education ({pr['r2_demographics']:.2f} → {pr['r2_with_watch']:.2f}). "
                     f"Small: a watch can't tell how well someone thinks, but it can show habits that go with it.")}


RULES = [
    "Each measure is compared with your own starting point, not with a made-up score.",
    "Early plays of each game don't count: everyone improves at first just from learning the game.",
    "A change only counts if it's bigger than your normal day-to-day ups and downs.",
    "Your watch wins over a typed check-in for the same day, so nothing is counted twice.",
    "Sample MRI scans belong to research volunteers and are never counted as yours.",
    "Patterns between sources (sleep vs games) are clues in your own data, not proof.",
]


# ====================================================================== the combined picture
AREA_NAMES = {"movement": "Moving", "sleep_heart": "Sleep & heart", "thinking": "Thinking games",
              "speech_hands": "Speech & hands", "hearing": "Hearing", "brain_scan": "Brain scan"}
CARRY_WEEKS = 6        # a measure keeps counting for this long after its last reading


def _week(d: str) -> date:
    x = date.fromisoformat(d[:10])
    return x - timedelta(days=x.weekday())


def _personal_scores(spec) -> list[tuple[str, float]] | None:
    """Each reading as 'how far from YOUR starting point', in units of your own normal wobble,
    flipped so up = better. This is what lets steps, game scores and sleep share one line.
    None until the measure has a starting point AND at least one reading after it."""
    kind, pts, better, floor, practice = spec
    if kind == "daily":
        first = date.fromisoformat(pts[0][0][:10])
        base = [(d, v) for d, v in pts if date.fromisoformat(d[:10]) < first + timedelta(days=DAY_BASE)]
        if len(base) < DAY_MIN or len(base) == len(pts):
            return None
    elif kind == "test":
        if len(pts) < 2:
            return None
        base = pts[:1]
    else:
        pts = pts[practice:]
        if len(pts) < 4:
            return None
        base = pts[:3]
    tb = [_score_for(better, v) for _, v in base]
    b = st.median(tb)
    scale = floor if kind == "test" else max(st.pstdev(tb), floor, 0.05 * abs(b), 1e-6)
    return [(d, max(-3.0, min(3.0, (_score_for(better, v) - b) / scale))) for d, v in pts]


def combined(vars_: list[dict], today: date | None = None) -> dict:
    """One line for everything: per week, each measure's distance from your start → averaged within its
    area → areas averaged equally (so 9 games can't outvote your watch). 0 = where you started."""
    today = today or date.today()
    scored, collecting = {}, []
    for v in vars_:
        spec = v.get("_spec")
        sc = _personal_scores(spec) if spec else None
        if sc:
            scored[v["id"]] = (v, sc)
        elif v.get("n"):
            collecting.append(v["label"])
    if not scored:
        return {"weeks": [], "overall": None, "areas": [], "changes": [], "collecting": collecting, "n_measures": 0}
    start = min(_week(sc[0][0]) for _, sc in scored.values())
    weeks = []
    w = start
    while w <= _week(today.isoformat()):
        weeks.append(w)
        w += timedelta(days=7)
    by_var_week = {}
    for vid, (_, sc) in scored.items():
        wk = {}
        for d, x in sc:
            wk.setdefault(_week(d), []).append(x)
        by_var_week[vid] = {k: sum(x) / len(x) for k, x in wk.items()}
    series, latest_var = [], {}
    for w in weeks:
        areas = {}
        for vid, (v, _) in scored.items():
            known = [k for k in by_var_week[vid] if k <= w and (w - k).days <= 7 * CARRY_WEEKS]
            if known:
                val = by_var_week[vid][max(known)]
                areas.setdefault(v["group"], []).append(val)
                latest_var[vid] = val
            else:
                latest_var.pop(vid, None)
        a = {g: sum(x) / len(x) for g, x in areas.items()}
        series.append({"week": w.isoformat(), "overall": round(sum(a.values()) / len(a), 3) if a else None,
                       "areas": {g: round(x, 3) for g, x in a.items()}})
    while series and series[0]["overall"] is None:
        series.pop(0)
    last = next((s for s in reversed(series) if s["overall"] is not None), None)
    areas = [{"id": g, "name": AREA_NAMES[g], "value": last["areas"][g], "word": _word(last["areas"][g]),
              "n": sum(1 for v, _ in scored.values() if v["group"] == g)} for g in AREA_NAMES if last and g in last["areas"]]
    changes = sorted(({"id": vid, "label": scored[vid][0]["label"], "icon": scored[vid][0].get("icon", ""),
                       "value": round(x, 2), "unit": scored[vid][0].get("unit"),
                       "from": scored[vid][0].get("baseline"), "to": scored[vid][0].get("recent", scored[vid][0].get("latest"))}
                      for vid, x in latest_var.items()), key=lambda c: -abs(c["value"]))
    # only changes that pass the "bigger than your normal ups and downs" rule are listed
    status = {vid: v["status"] for vid, (v, _) in scored.items()}
    return {"weeks": series, "overall": last["overall"] if last else None, "word": _word(last["overall"]) if last else None,
            "areas": areas, "gains": [c for c in changes if status[c["id"]] == "improving" and c["value"] > 0][:3],
            "drops": [c for c in changes if status[c["id"]] == "slipping" and c["value"] < 0][:3],
            "collecting": collecting, "n_measures": len(scored), "sources": _sources(scored)}


def _sources(scored) -> str:
    names = {"watch": "your watch", "watch + check-ins": "your watch", "check-ins": "your check-ins", "game": "games",
             "voice check": "voice checks", "hand check": "hand checks", "MRI upload": "your MRI scans"}
    got = list(dict.fromkeys(names.get(v["source"], v["source"]) for v, _ in scored.values()))
    return got[0] if len(got) == 1 else ", ".join(got[:-1]) + " and " + got[-1]


def _word(x: float) -> str:
    return ("much better" if x >= 1 else "better" if x >= 0.4 else "a little better" if x >= 0.15 else
            "about the same" if x > -0.15 else "a little lower" if x > -0.4 else "lower" if x > -1 else "much lower")
