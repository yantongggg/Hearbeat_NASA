import AxeBuilder from '@axe-core/playwright';
import { test, expect, start, hb, slow } from './helpers';

/** Count calls to the speech synthesiser (the start screen must not talk unless eyes-closed mode was chosen). */
async function countSpeech(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    (window as unknown as { __speaks: number }).__speaks = 0;
    const s = window.speechSynthesis;
    if (s) { const orig = s.speak.bind(s); s.speak = (u: SpeechSynthesisUtterance) => { (window as unknown as { __speaks: number }).__speaks++; orig(u); }; }
  });
}
const speaks = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __speaks: number }).__speaks);

test('the start screen states the problem, and starting does not suddenly speak', async ({ page }) => {
  await countSpeech(page);
  await page.goto('/');
  await expect(page.locator('#gate')).toContainText('Hear how home is doing');
  await expect(page.locator('#gate')).toContainText(/2\.2 billion/);
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#go').click();
  await expect(page.locator('#gate')).toBeHidden();
  await page.waitForTimeout(1500);
  expect(await speaks(page)).toBe(0);
  // the vital signs at the listening point are on screen, one per track
  await expect(page.locator('#vitals [data-vital]')).toHaveCount(5);
  await expect(page.locator('#vitals')).toContainText(/Circulation/);
  await expect(page.locator('#vitals')).toContainText(/Breathing/);
  await expect(page.locator('#vitals')).toContainText(/Fever/);
  await expect(page.locator('#vitals')).toContainText(/Storms/);
});

test('check-ups: four questions answered from the NASA data, checked, timed and logged', async ({ page }) => {
  await countSpeech(page);
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goCheck').click();
  const card = page.locator('#checkup');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Check-up 1 / 4');
  // 1 (find): wrong place first, then the wettest cell in Southeast Asia
  expect(await hb<boolean>(page, 'return hb.checkupDebug().done;')).toBe(false);
  await page.locator('#cuHintBtn').click();
  await expect(page.locator('#cuHint')).toContainText(/km to the/);
  await hb(page, `
    const l = hb.P.themeLayer('rain'), q = hb.DATA.grids.get(l.key + ':' + hb.state.step), g = l.grid; let best = null;
    for (let y = 0; y < g.h; y++) { const lat = g.lat0 - y * g.step; if (lat < -11 || lat > 22) continue;
      for (let x = 0; x < g.w; x++) { const lon = g.lon0 + x * g.step; if (lon < 92 || lon > 135) continue; const c = q[y * g.w + x]; if (c && (!best || c > best.c)) best = { c, lat, lon }; } }
    hb.P.setListen({ lat: best.lat, lon: best.lon }, 'key');`);
  await expect(card.locator('.cu-result.ok')).toContainText(/Well done/);
  // 2-4 (choose): the right answer is the one computed from the data
  for (const n of [2, 3, 4]) {
    await page.locator('#cuNext').click();
    await expect(card).toContainText(`Check-up ${n} / 4`);
    await expect(card.locator('[data-opt]').first()).toBeVisible();
    if (n === 3) {
      // each day can be heard on its own; the heartbeat is faster on the worse day
      const days = await card.locator('[data-day]').evaluateAll(bs => bs.map(b => (b as HTMLElement).dataset.day!));
      expect(days.length).toBe(5);
      const bpm: Record<string, number> = {};
      for (const d of days) {
        await card.locator(`[data-day="${d}"]`).click();
        await page.waitForTimeout(150);
        // the card is redrawn when a day starts playing; keyboard focus stays on that day's button
        expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.day)).toBe(d);
        bpm[d] = await hb<number>(page, 'return hb.AE.params.p.bpm;');
      }
      const worst = await hb<string>(page, 'return hb.checkupDebug().answer;');
      expect(Math.max(...Object.values(bpm))).toBe(bpm[worst]);
      expect(new Set(Object.values(bpm).map(Math.round)).size).toBeGreaterThan(1);
    }
    const answer = await hb<string>(page, 'return hb.checkupDebug().answer;');
    await card.locator(`[data-opt="${answer}"]`).click();
    await expect(card.locator('.cu-result.ok')).toBeVisible();
    if (n === 3) {
      // the result stays on the card after the last day's 4-second preview has ended
      await page.waitForTimeout(4500);
      await expect(card.locator('.cu-result.ok')).toContainText(/Well done/);
    }
  }
  const log = await hb<Array<{ checkup: string; result: string; seconds: number; hints: number }>>(page, 'return hb.checkupLog();');
  expect(log.map(r => [r.checkup, r.result])).toEqual([['rain', 'found'], ['air', 'correct'], ['haze', 'correct'], ['fever', 'correct']]);
  expect(log[0].hints).toBe(1);
  // results and hints are shown, not spoken, when eyes are open
  expect(await speaks(page)).toBe(0);
  expect(log.every(r => r.seconds > 0)).toBe(true);
  // a wrong answer is recorded as wrong and the right one is explained
  await hb(page, 'await hb.startCheckup(1);');
  const right = await hb<string>(page, 'return hb.checkupDebug().answer;');
  await card.locator(`[data-opt]:not([data-opt="${right}"])`).first().click();
  await expect(card.locator('.cu-result.bad')).toContainText(/The answer is/);
  // results dialog lists them and can copy CSV
  await page.locator('#cuNext').click();
  await page.locator('#checkBtn').click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#results tbody tr')).toHaveCount(5);
  // the classroom pack (teacher guide, large-print cards, tactile map) is linked and served
  for (const lang of ['en', 'zh']) {
    const href = await page.locator(`#results a[href$="classroom-pack-${lang}.pdf"]`).getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  }
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
});

test('check-ups work in eyes-closed mode with large buttons and speech', async ({ page }) => {
  await countSpeech(page);
  await start(page, true);
  await hb(page, 'await hb.startCheckup(1);');
  await expect(page.locator('#eyesTask')).toBeVisible();
  const answer = await hb<string>(page, 'return hb.checkupDebug().answer;');
  await page.locator(`#eyesTask [data-opt="${answer}"]`).click();
  await expect(page.locator('#eyesTask')).toContainText(/Well done/);
  expect(await speaks(page)).toBeGreaterThan(0);
  expect(await hb<string>(page, 'return hb.checkupLog().slice(-1)[0].mode;')).toBe('eyes-closed');
});

test('every sound event is drawn at the stethoscope on the globe', async ({ page }) => {
  await start(page);
  await page.locator('.track[data-theme="climate"]').click();
  await expect.poll(() => hb<boolean>(page, 'return hb.state.playing;')).toBe(true);
  await expect.poll(async () => { const c = await hb<Record<string, number>>(page, 'return hb.overlayDebug();'); return (c.note ?? 0) + (c.whisper ?? 0); }, { timeout: slow(20_000) }).toBeGreaterThan(3);
});
