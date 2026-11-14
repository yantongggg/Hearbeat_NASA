"""Check a data directory against the v2 contract (docs/DATA.md).

    python -m hearthbeat_pipeline.validate ../app/public/data [--max-age-days 4]

Errors make the data unusable (the build refuses to publish it); warnings are
things a reader should know (stale layer, unusually empty grid, old frames).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ISO_DT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$")
YEAR = re.compile(r"^\d{4}$")
MONTH = re.compile(r"^(0[1-9]|1[0-2])$")
REQUIRED = ("key", "title", "unit", "simulated", "encoding", "grid", "source", "time", "steps", "colorbar", "notes")


def _parse_t(t: str, label: str) -> datetime:
    if label == "month":   # a calendar month averaged over several years (lightning): "01".."12"
        if not MONTH.match(t):
            raise ValueError(f"step time {t!r} is not a month 01..12")
        return datetime(2000, int(t), 15, tzinfo=timezone.utc)
    if label == "year":
        if not YEAR.match(t):
            raise ValueError(f"step time {t!r} is not a year")
        return datetime(int(t), 7, 1, tzinfo=timezone.utc)
    if not ISO_DT.match(t):
        raise ValueError(f"step time {t!r} is not YYYY-MM-DDTHH:MMZ")
    return datetime.strptime(t, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)


def validate_layer(d: Path, key: str, m: dict, generated: datetime, max_age_days: float) -> tuple[list, list, dict]:
    errs, warns = [], []
    summary: dict = {"steps": len(m.get("steps", []))}
    for f in REQUIRED:
        if f not in m:
            errs.append(f"{key}: missing field {f!r}")
    if errs:
        return errs, warns, summary
    if m["key"] != key:
        errs.append(f"{key}: key field is {m['key']!r}")
    enc = m["encoding"]
    if enc.get("scale") not in ("linear", "log"):
        errs.append(f"{key}: encoding.scale must be linear|log")
    if not (enc.get("min", 0) < enc.get("max", 0)):
        errs.append(f"{key}: encoding min must be < max")
    if enc.get("scale") == "log" and enc.get("min", 0) <= 0:
        errs.append(f"{key}: log encoding needs min > 0")
    g = m["grid"]
    try:
        w, h, step = int(g["w"]), int(g["h"]), float(g["step"])
        if abs(w * step - 360) > 1e-6 or abs(h * step - 180) > 1e-6:
            errs.append(f"{key}: grid {w}x{h} at {step}° does not cover the globe")
        if abs(g["lat0"] - (90 - step / 2)) > 1e-6 or abs(g["lon0"] - (-180 + step / 2)) > 1e-6:
            errs.append(f"{key}: grid lat0/lon0 must be the north-west cell centre")
    except (KeyError, TypeError, ValueError) as e:
        errs.append(f"{key}: bad grid block ({e})")
        return errs, warns, summary
    label = m["time"].get("label")
    if label not in ("datetime", "year", "month"):
        errs.append(f"{key}: time.label must be datetime|year|month")
        return errs, warns, summary
    steps = m["steps"]
    if not steps:
        errs.append(f"{key}: no steps")
        return errs, warns, summary
    times = []
    nodata_frac = []
    for i, s in enumerate(steps):
        try:
            times.append(_parse_t(s["t"], label))
        except (KeyError, ValueError) as e:
            errs.append(f"{key}: step {i}: {e}")
            continue
        gp, ip = d / s.get("grid", ""), d / s.get("image", "")
        if not gp.is_file():
            errs.append(f"{key}: step {i}: grid file {s.get('grid')!r} missing")
        else:
            b = gp.read_bytes()
            if len(b) != w * h:
                errs.append(f"{key}: step {i}: grid has {len(b)} bytes, expected {w * h}")
            else:
                q = np.frombuffer(b, np.uint8)
                nodata_frac.append(float((q == 0).mean()))
        if "image" not in s:
            if (m.get("picture") or {}).get("mode") != "none":
                errs.append(f"{key}: step {i}: no image")
        elif not ip.is_file():
            errs.append(f"{key}: step {i}: image {s.get('image')!r} missing")
        elif i in (0, len(steps) - 1):
            try:
                with Image.open(ip) as im:
                    iw, ih = im.size
                if iw != 2 * ih:
                    errs.append(f"{key}: step {i}: image is {iw}x{ih}, not 2:1")
            except Exception as e:  # noqa: BLE001
                errs.append(f"{key}: step {i}: unreadable image ({e})")
    if times and any(b <= a for a, b in zip(times, times[1:])):
        errs.append(f"{key}: step times are not strictly increasing")
    if m.get("pack"):
        try:
            import base64
            pk = json.loads((d / m["pack"]).read_text())
            if len(pk.get("steps", [])) != len(steps):
                errs.append(f"{key}: pack has {len(pk.get('steps', []))} steps, manifest has {len(steps)}")
            for i, b64 in enumerate(pk.get("steps", [])):
                raw = base64.b64decode(b64)
                gp = d / steps[i].get("grid", "")
                if len(raw) != w * h or (gp.is_file() and raw != gp.read_bytes()):
                    errs.append(f"{key}: pack step {i} does not match its grid file")
                    break
        except (OSError, ValueError) as e:
            errs.append(f"{key}: unreadable pack {m['pack']!r} ({e})")
    cb = d / m["colorbar"].get("image", "")
    if not cb.is_file():
        errs.append(f"{key}: colorbar image missing")
    if m["simulated"]:
        warns.append(f"{key}: SIMULATED data (test fixture), not NASA output")
    if m.get("stale"):
        warns.append(f"{key}: stale — carried over from an earlier run")
    if nodata_frac:
        summary["nodataFraction"] = {"min": round(min(nodata_frac), 3), "max": round(max(nodata_frac), 3)}
        if max(nodata_frac) > 0.95:
            warns.append(f"{key}: a grid is >95% no-data")
    if times:
        summary["first"], summary["last"] = steps[0]["t"], steps[-1]["t"]
        if label == "datetime":
            age = generated - times[-1]
            summary["newestAgeHours"] = round(age.total_seconds() / 3600, 1)
            if age > timedelta(days=max_age_days):
                warns.append(f"{key}: newest step is {age.days} days older than the build")
            if times[-1] > generated + timedelta(days=2):
                errs.append(f"{key}: newest step is in the future ({steps[-1]['t']})")
    return errs, warns, summary


def validate_dir(d: Path, max_age_days: float = 4.0) -> dict:
    d = Path(d)
    errs, warns = [], []
    layers_summary = {}
    mp = d / "manifest.json"
    if not mp.is_file():
        return {"ok": False, "errors": ["manifest.json missing"], "warnings": [], "layers": {}}
    try:
        m = json.loads(mp.read_text())
    except json.JSONDecodeError as e:
        return {"ok": False, "errors": [f"manifest.json is not JSON ({e})"], "warnings": [], "layers": {}}
    if m.get("version") != 2:
        errs.append("manifest version must be 2")
    try:
        generated = datetime.strptime(m["generated"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (KeyError, ValueError):
        errs.append("generated must be YYYY-MM-DDTHH:MM:SSZ")
        generated = datetime.now(timezone.utc)
    for k, lm in m.get("layers", {}).items():
        e, w, s = validate_layer(d, k, lm, generated, max_age_days)
        errs += e
        warns += w
        layers_summary[k] = s
    for theme, t in m.get("themes", {}).items():
        if t.get("layer") not in m.get("layers", {}):
            warns.append(f"theme {theme!r}: its layer {t.get('layer')!r} is unavailable this run")
        elif (m["layers"][t["layer"]].get("picture") or {}).get("mode") == "none":
            errs.append(f"theme {theme!r}: its layer {t['layer']!r} has no globe picture")
    for k, e in m.get("errors", {}).items():
        warns.append(f"{k}: {e}")
    if not m.get("layers"):
        errs.append("no layers at all")
    from .station import validate_station
    e, w = validate_station(d, generated)
    errs += e
    warns += w
    return {"ok": not errs, "checked": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "errors": errs, "warnings": warns, "layers": layers_summary}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data", type=Path, nargs="?", default=Path(__file__).resolve().parents[2] / "app/public/data")
    ap.add_argument("--max-age-days", type=float, default=4.0)
    ap.add_argument("--write", action="store_true", help="also write validation.json into the data directory")
    a = ap.parse_args(argv)
    r = validate_dir(a.data, a.max_age_days)
    if a.write:
        (a.data / "validation.json").write_text(json.dumps(r, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(r, indent=1, ensure_ascii=False))
    return 0 if r["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
