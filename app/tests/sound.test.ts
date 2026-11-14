import { describe, expect, it } from 'vitest';
import { rainParams, airParams, climateParams, lightsParams, lightningParams, pentaMidi, hapticFor, CLIMATE_LO, CLIMATE_HI } from '../src/audio/mapping';
import { THEMES, category } from '../src/themes';

const none = { coverage: 0, pan: 0 };
const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);
const decreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x <= xs[i - 1]);

describe('the sound is driven by the data', () => {
  const rain = [0, 0.05, 0.2, 1, 2.5, 5, 7.6, 12, 20, 40];
  it('rain: more rain → more drops, darker music, drum only in heavy rain', () => {
    const p = rain.map(v => rainParams(v, none));
    expect(p[0].dropsPerSec).toBe(0);
    expect(p[1].dropsPerSec).toBe(0);                 // below 0.1 mm/h counts as dry
    expect(increasing(p.map(x => x.dropsPerSec))).toBe(true);
    expect(p[8].dropsPerSec).toBeGreaterThan(p[3].dropsPerSec * 2);
    expect(p[9].dropsPerSec).toBeLessThanOrEqual(10);                  // never a wall of sound
    expect(decreasing(p.map(x => x.brightness))).toBe(true);
    expect(p.map(x => x.drum)).toEqual(rain.map(v => v >= 7.6));
    expect(increasing(p.map(x => x.preciseHz))).toBe(true);
  });
  it('rain: nearby rain is heard from its side', () => {
    expect(rainParams(0, { coverage: .3, pan: .8 }).pan).toBe(.8);
    expect(rainParams(0, { coverage: .3, pan: -.8 }).pan).toBe(-.8);
    expect(rainParams(0, { coverage: 0, pan: 0 }).rush).toBe(0);
    expect(rainParams(0, { coverage: .3, pan: 0 }).rush).toBeGreaterThan(0);
  });
  it('air: dirtier → more muffled; above the WHO guideline a heartbeat joins in and grows faster', () => {
    const pm = [1, 5, 15, 16, 25, 37.5, 50, 75, 150, 400];
    const p = pm.map(v => airParams(v, none));
    expect(decreasing(p.map(x => x.cutoffHz))).toBe(true);
    expect(p[0].cutoffHz).toBeGreaterThan(8000);
    expect(p[9].cutoffHz).toBeLessThan(400);
    expect(p.map(x => x.dark)).toEqual(pm.map(v => v > 15));
    expect(p.slice(0, 3).every(x => x.beat === 0)).toBe(true);
    expect(p[3].beat).toBeGreaterThan(0);
    expect(increasing(p.map(x => x.beat))).toBe(true);
    expect(p[8].beat).toBe(1);
    // the heartbeat's speed carries the value: clearly different speeds for typical city air
    expect(p.slice(0, 3).every(x => x.bpm === 0)).toBe(true);
    expect(increasing(p.map(x => x.bpm))).toBe(true);
    expect(p[8].bpm).toBe(140);
    expect(airParams(56, none).bpm - airParams(29, none).bpm).toBeGreaterThan(20);   // two days in Kuala Lumpur
    expect(airParams(90, none).bpm - airParams(24, none).bpm).toBeGreaterThan(40);   // Jakarta vs Kuala Lumpur
  });
  it('climate: warmer → higher note; global mean sets the drone; missing data is not a note', () => {
    const a = [-3, -2, -1, 0, 0.5, 1, 2, 3, 4, 6];
    const p = a.map(v => climateParams(v, 0));
    expect(increasing(p.map(x => x.midi))).toBe(true);
    expect(p[9].midi - p[1].midi).toBeGreaterThanOrEqual(24);       // two octaves across the range
    expect(climateParams(CLIMATE_LO, 0).midi).toBe(57);
    expect(climateParams(CLIMATE_HI, 0).midi).toBe(pentaMidi(57, 12));
    expect(climateParams(1, -0.5).droneMidi).toBeLessThan(climateParams(1, 1.2).droneMidi);
    expect(climateParams(null, 0).hasData).toBe(false);
  });
  it('melody notes stay in the key of the chords (A major pentatonic for Climate: warm, not minor)', () => {
    const pcs = new Set([-3, -2, -1, 0, 0.7, 1.4, 2, 3, 4].map(v => climateParams(v, 0).midi % 12));
    for (const pc of pcs) expect([9, 11, 1, 4, 6]).toContain(pc);   // A B C# E F#
    const maj = new Set(Array.from({ length: 10 }, (_, i) => pentaMidi(62, i) % 12));
    expect([...maj].sort((a, b) => a - b)).toEqual([2, 4, 6, 9, 11]);   // D major pentatonic (Rain)
  });
  it('haptics get longer for worse classes', () => {
    expect(hapticFor(0)).toEqual([12]);
    expect(hapticFor(1)[0]).toBeGreaterThan(hapticFor(.33)[0]);
  });
});

describe('categories', () => {
  it('rain uses the AMS intensity classes', () => {
    const r = THEMES.rain;
    expect(category(r, 0.05)!.en).toBe('dry');
    expect(category(r, 1)!.en).toBe('light rain');
    expect(category(r, 5)!.en).toBe('moderate rain');
    expect(category(r, 8)!.en).toBe('heavy rain');
    expect(category(r, null)).toBeNull();
  });
  it('air uses the WHO 2021 guideline and interim targets', () => {
    const a = THEMES.air;
    expect(category(a, 10)!.en).toMatch(/within/);
    expect(category(a, 20)!.en).toMatch(/above/);
    expect(category(a, 60)!.en).toBe('very high');
    expect(category(a, 200)!.en).toBe('extremely high');
  });
  it('every theme legend plays three increasing values in different classes', () => {
    for (const t of Object.values(THEMES)) {
      expect(t.legend).toHaveLength(3);
      expect(increasing(t.legend)).toBe(true);
      const cats = t.legend.map(v => category(t, v)!.en);
      expect(new Set(cats).size).toBe(3);
    }
  });
  it('night lights: dark is silent; more light, more twinkles (1 to 8 a second), never above 8', () => {
    expect(lightsParams(0).twinklesPerSec).toBe(0);
    expect(lightsParams(.5).twinklesPerSec).toBe(0);
    expect(lightsParams(null).twinklesPerSec).toBe(0);
    const vs = [1, 3, 8, 20, 40, 60, 100], t = vs.map(v => lightsParams(v).twinklesPerSec);
    expect(increasing(t)).toBe(true);
    expect(t[0]).toBeCloseTo(1, 6); expect(Math.max(...t)).toBeCloseTo(8, 6);
    expect(category(THEMES.lights, 0)!.en).toBe('dark');
    expect(category(THEMES.lights, 30)!.en).toBe('bright city lights');
  });
  it('lightning: none seen is silent; more lightning, more marimba taps (1 to 6 a second), never above 6', () => {
    expect(lightningParams(.01).tapsPerSec).toBe(0);
    expect(lightningParams(null).tapsPerSec).toBe(0);
    const vs = [.05, .3, 2, 10, 30, 50, 100], t = vs.map(v => lightningParams(v).tapsPerSec);
    expect(increasing(t.slice(0, 6))).toBe(true);
    expect(t[0]).toBeCloseTo(1, 6); expect(Math.max(...t)).toBeCloseTo(6, 6);
    expect(category(THEMES.lightning, .01)!.en).toBe('no lightning seen');
    expect(category(THEMES.lightning, 25)!.en).toBe('very frequent lightning');
  });
});
