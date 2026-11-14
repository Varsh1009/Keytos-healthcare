"""Camera movement games: published cut-offs, saving results, and the pose logic (via node)."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import db, games  # noqa: E402


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    yield
    db.set_path(old)


def test_movement_games_are_registered_as_camera_games():
    for gid in ("chair", "balance", "reach"):
        g = games.GAME_BY_ID[gid]
        assert g["camera"] and g["better"] == "higher" and g["url"].startswith("https://")


@pytest.mark.parametrize("age,female,score,level", [
    (72, True, 9, "warn"), (72, True, 10, "ok"),        # CDC STEADI: women 70–74 below average if < 10
    (66, False, 11, "warn"), (66, False, 12, "ok"),     # men 65–69: < 12
    (91, True, 3, "warn"), (91, True, 4, "ok"),         # women 90–94: < 4
    (45, False, 25, "info"),                            # no CDC cut-off under 60
])
def test_chair_stand_uses_the_cdc_table(age, female, score, level):
    assert games.movement_reference("chair", score, age, female)["level"] == level


@pytest.mark.parametrize("secs,level", [(4.0, "warn"), (9.9, "warn"), (10.0, "info"), (19.9, "info"), (20.0, "ok"), (30.0, "ok")])
def test_balance_uses_the_10_and_20_second_marks(secs, level):
    assert games.movement_reference("balance", secs, 70, False)["level"] == level


def test_saving_a_chair_stand_returns_the_reference():
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app)
    c.post("/api/players", json={"name": "Mover"})
    r = c.post("/api/player/Mover/onboard", json={"age": 72, "female": True, "educ": 3, "income_pir": 2.5, "sbp": 128, "diabetes": False,
                                                   "current_smoker": False, "active_min_week": 120, "sedentary_min_day": 400,
                                                   "sleep_hours": 7, "phq": [0] * 9})
    assert r.status_code == 200, r.text
    r = c.post("/api/player/Mover/game", json={"game": "chair", "score": 8, "detail": {"stands": 8}}).json()
    assert r["reference"]["level"] == "warn" and "fewer than 10" in r["reference"]["text"]
    assert r["stats"]["history"] == [8] and r["sparks_gained"] == games.GAME_SPARKS
    assert c.get("/api/player/Mover/games").json()["balance"]["plays"] == 0
    assert {"chair", "balance", "reach"} <= {g["id"] for g in c.get("/api/games").json()["games"]}


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_pose_logic_on_synthetic_movement():
    r = subprocess.run(["node", str(ROOT / "tests" / "test_movelogic.mjs")], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr or r.stdout
