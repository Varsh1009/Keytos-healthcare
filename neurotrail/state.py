"""
Game logic on top of the SQLite store (neurotrail/db.py): profile, sparks,
levels, streaks, step checklists, trail status. Nothing leaves the device.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from . import db
from .quests import QUEST_BY_ID, QUESTS

LEVELS = [(0, "Neuron"), (150, "Synapse"), (400, "Circuit"), (800, "Network"),
          (1400, "Cortex"), (2200, "Connectome"), (3200, "Mindstar")]
PROFILE_KEYS = ("age", "female", "educ", "income_pir", "sbp", "diabetes", "current_smoker",
                "active_min_week", "sedentary_min_day", "sleep_hours", "phq9", "hearing_trouble", "feel_down", "guest")


def today() -> str:
    return date.today().isoformat()


@dataclass
class Player:
    name: str
    age: int = 65
    female: bool = True
    educ: int = 4
    income_pir: float = 2.5
    sbp: float | None = None          # unknown until measured (never guessed)
    diabetes: bool = False
    current_smoker: bool = False
    active_min_week: float = 90.0
    sedentary_min_day: float = 420.0
    sleep_hours: float = 7.0
    phq9: int | None = None           # PHQ-8 total from the Mood check (item 9 is never asked)
    hearing_trouble: bool = False
    feel_down: bool = False
    guest: bool = False
    onboarded: bool = False
    logs: list[dict] = field(default_factory=list)

    # ------------------------------------------------------------ persistence
    @classmethod
    def load(cls, name: str) -> "Player | None":
        r = db.get_player(name)
        if r is None:
            return None
        p = cls(name=name, onboarded=r["onboarded"], **{k: v for k, v in r["profile"].items() if k in PROFILE_KEYS})
        p.logs = db.logs(name)
        return p

    @classmethod
    def create(cls, name: str) -> "Player":
        p = cls(name=name)
        p.save()
        return p

    def save(self) -> None:
        d = asdict(self)
        db.upsert_player(self.name, {k: d[k] for k in PROFILE_KEYS}, self.onboarded)

    # ------------------------------------------------------------ derived
    def profile(self) -> dict:
        """Values for the lever model; the last 7 days of logs override baseline answers."""
        p = asdict(self)
        # Watch sleep is display-only: the NHANES model was trained on self-reported sleep.
        for qid, key in (("bp", "sbp"), ("sleep", "sleep_hours")):
            vals = [l["value"] for l in self.recent(qid, 7) if l.get("value") is not None]
            if vals:
                p[key] = sum(vals) / len(vals)
        return {k: p[k] for k in PROFILE_KEYS}

    def recent(self, quest_id: str, days: int) -> list[dict]:
        cut = (date.today() - timedelta(days=days - 1)).isoformat()
        return [l for l in self.logs if l["quest"] == quest_id and l["date"] >= cut]

    @property
    def sparks(self) -> int:
        """Quest sparks plus Brain Gym sparks."""
        return sum(l["sparks"] for l in self.logs) + sum(g["sparks"] for g in db.games(self.name))

    def level(self) -> dict:
        s = self.sparks
        idx = max(i for i, (t, _) in enumerate(LEVELS) if s >= t)
        nxt = LEVELS[idx + 1] if idx + 1 < len(LEVELS) else None
        return {"index": idx + 1, "name": LEVELS[idx][1], "floor": LEVELS[idx][0],
                "next_at": nxt[0] if nxt else None, "next_name": nxt[1] if nxt else None}

    def done_today(self, quest_id: str) -> bool:
        return any(l["quest"] == quest_id and l["date"] == today() for l in self.logs)

    def active_days(self) -> set[str]:
        days = {l["date"] for l in self.logs}
        days |= {g["date"] for g in db.games(self.name)}
        days |= {r["date"] for r in db.rounds(self.name)}
        return days

    def streak(self) -> int:
        """Kind streak: consecutive days with any habit or check, with one free rest day per 7 days."""
        days = self.active_days()
        d = date.today()
        if d.isoformat() not in days:
            d -= timedelta(days=1)
        n, rests, last_rest = 0, 0, None
        while True:
            if d.isoformat() in days:
                n += 1
            elif (last_rest is None or (last_rest - d).days >= 7) and n > 0 and (d - timedelta(days=1)).isoformat() in days:
                last_rest, rests = d, rests + 1   # rest day: doesn't break the streak, doesn't count
            else:
                break
            d -= timedelta(days=1)
        return n

    def _old_streak(self) -> int:
        days = {l["date"] for l in self.logs}
        d = date.today()
        if d.isoformat() not in days:
            d -= timedelta(days=1)
        n = 0
        while d.isoformat() in days:
            n += 1
            d -= timedelta(days=1)
        return n

    def active_quests(self) -> list:
        return [q for q in QUESTS if not q.smokers_only or self.current_smoker]

    def trail_status(self) -> dict[str, str]:
        """done / next (suggested) / open. Every quest is playable in any order."""
        out, nxt = {}, False
        for q in self.active_quests():
            if self.done_today(q.id):
                out[q.id] = "done"
            elif not nxt:
                out[q.id] = "next"
                nxt = True
            else:
                out[q.id] = "open"
        return out

    def steps_today(self, quest_id: str) -> list[bool]:
        n = len(QUEST_BY_ID[quest_id].steps)
        ticks = db.steps(self.name, today()).get(quest_id, {})
        return [ticks.get(i, False) for i in range(n)]

    def set_step(self, quest_id: str, idx: int, value: bool) -> list[bool]:
        db.set_step(self.name, today(), quest_id, idx, value)
        return self.steps_today(quest_id)

    def week(self) -> list[dict]:
        counts: dict[str, int] = {}
        for l in self.logs:
            counts[l["date"]] = counts.get(l["date"], 0) + 1
        out = []
        for i in range(6, -1, -1):
            d = date.today() - timedelta(days=i)
            out.append({"date": d.isoformat(), "dow": d.strftime("%a")[0], "quests": counts.get(d.isoformat(), 0)})
        return out

    def complete(self, quest_id: str, value: float | None = None, extra: dict | None = None) -> int:
        """Award sparks once per quest per day. Streak bonus +10 from a 3-day streak."""
        if self.done_today(quest_id):
            return 0
        q = QUEST_BY_ID[quest_id]
        sparks = q.sparks + (10 if self.streak() >= 3 else 0)
        db.add_log(self.name, today(), quest_id, value, sparks, extra or {})
        self.logs = db.logs(self.name)
        return sparks
