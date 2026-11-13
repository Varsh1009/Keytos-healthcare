"""MRI endpoint returns the upgraded fields (interval, confidence, per-model estimates). Needs the OASIS
scans (data/download_data.py) and trained models; skipped otherwise."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurotrail import brainage_ensemble as be, db  # noqa: E402

MRI_DIR = ROOT / "data" / "raw" / "oasis_mri"
pytestmark = pytest.mark.skipif(not (any(MRI_DIR.glob("**/*.nii")) and be.available()),
                                reason="needs OASIS MRI scans and trained brain-age models")
FIELDS = {"brain_age", "chronological_age", "gap", "interval_low", "interval_high", "confidence",
          "confidence_reasons", "per_model", "images"}


@pytest.fixture()
def client(tmp_path):
    from fastapi.testclient import TestClient
    import web.server as srv
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    c = TestClient(srv.app)
    c.post("/api/players", json={"name": "M"})
    yield c
    db.set_path(old)


def _sample(status: str) -> pd.Series:
    d = pd.read_csv(ROOT / "models" / "artifacts" / "mri_cnn_predictions.csv")
    return d[(d["status"] == status) & (d["session"] == "MR1")].iloc[0]


def _check(r: dict) -> None:
    assert FIELDS <= set(r), FIELDS - set(r)
    assert r["interval_low"] < r["brain_age"] < r["interval_high"]
    assert r["confidence"] in ("high", "medium", "low") and r["confidence_reasons"]
    assert {p["model"] for p in r["per_model"]} == set(be.config(be.MRI_MODEL)["models"])
    assert set(r["images"]) == {"axial", "coronal", "sagittal"}


def test_mri_sample_dementia_returns_interval_confidence_and_per_model(client):
    s = _sample("dementia (CDR≥0.5)")
    r = client.post("/api/player/M/mri/sample", data={"file": s["file"]})
    assert r.status_code == 200, r.text
    r = r.json()
    _check(r)
    assert r["chronological_age"] == s["Age"]
    assert r["gap_low"] < r["gap"] < r["gap_high"]


def test_mri_sample_normal_uses_only_held_out_fold(client):
    s = _sample("cognitively normal")
    r = client.post("/api/player/M/mri/sample", data={"file": s["file"]}).json()
    _check(r)
    from neurotrail.mri import heldout_fold
    k = heldout_fold(s["file"])
    assert k is not None
    for p in r["per_model"]:   # only that fold's checkpoints (1 per fold, or 3 seeds for the 2 mm CNN)
        assert p["n_models"] == sum(1 for kk, _ in be.members(p["model"]) if kk == k)
    oof = pd.read_csv(ROOT / "results" / f"oof_{be.config_name(be.MRI_MODEL)}.csv").set_index("scan_id")
    assert r["brain_age"] == pytest.approx(oof.loc[s["ID"], "pred_age"], abs=0.5)   # same as the validated OOF value


def test_mri_upload_matches_sample_path(client):
    s = _sample("dementia (CDR≥0.5)")
    f = next(MRI_DIR.glob(f"**/{s['file']}"))
    up = client.post("/api/player/M/mri/upload", files={"file": (f.name, f.read_bytes())}, data={"age": str(s["Age"])})
    assert up.status_code == 200, up.text
    up = up.json()
    _check(up)
    smp = client.post("/api/player/M/mri/sample", data={"file": s["file"]}).json()
    assert up["brain_age"] == pytest.approx(smp["brain_age"], abs=1e-3)


def test_mri_comparison_endpoint(client):
    c = client.get("/api/mri/comparison").json()
    assert {"baseline_4mm", "ensemble"} <= {row["model"] for row in c["rows"]}
    assert c["rules"]["high_width"] < c["rules"]["low_width"]
