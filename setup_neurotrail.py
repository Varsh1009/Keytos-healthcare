"""
One command to get NeuroTrail running on a fresh laptop (Mac, Windows or Linux):

    python setup_neurotrail.py              # everything (~2 GB download, about 5-10 minutes)
    python setup_neurotrail.py --skip-mri   # skip the 1.5 GB MRI sample scans

What it does:
  1. Makes a Python environment in .venv (if you're not already in one) and installs requirements.txt.
  2. Downloads the public data the app uses (none of it needs an account or login):
       - CDC NHANES 2011-2014 (cognition tests, health, wrist tracker)  ~100 MB
       - PhysioNet NHANES step counts (for the watch model)               ~40 MB
       - PhysioNet resting EEG recordings (EEG samples)                   ~10 MB
       - OASIS-1 MRI table + 436 real MRI scans from Kaggle               ~1.5 GB
  3. Checks everything arrived and tells you how to start the app.

Already in the repo, so no download needed: the trained models, and the made-up sample Apple Watch
data (data/samples/apple_health_sample.zip). Safe to run again: finished downloads are skipped.
"""
from __future__ import annotations

import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
WIN = os.name == "nt"
VPY = VENV / ("Scripts/python.exe" if WIN else "bin/python")


def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def run(cmd: list[str]) -> None:
    print("   $", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=ROOT)


def main() -> None:
    try:                                   # Windows consoles default to cp1252, which can't print ✓
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if sys.version_info < (3, 10):
        sys.exit(f"Python 3.10 or newer is needed (you have {sys.version.split()[0]}). Install it from python.org.")
    in_venv = sys.prefix != sys.base_prefix
    py = Path(sys.executable) if in_venv else VPY

    step("1/3  Python environment + requirements")
    if not in_venv and not VPY.exists():
        print("   making .venv")
        venv.create(VENV, with_pip=True)
    run([py, "-m", "pip", "install", "--upgrade", "pip", "-q"])
    run([py, "-m", "pip", "install", "-r", "requirements.txt"])

    step("2/3  Public data (finished files are skipped)")
    run([py, "data/download_data.py", *(["--skip-mri"] if "--skip-mri" in sys.argv else [])])

    step("3/3  Checking")
    ok = check("--skip-mri" in sys.argv)
    start = ".venv\\Scripts\\python web\\server.py" if WIN else ".venv/bin/python web/server.py"
    if in_venv:
        start = "python web/server.py"
    print("\n" + ("All set." if ok else "Mostly set (see the ✗ lines above)."), "Start the app with:\n")
    print(f"    {start}\n\nthen open http://localhost:8600")


def check(skip_mri: bool) -> bool:
    raw = ROOT / "data" / "raw"
    items = [
        ("NHANES files", len(list(raw.glob("*.xpt"))) >= 30, "re-run this script"),
        ("PhysioNet step counts", (raw / "physionet_steps" / "nhanes_1440_scsslsteps.csv.xz").exists(), "re-run this script"),
        ("OASIS MRI table", any(raw.glob("oasis/*.csv")), "re-run this script"),
        ("EEG samples (8 resting recordings)", len(list((raw / "eeg_samples").glob("*.edf"))) >= 8, "re-run this script"),
        ("Sample Apple Watch data", (ROOT / "data" / "samples" / "apple_health_sample.zip").exists(), "git pull"),
        ("Trained models", (ROOT / "models" / "artifacts" / "cognition_gbm.joblib").exists(), "git pull"),
    ]
    if not skip_mri:
        n = len(list((raw / "oasis_mri").rglob("*.nii*")))
        items.append((f"MRI sample scans ({n} of 436)", n >= 436, "re-run this script"))
    good = True
    for name, passed, fix in items:
        print(f"   {'✓' if passed else '✗'} {name}" + ("" if passed else f"  → {fix}"))
        good &= passed
    return good


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"\nA step failed (exit code {e.returncode}). Fix the message above and run this script again; "
                 "it skips what's already done.\nCERTIFICATE_VERIFY_FAILED? Run: pip install pip-system-certs")
