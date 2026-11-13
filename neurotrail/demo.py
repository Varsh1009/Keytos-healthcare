"""
Opt-in demo profile with MADE-UP data, for showing the Personal insights feature in a live demo
without waiting four weeks. Off unless the server runs with NT_DEMO=1, and always labeled
"Demo data" in the app. It never touches real players.

The simulated person: 68, four weeks of habits and checks. Speed Sprint and Color Clash are a bit
better after 7+ hours of sleep and with practice; social contact has a small effect; enjoyable
activities have none (so the app should report "no clear difference" for them).
"""
from __future__ import annotations

import os
import secrets
from datetime import date, timedelta

import numpy as np

from . import db
from .state import Player

ENABLED = os.environ.get("NT_DEMO") == "1"
DAYS = 28


def create_demo_player(seed: int | None = 3) -> str:
    rng = np.random.default_rng(seed)
    name = f"Demo-{secrets.token_hex(2)}"
    p = Player.create(name)
    p.age, p.female, p.guest, p.onboarded = 68, True, True, True
    p.sbp, p.diabetes, p.current_smoker, p.sleep_hours = 136.0, False, False, 6.5
    p.hearing_trouble, p.feel_down = True, False
    p.save()
    start = date.today() - timedelta(days=DAYS - 1)
    plays = 0
    for i in range(DAYS):
        d = (start + timedelta(days=i)).isoformat()
        sleep = float(np.clip(rng.normal(6.8, 0.9), 4.5, 9.0).round(1))
        steps = int(np.clip(rng.normal(6500, 2200), 1500, 14000) // 100 * 100)
        talked = rng.random() < 0.5
        joy = rng.random() < 0.4
        db.add_log(name, d, "sleep", sleep, 25, {})
        db.add_log(name, d, "steps", steps, 47, {})
        if talked:
            db.add_log(name, d, "connect", 20, 58, {"who": "Friend"})
        if joy:
            db.add_log(name, d, "joy", 1, 65, {"activity": "Gardening", "before": 5, "after": 6})
        if i % 7 == 2:
            db.add_log(name, d, "bp", float(rng.integers(124, 138)), 61, {})
        if rng.random() < 0.85:                               # most days: a Speed Sprint
            plays += 1
            good = sleep >= 7
            correct = 30 + 3.0 * np.log(plays) + 4.5 * good + 1.2 * talked + rng.normal(0, 2.2)
            db.add_round(name, d, int(round(correct)), int(rng.integers(0, 4)), int(rng.integers(5, 15)))
        if rng.random() < 0.5:                                # some days: Color Clash too
            score = 38 + 2.0 * np.log(i + 1) + 3.5 * (sleep >= 7) + rng.normal(0, 3)
            db.add_game(name, "stroop", d, round(float(score)), {"demo": True}, 0)
    return name
