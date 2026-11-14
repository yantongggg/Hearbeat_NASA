import numpy as np
from PIL import Image

from hearthbeat_pipeline.colorbar import augment, extract_strip, invert


def colormap(p):
    """A smooth, non-self-intersecting RGB ramp."""
    p = np.asarray(p, dtype=np.float64)
    return np.stack([255 * p, 255 * (1 - np.abs(2 * p - 1)), 255 * (1 - p)], axis=-1)


def synthetic_colorbar(n=300, transparent_until=0):
    """528x125 RGBA colorbar: 1 px white border around rows 40..80, cols 70..70+n+1."""
    a = np.zeros((125, 528, 4), np.uint8)
    a[..., :3] = 255
    x0, y0, y1 = 70, 40, 80
    x1 = x0 + n + 1
    a[y0:y1 + 1, x0:x1 + 1] = [255, 255, 255, 255]           # border
    p = np.arange(n) / (n - 1)
    a[y0 + 1:y1, x0 + 1:x1, :3] = np.rint(colormap(p)).astype(np.uint8)[None]
    a[y0 + 1:y1, x0 + 1:x1, 3] = 255
    a[y0 + 1:y1, x0 + 1:x0 + 1 + transparent_until, 3] = 0   # transparent start
    a[y1 - 6:y1, x0 + 1 + n // 2, :] = 255                     # a tick mark
    return Image.fromarray(a, "RGBA")


def test_strip_detection_and_positions():
    lut = extract_strip(synthetic_colorbar(300))
    assert len(lut) == 300
    assert lut.positions[0] == 0 and lut.positions[-1] == 1
    np.testing.assert_allclose(lut.colors, np.rint(colormap(lut.positions)), atol=1)


def test_round_trip():
    lut = extract_strip(synthetic_colorbar(300))
    rng = np.random.default_rng(0)
    p = rng.uniform(0, 1, size=(64, 128))
    img = np.rint(colormap(p)).astype(np.uint8)
    pos, dist = invert(img, lut, max_dist=12)
    assert not np.isnan(pos).any()
    assert np.abs(pos - p).max() < 2 / 299


def test_far_colours_masked():
    lut = extract_strip(synthetic_colorbar(300))
    img = np.zeros((2, 2, 3), np.uint8)
    img[0, 0] = colormap(0.5)
    img[1, 1] = [0, 0, 0]                 # black coastline: far from every LUT colour
    pos, dist = invert(img, lut, max_dist=12)
    assert abs(pos[0, 0] - 0.5) < 0.01
    assert np.isnan(pos[1, 1]) and dist[1, 1] > 12


def test_transparent_part_excluded():
    lut = extract_strip(synthetic_colorbar(300, transparent_until=30))
    assert len(lut) == 270
    assert abs(lut.positions[0] - 30 / 299) < 1e-6


def test_augment_keeps_positions():
    lut = extract_strip(synthetic_colorbar(100))
    aug = augment(lut, (30, 30, 30), 0.5, p_max=0.5, steps=5)
    assert len(aug) == 100 + 5 * int((lut.positions <= 0.5).sum())
    faded = 0.6 * colormap(0.2) + 0.4 * np.array([30, 30, 30])
    pos, _ = invert(np.rint(faded).astype(np.uint8)[None, None], aug, max_dist=12)
    assert abs(pos[0, 0] - 0.2) < 0.02
