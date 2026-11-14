"""
Download every real dataset NeuroTrail uses. Nothing here is synthetic.

1. NHANES 2011-2012 (suffix G) and 2013-2014 (suffix H), CDC public-use files.
   The cognitive functioning module (CFQ) was given to adults aged 60+ and
   includes the Digit Symbol Substitution Test (DSST), CERAD word learning
   and animal fluency. We join it to the modifiable dementia risk factors
   named by the 2024 Lancet Commission (blood pressure, diabetes, smoking,
   alcohol, inactivity, depression, hearing, cholesterol, obesity, education).
2. OASIS-1 cross-sectional MRI table (via Kaggle: jboysen/mri-and-alzheimers):
   real MRI-derived normalized whole-brain volume (nWBV) for 416 people
   aged 18-96, with dementia ratings (CDR) and MMSE.
3. OASIS-1 real T1 MRI volumes (via Kaggle: ninadaithal/oasis-1-shinohara): 436 skull-stripped,
   MNI 2 mm scans used to train the 3D CNN brain-age model.

4. NHANES 2011-2014 wrist-tracker days (PAXDAY) and step counts from PhysioNet: used to train
   the watch model (models/train_wearable.py).

Run:  python data/download_data.py
"""
from __future__ import annotations

import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent / "raw"
RAW.mkdir(parents=True, exist_ok=True)

# NHANES component files: (file stem, what it holds)
NHANES_FILES = {
    "DEMO": "demographics (age, sex, education, survey weights)",
    "CFQ": "cognitive functioning (DSST, CERAD, animal fluency), age 60+",
    "BPX": "measured blood pressure (exam)",
    "BPQ": "blood pressure / cholesterol questionnaire (meds)",
    "DIQ": "diabetes questionnaire",
    "GHB": "glycohemoglobin (HbA1c) lab",
    "SMQ": "smoking questionnaire",
    "ALQ": "alcohol questionnaire",
    "PAQ": "physical activity questionnaire",
    "SLQ": "sleep questionnaire",
    "DPQ": "depression screener (PHQ-9)",
    "BMX": "body measures (BMI)",
    "TCHOL": "total cholesterol lab",
    "HDL": "HDL cholesterol lab",
    "AUQ": "audiometry / hearing questionnaire",
    "MCQ": "medical conditions (stroke, heart disease)",
    "PAXDAY": "wrist accelerometer, one row per day (wear, sleep, MIMS)",
    "PAXHD": "wrist accelerometer header (device, wear hand)",
}
# 4. Steps from the same NHANES wrist trackers (open, no login): PhysioNet, Koffman & Muschelli,
#    doi:10.13026/d7sw-f662. Minute-level steps (stepcount SSL algorithm) + wake/sleep/non-wear.
PHYSIONET = "https://physionet.org/files/minute-level-step-count-nhanes/1.0.2/"
PHYSIONET_FILES = {  # path -> sha256 published in SHA256SUMS.txt
    "csv/nhanes_1440_scsslsteps.csv.xz": "348d7be60203dbae4f3987358820282b192f596952223c51b1889198c2f7eb86",
    "csv/nhanes_1440_PAXPREDM.csv.xz": "073f9df54185f411e86a062cabf55b497870e77d85b3d68c697d62491ae122cf",
    "subject-info.csv": "f3b76a9b163ac5b55f3969c88ccf51fbd004b2c17216f2eebe3d398ad260564e",
}
CYCLES = {"G": "2011", "H": "2013"}
BASE = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/{year}/DataFiles/{stem}_{sfx}.xpt"


def fetch(url: str, dest: Path) -> None:
    """Download url to dest unless it already exists; reject HTML error pages."""
    if dest.exists() and dest.stat().st_size > 10_000:
        print(f"  have {dest.name}")
        return
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    if data[:200].lstrip().lower().startswith(b"<!doctype") or b"<html" in data[:500].lower():
        raise RuntimeError(f"Got an HTML page instead of data for {url}")
    dest.write_bytes(data)
    print(f"  got  {dest.name} ({len(data)/1e6:.2f} MB)")


def download_nhanes() -> None:
    print("NHANES (CDC public-use files)")
    for sfx, year in CYCLES.items():
        for stem in NHANES_FILES:
            try:
                fetch(BASE.format(year=year, stem=stem, sfx=sfx), RAW / f"{stem}_{sfx}.xpt")
            except urllib.error.HTTPError as e:
                # Not every module exists in every cycle (e.g. hearing questionnaire).
                print(f"  MISSING {stem}_{sfx}: HTTP {e.code} (module not released this cycle)")


def download_physionet_steps() -> None:
    import hashlib
    print("PhysioNet NHANES minute-level step counts (~41 MB)")
    out = RAW / "physionet_steps"
    out.mkdir(exist_ok=True)
    for path, sha in PHYSIONET_FILES.items():
        dest = out / path.rsplit("/", 1)[-1]
        fetch(PHYSIONET + path, dest)
        if hashlib.sha256(dest.read_bytes()).hexdigest() != sha:
            dest.unlink()
            raise RuntimeError(f"checksum mismatch for {dest.name}; deleted, run again")


def download_oasis() -> None:
    print("OASIS-1 cross-sectional MRI table (Kaggle jboysen/mri-and-alzheimers)")
    out = RAW / "oasis"
    if (out / "oasis_cross-sectional.csv").exists():
        print("  have oasis_cross-sectional.csv")
        return
    out.mkdir(exist_ok=True)
    subprocess.run(
        ["kaggle", "datasets", "download", "-d", "jboysen/mri-and-alzheimers",
         "-p", str(out), "--unzip"],
        check=True,
    )


def download_oasis_mri() -> None:
    print("OASIS-1 real MRI volumes (Kaggle ninadaithal/oasis-1-shinohara, ~400 MB)")
    out = RAW / "oasis_mri"
    if any(out.glob("**/*.nii")):
        print("  have MRI volumes")
        return
    out.mkdir(exist_ok=True)
    try:   # kagglehub downloads public datasets without a Kaggle login
        import shutil
        import kagglehub
        src = Path(kagglehub.dataset_download("ninadaithal/oasis-1-shinohara"))
        shutil.copytree(src, out, dirs_exist_ok=True)
        shutil.rmtree(src, ignore_errors=True)       # don't keep a second 1.5 GB copy in the cache
    except ImportError:
        subprocess.run(["kaggle", "datasets", "download", "-d", "ninadaithal/oasis-1-shinohara",
                        "-p", str(out), "--unzip"], check=True)


if __name__ == "__main__":
    download_nhanes()
    download_physionet_steps()
    try:
        download_oasis()
        download_oasis_mri()
    except Exception as e:  # Kaggle needs ~/.kaggle credentials
        print(f"OASIS download failed: {e}", file=sys.stderr)
        sys.exit(1)
    print("done")
