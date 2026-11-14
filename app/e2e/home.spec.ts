import { type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, hb, realtimeAudio, REALTIME_ONLY, slow } from './helpers';

async function countSpeech(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __speaks: number }).__speaks = 0;
    const s = window.speechSynthesis;
    if (s) { const orig = s.speak.bind(s); s.speak = (u: SpeechSynthesisUtterance) => { (window as unknown as { __speaks: number }).__speaks++; orig(u); }; }
  });
}
const speaks = (page: Page) => page.evaluate(() => (window as unknown as { __speaks: number }).__speaks);

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goHome').click();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#home [data-q]').first()).toBeEnabled({ timeout: slow(20_000) });
  await expect.poll(() => page.locator('.topbar').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
}

test('the start screen leads with Home: the story, the problem and three questions', async ({ page }) => {
  await countSpeech(page);
  await page.goto('/');
  const gate = page.locator('#gate');
  await expect(gate).toContainText('Hear how home is doing');
  await expect(gate).toContainText(/Astronauts can see home from orbit, but cannot hear it/);
  await expect(gate).toContainText(/2\.2 billion/);
  await expect(gate).toContainText(/Is it raining\? Is the air clean\?/);
  await expect(page.locator('#goHome')).toHaveText('Hear my home');
  await openHome(page);
  const card = page.locator('#home');
  await expect(card).toContainText('How is Kuala Lumpur doing?');
  await expect(card.locator('.hm-qs [data-q]')).toHaveCount(3);
  await expect(card.locator('[data-q="home"]')).toContainText('Hear home');
  // the explorer panels step aside; nothing plays and nothing is spoken until a question is pressed
  await expect(page.locator('.transport')).toBeHidden();
  const before = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  await page.waitForTimeout(1500);
  const after = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  expect(after).toEqual(before);
  expect(await speaks(page)).toBe(0);
  // the sourced story is in About
  await page.locator('#aboutBtn').click();
  await expect(page.locator('#aboutBody')).toContainText(/Scott Kelly.*New York Times/);
});

test('Home: each question plays only its own sound, at home, and shows the NASA number', async ({ page }) => {
  await countSpeech(page);
  await openHome(page);
  const air = await hb<{ v: number }>(page, `const r = hb.reading('air', hb.homeDebug().home); return { v: r.v };`);
  // air: a heartbeat whose speed is the PM2.5 (none at or below the WHO guideline)
  const c0 = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  await page.locator('#home [data-q="air"]').click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now?.q ?? null;')).toBe('air');
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(10_000) }).toBeNull();
  const c1 = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  if (air.v > 15) expect(c1.beat - c0.beat).toBeGreaterThanOrEqual(3); else expect(c1.beat - c0.beat).toBe(0);
  expect(c1.drop - c0.drop).toBe(0);
  expect(c1.note - c0.note).toBe(0);
  await expect(page.locator('#home .hm-res')).toContainText(/Kuala Lumpur: (Clean|Not clean)/);
  expect(await hb<{ lat: number }>(page, 'return hb.state.listen;')).toMatchObject({ lat: 3.14 });
  // warming: one note per decade, 1880s to 2020s, and the globe steps through the years with it
  await page.locator('#home [data-q="fever"]').click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(15_000) }).toBeNull();
  const c2 = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  expect(c2.note + c2.whisper - c1.note - c1.whisper).toBe(15);
  expect(await hb<string>(page, 'return hb.state.theme;')).toBe('climate');
  await expect(page.locator('#home .hm-res')).toContainText(/in 2025/);
  // eyes open: nothing was spoken (results go to the screen and the screen reader's live region)
  expect(await speaks(page)).toBe(0);
  // silent again afterwards
  const c3 = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  await page.waitForTimeout(1200);
  expect(await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };')).toEqual(c3);
});

test('Home: compare with another city plays home, then the other place', async ({ page }) => {
  await openHome(page);
  await page.locator('#homeCmp').selectOption('jakarta');
  await expect(page.locator('#home [data-q="air"] .hm-ans')).toContainText('Jakarta');
  await page.locator('#home [data-q="air"]').click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now?.at ?? null;')).toBe('kl');
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now?.at ?? null;'), { timeout: slow(10_000) }).toBe('jakarta');
  expect(await hb<number>(page, 'return hb.state.listen.lat;')).toBeCloseTo(-6.2, 1);
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(10_000) }).toBeNull();
  await expect(page.locator('#home .hm-res')).toContainText(/Kuala Lumpur: .*Jakarta: /);
});

test('Home: choosing another home, by list or by tapping the globe, is remembered', async ({ page }) => {
  await openHome(page);
  await page.locator('#homeSel').selectOption('bangkok');
  await expect(page.locator('#homeTitle')).toHaveText('How is Bangkok doing?');
  await page.reload();
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goHome').click();
  await expect(page.locator('#homeTitle')).toHaveText('How is Bangkok doing?');
  const box = await page.locator('#gl').boundingBox();
  await page.mouse.click(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5);
  await expect.poll(() => hb<string>(page, 'return hb.homeDebug().home.id;')).toBe('custom');
  await expect(page.locator('#homeTitle')).not.toHaveText('How is Bangkok doing?');
});

test('Home: the sound is loud enough, the heartbeat is playable on a phone speaker, and nothing is a deep thud', async ({ page }) => {
  test.skip(!realtimeAudio, REALTIME_ONLY);
  await openHome(page);
  const m = await hb<Record<string, { peakDb: number; above300: number; below150: number }>>(page, `
    const AE = hb.AE, an = AE.an, c = AE.c, td = new Float32Array(an.fftSize), fft = new Float32Array(an.frequencyBinCount);
    async function meas(ms) { let peak = 0, hi = 0, lo = 0, all = 0; const t0 = performance.now();
      while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(td); for (const x of td) peak = Math.max(peak, Math.abs(x));
        an.getFloatFrequencyData(fft); const hz = c.sampleRate / an.fftSize;
        for (let i = 1; i < fft.length; i++) { const e = Math.pow(10, fft[i] / 10); all += e; if (i * hz >= 300) hi += e; if (i * hz < 150) lo += e; }
        await new Promise(r => setTimeout(r, 20)); }
      return { peakDb: 20 * Math.log10(Math.max(1e-6, peak)), above300: hi / all, below150: lo / all }; }
    const out = {};
    let p = AE.previewOnce(hb.P.paramsFor('rain', 2), 2.5); out.rain = await meas(2300); await p;
    p = AE.previewOnce(hb.P.paramsFor('air', 46), 2.5); out.air = await meas(2300); await p;
    return out;`);
  expect(m.rain.peakDb).toBeGreaterThan(-10);
  expect(m.air.peakDb).toBeGreaterThan(-10);
  expect(m.rain.peakDb).toBeLessThan(0);
  expect(m.air.peakDb).toBeLessThan(0);
  expect(m.air.above300).toBeGreaterThan(0.2);
  // warm, not eerie: the heartbeat was 65 % below 150 Hz (a horror-film thud); now it is wooden notes
  expect(m.air.below150).toBeLessThan(0.15);
  expect(m.rain.below150).toBeLessThan(0.15);
});

test('Home works in eyes-closed mode, and its answers are spoken there', async ({ page }) => {
  await countSpeech(page);
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goEyes').click();
  await expect(page.locator('#eyesStatus')).toContainText(/Eyes-closed mode\. Home: Kuala Lumpur/);
  const box = page.locator('#eyesHome');
  await expect(box).toBeVisible();
  await expect(box.getByRole('button', { name: 'Is the air clean?' })).toBeVisible();
  await expect(page.locator('#home [data-q]').first()).toBeEnabled({ timeout: slow(20_000) });
  const n0 = await speaks(page);
  await box.getByRole('button', { name: 'Is the air clean?' }).click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(40_000) }).toBeNull();
  expect(await speaks(page)).toBeGreaterThan(n0);
  await expect(page.locator('#live')).toContainText(/Kuala Lumpur: (clean|not clean)/);
  // moving the stethoscope means exploring: Home closes and the live sound returns
  await page.getByRole('button', { name: 'East', exact: true }).click();
  expect(await hb<boolean>(page, 'return hb.homeDebug().open;')).toBe(false);
  expect(await hb<boolean>(page, 'return hb.AE.idle;')).toBe(false);
});

test('accessibility scan (axe, WCAG 2.1 A/AA): Home view', async ({ page }) => {
  await openHome(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

/** A stand-in recording for tests only (two soft tones, 3 s): the real home sounds are public recordings in public/home-sounds. */
function testWav(seconds = 3, rate = 22050) {
  const n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate; b.writeInt16LE(Math.round(6000 * (Math.sin(2 * Math.PI * 440 * t) + .5 * Math.sin(2 * Math.PI * 1320 * t)) * (.6 + .4 * Math.sin(2 * Math.PI * .7 * t))), 44 + i * 2); }
  return b;
}
async function withRoom(page: Page) {
  const clip = (kind: string) => ({ id: kind, kind, file: `${kind}.wav`, en: kind, zh: kind, title: `Test ${kind}`, author: 'Test', license: 'CC0', licenseUrl: '', people: 'none',
    source: `https://commons.wikimedia.org/wiki/File:Test_${kind}.ogg`, excerpt: 'all', changes: 'none' });
  await page.route('**/home-sounds/manifest.json', r => r.fulfill({ json: { clips: ['talk', 'play', 'cook'].map(clip) } }));
  const wav = testWav();
  await page.route('**/home-sounds/*.wav', r => r.fulfill({ body: wav, contentType: 'audio/wav' }));
}

test('Home: "hear home now" plays one thing at a time: a home, then today\'s rain, then the air (which muffles the home); the switch leaves the data alone', async ({ page }) => {
  await withRoom(page);
  await openHome(page);
  await expect(page.locator('#homeRoom')).toBeChecked();
  await expect(page.locator('#home .hm-note')).toContainText('not your home');
  await expect(page.locator('#home [data-q="home"] .hm-how')).toContainText(/^Someone cooking, then the rain here .+, then the air · 12 s$/);
  const r = await hb<{ rain: number | null; air: number | null }>(page, `const h = hb.homeDebug().home; return { rain: hb.reading('rain', h).v, air: hb.reading('air', h).v };`);
  // a recorder in the page notes, 20 times a second, which part is playing and how many drops and beats have sounded
  await hb(page, `window.__rec = []; window.__recT = setInterval(() => { const d = hb.homeDebug(); if (d.now) window.__rec.push({ part: d.part, drop: hb.AE.counts.drop, beat: hb.AE.counts.beat, note: hb.AE.counts.note, text: document.querySelector('#home [data-q="home"] .hm-now')?.textContent ?? '' }); }, 50);`);
  await page.locator('#home [data-q="home"]').click();
  await expect.poll(() => hb<number>(page, 'return hb.homeDebug().engine.room?.clips ?? 0;'), { timeout: slow(8000) }).toBe(3);
  const st = await hb<{ room: { cutoff: number; level: number }; bpm: number; rain: number }>(page, 'return hb.homeDebug().engine;');
  // in the air part the room is muffled exactly as far as the air says (open window at or below the WHO guideline)
  if (r.air != null && r.air > 15) { expect(st.room.cutoff).toBeLessThan(7000); expect(st.bpm).toBeGreaterThan(0); }
  else { expect(st.room.cutoff).toBe(12000); expect(st.bpm).toBe(0); }
  // the room is heard
  const rms = await hb<number>(page, `const an = hb.AE.an, td = new Float32Array(an.fftSize); let s = 0, n = 0; const t0 = performance.now();
    while (performance.now() - t0 < 1500) { an.getFloatTimeDomainData(td); for (const x of td) { s += x * x; n++; } await new Promise(r => setTimeout(r, 30)); }
    return 10 * Math.log10(s / n);`);
  if (realtimeAudio) expect(rms).toBeGreaterThan(-40);
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(20_000) }).toBeNull();
  type Rec = { part: string; drop: number; beat: number; note: number; text: string };
  const rec = await hb<Rec[]>(page, 'clearInterval(window.__recT); return window.__rec;');
  // the three parts come in order, and the card names the one that is playing
  expect(rec.map(x => x.part).filter((x, i, all) => x !== all[i - 1])).toEqual(['room', 'rain', 'air']);
  const of = (part: string) => rec.filter(x => x.part === part), first = (part: string) => of(part)[0], last = (part: string) => of(part)[of(part).length - 1];
  expect(first('room').text).toContain('someone cooking');
  expect(first('rain').text).toContain('the rain');
  expect(last('air').text).toContain('the air');
  // (a part's first sound is scheduled as the part begins, so it can be counted just before the recorder's first sample
  //  of that part: each part is therefore measured from the last sample of the part before it)
  // (on the slow CI runner the page's timers are starved while the globe is drawn in software, so the engine schedules
  //  only a few of the steps: there, one drop and one beat in the right part is the proof; in real time, more than three)
  const some = realtimeAudio ? 3 : 0;
  // the home alone: no drop, no heartbeat
  expect(last('room').drop - first('room').drop).toBe(0);
  expect(last('room').beat - first('room').beat).toBe(0);
  // then the rain alone on the window: drops if the data has rain, and no heartbeat
  if (r.rain != null && r.rain >= 0.105) expect(last('rain').drop - last('room').drop).toBeGreaterThan(some); else expect(last('rain').drop - last('room').drop).toBe(0);
  expect(last('rain').beat - first('room').beat).toBe(0);
  // then the air alone: a heartbeat if the air is over the guideline, and no more drops
  if (r.air != null && r.air > 15) expect(last('air').beat - last('rain').beat).toBeGreaterThan(some); else expect(last('air').beat - last('rain').beat).toBe(0);
  expect(last('air').drop - first('air').drop).toBe(0);
  expect(last('air').note - first('room').note).toBe(0);
  await expect(page.locator('#home .hm-res')).toContainText(/Kuala Lumpur: .*(rain|No data).*; .*(Clean|Not clean|No data)/);
  expect(await hb<unknown>(page, 'return hb.homeDebug().engine.room;')).toBeNull();
  // switched off: the same data voices one after the other, no room
  await page.locator('#homeRoom').uncheck();
  await page.locator('#home [data-q="home"]').click();
  await expect.poll(() => hb<boolean>(page, 'return hb.homeDebug().engine.mix;')).toBe(true);
  expect(await hb<unknown>(page, 'return hb.homeDebug().engine.room;')).toBeNull();
  expect(await hb<string>(page, 'return hb.homeDebug().part;')).toBe('rain');
  await page.locator('#home [data-q="home"]').click();   // pressing again stops
  await expect.poll(() => hb<boolean>(page, 'return hb.homeDebug().engine.mix;')).toBe(false);
  await page.reload();
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#goHome').click();
  await expect(page.locator('#homeRoom')).not.toBeChecked();
});

test('Home: the shipped home recordings load, the home is heard in front, no data voice drowns it, and they are credited', async ({ page }) => {
  test.skip(!realtimeAudio, REALTIME_ONLY);
  const shipped = JSON.parse(readFileSync(join(process.cwd(), 'public/home-sounds/manifest.json'), 'utf8')) as { clips: Array<{ author: string; license: string; people: string }> };
  expect(shipped.clips.length).toBeGreaterThan(0);
  for (const c of shipped.clips) { expect(['Public domain', 'CC0']).toContain(c.license); expect(c.people).toBe('none'); }
  await openHome(page);
  await expect(page.locator('#homeRoom')).toBeChecked();
  type Part = { rms: number; peak: number; below150: number; above300: number };
  const m = await hb<{ loaded: number; room: Part; rain: Part; air: Part }>(page, `
    const AE = hb.AE; const p0 = hb.hear('home');   // loads and decodes the recordings as the app does
    for (let i = 0; i < 100 && AE.homeState().loaded < ${shipped.clips.length}; i++) await new Promise(r => setTimeout(r, 100));
    AE.stopSolo(); await p0;
    const an = AE.an, c = AE.c, td = new Float32Array(an.fftSize), fft = new Float32Array(an.frequencyBinCount);
    // Kuala Lumpur on 12 Nov 2026: light rain and PM2.5 at three times the guideline
    const rain = hb.P.paramsFor('rain', 0.5).p, air = hb.P.paramsFor('air', 47).p;
    const acc = {}; let part = null, since = 0, done = false;
    const p = AE.hearHome({ rain, air }, { cutoff: 4600, level: .88 }, x => { part = x; since = performance.now(); });
    p.then(() => { done = true; });
    while (!done) {
      const age = performance.now() - since;
      // skip each part's first moments (fade-in, change-over) and the fade-out at the very end
      if (part && age > (part === 'room' ? 1000 : 400) && !(part === 'air' && age > 2700)) {
        const a = acc[part] ??= { peak: 0, s: 0, n: 0, lo: 0, hi: 0, all: 0 };
        an.getFloatTimeDomainData(td); for (const x of td) { a.peak = Math.max(a.peak, Math.abs(x)); a.s += x * x; a.n++; }
        an.getFloatFrequencyData(fft); const hz = c.sampleRate / an.fftSize;
        for (let i = 1; i < fft.length; i++) { const e = Math.pow(10, fft[i] / 10); a.all += e; if (i * hz < 150) a.lo += e; if (i * hz >= 300) a.hi += e; }
      }
      await new Promise(r => setTimeout(r, 25));
    }
    const out = { loaded: AE.homeState().loaded };
    for (const k of Object.keys(acc)) { const a = acc[k]; out[k] = { rms: 10 * Math.log10(a.s / a.n), peak: 20 * Math.log10(a.peak), below150: a.lo / a.all, above300: a.hi / a.all }; }
    return out;`);
  expect(m.loaded).toBe(shipped.clips.length);
  // the home, alone, is clearly there (it was at -27 dBFS under the data voices; in front it is about -23)
  expect(m.room.rms).toBeGreaterThan(-28);
  expect(m.room.rms).toBeLessThan(-18);
  // each data voice joins the home without drowning it: neither part is more than 5 dB louder than the home alone
  expect(m.rain.rms - m.room.rms).toBeLessThan(5);
  expect(m.air.rms - m.room.rms).toBeLessThan(5);
  // no clipping, no rumble, and mostly in the range a phone speaker plays
  for (const k of ['room', 'rain', 'air'] as const) { expect(m[k].peak).toBeLessThan(0); expect(m[k].below150).toBeLessThan(.05); }
  expect(m.room.above300).toBeGreaterThan(.6);
  await page.locator('#aboutBtn').click();
  const about = page.locator('#aboutBody');
  await expect(about).toContainText('Sounds of a home');
  for (const c of shipped.clips) { await expect(about).toContainText(c.author); await expect(about).toContainText(c.license); }
});

test('Home: in the shipped recordings a knock stays near the sizzle: stirring, not a bang', async ({ page }) => {
  // The kitchen recording was made very close to the pan: a knock of the utensil stood 16 dB over the sizzle (20 dB once
  // muffled), as loud as the data voices. The shipped clip brings the knocks nearer; this keeps any later clip honest.
  const shipped = JSON.parse(readFileSync(join(process.cwd(), 'public/home-sounds/manifest.json'), 'utf8')) as { clips: Array<{ file: string }> };
  await page.goto('/');
  const LIMIT: Record<string, number> = { 12000: 12, 4600: 15, 3000: 17 };   // dB over the median; open, Kuala Lumpur on 12 Nov 2026, ten times the guideline
  for (const c of shipped.clips) {
    const over = await page.evaluate(async file => {
      const data = await (await fetch('home-sounds/' + file)).arrayBuffer();
      const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
      const out: Record<string, number> = {};
      for (const cut of [12000, 4600, 3000]) {
        const oc = new OfflineAudioContext(1, buf.length, buf.sampleRate);
        const s = oc.createBufferSource(); s.buffer = buf;
        const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = .5;
        s.connect(f); f.connect(oc.destination); s.start();
        const d = (await oc.startRendering()).getChannelData(0);
        const W = Math.round(buf.sampleRate * .05), lv: number[] = [];   // level of every 50 ms window, in dB
        for (let i = 0; i + W <= d.length; i += W) { let e = 0; for (let j = i; j < i + W; j++) e += d[j] * d[j]; lv.push(10 * Math.log10(e / W + 1e-12)); }
        const median = [...lv].sort((a, b) => a - b)[lv.length >> 1];
        out[cut] = Math.max(...lv) - median;
      }
      return out;
    }, c.file);
    for (const [cut, db] of Object.entries(over)) expect(db, `${c.file} through a ${cut} Hz low-pass: loudest 50 ms window over the median, in dB`).toBeLessThan(LIMIT[cut]);
  }
});

test('Home: without home recordings, "hear home now" still plays the data and says so in About', async ({ page }) => {
  await page.route('**/home-sounds/manifest.json', r => r.fulfill({ status: 404, body: '' }));
  await openHome(page);
  await expect(page.locator('#homeRoom')).toHaveCount(0);
  await page.locator('#home [data-q="home"]').click();
  await expect.poll(() => hb<boolean>(page, 'return hb.homeDebug().engine.mix;')).toBe(true);
  expect(await hb<unknown>(page, 'return hb.homeDebug().engine.room;')).toBeNull();
  await page.locator('#home [data-q="home"]').click();
  await page.locator('#aboutBtn').click();
  await expect(page.locator('#aboutBody')).toContainText('No home recordings are loaded');
});

test('sign-in is a one-press demo: astronaut or family, nothing to type, home chosen, Home opens signed in, sign out works', async ({ page }) => {
  await countSpeech(page);
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await expect(page.locator('#goCrew')).toHaveText('Sign in: astronaut or family');
  await page.locator('#goCrew').click();
  const dlg = page.locator('#crew');
  await expect(dlg).toBeVisible();
  // two roles, as a radio group: the astronaut is chosen first and has focus; arrow keys switch
  const roles = dlg.locator('[role="radio"]');
  await expect(roles).toHaveCount(2);
  await expect(dlg.locator('[data-role="astronaut"]')).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.locator('[data-role="astronaut"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(dlg.locator('[data-role="family"]')).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.locator('[data-role="family"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(dlg.locator('[data-role="astronaut"]')).toHaveAttribute('aria-checked', 'true');
  await expect(dlg).toContainText(/Demo sign-in/);
  await expect(dlg).toContainText(/no password, and nothing is sent anywhere/);
  await expect(dlg).toContainText(/not a NASA system/);
  await expect(dlg.locator('input')).toHaveCount(0);            // no credentials are asked for or collected
  const r = await new AxeBuilder({ page }).include('#crew').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
  // Escape closes it and nothing has started
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator('#gate')).toBeVisible();
  await page.locator('#goCrew').click();
  await dlg.locator('#crewHomeSel').selectOption('penang');
  await dlg.locator('#crewGo').click();
  await expect(page.locator('#gate')).toBeHidden();
  const card = page.locator('#home');
  await expect(card).toContainText('Astronaut · demo account');
  await expect(page.locator('#homeTitle')).toHaveText('Home: George Town, Penang');
  await expect(page.locator('#live')).toContainText(/Signed in as astronaut, demo account\. Home on Earth: George Town, Penang/);
  expect(await hb<boolean>(page, 'return hb.homeDebug().crew;')).toBe(true);
  expect(await hb<number>(page, 'return hb.state.listen.lat;')).toBeCloseTo(5.41, 1);
  // signing in does not play or say anything by itself
  await expect(card.locator('[data-q="home"]')).toBeEnabled({ timeout: slow(20_000) });
  const c0 = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  await page.waitForTimeout(1200);
  expect(await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };')).toEqual(c0);
  expect(await speaks(page)).toBe(0);
  await page.locator('#homeSignOut').click();
  await expect(card).not.toContainText('demo account');
  expect(await hb<boolean>(page, 'return hb.homeDebug().crew;')).toBe(false);
  await expect(page.locator('#homeTitle')).toHaveText('How is George Town, Penang doing?');   // home stays
});

test('the app says "today" and "now" only when the newest NASA step is from today', async ({ page }) => {
  await openHome(page);
  const fresh = await hb<boolean>(page, 'return hb.homeDebug().dataToday;');
  const card = page.locator('#home');
  if (fresh) { await expect(card.locator('[data-q="home"] .hm-ask')).toHaveText('Hear home now'); await expect(card.locator('[data-q="home"] .hm-how')).toContainText('here today'); await expect(card.locator('.hm-src')).not.toContainText('days ago'); }
  else { await expect(card.locator('[data-q="home"] .hm-ask')).toHaveText('Hear home'); await expect(card.locator('[data-q="home"] .hm-how')).toContainText(/here on \d+ \w+, then the air/); await expect(card.locator('.hm-src')).toContainText(/\d+ days ago; not today's data/); }
});

test('Home stays itself: musical sound even if Precise was chosen, results follow the language, playing leaves Home', async ({ page }) => {
  await openHome(page);
  const air = await hb<number>(page, `return hb.reading('air', hb.homeDebug().home).v;`);
  // "Precise" (one tone) belongs to Explore; Home's cards promise drops and a heartbeat
  await page.keyboard.press('m');
  expect(await hb<string>(page, 'return hb.AE.sound;')).toBe('precise');
  const c0 = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  await page.locator('#home [data-q="air"]').click();
  await expect.poll(() => hb<string | null>(page, 'return hb.homeDebug().now;'), { timeout: slow(10_000) }).toBeNull();
  const c1 = await hb<Record<string, number>>(page, 'return { ...hb.AE.counts };');
  if (air > 15) expect(c1.beat - c0.beat).toBeGreaterThanOrEqual(3);
  // the result line is rebuilt in the new language
  await expect(page.locator('#home .hm-res')).toContainText(/Kuala Lumpur: (Clean|Not clean)/);
  await page.locator('.topbar [data-set-lang="zh"]').click();
  await expect(page.locator('#home .hm-res')).toContainText(/吉隆坡：?:? ?(干净|不干净)/);
  await page.locator('.topbar [data-set-lang="en"]').click();
  // L (the legend) does nothing in Home; Space plays, which means exploring: Home closes and the live sound returns
  await page.locator('#gl').focus();
  await page.keyboard.press('l');
  expect(await hb<boolean>(page, 'return hb.homeDebug().open;')).toBe(true);
  await page.keyboard.press(' ');
  expect(await hb<boolean>(page, 'return hb.homeDebug().open;')).toBe(false);
  expect(await hb<boolean>(page, 'return hb.AE.idle;')).toBe(false);
  expect(await hb<boolean>(page, 'return hb.state.playing;')).toBe(true);
});

test('pictures of another track are released when the track changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#gateStatus')).toContainText(/NASA data ready/, { timeout: slow(20_000) });
  await page.locator('#go').click();
  await expect.poll(() => hb<number>(page, 'return hb.framesHeld();'), { timeout: slow(30_000) }).toBeGreaterThanOrEqual(20);   // the whole rain track
  await page.locator('.track[data-theme="air"]').click();
  await expect.poll(() => hb<number>(page, 'return hb.framesHeld();'), { timeout: slow(30_000) }).toBeGreaterThanOrEqual(20);
  expect(await hb<number>(page, 'return hb.framesHeld();')).toBeLessThanOrEqual(22);   // air's 20 plus at most the two rain frames still on screen
});
