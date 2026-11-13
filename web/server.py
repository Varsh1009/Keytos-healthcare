"""
NeuroTrail backend. Python serves every number (models, evidence, game state in
SQLite, the AI coach). The browser only draws.

Run:  python web/server.py   then open http://localhost:8600
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import uvicorn
import base64
import json
import random

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurotrail import auth, coach, db, diseases, games as gym, regions as RG, scoring, tissue, voice as vox, wearables  # noqa: E402
from neurotrail.quests import LANCET_CITE, QUEST_BY_ID, QUESTS, TIER_BONUS  # noqa: E402
from neurotrail.state import Player, today  # noqa: E402

WEB = Path(__file__).resolve().parent
ART = ROOT / "models" / "artifacts"
app = FastAPI(title="NeuroTrail")
app.mount("/static", StaticFiles(directory=WEB / "static"), name="static")


class MeRouter:
    """Resolve /api/me/... to the signed-in player; refuse direct /api/player/... from the browser."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope["path"]
            if path.startswith("/api/player/"):
                return await JSONResponse({"detail": "Use /api/me (sign in first)"}, 401)(scope, receive, send)
            if path.startswith("/api/me"):
                cookies = {}
                for k, v in scope.get("headers", []):
                    if k == b"cookie":
                        for part in v.decode().split(";"):
                            if "=" in part:
                                a, b = part.strip().split("=", 1)
                                cookies[a] = b
                name = auth.player_for(cookies.get(auth.COOKIE))
                if not name:
                    return await JSONResponse({"detail": "Not signed in"}, 401)(scope, receive, send)
                from urllib.parse import quote
                rest = path[len("/api/me"):]
                new = f"/api/player/{quote(name)}{rest}"
                scope = {**scope, "path": new, "raw_path": new.encode()}
        return await self.app(scope, receive, send)


app.add_middleware(MeRouter)


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


RING_OF = {"steps": "move", "bp": "body", "labs": "body", "smoke": "body", "sleep": "body", "hearing": "body",
           "connect": "mind", "joy": "mind", "speed": "mind"}
RING_GOAL = 150


def _rings(p: Player) -> dict:
    """Weekly care rings (last 7 days): evidence-weighted habit points + check points."""
    cut = (date.today() - timedelta(days=6)).isoformat()
    r = {"move": 0, "mind": 0, "body": 0}
    for l in p.logs:
        if l["date"] >= cut:
            r[RING_OF.get(l["quest"], "mind")] += l["sparks"]
    for g in db.games(p.name):
        if g["date"] >= cut:
            r["mind"] += g["sparks"]
    return {k: {"points": v, "goal": RING_GOAL} for k, v in r.items()}


def snapshot(p: Player) -> dict:
    rounds = db.rounds(p.name)
    return {
        "name": p.name, "onboarded": p.onboarded, "profile": p.profile(), "sparks": p.sparks,
        "level": p.level(), "streak": p.streak(), "week": p.week(), "trail": p.trail_status(),
        "steps": {q.id: p.steps_today(q.id) for q in p.active_quests()},
        "lever": scoring.lever_age(p.profile()) if p.onboarded else None,
        "support": bool(p.phq9 is not None and p.phq9 >= 10) or p.feel_down,
        "best_speed": max((r["correct"] for r in rounds), default=None),
        "first_speed": rounds[0]["correct"] if rounds else None,
        "rings": _rings(p),
        "rounds_today": sum(r["date"] == today() for r in rounds),
    }


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    # cache-bust the front-end on every server start
    v = str(int((WEB / "static" / "app.js").stat().st_mtime))
    return (WEB / "index.html").read_text().replace("__V__", v)


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


def _players_unused() -> list[dict]:
    week0 = (date.today() - timedelta(days=6)).isoformat()
    rows = []
    for n in db.list_players():
        p = Player.load(n)
        rows.append({"name": n, "sparks": p.sparks, "streak": p.streak(),
                     "week_sparks": sum(l["sparks"] for l in p.logs if l["date"] >= week0)})
    return sorted(rows, key=lambda r: -r["week_sparks"])


class NewPlayer(BaseModel):
    name: str = Field(default="Guest", max_length=24)


# ====================================================================== Auth (passkeys + guest)
import secrets as _secrets


def _set_cookie(resp: JSONResponse, token: str) -> JSONResponse:
    resp.set_cookie(auth.COOKIE, token, httponly=True, samesite="strict", max_age=60 * 60 * 24 * auth.SESSION_DAYS, path="/")
    return resp


def _site(request: Request) -> tuple[str, str]:
    """RP ID + origin for the address the browser used (any localhost port, or a configured https host)."""
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
    try:
        return auth.site_for(scheme, request.headers.get("host", ""))
    except auth.SiteError as e:
        raise HTTPException(400, str(e))


def _cookie(request: Request) -> str | None:
    return request.cookies.get(auth.COOKIE)


@app.get("/auth/me")
def auth_me(request: Request) -> dict:
    name = auth.player_for(_cookie(request))
    if not name:
        return {"signed_in": False}
    p = Player.load(name)
    if p is None:
        return {"signed_in": False}
    return {"signed_in": True, "name": name, "guest": bool(p and p.guest), "passkey": auth.has_passkey(name),
            "onboarded": bool(p and p.onboarded)}


@app.post("/auth/guest")
def auth_guest(body: NewPlayer | None = None) -> JSONResponse:
    base = (body.name.strip() if body and body.name.strip() else "Guest")[:20]
    name = base
    while Player.load(name) is not None:
        name = f"{base}-{_secrets.token_hex(2)}"
    p = Player.create(name)
    p.guest = True
    p.save()
    return _set_cookie(JSONResponse({"name": name}), auth.new_session(name, "guest"))


@app.post("/auth/register/options")
def auth_register_options(request: Request) -> dict:
    name = auth.player_for(_cookie(request))
    if not name:
        raise HTTPException(401, "Start as a guest first, then save with a passkey.")
    return auth.register_options(name, _site(request))


class WebAuthnIn(BaseModel):
    key: str
    credential: dict


@app.post("/auth/register/verify")
def auth_register_verify(body: WebAuthnIn) -> dict:
    try:
        name = auth.register_verify(body.key, body.credential)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Passkey not saved: {e}")
    p = Player.load(name)
    p.guest = False
    p.save()
    return {"ok": True, "name": name}


@app.post("/auth/login/options")
def auth_login_options(request: Request) -> dict:
    return auth.login_options(_site(request))


@app.post("/auth/login/verify")
def auth_login_verify(body: WebAuthnIn) -> JSONResponse:
    try:
        name = auth.login_verify(body.key, body.credential)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Sign-in failed: {e}")
    return _set_cookie(JSONResponse({"ok": True, "name": name}), auth.new_session(name, "passkey"))


@app.post("/auth/logout")
def auth_logout(request: Request) -> JSONResponse:
    auth.end(_cookie(request))
    r = JSONResponse({"ok": True})
    r.delete_cookie(auth.COOKIE, path="/")
    return r


@app.get("/api/player/{name}")
def player(name: str) -> dict:
    return snapshot(get(name))


class Onboard(BaseModel):
    """Quick start: 2 screens. No education/income (the score doesn't use them), no depression form."""
    age: int = Field(ge=18, le=100)
    female: bool
    diabetes: bool
    current_smoker: bool
    sleep_hours: float = Field(ge=2, le=12)
    sbp: float | None = Field(default=None, ge=70, le=250)   # only if they know it
    hearing_trouble: bool = False
    feel_down: bool = False


@app.post("/api/player/{name}/onboard")
def onboard(name: str, body: Onboard) -> dict:
    p = get(name)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    p.onboarded = True
    p.save()
    return snapshot(p)


class Mood(BaseModel):
    answers: list[int] = Field(min_length=8, max_length=8)   # PHQ-8 (no self-harm item)


@app.post("/api/player/{name}/mood")
def mood(name: str, body: Mood) -> dict:
    """PHQ-8 (Kroenke 2009). Score >= 10 shows support resources before anything else."""
    p = get(name)
    p.phq9 = int(sum(max(0, min(3, x)) for x in body.answers))
    p.feel_down = p.phq9 >= 10
    p.save()
    return {"score": p.phq9, "support": p.phq9 >= 10, "player": snapshot(p)}


class Profile(BaseModel):
    sbp: float | None = Field(default=None, ge=70, le=250)
    sleep_hours: float | None = Field(default=None, ge=2, le=12)
    diabetes: bool | None = None
    current_smoker: bool | None = None
    hearing_trouble: bool | None = None


@app.post("/api/player/{name}/profile")
def update_profile(name: str, body: Profile) -> dict:
    p = get(name)
    for k, v in body.model_dump().items():
        if v is not None:
            setattr(p, k, v)
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
    # Steps are guidance, not gates (UX review): one clear "Done".
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
    if n == 1:   # first round today earns the daily check points
        db.add_game(p.name, "speed", today(), body.correct, {}, gym.GAME_SPARKS)
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
        lever_hist.append({"date": d, "points": scoring.lever_age(prof)["points"]})
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
    sbp: float | None = None
    diabetes: bool
    current_smoker: bool
    active_min_week: float = 0
    sedentary_min_day: float = 360
    sleep_hours: float
    phq9: float | None = None


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
def recall_words(avoid: str | None = None) -> dict:
    """A word list, never the one you learned last time (avoid = its first word), so practice doesn't inflate scores."""
    lists = [w for w in gym.WORD_LISTS if w[0] != avoid] or gym.WORD_LISTS
    words = random.choice(lists)
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
    sparks = gym.GAME_SPARKS if first_today and g["id"] != "recall_delayed" else 0   # part of Word Recall, no extra points
    db.add_game(p.name, g["id"], today(), body.score, body.detail, sparks)
    out = {"sparks_gained": sparks, "stats": game_stats(p, g["id"]), "player": snapshot(p)}
    norm_col = body.detail.get("norm_col") or g["norm"]
    if norm_col and body.detail.get("comparable", False):
        out["nhanes"] = gym.nhanes_percentile(norm_col, body.score, p.age, p.female)
    return out


# ====================================================================== MRI brain age (real 3D CNN)
def _mri_payload(p: Player | None, v, age, source: str, only: int | None = None, female: bool | None = None) -> dict:
    from neurotrail import mri
    res = mri.analyze(v, age, only)
    cam = res.pop("_cam", None)
    imgs = mri.slices_png(v, cam) if tuple(v.shape) == mri.SHAPE else {}
    res["images"] = {k: "data:image/png;base64," + base64.b64encode(b).decode() for k, b in imgs.items()}
    res["model"] = mri.metrics()
    regions = None
    if tuple(v.shape) == mri.SHAPE and age is not None:
        regions = {k: round(z, 3) for k, z in RG.zscores(RG.measure(v), age, p.female if female is None else female).items()}
        res["regions"] = regions
    if p is not None:
        db.add_mri(p.name, source, age, res.get("brain_age"), res.get("gap"), res["format"]["ok"], regions)
    return res


OASIS_RAW = ROOT / "data" / "raw" / "oasis_mri"


@app.get("/api/mri/status")
def mri_status() -> dict:
    """The sample scans are real OASIS files that aren't redistributed; they appear after data/download_data.py."""
    return {"samples": (OASIS_RAW / "oasis_cross-sectional.csv").exists()}


@app.get("/api/mri/samples")
def mri_samples() -> list[dict]:
    """Real OASIS scans to try: dementia cases (unseen by every model) and normal first sessions
    (each scored by the one fold model that held that person out)."""
    d = pd.read_csv(ART / "mri_cnn_predictions.csv").replace({np.nan: None})
    pick = pd.concat([d[d["status"] != "cognitively normal"].sample(8, random_state=1),
                      d[(d["status"] == "cognitively normal") & (d["session"] == "MR1")].sample(8, random_state=1)])
    return pick[["ID", "file", "Age", "female", "CDR", "status"]].to_dict("records")


def _nwbv_view(age: float, female: bool, nwbv: float) -> dict:
    """Teaching view on a real OASIS scan: OASIS's validated brain volume vs healthy people the same age/sex."""
    from scipy.stats import norm as _n
    tn = json.loads((ART / "tissue_norms.json").read_text())
    m = tn["measures"]["nWBV"]
    b, sc = m["coef"], m["sd_coef"]
    pred = b[0] + b[1] * age + b[2] * age ** 2 + b[3] * float(female)
    sd = max(1e-6, sc[0] + sc[1] * age)
    toward = -(nwbv - pred) / sd                       # positive = less brain tissue than expected
    t = tn["nwbv_teaching"]
    return {"nwbv": nwbv, "expected": pred, "toward": float(toward),
            "per100_lower": int(round(100 * (1 - _n.cdf(toward)))),
            "flag": bool(toward > t["threshold"]), "threshold": t["threshold"],
            "healthy_flag_per100": round(t["healthy60_flag_pct"]), "dementia_flag_per100": round(t["dementia_flag_pct"])}


@app.post("/api/player/{name}/mri/sample")
def mri_sample(name: str, file: str = Form(...)) -> dict:
    import nibabel as nib
    from neurotrail import mri
    p = get(name)
    if not mri_status()["samples"]:
        raise HTTPException(503, "The research scans aren't downloaded on this computer. Run python data/download_data.py (needs a Kaggle account).")
    meta = pd.read_csv(OASIS_RAW / "oasis_cross-sectional.csv")
    d = pd.read_csv(ART / "mri_cnn_predictions.csv")
    row = d[d["file"] == file]
    if row.empty:
        raise HTTPException(404, "unknown sample")
    r = row.iloc[0]
    mrow = meta[meta["ID"] == r["ID"]].iloc[0]
    f = next(OASIS_RAW.glob(f"**/{file}"), None)
    if f is None:
        raise HTTPException(503, "That scan file isn't downloaded on this computer.")
    v = np.asanyarray(nib.load(f).dataobj, dtype=np.float32)
    view = _nwbv_view(float(r["Age"]), bool(r["female"]), float(mrow["nWBV"]))
    imgs = mri.slices_png(v, None)
    db.add_mri(p.name, f"OASIS sample {r['ID']}", float(r["Age"]), None, None, True, {"nwbv_toward": view["toward"]})
    return {"kind": "sample", "id": r["ID"], "age": float(r["Age"]), "female": bool(r["female"]), "status": r["status"],
            "cdr": None if pd.isna(r["CDR"]) else float(r["CDR"]), "view": view,
            "images": {k: "data:image/png;base64," + base64.b64encode(b).decode() for k, b in imgs.items()}}


@app.post("/api/player/{name}/mri/upload")
async def mri_upload(name: str, file: UploadFile = File(...)) -> dict:
    """Uploads get a format check and slice preview only: our own MRI measures did not pass validation,
    so we don't put numbers on a personal scan (see How we know)."""
    from neurotrail import mri
    get(name)
    if not file.filename.lower().endswith((".nii", ".nii.gz")):
        raise HTTPException(400, "Upload a NIfTI file (.nii or .nii.gz)")
    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(400, "File too large (200 MB max)")
    try:
        v = mri.load_upload(data, file.filename)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Couldn't read that NIfTI file: {e}")
    fmt = mri.check_format(v)
    imgs = mri.slices_png(v, None) if tuple(v.shape) == mri.SHAPE else {}
    return {"kind": "upload", "format": fmt,
            "images": {k: "data:image/png;base64," + base64.b64encode(b).decode() for k, b in imgs.items()}}


@app.get("/api/facts")
def facts() -> dict:
    return json.loads((ART / "facts.json").read_text())


@app.get("/api/mri/metrics")
def mri_metrics() -> dict:
    from neurotrail import mri
    if not (ART / "mri_cnn_metrics.json").exists():
        raise HTTPException(503, "The 3D CNN is still training on the OASIS scans. Check back in a few minutes.")
    return mri.metrics()


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


# ====================================================================== Brain disease atlas
SKILLS = [  # skill -> games that track it -> brain regions most linked to that skill (approximate)
    {"id": "memory", "name": "Memory", "icon": "📝", "games": ["recall"], "better": "higher",
     "regions": ["hippocampus", "Parahippocampal Gyrus", "Temporal Pole", "Middle Temporal Gyrus"]},
    {"id": "speed", "name": "Speed & attention", "icon": "⚡", "games": ["speed", "stroop", "trails"], "better": "mixed",
     "regions": ["Middle Frontal Gyrus", "Superior Frontal Gyrus", "Cingulate Gyrus, anterior", "Superior Parietal Lobule"]},
    {"id": "movement", "name": "Movement", "icon": "🏃", "games": ["reaction"], "better": "lower",
     "regions": ["Precentral Gyrus", "Juxtapositional Lobule Cortex", "putamen", "caudate"]},
    {"id": "language", "name": "Language & speech", "icon": "🗣️", "games": ["fluency", "voice"], "better": "higher",
     "regions": ["Inferior Frontal Gyrus", "Superior Temporal Gyrus", "Planum Temporale", "Angular Gyrus"]},
    {"id": "spatial", "name": "Spatial memory", "icon": "🟦", "games": ["corsi"], "better": "higher",
     "regions": ["Superior Parietal Lobule", "Precuneous Cortex", "Lateral Occipital Cortex, superior"]},
]


@app.get("/api/atlas")
def atlas() -> dict:
    n = RG.norms()
    return {"regions": RG.public_regions(), "diseases": diseases.catalog(),
            "alzheimers_measured": n["alzheimers_map"], "region_test_retest": n.get("test_retest"), "norm_n": n["n_normal"],
            "skills": [{**sk, "regions": diseases._ids(*sk["regions"])} for sk in SKILLS]}


def _skill_status(p: Player) -> list[dict]:
    out = []
    for sk in SKILLS:
        series = []
        for gid in sk["games"]:
            if gid == "speed":
                rows = [r["correct"] for r in db.rounds(p.name)]
                better = "higher"
            elif gid == "voice":
                rows = [v["metrics"]["speech_tempo"] for v in db.voices(p.name) if v["task"] == "reading"]
                better = "higher"
            else:
                rows = [g["score"] for g in db.games(p.name, gid)]
                better = gym.GAME_BY_ID[gid]["better"]
            if rows:
                series.append({"game": gid, "first": rows[0], "last": rows[-1], "plays": len(rows), "better": better,
                               "trend": None if len(rows) < 2 else ("up" if rows[-1] > rows[0] else "down" if rows[-1] < rows[0] else "same")})
        plays = sum(s["plays"] for s in series)
        good = [s for s in series if s["trend"] and ((s["trend"] == "up") == (s["better"] == "higher")) and s["trend"] != "same"]
        bad = [s for s in series if s["trend"] and ((s["trend"] == "up") != (s["better"] == "higher")) and s["trend"] != "same"]
        status = "untested" if not plays else "learning" if plays < 3 or all(s["trend"] is None for s in series) else \
            "improving" if len(good) > len(bad) else "dipping" if len(bad) > len(good) else "steady"
        out.append({"id": sk["id"], "name": sk["name"], "icon": sk["icon"], "status": status, "plays": plays, "series": series})
    return out


@app.get("/api/player/{name}/brain")
def my_brain(name: str) -> dict:
    """Your brain on the atlas: per-region MRI scores (if any scans) + skills from games/voice."""
    p = get(name)
    scans = [m for m in db.mris(p.name) if m["regions"]][::-1]   # oldest -> newest
    rt = RG.norms().get("test_retest", {})
    change = None
    if len(scans) >= 2:
        a, b = scans[-2]["regions"], scans[-1]["regions"]
        thr = rt.get("z_change_95pct", 0.6)
        change = {"threshold": thr, "from": scans[-2]["ts"], "to": scans[-1]["ts"],
                  "regions": {k: round(b[k] - a[k], 3) for k in b if k in a},
                  "beyond_noise": [k for k in b if k in a and abs(b[k] - a[k]) > thr]}
    return {"scans": [{"ts": m["ts"], "source": m["source"], "brain_age": m["brain_age"], "gap": m["gap"],
                       "age": m["age"], "regions": m["regions"]} for m in scans],
            "change": change, "test_retest": rt, "skills": _skill_status(p)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8600, log_level="warning")
