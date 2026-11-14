"""Where the International Space Station is: NASA's predicted ISS trajectory (CCSDS OEM).

    python -m hearthbeat_pipeline.station --out ../app/public/data [--file ISS.OEM_J2K_EPH.txt]

NASA's Johnson Space Center (Flight Operations Directorate, Trajectory Operations and Planning)
publishes the station's predicted state vectors for about 15 days ahead, every 4 minutes, in the
EME2000 (J2000) inertial frame, as the "ISS Trajectory Data" file. This module downloads it, checks it
(frame, units, time order, altitude, speed and inclination of a real ISS orbit) and writes
<out>/station.json, which the app interpolates and turns into a place on Earth (app/src/data/station.ts).
Nothing here is invented: if the file cannot be read or fails a check, no station.json is written and
the app says the station's position is unavailable.

The same conversion, checked against the file itself: at each ascending-node epoch that NASA lists in
the file's comments, the app's latitude is 0.00 degrees and its longitude matches NASA's to 0.0001 degrees.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

OEM_URL = "https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt"
CACHE = Path(__file__).resolve().parent.parent / "cache" / "station"

_ROW = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)Z?\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$")
_KV = re.compile(r"^([A-Z_]+)\s*=\s*(.*?)\s*$")
_NODE = re.compile(r"asc\.\s*node\s*:?\s*EPOCH\s*=\s*(\S+)\s*\$\s*ORBIT\s*=\s*(\d+)\s*\$\s*LAN\(DEG\)\s*=\s*(-?[\d.]+)", re.I)


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s.rstrip("Z")).replace(tzinfo=timezone.utc)


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%S") + (f".{t.microsecond // 1000:03d}" if t.microsecond else "") + "Z"


def parse_oem(text: str) -> dict:
    """CCSDS OEM text -> {meta: {...}, nodes: [...], times: [datetime], states: [[x, y, z, vx, vy, vz]]} (km, km/s)."""
    meta: dict[str, str] = {}
    nodes, times, states = [], [], []
    for raw in text.replace("\r", "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("COMMENT"):
            m = _NODE.search(line)
            if m:
                nodes.append({"t": _iso(_utc(m.group(1))), "orbit": int(m.group(2)), "lonDeg": float(m.group(3))})
            continue
        m = _ROW.match(line)
        if m:
            times.append(_utc(m.group(1)))
            states.append([float(m.group(i)) for i in range(2, 8)])
            continue
        m = _KV.match(line)
        if m and m.group(1) not in meta:
            meta[m.group(1)] = m.group(2)
    return {"meta": meta, "nodes": nodes, "times": times, "states": states}


def inclination_deg(s: list[float]) -> float:
    x, y, z, vx, vy, vz = s
    hx, hy, hz = y * vz - z * vy, z * vx - x * vz, x * vy - y * vx
    return math.degrees(math.acos(hz / math.sqrt(hx * hx + hy * hy + hz * hz)))


def check(oem: dict) -> list[str]:
    """Reasons the file is not a usable ISS trajectory (empty list = usable)."""
    meta, times, states = oem["meta"], oem["times"], oem["states"]
    errs = []
    if meta.get("REF_FRAME", "").upper() != "EME2000":
        errs.append(f"frame is {meta.get('REF_FRAME')!r}, expected EME2000")
    if meta.get("CENTER_NAME", "").lower() != "earth":
        errs.append(f"centre is {meta.get('CENTER_NAME')!r}, expected Earth")
    if meta.get("TIME_SYSTEM", "").upper() != "UTC":
        errs.append(f"time system is {meta.get('TIME_SYSTEM')!r}, expected UTC")
    if len(states) < 360:
        errs.append(f"only {len(states)} states (expected about 5400 for 15 days)")
        return errs
    for a, b in zip(times, times[1:]):
        dt = (b - a).total_seconds()
        if not 0 < dt <= 600:
            errs.append(f"time step {dt:.0f} s at {_iso(a)} (must be increasing and at most 10 minutes)")
            break
    for t, s in zip(times, states):
        r, v = math.sqrt(sum(c * c for c in s[:3])), math.sqrt(sum(c * c for c in s[3:]))
        # km and km/s: a station 330-480 km above a 6371 km Earth, moving at 7.5-7.8 km/s
        if not 6650 <= r <= 6900 or not 7.4 <= v <= 7.9:
            errs.append(f"state at {_iso(t)} is not a low Earth orbit (|r| {r:.0f} km, |v| {v:.2f} km/s)")
            break
    inc = [inclination_deg(s) for s in states[:: max(1, len(states) // 50)]]
    if not all(51.0 <= i <= 52.2 for i in inc):
        errs.append(f"inclination {min(inc):.2f}-{max(inc):.2f} deg, expected the ISS's 51.6")
    return errs


def to_json(oem: dict, source_url: str, downloaded: datetime) -> dict:
    """The app's station.json: times as seconds after t0, positions rounded to 1 m and velocities to 1 mm/s."""
    meta, times, states = oem["meta"], oem["times"], oem["states"]
    t0 = times[0]
    return {
        "object": meta.get("OBJECT_NAME", "ISS"),
        "objectId": meta.get("OBJECT_ID", ""),
        "source": {
            "name": "NASA Johnson Space Center, Flight Operations Directorate (TOPO): ISS predicted trajectory (CCSDS OEM)",
            "originator": meta.get("ORIGINATOR", ""),
            "created": _iso(_utc(meta["CREATION_DATE"])) if meta.get("CREATION_DATE") else None,
            "url": source_url,
            "downloaded": _iso(downloaded.replace(microsecond=0)),
        },
        "frame": "EME2000",
        "timeSystem": "UTC",
        "units": {"position": "km", "velocity": "km/s"},
        "start": _iso(times[0]),
        "stop": _iso(times[-1]),
        "ascendingNodes": oem["nodes"],
        "notes": "Predicted by NASA; NASA publishes a new file when the station manoeuvres. The app interpolates between "
                 "states (cubic Hermite) and converts EME2000 to latitude and longitude (IAU 1976 precession, GMST; "
                 "nutation ignored, under 0.01 degrees).",
        "t0": _iso(t0),
        "s": [round((t - t0).total_seconds(), 3) for t in times],
        "r": [[round(c, 3) for c in s[:3]] + [round(c, 6) for c in s[3:]] for s in states],
    }


def validate_station(d: Path, generated: datetime | None = None) -> tuple[list[str], list[str]]:
    """Checks for <d>/station.json (absent is a warning, not an error: the app then says it is unavailable)."""
    p = Path(d) / "station.json"
    if not p.is_file():
        return [], ["station.json missing: the station's position is unavailable this build"]
    try:
        j = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        return [f"station.json is not JSON ({e})"], []
    errs, warns = [], []
    s, r = j.get("s", []), j.get("r", [])
    if len(s) != len(r) or len(r) < 360:
        errs.append(f"station.json: {len(s)} times for {len(r)} states")
        return errs, warns
    if any(not 0 < b - a <= 600 for a, b in zip(s, s[1:])):
        errs.append("station.json: times not increasing in steps of at most 10 minutes")
    oem = {"meta": {"REF_FRAME": j.get("frame"), "CENTER_NAME": "Earth", "TIME_SYSTEM": j.get("timeSystem")},
           "times": [_utc(j["t0"])] * len(r), "states": r}
    errs += [e for e in check(oem) if "time step" not in e]
    stop = _utc(j["stop"])
    now = generated or datetime.now(timezone.utc)
    if stop < now:
        warns.append(f"station.json ends {j['stop']}, before this build: the app will say the position is unavailable")
    return errs, warns


def fetch(url: str = OEM_URL) -> tuple[str, datetime]:
    from .svs import fetch_bytes
    data = fetch_bytes(url)
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / url.rsplit("/", 1)[-1]).write_bytes(data)
    return data.decode("ascii", errors="replace"), datetime.now(timezone.utc)


def build_station(out_dir: Path, text: str | None = None, downloaded: datetime | None = None, url: str = OEM_URL) -> dict:
    """Write <out_dir>/station.json from NASA's file (downloaded unless text is given). Raises if the file fails a check."""
    if text is None:
        text, downloaded = fetch(url)
    oem = parse_oem(text)
    errs = check(oem)
    if errs:
        raise ValueError("NASA ISS trajectory failed checks: " + "; ".join(errs))
    j = to_json(oem, url, downloaded or datetime.now(timezone.utc))
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    (Path(out_dir) / "station.json").write_text(json.dumps(j, separators=(",", ":")) + "\n")
    return {"file": "station.json", "start": j["start"], "stop": j["stop"], "created": j["source"]["created"],
            "states": len(j["r"]), "source": j["source"]["url"]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "app/public/data")
    ap.add_argument("--file", type=Path, help="use this OEM file instead of downloading it")
    a = ap.parse_args(argv)
    text = a.file.read_text(errors="replace") if a.file else None
    downloaded = datetime.fromtimestamp(a.file.stat().st_mtime, tz=timezone.utc) if a.file else None
    try:
        entry = build_station(a.out, text, downloaded)
    except Exception as e:  # noqa: BLE001
        print(f"station: {e}", file=sys.stderr)
        return 2
    print(json.dumps(entry, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
