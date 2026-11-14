import { describe, expect, it } from 'vitest';
import { cellsIn, rainGoal, nearestAtLeast, dryStart, pickPartner, worstDay, feverBand, toCsv, inBox, SEA, PARTNERS, KL } from '../src/data/checkup-logic';
import type { GridSpec, Encoding } from '../src/data/grid';

const g: GridSpec = { w: 4, h: 2, lat0: 10, lon0: 100, step: 10 };   // cells at lat 10/0, lon 100..130
const lin: Encoding = { scale: 'linear', min: 0, max: 254 };          // code q -> value q-1

describe('check-up answers come from the data on screen', () => {
  it('rain: goal is 60% of the box maximum (at least 0.5), and the hint points at the nearest such cell', () => {
    const q = new Uint8Array([1, 3, 11, 0, 1, 1, 5, 2]);              // values 0,2,10,-,0,0,4,1
    const cells = cellsIn(q, g, lin, { s: -5, n: 15, w: 95, e: 135 });
    expect(cells).toHaveLength(7);                                   // no-data cell skipped
    expect(rainGoal(cells)).toBe(6);
    const n = nearestAtLeast(cells, { lat: 10, lon: 100 }, 6)!;
    expect([n.lat, n.lon, n.v]).toEqual([10, 120, 10]);
    expect(rainGoal([{ lat: 0, lon: 0, v: 0.3 }])).toBe(0.5);
    const start = dryStart(cells, 6, [{ lat: 10, lon: 120 }, { lat: 0, lon: 100 }]);
    expect(start).toEqual({ lat: 0, lon: 100 });                     // the candidate farthest from the rain
    expect(inBox(3, 101, SEA) && !inBox(30, 101, SEA)).toBe(true);
  });
  it('air: the partner city must differ clearly from Kuala Lumpur (1.5x), else the most different', () => {
    const vals = PARTNERS.map((city, i) => ({ city, v: [35, 31, 60, 20, null, 30, 30, 30][i] as number | null }));
    expect(pickPartner(30, vals)!.city.id).toBe('kuching');          // Jakarta 35 and Singapore 31 are too close
    expect(pickPartner(30, PARTNERS.map(city => ({ city, v: 31 })))!.city.id).toBe('jakarta');
    expect(pickPartner(30, PARTNERS.map(city => ({ city, v: null })))).toBeNull();
    expect(KL.en).toBe('Kuala Lumpur');
  });
  it('haze: the worst day is the day with the highest mean', () => {
    const w = worstDay([
      { t: '2026-11-01T00:00Z', v: 10 }, { t: '2026-11-01T12:00Z', v: 50 },
      { t: '2026-11-02T00:00Z', v: 25 }, { t: '2026-11-02T12:00Z', v: 25 }, { t: '2026-11-03T00:00Z', v: null }
    ])!;
    expect(w.day).toBe('2026-11-01');
    expect(w.days.map(d => d.day)).toEqual(['2026-11-01', '2026-11-02']);
  });
  it('fever: answer bands around the 1951-1980 baseline', () => {
    expect([-1, -0.2, 0.5, 0.51, 1.05, 1.5, 1.6].map(feverBand)).toEqual(['cooler', 'same', 'same', 'warmer', 'warmer', 'warmer', 'much']);
  });
  it('the log exports as CSV with a header and quoted text', () => {
    const csv = toCsv([{ when: '2026-11-06T10:00:00Z', checkup: 'air', mode: 'eyes-closed', lang: 'en', seconds: 42.25, result: 'correct', hints: 1, detail: 'picked Kuala Lumpur, "KL"' }]);
    expect(csv.split('\n')[0]).toBe('when,checkup,mode,language,seconds,result,hints,detail');
    expect(csv.split('\n')[1]).toBe('2026-11-06T10:00:00Z,air,eyes-closed,en,42.3,correct,1,"picked Kuala Lumpur, ""KL"""');
  });
});
