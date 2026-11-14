import math

from hearthbeat_pipeline.station import check, inclination_deg, parse_oem, to_json
from datetime import datetime, timedelta, timezone

MU = 398600.4418


def oem_text(n=400, radius=6790.0, inc=51.6, frame="EME2000", step=240, first_bad=None):
    """A circular orbit in CCSDS OEM form, as NASA writes it."""
    v = math.sqrt(MU / radius)
    w = v / radius
    i = math.radians(inc)
    t0 = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)
    lines = ["CCSDS_OEM_VERS = 2.0", "CREATION_DATE  = 2026-11-12T14:08:28.056", "ORIGINATOR     = NASA/JSC/FOD/TOPO", "",
             "META_START", "OBJECT_NAME          = ISS", "OBJECT_ID            = 1998-067-A", "CENTER_NAME          = Earth",
             f"REF_FRAME            = {frame}", "TIME_SYSTEM          = UTC", "META_STOP", "",
             "COMMENT ISS first asc. node: EPOCH = 2026-11-11T12:00:00.000 $ ORBIT = 3459 $ LAN(DEG) = 49.63348"]
    for k in range(n):
        t = t0 + timedelta(seconds=k * step if first_bad is None or k < first_bad else (k - 2) * step)
        a = w * k * step
        x, y = radius * math.cos(a), radius * math.sin(a)
        vx, vy = -v * math.sin(a), v * math.cos(a)
        r = [x, y * math.cos(i), y * math.sin(i), vx, vy * math.cos(i), vy * math.sin(i)]
        lines.append(t.strftime("%Y-%m-%dT%H:%M:%S.000") + " " + " ".join(f"{c:.9f}" for c in r))
    return "\r\n".join(lines) + "\r\n"


def test_a_real_looking_orbit_passes_and_is_written_compactly():
    oem = parse_oem(oem_text())
    assert len(oem["states"]) == 400 and oem["meta"]["REF_FRAME"] == "EME2000"
    assert oem["nodes"] == [{"t": "2026-11-11T12:00:00Z", "orbit": 3459, "lonDeg": 49.63348}]
    assert check(oem) == []
    assert abs(inclination_deg(oem["states"][7]) - 51.6) < 1e-6
    j = to_json(oem, "https://example.invalid/oem.txt", datetime(2026, 11, 13, tzinfo=timezone.utc))
    assert j["t0"] == "2026-11-11T12:00:00Z" and j["s"][:3] == [0.0, 240.0, 480.0]
    assert len(j["r"]) == 400 and len(j["r"][0]) == 6
    assert j["source"]["created"] == "2026-11-12T14:08:28.056Z" and j["frame"] == "EME2000"


def test_files_that_are_not_an_iss_orbit_are_refused():
    assert any("frame" in e for e in check(parse_oem(oem_text(frame="ITRF"))))
    assert any("low Earth orbit" in e for e in check(parse_oem(oem_text(radius=7400.0))))
    assert any("inclination" in e for e in check(parse_oem(oem_text(inc=28.5))))
    assert any("time step" in e for e in check(parse_oem(oem_text(first_bad=100))))
    assert any("states" in e for e in check(parse_oem(oem_text(n=50))))
