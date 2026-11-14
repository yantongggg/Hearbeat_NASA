"""NASA EIC night lights, 2012-2023 (SVS 5313), one of the visualizations listed in the challenge.

    python -m hearthbeat_pipeline.nightlights --out ../app/public/data [--movie FILE]

SVS 5313 "Change in Night Lights between 2012 and 2023 - EIC Version" shows NASA's Black Marble
(VIIRS on Suomi NPP, NASA/NOAA) as a flat world map, one annual average per year, then the lights fade
away. Its frame folder is not public, so the frames come from NASA's movie of it
(MOVIE_URL, 7680x2160, two copies of the map side by side, the year written between them).

What this does, and the checks that stop it if the movie is not what it expects:
- finds the 12 stretches where the year label holds still (exactly 11 label changes in the first
  9 seconds) and takes the middle frame of each, in order 2012..2023 (checked by eye on 13 Nov 2026);
- finds the frame where the lights have faded out (the bare base map) and subtracts it, so what is
  left is the light itself (deserts and ice in the base map are not mistaken for lights);
- places the map: the left copy starts at longitude LON0 and runs 360 degrees; rows run 90N..90S. This
  is re-checked every build by matching the 2016 lights with NASA Black Marble 2016
  (app/public/tex/night.jpg): the best longitude must be within 0.3 degrees of LON0, with a sharp peak
  there (on 13 Nov 2026: correlation 0.43 at LON0, 0.34 at 0.2 degrees off, 0.25 at 2, 0.18 at 10);
- writes a 1-degree grid of a light index 0..100 (100 = a cell fully at the picture's brightest) and a
  2048x1024 picture of the lights for the globe.

The picture has no colour scale, so the index is relative brightness in NASA's picture, not radiance.
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MOVIE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a005300/a005313/nightlights_flat_series_and_change_wZooms_13_EIC_2160p30_h265.mp4"
PAGE = "https://svs.gsfc.nasa.gov/5313"
YEARS = list(range(2012, 2024))
W, H = 7680, 2160          # movie frame
MW = 3840                  # one copy of the map
LON0 = -168.6              # longitude of the left edge of the left copy (see check_position)
LABEL_BOX = (3740, 1040, 480, 120)   # x, y, w, h of the year label between the two copies
TEX = Path(__file__).resolve().parents[2] / "app/public/tex/night.jpg"


def _ffmpeg_raw(movie: Path, vf: str, pix: str, frames: int | None = None) -> bytes:
    cmd = ["ffmpeg", "-v", "error", "-i", str(movie), "-vf", vf]
    if frames:
        cmd += ["-frames:v", str(frames)]
    cmd += ["-vsync", "0", "-f", "rawvideo", "-pix_fmt", pix, "-"]
    return subprocess.run(cmd, capture_output=True, check=True).stdout


def find_years(movie: Path) -> tuple[list[int], int]:
    """Frame index of each year (middle of its labelled stretch) and of the bare base map."""
    x, y, w, h = LABEL_BOX
    raw = _ffmpeg_raw(movie, f"crop={w}:{h}:{x}:{y},scale={w // 2}:{h // 2}", "gray", 320)
    lab = np.frombuffer(raw, np.uint8).reshape(-1, h // 2, w // 2).astype(np.float32)
    diff = np.abs(np.diff(lab, axis=0)).mean((1, 2))
    changes = [i + 1 for i in range(min(len(diff), 270)) if diff[i] > 0.9]
    if len(changes) != len(YEARS) - 1:
        raise RuntimeError(f"expected {len(YEARS) - 1} year-label changes in the first 9 s, found {len(changes)}")
    starts = [0] + changes
    peak = lab.max((1, 2))
    fade = next((i for i in range(changes[-1] + 10, len(peak)) if peak[i] < .9 * np.median(peak[:changes[-1]])), None)
    if fade is None:
        raise RuntimeError("the year label does not fade out after the last year")
    ends = changes + [fade]   # the lights start to fade with the label
    runs = list(zip(starts, ends))
    if any(b - a < 10 for a, b in runs):
        raise RuntimeError(f"a year is shown for fewer than 10 frames: {runs}")
    mids = [(a + b) // 2 for a, b in runs]
    # the base map: the darkest frame shortly after the last year (lights faded out, change map not yet in)
    small = np.frombuffer(_ffmpeg_raw(movie, f"crop={MW}:{H}:0:0,scale=384:216", "rgb24", 320), np.uint8).reshape(-1, 216, 384, 3).astype(np.float32)
    lum = 0.3 * small[..., 0] + 0.59 * small[..., 1] + 0.11 * small[..., 2]
    lit = (lum > 45).mean((1, 2))
    lo = ends[-1]
    base = lo + int(np.argmin(lit[lo:lo + 30]))
    if lit[base] > 5e-4:
        raise RuntimeError(f"no frame without lights after the last year (darkest frame {base}: {lit[base]:.4f} lit)")
    return mids, base


def read_frames(movie: Path, idx: list[int]) -> dict[int, np.ndarray]:
    sel = "+".join(f"eq(n\\,{i})" for i in sorted(idx))
    raw = _ffmpeg_raw(movie, f"select={sel},crop={MW}:{H}:0:0", "rgb24")
    arr = np.frombuffer(raw, np.uint8).reshape(-1, H, MW, 3)
    if len(arr) != len(idx):
        raise RuntimeError(f"read {len(arr)} frames, expected {len(idx)}")
    return {i: arr[k] for k, i in enumerate(sorted(idx))}


def luminance(a: np.ndarray) -> np.ndarray:
    a = a.astype(np.float32)
    return 0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]


def to_lonlat(img: np.ndarray, lon0: float = LON0, res: float = 0.1) -> np.ndarray:
    """Resample one copy of the map (rows 90N..90S, columns from lon0 over 360 degrees) to a
    -180..180 / 90..-90 grid of `res` degrees (nearest neighbour)."""
    lat = 90 - (np.arange(round(180 / res)) + .5) * res
    lon = -180 + (np.arange(round(360 / res)) + .5) * res
    ys = np.clip(((90 - lat) / 180 * H).astype(int), 0, H - 1)
    xs = np.clip((((lon - lon0) % 360) / 360 * MW).astype(int), 0, MW - 1)
    return img[np.ix_(ys, xs)]


def check_position(light: np.ndarray, tex: Path = TEX) -> tuple[float, float, float]:
    """Best left-edge longitude, its correlation with NASA Black Marble 2016 (log brightness, 75N..60S),
    and the higher correlation 2 degrees either side of LON0 (the peak must stand out)."""
    nt = np.asarray(Image.open(tex).convert("L")).astype(np.float32)
    th, tw = nt.shape
    lat = np.arange(74.875, -60, -.25)
    lon = np.arange(-179.875, 180, .25)
    ty = ((90 - lat) / 180 * th).astype(int).clip(0, th - 1)
    tx = ((lon + 180) / 360 * tw).astype(int).clip(0, tw - 1)
    ref = np.log1p(nt[np.ix_(ty, tx)])
    ref = (ref - ref.mean()) / ref.std()
    ys = ((90 - lat) / 180 * H).astype(int)
    def corr(lon0: float) -> float:
        xs = ((((lon - lon0) % 360)) / 360 * MW).astype(int).clip(0, MW - 1)
        g = np.log1p(light[np.ix_(ys, xs)])
        g = (g - g.mean()) / (g.std() + 1e-6)
        return float((g * ref).mean())
    best = max((corr(l0), round(float(l0), 2)) for l0 in np.arange(LON0 - 3, LON0 + 3.001, .1))
    return best[0], best[1], max(corr(LON0 - 2), corr(LON0 + 2))


def colorbar(width: int = 512, height: int = 24) -> Image.Image:
    t = np.linspace(0, 1, width)
    rgb = np.stack([t ** .6 * 255, t ** .75 * 236, t ** 1.4 * 190], 1)
    return Image.fromarray(np.repeat(rgb[None].astype(np.uint8), height, 0), "RGB")


def build_lights(out_dir: Path, key: str = "lights", movie: Path | None = None) -> dict:
    """Write out_dir/<key>/g<YYYY>.bin + o<YYYY>.webp + colorbar.png and return the manifest layer entry."""
    if movie is None:
        from .svs import cached
        movie = cached(MOVIE_URL, "movies")
    mids, base = find_years(movie)
    frames = read_frames(movie, mids + [base])
    bg = luminance(frames[base])
    lights = {y: np.clip(luminance(frames[m]) - bg, 0, 255) for y, m in zip(YEARS, mids)}
    r, best, side = check_position(lights[2016])
    if abs(best - LON0) > .3 or r < .3 or r - side < .1:
        raise RuntimeError(f"map position check failed: best left edge {best} (expected {LON0}), r = {r:.2f}, 2 degrees off {side:.2f}")

    layer_dir = Path(out_dir) / key
    layer_dir.mkdir(parents=True, exist_ok=True)
    steps, grids, totals = [], {}, {}
    for y, m in zip(YEARS, mids):
        L = to_lonlat(lights[y])                                   # 1800 x 3600, 0.1 degree
        idx = L.reshape(180, 10, 360, 10).mean((1, 3)) / 255 * 100  # 1-degree light index 0..100
        q = (1 + np.round(np.clip(idx, 0, 100) / 100 * 254)).astype(np.uint8)   # 0 is never used: dark is data
        (layer_dir / f"g{y}.bin").write_bytes(q.tobytes())
        # the globe picture: warm light whose opacity is the light (the values are in the grid, not here)
        a = np.clip(L / 255 * 2.5, 0, 1)
        warm = np.array([255, 226, 168], np.float32)
        img = np.dstack([np.broadcast_to(warm, L.shape + (3,)), a[..., None] * 255]).astype(np.uint8)
        Image.fromarray(img, "RGBA").resize((2048, 1024), Image.BILINEAR).save(layer_dir / f"o{y}.webp", "WEBP", quality=82, method=6)
        steps.append({"t": str(y), "grid": f"{key}/g{y}.bin", "image": f"{key}/o{y}.webp", "stats": {"frame": int(m), "validCells": int(q.size)}})
        grids[y], totals[y] = q, float(idx.mean())
    colorbar().save(layer_dir / "colorbar.png", optimize=True)
    rise = 100 * (totals[2023] / totals[2012] - 1)
    notes = (
        "Light at night from NASA's Black Marble annual composites (VIIRS on Suomi NPP, NASA/NOAA), read from the EIC "
        "visualization SVS 5313, 2012-2023. The picture has no colour scale, so each value is a relative light index "
        "0-100 (100 = a 1-degree cell fully at the picture's brightest), not radiance; compare places and years, not units. "
        "The frames come from NASA's movie of the visualization (its frame folder is not public): for each year, the "
        f"middle frame of the stretch labelled with that year (frames {', '.join(map(str, mids))}); the base map without "
        f"lights (frame {base}) is subtracted. Map position checked against NASA Black Marble 2016: correlation {r:.2f} at the "
        f"calibrated position, {side:.2f} two degrees off. "
        f"Summed over the globe, the index is {rise:+.0f}% in 2023 against 2012."
    )
    return {
        "key": key,
        "title": "Black Marble night lights (EIC, annual)",
        "unit": "index",
        "simulated": False,
        "encoding": {"scale": "linear", "min": 0, "max": 100},
        "grid": {"w": 360, "h": 180, "lat0": 89.5, "lon0": -179.5, "step": 1.0},
        "source": {
            "kind": "eic-svs-movie", "agency": "NASA/NOAA", "product": "Black Marble (VIIRS, Suomi NPP)", "svs": 5313,
            "page": PAGE, "url": MOVIE_URL,
            "citation": "NASA Scientific Visualization Studio, Earth Information Center visualization 5313: Change in Night "
                        "Lights between 2012 and 2023 - EIC Version (visualizer Kel Elkins, USRA; scientists Zhuosen Wang, "
                        "Miguel Román, Ranjay Shrestha, Srija Chakraborty, Virginia Kalb). Data: Black Marble: Next "
                        "Generation, NASA/NOAA Suomi NPP VIIRS. https://svs.gsfc.nasa.gov/5313",
        },
        "time": {"cadence": "P1Y", "label": "year", "timing": "annual average of night lights, one frame per year in NASA's visualization"},
        "steps": steps,
        "colorbar": {"image": f"{key}/colorbar.png", "scale": "linear", "min": 0, "max": 100},
        "picture": {"mode": "lights", "from": "NASA EIC frame (from NASA's movie of SVS 5313)"},
        "check": {"positionR": round(r, 3), "positionR2DegOff": round(side, 3), "leftEdgeLon": best, "baseFrame": int(base)},
        "notes": notes,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "app/public/data")
    ap.add_argument("--movie", type=Path, help="use this copy of NASA's movie instead of downloading it")
    a = ap.parse_args(argv)
    entry = build_lights(a.out, "lights", a.movie)
    # write the pack and record the layer in the manifest, as the full build does
    from .build import write_pack
    write_pack(a.out, entry)
    mp = a.out / "manifest.json"
    m = json.loads(mp.read_text())
    m["layers"]["lights"] = entry
    m.setdefault("themes", {})["lights"] = {"layer": "lights"}
    m.get("errors", {}).pop("lights", None)
    mp.write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: entry[k] for k in ("key", "title", "check")}, indent=1, ensure_ascii=False))
    print(entry["notes"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
