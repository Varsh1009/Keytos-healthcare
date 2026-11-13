"""
Brain-age ensemble with per-scan uncertainty, a calibrated 95% interval and a confidence label.

No leakage: for a scan in fold k, everything learned (model weights, residual SD per age band,
interval scale factor) comes only from out-of-fold predictions of cognitively normal people in the
OTHER folds. Dementia scans and new uploads use the values learned on all normal people.

Design notes (deliberate deviations, see results/comparison.md):
  * Models are combined on their RAW predictions. Combining age-bias-corrected predictions would
    feed each person's real age into the estimate and make MAE look better than it is.
    The bias correction is applied afterwards to the gap, exactly as for single models.
  * Residual SD is looked up by PREDICTED-age band, so an upload needs no age to get an interval.

  weights        w_m = (1 / MAE_m^2) / sum(1 / MAE^2)              (other folds, normal people)
  between-model  var_b = sum w_m (p_m - p)^2 + sum w_m s_m^2       (s_m = a model's seed SD)
  residual       var_r = var(ensemble error) in that 10-year predicted-age band (other folds)
  pred_std       = c * sqrt(var_b + var_r),  c chosen so 95% of other-fold normals are covered
  interval       = pred +- 1.96 * pred_std

Run:  python models/ensemble.py [--name ensemble] [--models baseline_4mm cnn_2mm sfcn_ft]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
sys.path.insert(0, str(ROOT / "models"))
from eval_brainage import Z95, evaluate, mae  # noqa: E402

IMAGE_MODELS = ["baseline_4mm", "cnn_2mm", "sfcn_ft"]
MIN_BAND_N = 10

# Confidence rules (frozen; see choose_cutoffs and results/ensemble_config.json for how they were set).
DEFAULT_RULES = {"high_width": 8.0, "low_width": 14.0, "max_disagreement": 10.0}


# ------------------------------------------------------------------ building blocks
def inverse_mae2_weights(preds: dict[str, np.ndarray], age: np.ndarray) -> dict[str, float]:
    """Weights proportional to 1 / MAE^2 of each model; they sum to 1."""
    inv = {m: 1.0 / mae(age, p) ** 2 for m, p in preds.items()}
    tot = sum(inv.values())
    return {m: v / tot for m, v in inv.items()}


def combine(P: np.ndarray, S: np.ndarray, w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """P, S: (n_scans, n_models) predictions and seed SDs (NaN = none). Returns weighted mean, between-model var."""
    mean = P @ w
    var = ((P - mean[:, None]) ** 2) @ w + np.nan_to_num(S ** 2) @ w
    return mean, var


def band(pred) -> np.ndarray:
    return np.clip(np.asarray(pred, float) // 10 * 10, 10, 90).astype(int)


def residual_sd_by_band(pred: np.ndarray, age: np.ndarray) -> dict[int, float]:
    """SD of (pred - age) per 10-year PREDICTED-age band; small bands borrow the overall SD."""
    err = pred - age
    overall = float(np.sqrt(np.mean(err ** 2)))
    b = band(pred)
    out = {}
    for x in range(10, 100, 10):
        e = err[b == x]
        out[x] = float(np.sqrt(np.mean(e ** 2))) if len(e) >= MIN_BAND_N else overall
    return out


def calibration_factor(err: np.ndarray, sd: np.ndarray, target: float = 0.95) -> float:
    """Single factor c so that |err| <= 1.96 * c * sd for `target` of training-fold scans."""
    return float(np.quantile(np.abs(err) / sd, target) / Z95)


def confidence_label(width: float, similarity: float | None, age: float | None, disagreement: float,
                     rules: dict, sim_cutoff: float, sim_comfort: float, age_range: tuple[float, float]) -> tuple[str, list[str]]:
    """high / medium / low plus the reasons. Any 'low' reason wins, then any 'medium' reason."""
    low, med = [], []
    if width > rules["low_width"]:
        low.append(f"95% interval is wide ({width:.0f} years)")
    elif width >= rules["high_width"]:
        med.append(f"95% interval is moderate ({width:.0f} years)")
    if age is not None and not (age_range[0] <= age <= age_range[1]):
        low.append(f"age {age:.0f} is outside the training range {age_range[0]:.0f}-{age_range[1]:.0f}")
    if disagreement > rules["max_disagreement"]:
        low.append(f"models disagree by {disagreement:.0f} years")
    if similarity is not None and similarity < sim_comfort:
        (low if similarity < sim_cutoff else med).append(
            f"scan is {'below' if similarity < sim_cutoff else 'close to'} the template-similarity cutoff (r = {similarity:.2f})")
    if low:
        return "low", low + med
    if med:
        return "medium", med
    return "high", ["narrow interval, models agree, scan matches the training format"]


# ------------------------------------------------------------------ fitting on a set of normal scans
def fit_ensemble(P: np.ndarray, S: np.ndarray, age: np.ndarray, models: list[str]) -> dict:
    """Weights, residual SD by band and interval scale factor, all from these (training-fold) scans."""
    w = inverse_mae2_weights({m: P[:, j] for j, m in enumerate(models)}, age)
    wv = np.array([w[m] for m in models])
    mean, var_b = combine(P, S, wv)
    rsd = residual_sd_by_band(mean, age)
    sd = np.sqrt(var_b + np.array([rsd[b] for b in band(mean)]) ** 2)
    return {"weights": w, "residual_sd_by_band": rsd, "scale": calibration_factor(mean - age, sd)}


def apply_ensemble(P: np.ndarray, S: np.ndarray, models: list[str], fit: dict) -> tuple[np.ndarray, np.ndarray]:
    wv = np.array([fit["weights"][m] for m in models])
    mean, var_b = combine(P, S, wv)
    sd = fit["scale"] * np.sqrt(var_b + np.array([fit["residual_sd_by_band"][b] for b in band(mean)]) ** 2)
    return mean, sd


# ------------------------------------------------------------------ main
def load_oofs(models: list[str]) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    base = None
    P, S = [], []
    for m in models:
        d = pd.read_csv(RESULTS / f"oof_{m}.csv")
        if base is None:
            base = d[["subject_id", "scan_id", "fold", "age", "sex", "cdr"]]
        else:
            assert (d["scan_id"].to_numpy() == base["scan_id"].to_numpy()).all(), f"{m}: rows not aligned"
            assert (d["fold"].to_numpy() == base["fold"].to_numpy()).all(), f"{m}: different folds"
        P.append(d["pred_age"].to_numpy(float))
        S.append(d["pred_std"].to_numpy(float))
    return base.copy(), np.column_stack(P), np.column_stack(S)


def template_similarity(scan_ids: pd.Series) -> np.ndarray:
    """Template similarity of every OASIS scan, the same measure the upload check uses."""
    import nibabel as nib
    sys.path.insert(0, str(ROOT))
    from neurotrail.mri import normalize, template
    from splits import scan_table
    t = template().ravel()
    paths = scan_table().set_index("ID")["path"]
    return np.array([float(np.corrcoef(normalize(np.asanyarray(nib.load(paths[s]).dataobj, dtype=np.float32)).ravel(), t)[0, 1])
                     for s in scan_ids])


def choose_cutoffs(width_train: np.ndarray) -> dict:
    """Spec cutoffs (8 / 14 years) if they leave any scan 'high'; otherwise terciles of training-fold widths."""
    if np.mean(width_train < DEFAULT_RULES["high_width"]) >= 0.05:
        return {**DEFAULT_RULES, "how": "spec cutoffs (8 / 14 years) kept"}
    lo, hi = np.percentile(width_train, [100 / 3, 200 / 3])
    return {"high_width": float(round(lo, 1)), "low_width": float(round(hi, 1)),
            "max_disagreement": DEFAULT_RULES["max_disagreement"],
            "how": "spec cutoffs would label <5% of scans 'high', so cutoffs = terciles of 95% interval width "
                   "on cognitively normal training-fold scans (labels are relative, not absolute accuracy)"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ensemble")
    ap.add_argument("--models", nargs="+", default=None)
    a = ap.parse_args()
    models = a.models or [m for m in IMAGE_MODELS if (RESULTS / f"oof_{m}.csv").exists()]
    df, P, S = load_oofs(models)
    age = df["age"].to_numpy(float)
    fold = df["fold"].to_numpy()
    normal = ((df["cdr"].fillna(0) == 0) & df["scan_id"].str.endswith("MR1") & (df["fold"] >= 0)).to_numpy()

    pred, std = np.full(len(df), np.nan), np.full(len(df), np.nan)
    fits = {}
    for k in sorted(set(fold)):
        rows = fold == k
        train = normal & (fold != k) if k >= 0 else normal
        fits[int(k)] = fit_ensemble(P[train], S[train], age[train], models)
        pred[rows], std[rows] = apply_ensemble(P[rows], S[rows], models, fits[int(k)])

    final = fit_ensemble(P[normal], S[normal], age[normal], models)       # for new uploads
    width = 2 * Z95 * std
    # Cutoffs tuned once on training-fold widths: each normal scan's width as predicted by the OTHER folds' fit
    rules = choose_cutoffs(width[normal])
    sim = template_similarity(df["scan_id"])
    sim_cut = float(json.loads((ROOT / "models" / "artifacts" / "mri_cnn_metrics.json").read_text())
                    ["format_check"]["similarity_threshold"])
    sim_comfort = float(np.percentile(sim, 5))
    age_range = (float(age[normal].min()), float(age[normal].max()))
    disagree = P.max(axis=1) - P.min(axis=1)
    labels = [confidence_label(width[i], sim[i], age[i], disagree[i], rules, sim_cut, sim_comfort, age_range)
              for i in range(len(df))]

    out = df.assign(pred_age=pred, pred_std=std, interval_low=pred - Z95 * std, interval_high=pred + Z95 * std,
                    confidence=[c for c, _ in labels], confidence_reasons=["; ".join(r) for _, r in labels],
                    model_disagreement=disagree, template_similarity=sim,
                    **{f"pred_{m}": P[:, j] for j, m in enumerate(models)})
    out.to_csv(RESULTS / f"oof_{a.name}.csv", index=False)
    m = evaluate(a.name)
    conf = out.loc[normal, "confidence"].value_counts().to_dict()
    err_by_conf = {c: mae(age[normal & (out["confidence"] == c).to_numpy()], pred[normal & (out["confidence"] == c).to_numpy()])
                   for c in conf}
    cfg = {"name": a.name, "models": models, "final": final, "per_fold": fits, "rules": rules,
           "similarity_cutoff": sim_cut, "similarity_comfort_p5": sim_comfort, "age_range": age_range,
           "scale_factor_per_fold": {k: f["scale"] for k, f in fits.items()},
           "confidence_counts_normal": conf, "mae_by_confidence_normal": err_by_conf}
    (RESULTS / f"{a.name}_config.json").write_text(json.dumps(cfg, indent=2))
    m["confidence_counts_normal"], m["mae_by_confidence_normal"] = conf, err_by_conf
    m["weights_all_normal"], m["scale_factor_all_normal"] = final["weights"], final["scale"]
    (RESULTS / f"metrics_{a.name}.json").write_text(json.dumps(m, indent=2))
    print(f"{a.name} {models}: MAE {m['mae']:.2f} r {m['r']:.3f} AUC {m['clinical_validity']['auc']:.3f} "
          f"ICC {m['test_retest']['icc_3_1']:.3f} SDC {m['test_retest']['smallest_detectable_change']:.2f} "
          f"coverage {m['interval_coverage_95']:.3f} width {m['mean_interval_width']:.1f}  weights {final['weights']}  "
          f"scale {final['scale']:.2f}  confidence {conf}  MAE by confidence {err_by_conf}")


if __name__ == "__main__":
    main()
