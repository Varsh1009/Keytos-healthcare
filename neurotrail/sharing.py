"""
Family sharing with real consent.

Research gap this addresses: most caregivers already hold their parent's passwords, and once
monitoring starts it is almost never revisited ("consent stasis", Future of Privacy Forum 2026).
So here:
  * the person chooses exactly what is shared (scopes), and can see it at any time;
  * every share expires (7–90 days) and can be renewed or stopped in one tap;
  * the caregiver opens it with THEIR OWN passkey (no shared logins), and the invite link is single-use;
  * every visit is logged and shown to the person ("Seen by Daughter, 2 hours ago").
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import secrets
from statistics import mean

from . import db, insights
from .games import GAMES

SCOPES = {  # key: (label, default on)
    "activity": ("Daily sessions and streak", True),     # always included
    "bp": ("Blood pressure readings", True),
    "games": ("Thinking-game trends", True),
    "insights": ("Personal patterns", True),
    "mood": ("Mood check score", False),
}
MAX_DAYS = 90
_now = lambda: dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
_h = lambda t: hashlib.sha256(t.encode()).hexdigest()


def _schema() -> None:
    with db.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, owner TEXT NOT NULL, label TEXT NOT NULL,
                     owner_label TEXT NOT NULL, scopes TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
                     invite_hash TEXT, viewer TEXT, viewer_passkey INTEGER NOT NULL DEFAULT 0, accepted TEXT,
                     revoked INTEGER NOT NULL DEFAULT 0)""")
        c.execute("""CREATE TABLE IF NOT EXISTS share_views (id INTEGER PRIMARY KEY AUTOINCREMENT, share_id TEXT NOT NULL,
                     viewer TEXT NOT NULL, at TEXT NOT NULL)""")


def _row(r) -> dict:
    d = dict(r)
    d["scopes"] = json.loads(d["scopes"])
    d["revoked"] = bool(d["revoked"])
    d["viewer_passkey"] = bool(d["viewer_passkey"])
    d["expired"] = dt.datetime.fromisoformat(d["expires"]) < _now()
    d["status"] = "stopped" if d["revoked"] else "expired" if d["expired"] else "active" if d["viewer"] else "pending"
    d.pop("invite_hash", None)
    return d


def _clean_scopes(scopes: list[str]) -> list[str]:
    return ["activity"] + [s for s in dict.fromkeys(scopes) if s in SCOPES and s != "activity"]


def create(owner: str, label: str, owner_label: str, scopes: list[str], days: int) -> tuple[dict, str]:
    _schema()
    days = max(1, min(MAX_DAYS, int(days)))
    sid, token, now = secrets.token_urlsafe(9), secrets.token_urlsafe(18), _now()
    with db.conn() as c:
        c.execute("INSERT INTO shares (id, owner, label, owner_label, scopes, created, expires, invite_hash) VALUES (?,?,?,?,?,?,?,?)",
                  (sid, owner, label.strip()[:40] or "Family", owner_label.strip()[:40] or "Your family member",
                   json.dumps(_clean_scopes(scopes)), now.isoformat(), (now + dt.timedelta(days=days)).isoformat(), _h(token)))
    return get(sid), token


def get(sid: str) -> dict | None:
    _schema()
    with db.conn() as c:
        r = c.execute("SELECT * FROM shares WHERE id=?", (sid,)).fetchone()
    return _row(r) if r else None


def invite_info(token: str) -> dict | None:
    """Public preview of an invite (before the caregiver signs in): who, what, until when."""
    _schema()
    with db.conn() as c:
        r = c.execute("SELECT * FROM shares WHERE invite_hash=?", (_h(token),)).fetchone()
    if r is None:
        return None
    s = _row(r)
    return {"owner_label": s["owner_label"], "label": s["label"], "scopes": [SCOPES[k][0] for k in s["scopes"]],
            "expires": s["expires"], "status": s["status"]}


def accept(token: str, viewer: str, viewer_has_passkey: bool, allow_without_passkey: bool = False) -> dict:
    _schema()
    with db.conn() as c:
        r = c.execute("SELECT * FROM shares WHERE invite_hash=?", (_h(token),)).fetchone()
    if r is None:
        raise ValueError("This invite link isn't valid or was already used.")
    s = _row(r)
    if s["status"] != "pending":
        raise ValueError(f"This invite is {s['status']}.")
    if s["owner"] == viewer:
        raise ValueError("You can't accept your own invite. Send the link to the person you're sharing with.")
    if not (viewer_has_passkey or allow_without_passkey):
        raise PermissionError("Save a passkey first: shared health data opens only with your own passkey.")
    with db.conn() as c:   # single use: the invite hash is cleared on accept
        c.execute("UPDATE shares SET viewer=?, viewer_passkey=?, accepted=?, invite_hash=NULL WHERE id=?",
                  (viewer, int(viewer_has_passkey), _now().isoformat(), s["id"]))
    return get(s["id"])


def owned(owner: str) -> list[dict]:
    _schema()
    with db.conn() as c:
        rows = c.execute("SELECT * FROM shares WHERE owner=? ORDER BY created DESC", (owner,)).fetchall()
        out = []
        for r in rows:
            s = _row(r)
            v = c.execute("SELECT COUNT(*) n, MAX(at) last FROM share_views WHERE share_id=?", (s["id"],)).fetchone()
            s["views"], s["last_view"] = v["n"], v["last"]
            s.pop("viewer", None)                 # the person sees the label they chose, not the account id
            out.append(s)
    return out


def viewing(viewer: str) -> list[dict]:
    _schema()
    with db.conn() as c:
        rows = c.execute("SELECT * FROM shares WHERE viewer=? ORDER BY accepted DESC", (viewer,)).fetchall()
    return [{k: v for k, v in _row(r).items() if k not in ("owner", "viewer")} for r in rows]


def _owned_row(owner: str, sid: str) -> dict:
    s = get(sid)
    if s is None or s["owner"] != owner:
        raise KeyError(sid)
    return s


def revoke(owner: str, sid: str) -> None:
    _owned_row(owner, sid)
    with db.conn() as c:
        c.execute("UPDATE shares SET revoked=1, invite_hash=NULL WHERE id=?", (sid,))


def renew(owner: str, sid: str, days: int) -> dict:
    s = _owned_row(owner, sid)
    if s["revoked"]:
        raise ValueError("This share was stopped. Send a new invite instead.")
    days = max(1, min(MAX_DAYS, int(days)))
    with db.conn() as c:
        c.execute("UPDATE shares SET expires=? WHERE id=?", ((_now() + dt.timedelta(days=days)).isoformat(), sid))
    return get(sid)


def log(owner: str, sid: str) -> list[dict]:
    s = _owned_row(owner, sid)
    with db.conn() as c:
        rows = c.execute("SELECT at FROM share_views WHERE share_id=? ORDER BY id DESC LIMIT 50", (sid,)).fetchall()
    return [{"at": r["at"], "who": s["label"]} for r in rows]


def view(viewer: str, sid: str) -> dict:
    """The caregiver's view: only the scopes the person chose. Every call is logged for the person to see."""
    s = get(sid)
    if s is None or s.get("viewer") != viewer:
        raise KeyError(sid)
    if s["status"] != "active":
        raise PermissionError(f"This share is {s['status']}.")
    with db.conn() as c:
        c.execute("INSERT INTO share_views (share_id, viewer, at) VALUES (?,?,?)", (sid, viewer, _now().isoformat()))
    owner, today = s["owner"], dt.date.today()
    span = [(today - dt.timedelta(days=13 - i)).isoformat() for i in range(14)]
    logs = db.logs(owner)
    rounds = db.rounds(owner)
    active = {l["date"] for l in logs} | {r["date"] for r in rounds} | {g["date"] for g in db.games(owner)}
    last = max(active) if active else None
    streak, d = 0, today
    while d.isoformat() in active:
        streak, d = streak + 1, d - dt.timedelta(days=1)
    out = {"id": sid, "owner_label": s["owner_label"], "label": s["label"], "expires": s["expires"], "scopes": s["scopes"],
           "activity": {"last_active": last, "days_since": (today - dt.date.fromisoformat(last)).days if last else None,
                        "streak": streak, "days": [{"date": x, "active": x in active} for x in span],
                        "active_14": sum(x in active for x in span)}}
    if "bp" in s["scopes"]:
        bp = [{"date": l["date"], "sys": round(l["value"]), "dia": (l.get("readings") or [[None, None]])[0][1]}
              for l in logs if l["quest"] == "bp" and l["value"] is not None and l["date"] >= span[0]]
        out["bp"] = {"readings": bp[-10:], "avg": round(mean(b["sys"] for b in bp)) if bp else None}
    if "games" in s["scopes"]:
        rows = []
        for g in GAMES:
            sc = [float(r["correct"]) for r in rounds] if g["id"] == "speed" else [float(x["score"]) for x in db.games(owner, g["id"])]
            if sc:
                rows.append({"game": g["title"], "unit": g["unit"], "plays": len(sc), "first": sc[0], "latest": sc[-1],
                             "better": g["better"]})
        out["games"] = rows
    if "mood" in s["scopes"]:
        p = db.get_player(owner)
        out["mood"] = {"phq8": (p or {}).get("profile", {}).get("phq9")}
    if "insights" in s["scopes"]:
        ins = insights.personal_insights(owner)
        out["insights"] = [{"finding": i["headline"], "level": i["level"]} for i in ins.get("insights", [])
                           if i["level"] in ("clear", "hint")] if ins.get("ready") else []
    return out
