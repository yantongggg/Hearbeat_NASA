import { describe, expect, it } from 'vitest';
import { describeFrame } from '../src/data/describe';
import type { Encoding, GridSpec } from '../src/data/grid';

const G1: GridSpec = { w: 360, h: 180, lat0: 89.5, lon0: -179.5, step: 1 };
const E: Encoding = { scale: 'log', min: 0.1, max: 20 };
const code = (v: number) => 1 + Math.round(Math.max(0, Math.min(1, Math.log(v / E.min) / Math.log(E.max / E.min))) * 254);

describe('frame descriptions for screen readers', () => {
  it('names where the heaviest rain is and what is at the listening point', () => {
    const q = new Uint8Array(G1.w * G1.h).fill(code(0.1));
    // heavy rain over Borneo (Kuching), light rain at Kuala Lumpur
    for (let y = 85; y <= 90; y++) for (let x = 288; x <= 292; x++) q[y * G1.w + x] = code(12);
    for (let y = 86; y <= 87; y++) for (let x = 281; x <= 282; x++) q[y * G1.w + x] = code(1);
    const s = describeFrame({ theme: 'rain', q, grid: G1, enc: E, when: 'Wed 4 Nov 2026 · 18:00 UTC', lat: 3.14, lon: 101.69 });
    expect(s).toMatch(/^Wed 4 Nov 2026/);
    expect(s).toMatch(/heaviest rain is near Kuching/);
    expect(s).toMatch(/At Kuala Lumpur: 1\.\d mm\/h, light rain/);
    expect(s).toMatch(/to the east/);
  });
  it('says when there is no data at the point', () => {
    const q = new Uint8Array(180 * 90);
    const s = describeFrame({ theme: 'climate', q, grid: { w: 180, h: 90, lat0: 89, lon0: -179, step: 2 }, enc: { scale: 'linear', min: -6, max: 6 }, when: '1880', lat: 80, lon: 0, globalMean: -0.17 });
    expect(s).toMatch(/−0\.17 °C compared with 1951 to 1980/);
    expect(s).toMatch(/no data/);
  });
});
