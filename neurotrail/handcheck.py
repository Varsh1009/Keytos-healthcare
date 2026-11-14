"""Hand check: tremor, fist open/close and finger tapping, analyzed from camera hand landmarks.

The browser tracks 21 hand landmarks per frame (MediaPipe Hand Landmarker) and uploads them with
their timestamps. Everything below runs on the server:

* steady  - arm out, fingers spread, 10 s. Tremor = rhythmic movement of the hand between
            3.5 and 12 Hz. We report its frequency, its size in mm and the MDS-UPDRS 3.15
            amplitude band (slight < 1 cm, mild 1-3 cm, moderate 3-10 cm, severe >= 10 cm).
* fist    - open and close the hand as fast and fully as possible (MDS-UPDRS 3.5).
* tap     - tap index finger on thumb as fast and as big as possible (MDS-UPDRS 3.4).
            For both: count, rate, whether each movement was complete, rhythm, hesitations,
            and decrement (movements getting smaller), the signs a clinician looks for.

Fist and tap shapes use the model's 3D hand points ("world landmarks"), normalized by the hand's own
palm (wrist to middle-finger knuckle), so neither the distance to the camera nor a tilted hand changes
them. On 16 real photos, a fist seen at an angle read 1.95 in 2D (looks open) but 1.26 in 3D (closed).
Tremor uses the 2D image points, converted to mm with the person's own 3D palm size. A camera cannot
diagnose anything: flags mean "worth showing a doctor if it keeps happening".
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks, welch

PALM_MM = 95.0                     # wrist to middle-finger knuckle, adult average (approximate)
WRIST, THUMB_TIP, INDEX_TIP = 0, 4, 8
KNUCKLES = [5, 9, 13, 17]
TIPS = [8, 12, 16, 20]
TREMOR_BAND = (3.5, 12.0)
MIN_FPS = 15.0                     # below this, fast taps and tremor can be missed
MIN_TREMOR_MM = 2.0                # smaller than this is within camera noise
MIN_PEAK_RATIO = 6.0               # tremor must stand out of the spectrum (rhythmic, not noise)
# Thresholds, set from real photos run through the same model (fingertip-to-wrist / palm, thumb-to-index / palm):
#   3D: open hands 1.67-1.90, fists 0.83-1.26, thumb-index touching 0.24-0.31, open 0.70-1.19
#   2D: open hands 1.64-2.12, fists 0.80-0.86, thumb-index touching 0.12-0.19 (fallback when no 3D points)
FIST_CLOSED, FIST_OPEN = {"3d": 1.3, "2d": 1.2}, {"3d": 1.5, "2d": 1.5}
TAP_TOUCH, TAP_OPEN = {"3d": 0.4, "2d": 0.35}, {"3d": 0.6, "2d": 0.6}
UPDRS_AMPLITUDE = [(10.0, "slight"), (30.0, "mild"), (100.0, "moderate"), (float("inf"), "severe")]


class HandDataError(ValueError):
    """Not enough tracked frames to analyze."""


# ---------------------------------------------------------------- frames → uniform signals
def _frames(t, lm, aspect: float, wl=None):
    """t (ms); lm: per frame 21 [x, y] (image-normalized) or None; wl: per frame 21 [x, y, z] in metres or None.
    Returns valid t (s), image points (n, 21, 2), 3D points (n, 21, 3) or None, share of frames tracked."""
    t = np.asarray(t, float)
    has3d = wl is not None and len(wl) == len(lm)
    ok = np.array([f is not None and len(f) == 21 and (not has3d or (w is not None and len(w) == 21))
                   for f, w in zip(lm, wl if has3d else [None] * len(lm))])
    if ok.sum() < 20:
        raise HandDataError("We couldn't see your hand for long enough.")
    pts = np.array([f for f, k in zip(lm, ok) if k], float)[:, :, :2]
    pts[:, :, 0] *= aspect                               # isotropic units
    w3 = np.array([w for w, k in zip(wl, ok) if k], float)[:, :, :3] if has3d else None
    tt = (t[ok] - t[ok][0]) / 1000.0
    keep = np.concatenate([[True], np.diff(tt) > 1e-4])  # drop duplicate timestamps
    return tt[keep], pts[keep], (w3[keep] if has3d else None), float(ok.mean())


def _palm(pts):
    return np.linalg.norm(pts[:, 9] - pts[:, WRIST], axis=1)


def _uniform(tt, sig, fs):
    grid = np.arange(0, tt[-1], 1.0 / fs)
    if sig.ndim == 1:
        return grid, np.interp(grid, tt, sig)
    return grid, np.column_stack([np.interp(grid, tt, sig[:, k]) for k in range(sig.shape[1])])


def _fs(tt) -> float:
    """Sampling rate to analyze at: the camera's real rate, capped at 30 Hz."""
    return float(min(30.0, max(10.0, 1.0 / np.median(np.diff(tt)))))


# ---------------------------------------------------------------- tremor
def _palm_mm(w3) -> float:
    """The person's own palm length from the 3D points (falls back to an adult average if implausible)."""
    if w3 is None:
        return PALM_MM
    mm = float(np.median(np.linalg.norm(w3[:, 9] - w3[:, WRIST], axis=1))) * 1000
    return mm if 55 <= mm <= 135 else PALM_MM


def analyze_steady(t, lm, aspect: float, wl=None) -> dict:
    tt, pts, w3, cover = _frames(t, lm, aspect, wl)
    if tt[-1] < 5:
        raise HandDataError("Hold your hand up for the whole 10 seconds.")
    fs = _fs(tt)
    hi = min(TREMOR_BAND[1], 0.45 * fs)                  # stay below the camera's Nyquist limit
    palm_mm = _palm_mm(w3)
    mm_per_unit = palm_mm / float(np.median(_palm(pts)))
    centre = pts[:, [WRIST] + KNUCKLES].mean(axis=1)     # the hand as a whole
    grid, c = _uniform(tt, centre, fs)
    c = (c - c.mean(axis=0)) * mm_per_unit
    b, a = butter(2, 2.0 / (fs / 2), "high")             # remove slow arm drift
    hp = filtfilt(b, a, c, axis=0)
    f, pxx = welch(hp, fs=fs, nperseg=min(len(hp), int(fs * 4)), axis=0)
    p = pxx.sum(axis=1)
    band = (f >= TREMOR_BAND[0]) & (f <= hi)
    ref = (f >= 2.0) & (f <= hi)
    i = int(np.argmax(np.where(band, p, -1)))
    ratio = float(p[i] / max(np.median(p[ref]), 1e-12))
    # Size of the shaking: fit a sine at the peak frequency straight to the real camera timestamps
    # (interpolating to a grid first flattens fast tremors that only get ~3 frames per shake).
    raw = (centre - centre.mean(axis=0)) * mm_per_unit
    ts = tt - tt.mean()
    best = None
    for fq in np.linspace(max(TREMOR_BAND[0], f[i] - 0.3), min(hi, f[i] + 0.3), 13):
        w = 2 * np.pi * fq * ts
        X = np.column_stack([np.sin(w), np.cos(w), np.ones_like(ts), ts, ts ** 2])  # + slow drift
        coef, *_ = np.linalg.lstsq(X, raw, rcond=None)
        amp2 = float((coef[:2] ** 2).sum())                     # Ax^2 + Ay^2 (each axis A = sqrt(a^2 + b^2))
        if best is None or amp2 > best[0]:
            best = (amp2, fq)
    p2p = 2 * np.sqrt(best[0])
    detected = p2p >= MIN_TREMOR_MM and ratio >= MIN_PEAK_RATIO
    grade = next(g for lim, g in UPDRS_AMPLITUDE if p2p < lim) if detected else None
    view = f <= hi
    return {"tremor": bool(detected), "frequency_hz": round(best[1], 2) if detected else None,
            "peak_hz": round(best[1], 2), "amplitude_mm": round(float(p2p), 1), "peak_ratio": round(ratio, 1),
            "updrs_amplitude": grade, "palm_mm": round(palm_mm), "fps": round(fs, 1), "max_hz": round(hi, 1), "tracked": round(cover, 2),
            "spectrum": {"hz": [round(float(x), 2) for x in f[view]], "power": [round(float(x), 5) for x in p[view] / max(p[view].max(), 1e-12)]}}


# ---------------------------------------------------------------- repeated movements
def _cycles(grid, sig, fs, *, closed: float, opened: float, min_prom: float) -> dict:
    """Generic analysis of an open-close signal (big = open, small = closed)."""
    k = max(1, int(round(fs / 15)))                     # light smoothing (~70 ms)
    s = np.convolve(sig, np.ones(k) / k, mode="same")
    troughs, _ = find_peaks(-s, prominence=min_prom, distance=max(1, int(0.12 * fs)))
    peaks, _ = find_peaks(s, prominence=min_prom, distance=max(1, int(0.12 * fs)))
    reps = []
    for tr in troughs:
        before = peaks[peaks < tr]
        top = s[before[-1]] if len(before) else s[:tr + 1].max()
        reps.append({"t": float(grid[tr]), "closed": float(s[tr]), "open": float(top), "amp": float(top - s[tr])})
    n = len(reps)
    out = {"count": n, "rate_hz": round(n / grid[-1], 2) if grid[-1] > 0 else 0.0,
           "complete": sum(r["closed"] <= closed and r["open"] >= opened for r in reps),
           "not_closed": sum(r["closed"] > closed for r in reps), "not_opened": sum(r["open"] < opened for r in reps),
           "amplitudes": [round(r["amp"], 3) for r in reps]}
    if n >= 6:
        a = np.array([r["amp"] for r in reps])
        third = max(2, n // 3)
        out["decrement_pct"] = round(float(100 * (1 - a[-third:].mean() / a[:third].mean())), 1)
        iv = np.diff([r["t"] for r in reps])
        med = float(np.median(iv))
        out["rhythm_cv_pct"] = round(float(100 * iv.std() / iv.mean()), 1)
        out["hesitations"] = int((iv > 2 * med).sum())
    return out


def analyze_fist(t, lm, aspect: float, wl=None) -> dict:
    tt, pts, w3, cover = _frames(t, lm, aspect, wl)
    fs, mode = _fs(tt), "3d" if w3 is not None else "2d"
    P = w3 if w3 is not None else pts
    # How far the fingertips are from the wrist, in palm lengths (open ~1.8, fist ~0.9).
    o = np.linalg.norm(P[:, TIPS] - P[:, [WRIST]], axis=2).mean(axis=1) / np.linalg.norm(P[:, 9] - P[:, WRIST], axis=1)
    grid, s = _uniform(tt, o, fs)
    out = _cycles(grid, s, fs, closed=FIST_CLOSED[mode], opened=FIST_OPEN[mode], min_prom=0.25)
    return out | {"mode": mode, "closed_line": FIST_CLOSED[mode], "tracked": round(cover, 2), "fps": round(fs, 1),
                  "signal": {"t": [round(float(x), 3) for x in grid], "v": [round(float(x), 3) for x in s]}}


def analyze_tap(t, lm, aspect: float, wl=None) -> dict:
    tt, pts, w3, cover = _frames(t, lm, aspect, wl)
    fs, mode = _fs(tt), "3d" if w3 is not None else "2d"
    P = w3 if w3 is not None else pts
    # Thumb-tip to index-tip gap, in palm lengths (touching ~0.25 in 3D).
    d = np.linalg.norm(P[:, THUMB_TIP] - P[:, INDEX_TIP], axis=1) / np.linalg.norm(P[:, 9] - P[:, WRIST], axis=1)
    grid, s = _uniform(tt, d, fs)
    out = _cycles(grid, s, fs, closed=TAP_TOUCH[mode], opened=TAP_OPEN[mode], min_prom=0.15)
    if out["count"]:
        out["opening_mm"] = round(float(np.median(out["amplitudes"])) * _palm_mm(w3))
    return out | {"mode": mode, "closed_line": TAP_TOUCH[mode], "tracked": round(cover, 2), "fps": round(fs, 1),
                  "signal": {"t": [round(float(x), 3) for x in grid], "v": [round(float(x), 3) for x in s]}}


# ---------------------------------------------------------------- plain-language summary
def flags(res: dict) -> list[dict]:
    """What a clinician would look at, in plain words. level: ok | watch."""
    out = []
    st = res.get("steady")
    if st:
        if st["tremor"]:
            out.append({"level": "watch", "text": f"Rhythmic shaking at {st['frequency_hz']} times a second, about {st['amplitude_mm']:.0f} mm "
                                                   f"({st['updrs_amplitude']} on the MDS-UPDRS tremor scale)."})
        else:
            out.append({"level": "ok", "text": f"No rhythmic shaking seen (the camera picks up about {MIN_TREMOR_MM:.0f} mm and more)."})
    for key, name, verb in (("fist", "fists", "close and open fully"), ("tap", "taps", "touch and open wide")):
        r = res.get(key)
        if not r:
            continue
        if r["count"] < 3:
            out.append({"level": "watch", "text": f"Only {r['count']} {name} were seen. Keep your hand in view and move fully."})
            continue
        part = r["count"] - r["complete"]
        if part > max(1, 0.3 * r["count"]):
            out.append({"level": "watch", "text": f"{part} of {r['count']} {name} didn't {verb}."})
        if r.get("decrement_pct", 0) >= 30:
            out.append({"level": "watch", "text": f"Your {name} got {r['decrement_pct']:.0f}% smaller by the end (doctors call this decrement)."})
        if r.get("hesitations", 0) >= 3:
            out.append({"level": "watch", "text": f"{r['hesitations']} pauses or hesitations during the {name}."})
    if not any(f["level"] == "watch" for f in out):
        out.append({"level": "ok", "text": "Movements were complete, steady and didn't fade."})
    return out


def analyze(payload: dict) -> dict:
    aspect = float(payload.get("aspect") or 4 / 3)
    res, errors = {}, {}
    for key, fn in (("steady", analyze_steady), ("fist", analyze_fist), ("tap", analyze_tap)):
        task = (payload.get("tasks") or {}).get(key)
        if not task:
            continue
        try:
            res[key] = fn(task["t"], task["lm"], aspect, task.get("wl"))
        except HandDataError as e:
            errors[key] = str(e)
    # Honesty about tracking speed: fast taps (4-6 a second) and tremor need roughly 15+ frames a second.
    fps = min((r["fps"] for r in res.values()), default=None)
    quality = {"fps": fps, "ok": fps is None or fps >= MIN_FPS}
    fl = flags(res)
    if not quality["ok"]:
        fl.append({"level": "info", "text": f"Your camera was tracked at only {fps:.0f} frames a second, so fast taps or shaking can be missed. "
                                            "Close other apps and redo for the most accurate result."})
    return {"hand": payload.get("hand"), "results": res, "errors": errors, "flags": fl, "quality": quality}
