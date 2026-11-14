"""Colorbar extraction and RGB -> normalized-position inversion.

A colorbar PNG contains a horizontal strip framed by a 1 px white border.
Position 0.0 is the left inner edge of the strip, 1.0 the right inner edge;
each layer maps that position to a physical value (see layers.py).

Transparent stretches of the strip (e.g. "calm" wind, drizzle in the
precipitation bar) are left out of the LUT: in frames those values show the
background map instead of a colour.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass
class ColorLUT:
    colors: np.ndarray     # (N, 3) float32 RGB
    positions: np.ndarray  # (N,) float32 in [0, 1]

    def __len__(self) -> int:
        return len(self.positions)


def _strip_rows(rgba: np.ndarray) -> tuple[int, int]:
    """Rows of the strip interior: the longest run of rows that are mostly
    opaque and coloured (not white, not transparent)."""
    a = rgba[..., 3]
    rgb = rgba[..., :3].astype(int)
    not_white = (rgb.min(axis=2) < 235) | (np.ptp(rgb, axis=2) > 25)
    frac = ((a == 255) & not_white).mean(axis=1)
    good = frac > 0.3 * frac.max()
    best, run_start, best_span = (0, 0), None, -1
    for y, g in enumerate(list(good) + [False]):
        if g and run_start is None:
            run_start = y
        elif not g and run_start is not None:
            if y - run_start > best_span:
                best_span, best = y - run_start, (run_start, y - 1)
            run_start = None
    return best


def _strip_cols(rgba: np.ndarray, y: int) -> tuple[int, int]:
    """Inner left/right columns: just inside the opaque white border on row y."""
    row = rgba[y].astype(int)
    white = (row[:, 3] == 255) & (row[:, :3].min(axis=1) >= 245)
    xs = np.nonzero(white)[0]
    if len(xs) < 2:
        raise ValueError("could not find colorbar border")
    # the border may be 1-2 px wide: skip the whole first/last run of white
    left = int(xs[0])
    while left + 1 < row.shape[0] and white[left + 1]:
        left += 1
    right = int(xs[-1])
    while right - 1 > left and white[right - 1]:
        right -= 1
    return left + 1, right - 1


def extract_strip(path_or_img, rows: tuple[int, int] | None = None,
                  cols: tuple[int, int] | None = None) -> ColorLUT:
    """Build a LUT from a colorbar image.

    rows/cols: optional inclusive interior bounds; auto-detected otherwise.
    Uses the median of the middle half of the strip rows (avoids tick marks)."""
    img = path_or_img if isinstance(path_or_img, Image.Image) else Image.open(path_or_img)
    rgba = np.asarray(img.convert("RGBA"))
    y0, y1 = rows if rows else _strip_rows(rgba)
    ymid = (y0 + y1) // 2
    x0, x1 = cols if cols else _strip_cols(rgba, ymid)
    h = y1 - y0 + 1
    band = rgba[y0 + h // 4: y1 - h // 4 + 1, x0:x1 + 1]
    rgb = np.median(band[..., :3].astype(np.float32), axis=0)       # (W, 3)
    alpha = np.min(band[..., 3], axis=0)
    pos = (np.arange(x0, x1 + 1) - x0) / float(x1 - x0)
    keep = alpha >= 200   # transparent stretches are drawn as background in frames
    return ColorLUT(colors=rgb[keep].astype(np.float32), positions=pos[keep].astype(np.float32))


def invert(rgb: np.ndarray, lut: ColorLUT, max_dist: float = 12.0,
           chunk: int = 20000) -> tuple[np.ndarray, np.ndarray]:
    """Map an (H, W, 3) uint8 image to normalized positions.

    Returns (pos, dist): float32 arrays of shape (H, W). pos is NaN where the
    nearest LUT colour is farther than max_dist (Euclidean RGB)."""
    rgb = np.asarray(rgb)[..., :3].astype(np.uint32)
    packed = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    uniq, inv = np.unique(packed.ravel(), return_inverse=True)
    ucol = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], axis=1).astype(np.float32)
    best_i = np.empty(len(uniq), dtype=np.int64)
    best_d = np.empty(len(uniq), dtype=np.float32)
    c = lut.colors
    c2 = (c * c).sum(axis=1)
    for s in range(0, len(uniq), chunk):
        u = ucol[s:s + chunk]
        d2 = (u * u).sum(axis=1)[:, None] - 2 * u @ c.T + c2[None, :]
        i = np.argmin(d2, axis=1)
        best_i[s:s + chunk] = i
        best_d[s:s + chunk] = np.sqrt(np.maximum(d2[np.arange(len(i)), i], 0))
    pos_u = lut.positions[best_i].astype(np.float32)
    pos_u[best_d > max_dist] = np.nan
    shape = rgb.shape[:2]
    return pos_u[inv].reshape(shape), best_d[inv].reshape(shape)


def augment(lut: ColorLUT, toward: tuple[float, float, float], t_max: float,
            p_max: float = 1.0, steps: int = 4) -> ColorLUT:
    """Add LUT entries blended toward a background colour.

    Frames draw some colormaps semi-transparently (wind fades in over a grey
    background; flow streaks lighten it). Entries (1-t)*c + t*toward for
    t in (0, t_max] keep the position of c, so nearest-neighbour matching of a
    blended pixel still returns the right value. Only entries with
    position <= p_max are blended."""
    sel = lut.positions <= p_max
    cols, poss = [lut.colors], [lut.positions]
    bg = np.asarray(toward, dtype=np.float32)
    for t in np.linspace(0, t_max, steps + 1)[1:]:
        cols.append((1 - t) * lut.colors[sel] + t * bg)
        poss.append(lut.positions[sel])
    return ColorLUT(np.concatenate(cols).astype(np.float32), np.concatenate(poss).astype(np.float32))
