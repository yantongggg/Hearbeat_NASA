import { test as base, expect, type Page } from '@playwright/test';

/**
 * Test runs make no sound on the machine they run on.
 * - Speech: the browser hands speech to the operating system's voice, which Chromium's --mute-audio does not
 *   mute, so a test run used to read fragments of text aloud, cut off and overlapping. Here `speak` never
 *   reaches the system voice: the utterance gets its `start` and `end` events after about the time the words
 *   would take, and `cancel` ends it with `error`, as Chrome does. The app's calls and its reactions are tested;
 *   the voice itself is not.
 * - The app's own audio is still rendered (the level tests read it from the analyser) but the output device is
 *   muted with --mute-audio in playwright.config.ts.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const s = window.speechSynthesis; if (!s) return;
      let cur: SpeechSynthesisUtterance | null = null, timer = 0;
      const stop = (type: 'end' | 'error') => { const u = cur; cur = null; clearTimeout(timer); u?.dispatchEvent(new Event(type)); };
      s.speak = (u: SpeechSynthesisUtterance) => {
        stop('error'); cur = u;
        window.setTimeout(() => { if (cur === u) u.dispatchEvent(new Event('start')); }, 0);
        timer = window.setTimeout(() => { if (cur === u) stop('end'); }, Math.min(6000, 250 + u.text.length * (/^zh/.test(u.lang) ? 180 : 55)));
      };
      s.cancel = () => stop('error');
    });
    await use(page);
  }
});
export { expect };

export async function start(page: Page, eyes = false) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator(eyes ? '#goEyes' : '#go').click();
  await expect(page.locator('#gate')).toBeHidden();
  // panels fade in over 0.8 s; wait until they are fully shown (contrast checks measure the real colours)
  await expect.poll(() => page.locator('.topbar').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  return errors;
}

/** Time limits written in the tests are for a laptop; the CI runner gets four times as long. */
export const slow = (ms: number) => (process.env.CI ? ms * 4 : ms);
/** False on CI: the shared runner cannot render audio in real time, so level measurements there mean nothing. */
export const realtimeAudio = !process.env.CI;
export const REALTIME_ONLY = 'measures real-time audio levels; the shared CI runner cannot render audio in real time (run locally with npm run test:e2e)';

export const hb = <T>(page: Page, fn: string) => page.evaluate(`(async () => { const hb = window.__hb; ${fn} })()`) as Promise<T>;

/** Put the listening point on the strongest cell of the current track's frame (so the sound has something to play).
 *  Only cells with data in every step of the track are used. In the warming track a place can have data in
 *  1880–1883 and none in 1884–1890 (19°N 13°W does); there the app rightly plays the no-data sound, not a note,
 *  and a slow machine that reads its counters late would see no note at all. */
export async function goToPeak(page: Page) {
  return hb<{ lat: number; lon: number; v: number }>(page, `
    const l = hb.P.themeLayer(), q = hb.DATA.grids.get(l.key + ':' + hb.state.step); const g = l.grid, e = l.encoding;
    const all = l.steps.map((_, i) => hb.DATA.grids.get(l.key + ':' + i)).filter(Boolean);
    let best = -1, bi = 0; for (let i = 0; i < q.length; i++) if (q[i] > best && Math.abs(g.lat0 - Math.floor(i / g.w) * g.step) < 60 && all.every(a => a[i] > 0)) { best = q[i]; bi = i; }
    const lat = g.lat0 - Math.floor(bi / g.w) * g.step, lon = g.lon0 + (bi % g.w) * g.step;
    hb.P.setListen({ lat, lon }, 'key'); await new Promise(r => setTimeout(r, 300));
    return { lat, lon, v: hb.live.v };`);
}
