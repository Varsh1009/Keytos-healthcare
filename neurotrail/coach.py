"""
NeuroCoach: an AI agent (Claude + tool use) grounded in the player's real data.

The agent never guesses numbers. It has five tools, all backed by this project's
own data and models:
  get_profile_and_levers  - the NHANES lever model on the player's current values
  get_recent_activity     - quest logs, BP/steps/sleep values, speed rounds (SQLite)
  get_quest_evidence      - steps + verified evidence + NHANES association per quest
  simulate_change         - re-runs the lever model with hypothetical values
  save_weekly_plan        - writes a plan to the database (shown on the Coach page)

If no Anthropic credentials are available the "offline coach" runs the same tools
with fixed rules and says so. The answer's `source` field tells the UI which ran.
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta

from . import db, scoring
from .quests import QUEST_BY_ID, QUESTS
from .state import Player

log = logging.getLogger(__name__)
MODEL = "claude-opus-5-5"

SYSTEM = """You are the NeuroTrail assistant, a friendly brain-health habit coach for adults.
Ground every number you mention in a tool result from this conversation; never invent statistics,
risks or diagnoses. Call tools before answering questions about the player's data, progress or plan.

What the data can and cannot say:
- "What matters most for you" comes from a cross-sectional NHANES association model (DSST processing-speed
  test points, adults 60-80). Present it as an association in test points. Never say "brain age" or "years older".
- Quest evidence comes from get_quest_evidence; cite the trial or study it names.
- You are not a clinician. For medication, diagnoses or very high readings (e.g. BP >= 180), tell the player
  to contact a clinician. If the player mentions self-harm, hopelessness or feeling down, or their profile shows support=true,
  give the US 988 Suicide & Crisis Lifeline (call or text 988) first, before anything else.

Style: warm, direct, concise (under 160 words unless asked for a plan). Give concrete next actions that map
to NeuroTrail habits by name (Check your blood pressure, Take a walk, Talk with someone,
Look after your hearing, Do something you enjoy, Smoke-free day, Sleep on a schedule, Know your numbers, Mood check). When you build a weekly plan, save it with save_weekly_plan."""

TOOLS = [
    {"name": "get_profile_and_levers",
     "description": "Get the player's current profile values and 'what matters most': for each modifiable factor, "
                    "how many DSST test points lower people scored in NHANES at the player's value vs the healthy target, "
                    "with 95% ranges, size label and significance. Unknown values are marked known=false.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_recent_activity",
     "description": "Get the player's completed quests, logged values (blood pressure, steps, sleep, mood change) "
                    "and Speed Sprint rounds for the last N days, plus streak and sparks.",
     "input_schema": {"type": "object", "properties": {"days": {"type": "integer", "minimum": 1, "maximum": 60}},
                      "required": ["days"], "additionalProperties": False}},
    {"name": "get_quest_evidence",
     "description": "Get a quest's action steps, its verified evidence (trial results with sources) and its "
                    "association in our NHANES model. Quest ids: " + ", ".join(q.id for q in QUESTS) + ".",
     "input_schema": {"type": "object", "properties": {"quest_id": {"type": "string", "enum": [q.id for q in QUESTS]}},
                      "required": ["quest_id"], "additionalProperties": False}},
    {"name": "simulate_change",
     "description": "Re-run the NHANES lever model with hypothetical values to show how the association would change. "
                    "Any field left out keeps the player's current value.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {
         "sbp": {"type": "number"}, "active_min_week": {"type": "number"}, "sleep_hours": {"type": "number"},
         "phq9": {"type": "number"}, "sedentary_min_day": {"type": "number"},
         "current_smoker": {"type": "boolean"}, "diabetes": {"type": "boolean"}}}},
    {"name": "save_weekly_plan",
     "description": "Save a 7-day plan for the player. Each item names a day, a NeuroTrail quest id and the concrete action.",
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["title", "items"], "properties": {
         "title": {"type": "string"},
         "items": {"type": "array", "minItems": 1, "maxItems": 21, "items": {
             "type": "object", "additionalProperties": False, "required": ["day", "quest_id", "action"],
             "properties": {"day": {"type": "string"},
                            "quest_id": {"type": "string", "enum": [q.id for q in QUESTS]},
                            "action": {"type": "string"}}}}}}},
]


# ------------------------------------------------------------------ tool implementations
def _levers(p: Player) -> dict:
    r = scoring.lever_age(p.profile())
    return {"profile": p.profile(), "total_points": round(r["points"], 2), "ci": [round(x, 2) for x in r["ci"]],
            "rule": r["rule"], "model_n": r["n"],
            "factors": [{"factor": f["label"], "you": None if f["value"] is None else round(f["value"], 1), "target": f["target"],
                         "points": None if f["points"] is None else round(f["points"], 2),
                         "range": None if f["ci"] is None else [round(x, 2) for x in f["ci"]],
                         "size": f["size"], "significant": f["significant"], "known": f["known"]} for f in r["per_factor"].values()]}


def _activity(p: Player, days: int) -> dict:
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    L = [l for l in p.logs if l["date"] >= since]
    return {"days": days, "streak": p.streak(), "sparks_total": p.sparks,
            "quests_completed": [{"date": l["date"], "quest": QUEST_BY_ID[l["quest"]].title,
                                  "value": l.get("value")} for l in L],
            "blood_pressure_systolic": [{"date": l["date"], "avg": l["value"]} for l in L if l["quest"] == "bp"],
            "steps": [{"date": l["date"], "steps": l["value"]} for l in L if l["quest"] == "steps"],
            "sleep_hours": [{"date": l["date"], "hours": l["value"]} for l in L if l["quest"] == "sleep"],
            "speed_rounds": [r for r in db.rounds(p.name) if r["date"] >= since],
            "today_open_quests": [QUEST_BY_ID[k].title for k, s in p.trail_status().items() if s != "done"]}


def _evidence(qid: str) -> dict:
    q = QUEST_BY_ID[qid]
    a = {c["column"]: c for c in scoring.associations()["contrasts"]}
    nh = a.get(q.nhanes_key) if q.nhanes_key else None
    return {"quest": q.title, "steps": q.steps, "tier": q.tier, "lancet_paf_pct": q.lancet_paf,
            "evidence": q.evidence, "caveat": q.caveat,
            "nhanes_association": None if nh is None else {
                "change": nh["label"], "dsst_points": round(nh["dsst_points"], 2),
                "ci": [round(x, 2) for x in nh["dsst_ci"]],
                "p_value": nh["p_value"]}}


def _simulate(p: Player, changes: dict) -> dict:
    prof = {**p.profile(), **{k: v for k, v in changes.items() if v is not None}}
    now, new = scoring.lever_age(p.profile()), scoring.lever_age(prof)
    return {"current_points": round(now["points"], 2), "simulated_points": round(new["points"], 2),
            "difference": round(new["points"] - now["points"], 2), "simulated_range": [round(x, 2) for x in new["ci"]],
            "note": "Cross-sectional association from NHANES, not a guaranteed effect."}


def run_tool(p: Player, name: str, args: dict) -> dict:
    if name == "get_profile_and_levers":
        return _levers(p)
    if name == "get_recent_activity":
        return _activity(p, int(args.get("days", 7)))
    if name == "get_quest_evidence":
        return _evidence(args["quest_id"])
    if name == "simulate_change":
        return _simulate(p, args)
    if name == "save_weekly_plan":
        db.save_plan(p.name, args["title"], args["items"], "claude")
        return {"saved": True, "items": len(args["items"])}
    raise ValueError(f"unknown tool {name}")


TOOL_LABELS = {"get_profile_and_levers": "Ran your lever model", "get_recent_activity": "Read your activity log",
               "get_quest_evidence": "Checked the evidence", "simulate_change": "Simulated a change",
               "save_weekly_plan": "Saved your weekly plan"}


# ------------------------------------------------------------------ Claude agent loop
def _claude(p: Player, user_text: str) -> dict:
    import anthropic

    client = anthropic.Anthropic()
    history = []
    for m in db.messages(p.name, 12):
        if m["role"] in ("user", "assistant") and m["content"]:
            history.append({"role": m["role"], "content": m["content"]})
    while history and history[0]["role"] != "user":
        history.pop(0)
    msgs = history + [{"role": "user", "content": user_text}]
    trace = []
    for _ in range(8):
        resp = client.beta.messages.create(
            model=MODEL, max_tokens=4000, system=SYSTEM, tools=TOOLS, messages=msgs,
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"},
        )
        if resp.stop_reason == "refusal":
            return {"text": "I can't help with that one. Try asking about your quests, levers or plan.",
                    "tools": trace, "source": "claude"}
        msgs.append({"role": "assistant", "content": resp.content})
        uses = [b for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason != "tool_use" or not uses:
            text = "\n".join(b.text for b in resp.content if b.type == "text").strip()
            return {"text": text, "tools": trace, "source": "claude"}
        results = []
        for u in uses:
            try:
                out = run_tool(p, u.name, dict(u.input))
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": json.dumps(out)})
                trace.append({"tool": u.name, "label": TOOL_LABELS[u.name], "input": dict(u.input)})
            except Exception as e:  # noqa: BLE001 - report tool failures back to the model
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": str(e), "is_error": True})
        msgs.append({"role": "user", "content": results})
    return {"text": "I ran out of steps on that one. Ask me again more specifically?", "tools": trace,
            "source": "claude"}


# ------------------------------------------------------------------ offline coach (no API)
def _offline(p: Player, user_text: str) -> dict:
    """Deterministic fallback: same tools, fixed rules. Clearly labeled in the UI."""
    lev, act = _levers(p), _activity(p, 7)
    trace = [{"tool": "get_profile_and_levers", "label": TOOL_LABELS["get_profile_and_levers"], "input": {}},
             {"tool": "get_recent_activity", "label": TOOL_LABELS["get_recent_activity"], "input": {"days": 7}}]
    sig = [f for f in lev["factors"] if f["significant"] and f["known"] and (f["points"] or 0) > 0.1]
    lines = ["Here's what matters most for you, from a CDC study of 2,597 adults aged 60+ (an association, not a diagnosis)."]
    qmap = {"Blood pressure": "bp", "Mood (PHQ-8)": "joy", "Sleep (outside 6-8 h)": "sleep",
            "Smoking": "smoke", "Diabetes": "labs"}
    plan = []
    if sig:
        top = sig[0]
        qid = qmap.get(top["factor"], "steps")
        ev = _evidence(qid)
        trace.append({"tool": "get_quest_evidence", "label": TOOL_LABELS["get_quest_evidence"], "input": {"quest_id": qid}})
        lines.append(f"Biggest one: {top['factor']} (people at your value scored about {top['points']:.1f} points lower on a speed test). Habit for it: {ev['quest']}. "
                     f"Evidence: {ev['evidence'][0]['claim']}")
    if act["today_open_quests"]:
        lines.append("Still open today: " + ", ".join(act["today_open_quests"][:4]) + ".")
    if act["streak"]:
        lines.append(f"Streak: {act['streak']} day(s). One quest today keeps it alive.")
    if "plan" in user_text.lower():
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        order = ([qmap.get(f["factor"], "steps") for f in sig] + ["speed", "steps", "connect", "joy"])[:4]
        for i, d in enumerate(days):
            qid = order[i % len(order)]
            plan.append({"day": d, "quest_id": qid, "action": QUEST_BY_ID[qid].steps[0]})
        db.save_plan(p.name, "Your week (offline coach)", plan, "offline")
        trace.append({"tool": "save_weekly_plan", "label": TOOL_LABELS["save_weekly_plan"], "input": {}})
        lines.append("I saved a 7-day plan below, built around your biggest levers.")
    return {"text": "\n\n".join(lines), "tools": trace, "source": "offline"}


def status() -> dict:
    """Is the Claude agent usable? (Builds a client; never reads or returns the key.)"""
    try:
        import anthropic
        c = anthropic.Anthropic()
        configured = bool(getattr(c, "api_key", None) or getattr(c, "auth_token", None))
        return {"claude": configured, "model": MODEL}
    except Exception as e:  # noqa: BLE001
        return {"claude": False, "model": MODEL, "reason": type(e).__name__}


def ask(p: Player, user_text: str) -> dict:
    db.add_message(p.name, "user", user_text)
    try:
        out = _claude(p, user_text)
    except Exception as e:  # noqa: BLE001 - no credentials / network: use offline coach
        log.warning("Claude coach unavailable (%s); using offline coach", type(e).__name__)
        out = _offline(p, user_text)
        out["note"] = ("Claude isn't connected (no Anthropic credentials found), so the offline coach answered. "
                       "Set ANTHROPIC_API_KEY and restart the server to enable the Claude agent.")
    db.add_message(p.name, "assistant", out["text"], out["tools"], out["source"])
    return out
