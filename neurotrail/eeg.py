"""
EEG: the brain's resting rhythm from a standard .edf recording.

What we measure (eyes closed, at rest, back-of-head channels where the alpha rhythm is strongest):
  * peak alpha frequency (PAF): the speed of the dominant 8-13 Hz rhythm. It's lower on average
    in Alzheimer's disease (David et al. 2025, doi:10.1093/braincomms/fcaf236) and in a longitudinal
    study fell year by year as the disease progressed (Wang et al. 2026, doi:10.1177/13872877261476331).
    Typical adults sit around 8-12 Hz, and it slows a little with age.
  * relative power in the delta / theta / alpha / beta bands, and the theta/alpha ratio ("slowing").

What it is not: a diagnosis. Drowsiness, eyes open, medication and electrode placement all move these
numbers. The useful thing is the SAME person's recordings compared over months and years.

The EDF reader below handles the standard European Data Format (16-bit) with no extra dependency.
"""
from __future__ import annotations

import io

import numpy as np
from scipy.signal import welch

BANDS = {"delta": (1, 4), "theta": (4, 8), "alpha": (8, 13), "beta": (13, 30)}
POSTERIOR = ("O1", "O2", "OZ", "PZ", "P3", "P4", "POZ", "PO3", "PO4", "PO7", "PO8", "P7", "P8")
TYPICAL_PAF = (8.0, 12.0)
MIN_SECONDS = 30


def read_edf(data: bytes) -> tuple[list[str], list[float], list[np.ndarray]]:
    """Minimal EDF/EDF+ reader → (labels, sample rates, signals in physical units)."""
    f = io.BytesIO(data)
    h = f.read(256)
    if len(h) < 256 or not h[:8].strip().isdigit():
        raise ValueError("That isn't an EDF file. Export the recording as .edf (European Data Format).")
    n_rec, dur, ns = int(h[236:244]), float(h[244:252]), int(h[252:256])
    if ns <= 0 or dur <= 0:
        raise ValueError("EDF header looks broken (no signals or zero record length).")
    field = lambda size: [f.read(size).decode("latin-1").strip() for _ in range(ns)]
    labels = field(16); field(80); field(8)
    pmin, pmax = np.array(field(8), float), np.array(field(8), float)
    dmin, dmax = np.array(field(8), float), np.array(field(8), float)
    field(80)
    spr = np.array(field(8), int)
    field(32)
    raw = np.frombuffer(f.read(), dtype="<i2")
    per_rec = int(spr.sum())
    if n_rec < 0:                                     # -1 = unknown in some writers
        n_rec = len(raw) // per_rec
    raw = raw[: n_rec * per_rec].reshape(n_rec, per_rec)
    gain = (pmax - pmin) / np.where(dmax - dmin == 0, 1, dmax - dmin)
    sigs, start = [], 0
    for i in range(ns):
        x = raw[:, start:start + spr[i]].reshape(-1).astype(float)
        sigs.append((x - dmin[i]) * gain[i] + pmin[i])
        start += spr[i]
    return labels, list(spr / dur), sigs


def _clean_label(s: str) -> str:
    return s.upper().replace("EEG", "").replace(".", "").replace("-REF", "").replace("-LE", "").strip(" -")


def analyze(data: bytes) -> dict:
    labels, rates, sigs = read_edf(data)
    eeg = [(l, r, s) for l, r, s in zip(labels, rates, sigs)
           if r >= 100 and not any(k in l.upper() for k in ("ANNOT", "ECG", "EKG", "EMG", "EOG", "RESP", "STATUS"))]
    if not eeg:
        raise ValueError("No EEG channels sampled at 100 Hz or more were found in that file.")
    post = [c for c in eeg if _clean_label(c[0]) in POSTERIOR]
    use = post or eeg
    fs = use[0][1]
    use = [c for c in use if abs(c[1] - fs) < 1e-6]
    secs = len(use[0][2]) / fs
    if secs < MIN_SECONDS:
        raise ValueError(f"The recording is {secs:.0f} s long; at least {MIN_SECONDS} s of rest is needed.")
    psds = []
    for _, _, x in use:
        x = x - np.mean(x)
        if np.std(x) == 0:
            continue
        fr, p = welch(x, fs=fs, nperseg=int(4 * fs), noverlap=int(2 * fs))   # 0.25 Hz resolution
        psds.append(p)
    if not psds:
        raise ValueError("All the EEG channels are flat.")
    psd = np.median(psds, axis=0)
    band = lambda lo, hi: (fr >= lo) & (fr < hi)
    total = np.trapezoid(psd[band(1, 30)], fr[band(1, 30)])
    rel = {k: float(np.trapezoid(psd[band(*v)], fr[band(*v)]) / total) for k, v in BANDS.items()}
    # alpha peak above the 1/f background (fit in log-log space outside the alpha band)
    bg_m = band(2, 7) | band(14, 30)
    coef = np.polyfit(np.log10(fr[bg_m]), np.log10(psd[bg_m]), 1)
    resid = np.log10(psd) - np.polyval(coef, np.log10(np.maximum(fr, 0.1)))
    am = band(7, 13.5)
    i = int(np.argmax(np.where(am, resid, -np.inf)))
    peak, peak_db = float(fr[i]), float(10 * resid[i])
    cog = float(np.sum(fr[am] * psd[am]) / np.sum(psd[am]))   # centre of gravity, a steadier estimate
    # a real alpha peak stands >= 3 dB above the 1/f background and isn't stuck at the edge of the search window
    clear = peak_db >= 3.0 and 7.25 < peak < 13.25
    paf = peak if clear else cog
    keep = fr <= 40
    return {
        "paf_hz": round(paf, 2), "paf_method": "peak" if clear else "centre of gravity (no clear peak)",
        "alpha_cog_hz": round(cog, 2), "alpha_peak_db": round(peak_db, 1),
        "clear_alpha": bool(clear), "rel_power": {k: round(v, 3) for k, v in rel.items()},
        "theta_alpha_ratio": round(rel["theta"] / max(rel["alpha"], 1e-6), 2),
        "seconds": round(secs, 1), "fs": fs, "channels": [l for l, _, _ in use][:12], "n_channels": len(use),
        "posterior": bool(post),
        "spectrum": {"f": [round(float(x), 2) for x in fr[keep]], "db": [round(float(10 * np.log10(y + 1e-30)), 2) for y in psd[keep]]},
        "plain": plain(paf, clear, bool(post)),
    }


def plain(paf: float, clear: bool, posterior: bool) -> list[str]:
    out = []
    if not clear:
        out.append("No clear alpha rhythm was found. That's normal with eyes open or when drowsy; for this measure "
                   "record 2+ minutes resting with eyes closed.")
    lo, hi = TYPICAL_PAF
    if paf < lo:
        out.append(f"Your resting brain rhythm is {paf:.1f} Hz, slower than the typical adult range ({lo:g}–{hi:g} Hz). "
                   "Slower rhythms are seen more often with ageing and Alzheimer's, but tiredness and some medicines "
                   "do it too. Worth mentioning to a doctor if it repeats.")
    elif paf > hi:
        out.append(f"Your resting brain rhythm is {paf:.1f} Hz, a little above the usual {lo:g}–{hi:g} Hz range.")
    else:
        out.append(f"Your resting brain rhythm is {paf:.1f} Hz, inside the typical adult range ({lo:g}–{hi:g} Hz).")
    out.append("One recording can't diagnose anything. Its value is tracking: the same person, recorded the same way, "
               "over months and years.")
    if not posterior:
        out.append("No back-of-head channels (O1/O2/Pz) were found, so all channels were averaged; alpha is weaker elsewhere.")
    return out
