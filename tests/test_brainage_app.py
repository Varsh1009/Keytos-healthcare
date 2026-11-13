"""Brain age in the app: guarded output, out-of-fold samples, uploads (model call stubbed for speed)."""
from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import brainage_ensemble as be, db, mri  # noqa: E402
import web.server as srv  # noqa: E402

pytestmark = pytest.mark.skipif(not be.available(), reason="needs the trained brain-age models")


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    yield
    db.set_path(old)


def _res(**kw):
    base = {"format": {"ok": True}, "brain_age": 71.0, "interval_low": 60.0, "interval_high": 82.0, "confidence": "medium",
            "confidence_reasons": ["95% interval is moderate (22 years)"], "model_disagreement": 4.0,
            "per_model": [{"label": "A", "brain_age": 70.0}, {"label": "B", "brain_age": 72.0}]}
    return base | kw


def test_guard_shows_sane_estimates_with_context():
    v = srv.brain_age_view(_res(), 68.0)
    assert v["ok"] and v["brain_age"] == 71.0 and v["within_range"] and v["difference"] == 3.0


@pytest.mark.parametrize("bad", [
    {"per_model": [{"label": "SFCN", "brain_age": 6.07e12}, {"label": "B", "brain_age": 40.0}]},   # the real failure we saw
    {"brain_age": float("nan")},
    {"interval_low": -40.0, "interval_high": 140.0},
    {"interval_low": 30.0, "interval_high": 100.0},                                                  # range wider than 60 years
])
def test_guard_refuses_implausible_results(bad):
    v = srv.brain_age_view(_res(**bad), 68.0)
    assert v["ok"] is False and "implausible" in v["reason"]


def test_guard_refuses_wrong_format():
    assert srv.brain_age_view({"format": {"ok": False}}, 68.0)["ok"] is False


def _client():
    from fastapi.testclient import TestClient
    c = TestClient(srv.app, base_url="http://localhost:8600")
    c.post("/auth/guest", json={})
    return c


def test_research_samples_work_without_the_download():
    c = _client()
    s = c.get("/api/mri/samples").json()
    r = c.post("/api/me/mri/sample", data={"file": s[0]["file"]}).json()
    b = r["brain_age"]
    assert b["ok"] and b["real_age"] == r["age"] and len(b["per_model"]) == 3 and b["low"] < b["brain_age"] < b["high"]


def test_accuracy_card_reports_the_over_60_comparison():
    card = _client().get("/api/mri/brainage-card").json()
    assert card["available"] and card["mae_60"] < card["guess_60"] and 0.6 < card["auc"] < 0.8


def _nifti():
    import nibabel as nib
    v = np.zeros(mri.SHAPE, np.float32)
    v[20:70, 20:90, 20:70] = 1
    return io.BytesIO(nib.Nifti1Image(v, np.eye(4)).to_bytes())


@pytest.mark.parametrize("pred,ok", [(66.0, True), (6.07e12, False)])
def test_upload_runs_the_ensemble_and_is_guarded(monkeypatch, pred, ok):
    monkeypatch.setattr(mri, "check_format", lambda v: {"ok": True, "issues": [], "similarity": 0.6})
    monkeypatch.setattr(be, "estimate", lambda v, age, fold=None: _res(brain_age=pred, per_model=[{"label": "A", "brain_age": pred}]) | {"_cam": None})
    r = _client().post("/api/me/mri/upload", files={"file": ("scan.nii", _nifti(), "application/octet-stream")}).json()
    assert r["brain_age"]["ok"] is ok and r["brain_age"].get("real_age", 65.0) == 65.0
