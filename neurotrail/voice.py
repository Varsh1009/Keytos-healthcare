"""
Voice check: temporal speech measures from a short recording, computed in Python (numpy/scipy).

Why these measures: in Tóth et al. 2018 (Curr Alzheimer Res, PubMed 29165085) people with mild
cognitive impairment differed from healthy controls in speech tempo, articulation rate, silent pauses
and hesitation. NeuroTrail tracks the same kinds of measures over time for one person. It does not
diagnose anything; small studies, and recording conditions matter.

Method (all from the raw waveform):
  * 25 ms frames every 10 ms; intensity in dB.
  * Speech vs silence: frame is speech if intensity > (noise floor + 0.35 * dynamic range).
    Silences of 250 ms or more inside the recording count as pauses.
  * Syllables: intensity peaks in speech (prominence >= 2 dB, >= 100 ms apart) that are voiced,
    following the syllable-nuclei idea of de Jong & Wempe (2009).
  * Pitch: autocorrelation per voiced frame, 70-400 Hz.
"""
from __future__ import annotations

import io

import numpy as np
from scipy.io import wavfile
from scipy.signal import find_peaks, resample_poly

EVIDENCE_URL = "https://pubmed.ncbi.nlm.nih.gov/29165085/"
READING = ("Every morning the market opens at seven. The baker sets out warm bread, the florist waters "
           "her roses, and the old clockmaker winds a dozen clocks. By nine the square is busy with "
           "children, bicycles and the smell of coffee. When the rain comes, everyone gathers under the "
           "striped awnings and talks until the sun returns.")
FREE_PROMPT = "Tell me about yesterday, from the moment you woke up until you went to bed."


def load_wav(data: bytes) -> tuple[np.ndarray, int]:
    sr, x = wavfile.read(io.BytesIO(data))
    x = x.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if np.abs(x).max() > 1.5:          # int PCM -> [-1, 1]
        x = x / 32768.0
    if sr != 16000:
        g = np.gcd(sr, 16000)
        x = resample_poly(x, 16000 // g, sr // g).astype(np.float32)
        sr = 16000
    return x, sr


def _frames(x: np.ndarray, sr: int, win: float = .025, hop: float = .010) -> np.ndarray:
    w, h = int(win * sr), int(hop * sr)
    n = 1 + max(0, (len(x) - w) // h)
    idx = np.arange(w)[None, :] + h * np.arange(n)[:, None]
    return x[idx] * np.hanning(w)[None, :]


def _pitch(fr: np.ndarray, sr: int) -> float:
    fr = fr - fr.mean()
    ac = np.correlate(fr, fr, mode="full")[len(fr) - 1:]
    if ac[0] <= 0:
        return 0.0
    lo, hi = int(sr / 400), int(sr / 70)
    seg = ac[lo:hi]
    k = int(np.argmax(seg))
    return sr / (lo + k) if seg[k] / ac[0] > 0.35 else 0.0


def analyze(x: np.ndarray, sr: int) -> dict:
    dur = len(x) / sr
    if dur < 5:
        raise ValueError("Recording is shorter than 5 seconds.")
    F = _frames(x, sr)
    db = 10 * np.log10((F ** 2).mean(axis=1) + 1e-10)
    floor, top = np.percentile(db, 10), np.percentile(db, 98)
    if top - floor < 15:
        raise ValueError("Too quiet or too noisy to find speech. Move closer to the mic and try again.")
    speech = db > floor + 0.35 * (top - floor)
    # smooth: fill speech gaps < 80 ms, drop blips < 50 ms
    s = speech.copy()
    for val, mx in ((False, 8), (True, 5)):
        i = 0
        while i < len(s):
            j = i
            while j < len(s) and s[j] == val:
                j += 1
            if s[i] == val and 0 < i and j < len(s) and j - i < mx:
                s[i:j] = not val
            i = max(j, i + 1)
    on = np.where(s)[0]
    if len(on) == 0:
        raise ValueError("No speech found in the recording.")
    first, last = on[0], on[-1]
    core = s[first:last + 1]
    # pauses >= 250 ms inside the speaking span
    pauses, run = [], 0
    for v in core:
        if not v:
            run += 1
        else:
            if run >= 25:
                pauses.append(run / 100)
            run = 0
    span = (last - first + 1) / 100
    speech_time = core.sum() / 100
    # pitch on voiced speech frames (every 2nd frame for speed)
    f0 = np.array([_pitch(F[i], sr) if s[i] else 0.0 for i in range(0, len(F), 2)])
    voiced_f0 = f0[f0 > 0]
    voiced = np.zeros(len(F), bool)
    voiced[::2] = f0 > 0
    voiced = voiced | np.roll(voiced, 1)
    # syllable nuclei: voiced intensity peaks in speech
    peaks, _ = find_peaks(db, prominence=2.0, distance=10)
    syl = [p for p in peaks if s[p] and voiced[p]]
    semis = 12 * np.log2(voiced_f0 / np.median(voiced_f0)) if len(voiced_f0) > 10 else np.array([0.0])
    return {
        "duration_s": round(dur, 1), "speaking_span_s": round(float(span), 1), "speech_time_s": round(float(speech_time), 1),
        "syllables": int(len(syl)),
        "speech_tempo": round(float(len(syl) / span), 2),                # syllables per second incl. pauses
        "articulation_rate": round(float(len(syl) / max(speech_time, .1)), 2),  # syllables per second of speech
        "pauses": int(len(pauses)), "pauses_per_min": round(float(len(pauses) / span * 60), 1),
        "silent_pause_ratio": round(float(sum(pauses) / span), 3), "mean_pause_s": round(float(np.mean(pauses)) if pauses else 0.0, 2),
        "longest_pause_s": round(float(max(pauses)) if pauses else 0.0, 2),
        "pitch_median_hz": round(float(np.median(voiced_f0)), 1) if len(voiced_f0) else None,
        "pitch_variability_st": round(float(np.std(semis)), 2),
    }


def plain_summary(m: dict) -> list[str]:
    """Plain-language lines for the result card (no diagnosis)."""
    out = [f"You spoke for {m['speech_time_s']:.0f} of {m['speaking_span_s']:.0f} seconds, "
           f"at about {m['speech_tempo']:.1f} syllables per second.",
           f"You paused {m['pauses']} times (≥ ¼ second); pauses took {m['silent_pause_ratio'] * 100:.0f}% of the time."]
    if m["pitch_median_hz"]:
        out.append(f"Your voice's typical pitch was {m['pitch_median_hz']:.0f} Hz, varying by {m['pitch_variability_st']:.1f} semitones.")
    return out
