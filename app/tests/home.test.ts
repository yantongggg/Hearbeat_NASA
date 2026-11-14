import { describe, expect, it } from 'vitest';
import { HOMES, HOME_GROUPS, homeById, decadeMeans, whoMultiple, ageHours, isToday } from '../src/data/home-logic';

describe('Home', () => {
  it('offers Kuala Lumpur first, with unique ids and valid coordinates', () => {
    expect(HOME_GROUPS[0].cities[0].id).toBe('kl');
    expect(new Set(HOMES.map(c => c.id)).size).toBe(HOMES.length);
    for (const c of HOMES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      expect(c.en && c.zh).toBeTruthy();
    }
    expect(homeById('jakarta')!.en).toBe('Jakarta');
    expect(homeById('nowhere')).toBeUndefined();
  });
  it('warming: one note per decade, the mean of the years that have data', () => {
    const series = [
      { t: '1880', v: null }, { t: '1881', v: -0.4 }, { t: '1889', v: -0.2 },
      { t: '1890', v: null }, { t: '1899', v: null },
      { t: '2020', v: 1.0 }, { t: '2025', v: 1.2 }
    ];
    const d = decadeMeans(series);
    expect(d.map(x => x.decade)).toEqual([1880, 1890, 2020]);
    expect(d[0].v).toBeCloseTo(-0.3, 6);
    expect(d[0].years).toBe(2);
    expect(d[0].lastIndex).toBe(2);
    expect(d[1].v).toBeNull();                 // no data in the 1890s: a soft tap, not a made-up note
    expect(d[2].v).toBeCloseTo(1.1, 6);
    expect(d[2].lastIndex).toBe(6);
  });
  it('146 years (1880–2025) make 15 decade notes', () => {
    const series = Array.from({ length: 146 }, (_, i) => ({ t: String(1880 + i), v: i / 100 }));
    expect(decadeMeans(series)).toHaveLength(15);
  });
  it('air is stated as a multiple of the WHO guideline', () => {
    expect(whoMultiple(24)).toBe('1.6');
    expect(whoMultiple(90)).toBe('6');
    expect(whoMultiple(15)).toBe('1.0');
  });
  it('data is called "today" only when its newest step is within 36 hours', () => {
    const now = Date.parse('2026-11-13T04:00Z');
    expect(isToday('2026-11-13T00:00Z', now)).toBe(true);
    expect(isToday('2026-11-12T00:00Z', now)).toBe(true);     // 28 h old
    expect(isToday('2026-11-13T18:00Z', now)).toBe(true);     // a short forecast step
    expect(isToday('2026-11-04T18:00Z', now)).toBe(false);    // the 4 Nov build, nine days old
    expect(Math.round(ageHours('2026-11-04T18:00Z', now)! / 24)).toBe(8);
    expect(isToday('2025', now)).toBe(false);                 // a year is not a day
    expect(isToday('not a date', now)).toBe(false);
    expect(ageHours('not a date', now)).toBeNull();
  });
});
