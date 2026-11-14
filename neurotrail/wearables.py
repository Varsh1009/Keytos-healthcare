"""
Import real data from a phone, watch or fitness tracker. Only daily numbers are stored.

Ways in (an Apple Watch can't talk to a web page directly: Apple keeps Health data on the phone,
so every route goes through the iPhone):
  1. Apple Health export: Health app → profile picture → Export All Health Data → export.zip.
     Upload the zip (or the export.xml inside). Works for Apple Watch and iPhone-only users.
  2. Live sync from the iPhone: the "Health Auto Export" app (REST API automation) or an iOS
     Shortcut POSTs JSON to /api/player/{name}/wearables/sync with the player's sync token.
     The phone must be able to reach this server (same Wi-Fi + HOST=0.0.0.0, or a deployed URL).
  3. Fitbit: Google Takeout zip (Fitbit/Global Export Data/steps-*.json, sleep-*.json,
     resting_heart_rate-*.json).
  4. Any other app (Garmin, Samsung, Oura, Google Fit): a CSV with a `date` column plus any of the
     field names in FIELDS.

De-duplication: an iPhone and an Apple Watch both count steps. For summed measures we keep, per
day, the single source with the largest total instead of adding them (Apple's Health app does
a similar priority merge).
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from xml.etree.ElementTree import iterparse

# field -> (how to combine a day's samples, label, unit). "sum" fields de-duplicate by source.
FIELD_INFO = {
    "steps": ("sum", "Steps", "steps"),
    "exercise_min": ("sum", "Exercise minutes", "min"),
    "active_kcal": ("sum", "Active energy", "kcal"),
    "daylight_min": ("sum", "Time in daylight", "min"),
    "sleep_hours": ("night", "Sleep", "h"),
    "resting_hr": ("avg", "Resting heart rate", "bpm"),
    "hrv_ms": ("avg", "Heart-rate variability (SDNN)", "ms"),
    "walking_speed": ("avg", "Walking speed", "m/s"),
    "vo2max": ("avg", "Cardio fitness (VO₂ max)", "mL/kg/min"),
    "walking_steadiness": ("avg", "Walking steadiness", "%"),
    "walking_asymmetry": ("avg", "Walking asymmetry", "%"),
    "double_support": ("avg", "Double support time", "%"),
    "spo2": ("avg", "Blood oxygen", "%"),
    "resp_rate": ("avg", "Breathing rate (sleep)", "/min"),
    "headphone_db": ("db", "Headphone volume", "dBA"),
    "noise_db": ("db", "Environmental noise", "dBA"),
    "hearing_pta_db": ("avg", "Hearing threshold (better ear)", "dB HL"),
}
FIELDS = tuple(FIELD_INFO)

APPLE = {
    "HKQuantityTypeIdentifierStepCount": "steps",
    "HKQuantityTypeIdentifierAppleExerciseTime": "exercise_min",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "active_kcal",
    "HKQuantityTypeIdentifierTimeInDaylight": "daylight_min",
    "HKQuantityTypeIdentifierRestingHeartRate": "resting_hr",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "hrv_ms",
    "HKQuantityTypeIdentifierWalkingSpeed": "walking_speed",
    "HKQuantityTypeIdentifierVO2Max": "vo2max",
    "HKQuantityTypeIdentifierAppleWalkingSteadiness": "walking_steadiness",
    "HKQuantityTypeIdentifierWalkingAsymmetryPercentage": "walking_asymmetry",
    "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage": "double_support",
    "HKQuantityTypeIdentifierOxygenSaturation": "spo2",
    "HKQuantityTypeIdentifierRespiratoryRate": "resp_rate",
    "HKQuantityTypeIdentifierHeadphoneAudioExposure": "headphone_db",
    "HKQuantityTypeIdentifierEnvironmentalAudioExposure": "noise_db",
}
ASLEEP = {"HKCategoryValueSleepAnalysisAsleep", "HKCategoryValueSleepAnalysisAsleepCore",
          "HKCategoryValueSleepAnalysisAsleepDeep", "HKCategoryValueSleepAnalysisAsleepREM",
          "HKCategoryValueSleepAnalysisAsleepUnspecified"}
PTA_FREQS = (500, 1000, 2000, 4000)            # WHO pure-tone average frequencies
# plausible daily ranges; anything outside is a sensor/merge glitch and is dropped
RANGE = {"steps": (0, 80000), "exercise_min": (0, 600), "active_kcal": (0, 8000), "daylight_min": (0, 1000),
         "sleep_hours": (0.5, 16), "resting_hr": (30, 130), "hrv_ms": (5, 300), "walking_speed": (0.1, 3),
         "vo2max": (8, 90), "walking_steadiness": (0, 100), "walking_asymmetry": (0, 100),
         "double_support": (0, 100), "spo2": (70, 100), "resp_rate": (5, 40), "headphone_db": (20, 120),
         "noise_db": (20, 130), "hearing_pta_db": (-10, 120)}


def _dt(s: str) -> datetime:
    return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")


def _convert(field: str, v: float, unit: str | None) -> float:
    u = (unit or "").lower()
    if field == "walking_speed":
        v = v / 3.6 if u in ("km/hr", "km/h") else v * 0.44704 if u in ("mi/hr", "mph") else v
    elif field == "active_kcal" and u == "kj":
        v /= 4.184
    elif field in ("walking_steadiness", "walking_asymmetry", "double_support", "spo2") and v <= 1.0:
        v *= 100                       # Apple stores percentages as fractions
    return v


class _Acc:
    """Collects samples, then turns them into one value per day per field."""

    def __init__(self):
        self.sums = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))  # field -> day -> source -> total
        self.avgs = defaultdict(lambda: defaultdict(list))                       # field -> day -> [values]
        self.dbs = defaultdict(lambda: defaultdict(list))                        # field -> day -> [(dB, seconds)]
        self.sources: dict[str, set] = defaultdict(set)

    def add(self, field: str, day: str, v: float, source: str = "?", seconds: float = 60.0):
        how = FIELD_INFO[field][0]
        if how in ("sum", "night"):
            self.sums[field][day][source] += v
        elif how == "db":
            self.dbs[field][day].append((v, max(seconds, 1.0)))
        else:
            self.avgs[field][day].append(v)
        self.sources[day].add(source)

    def days(self) -> dict[str, dict]:
        out: dict[str, dict] = defaultdict(dict)
        for f, by_day in self.sums.items():
            for d, src in by_day.items():
                out[d][f] = max(src.values())
        for f, by_day in self.avgs.items():
            for d, vals in by_day.items():
                out[d][f] = sum(vals) / len(vals)
        for f, by_day in self.dbs.items():
            for d, pairs in by_day.items():
                # sound levels average on an energy scale, weighted by how long each sample lasted
                tot = sum(s for _, s in pairs)
                out[d][f] = 10 * math.log10(sum(10 ** (db / 10) * s for db, s in pairs) / tot)
        clean = {}
        for d, rec in out.items():
            r = {f: round(v, 2) for f, v in rec.items() if RANGE[f][0] <= v <= RANGE[f][1]}
            if "steps" in r:
                r["steps"] = round(r["steps"])
            if r:
                clean[d] = r
        return clean


# ------------------------------------------------------------------ Apple Health export.xml
def _pta(points: list[dict]) -> float | None:
    """Better-ear pure-tone average at 0.5/1/2/4 kHz (WHO grading uses the better ear)."""
    ears = []
    for side in ("left", "right"):
        vals = [p[side] for p in points if p["f"] in PTA_FREQS and p.get(side) is not None]
        if len(vals) == len(PTA_FREQS):
            ears.append(sum(vals) / len(vals))
    return min(ears) if ears else None


def parse_apple(xml_stream) -> dict[str, dict]:
    acc = _Acc()
    audiogram: list[dict] | None = None
    for ev, el in iterparse(xml_stream, events=("start", "end")):
        tag = el.tag
        if ev == "start":
            if tag == "Audiogram" or (tag == "Record" and el.get("type") == "HKDataTypeIdentifierAudiogram"):
                audiogram = []
            continue
        a = el.attrib
        try:
            if tag == "SensitivityPoint" and audiogram is not None:
                num = lambda k: float(a[k]) if a.get(k) not in (None, "") else None
                audiogram.append({"f": round(float(a["frequencyValue"])), "left": num("leftEarValue"),
                                  "right": num("rightEarValue")})
            elif tag == "Audiogram" or (tag == "Record" and a.get("type") == "HKDataTypeIdentifierAudiogram"):
                pta = _pta(audiogram or [])
                if pta is not None:
                    acc.add("hearing_pta_db", a["startDate"][:10], pta, a.get("sourceName", "?"))
                audiogram = None
            elif tag == "Record":
                t = a.get("type")
                src = a.get("sourceName", "?")
                if t == "HKCategoryTypeIdentifierSleepAnalysis" and a.get("value") in ASLEEP:
                    s, e = _dt(a["startDate"]), _dt(a["endDate"])
                    acc.add("sleep_hours", e.date().isoformat(), (e - s).total_seconds() / 3600, src)
                elif t in APPLE:
                    f = APPLE[t]
                    secs = (_dt(a["endDate"]) - _dt(a["startDate"])).total_seconds()
                    acc.add(f, a["startDate"][:10], _convert(f, float(a["value"]), a.get("unit")), src, secs)
        except (KeyError, ValueError):
            pass
        el.clear()                     # values are read at each element's end, so it's safe to free it
    return acc.days()


# ------------------------------------------------------------------ JSON (live sync / Health Auto Export)
HAE = {  # Health Auto Export metric names -> our fields
    "step_count": "steps", "apple_exercise_time": "exercise_min", "active_energy": "active_kcal",
    "time_in_daylight": "daylight_min", "resting_heart_rate": "resting_hr", "heart_rate_variability": "hrv_ms",
    "walking_speed": "walking_speed", "vo2_max": "vo2max", "apple_walking_steadiness": "walking_steadiness",
    "walking_asymmetry_percentage": "walking_asymmetry", "walking_double_support_percentage": "double_support",
    "blood_oxygen_saturation": "spo2", "respiratory_rate": "resp_rate",
    "headphone_audio_exposure": "headphone_db", "environmental_audio_exposure": "noise_db",
}


def parse_json(obj) -> dict[str, dict]:
    """Accepts (a) Health Auto Export {"data": {"metrics": [...]}}, (b) {"days": {date: {field: v}}},
    (c) [{"date": ..., field: v}, ...] as an iOS Shortcut would send."""
    acc = _Acc()
    if isinstance(obj, dict) and isinstance(obj.get("data"), dict) and "metrics" in obj["data"]:
        for m in obj["data"]["metrics"]:
            name, unit = m.get("name"), m.get("units")
            for r in m.get("data", []):
                d = str(r.get("date", ""))[:10]
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
                    continue
                src = r.get("source", "Health Auto Export")
                if name == "sleep_analysis":
                    h = r.get("totalSleep") or r.get("asleep")
                    if isinstance(h, (int, float)):
                        acc.add("sleep_hours", d, float(h), src)
                elif name in HAE and isinstance(r.get("qty"), (int, float)):
                    f = HAE[name]
                    acc.add(f, d, _convert(f, float(r["qty"]), unit), src, 86400)
        return acc.days()
    rows = obj.get("days") if isinstance(obj, dict) else obj
    if isinstance(rows, dict):
        rows = [{"date": d, **v} for d, v in rows.items() if isinstance(v, dict)]
    if not isinstance(rows, list):
        raise ValueError("Unrecognised JSON. Send Health Auto Export JSON or {\"days\": {\"YYYY-MM-DD\": {\"steps\": 1234}}}.")
    out = {}
    for r in rows:
        d = str(r.get("date", ""))[:10] if isinstance(r, dict) else ""
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            continue
        rec = {f: float(r[f]) for f in FIELDS if isinstance(r.get(f), (int, float)) and RANGE[f][0] <= r[f] <= RANGE[f][1]}
        if rec:
            out[d] = rec
    return out


# ------------------------------------------------------------------ Fitbit (Google Takeout)
def _fitbit_date(s: str) -> str | None:
    for fmt in ("%m/%d/%y %H:%M:%S", "%m/%d/%y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def parse_fitbit(z: zipfile.ZipFile) -> dict[str, dict]:
    acc = _Acc()
    for n in z.namelist():
        base = n.rsplit("/", 1)[-1]
        if not base.endswith(".json"):
            continue
        kind = next((k for k in ("steps-", "sleep-", "resting_heart_rate-") if base.startswith(k)), None)
        if not kind:
            continue
        try:
            rows = json.loads(z.read(n))
        except ValueError:
            continue
        for r in rows if isinstance(rows, list) else []:
            try:
                if kind == "steps-":
                    d = _fitbit_date(r["dateTime"])
                    d and acc.add("steps", d, float(r["value"]), "Fitbit")
                elif kind == "sleep-" and r.get("mainSleep", True):
                    acc.add("sleep_hours", r["dateOfSleep"][:10], float(r["minutesAsleep"]) / 60, "Fitbit")
                elif kind == "resting_heart_rate-":
                    v = r["value"]
                    d = _fitbit_date(v.get("date") or r["dateTime"])
                    if d and v.get("value"):
                        acc.add("resting_hr", d, float(v["value"]), "Fitbit")
            except (KeyError, TypeError, ValueError):
                pass
    return acc.days()


# ------------------------------------------------------------------ CSV (any app)
ALIASES = {"sleep": "sleep_hours", "rhr": "resting_hr", "hrv": "hrv_ms", "vo2_max": "vo2max",
           "exercise_minutes": "exercise_min", "active_calories": "active_kcal"}


def parse_csv(text: str) -> dict[str, dict]:
    rows = csv.DictReader(io.StringIO(text))
    cols = {}
    for c in rows.fieldnames or []:
        k = c.lower().strip().replace(" ", "_")
        cols[ALIASES.get(k, k)] = c
    if "date" not in cols:
        raise ValueError("CSV needs a 'date' column (YYYY-MM-DD) plus any of: " + ", ".join(FIELDS))
    days = {}
    for r in rows:
        d = (r[cols["date"]] or "").strip()[:10]
        try:
            datetime.strptime(d, "%Y-%m-%d")
        except ValueError:
            continue
        rec = {}
        for f in FIELDS:
            if f in cols and (r[cols[f]] or "").strip():
                try:
                    v = float(r[cols[f]])
                    if RANGE[f][0] <= v <= RANGE[f][1]:
                        rec[f] = v
                except ValueError:
                    pass
        if rec:
            days[d] = rec
    return days


def parse_upload(data: bytes, filename: str) -> dict[str, dict]:
    name = filename.lower()
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = next((n for n in z.namelist() if n.endswith("export.xml")), None)
            if xml is not None:
                with z.open(xml) as f:
                    return parse_apple(f)
            fb = parse_fitbit(z)
            if fb:
                return fb
            raise ValueError("No Apple Health export.xml or Fitbit data inside that zip.")
    if name.endswith(".xml"):
        return parse_apple(io.BytesIO(data))
    if name.endswith(".json"):
        return parse_json(json.loads(data))
    if name.endswith(".csv"):
        return parse_csv(data.decode("utf-8", errors="replace"))
    raise ValueError("Upload an Apple Health export.zip / export.xml, a Fitbit Takeout zip, JSON, or a CSV.")


def summary(days: dict[str, dict], window: int = 14) -> dict:
    """Averages over the most recent `window` days that have data, plus sleep regularity."""
    if not days:
        return {}
    last = max(days)
    cut = (datetime.fromisoformat(last) - timedelta(days=window - 1)).date().isoformat()
    recent = {d: v for d, v in days.items() if d >= cut}
    out = {"days_with_data": len(days), "from": min(days), "to": last, "window_days": window}
    for f in FIELDS:
        vals = [v[f] for v in recent.values() if f in v]
        if vals:
            out[f] = round(sum(vals) / len(vals), 2)
    out.update(sleep_regularity(days, last, window))
    return out


def sleep_regularity(days: dict[str, dict], end: str, window: int = 14) -> dict:
    """Night-to-night SD of sleep hours over the window (needs >= 5 nights). Lower = more regular."""
    cut = (datetime.fromisoformat(end) - timedelta(days=window - 1)).date().isoformat()
    n = [v["sleep_hours"] for d, v in days.items() if cut <= d <= end and "sleep_hours" in v]
    if len(n) < 5:
        return {}
    m = sum(n) / len(n)
    return {"sleep_sd": round(math.sqrt(sum((x - m) ** 2 for x in n) / (len(n) - 1)), 2)}
