"""NASA GISTEMP v4 climate layer: annual surface temperature anomaly, 1880 -> last complete year.

    python -m hearthbeat_pipeline.climate --out ../app/public/data

Writes <out>/<key>/g<YYYY>.bin, o<YYYY>.webp (RGBA globe layer) and colorbar.png (docs/DATA.md v2)
and prints the manifest layer entry as JSON on stdout (progress and a sanity
check go to stderr).

Inputs (cached under pipeline/cache/gistemp/, reused until --refresh):
- gistemp1200_GHCNv4_ERSSTv5.nc.gz: monthly anomalies (K = degC) on a 2 deg grid,
  1200 km smoothing, base 1951-1980.
- GLB.Ts+dSST.csv: NASA's global land-ocean annual mean (J-D column).
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from . import grid as qgrid
from .svs import fetch_bytes

NC_URL = "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz"
CSV_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
PAGE = "https://data.giss.nasa.gov/gistemp/"
CACHE = Path(__file__).resolve().parent.parent / "cache" / "gistemp"

DEFAULTS: dict = {
    "url": NC_URL,            # gridded monthly anomalies
    "series_url": CSV_URL,    # global annual means
    "nc_file": None,          # local file instead of downloading url (tests, offline runs)
    "csv_file": None,         # local file instead of downloading series_url
    "refresh": False,         # re-download even if cached
    "min_months": 9,          # months (of 12) a cell needs for a valid annual mean
    "enc_min": -6.0,          # stored range, degC (uint8 linear)
    "enc_max": 6.0,
    "palette_max": 4.0,       # image colours saturate at +-palette_max degC
    "image_size": (512, 256),   # 2.8 px per 2° cell; the GPU smooths it on the globe
    "webp_quality": 80,
    "alpha_from": 0.3,        # |anomaly| (degC) below which the globe shows through untinted
    "alpha_full": 2.2,        # |anomaly| (degC) at which the colour is fully opaque on the globe
    "alpha_max": 0.88,
    "nodata_alpha": 0.6,
}

NODATA_RGB = (0x26, 0x2B, 0x31)   # #262b31
# ColorBrewer RdBu (11 classes), reversed: blue = cooler, red = warmer than 1951-1980.
# Lightness is matched on both sides (within ~4 L*), so equal |anomaly| reads equally strong.
PALETTE_HEX = ["#053061", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7",
               "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f"]
PALETTE_RGB = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in PALETTE_HEX], np.float64)

SANITY_POINTS = {
    "Arctic 84N 20E": (84.0, 20.0),
    "Trop. Pacific 0N 150W": (0.0, -150.0),
    "Kuala Lumpur 3.1N 101.7E": (3.1, 101.7),
}


# ---------------------------------------------------------------- downloads

def fetch(url: str, refresh: bool = False) -> Path:
    """Download url into pipeline/cache/gistemp/<basename> (reused unless refresh)."""
    p = CACHE / url.rstrip("/").rsplit("/", 1)[-1]
    if refresh or not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        data = fetch_bytes(url)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(p)
    return p


def _mtime_utc(p: Path) -> datetime:
    return datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)


# ---------------------------------------------------------------- reading

def read_monthly(path: Path) -> dict:
    """GISTEMP NetCDF (optionally .gz) -> dict(data (t, lat, lon) float32 with NaN,
    lat, lon, years, months, history). Coordinates are returned as stored."""
    import netCDF4  # local import: only needed for real runs

    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    with netCDF4.Dataset("gistemp", memory=raw) as ds:
        names = set(ds.variables)
        lat_name = next(n for n in ("lat", "latitude") if n in names)
        lon_name = next(n for n in ("lon", "longitude") if n in names)
        var = ds.variables["tempanomaly"]
        if var.dimensions != ("time", lat_name, lon_name):
            raise ValueError(f"unexpected dimensions {var.dimensions}")
        units = getattr(var, "units", "")
        if units not in ("K", "C", "degC", "deg C"):
            raise ValueError(f"unexpected anomaly units {units!r}")
        data = np.ma.filled(var[:].astype(np.float32), np.nan)
        lat = np.asarray(ds.variables[lat_name][:], np.float64)
        lon = np.asarray(ds.variables[lon_name][:], np.float64)
        tv = ds.variables["time"]
        dates = netCDF4.num2date(tv[:], tv.units, getattr(tv, "calendar", "standard"))
        history = getattr(ds, "history", "")
    return {"data": data, "lat": lat, "lon": lon,
            "years": np.array([d.year for d in dates]), "months": np.array([d.month for d in dates]),
            "history": history}


def read_global_series(path: Path) -> dict[int, float]:
    """GLB.Ts+dSST.csv -> {year: J-D annual mean}; '***' (missing) years are left out."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    hi = next(i for i, r in enumerate(rows) if r and r[0].strip() == "Year")
    col = [c.strip() for c in rows[hi]].index("J-D")
    out = {}
    for r in rows[hi + 1:]:
        if len(r) <= col or not r[0].strip().isdigit():
            continue
        v = r[col].strip()
        if v and "*" not in v:
            out[int(r[0])] = round(float(v), 2)
    return out


# ---------------------------------------------------------------- gridding

def _num(x: float):
    x = float(x)
    return int(x) if x.is_integer() else round(x, 6)


def orient(data: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, dict]:
    """Reorder (..., lat, lon) so row 0 is the northernmost row and column 0 the
    westernmost (longitudes taken to -180..180). Returns (data, grid block)."""
    lat = np.asarray(lat, np.float64)
    lon = (np.asarray(lon, np.float64) + 180.0) % 360.0 - 180.0
    ri = np.argsort(-lat, kind="stable")
    ci = np.argsort(lon, kind="stable")
    lat_s, lon_s = lat[ri], lon[ci]
    dlat, dlon = -np.diff(lat_s), np.diff(lon_s)
    step = float(dlat[0])
    if not (np.allclose(dlat, step, atol=1e-4) and np.allclose(dlon, step, atol=1e-4) and step > 0):
        raise ValueError("grid is not regular with equal lat/lon steps")
    out = np.take(np.take(data, ri, axis=-2), ci, axis=-1)
    g = {"w": int(len(lon_s)), "h": int(len(lat_s)), "lat0": _num(lat_s[0]),
         "lon0": _num(lon_s[0]), "step": _num(step)}
    return out, g


def annual_means(monthly: np.ndarray, years, months, min_months: int = 9) -> tuple[list[int], np.ndarray]:
    """Monthly (t, h, w) with NaN = missing -> (complete years, (n, h, w) annual means).

    Only calendar years whose 12 months are all in the time axis are used. A cell
    is valid for a year if it has >= min_months non-missing months; its value is
    the mean of those months, otherwise NaN."""
    years, months = np.asarray(years), np.asarray(months)
    out_years, out = [], []
    for y in sorted(set(years.tolist())):
        sel = years == y
        ms = months[sel]
        if len(ms) != len(set(ms.tolist())):
            raise ValueError(f"duplicate months in {y}")
        if set(ms.tolist()) != set(range(1, 13)):
            continue
        block = monthly[sel]
        ok = np.isfinite(block)
        n = ok.sum(axis=0)
        s = np.where(ok, block, 0).sum(axis=0, dtype=np.float64)
        mean = np.full(n.shape, np.nan, np.float32)
        good = n >= min_months
        mean[good] = (s[good] / n[good]).astype(np.float32)
        out_years.append(int(y))
        out.append(mean)
    shape = (0,) + monthly.shape[1:]
    return out_years, (np.stack(out) if out else np.zeros(shape, np.float32))


def encode(values: np.ndarray, vmin: float = -6.0, vmax: float = 6.0) -> np.ndarray:
    """degC -> uint8 per contract (linear, 0 = no data, clipped to 1/255)."""
    return qgrid.quantize(values, vmin, vmax, "linear")


def cell_of(lat: float, lon: float, g: dict) -> tuple[int, int]:
    """(row, col) of the grid cell containing lat/lon."""
    s = g["step"]
    r = int(np.clip(np.floor((g["lat0"] + s / 2 - lat) / s), 0, g["h"] - 1))
    c = int(np.floor(((lon - (g["lon0"] - s / 2)) % 360.0) / s)) % g["w"]
    return r, c


def valid_area_fraction(values: np.ndarray, g: dict) -> float:
    """Share of the grid's area (cos-latitude weighted) with data."""
    lat = g["lat0"] - g["step"] * np.arange(g["h"])
    w = np.cos(np.radians(lat))[:, None] * np.ones((1, g["w"]))
    return float((w * np.isfinite(values)).sum() / w.sum())


def area_mean(values: np.ndarray, g: dict) -> float:
    lat = g["lat0"] - g["step"] * np.arange(g["h"])
    w = np.cos(np.radians(lat))[:, None] * np.isfinite(values)
    return float(np.nansum(values * w) / w.sum())


# ---------------------------------------------------------------- pictures

def palette(values, vmax: float = 4.0) -> np.ndarray:
    """degC -> (..., 3) uint8 RGB, diverging blue-white-red, symmetric about 0,
    saturating at +-vmax. NaN maps to the no-data grey."""
    v = np.asarray(values, np.float64)
    pos = np.linspace(-vmax, vmax, len(PALETTE_RGB))
    vc = np.clip(np.nan_to_num(v), -vmax, vmax)
    rgb = np.stack([np.interp(vc, pos, PALETTE_RGB[:, k]) for k in range(3)], axis=-1)
    rgb[np.isnan(v)] = NODATA_RGB
    return np.rint(rgb).astype(np.uint8)


def render(values: np.ndarray, g: dict, size: tuple[int, int] = (1024, 512),
           vmax: float = 4.0, rgba: bool = False, alpha_from: float = 0.3, alpha_full: float = 2.2, alpha_max: float = 0.88,
           nodata_alpha: float = 0.6) -> Image.Image:
    """(h, w) degC grid (NaN = no data) -> equirectangular RGB image, lon -180..180
    left to right, lat 90..-90 top to bottom. Values are bilinearly interpolated
    from the valid neighbours; a pixel is no data where the bilinear weight of
    valid cells is below 0.5 (edges blended over ~0.2 cell)."""
    W, H = size
    h, w, s = g["h"], g["w"], g["step"]
    lon = -180.0 + (np.arange(W) + 0.5) * 360.0 / W
    lat = 90.0 - (np.arange(H) + 0.5) * 180.0 / H
    fx = (lon - g["lon0"]) / s
    fy = np.clip((g["lat0"] - lat) / s, 0, h - 1)
    x0 = np.floor(fx).astype(int)
    tx = fx - x0
    if abs(w * s - 360.0) < 1e-6:            # global in longitude: wrap
        x0, x1 = x0 % w, (x0 + 1) % w
    else:
        x0, x1 = np.clip(x0, 0, w - 1), np.clip(x0 + 1, 0, w - 1)
    y0 = np.floor(fy).astype(int)
    y1 = np.minimum(y0 + 1, h - 1)
    ty = (fy - y0)[:, None]
    tx = tx[None, :]
    vals = np.asarray(values, np.float64)
    ok = np.isfinite(vals)
    z = np.where(ok, vals, 0.0)
    num = np.zeros((H, W))
    den = np.zeros((H, W))
    for yy, xx, wt in ((y0, x0, (1 - ty) * (1 - tx)), (y0, x1, (1 - ty) * tx),
                       (y1, x0, ty * (1 - tx)), (y1, x1, ty * tx)):
        okk = ok[yy[:, None], xx[None, :]]
        num += wt * okk * z[yy[:, None], xx[None, :]]
        den += wt * okk
    v = np.where(den > 0, num / np.maximum(den, 1e-12), 0.0)
    rgb = palette(v, vmax).astype(np.float64)
    alpha = np.clip((den - 0.4) / 0.2, 0, 1)[..., None]
    out = alpha * rgb + (1 - alpha) * np.array(NODATA_RGB, np.float64)
    if not rgba:
        return Image.fromarray(np.rint(out).astype(np.uint8), "RGB")
    # globe layer: opacity grows with |anomaly| (near-normal lets the Earth show), no data is a grey veil
    a = np.clip((np.abs(v) - alpha_from) / (alpha_full - alpha_from), 0, 1) ** 0.85 * alpha_max
    a = alpha[..., 0] * a + (1 - alpha[..., 0]) * nodata_alpha
    return Image.fromarray(np.dstack([np.rint(out), np.rint(a * 255)]).astype(np.uint8), "RGBA")


def colorbar(width: int = 512, height: int = 24, vmax: float = 4.0) -> Image.Image:
    """Horizontal legend: -vmax at the left edge, +vmax at the right edge."""
    v = -vmax + (np.arange(width) + 0.5) / width * 2 * vmax
    row = palette(v, vmax)
    return Image.fromarray(np.repeat(row[None], height, axis=0), "RGB")


# ---------------------------------------------------------------- layer

def _citation(data_year: int, accessed: str) -> str:
    return (f"GISTEMP Team, {data_year}: GISS Surface Temperature Analysis (GISTEMP), version 4. "
            f"NASA Goddard Institute for Space Studies. Dataset accessed {accessed} at {PAGE}. "
            "Lenssen, N., G.A. Schmidt, M. Hendrickson, P. Jacobs, M. Menne, and R. Ruedy, 2024: "
            "A GISTEMPv4 observational uncertainty ensemble. J. Geophys. Res. Atmos., 129, no. 17, "
            "e2023JD040179, doi:10.1029/2023JD040179. "
            "Lenssen, N., G. Schmidt, J. Hansen, M. Menne, A. Persin, R. Ruedy, and D. Zyss, 2019: "
            "Improvements in the GISTEMP uncertainty model. J. Geophys. Res. Atmos., 124, no. 12, "
            "6307-6326, doi:10.1029/2018JD029522.")


def _last_month(years: np.ndarray, months: np.ndarray) -> tuple[int, int]:
    i = int(np.argmax(years * 12 + months))
    return int(years[i]), int(months[i])


def build_gistemp(out_dir: Path, key: str = "tanom", cfg: dict | None = None) -> dict:
    """Write out_dir/<key>/g<YYYY>.bin + o<YYYY>.webp + colorbar.png; return the manifest layer entry."""
    c = {**DEFAULTS, **(cfg or {})}
    nc_path = Path(c["nc_file"]) if c["nc_file"] else fetch(c["url"], c["refresh"])
    csv_path = Path(c["csv_file"]) if c["csv_file"] else fetch(c["series_url"], c["refresh"])
    accessed = _mtime_utc(nc_path).strftime("%Y-%m-%d")

    nc = read_monthly(nc_path)
    monthly, g = orient(nc["data"], nc["lat"], nc["lon"])
    years, annual = annual_means(monthly, nc["years"], nc["months"], int(c["min_months"]))
    if not years:
        raise RuntimeError("no complete calendar year in the GISTEMP file")
    ly, lm = _last_month(nc["years"], nc["months"])
    m = re.search(r"Created (\d{4}-\d{2}-\d{2})", nc["history"])
    created = m.group(1) if m else None
    data_year = int(created[:4]) if created else datetime.now(timezone.utc).year
    glob = read_global_series(csv_path)

    vmin, vmax, pmax = float(c["enc_min"]), float(c["enc_max"]), float(c["palette_max"])
    layer_dir = Path(out_dir) / key
    layer_dir.mkdir(parents=True, exist_ok=True)
    steps, keep = [], {"colorbar.png"}
    clipped = 0
    for y, a in zip(years, annual):
        q = encode(a, vmin, vmax)
        assert q.shape == (g["h"], g["w"])
        clipped += int((np.isfinite(a) & ((a < vmin) | (a > vmax))).sum())
        gname, iname = f"g{y}.bin", f"o{y}.webp"
        (layer_dir / gname).write_bytes(q.tobytes())
        render(a, g, tuple(c["image_size"]), pmax, rgba=True, alpha_from=float(c["alpha_from"]), alpha_full=float(c["alpha_full"]),
               alpha_max=float(c["alpha_max"]), nodata_alpha=float(c["nodata_alpha"])).save(
            layer_dir / iname, "WEBP", quality=int(c["webp_quality"]), method=6)
        keep |= {gname, iname}
        steps.append({"t": str(y), "grid": f"{key}/{gname}", "image": f"{key}/{iname}",
                      "stats": {"validCells": int((q > 0).sum()), "nodataCells": int((q == 0).sum())}})
    colorbar(512, 24, pmax).save(layer_dir / "colorbar.png", optimize=True)
    for f in layer_dir.iterdir():   # drop step files from earlier runs (e.g. a year range that shrank)
        if re.fullmatch(r"([gio])\d{4}\.(bin|jpg|webp)", f.name) and f.name not in keep:
            f.unlink()

    cover = {y: valid_area_fraction(a, g) for y, a in zip(years, annual)}
    cov_txt = ", ".join(f"{y}: {100 * cover[y]:.0f}%" for y in (years[0], 1900, 1950, years[-1]) if y in cover)
    first, last = years[0], years[-1]
    if (ly, lm) == (last, 12):
        why_last = f"{last} is the last year in the file"
    else:
        why_last = (f"{ly} is left out because the file{f' (created {created})' if created else ''} "
                    f"only runs to {ly}-{lm:02d}; only complete calendar years are used")
    missing_series = [y for y in years if y not in glob]
    notes = (
        "Values are temperature ANOMALIES in °C relative to the 1951–1980 mean of each grid cell, "
        "not absolute temperatures (+1 means 1 °C warmer than that place's 1951–1980 average). "
        "Source grid: GISTEMP v4 (GHCN v4 land stations + ERSST v5 sea surface), 2° cells, with each "
        "station's influence spread up to 1200 km (1200 km smoothing), so cells far from stations "
        "are interpolated. "
        f"Annual value = mean of the monthly anomalies Jan–Dec; a cell needs at least {int(c['min_months'])} "
        "of 12 months, otherwise it is no data. "
        f"Years {first}–{last}: {why_last}. "
        "Early coverage is sparse: before ~1950 much of the Arctic and Antarctic, the Southern Ocean near "
        "the sea ice and parts of Africa and South America are no data, while most ice-free ocean is "
        "covered from 1880 because ERSST v5 is itself a statistical reconstruction (share of Earth's "
        f"area with data — {cov_txt}). Seasonal sea-ice areas can stay no data in recent years too. "
        f"Stored range {vmin:+g}…{vmax:+g} °C (uint8 linear); {clipped} cell-years beyond it are clipped to "
        f"the end codes. The picture palette (ColorBrewer RdBu, reversed) saturates at ±{pmax:g} °C: "
        f"anomalies beyond it are drawn in the end colour but stored up to ±{vmax:g}. "
        "Dark grey = no data. series.global is NASA's own global land–ocean annual mean "
        "(GLB.Ts+dSST.csv, J-D column), computed by GISS from the full analysis, not an average of "
        "these grids."
        + (f" Global mean missing for: {', '.join(map(str, missing_series))}." if missing_series else "")
    )
    return {
        "key": key,
        "title": "GISTEMP v4 surface temperature anomaly (vs 1951–1980)",
        "unit": "°C",
        "simulated": False,
        "encoding": {"scale": "linear", "min": _num(vmin), "max": _num(vmax)},
        "grid": g,
        "source": {
            "kind": "gistemp-netcdf", "agency": "NASA GISS", "product": "GISTEMP v4",
            "page": PAGE, "url": c["url"], "seriesUrl": c["series_url"],
            "citation": _citation(data_year, accessed),
        },
        "time": {"cadence": "P1Y", "label": "year", "timing": "annual mean of monthly anomalies, Jan–Dec"},
        "steps": steps,
        "colorbar": {"image": f"{key}/colorbar.png", "scale": "linear", "min": _num(-pmax), "max": _num(pmax)},
        "picture": {"mode": "field", "from": "drawn from the GISTEMP values (opacity grows with |anomaly|)"},
        "series": {"global": [{"t": str(y), "v": glob[y]} for y in years if y in glob]},
        "notes": notes,
    }


# ---------------------------------------------------------------- CLI

def sanity(out_dir: Path, entry: dict, years: list[str] | None = None) -> str:
    """Decode the written .bin files exactly as the app does at a few points."""
    g, enc = entry["grid"], entry["encoding"]
    ts = [s["t"] for s in entry["steps"]]
    years = [y for y in (years or ["1900", "1950", "2000", ts[-1]]) if y in ts]
    glob = {p["t"]: p["v"] for p in entry["series"]["global"]}
    grids = {y: qgrid.dequantize(np.frombuffer((Path(out_dir) / entry["key"] / f"g{y}.bin").read_bytes(),
                                               np.uint8).reshape(g["h"], g["w"]), enc["min"], enc["max"], "linear")
             for y in years}
    lines = [f"{'':26}" + "".join(f"{y:>8}" for y in years)]
    for name, (la, lo) in SANITY_POINTS.items():
        r, c = cell_of(la, lo, g)
        row = ["nodata" if np.isnan(grids[y][r, c]) else f"{grids[y][r, c]:+.2f}" for y in years]
        lines.append(f"{name:26}" + "".join(f"{x:>8}" for x in row))
    lines.append(f"{'area mean of valid cells':26}" + "".join(f"{area_mean(grids[y], g):>+8.2f}" for y in years))
    lines.append(f"{'global (GLB.Ts+dSST J-D)':26}" + "".join(
        f"{glob[y]:>+8.2f}" if y in glob else f"{'-':>8}" for y in years))
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--key", default="tanom")
    ap.add_argument("--min-months", type=int, default=DEFAULTS["min_months"])
    ap.add_argument("--refresh", action="store_true", help="re-download the GISTEMP files")
    a = ap.parse_args(argv)
    entry = build_gistemp(a.out, a.key, {"min_months": a.min_months, "refresh": a.refresh})
    files = list((a.out / a.key).iterdir())
    total = sum(f.stat().st_size for f in files)
    jpg = [f.stat().st_size for f in files if f.suffix == ".webp"]
    print(f"[{a.key}] {entry['steps'][0]['t']}–{entry['steps'][-1]['t']} ({len(entry['steps'])} years), "
          f"grid {entry['grid']}, {len(files)} files, {total / 1e6:.2f} MB, "
          f"largest image {max(jpg) / 1e3:.0f} KB", file=sys.stderr)
    print(sanity(a.out, entry), file=sys.stderr)
    print(json.dumps(entry, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
