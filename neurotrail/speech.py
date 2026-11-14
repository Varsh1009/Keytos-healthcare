"""Speech-to-text for the Animal Naming game (faster-whisper, no ffmpeg needed).

The browser uploads a WAV; we decode it with scipy, resample to 16 kHz mono and
hand a float32 array to faster-whisper. The output `entries` (lowercase words in
spoken order) go straight into games.score_fluency.
"""
from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

SR = 16000
PROMPT_ANIMALS = (
    "dog, cat, horse, cow, pig, sheep, goat, chicken, duck, rabbit, mouse, rat, lion, tiger, "
    "elephant, giraffe, zebra, monkey, bear, wolf, fox, deer, camel, kangaroo, koala, panda, "
    "snake, frog, turtle, shark, whale, dolphin, eagle, owl, parrot, penguin, bee, ant, spider, "
    "butterfly, squirrel, hippo, rhino, cheetah, leopard, donkey, moose, otter"
)
INITIAL_PROMPT = f"Animals: {PROMPT_ANIMALS}."

_lock = threading.Lock()
_model = None
_info: dict = {}


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def _add_torch_cuda_dlls() -> None:
    """On Windows, ctranslate2 needs cuBLAS/cuDNN DLLs; the torch cu12x wheel ships them."""
    if os.name != "nt":
        return
    try:
        import importlib.util
        spec = importlib.util.find_spec("torch")
        if not spec or not spec.origin:
            return
        lib = Path(spec.origin).parent / "lib"
        if lib.is_dir():
            os.add_dll_directory(str(lib))
            if str(lib) not in os.environ.get("PATH", ""):
                os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")
    except Exception as e:  # pragma: no cover
        log.info("speech: could not add torch DLL dir: %s", e)


def _model_path(name: str) -> str:
    """Local model dir: cached copy first (no network); download only if missing.

    pip-system-certs injects pip's vendored truststore into ssl, which recurses forever
    inside httpx2 (used by huggingface_hub); if that happens, download with it removed.
    """
    from faster_whisper.utils import download_model
    if os.path.isdir(name):
        return name
    try:
        return download_model(name, local_files_only=True)
    except Exception:
        pass
    log.info("speech: downloading model %s (first use)", name)
    try:
        return download_model(name)
    except RecursionError:
        from pip._vendor import truststore
        truststore.extract_from_ssl()
        try:
            return download_model(name)
        finally:
            truststore.inject_into_ssl()


def _load():
    """Load the model once. CUDA float16 if it really works (checked with a warm-up), else CPU int8."""
    global _model, _info
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        from faster_whisper import WhisperModel
        env_model = os.environ.get("NEUROTRAIL_ASR_MODEL")
        tries = []
        if os.environ.get("NEUROTRAIL_ASR_DEVICE", "").lower() != "cpu":
            _add_torch_cuda_dlls()
            try:
                import ctranslate2
                if ctranslate2.get_cuda_device_count() > 0:
                    tries.append(("cuda", "float16", env_model or "small.en"))
            except Exception as e:
                log.info("speech: CUDA check failed: %s", e)
        tries.append(("cpu", "int8", env_model or "base.en"))
        last = None
        for device, ctype, name in tries:
            try:
                m = WhisperModel(_model_path(name), device=device, compute_type=ctype)
                # cuBLAS/cuDNN load lazily on first inference, so warm up to prove the device works.
                warm = (np.random.default_rng(0).standard_normal(SR) * 0.01).astype(np.float32)
                list(m.transcribe(warm, language="en", beam_size=1, vad_filter=False)[0])
                _model, _info = m, {"model": name, "device": f"{device}/{ctype}"}
                log.info("speech: loaded %s on %s/%s", name, device, ctype)
                return _model
            except Exception as e:
                last = e
                log.warning("speech: %s on %s failed (%s); falling back", name, device, e)
        raise RuntimeError(f"Could not load speech model: {last}")


def _decode(wav_bytes: bytes) -> np.ndarray:
    from scipy.io import wavfile
    from scipy.signal import resample_poly
    rate, data = wavfile.read(io.BytesIO(wav_bytes))
    if data.dtype == np.int16:
        x = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        x = data.astype(np.float32) / 2147483648.0
    elif data.dtype == np.uint8:
        x = (data.astype(np.float32) - 128.0) / 128.0
    else:
        x = data.astype(np.float32)
    if x.ndim == 2:
        x = x.mean(axis=1)
    if rate != SR:
        g = np.gcd(int(rate), SR)
        x = resample_poly(x, SR // g, int(rate) // g).astype(np.float32)
    return np.clip(x, -1.0, 1.0).astype(np.float32)


def words(text: str) -> list[str]:
    return [w for w in re.split(r"[^a-z]+", text.lower()) if w]


def transcribe_animals(wav_bytes: bytes) -> dict:
    """Transcribe a short clip of spoken animal names.

    Returns {"text", "entries", "model", "device", "seconds"}; entries are lowercase
    words in spoken order, ready for games.score_fluency(entries).
    """
    t0 = time.perf_counter()
    audio = _decode(wav_bytes)
    rms = float(np.sqrt(np.mean(audio ** 2))) if audio.size else 0.0
    if audio.size < SR // 4 or rms < 1e-4:
        return {"text": "", "entries": [], "model": _info.get("model", ""), "device": _info.get("device", ""),
                "seconds": round(time.perf_counter() - t0, 3)}
    # Normalise quiet recordings so whisper hears them clearly.
    peak = float(np.max(np.abs(audio)))
    if 0 < peak < 0.5:
        audio = audio * (0.9 / peak)
    model = _load()
    segs, _ = model.transcribe(
        audio, language="en", beam_size=5, vad_filter=False,
        condition_on_previous_text=False, initial_prompt=INITIAL_PROMPT,
        without_timestamps=True,
    )
    kept = []
    for s in segs:
        if s.no_speech_prob > 0.6 and s.avg_logprob < -1.0:
            continue
        kept.append(s.text.strip())
    text = " ".join(t for t in kept if t)
    return {"text": text, "entries": words(text), "model": _info["model"], "device": _info["device"],
            "seconds": round(time.perf_counter() - t0, 3)}
