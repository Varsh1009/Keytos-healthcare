"""Animal Naming speech-to-text (faster-whisper). Skipped when faster-whisper isn't installed.

Fixture tests/fixtures/animals_tts.wav was made with Windows text-to-speech
(System.Speech, 16 kHz mono 16-bit) saying: dog. cat. horse. elephant. lion. tiger. zebra. rabbit.
"""
import io
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile

from neurotrail import games, speech

pytestmark = pytest.mark.skipif(not speech.available(), reason="faster-whisper not installed")

FIXTURE = Path(__file__).parent / "fixtures" / "animals_tts.wav"
SAID = ["dog", "cat", "horse", "elephant", "lion", "tiger", "zebra", "rabbit"]


def _wav(x: np.ndarray, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    wavfile.write(buf, rate, x)
    return buf.getvalue()


def test_transcribes_tts_animals():
    r = speech.transcribe_animals(FIXTURE.read_bytes())
    assert set(r) >= {"text", "entries", "model", "device", "seconds"}
    assert all(w == w.lower() and w.isalpha() for w in r["entries"])
    s = games.score_fluency(r["entries"])
    counted = {w.lower() for w in s["valid"]} & set(SAID)
    assert len(counted) >= 7, (r["text"], s)


def test_silence_gives_no_entries():
    r = speech.transcribe_animals(_wav(np.zeros(16000 * 5, dtype=np.int16)))
    assert r["entries"] == [] and r["text"] == ""
