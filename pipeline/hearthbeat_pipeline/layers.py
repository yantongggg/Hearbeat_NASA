"""Layer configuration, loaded from pipeline/sources.json.

Every NASA EIC visualization the app can play is one entry under "layers" in
sources.json. Value ranges come from each page's labelled colorbar image:
position 0..1 across the colorbar strip maps to min..max on the given scale.
New visualizations are added by editing that file (see probe.py), not this code.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, fields
from pathlib import Path

SOURCES = Path(__file__).resolve().parent.parent / "sources.json"


@dataclass
class Blend:
    """Extra LUT entries blended toward a background colour (see colorbar.augment)."""
    toward: tuple[int, int, int]
    t_max: float
    p_max: float = 1.0
    steps: int = 4


@dataclass
class Layer:
    key: str
    svs: int
    title: str
    unit: str
    scale: str                 # colorbar scale: "linear" | "log"
    min: float                 # value at the left edge of the colorbar strip
    max: float                 # value at the right edge
    colorbar: str              # filename on the SVS page
    frames_dir: str            # substring identifying the Frames entry to use
    cadence: str               # "hourly" (GEOS animations) | "daily" (dated files)
    enabled: bool = True
    disabled_reason: str = ""
    agency: str = "NASA"
    product: str = ""
    max_dist: float = 12.0     # RGB distance beyond which a pixel is "not a colorbar colour"
    blends: list[Blend] = field(default_factory=list)
    drop_grey_lut: bool = False      # drop near-grey LUT entries (collide with grey backgrounds)
    grey_value: float | None = None  # value for near-grey (background) pixels; None = invalid
    unmatched_value: float | None = None  # value for any other unmatched pixel; None = invalid
    min_chroma: int = 0        # matched pixels need max(RGB)-min(RGB) >= this
    white_invalid: bool = False  # pixels with all channels >= 235 are invalid (snow/ice)
    exclude_colors: list[tuple[int, int, int]] = field(default_factory=list)  # background colours (±6) -> no data
    agg: str = "median"        # per-cell aggregation
    # overlay rectangles (fractions x0, y0, x1, y1 of frame size) that are masked
    overlays: list[tuple[float, float, float, float]] = field(default_factory=list)
    fill: str = "all"          # fill empty cells from neighbours: "all" | "overlays" | "none"
    # .bin encoding (manifest encoding); defaults to the colorbar's own
    out_scale: str | None = None
    out_min: float | None = None
    out_max: float | None = None
    # take the numbers from NASA model output instead of the picture (see raw.py); None = decode the picture
    values: dict | None = None
    # what the globe draws (see pictures.py): {"mode": "rain-clouds" | "field" | "none", ...}
    picture: dict | None = None
    notes: str = ""

    @property
    def enc(self) -> tuple[str, float, float]:
        return (self.out_scale or self.scale,
                self.min if self.out_min is None else self.out_min,
                self.max if self.out_max is None else self.out_max)

    def pos_to_value(self, p):
        import numpy as np
        p = np.asarray(p, dtype=np.float64)
        if self.scale == "linear":
            return self.min + p * (self.max - self.min)
        return np.exp(np.log(self.min) + p * (np.log(self.max) - np.log(self.min)))


# GMAO frames (2048x1024): NASA/GMAO logo box top-left, date label box bottom-left.
GMAO_OVERLAYS = [(0.0, 0.0, 0.175, 0.075), (0.0, 0.9, 0.25, 1.0)]
OVERLAY_PRESETS = {"gmao": GMAO_OVERLAYS}
_FIELDS = {f.name for f in fields(Layer)}


def layer_from_config(key: str, c: dict) -> Layer:
    """Build a Layer from one sources.json entry, rejecting unknown or missing keys."""
    c = {k: v for k, v in c.items() if k not in ("adapter",) and not k.startswith("_")}
    unknown = set(c) - _FIELDS
    if unknown:
        raise ValueError(f"layer {key!r}: unknown keys {sorted(unknown)}")
    ov = c.get("overlays", [])
    if isinstance(ov, str):
        if ov not in OVERLAY_PRESETS:
            raise ValueError(f"layer {key!r}: unknown overlay preset {ov!r}")
        ov = OVERLAY_PRESETS[ov]
    c["overlays"] = [tuple(r) for r in ov]
    c["blends"] = [Blend(tuple(b["toward"]), b["t_max"], b.get("p_max", 1.0), b.get("steps", 4))
                   for b in c.get("blends", [])]
    c["exclude_colors"] = [tuple(x) for x in c.get("exclude_colors", [])]
    if c.get("scale") not in ("linear", "log"):
        raise ValueError(f"layer {key!r}: scale must be 'linear' or 'log'")
    if c.get("scale") == "log" and c["min"] <= 0:
        raise ValueError(f"layer {key!r}: log scale needs min > 0")
    return Layer(key=key, **c)


def load_sources(path: Path = SOURCES) -> dict:
    return json.loads(Path(path).read_text())


def load_layers(cfg: dict | None = None) -> dict[str, Layer]:
    cfg = cfg or load_sources()
    return {k: layer_from_config(k, c) for k, c in cfg["layers"].items() if c.get("adapter") == "eic-svs"}


LAYERS: dict[str, Layer] = load_layers()
