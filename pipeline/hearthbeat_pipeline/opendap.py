"""Small OPeNDAP client for NASA NCCS GrADS Data Server (GDS) aggregations.

Only what the accuracy check needs:

- ``fetch_text``: GET with retries, cached under ``pipeline/cache/opendap/``.
  Data responses are cached forever (keyed by URL); ``.das`` metadata is
  always re-fetched because aggregations grow every few hours.
- ``parse_ascii``: parse a ``.ascii?var[...]`` response into numpy arrays.
- ``parse_das_time`` / ``TimeAxis``: the dataset's time axis from the DAS
  (``grads_min``, ``grads_step``, ``grads_size``).
- ``gds_days_to_datetime``: GDS time values are "days since 1-1-1 00:00:0.0";
  value − 2 days counted from 0001-01-01 in the proleptic Gregorian calendar
  gives the UTC time (checked against ``grads_min`` of several datasets, e.g.
  736665.0 = 2017-12-01 00Z, 739925.354167 = 2026-11-04 08:30Z).
- ``Dataset.field``: one time step of a variable on a strided lat/lon subset,
  split into latitude bands so each request stays around 1 MB. Every response
  carries its own time coordinate; it is checked against the requested time,
  so a cached file can never be silently used for the wrong hour.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
import time as _time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import certifi
import numpy as np
import requests

from .svs import CACHE as _SVS_CACHE

CACHE = _SVS_CACHE / "opendap"
TIMEOUT = 300
RETRIES = 3
MAX_VALUES_PER_REQUEST = 80_000   # ~0.8-1 MB of ASCII
FILL_ABOVE = 1e14                 # GDS _FillValue is 1.0E15

_EPOCH = datetime(1, 1, 1, tzinfo=timezone.utc)
_HEADER = re.compile(r"^([A-Za-z_][\w.]*),\s*((?:\[\d+\])+)\s*$")
_INDEX_PREFIX = re.compile(r"^(?:\[\d+\])+,\s*")


class OpendapError(RuntimeError):
    pass


# --------------------------------------------------------------------------- time

def gds_days_to_datetime(v: float) -> datetime:
    """GDS 'days since 1-1-1 00:00:0.0' value -> aware UTC datetime (rounded to the second)."""
    dt = _EPOCH + timedelta(days=float(v) - 2.0)
    return (dt + timedelta(microseconds=500_000)).replace(microsecond=0)


def datetime_to_gds_days(t: datetime) -> float:
    return (t - _EPOCH).total_seconds() / 86400.0 + 2.0


_MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def parse_grads_time(s: str) -> datetime:
    """GrADS absolute time like '00z01dec2017', '00:30Z01DEC2017', '09:30z04aug2025'."""
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?z(\d{1,2})([a-z]{3})(\d{4})", s.strip().lower())
    if not m:
        raise ValueError(f"unrecognised GrADS time {s!r}")
    hh, mm, dd, mon, yyyy = m.groups()
    return datetime(int(yyyy), _MONTHS[mon], int(dd), int(hh), int(mm or 0), tzinfo=timezone.utc)


def parse_grads_step(s: str) -> timedelta:
    """GrADS increment like '60mn', '180mn', '1hr', '3hr', '1dy'."""
    m = re.fullmatch(r"(\d+)(mn|hr|dy)", s.strip().lower())
    if not m:
        raise ValueError(f"unrecognised GrADS step {s!r}")
    n, u = int(m[1]), m[2]
    return {"mn": timedelta(minutes=n), "hr": timedelta(hours=n), "dy": timedelta(days=n)}[u]


@dataclass(frozen=True)
class TimeAxis:
    start: datetime
    step: timedelta
    size: int

    @property
    def end(self) -> datetime:
        return self.start + self.step * (self.size - 1)

    def index(self, t: datetime) -> int | None:
        """Index of time t on the axis, or None if t is not an axis point."""
        q, r = divmod(t - self.start, self.step)
        if r != timedelta(0) or not 0 <= q < self.size:
            return None
        return int(q)

    def covers(self, t: datetime) -> bool:
        return self.index(t) is not None


def parse_das_time(das: str) -> TimeAxis:
    """Time axis from a GDS DAS response (the `time { ... }` attribute block)."""
    m = re.search(r"^\s*time\s*\{(.*?)^\s*\}", das, re.S | re.M)
    if not m:
        raise OpendapError("no time block in DAS")
    block = m.group(1)

    def attr(name: str) -> str:
        a = re.search(rf'{name}\s+"([^"]+)"', block)
        if not a:
            raise OpendapError(f"DAS time block lacks {name}")
        return a.group(1)

    units = attr("units")
    if not units.startswith("days since 1-1-1"):
        raise OpendapError(f"unexpected time units {units!r}")
    return TimeAxis(parse_grads_time(attr("grads_min")), parse_grads_step(attr("grads_step")),
                    int(attr("grads_size")))


# --------------------------------------------------------------------------- ascii

def parse_ascii(text: str) -> dict[str, np.ndarray]:
    """Parse a GDS `.ascii` response into {name: array}.

    The response is a sequence of blocks, each a header ``name, [n1][n2]...``
    followed by the values; multi-dimensional rows are prefixed with their
    indices (``[0][3], v, v, ...``). Grid requests return the data block first
    and then the map vectors (time, lev, lat, lon). Fill values (1e15) -> NaN."""
    if "<html" in text[:500].lower() or text.lstrip().startswith("Error"):
        msg = re.sub(r"<[^>]+>", " ", text)
        raise OpendapError("server error: " + " ".join(msg.split())[:300])
    out: dict[str, np.ndarray] = {}
    name, shape, vals = None, None, []

    def close():
        if name is None:
            return
        want = int(np.prod(shape))
        if len(vals) != want:
            raise OpendapError(f"{name}: expected {want} values, got {len(vals)}")
        a = np.array(vals, dtype=np.float64).reshape(shape)
        a[np.abs(a) > FILL_ABOVE] = np.nan
        out[name] = a

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        h = _HEADER.match(line)
        if h:
            close()
            name = h.group(1)
            shape = tuple(int(x) for x in re.findall(r"\d+", h.group(2)))
            vals = []
            continue
        if name is None:
            continue   # preamble (e.g. 'Dataset {...}' in some servers)
        line = _INDEX_PREFIX.sub("", line)
        vals.extend(float(x) for x in line.split(",") if x.strip())
    close()
    if not out:
        raise OpendapError("empty ASCII response")
    return out


# --------------------------------------------------------------------------- http + cache

def _cache_path(url: str) -> Path:
    h = hashlib.sha1(url.encode()).hexdigest()[:16]
    tail = re.sub(r"[^\w.-]+", "_", url.split("/dods/", 1)[-1])[:80]
    return CACHE / f"{h}_{tail}.txt"


def _get(url: str) -> str:
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, timeout=TIMEOUT, verify=certifi.where())
            r.raise_for_status()
            return r.text
        except requests.exceptions.SSLError:
            return subprocess.run(["curl", "-gsSfL", "--max-time", str(TIMEOUT), url],
                                  check=True, capture_output=True, text=True).stdout
        except requests.exceptions.HTTPError as e:   # 4xx: no point retrying
            if e.response is not None and 400 <= e.response.status_code < 500:
                raise OpendapError(f"HTTP {e.response.status_code} for {url}") from e
            last = e
        except requests.exceptions.RequestException as e:
            last = e
        _time.sleep(5 * (attempt + 1))
    raise OpendapError(f"failed after {RETRIES} tries: {url}: {last}")


def fetch_text(url: str, cache: bool = True, refresh: bool = False) -> str:
    """GET url (text). Successful responses are cached when cache=True."""
    p = _cache_path(url)
    if cache and not refresh and p.exists():
        return p.read_text()
    text = _get(url)
    if cache:
        if ".ascii?" in url:
            parse_ascii(text)   # raises on an error page, which is then not cached
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        tmp.write_text(text)
        tmp.replace(p)
    return text


# --------------------------------------------------------------------------- dataset

@dataclass
class Field:
    values: np.ndarray   # (nlat, nlon), south -> north as served
    lat: np.ndarray
    lon: np.ndarray
    time: datetime
    urls: list[str]


class Dataset:
    """One GDS dataset URL, e.g. https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx"""

    def __init__(self, url: str, has_lev: bool = False):
        self.url = url.rstrip("/")
        self.has_lev = has_lev
        self._axis: TimeAxis | None = None

    @property
    def axis(self) -> TimeAxis:
        if self._axis is None:
            self._axis = parse_das_time(fetch_text(self.url + ".das", cache=False))
        return self._axis

    def field(self, var: str, t: datetime, lat: tuple[int, int, int], lon: tuple[int, int, int]) -> Field:
        """Variable `var` at time t on index ranges lat=(start, stride, stop), lon=(start, stride, stop)
        (inclusive, OPeNDAP style). Requests are split into latitude bands of
        <= MAX_VALUES_PER_REQUEST values."""
        ti = self.axis.index(t)
        if ti is None:
            raise OpendapError(f"{t:%Y-%m-%d %H:%MZ} not on time axis of {self.url} "
                               f"({self.axis.start:%Y-%m-%d %H:%MZ} .. {self.axis.end:%Y-%m-%d %H:%MZ}, "
                               f"step {self.axis.step})")
        la0, las, la1 = lat
        lo0, los, lo1 = lon
        nlon = (lo1 - lo0) // los + 1
        rows = list(range(la0, la1 + 1, las))
        per = max(1, MAX_VALUES_PER_REQUEST // nlon)
        parts, lats, urls, lons = [], [], [], None
        for b in range(0, len(rows), per):
            r0, r1 = rows[b], rows[min(b + per, len(rows)) - 1]
            lev = "[0:0]" if self.has_lev else ""
            url = f"{self.url}.ascii?{var}[{ti}:{ti}]{lev}[{r0}:{las}:{r1}][{lo0}:{los}:{lo1}]"
            d = parse_ascii(fetch_text(url))
            got = gds_days_to_datetime(d["time"][0])
            if abs((got - t).total_seconds()) > 60:
                # DAS axis and served time disagree (aggregation changed, or a broken dataset):
                # never keep or use such a response
                _cache_path(url).unlink(missing_ok=True)
                raise OpendapError(f"time mismatch: server returned {got:%Y-%m-%d %H:%MZ} at time index {ti}, "
                                   f"DAS axis says {t:%Y-%m-%d %H:%MZ} ({url})")
            parts.append(d[var].reshape(-1, nlon))
            lats.append(d["lat"])
            lons = d["lon"]
            urls.append(url)
        return Field(np.concatenate(parts), np.concatenate(lats), lons, t, urls)
