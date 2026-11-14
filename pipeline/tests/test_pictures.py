"""The globe layer lifted off an EIC frame (pictures.py)."""
import numpy as np

from hearthbeat_pipeline import pictures


def test_background_is_the_darkest_frames_so_moving_clouds_drop_out():
    bg = np.full((4, 4, 3), 40, np.uint8)
    frames = []
    for i in range(6):
        f = bg.copy()
        f[i % 4, :, :] = 230            # a bright cloud band in a different row each frame
        frames.append(f)
    est = pictures.estimate_background(frames)
    assert (est == 40).all()


def test_rain_keeps_nasa_colour_clouds_become_white_alpha_rest_transparent():
    bg = np.full((2, 3, 3), 40, np.uint8)
    rgb = bg.copy()
    rgb[0, 0] = (0, 200, 0)              # rain colour
    rgb[0, 1] = (200, 200, 200)          # cloud
    pos = np.full((2, 3), np.nan); pos[0, 0] = 0.5   # heavy rain
    hidden = np.zeros((2, 3), bool); hidden[1, 2] = True
    rgb[1, 2] = (255, 255, 255)          # logo pixel
    o = pictures.rain_clouds(rgb, pos, bg, hidden)
    assert tuple(o[0, 0, :3]) == (0, 200, 0) and o[0, 0, 3] >= 240
    assert tuple(o[0, 1, :3]) == (255, 255, 255) and 150 < o[0, 1, 3] < 230
    assert o[1, 0, 3] == 0               # plain background
    assert o[1, 2, 3] == 0               # under the logo


def test_field_opacity_rises_with_colorbar_position():
    rgb = np.full((1, 4, 3), 200, np.uint8)
    pos = np.array([[0.0, 0.3, 0.9, np.nan]])
    o = pictures.field(rgb, pos, np.zeros((1, 4), bool), 0.1, 0.6, 0.85)
    a = o[0, :, 3]
    assert a[0] == 0 and 0 < a[1] < a[2] and a[2] == round(0.85 * 255) and a[3] == 0


def test_light_rain_is_translucent_heavy_rain_opaque():
    rgb = np.full((1, 2, 3), 100, np.uint8)
    pos = np.array([[0.01, 0.5]])
    o = pictures.rain_clouds(rgb, pos, rgb.copy(), np.zeros((1, 2), bool))
    assert 150 < o[0, 0, 3] < o[0, 1, 3]


def test_feather_softens_edges_without_dark_fringes():
    o = np.zeros((5, 5, 4), np.uint8)
    o[2, 2] = (0, 200, 0, 255)
    f = pictures.feather(o)
    assert 0 < f[2, 3, 3] < 255 and tuple(f[2, 3, :3]) == (0, 200, 0)   # neighbour: partly covered, same colour
    assert f[0, 0, 3] == 0
