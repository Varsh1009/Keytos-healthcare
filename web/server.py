"""
NeuroTrail backend. Python serves every number (models, evidence, game state in
SQLite, the AI coach). The browser only draws.

Run:  python web/server.py   then open http://localhost:8600
"""
from __future__ import annotations

import os
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import uvicorn
import base64
import random

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurotrail import coach, db, games as gym, scoring, voice as vox, wearables  # noqa: E402
from neurotrail.quests import LANCET_CITE, QUEST_BY_ID, QUESTS, TIER_BONUS  # noqa: E402
from neurotrail.state import Player, today  # noqa: E402

WEB = Path(__file__).resolve().parent
ART = ROOT / "models" / "artifacts"
app = FastAPI(title="NeuroTrail")
app.mount("/static", StaticFiles(directory=WEB / "static"), name="static")


@app.middleware("http")
async def no_cache(request: Request, call_next):
    """Always serve fresh front-end code (a stale cached app.js broke buttons once)."""
    resp = await call_next(request)
    if request.url.path == "/" or request.url.path.endswith((".js", ".css", ".html")):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def get(name: str) -> Player:
    p = Player.load(name)
    if p is None:
        raise HTTPException(404, "no such player")
    return p


def snapshot(p: Player) -> dict:
    rounds = db.rounds(p.name)
    return {
        "name": p.name, "onboarded": p.onboarded, "profile": p.profile(), "sparks": p.sparks,
        "level": p.level(), "streak": p.streak(), "week": p.week(), "trail": p.trail_status(),
        "steps": {q.id: p.steps_today(q.id) for q in p.active_quests()},
        "lever": scoring.lever_age(p.profile()) if p.onboarded else None,
        "support": p.phq9 >= 10 or p.phq_item9 > 0,
        "best_speed": max((r["correct"] for r in rounds), default=None),
        "rounds_today": sum(r["date"] == today() for r in rounds),
    }


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    # cache-bust the front-end on every server start
    v = str(int((WEB / "static" / "app.js").stat().st_mtime))
    return (WEB / "index.html").read_text(encoding="utf-8").replace("__V__", v)   # UTF-8 on every OS (Windows default is cp1252)


@app.get("/api/quests")
def quests() -> list[dict]:
    a = {c["column"]: c for c in scoring.associations()["contrasts"]}
    out = []
    for q in QUESTS:
        d = q.to_dict()
        d["nhanes"] = a.get(q.nhanes_key) if q.nhanes_key else None
        d["sparks_formula"] = (f"20 + {TIER_BONUS[q.tier]} ({q.tier})"
                               + (f" + 5 × {q.lancet_paf}% PAF" if q.lancet_paf else "") + f" = {q.sparks}")
        out.append(d)
    return out


@app.get("/api/players")
def players() -> list[dict]:
    week0 = (date.today() - timedelta(days=6)).isoformat()
    rows = []
    for n in db.list_players():
        p = Player.load(n)
        rows.append({"name": n, "sparks": p.sparks, "streak": p.streak(),
                     "week_sparks": sum(l["sparks"] for l in p.logs if l["date"] >= week0)})
    return sorted(rows, key=lambda r: -r["week_sparks"])


class NewPlayer(BaseModel):
    name: str = Field(min_length=1, max_length=24)


@app.post("/api/players")
def add_player(body: NewPlayer) -> dict:
    name = body.name.strip()
    p = Player.load(name) or Player.create(name)
    return snapshot(p)


@app.get("/api/player/{name}")
def player(name: str) -> dict:
    return snapshot(get(name))


class Onboard(BaseModel):
    age: int = Field(ge=18, le=100)
    female: bool
    educ: int = Field(ge=1, le=5)
    income_pir: float = Field(ge=0, le=5)
    sbp: float = Field(ge=70, le=250)
    diabetes: bool
    current_smoker: bool
    active_min_week: float = Field(ge=0, le=3000)
    sedentary_min_day: float = Field(ge=0, le=1140)
    sleep_hours: float = Field(ge=2, le=12)
    phq: list[int] = Field(min_length=9, max_length=9)


@app.post("/api/player/{name}/onboard")
def onboard(name: str, body: Onboard) -> dict:
    p = get(name)
    for k, v in body.model_dump().items():
        if k != "phq":
            setattr(p, k, v)
    p.phq9 = int(sum(max(0, min(3, x)) for x in body.phq))
    p.phq_item9 = int(body.phq[8])
    p.onboarded = True
    p.save()
    return snapshot(p)


class Step(BaseModel):
    quest: str
    index: int
    done: bool


@app.post("/api/player/{name}/step")
def step(name: str, body: Step) -> dict:
    p = get(name)
    q = QUEST_BY_ID.get(body.quest)
    if q is None or not 0 <= body.index < len(q.steps):
        raise HTTPException(400, "bad step")
    if q.log["kind"] == "speed" and body.index > 0:
        raise HTTPException(409, "these steps tick themselves when you play")
    p.set_step(body.quest, body.index, body.done)
    return snapshot(p)


class Complete(BaseModel):
    quest: str
    value: float | None = None
    extra: dict = {}


@app.post("/api/player/{name}/complete")
def complete(name: str, body: Complete) -> dict:
    p = get(name)
    q = QUEST_BY_ID.get(body.quest)
    if q is None:
        raise HTTPException(400, "unknown quest")
    if not all(p.steps_today(q.id)):
        raise HTTPException(409, "finish every step first (Speed Sprint: play a round and the booster)")
    before = p.level()["index"]
    gained = p.complete(q.id, body.value, body.extra)
    snap = snapshot(p)
    snap["gained"] = gained
    snap["leveled_up"] = snap["level"]["index"] > before
    return snap


class SpeedRound(BaseModel):
    correct: int = Field(ge=0, le=500)
    wrong: int = Field(ge=0, le=500)
    best_combo: int = Field(ge=0, le=500)


@app.post("/api/player/{name}/speed")
def speed_round(name: str, body: SpeedRound) -> dict:
    """Record a round. Round 1 ticks steps 1-2; a second round today ticks the booster step."""
    p = get(name)
    db.add_round(p.name, today(), body.correct, body.wrong, body.best_combo)
    n = sum(r["date"] == today() for r in db.rounds(p.name))
    p.set_step("speed", 0, True)
    p.set_step("speed", 1, True)
    if n >= 2:
        p.set_step("speed", 2, True)
    snap = snapshot(p)
    snap["history"] = [r["correct"] for r in db.rounds(p.name)][-30:]
    return snap


@app.get("/api/player/{name}/progress")
def progress(name: str, days: int = 30) -> dict:
    """Every series on the Progress page, straight from the database."""
    p = get(name)
    d0 = date.today() - timedelta(days=days - 1)
    span = [(d0 + timedelta(days=i)).isoformat() for i in range(days)]
    L = [l for l in p.logs if l["date"] >= span[0]]
    by_day = Counter(l["date"] for l in L)
    sparks_day = Counter()
    for l in L:
        sparks_day[l["date"]] += l["sparks"]
    series = lambda q: [{"date": l["date"], "value": l["value"], **{k: v for k, v in l.items()
                         if k not in ("date", "value", "quest", "sparks", "ts")}} for l in L if l["quest"] == q]
    # Lever score over time: re-run the model on the rolling 7-day profile for each logged day.
    lever_hist = []
    for d in sorted({l["date"] for l in p.logs}):
        dd = date.fromisoformat(d)
        prof = p.profile()
        for qid, key in (("bp", "sbp"), ("sleep", "sleep_hours")):
            vals = [l["value"] for l in p.logs if l["quest"] == qid and l.get("value") is not None
                    and dd - timedelta(days=6) <= date.fromisoformat(l["date"]) <= dd]
            if vals:
                prof[key] = sum(vals) / len(vals)
        lever_hist.append({"date": d, "years": scoring.lever_age(prof)["years"]})
    return {
        "days": span, "quests_per_day": [by_day.get(d, 0) for d in span],
        "sparks_per_day": [sparks_day.get(d, 0) for d in span],
        "quest_counts": Counter(QUEST_BY_ID[l["quest"]].title for l in p.logs),
        "bp": series("bp"), "steps": series("steps"), "sleep": series("sleep"), "joy": series("joy"),
        "speed": db.rounds(p.name), "lever": lever_hist,
        "totals": {"quests": len(p.logs), "sparks": p.sparks, "streak": p.streak(),
                   "active_days": len({l["date"] for l in p.logs})},
        "log": list(reversed(p.logs))[:40],
    }


class Ask(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@app.post("/api/player/{name}/coach")
def ask_coach(name: str, body: Ask) -> dict:
    return coach.ask(get(name), body.text.strip())


@app.get("/api/coach/status")
def coach_status() -> dict:
    return coach.status()


@app.get("/api/player/{name}/coach")
def coach_history(name: str) -> dict:
    get(name)
    return {"messages": db.messages(name), "plans": db.plans(name)}


class LeverIn(BaseModel):
    sbp: float
    diabetes: bool
    current_smoker: bool
    active_min_week: float
    sedentary_min_day: float
    sleep_hours: float
    phq9: float


@app.post("/api/lever")
def lever(body: LeverIn) -> dict:
    return scoring.lever_age(body.model_dump())


class BrainIn(BaseModel):
    age: float = Field(ge=18, le=100)
    female: bool
    nwbv: float = Field(ge=0.55, le=0.95)
    etiv: float = Field(ge=1000, le=2200)


@app.post("/api/brainage")
def brainage(body: BrainIn) -> dict:
    return scoring.brain_age(body.age, body.female, body.nwbv, body.etiv)


@app.get("/api/oasis")
def oasis() -> list[dict]:
    d = pd.read_csv(ART / "brainage_predictions.csv").replace({np.nan: None})
    return d[["ID", "Age", "female", "nWBV", "eTIV", "CDR", "status", "brain_age"]].to_dict("records")


@app.get("/api/science")
def science() -> dict:
    oof = pd.read_csv(ART / "cognition_oof_predictions.csv").sample(800, random_state=0)
    return {
        "cognition": scoring.metrics("cognition"), "brainage": scoring.metrics("brainage"),
        "associations": {k: v for k, v in scoring.associations().items() if k not in ("cov", "names")},
        "oof": oof[["dsst", "pred_gbm_full"]].round(1).values.tolist(), "lancet": LANCET_CITE,
    }


# ====================================================================== Brain Gym
@app.get("/api/games")
def games_catalog() -> dict:
    return {"games": gym.GAMES, "sparks": gym.GAME_SPARKS}


@app.get("/api/games/recall-words")
def recall_words() -> dict:
    words = random.choice(gym.WORD_LISTS)
    return {"words": words, "distractors": random.sample(gym.DISTRACTORS, 10)}


class FluencyIn(BaseModel):
    entries: list[str] = Field(max_length=300)


@app.post("/api/games/fluency-score")
def fluency_score(body: FluencyIn) -> dict:
    return gym.score_fluency(body.entries)


class GameIn(BaseModel):
    game: str
    score: float
    detail: dict = {}


def game_stats(p: Player, gid: str) -> dict:
    g = gym.GAME_BY_ID[gid]
    if gid == "speed":
        rows = [{"date": r["date"], "score": r["correct"], "ts": r["ts"], "detail": {}} for r in db.rounds(p.name)]
    else:
        rows = db.games(p.name, gid)
    scores = [r["score"] for r in rows]
    best = (max if g["better"] == "higher" else min)(scores) if scores else None
    return {"id": gid, "plays": len(rows), "best": best, "last": scores[-1] if scores else None,
            "history": scores[-20:], "played_today": any(r["date"] == today() for r in rows)}


@app.get("/api/player/{name}/games")
def player_games(name: str) -> dict:
    p = get(name)
    return {g["id"]: game_stats(p, g["id"]) for g in gym.GAMES}


@app.post("/api/player/{name}/game")
def play_game(name: str, body: GameIn) -> dict:
    p = get(name)
    g = gym.GAME_BY_ID.get(body.game)
    if g is None or body.game == "speed":
        raise HTTPException(400, "unknown game (Speed Sprint records via /speed)")
    first_today = not any(r["date"] == today() for r in db.games(p.name, g["id"]))
    sparks = gym.GAME_SPARKS if first_today else 0
    db.add_game(p.name, g["id"], today(), body.score, body.detail, sparks)
    out = {"sparks_gained": sparks, "stats": game_stats(p, g["id"]), "player": snapshot(p)}
    ref = gym.movement_reference(g["id"], body.score, p.age, p.female)
    if ref:
        out["reference"] = ref
    norm_col = body.detail.get("norm_col") or g["norm"]
    if norm_col and body.detail.get("comparable", False):
        out["nhanes"] = gym.nhanes_percentile(norm_col, body.score, p.age, p.female)
    return out


# ====================================================================== MRI brain age (real 3D CNN)
def _mri_payload(p: Player | None, v, age, source: str, only: int | None = None) -> dict:
    from neurotrail import brainage_ensemble as be, mri
    # Upgraded models (interval + confidence) when trained; otherwise the original 4 mm CNN path.
    res = be.estimate(v, age, only) if be.available() else mri.analyze(v, age, only)
    cam = res.pop("_cam", None)
    imgs = mri.slices_png(v, cam) if tuple(v.shape) == mri.SHAPE else {}
    res["images"] = {k: "data:image/png;base64," + base64.b64encode(b).decode() for k, b in imgs.items()}
    res["model"] = mri.metrics()
    if p is not None:
        db.add_mri(p.name, source, age, res.get("brain_age"), res.get("gap"), res["format"]["ok"])
    return res


@app.get("/api/mri/samples")
def mri_samples() -> list[dict]:
    """Real OASIS scans to try: dementia cases (unseen by every model) and normal first sessions
    (each scored by the one fold model that held that person out)."""
    d = pd.read_csv(ART / "mri_cnn_predictions.csv").replace({np.nan: None})
    pick = pd.concat([d[d["status"] != "cognitively normal"].sample(8, random_state=1),
                      d[(d["status"] == "cognitively normal") & (d["session"] == "MR1")].sample(8, random_state=1)])
    return pick[["ID", "file", "Age", "female", "CDR", "status", "brain_age"]].to_dict("records")


@app.post("/api/player/{name}/mri/sample")
def mri_sample(name: str, file: str = Form(...)) -> dict:
    import nibabel as nib
    p = get(name)
    d = pd.read_csv(ART / "mri_cnn_predictions.csv")
    row = d[d["file"] == file]
    if row.empty:
        raise HTTPException(404, "unknown sample")
    f = next((ROOT / "data" / "raw" / "oasis_mri").glob(f"**/{file}"))
    v = np.asanyarray(nib.load(f).dataobj, dtype=np.float32)
    from neurotrail import mri
    fold = mri.heldout_fold(file) if row["status"].iloc[0] == "cognitively normal" else None
    out = _mri_payload(p, v, float(row["Age"].iloc[0]), f"OASIS sample {row['ID'].iloc[0]}", fold)
    r = row.iloc[0]
    oof_age = float(r["brain_age"])
    from neurotrail import brainage_ensemble as be
    if be.available():   # the active model's own out-of-fold estimate for this scan
        o = pd.read_csv(ROOT / "results" / f"oof_{be.config_name(be.MRI_MODEL)}.csv")
        oof_age = float(o.loc[o["scan_id"] == r["ID"], "pred_age"].iloc[0])
    out["truth"] = {"id": r["ID"], "age": float(r["Age"]), "status": r["status"],
                    "cdr": None if pd.isna(r["CDR"]) else float(r["CDR"]),
                    "oof_brain_age": oof_age,
                    "note": ("Dementia participants were never seen by any model, so every fold model was used."
                             if r["status"] != "cognitively normal"
                             else f"Scored only by fold {fold}'s models, the ones that never saw this person's scan.")}
    return out


@app.post("/api/player/{name}/mri/upload")
async def mri_upload(name: str, file: UploadFile = File(...), age: float | None = Form(None)) -> dict:
    from neurotrail import mri
    p = get(name)
    if not file.filename.lower().endswith((".nii", ".nii.gz")):
        raise HTTPException(400, "Upload a NIfTI file (.nii or .nii.gz)")
    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(400, "File too large (200 MB max)")
    try:
        v = mri.load_upload(data, file.filename)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Couldn't read that NIfTI file: {e}")
    return _mri_payload(p, v, age if age is not None else float(p.age), f"upload {file.filename}")


@app.get("/api/mri/metrics")
def mri_metrics() -> dict:
    from neurotrail import mri
    if not (ART / "mri_cnn_metrics.json").exists():
        raise HTTPException(503, "The 3D CNN is still training on the OASIS scans. Check back in a few minutes.")
    from neurotrail import brainage_ensemble as be
    out = dict(mri.metrics())
    if be.available():   # headline numbers of the model the app is actually using
        em = be.config(be.MRI_MODEL)["metrics"]
        tr = em["test_retest"]
        out.update({"active_model": be.MRI_MODEL, "mae": em["mae"], "r": em["r"], "clinical_validity": em["clinical_validity"],
                    "test_retest": {"n_pairs": tr["n_pairs"], "icc": tr["icc_3_1"], "mean_abs_diff": tr["mean_abs_diff"],
                                    "smallest_detectable_change": tr["smallest_detectable_change"]},
                    "interval_coverage_95": em.get("interval_coverage_95"), "nwbv_model_mae": out.get("nwbv_model_mae"),
                    "n_models": {m: len(be.members(m)) for m in be.config(be.MRI_MODEL)["models"]}})
    return out


@app.get("/api/mri/comparison")
def mri_comparison() -> dict:
    """Every brain-age model on the same folds (results/metrics_*.json) + the frozen confidence rules."""
    import json
    res = ROOT / "results"
    names = [("baseline_4mm", "Baseline 4 mm CNN"), ("cnn_2mm", "CNN 2 mm"), ("sfcn_ft", "SFCN fine-tuned"),
             ("volume", "Volume model"), ("ensemble", "Ensemble (used by the app)")]
    rows = []
    for n, label in names:
        f = res / f"metrics_{n}.json"
        if not f.exists():
            continue
        m = json.loads(f.read_text())
        # Calibrated intervals only: cal_<model> for single models (raw pred_std is just the seed spread).
        cal = res / (f"metrics_{n}.json" if n == "ensemble" else f"metrics_cal_{n}.json")
        cov = json.loads(cal.read_text()).get("interval_coverage_95") if cal.exists() else None
        rows.append({"model": n, "label": label, "mae": m["mae"], "r": m["r"], "auc": m["clinical_validity"]["auc"],
                     "auc_ci": m["clinical_validity"]["auc_ci"], "icc": m["test_retest"]["icc_3_1"],
                     "sdc": m["test_retest"]["smallest_detectable_change"], "coverage": cov})
    cfg = res / "ensemble_config.json"
    c = json.loads(cfg.read_text()) if cfg.exists() else None
    from neurotrail import brainage_ensemble as be
    return {"rows": rows, "active_model": be.MRI_MODEL if be.available() else "baseline_4mm (original)",
            "rules": c and {**c["rules"], "similarity_cutoff": c["similarity_cutoff"],
                            "similarity_comfort": c["similarity_comfort_p5"], "age_range": c["age_range"]},
            "limits": ["Small training set: 316 cognitively normal people from one dataset (OASIS-1).",
                       "Scans must be preprocessed like the training scans: skull-stripped, N4, FSL MNI152 2 mm.",
                       "Test-retest reliability comes from 20 young adults (19–34) only.",
                       "A research tool, not a diagnosis."]}


# ====================================================================== Voice check
@app.get("/api/voice/tasks")
def voice_tasks() -> dict:
    return {"reading": vox.READING, "free": vox.FREE_PROMPT, "evidence": vox.EVIDENCE_URL}


@app.post("/api/player/{name}/voice")
async def voice_check(name: str, file: UploadFile = File(...), task: str = Form("reading"),
                      words: int | None = Form(None)) -> dict:
    p = get(name)
    if task not in ("reading", "free"):
        raise HTTPException(400, "task must be reading or free")
    data = await file.read()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(400, "Recording too large")
    try:
        x, sr = vox.load_wav(data)
        m = vox.analyze(x, sr)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Couldn't read the recording: {e}")
    if words and task == "free":
        m["words_per_min"] = round(words / max(m["speaking_span_s"], 1) * 60, 1)
    first_today = not any(v["date"] == today() for v in db.voices(p.name))
    db.add_voice(p.name, today(), task, m, words)
    if first_today:
        db.add_game(p.name, "voice", today(), m["speech_tempo"], {"task": task}, gym.GAME_SPARKS)
    hist = [v for v in db.voices(p.name) if v["task"] == task]
    base = hist[0]["metrics"] if len(hist) > 1 else None
    return {"metrics": m, "plain": vox.plain_summary(m), "sparks_gained": gym.GAME_SPARKS if first_today else 0,
            "history": [{"ts": v["ts"], **v["metrics"]} for v in hist][-30:], "baseline": base, "player": snapshot(p)}


@app.get("/api/player/{name}/voice")
def voice_history(name: str) -> dict:
    get(name)
    return {"history": db.voices(name)}


# ====================================================================== Phone & watch data
@app.post("/api/player/{name}/wearables")
async def wearables_upload(name: str, file: UploadFile = File(...)) -> dict:
    p = get(name)
    data = await file.read()
    if len(data) > 800 * 1024 * 1024:
        raise HTTPException(400, "File too large (800 MB max)")
    try:
        days = wearables.parse_upload(data, file.filename)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Couldn't read that file: {e}")
    if not days:
        raise HTTPException(422, "No steps, sleep or heart data found in that file.")
    n = db.put_days(p.name, days, file.filename)
    return wearables_get(name) | {"imported_days": n}


@app.get("/api/player/{name}/wearables")
def wearables_get(name: str) -> dict:
    p = get(name)
    all_days = db.days(p.name)
    recent = dict(list(all_days.items())[-60:])
    return {"days": recent, "summary": wearables.summary(all_days), "player": snapshot(p)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8600")), log_level="warning")
