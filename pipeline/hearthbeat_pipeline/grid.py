"""1-degree global grid: downsampling, hole filling, uint8 (de)quantisation.

Grid convention (docs/DATA.md): 360 x 180, row 0 = 89.5 N going south,
column 0 = -179.5 E going east. Source frames are equirectangular with
lon -180..180 left to right and lat 90..-90 top to bottom.
"""
from __future__ import annotations

import numpy as np

W, H = 360, 180
LAT0, LON0, STEP = 89.5, -179.5, 1.0


def cell_index(h: int, w: int) -> tuple[np.ndarray, np.ndarray]:
    """Grid row for each image row and grid column for each image column."""
    rows = np.minimum(((np.arange(h) + 0.5) * H / h).astype(int), H - 1)
    cols = np.minimum(((np.arange(w) + 0.5) * W / w).astype(int), W - 1)
    return rows, cols


def downsample(values: np.ndarray, how: str = "median") -> np.ndarray:
    """(h, w) float image with NaN = invalid -> (180, 360) float grid, NaN where empty."""
    h, w = values.shape
    r, c = cell_index(h, w)
    cell = (r[:, None] * W + c[None, :]).ravel()
    v = values.ravel()
    ok = ~np.isnan(v)
    cell, v = cell[ok], v[ok]
    out = np.full(W * H, np.nan, dtype=np.float32)
    counts = np.bincount(cell, minlength=W * H)
    if how == "mean":
        sums = np.bincount(cell, weights=v, minlength=W * H)
        nz = counts > 0
        out[nz] = sums[nz] / counts[nz]
    elif how == "median":
        order = np.lexsort((v, cell))
        vs = v[order]
        starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
        nz = np.nonzero(counts)[0]
        lo = starts[nz] + (counts[nz] - 1) // 2
        hi = starts[nz] + counts[nz] // 2
        out[nz] = 0.5 * (vs[lo] + vs[hi])
    else:
        raise ValueError(how)
    return out.reshape(H, W)


def fill_holes(grid: np.ndarray, where: np.ndarray, iterations: int = 200) -> np.ndarray:
    """Fill NaN cells inside `where` from the mean of valid 8-neighbours
    (longitude wraps). Used only for cells hidden by logo/date overlays."""
    g = grid.copy()
    todo = where & np.isnan(g)
    for _ in range(iterations):
        if not todo.any():
            break
        valid = ~np.isnan(g)
        z = np.where(valid, g, 0.0)
        s = np.zeros_like(z)
        n = np.zeros_like(z)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == dx == 0:
                    continue
                zs = np.roll(np.roll(z, dx, axis=1), dy, axis=0)
                vs = np.roll(np.roll(valid, dx, axis=1), dy, axis=0)
                if dy == 1:
                    zs[0], vs[0] = 0, False
                if dy == -1:
                    zs[-1], vs[-1] = 0, False
                s += zs
                n += vs
        can = todo & (n > 0)
        g[can] = s[can] / n[can]
        todo &= ~can
    return g


def quantize(values: np.ndarray, vmin: float, vmax: float, scale: str) -> np.ndarray:
    """Float values -> uint8 per contract. NaN -> 0; finite values clamp to 1..255."""
    v = np.asarray(values, dtype=np.float64)
    nan = np.isnan(v)
    if scale == "linear":
        t = (v - vmin) / (vmax - vmin)
    elif scale == "log":
        t = (np.log(np.clip(v, vmin, None)) - np.log(vmin)) / (np.log(vmax) - np.log(vmin))
    else:
        raise ValueError(scale)
    q = 1 + np.rint(np.clip(np.nan_to_num(t), 0, 1) * 254)
    q[nan] = 0
    return q.astype(np.uint8)


def dequantize(q: np.ndarray, vmin: float, vmax: float, scale: str) -> np.ndarray:
    """uint8 -> float values (NaN for 0), exactly as the web app decodes them."""
    q = np.asarray(q).astype(np.float64)
    t = (q - 1) / 254
    if scale == "linear":
        v = vmin + t * (vmax - vmin)
    else:
        v = np.exp(np.log(vmin) + t * (np.log(vmax) - np.log(vmin)))
    v[q == 0] = np.nan
    return v


def latlon_to_cell(lat: float, lon: float) -> tuple[int, int]:
    r = int(np.clip(np.floor(LAT0 + 0.5 - lat), 0, H - 1))
    c = int(np.floor(lon - (LON0 - 0.5))) % W
    return r, c
