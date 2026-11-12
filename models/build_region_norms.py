"""
Build region norms and the data-driven Alzheimer's map from the 436 real OASIS-1 MRI scans.

1. Tissue index in every Harvard-Oxford region for every scan.
2. Norms from cognitively normal first sessions: index ~ age + age^2 + sex (OLS), residual SD.
3. Validation / Alzheimer's map: z-scores of dementia participants (CDR >= 0.5) vs normals aged 60+,
   per region: mean z, Cohen's d, Welch t-test p-value, Benjamini-Hochberg FDR.
   Normal participants' z-scores are computed leave-one-out (their own scan is not in their norm).
4. Test-retest: correlation of region z between MR1 and MR2 for the 20 rescanned people.
Outputs: models/artifacts/region_norms.json, region_values.csv
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurotrail import regions as R  # noqa: E402

MRI = ROOT / "data" / "raw" / "oasis_mri"
ART = ROOT / "models" / "artifacts"


def bh(p: np.ndarray) -> np.ndarray:
    n = len(p)
    o = np.argsort(p)
    q = np.empty(n)
    q[o] = np.minimum.accumulate((p[o] * n / np.arange(1, n + 1))[::-1])[::-1]
    return np.minimum(q, 1)


def main() -> None:
    meta = pd.read_csv(MRI / "oasis_cross-sectional.csv")
    rows = []
    for f in sorted(MRI.glob("**/*.nii")):
        m = re.search(r"(OAS1_\d{4}_MR\d)", f.name)
        v = np.asanyarray(nib.load(f).dataobj, dtype=np.float32)
        rows.append({"ID": m.group(1), **R.measure(v)})
    df = pd.DataFrame(rows).merge(meta[["ID", "M/F", "Age", "CDR"]], on="ID")
    df["female"] = (df["M/F"] == "F").astype(float)
    df["session"] = df["ID"].str[-3:]
    df["status"] = np.where(df["CDR"].fillna(0) >= .5, "dementia", "normal")
    rids = [r["id"] for r in R.regions() if r["id"] in df.columns]
    X = lambda d: np.c_[np.ones(len(d)), d["Age"], d["Age"] ** 2, d["female"]]
    norm = df[(df["status"] == "normal") & (df["session"] == "MR1")].reset_index(drop=True)
    out = {"n_normal": int(len(norm)), "model": "tissue index ~ 1 + age + age^2 + female (OLS) in cognitively normal OASIS-1 adults",
           "regions": {}}
    Z = pd.DataFrame(index=df.index)
    for rid in rids:
        y = norm[rid].to_numpy()
        A = X(norm)
        b, *_ = np.linalg.lstsq(A, y, rcond=None)
        resid = y - A @ b
        sd = float(resid.std(ddof=4))
        out["regions"][rid] = {"coef": [float(x) for x in b], "sd": sd}
        Z[rid] = (df[rid] - X(df) @ b) / sd
        # leave-one-out z for the normals themselves
        H = A @ np.linalg.pinv(A.T @ A) @ A.T
        loo = resid / (1 - np.diag(H))
        Z.loc[(df["status"] == "normal") & (df["session"] == "MR1"), rid] = loo / sd
    dem = df["status"] == "dementia"
    old = (df["status"] == "normal") & (df["session"] == "MR1") & (df["Age"] >= df.loc[dem, "Age"].min())
    res = []
    for rid in rids:
        a, c = Z.loc[dem, rid], Z.loc[old, rid]
        t = stats.ttest_ind(a, c, equal_var=False)
        d = (a.mean() - c.mean()) / np.sqrt((a.var(ddof=1) + c.var(ddof=1)) / 2)
        res.append((rid, float(a.mean()), float(c.mean()), float(d), float(t.pvalue)))
    q = bh(np.array([r[4] for r in res]))
    out["alzheimers_map"] = {"comparison": f"dementia CDR>=0.5 (n={int(dem.sum())}) vs cognitively normal aged >= {int(df.loc[dem, 'Age'].min())} (n={int(old.sum())})",
                             "regions": {r[0]: {"mean_z_dementia": r[1], "mean_z_normal": r[2], "cohens_d": r[3], "p": r[4], "q_fdr": float(qq)}
                                         for r, qq in zip(res, q)}}
    # test-retest
    pairs = []
    for sid in df.loc[df["session"] == "MR2", "ID"].str[:9]:
        i1 = df.index[df["ID"] == sid + "_MR1"]
        i2 = df.index[df["ID"] == sid + "_MR2"]
        if len(i1) and len(i2):
            pairs.append((Z.loc[i1[0], rids].to_numpy(float), Z.loc[i2[0], rids].to_numpy(float)))
    if pairs:
        a = np.array([p[0] for p in pairs]); b = np.array([p[1] for p in pairs])
        per = [stats.pearsonr(a[:, j], b[:, j])[0] for j in range(len(rids))]
        out["test_retest"] = {"n_pairs": len(pairs), "median_region_r": float(np.median(per)),
                              "median_abs_z_change": float(np.median(np.abs(b - a))),
                              "z_change_95pct": float(np.percentile(np.abs(b - a), 95))}
    (ART / "region_norms.json").write_text(json.dumps(out, indent=1))
    Z.assign(ID=df["ID"], Age=df["Age"], status=df["status"], session=df["session"]).to_csv(ART / "region_values.csv", index=False)
    top = sorted(out["alzheimers_map"]["regions"].items(), key=lambda kv: kv[1]["cohens_d"])[:12]
    names = {r["id"]: r["name"] for r in R.regions()}
    print(out["alzheimers_map"]["comparison"])
    for rid, v in top:
        print(f"  {names[rid]:45s} d={v['cohens_d']:+.2f}  z_dem={v['mean_z_dementia']:+.2f}  q={v['q_fdr']:.1e}")
    print("test-retest:", out.get("test_retest"))


if __name__ == "__main__":
    main()
