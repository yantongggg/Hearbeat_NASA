"""Build app/public/data (data contract v2, docs/DATA.md) from NASA sources.

    python -m hearthbeat_pipeline.build --out ../app/public/data

Layers and themes come from pipeline/sources.json. Each EIC layer becomes a
sequence of playback steps (default: every 6 h over 5 days); each step has the
NASA frame shown on the globe and the value grid recovered from it. The GISTEMP
layer becomes one step per year. The result is validated before it replaces the
previous data, and a layer that fails keeps its previous good data (with its
real times) instead of disappearing or being invented.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import traceback
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from . import grid, svs
from .colorbar import ColorLUT, augment, extract_strip, invert
from .layers import Layer, load_layers, load_sources

# GEOS animation frames are hourly and anchored in UTC: the last frame is 20:00 UTC on
# the calendar day (UTC) of the frame files' Last-Modified header (files are rendered
# ~07:30 UTC), and frame i is (n-1-i) hours earlier. The burned-in date labels are US
# Eastern local time, so they read 16:00 EDT before the DST change and 15:00 EST after it.
# Checked by reading the labels on 2026-11-06 (SVS 5149 and 5151, Last-Modified 2026-11-04):
#   00000372.png "04 Nov 2026 15:00:00 EST" = 2026-11-04 20:00 UTC
#   00000001.png "20 Oct 2026 05:00:00 EDT" = 2026-10-20 09:00 UTC (371 h earlier)
# An earlier version anchored the last frame to 16:00 *local*, which put every frame one
# hour late once DST ended on 2026-11-01. tests/test_timing.py pins both labels.
LAST_FRAME_UTC_HOUR = 20
TARGET_HOUR_UTC = 12
MAX_STEP_OFFSET_H = 0.5   # a playback step must have a frame within this many hours

SANITY_POINTS = {
    "Kuala Lumpur": (3.14, 101.69),
    "Sahara": (23.0, 12.0),
    "Arctic": (84.0, 20.0),
    "Jakarta": (-6.2, 106.85),
}


def last_frame_utc(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, LAST_FRAME_UTC_HOUR, tzinfo=timezone.utc)


@dataclass
class Frame:
    url: str
    time: datetime
    # when SVS rendered this frame set (Last-Modified). SVS reuses the same file names every day,
    # so downloads are cached per render: a new day's 00000372.png never reuses yesterday's file.
    rendered: str = ""


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def discover(layer: Layer) -> tuple[list[Frame], str, str]:
    """Return (frames with timestamps, colorbar URL, timing method)."""
    pj = svs.page(layer.svs)
    dirs = [d for d in svs.frame_dirs(pj) if layer.frames_dir in d["url"]]
    if not dirs:
        raise RuntimeError(f"no Frames entry matching {layer.frames_dir!r} on SVS {layer.svs}")
    urls = svs.list_frames(dirs[0]["url"])
    cb_url = svs.find_media(pj, layer.colorbar)
    if layer.cadence == "daily":
        import re
        frames = []
        for u in urls:
            m = re.search(r"(20\d{2})(\d{2})(\d{2})", u.rsplit("/", 1)[-1])
            if m:
                frames.append(Frame(u, datetime(int(m[1]), int(m[2]), int(m[3]), 12, tzinfo=timezone.utc)))
        return frames, cb_url, "date in file name (daily composite)"
    lm = svs.head_last_modified(urls[-1])
    if lm is None:
        upd = pj.get("update_date") or pj.get("release_date")
        lm = datetime.fromisoformat(upd).astimezone(timezone.utc)
        how = "page update_date"
    else:
        how = "Last-Modified of the last frame"
    last = last_frame_utc(lm.date())
    n = len(urls)
    stamp = lm.strftime("%Y%m%dT%H%M")
    frames = [Frame(u, last - timedelta(hours=n - 1 - i), stamp) for i, u in enumerate(urls)]
    return frames, cb_url, (f"hourly frames; last frame = {last:%Y-%m-%d %H:%M} UTC (20:00 UTC on the day of the "
                            f"{how}, {lm:%Y-%m-%d %H:%M}Z), one hour earlier per frame; checked against the "
                            f"burned-in US Eastern date labels")


def pick(frames: list[Frame], target) -> Frame:
    """Frame nearest a target datetime (or 12:00 UTC on a target date)."""
    if isinstance(target, date) and not isinstance(target, datetime):
        target = datetime(target.year, target.month, target.day, TARGET_HOUR_UTC, tzinfo=timezone.utc)
    return min(frames, key=lambda f: abs((f.time - target).total_seconds()))


def step_times(newest: datetime, days: int, step_hours: int) -> list[datetime]:
    """Playback times ending at `newest` rounded down to a multiple of step_hours (UTC)."""
    end = newest.replace(minute=0, second=0, microsecond=0)
    end -= timedelta(hours=end.hour % step_hours)
    n = days * 24 // step_hours
    return [end - timedelta(hours=step_hours * (n - 1 - i)) for i in range(n)]


def build_lut(layer: Layer, cb_path: Path) -> ColorLUT:
    lut = extract_strip(cb_path)
    if layer.drop_grey_lut:
        keep = np.ptp(lut.colors, axis=1) >= 15
        lut = ColorLUT(lut.colors[keep], lut.positions[keep])
    for b in layer.blends:
        lut = augment(lut, b.toward, b.t_max, b.p_max, b.steps)
    return lut


def overlay_mask(layer: Layer, h: int, w: int) -> np.ndarray:
    m = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in layer.overlays:
        m[int(y0 * h):int(np.ceil(y1 * h)), int(x0 * w):int(np.ceil(x1 * w))] = True
    return m


def decode(layer: Layer, lut: ColorLUT, rgb: np.ndarray) -> tuple[np.ndarray, dict]:
    """RGB frame -> (180, 360) float grid of physical values (NaN = no data)."""
    rgb = rgb[..., :3]
    h, w = rgb.shape[:2]
    pos, _ = invert(rgb, lut, layer.max_dist)
    chroma = np.ptp(rgb.astype(np.int16), axis=2)
    matched = ~np.isnan(pos)
    if layer.min_chroma:
        matched &= chroma >= layer.min_chroma
    vals = np.full((h, w), np.nan, np.float64)
    vals[matched] = layer.pos_to_value(pos[matched])
    if layer.grey_value is not None:
        vals[chroma <= 12] = layer.grey_value
    if layer.unmatched_value is not None:
        vals[np.isnan(vals)] = layer.unmatched_value
    if layer.white_invalid:
        vals[rgb.min(axis=2) >= 235] = np.nan
    for c in layer.exclude_colors:
        vals[np.abs(rgb.astype(np.int16) - np.array(c, np.int16)).max(axis=2) <= 6] = np.nan
    ov = overlay_mask(layer, h, w)
    vals[ov] = np.nan
    g = grid.downsample(vals, layer.agg)
    under = overlay_cells(ov)
    g[under] = np.nan                 # under the logo / date label nothing was measured
    empty = np.isnan(g)
    if layer.fill == "all":
        g = grid.fill_holes(g, empty & ~under)
    # Cells hidden by the logo or date label stay "no data": the accuracy test showed that
    # filling them from neighbours is badly wrong there (West Antarctica 5–6 °C too warm).
    g[under] = np.nan
    stats = {"matchedFraction": round(float(matched[~ov].mean()), 3),
             "filledCells": int((empty & ~under & ~np.isnan(g)).sum()),
             "overlayCells": int(under.sum())}
    return g, stats


def overlay_cells(ov: np.ndarray) -> np.ndarray:
    """Grid cells at least half covered by overlay pixels."""
    return grid.downsample(ov.astype(np.float64), "mean") >= 0.5


GRID_BLOCK = {"w": grid.W, "h": grid.H, "lat0": grid.LAT0, "lon0": grid.LON0, "step": grid.STEP}


def build_eic_layer(layer: Layer, found: tuple[list[Frame], str, str], times: list[datetime],
                    out: Path, playback: dict) -> dict:
    """Write g###.bin / o###.webp / colorbar.png for one EIC layer; return its manifest entry."""
    from . import pictures
    frames, cb_url, timing = found
    cb_path = svs.cached(cb_url, "colorbars")
    lut = build_lut(layer, cb_path)
    d = out / layer.key
    d.mkdir(parents=True, exist_ok=True)
    # the colour strip alone (no tick labels), left = colorbar min, right = max
    strip = extract_strip(cb_path).colors.astype(np.uint8)[None, :, :]
    Image.fromarray(strip, "RGB").resize((512, 16), Image.NEAREST).save(d / "colorbar.png")
    width = int(playback.get("imageWidth", 2048))
    quality = int(playback.get("webpQuality", 70))
    alpha_q = int(playback.get("webpAlphaQuality", 50))
    pic = {"mode": "field", **(layer.picture or {})}
    if pic["mode"] not in pictures.MODES:
        raise ValueError(f"{layer.key}: unknown picture mode {pic['mode']!r}")
    sc, mn, mx = layer.enc
    picked = []
    for t in times:
        f = pick(frames, t)
        off = abs((f.time - t).total_seconds()) / 3600
        if off > MAX_STEP_OFFSET_H:
            raise RuntimeError(f"no frame within {MAX_STEP_OFFSET_H} h of {iso(t)} (nearest {iso(f.time)})")
        picked.append((f, svs.cached(f.url, f"frames/{layer.key}/{f.rendered or 'undated'}")))
    background = None
    if pic["mode"] == "rain-clouds":
        background = pictures.estimate_background(
            [np.asarray(Image.open(p).convert("RGB")) for _, p in picked])
    steps = []
    for i, (f, path) in enumerate(picked):
        rgb = np.asarray(Image.open(path).convert("RGB"))
        if layer.values:
            # numbers from NASA's model output at the same instant; the picture stays the EIC frame's
            from .raw import raw_grid
            g, used = raw_grid(layer.values, f.time)
            st = {"valuesFrom": used, "validCells": int(np.isfinite(g).sum())}
        else:
            g, st = decode(layer, lut, rgb)
        q = grid.quantize(g, mn, mx, sc)
        assert q.shape == (grid.H, grid.W)
        (d / f"g{i:03d}.bin").write_bytes(q.tobytes())
        step = {"t": iso(f.time), "grid": f"{layer.key}/g{i:03d}.bin"}
        if pic["mode"] != "none":
            h, w = rgb.shape[:2]
            hidden = overlay_mask(layer, h, w)
            pos, _ = invert(rgb, lut, layer.max_dist)
            if layer.min_chroma:
                pos[np.ptp(rgb.astype(np.int16), axis=2) < layer.min_chroma] = np.nan
            if pic["mode"] == "rain-clouds":
                rgba = pictures.rain_clouds(rgb, pos, background, hidden, float(pic.get("rain_alpha", 0.95)),
                                            float(pic.get("rain_alpha_min", 0.6)), float(pic.get("rain_full_pos", 0.25)))
            else:
                rgba = pictures.field(rgb, pos, hidden, float(pic.get("alpha_from", 0.1)), float(pic.get("alpha_to", 0.7)),
                                      float(pic.get("alpha_max", 0.85)))
            pictures.save(rgba, d / f"o{i:03d}.webp", width, quality, alpha_q)
            step["image"] = f"{layer.key}/o{i:03d}.webp"
        st["nodataCells"] = int((q == 0).sum())
        step.update({"frame": f.url, "stats": st})
        steps.append(step)
    return {
        "key": layer.key, "title": layer.title, "unit": layer.unit, "simulated": False,
        "encoding": {"scale": sc, "min": mn, "max": mx},
        "grid": dict(GRID_BLOCK),
        "source": {"kind": "eic-svs-frames", "agency": layer.agency, "product": layer.product,
                   "page": f"https://svs.gsfc.nasa.gov/{layer.svs}", "svs": layer.svs,
                   "values": ({"from": "nasa-model-output", "variable": layer.values["variable"],
                               "datasets": layer.values["datasets"], "label": layer.values.get("label", "")}
                              if layer.values else {"from": "picture-colorbar"}),
                   "citation": f"NASA Scientific Visualization Studio, Earth Information Center daily visualization "
                               f"{layer.svs}: {layer.title}. https://svs.gsfc.nasa.gov/{layer.svs}"},
        "time": {"cadence": f"PT{playback.get('stepHours', 6)}H", "label": "datetime", "timing": timing},
        "steps": steps,
        "colorbar": {"image": f"{layer.key}/colorbar.png", "scale": layer.scale, "min": layer.min,
                     "max": layer.max, "source": cb_url},
        # logo / date-label boxes burned into the frames (fractions of the image), so the app can hide them
        "overlays": [list(r) for r in layer.overlays],
        # what the globe shows: the data layer lifted off NASA's frame (see pictures.py), or nothing
        "picture": {"mode": pic["mode"], "from": "NASA EIC frame" if pic["mode"] != "none" else None},
        "notes": layer.notes,
    }


def _carry_over(key: str, prev: dict | None, prev_dir: Path, out: Path, reason: str, errors: dict,
                expect_values: str | None = None) -> dict | None:
    """Keep the previous run's data for a layer that failed now (its times stay the real ones) —
    but only if it was made the same way as this run would make it."""
    if not prev or key not in prev.get("layers", {}) or not (prev_dir / key).is_dir():
        errors[key] = reason
        return None
    made = (prev["layers"][key].get("source", {}).get("values") or {}).get("from", "picture-colorbar")
    if expect_values and made != expect_values:
        errors[key] = f"{reason} — previous data not reused: it was made from {made}, this layer now uses {expect_values}"
        return None
    shutil.copytree(prev_dir / key, out / key, dirs_exist_ok=True)
    errors[key] = f"{reason} — kept the previous run's data from {prev.get('generated', '?')}"
    entry = dict(prev["layers"][key])
    entry["stale"] = True
    return entry


def _method(layer: Layer) -> str:
    return "nasa-model-output" if layer.values else "picture-colorbar"


def run(out: Path, days: int | None = None, step_hours: int | None = None, only: list[str] | None = None,
        sources: Path | None = None) -> int:
    cfg = load_sources(sources) if sources else load_sources()
    layers = load_layers(cfg)
    playback = dict(cfg.get("playback", {}))
    if days:
        playback["days"] = days
    if step_hours:
        playback["stepHours"] = step_hours
    out = out.resolve()
    prev_path = out / "manifest.json"
    prev = json.loads(prev_path.read_text()) if prev_path.exists() else None
    stage = out.parent / (out.name + ".staging")
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)

    wanted = [k for k, c in cfg["layers"].items() if c.get("enabled", True) and (not only or k in only)]
    errors: dict[str, str] = {}
    manifest_layers: dict[str, dict] = {}

    # ---- EIC layers: discover, then a common playback window ----
    found: dict[str, tuple[list[Frame], str, str]] = {}
    for k in wanted:
        if k not in layers:
            continue
        try:
            found[k] = discover(layers[k])
            print(f"[{k}] {len(found[k][0])} frames; {found[k][2]}")
        except Exception as e:  # noqa: BLE001 - keep going with other layers
            traceback.print_exc()
            entry = _carry_over(k, prev, out, stage, f"discover failed: {e}", errors, _method(layers[k]))
            if entry:
                manifest_layers[k] = entry
    if found:
        newest = min(max(f.time for f in fr) for fr, _, _ in found.values())
        times = step_times(newest, int(playback.get("days", 5)), int(playback.get("stepHours", 6)))
        print("playback steps:", iso(times[0]), "…", iso(times[-1]), f"({len(times)} steps)")
        for k in found:
            try:
                manifest_layers[k] = build_eic_layer(layers[k], found[k], times, stage, playback)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                shutil.rmtree(stage / k, ignore_errors=True)
                entry = _carry_over(k, prev, out, stage, f"processing failed: {e}", errors, _method(layers[k]))
                if entry:
                    manifest_layers[k] = entry

    # ---- other adapters ----
    for k in wanted:
        c = cfg["layers"][k]
        if c.get("adapter") == "gistemp":
            try:
                from .climate import build_gistemp
                manifest_layers[k] = build_gistemp(stage, k, c)
                print(f"[{k}] GISTEMP {manifest_layers[k]['steps'][0]['t']}…{manifest_layers[k]['steps'][-1]['t']}")
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                shutil.rmtree(stage / k, ignore_errors=True)
                entry = _carry_over(k, prev, out, stage, f"GISTEMP failed: {e}", errors)
                if entry:
                    manifest_layers[k] = entry
        elif c.get("adapter") == "svs-movie-lights":
            try:
                from .nightlights import build_lights
                manifest_layers[k] = build_lights(stage, k)
                print(f"[{k}] night lights {manifest_layers[k]['steps'][0]['t']}…{manifest_layers[k]['steps'][-1]['t']}")
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                shutil.rmtree(stage / k, ignore_errors=True)
                entry = _carry_over(k, prev, out, stage, f"night lights failed: {e}", errors)
                if entry:
                    manifest_layers[k] = entry
        elif c.get("adapter") == "svs-movie-lightning":
            # a finished visualization (2017-2023) that never changes: reuse the published layer when it was
            # made by this version of the code from the same movie, instead of fetching 350 MB every day
            from .lightning import METHOD, MOVIE_URL, build_lightning
            pl = (prev or {}).get("layers", {}).get(k)
            if (pl and not pl.get("stale") and (out / k).is_dir() and pl.get("source", {}).get("url") == MOVIE_URL
                    and pl.get("check", {}).get("method") == METHOD):
                shutil.copytree(out / k, stage / k, dirs_exist_ok=True)
                manifest_layers[k] = dict(pl)
                print(f"[{k}] lightning unchanged (reused, method {METHOD})")
                continue
            try:
                manifest_layers[k] = build_lightning(stage, k)
                print(f"[{k}] lightning {manifest_layers[k]['steps'][0]['t']}…{manifest_layers[k]['steps'][-1]['t']}")
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                shutil.rmtree(stage / k, ignore_errors=True)
                entry = _carry_over(k, prev, out, stage, f"lightning failed: {e}", errors)
                if entry:
                    manifest_layers[k] = entry
        elif c.get("adapter") not in ("eic-svs", "gistemp"):
            errors[k] = f"unknown adapter {c.get('adapter')!r}"
    for k, c in cfg["layers"].items():
        if not c.get("enabled", True):
            print(f"[{k}] disabled: {c.get('disabled_reason', '')}")

    # a partial build (--layers) keeps every other layer from the previous run unchanged
    if only and prev:
        for k, m in prev.get("layers", {}).items():
            if k not in manifest_layers and k not in only and (out / k).is_dir():
                shutil.copytree(out / k, stage / k, dirs_exist_ok=True)
                manifest_layers[k] = m
        for k, e in prev.get("errors", {}).items():
            if k not in only and k not in errors:
                errors[k] = e

    for k, m in manifest_layers.items():
        write_pack(stage, m)

    # ---- where the International Space Station is (NASA's predicted trajectory; see station.py) ----
    try:
        from .station import build_station
        station = build_station(stage)
        print(f"[station] {station['states']} states, {station['start']} … {station['stop']}")
    except Exception as e:  # noqa: BLE001 - the tracks do not depend on it
        traceback.print_exc()
        if (out / "station.json").is_file():
            shutil.copyfile(out / "station.json", stage / "station.json")
            station = {"file": "station.json", "carriedOver": True, "reason": str(e)[:300]}
        else:
            station = {"error": str(e)[:300]}

    manifest = {
        "version": 2,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "themes": cfg.get("themes", {}),
        "layers": manifest_layers,
        "errors": errors,
        "station": station,
    }
    (stage / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    if (out / "accuracy.json").exists():
        shutil.copyfile(out / "accuracy.json", stage / "accuracy.json")

    from .validate import validate_dir
    report = validate_dir(stage)
    (stage / "validation.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    print_summary(manifest, stage)
    print(f"\nvalidation: {'OK' if report['ok'] else 'FAILED'} "
          f"({len(report['errors'])} errors, {len(report['warnings'])} warnings)")
    for e in report["errors"]:
        print("  ERROR", e)
    for w in report["warnings"]:
        print("  warn ", w)
    if not report["ok"]:
        print(f"\nNot replacing {out}: the new data failed validation. Staging left at {stage}.")
        return 2
    # swap in: keep non-data files (none expected) out of the way
    if out.exists():
        shutil.rmtree(out)
    stage.rename(out)
    print(f"\nwrote {out}")
    return 0 if manifest_layers else 1


def write_pack(d: Path, m: dict) -> None:
    """All of a layer's step grids in one JSON file (base64 per step): one request instead of one per step,
    and served by any static host (some do not serve .bin)."""
    import base64
    steps = [base64.b64encode((d / s["grid"]).read_bytes()).decode("ascii") for s in m["steps"]]
    rel = f"{m['key']}/grids.json"
    (d / rel).write_text(json.dumps({"w": m["grid"]["w"], "h": m["grid"]["h"], "encoding": "base64-uint8", "steps": steps},
                                    separators=(",", ":")))
    m["pack"] = rel


def print_summary(manifest: dict, d: Path) -> None:
    print("\nlayer    steps  first .. last                          unit    status")
    for k, m in manifest["layers"].items():
        st = m["steps"]
        print(f"{k:8} {len(st):5}  {st[0]['t']:>17} .. {st[-1]['t']:<17}  {m['unit'] or '-':7} "
              f"{'stale' if m.get('stale') else 'ok'}")
    for k, e in manifest["errors"].items():
        print(f"{k:8} error: {e}")
    rows = []
    for k, m in manifest["layers"].items():
        if m["grid"]["step"] != 1:
            continue
        q = np.frombuffer((d / m["steps"][-1]["grid"]).read_bytes(), np.uint8).reshape(m["grid"]["h"], m["grid"]["w"])
        rows.append((k, q, m["encoding"]))
    if rows:
        print("\nsanity check, newest step (decoded exactly as the app does):")
        print(f"{'':14}" + "".join(f"{k:>10}" for k, _, _ in rows))
        for name, (la, lo) in SANITY_POINTS.items():
            r, c = grid.latlon_to_cell(la, lo)
            vals = []
            for _, q, e in rows:
                v = grid.dequantize(q[r, c][None], e["min"], e["max"], e["scale"])[0]
                vals.append("nodata" if np.isnan(v) else f"{v:.3g}")
            print(f"{name:14}" + "".join(f"{x:>10}" for x in vals))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "app/public/data")
    ap.add_argument("--days", type=int, help="playback length (default from sources.json)")
    ap.add_argument("--step-hours", type=int, help="hours between playback steps (default from sources.json)")
    ap.add_argument("--layers", nargs="*", help="only these layer keys")
    ap.add_argument("--sources", type=Path, help="alternative sources.json")
    a = ap.parse_args(argv)
    return run(a.out, a.days, a.step_hours, a.layers, a.sources)


if __name__ == "__main__":
    sys.exit(main())
