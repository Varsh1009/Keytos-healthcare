"""Personal insights: within-person links between your habits and your check scores."""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import db, demo, insights  # noqa: E402
from neurotrail.state import Player  # noqa: E402


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    yield
    db.set_path(old)


def _days(n):
    start = date.today() - timedelta(days=n - 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


def _person(sleep_effect: float, practice: float = 0.0, n=24, seed=0):
    rng = np.random.default_rng(seed)
    name = f"P{seed}{int(sleep_effect)}{int(practice)}"
    Player.create(name)
    for i, d in enumerate(_days(n)):
        sleep = 8.0 if i % 2 else 6.0                        # alternate good / short nights
        db.add_log(name, d, "sleep", sleep, 25, {})
        db.add_round(name, d, int(round(30 + practice * np.log(i + 1) + sleep_effect * (sleep >= 7) + rng.normal(0, 1.5))), 1, 5)
    return name


def test_locked_until_enough_days():
    name = _person(5, n=4)
    r = insights.personal_insights(name)
    assert r["ready"] is False and r["status"]["days_with_both"] == 4 and r["status"]["days_needed"] == 6


def test_finds_a_real_sleep_effect():
    r = insights.personal_insights(_person(sleep_effect=5))
    sleep = next(i for i in r["insights"] if i["key"] == "sleep")
    assert sleep["level"] == "clear" and sleep["direction"] == "better" and sleep["p_adjusted"] < .05
    assert sleep["example"]["check"] == "Speed Sprint" and sleep["example"]["with"] > sleep["example"]["without"]
    assert r["insights"][0]["key"] == "sleep"                # strongest first


def test_no_effect_is_not_reported_as_a_pattern():
    r = insights.personal_insights(_person(sleep_effect=0, seed=3))
    sleep = next(i for i in r["insights"] if i["key"] == "sleep")
    assert sleep["level"] != "clear"


def test_practice_gains_are_not_credited_to_habits():
    """Scores climb only from practice while the person sleeps well more and more often: no sleep effect."""
    name = "Practicer"
    Player.create(name)
    rng = np.random.default_rng(7)
    for i, d in enumerate(_days(24)):
        sleep = 8.0 if i >= 12 else 6.0                       # good sleep only in the later (more practiced) half
        db.add_log(name, d, "sleep", sleep, 25, {})
        db.add_round(name, d, int(round(25 + 6 * np.log(i + 1) + rng.normal(0, 0.8))), 1, 5)
    sleep = next(i for i in insights.personal_insights(name)["insights"] if i["key"] == "sleep")
    assert sleep["level"] != "clear"


def test_needs_days_on_both_sides():
    name = "AlwaysSleeps"
    Player.create(name)
    for i, d in enumerate(_days(10)):
        db.add_log(name, d, "sleep", 8.0, 25, {})
        db.add_round(name, d, 30 + i % 3, 1, 5)
    sleep = next(i for i in insights.personal_insights(name)["insights"] if i["key"] == "sleep")
    assert sleep["level"] == "more_data" and sleep["n_no"] == 0


def test_demo_profile_is_opt_in(monkeypatch):
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app, base_url="http://localhost:8600")
    monkeypatch.setattr(demo, "ENABLED", False)
    assert c.post("/auth/demo").status_code == 404 and c.get("/api/config").json()["demo"] is False
    monkeypatch.setattr(demo, "ENABLED", True)
    assert c.post("/auth/demo").status_code == 200
    me = c.get("/auth/me").json()
    assert me["demo"] is True and me["onboarded"]
    r = c.get("/api/me/insights").json()
    assert r["ready"] and r["insights"][0]["key"] == "sleep" and r["insights"][0]["level"] == "clear"
