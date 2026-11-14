from datetime import datetime, timezone

import numpy as np
import pytest

from hearthbeat_pipeline import build, grid, raw
from hearthbeat_pipeline.layers import load_layers


def test_bracket_hourly_means():
    t = datetime(2026, 11, 4, 6, tzinfo=timezone.utc)
    assert raw.times_for({"time": "bracket-hourly-means"}, t) == [
        datetime(2026, 11, 4, 5, 30, tzinfo=timezone.utc), datetime(2026, 11, 4, 6, 30, tzinfo=timezone.utc)]
    assert raw.times_for({}, t) == [t]


def test_stride_hits_one_degree_cell_centres():
    lats = -90 + 0.25 * np.arange(raw.LAT_IDX[0], raw.LAT_IDX[2] + 1, raw.LAT_IDX[1])
    lons = -180 + 0.25 * np.arange(raw.LON_IDX[0], raw.LON_IDX[2] + 1, raw.LON_IDX[1])
    assert len(lats) == grid.H and len(lons) == grid.W
    assert lats[0] == -89.5 and lats[-1] == 89.5 and lons[0] == -179.5 and lons[-1] == 179.5


class _Axis:
    def __init__(self, ok): self.ok = ok
    def covers(self, t): return t in self.ok


class _DS:
    """Stand-in for opendap.Dataset serving a field that increases northward (south→north rows, as served)."""
    def __init__(self, ok, value): self.axis = _Axis(ok); self.value = value
    def field(self, var, t, lat, lon):
        la = np.arange(-89.5, 90, 1.0); lo = np.arange(-179.5, 180, 1.0)
        v = np.repeat(la[:, None], len(lo), 1) + self.value
        return type("F", (), {"values": v, "lat": la, "lon": lo})()


def test_raw_grid_flips_to_north_first_and_switches_to_the_forecast(monkeypatch):
    t = datetime(2026, 11, 4, 9, tzinfo=timezone.utc)
    early, late = raw.times_for({"time": "bracket-hourly-means"}, t)
    dss = {"ana": _DS({early}, 0.0), "fcst": _DS({late}, 10.0)}
    monkeypatch.setattr(raw, "_ds", lambda url, lev: dss[url])
    g, used = raw.raw_grid({"variable": "x", "datasets": ["ana", "fcst"], "time": "bracket-hourly-means"}, t)
    assert used == ["ana", "fcst"]
    assert g.shape == (grid.H, grid.W)
    assert g[0, 0] == pytest.approx(89.5 + 5)       # row 0 is the north; mean of analysis (+0) and forecast (+10)
    assert g[-1, 0] == pytest.approx(-89.5 + 5)


def test_raw_grid_fails_loudly_when_no_dataset_covers_the_time(monkeypatch):
    monkeypatch.setattr(raw, "_ds", lambda url, lev: _DS(set(), 0))
    with pytest.raises(RuntimeError, match="no dataset covers"):
        raw.raw_grid({"variable": "x", "datasets": ["a"]}, datetime(2026, 11, 4, tzinfo=timezone.utc))


def test_cells_under_the_logo_and_date_label_are_no_data():
    layer = load_layers()["temp"]
    h, w = 1024, 2048
    ov = build.overlay_mask(layer, h, w)
    cells = build.overlay_cells(ov)
    # date label box: x 0..25 %, y 90..100 % → West Antarctica, 90°W..180°W, south of 72°S
    r, c = grid.latlon_to_cell(-85, -150)
    assert cells[r, c]
    r, c = grid.latlon_to_cell(-60, -150)
    assert not cells[r, c]
    assert 1500 < cells.sum() < 4000


def test_pm25_values_come_from_nasa_model_output():
    pm = load_layers()["pm25"]
    assert pm.values and pm.values["variable"] == "pm25_rh35"
    assert any("/ana/" in u for u in pm.values["datasets"]) and any("fcst" in u for u in pm.values["datasets"])


def test_carry_over_refuses_data_made_by_a_different_method(tmp_path):
    prev_dir, out = tmp_path / "prev", tmp_path / "out"
    (prev_dir / "pm25").mkdir(parents=True); out.mkdir()
    prev = {"generated": "2026-11-05T00:00:00Z", "layers": {"pm25": {"key": "pm25", "source": {"values": {"from": "picture-colorbar"}}}}}
    errors: dict = {}
    assert build._carry_over("pm25", prev, prev_dir, out, "discover failed", errors, "nasa-model-output") is None
    assert "not reused" in errors["pm25"]
    errors = {}
    kept = build._carry_over("pm25", prev, prev_dir, out, "discover failed", errors, "picture-colorbar")
    assert kept and kept["stale"] is True and "kept the previous run" in errors["pm25"]
