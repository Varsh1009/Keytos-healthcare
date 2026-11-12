"""
Shared training loop for the upgraded brain-age models.

* Inner validation split taken from the TRAINING fold only (stratified by age decade).
* AdamW + cosine learning-rate schedule (short linear warm-up), smooth-L1 loss on standardized age.
* Early stopping on inner-validation MAE; the best epoch's weights are kept.
* Mixed precision (bfloat16) on CUDA; volumes can live on the GPU or on the CPU (moved per batch).
"""
from __future__ import annotations

import copy
import logging
import math
from typing import Callable

import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split

log = logging.getLogger("train")
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def inner_split(idx: np.ndarray, ages: np.ndarray, seed: int, frac: float = 0.15) -> tuple[np.ndarray, np.ndarray]:
    """Split training-fold rows into (train, validation), stratified by age decade."""
    bins = np.minimum(ages[idx] // 10, 8).astype(int)
    tr, va = train_test_split(idx, test_size=frac, random_state=seed, stratify=bins)
    return np.sort(tr), np.sort(va)


def _autocast():
    return torch.autocast("cuda", dtype=torch.bfloat16) if DEV.type == "cuda" else torch.autocast("cpu", enabled=False)


@torch.no_grad()
def predict(model: nn.Module, X: torch.Tensor, idx: np.ndarray, batch: int = 8,
            prep: Callable[[torch.Tensor], torch.Tensor] | None = None) -> np.ndarray:
    """Predicted ages (years) for rows idx of X (N, D, H, W)."""
    model.eval()
    out = []
    for i in range(0, len(idx), batch):
        xb = X[torch.as_tensor(idx[i:i + batch])].to(DEV, non_blocking=True).float().unsqueeze(1)
        if prep is not None:
            xb = prep(xb)
        with _autocast():
            p = model(xb).float().squeeze(1)
        out.append(p.cpu().numpy())
    return np.concatenate(out) * model.y_std + model.y_mean


def fit(model: nn.Module, X: torch.Tensor, ages: np.ndarray, tr: np.ndarray, va: np.ndarray, *,
        augment: Callable[[torch.Tensor], torch.Tensor], epochs: int = 100, batch: int = 8, lr: float = 1e-3,
        weight_decay: float = 1e-3, patience: int = 20, min_epochs: int = 25, seed: int = 0,
        params=None, prep: Callable[[torch.Tensor], torch.Tensor] | None = None, label: str = "",
        bn_eval: bool = False) -> dict:
    """Train in place; returns {'val_mae', 'best_epoch', 'epochs_run'} and leaves the best weights loaded.
    bn_eval=True keeps batch-norm running statistics frozen (pretrained models with tiny batches)."""
    torch.manual_seed(seed)
    np.random.seed(seed)
    model.to(DEV)
    ym, ys = float(ages[tr].mean()), float(ages[tr].std())
    model.y_mean, model.y_std = ym, ys
    yt = torch.from_numpy(((ages - ym) / ys).astype(np.float32))
    opt = torch.optim.AdamW(params if params is not None else model.parameters(), lr=lr, weight_decay=weight_decay)
    steps = epochs * math.ceil(len(tr) / batch)
    warm = max(1, steps // 20)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: (s + 1) / warm if s < warm else 0.5 * (1 + math.cos(math.pi * (s - warm) / max(1, steps - warm))))
    best, best_state, best_ep, since = float("inf"), None, -1, 0
    for ep in range(epochs):
        model.train()
        if bn_eval:
            for mod in model.modules():
                if isinstance(mod, nn.modules.batchnorm._BatchNorm):
                    mod.eval()
        perm = np.random.permutation(tr)
        tot = 0.0
        for i in range(0, len(perm), batch):
            b = perm[i:i + batch]
            if len(b) < 2:          # BatchNorm needs > 1 sample
                continue
            xb = X[torch.as_tensor(b)].to(DEV, non_blocking=True).float().unsqueeze(1)
            if prep is not None:
                xb = prep(xb)
            xb = augment(xb)
            with _autocast():
                loss = nn.functional.smooth_l1_loss(model(xb).float().squeeze(1), yt[b].to(DEV))
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item() * len(b)
        val_mae = float(np.mean(np.abs(predict(model, X, va, prep=prep) - ages[va])))
        if val_mae < best:
            best, best_state, best_ep, since = val_mae, copy.deepcopy(model.state_dict()), ep, 0
        else:
            since += 1
        if ep % 10 == 0 or ep == epochs - 1:
            log.info("    %s epoch %3d  loss %.4f  val MAE %.2f (best %.2f @ %d)", label, ep, tot / len(tr), val_mae, best, best_ep)
        if ep >= min_epochs and since >= patience:
            log.info("    %s early stop at epoch %d (best %d, val MAE %.2f)", label, ep, best_ep, best)
            break
    model.load_state_dict(best_state)
    return {"val_mae": best, "best_epoch": best_ep, "epochs_run": ep + 1}
