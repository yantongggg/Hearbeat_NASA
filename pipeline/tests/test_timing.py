from datetime import date, datetime, timezone

from hearthbeat_pipeline.build import Frame, last_frame_utc, pick, step_times


def test_last_frame_is_anchored_in_utc():
    # Burned-in labels read on 2026-11-06 (Last-Modified 2026-11-04):
    # last frame "04 Nov 2026 15:00:00 EST" = 20:00 UTC; before DST ended it read 16:00 EDT = 20:00 UTC too.
    assert last_frame_utc(date(2026, 10, 30)) == datetime(2026, 10, 30, 20, tzinfo=timezone.utc)
    assert last_frame_utc(date(2026, 11, 4)) == datetime(2026, 11, 4, 20, tzinfo=timezone.utc)


def test_first_frame_label_matches():
    # 372 hourly frames: frame 1 is 371 h before the last, labelled "20 Oct 2026 05:00:00 EDT" = 09:00 UTC
    from datetime import timedelta
    assert last_frame_utc(date(2026, 11, 4)) - timedelta(hours=371) == datetime(2026, 10, 20, 9, tzinfo=timezone.utc)


def test_step_times_round_down_and_space_evenly():
    t = step_times(datetime(2026, 11, 4, 20, tzinfo=timezone.utc), days=5, step_hours=6)
    assert len(t) == 20
    assert t[-1] == datetime(2026, 11, 4, 18, tzinfo=timezone.utc)
    assert t[0] == datetime(2026, 10, 31, 0, tzinfo=timezone.utc)
    assert all((b - a).total_seconds() == 6 * 3600 for a, b in zip(t, t[1:]))


def test_pick_nearest_and_date_means_noon():
    fr = [Frame(f"u{h}", datetime(2026, 11, 1, h, tzinfo=timezone.utc)) for h in range(24)]
    assert pick(fr, datetime(2026, 11, 1, 6, 20, tzinfo=timezone.utc)).url == "u6"
    assert pick(fr, date(2026, 11, 1)).url == "u12"
