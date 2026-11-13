"""
Passkey sign-in (WebAuthn / FIDO2) with py_webauthn. No passwords anywhere.

  * Registration and login use discoverable credentials (passkeys) with user verification
    (Touch ID / Face ID / security-key PIN).
  * Public keys and sign counters are stored in SQLite (table `credentials`); private keys never
    leave the authenticator.
  * Sessions are random 256-bit tokens in an HttpOnly, SameSite=Strict cookie. Only a SHA-256 hash of
    each token is stored (SQLite table `sessions`), so a server restart no longer signs everyone out.
  * Challenges are single-use, expire after 5 minutes, and remember which site (RP ID + origin)
    asked for them, so the app works on any localhost port or a configured https domain.
  * Every player-data route is /api/me/...; the server resolves the player from the session, so a
    typed name in a URL can no longer open someone else's data.

Passkeys need a secure context: http://localhost (any port) or https. Plain-http LAN addresses and raw
IPs such as 127.0.0.1 can't use them (a browser rule), so the front end redirects 127.0.0.1 to localhost.
For a deployed https site set NT_RP_ID (e.g. "neurotrail.example.org").
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import secrets
import time

from webauthn import (generate_authentication_options, generate_registration_options, options_to_json,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
                                      ResidentKeyRequirement, UserVerificationRequirement)

from . import db

RP_NAME = "NeuroTrail"
EXTRA_RP_IDS = {h.strip().lower() for h in os.environ.get("NT_RP_ID", "").split(",") if h.strip()}
COOKIE = "nt_session"
SESSION_DAYS = 30
SESSIONS: dict[str, dict] = {}           # token hash -> {"player": name, "via": ..., "t": time} (cache of the DB)
CHALLENGES: dict[str, tuple[bytes, float, str | None, str, str]] = {}   # key -> (challenge, expiry, player, rp_id, origin)


class SiteError(ValueError):
    """The page was opened from an address where browsers don't allow passkeys."""


def site_for(scheme: str, host_header: str) -> tuple[str, str]:
    """(rp_id, origin) for the address the browser used, e.g. ('localhost', 'http://localhost:8600')."""
    host = (host_header or "").strip().lower()
    hostname = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
    try:
        ipaddress.ip_address(hostname.strip("[]"))
        is_ip = True
    except ValueError:
        is_ip = False
    if is_ip:
        raise SiteError(f"Passkeys don't work on an IP address ({hostname}). Open http://localhost{host[len(hostname):]} instead.")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return hostname, f"{scheme}://{host}"
    if hostname in EXTRA_RP_IDS and scheme == "https":
        return hostname, f"https://{host}"
    raise SiteError(f"Passkeys aren't set up for {hostname}. Use http://localhost on this computer, "
                    "or serve the app over https and set NT_RP_ID.")


def _schema() -> None:
    with db.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS credentials (cred_id TEXT PRIMARY KEY, player TEXT NOT NULL,
                     public_key BLOB NOT NULL, sign_count INTEGER NOT NULL, created_at TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, player TEXT NOT NULL,
                     via TEXT NOT NULL, created REAL NOT NULL)""")


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_session(player: str, via: str) -> str:
    _schema()
    tok = secrets.token_urlsafe(32)
    rec = {"player": player, "via": via, "t": time.time()}
    SESSIONS[_h(tok)] = rec
    with db.conn() as c:
        c.execute("INSERT INTO sessions VALUES (?,?,?,?)", (_h(tok), player, via, rec["t"]))
    return tok


def player_for(token: str | None) -> str | None:
    if not token:
        return None
    h = _h(token)
    s = SESSIONS.get(h)
    if s is None:
        _schema()
        with db.conn() as c:
            row = c.execute("SELECT player, via, created FROM sessions WHERE token_hash=?", (h,)).fetchone()
        if row is None:
            return None
        s = SESSIONS[h] = {"player": row["player"], "via": row["via"], "t": row["created"]}
    if time.time() - s["t"] > SESSION_DAYS * 86400:
        end(token)
        return None
    return s["player"]


def end(token: str | None) -> None:
    if not token:
        return
    SESSIONS.pop(_h(token), None)
    _schema()
    with db.conn() as c:
        c.execute("DELETE FROM sessions WHERE token_hash=?", (_h(token),))


def has_passkey(player: str) -> bool:
    _schema()
    with db.conn() as c:
        return c.execute("SELECT 1 FROM credentials WHERE player=?", (player,)).fetchone() is not None


def _put_challenge(ch: bytes, player: str | None, site: tuple[str, str]) -> str:
    key = secrets.token_urlsafe(16)
    now = time.time()
    for k in [k for k, v in CHALLENGES.items() if v[1] < now]:
        CHALLENGES.pop(k, None)
    CHALLENGES[key] = (ch, now + 300, player, *site)
    return key


def _take_challenge(key: str) -> tuple[bytes, str | None, str, str]:
    ch = CHALLENGES.pop(key, None)
    if not ch or ch[1] < time.time():
        raise ValueError("That request expired (5 minutes). Please try again.")
    return ch[0], ch[2], ch[3], ch[4]


def register_options(player: str, site: tuple[str, str]) -> dict:
    _schema()
    with db.conn() as c:
        existing = [r["cred_id"] for r in c.execute("SELECT cred_id FROM credentials WHERE player=?", (player,))]
    opts = generate_registration_options(
        rp_id=site[0], rp_name=RP_NAME, user_name=player, user_display_name=player,
        user_id=player.encode()[:64],
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED,
                                                               user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(x)) for x in existing])
    return {"key": _put_challenge(opts.challenge, player, site), "options": json.loads(options_to_json(opts))}


def register_verify(key: str, credential: dict) -> str:
    _schema()
    ch, player, rp_id, origin = _take_challenge(key)
    v = verify_registration_response(credential=credential, expected_challenge=ch, expected_rp_id=rp_id,
                                     expected_origin=origin, require_user_verification=True)
    with db.conn() as c:
        c.execute("INSERT INTO credentials VALUES (?,?,?,?,?)",
                  (bytes_to_base64url(v.credential_id), player, v.credential_public_key, v.sign_count, db.now()))
    return player


def approval_options(player: str, site: tuple[str, str], challenge: bytes) -> dict:
    """Ask the person's own passkey to approve something specific: the challenge is that thing's SHA-256."""
    _schema()
    with db.conn() as c:
        creds = [r["cred_id"] for r in c.execute("SELECT cred_id FROM credentials WHERE player=?", (player,))]
    if not creds:
        raise ValueError("Save a passkey first.")
    opts = generate_authentication_options(rp_id=site[0], challenge=challenge, user_verification=UserVerificationRequirement.REQUIRED,
                                           allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(x)) for x in creds])
    return {"key": _put_challenge(opts.challenge, player, site), "options": json.loads(options_to_json(opts))}


def approval_verify(key: str, credential: dict, player: str, expected: bytes) -> dict:
    """Check the passkey approved exactly `expected` and belongs to this person. Returns an audit record."""
    _schema()
    ch, who, rp_id, origin = _take_challenge(key)
    if who != player or ch != expected:
        raise ValueError("This approval doesn't match the report.")
    with db.conn() as c:
        row = c.execute("SELECT * FROM credentials WHERE cred_id=?", (credential.get("id"),)).fetchone()
    if row is None or row["player"] != player:
        raise ValueError("That passkey belongs to a different account.")
    v = verify_authentication_response(credential=credential, expected_challenge=ch, expected_rp_id=rp_id,
                                       expected_origin=origin, credential_public_key=row["public_key"],
                                       credential_current_sign_count=row["sign_count"], require_user_verification=True)
    with db.conn() as c:
        c.execute("UPDATE credentials SET sign_count=? WHERE cred_id=?", (v.new_sign_count, row["cred_id"]))
    return {"method": "passkey (WebAuthn)", "user_verified": bool(v.user_verified), "credential": row["cred_id"][:12] + "…",
            "approved_report_sha256": ch.hex(), "at": db.now()}


def login_options(site: tuple[str, str]) -> dict:
    opts = generate_authentication_options(rp_id=site[0], user_verification=UserVerificationRequirement.REQUIRED)
    return {"key": _put_challenge(opts.challenge, None, site), "options": json.loads(options_to_json(opts))}


def login_verify(key: str, credential: dict) -> str:
    _schema()
    ch, _, rp_id, origin = _take_challenge(key)
    with db.conn() as c:
        row = c.execute("SELECT * FROM credentials WHERE cred_id=?", (credential.get("id"),)).fetchone()
    if row is None:
        raise ValueError("This passkey isn't registered here. Start as a guest, then save with a passkey.")
    v = verify_authentication_response(credential=credential, expected_challenge=ch, expected_rp_id=rp_id,
                                       expected_origin=origin, credential_public_key=row["public_key"],
                                       credential_current_sign_count=row["sign_count"], require_user_verification=True)
    with db.conn() as c:
        c.execute("UPDATE credentials SET sign_count=? WHERE cred_id=?", (v.new_sign_count, row["cred_id"]))
    return row["player"]
