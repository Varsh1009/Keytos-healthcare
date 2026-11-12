"""
Build and validate the three MRI tissue measures on the 436 real OASIS-1 scans.

For each measure:
  * norms on cognitively normal first sessions (n=316): value ~ 1 + age + age^2 + female (OLS),
    with an age-dependent SD: |residual| ~ age, scaled by sqrt(pi/2) (mean |e| -> SD for normal e).
  * leave-one-out z for the normals (their own scan never sets their norm).
  * dementia (CDR>=0.5) vs age-matched normals: Cohen's d and AUC with 2,000-sample bootstrap CIs,
    compared with the OASIS nWBV volume measure treated the same way.
  * test-retest on the 20 repeat scans: ICC(1,1) and smallest detectable change (1.96*sqrt(2)*SEM).
  * correlation of bpf with OASIS nWBV (sanity check).
Flag threshold: the smallest one-sided z (disease direction) such that at most 5% of healthy people
aged 60+ get ANY flag across the shown measures. Reported with the dementia flag rate at that cut.
Go / no-go: a measure is shown to users only if AUC >= 0.70 and ICC >= 0.90.
Outputs: models/artifacts/tissue_norms.json, tissue_values.csv
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurotrail import tissue as T  # noqa: E402

MRI = ROOT / "data" / "raw" / "oasis_mri"
ART = ROOT / "models" / "artifacts"
RNG = np.random.default_rng(0)


def fit_norm(d: pd.DataFrame, col: str):
    A = np.c_[np.ones(len(d)), d["Age"], d["Age"] ** 2, d["female"]]
    b, *_ = np.linalg.lstsq(A, d[col].to_numpy(), rcond=None)
    e = d[col].to_numpy() - A @ b
    S = np.c_[np.ones(len(d)), d["Age"]]
    s, *_ = np.linalg.lstsq(S, np.abs(e) * np.sqrt(np.pi / 2), rcond=None)
    return b, s


def z_of(d: pd.DataFrame, col: str, b, s) -> np.ndarray:
    pred = b[0] + b[1] * d["Age"] + b[2] * d["Age"] ** 2 + b[3] * d["female"]
    return ((d[col] - pred) / np.maximum(1e-6, s[0] + s[1] * d["Age"])).to_numpy()


def boot_auc(y, s, n=2000):
    vals = []
    for _ in range(n):
        i = RNG.integers(0, len(y), len(y))
        if 0 < y[i].sum() < len(i):
            vals.append(roc_auc_score(y[i], s[i]))
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def icc(a, b):
    k = np.c_[a, b]
    msb = k.mean(1).var(ddof=1) * 2
    msw = ((k - k.mean(1, keepdims=True)) ** 2).sum() / len(k)
    return float((msb - msw) / (msb + msw))


def main() -> None:
    meta = pd.read_csv(MRI / "oasis_cross-sectional.csv")
    files = sorted(MRI.glob("**/*.nii"))
    raw = ART / "tissue_raw.csv"
    if raw.exists() and len(pd.read_csv(raw)) == len(files):
        rows = pd.read_csv(raw)
    else:
        rows = []
        for i, f in enumerate(files):
            m = re.search(r"(OAS1_\d{4}_MR\d)", f.name)
            rows.append({"ID": m.group(1), "file": f.name, **T.measure(np.asanyarray(nib.load(f).dataobj, dtype=np.float32))})
            if i % 50 == 0:
                print(f"  measured {i}/{len(files)}", flush=True)
        rows = pd.DataFrame(rows)
        rows.to_csv(raw, index=False)
    df = rows.merge(meta[["ID", "M/F", "Age", "CDR", "nWBV"]], on="ID")
    df["female"] = (df["M/F"] == "F").astype(float)
    df["session"] = df["ID"].str[-3:]
    df["status"] = np.where(df["CDR"].fillna(0) >= .5, "dementia", "normal")
    normal_mask = (df["status"] == "normal") & (df["session"] == "MR1")
    norm = df[normal_mask]
    cols = list(T.MEASURES) + ["nWBV"]
    bad = {**{k: v["bad"] for k, v in T.MEASURES.items()}, "nWBV": "low"}
    out = {"n_normal": int(len(norm)), "measures": {}}
    toward = pd.DataFrame(index=df.index)
    for c in cols:
        b, s = fit_norm(norm, c)
        z = np.array(z_of(df, c, b, s), dtype=float)
        # leave-one-out z for the normals
        loo = np.empty(normal_mask.sum())
        idx = np.where(normal_mask)[0]
        for j, i in enumerate(idx):
            bb, ss = fit_norm(norm.drop(index=df.index[i]), c)
            loo[j] = z_of(df.iloc[[i]], c, bb, ss)[0]
        z[idx] = loo
        toward[c] = -z if bad[c] == "low" else z
        out["measures"][c] = {"coef": [float(x) for x in b], "sd_coef": [float(x) for x in s]}
    dem = (df["status"] == "dementia").to_numpy()
    old = (normal_mask & (df["Age"] >= df.loc[dem, "Age"].min())).to_numpy()
    y = np.r_[np.zeros(old.sum()), np.ones(dem.sum())]
    for c in cols:
        a, h = toward.loc[dem, c].to_numpy(), toward.loc[old, c].to_numpy()
        sc = np.r_[h, a]
        out["measures"][c].update({
            "cohens_d": float((a.mean() - h.mean()) / np.sqrt((a.var(ddof=1) + h.var(ddof=1)) / 2)),
            "auc": float(roc_auc_score(y, sc)), "auc_ci": boot_auc(y, sc)})
    # delta AUC vs nWBV (paired bootstrap)
    for c in T.MEASURES:
        d_ = []
        for _ in range(2000):
            i = RNG.integers(0, len(y), len(y))
            if 0 < y[i].sum() < len(i):
                sc = np.r_[toward.loc[old, c], toward.loc[dem, c]][i]
                sn = np.r_[toward.loc[old, "nWBV"], toward.loc[dem, "nWBV"]][i]
                d_.append(roc_auc_score(y[i], sc) - roc_auc_score(y[i], sn))
        out["measures"][c]["delta_auc_vs_nwbv"] = [float(np.mean(d_)), float(np.percentile(d_, 2.5)), float(np.percentile(d_, 97.5))]
    # test-retest (z of MR1 vs MR2)
    zs = pd.DataFrame({c: (-1 if bad[c] == "low" else 1) * toward[c] for c in cols})
    pairs = [(df.index[(df["ID"] == s + "_MR1")][0], j) for j, s in zip(df.index[df["session"] == "MR2"], df.loc[df["session"] == "MR2", "ID"].str[:9])
             if ((df["ID"] == s + "_MR1")).any()]
    for c in cols:
        a = np.array([zs.loc[p[0], c] for p in pairs]); b_ = np.array([zs.loc[p[1], c] for p in pairs])
        sem = np.std(b_ - a, ddof=1) / np.sqrt(2)
        out["measures"][c].update({"icc": icc(a, b_), "sdc_z": float(1.96 * np.sqrt(2) * sem), "retest_n": len(pairs)})
    out["retest_note"] = "20 young adults (19-34), same scanner, days apart; older adults' scan noise is likely larger."
    out["bpf_vs_nwbv_r"] = float(np.corrcoef(df["bpf"], df["nWBV"])[0, 1])
    for c in T.MEASURES:
        m = out["measures"][c]
        m["shown"] = bool(m["auc"] >= .70 and m["icc"] >= .90)
    shown = [c for c in T.MEASURES if out["measures"][c]["shown"]]
    healthy60 = (normal_mask & (df["Age"] >= 60)).to_numpy()
    thr = None
    for t in np.arange(1.5, 4.01, 0.01):
        if not shown:
            break
        anyflag = (toward.loc[healthy60, shown] > t).any(axis=1).mean()
        if anyflag <= 0.05:
            thr = float(round(t, 2)); break
    out["threshold"] = thr if thr is not None else 99.0
    out["shown_measures"] = shown
    if shown and thr is not None:
        out["healthy60_any_flag_pct"] = float((toward.loc[healthy60, shown] > thr).any(axis=1).mean() * 100)
        out["dementia_any_flag_pct"] = float((toward.loc[dem, shown] > thr).any(axis=1).mean() * 100)
        out["n_healthy60"] = int(healthy60.sum())
    # Teaching view on sample OASIS scans: OASIS's own validated nWBV, one-sided (low = atrophy).
    nw = toward["nWBV"]
    t_nw = next((float(round(t, 2)) for t in np.arange(1.0, 4.01, 0.01) if (nw[healthy60] > t).mean() <= 0.05), 99.0)
    out["nwbv_teaching"] = {"threshold": t_nw, "healthy60_flag_pct": float((nw[healthy60] > t_nw).mean() * 100),
                            "dementia_flag_pct": float((nw[dem] > t_nw).mean() * 100), "n_healthy60": int(healthy60.sum()),
                            "n_dementia": int(dem.sum()),
                            "note": "nWBV is computed by the OASIS team's own pipeline; we cannot compute it for uploaded scans."}
    (ART / "tissue_norms.json").write_text(json.dumps(out, indent=1))
    df.assign(**{f"toward_{c}": toward[c] for c in cols}).to_csv(ART / "tissue_values.csv", index=False)
    print(json.dumps({c: {k: (round(v, 3) if isinstance(v, float) else v) for k, v in out["measures"][c].items() if k not in ("coef", "sd_coef")} for c in cols}, indent=1))
    print({k: out[k] for k in ("threshold", "shown_measures", "bpf_vs_nwbv_r")}, out.get("healthy60_any_flag_pct"), out.get("dementia_any_flag_pct"))
    print("nWBV teaching:", out["nwbv_teaching"])


if __name__ == "__main__":
    main()
