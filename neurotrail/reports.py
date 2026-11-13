"""
Doctor reports that a clinic can verify.

Flow:  build (server-side, from the database: the browser can't inject numbers)
   →   the person approves it with their passkey (WebAuthn assertion whose challenge is the SHA-256 of the report)
   →   NeuroTrail signs {report + approval} with its Report Signing certificate (see signing.py)
   →   a QR code points to /verify/<id>, where the signature is checked in the browser.
Reports expire after 90 days and can be revoked at any time (the verify page then says so).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import secrets
from statistics import mean

from . import db, insights, signing
from .games import GAMES, GAME_BY_ID
from .state import Player

VALID_DAYS = 90


def _schema() -> None:
    with db.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, player TEXT NOT NULL, issued TEXT NOT NULL,
                     expires TEXT NOT NULL, payload_json TEXT NOT NULL, sig_der TEXT NOT NULL, sig_raw TEXT NOT NULL,
                     digest TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)""")


def _r(x, d=1):
    return None if x is None else round(float(x), d)


def _game_rows(name: str) -> list[dict]:
    out = []
    for g in GAMES:
        if g["id"] == "speed":
            scores = [float(r["correct"]) for r in db.rounds(name)]
        else:
            scores = [float(r["score"]) for r in db.games(name, g["id"])]
        if not scores:
            continue
        best = (max if g["better"] == "higher" else min)(scores)
        out.append({"game": g["title"], "unit": g["unit"], "plays": len(scores), "first": _r(scores[0]), "best": _r(best), "latest": _r(scores[-1])})
    return out


def build(p: Player, has_passkey: bool) -> dict:
    """Everything on the report, computed from the database for the last 30 days."""
    today = dt.date.today()
    start = (today - dt.timedelta(days=29)).isoformat()
    L = [l for l in p.logs if l["date"] >= start]
    vals = lambda q: [float(l["value"]) for l in L if l["quest"] == q and l["value"] is not None]
    bp = [[l["date"], round(float(l["value"])), (l.get("readings") or [[None, None]])[0][1]] for l in L if l["quest"] == "bp" and l["value"] is not None]
    bp_avg, sleep_avg, steps_avg = (mean(x) if x else None for x in (vals("bp"), vals("sleep"), vals("steps")))
    ins = insights.personal_insights(p.name)
    patterns = [{"finding": i["headline"], "level": i["level"], "days": [i["n_yes"], i["n_no"]]}
                for i in ins.get("insights", []) if i["level"] in ("clear", "hint")] if ins.get("ready") else []
    asks = []
    if bp_avg is not None and bp_avg >= 130:
        asks.append(f"My home blood pressure averages about {round(bp_avg)}. What should my target be?")
    if bp_avg is None and p.sbp is None:
        asks.append("I don't know my blood pressure. Can we check it?")
    if p.hearing_trouble:
        asks.append("I have trouble hearing. Should I have a hearing test?")
    if (p.phq9 or 0) >= 10:
        asks.append(f"My mood questionnaire (PHQ-8) score was {p.phq9}. Can we talk about it?")
    if p.diabetes:
        asks.append("Is my blood sugar (HbA1c) on target?")
    if p.current_smoker:
        asks.append("What support is there to help me quit smoking?")
    if sleep_avg is not None and sleep_avg < 6:
        asks.append(f"I've been sleeping about {sleep_avg:.1f} hours. Could anything help?")
    self_rep = [t for t, on in (("Diabetes", p.diabetes), ("Current smoker", p.current_smoker),
                                ("Trouble hearing", p.hearing_trouble), ("Recently felt down", p.feel_down)) if on]
    return {
        "type": "neurotrail.doctor_report", "version": 1,
        "period": [start, today.isoformat()],
        "subject": {"label": "NeuroTrail user", "age": p.age, "sex": "Female" if p.female else "Male",
                    "account": hashlib.sha256(p.name.encode()).hexdigest()[:12], "passkey_account": has_passkey},
        "glance": {"bp_avg": _r(bp_avg, 0), "bp_readings": len(bp), "phq8": p.phq9, "sleep_avg_h": _r(sleep_avg), "steps_avg": _r(steps_avg, 0)},
        "bp_readings": bp[-10:], "games": _game_rows(p.name), "patterns": patterns, "questions": asks, "self_reported": self_rep,
        "note": "Self-reported and home-measured data. Not a diagnosis or a dementia risk score. "
                "Thinking-game results are compared only with the person's own earlier scores.",
    }


def stamp(payload: dict) -> dict:
    """Give a draft its identity: id, issue time, expiry. This is what the passkey approves."""
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    return {**payload, "report_id": secrets.token_urlsafe(12),
            "issued_at": now.isoformat(), "expires_at": (now + dt.timedelta(days=VALID_DAYS)).isoformat()}


def approval_challenge(stamped: dict) -> bytes:
    return hashlib.sha256(signing.canonical(stamped).encode()).digest()


def seal(player: str, stamped: dict, approval: dict | None) -> dict:
    """NeuroTrail's signature over the report and the person's passkey approval."""
    _schema()
    envelope = {"report": stamped, "patient_approval": approval}
    s = signing.sign(envelope)
    with db.conn() as c:
        c.execute("INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,0)", (stamped["report_id"], player, stamped["issued_at"], stamped["expires_at"],
                                                                     s["payload_json"], s["sig_der"], s["sig_raw"], s["digest"]))
    return {"id": stamped["report_id"], "digest": s["digest"]}


def get(rid: str) -> dict | None:
    _schema()
    with db.conn() as c:
        row = c.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone()
    return dict(row) if row else None


def mine(player: str) -> list[dict]:
    _schema()
    with db.conn() as c:
        rows = c.execute("SELECT id, issued, expires, revoked FROM reports WHERE player=? ORDER BY issued DESC", (player,)).fetchall()
    return [dict(r) for r in rows]


def revoke(player: str, rid: str) -> bool:
    _schema()
    with db.conn() as c:
        n = c.execute("UPDATE reports SET revoked=1 WHERE id=? AND player=?", (rid, player)).rowcount
    return n == 1


def public_view(rid: str) -> dict | None:
    """What a clinic sees: the signed bytes, both signature formats, the certificate chain and the status."""
    row = get(rid)
    if row is None:
        return None
    expired = dt.datetime.fromisoformat(row["expires"]) < dt.datetime.now(dt.timezone.utc)
    return {"id": rid, "payload_json": row["payload_json"], "sig_der": row["sig_der"], "sig_raw": row["sig_raw"], "digest": row["digest"],
            "server_check": signing.verify(row["payload_json"], row["sig_der"]), "revoked": bool(row["revoked"]), "expired": expired,
            "chain": signing.chain(), "game_units": {g["title"]: g["unit"] for g in GAME_BY_ID.values() if "unit" in g}}
