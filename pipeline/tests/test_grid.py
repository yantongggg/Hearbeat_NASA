import numpy as np
import pytest

from hearthbeat_pipeline import grid


@pytest.mark.parametrize("vmin,vmax,scale", [(-40, 40, "linear"), (0, 25, "linear"),
                                              (0.4, 409.6, "log"), (0.1, 20, "log")])
def test_quantize_round_trip(vmin, vmax, scale):
    if scale == "linear":
        v = np.linspace(vmin, vmax, 1000)
        step = (vmax - vmin) / 254
        err = np.abs(grid.dequantize(grid.quantize(v, vmin, vmax, scale), vmin, vmax, scale) - v)
        assert err.max() <= step / 2 + 1e-9
    else:
        v = np.geomspace(vmin, vmax, 1000)
        step = (np.log(vmax) - np.log(vmin)) / 254
        back = grid.dequantize(grid.quantize(v, vmin, vmax, scale), vmin, vmax, scale)
        assert np.abs(np.log(back) - np.log(v)).max() <= step / 2 + 1e-9


def test_quantize_contract_endpoints():
    q = grid.quantize(np.array([np.nan, -100, -40, 40, 100]), -40, 40, "linear")
    assert q.tolist() == [0, 1, 1, 255, 255]
    assert np.isnan(grid.dequantize(np.array([0]), -40, 40, "linear")[0])
    # contract formula, linear: value = min + (q-1)/254*(max-min)
    assert grid.dequantize(np.array([128]), 0, 254, "linear")[0] == pytest.approx(127)
    # log: value = exp(ln(min) + (q-1)/254*(ln(max)-ln(min)))
    assert grid.dequantize(np.array([255]), 0.4, 409.6, "log")[0] == pytest.approx(409.6)
    assert grid.dequantize(np.array([1]), 0.4, 409.6, "log")[0] == pytest.approx(0.4)
    assert grid.quantize(np.array([0.0]), 0.1, 20, "log")[0] == 1   # zero clamps to min


def test_grid_orientation():
    h, w = 1024, 2048
    lat = 90 - (np.arange(h) + 0.5) * 180 / h
    lon = -180 + (np.arange(w) + 0.5) * 360 / w
    g_lat = grid.downsample(np.repeat(lat[:, None], w, axis=1))
    g_lon = grid.downsample(np.repeat(lon[None, :], h, axis=0))
    assert g_lat.shape == (180, 360)
    assert g_lat[0, 0] == pytest.approx(89.5, abs=0.2)      # row 0 = north
    assert g_lat[-1, 0] == pytest.approx(-89.5, abs=0.2)
    assert g_lon[0, 0] == pytest.approx(-179.5, abs=0.2)    # col 0 = -179.5
    assert g_lon[0, -1] == pytest.approx(179.5, abs=0.2)
    assert grid.latlon_to_cell(89.5, -179.5) == (0, 0)
    assert grid.latlon_to_cell(-89.5, 179.5) == (179, 359)
    assert grid.latlon_to_cell(3.14, 101.69) == (86, 281)


def test_downsample_median_ignores_nan():
    img = np.full((180, 360), np.nan)
    img[0, 0] = 5.0
    g = grid.downsample(img)
    assert g[0, 0] == 5 and np.isnan(g[0, 1])
    img = np.zeros((360, 720))
    img[:2, :2] = [[1, 2], [3, 100]]
    assert grid.downsample(img)[0, 0] == 2.5
    assert grid.downsample(img, "mean")[0, 0] == pytest.approx(26.5)


def test_fill_holes_wraps_longitude():
    g = np.full((180, 360), np.nan)
    g[:, 0] = 1.0
    g[:, 358] = 3.0
    out = grid.fill_holes(g, np.isnan(g) & (np.arange(360) == 359)[None, :])
    assert out[90, 359] == pytest.approx(2.0)
    assert np.isnan(out[90, 100])
