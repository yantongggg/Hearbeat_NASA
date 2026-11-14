import { type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, hb, slow, realtimeAudio, REALTIME_ONLY } from './helpers';

/** The dates of NASA's trajectory file in this build (the daily build downloads a new one, about 15 days long):
 *  the station's clock (only that clock) is set inside it, or after it. */
const STATION = JSON.parse(readFileSync(join(process.cwd(), 'public/data/station.json'), 'utf8')) as { start: string; stop: string };
const START = Date.parse(STATION.start), STOP = Date.parse(STATION.stop);
const IN_FILE = new Date(START + 2 * 86400e3);
const AFTER_FILE = new Date(STOP + 9 * 86400e3);
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

async function signIn(page: Page, role: 'astronaut' | 'family', at = IN_FILE) {
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await hb(page, `hb.setStationClock(${at.getTime()});`);
  await page.locator('#goCrew').click();
  await page.locator(`#crew [data-role="${role}"]`).click();
  await page.locator('#crewGo').click();
  await expect(page.locator('#togetherLive')).toBeVisible();
  await expect.poll(() => hb<boolean>(page, 'return hb.homeDebug().loading;'), { timeout: slow(20_000) }).toBe(false);   // NASA grids ready
  await expect(page.locator('#home [data-q="both"]')).toBeVisible();
}

test('Together: the family sees where the station is now, from NASA\'s trajectory, and the station is on the globe', async ({ page }) => {
  await signIn(page, 'family');
  await expect(page.locator('#homeTitle')).toHaveText('Your astronaut');
  await expect(page.locator('#togetherLive')).toHaveText(/^over .+/);
  await expect(page.locator('#tgDist')).toHaveText(/^[\d,]+ km from home · 4\d\d km up$/);
  await expect(page.locator('#tgCount')).toHaveText(/^(Nearest to us at \d\d:\d\d|Passing near us now)$/);
  // the signed-in page is only Together: no questions, no comparison, two buttons
  await expect(page.locator('#home [data-q]')).toHaveCount(2);
  await expect(page.locator('#homeCmp')).toHaveCount(0);
  await expect(page.locator('#home [data-q="both"] .hm-how')).toHaveText('Home, then where they are · 20 s');
  await expect(page.locator('#home [data-q="space"] .hm-ask')).toHaveText('Hear where they are');
  const st = await hb<{ now: { lat: number; lon: number; altKm: number }; onGlobe: boolean }>(page, 'return hb.homeDebug().station;');
  expect(Math.abs(st.now.lat)).toBeLessThan(52);
  expect(st.now.altKm).toBeGreaterThan(380);
  await expect.poll(() => hb<boolean>(page, 'return !!hb.state.station && hb.state.station.track.length > 80;')).toBe(true);
  await expect(page.locator('#home [data-q="both"]')).toBeEnabled();
  const r = await new AxeBuilder({ page }).include('#home').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
});

test('Together: "hear both sides" plays home, then the station\'s side along its path, then names both', async ({ page }) => {
  await signIn(page, 'family');
  await hb(page, `window.__rec = []; window.__recT = setInterval(() => { const d = hb.homeDebug(); if (d.now) window.__rec.push({ part: d.part, space: d.space, lat: hb.state.listen.lat, lon: hb.state.listen.lon, drop: hb.AE.counts.drop, beat: hb.AE.counts.beat }); }, 50);`);
  await page.locator('#home [data-q="both"]').click();
  await expect(page.locator('#home [data-q="both"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(40_000) }).toBeNull();
  type Rec = { part: string | null; space: { lat: number; lon: number } | null; lat: number; lon: number };
  const rec = await hb<Rec[]>(page, 'clearInterval(window.__recT); return window.__rec;');
  // the family hears home first (someone cooking, the rain, the air), then the station's side
  expect(rec.map(x => x.part).filter((x, i, all) => x && x !== all[i - 1])).toEqual(['room', 'rain', 'air', 'space']);
  // during the station's side the listening point follows the station's path across the Earth
  const sp = rec.filter(x => x.part === 'space' && x.space);
  const places = new Set(sp.map(x => `${x.space!.lat.toFixed(1)},${x.space!.lon.toFixed(1)}`));
  expect(places.size).toBeGreaterThanOrEqual(4);
  for (const x of sp.slice(-3)) { expect(x.lat).toBeCloseTo(x.space!.lat, 1); }
  await expect(page.locator('#home .hm-res')).toContainText(/^Kuala Lumpur: .+ The station, at \d\d:\d\d: over .+; below it, in NASA's data/);
  expect(await hb<unknown>(page, 'return hb.homeDebug().engine.mix;')).toBe(false);
});

test('Together: the astronaut hears their own side first, then home', async ({ page }) => {
  await signIn(page, 'astronaut');
  await expect(page.locator('#homeTitle')).toHaveText('Home: Kuala Lumpur');
  await expect(page.locator('#home [data-q="both"] .hm-how')).toHaveText('Where you are, then home · 20 s');
  await page.locator('#home [data-q="both"]').click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().part;'), { timeout: slow(8000) }).toBe('space');
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().part;'), { timeout: slow(20_000) }).toBe('room');
  await page.locator('#home [data-q="both"]').click();   // pressing again stops
  await expect.poll(() => hb<boolean>(page, 'return hb.homeDebug().engine.mix;')).toBe(false);
  expect(await hb<string | null>(page, 'return hb.homeDebug().now;')).toBeNull();
});

test('Together: outside the dates of NASA\'s trajectory file the station is not shown and nothing is guessed', async ({ page }) => {
  await signIn(page, 'family', AFTER_FILE);
  await expect(page.locator('#home .tg-off')).toContainText(`No station position for today: NASA's file in this build covers ${day(START)} to ${day(STOP)}`);
  await expect(page.locator('#home [data-q="space"]')).toBeDisabled();
  await expect(page.locator('#home [data-q="both"]')).toBeDisabled();
  expect(await hb<unknown>(page, 'return hb.state.station;')).toBeNull();
});

test('Start goes back to the start page from anywhere: sound stops, the sign-in is kept, another part can be chosen', async ({ page }) => {
  await signIn(page, 'family');
  await page.locator('#home [data-q="space"]').click();
  await expect.poll(() => hb<boolean>(page, 'return hb.homeDebug().engine.mix;')).toBe(true);
  await page.locator('#startBtn').click();
  await expect(page.locator('#gate')).toBeVisible();
  await expect(page.locator('#goCrew')).toBeFocused();
  expect(await hb<boolean>(page, 'return hb.homeDebug().engine.mix;')).toBe(false);
  expect(await hb<boolean>(page, 'return hb.homeDebug().open;')).toBe(false);
  // keys meant for the globe do nothing on the start page
  const listen = await hb<{ lat: number }>(page, 'return { ...hb.state.listen };');
  await page.keyboard.press('ArrowUp');
  expect(await hb<{ lat: number }>(page, 'return { ...hb.state.listen };')).toEqual(listen);
  await page.locator('#goCheck').click();
  await expect(page.locator('#checkup')).toBeVisible();
  await expect(page.locator('#checkup')).toContainText('Check-up 1 / 4');
  await page.locator('#startBtn').click();
  await page.locator('#goHome').click();
  // "Hear my home" is always its own page; the sign-in is kept, with a way back to the family page
  await expect(page.locator('#home .hm-qs [data-q]')).toHaveCount(3);
  await expect(page.locator('#togetherLive')).toHaveCount(0);
  await page.locator('#homeCrewView').click();
  await expect(page.locator('#togetherLive')).toBeVisible();          // still signed in as family
  await page.locator('#startBtn').click();
  await page.locator('#goEyes').click();
  await expect(page.locator('#eyes')).toBeVisible();
  await expect(page.locator('#eyesHome [data-q="both"]')).toHaveText('Hear both sides');
});

test('Together in Chinese: the sign-in, the card, the start button and About all read in Chinese', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('hb-lang', 'zh'); } catch { /* blocked */ } });
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA 数据已就绪/, { timeout: slow(20_000) });
  await hb(page, `hb.setStationClock(${IN_FILE.getTime()});`);
  await expect(page.locator('#goCrew')).toHaveText('登录：宇航员或家人');
  await page.locator('#goCrew').click();
  await expect(page.locator('#crew')).toContainText('两个人，相隔很远');
  await expect(page.locator('#crew [data-role="family"]')).toContainText('家人');
  await page.locator('#crew [data-role="family"]').click();
  await page.locator('#crewGo').click();
  const card = page.locator('#home');
  await expect(card).toContainText('你的宇航员');
  await expect(page.locator('#homeTitle')).toHaveText('你的宇航员');
  await expect(page.locator('#togetherLive')).toHaveText(/^在.+上空$/);
  await expect(page.locator('#tgCount')).toHaveText(/离我们最近|正在经过我们附近/);
  await expect(card.locator('[data-q="space"] .hm-ask')).toHaveText('听他那边');
  await expect(card.locator('[data-q="both"] .hm-ask')).toHaveText('听两边');
  await expect(page.locator('#startBtn')).toContainText('首页');
  await expect(page.locator('#homeBtn')).toHaveText('我的家');
  expect(await page.locator('#gl').getAttribute('aria-label')).toMatch(/^地球。/);
  await page.locator('#aboutBtn').click();
  const about = page.locator('#aboutBody');
  await expect(about).toContainText('空间站（一起听）');
  await expect(about).toContainText('GEOS-FP 降水率，只在画面上看得到雨色的地方读出');
  await expect(about.locator('details.orig summary').first()).toHaveText('英文原文');
  await expect(about).toContainText('公有领域');
});

test('Together: the station\'s side is warm and no louder than the home\'s: a soft chord, then the data voices on top', async ({ page }) => {
  test.skip(!realtimeAudio, REALTIME_ONLY);
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goHome').click();
  await expect(page.locator('#home [data-q="home"]')).toBeEnabled({ timeout: slow(20_000) });
  type M = { rms: number; peak: number; below150: number };
  const m = await hb<{ chord: M; all: M }>(page, `
    const AE = hb.AE, an = AE.an, c = AE.c, td = new Float32Array(an.fftSize), fft = new Float32Array(an.frequencyBinCount);
    async function meas(p) { await new Promise(r => setTimeout(r, 1700)); let s = 0, n = 0, pk = 0, lo = 0, all = 0; const t0 = performance.now();
      while (performance.now() - t0 < 3000) { an.getFloatTimeDomainData(td); for (const x of td) { s += x * x; n++; pk = Math.max(pk, Math.abs(x)); }
        an.getFloatFrequencyData(fft); const hz = c.sampleRate / an.fftSize; for (let i = 1; i < fft.length; i++) { const e = Math.pow(10, fft[i] / 10); all += e; if (i * hz < 150) lo += e; }
        await new Promise(r => setTimeout(r, 25)); }
      await p; return { rms: 10 * Math.log10(s / n), peak: 20 * Math.log10(pk), below150: lo / all }; }
    const none = { rain: null, air: null }, rain = hb.P.paramsFor('rain', 2).p, air = hb.P.paramsFor('air', 60).p, lightning = hb.P.paramsFor('lightning', 40).p;
    return { chord: await meas(AE.hearSpace(Array(6).fill(none), 1)), all: await meas(AE.hearSpace(Array(6).fill({ rain, air, lightning }), 1)) };`);
  // the chord alone is quiet but there (home alone is about -23 dBFS); with rain, a heartbeat and the most lightning it stays below -17
  expect(m.chord.rms).toBeGreaterThan(-30); expect(m.chord.rms).toBeLessThan(-21);
  expect(m.all.rms).toBeLessThan(-17);
  for (const k of ['chord', 'all'] as const) { expect(m[k].peak).toBeLessThan(0); expect(m[k].below150).toBeLessThan(.05); }
});

test('signed in as the astronaut, the start page\'s "Hear my home" still opens "Hear my home", not the astronaut page', async ({ page }) => {
  await signIn(page, 'astronaut');
  await expect(page.locator('.porthole')).toBeVisible();
  await page.locator('#startBtn').click();
  await page.locator('#goHome').click();
  await expect(page.locator('#home .hm-qs [data-q]')).toHaveCount(3);
  await expect(page.locator('#home [data-q="song"]')).toBeVisible();
  await expect(page.locator('#home .tg')).toHaveCount(0);
  await expect(page.locator('.porthole')).toBeHidden();
  expect(await hb<unknown>(page, 'return hb.state.station;')).toBeNull();
  expect(await hb<{ crew: boolean; view: string }>(page, 'const d = hb.homeDebug(); return { crew: d.crew, view: d.view };')).toEqual({ crew: true, view: 'mine' });
  // the sign-in is kept: one press goes back to the astronaut's page
  await page.locator('#homeCrewView').click();
  await expect(page.locator('.porthole')).toBeVisible();
  await expect(page.locator('#home .tg-astro')).toBeVisible();
});

test('the three pages are different: the astronaut looks down from the station, the family looks at home, "Hear my home" asks questions', async ({ page }) => {
  await signIn(page, 'astronaut');
  // the astronaut: a porthole, the station in the middle of it, a countdown to home, "Hear home" first
  await expect(page.locator('.porthole')).toBeVisible();
  await expect(page.locator('#tgCount')).toHaveText(/^(Home in .+|Over home now)$/);
  await expect(page.locator('#home .tg-main')).toHaveAttribute('data-q', 'home');
  await expect.poll(async () => hb<number>(page, `const s = hb.state.station, c = hb.state.center; return s ? Math.hypot(s.lat - c.lat, ((s.lon - c.lon + 540) % 360) - 180) : 99;`), { timeout: slow(15_000) }).toBeLessThan(3);
  expect(await hb<unknown>(page, 'return hb.state.homeMark;')).toEqual({ lat: 3.14, lon: 101.69 });
  // the family: no porthole, the camera on home, "Hear where they are" first
  await page.locator('#homeSignOut').click();
  await page.locator('#startBtn').click();
  await page.locator('#goCrew').click();
  await page.locator('#crew [data-role="family"]').click();
  await page.locator('#crewGo').click();
  await expect(page.locator('#home .tg-family')).toBeVisible();
  await expect(page.locator('.porthole')).toBeHidden();
  await expect(page.locator('#home .tg-main')).toHaveAttribute('data-q', 'space');
  await expect.poll(async () => hb<number>(page, 'const c = hb.state.center; return Math.hypot(c.lat - 3.14, c.lon - 101.69);'), { timeout: slow(15_000) }).toBeLessThan(3);
  // "Hear my home": the questions, no station, no porthole
  await page.locator('#homeSignOut').click();
  await expect(page.locator('#home .hm-qs [data-q]')).toHaveCount(3);
  await expect(page.locator('#home .tg')).toHaveCount(0);
  await expect(page.locator('.porthole')).toBeHidden();
  expect(await hb<unknown>(page, 'return hb.state.station;')).toBeNull();
});

test('the family\'s "Hear where they are" plays only the station\'s side, and names what is below it', async ({ page }) => {
  await signIn(page, 'family');
  await hb(page, `window.__parts = new Set(); window.__pt = setInterval(() => { const p = hb.homeDebug().part; if (p) window.__parts.add(p); }, 50);`);
  await page.locator('#home [data-q="space"]').click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(30_000) }).toBeNull();
  expect(await hb<string[]>(page, 'clearInterval(window.__pt); return [...window.__parts];')).toEqual(['space']);
  await expect(page.locator('#home .hm-res')).toContainText(/^The station, at \d\d:\d\d: over .+; below it, in NASA's data/);
});

test('the station\'s side includes the lightning its own sensor saw below its path (NASA SVS 5011, this month)', async ({ page }) => {
  await signIn(page, 'family');
  await hb(page, `window.__lv = []; window.__lt = setInterval(() => { const s = hb.homeDebug().space; if (s) window.__lv.push([s.lv, s.taps]); }, 100);`);
  await page.locator('#home [data-q="space"]').click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(30_000) }).toBeNull();
  const lv = await hb<Array<[number | null, number]>>(page, 'clearInterval(window.__lt); return window.__lv;');
  expect(lv.length).toBeGreaterThan(3);
  // the station flies within 52 degrees of the equator, where every cell has a lightning value (0.01 % = none seen)
  for (const [v, taps] of lv) { expect(v).not.toBeNull(); expect(taps > 0).toBe(v! > .0105); }
});
