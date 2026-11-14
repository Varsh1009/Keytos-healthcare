"""Any name should work for signing in: create it, load it back, and use it."""
from __future__ import annotations

import sys
import urllib.parse
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import db  # noqa: E402


@pytest.fixture
def client(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "t.db")
    from fastapi.testclient import TestClient
    import web.server as srv
    yield TestClient(srv.app)
    db.set_path(old)


NAMES = ["Hong Kong", "King Kong", "José Ñandú", "李小龙", "😀 Smiley", "King/Kong", "AC/DC", "50% sure", "who?", "#1 fan",
         "a.b", "back\\slash", "O'Brien", 'Quote"s', "<b>bold</b>", "A&B", "plus+sign", "Ab", "x" * 40, "Mary  Ann   Lee"]


@pytest.mark.parametrize("name", NAMES)
def test_any_name_signs_in_and_loads_back(client, name):
    r = client.post("/api/players", json={"name": name})
    assert r.status_code == 200, r.text
    saved = r.json()["name"]
    # the browser URL-encodes the name exactly like this (encodeURIComponent)
    back = client.get("/api/player/" + urllib.parse.quote(saved, safe="-_.!~*'()"))
    assert back.status_code == 200 and back.json()["name"] == saved
    # signing in again with the same name returns the same player
    assert client.post("/api/players", json={"name": name}).json()["name"] == saved


def test_names_are_tidied_not_rejected(client):
    assert client.post("/api/players", json={"name": "  Mary  Ann   Lee "}).json()["name"] == "Mary Ann Lee"
    assert client.post("/api/players", json={"name": "AC/DC"}).json()["name"] == "AC∕DC"   # look-alike slash
    long = client.post("/api/players", json={"name": "Hubert Blaine Wolfeschlegelsteinhausenbergerdorff"}).json()["name"]
    assert len(long) == 40


@pytest.mark.parametrize("bad", ["", "   ", ".", "..", "..."])
def test_only_blank_or_dots_gets_a_clear_message(client, bad):
    r = client.post("/api/players", json={"name": bad})
    assert r.status_code == 422
    if bad.strip():
        assert "letter or number" in r.json()["detail"]


def test_a_tricky_name_can_play(client):
    name = client.post("/api/players", json={"name": "King/Kong 🦍"}).json()["name"]
    path = "/api/player/" + urllib.parse.quote(name, safe="")
    ob = client.post(path + "/onboard", json={"age": 70, "female": False, "educ": 3, "income_pir": 2, "sbp": 130, "diabetes": False,
                                               "current_smoker": False, "active_min_week": 90, "sedentary_min_day": 400,
                                               "sleep_hours": 7, "phq": [0] * 9})
    assert ob.status_code == 200, ob.text
    assert client.post(path + "/game", json={"game": "stroop", "score": 20, "detail": {}}).status_code == 200
