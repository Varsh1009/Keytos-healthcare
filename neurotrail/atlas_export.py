"""
Export the Harvard-Oxford atlas for the 3D view:
  * deep.json: meshes of deep structures (hippocampus, amygdala, thalamus, caudate, putamen,
    pallidum, accumbens, brainstem, ventricles), built with marching cubes from the atlas in MNI mm.
  * ho_left.bin / ho_right.bin: the Harvard-Oxford cortical label of every fsaverage6 vertex
    (volume-to-surface projection), so region scores can colour the cortical surface.
fsaverage and the MNI152 atlas share (approximately) the same millimetre space.
"""
from __future__ import annotations

import json
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
from skimage import measure

from . import regions as R

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "static" / "brain"
NL = str(ROOT / "data" / "raw" / "nilearn")


def main() -> None:
    from nilearn import datasets, surface
    c = datasets.fetch_atlas_harvard_oxford("cort-maxprob-thr25-2mm", data_dir=NL)
    s = datasets.fetch_atlas_harvard_oxford("sub-maxprob-thr25-2mm", data_dir=NL)
    cimg = c.maps if hasattr(c.maps, "shape") else nib.load(c.maps)
    simg = s.maps if hasattr(s.maps, "shape") else nib.load(s.maps)
    sub = np.asanyarray(simg.dataobj).astype(int)
    aff = simg.affine
    deep = {}
    for rid, (name, labs, _) in R.DEEP.items():
        for lab in labs:
            m = gaussian_filter((sub == s.labels.index(lab)).astype(float), 0.8)
            if m.max() < .5:
                continue
            verts, faces, _, _ = measure.marching_cubes(m, level=0.5)
            xyz = nib.affines.apply_affine(aff, verts)
            side = "L" if lab.startswith("Left") else "R" if lab.startswith("Right") else "M"
            deep[f"{rid}_{side}"] = {"region": rid, "pos": np.round(xyz, 1).ravel().tolist(), "idx": faces.astype(int).ravel().tolist()}
    (OUT / "deep.json").write_text(json.dumps(deep))
    fs6 = datasets.fetch_surf_fsaverage("fsaverage6", data_dir=NL)
    for h in ("left", "right"):
        lab = surface.vol_to_surf(cimg, fs6[f"pial_{h}"], interpolation="nearest_most_frequent", radius=3.0)
        lab = np.nan_to_num(lab).astype(int)
        coords, _ = surface.load_surf_mesh(fs6[f"pial_{h}"])
        coords = np.asarray(coords)
        known = lab > 0
        if (~known).any():
            _, nn = cKDTree(coords[known]).query(coords[~known])
            lab[~known] = lab[known][nn]
        (OUT / f"ho_{h}.bin").write_bytes(lab.astype(np.uint8).tobytes())
        print(h, "labels", len(np.unique(lab)), "filled", int((~known).sum()))
    print("deep meshes:", {k: len(v["idx"]) // 3 for k, v in deep.items()})


if __name__ == "__main__":
    main()
