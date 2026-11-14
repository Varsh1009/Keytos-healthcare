"""Watch import (Apple, Fitbit, live sync) and the combined Progress page."""
from __future__ import annotations

import io
import json
import sys
import zipfile
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurotrail import db, progress, wearables  # noqa: E402

APPLE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Rohini's iPhone" unit="count" startDate="2026-11-01 08:00:00 -0500" endDate="2026-11-01 09:00:00 -0500" value="3000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Rohini's Apple Watch" unit="count" startDate="2026-11-01 08:00:00 -0500" endDate="2026-11-01 09:00:00 -0500" value="3200">
  <MetadataEntry key="HKMetadataKeySyncVersion" value="1"/>
 </Record>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Rohini's Apple Watch" unit="count" startDate="2026-11-01 17:00:00 -0500" endDate="2026-11-01 18:00:00 -0500" value="1800"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-11-01 23:00:00 -0500" endDate="2026-11-02 03:00:00 -0500"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAwake" startDate="2026-11-02 03:00:00 -0500" endDate="2026-11-02 03:30:00 -0500"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" value="HKCategoryValueSleepAnalysisAsleepDeep" startDate="2026-11-02 03:30:00 -0500" endDate="2026-11-02 06:30:00 -0500"/>
 <Record type="HKQuantityTypeIdentifierWalkingSpeed" sourceName="iPhone" unit="km/hr" startDate="2026-11-01 08:00:00 -0500" endDate="2026-11-01 08:01:00 -0500" value="4.5"/>
 <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Watch" unit="%" startDate="2026-11-01 02:00:00 -0500" endDate="2026-11-01 02:00:00 -0500" value="0.97"/>
 <Record type="HKQuantityTypeIdentifierHeadphoneAudioExposure" sourceName="AirPods" unit="dBASPL" startDate="2026-11-01 10:00:00 -0500" endDate="2026-11-01 11:00:00 -0500" value="70"/>
 <Record type="HKQuantityTypeIdentifierHeadphoneAudioExposure" sourceName="AirPods" unit="dBASPL" startDate="2026-11-01 12:00:00 -0500" endDate="2026-11-01 13:00:00 -0500" value="80"/>
 <Audiogram type="HKDataTypeIdentifierAudiogram" sourceName="AirPods Pro" startDate="2026-11-01 12:00:00 -0500" endDate="2026-11-01 12:10:00 -0500">
  <SensitivityPoint frequencyValue="500" frequencyUnit="Hz" leftEarValue="10" leftEarUnit="dBHL" rightEarValue="20" rightEarUnit="dBHL"/>
  <SensitivityPoint frequencyValue="1000" frequencyUnit="Hz" leftEarValue="10" leftEarUnit="dBHL" rightEarValue="20" rightEarUnit="dBHL"/>
  <SensitivityPoint frequencyValue="2000" frequencyUnit="Hz" leftEarValue="15" leftEarUnit="dBHL" rightEarValue="25" rightEarUnit="dBHL"/>
  <SensitivityPoint frequencyValue="4000" frequencyUnit="Hz" leftEarValue="25" leftEarUnit="dBHL" rightEarValue="35" rightEarUnit="dBHL"/>
  <SensitivityPoint frequencyValue="8000" frequencyUnit="Hz" leftEarValue="40" leftEarUnit="dBHL" rightEarValue="50" rightEarUnit="dBHL"/>
 </Audiogram>
</HealthData>"""


@pytest.fixture(autouse=True)
def tmp_db(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    yield
    db.set_path(old)


def test_apple_export_parses_all_new_fields():
    days = wearables.parse_apple(io.BytesIO(APPLE_XML.encode()))
    d1 = days["2026-11-01"]
    assert d1["steps"] == 5000                    # watch (3200+1800) kept, iPhone's 3000 not added on top
    assert abs(d1["walking_speed"] - 1.25) < 0.01  # km/h → m/s
    assert d1["spo2"] == 97.0                       # fraction → %
    assert 77 < d1["headphone_db"] < 78            # energy average of 70 & 80 dB, not 75
    assert d1["hearing_pta_db"] == 15.0            # better (left) ear: mean of 10,10,15,25
    assert days["2026-11-02"]["sleep_hours"] == 7.0  # awake segment excluded, night assigned to wake-up date


def test_zip_and_fitbit_and_csv():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("apple_health_export/export.xml", APPLE_XML)
    assert "2026-11-01" in wearables.parse_upload(buf.getvalue(), "export.zip")

    fb = io.BytesIO()
    with zipfile.ZipFile(fb, "w") as z:
        z.writestr("Takeout/Fitbit/Global Export Data/steps-2026-11-01.json",
                   json.dumps([{"dateTime": "11/01/26 08:00:00", "value": "40"}, {"dateTime": "11/01/26 08:01:00", "value": "60"}]))
        z.writestr("Takeout/Fitbit/Global Export Data/sleep-2026-11-01.json",
                   json.dumps([{"dateOfSleep": "2026-11-02", "minutesAsleep": 420, "mainSleep": True}]))
        z.writestr("Takeout/Fitbit/Global Export Data/resting_heart_rate-2026-11-01.json",
                   json.dumps([{"dateTime": "11/01/26 00:00:00", "value": {"date": "11/01/26", "value": 61.5, "error": 6.7}}]))
    d = wearables.parse_upload(fb.getvalue(), "takeout.zip")
    assert d["2026-11-01"]["steps"] == 100 and d["2026-11-02"]["sleep_hours"] == 7.0 and d["2026-11-01"]["resting_hr"] == 61.5

    c = wearables.parse_csv("Date,Steps,Sleep,RHR,vo2_max\n2026-11-01,8000,7.5,60,38\n2026-11-02,999999,7,61,\n")
    assert c["2026-11-01"] == {"steps": 8000, "sleep_hours": 7.5, "resting_hr": 60, "vo2max": 38}
    assert "steps" not in c["2026-11-02"]          # impossible value dropped


def test_health_auto_export_json():
    hae = {"data": {"metrics": [
        {"name": "step_count", "units": "count", "data": [{"date": "2026-11-01 00:00:00 -0500", "qty": 6543}]},
        {"name": "walking_speed", "units": "mi/hr", "data": [{"date": "2026-11-01 00:00:00 -0500", "qty": 3.0}]},
        {"name": "sleep_analysis", "units": "hr", "data": [{"date": "2026-11-02 00:00:00 -0500", "totalSleep": 6.8}]}]}}
    d = wearables.parse_json(hae)
    assert d["2026-11-01"]["steps"] == 6543 and abs(d["2026-11-01"]["walking_speed"] - 1.34) < 0.01
    assert d["2026-11-02"]["sleep_hours"] == 6.8
    assert wearables.parse_json([{"date": "2026-11-03", "steps": 100, "junk": "x"}]) == {"2026-11-03": {"steps": 100.0}}


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from web.server import app
    return TestClient(app)


def test_live_sync_needs_token(client):
    client.post("/api/players", json={"name": "Ada"})
    s = client.get("/api/player/Ada/wearables/sync").json()
    body = {"days": {"2026-11-01": {"steps": 4321}}}
    assert client.post(s["url"].split("testserver")[1], json=body).status_code == 401
    assert client.post("/api/player/Ada/wearables/sync", json=body, headers={"X-Sync-Token": "nope"}).status_code == 401
    r = client.post("/api/player/Ada/wearables/sync", json=body, headers={"X-Sync-Token": s["token"]})
    assert r.status_code == 200 and r.json()["imported_days"] == 1
    assert db.days("Ada")["2026-11-01"]["steps"] == 4321
    # rotating the token locks out the old one
    new = client.get("/api/player/Ada/wearables/sync?rotate=true").json()["token"]
    assert client.post("/api/player/Ada/wearables/sync", json=body, headers={"X-Sync-Token": s["token"]}).status_code == 401
    assert client.post("/api/player/Ada/wearables/sync", json=body, headers={"X-Sync-Token": new}).status_code == 200


def _seed_watch(name: str, n: int, steps0: float, steps1: float):
    t0 = date.today() - timedelta(days=n - 1)
    days = {}
    for i in range(n):
        s = steps0 if i < n // 2 else steps1
        days[(t0 + timedelta(days=i)).isoformat()] = {"steps": s + (i % 3) * 50, "sleep_hours": 7 + (i % 2) * 0.2,
                                                      "resting_hr": 64.0}
    db.put_days(name, days, "test")


def test_overview_combines_sources_with_rules(client):
    client.post("/api/players", json={"name": "Bo"})
    _seed_watch("Bo", 50, 3000, 6000)
    for sc in [10, 30, 31, 30, 32, 33, 35, 36]:      # big practice jump on play 2, then gentle improvement
        client.post("/api/player/Bo/game", json={"game": "stroop", "score": sc, "detail": {"classic": True}})
    db.add_mri("Bo", "OASIS sample OAS1_0001", 70, 75, 5, True)    # a sample scan is not theirs
    ov = client.get("/api/player/Bo/overview").json()
    V = {v["id"]: v for v in ov["variables"]}

    assert V["steps"]["status"] == "improving" and V["steps"]["source"] == "watch"
    assert V["resting_hr"]["status"] == "steady"
    g = V["game_stroop"]
    assert g["practice_skipped"] == 1 and g["baseline"] == 30   # the practice play (10) never forms the baseline
    assert g["status"] == "improving"
    assert V["game_recall"]["status"] == "none"                  # never played: listed, no trend
    assert V["mri_gap"]["status"] == "none" and "sample" in V["mri_gap"]["note"]
    assert ov["summary"]["improving"] >= 2
    cov = {c["id"]: c for c in ov["coverage"]}
    assert cov["watch"]["ok"] and not cov["mri"]["ok"]


def test_overview_building_and_stale(client):
    client.post("/api/players", json={"name": "Cy"})
    _seed_watch("Cy", 10, 5000, 5000)
    V = {v["id"]: v for v in client.get("/api/player/Cy/overview").json()["variables"]}
    assert V["steps"]["status"] == "building" and "more days" in V["steps"]["need"]
    old = {(date.today() - timedelta(days=100 + i)).isoformat(): {"vo2max": 35.0} for i in range(60)}
    db.put_days("Cy", old, "old")                 # VO2 max stopped syncing 100 days ago
    V = {v["id"]: v for v in client.get("/api/player/Cy/overview").json()["variables"]}
    assert V["vo2max"]["status"] == "stale" and V["vo2max"]["stale_days"] == 100


def test_percentile_uses_nhanes_norms():
    if not progress._norms():
        pytest.skip("run models/train_wearable.py first")
    lo = progress.percentile("steps_day", 2000, 72, True)
    hi = progress.percentile("steps_day", 12000, 72, True)
    assert lo["percentile"] < 25 < 75 < hi["percentile"] and lo["group"] == "women 70–79"


def test_hearing_tests_are_snapshots_then_compared(client):
    client.post("/api/players", json={"name": "Di"})
    db.put_days("Di", {"2026-01-10": {"hearing_pta_db": 18.0}}, "AirPods")
    V = {v["id"]: v for v in client.get("/api/player/Di/overview").json()["variables"]}
    assert V["hearing_pta_db"]["status"] == "snapshot"
    db.put_days("Di", {"2026-10-10": {"hearing_pta_db": 33.0}}, "AirPods")      # 15 dB worse, beyond retest noise
    V = {v["id"]: v for v in client.get("/api/player/Di/overview").json()["variables"]}
    assert V["hearing_pta_db"]["status"] == "slipping" and V["hearing_pta_db"]["change"] == 15.0


def test_moving_up_levels_counts_as_progress(client):
    """Harder levels give lower raw scores; the difficulty-adjusted score must still go UP."""
    client.post("/api/players", json={"name": "Ed"})
    for sc in [7, 8, 9, 10, 11]:                     # passes each level in turn (targets 6, 7, 8, 9, 10)
        client.post("/api/player/Ed/game", json={"game": "stroop", "score": sc, "detail": {"correct": sc, "wrong": 0}})
    from neurotrail import progress as prog
    rows = prog.game_rows(type("P", (), {"name": "Ed"}), "stroop")
    assert [r["level"] for r in rows] == [1, 2, 3, 4, 5] and all(r["fmt"] == "levels" for r in rows)
    assert [round(r["value"], 2) for r in rows] == sorted(round(r["value"], 2) for r in rows)
    V = {v["id"]: v for v in client.get("/api/player/Ed/overview").json()["variables"]}
    assert V["game_stroop"]["status"] == "improving" and V["game_stroop"]["level_reached"] == 5
    ov = client.get("/api/player/Ed/overview").json()
    assert ov["combined"]["overall"] > 0                          # shows on the one combined line
    assert any("cleared level 5" in t for u in ov["updates"] for t in u["tags"])   # and in the updates feed


def test_a_few_plays_already_show(client):
    client.post("/api/players", json={"name": "Gus"})
    for sc in [300, 280, 270]:                       # 3 classic Reflex plays (lower is better)
        client.post("/api/player/Gus/game", json={"game": "reaction", "score": sc, "detail": {"classic": True}})
    ov = client.get("/api/player/Gus/overview").json()
    assert ov["combined"]["overall"] is not None and ov["combined"]["daily"]
    assert len([u for u in ov["updates"] if u["text"].startswith("Reflex")]) == 3


def test_sample_watch_data_load_refuse_remove(client):
    client.post("/api/players", json={"name": "Fay"})
    r = client.post("/api/player/Fay/wearables/sample").json()
    assert r["imported_days"] >= 90 and r["is_sample"]
    assert max(db.days("Fay")) == date.today().isoformat()          # shifted to end today
    ov = client.get("/api/player/Fay/overview").json()
    assert ov["sample_watch"] and ov["combined"]["overall"] is not None
    assert client.delete("/api/player/Fay/wearables/sample").json()["removed_days"] >= 90
    assert db.days("Fay") == {}
    db.put_days("Fay", {"2026-11-01": {"steps": 5000}}, "export.zip")   # real data → sample refused
    assert client.post("/api/player/Fay/wearables/sample").status_code == 409



def test_eeg_samples_and_uploads(client):
    from pathlib import Path
    smp = client.get("/api/eeg/samples").json()
    if not smp:
        pytest.skip("EEG samples not downloaded")
    client.post("/api/players", json={"name": "Hal"})
    r = client.post("/api/player/Hal/eeg/sample", data={"file": smp[0]["file"]}).json()
    assert 7 <= r["paf_hz"] <= 13 and r["sample"]
    data = (ROOT / "data" / "raw" / "eeg_samples" / smp[1]["file"]).read_bytes()
    r = client.post("/api/player/Hal/eeg/upload", files={"file": ("mine.edf", data)}).json()
    assert len(r["history"]) == 1                                 # only the upload is "yours"
    V = {v["id"]: v for v in client.get("/api/player/Hal/overview").json()["variables"]}
    assert V["eeg_paf"]["status"] == "snapshot"
    assert client.post("/api/player/Hal/eeg/upload", files={"file": ("x.edf", b"not an edf")}).status_code == 422
