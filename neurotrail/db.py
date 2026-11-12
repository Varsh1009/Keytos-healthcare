"""
SQLite storage for NeuroTrail. One local file: data/neurotrail.db.

Tables
  players        profile + onboarding answers
  quest_logs     one row per completed quest (value + extra JSON)
  step_progress  checklist ticks per player/day/quest/step
  speed_rounds   every Speed Sprint round
  coach_messages AI coach conversation, including the tools it called
  plans          weekly plans the coach agent saved
  game_results   every Brain Gym game played
  mri_results    MRI brain-age analyses (scan files are never stored)
  voice_results  voice-check speech measures (audio is never stored)
  wearable_days  daily steps / sleep / heart data imported from a phone or watch
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from threading import Lock

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "neurotrail.db"
_lock = Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
  name TEXT PRIMARY KEY, profile TEXT NOT NULL, onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quest_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, date TEXT NOT NULL,
  quest TEXT NOT NULL, value REAL, sparks INTEGER NOT NULL, ts TEXT NOT NULL, extra TEXT,
  FOREIGN KEY(player) REFERENCES players(name));
CREATE INDEX IF NOT EXISTS ix_logs ON quest_logs(player, date);
CREATE TABLE IF NOT EXISTS step_progress (
  player TEXT NOT NULL, date TEXT NOT NULL, quest TEXT NOT NULL, idx INTEGER NOT NULL,
  done INTEGER NOT NULL, PRIMARY KEY(player, date, quest, idx));
CREATE TABLE IF NOT EXISTS speed_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, date TEXT NOT NULL,
  correct INTEGER NOT NULL, wrong INTEGER NOT NULL, best_combo INTEGER NOT NULL, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coach_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, tools TEXT, source TEXT, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS game_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, game TEXT NOT NULL, date TEXT NOT NULL,
  score REAL NOT NULL, detail TEXT, sparks INTEGER NOT NULL DEFAULT 0, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mri_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, source TEXT NOT NULL, age REAL,
  brain_age REAL, gap REAL, format_ok INTEGER NOT NULL, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, date TEXT NOT NULL, task TEXT NOT NULL,
  metrics TEXT NOT NULL, words INTEGER, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wearable_days (
  player TEXT NOT NULL, date TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(player, date));
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, created_at TEXT NOT NULL,
  title TEXT NOT NULL, items TEXT NOT NULL, source TEXT);
"""


def set_path(path: Path) -> None:
    """Point at a different database file (used by tests)."""
    global DB_PATH
    DB_PATH = Path(path)


@contextmanager
def conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        c = sqlite3.connect(DB_PATH)
        c.row_factory = sqlite3.Row
        try:
            c.executescript(SCHEMA)
            yield c
            c.commit()
        finally:
            c.close()


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ------------------------------------------------------------------ players
def upsert_player(name: str, profile: dict, onboarded: bool) -> None:
    with conn() as c:
        c.execute("""INSERT INTO players(name, profile, onboarded, created_at) VALUES (?,?,?,?)
                     ON CONFLICT(name) DO UPDATE SET profile=excluded.profile, onboarded=excluded.onboarded""",
                  (name, json.dumps(profile), int(onboarded), now()))


def get_player(name: str) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM players WHERE name=?", (name,)).fetchone()
    return None if r is None else {"name": r["name"], "profile": json.loads(r["profile"]),
                                   "onboarded": bool(r["onboarded"]), "created_at": r["created_at"]}


def list_players() -> list[str]:
    with conn() as c:
        return [r["name"] for r in c.execute("SELECT name FROM players ORDER BY created_at")]


# ------------------------------------------------------------------ logs
def add_log(player: str, date: str, quest: str, value: float | None, sparks: int, extra: dict) -> None:
    with conn() as c:
        c.execute("INSERT INTO quest_logs(player,date,quest,value,sparks,ts,extra) VALUES (?,?,?,?,?,?,?)",
                  (player, date, quest, value, sparks, now(), json.dumps(extra or {})))


def logs(player: str, since: str | None = None) -> list[dict]:
    q, a = "SELECT * FROM quest_logs WHERE player=?", [player]
    if since:
        q += " AND date>=?"
        a.append(since)
    with conn() as c:
        rows = c.execute(q + " ORDER BY ts", a).fetchall()
    return [{"date": r["date"], "quest": r["quest"], "value": r["value"], "sparks": r["sparks"],
             "ts": r["ts"], **json.loads(r["extra"] or "{}")} for r in rows]


# ------------------------------------------------------------------ steps
def set_step(player: str, date: str, quest: str, idx: int, done: bool) -> None:
    with conn() as c:
        c.execute("""INSERT INTO step_progress VALUES (?,?,?,?,?)
                     ON CONFLICT(player,date,quest,idx) DO UPDATE SET done=excluded.done""",
                  (player, date, quest, idx, int(done)))


def steps(player: str, date: str) -> dict[str, dict[int, bool]]:
    with conn() as c:
        rows = c.execute("SELECT quest, idx, done FROM step_progress WHERE player=? AND date=?",
                         (player, date)).fetchall()
    out: dict[str, dict[int, bool]] = {}
    for r in rows:
        out.setdefault(r["quest"], {})[r["idx"]] = bool(r["done"])
    return out


# ------------------------------------------------------------------ speed
def add_round(player: str, date: str, correct: int, wrong: int, best_combo: int) -> None:
    with conn() as c:
        c.execute("INSERT INTO speed_rounds(player,date,correct,wrong,best_combo,ts) VALUES (?,?,?,?,?,?)",
                  (player, date, correct, wrong, best_combo, now()))


def rounds(player: str) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT date,correct,wrong,best_combo,ts FROM speed_rounds "
                                           "WHERE player=? ORDER BY ts", (player,))]


# ------------------------------------------------------------------ coach
def add_message(player: str, role: str, content: str, tools: list | None = None, source: str = "") -> None:
    with conn() as c:
        c.execute("INSERT INTO coach_messages(player,role,content,tools,source,ts) VALUES (?,?,?,?,?,?)",
                  (player, role, content, json.dumps(tools or []), source, now()))


def messages(player: str, limit: int = 40) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT role,content,tools,source,ts FROM coach_messages WHERE player=? "
                         "ORDER BY id DESC LIMIT ?", (player, limit)).fetchall()
    return [{"role": r["role"], "content": r["content"], "tools": json.loads(r["tools"] or "[]"),
             "source": r["source"], "ts": r["ts"]} for r in reversed(rows)]


def save_plan(player: str, title: str, items: list[dict], source: str) -> None:
    with conn() as c:
        c.execute("INSERT INTO plans(player,created_at,title,items,source) VALUES (?,?,?,?,?)",
                  (player, now(), title, json.dumps(items), source))


def plans(player: str) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT created_at,title,items,source FROM plans WHERE player=? ORDER BY id DESC LIMIT 5",
                         (player,)).fetchall()
    return [{"created_at": r["created_at"], "title": r["title"], "items": json.loads(r["items"]),
             "source": r["source"]} for r in rows]


# ------------------------------------------------------------------ games
def add_game(player: str, game: str, date: str, score: float, detail: dict, sparks: int) -> None:
    with conn() as c:
        c.execute("INSERT INTO game_results(player,game,date,score,detail,sparks,ts) VALUES (?,?,?,?,?,?,?)",
                  (player, game, date, score, json.dumps(detail or {}), sparks, now()))


def games(player: str, game: str | None = None) -> list[dict]:
    q, a = "SELECT game,date,score,detail,sparks,ts FROM game_results WHERE player=?", [player]
    if game:
        q += " AND game=?"
        a.append(game)
    with conn() as c:
        rows = c.execute(q + " ORDER BY id", a).fetchall()
    return [{"game": r["game"], "date": r["date"], "score": r["score"], "sparks": r["sparks"], "ts": r["ts"],
             "detail": json.loads(r["detail"] or "{}")} for r in rows]


def add_mri(player: str, source: str, age, brain_age, gap, ok: bool) -> None:
    with conn() as c:
        c.execute("INSERT INTO mri_results(player,source,age,brain_age,gap,format_ok,ts) VALUES (?,?,?,?,?,?,?)",
                  (player, source, age, brain_age, gap, int(ok), now()))


def mris(player: str) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT source,age,brain_age,gap,format_ok,ts FROM mri_results "
                                           "WHERE player=? ORDER BY id DESC LIMIT 20", (player,))]


# ------------------------------------------------------------------ voice
def add_voice(player: str, date: str, task: str, metrics: dict, words: int | None) -> None:
    with conn() as c:
        c.execute("INSERT INTO voice_results(player,date,task,metrics,words,ts) VALUES (?,?,?,?,?,?)",
                  (player, date, task, json.dumps(metrics), words, now()))


def voices(player: str) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT date,task,metrics,words,ts FROM voice_results WHERE player=? ORDER BY id", (player,)).fetchall()
    return [{"date": r["date"], "task": r["task"], "metrics": json.loads(r["metrics"]), "words": r["words"], "ts": r["ts"]} for r in rows]


# ------------------------------------------------------------------ wearables
def put_days(player: str, days: dict, source: str) -> int:
    with conn() as c:
        for d, v in days.items():
            old = c.execute("SELECT data FROM wearable_days WHERE player=? AND date=?", (player, d)).fetchone()
            merged = {**(json.loads(old["data"]) if old else {}), **v}
            c.execute("""INSERT INTO wearable_days VALUES (?,?,?,?) ON CONFLICT(player,date)
                         DO UPDATE SET data=excluded.data, source=excluded.source""", (player, d, source, json.dumps(merged)))
    return len(days)


def days(player: str) -> dict[str, dict]:
    with conn() as c:
        rows = c.execute("SELECT date,data FROM wearable_days WHERE player=? ORDER BY date", (player,)).fetchall()
    return {r["date"]: json.loads(r["data"]) for r in rows}
