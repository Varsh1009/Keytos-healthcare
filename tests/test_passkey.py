"""End-to-end passkey tests with a software authenticator (no browser needed).

The fake authenticator builds real WebAuthn responses (ES256 key, "none" attestation),
so the server's py_webauthn verification runs exactly as it does for Touch ID / Face ID.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import sys
from pathlib import Path

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import auth, db  # noqa: E402
from webauthn.helpers import bytes_to_base64url  # noqa: E402


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    yield
    db.set_path(old)


class SoftAuthenticator:
    """A passkey that lives in memory. One instance = one device."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(16)
        self.count = 0
        self.user_handle = None

    def _client_data(self, kind: str, challenge: str, origin: str) -> bytes:
        return json.dumps({"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": False}).encode()

    def create(self, options: dict, origin: str) -> dict:
        rp_id = options["rp"]["id"]
        self.user_handle = options["user"]["id"]
        n = self.key.public_key().public_numbers()
        cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")})
        auth_data = (hashlib.sha256(rp_id.encode()).digest() + bytes([0x45]) + struct.pack(">I", self.count)
                     + bytes(16) + struct.pack(">H", len(self.cred_id)) + self.cred_id + cose)
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        cd = self._client_data("webauthn.create", options["challenge"], origin)
        cid = bytes_to_base64url(self.cred_id)
        return {"id": cid, "rawId": cid, "type": "public-key", "clientExtensionResults": {},
                "response": {"clientDataJSON": bytes_to_base64url(cd), "attestationObject": bytes_to_base64url(att),
                             "transports": ["internal"]}}

    def get(self, options: dict, origin: str) -> dict:
        self.count += 1
        auth_data = hashlib.sha256(options["rpId"].encode()).digest() + bytes([0x05]) + struct.pack(">I", self.count)
        cd = self._client_data("webauthn.get", options["challenge"], origin)
        sig = self.key.sign(auth_data + hashlib.sha256(cd).digest(), ec.ECDSA(hashes.SHA256()))
        cid = bytes_to_base64url(self.cred_id)
        return {"id": cid, "rawId": cid, "type": "public-key", "clientExtensionResults": {},
                "response": {"clientDataJSON": bytes_to_base64url(cd), "authenticatorData": bytes_to_base64url(auth_data),
                             "signature": bytes_to_base64url(sig), "userHandle": self.user_handle}}


def _client(base: str):
    from fastapi.testclient import TestClient
    import web.server as srv
    return TestClient(srv.app, base_url=base)


ONB = {"age": 68, "female": True, "diabetes": True, "current_smoker": False, "sleep_hours": 7,
       "sbp": None, "hearing_trouble": True, "feel_down": False}


@pytest.mark.parametrize("origin", ["http://localhost:8600", "http://localhost:9000"])
def test_passkey_register_logout_login_keeps_progress(origin):
    dev = SoftAuthenticator()
    c = _client(origin)
    name = c.post("/auth/guest", json={}).json()["name"]
    c.post("/api/me/onboard", json=ONB)
    c.post("/api/me/complete", json={"quest": "bp", "value": 128})

    o = c.post("/auth/register/options").json()
    r = c.post("/auth/register/verify", json={"key": o["key"], "credential": dev.create(o["options"], origin)})
    assert r.status_code == 200, r.text
    me = c.get("/auth/me").json()
    assert me["passkey"] is True and me["guest"] is False

    c.post("/auth/logout", json={})
    assert c.get("/auth/me").json()["signed_in"] is False

    fresh = _client(origin)                                  # a new browser on the same computer
    o = fresh.post("/auth/login/options").json()
    r = fresh.post("/auth/login/verify", json={"key": o["key"], "credential": dev.get(o["options"], origin)})
    assert r.status_code == 200, r.text
    me = fresh.get("/auth/me").json()
    assert me["signed_in"] and me["name"] == name and me["onboarded"]
    assert fresh.get("/api/me/progress").json()["totals"]["quests"] == 1    # progress came back


def test_unknown_passkey_gives_clear_error():
    origin = "http://localhost:8600"
    c = _client(origin)
    o = c.post("/auth/login/options").json()
    r = c.post("/auth/login/verify", json={"key": o["key"], "credential": SoftAuthenticator().get(o["options"], origin)})
    assert r.status_code == 400 and "isn't registered" in r.json()["detail"]


def test_challenge_is_single_use():
    origin = "http://localhost:8600"
    dev = SoftAuthenticator()
    c = _client(origin)
    c.post("/auth/guest", json={})
    o = c.post("/auth/register/options").json()
    cred = dev.create(o["options"], origin)
    assert c.post("/auth/register/verify", json={"key": o["key"], "credential": cred}).status_code == 200
    assert c.post("/auth/register/verify", json={"key": o["key"], "credential": cred}).status_code == 400


def test_session_survives_server_restart():
    c = _client("http://localhost:8600")
    name = c.post("/auth/guest", json={}).json()["name"]
    auth.SESSIONS.clear()                                    # what a restart does to in-memory sessions
    me = c.get("/auth/me").json()
    assert me["signed_in"] and me["name"] == name
