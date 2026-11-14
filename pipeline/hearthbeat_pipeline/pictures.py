"""Globe pictures: the data layer of each NASA EIC frame, lifted off its background.

An EIC frame is a finished picture: NASA's data colours drawn over a flat map. On a 3-D globe that
looks flat and soft, so the app draws the Earth itself (NASA Blue Marble / Black Marble, lit by the
sun at the frame's hour) and lays only the data on top. This module makes that data layer as an
RGBA image (``o###.webp``):

- ``rain-clouds`` (precipitation): pixels that match the colorbar keep NASA's colour, opaque.
  Clouds are recovered as white with an alpha: the frame's own cloud-free background is estimated
  per pixel from all frames of the build (the darkest few), and cloud alpha is how far each pixel
  is from that background toward white.
- ``field`` (e.g. PM2.5): every pixel that matches the colorbar keeps NASA's colour; its opacity
  rises with its colorbar position, so clean air lets the Earth show through and polluted air
  covers it.
- ``none``: no picture (context-only layers that are never drawn).

The NASA/GMAO logo and date-label boxes are made fully transparent.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

MODES = ("rain-clouds", "field", "none")


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def estimate_background(frames: list[np.ndarray], rank: int = 2) -> np.ndarray:
    """Per pixel, the colour of the `rank`-th darkest frame (0 = darkest).

    Clouds only ever brighten the map, and at any place most frames are cloud-free some of the
    time, so a low-rank pick returns the plain background. rank > 0 skips one-off dark glitches."""
    stack = np.stack([f[..., :3] for f in frames])
    if len(frames) <= rank:
        rank = 0
    lum = stack.astype(np.int16).sum(axis=3)
    idx = np.argsort(lum, axis=0)[rank]
    return np.take_along_axis(stack, idx[None, ..., None], axis=0)[0]


def cloud_alpha(rgb: np.ndarray, background: np.ndarray, floor: float = 0.04) -> np.ndarray:
    """0..1: how far each pixel moved from the background toward white."""
    f = rgb[..., :3].astype(np.float32)
    b = background.astype(np.float32)
    a = ((f - b) / np.maximum(255.0 - b, 8.0)).mean(axis=2)
    return np.clip((a - floor) / (1 - floor), 0, 1)


def rain_clouds(rgb: np.ndarray, pos: np.ndarray, background: np.ndarray, hidden: np.ndarray,
                rain_alpha: float = 0.95, rain_alpha_min: float = 0.6, rain_full_pos: float = 0.25) -> np.ndarray:
    """RGBA: rain pixels in NASA's colours, clouds white with alpha, everything else transparent.

    `pos` is the colorbar position of each pixel (NaN = not a rain colour). Light rain is drawn
    semi-transparent (rain_alpha_min) and becomes opaque (rain_alpha) at `rain_full_pos`."""
    rain = np.isfinite(pos)
    h, w = rain.shape
    out = np.zeros((h, w, 4), np.uint8)
    a = cloud_alpha(rgb, background)
    a[rain] = 0
    ra = rain_alpha_min + (rain_alpha - rain_alpha_min) * smoothstep(0.0, rain_full_pos, np.nan_to_num(pos))
    out[..., :3] = np.where(rain[..., None], rgb[..., :3], 255)
    out[..., 3] = np.rint(np.where(rain, ra, a) * 255).astype(np.uint8)
    out[hidden, 3] = 0
    out[out[..., 3] == 0, :3] = 0
    return out


def feather(rgba: np.ndarray) -> np.ndarray:
    """Soften hard pixel edges: a 3x3 mean in premultiplied space (no dark fringes)."""
    a = rgba[..., 3:4].astype(np.float32) / 255
    pm = np.concatenate([rgba[..., :3].astype(np.float32) * a, a], axis=2)
    pad = np.pad(pm, ((1, 1), (1, 1), (0, 0)), mode="edge")
    pad[:, 0], pad[:, -1] = pm[np.r_[0, :pm.shape[0], -1], -1], pm[np.r_[0, :pm.shape[0], -1], 0]   # wrap in longitude
    acc = sum(pad[1 + dy:1 + dy + pm.shape[0], 1 + dx:1 + dx + pm.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    out = np.zeros_like(rgba)
    al = acc[..., 3]
    out[..., :3] = np.rint(np.where(al[..., None] > 1e-4, acc[..., :3] / np.maximum(al[..., None], 1e-4), 0)).clip(0, 255)
    out[..., 3] = np.rint(al * 255)
    return out


def field(rgb: np.ndarray, pos: np.ndarray, hidden: np.ndarray, alpha_from: float, alpha_to: float,
          alpha_max: float) -> np.ndarray:
    """RGBA: matched pixels in NASA's colours, opacity rising with colorbar position."""
    h, w = pos.shape
    out = np.zeros((h, w, 4), np.uint8)
    ok = np.isfinite(pos)
    a = np.where(ok, smoothstep(alpha_from, alpha_to, np.nan_to_num(pos)) * alpha_max, 0.0)
    out[..., :3] = rgb[..., :3]
    out[..., 3] = np.rint(a * 255).astype(np.uint8)
    out[hidden, 3] = 0
    out[out[..., 3] == 0, :3] = 0
    return out


def save(rgba: np.ndarray, path: Path, width: int, quality: int = 70, alpha_quality: int = 50) -> None:
    im = Image.fromarray(feather(rgba), "RGBA")
    if im.width != width:
        im = im.resize((width, width // 2), Image.LANCZOS)
    im.save(path, "WEBP", quality=quality, alpha_quality=alpha_quality, method=6)
