/**
 * The answers to the four check-ups, computed from the NASA grids shown at that moment.
 * Pure functions (no DOM, no state), so they are unit-tested.
 */
import { decode, distKm, type Encoding, type GridSpec } from './grid';

export interface Box { s: number; n: number; w: number; e: number }
/** Southeast Asia, where check-up 1 asks for rain. */
export const SEA: Box = { s: -11, n: 22, w: 92, e: 135 };
export const inBox = (lat: number, lon: number, b: Box) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;

export interface Cell { lat: number; lon: number; v: number }

/** Every valid cell inside a box. */
export function cellsIn(q: Uint8Array, g: GridSpec, e: Encoding, b: Box): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < g.h; y++) {
    const lat = g.lat0 - y * g.step; if (lat < b.s || lat > b.n) continue;
    for (let x = 0; x < g.w; x++) {
      const lon = g.lon0 + x * g.step; if (lon < b.w || lon > b.e) continue;
      const v = decode(q[y * g.w + x], e); if (v != null) out.push({ lat, lon, v });
    }
  }
  return out;
}

/**
 * Check-up 1 goal: a rain rate that only the wetter places in the box reach (60 % of the box's
 * maximum, rounded to 0.1, at least 0.5 mm/h), so the listener has to search for it.
 */
export function rainGoal(cells: Cell[]): number {
  const max = cells.reduce((m, c) => Math.max(m, c.v), 0);
  return Math.max(0.5, Math.round(max * 0.6 * 10) / 10);
}

/** The closest cell at or above `goal` (for the direction hint). */
export function nearestAtLeast(cells: Cell[], from: { lat: number; lon: number }, goal: number): (Cell & { km: number }) | null {
  let best: (Cell & { km: number }) | null = null;
  for (const c of cells) {
    if (c.v < goal) continue;
    const km = distKm(from.lat, from.lon, c.lat, c.lon);
    if (!best || km < best.km) best = { ...c, km };
  }
  return best;
}

/** A dry place in the box to start check-up 1 from (the cell farthest from any goal-level rain). */
export function dryStart(cells: Cell[], goal: number, candidates: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  let best = candidates[0], bestKm = -1;
  for (const p of candidates) {
    const n = nearestAtLeast(cells, p, goal); const km = n ? n.km : 1e9;
    if (km > bestKm) { bestKm = km; best = p; }
  }
  return best;
}

export interface City { id: string; en: string; zh: string; lat: number; lon: number }
export const KL: City = { id: 'kl', en: 'Kuala Lumpur', zh: '吉隆坡', lat: 3.14, lon: 101.69 };
/** Partner cities for check-up 2, in order of preference (nearest to Malaysian students first). */
export const PARTNERS: City[] = [
  { id: 'jakarta', en: 'Jakarta', zh: '雅加达', lat: -6.2, lon: 106.85 },
  { id: 'singapore', en: 'Singapore', zh: '新加坡', lat: 1.35, lon: 103.82 },
  { id: 'kuching', en: 'Kuching', zh: '古晋', lat: 1.55, lon: 110.34 },
  { id: 'bangkok', en: 'Bangkok', zh: '曼谷', lat: 13.75, lon: 100.5 },
  { id: 'hcmc', en: 'Ho Chi Minh City', zh: '胡志明市', lat: 10.82, lon: 106.63 },
  { id: 'manila', en: 'Manila', zh: '马尼拉', lat: 14.6, lon: 120.98 },
  { id: 'hanoi', en: 'Hanoi', zh: '河内', lat: 21.03, lon: 105.85 },
  { id: 'delhi', en: 'New Delhi', zh: '新德里', lat: 28.61, lon: 77.21 }
];

/**
 * Check-up 2 partner: the first city whose PM2.5 differs from Kuala Lumpur's by at least 1.5x
 * (so the answer is clear by ear); if none does, the one that differs most.
 */
export function pickPartner(klV: number, vals: Array<{ city: City; v: number | null }>): { city: City; v: number } | null {
  const ok = vals.filter((x): x is { city: City; v: number } => x.v != null && x.v > 0 && klV > 0);
  const clear = ok.find(x => Math.max(x.v / klV, klV / x.v) >= 1.5);
  if (clear) return clear;
  return ok.sort((a, b) => Math.abs(Math.log(b.v / klV)) - Math.abs(Math.log(a.v / klV)))[0] ?? null;
}

/** Check-up 3: the UTC day with the highest mean value (steps are ISO "YYYY-MM-DDTHH:MMZ"). */
export function worstDay(series: Array<{ t: string; v: number | null }>): { day: string; mean: number; days: Array<{ day: string; mean: number }> } | null {
  const by = new Map<string, number[]>();
  for (const s of series) { if (s.v == null) continue; const d = s.t.slice(0, 10); (by.get(d) ?? by.set(d, []).get(d)!).push(s.v); }
  const days = [...by.entries()].map(([day, vs]) => ({ day, mean: vs.reduce((a, b) => a + b, 0) / vs.length })).sort((a, b) => a.day.localeCompare(b.day));
  if (!days.length) return null;
  const top = days.reduce((m, d) => (d.mean > m.mean ? d : m));
  return { day: top.day, mean: top.mean, days };
}

/** Check-up 4 answer bands for an annual anomaly against 1951–1980 (°C). */
export type FeverBand = 'cooler' | 'same' | 'warmer' | 'much';
export const FEVER_BANDS: FeverBand[] = ['cooler', 'same', 'warmer', 'much'];
/** Bands are wide (1 °C) so the answer is never a hair from a boundary that no ear could tell apart. */
export function feverBand(v: number): FeverBand {
  if (v < -0.5) return 'cooler';
  if (v <= 0.5) return 'same';
  if (v <= 1.5) return 'warmer';
  return 'much';
}

/** One row of the check-up log (CSV export). */
export interface LogRow { when: string; checkup: string; mode: 'eyes-open' | 'eyes-closed'; lang: string; seconds: number; result: 'found' | 'correct' | 'wrong' | 'skipped'; hints: number; detail: string }
export const CSV_HEAD = 'when,checkup,mode,language,seconds,result,hints,detail';
export function toCsv(rows: LogRow[]): string {
  const esc = (s: string | number) => { const t = String(s); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [CSV_HEAD, ...rows.map(r => [r.when, r.checkup, r.mode, r.lang, r.seconds.toFixed(1), r.result, r.hints, r.detail].map(esc).join(','))].join('\n');
}
