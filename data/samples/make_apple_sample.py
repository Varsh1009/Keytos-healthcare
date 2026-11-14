"""
Build data/samples/apple_health_sample.zip: a MADE-UP 90-day Apple Health export (not a real person).

Same file layout and XML format as the iPhone Health app's "Export All Health Data", so loading it
runs the exact importer a real upload uses (neurotrail/wearables.py). The story: a 70-year-old who
starts walking more and keeping a steadier sleep schedule halfway through.

It deliberately includes the messy parts of real exports:
  * iPhone AND Apple Watch both counting the same steps (must not be added together)
  * sleep split into Core / Deep / REM / Awake segments across midnight
  * walking speed in km/hr, blood oxygen as a fraction, energy in kcal
  * one AirPods Pro hearing test (audiogram)

Run:  python data/samples/make_apple_sample.py
"""
from __future__ import annotations

import io
import math
import random
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

OUT = Path(__file__).with_name("apple_health_sample.zip")
DAYS = 90
END = date(2026, 1, 31)          # dates are shifted to "today" when loaded into the app
TZ = "-0500"
PHONE, WATCH, PODS = "Sample iPhone", "Sample Apple Watch", "Sample AirPods Pro"


def ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S ") + TZ


def rec(t, src, start, end, value, unit=None, device=""):
    u = f' unit="{unit}"' if unit else ""
    return (f' <Record type="{t}" sourceName="{src}" sourceVersion="17.2"{u} creationDate="{ts(end)}" '
            f'startDate="{ts(start)}" endDate="{ts(end)}" value="{value}"/>\n')


def build() -> str:
    rnd = random.Random(7)
    out = ['<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData>\n<HealthData locale="en_US">\n',
           ' <ExportDate value="2026-01-31 21:00:00 -0500"/>\n',
           ' <Me HKCharacteristicTypeIdentifierDateOfBirth="1956-03-14" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexFemale"/>\n']
    start = END - timedelta(days=DAYS - 1)
    for i in range(DAYS):
        d = start + timedelta(days=i)
        ramp = min(1.0, max(0.0, (i - 40) / 25))          # habits improve from day 40 to 65
        day0 = datetime(d.year, d.month, d.day)
        steps = max(800, rnd.gauss(3400 + 2600 * ramp, 900))
        if d.weekday() >= 5:
            steps *= 0.85
        hours = [8, 10, 12, 15, 17, 19]
        w = [rnd.random() + 0.3 for _ in hours]
        for h, share in zip(hours, w):
            n = steps * share / sum(w)
            s = day0 + timedelta(hours=h, minutes=rnd.randint(0, 20))
            e = s + timedelta(minutes=rnd.randint(15, 40))
            out.append(rec("HKQuantityTypeIdentifierStepCount", WATCH, s, e, round(n), "count"))
            if rnd.random() < 0.8:                          # the phone in a pocket sees most of the same walk
                out.append(rec("HKQuantityTypeIdentifierStepCount", PHONE, s, e, round(n * rnd.uniform(0.6, 0.95)), "count"))
            out.append(rec("HKQuantityTypeIdentifierWalkingSpeed", PHONE, s, s + timedelta(minutes=1),
                           round(rnd.gauss(4.0 + 0.2 * ramp, 0.25), 2), "km/hr"))
        ex = max(0, rnd.gauss(8 + 22 * ramp, 6))
        out.append(rec("HKQuantityTypeIdentifierAppleExerciseTime", WATCH, day0 + timedelta(hours=10),
                       day0 + timedelta(hours=10, minutes=int(ex)), round(ex), "min"))
        out.append(rec("HKQuantityTypeIdentifierActiveEnergyBurned", WATCH, day0 + timedelta(hours=7),
                       day0 + timedelta(hours=21), round(steps * 0.045 + ex * 4, 1), "kcal"))
        out.append(rec("HKQuantityTypeIdentifierTimeInDaylight", WATCH, day0 + timedelta(hours=9),
                       day0 + timedelta(hours=17), round(max(5, rnd.gauss(35 + 30 * ramp, 15))), "min"))
        out.append(rec("HKQuantityTypeIdentifierRestingHeartRate", WATCH, day0, day0 + timedelta(hours=23),
                       round(rnd.gauss(69 - 3 * ramp, 2)), "count/min"))
        out.append(rec("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", WATCH, day0 + timedelta(hours=3),
                       day0 + timedelta(hours=3, minutes=1), round(rnd.gauss(31 + 4 * ramp, 5), 1), "ms"))
        out.append(rec("HKQuantityTypeIdentifierOxygenSaturation", WATCH, day0 + timedelta(hours=2),
                       day0 + timedelta(hours=2), round(min(1.0, rnd.gauss(0.965, 0.01)), 3), "%"))
        out.append(rec("HKQuantityTypeIdentifierRespiratoryRate", WATCH, day0 + timedelta(hours=2),
                       day0 + timedelta(hours=2), round(rnd.gauss(15, 0.8), 1), "count/min"))
        if i % 7 == 3:
            out.append(rec("HKQuantityTypeIdentifierVO2Max", WATCH, day0 + timedelta(hours=11),
                           day0 + timedelta(hours=11), round(24.5 + 2.0 * ramp + rnd.gauss(0, 0.3), 1), "mL/min·kg"))
        if rnd.random() < 0.6:
            s = day0 + timedelta(hours=rnd.choice([9, 13, 18]))
            out.append(rec("HKQuantityTypeIdentifierHeadphoneAudioExposure", PODS, s, s + timedelta(minutes=rnd.randint(20, 90)),
                           round(rnd.gauss(73, 4), 1), "dBASPL"))
        # the night that ENDS on the morning of day d+1: bedtime varies less once habits improve
        bed = day0 + timedelta(hours=22, minutes=30) + timedelta(minutes=rnd.gauss(0, 75 - 50 * ramp))
        total = rnd.gauss(6.4 + 0.7 * ramp, 1.0 - 0.6 * ramp) * 60
        t = bed
        for stage, frac in (("Core", .45), ("Deep", .15), ("REM", .2), ("Awake", .04), ("Core", .16)):
            mins = max(5, total * frac)
            out.append(f' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="{WATCH}" sourceVersion="10.2" '
                       f'creationDate="{ts(t + timedelta(minutes=mins))}" startDate="{ts(t)}" endDate="{ts(t + timedelta(minutes=mins))}" '
                       f'value="HKCategoryValueSleepAnalysis{"Asleep" + stage if stage != "Awake" else "Awake"}"/>\n')
            t += timedelta(minutes=mins)
    hear = start + timedelta(days=50)
    pts = {500: (15, 20), 1000: (15, 20), 2000: (20, 25), 4000: (30, 35), 8000: (45, 50)}
    out.append(f' <Audiogram type="HKDataTypeIdentifierAudiogram" sourceName="{PODS}" sourceVersion="18.1" '
               f'creationDate="{ts(datetime(hear.year, hear.month, hear.day, 15))}" startDate="{ts(datetime(hear.year, hear.month, hear.day, 15))}" '
               f'endDate="{ts(datetime(hear.year, hear.month, hear.day, 15, 8))}">\n')
    for f, (l, r) in pts.items():
        out.append(f'  <SensitivityPoint frequencyValue="{f}" frequencyUnit="Hz" leftEarValue="{l}" leftEarUnit="dBHL" '
                   f'rightEarValue="{r}" rightEarUnit="dBHL"/>\n')
    out.append(" </Audiogram>\n</HealthData>\n")
    return "".join(out)


if __name__ == "__main__":
    xml = build()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("apple_health_export/export.xml", xml)
        z.writestr("apple_health_export/README.txt",
                   "MADE-UP sample data for NeuroTrail. Not a real person. Built by data/samples/make_apple_sample.py\n")
    OUT.write_bytes(buf.getvalue())
    print(f"wrote {OUT.name}: {len(xml) / 1e6:.1f} MB xml, {OUT.stat().st_size / 1e3:.0f} KB zipped")
