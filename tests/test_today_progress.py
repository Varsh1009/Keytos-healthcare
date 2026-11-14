"""Progress 'Today': a single play counts right away, compared with the player's own usual."""
from datetime import date

from neurotrail import games as gym
from neurotrail import progress as prog

D = "2026-11-14"


def row(d, value, level=1, passed=False):
    return {"ts": d + "T10:00:00", "date": d, "raw": value, "value": value, "level": level,
            "passed": passed, "fmt": "levels", "classic": False}


def test_one_play_today_counts_as_starting_point():
    g = gym.GAMES[0]["id"]
    out = prog.today_section(None, {g: [row(D, 1.2)]}, [], [], today=date.fromisoformat(D))
    assert len(out["items"]) == 1
    assert out["items"][0]["verdict"] == "first"
    assert "starting point" in out["headline"]


def test_today_compared_with_own_usual():
    g = gym.GAMES[0]["id"]
    earlier = [row("2026-11-0%d" % i, 1.0) for i in range(1, 6)]
    out = prog.today_section(None, {g: earlier + [row(D, 2.1, level=2, passed=True)]}, [], [],
                             today=date.fromisoformat(D))
    it = out["items"][0]
    assert it["verdict"] == "better" and it["levels_cleared"] == [2]
    assert it["usual"] == 1.0 and it["n_before"] == 4      # first (practice) play skipped


def test_nothing_today():
    out = prog.today_section(None, {}, [], [], today=date.fromisoformat(D))
    assert out["items"] == [] and "Even one level counts" in out["headline"]


def test_overview_counts_a_single_speed_round_today(tmp_path):
    from neurotrail import db
    old = db.DB_PATH
    db.set_path(tmp_path / "t.db")
    try:
        from fastapi.testclient import TestClient
        import web.server as srv
        c = TestClient(srv.app)
        assert c.post("/api/players", json={"name": "Today Tester"}).status_code == 200
        r = c.post("/api/player/Today%20Tester/speed", json={"correct": 9, "wrong": 0, "best_combo": 9, "level": 1})
        assert r.status_code == 200, r.text
        T = c.get("/api/player/Today%20Tester/overview").json()["today"]
        assert [i["id"] for i in T["items"]] == ["speed"]
        assert T["items"][0]["verdict"] == "first"
    finally:
        db.set_path(old)


def test_voice_check_game_feeds_speech_area(tmp_path):
    """Voice Check game results (speech pace) must show in Speech & hands, not only in the games area."""
    from neurotrail import db
    old = db.DB_PATH
    db.set_path(tmp_path / "t.db")
    try:
        from fastapi.testclient import TestClient
        import web.server as srv
        c = TestClient(srv.app)
        c.post("/api/players", json={"name": "Talker"})
        m = {"speech_tempo": 4.1, "silent_pause_ratio": 0.12, "speaking_span_s": 28, "pauses": 6}
        r = c.post("/api/player/Talker/game", json={"game": "voice", "score": 88, "detail": {"finished": True, "metrics": m, "level": 1}})
        assert r.status_code == 200, r.text
        o = c.get("/api/player/Talker/overview").json()
        ids = {v["id"] for v in o["variables"] if v["group"] == "speech_hands"}
        assert "voice_speech_tempo_free" in ids
        assert [i["id"] for i in o["today"]["items"]].count("voice") == 1          # one chip, not two
    finally:
        db.set_path(old)
