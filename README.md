# NeuroTrail: the honest brain coach

Keytos Hack 2026, Health track.

In 2 minutes NeuroTrail shows you **which of your habits matter most for your brain**, using models
trained on real public health data. Then it helps you build those habits with small daily steps you
actually tick off. It also teaches how 7 brain diseases affect the brain, on a real 3D brain.

It is a wellness and education tool. It is **not** a diagnosis, a dementia risk score, or an MRI reader.
We tested several "impressive" features, found they didn't hold up, and removed them (see
[What we tested and removed](#what-we-tested-and-removed)).

## Run it

```bash
pip install -r requirements.txt
python data/download_data.py        # CDC NHANES + OASIS (Kaggle; needs ~/.kaggle credentials)
python models/train_cognition.py    # NHANES thinking-speed models, associations, fairness
python models/train_brainage.py     # OASIS nWBV model + validation
python models/train_mri_cnn.py      # 3D CNN on 436 real OASIS MRIs (~30 min CPU; tested, then removed from the app)
python models/build_region_norms.py # region intensity index (tested, then removed from the app)
python models/build_tissue_norms.py # hippocampus / ventricle / brain-fraction measures + go/no-go test
python models/build_facts.py        # writes models/artifacts/facts.json: every number the app quotes
python -m neurotrail.brain_export   # fsaverage6 brain mesh for the 3D view
python -m neurotrail.atlas_export   # deep-structure meshes + Harvard-Oxford labels
python web/server.py                # open http://localhost:8600
pytest -q                           # 48 tests (one needs the NHANES download)
```

Python does all the work (pandas, scikit-learn, statsmodels, nilearn, nibabel, PyTorch, FastAPI).
The browser only draws it: one HTML page, plain ES modules, Three.js / Chart.js / SimpleWebAuthn
served locally from `web/static/vendor/`. No Node, no build step, no CDN at runtime (fonts aside).

## How it works (the user flow)

1. **Welcome**: Start as a guest, or sign in with a passkey.
2. **About you**: age and sex (two taps).
3. **Speed Sprint** (90 s, skippable): a digital symbol-matching task modeled on the Digit Symbol test.
   It becomes your "first try" that you race later as a ghost.
4. **6 taps**: told you have high blood pressure (optional reading), diabetes, smoking, sleep hours,
   hearing trouble, feeling down. If you've been feeling down, a 988 support card shows first.
5. **Your result**:
   - A 100-person icon array: of 100 dementia cases, about 45 are linked to 14 changeable factors
     (Lancet Commission 2024). The ones linked to your answers are gold. Population numbers, not your personal risk.
   - **What matters most for you**: each factor with a clear link in the CDC survey, ranked, in test
     points with a 95% range (for example diabetes: about 3.6 points lower, range 2.1 to 5.1).
   - Your first 3 habits.
   - **Save with a passkey** (WebAuthn / FIDO2): fingerprint, face or device PIN. No password.

Then four tabs:

| Tab | What's there |
|---|---|
| **Today** | One next step, today's 3 habits, care rings (Move / Mind / Body, filled by evidence-weighted points), a kind streak (one rest day a week never breaks it), "Try a change" what-if, tip of the day |
| **Checks** | Speed Sprint (race your ghost), Word Recall, Animal Naming, Voice check; more: Trail Connect, Color Clash, Memory Grid, Reflex. Compared only with your own first tries; "learning your baseline" until 3 plays |
| **My Brain** | **Learn**: 7 diseases grouped by what you can do (lower your risk / live better / early help matters): where each one strikes on a 3D brain, a stage slider, how it varies, what to do at home, when to call a doctor, BE-FAST, myth-or-fact cards. **Mine**: a skills map colored from your checks, plus an MRI research preview |
| **Me** | Progress charts, connect a device (Apple Health / CSV), edit answers, passkey security, **How we know**, support lines |

### Personal insights (`neurotrail/insights.py`)

The survey model says what matters for *people like you*. Personal insights ask what works for *you*:
on days you slept 7+ hours, walked more, talked with someone or did something enjoyable, did your
checks go better than on your other days?

- Each check is put on your own scale, and **practice gains are removed first** (score ~ log(play number)),
  so getting used to a game isn't credited to a habit.
- Days are compared with a Welch t-test; a **"Clear pattern"** must survive a **Holm correction** for testing
  several habits at once and have 5+ days on each side. Weaker results are "Early hint" or "No clear difference yet".
- Unlocks after 6 days with both a logged habit and a check. Shown on Today and in Me → My patterns.

**Demo mode:** `NT_DEMO=1 python web/server.py` adds "Explore a demo person" to the welcome page: four weeks of
clearly labeled, made-up data (a yellow "Demo person" banner stays on screen). It's off by default.

Each habit page has numbered "how to do it" steps (guidance, not gates), one input that counts, and one
big **Done**. The blood pressure habit has an "I don't have a cuff" path. The mood habit is the PHQ-8;
a score of 10+ shows support resources before anything else.

Accessibility: 18 px body text (nothing under 16 px), 48 px tap targets, solid high-contrast panels,
A / A+ / A++ text size, Calm mode and `prefers-reduced-motion` (no animation), keyboard focus rings,
skip link, single-column phone layout with a bottom tab bar. The 3D brain spins for 5 s, then holds still.

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
| 3D CNN "brain age" | In people 60+ it was no better than guessing the average age (error 7.63 vs 7.62 years). Its 7.1-year overall error came from the wide 18–96 age range |
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
