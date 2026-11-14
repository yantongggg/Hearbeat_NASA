import json

import numpy as np
import pytest

from hearthbeat_pipeline import grid
from hearthbeat_pipeline.layers import layer_from_config, load_layers, load_sources
from hearthbeat_pipeline.probe import ids_from_text, stub_for
from hearthbeat_pipeline.validate import validate_dir


def test_sources_json_loads_and_themes_point_at_layers():
    cfg = load_sources()
    layers = cfg["layers"]
    for name, t in cfg["themes"].items():
        assert t["layer"] in layers, name
        assert layers[t["layer"]].get("enabled", True), f"theme {name} uses a disabled layer"
    eic = load_layers(cfg)
    assert {"precip", "pm25", "temp"} <= set(eic)
    assert eic["precip"].enc == ("log", 0.1, 20.0)
    assert eic["precip"].overlays and eic["precip"].overlays[0][2] == pytest.approx(0.175)


def test_disabled_layers_say_why():
    for k, c in load_sources()["layers"].items():
        if not c.get("enabled", True):
            assert c.get("disabled_reason"), k


def test_config_rejects_unknown_keys_and_bad_scale():
    base = dict(svs=1, title="t", unit="u", scale="linear", min=0, max=1, colorbar="c.png",
                frames_dir="f", cadence="hourly")
    layer_from_config("x", base)
    with pytest.raises(ValueError):
        layer_from_config("x", {**base, "colour": 1})
    with pytest.raises(ValueError):
        layer_from_config("x", {**base, "scale": "log", "min": 0})


def test_probe_extracts_svs_ids_from_pasted_text():
    text = ('See https://svs.gsfc.nasa.gov/5149 and <a href="https://svs.gsfc.nasa.gov/5151/">PM</a>, '
            'frames at https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005150/frames/ and 5149 again.')
    assert ids_from_text(text) == [5149, 5151, 5150]


def test_probe_stub_is_disabled_until_a_person_sets_the_range():
    rep = {"svs": 7, "title": "GEOS-FP Something", "frameDirs": [{"url": "https://x/frames/2048x1024/thing/",
           "width": 2048, "height": 1024, "datedNames": False}], "colorbars": [{"filename": "cb.png", "colours": 300}],
           "suggestedMaxDist": 12.0}
    s = stub_for(rep)
    assert s["enabled"] is False and s["min"] is None and s["max"] is None
    assert s["frames_dir"] == "thing" and s["overlays"] == "gmao"


def _write_layer(d, key="precip", n=3, w=360, h=180, label="datetime"):
    from PIL import Image
    (d / key).mkdir(parents=True)
    steps = []
    for i in range(n):
        (d / key / f"g{i:03d}.bin").write_bytes(np.full(w * h, 7, np.uint8).tobytes())
        Image.new("RGB", (64, 32)).save(d / key / f"i{i:03d}.jpg")
        t = f"2026-11-0{i + 1}T00:00Z" if label == "datetime" else str(1900 + i)
        steps.append({"t": t, "grid": f"{key}/g{i:03d}.bin", "image": f"{key}/i{i:03d}.jpg"})
    Image.new("RGB", (64, 8)).save(d / key / "colorbar.png")
    return {"key": key, "title": "t", "unit": "mm/h", "simulated": False,
            "encoding": {"scale": "log", "min": 0.1, "max": 20},
            "grid": {"w": w, "h": h, "lat0": 90 - 180 / h / 2, "lon0": -180 + 360 / w / 2, "step": 360 / w},
            "source": {"kind": "eic-svs-frames"}, "time": {"label": label}, "steps": steps,
            "colorbar": {"image": f"{key}/colorbar.png"}, "notes": ""}


def _manifest(d, layers):
    (d / "manifest.json").write_text(json.dumps({"version": 2, "generated": "2026-11-04T00:00:00Z",
                                                 "themes": {"rain": {"layer": "precip"}}, "layers": layers,
                                                 "errors": {}}))


def test_validate_accepts_a_good_directory(tmp_path):
    _manifest(tmp_path, {"precip": _write_layer(tmp_path)})
    r = validate_dir(tmp_path)
    assert r["ok"], r["errors"]


def test_validate_catches_wrong_grid_size_and_order(tmp_path):
    m = _write_layer(tmp_path)
    (tmp_path / "precip" / "g001.bin").write_bytes(b"\x00" * 10)
    m["steps"][2]["t"] = "2026-11-01T00:00Z"
    _manifest(tmp_path, {"precip": m})
    r = validate_dir(tmp_path)
    assert not r["ok"]
    assert any("bytes" in e for e in r["errors"])
    assert any("increasing" in e for e in r["errors"])


def test_validate_flags_simulated_and_missing_theme_layer(tmp_path):
    m = _write_layer(tmp_path, key="tanom", w=180, h=90, label="year")
    m["simulated"] = True
    _manifest(tmp_path, {"tanom": m})
    r = validate_dir(tmp_path)
    assert r["ok"]
    assert any("SIMULATED" in w for w in r["warnings"])
    assert any("theme 'rain'" in w for w in r["warnings"])


def test_grid_constants_match_contract():
    assert (grid.W, grid.H, grid.LAT0, grid.LON0, grid.STEP) == (360, 180, 89.5, -179.5, 1.0)
