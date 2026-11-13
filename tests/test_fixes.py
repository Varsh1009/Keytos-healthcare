"""Regression tests for bugs found in the Nov 2026 functionality pass (login, games, MRI, install)."""
from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import auth, db  # noqa: E402


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    yield
    db.set_path(old)


def _client(base="http://localhost:8600"):
    from fastapi.testclient import TestClient
    import web.server as srv
    return TestClient(srv.app, base_url=base)


# ---------------------------------------------------------------- install
def test_requirements_list_every_runtime_import():
    req = (ROOT / "requirements.txt").read_text().lower()
    for pkg in ["webauthn", "nibabel", "python-multipart", "pillow", "scikit-learn==1.6.1"]:
        assert pkg in req, f"{pkg} missing from requirements.txt (server fails on a fresh install)"


# ---------------------------------------------------------------- login
@pytest.mark.parametrize("host", ["127.0.0.1:8600", "192.168.1.20:8600"])
def test_passkeys_on_an_ip_address_get_a_clear_message(host):
    with pytest.raises(auth.SiteError, match="localhost"):
        auth.site_for("http", host)
    r = _client(f"http://{host}").post("/auth/login/options")
    assert r.status_code == 400 and "localhost" in r.json()["detail"]


def test_any_localhost_port_is_a_valid_site():
    assert auth.site_for("http", "localhost:8600") == ("localhost", "http://localhost:8600")
    assert auth.site_for("http", "localhost:3000") == ("localhost", "http://localhost:3000")


def test_guest_session_cookie_lasts_30_days():
    r = _client().post("/auth/guest", json={})
    assert "max-age=2592000" in r.headers["set-cookie"].lower()


def test_logout_really_ends_the_session():
    c = _client()
    c.post("/auth/guest", json={})
    tok = c.cookies.get(auth.COOKIE)
    c.post("/auth/logout", json={})
    auth.SESSIONS.clear()
    assert auth.player_for(tok) is None


# ---------------------------------------------------------------- games
def test_fluency_reports_repeats_and_keeps_words_ending_in_s():
    from neurotrail import games
    r = games.score_fluency(["dog", "dogs", "Dog", "cat", "table"])
    assert r["score"] == 2 and r["repeats"] == 2 and r["unrecognized"] == ["table"]


def test_recall_never_repeats_the_last_list():
    from neurotrail import games
    c = _client()
    for last in games.WORD_LISTS:
        for _ in range(10):
            w = c.get("/api/games/recall-words", params={"avoid": last[0]}).json()
            assert w["words"] != last and not set(w["words"]) & set(w["distractors"])


def test_delayed_recall_has_its_own_history():
    c = _client()
    c.post("/auth/guest", json={})
    c.post("/api/me/game", json={"game": "recall", "score": 21, "detail": {}})
    d = c.post("/api/me/game", json={"game": "recall_delayed", "score": 7, "detail": {"delayed": True}}).json()
    assert d["stats"]["history"] == [7] and d["sparks_gained"] == 0
    assert c.get("/api/me/games").json()["recall"]["history"] == [21]
    # rows saved by older versions (delayed recall stored as "recall") are sorted out too
    c.post("/api/me/game", json={"game": "recall", "score": 6, "detail": {"delayed": True}})
    assert c.get("/api/me/games").json()["recall"]["history"] == [21]
    name = c.get("/api/me").json()["name"]
    assert [r["score"] for r in db.games(name, "recall_delayed")] == [7, 6]


# ---------------------------------------------------------------- MRI
def test_mri_upload_previews_and_samples_work_without_the_download(monkeypatch):
    import nibabel as nib
    from neurotrail import brainage_ensemble as be
    monkeypatch.setattr(be, "estimate", lambda v, age, fold=None: {"format": {"ok": True}, "brain_age": 60.0, "interval_low": 50.0,
        "interval_high": 70.0, "confidence": "medium", "confidence_reasons": [], "per_model": [], "model_disagreement": 0.0, "_cam": None})
    c = _client()
    c.post("/auth/guest", json={})
    v = np.zeros((91, 109, 91), np.float32)
    v[20:70, 20:90, 20:70] = 1
    buf = io.BytesIO(nib.Nifti1Image(v, np.eye(4)).to_bytes())
    r = c.post("/api/me/mri/upload", files={"file": ("scan.nii", buf, "application/octet-stream")})
    assert r.status_code == 200 and set(r.json()["images"]) == {"axial", "coronal", "sagittal"}
    if not c.get("/api/mri/status").json()["samples"]:
        f = c.get("/api/mri/samples").json()[0]["file"]
        r = c.post("/api/me/mri/sample", data={"file": f}).json()
        assert r["images"] == {} and r["view"] is None and r["brain_age"]["ok"]   # out-of-fold estimate, no download needed
