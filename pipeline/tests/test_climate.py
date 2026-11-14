"""Offline tests for the GISTEMP climate layer (tiny synthetic arrays, no downloads)."""
import gzip
import json

import numpy as np
import pytest
from PIL import Image

from hearthbeat_pipeline import climate, grid

NAN = np.nan


def _months(*years):
    ys = np.repeat(years, 12)
    ms = np.tile(np.arange(1, 13), len(years))
    return ys, ms


# ---------------------------------------------------------------- annual means

def test_annual_mean_with_missing_months():
    ys, ms = _months(2000)
    m = np.zeros((12, 1, 3), np.float32)
    m[:, 0, 0] = np.arange(12)                 # all 12 months: mean 5.5
    m[:, 0, 1] = np.arange(12)
    m[[0, 5, 11], 0, 1] = NAN                  # 9 months left: mean of the 9
    m[:, 0, 2] = 1.0
    m[:4, 0, 2] = NAN                          # 8 months left -> no data
    years, a = climate.annual_means(m, ys, ms)
    assert years == [2000]
    assert a.shape == (1, 1, 3)
    assert a[0, 0, 0] == pytest.approx(5.5)
    assert a[0, 0, 1] == pytest.approx(np.mean([1, 2, 3, 4, 6, 7, 8, 9, 10]))
    assert np.isnan(a[0, 0, 2])


def test_min_months_rule_is_configurable():
    ys, ms = _months(2000)
    m = np.ones((12, 1, 2), np.float32)
    m[:3, 0, 0] = NAN      # 9 months
    m[:4, 0, 1] = NAN      # 8 months
    _, a9 = climate.annual_means(m, ys, ms, min_months=9)
    _, a12 = climate.annual_means(m, ys, ms, min_months=12)
    _, a8 = climate.annual_means(m, ys, ms, min_months=8)
    assert np.isfinite(a9[0, 0, 0]) and np.isnan(a9[0, 0, 1])
    assert np.isnan(a12[0]).all()
    assert np.isfinite(a8[0]).all()


def test_only_complete_calendar_years():
    ys, ms = _months(1999, 2000)
    ys = np.concatenate([ys, [2001] * 9])                 # 2001 runs to September only
    ms = np.concatenate([ms, np.arange(1, 10)])
    m = np.ones((len(ys), 1, 1), np.float32)
    years, a = climate.annual_means(m, ys, ms, min_months=1)
    assert years == [1999, 2000]
    assert a.shape == (2, 1, 1)


# ---------------------------------------------------------------- encoding

def test_encoding_clips_to_end_codes_and_keeps_nodata():
    q = climate.encode(np.array([NAN, -10, -6, 0, 6, 10]))
    assert q.dtype == np.uint8
    assert q.tolist() == [0, 1, 1, 128, 255, 255]


def test_encoding_round_trip_matches_contract():
    v = np.linspace(-6, 6, 501)
    back = grid.dequantize(climate.encode(v), -6, 6, "linear")
    assert np.abs(back - v).max() <= 12 / 254 / 2 + 1e-9


# ---------------------------------------------------------------- orientation

def test_orient_rows_north_to_south_and_columns_west_to_east():
    lat = np.array([-45.0, 45.0])                      # stored south -> north (like GISTEMP)
    lon = np.array([45.0, 135.0, 225.0, 315.0])        # 0..360 convention
    lat_field = np.repeat(lat[:, None], 4, axis=1)
    lon_field = np.repeat(lon[None, :], 2, axis=0)
    data = np.stack([lat_field, lon_field])            # (t=2, lat, lon)
    out, g = climate.orient(data, lat, lon)
    assert g == {"w": 4, "h": 2, "lat0": 45, "lon0": -135, "step": 90}
    assert out[0, :, 0].tolist() == [45, -45]          # row 0 = northernmost
    assert out[1, 0].tolist() == [225, 315, 45, 135]   # col 0 = westernmost (-135 = 225)


def test_orient_real_gistemp_layout():
    lat = np.arange(-89, 90, 2.0)
    lon = np.arange(-179, 180, 2.0)
    _, g = climate.orient(np.zeros((1, 90, 180)), lat, lon)
    assert g == {"w": 180, "h": 90, "lat0": 89, "lon0": -179, "step": 2}
    assert climate.cell_of(89.5, -179.5, g) == (0, 0)
    assert climate.cell_of(-89.5, 179.5, g) == (89, 179)
    assert climate.cell_of(3.1, 101.7, g) == (43, 140)   # Kuala Lumpur -> cell centre 3N 101E


def test_orient_rejects_irregular_grid():
    with pytest.raises(ValueError):
        climate.orient(np.zeros((1, 3, 2)), np.array([0.0, 2.0, 5.0]), np.array([0.0, 2.0]))


# ---------------------------------------------------------------- palette & pictures

def _lstar(rgb):
    c = np.asarray(rgb, np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = c @ np.array([0.2126, 0.7152, 0.0722])
    return np.where(y > 0.008856, 116 * np.cbrt(y) - 16, 903.3 * y)


def test_palette_symmetric_around_zero():
    v = np.linspace(0, 4, 41)
    pos, neg = climate.palette(v).astype(int), climate.palette(-v).astype(int)
    zero = pos[0]
    assert np.ptp(zero) <= 4 and zero.min() >= 240                  # neutral near-white at 0
    assert np.abs(_lstar(pos) - _lstar(neg)).max() < 5               # equal |anomaly|, equal lightness
    assert (pos[1:, 0] > pos[1:, 2]).all()                           # warm side red
    assert (neg[1:, 2] > neg[1:, 0]).all()                           # cool side blue
    assert np.all(np.diff(_lstar(pos)) <= 1e-6)                      # darker as |anomaly| grows
    assert np.all(np.diff(_lstar(neg)) <= 1e-6)


def test_palette_saturates_and_marks_nodata():
    p = climate.palette(np.array([4, 5, 100, -4, -5, NAN]))
    assert (p[0] == p[1]).all() and (p[0] == p[2]).all()
    assert (p[3] == p[4]).all()
    assert tuple(p[5]) == (0x26, 0x2B, 0x31)


def test_render_orientation_size_and_nodata():
    g = {"w": 4, "h": 2, "lat0": 45, "lon0": -135, "step": 90}
    vals = np.array([[3, 3, 3, NAN],           # north: warm, one no-data cell at lon 135
                     [-3, -3, -3, -3]])        # south: cool
    img = climate.render(vals, g, (64, 32))
    assert img.size == (64, 32) and img.mode == "RGB"
    a = np.asarray(img).astype(int)
    assert a[2, 8, 0] > a[2, 8, 2]             # top-left (north-west) is red
    assert a[29, 8, 2] > a[29, 8, 0]           # bottom is blue
    assert tuple(a[2, 56]) == (0x26, 0x2B, 0x31)   # north-east cell centre = no data grey


def test_colorbar_image():
    img = climate.colorbar(512, 24)
    assert img.size == (512, 24)
    a = np.asarray(img).astype(int)
    assert a[12, 0, 2] > a[12, 0, 0] and a[12, -1, 0] > a[12, -1, 2]
    assert (a[:, 256] >= 235).all()            # centre (0 degC) near white


# ---------------------------------------------------------------- end to end, offline

def _write_nc(path, data, lat, lon, years, months):
    netCDF4 = pytest.importorskip("netCDF4")
    raw = path.with_suffix("")
    with netCDF4.Dataset(raw, "w", format="NETCDF3_CLASSIC") as ds:
        ds.history = "Created 2026-10-22 14:38:23 by test"
        ds.createDimension("lat", len(lat))
        ds.createDimension("lon", len(lon))
        ds.createDimension("time", None)
        ds.createVariable("lat", "f4", ("lat",))[:] = lat
        ds.createVariable("lon", "f4", ("lon",))[:] = lon
        t = ds.createVariable("time", "i4", ("time",))
        t.units = "days since 1800-01-01 00:00:00"
        t[:] = netCDF4.date2num([__import__("datetime").datetime(y, m, 15) for y, m in zip(years, months)],
                                t.units)
        v = ds.createVariable("tempanomaly", "i2", ("time", "lat", "lon"), fill_value=32767)
        v.units = "K"
        v.scale_factor = 0.01
        v[:] = np.ma.array(np.nan_to_num(data), mask=np.isnan(data))
    path.write_bytes(gzip.compress(raw.read_bytes()))


def test_build_gistemp_offline(tmp_path):
    lat = np.array([-45.0, 45.0])
    lon = np.array([-135.0, -45.0, 45.0, 135.0])
    ys, ms = _months(1880, 1881)
    ys = np.concatenate([ys, [1882, 1882]])
    ms = np.concatenate([ms, [1, 2]])
    data = np.zeros((len(ys), 2, 4))
    data[:, 1, :] = 1.5                        # north row (stored second)
    data[:, 0, :] = -0.5
    data[:12, 1, 3] = NAN                      # 1880: north-east cell missing all year
    data[:, 0, 0] = 9.0                        # beyond +6 -> clipped
    nc = tmp_path / "g.nc.gz"
    _write_nc(nc, data, lat, lon, ys, ms)
    csvp = tmp_path / "GLB.csv"
    csvp.write_text("Land-Ocean: Global Means\nYear,Jan,J-D,D-N\n1880,-.19,-.17,***\n"
                    "1881,-.20,***,-.10\n1882,.16,.01,-.09\n")
    out = tmp_path / "out"
    e = climate.build_gistemp(out, "tanom", {"nc_file": nc, "csv_file": csvp})
    json.dumps(e)                              # serialisable
    assert e["key"] == "tanom" and e["simulated"] is False and e["unit"] == "°C"
    assert e["encoding"] == {"scale": "linear", "min": -6, "max": 6}
    assert e["grid"] == {"w": 4, "h": 2, "lat0": 45, "lon0": -135, "step": 90}
    assert e["time"]["cadence"] == "P1Y" and e["time"]["label"] == "year"
    assert [s["t"] for s in e["steps"]] == ["1880", "1881"]          # 1882 incomplete
    s0 = e["steps"][0]
    assert s0["grid"] == "tanom/g1880.bin" and s0["image"] == "tanom/o1880.webp"
    assert s0["stats"] == {"validCells": 7, "nodataCells": 1}
    assert e["series"]["global"] == [{"t": "1880", "v": -0.17}]      # 1881 is *** in J-D
    assert e["colorbar"] == {"image": "tanom/colorbar.png", "scale": "linear", "min": -4, "max": 4}
    assert e["source"]["kind"] == "gistemp-netcdf" and "GISTEMP Team, 2026" in e["source"]["citation"]
    assert "1882" in e["notes"] and "1951–1980" in e["notes"] and "1200 km" in e["notes"]
    q = np.frombuffer((out / "tanom" / "g1880.bin").read_bytes(), np.uint8).reshape(2, 4)
    v = grid.dequantize(q, -6, 6, "linear")
    assert np.allclose(v[0, :3], 1.5, atol=0.03) and np.isnan(v[0, 3])   # row 0 = north
    assert q[1, 0] == 255                                                  # 9 degC clipped
    with Image.open(out / "tanom" / "o1880.webp") as im:
        assert im.size == (512, 256) and im.format == "WEBP" and im.mode == "RGBA"
        a = np.asarray(im)[..., 3]
    # opacity follows |anomaly|: the +1.5 degC north is more opaque than the -0.5 degC south;
    # the missing north-east cell is a grey veil, not transparent
    assert a[64, 192] > a[192, 192] > 0
    assert 120 < a[64, 500] < 190
    with Image.open(out / "tanom" / "colorbar.png") as im:
        assert im.size == (512, 24)
