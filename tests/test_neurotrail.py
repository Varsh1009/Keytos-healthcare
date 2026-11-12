"""Unit tests: data coding, database, game logic, API, models, coach tools. Run: pytest -q"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import coach, db, nhanes, scoring  # noqa: E402
from neurotrail.quests import QUESTS, TIER_BONUS  # noqa: E402
from neurotrail.state import Player  # noqa: E402


@pytest.fixture(autouse=True)
def temp_db(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "test.db")
    yield
    db.set_path(old)


# ---------------------------------------------------------------- NHANES coding
def test_missing_codes_become_nan():
    s = pd.Series([1, 2, 7, 9])
    assert nhanes._yes(s).tolist()[:2] == [1.0, 0.0]
    assert nhanes._yes(s).isna().tolist()[2:] == [True, True]


def test_activity_minutes_zero_when_no():
    out = nhanes._minutes(pd.Series([2.0, 1.0, 1.0]), pd.Series([np.nan, 3.0, 99.0]), pd.Series([np.nan, 30.0, 30.0]))
    assert out.iloc[0] == 0 and out.iloc[1] == 90 and np.isnan(out.iloc[2])


def test_nhanes_table_is_real_and_in_range():
    t = nhanes.build_table()
    assert len(t) > 2500 and t["age"].between(60, 80).all() and t["dsst"].between(0, 133).all()


# ---------------------------------------------------------------- quests
def test_sparks_formula_and_evidence():
    for q in QUESTS:
        assert q.sparks == 20 + TIER_BONUS[q.tier] + round(5 * (q.lancet_paf or 0))
        assert q.evidence and all(e["url"].startswith("http") for e in q.evidence)
        assert len(q.steps) >= 3 and q.regions


# ---------------------------------------------------------------- database + game state
def test_player_persists_in_sqlite():
    p = Player.create("A")
    p.sbp, p.onboarded = 141.0, True
    p.save()
    q = Player.load("A")
    assert q.sbp == 141.0 and q.onboarded and db.list_players() == ["A"]


def test_any_quest_playable_and_no_double_claim():
    p = Player.create("B")
    st = p.trail_status()
    assert set(st.values()) <= {"next", "open"}
    assert p.complete("steps", 5000) > 0 and p.complete("steps", 5000) == 0
    assert Player.load("B").trail_status()["steps"] == "done"


def test_steps_tracked_per_day():
    p = Player.create("C")
    assert p.steps_today("bp") == [False] * 4
    assert p.set_step("bp", 2, True) == [False, False, True, False]


def test_streak_counts_consecutive_days():
    Player.create("S")
    for i in (0, 1, 2, 5):
        db.add_log("S", (date.today() - timedelta(days=i)).isoformat(), "bp", 120, 10, {})
    assert Player.load("S").streak() == 3


def test_recent_logs_update_profile():
    p = Player.create("R")
    p.sbp = 150
    p.save()
    db.add_log("R", date.today().isoformat(), "bp", 120, 0, {})
    assert Player.load("R").profile()["sbp"] == 120


# ---------------------------------------------------------------- models
BASE = dict(sbp=120, diabetes=0, current_smoker=0, active_min_week=150, phq9=0, sleep_hours=7, sedentary_min_day=360)


def test_lever_zero_at_targets_and_monotone_in_bp():
    assert abs(scoring.lever_age(BASE)["points"]) < 1e-9
    hi = scoring.lever_age({**BASE, "sbp": 160})
    assert hi["points"] > 0 and hi["ci"][0] <= hi["points"] <= hi["ci"][1]
    assert "years" not in hi                      # no "years older" anywhere


def test_unknown_and_null_factors_excluded_from_total():
    r = scoring.lever_age({**BASE, "sbp": None, "phq9": None, "active_min_week": 0, "sedentary_min_day": 900})
    f = r["per_factor"]
    assert abs(r["points"]) < 1e-9
    assert not f["sbp"]["known"] and f["sbp"]["size"] == "Unknown"
    assert not f["active_min_week"]["significant"] and f["active_min_week"]["size"] == "Not shown in data"


def test_brain_age_reports_noise_band():
    r = scoring.brain_age(70, True, 0.74, 1450)
    assert 18 <= r["brain_age"] <= 110 and r["sdc"] > 0


# ---------------------------------------------------------------- coach agent tools
def test_coach_tools_are_grounded():
    p = Player.create("K")
    p.sbp = 150
    p.save()
    lev = coach.run_tool(Player.load("K"), "get_profile_and_levers", {})
    assert lev["total_points"] == round(scoring.lever_age(Player.load("K").profile())["points"], 2)
    ev = coach.run_tool(p, "get_quest_evidence", {"quest_id": "bp"})
    assert ev["evidence"][0]["url"].startswith("https://pubmed")
    coach.run_tool(p, "save_weekly_plan", {"title": "t", "items": [{"day": "Mon", "quest_id": "bp", "action": "x"}]})
    assert db.plans("K")[0]["items"][0]["quest_id"] == "bp"


def test_coach_prompt_puts_988_first():
    assert "988" in coach.SYSTEM and "years older" in coach.SYSTEM   # the prompt forbids the phrase


def test_offline_coach_saves_plan():
    p = Player.create("O")
    p.sbp, p.onboarded = 160, True
    p.save()
    out = coach._offline(Player.load("O"), "build my weekly plan")
    assert out["source"] == "offline" and db.plans("O")


# ---------------------------------------------------------------- API (guest session cookie + /api/me)
def _client():
    from fastapi.testclient import TestClient
    import web.server as srv
    return TestClient(srv.app)


ONB = {"age": 68, "female": True, "diabetes": True, "current_smoker": False, "sleep_hours": 7,
       "sbp": None, "hearing_trouble": True, "feel_down": False}


def test_api_requires_session_and_blocks_direct_player_routes():
    c = _client()
    assert c.get("/api/me").status_code == 401
    name = c.post("/auth/guest", json={}).json()["name"]
    assert name.startswith("Guest")
    assert c.get(f"/api/player/{name}").status_code == 401       # no reading other people's data by name
    assert c.get("/api/me").json()["name"] == name


def test_api_flow():
    c = _client()
    c.post("/auth/guest", json={})
    snap = c.post("/api/me/onboard", json=ONB).json()
    assert snap["lever"]["per_factor"]["sbp"]["known"] is False and snap["profile"]["phq9"] is None
    r = c.post("/api/me/complete", json={"quest": "bp", "value": 128})   # one clear Done: steps are guidance
    assert r.status_code == 200 and r.json()["gained"] == 61 and r.json()["rings"]["body"]["points"] == 61
    s1 = c.post("/api/me/speed", json={"correct": 30, "wrong": 2, "best_combo": 9}).json()
    s2 = c.post("/api/me/speed", json={"correct": 34, "wrong": 1, "best_combo": 9}).json()
    assert s2["first_speed"] == 30 and s2["best_speed"] == 34 and s2["rings"]["mind"]["points"] == s1["rings"]["mind"]["points"]
    prog = c.get("/api/me/progress").json()
    assert prog["totals"]["quests"] == 1 and prog["bp"][0]["value"] == 128 and len(prog["speed"]) == 2


def test_mood_check_shows_support_at_10_or_more():
    c = _client()
    c.post("/auth/guest", json={})
    c.post("/api/me/onboard", json=ONB)
    low = c.post("/api/me/mood", json={"answers": [0, 1, 0, 1, 0, 0, 1, 0]}).json()
    high = c.post("/api/me/mood", json={"answers": [2, 2, 1, 2, 1, 1, 1, 0]}).json()
    assert low["score"] == 3 and not low["support"] and high["score"] == 10 and high["support"]
    assert high["player"]["support"]


# ---------------------------------------------------------------- Checks (games)
def test_fluency_scoring_rejects_non_animals_and_repeats():
    from neurotrail import games
    r = games.score_fluency(["dog", "Dogs", "table", "butterflies", "polar bear"])
    assert r["score"] == 3 and r["unrecognized"] == ["table"]


def test_game_api_awards_points_once_per_day_and_no_population_percentiles():
    c = _client()
    c.post("/auth/guest", json={})
    a = c.post("/api/me/game", json={"game": "stroop", "score": 30, "detail": {}}).json()
    b = c.post("/api/me/game", json={"game": "stroop", "score": 33, "detail": {}}).json()
    assert a["sparks_gained"] == 15 and b["sparks_gained"] == 0 and b["stats"]["best"] == 33
    assert not b.get("nhanes")                     # compared only with yourself


# ---------------------------------------------------------------- voice + wearables
FIX = ROOT / "tests" / "fixtures"   # macOS text-to-speech recordings (test fixtures only)


def test_voice_measures_respond_to_slower_speech_with_pauses():
    from neurotrail import voice
    fast = voice.analyze(*voice.load_wav((FIX / "tts_fast.wav").read_bytes()))
    slow = voice.analyze(*voice.load_wav((FIX / "tts_slow.wav").read_bytes()))
    assert slow["speech_tempo"] < fast["speech_tempo"]
    assert slow["silent_pause_ratio"] > fast["silent_pause_ratio"] and slow["pauses"] >= 3


def test_apple_health_parse_dedupes_sources_and_ignores_in_bed():
    import io
    from neurotrail import wearables
    xml = b'''<HealthData>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-11-09 08:00:00 -0500" endDate="2026-11-09 09:00:00 -0500" value="3000"/>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" startDate="2026-11-09 08:00:00 -0500" endDate="2026-11-09 09:00:00 -0500" value="3500"/>
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-11-08 23:30:00 -0500" endDate="2026-11-09 06:30:00 -0500" value="HKCategoryValueSleepAnalysisAsleepCore"/>
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-11-08 22:00:00 -0500" endDate="2026-11-08 23:30:00 -0500" value="HKCategoryValueSleepAnalysisInBed"/>
</HealthData>'''
    d = wearables.parse_apple(io.BytesIO(xml))["2026-11-09"]
    assert d["steps"] == 3500 and d["sleep_hours"] == 7.0


def test_watch_sleep_is_display_only():
    p = Player.create("W")
    p.sleep_hours = 7.0
    p.save()
    db.put_days("W", {date.today().isoformat(): {"sleep_hours": 5.0}}, "test")
    assert Player.load("W").profile()["sleep_hours"] == 7.0   # model was trained on self-report


# ---------------------------------------------------------------- brain atlas + MRI honesty
def test_disease_atlas_regions_resolve_and_cite_pubmed():
    from neurotrail import diseases, regions as R
    ids = {r["id"] for r in R.regions()}
    for d in diseases.catalog():
        assert d["source"][1].startswith("https://pubmed.ncbi.nlm.nih.gov/")
        assert d["group"] in {"lower", "live", "early"} and d["doctor"]
        for st in d["stages"]:
            assert st["regions"] and set(st["regions"]) <= ids


def test_failed_mri_measures_are_not_shown():
    import json
    t = json.loads((ROOT / "models" / "artifacts" / "tissue_norms.json").read_text())
    for k, m in t["measures"].items():
        if k != "nWBV":
            assert m["shown"] is False and (m["auc"] < 0.70 or m["icc"] < 0.90)


def test_facts_match_artifacts():
    import json
    f = json.loads((ROOT / "models" / "artifacts" / "facts.json").read_text())
    tv = f["teaching_view"]
    assert f["oasis"]["volumes"] == 436 and len(f["removed"]) == 5
    assert tv["healthy60_flag_pct"] < tv["dementia_flag_pct"] < 50   # one MRI number can't screen


def test_mri_samples_do_not_expose_cnn_brain_age():
    c = _client()
    rows = c.get("/api/mri/samples").json()
    assert rows and all("brain_age" not in r for r in rows)
