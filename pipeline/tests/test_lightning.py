from datetime import timedelta

import numpy as np
import pytest

from hearthbeat_pipeline import lightning as lg


def test_nasa_writes_2023_as_2003_after_2022_and_only_that_is_fixed():
    d = lg.parse_labels("30 Dec 2022 10:00\n31 Dec 2022 19:21\n01 Jan 2003 04:09\n31 Aug 2003 01:30\n")
    assert [x.year for x in d] == [2022, 2022, 2023, 2023]
    with pytest.raises(RuntimeError):
        lg.parse_labels("01 Mar 2017 01:25\n01 Jan 2003 04:09\n")   # 2003 not after 2022: going back is refused


def test_frames_are_taken_ten_days_apart_once_the_first_window_is_full():
    d0 = lg.parse_labels("01 Mar 2017 01:25\n")[0]
    dates = [d0 + timedelta(hours=13 * i) for i in range(200)]
    picks = lg.pick_frames(dates)
    assert dates[picks[0]] >= d0 + timedelta(days=10)
    gaps = [dates[b] - dates[a] for a, b in zip(picks, picks[1:])]
    assert all(g >= timedelta(days=10) for g in gaps) and all(g < timedelta(days=11) for g in gaps)


def test_yellow_marks_count_and_the_grey_map_does_not():
    img = np.full((4, 4, 3), 21, np.uint8)
    img[0, 0] = (212, 201, 61)       # a lightning mark as NASA draws it
    img[1, 1] = (60, 60, 60)         # grey land
    img[2, 2] = (90, 90, 95)         # the equator line
    a = lg.lightning_amount(img)
    assert a[0, 0] > .8 and a[1, 1] == 0 and a[2, 2] == 0 and a[3, 3] == 0


def test_the_map_runs_from_180_west_and_90_north():
    img = np.zeros((lg.H, lg.W), np.float32)
    x = int((101.7 + 180) / 360 * lg.W); y = int((90 - 3.1) / 180 * lg.H)   # Kuala Lumpur
    img[y - 6:y + 6, x - 6:x + 6] = 1
    g = lg.cells(img)
    iy, ix = np.unravel_index(np.argmax(g), g.shape)
    assert abs((89.5 - iy) - 3.1) <= 1 and abs((-179.5 + ix) - 101.7) <= 1


def test_the_legend_runs_dark_to_warm_yellow():
    cb = np.asarray(lg.colorbar(64, 4)).astype(int)
    assert cb.shape == (4, 64, 3)
    assert (np.diff(cb[0].sum(1)) >= 0).all() and cb[0, -1, 0] > 240 and cb[0, -1, 2] < 80
