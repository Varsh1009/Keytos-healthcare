"""
Import real data from your phone or watch.

Supported:
  * Apple Health export (export.zip from the Health app, or the export.xml inside it).
    Daily totals for steps, sleep, resting heart rate, heart-rate variability and walking speed.
    iPhone and Apple Watch both record steps; to avoid double counting we take, for each day,
    the source with the most steps (Apple's own approach is similar de-duplication).
  * A simple CSV from any app (Fitbit, Google Fit, Garmin exports): columns `date` plus any of
    `steps`, `sleep_hours`, `resting_hr`, `hrv_ms`, `walking_speed`.
Files are parsed in memory; only the daily numbers are stored.
"""
from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from xml.etree.ElementTree import iterparse

FIELDS = ("steps", "sleep_hours", "resting_hr", "hrv_ms", "walking_speed")
ASLEEP = {"HKCategoryValueSleepAnalysisAsleep", "HKCategoryValueSleepAnalysisAsleepCore",
          "HKCategoryValueSleepAnalysisAsleepDeep", "HKCategoryValueSleepAnalysisAsleepREM",
          "HKCategoryValueSleepAnalysisAsleepUnspecified"}


def _dt(s: str) -> datetime:
    return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")


def parse_apple(xml_stream) -> dict[str, dict]:
    steps = defaultdict(lambda: defaultdict(float))       # day -> source -> steps
    sleep = defaultdict(lambda: defaultdict(float))       # night (end date) -> source -> hours
    avg = {k: defaultdict(list) for k in ("resting_hr", "hrv_ms", "walking_speed")}
    typemap = {"HKQuantityTypeIdentifierRestingHeartRate": "resting_hr",
               "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "hrv_ms",
               "HKQuantityTypeIdentifierWalkingSpeed": "walking_speed"}
    for _, el in iterparse(xml_stream, events=("end",)):
        if el.tag != "Record":
            el.clear()
            continue
        t, a = el.get("type"), el.attrib
        try:
            if t == "HKQuantityTypeIdentifierStepCount":
                steps[a["startDate"][:10]][a.get("sourceName", "?")] += float(a["value"])
            elif t == "HKCategoryTypeIdentifierSleepAnalysis" and a.get("value") in ASLEEP:
                s, e = _dt(a["startDate"]), _dt(a["endDate"])
                sleep[e.date().isoformat()][a.get("sourceName", "?")] += (e - s).total_seconds() / 3600
            elif t in typemap:
                v = float(a["value"])
                if t.endswith("WalkingSpeed") and a.get("unit") == "km/hr":
                    v /= 3.6            # store m/s
                avg[typemap[t]][a["startDate"][:10]].append(v)
        except (KeyError, ValueError):
            pass
        el.clear()
    days: dict[str, dict] = defaultdict(dict)
    for d, src in steps.items():
        days[d]["steps"] = round(max(src.values()))
    for d, src in sleep.items():
        h = max(src.values())
        if 0.5 <= h <= 16:
            days[d]["sleep_hours"] = round(h, 2)
    for k, by_day in avg.items():
        for d, vals in by_day.items():
            days[d][k] = round(sum(vals) / len(vals), 2)
    return dict(days)


def parse_csv(text: str) -> dict[str, dict]:
    rows = csv.DictReader(io.StringIO(text))
    cols = {c.lower().strip(): c for c in (rows.fieldnames or [])}
    if "date" not in cols:
        raise ValueError("CSV needs a 'date' column (YYYY-MM-DD) plus steps / sleep_hours / resting_hr / hrv_ms / walking_speed.")
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
                    rec[f] = float(r[cols[f]])
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
            if xml is None:
                raise ValueError("No export.xml inside that zip. Export from the Health app: profile → Export All Health Data.")
            with z.open(xml) as f:
                return parse_apple(f)
    if name.endswith(".xml"):
        return parse_apple(io.BytesIO(data))
    if name.endswith(".csv"):
        return parse_csv(data.decode("utf-8", errors="replace"))
    raise ValueError("Upload Apple Health export.zip / export.xml, or a CSV.")


def summary(days: dict[str, dict], window: int = 14) -> dict:
    """Averages over the most recent `window` days that have data."""
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
    return out
