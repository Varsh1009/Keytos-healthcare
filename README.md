# NeuroTrail: the honest brain coach

Keytos Hack 2026, Health track.

In 2 minutes NeuroTrail shows you **which of your habits matter most for your brain**, using models
trained on real public health data. Then it helps you build those habits with small daily steps you
actually tick off. It also teaches how 7 brain diseases affect the brain, on a real 3D brain.

It is a wellness and education tool. It is **not** a diagnosis, a dementia risk score, or an MRI reader.
We tested several "impressive" features, found they didn't hold up, and removed them (see
[What we tested and removed](#what-we-tested-and-removed)).

## Quick start (fresh clone)

All trained models are in the repo, so nothing needs retraining. You only download the public data.

```bash
# 1. Python 3.12 and Git installed
git clone https://github.com/Varsh1009/Keytos-healthcare.git
cd Keytos-healthcare

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
NT_DEMO=1 python web/server.py         # same, plus "Explore a demo person" (made-up data) for demos
pytest -q                              # optional: the test suite
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
python models/build_region_norms.py # region intensity index (tested, then removed from the app)
python models/build_tissue_norms.py # hippocampus / ventricle / brain-fraction measures + go/no-go test
python models/build_facts.py        # writes models/artifacts/facts.json: every number the app quotes
python -m neurotrail.brain_export   # fsaverage6 brain mesh for the 3D view
python -m neurotrail.atlas_export   # deep-structure meshes + Harvard-Oxford labels
```
`notebooks/brainage_training.ipynb` runs the whole MRI pipeline step by step with charts.

Python does all the work (pandas, scikit-learn, statsmodels, nilearn, nibabel, PyTorch, FastAPI).
The browser only draws it: one HTML page, plain ES modules, Three.js / Chart.js / SimpleWebAuthn
served locally from `web/static/vendor/`. No Node, no build step, no CDN at runtime (fonts and the Tabler icon font aside).

## How it works (the user flow)

**The idea: one 3-minute session a day.** Open the app, tap Start, do three small things, done.

1. **Welcome**: get started as a guest, or sign in with a passkey.
2. **Onboarding, one question per screen** (8 taps): age, sex, told you have high blood pressure,
   diabetes, smoking, usual sleep, hearing trouble, feeling down. If you've been feeling down, a 988
   support card shows first.
3. **The big picture**: a 100-person icon array: about 45 of 100 dementia cases are linked to 14 changeable
   factors (Lancet Commission 2024); the ones linked to your answers are highlighted. Population numbers, not your risk.
4. **Your plan**: the factors with a clear link in the CDC survey (e.g. diabetes: about 3.6 points slower on a
   thinking-speed test), your first habits, and **Save with a passkey** (WebAuthn / FIDO2). No password.

Then the **daily session** (Today → Start): **check-in** (how you slept) → **today's game** (Speed Sprint every
other day, rotating with the other games) → **one habit** from your plan → a short celebration with your streak.

| Tab | What's there |
|---|---|
| **Today** | The session ring (0/3 → done), your top personal insight, and this week at a glance |
| **Train** | Today's game plus all 8 games (Speed Sprint, Color Clash, Memory Grid, Reflex, Trail Connect, Animal Naming, Word Recall, Voice check). Compared only with your own earlier scores |
| **Learn** | 7 brain diseases on a real 3D brain: where each one strikes, a stage slider, what you can do, when to call a doctor, BE-FAST, myth-or-fact cards. **Your brain map**: skills colored from your games, plus an MRI research preview |
| **You** | **Your week** (a weekly story), **My patterns** (personal insights), **Doctor report** (one printable page), charts, what matters for you + what-ifs, your answers, phone and watch import, text size and Calm mode, passkey, How we know, help |

The details (sources, p-values, caveats) are one tap away behind small "Why?" links instead of on every screen.
A Help button in the header opens crisis lines (988, 911) from anywhere.

### Verifiable doctor reports (`neurotrail/signing.py`, `neurotrail/reports.py`)

About 6 in 10 people living with dementia are undiagnosed (Lang et al., BMJ Open 2017), and a home log or
screenshot carries no proof it wasn't edited. NeuroTrail's one-page report can be **signed twice and checked by anyone**:

1. **The server builds the report** from the database (the browser can't inject numbers).
2. **You approve it with your passkey**: a WebAuthn assertion whose challenge is the report's SHA-256.
3. **NeuroTrail signs** {report + your approval} with ECDSA P-256 using a *Report Signing* certificate issued by
   a local *NeuroTrail Root CA* (created on first run in `data/keys/`, never committed).
4. A **QR code** opens `/verify/<id>`: the signature is checked **in the clinic's browser** (WebCrypto) and the
   certificate chain on the server. A "change blood pressure to 118" button shows a tampered copy failing live.
5. Reports **expire after 90 days** and can be **revoked**; the verify page then says so.

For phones scanning the QR, serve over https (e.g. a tunnel) and set `NT_PUBLIC_URL` and `NT_RP_ID`.

### Family sharing, consent first (`neurotrail/sharing.py`)

Most caregivers already hold their parent's passwords, and once monitoring starts it is almost never revisited
("consent stasis", Future of Privacy Forum 2026). NeuroTrail's sharing is built the other way round:

- **You choose what they see**: sessions and streak (always), blood pressure, game trends, personal patterns;
  mood is off unless you turn it on.
- **It ends on its own**: every share lasts 7, 30 or 90 days. A week before the end, Today asks
  "Still want Daughter to see your progress?" Nothing renews silently.
- **Their own passkey**: the caregiver opens the single-use invite link (or QR) and signs in with their own passkey.
  No shared passwords. (Demo mode allows guests so the demo works on one laptop.)
- **You see every visit**: "Seen by Daughter, 2 hours ago", with a full visit log. Stop sharing any time.
- The caregiver's page nudges them gently when there's been no session for 3+ days.

### Personal insights (`neurotrail/insights.py`)

The survey model says what matters for *people like you*. Personal insights ask what works for *you*:
on days you slept 7+ hours, walked more, talked with someone or did something enjoyable, did your
checks go better than on your other days?

- Each check is put on your own scale, and **practice gains are removed first** (score ~ log(play number)),
  so getting used to a game isn't credited to a habit.
- Days are compared with a Welch t-test; a **"Clear pattern"** must survive a **Holm correction** for testing
  several habits at once and have 5+ days on each side. Weaker results are "Early hint" or "No clear difference yet".
- Unlocks after 6 days with both a logged habit and a check. Shown on Today and in You → My patterns.

**Demo mode:** `NT_DEMO=1 python web/server.py` adds "Explore a demo person" to the welcome page: four weeks of
clearly labeled, made-up data (a yellow "Demo person" banner stays on screen). It's off by default.

Each habit has one input that counts and one big **Done**; the how-to steps and evidence sit behind "How to do it"
and "Why it matters". The blood pressure habit has an "I don't have a cuff" path and a 180+ safety warning. The mood
check is the PHQ-8, one question per screen; a score of 10+ shows support resources first.

Accessibility: 18 px body text, 48 px tap targets, AA-contrast light theme, one question per screen,
A / A+ / A++ text size (You → Text size), Calm mode and `prefers-reduced-motion` (no animation), keyboard focus rings,
skip link, single-column phone layout with a bottom tab bar. The 3D brain spins for 5 s, then holds still.

## Real MRI scans: brain-age ensemble (`neurotrail/brainage_ensemble.py`)

- **Data:** 436 real T1 MRI volumes from Kaggle `ninadaithal/oasis-1-shinohara` (OASIS-1): skull-stripped,
  N4 bias-corrected, MNI 2 mm grid, each joined to that person's real age and dementia rating (CDR).
- **Models** (trained only on the 316 cognitively normal people; files in `models/checkpoints/` and
  `models/artifacts/`): a 4 mm 3D CNN, a 2 mm 3D CNN (5 folds x 3 seeds) and SFCN pretrained on
  12,949 UK Biobank brains and fine-tuned here, combined by weight (1 / error²).
- **Fair testing:** one fixed, age-balanced 5-fold split by person (`results/splits.json`); every person is
  scored only by models that never saw them; one shared scorer (`models/eval_brainage.py`).
- **Results** (`results/comparison.md`): ensemble usual miss **5.15 years** (r = 0.96; the original single
  4 mm model: 7.35), repeat-scan ICC 0.956, smallest detectable change ±3.6 years, dementia AUC **0.70**
  (95% CI 0.63–0.77); 95% ranges contained the true age for 94% of people.
- **Adults 60+** (98 cognitively normal people): ensemble error **6.45 years** vs 7.62 for guessing the
  average age (r = 0.68), so it now beats the baseline the original model failed, but by a modest margin.
- **In the app** (Learn → Your brain map → Brain age from an MRI, a research preview): brain age with its 95% range,
  a high / medium / low confidence label with reasons, each model's estimate, Grad-CAM heatmaps on uploads, and a
  "How accurate is it?" sheet computed from the out-of-fold results. **Research scans** use each scan's out-of-fold
  estimate, so they work without the Kaggle download. **Guard:** if any model returns an impossible age (outside
  −5 to 125) or the range is wider than 60 years, the app shows no number and says why.
  Switch back to the original single model with `NEUROTRAIL_MRI_MODEL=baseline_4mm`.
- **Limits:** one dataset and scanner type, 316 training people, repeat scans only from 20 young adults,
  research-format scans only. An estimate for learning, not a diagnosis.
- **Credit:** SFCN architecture and UK Biobank weights from Peng et al. 2021, *Medical Image Analysis*
  68:101871 ([code, MIT license](https://github.com/ha-ha-ha-han/UKBiobank_deep_pretrain)).

## Data (all real, all public)

| Dataset | Used for | n |
|---|---|---|
| CDC NHANES 2011–2014 | Digit Symbol test (thinking speed) + blood pressure, diabetes, smoking, activity, sleep, PHQ-9, hearing | 3,014 adults 60+ with the test; 2,597 complete cases |
| OASIS-1 tables (Kaggle `jboysen/mri-and-alzheimers`) | nWBV brain volume, dementia rating (CDR) | 416 people aged 18–96 + 20 repeat scans |
| OASIS-1 MRI volumes (Kaggle `ninadaithal/oasis-1-shinohara`) | Sample scans, tested MRI measures | 436 volumes |
| fsaverage6 + Harvard-Oxford atlas (nilearn) | 3D brain surface, cortical and deep regions | 81,924 vertices |

## Results (every number below is in `models/artifacts/facts.json`)

**Habits and thinking speed** (NHANES, survey-weighted regression, adults 60+, n = 2,597).
Adding habits to age, sex, education and income raised cross-validated R² from 0.41 to 0.45.

| Change | Digit Symbol points (95% CI) | p |
|---|---|---|
| Diabetes → no diabetes | +3.6 (+2.1 to +5.1) | 1.8e-6 |
| Depression score 10 → 2 | +3.2 (+1.6 to +4.7) | 3.5e-5 |
| Smoker → non-smoker | +2.6 (+0.7 to +4.6) | 0.009 |
| Systolic BP 150 → 120 | +1.7 (+0.7 to +2.7) | 0.0009 |
| Sleep 5 h → 7 h | +1.5 (+0.3 to +2.7) | 0.019 |
| Inactive → 150 active min/week | +0.1 (−0.2 to +0.3) | 0.59 (not shown as a factor) |
| Sitting 600 → 360 min/day | −0.1 (−1.0 to +0.7) | 0.75 (not shown as a factor) |

These are associations in a cross-sectional survey, not proof of cause. Only factors with p < 0.05 count.

Fairness: the prediction model's mean error differs by group (+5.1 points Non-Hispanic Black, +4.6 Other
Hispanic, −3.0 Non-Hispanic White). So the app only uses these numbers for within-person "what if"
comparisons, never to rank or label people.

**MRI teaching view** (OASIS's own validated nWBV measure). It separates dementia from healthy scans
with AUC 0.72 (95% CI 0.64–0.79). At the best cut-off it flags 4 of 100 healthy people over 60 and only
12 of 100 people with dementia. The app uses this to teach why one MRI number can't screen a person.

## What we tested and removed

| Built | Why it's gone |
|---|---|
| Original 4 mm 3D CNN "brain age" | In people 60+ it was no better than guessing the average age (error 7.63 vs 7.62 years). The newer ensemble (above) does better (6.45 vs 7.62) and is back as a research preview |
| Region intensity index (57 regions) | Flagged 81% of healthy adults 60+ as having an "abnormal" region, and missed ventricle enlargement |
| Our hippocampus / ventricle / brain-fraction measures | None reached our bar (dementia AUC ≥ 0.70 and repeat-scan ICC ≥ 0.90), so uploads get a format check and slice preview only, no numbers |
| "Years older" / "brain age" wording | A single survey snapshot can't tell you how old your brain is |
| NHANES percentiles for the digital games | Different words, timing and format from the NHANES interview; you're compared only with yourself |

## Evidence behind the habits

Each habit cites its source in the app ("Why this habit?"). Main ones: SPRINT MIND (blood pressure),
ACHIEVE (hearing aids), UK Biobank step counts (3,826 / 9,826 steps), ACTIVE (speed training),
behavioral activation trials (planning enjoyable activities), CDC quitline. Disease maps: Braak staging
for Alzheimer's and Parkinson's, Vonsattel for Huntington's, Brettschneider for ALS, Rascovsky for FTD,
McDonald criteria for MS, BE-FAST for stroke (all PubMed-linked in the app).

## Security and privacy

- **Passkeys** (py_webauthn + SimpleWebAuthn): resident keys with user verification; no passwords stored.
  A guest session can be upgraded to a passkey at any time.
- **Session routing**: the browser only calls `/api/me/...`; a middleware maps it to the signed-in player
  and refuses direct `/api/player/<name>` calls, so nobody can read another person's data by name.
- **Local storage**: SQLite at `data/neurotrail.db` (11 tables). Voice audio is analyzed and discarded; only numbers are kept.

## AI assistant (`neurotrail/coach.py`)

Claude Opus 5.5 in a tool-use loop with five tools grounded in your data (your factors, your activity log,
habit evidence, a what-if, saving a weekly plan). The prompt forbids numbers that didn't come from a
tool and puts 988 first if someone mentions feeling down. The Ask card only appears when an API key is
configured; otherwise it stays hidden.

## Hackathon note

Everything in this repository so far (data pipeline, models, app) was built before the hackathon
starts on Nov 13, 2026. Check the Keytos Hack rules on pre-existing code and disclose it in the submission.
