"""Verifiable doctor reports: PKI chain, passkey approval, tamper detection, revocation, QR."""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from neurotrail import db, signing  # noqa: E402
from test_passkey import SoftAuthenticator  # noqa: E402

ORIGIN = "http://localhost:8600"
ONB = {"age": 70, "female": False, "diabetes": True, "current_smoker": False, "sleep_hours": 6,
       "sbp": None, "hearing_trouble": True, "feel_down": False}


@pytest.fixture(autouse=True)
def temp_db_and_keys(tmp_path, monkeypatch):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    monkeypatch.setattr(signing, "KEYDIR", tmp_path / "keys")
    signing.reset_cache()
    yield
    db.set_path(old)
    signing.reset_cache()


def _client():
    from fastapi.testclient import TestClient
    import web.server as srv
    return TestClient(srv.app, base_url=ORIGIN)


def _guest(c):
    c.post("/auth/guest", json={})
    c.post("/api/me/onboard", json=ONB)
    c.post("/api/me/complete", json={"quest": "bp", "value": 142, "extra": {"readings": [[142, 88]]}})


def test_pki_chain_is_created_and_valid():
    ch = signing.chain()
    assert ch["chain_valid"] and ch["signing"]["issuer"] == "NeuroTrail Local Root CA" and ch["signing"]["valid_now"]
    s = signing.sign({"a": 1})
    assert signing.verify(s["payload_json"], s["sig_der"]) and signing.raw_to_der(s["sig_raw"])


def test_guest_report_is_signed_built_server_side_and_tamper_evident():
    c = _client()
    _guest(c)
    preview = c.get("/api/me/report").json()["report"]
    assert preview["glance"]["bp_avg"] == 142 and any("blood pressure" in q for q in preview["questions"])
    o = c.post("/api/me/report/options", json={}).json()
    assert o["approval"] is None                                   # guest: no passkey to approve with
    s = c.post("/api/me/report/sign", json={"id": o["id"]}).json()
    assert s["url"].endswith(f"/verify/{s['id']}") and s["approved"] is False
    v = c.get(f"/api/verify/{s['id']}").json()
    assert v["server_check"] and not v["revoked"] and v["chain"]["chain_valid"]
    env = json.loads(v["payload_json"])
    assert env["report"]["glance"]["bp_avg"] == 142 and env["patient_approval"] is None
    env["report"]["glance"]["bp_avg"] = 118                         # someone edits a number
    assert not signing.verify(signing.canonical(env), v["sig_der"])
    assert c.post("/api/me/report/sign", json={"id": o["id"]}).status_code == 400   # drafts are single-use


def test_passkey_account_must_approve_and_approval_covers_the_exact_report():
    dev, c = SoftAuthenticator(), _client()
    _guest(c)
    ro = c.post("/auth/register/options").json()
    assert c.post("/auth/register/verify", json={"key": ro["key"], "credential": dev.create(ro["options"], ORIGIN)}).status_code == 200
    o = c.post("/api/me/report/options", json={}).json()
    assert o["approval"] and o["approval"]["options"]["allowCredentials"]
    assert c.post("/api/me/report/sign", json={"id": o["id"]}).status_code == 400   # can't skip the passkey
    o = c.post("/api/me/report/options", json={}).json()
    cred = dev.get(o["approval"]["options"], ORIGIN)
    s = c.post("/api/me/report/sign", json={"id": o["id"], "key": o["approval"]["key"], "credential": cred}).json()
    assert s["approved"] is True
    v = c.get(f"/api/verify/{s['id']}").json()
    env = json.loads(v["payload_json"])
    A = env["patient_approval"]
    assert A["user_verified"] and A["approved_report_sha256"] == signing.hashlib.sha256(signing.canonical(env["report"]).encode()).hexdigest()
    challenge = base64.urlsafe_b64decode(o["approval"]["options"]["challenge"] + "==")
    assert challenge.hex() == A["approved_report_sha256"]


def test_approval_for_one_report_cannot_sign_another():
    dev, c = SoftAuthenticator(), _client()
    _guest(c)
    ro = c.post("/auth/register/options").json()
    c.post("/auth/register/verify", json={"key": ro["key"], "credential": dev.create(ro["options"], ORIGIN)})
    o1 = c.post("/api/me/report/options", json={}).json()
    o2 = c.post("/api/me/report/options", json={}).json()
    cred = dev.get(o1["approval"]["options"], ORIGIN)
    r = c.post("/api/me/report/sign", json={"id": o2["id"], "key": o1["approval"]["key"], "credential": cred})
    assert r.status_code == 400


def test_revoke_qr_and_privacy():
    c, other = _client(), _client()
    _guest(c)
    other.post("/auth/guest", json={})
    o = c.post("/api/me/report/options", json={}).json()
    rid = c.post("/api/me/report/sign", json={"id": o["id"]}).json()["id"]
    assert other.post(f"/api/me/report/{rid}/revoke").status_code == 404      # only the owner can revoke
    qr = c.get(f"/api/report/{rid}/qr.svg")
    assert qr.status_code == 200 and qr.headers["content-type"].startswith("image/svg") and b"<svg" in qr.content
    assert c.get(f"/verify/{rid}").status_code == 200
    assert c.post(f"/api/me/report/{rid}/revoke").json()["ok"]
    assert c.get(f"/api/verify/{rid}").json()["revoked"] is True
    assert c.get("/api/verify/not-a-real-id").status_code == 404
    assert len(rid) >= 16                                                      # unguessable link
