/** Value grids (docs/DATA.md): uint8 per cell, 0 = no data, 1..255 = value on a linear or log scale. Pure functions. */

export interface Encoding { scale: 'linear' | 'log'; min: number; max: number }
export interface GridSpec { w: number; h: number; lat0: number; lon0: number; step: number }

export function decode(q: number, e: Encoding): number | null {
  if (q === 0) return null;
  const u = (q - 1) / 254;
  return e.scale === 'log'
    ? Math.exp(Math.log(e.min) + u * (Math.log(e.max) - Math.log(e.min)))
    : e.min + u * (e.max - e.min);
}

/** Smallest value step between neighbouring codes near v (the storage resolution). */
export function resolutionAt(v: number, e: Encoding): number {
  if (e.scale === 'linear') return (e.max - e.min) / 254;
  return v * (Math.pow(e.max / e.min, 1 / 254) - 1);
}

export function cellOf(lat: number, lon: number, g: GridSpec): [number, number] {
  const y = Math.max(0, Math.min(g.h - 1, Math.round((g.lat0 - lat) / g.step)));
  let x = Math.round((lon - g.lon0) / g.step) % g.w; if (x < 0) x += g.w;
  return [y, x];
}

export function cellCentre(y: number, x: number, g: GridSpec): [number, number] {
  return [g.lat0 - y * g.step, g.lon0 + x * g.step];
}

export const valueAtCell = (q: Uint8Array, y: number, x: number, g: GridSpec, e: Encoding) => decode(q[y * g.w + x], e);

/** Bilinear sample that ignores no-data cells. Returns null when every neighbour is empty. */
export function sample(q: Uint8Array, lat: number, lon: number, g: GridSpec, e: Encoding): number | null {
  const fy = (g.lat0 - lat) / g.step, fx = (lon - g.lon0) / g.step;
  const y0 = Math.floor(fy), x0 = Math.floor(fx), ty = fy - y0, tx = fx - x0;
  let acc = 0, wsum = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const y = Math.max(0, Math.min(g.h - 1, y0 + dy));
    const x = (((x0 + dx) % g.w) + g.w) % g.w;
    const v = decode(q[y * g.w + x], e);
    if (v == null) continue;
    const wt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) + 1e-6;
    acc += v * wt; wsum += wt;
  }
  return wsum > 0 ? acc / wsum : null;
}

const R = 6371, D2R = Math.PI / 180;
export function distKm(a1: number, o1: number, a2: number, o2: number) {
  const p1 = a1 * D2R, p2 = a2 * D2R, dp = (a2 - a1) * D2R, dl = (o2 - o1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Neighbourhood {
  /** fraction of valid cells within the radius whose value passes the threshold */
  coverage: number;
  /** -1 (west) … 1 (east): where the passing cells lie, weighted by value and closeness */
  pan: number;
  /** strongest value within the radius, its distance (km) and position */
  peak: { v: number; km: number; lat: number; lon: number } | null;
  valid: number;
}

/** What is around a point: how much of the area passes `threshold`, and to which side it lies. */
export function neighbourhood(q: Uint8Array, lat: number, lon: number, g: GridSpec, e: Encoding,
  radiusKm: number, threshold: number): Neighbourhood {
  const span = Math.ceil(radiusKm / 111 / g.step) + 1;
  const [cy, cx] = cellOf(lat, lon, g);
  let valid = 0, pass = 0, panAcc = 0, panW = 0;
  let peak: Neighbourhood['peak'] = null;
  for (let dy = -span; dy <= span; dy++) {
    const y = cy + dy; if (y < 0 || y >= g.h) continue;
    const xs = Math.min(g.w / 2, Math.ceil(span / Math.max(0.15, Math.cos((g.lat0 - y * g.step) * D2R))));
    for (let dx = -xs; dx <= xs; dx++) {
      const x = (((cx + dx) % g.w) + g.w) % g.w;
      const [la, lo] = cellCentre(y, x, g);
      const km = distKm(lat, lon, la, lo);
      if (km > radiusKm) continue;
      const v = decode(q[y * g.w + x], e);
      if (v == null) continue;
      valid++;
      if (v >= threshold) {
        pass++;
        // east–west component of the direction to this cell (−1 due west … 1 due east)
        let dl = lo - lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
        const dxKm = dl * 111.32 * Math.cos(lat * D2R);
        const east = km > 1 ? Math.max(-1, Math.min(1, dxKm / km)) : 0;
        const w = v / (1 + km / 300);
        panAcc += east * w; panW += w;
      }
      if (!peak || v > peak.v) peak = { v, km, lat: la, lon: lo };
    }
  }
  return { coverage: valid ? pass / valid : 0, pan: panW ? Math.max(-1, Math.min(1, panAcc / panW)) : 0, peak, valid };
}

/** Area-weighted mean and the n highest / lowest cells, for frame descriptions. */
export function summarize(q: Uint8Array, g: GridSpec, e: Encoding) {
  let acc = 0, wsum = 0, valid = 0;
  const cells: Array<[number, number, number]> = [];
  for (let y = 0; y < g.h; y++) {
    const cw = Math.cos((g.lat0 - y * g.step) * D2R);
    for (let x = 0; x < g.w; x++) {
      const v = decode(q[y * g.w + x], e);
      if (v == null) continue;
      valid++; acc += v * cw; wsum += cw;
      cells.push([v, y, x]);
    }
  }
  return { mean: wsum ? acc / wsum : null, validFraction: valid / (g.w * g.h), cells };
}

/** Pick up to n extreme cells at least minKm apart (so three hot spots are three different places). */
export function extremes(cells: Array<[number, number, number]>, g: GridSpec, n: number, minKm: number, high = true) {
  const sorted = cells.slice().sort((a, b) => (high ? b[0] - a[0] : a[0] - b[0]));
  const out: Array<{ v: number; lat: number; lon: number }> = [];
  for (const [v, y, x] of sorted) {
    const [lat, lon] = cellCentre(y, x, g);
    if (out.every(o => distKm(o.lat, o.lon, lat, lon) >= minKm)) out.push({ v, lat, lon });
    if (out.length >= n) break;
  }
  return out;
}
