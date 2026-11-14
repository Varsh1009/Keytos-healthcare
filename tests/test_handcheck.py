"""Hand check analysis on synthetic hands with known tremor, fist and tapping patterns.

A 21-point hand (MediaPipe layout) is animated at a realistic, slightly uneven webcam frame rate,
with landmark jitter like a real tracker, then sent through the same code the server runs.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from neurotrail import db, handcheck as hc  # noqa: E402

RNG = np.random.default_rng(4)
ASPECT = 4 / 3
SCALE = 0.15                       # palm = 15% of the image height (hand ~40 cm from a laptop camera)
MM = hc.PALM_MM


def hand(fist=0.0, gap=1.0):
    """Hand landmarks in palm units (wrist at 0,0, fingers up). fist: 0 open → 1 closed; gap: thumb-index opening 1 → 0 touching."""
    P = np.zeros((21, 2))
    P[0] = (0, 0)
    P[1:5] = [(-0.3, -0.2), (-0.55, -0.42), (-0.72, -0.62), (-0.85, -0.85)]          # thumb
    for j, (x, base) in enumerate([(-0.35, 1), (0.0, 1), (0.3, 1), (0.55, 1)]):
        mcp = np.array([x, -0.95 if j != 1 else -1.0])
        open_pts = [mcp + (0, -0.4), mcp + (0, -0.7), mcp + (0, -0.92)]
        closed_pts = [mcp + (0, -0.25), mcp + (0, 0.05), mcp + (0, 0.2)]               # curled into the palm
        P[5 + 4 * j] = mcp
        for k in range(3):
            P[6 + 4 * j + k] = (1 - fist) * np.array(open_pts[k]) + fist * np.array(closed_pts[k])
    touch = np.array([-0.6, -1.25])
    P[4] = gap * P[4] + (1 - gap) * touch                                               # thumb tip
    P[8] = gap * P[8] + (1 - gap) * (touch + (0.02, -0.03))                             # index tip
    return P


def record(fn, secs=10.0, fps=30.0, jitter=0.0015, drop=0.0):
    """fn(t) -> (fist, gap, dx_mm, dy_mm). Returns t (ms) and per-frame landmark lists (image coords)."""
    t, lm, now = [], [], 0.0
    while now < secs:
        f, g, dx, dy = fn(now)
        pts = hand(f, g) * SCALE
        pts[:, 0] = pts[:, 0] / ASPECT + 0.5 + dx / MM * SCALE / ASPECT
        pts[:, 1] = pts[:, 1] + 0.7 + dy / MM * SCALE
        pts = pts + RNG.normal(0, jitter, pts.shape)
        t.append(now * 1000)
        lm.append(None if RNG.random() < drop else pts.round(5).tolist())
        now += 1 / fps * RNG.uniform(0.85, 1.15)                                       # uneven webcam timing
    return t, lm


# ---------------------------------------------------------------- tremor
def test_still_hand_shows_no_tremor():
    t, lm = record(lambda s: (0, 1, 0.4 * np.sin(0.7 * s), 0.3 * s))                  # slow drift + jitter only
    r = hc.analyze_steady(t, lm, ASPECT)
    assert not r["tremor"] and r["amplitude_mm"] < hc.MIN_TREMOR_MM


@pytest.mark.parametrize("hz,p2p,grade", [(4.5, 6.0, "slight"), (5.5, 18.0, "mild"), (8.0, 4.0, "slight"), (9.5, 40.0, "moderate")])
def test_tremor_frequency_and_size(hz, p2p, grade):
    t, lm = record(lambda s: (0, 1, p2p / 2 * np.sin(2 * np.pi * hz * s), 0.2 * p2p / 2 * np.sin(2 * np.pi * hz * s + 1)))
    r = hc.analyze_steady(t, lm, ASPECT)
    true_p2p = p2p * np.sqrt(1 + 0.04)                                                  # x plus a small y component
    assert r["tremor"] and abs(r["frequency_hz"] - hz) <= 0.3, r
    assert abs(r["amplitude_mm"] - true_p2p) / true_p2p < 0.25, r
    assert r["updrs_amplitude"] == grade


def test_tremor_at_a_low_camera_frame_rate():
    t, lm = record(lambda s: (0, 1, 5 * np.sin(2 * np.pi * 5 * s), 0), fps=15)
    r = hc.analyze_steady(t, lm, ASPECT)
    assert r["tremor"] and abs(r["frequency_hz"] - 5) <= 0.3 and r["max_hz"] <= 6.75


def test_lost_hand_is_an_error_not_a_result():
    t, lm = record(lambda s: (0, 1, 0, 0), drop=0.97)
    with pytest.raises(hc.HandDataError):
        hc.analyze_steady(t, lm, ASPECT)


# ---------------------------------------------------------------- fist
def cyc(hz, s, start=0.0):
    return 0.5 - 0.5 * np.cos(2 * np.pi * hz * (s - start))


def test_full_fists_are_counted_and_complete():
    t, lm = record(lambda s: (cyc(1.2, s), 1, 0, 0))
    r = hc.analyze_fist(t, lm, ASPECT)
    assert r["count"] == 12 and r["complete"] == 12 and r["decrement_pct"] < 10 and r["hesitations"] == 0, r


def test_half_closed_fists_are_flagged_as_incomplete():
    t, lm = record(lambda s: (0.45 * cyc(1.2, s), 1, 0, 0))
    r = hc.analyze_fist(t, lm, ASPECT)
    assert r["count"] >= 10 and r["complete"] == 0 and r["not_closed"] == r["count"]
    assert any("didn't close and open fully" in f["text"] for f in hc.flags({"fist": r}))


def test_fists_that_fade_show_decrement():
    t, lm = record(lambda s: (cyc(1.2, s) * (1 - 0.06 * s), 1, 0, 0))                  # ~55% smaller by the end
    r = hc.analyze_fist(t, lm, ASPECT)
    assert r["decrement_pct"] >= 30, r
    assert any("smaller by the end" in f["text"] for f in hc.flags({"fist": r}))


# ---------------------------------------------------------------- tapping
def taps_with_pauses(s):
    pauses = [(3.0, 3.8), (5.5, 6.3), (8.0, 8.8)]
    shift = sum(min(max(s - a, 0), b - a) for a, b in pauses)
    if any(a <= s < b for a, b in pauses):
        return 0, 1, 0, 0                                                             # frozen with fingers open
    return 0, 1 - cyc(3.0, s - shift), 0, 0


def test_tapping_rate_and_contact():
    t, lm = record(lambda s: (0, 1 - cyc(3.5, s), 0, 0))
    r = hc.analyze_tap(t, lm, ASPECT)
    assert r["count"] == 35 and r["complete"] >= 33 and abs(r["rate_hz"] - 3.5) < 0.2, r
    assert r["hesitations"] == 0 and r["decrement_pct"] < 10


def test_tapping_hesitations_are_counted():
    t, lm = record(taps_with_pauses)
    r = hc.analyze_tap(t, lm, ASPECT)
    assert r["hesitations"] == 3, r
    assert any("pauses" in f["text"] for f in hc.flags({"tap": r}))


def test_taps_that_never_touch_are_incomplete():
    t, lm = record(lambda s: (0, 1 - 0.45 * cyc(3.0, s), 0, 0))
    r = hc.analyze_tap(t, lm, ASPECT)
    assert r["count"] >= 25 and r["complete"] == 0


# ---------------------------------------------------------------- API
@pytest.fixture
def client(tmp_path):
    old = db.DB_PATH
    db.set_path(tmp_path / "t.db")
    from fastapi.testclient import TestClient
    import web.server as srv
    c = TestClient(srv.app)
    c.post("/api/players", json={"name": "Hands"})
    yield c
    db.set_path(old)


def test_api_analyzes_saves_and_compares_hands(client):
    steady = record(lambda s: (0, 1, 3 * np.sin(2 * np.pi * 5 * s), 0))
    fist = record(lambda s: (cyc(1.2, s), 1, 0, 0))
    tap = record(lambda s: (0, 1 - cyc(3.5, s), 0, 0))
    body = {"hand": "right", "aspect": ASPECT, "tasks": {k: {"t": v[0], "lm": v[1]} for k, v in
                                                          {"steady": steady, "fist": fist, "tap": tap}.items()}}
    r = client.post("/api/player/Hands/hands", json=body).json()
    assert r["results"]["steady"]["tremor"] and r["results"]["tap"]["count"] == 35 and not r["errors"]
    body["hand"] = "left"
    client.post("/api/player/Hands/hands", json=body)
    h = client.get("/api/player/Hands/hands").json()
    assert [x["hand"] for x in h["history"]] == ["right", "left"] and abs(h["history"][0]["tap_rate"] - 3.5) < 0.1
    assert "signal" not in h["history"][0]["results"]["tap"]                         # raw signals aren't stored


def test_api_rejects_a_bad_hand_label(client):
    assert client.post("/api/player/Hands/hands", json={"hand": "middle", "tasks": {}}).status_code == 422
