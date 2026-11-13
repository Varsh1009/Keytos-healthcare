"""Family sharing: chosen scopes, caregiver passkey, single-use invites, expiry, revoke, access log."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from neurotrail import db, demo  # noqa: E402
from test_passkey import SoftAuthenticator  # noqa: E402

ORIGIN = "http://localhost:8600"
ONB = {"age": 74, "female": True, "diabetes": False, "current_smoker": False, "sleep_hours": 7,
       "sbp": None, "hearing_trouble": True, "feel_down": False}


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    monkeypatch.setattr(demo, "ENABLED", False)
    yield
    db.set_path(old)


def _client():
    from fastapi.testclient import TestClient
    import web.server as srv
    return TestClient(srv.app, base_url=ORIGIN)


def _with_passkey(c):
    dev = SoftAuthenticator()
    o = c.post("/auth/register/options").json()
    assert c.post("/auth/register/verify", json={"key": o["key"], "credential": dev.create(o["options"], ORIGIN)}).status_code == 200
    return dev


def _mom():
    c = _client()
    c.post("/auth/guest", json={})
    c.post("/api/me/onboard", json=ONB)
    c.post("/api/me/complete", json={"quest": "bp", "value": 138, "extra": {"readings": [[138, 86]]}})
    c.post("/api/me/speed", json={"correct": 30, "wrong": 1, "best_combo": 5})
    return c


def _invite(mom, scopes=("bp", "games"), days=30):
    r = mom.post("/api/me/shares", json={"label": "Daughter", "owner_label": "Mom", "scopes": list(scopes), "days": days}).json()
    return r["share"]["id"], r["token"], r["invite_url"]


def test_full_flow_scoped_view_and_access_log():
    mom, kid = _mom(), _client()
    sid, token, url = _invite(mom)
    assert url.endswith(f"/#/join/{token}")
    info = kid.get(f"/api/invite/{token}").json()
    assert info["owner_label"] == "Mom" and info["status"] == "pending" and "Mood check score" not in info["scopes"]
    kid.post("/auth/guest", json={})
    _with_passkey(kid)
    acc = kid.post("/api/me/join", json={"token": token})
    assert acc.status_code == 200 and acc.json()["status"] == "active"
    v = kid.get(f"/api/me/shared/{sid}").json()
    assert v["owner_label"] == "Mom" and v["bp"]["avg"] == 138 and v["games"][0]["game"] == "Speed Sprint"
    assert "mood" not in v and "insights" not in v                     # only what Mom chose
    assert v["activity"]["days_since"] == 0 and v["activity"]["streak"] >= 1
    owned = mom.get("/api/me/shares").json()["owned"][0]
    assert owned["views"] == 1 and owned["status"] == "active" and "viewer" not in owned
    assert mom.get(f"/api/me/shares/{sid}/log").json()[0]["who"] == "Daughter"
    assert kid.get("/api/me/shares").json()["viewing"][0]["owner_label"] == "Mom"


def test_caregiver_needs_a_passkey_and_invite_is_single_use():
    mom, kid, other = _mom(), _client(), _client()
    sid, token, _ = _invite(mom)
    kid.post("/auth/guest", json={})
    r = kid.post("/api/me/join", json={"token": token})
    assert r.status_code == 403 and "passkey" in r.json()["detail"]
    _with_passkey(kid)
    assert kid.post("/api/me/join", json={"token": token}).status_code == 200
    other.post("/auth/guest", json={}); _with_passkey(other)
    assert other.post("/api/me/join", json={"token": token}).status_code == 400   # already used
    assert other.get(f"/api/me/shared/{sid}").status_code == 404                  # not theirs
    assert other.get(f"/api/invite/{token}").status_code == 404                   # token gone after use


def test_owner_cannot_accept_own_invite_and_others_cannot_manage():
    mom, stranger = _mom(), _client()
    _with_passkey(mom)
    sid, token, _ = _invite(mom)
    assert mom.post("/api/me/join", json={"token": token}).status_code == 400
    stranger.post("/auth/guest", json={})
    assert stranger.post(f"/api/me/shares/{sid}/revoke").status_code == 404
    assert stranger.get(f"/api/me/shares/{sid}/log").status_code == 404


def test_revoke_and_expiry_stop_access_and_renew_restores():
    mom, kid = _mom(), _client()
    sid, token, _ = _invite(mom, days=7)
    kid.post("/auth/guest", json={}); _with_passkey(kid)
    kid.post("/api/me/join", json={"token": token})
    with db.conn() as c:
        c.execute("UPDATE shares SET expires='2000-01-01T00:00:00+00:00' WHERE id=?", (sid,))
    assert kid.get(f"/api/me/shared/{sid}").status_code == 403
    assert mom.post(f"/api/me/shares/{sid}/renew", json={"days": 30}).json()["status"] == "active"
    assert kid.get(f"/api/me/shared/{sid}").status_code == 200
    mom.post(f"/api/me/shares/{sid}/revoke")
    assert kid.get(f"/api/me/shared/{sid}").status_code == 403
    assert mom.post(f"/api/me/shares/{sid}/renew", json={"days": 30}).status_code == 400


def test_scopes_and_duration_are_clamped():
    mom = _mom()
    r = mom.post("/api/me/shares", json={"label": "Son", "owner_label": "Dad", "scopes": ["mood", "steal_everything"], "days": 999}).json()["share"]
    assert r["scopes"] == ["activity", "mood"]
    import datetime as dt
    days = (dt.datetime.fromisoformat(r["expires"]) - dt.datetime.fromisoformat(r["created"])).days
    assert days == 90


def test_demo_mode_allows_guest_caregivers(monkeypatch):
    monkeypatch.setattr(demo, "ENABLED", True)
    mom, kid = _mom(), _client()
    sid, token, _ = _invite(mom)
    kid.post("/auth/guest", json={})
    assert kid.get(f"/api/invite/{token}").json()["needs_passkey"] is False
    assert kid.post("/api/me/join", json={"token": token}).json()["viewer_passkey"] is False
