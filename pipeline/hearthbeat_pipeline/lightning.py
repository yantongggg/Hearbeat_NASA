"""Lightning seen from the International Space Station, 2017-2023 (SVS 5011), one of the visualizations
listed in the challenge.

    python -m hearthbeat_pipeline.lightning --out ../app/public/data [--movie FILE --labels FILE]

SVS 5011 "Lightning Events Detected from the International Space Station (ISS) 2017-2023" draws every
lightning event that the Lightning Imaging Sensor (LIS) on the ISS saw, as yellow marks on a grey Earth,
over a roving window of 10 days. NASA's Science On a Sphere copy (MOVIE_URL) is a plain world map,
4096 x 2048, longitude -180..180 from left to right and latitude 90N..90S from top to bottom, with a
date for every frame in LABELS_URL.

What this does, and the checks that stop it if the movie is not what it expects:
- reads the date of every frame. NASA's label file writes the year 2023 as "2003" (those labels come
  straight after 31 Dec 2022); only that case is corrected, and the dates must then never go back;
- takes one frame every 10 days, so each lightning mark is counted once (the windows do not overlap);
- measures how much of each 1-degree cell is covered with yellow marks (the grey map has no yellow);
- averages the 10-day windows labelled in each calendar month over 2017-2023: twelve maps, January to
  December, the season of storms through a year;
- checks: the map lines up with NASA Blue Marble (app/public/tex/day.jpg), the first frame (before any
  lightning is drawn) has no marks, almost nothing lies beyond 58 degrees of latitude (the ISS cannot see
  there), and the storms follow the summer (northern mid-latitudes in July, southern ones in January).

The value is the share of the cell covered with lightning marks in NASA's picture (0-100 %), a relative
measure: LIS sees each place for only about 90 seconds per pass, and the marks have a drawn size.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

PAGE = "https://svs.gsfc.nasa.gov/5011"
BASE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a005000/a005011/"
MOVIE_URL = BASE_URL + "iss_lightning_sos_yearly_07312023_2048p60.mp4"
LABELS_URL = BASE_URL + "labels.txt"
W, H = 4096, 2048
WINDOW_DAYS = 10
METHOD = 1                  # bump when the way values are made changes (a static source is otherwise reused)
TEX = Path(__file__).resolve().parents[2] / "app/public/tex/day.jpg"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def parse_labels(text: str) -> list[datetime]:
    """Frame dates (UTC). NASA's file writes 2023 as "2003" after 31 Dec 2022; that, and only that, is fixed."""
    out: list[datetime] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        d = datetime.strptime(line, "%d %b %Y %H:%M").replace(tzinfo=timezone.utc)
        if d.year == 2003 and out and out[-1].year >= 2022:
            d = d.replace(year=2023)
        if out and d < out[-1]:
            raise RuntimeError(f"frame dates go back at frame {len(out)}: {out[-1]:%Y-%m-%d %H:%M} then {line}")
        out.append(d)
    if not out:
        raise RuntimeError("no frame dates")
    return out


def pick_frames(dates: list[datetime], days: int = WINDOW_DAYS) -> list[int]:
    """One frame every `days` days, starting once the first window is full, so the windows do not overlap."""
    picks, nxt = [], dates[0] + timedelta(days=days)
    for i, d in enumerate(dates):
        if d >= nxt:
            picks.append(i)
            nxt = d + timedelta(days=days)
    return picks


def lightning_amount(rgb: np.ndarray) -> np.ndarray:
    """0..1 per pixel: how yellow it is. The grey map has none (min(R,G) - B stays under 6 there)."""
    a = rgb.astype(np.int16)
    y = np.minimum(a[..., 0], a[..., 1]) - a[..., 2]
    return np.clip((y - 12) / 150, 0, 1).astype(np.float32)


def box(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """Area-average resize of a float image."""
    return np.asarray(Image.fromarray(img.astype(np.float32), "F").resize((w, h), Image.BOX))


def cells(amount: np.ndarray) -> np.ndarray:
    """1-degree cells (180 x 360, rows 90N..90S, columns 180W..180E): mean coverage 0..1."""
    return box(amount, 3600, 1800).reshape(180, 10, 360, 10).mean((1, 3))


FPS = 60
BATCH = 80                  # ffmpeg refuses a frame-select expression much longer than about 100 terms


def read_frames(movie: Path, idx: list[int]):
    """Yield (frame index, rgb) for the chosen frames, in order. Frames are picked by their number, in batches;
    each batch decodes from the start and stops just after its last frame."""
    idx = sorted(idx)
    size = W * H * 3
    for b in range(0, len(idx), BATCH):
        part = idx[b:b + BATCH]
        sel = "+".join(f"eq(n\\,{i})" for i in part)
        cmd = ["ffmpeg", "-v", "error", "-i", str(movie), "-t", f"{(part[-1] + 2) / FPS:.4f}", "-vf", f"select={sel}",
               "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
        try:
            for i in part:
                buf = p.stdout.read(size)
                if len(buf) != size:
                    raise RuntimeError(f"movie ended before frame {i}")
                yield i, np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        finally:
            p.stdout.close()
            p.wait()


def movie_size(movie: Path) -> tuple[int, int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                          "stream=width,height,nb_read_packets", "-of", "csv=p=0", str(movie)],
                         capture_output=True, text=True, check=True).stdout.strip().split(",")
    return int(out[0]), int(out[1]), int(out[2])


def _edges(a: np.ndarray) -> np.ndarray:
    g = np.abs(np.diff(a, axis=1, append=a[:, :1])) + np.abs(np.diff(a, axis=0, append=a[-1:]))
    g = np.log1p(g)
    return (g - g.mean()) / (g.std() + 1e-6)


def check_position(base_rgb: np.ndarray, tex: Path = TEX) -> tuple[float, float, float]:
    """Line the grey map up with NASA Blue Marble by their edges (coasts, mountains), 60N..56S at 0.1 degree:
    best longitude shift of the map's left edge from -180, its correlation, and the correlation 2 degrees off.
    On 14 Nov 2026: 0.45 at no shift, 0.38 two degrees off, 0.35 three degrees off."""
    lum = base_rgb.astype(np.float32).mean(-1)
    day = np.asarray(Image.open(tex).convert("L")).astype(np.float32)
    lat = np.arange(59.95, -56, -.1)
    lon = np.arange(-179.95, 180, .1)
    dy = ((90 - lat) / 180 * day.shape[0]).astype(int).clip(0, day.shape[0] - 1)
    dx = ((lon + 180) / 360 * day.shape[1]).astype(int).clip(0, day.shape[1] - 1)
    ref = _edges(day[np.ix_(dy, dx)])
    ys = ((90 - lat) / 180 * H).astype(int)

    def corr(shift: float) -> float:
        xs = ((((lon - (-180 + shift)) % 360)) / 360 * W).astype(int).clip(0, W - 1)
        return float((_edges(lum[np.ix_(ys, xs)]) * ref).mean())

    best = max((corr(s), round(float(s), 2)) for s in np.arange(-3, 3.001, .1))
    return best[0], best[1], max(corr(-2), corr(2))


def colorbar(width: int = 512, height: int = 24) -> Image.Image:
    t = np.linspace(0, 1, width)
    rgb = np.stack([40 + t ** .7 * 215, 40 + t ** .8 * 184, 40 + t * 10], 1)
    return Image.fromarray(np.repeat(rgb[None].clip(0, 255).astype(np.uint8), height, 0), "RGB")


def season_ratio(grids: dict[int, np.ndarray], lat_a: float, lat_b: float, summer: list[int], winter: list[int]) -> float:
    rows = slice(int(90 - lat_b), int(90 - lat_a))
    s = sum(grids[m][rows].sum() for m in summer)
    w = sum(grids[m][rows].sum() for m in winter)
    return float(s / max(w, 1e-9))


def build_lightning(out_dir: Path, key: str = "lightning", movie: Path | None = None, labels: Path | None = None) -> dict:
    """Write out_dir/<key>/g01..g12.bin + o01..o12.webp + colorbar.png and return the manifest layer entry."""
    from .svs import cached
    if movie is None:
        movie = cached(MOVIE_URL, "movies")
    if labels is None:
        labels = cached(LABELS_URL, "movies")
    w, h, n = movie_size(movie)
    if (w, h) != (W, H):
        raise RuntimeError(f"movie is {w}x{h}, expected {W}x{H}")
    dates = parse_labels(Path(labels).read_text())
    if abs(len(dates) - n) > 2:
        raise RuntimeError(f"{len(dates)} dates for {n} frames")
    picks = pick_frames(dates[:n])
    if len(picks) < 150:
        raise RuntimeError(f"only {len(picks)} ten-day windows")

    sums = {m: np.zeros((180, 360), np.float64) for m in range(1, 13)}
    pics = {m: np.zeros((1024, 2048), np.float64) for m in range(1, 13)}
    count = {m: 0 for m in range(1, 13)}
    years: dict[int, set[int]] = {m: set() for m in range(1, 13)}
    base_rgb, base_amount = None, None
    for i, rgb in read_frames(movie, [0] + picks):
        a = lightning_amount(rgb)
        if i == 0:
            base_rgb, base_amount = rgb.copy(), float(a.mean())
            continue
        m = dates[i].month
        sums[m] += cells(a)
        pics[m] += box(a, 2048, 1024)
        count[m] += 1
        years[m].add(dates[i].year)
    if base_amount is None or base_amount > 1e-5:
        raise RuntimeError(f"the first frame already has lightning marks ({base_amount})")
    if min(count.values()) < 6:
        raise RuntimeError(f"too few windows in some month: {count}")
    r, shift, side = check_position(base_rgb)
    if abs(shift) > .3 or r < .3 or r - side < .05:
        raise RuntimeError(f"map position check failed: best shift {shift} degrees, r = {r:.2f}, 2 degrees off {side:.2f}")
    grids = {m: sums[m] / count[m] for m in sums}             # mean coverage 0..1 per cell
    total = sum(g.sum() for g in grids.values())
    polar = sum(g[:32].sum() + g[148:].sum() for g in grids.values())   # beyond 58N / 58S
    if polar / total > .005:
        raise RuntimeError(f"{100 * polar / total:.2f}% of the marks lie beyond 58 degrees, where the ISS cannot see")
    north = season_ratio(grids, 30, 50, [6, 7, 8], [12, 1, 2])
    south = season_ratio(grids, -40, -20, [12, 1, 2], [6, 7, 8])
    if north < 2 or south < 2:
        raise RuntimeError(f"storms do not follow the summer: north {north:.1f}x, south {south:.1f}x")

    layer_dir = Path(out_dir) / key
    layer_dir.mkdir(parents=True, exist_ok=True)
    steps = []
    vmax = max(float(g.max()) for g in grids.values())
    for m in range(1, 13):
        pct = grids[m] * 100
        # log scale 0.01..100 %: code 1 means none seen (or at most 0.01 %); 0 is never used, no lightning is data
        q = (1 + np.round((np.log10(np.clip(pct, .01, 100)) + 2) / 4 * 254)).astype(np.uint8)
        (layer_dir / f"g{m:02d}.bin").write_bytes(q.tobytes())
        a = np.clip(np.sqrt(pics[m] / count[m] / max(vmax, 1e-6)) * 1.15, 0, 1)
        col = np.array([255, 222, 92], np.float32)
        img = np.dstack([np.broadcast_to(col, a.shape + (3,)), a[..., None] * 255]).astype(np.uint8)
        Image.fromarray(img, "RGBA").save(layer_dir / f"o{m:02d}.webp", "WEBP", quality=82, method=6)
        steps.append({"t": f"{m:02d}", "grid": f"{key}/g{m:02d}.bin", "image": f"{key}/o{m:02d}.webp",
                      "stats": {"windows": count[m], "firstYear": min(years[m]), "lastYear": max(years[m]),
                                "maxPct": round(float(pct.max()), 2)}})
    colorbar().save(layer_dir / "colorbar.png", optimize=True)
    d0, d1 = dates[picks[0]], dates[picks[-1]]
    notes = (
        "Lightning seen by the Lightning Imaging Sensor (LIS) on the International Space Station, read from the EIC "
        "visualization SVS 5011 (NASA's Science On a Sphere copy of it, a plain world map with a date for every frame). "
        f"One frame every 10 days ({len(picks)} non-overlapping 10-day windows, labelled {d0:%d %b %Y} to {d1:%d %b %Y}); "
        "for each calendar month, the windows labelled in that month are averaged over the years. Each value is the "
        "share (0-100 %) of a 1-degree cell covered with NASA's lightning marks: a relative measure, since LIS sees each "
        "place for about 90 seconds per pass and the marks have a drawn size. NASA's label file writes 2023 as 2003; "
        "those labels come after 31 Dec 2022 and are read as 2023. "
        f"Checks: map position against NASA Blue Marble, correlation {r:.2f} (2 degrees off {side:.2f}); "
        f"{100 * polar / total:.2f}% of marks beyond 58 degrees; 30-50N has {north:.0f}x more in June-August than "
        f"December-February, 20-40S {south:.0f}x more in December-February than June-August."
    )
    return {
        "key": key,
        "title": "Lightning seen from the ISS (LIS, monthly, 2017-2023)",
        "unit": "%",
        "simulated": False,
        "encoding": {"scale": "log", "min": 0.01, "max": 100},
        "grid": {"w": 360, "h": 180, "lat0": 89.5, "lon0": -179.5, "step": 1.0},
        "source": {
            "kind": "eic-svs-movie", "agency": "NASA", "product": "ISS LIS lightning", "svs": 5011,
            "page": PAGE, "url": MOVIE_URL,
            "citation": "NASA Scientific Visualization Studio, visualization 5011: Lightning Events Detected from the "
                        "International Space Station (ISS) 2017-2023 (visualizers Michala Garrison, SSAI; Greg Shirah, "
                        "NASA/GSFC; Kel Elkins, USRA; Alex Kekesi, GST). Data: Blakeslee, R. J. 2020, Quality Controlled "
                        "Lightning Imaging Sensor (LIS) on International Space Station (ISS) Science Data, NASA Global "
                        "Hydrometeorology Resource Center DAAC. https://svs.gsfc.nasa.gov/5011",
        },
        "time": {"cadence": "P1M", "label": "month",
                 "timing": f"each calendar month averaged over {d0.year}-{d1.year}, from 10-day windows of lightning seen by LIS on the ISS"},
        "steps": steps,
        "colorbar": {"image": f"{key}/colorbar.png", "scale": "log", "min": 0.01, "max": 100},
        "picture": {"mode": "lightning", "from": "NASA visualization frames (Science On a Sphere copy of SVS 5011)"},
        "check": {"method": METHOD, "positionR": round(r, 3), "positionR2DegOff": round(side, 3), "shiftDeg": shift,
                  "windows": len(picks), "polarPct": round(100 * polar / total, 3),
                  "northSummerRatio": round(north, 1), "southSummerRatio": round(south, 1)},
        "notes": notes,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "app/public/data")
    ap.add_argument("--movie", type=Path, help="use this copy of NASA's movie instead of downloading it")
    ap.add_argument("--labels", type=Path, help="use this copy of NASA's labels.txt")
    a = ap.parse_args(argv)
    entry = build_lightning(a.out, "lightning", a.movie, a.labels)
    from .build import write_pack
    write_pack(a.out, entry)
    mp = a.out / "manifest.json"
    m = json.loads(mp.read_text())
    m["layers"]["lightning"] = entry
    m.setdefault("themes", {})["lightning"] = {"layer": "lightning"}
    m.get("errors", {}).pop("lightning", None)
    mp.write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: entry[k] for k in ("key", "title", "check")}, indent=1, ensure_ascii=False))
    print(entry["notes"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
