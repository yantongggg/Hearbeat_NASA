"""Values straight from NASA's model output (NCCS OPeNDAP), for layers whose picture cannot be read reliably.

The accuracy test showed that the EIC PM2.5 frames do not follow their own colorbar: decoded values
correlate with GEOS-CF (r_log ≈ 0.93) but are about 4× too low, on a compressed scale. For such a
layer the app still shows the EIC frame, but its numbers come from the same NASA model here.

Config (sources.json, layer key "values"):
    {"from": "opendap", "variable": "pm25_rh35", "has_lev": true, "time": "bracket-hourly-means",
     "datasets": [<analysis url>, <latest forecast url>], "label": "..."}
"""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from . import grid, opendap

# GEOS-CF / GEOS-FP 0.25° grids: lat −90…90 (721), lon −180…179.75 (1440). Index 2 + 4k is a 1° cell centre.
LAT_IDX = (2, 4, 718)
LON_IDX = (2, 4, 1438)

_datasets: dict[tuple[str, bool], opendap.Dataset] = {}


def _ds(url: str, has_lev: bool) -> opendap.Dataset:
    k = (url, has_lev)
    if k not in _datasets:
        _datasets[k] = opendap.Dataset(url, has_lev)
    return _datasets[k]


def times_for(cfg: dict, t: datetime) -> list[datetime]:
    """Hourly-mean collections are stamped at :30; an instant T is the mean of the hours either side."""
    if cfg.get("time") == "bracket-hourly-means":
        return [t - timedelta(minutes=30), t + timedelta(minutes=30)]
    return [t]


def _field(cfg: dict, t: datetime) -> tuple[np.ndarray, str]:
    errors = []
    for url in cfg["datasets"]:
        ds = _ds(url, bool(cfg.get("has_lev")))
        if not ds.axis.covers(t):
            continue
        for attempt in range(2):          # a cached response from an older ".latest" aggregation is dropped and refetched
            try:
                f = ds.field(cfg["variable"], t, LAT_IDX, LON_IDX)
                break
            except opendap.OpendapError as e:
                if attempt or "time mismatch" not in str(e):
                    raise
        if not (np.isclose(f.lat[0], -89.5) and np.isclose(f.lat[-1], 89.5)
                and np.isclose(f.lon[0], -179.5) and np.isclose(f.lon[-1], 179.5)):
            raise RuntimeError(f"unexpected grid from {url}: lat {f.lat[0]}..{f.lat[-1]}, lon {f.lon[0]}..{f.lon[-1]}")
        return f.values[::-1, :].astype(np.float64), url     # served south→north; contract is north→south
    errors.append(f"no dataset covers {t:%Y-%m-%d %H:%MZ}")
    raise RuntimeError("; ".join(errors))


def raw_grid(cfg: dict, t: datetime) -> tuple[np.ndarray, list[str]]:
    """(180, 360) grid of the variable at instant t (NaN where missing) and the datasets used."""
    vals, used = [], []
    for tt in times_for(cfg, t):
        v, url = _field(cfg, tt)
        vals.append(v)
        used.append(url)
    g = np.mean(vals, axis=0) * float(cfg.get("scale", 1.0))
    g[~np.isfinite(g)] = np.nan
    assert g.shape == (grid.H, grid.W)
    return g, sorted(set(used))
