# Brain-age upgrade: handoff

Branch: `brainage-accuracy`. Goal: make the MRI brain-age estimate more accurate and give every estimate a calibrated 95% range plus a high / medium / low confidence label, all validated the same fair way.

**Quickest path:** open [`notebooks/brainage_training.ipynb`](notebooks/brainage_training.ipynb). It runs every step in order, explains each one in plain English, and skips steps whose results already exist.

---

## 1. Status

### Done and committed

| Task | What | Result |
|---|---|---|
| 1 | Fixed, age-balanced, subject-level 5-fold split (`results/splits.json`, made by `models/splits.py`) and one shared scorer (`models/eval_brainage.py`) used by every model. Baseline 4 mm CNN retrained on the new split. | Baseline: MAE 7.35 yrs, r 0.928, dementia AUC 0.716, ICC 0.971, smallest detectable change ±4.14 yrs (README, old split: 7.14 / 0.929 / 0.73 / 0.971 / ±4.36) |
| 2 | New 3D CNN at native 2 mm (`models/train_mri_cnn_2mm.py`), 5 folds × 3 seeds | MAE **5.95**, r 0.941, AUC 0.711, ICC 0.935, SDC ±5.73 |

### Written and tested, NOT committed yet

| What | Files | State |
|---|---|---|
| Volume model on the shared split | `models/oof_volume_model.py`, `results/oof_volume.csv`, `results/metrics_volume.json` | Ran: MAE 8.10, AUC 0.714, ICC 0.966 |
| Task 3: SFCN fine-tuning (Peng 2021, UK Biobank weights, MIT) | `models/finetune_sfcn.py`, SFCN in `neurotrail/brainage_nets.py` | Script works (smoke test passed). Zero-shot check ran (`results/sfcn_pretrained_check.json`). **Full fine-tune not completed** (see section 2) |
| Task 4: ensemble, calibrated range, confidence label | `models/ensemble.py`, `tests/test_ensemble.py` | Calibrated single-model ranges built for baseline and 2 mm (`results/cal_*`). **The combined ensemble has not been built yet.** |
| Task 5: comparison report generator | `models/make_comparison.py` → `results/comparison.md` | Works. The current `comparison.md` has no SFCN or ensemble rows yet. |
| Task 6: app integration | `neurotrail/brainage_ensemble.py` (`MRI_MODEL` switch), `web/server.py`, `web/static/gym.js`, `web/static/app.js`, `tests/test_mri_api.py` | Tested with `NEUROTRAIL_MRI_MODEL=cnn_2mm`: sample, held-out-fold and upload tests pass. `test_mri_comparison_endpoint` fails until the ensemble exists. |
| Bug fixes | `neurotrail/mri.py` | Uploads were reoriented to RAS (a left-right mirror of the LAS training scans); now LAS. Uploads used a reopened temp file, which fails on Windows; now parsed in memory. |
| Training notebook | `notebooks/brainage_training.ipynb` | Code cells compile; read-only cells checked |

### Not done

1. **Fine-tune SFCN** (Task 3). This is the main remaining training job.
2. **Build the ensemble**, then regenerate `results/comparison.md`.
3. **Switch the app to the ensemble** and run the full test suite.
4. **Commit Tasks 3–6**, update `requirements.txt` (section 3) and the README results.
5. Optional: 2 mm CNN with left-right flips (`--flip`), as the spec suggests ("test with and without if time allows").
6. Optional stretch, Task 7: rate of aging from repeat scans. Not started. OASIS-1 only has 20 repeat scans, all of young adults, so this probably needs OASIS-3 (data-use agreement).

---

## 2. What happened with SFCN (read before training it)

- **Weights:** downloaded from the official repo and verified by SHA-256 inside the script. They go to `models/pretrained/`, which git ignores.
- **Zero-shot (untouched UK Biobank model) on our healthy people aged 44–80:** MAE 8.36, r 0.78. Its predictions were squeezed into 52–66 years. Conclusion: the preprocessing is right (wrong orientation or intensity would give r ≈ 0), but there is a domain shift that fine-tuning needs to fix.
- **Fine-tune speed on an RTX 3060 Laptop GPU (6 GB):**
  - Stage 1 (only `conv_5` + the new head learn): ~3 min for 8 passes.
  - Stage 2 (everything learns): **~2.5 min per pass**, at batch 4 with gradient checkpointing. Peak GPU memory was **5.3 GB**.
  - The default of up to 40 stage-2 passes × 5 folds could take ~8 h, so we stopped it.
  - Fold 0 had reached **3.52 yrs** MAE on its inner-validation set by pass 10. That's promising, but it's not a test score. Nothing was saved.
- **Recommended run:** `--epochs2 15` (≈ 40 min per fold, ≈ 3.5 h total on that GPU). On a bigger GPU, raise `--batch` and it gets faster. On a GPU under 6 GB, use `--batch 2`.

```powershell
$env:PYTHONUTF8 = "1"
C:\path\to\.venv\Scripts\python.exe models/finetune_sfcn.py --epochs2 15
```
Outputs: `models/checkpoints/sfcn_ft/fold{k}.pt`, `results/oof_sfcn_ft.csv`, `results/metrics_sfcn_ft.json`, `results/train_log_sfcn_ft.json`. Keep the laptop plugged in and awake.

---

## 3. Setup from scratch

Python 3.12 worked (Windows 11, NVIDIA GPU, driver 546). The repo's `requirements.txt` is **incomplete** for this branch:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pip install "scikit-learn==1.6.1"   # the committed .joblib models were saved with 1.6.1; newer versions fail to load them
.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu126   # GPU build (use /whl/cpu on machines without NVIDIA)
.venv\Scripts\python.exe -m pip install python-multipart pillow six ipykernel matplotlib
```
- `python-multipart`: needed by the FastAPI upload and form endpoints.
- `pillow`: draws the MRI slice images.
- `six`: needed by the Kaggle CLI.
- `ipykernel` and `matplotlib`: for the notebook.
- If the Kaggle download fails with `CERTIFICATE_VERIFY_FAILED` (antivirus or proxy), also `pip install pip-system-certs`.
- Versions that worked: torch 2.14.1+cu126, scikit-learn 1.6.1, nibabel 5.5.0, kaggle 2.2.5.

**Data:** Kaggle credentials go in `~/.kaggle/kaggle.json`. Then:
```powershell
$env:PYTHONUTF8 = "1"; .venv\Scripts\python.exe data/download_data.py
```
- Size: about 1.6 GB, into `data/raw/` (ignored by git).
- Expect 436 MRI files.
- `AUQ_H` returning 404 is expected.

**Windows:** always set `PYTHONUTF8=1`. Otherwise reading `index.html` and some outputs fails with a `cp1252` decode error.

---

## 4. Gotchas

- **Model checkpoints are NOT in git.** `models/checkpoints/cnn_2mm/` (15 files, 59 MB) exists only on the laptop that trained it. `results/oof_cnn_2mm.csv` *is* committed, so the notebook's `auto` mode will skip retraining. The ensemble and report will build fine, **but the app needs the checkpoint files** to score scans with the 2 mm model. Either copy that folder from the original laptop, or retrain (notebook: `RUN["cnn_2mm"] = "force"`, ~1 h). The same applies to `models/checkpoints/sfcn_ft/` once trained. Whether to commit checkpoints (≈ 120 MB total) is an open decision.
- **Retraining the baseline overwrites the app's model files** in `models/artifacts/` (`mri_cnn_fold*.pt`, metrics, predictions). That's intended (they now match `splits.json`), but be aware of it.
- **`neurotrail/mri.py` `heldout_fold` reads `results/splits.json`.** Don't regenerate the split unless you retrain every model, or sample scans could be scored by a model that saw them.
- **Don't run two GPU jobs at once** on a 6 GB card: SFCN alone uses 5.3 GB. For CPU-only checks while training runs, set `CUDA_VISIBLE_DEVICES=""`.
- **Coverage numbers:** for single models, use the calibrated `cal_<model>` results. A model's raw `pred_std` is just the seed spread, e.g. 49% coverage for the 2 mm CNN versus 93.7% calibrated.

---

## 5. Remaining steps, in order

| # | Step | Command (or notebook step) | Time |
|---|---|---|---|
| 1 | (If needed) get 2 mm checkpoints: copy, or retrain | `python models/train_mri_cnn_2mm.py --seeds 3` (Step 4) | ~1 h |
| 2 | Fine-tune SFCN | `python models/finetune_sfcn.py --epochs2 15` (Step 5, set `RUN["sfcn_ft"] = "auto"`) | ~3.5 h |
| 3 | Calibrate the SFCN range | `python models/ensemble.py --name cal_sfcn_ft --models sfcn_ft` (Step 6) | ~2 min |
| 4 | Build the ensemble (app) + ensemble with volume (report only) | `python models/ensemble.py --name ensemble --models baseline_4mm cnn_2mm sfcn_ft`<br>`python models/ensemble.py --name ensemble_with_volume --models baseline_4mm cnn_2mm sfcn_ft volume` (Step 6) | ~5 min |
| 5 | Regenerate the report | `python models/make_comparison.py` (Step 7) | seconds |
| 6 | Tests | `python -m pytest -q` (Step 9). All should pass once the ensemble exists. | ~1 min |
| 7 | Run the app on the ensemble | `$env:NEUROTRAIL_MRI_MODEL = "ensemble"; python web/server.py` → My data → MRI | – |
| 8 | Commit + update `requirements.txt` and README results | – | – |

If SFCN can't be trained in time, skip steps 2–3 and build the ensemble from `baseline_4mm cnn_2mm` (the notebook does this automatically). The report then shows SFCN as not completed.

**Switch back instantly:** `NEUROTRAIL_MRI_MODEL=baseline_4mm`, or edit `MRI_MODEL` in `neurotrail/brainage_ensemble.py`. Without any upgrade files, the app falls back to the original code path.

---

## 6. Design decisions and deviations from the spec (all deliberate)

- **The ensemble averages raw predictions, not bias-corrected ones.** Bias-corrected brain age uses the person's real age and would inflate accuracy. The bias correction is applied to the gap afterwards, the same way for every model.
- **Bias-correction line for fold k:** fitted on the other folds' out-of-fold predictions (in-sample training predictions are overfit).
- **Ensemble weights:** proportional to 1 / MAE², fitted on the other folds only. Dementia scans and uploads use weights fitted on all healthy people.
- **Range:** `pred ± 1.96 · c · sqrt(model/seed spread² + residual SD²)`.
  - The residual SD is looked up by **predicted**-age decade, so uploads need no age.
  - `c` is fitted on training folds to hit 95% coverage.
  - Achieved so far: 92.1% for baseline and 93.7% for the 2 mm model. That's slightly under target, and we report it as it is.
- **Confidence cutoffs:** the spec's 8 / 14-year width cutoffs are impossible at this accuracy (ranges are ~28–31 years wide), so the code falls back to terciles of training-fold range width and says so. The labels still separate well: for the 2 mm model, "high" scans miss by 3.4 years on average and "low" scans by 8.8.
- **The app ensemble excludes the volume model:** uploads don't have OASIS's nWBV/eTIV values.
- **New models train without left-right flips** (per the spec). The baseline keeps its original flip augmentation and flip averaging at test time. That may be part of why the baseline is more repeatable (ICC 0.971 vs 0.935).
- **GPU:** the spec's Apple M3 notes don't apply on this machine. Scripts use CUDA when available and the CPU otherwise.

---

## 7. Honest limits (also on the Science page)

- 316 healthy training people, one dataset (OASIS-1), one scanner type.
- Uploads must be preprocessed like the training scans: skull-stripped, N4, FSL MNI152 2 mm.
- Repeat-scan reliability (ICC, SDC) comes from 20 people aged 19–34 only.
- A research tool, not a diagnosis.

## 8. File map

```
models/
  splits.py              fixed folds -> results/splits.json
  eval_brainage.py       shared metrics -> results/metrics_<model>.json
  train_mri_cnn.py       baseline 4 mm CNN (now uses splits.json, writes results/oof_baseline_4mm.csv)
  train_mri_cnn_2mm.py   2 mm CNN
  finetune_sfcn.py       SFCN download, zero-shot check, two-stage fine-tune
  oof_volume_model.py    volume model on the shared folds
  train_utils.py         shared training loop (inner validation, early stopping, bf16)
  ensemble.py            weights, calibrated range, confidence label -> results/<name>_config.json
  make_comparison.py     results/comparison.md
neurotrail/
  brainage_nets.py       BrainAgeCNN2mm, SFCN, preprocessing
  brainage_ensemble.py   app inference, MRI_MODEL switch
  mri.py                 format check, Grad-CAM (baseline), upload loader (fixed)
notebooks/brainage_training.ipynb   whole pipeline, plain-English
tests/test_eval_brainage.py, test_ensemble.py, test_mri_api.py
```
