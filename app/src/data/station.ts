/**
 * Where the International Space Station is, from NASA's predicted trajectory (station.json, written by
 * pipeline/hearthbeat_pipeline/station.py from NASA JSC's CCSDS OEM file). Pure functions, unit-tested.
 *
 * NASA gives position and velocity every 4 minutes in the EME2000 (J2000) frame. Between two states the
 * position is a cubic Hermite curve; it is then turned to the Earth: IAU 1976 precession to the date, then
 * the Greenwich mean sidereal time (nutation, under 0.01 degrees, is ignored), then latitude on the WGS 84
 * ellipsoid. Checked against the file itself: at the ascending-node epochs NASA lists, latitude is 0.00
 * degrees and longitude matches NASA's to 0.0001 degrees (tests/station.test.ts).
 * Outside the file's time span there is no position: the app says so rather than guess.
 */
export interface StationFile {
  object: string; objectId?: string;
  source: { name: string; originator?: string; created?: string | null; url: string; downloaded?: string };
  frame: string; timeSystem: string; start: string; stop: string;
  ascendingNodes?: Array<{ t: string; orbit: number; lonDeg: number }>;
  notes?: string;
  t0: string; s: number[]; r: number[][];
}
export interface Fix { t: number; lat: number; lon: number; altKm: number }

const D2R = Math.PI / 180, AS2R = D2R / 3600;
const jd = (ms: number) => ms / 86400000 + 2440587.5;

/** Greenwich mean sidereal time, radians (IAU 1982, as in Meeus 12.4). */
export function gmst(ms: number) {
  const d = jd(ms) - 2451545, T = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T * T * T / 38710000;
  return (((deg % 360) + 360) % 360) * D2R;
}

/** J2000 vector to the mean equator and equinox of the date (IAU 1976 precession). */
export function precess(r: number[], ms: number) {
  const T = (jd(ms) - 2451545) / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * AS2R;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * AS2R;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * AS2R;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(z), sZ = Math.sin(z), ct = Math.cos(th), st = Math.sin(th);
  const P = [[cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
    [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
    [st * cz, -st * sz, ct]];
  return P.map(row => row[0] * r[0] + row[1] * r[1] + row[2] * r[2]);
}

/** Inertial (J2000) position at time `ms` to latitude, longitude (degrees) and height (km) on WGS 84. */
export function toEarth(r: number[], ms: number): { lat: number; lon: number; altKm: number } {
  const [x, y, z] = precess(r, ms), g = gmst(ms);
  const xe = Math.cos(g) * x + Math.sin(g) * y, ye = -Math.sin(g) * x + Math.cos(g) * y;
  const A = 6378.137, e2 = 6.69437999014e-3, p = Math.hypot(xe, ye);
  let lat = Math.atan2(z, p * (1 - e2)), alt = 0;
  for (let i = 0; i < 5; i++) {
    const N = A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    alt = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - e2 * N / (N + alt)));
  }
  return { lat: lat / D2R, lon: Math.atan2(ye, xe) / D2R, altKm: alt };
}

const t0Of = (f: StationFile) => Date.parse(f.t0);
/** Does the file cover this moment? */
export const covers = (f: StationFile | null, ms: number) => !!f && f.r.length > 1 && ms >= t0Of(f) + f.s[0] * 1000 && ms <= t0Of(f) + f.s[f.s.length - 1] * 1000;

/** J2000 position (km) at `ms`, by cubic Hermite interpolation between NASA's states; null outside the file. */
export function positionAt(f: StationFile, ms: number): number[] | null {
  if (!covers(f, ms)) return null;
  const sec = (ms - t0Of(f)) / 1000;
  let lo = 0, hi = f.s.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f.s[mid] <= sec) lo = mid; else hi = mid; }
  const a = f.r[lo], b = f.r[hi], h = f.s[hi] - f.s[lo];
  if (h <= 0) return a.slice(0, 3);
  const s = (sec - f.s[lo]) / h, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return [0, 1, 2].map(k => h00 * a[k] + h10 * h * a[k + 3] + h01 * b[k] + h11 * h * b[k + 3]);
}

/** Where on Earth the station is at `ms` (null outside the file). */
export function stationAt(f: StationFile | null, ms: number): Fix | null {
  if (!f) return null;
  const r = positionAt(f, ms); if (!r) return null;
  return { t: ms, ...toEarth(r, ms) };
}

/** The ground track from `ms` for `minutes`, one point every `stepSec` seconds (stops where the file ends). */
export function groundTrack(f: StationFile | null, ms: number, minutes: number, stepSec = 30): Fix[] {
  const out: Fix[] = [];
  for (let t = ms; t <= ms + minutes * 60000; t += stepSec * 1000) { const p = stationAt(f, t); if (!p) break; out.push(p); }
  return out;
}

/** Great-circle distance in km between two points (mean Earth radius). */
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The moment in the next `hours` when the station's ground point comes closest to `home` (null if the file ends first). */
export function closestPass(f: StationFile | null, home: { lat: number; lon: number }, ms: number, hours = 24): { t: number; km: number; fix: Fix } | null {
  let best: { t: number; km: number; fix: Fix } | null = null;
  for (let t = ms; t <= ms + hours * 3600000; t += 30000) {
    const p = stationAt(f, t); if (!p) break;
    const km = kmBetween(p, home); if (!best || km < best.km) best = { t, km, fix: p };
  }
  if (!best) return null;
  for (let t = best.t - 30000; t <= best.t + 30000; t += 2000) {   // refine to 2 seconds
    const p = stationAt(f, t); if (!p) continue;
    const km = kmBetween(p, home); if (km < best.km) best = { t, km, fix: p };
  }
  return best;
}
