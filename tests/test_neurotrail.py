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
    assert abs(scoring.lever_age(BASE)["years"]) < 1e-9
    hi = scoring.lever_age({**BASE, "sbp": 160})
    assert hi["years"] > 0 and hi["ci"][0] <= hi["years"] <= hi["ci"][1]


def test_null_factors_excluded_from_total():
    r = scoring.lever_age({**BASE, "active_min_week": 0, "sedentary_min_day": 900})
    assert abs(r["years"]) < 1e-9 and not r["per_factor"]["active_min_week"]["in_total"]


def test_brain_age_reports_noise_band():
    r = scoring.brain_age(70, True, 0.74, 1450)
    assert 18 <= r["brain_age"] <= 110 and r["sdc"] > 0


# ---------------------------------------------------------------- coach agent tools
def test_coach_tools_are_grounded():
    p = Player.create("K")
    lev = coach.run_tool(p, "get_profile_and_levers", {})
    assert lev["total_years"] == round(scoring.lever_age(p.profile())["years"], 2)
    ev = coach.run_tool(p, "get_quest_evidence", {"quest_id": "bp"})
    assert ev["evidence"][0]["url"].startswith("https://pubmed")
    coach.run_tool(p, "save_weekly_plan", {"title": "t", "items": [{"day": "Mon", "quest_id": "bp", "action": "x"}]})
    assert db.plans("K")[0]["items"][0]["quest_id"] == "bp"


def test_offline_coach_saves_plan():
    p = Player.create("O")
    p.sbp, p.onboarded = 160, True
    p.save()
    out = coach._offline(Player.load("O"), "build my weekly plan")
    assert out["source"] == "offline" and db.plans("O")


# ---------------------------------------------------------------- API
def test_api_flow():
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app)
    c.post("/api/players", json={"name": "T"})
    assert c.post("/api/player/T/complete", json={"quest": "bp"}).status_code == 409  # steps not done
    for i in range(4):
        c.post("/api/player/T/step", json={"quest": "bp", "index": i, "done": True})
    r = c.post("/api/player/T/complete", json={"quest": "bp", "value": 128})
    assert r.status_code == 200 and r.json()["gained"] == 61
    for _ in range(2):
        c.post("/api/player/T/speed", json={"correct": 30, "wrong": 2, "best_combo": 9})
    assert c.post("/api/player/T/complete", json={"quest": "speed", "value": 30}).json()["gained"] == 50
    prog = c.get("/api/player/T/progress").json()
    assert prog["totals"]["quests"] == 2 and prog["bp"][0]["value"] == 128 and len(prog["speed"]) == 2


def test_speed_sprint_levels():
    """15-second rounds: hitting the goal with >=80% accuracy unlocks the next level; old 90 s rounds don't count."""
    from neurotrail import games
    assert games.SPEED_SECONDS == 15
    assert games.speed_summary([{"correct": 40, "wrong": 0, "level": None}])["level"] == 1   # legacy round ignored
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app)
    c.post("/api/players", json={"name": "L"})
    assert c.get("/api/player/L").json()["speed"]["level"] == 1
    r = c.post("/api/player/L/speed", json={"correct": 6, "wrong": 3, "best_combo": 3}).json()   # 67% accuracy
    assert r["round"] == {"level": 1, "target": 6, "passed": False, "unlocked": None, "new_clear": False}
    assert r["speed"]["level"] == 1 and r["level_bonus"] == 0
    sparks0 = r["sparks"]
    r = c.post("/api/player/L/speed", json={"correct": 7, "wrong": 1, "best_combo": 5}).json()
    assert r["round"]["passed"] and r["round"]["unlocked"] == 2 and r["speed"]["level"] == 2
    assert r["speed"]["rule"]["symbols"] == 6 and r["rounds_today"] == 2
    assert r["level_bonus"] == 10 and r["sparks"] == sparks0 + 10        # level-up reward
    assert r["leaderboard"]["you"]["rank"] == 1 and r["leaderboard"]["n"] == 1


def test_game_levels_rewards_and_leaderboard():
    """Every game: the server picks the level, judges pass/fail, pays +10 per new level, ranks players."""
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app)
    for n in ("A", "B"):
        c.post("/api/players", json={"name": n})
    r = c.post("/api/player/A/game", json={"game": "recall", "score": 3, "detail": {"errors": 2}}).json()
    assert r["round"]["level"] == 1 and not r["round"]["passed"] and r["level_bonus"] == 0   # too many wrong taps
    r = c.post("/api/player/A/game", json={"game": "recall", "score": 3, "detail": {"errors": 0}}).json()
    assert r["round"]["passed"] and r["round"]["unlocked"] == 2 and r["level_bonus"] == 10
    assert r["stats"]["levels"]["level"] == 2 and r["sparks_gained"] == 0                   # daily +15 already paid
    r = c.post("/api/player/A/game", json={"game": "trails", "score": 12.5, "detail": {"errors": 0}}).json()
    assert r["round"]["passed"]                                                             # lower is better: 12.5 s <= 15 s
    assert not c.post("/api/player/B/game", json={"game": "trails", "score": 9,
                                                  "detail": {"errors": 0, "finished": False}}).json()["round"]["passed"]
    lb = c.get("/api/games/trails/leaderboard?player=B").json()
    assert [x["name"] for x in lb["rows"]] == ["A", "B"] and lb["you"]["rank"] == 2
    classic = c.post("/api/player/A/game", json={"game": "fluency", "score": 14, "detail": {"classic": True}}).json()
    assert classic["round"] is None                                                         # clinical version has no level


# ---------------------------------------------------------------- Brain Gym
def test_fluency_scoring_rejects_non_animals_and_repeats():
    from neurotrail import games
    r = games.score_fluency(["dog", "Dogs", "table", "butterflies", "polar bear"])
    assert r["score"] == 3 and r["unrecognized"] == ["table"]


def test_nhanes_percentile_uses_real_reference():
    from neurotrail import games
    r = games.nhanes_percentile("cerad_learning", 22, 70, True)
    assert r["n"] > 300 and 0 <= r["percentile"] <= 100


def test_game_api_awards_sparks_once_per_day():
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app)
    c.post("/api/players", json={"name": "G"})
    a = c.post("/api/player/G/game", json={"game": "stroop", "score": 30, "detail": {}}).json()
    b = c.post("/api/player/G/game", json={"game": "stroop", "score": 33, "detail": {}}).json()
    assert a["sparks_gained"] == 15 and b["sparks_gained"] == 0 and b["stats"]["best"] == 33
    r = c.post("/api/player/G/game", json={"game": "recall", "score": 22, "detail": {"comparable": True, "norm_col": "cerad_learning"}}).json()
    assert r["nhanes"]["n"] > 100


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


def test_wearable_sleep_feeds_profile():
    p = Player.create("W")
    db.put_days("W", {date.today().isoformat(): {"sleep_hours": 5.0}}, "test")
    assert Player.load("W").profile()["sleep_hours"] == 5.0


def test_fluency_audio_route_counts_spoken_animals():
    """Animal Naming by voice: upload a WAV (8 animals, Windows TTS) → Whisper on the server → counted."""
    from neurotrail import speech
    if not speech.available():
        pytest.skip("faster-whisper not installed")
    from fastapi.testclient import TestClient
    import web.server as srv
    wav = (ROOT / "tests" / "fixtures" / "animals_tts.wav").read_bytes()
    r = TestClient(srv.app).post("/api/games/fluency-audio", files={"file": ("a.wav", wav, "audio/wav")})
    assert r.status_code == 200, r.text
    assert r.json()["score"] >= 7


def test_voice_game_endpoint_scores_flow():
    """Voice Check game: the server measures flow (% time not in long pauses); slow, pausing speech scores lower."""
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app)
    flow = {}
    for k in ("fast", "slow"):
        r = c.post("/api/games/voice-analyze", files={"file": ("v.wav", (FIX / f"tts_{k}.wav").read_bytes(), "audio/wav")})
        assert r.status_code == 200, r.text
        flow[k] = r.json()["flow"]
    assert 0 <= flow["slow"] < flow["fast"] <= 100
    assert c.post("/api/games/voice-analyze", files={"file": ("v.wav", b"not audio", "audio/wav")}).status_code in (400, 422)


def test_voice_and_read_aloud_levels():
    from neurotrail import games as gym
    assert {"voice", "readaloud"} <= {g["id"] for g in gym.GAMES}
    assert gym.level_passed("voice", 1, 62, {"finished": True})
    assert not gym.level_passed("voice", 1, 90, {"finished": False})    # stopped talking early
    assert not gym.level_passed("voice", 1, 55, {"finished": True})     # too many long pauses
    p = gym.read_passage(8)
    assert p["words"] >= gym.LEVELS["readaloud"][7]["words"]
    assert gym.level_passed("readaloud", 1, gym.LEVELS["readaloud"][0]["target"], {})
