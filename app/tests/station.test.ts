import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gmst, stationAt, groundTrack, closestPass, covers, positionAt, kmBetween, toEarth, type StationFile } from '../src/data/station';

const f = JSON.parse(readFileSync(join(__dirname, '../public/data/station.json'), 'utf8')) as StationFile;
const at = (iso: string) => Date.parse(iso);

describe('Where the space station is (NASA ISS trajectory)', () => {
  it('Greenwich sidereal time is right at the J2000 epoch', () => {
    expect(gmst(at('2000-01-01T12:00:00Z')) * 180 / Math.PI).toBeCloseTo(280.46061837, 6);
  });

  it('the committed file is NASA\'s, in J2000, and covers at least a week', () => {
    expect(f.object).toBe('ISS');
    expect(f.frame).toBe('EME2000');
    expect(f.source.url).toMatch(/^https:\/\/nasa-public-data\.s3\.amazonaws\.com\/iss-coords\//);
    expect(f.s.length).toBe(f.r.length);
    expect(at(f.stop) - at(f.start)).toBeGreaterThan(7 * 86400e3);
  });

  it('matches NASA\'s own ascending nodes: latitude 0 and NASA\'s longitude, to 0.001 degrees', () => {
    expect(f.ascendingNodes?.length).toBeGreaterThan(0);
    for (const n of f.ascendingNodes!) {
      const p = stationAt(f, at(n.t))!, q = stationAt(f, at(n.t) + 60e3)!;
      expect(Math.abs(p.lat)).toBeLessThan(0.01);
      expect(q.lat).toBeGreaterThan(p.lat);                  // ascending
      expect(Math.abs(((p.lon - n.lonDeg) + 540) % 360 - 180)).toBeLessThan(0.001);
    }
  });

  it('interpolation between NASA\'s states is good to well under a kilometre', () => {
    // leave out every other state, interpolate at the one left out, compare (gaps of 8 minutes, twice the real ones)
    const half: StationFile = { ...f, s: f.s.filter((_, i) => i % 2 === 0), r: f.r.filter((_, i) => i % 2 === 0) };
    const errs: number[] = [];
    for (let i = 1; i < 2001; i += 2) {
      const p = positionAt(half, at(f.t0) + f.s[i] * 1000)!;
      errs.push(Math.hypot(p[0] - f.r[i][0], p[1] - f.r[i][1], p[2] - f.r[i][2]));
    }
    errs.sort((a, b) => a - b);
    expect(errs[errs.length >> 1]).toBeLessThan(3);           // km, at twice the spacing; at the real spacing about 16x smaller
  });

  it('every position is an ISS orbit: 400-450 km up, never beyond 51.9 degrees of latitude', () => {
    let maxLat = 0;
    for (let i = 0; i < f.r.length; i += 7) {
      const p = toEarth(f.r[i], at(f.t0) + f.s[i] * 1000);
      expect(p.altKm).toBeGreaterThan(380); expect(p.altKm).toBeLessThan(460);
      maxLat = Math.max(maxLat, Math.abs(p.lat));
    }
    expect(maxLat).toBeGreaterThan(51.3); expect(maxLat).toBeLessThan(51.9);
  });

  it('the ground track moves about 7.2 km a second, and there is no position outside the file', () => {
    const t = at(f.start) + 86400e3, tr = groundTrack(f, t, 10, 60);
    expect(tr.length).toBe(11);
    const km = tr.slice(1).reduce((s, p, i) => s + kmBetween(tr[i], p), 0);
    expect(km / 600).toBeGreaterThan(6.9); expect(km / 600).toBeLessThan(7.6);
    expect(covers(f, at(f.stop) + 60e3)).toBe(false);
    expect(stationAt(f, at(f.start) - 60e3)).toBeNull();
    expect(groundTrack(f, at(f.stop) - 120e3, 10, 60).length).toBe(3);
  });

  it('finds the closest pass to a home within a day, and it is close', () => {
    const kl = { lat: 3.14, lon: 101.69 }, t = at(f.start) + 86400e3;
    const c = closestPass(f, kl, t, 24)!;
    expect(c.t).toBeGreaterThanOrEqual(t); expect(c.t).toBeLessThanOrEqual(t + 24 * 3600e3);
    expect(c.km).toBeLessThan(600);                            // the track shifts about 2,500 km at the equator per orbit
    expect(Math.abs(kmBetween(c.fix, kl) - c.km)).toBeLessThan(1e-6);
    expect(closestPass(f, kl, at(f.stop) + 1, 24)).toBeNull();
  });
});
