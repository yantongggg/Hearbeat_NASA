import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decode, sample, cellOf, neighbourhood, summarize, extremes, resolutionAt, type GridSpec, type Encoding } from '../src/data/grid';
import { checkManifest, type Manifest } from '../src/data/manifest';

const G1: GridSpec = { w: 360, h: 180, lat0: 89.5, lon0: -179.5, step: 1 };
const LIN: Encoding = { scale: 'linear', min: -40, max: 40 };
const LOG: Encoding = { scale: 'log', min: 0.4, max: 409.6 };
const enc = (v: number, e: Encoding) => {
  const u = e.scale === 'log' ? Math.log(v / e.min) / Math.log(e.max / e.min) : (v - e.min) / (e.max - e.min);
  return 1 + Math.round(Math.max(0, Math.min(1, u)) * 254);
};
const fill = (g: GridSpec, f: (lat: number, lon: number) => number, e: Encoding) => {
  const q = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) q[y * g.w + x] = enc(f(g.lat0 - y * g.step, g.lon0 + x * g.step), e);
  return q;
};

describe('grid decoding (docs/DATA.md)', () => {
  it('maps codes to values on linear and log scales; 0 is no data', () => {
    expect(decode(0, LIN)).toBeNull();
    expect(decode(1, LIN)).toBeCloseTo(-40);
    expect(decode(255, LIN)).toBeCloseTo(40);
    expect(decode(128, LIN)).toBeCloseTo(0, 0);
    expect(decode(1, LOG)).toBeCloseTo(0.4);
    expect(decode(255, LOG)).toBeCloseTo(409.6, 3);
    expect(decode(128, LOG)!).toBeCloseTo(Math.sqrt(0.4 * 409.6), 0);
  });
  it('reports the storage resolution', () => {
    expect(resolutionAt(10, LIN)).toBeCloseTo(80 / 254);
    expect(resolutionAt(100, LOG) / 100).toBeCloseTo(Math.pow(1024, 1 / 254) - 1, 6);
  });
  it('finds cells: row 0 is the north, column 0 is the dateline', () => {
    expect(cellOf(89.5, -179.5, G1)).toEqual([0, 0]);
    expect(cellOf(-89.5, 179.5, G1)).toEqual([179, 359]);
    expect(cellOf(3.14, 101.69, G1)).toEqual([86, 281]);
    expect(cellOf(0, 180.5, G1)[1]).toBe(0); // wraps
  });
  it('samples bilinearly, ignoring no-data neighbours', () => {
    const q = fill(G1, lat => lat / 3, LIN);
    expect(sample(q, 10, 20, G1, LIN)!).toBeCloseTo(10 / 3, 0);
    q.fill(0);
    expect(sample(q, 10, 20, G1, LIN)).toBeNull();
    const [y, x] = cellOf(10, 20, G1);
    q[y * G1.w + x] = enc(7, LIN);
    expect(sample(q, 10, 20, G1, LIN)!).toBeCloseTo(7, 0);
  });
  it('knows which side the rain is on (east is positive) and how much of the area has it', () => {
    const e: Encoding = { scale: 'log', min: 0.1, max: 20 };
    const east = fill(G1, (lat, lon) => (lon > 105 && lon < 112 && Math.abs(lat) < 6 ? 10 : 0.1), e);
    const n = neighbourhood(east, 3, 101.7, G1, e, 1000, 0.5);
    expect(n.pan).toBeGreaterThan(0.7);
    expect(n.coverage).toBeGreaterThan(0.05);
    expect(n.peak!.v).toBeGreaterThan(9);
    const west = fill(G1, (lat, lon) => (lon > 92 && lon < 98 && Math.abs(lat) < 6 ? 10 : 0.1), e);
    expect(neighbourhood(west, 3, 101.7, G1, e, 1000, 0.5).pan).toBeLessThan(-0.7);
    const dry = fill(G1, () => 0.1, e);
    expect(neighbourhood(dry, 3, 101.7, G1, e, 1000, 0.5).coverage).toBe(0);
  });
  it('summarises with area weights and picks separated extremes', () => {
    const q = fill(G1, lat => (lat > 60 ? 30 : 0), LIN);
    const s = summarize(q, G1, LIN);
    expect(s.validFraction).toBe(1);
    expect(s.mean!).toBeGreaterThan(0.5); expect(s.mean!).toBeLessThan(3); // polar cap is a small share of the area
    const ex = extremes(s.cells, G1, 3, 2000);
    expect(ex).toHaveLength(3);
    expect(ex.every(e => e.v > 29)).toBe(true);
  });
});

describe('manifest checks', () => {
  it('rejects bad manifests with a readable reason', () => {
    expect(() => checkManifest(null)).toThrow(/missing/);
    expect(() => checkManifest({ version: 1, layers: {} })).toThrow(/version/);
    expect(() => checkManifest({ version: 2, layers: { a: { steps: [] } } })).toThrow(/no steps/);
  });
  const real = resolve(__dirname, '../public/data/manifest.json');
  it.runIf(existsSync(real))('accepts the committed NASA data and every theme points at a real, non-simulated layer', () => {
    const m = JSON.parse(readFileSync(real, 'utf8')) as Manifest;
    checkManifest(m);
    for (const id of ['rain', 'air', 'climate', 'lights', 'lightning']) {
      const key = m.themes[id]?.layer; expect(key, id).toBeTruthy();
      const l = m.layers[key!]; expect(l, `${id} → ${key}`).toBeTruthy();
      expect(l.simulated).toBe(false);
      expect(l.steps.length).toBeGreaterThan(4);
      const g = readFileSync(resolve(__dirname, '../public/data', l.steps[l.steps.length - 1].grid));
      expect(g.length).toBe(l.grid.w * l.grid.h);
      // every track has a globe picture: the data layer lifted off NASA's frame (RGBA WebP)
      const img = l.steps[l.steps.length - 1].image; expect(img, id).toMatch(/\.webp$/);
      expect(existsSync(resolve(__dirname, '../public/data', img!))).toBe(true);
      expect(l.picture?.mode, id).not.toBe('none');
    }
    // the accuracy test showed the PM2.5 picture cannot be read reliably, so its numbers must be NASA model output
    expect(m.layers[m.themes.air.layer].source.values?.from).toBe('nasa-model-output');
    expect(m.errors).toEqual({});
    // night lights: NASA's EIC visualization SVS 5313 (in the challenge resources), one step per year 2012-2023
    const nl = m.layers[m.themes.lights.layer];
    expect(nl.source.kind).toBe('eic-svs-movie');
    expect(nl.source.svs).toBe(5313);
    expect(nl.steps.map(s => s.t)).toEqual(Array.from({ length: 12 }, (_, i) => String(2012 + i)));
    // lightning: SVS 5011 (in the challenge resources), twelve calendar months
    const lg = m.layers[m.themes.lightning.layer];
    expect(lg.source.svs).toBe(5011);
    expect(lg.time.label).toBe('month');
    expect(lg.steps.map(s => s.t)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')));
  });
  it.runIf(existsSync(real))('lightning seen from the ISS follows the summer, stays within the station\'s reach, and keeps off the open ocean', () => {
    const m = JSON.parse(readFileSync(real, 'utf8')) as Manifest, l = m.layers.lightning;
    const at = (month: number, lat: number, lon: number) => {
      const s = l.steps[month - 1];
      return sample(new Uint8Array(readFileSync(resolve(__dirname, '../public/data', s.grid))), lat, lon, l.grid, l.encoding)!;
    };
    expect(at(7, 28, -81)).toBeGreaterThan(at(1, 28, -81) * 10);          // Florida: summer storms
    expect(at(1, -26.2, 28.05)).toBeGreaterThan(at(7, -26.2, 28.05) * 10); // Johannesburg: southern summer
    expect(at(1, -12.46, 130.84)).toBeGreaterThan(at(7, -12.46, 130.84) * 10);   // Darwin: the wet season
    for (let mo = 1; mo <= 12; mo++) {
      expect(at(mo, 3.14, 101.69)).toBeGreaterThan(10);                    // Kuala Lumpur: storms all year
      expect(at(mo, 70, 20)).toBeLessThan(.0105);                          // beyond the ISS's reach: nothing
    }
    expect(at(1, -10, -140)).toBeLessThan(.5);                            // open Pacific in January: hardly any
  });
  it.runIf(existsSync(real))('night lights: dark ocean, bright cities, and places that changed as the news says', () => {
    const m = JSON.parse(readFileSync(real, 'utf8')) as Manifest, l = m.layers.lights;
    const at = (year: number, lat: number, lon: number) => {
      const s = l.steps.find(x => x.t === String(year))!;
      return sample(new Uint8Array(readFileSync(resolve(__dirname, '../public/data', s.grid))), lat, lon, l.grid, l.encoding)!;
    };
    expect(at(2016, 0, -150)).toBeLessThan(1);                                   // mid-Pacific: dark
    expect(at(2016, 23, 10)).toBeLessThan(1);                                    // Sahara: dark
    for (const [lat, lon] of [[35.68, 139.69], [40.71, -74], [30.04, 31.24]]) expect(at(2016, lat, lon)).toBeGreaterThan(20);   // Tokyo, New York, Cairo
    expect(at(2023, 28.61, 77.21)).toBeGreaterThan(at(2012, 28.61, 77.21) * 1.2);   // Delhi grew brighter
    expect(at(2023, 50.45, 30.52)).toBeLessThan(at(2021, 50.45, 30.52) * .8);       // Kyiv darker after 2022 (war, power cuts)
  });
});
