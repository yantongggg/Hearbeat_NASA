"""Offline tests for the OPeNDAP client and the accuracy statistics (no network)."""
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from hearthbeat_pipeline import accuracy, grid, opendap

UTC = timezone.utc

# A real GDS response shape (values shortened), for t2m[26091:26091][0:360:720][0:576:1151]
ASCII_3D = """t2m, [1][3][2]
[0][0], 232.17368, 232.17368
[0][1], 302.98618, 1.0E15
[0][2], 267.21274, 267.21274


time, [1]
739926.375
lat, [3]
-90.0, 0.0, 90.0
lon, [2]
-180.0, 0.0
"""

# GEOS-CF has a single-level 'lev' dimension
ASCII_4D = """pm25_rh35, [1][1][2][3]
[0][0][0], 0.75878906, 0.70214844, 7.40625
[0][0][1], 1.4375, 2.5, 3.0


time, [1]
739925.3541666666
lev, [1]
72.0
lat, [2]
-89.75, 89.75
lon, [3]
-180.0, 0.0, 90.0
"""

DAS = """Attributes {
    NC_GLOBAL {
        String title "GEOS5 FP 2d assimilated state";
    }
    time {
        String grads_dim "t";
        String grads_mapping "linear";
        String grads_size "26092";
        String grads_min "00z01dec2017";
        String grads_step "180mn";
        String units "days since 1-1-1 00:00:0.0";
        String minimum "00z01dec2017";
        String maximum "09z05nov2026";
        Float32 resolution 0.125;
    }
    lat {
        String grads_dim "y";
    }
}
"""


def test_parse_ascii_3d_with_maps_and_fill():
    d = opendap.parse_ascii(ASCII_3D)
    assert d["t2m"].shape == (1, 3, 2)
    assert d["t2m"][0, 1, 0] == pytest.approx(302.98618)
    assert np.isnan(d["t2m"][0, 1, 1])                       # 1e15 fill -> NaN
    assert d["lat"].tolist() == [-90.0, 0.0, 90.0]
    assert d["lon"].tolist() == [-180.0, 0.0]
    assert d["time"][0] == 739926.375


def test_parse_ascii_4d_lev():
    d = opendap.parse_ascii(ASCII_4D)
    assert d["pm25_rh35"].shape == (1, 1, 2, 3)
    assert d["pm25_rh35"][0, 0, 1, 2] == 3.0
    assert d["lev"].tolist() == [72.0]


def test_parse_ascii_rejects_error_pages_and_short_blocks():
    with pytest.raises(opendap.OpendapError):
        opendap.parse_ascii("<html><head><title>GrADS Data Server - error</title></head></html>")
    with pytest.raises(opendap.OpendapError):
        opendap.parse_ascii("t2m, [1][2][2]\n[0][0], 1.0, 2.0\n")


def test_gds_time_values():
    # values observed on opendap.nccs.nasa.gov (time maps vs. grads_min / info pages)
    assert opendap.gds_days_to_datetime(736665.0) == datetime(2017, 12, 1, 0, tzinfo=UTC)
    assert opendap.gds_days_to_datetime(739926.375) == datetime(2026, 11, 5, 9, tzinfo=UTC)
    assert opendap.gds_days_to_datetime(739925.3541666666) == datetime(2026, 11, 4, 8, 30, tzinfo=UTC)
    assert opendap.gds_days_to_datetime(739468.3958333334) == datetime(2025, 8, 4, 9, 30, tzinfo=UTC)
    t = datetime(2026, 11, 4, 18, 30, tzinfo=UTC)
    assert opendap.gds_days_to_datetime(opendap.datetime_to_gds_days(t)) == t


def test_grads_time_strings_and_steps():
    assert opendap.parse_grads_time("00z01dec2017") == datetime(2017, 12, 1, tzinfo=UTC)
    assert opendap.parse_grads_time("00:30Z01DEC2017") == datetime(2017, 12, 1, 0, 30, tzinfo=UTC)
    assert opendap.parse_grads_time("09:30z04aug2025") == datetime(2025, 8, 4, 9, 30, tzinfo=UTC)
    assert opendap.parse_grads_step("60mn") == timedelta(hours=1)
    assert opendap.parse_grads_step("3hr") == timedelta(hours=3)
    assert opendap.parse_grads_step("1dy") == timedelta(days=1)


def test_time_axis_from_das():
    ax = opendap.parse_das_time(DAS)
    assert ax.start == datetime(2017, 12, 1, tzinfo=UTC)
    assert ax.step == timedelta(hours=3)
    assert ax.end == datetime(2026, 11, 5, 9, tzinfo=UTC)
    assert ax.index(datetime(2026, 11, 5, 9, tzinfo=UTC)) == 26091
    assert ax.index(datetime(2026, 11, 5, 10, tzinfo=UTC)) is None      # not a 3-hourly step
    assert ax.index(datetime(2026, 11, 5, 12, tzinfo=UTC)) is None      # after the end
    assert ax.index(datetime(2017, 11, 30, 21, tzinfo=UTC)) is None     # before the start


def test_cell_mean_maps_points_to_app_grid():
    lat = np.array([-89.75, -89.25, 89.25, 89.75])
    lon = np.array([-180.0, -179.375, 179.375])
    v = np.arange(12, dtype=float).reshape(4, 3)
    v[0, 0] = np.nan
    g = accuracy.cell_mean(opendap.Field(v, lat, lon, datetime(2026, 1, 1, tzinfo=UTC), []))
    assert g.shape == (grid.H, grid.W)
    # bottom row (89.5S) col 0 (-179.5E) gets lat -89.75/-89.25 x lon -180/-179.375, minus the NaN
    assert g[179, 0] == pytest.approx(np.mean([1, 3, 4]))
    assert g[0, 359] == pytest.approx(np.mean([8, 11]))     # 89.5N, 179.5E
    assert g[0, 0] == pytest.approx(np.mean([6, 7, 9, 10]))
    assert np.isnan(g[90, 180])


def test_error_stats_known_arrays():
    raw = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    dec = raw + np.array([1.0, -1.0, 1.0, -1.0, 3.0])
    s = accuracy.error_stats(dec, raw)
    assert s["n"] == 5
    assert s["bias"] == pytest.approx(0.6)
    assert s["mae"] == pytest.approx(1.4)
    assert s["rmse"] == pytest.approx(np.sqrt(13 / 5), abs=1e-4)
    assert s["medianAbsErr"] == 1.0
    assert s["p90AbsErr"] == pytest.approx(2.2)              # numpy linear interpolation
    assert s["r"] == pytest.approx(np.corrcoef(dec, raw)[0, 1], abs=1e-4)
    perfect = accuracy.error_stats(raw * 2 + 1, raw)
    assert perfect["r"] == pytest.approx(1.0)
    assert accuracy.ols_slope(raw * 2 + 1, raw) == {"slope": 2.0, "intercept": 1.0}
    assert accuracy.error_stats(np.array([]), np.array([]))["n"] == 0


def test_contingency():
    raw = np.array([0.0, 0.05, 0.2, 1.0, 3.0, 0.0])
    dec = np.array([0.0, 0.5, 0.0, 2.0, 1.0, 0.0])
    c = accuracy.contingency(dec, raw, 0.1)
    assert (c["hits"], c["misses"], c["falseAlarms"], c["correctNegatives"]) == (2, 1, 1, 2)
    assert c["hitRate"] == pytest.approx(2 / 3, abs=1e-4)
    assert c["falseAlarmRatio"] == pytest.approx(1 / 3, abs=1e-4)
    assert c["frequencyBias"] == 1.0


def test_log_stats():
    raw = np.array([1.0, 10.0, 100.0, 4.0])
    dec = np.array([2.0, 10.0, 50.0, 4.0])
    s = accuracy.log_stats(dec, raw)
    assert s["log10Bias"] == pytest.approx(0.0, abs=1e-4)
    assert s["log10Mae"] == pytest.approx(np.log10(2) / 2, abs=1e-4)
    assert s["fac2"] == 1.0
    assert s["medianRelErr"] == pytest.approx(0.25)


def test_sampling_is_seeded_area_weighted_and_valid_only():
    valid = np.zeros((grid.H, grid.W), bool)
    valid[::2, ::3] = True
    a = accuracy.sample_cells(valid, 400, 2026)
    b = accuracy.sample_cells(valid, 400, 2026)
    c = accuracy.sample_cells(valid, 400, 7)
    assert len(a) == 400 and len(set(a.tolist())) == 400
    assert np.array_equal(a, b) and not np.array_equal(a, c)
    assert valid.ravel()[a].all()
    # area weighting: few samples poleward of 60 degrees (~13 % of the area, 33 % of the cells)
    lat = grid.LAT0 - (a // grid.W)
    assert np.mean(np.abs(lat) > 60) < 0.2
    assert len(accuracy.sample_cells(valid, 10 ** 6, 1)) == valid.sum()


def test_best_offset_prefers_highest_r_then_smallest_shift():
    scan = [{"h": -1, "r": 0.9, "rmse": 1}, {"h": 0, "r": 0.95, "rmse": 1}, {"h": 1, "r": 0.95, "rmse": 1},
            {"h": 2, "r": None, "rmse": None}]
    assert accuracy.best_offset(scan) == 0
    assert accuracy.best_offset([{"h": 2, "r": 0.5}, {"h": -1, "r": 0.7}]) == -1
    assert accuracy.best_offset([{"h": 0, "r": None}]) is None
    logscan = [{"h": 0, "r": 0.9, "rLog": 0.8}, {"h": 1, "r": 0.7, "rLog": 0.85}]
    assert accuracy.best_offset(logscan) == 0
    assert accuracy.best_offset(logscan, "rLog") == 1


def test_tavg_value_uses_the_two_hours_around_t():
    src = accuracy.SPECS["precip"].main
    t = datetime(2026, 11, 4, 12, tzinfo=UTC)
    assert src.times(t) == [datetime(2026, 11, 4, 11, 30, tzinfo=UTC), datetime(2026, 11, 4, 12, 30, tzinfo=UTC)]
    assert accuracy.SPECS["temp"].main.times(t) == [t]


def test_implied_range_recovers_the_bar_when_decoding_is_perfect():
    from types import SimpleNamespace
    lin = SimpleNamespace(scale="linear", min=-40.0, max=40.0)
    v = np.linspace(-30, 30, 50)
    assert accuracy.implied_range(lin, v, v)["min"] == pytest.approx(-40.0)
    assert accuracy.implied_range(lin, v, v)["max"] == pytest.approx(40.0)
    log = SimpleNamespace(scale="log", min=0.4, max=409.6)
    v = np.geomspace(1, 200, 50)
    ir = accuracy.implied_range(log, v, 4 * v)          # raw 4x the decoded value everywhere
    assert ir["min"] == pytest.approx(1.6, rel=1e-3) and ir["max"] == pytest.approx(1638.4, rel=1e-3)


def test_weighted_stats_and_overlay_cells():
    from types import SimpleNamespace
    s = accuracy.weighted_stats(np.array([1.0, 3.0]), np.array([0.0, 0.0]), np.array([3.0, 1.0]))
    assert s["bias"] == pytest.approx(1.5) and s["mae"] == pytest.approx(1.5)
    assert s["rmse"] == pytest.approx(np.sqrt(3.0), abs=1e-4)
    m = accuracy.overlay_cells(SimpleNamespace(overlays=[(0.0, 0.9, 0.25, 1.0)]))
    assert m.shape == (grid.H, grid.W) and m[-1, 0] and not m[0, 0] and not m[-1, 180]
    assert accuracy.overlay_cells(SimpleNamespace(overlays=[])) is None
