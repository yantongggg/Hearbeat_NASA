"""Inspect NASA SVS visualization pages and draft sources.json entries for them.

    python -m hearthbeat_pipeline.probe 5149 5150
    python -m hearthbeat_pipeline.probe --from-text resources.txt --out probe.json --stubs stubs.json

`--from-text` pulls every SVS page id out of any pasted text or saved HTML (for
example the challenge's Resources tab). For each page the probe lists its frame
folders and colorbar images, checks that the colorbar strip can be read, measures
how many frame pixels match the colorbar at several colour distances, and writes
a draft layer entry. Drafts are `"enabled": false` with `min`/`max` set to null:
those two numbers must be read off the colorbar labels by a person before the
layer is switched on, because guessing them would put wrong values in front of
students. Everything else the probe can fill in.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from . import svs
from .colorbar import extract_strip, invert

ID_PATTERNS = [
    re.compile(r"svs\.gsfc\.nasa\.gov/(?:api/)?(\d{4,6})(?:[/?#\s\"'<]|$)"),
    re.compile(r"svs\.gsfc\.nasa\.gov/vis/a0\d{5}/a0\d{5}/a0*(\d{4,6})/"),
]
CB_NAME = re.compile(r"colou?r[ _-]?bar|legend|colou?r[ _-]?scale|key", re.I)


def ids_from_text(text: str) -> list[int]:
    found: list[int] = []
    for p in ID_PATTERNS:
        for m in p.finditer(text):
            i = int(m.group(1))
            if i not in found:
                found.append(i)
    return found


def _image_items(pj: dict) -> list[dict]:
    return [i for i in svs.media_items(pj) if re.search(r"\.(png|jpg|jpeg|tif)$", i["url"], re.I)]


def probe_page(svs_id: int, sample_frames: bool = True) -> dict:
    pj = svs.page(svs_id)
    rep: dict = {"svs": svs_id, "page": f"https://svs.gsfc.nasa.gov/{svs_id}", "title": pj.get("title", ""),
                 "updated": pj.get("update_date") or pj.get("release_date"),
                 "description": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", pj.get("description", "")))[:400],
                 "frameDirs": [], "colorbars": [], "problems": []}
    for d in svs.frame_dirs(pj):
        entry = {"url": d["url"], "width": d.get("width"), "height": d.get("height")}
        try:
            urls = svs.list_frames(d["url"])
            entry.update(count=len(urls), first=urls[0].rsplit("/", 1)[-1], last=urls[-1].rsplit("/", 1)[-1])
            lm = svs.head_last_modified(urls[-1])
            entry["lastModified"] = lm.strftime("%Y-%m-%dT%H:%MZ") if lm else None
            entry["datedNames"] = bool(re.search(r"20\d{6}", entry["last"]))
            entry["_last"] = urls[-1]
        except Exception as e:  # noqa: BLE001
            entry["error"] = str(e)
        rep["frameDirs"].append(entry)
    for it in _image_items(pj):
        name = it["url"].rsplit("/", 1)[-1]
        if not CB_NAME.search(name):
            continue
        cb = {"filename": name, "url": it["url"]}
        try:
            lut = extract_strip(svs.cached(it["url"], "colorbars"))
            cb["colours"] = int(len(lut.colors))
        except Exception as e:  # noqa: BLE001
            cb["error"] = f"strip not found: {e}"
        rep["colorbars"].append(cb)
    movies = [i["url"] for i in svs.media_items(pj) if i.get("media_type") == "Movie"]
    rep["movies"] = movies[:6]
    if not rep["frameDirs"]:
        rep["problems"].append("no Frames folder: this page has no image sequence to play"
                               + (f" (only {len(movies)} movie file(s); frames would have to be extracted with ffmpeg, "
                                  "which the pipeline does not do yet)" if movies else ""))
    if not any("colours" in c for c in rep["colorbars"]):
        rep["problems"].append("no readable colorbar: values cannot be recovered (images could still be shown)")
    # match quality of the best frame dir / colorbar pair
    usable = [d for d in rep["frameDirs"] if "_last" in d]
    if sample_frames and usable and any("colours" in c for c in rep["colorbars"]):
        d = max(usable, key=lambda x: (x.get("width") or 0) * (x.get("height") or 0))
        cb = next(c for c in rep["colorbars"] if "colours" in c)
        lut = extract_strip(svs.cached(cb["url"], "colorbars"))
        img = Image.open(svs.cached(d["_last"], f"frames/probe{svs_id}")).convert("RGB")
        rgb = np.asarray(img)
        h, w = rgb.shape[:2]
        core = rgb[int(h * .1):int(h * .88), int(w * .02):int(w * .98)]
        sub = core[::4, ::4]
        match = {}
        for dist in (6, 12, 20, 30):
            pos, _ = invert(sub, lut, dist)
            match[str(dist)] = round(float((~np.isnan(pos)).mean()), 3)
        rep["match"] = {"frameSize": [w, h], "fractionWithinRGBDistance": match, "frameDir": d["url"],
                        "colorbar": cb["filename"]}
        if w != 2 * h:
            rep["problems"].append(f"frames are {w}x{h}, not 2:1 equirectangular — needs reprojection")
        best = next((int(k) for k, v in match.items() if v >= 0.5), 30)
        rep["suggestedMaxDist"] = float(best)
    for d in rep["frameDirs"]:
        d.pop("_last", None)
    return rep


def stub_for(rep: dict) -> dict:
    """Draft sources.json entry. Disabled until a person fills in min/max/scale/unit."""
    fd = max(rep["frameDirs"], key=lambda x: (x.get("width") or 0) * (x.get("height") or 0), default={})
    cb = next((c for c in rep["colorbars"] if "colours" in c), {})
    tail = (fd.get("url") or "").rstrip("/").rsplit("/", 1)[-1]
    return {
        "adapter": "eic-svs", "enabled": False,
        "disabled_reason": "draft from probe.py: read min, max, scale and unit off the colorbar labels, then enable",
        "svs": rep["svs"], "title": rep["title"], "agency": "NASA", "product": "",
        "unit": None, "scale": None, "min": None, "max": None,
        "colorbar": cb.get("filename"), "frames_dir": tail,
        "cadence": "daily" if fd.get("datedNames") else "hourly",
        "max_dist": rep.get("suggestedMaxDist", 12.0),
        "overlays": "gmao" if "GMAO" in rep["title"] or "GEOS" in rep["title"] else [],
        "notes": "",
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*", help="SVS page ids or URLs")
    ap.add_argument("--from-text", type=Path, help="file with pasted text/HTML to pull SVS ids from")
    ap.add_argument("--out", type=Path, help="write the full report as JSON")
    ap.add_argument("--stubs", type=Path, help="write draft sources.json layer entries as JSON")
    ap.add_argument("--no-frames", action="store_true", help="skip downloading a sample frame")
    a = ap.parse_args(argv)
    ids: list[int] = []
    for s in a.ids:
        ids += ids_from_text(s) if not s.isdigit() else [int(s)]
    if a.from_text:
        ids += [i for i in ids_from_text(a.from_text.read_text(errors="replace")) if i not in ids]
    if not ids:
        ap.error("no SVS ids given")
    reports, stubs = [], {}
    for i in ids:
        try:
            r = probe_page(i, not a.no_frames)
        except Exception as e:  # noqa: BLE001
            r = {"svs": i, "error": str(e)}
        reports.append(r)
        if "error" not in r:
            stubs[f"svs{i}"] = stub_for(r)
        print(f"\n== SVS {i}: {r.get('title', r.get('error'))}")
        for d in r.get("frameDirs", []):
            print(f"   frames  {d.get('count', '?'):>4} × {d.get('width')}x{d.get('height')}  {d['url']}")
        for c in r.get("colorbars", []):
            print(f"   colorbar {c['filename']}: {c.get('colours', c.get('error'))}")
        if "match" in r:
            print(f"   pixels matching the colorbar by RGB distance: {r['match']['fractionWithinRGBDistance']}")
        for p in r.get("problems", []):
            print(f"   ! {p}")
    if a.out:
        a.out.write_text(json.dumps(reports, indent=1, ensure_ascii=False) + "\n")
    if a.stubs:
        a.stubs.write_text(json.dumps(stubs, indent=1, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
