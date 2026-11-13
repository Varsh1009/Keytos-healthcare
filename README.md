# NeuroTrail: brain-health quests. No chip in your head. No scan required.

Keytos Hack 2026, Health track. You don't need an implant (like Neuralink) or an MRI to work on
brain health. NeuroTrail turns the habits with the strongest evidence into a daily game:

- Each quest has concrete action steps.
- Points are weighted by how strong the evidence is.
- The score comes from models trained on real public data.
- Each finished quest lights up a real region on a 3D brain.

## Quick start (fresh clone)

All trained models are in the repo, so nothing needs retraining. You only download the public data.

```bash
# 1. Python 3.12 and Git installed
git clone https://github.com/Varsh1009/Keytos-healthcare.git
cd Keytos-healthcare
git checkout brainage-accuracy         # skip once this branch is merged into main

# 2. Python environment
python -m venv .venv
.venv\Scripts\activate                 # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
# optional, NVIDIA GPU: pip install torch --index-url https://download.pytorch.org/whl/cu126

# 3. Free Kaggle API key: kaggle.com > Settings > API > Create New Token,
#    save kaggle.json in C:\Users\<you>\.kaggle\ (Mac/Linux: ~/.kaggle/)

# 4. Public data: CDC NHANES (direct) + OASIS-1 tables and 436 MRI scans (Kaggle), ~1.6 GB
python data/download_data.py

# 5. Run
python web/server.py                   # open http://localhost:8600
pytest -q                              # optional: 35 tests
```

- `CERTIFICATE_VERIFY_FAILED` while downloading or installing (antivirus / proxy): `pip install pip-system-certs`, then retry.
- AI coach: works offline by default; set `ANTHROPIC_API_KEY` for the Claude agent.
- No GPU: everything works, MRI results just take a few seconds longer.

## Rebuild everything (optional)

```bash
python models/train_cognition.py    # NHANES processing-speed models + associations + fairness
python models/train_brainage.py     # OASIS nWBV brain-age model + validation
python models/splits.py             # fixed, age-balanced 5-fold split shared by every MRI model
python models/train_mri_cnn.py      # 4 mm 3D CNN (~5 min GPU / ~30 min CPU)
python models/train_mri_cnn_2mm.py  # 2 mm 3D CNN, 5 folds x 3 seeds (~1 h on an RTX 3060)
python models/finetune_sfcn.py      # SFCN pretrained on UK Biobank, fine-tuned (~7 min H200 / ~3.5 h laptop GPU)
python models/oof_volume_model.py   # nWBV volume model on the shared folds
python models/ensemble.py --name ensemble --models baseline_4mm cnn_2mm sfcn_ft   # ranges + confidence labels
python models/make_comparison.py    # results/comparison.md
python -m neurotrail.brain_export   # high-res brain mesh + atlas regions for the 3D view
```
`notebooks/brainage_training.ipynb` runs the whole MRI pipeline step by step with charts.

Stack: Python does all the work (pandas, scikit-learn, statsmodels, nilearn, FastAPI). The browser only
draws it, using a single HTML/JS page with Three.js from a CDN. There is no Node and no build step.

## App pages (tabs)

- **Home**: your brain buddy, today's 3-step plan, and what your habits say in plain words.
- **Missions**: the 9 daily missions.
- **Games**: 7 brain games.
- **Voice**: a 1-minute speech check.
- **My data**: phone/watch import, MRI upload, and what-if sliders.
- **Progress**, **Coach** and **Science**.

## Page details

- **Home**: today's progress ring, all quests (play them in any order), coach card, levers, this week.
- **Play**: a dedicated room for one quest. Step checklist, tap-only inputs (sliders, steppers, chips),
  "Fire this neuron". The brain flies to that quest's region.
- **Sprint**: a 90-second symbol-matching speed game, plus a booster round.
- **Progress**: sparks per day, consistency heatmap, BP / steps / sleep / speed trends, lever score
  over time, quest mix, full activity log.
- **Coach**: the AI agent (below) and its saved weekly plans.
- **Levers**: what-if sliders on the NHANES model, plus optional MRI brain age.
- **Science**: every metric, the fairness audit, the evidence table and the architecture.

## Real MRI scans: brain-age ensemble (`neurotrail/brainage_ensemble.py`)

- **Data:** 436 real T1 MRI volumes from Kaggle `ninadaithal/oasis-1-shinohara` (OASIS-1). They're
  skull-stripped, N4 bias-corrected and on the MNI 2 mm grid. Each is joined to that person's real
  age and dementia rating (CDR).
- **Models** (trained only on the 316 cognitively normal people; files in `models/checkpoints/` and
  `models/artifacts/`): a 4 mm 3D CNN, a 2 mm 3D CNN (5 folds x 3 seeds) and SFCN pretrained on
  12,949 UK Biobank brains and fine-tuned here. They are combined by weight (1 / error²).
- **Fair testing:** one fixed, age-balanced 5-fold split by person (`results/splits.json`) for every
  model; every person is scored only by models that never saw them; one shared scorer
  (`models/eval_brainage.py`).
- **Results** (`results/comparison.md`): ensemble usual miss **5.15 years** (r = 0.96; the original
  single 4 mm model: 7.35), repeat-scan ICC **0.956**, smallest detectable change ±3.6 years, dementia
  AUC **0.70** (95% CI 0.63–0.77). Its 95% ranges contained the true age for 94% of people.
- **What the app shows:** brain age, a 95% range, a high / medium / low confidence label with reasons,
  each model's estimate, and Grad-CAM heatmaps. Switch back to the original single model with
  `NEUROTRAIL_MRI_MODEL=baseline_4mm`.
- **Upload:** `.nii` / `.nii.gz`, checked against the training format (skull-stripped, MNI 2 mm,
  template similarity at or above the 1st percentile of the training scans). Scans are never stored.
- **Sample scans:** each is scored only by models that never saw that person.
- **Limits:** one dataset and scanner type, 316 training people, repeat scans only from 20 young adults,
  research-format scans only. An estimate for learning, not a diagnosis.
- **Credit:** SFCN architecture and UK Biobank weights from Peng et al. 2021, *Medical Image Analysis*
  68:101871 ([code, MIT license](https://github.com/ha-ha-ha-han/UKBiobank_deep_pretrain)).

## Voice check (`neurotrail/voice.py`)

You read a short paragraph or tell a 1-minute story. The browser records WAV audio, and Python
(numpy/scipy) measures:
- speech tempo and articulation rate (syllable nuclei)
- number of pauses and the share of time spent pausing
- pitch and pitch variability

These are the temporal speech measures that differed in mild cognitive impairment in Tóth et al.
2018 (PubMed 29165085). The app compares you only with yourself over time; it doesn't diagnose.
Audio is never stored.

## Phone & watch import (`neurotrail/wearables.py`)

- **Apple Health** `export.zip` / `export.xml`: daily steps (de-duplicated across iPhone and Watch),
  sleep (asleep stages only), resting heart rate, heart-rate variability, walking speed.
- **Any CSV** with `date` plus any of `steps`, `sleep_hours`, `resting_hr`, `hrv_ms`, `walking_speed`.
- Your 14-day sleep average replaces the sleep answer you gave at sign-up in your lever score.

## Brain Gym (7 games)

| Game | Based on |
|---|---|
| Speed Sprint | DSST (ACTIVE-trial evidence) |
| Word Recall | CERAD word list, with NHANES percentiles from 2,972 adults 60+ |
| Animal Naming | Animal fluency, with NHANES percentiles from 2,949 adults |
| Trail Connect | Trail Making Test A/B |
| Color Clash | Stroop |
| Memory Grid | Corsi block span |
| Reflex | Reaction time |

Only Speed Sprint has dementia-outcome trial evidence. The others are tracking tools: brain-training
gains rarely transfer to everyday life (Simons et al. 2016, PubMed 27697851).

## Database

SQLite, stored locally at `data/neurotrail.db` (`neurotrail/db.py`). It has six tables: `players`,
`quest_logs`, `step_progress`, `speed_rounds`, `coach_messages`, `plans`, `game_results`, `mri_results`, `voice_results`, `wearable_days`.

## AI coach agent (`neurotrail/coach.py`)

The coach is Claude Opus 5.5 running a tool-use loop. Its five tools are grounded in your data:
- the NHANES lever model on your current values
- your activity log from SQLite
- each quest's verified evidence
- a what-if simulation
- saving a weekly plan to the database

The system prompt forbids numbers that didn't come from a tool. To enable it, set `ANTHROPIC_API_KEY`
and restart the server. Without credentials, a labeled offline coach runs the same tools with fixed rules.

## Data (all real, all public)

| Dataset | What | n |
|---|---|---|
| CDC NHANES 2011–2014 | Digit Symbol Substitution Test (processing speed), plus BP, diabetes, smoking, activity, sleep, PHQ-9 depression, hearing, labs | 3,014 adults 60+ |
| OASIS-1 (Kaggle `jboysen/mri-and-alzheimers`) | MRI-derived brain volume (nWBV, eTIV), dementia rating (CDR) | 416 people aged 18–96, plus 20 repeat scans |
| OASIS-2 | Longitudinal MRI | 150 people, 373 scans |
| FreeSurfer fsaverage6 + Destrieux atlas (nilearn) | Template brain surface (average of 40 MRIs) and cortical regions | 81,924 vertices |

## Results (reproduced by the scripts above)

**Processing-speed model (NHANES, repeated 5-fold CV, 5 seeds)**

| Model | R² | MAE (DSST points) |
|---|---|---|
| Predict the mean | 0.000 | 14.23 |
| Linear: age, sex, education, income | 0.407 | 10.72 |
| Gradient boosting: demographics | 0.397 | 10.75 |
| **Gradient boosting: + 16 modifiable factors** | **0.451** | **10.31** |

Modifiable factors add ΔR² = 0.054 over demographics alone.

**Associations** (survey-weighted least squares, cluster-robust SEs, adjusted for age, sex, education
and income; n = 2,597; age effect −0.82 DSST points/year):

| Change | DSST points (95% CI) | ≈ years | p |
|---|---|---|---|
| Systolic BP 150 → 120 | +1.71 (0.71 to 2.73) | +2.1 | 0.0009 |
| Diabetes → none | +3.60 (2.12 to 5.07) | +4.4 | 2e-6 |
| Smoker → non-smoker | +2.60 (0.69 to 4.55) | +3.1 | 0.009 |
| PHQ-9 10 → 2 | +3.18 (1.64 to 4.71) | +3.9 | 4e-5 |
| Sleep 5 h → 7 h | +1.48 (0.25 to 2.73) | +1.8 | 0.02 |
| Activity 0 → 150 min/wk (self-report) | +0.07 (−0.17 to 0.30) | +0.1 | 0.59 (null) |
| Sitting 600 → 360 min/day | −0.14 (−1.03 to 0.71) | −0.2 | 0.75 (null) |

The "lever" score in the app counts only the factors that are statistically significant. Null factors
are still shown, greyed out.

**Fairness audit:** error (MAE) is similar across groups. Predictions still lean about +5 points for
Non-Hispanic Black participants and about −3 for Non-Hispanic White participants (race was not a model
input). This is why the app reports factor associations and within-person change, never a cognitive
diagnosis.

**MRI brain age (OASIS):**

- MAE 8.2 years (r = 0.88) on cognitively normal adults.
- Bias-corrected gap: +8.8 years in dementia vs +1.5 in age-matched normals; AUC 0.72 (95% CI 0.64–0.79).
- Test-retest ICC 0.958 on 20 real repeat scans. The smallest change that can be detected is ±6.1 years.
  That's why daily quests are never scored on MRI brain age.
- Brain atrophy: nWBV falls 0.33 points/yr in nondemented people vs 0.54 in people with dementia
  (mixed model, p = 0.001).

## How quests are weighted

`sparks = 20 + tier bonus (RCT 30 · large cohort 15 · mixed 5) + 5 × Lancet 2024 weighted PAF%`

PAF (population attributable fraction) is the Lancet Commission's estimate of the share of dementia
cases linked to each risk factor.

Sources were checked on 2026-11-11 against the primary text:
- Lancet Commission 2024, Table 1: https://doi.org/10.1016/S0140-6736(24)01296-0
- SPRINT MIND: https://pubmed.ncbi.nlm.nih.gov/30688979/
- ACTIVE 20-year follow-up: https://pubmed.ncbi.nlm.nih.gov/41669119/
- US POINTER: https://pubmed.ncbi.nlm.nih.gov/40720610/
- UK Biobank steps study: https://pubmed.ncbi.nlm.nih.gov/36066874/
- STEP UP gamification trial: https://pubmed.ncbi.nlm.nih.gov/31498375/
- Behavioural-activation meta-analysis: https://pubmed.ncbi.nlm.nih.gov/24936656/
- AHA home blood-pressure steps:
  https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home
- CDC quitline: https://www.cdc.gov/tobacco/campaign/tips/quit-smoking/quitline/index.html

## What it does not claim

- It does not diagnose anything, and it doesn't measure your brain without an MRI.
- The 3D brain is a template game board. A lit region means a quest is done, not that the region changed.
- The NHANES associations are cross-sectional. The trials are what support doing the quests.
- The Speed Sprint is a digital task in the style of the DSST, so you only see your own trend, never a
  percentile.
