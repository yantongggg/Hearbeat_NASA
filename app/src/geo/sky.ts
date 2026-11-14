import { D2R, clamp01 } from '../core/util';
import { CITIES, haversine } from './places';

/** Sub-solar point from the real current time. */
export const SUN = { lat: 0, lon: 0, utcH: 0 };
export function updateSun(now = new Date()) {
  const doy = (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5;
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  SUN.lat = -23.44 * Math.cos(2 * Math.PI / 365 * (doy + 10));
  SUN.lon = -15 * (utcH - 12);
  SUN.utcH = utcH;
}
export const cosZ = (lat: number, lon: number) => {
  const p = lat * D2R, s = SUN.lat * D2R;
  return Math.sin(p) * Math.sin(s) + Math.cos(p) * Math.cos(s) * Math.cos((lon - SUN.lon) * D2R);
};
/** 0 at night, 1 in daylight, smooth across the terminator. */
export const dayF = (cz: number) => { const x = clamp01((cz + 0.1) / 0.2); return x * x * (3 - 2 * x); };
export function localTime(lon: number) {
  let h = (SUN.utcH + lon / 15) % 24; if (h < 0) h += 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
export function lightsAt(lat: number, lon: number) {
  let s = 0;
  for (const c of CITIES) { if (!c[3]) continue; const d = haversine(lat, lon, c[1], c[2]); if (d < 900) s += c[3] * Math.exp(-((d / 320) ** 2)); }
  return clamp01(s);
}
