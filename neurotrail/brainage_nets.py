"""
Network definitions for the upgraded brain-age models (shared by training scripts and the app).

* BrainAgeCNN2mm: the baseline design at native 2 mm, one extra stride-2 block.
* Input crop: one fixed box for every scan (union of non-zero voxels over all 436 OASIS scans,
  plus a 2-4 voxel margin), so no brain tissue is cut and empty border is dropped.
"""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn

# Fixed crop of the 91 x 109 x 91 MNI 2 mm grid -> 86 x 102 x 84 (brain bbox over all scans: x 5-86, y 6-103, z 0-81).
CROP_2MM = (slice(3, 89), slice(4, 106), slice(0, 84))


def crop_2mm(v: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(v[CROP_2MM])


class BrainAgeCNN2mm(nn.Module):
    """6 conv blocks (first stride 1, then 5 stride-2; no 3D pooling) + global average pool + dropout + linear."""

    def __init__(self, ch=(16, 32, 64, 96, 128, 128), dropout: float = 0.3, norm: str = "batch"):
        super().__init__()
        layers, c_in = [], 1
        for i, c in enumerate(ch):
            nrm = nn.BatchNorm3d(c) if norm == "batch" else nn.GroupNorm(8, c)
            layers += [nn.Conv3d(c_in, c, 3, stride=1 if i == 0 else 2, padding=1, bias=False), nrm, nn.ReLU(inplace=True)]
            c_in = c
        self.features = nn.Sequential(*layers)
        self.head = nn.Sequential(nn.AdaptiveAvgPool3d(1), nn.Flatten(), nn.Dropout(dropout), nn.Linear(c_in, 1))
        self.y_mean, self.y_std = 0.0, 1.0

    def forward(self, x):
        return self.head(self.features(x))


# ------------------------------------------------------------------ SFCN (Peng et al. 2021)
# Re-implementation of github.com/ha-ha-ha-han/UKBiobank_deep_pretrain dp_model/model_files/sfcn.py (MIT),
# with identical module names so the published UK Biobank weights load unchanged.
SFCN_SHAPE = (160, 192, 160)          # exact input size (AvgPool3d([5, 6, 5]) is hard-coded)
SFCN_FULL = (182, 218, 182)           # FSL MNI152 1 mm grid; OASIS 2 mm files are the FSL MNI152 2 mm grid
SFCN_BINS = (42, 82)                  # pretrained head: 40 one-year bins, centres 42.5 ... 81.5


class SFCN(nn.Module):
    def __init__(self, channels=(32, 64, 128, 256, 256, 64), output_dim: int = 40, dropout: bool = True):
        super().__init__()
        self.feature_extractor = nn.Sequential()
        n = len(channels)
        for i in range(n):
            c_in = 1 if i == 0 else channels[i - 1]
            if i < n - 1:
                blk = nn.Sequential(nn.Conv3d(c_in, channels[i], 3, padding=1), nn.BatchNorm3d(channels[i]),
                                    nn.MaxPool3d(2, stride=2), nn.ReLU())
            else:
                blk = nn.Sequential(nn.Conv3d(c_in, channels[i], 1, padding=0), nn.BatchNorm3d(channels[i]), nn.ReLU())
            self.feature_extractor.add_module(f"conv_{i}", blk)
        self.classifier = nn.Sequential()
        self.classifier.add_module("average_pool", nn.AvgPool3d([5, 6, 5]))
        if dropout:
            self.classifier.add_module("dropout", nn.Dropout(0.5))
        self.classifier.add_module(f"conv_{n}", nn.Conv3d(channels[-1], output_dim, 1, padding=0))
        self.output_dim = output_dim
        self.y_mean, self.y_std = 0.0, 1.0
        self.grad_checkpoint = False      # recompute conv blocks in backward to fit 1 mm batches in 6 GB

    def forward(self, x):
        if self.grad_checkpoint and self.training and torch.is_grad_enabled():
            from torch.utils.checkpoint import checkpoint
            for blk in self.feature_extractor:
                x = checkpoint(blk, x, use_reentrant=False) if x.requires_grad or any(
                    p.requires_grad for p in blk.parameters()) else blk(x)
        else:
            x = self.feature_extractor(x)
        x = self.classifier(x).flatten(1)
        return x if self.output_dim == 1 else torch.log_softmax(x, dim=1)   # regression head: (B, 1)

    def load_pretrained(self, state: dict) -> list[str]:
        """Load Peng's DataParallel checkpoint ('module.' prefix); skips the head if output_dim != 40."""
        state = {k.removeprefix("module."): v for k, v in state.items()}
        if self.output_dim != 40:
            state = {k: v for k, v in state.items() if not k.startswith("classifier.")}
        missing, unexpected = self.load_state_dict(state, strict=False)
        assert not unexpected, unexpected
        return missing


def sfcn_prep(x2mm: torch.Tensor) -> torch.Tensor:
    """(B, 1, 91, 109, 91) raw 2 mm intensities -> SFCN input (B, 1, 160, 192, 160), as in Peng's notebook:
    on the 1 mm MNI grid, divide by the whole-volume mean (background included), centre-crop.
    Upsampling 2 mm -> 1 mm only matches the input shape; it adds no real detail."""
    x = torch.nn.functional.interpolate(x2mm.float(), size=SFCN_FULL, mode="trilinear", align_corners=False)
    x = x / x.mean(dim=(2, 3, 4), keepdim=True).clamp_min(1e-6)
    s = [(f - c) // 2 for f, c in zip(SFCN_FULL, SFCN_SHAPE)]
    return x[:, :, s[0]:s[0] + SFCN_SHAPE[0], s[1]:s[1] + SFCN_SHAPE[1], s[2]:s[2] + SFCN_SHAPE[2]].contiguous()
