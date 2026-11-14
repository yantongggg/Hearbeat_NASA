import AxeBuilder from '@axe-core/playwright';
import { test, expect, start, hb, goToPeak, slow } from './helpers';

test('loads the NASA data, starts, and shows real NASA layers (no simulated data)', async ({ page }) => {
  const errors = await start(page);
  await expect(page.locator('.track')).toHaveCount(5);
  await expect(page.locator('.track[disabled]')).toHaveCount(0);
  const layers = await hb<Array<{ key: string; simulated: boolean; kind: string }>>(page,
    `return Object.values(hb.DATA.manifest.layers).map(l => ({ key: l.key, simulated: l.simulated, kind: l.source.kind }));`);
  expect(layers.length).toBeGreaterThanOrEqual(3);
  expect(layers.every(l => !l.simulated)).toBe(true);
  await expect(page.locator('#errNote .badge.nasa')).toBeVisible();
  await expect(page.locator('#bigV')).not.toHaveText('—');
  expect(errors).toEqual([]);
});

for (const [theme, n, evt] of [['rain', 1, 'drop'], ['air', 2, 'pulse'], ['climate', 3, 'note'], ['lights', 4, 'twinkle'], ['lightning', 5, 'spark']] as const) {
  test(`track ${n} (${theme}) plays: time advances, the globe shows the matching NASA frame, and the data makes sound`, async ({ page }) => {
    await start(page);
    await page.locator(`.track[data-theme="${theme}"]`).click();
    await expect(page.locator(`.track[data-theme="${theme}"]`)).toHaveAttribute('aria-pressed', 'true');
    if (theme !== 'climate') await page.locator('#scrub').fill('0');   // (lights: 2012; lightning: January)
    await goToPeak(page);
    const before = await hb<{ step: number; c: Record<string, number> }>(page, `return { step: hb.state.step, c: { ...hb.AE.counts } };`);
    if (theme !== 'climate') await page.locator('#playBtn').click();
    await expect.poll(() => hb<boolean>(page, 'return hb.state.playing;')).toBe(true);
    await page.waitForTimeout(4500);
    const after = await hb<{ step: number; c: Record<string, number>; shown: string; image: string; running: boolean; vis: number }>(page, `
      const l = hb.P.themeLayer(); const d = hb.globeDebug();
      return { step: hb.state.step, c: { ...hb.AE.counts }, shown: d.shownA, image: hb.DATA.base + l.steps[hb.state.step].image, running: hb.AE.running, vis: d.data };`);
    expect(after.running).toBe(true);
    expect(after.step).toBeGreaterThan(before.step);
    expect(after.c[evt]).toBeGreaterThan(before.c[evt]);
    expect(after.vis).toBeGreaterThan(0.95);
    // pause, then the picture on the globe must be the frame for the step being heard
    // (while playing, a slow software renderer can be one frame behind the sound)
    await hb(page, 'hb.P.setPlaying(false);');
    await expect.poll(() => hb<boolean>(page, `const l = hb.P.themeLayer(); return hb.globeDebug().shownA === hb.DATA.base + l.steps[hb.state.step].image;`)).toBe(true);
    await expect(page.locator('#whenMain')).not.toHaveText('—');
    // the panel says in words what the sound is doing and what it means here
    await expect(page.locator('#hearing')).toContainText(theme === 'rain' ? /drop|Music only/ : theme === 'air' ? /music/i : theme === 'lights' ? /twinkle|night chord/ : theme === 'lightning' ? /tap|no taps/ : /note|whisper/);
    // the Earth is lit by the sun at the step's hour (Rain, Air) or evenly for annual means (Climate)
    const g = await hb<{ even: number; sunLon: number }>(page, 'return hb.globeDebug();');
    if (theme === 'climate') expect(g.even).toBeGreaterThan(0.5);
    else if (theme === 'lights' || theme === 'lightning') await expect.poll(() => hb<number>(page, 'return hb.globeDebug().night;')).toBeGreaterThan(0.95);   // night everywhere
    else {
      const step = await hb<number>(page, 'return hb.state.step;');
      const t = await hb<string>(page, 'const l = hb.P.themeLayer(); return l.steps[hb.state.step].t;');
      const h = +t.slice(11, 13);
      expect(Math.abs(((g.sunLon - (-15 * (h - 12))) + 540) % 360 - 180)).toBeLessThan(1);
      expect(step).toBeGreaterThanOrEqual(0);
    }
  });
}

test('the sound parameters follow the value at the listening point (and nothing else)', async ({ page }) => {
  await start(page);
  const r = await hb<Record<string, Array<{ v: number | null; p: Record<string, number | boolean> }>>>(page, `
    const out = {};
    for (const id of ['rain', 'air', 'climate', 'lights', 'lightning']) {
      await hb.P.setTheme(id, { quiet: true });
      const l = hb.P.themeLayer(), q = hb.DATA.grids.get(l.key + ':' + hb.state.step), g = l.grid;
      // the driest/cleanest/coldest and the wettest/dirtiest/warmest valid cells
      let lo = 256, hi = -1, li = 0, hiI = 0;
      for (let i = 0; i < q.length; i++) { if (!q[i]) continue; const lat = g.lat0 - Math.floor(i / g.w) * g.step; if (Math.abs(lat) > 60) continue; if (q[i] < lo) { lo = q[i]; li = i; } if (q[i] > hi) { hi = q[i]; hiI = i; } }
      out[id] = [];
      for (const i of [li, hiI]) {
        hb.P.setListen({ lat: g.lat0 - Math.floor(i / g.w) * g.step, lon: g.lon0 + (i % g.w) * g.step }, 'key');
        await new Promise(r => setTimeout(r, 150));
        out[id].push({ v: hb.live.v, p: { ...hb.AE.params.p } });
      }
    }
    return out;`);
  const [rLo, rHi] = r.rain, [aLo, aHi] = r.air, [cLo, cHi] = r.climate;
  expect(rHi.v!).toBeGreaterThan(rLo.v!);
  expect(rHi.p.dropsPerSec as number).toBeGreaterThan(rLo.p.dropsPerSec as number);
  expect(aHi.v!).toBeGreaterThan(aLo.v!);
  expect(aHi.p.cutoffHz as number).toBeLessThan(aLo.p.cutoffHz as number);
  expect(aHi.p.beat as number).toBeGreaterThan(aLo.p.beat as number);
  expect(cHi.v!).toBeGreaterThan(cLo.v!);
  expect(cHi.p.midi as number).toBeGreaterThan(cLo.p.midi as number);
  const [lLo, lHi] = r.lights;
  expect(lHi.v!).toBeGreaterThan(lLo.v!);
  expect(lHi.p.twinklesPerSec as number).toBeGreaterThan(lLo.p.twinklesPerSec as number);
  const [gLo, gHi] = r.lightning;
  expect(gHi.v!).toBeGreaterThan(gLo.v!);
  expect(gHi.p.tapsPerSec as number).toBeGreaterThan(gLo.p.tapsPerSec as number);
  expect(gLo.p.tapsPerSec).toBe(0);                 // none seen: no taps
});

test('keyboard: arrows move, Enter reads, D describes, 1-3 switch tracks, Space plays', async ({ page }) => {
  await start(page);
  await page.locator('#gl').focus();
  const lon0 = await hb<number>(page, 'return hb.state.listen.lon;');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await hb<number>(page, 'return hb.state.listen.lon;')).toBeGreaterThan(lon0 + 3);
  await page.keyboard.press('Enter');
  await expect(page.locator('#live')).toContainText(/millimetres per hour|no data/);
  await page.keyboard.press('d');
  await expect(page.locator('#descOut')).toContainText(/percent of the globe/);
  await page.keyboard.press('2');
  await expect(page.locator('.track[data-theme="air"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#quantity')).toContainText('PM2.5');
  await page.keyboard.press('3');
  await expect(page.locator('.track[data-theme="climate"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#gl').focus();
  const was = await hb<boolean>(page, 'return hb.state.playing;');
  await page.keyboard.press(' ');
  await expect.poll(() => hb<boolean>(page, 'return hb.state.playing;')).toBe(!was);
  await page.keyboard.press('p');
  await expect(page.locator('#placeName')).not.toHaveText('Kuala Lumpur');
});

test('A/B compare speaks both values and how they relate', async ({ page }) => {
  await start(page);
  await page.locator('.track[data-theme="air"]').click();
  await page.locator('#compareBtn').click();
  await expect(page.locator('#live')).toContainText(/A marked at Kuala Lumpur/);
  await hb(page, `hb.P.setListen({ lat: 28.61, lon: 77.21 }, 'key');`);
  await page.locator('#compareBtn').click();
  await expect(page.locator('#live')).toContainText(/A, Kuala Lumpur: .* B, New Delhi: .*(times|same)/);
});

test('sound legend plays low, middle and high examples and explains them', async ({ page }) => {
  await start(page);
  await page.locator('#legendBtn').click();
  await expect(page.locator('#descOut')).toContainText(/Raindrops/);
  await expect(page.locator('#live')).toContainText(/dry|light rain|heavy rain|Rain/, { timeout: slow(15_000) });
});

test('eyes-closed mode: speech, big buttons, keyboard, and leaving it', async ({ page }) => {
  await start(page, true);
  await expect(page.locator('#eyes')).toBeVisible();
  await expect(page.locator('#eyesStatus')).toContainText(/Eyes-closed mode/);
  await expect(page.locator('#eyesRead')).toBeFocused();
  for (const name of ['North', 'South', 'East', 'West', 'Read here', 'Play / pause', 'Describe', 'Next track', 'Open eyes']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const lon0 = await hb<number>(page, 'return hb.state.listen.lon;');
  await page.getByRole('button', { name: 'East', exact: true }).click();
  expect(await hb<number>(page, 'return hb.state.listen.lon;')).toBeGreaterThan(lon0);
  await page.getByRole('button', { name: 'Read here', exact: true }).click();
  await expect(page.locator('#eyesStatus')).toContainText(/Precipitation rate/);
  await page.getByRole('button', { name: 'Next track', exact: true }).click();
  await expect.poll(() => hb<string>(page, 'return hb.state.theme;')).toBe('air');
  await page.keyboard.press('h');
  await expect(page.locator('#eyesStatus')).toContainText(/Arrow keys/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#eyes')).toBeHidden();
});

test('About the data lists sources, how values are made, accuracy status and validation', async ({ page }) => {
  await start(page);
  await page.locator('#aboutBtn').click();
  const d = page.locator('#about');
  await expect(d).toBeVisible();
  await expect(d).toContainText('svs.gsfc.nasa.gov/5149');
  await expect(d).toContainText('svs.gsfc.nasa.gov/5151');
  await expect(d).toContainText('GISTEMP');
  await expect(d).toContainText(/data files checked/);
  await expect(d).toContainText(/colour legend|colorbar/i);
  await expect(d).toContainText(/(measured|not measured)/);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
});

test('Chinese interface switch', async ({ page }) => {
  await start(page);
  await page.locator('.topbar [data-set-lang="zh"]').click();
  await expect(page.locator('.track[data-theme="rain"] .ttl')).toHaveText(/^降雨/);
  await expect(page.locator('.track[data-theme="rain"] .sign')).toHaveText('循环');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
  await page.locator('.topbar [data-set-lang="en"]').click();
  await expect(page.locator('.track[data-theme="rain"] .ttl')).toHaveText(/^Rain/);
});

test('missing data: a failed layer disables its track and says why; nothing is invented', async ({ page }) => {
  await page.route('**/data/manifest.json', async route => {
    const res = await route.fetch(); const m = await res.json();
    delete m.layers.tanom; m.errors.tanom = 'GISTEMP failed: test outage';
    await route.fulfill({ response: res, json: m });
  });
  await start(page);
  await expect(page.locator('.track[data-theme="climate"]')).toBeDisabled();
  await expect(page.locator('.track[data-theme="climate"]')).toContainText('test outage');
  await page.keyboard.press('3');
  await expect(page.locator('#toast')).toContainText(/unavailable/);
  expect(await hb<string>(page, 'return hb.state.theme;')).toBe('rain');
});

test('no data at all: the app refuses to play instead of inventing values', async ({ page }) => {
  await page.route('**/data/manifest.json', route => route.fulfill({ status: 404, body: 'nope' }));
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/could not be loaded/);
  await expect(page.locator('#go')).toBeDisabled();
});

test('accessibility scan (axe, WCAG 2.1 A/AA): main view, eyes-closed view, About dialog', async ({ page }) => {
  await start(page);
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map(v => `${label}: ${v.id} ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
    return r.violations.length;
  };
  await scan('main');
  await page.locator('#aboutBtn').click(); await scan('about'); await page.keyboard.press('Escape');
  await page.locator('#eyesBtn').click(); await scan('eyes-closed');
});

test('works on hosts that do not serve .bin files (grids come from the per-layer pack)', async ({ page }) => {
  let binRequests = 0;
  await page.route('**/*.bin', route => { binRequests++; return route.fulfill({ status: 404, body: '' }); });
  await start(page);
  for (const id of ['rain', 'air', 'climate', 'lights', 'lightning']) {
    await page.locator(`.track[data-theme="${id}"]`).click();
    await expect(page.locator('#bigV')).not.toHaveText('—');
  }
  expect(binRequests).toBe(0);
});

test('Go to…: any step of a track can be chosen from a list, from 5 days of NASA EIC frames to 146 years of warming', async ({ page }) => {
  await start(page);
  const sel = page.locator('#timeSel');
  await expect(sel.locator('option')).toHaveCount(1 + await hb<number>(page, 'return hb.P.themeLayer().steps.length;'));
  await sel.selectOption({ index: 3 });
  await expect.poll(() => hb<number>(page, 'return hb.state.step;')).toBe(2);
  await expect(sel).toHaveValue('');                       // the list resets to "Go to…"
  await page.locator('.track[data-theme="climate"]').click();
  await expect(sel.locator('optgroup')).toHaveCount(15);    // 1880s ... 2020s
  await sel.selectOption({ label: '1950' });
  await expect(page.locator('#whenMain')).toHaveText('1950');
  expect(await hb<string>(page, 'return hb.P.themeLayer().steps[hb.state.step].t;')).toBe('1950');
});
