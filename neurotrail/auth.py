"""
Passkey sign-in (WebAuthn / FIDO2) with py_webauthn. No passwords anywhere.

  * Registration and login use discoverable credentials (passkeys) with user verification
    (Touch ID / Face ID / security-key PIN).
  * Public keys and sign counters are stored in SQLite (table `credentials`); private keys never
    leave the authenticator.
  * Sessions are random 256-bit tokens in an HttpOnly, SameSite=Strict cookie, kept in memory:
    restarting the server signs everyone out.
  * Challenges are single-use and expire after 5 minutes.
  * Every player-data route is /api/me/...; the server resolves the player from the session, so a
    typed name in a URL can no longer open someone else's data.
"""
from __future__ import annotations

import json
import secrets
import time

from webauthn import (generate_authentication_options, generate_registration_options, options_to_json,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
                                      ResidentKeyRequirement, UserVerificationRequirement)

from . import db

RP_ID, RP_NAME = "localhost", "NeuroTrail"
ORIGINS = ["http://localhost:8600"]
COOKIE = "nt_session"
SESSIONS: dict[str, dict] = {}           # token -> {"player": name, "via": "passkey"|"guest", "t": time}
CHALLENGES: dict[str, tuple[bytes, float, str | None]] = {}   # key -> (challenge, expiry, player)


def _schema() -> None:
    with db.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS credentials (cred_id TEXT PRIMARY KEY, player TEXT NOT NULL,
                     public_key BLOB NOT NULL, sign_count INTEGER NOT NULL, created_at TEXT NOT NULL)""")


def new_session(player: str, via: str) -> str:
    tok = secrets.token_urlsafe(32)
    SESSIONS[tok] = {"player": player, "via": via, "t": time.time()}
    return tok


def player_for(token: str | None) -> str | None:
    s = SESSIONS.get(token or "")
    return s["player"] if s else None


def end(token: str | None) -> None:
    SESSIONS.pop(token or "", None)


def has_passkey(player: str) -> bool:
    _schema()
    with db.conn() as c:
        return c.execute("SELECT 1 FROM credentials WHERE player=?", (player,)).fetchone() is not None


def _put_challenge(ch: bytes, player: str | None) -> str:
    key = secrets.token_urlsafe(16)
    now = time.time()
    for k in [k for k, v in CHALLENGES.items() if v[1] < now]:
        CHALLENGES.pop(k, None)
    CHALLENGES[key] = (ch, now + 300, player)
    return key


def _take_challenge(key: str) -> tuple[bytes, str | None]:
    ch = CHALLENGES.pop(key, None)
    if not ch or ch[1] < time.time():
        raise ValueError("Challenge expired. Try again.")
    return ch[0], ch[2]


def register_options(player: str) -> dict:
    _schema()
    with db.conn() as c:
        existing = [r["cred_id"] for r in c.execute("SELECT cred_id FROM credentials WHERE player=?", (player,))]
    opts = generate_registration_options(
        rp_id=RP_ID, rp_name=RP_NAME, user_name=player, user_display_name=player,
        user_id=player.encode()[:64],
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED,
                                                               user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(x)) for x in existing])
    return {"key": _put_challenge(opts.challenge, player), "options": json.loads(options_to_json(opts))}


def register_verify(key: str, credential: dict) -> str:
    ch, player = _take_challenge(key)
    v = verify_registration_response(credential=credential, expected_challenge=ch, expected_rp_id=RP_ID,
                                     expected_origin=ORIGINS, require_user_verification=True)
    with db.conn() as c:
        c.execute("INSERT INTO credentials VALUES (?,?,?,?,?)",
                  (bytes_to_base64url(v.credential_id), player, v.credential_public_key, v.sign_count, db.now()))
    return player


def login_options() -> dict:
    opts = generate_authentication_options(rp_id=RP_ID, user_verification=UserVerificationRequirement.REQUIRED)
    return {"key": _put_challenge(opts.challenge, None), "options": json.loads(options_to_json(opts))}


def login_verify(key: str, credential: dict) -> str:
    _schema()
    ch, _ = _take_challenge(key)
    with db.conn() as c:
        row = c.execute("SELECT * FROM credentials WHERE cred_id=?", (credential.get("id"),)).fetchone()
    if row is None:
        raise ValueError("This passkey isn't registered here.")
    v = verify_authentication_response(credential=credential, expected_challenge=ch, expected_rp_id=RP_ID,
                                       expected_origin=ORIGINS, credential_public_key=row["public_key"],
                                       credential_current_sign_count=row["sign_count"], require_user_verification=True)
    with db.conn() as c:
        c.execute("UPDATE credentials SET sign_count=? WHERE cred_id=?", (v.new_sign_count, row["cred_id"]))
    return row["player"]
