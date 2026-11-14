import numpy as np

from hearthbeat_pipeline import nightlights as nl


def test_the_map_is_placed_by_longitude_from_its_left_edge_and_latitude_top_to_bottom():
    img = np.zeros((nl.H, nl.MW), np.float32)
    # a light at 3.1N 101.7E (Kuala Lumpur), drawn where the movie's map puts it
    x = int(((101.7 - nl.LON0) % 360) / 360 * nl.MW); y = int((90 - 3.1) / 180 * nl.H)
    img[y - 3:y + 4, x - 3:x + 4] = 255
    g = nl.to_lonlat(img)                               # 0.1 degree: 1800 x 3600, 90N..90S, 180W..180E
    iy, ix = np.unravel_index(np.argmax(g), g.shape)
    assert abs((90 - (iy + .5) * .1) - 3.1) <= .3 and abs((-180 + (ix + .5) * .1) - 101.7) <= .3


def test_the_legend_runs_dark_to_warm_light():
    cb = np.asarray(nl.colorbar(64, 4)).astype(int)
    assert cb.shape == (4, 64, 3)
    assert cb[0, 0].sum() < 10 and cb[0, -1].sum() > 600
    assert (np.diff(cb[0].sum(1)) >= 0).all()
