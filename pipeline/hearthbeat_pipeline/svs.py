"""NASA SVS access: page API, frame directory listings, cached downloads.

Everything downloaded is cached under pipeline/cache/ so re-runs are cheap.
HTTPS goes through requests+certifi; if that fails (some Python builds lack
the CA chain for svs.gsfc.nasa.gov) we fall back to the system curl.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin

import certifi
import requests

API = "https://svs.gsfc.nasa.gov/api/{id}"
CACHE = Path(__file__).resolve().parent.parent / "cache"
TIMEOUT = 60


def _https(url: str) -> str:
    return re.sub(r"^http://", "https://", url)


def _cache_path(url: str, sub: str) -> Path:
    name = url.rstrip("/").rsplit("/", 1)[-1] or "index"
    h = hashlib.sha1(url.encode()).hexdigest()[:10]
    return CACHE / sub / f"{h}_{name}"


RETRY_WAITS = (5, 20, 60)   # seconds; SVS occasionally answers 503 for a minute


def fetch_bytes(url: str) -> bytes:
    """GET with retries on 5xx / connection errors (transient SVS outages)."""
    url = _https(url)
    for i, wait in enumerate((0,) + RETRY_WAITS):
        if wait:
            time.sleep(wait)
        try:
            r = requests.get(url, timeout=TIMEOUT, verify=certifi.where())
            if r.status_code >= 500 and i < len(RETRY_WAITS):
                continue
            r.raise_for_status()
            return r.content
        except requests.exceptions.SSLError:
            return subprocess.run(["curl", "-sSfL", "--max-time", str(TIMEOUT * 3), url],
                                  check=True, capture_output=True).stdout
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            if i == len(RETRY_WAITS):
                raise
    raise RuntimeError(f"unreachable: {url}")


def head_last_modified(url: str) -> datetime | None:
    """Last-Modified header of a URL (UTC), or None."""
    url = _https(url)
    try:
        r = requests.head(url, timeout=TIMEOUT, verify=certifi.where(), allow_redirects=True)
        lm = r.headers.get("Last-Modified")
    except requests.exceptions.SSLError:
        out = subprocess.run(["curl", "-sSfIL", url], check=True, capture_output=True, text=True).stdout
        m = re.search(r"^last-modified:\s*(.+)$", out, re.I | re.M)
        lm = m.group(1).strip() if m else None
    return parsedate_to_datetime(lm).astimezone(timezone.utc) if lm else None


def cached(url: str, sub: str = "files", refresh: bool = False) -> Path:
    p = _cache_path(_https(url), sub)
    if refresh or not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        data = fetch_bytes(url)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(p)
    return p


def page(svs_id: int) -> dict:
    """SVS page JSON (always refreshed: it tells us when frames change)."""
    return json.loads(cached(API.format(id=svs_id), "api", refresh=True).read_text())


def media_items(page_json: dict) -> list[dict]:
    out = []
    for g in page_json.get("media_groups", []):
        for it in g.get("items", []):
            inst = it.get("instance")
            if isinstance(inst, dict) and inst.get("url"):
                out.append(inst)
    return out


def frame_dirs(page_json: dict) -> list[dict]:
    return [i for i in media_items(page_json) if i.get("media_type") == "Frames"]


def find_media(page_json: dict, filename: str) -> str:
    for i in media_items(page_json):
        if i.get("filename") == filename or i["url"].endswith("/" + filename):
            return _https(i["url"])
    raise KeyError(f"{filename} not on SVS page")


def list_frames(dir_url: str) -> list[str]:
    """Absolute URLs of the image files in an SVS frame directory, sorted."""
    dir_url = _https(dir_url).rstrip("/") + "/"
    html = fetch_bytes(dir_url).decode("utf-8", "replace")
    hrefs = re.findall(r'href=["\']?([^"\'\s>]+\.(?:png|jpg|tif))', html, re.I)
    urls = sorted({urljoin(dir_url, h) for h in hrefs if "favicon" not in h and "/static/" not in h
                   and urljoin(dir_url, h).startswith(dir_url)})
    if not urls:
        raise RuntimeError(f"no frames listed at {dir_url}")
    return urls
