import { type Page } from '@playwright/test';
import { test, expect, hb, slow, realtimeAudio, REALTIME_ONLY, start } from './helpers';

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goHome').click();
  await expect(page.locator('#home [data-q="song"]')).toBeEnabled({ timeout: slow(20_000) });
}

test('Home song: the button plays all five tracks as one song, says what joins, and stops', async ({ page }) => {
  await openHome(page);
  const b = page.locator('#home [data-q="song"]');
  await expect(b).toContainText(/Home song/);
  await expect(b).toContainText(/one by one, then together/);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toContainText(/Now playing: the chords|Now playing: warming/, { timeout: slow(5_000) });
  await expect.poll(() => hb<number | null>(page, 'return hb.homeDebug().song?.bar ?? null;'), { timeout: slow(15_000) }).toBeGreaterThanOrEqual(2);
  await expect(b).toContainText(/warming, the melody|\+ the air/);
  await b.click();   // stop
  await expect.poll(() => hb<unknown>(page, 'return hb.homeDebug().now;')).toBeNull();
  expect(await hb<unknown>(page, 'return hb.AE.songState();')).toBeNull();
});

test('Home song: each voice joins in its own bar (melody, air, rain, lightning, night lights), as the data says', async ({ page }) => {
  test.skip(!realtimeAudio, REALTIME_ONLY);
  test.setTimeout(90_000);
  await openHome(page);
  await hb(page, `window.__first = {}; window.__c0 = { ...hb.AE.counts };
    window.__t = setInterval(() => { const s = hb.AE.songState(); if (!s) return; const c = hb.AE.counts;
      for (const k of Object.keys(c)) if (c[k] > window.__c0[k] && window.__first[k] == null) window.__first[k] = s.scheduledBar; }, 50);`);
  await page.locator('#home [data-q="song"]').click();
  await expect.poll(() => hb<number>(page, 'return hb.AE.songState()?.bar ?? -1;'), { timeout: 45_000, intervals: [500] }).toBeGreaterThanOrEqual(12);
  const first = await hb<Record<string, number>>(page, 'clearInterval(window.__t); return window.__first;');
  const res = await hb<string>(page, 'return hb.homeDebug().song?.line ?? "";');
  expect(res).toMatch(/all five together/);
  // each voice is first heard in (or after) its own bar, never before
  expect(first.note).toBeGreaterThanOrEqual(2);
  const air = Math.min(first.beat ?? 99, first.pulse ?? 99); expect(air).toBeGreaterThanOrEqual(4); expect(air).toBeLessThan(6);
  if (first.drop != null) expect(first.drop).toBeGreaterThanOrEqual(6);
  if (first.spark != null) expect(first.spark).toBeGreaterThanOrEqual(8);
  if (first.twinkle != null) expect(first.twinkle).toBeGreaterThanOrEqual(10);
  // Kuala Lumpur: lightning in every month and many lights at night, so both are heard
  expect(first.spark).toBeDefined(); expect(first.twinkle).toBeDefined();
  await page.locator('#home [data-q="song"]').click();
});

test('Home song: warm and no louder than a track: in the chorus below -16 dBFS, no clipping, almost nothing below 150 Hz', async ({ page }) => {
  test.skip(!realtimeAudio, REALTIME_ONLY);
  test.setTimeout(90_000);
  await openHome(page);
  await page.locator('#home [data-q="song"]').click();
  await expect.poll(() => hb<number>(page, 'return hb.AE.songState()?.bar ?? -1;'), { timeout: 45_000, intervals: [500] }).toBeGreaterThanOrEqual(10);
  const m = await hb<{ rms: number; peak: number; below150: number }>(page, `
    const AE = hb.AE, an = AE.an, c = AE.c, td = new Float32Array(an.fftSize), fft = new Float32Array(an.frequencyBinCount);
    let s = 0, n = 0, pk = 0, lo = 0, all = 0; const t0 = performance.now();
    while (performance.now() - t0 < 6000) { an.getFloatTimeDomainData(td); for (const x of td) { s += x * x; n++; pk = Math.max(pk, Math.abs(x)); }
      an.getFloatFrequencyData(fft); const hz = c.sampleRate / an.fftSize; for (let i = 1; i < fft.length; i++) { const e = Math.pow(10, fft[i] / 10); all += e; if (i * hz < 150) lo += e; }
      await new Promise(r => setTimeout(r, 25)); }
    return { rms: 10 * Math.log10(s / n), peak: 20 * Math.log10(pk), below150: lo / all };`);
  console.log('SONG LEVEL', JSON.stringify(m));
  expect(m.rms).toBeLessThan(-16); expect(m.rms).toBeGreaterThan(-28);
  expect(m.peak).toBeLessThan(0); expect(m.below150).toBeLessThan(.05);
  await page.locator('#home [data-q="song"]').click();
});

test('Explore: "All five as one song" plays the song for the listening point and stops', async ({ page }) => {
  await start(page);
  const b = page.locator('#songBtn');
  await expect(b).toContainText(/All five as one song/);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => hb<number>(page, 'return hb.AE.songState()?.bar ?? -1;'), { timeout: slow(15_000) }).toBeGreaterThanOrEqual(0);
  await expect(b).toContainText(/Stop/);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  expect(await hb<unknown>(page, 'return hb.AE.songState();')).toBeNull();
});
