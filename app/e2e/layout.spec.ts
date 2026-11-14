import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, start, hb, slow } from './helpers';

test('layout: no horizontal scroll, panels do not overlap, controls reachable', async ({ page }, info) => {
  await start(page);
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw + 1);
  for (const sel of ['#playBtn', '#scrub', '.track[data-theme="rain"]', '#readBtn', '#eyesBtn', '#aboutBtn']) {
    await page.locator(sel).scrollIntoViewIfNeeded();
    await expect(page.locator(sel)).toBeVisible();
  }
  const boxes = await page.evaluate(() => ['.tracks', '.readout', '.transport', '.frame', '.topbar']
    .map(s => { const r = document.querySelector(s)!.getBoundingClientRect(); return { s, x: r.x, y: r.y + scrollY, w: r.width, h: r.height, vis: getComputedStyle(document.querySelector(s)!).display !== 'none' }; }));
  const fixed = info.project.name === 'mobile' ? ['.transport'] : [];
  const overl = (a: typeof boxes[0], b: typeof boxes[0]) => a.vis && b.vis && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const clashes: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (fixed.includes(boxes[i].s) || fixed.includes(boxes[j].s)) continue;
    if (overl(boxes[i], boxes[j])) clashes.push(`${boxes[i].s} × ${boxes[j].s}`);
  }
  expect(clashes).toEqual([]);
  // the globe is round (no stretched canvas)
  const g = await page.evaluate(() => { const c = document.getElementById('gl') as HTMLCanvasElement; return { cw: c.clientWidth, ch: c.clientHeight, bw: c.width, bh: c.height }; });
  expect(Math.abs(g.bw / g.bh - g.cw / g.ch)).toBeLessThan(0.02);
  await page.screenshot({ path: `test-results/layout-${info.project.name}.png`, fullPage: false });
});

test('tapping or clicking the globe moves the listening point', async ({ page }) => {
  await start(page);
  const before = await hb<{ lat: number; lon: number }>(page, 'return hb.state.listen;');
  const box = (await page.locator('#gl').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5 + 40, box.y + box.height * 0.5 - 30);
  const after = await hb<{ lat: number; lon: number }>(page, 'return hb.state.listen;');
  expect(Math.abs(after.lat - before.lat) + Math.abs(after.lon - before.lon)).toBeGreaterThan(0.5);
  await expect(page.locator('#placeName')).not.toHaveText('');
});

test('layout: the Home view fits the screen and its three questions are reachable', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goHome').click();
  await expect(page.locator('#home [data-q]').first()).toBeEnabled({ timeout: slow(20_000) });
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw + 1);
  for (const q of ['home', 'rain', 'air', 'fever']) {
    // the card re-renders when the home recordings arrive, so a button can be replaced mid-step: try again
    await expect(async () => {
      const b = page.locator(`#home [data-q="${q}"]`);
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeVisible();
      const r = (await b.boundingBox())!;
      expect(r.height).toBeGreaterThanOrEqual(44);           // a comfortable touch target
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(vw);
    }).toPass();
  }
  // on a phone a band of globe stays visible above the card, with the first button on the first screen
  if (vw < 860) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const v = (await page.locator('#viz').boundingBox())!, first = (await page.locator('#home [data-q="home"]').boundingBox())!;
    expect(v.y + v.height).toBeLessThanOrEqual((await page.locator('#home').boundingBox())!.y + 1);
    expect(first.y).toBeLessThan(page.viewportSize()!.height);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: false });
});

test('layout: the astronaut\'s and the family\'s pages fit the screen, also while "Hear both sides" plays (nothing cut off, no button outside its card)', async ({ page }, info) => {
  test.setTimeout(120_000);
  const st = JSON.parse(readFileSync(join(process.cwd(), 'public/data/station.json'), 'utf8')) as { start: string };
  const sizes = info.project.name === 'desktop' ? [{ width: 1000, height: 575 }, page.viewportSize()!] : [page.viewportSize()!];
  for (const size of sizes) for (const role of ['astronaut', 'family'] as const) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
    await hb(page, `hb.setStationClock(${Date.parse(st.start) + 2 * 86400e3});`);
    await page.locator('#goCrew').click(); await page.locator(`#crew [data-role="${role}"]`).click(); await page.locator('#crewGo').click();
    await expect.poll(() => hb<boolean>(page, 'return hb.homeDebug().loading;'), { timeout: slow(20_000) }).toBe(false);
    await page.locator('#home [data-q="both"]').click();
    await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().part;'), { timeout: slow(30_000), intervals: [200] }).toBe('space');
    await expect(page.locator('#home [data-q="both"] .hm-now')).toBeVisible();
    const m = await page.evaluate(() => {
      const c = document.getElementById('home')!, r = c.getBoundingClientRect();
      let out = 0; c.querySelectorAll('button, select').forEach(e => { const b = e.getBoundingClientRect(); if (b.width) out = Math.max(out, r.left - b.left, b.right - r.right); });
      return { hidden: c.scrollHeight - c.clientHeight, out, bottom: r.bottom, vh: innerHeight, scroll: document.documentElement.scrollHeight > innerHeight };
    });
    const where = `${role} ${size.width}x${size.height}`;
    expect(m.out, where).toBeLessThanOrEqual(0);
    if (!m.scroll) { expect(m.hidden, where).toBeLessThanOrEqual(1); expect(m.bottom, where).toBeLessThanOrEqual(m.vh); }   // phones scroll the page instead
    if (role === 'astronaut' && size.width > 860) {
      // the porthole sits beside the panel, and the globe's centre is drawn at the porthole's centre
      const a = await page.evaluate(() => { const v = getComputedStyle(document.getElementById('viz')!); const r = document.getElementById('home')!.getBoundingClientRect();
        return { phx: parseFloat(v.getPropertyValue('--phx')), ph: parseFloat(v.getPropertyValue('--ph')), panelLeft: r.left }; });
      expect(a.phx + a.ph, where).toBeLessThan(a.panelLeft);
      expect(await hb<{ x: number } | null>(page, 'return hb.state.viewCenter;'), where).not.toBeNull();
    }
    await page.locator('#home [data-q="both"]').click();
  }
});
