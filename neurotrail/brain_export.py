"""
Export a realistic brain mesh for the WebGL front end.

Mesh:   FreeSurfer fsaverage6 pial surface (40,962 vertices per hemisphere),
        the standard template made by averaging 40 real MRI brains.
Labels: Destrieux 2009 cortical atlas (ships on fsaverage5). fsaverage meshes
        are nested icosahedra, so each fsaverage6 vertex takes the label of
        its nearest fsaverage5 vertex on the registered sphere.
Shading: sulcal depth, so grooves render darker like a real brain.

Output: web/static/brain/{left,right}.bin (+ meta.json) read by Three.js.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from nilearn import datasets, surface
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "static" / "brain"
NL = str(ROOT / "data" / "raw" / "nilearn")


def taubin(coords: np.ndarray, faces: np.ndarray, it: int = 4, lam: float = 0.5,
           mu: float = -0.53) -> np.ndarray:
    """Taubin smoothing: removes mesh jaggedness without shrinking the brain."""
    n = len(coords)
    nbrs = [[] for _ in range(n)]
    for a, b, c in faces:
        nbrs[a] += [b, c]; nbrs[b] += [a, c]; nbrs[c] += [a, b]
    idx = np.concatenate([np.unique(x) for x in nbrs])
    ptr = np.cumsum([0] + [len(np.unique(x)) for x in nbrs])
    v = coords.astype(np.float64).copy()
    for _ in range(it):
        for f in (lam, mu):
            mean = np.add.reduceat(v[idx], ptr[:-1]) / np.diff(ptr)[:, None]
            v = v + f * (mean - v)
    return v


def export(region_groups: dict[str, list[str]]) -> dict:
    fs6 = datasets.fetch_surf_fsaverage("fsaverage6", data_dir=NL)
    fs5 = datasets.fetch_surf_fsaverage("fsaverage5", data_dir=NL)
    atlas = datasets.fetch_atlas_surf_destrieux(data_dir=NL)
    labels = [l.decode() if isinstance(l, bytes) else l for l in atlas["labels"]]
    OUT.mkdir(parents=True, exist_ok=True)
    group_ids = {g: i + 1 for i, g in enumerate(region_groups)}
    meta = {"groups": group_ids, "hemis": {}}
    for h in ("left", "right"):
        c6, f6 = surface.load_surf_mesh(fs6[f"pial_{h}"])
        s6, _ = surface.load_surf_mesh(fs6[f"sphere_{h}"])
        s5, _ = surface.load_surf_mesh(fs5[f"sphere_{h}"])
        lab5 = np.asarray(atlas[f"map_{h}"])
        _, nn = cKDTree(np.asarray(s5)).query(np.asarray(s6))
        lab6 = lab5[nn]
        sulc = np.asarray(surface.load_surf_data(fs6[f"sulc_{h}"]), dtype=np.float32)
        coords = taubin(np.asarray(c6), np.asarray(f6)).astype(np.float32)
        region = np.zeros(len(coords), dtype=np.uint8)
        for g, names in region_groups.items():
            ids = [labels.index(n) for n in names]
            region[np.isin(lab6, ids)] = group_ids[g]
        sul = np.clip((sulc - np.percentile(sulc, 2)) / (np.ptp(np.percentile(sulc, [2, 98])) + 1e-9), 0, 1)
        faces = np.asarray(f6, dtype=np.uint16)
        blob = coords.tobytes() + faces.tobytes() + (sul * 255).astype(np.uint8).tobytes() + region.tobytes()
        (OUT / f"{h}.bin").write_bytes(blob)
        meta["hemis"][h] = {"n_vertices": int(len(coords)), "n_faces": int(len(faces))}
        for g, gid in group_ids.items():
            pts = coords[region == gid]
            if len(pts):
                meta.setdefault("centroids", {}).setdefault(g, {})[h] = pts.mean(axis=0).round(2).tolist()
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    return meta


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    from neurotrail.quests import QUESTS
    m = export({q.id: q.regions for q in QUESTS})
    print(json.dumps(m["hemis"]), list(m["groups"]))
