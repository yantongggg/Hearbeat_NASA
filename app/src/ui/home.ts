/**
 * Home: the main function. Choose your home, then
 * - "hear home", one thing at a time: a recording of a household (someone cooking; no voices) alone, then the
 *   newest NASA rain as drops on its window, then the air as a heartbeat while dirtier air muffles the room.
 *   The recordings are not data and not the listener's home; they are public domain and credited in About.
 * - or ask three questions about it, one at a time. Each is answered by a short sound (the data voice
 *   almost alone) and one plain sentence with the NASA number.
 * Outside those sounds the Home view is silent, so every sound answers something just asked.
 */
import { $ } from '../core/util';
import { L, getLang } from '../core/i18n';
import { state } from '../core/state';
import { DATA, getGrid, gridSync, type LayerEntry } from '../data/manifest';
import { stationAt, groundTrack, closestPass, covers, kmBetween, type StationFile, type Fix } from '../data/station';
import { sample, neighbourhood } from '../data/grid';
import { HOME_GROUPS, homeById, decadeMeans, whoMultiple, ageHours, isToday, type Decade } from '../data/home-logic';
import type { City } from '../data/checkup-logic';
import { THEMES, category, catName, type ThemeId } from '../themes';
import { rainParams, airParams, climateParams, lightningParams, lightsParams, WHO_PM25_24H, type RainParams, type AirParams, type LightningParams } from '../audio/mapping';
import { songPart, melodyIndex, SONG_ENTER, SONG_OUTRO, type SongVoice } from '../audio/song';
import { AE, type SongSpec } from '../audio/engine';
import * as P from '../player';
import { placeName } from '../geo/places';
import { say, sayAsync, announce } from './speech';
import { checkRoomManifest, clipMix, ROOM_TARGET_RMS, roomCutoff, roomLevel, type RoomClip, type HomePart } from '../data/home-sounds';
import { startAudio } from './controls';

export type Question = 'rain' | 'air' | 'fever';
/** what can be asked: both sides (signed in), hear home now, or one of the three questions */
export type Ask = Question | 'home' | 'both' | 'space' | 'song';
export const QUESTIONS: Question[] = ['rain', 'air', 'fever'];
const THEME: Record<Question, ThemeId> = { rain: 'rain', air: 'air', fever: 'climate' };
/** seconds each place is heard for the rain and air questions; seconds between decade notes ("hear home" has its own parts: homeParts) */
const HOLD = 4, GAP = .5;

// ---------- home, remembered in this browser ----------
const KEY = 'hearthbeat-home-v1';
interface Saved { id: string; lat?: number; lon?: number }
function load(): City {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (s?.id === 'custom' && typeof s.lat === 'number' && typeof s.lon === 'number') return { id: 'custom', en: '', zh: '', lat: s.lat, lon: s.lon };
    const c = s ? homeById(s.id) : undefined; if (c) return c;
  } catch { /* storage blocked */ }
  return homeById('kl')!;
}
function save(c: City) { try { localStorage.setItem(KEY, JSON.stringify(c.id === 'custom' ? { id: 'custom', lat: c.lat, lon: c.lon } : { id: c.id })); } catch { /* storage blocked */ } }

// ---------- the room: recordings of a home (public, credited), switchable off to hear the data alone ----------
const ROOM_KEY = 'hearthbeat-room-v1';
let roomOn = (() => { try { return localStorage.getItem(ROOM_KEY) !== 'off'; } catch { return true; } })();
let roomClips: RoomClip[] = [];
let roomFiles: Array<{ data: ArrayBuffer; gain: number; pan: number }> = [];
let roomFetch: Promise<void> | null = null;
let roomDecoded = false;
export const homeSounds = () => roomClips;

/** Fetch the manifest and the recordings (no audio context needed yet). Missing files simply mean no room. */
function fetchRoom() {
  roomFetch ??= (async () => {
    try {
      const r = await fetch('home-sounds/manifest.json', { cache: 'no-cache' }); if (!r.ok) return;
      const m: unknown = await r.json(); checkRoomManifest(m);
      const got = await Promise.all(m.clips.map(async c => {
        try { const f = await fetch(`home-sounds/${c.file}`); return f.ok ? { c, data: await f.arrayBuffer() } : null; } catch { return null; }
      }));
      const ok = got.filter((x): x is { c: RoomClip; data: ArrayBuffer } => !!x);
      roomClips = ok.map(x => x.c);
      roomFiles = ok.map(x => ({ data: x.data, ...clipMix(x.c) }));
    } catch (e) { console.warn('home sounds not loaded:', e); roomClips = []; roomFiles = []; }
    if (!roomFiles.length) roomFetch = null;      // nothing arrived (offline, slow Wi-Fi): try again the next time it is wanted
  })();
  return roomFetch;
}
let roomDecoding: Promise<void> | null = null;
function ensureRoom() {
  roomDecoding ??= (async () => {
    await fetchRoom();
    if (!roomDecoded && roomFiles.length) { await AE.setRoom(roomFiles, ROOM_TARGET_RMS); roomDecoded = true; }
    roomDecoding = null;
  })();
  return roomDecoding;
}
export function setRoomOn(on: boolean) { roomOn = on; try { localStorage.setItem(ROOM_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } render(); }

let home: City = load();
let other: City | null = null;
let open = false;
let loading = false;
let now: { q: Ask | 'all'; at: City } | null = null;
/** which part is playing: the home alone, the rain on its window, the air, or the station's side (Together) */
let homePart: HomePart | 'space' | null = null;
let run = 0;
/** what was last answered; the result line is built from it at render time, so it follows the language */
let lastAsked: Ask | 'all' | null = null;
const resultText = () => (!lastAsked ? '' : (lastAsked === 'all' ? QUESTIONS : [lastAsked]).map(q => resultSentence(q, false)).join(' '));

export const homeOpen = () => open;

// ---------- sign-in: a demo (no account, no password, nothing leaves the device) ----------
/** Together: the astronaut on the station, or the family at home. Each hears where the other one is. */
export type Role = 'astronaut' | 'family';
let crew: Role | null = null;
export const crewOn = () => !!crew;
export const crewRole = () => crew;
/** Which page Home shows: the signed-in role's page ('crew'), or "Hear my home" ('mine'). A sign-in is kept when
 *  the start page's "Hear my home" is chosen, but that button always opens "Hear my home", never the role's page. */
let view: 'crew' | 'mine' = 'mine';
/** The role whose page is on screen (null on "Hear my home"). */
const shown = () => (crew && view === 'crew' ? crew : null);
/** Sign in as the demo astronaut or family, with `c` as home on Earth. */
export function signIn(role: Role = 'astronaut', c?: City) {
  crew = role; view = 'crew'; other = null; lastAsked = null;
  if (c && c.id !== home.id) { home = c; save(c); }
  void ensureStation().then(() => { tickStation(); if (open) render(); });
  render();
}
export function signOut() {
  if (!crew) return;
  crew = null; view = 'mine'; stopHearing(); state.station = null;
  announce(L('Signed out.', '已退出登录。'));
}

// ---------- the space station (Together): NASA's predicted trajectory, see data/station.ts ----------
let station: StationFile | null = null, stationLoad: Promise<void> | null = null, stationError = '';
function ensureStation(): Promise<void> {
  return stationLoad ??= fetch(DATA.base + 'station.json')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j: StationFile) => { station = j; stationError = ''; })
    .catch(e => { stationError = String((e as Error)?.message ?? e); stationLoad = null; });
}
/** The station's clock: the real time, except in tests (setStationClock), which need a moment inside NASA's file. */
let stationClock: number | null = null;
const stationNow = () => stationClock ?? Date.now();
export function setStationClock(ms: number | null) { stationClock = ms; passCache = null; tickStation(); if (open) render(); }
/** "Together" plays the next 16 minutes of the station's path in 8 seconds, one second per 2-minute stretch. */
const SPACE_MIN = 16, SPACE_SEGS = 8, SPACE_SEG_S = 1;
interface SpaceSeg { fix: Fix; r: Reading | null; a: Reading | null; rain: RainParams | null; air: AirParams | null;
  /** lightning the station's own sensor (LIS) saw below it in this calendar month, 2017–2023 average (NASA SVS 5011) */
  lv: number | null; lightning: LightningParams | null }
let spaceAt: SpaceSeg | null = null, lastSpace: SpaceSeg | null = null;
/** the most lightning under the 16 minutes of path just played (its taps may come before or after the first point) */
let pathLv: number | null = null;
const stationCity = (p: { lat: number; lon: number }): City => ({ id: 'station', en: 'below the station', zh: '空间站下方', lat: p.lat, lon: p.lon });
const the = (name: string) => (getLang() === 'en' && /Ocean|Sea$/.test(name) ? `the ${name}` : name);
const fmtKm = (km: number) => (km < 10 ? '<10' : Math.round(km).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-GB'));
const clock = (ms: number) => new Date(ms).toLocaleTimeString(getLang() === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString(getLang() === 'zh' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function inTime(ms: number) {
  const m = Math.max(0, Math.round((ms - stationNow()) / 60000)), h = Math.floor(m / 60);
  return h ? L(`in ${h} h ${m % 60} min`, `${h} 小时 ${m % 60} 分钟后`) : L(`in ${m} min`, `${m} 分钟后`);
}
let passCache: { key: string; v: ReturnType<typeof closestPass> } | null = null;
function nextPass(t: number) {
  const key = `${home.lat},${home.lon},${Math.floor(t / 30000)}`;
  if (passCache?.key !== key) passCache = { key, v: closestPass(station, home, t, 24) };
  return passCache.v;
}
/** Where the station is now, in one short sentence (also says plainly when it is unknown). */
export function stationLine(t = stationNow()): string {
  if (!station) return stationError ? L('The station\'s position is unavailable.', '空间站位置不可用。') : L('Loading the station\'s position…', '正在载入空间站位置…');
  if (!covers(station, t)) return L(`No station position for today: NASA's file in this build covers ${day(station.start)} to ${day(station.stop)}.`,
    `今天没有空间站位置：本版本里 NASA 的文件只覆盖 ${day(station.start)} 至 ${day(station.stop)}。`);
  const p = stationAt(station, t)!, place = placeName(p.lat, p.lon).name, km = kmBetween(p, home), pass = nextPass(t);
  return L(`The station is over ${the(place)}, ${fmtKm(km)} km from home.${pass ? ` Closest to home at ${clock(pass.t)} (${inTime(pass.t)}).` : ''}`,
    `空间站在${place}上空，离家 ${fmtKm(km)} 公里。${pass ? `离家最近：${clock(pass.t)}（${inTime(pass.t)}）。` : ''}`);
}
/** "56 min" / "7 h 41 min" until `ms`. */
function dur(ms: number) {
  const m = Math.max(0, Math.round((ms - stationNow()) / 60000)), h = Math.floor(m / 60);
  return h ? L(`${h} h ${m % 60} min`, `${h} 小时 ${m % 60} 分钟`) : L(`${m} min`, `${m} 分钟`);
}
/** The role views' live lines: where the station is, and the next pass near home. Null if the station is unknown. */
function liveTexts(t = stationNow()) {
  if (!station || !covers(station, t)) return null;
  const p = stationAt(station, t)!, place = placeName(p.lat, p.lon).name, pass = nextPass(t), km = kmBetween(p, home);
  const nowOver = !!pass && pass.km < 1500 && Math.abs(pass.t - t) < 5 * 60000;
  if (crew === 'astronaut') return {
    place: L(`Over ${the(place)} · ${Math.round(p.altKm)} km up`, `在${place}上空 · 高 ${Math.round(p.altKm)} 公里`),
    count: nowOver ? L('Over home now', '正在经过家') : pass ? L(`Home in ${dur(pass.t)}`, `${dur(pass.t)}后经过家`) : '',
    sub: pass ? L(`${cityName(home)} · closest ${fmtKm(pass.km)} km, at ${clock(pass.t)}`, `${cityName(home)} · 最近 ${fmtKm(pass.km)} 公里，${clock(pass.t)}`) : ''
  };
  return {
    place: L(`over ${the(place)}`, `在${place}上空`),
    dist: L(`${fmtKm(km)} km from home · ${Math.round(p.altKm)} km up`, `离家 ${fmtKm(km)} 公里 · 高 ${Math.round(p.altKm)} 公里`),
    count: nowOver ? L('Passing near us now', '正在经过我们附近') : pass ? L(`Nearest to us at ${clock(pass.t)}`, `${clock(pass.t)} 离我们最近`) : '',
    sub: pass ? L(`in ${dur(pass.t)} · ${fmtKm(pass.km)} km away`, `${dur(pass.t)}后 · 相距 ${fmtKm(pass.km)} 公里`) : ''
  };
}
/** Keeps the station and its next 95 minutes of track on the globe, and the live sentence current, while Home is open. */
let stationTimer = 0;
function tickStation() {
  if (!open || !shown() || !station) { state.station = null; return; }
  const t = stationNow(), p = stationAt(station, t);
  state.station = p ? { lat: p.lat, lon: p.lon, track: groundTrack(station, t, 95, 60).map(f => ({ lat: f.lat, lon: f.lon })) } : null;
  const lt = liveTexts(t), set = (id: string, v: string | undefined) => { const el = document.getElementById(id); if (el && v != null && el.textContent !== v) el.textContent = v; };
  if (lt) { set('togetherLive', lt.place); set('tgDist', (lt as { dist?: string }).dist); set('tgCount', lt.count); set('tgCountSub', lt.sub); }
  // the camera: the astronaut looks down from the station; the family looks at home (both follow the sound while it plays)
  if (p && !now) {
    if (crew === 'astronaut') { state.target = { lat: p.lat, lon: p.lon }; state.dist += (2.1 - state.dist) * .5; }
    else { state.target = { lat: home.lat, lon: home.lon }; state.dist += (2.45 - state.dist) * .5; }
  }
}
/** The lightning layer's step for this moment's calendar month (null without the layer). */
function lightningStep(t: number) {
  const l = P.themeLayer('lightning');
  return l && l.time.label === 'month' ? { l, i: P.monthStep(l, t) } : null;
}
function lightningAt(fix: Fix): number | null {
  const s = lightningStep(fix.t), q = s ? gridSync(s.l.key, s.i) : null;
  return s && q ? sample(q, fix.lat, fix.lon, s.l.grid, s.l.encoding) : null;
}
function spaceSegments(t: number): SpaceSeg[] {
  const out: SpaceSeg[] = [];
  for (let i = 0; i < SPACE_SEGS; i++) {
    const fix = stationAt(station, t + (i + .5) * (SPACE_MIN / SPACE_SEGS) * 60000); if (!fix) break;
    const c = stationCity(fix), r = reading('rain', c), a = reading('air', c), lv = lightningAt(fix);
    out.push({ fix, r, a, rain: r?.params?.theme === 'rain' ? r.params.p : null, air: a?.params?.theme === 'air' ? a.params.p : null,
      lv, lightning: lv == null ? null : lightningParams(lv) });
  }
  return out;
}
/** The station's side: its chord, with the rain and air of NASA's newest data under the next 16 minutes of its path. */
async function hearSpaceAt(my: number) {
  if (my !== run) return;
  if (!station) await Promise.race([ensureStation(), wait(1500)]);
  const ls = lightningStep(stationNow()); if (ls) await Promise.race([getGrid(ls.l.key, ls.i), wait(1500)]);
  const segs = station ? spaceSegments(stationNow()) : [];
  if (!segs.length || my !== run) return;
  pathLv = segs.reduce<number | null>((m, s) => (s.lv != null && (m == null || s.lv > m) ? s.lv : m), null);
  homePart = 'space'; spaceAt = segs[0]; lastSpace = segs[0]; render();
  await AE.hearSpace(segs.map(s => ({ rain: s.rain, air: s.air, lightning: s.lightning })), SPACE_SEG_S, i => {
    if (my !== run) return;
    spaceAt = segs[i]; P.setListen({ lat: segs[i].fix.lat, lon: segs[i].fix.lon }, 'quiet'); render();
  });
  if (my === run) { homePart = null; spaceAt = null; }
}
/** What is below the station: a short phrase while it plays ('label'), or the NASA numbers ('written', 'spoken'). */
function belowText(s: SpaceSeg, mode: 'label' | 'written' | 'spoken' = 'label') {
  if (mode !== 'label') {
    const ans = (r: Reading | null) => (r ? (mode === 'spoken' ? r.spoken : r.answer) : L('no data', '无数据'));
    const m = P.monthName(new Date(s.fix.t).getUTCMonth() + 1);
    const lg = pathLv != null && pathLv > .0105 ? L(`; on this path, lightning the station saw in ${m} (2017–2023): ${catName(category(THEMES.lightning, pathLv))}`,
      `；这段路径上，空间站 ${m} 看到的闪电（2017–2023）：${catName(category(THEMES.lightning, pathLv))}`) : '';
    return L(`${ans(s.r)}; the air: ${ans(s.a)}${lg}`, `${ans(s.r)}；空气：${ans(s.a)}${lg}`);
  }
  const rain = s.r?.v == null ? L('no rain data', '无降雨数据') : s.rain && s.rain.dropsPerSec > 0 ? L('rain', '下雨') : L('no rain', '没下雨');
  const air = s.a?.v == null ? L('no air data', '无空气数据') : s.air && s.air.bpm > 0 ? L('dirty air, a heartbeat', '空气脏，有心跳') : L('clean air', '空气干净');
  const lg = s.lightning && s.lightning.tapsPerSec > 0 ? L(', lightning', '，有闪电') : '';
  return `${rain}${L(', ', '，')}${air}${lg}`;
}
/** Options for the "home on Earth" list in the sign-in dialog. */
export const homeOptions = () => options(home);

// ---------- how old is the data? The app says "today" only when that is true ----------
function newestStep(): string | null { const l = P.themeLayer('rain') ?? P.themeLayer('air'); return l ? l.steps[l.steps.length - 1].t : null; }
/** "today" when the newest NASA step is within 36 h, otherwise its date ("on 4 Nov"). */
function dayWord(): string {
  const l = P.themeLayer('rain') ?? P.themeLayer('air'), t = newestStep();
  if (!l || !t) return L('in the newest data', '（最新数据）');
  if (isToday(t)) return L('today', '今天');
  const d = P.whenLabel(l, l.steps.length - 1).replace(/ \d\d:00 UTC$/, '');
  return L(`on ${d}`, d);
}
/** e.g. " (9 days ago)" when the newest step is not from today. */
function ageNote(): string {
  const t = newestStep(), h = t ? ageHours(t) : null;
  if (h == null || Math.abs(h) <= 36) return '';
  const days = Math.round(h / 24);
  return L(` (${days} days ago; not today's data)`, `（${days} 天前，不是今天的数据）`);
}
export const cityName = (c: City) => (c.id === 'custom' ? placeName(c.lat, c.lon).name : L(c.en, c.zh));

// ---------- readings: what NASA says at a place ----------
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
interface Reading { v: number | null; answer: string; spoken: string; when: string; decades?: Decade[]; params?: ReturnType<typeof P.paramsFor> }

function newest(id: ThemeId, c: City) {
  const l = P.themeLayer(id); if (!l) return null;
  const step = l.steps.length - 1, q = gridSync(l.key, step);
  const v = q ? sample(q, c.lat, c.lon, l.grid, l.encoding) : null;
  const n = q ? neighbourhood(q, c.lat, c.lon, l.grid, l.encoding, 1000, THEMES[id].presence) : { coverage: 0, pan: 0 };
  return { l, step, v, near: { coverage: n.coverage, pan: n.pan } };
}

export function reading(q: Question, c: City): Reading | null {
  if (q === 'rain') {
    const r = newest('rain', c); if (!r) return null;
    const t = THEMES.rain, v = r.v, when = P.whenLabel(r.l, r.step);
    if (v == null) return { v, answer: L('No data', '无数据'), spoken: L('no data', '无数据'), when };
    const dry = v < 0.105;
    const answer = dry ? L('No rain', '没有下雨') : `${cap(catName(category(t, v)))} · ${t.fmt(v)}`;
    const spoken = dry ? L('no rain', '没有下雨') : `${catName(category(t, v))}, ${P.spokenUnits(t.fmt(v))}`;
    return { v, answer, spoken, when, params: { theme: 'rain', p: rainParams(v, r.near) } };
  }
  if (q === 'air') {
    const r = newest('air', c); if (!r) return null;
    const t = THEMES.air, v = r.v, when = P.whenLabel(r.l, r.step);
    if (v == null) return { v, answer: L('No data', '无数据'), spoken: L('no data', '无数据'), when };
    const clean = v <= WHO_PM25_24H, x = whoMultiple(v);
    const answer = clean ? L(`Clean · ${t.fmt(v)}`, `干净 · ${t.fmt(v)}`)
      : x === '1.0' ? L(`Not clean · just above the WHO guideline · ${t.fmt(v)}`, `不干净 · 刚超过世卫指导值 · ${t.fmt(v)}`)
      : L(`Not clean · ${x}× the WHO guideline · ${t.fmt(v)}`, `不干净 · 世卫指导值的 ${x} 倍 · ${t.fmt(v)}`);
    const spoken = clean ? L(`clean, ${P.spokenUnits(t.fmt(v))}, within the WHO guideline`, `干净，${P.spokenUnits(t.fmt(v))}，在世卫组织指导值以内`)
      : L(`not clean, ${P.spokenUnits(t.fmt(v))}, ${x} times the WHO guideline`, `不干净，${P.spokenUnits(t.fmt(v))}，是世卫组织指导值的 ${x} 倍`);
    return { v, answer, spoken, when, params: { theme: 'air', p: airParams(v, r.near) } };
  }
  const l = P.themeLayer('climate'); if (!l) return null;
  const series = l.steps.map((s, i) => { const g = gridSync(l.key, i); return { t: s.t, v: g ? sample(g, c.lat, c.lon, l.grid, l.encoding) : null }; });
  const last = series[series.length - 1], t = THEMES.climate;
  if (last.v == null) return { v: null, answer: L('No data', '无数据'), spoken: L('no data', '无数据'), when: last.t, decades: decadeMeans(series) };
  const word = last.v >= 0 ? L('warmer', '更暖') : L('cooler', '更冷');
  return {
    v: last.v, when: `${l.steps[0].t}–${last.t}`, decades: decadeMeans(series),
    answer: L(`${t.fmt(last.v)} in ${last.t}`, `${last.t} 年 ${t.fmt(last.v)}`),
    spoken: L(`in ${last.t}, ${Math.abs(last.v).toFixed(2)} degrees ${word} than 1951 to 1980`, `${last.t} 年比 1951 至 1980 年${word} ${Math.abs(last.v).toFixed(2)} 摄氏度`)
  };
}

const ask = (q: Ask) => ({
  both: L('Hear both sides', '听两边'),
  space: L('Hear where they are', '听他那边'),
  song: L('Home song', '家的歌'),
  home: newestStep() && isToday(newestStep()!) ? L('Hear home now', '听听家里现在') : L('Hear home', '听听家里'),   // "now" only when the data is from today
  rain: L('Is it raining?', '在下雨吗？'),
  air: L('Is the air clean?', '空气干净吗？'),
  fever: L('How much warmer than in 1951–1980?', '比 1951–1980 年暖了多少？')
})[q];
/** One short line under each button: what you will hear. */
const how = (q: Ask) => ({
  space: L('The Earth passing below the station · 8 s', '空间站下方经过的地球 · 8 秒'),
  song: L('All five tracks as one song: one by one, then together · 1 min', '五首合成一首歌：一个一个加入，最后一起 · 1 分钟'),
  both: crew === 'family' ? L('Home, then where they are · 20 s', '先听家里，再听他那边 · 20 秒') : L('Where you are, then home · 20 s', '先听你那边，再听家里 · 20 秒'),
  home: roomOn && roomClips.length
    ? L(`Someone cooking, then the rain here ${dayWord()}, then the air · 12 s`, `有人炒菜，然后是这里${dayWord()}的雨，然后是空气 · 12 秒`)
    : L(`The rain here ${dayWord()}, then the air · 9 s`, `这里${dayWord()}的雨，然后是空气 · 9 秒`),
  rain: L('Raindrops: more drops, harder rain.', '雨滴：越密，雨越大。'),
  air: L('A heartbeat: faster, dirtier air.', '心跳：越快，空气越脏。'),
  fever: L('A note per decade since the 1880s: higher, warmer.', '从 1880 年代起每十年一个音：越高越暖。')
})[q];

// ---------- loading the grids the questions need ----------
async function ensureGrids() {
  const need: Array<Promise<unknown>> = [];
  for (const id of ['rain', 'air'] as ThemeId[]) { const l = P.themeLayer(id); if (l) need.push(getGrid(l.key, l.steps.length - 1)); }
  const cl = P.themeLayer('climate'); if (cl) cl.steps.forEach((_, i) => need.push(getGrid(cl.key, i)));
  const nl = P.themeLayer('lights'); if (nl) need.push(getGrid(nl.key, nl.steps.length - 1));
  const lg = P.themeLayer('lightning'); if (lg) need.push(getGrid(lg.key, P.monthStep(lg)));
  await Promise.all(need);
}

// ---------- playing ----------
const wait = (ms: number) => new Promise(r => window.setTimeout(r, ms));

async function hearHomeAt(c: City, my: number, q: 'home' | 'both' = 'home') {
  if (my !== run) return;
  now = { q, at: c }; render();
  P.setListen({ lat: c.lat, lon: c.lon }, 'quiet');
  const rain = reading('rain', c), air = reading('air', c);
  const rp = rain?.params?.theme === 'rain' ? rain.params.p : null, ap = air?.params?.theme === 'air' ? air.params.p : null;
  // the recording is normally decoded when Home opens; if it is still on its way, wait at most 1.5 s and then
  // play the data alone rather than leave the listener in silence
  if (roomOn && !roomDecoded) await Promise.race([ensureRoom(), wait(1500)]);
  if (my !== run) return;
  const pm = air?.v ?? null;
  await AE.hearHome({ rain: rp, air: ap }, roomOn && roomDecoded ? { cutoff: roomCutoff(pm), level: roomLevel(pm) } : null,
    part => { if (my === run) { homePart = part; render(); } });
  if (my === run) homePart = null;
}

// ---------- the home song (audio/song.ts): all five tracks as one piece for one place ----------
interface SongData { spec: SongSpec; c: City; values: Record<SongVoice, number | null>; decades: Decade[]; month: number }
let songBar = -1, songNow: SongData | null = null, lastSong: SongData | null = null;
function valueNow(id: ThemeId, c: City, step?: number): number | null {
  const l = P.themeLayer(id); if (!l) return null;
  const q = gridSync(l.key, step ?? l.steps.length - 1);
  return q ? sample(q, c.lat, c.lon, l.grid, l.encoding) : null;
}
function songData(c: City): SongData {
  const rain = reading('rain', c), air = reading('air', c), fever = reading('fever', c);
  const lg = P.themeLayer('lightning'), month = lg ? +lg.steps[P.monthStep(lg)].t : new Date().getUTCMonth() + 1;
  const lv = lg ? valueNow('lightning', c, P.monthStep(lg)) : null, nl = valueNow('lights', c);
  const decades = fever?.decades ?? [];
  return {
    c, decades, month,
    values: { melody: fever?.v ?? null, air: air?.v ?? null, rain: rain?.v ?? null, lightning: lv, lights: nl },
    spec: {
      rain: rain?.params?.theme === 'rain' ? rain.params.p : null, air: air?.params?.theme === 'air' ? air.params.p : null,
      lightning: lv == null ? null : lightningParams(lv), lights: nl == null ? null : lightsParams(nl),
      melody: decades.map(d => d.v)
    }
  };
}
async function hearSongAt(c: City, my: number) {
  if (my !== run) return;
  now = { q: 'song', at: c };
  const d = songData(c); songNow = d; songBar = 0; render();
  P.setListen({ lat: c.lat, lon: c.lon }, 'quiet');
  await AE.hearSong(d.spec, b => { if (my === run) { songBar = b; render(); window.dispatchEvent(new CustomEvent('hb:song', { detail: songLine() })); } });
  if (my === run) { lastSong = d; songNow = null; songBar = -1; }
}
/** What each voice says about this place, in a few words. */
function voiceText(v: SongVoice, d: SongData, spoken = false): string {
  const x = d.values[v], s = d.spec;
  if (v === 'melody') {
    const first = d.decades.find(z => z.v != null), last = [...d.decades].reverse().find(z => z.v != null);
    return first && last ? L(`warming, the melody: ${first.decade}s ${THEMES.climate.fmt(first.v!)} → ${last.decade}s ${THEMES.climate.fmt(last.v!)}`,
      `变暖，旋律：${first.decade} 年代 ${THEMES.climate.fmt(first.v!)} → ${last.decade} 年代 ${THEMES.climate.fmt(last.v!)}`) : L('warming: no data', '变暖：无数据');
  }
  if (x == null) return L(`${v}: no data`, `${({ air: '空气', rain: '雨', lightning: '闪电', lights: '灯光' } as Record<string, string>)[v]}：无数据`);
  if (v === 'air') return s.air && s.air.bpm > 0 ? L(`the air: a heartbeat, ${whoMultiple(x)}× the WHO guideline`, `空气：心跳，世卫指导值的 ${whoMultiple(x)} 倍`) : L('the air: a calm bass, clean', '空气：平稳的低音，干净');
  if (v === 'rain') return s.rain && s.rain.dropsPerSec > 0 ? L(`the rain: drops, ${catName(category(THEMES.rain, x))}`, `雨：雨滴，${catName(category(THEMES.rain, x))}`) : L('the rain: none, dry', '雨：没有，干的');
  if (v === 'lightning') return s.lightning && s.lightning.tapsPerSec > 0
    ? L(`lightning: marimba, ${catName(category(THEMES.lightning, x))} in ${P.monthName(d.month)}`, `闪电：木琴，${P.monthName(d.month)}${catName(category(THEMES.lightning, x))}`)
    : L(`lightning: none seen in ${P.monthName(d.month)}`, `闪电：${P.monthName(d.month)}没看到`);
  return s.lights && s.lights.twinklesPerSec > 0 ? L(`night lights: bells, ${catName(category(THEMES.lights, x))}`, `夜间灯光：铃声，${catName(category(THEMES.lights, x))}`) : L('night lights: none, dark', '夜间灯光：没有，黑的');
}
/** The song card's line while it plays: the voice that just joined, or the chorus with the decade the melody is on. */
function songLine(): string {
  const d = songNow; if (!d || songBar < 0) return '';
  const part = songPart(songBar), mi = melodyIndex(Math.max(songBar, SONG_ENTER.melody), 0), dec = mi != null ? d.decades[Math.min(mi, d.decades.length - 1)]?.decade : null;
  const decTxt = dec != null && songBar >= SONG_ENTER.melody && songBar < SONG_OUTRO ? L(` · melody: the ${dec}s`, ` · 旋律：${dec} 年代`) : '';
  if (part === 'intro') return L('the chords', '和弦');
  if (part === 'outro') return L('the end', '结尾');
  if (part === 'chorus') return `${L('all five together', '五个一起')}${decTxt}`;
  return `${part === 'melody' ? '' : '+ '}${voiceText(part, d)}${part === 'melody' ? '' : decTxt}`;
}
/** Exploring: play the song for the listening point (the Explore button). */
export async function playSongAt(lat: number, lon: number) {
  const my = ++run;
  await startAudio(); if (my !== run) return;
  AE.stopSolo();
  await ensureGrids(); if (my !== run) return;
  state.listening = true;
  await hearSongAt({ id: 'custom', en: '', zh: '', lat, lon }, my);
  if (my !== run) return;
  now = null; state.listening = false;
  const s = resultSentence('song', true);
  if (state.eyes) await sayAsync(s); else announce(s);
  window.dispatchEvent(new CustomEvent('hb:song', { detail: '' }));
}
export const songPlaying = () => now?.q === 'song';

/** What the part of "hear home" playing now is, in words (the card shows it while it plays). */
function partLabel(c: City) {
  if (now?.q === 'song') return songLine();
  if (homePart === 'space' && spaceAt) {
    const place = placeName(spaceAt.fix.lat, spaceAt.fix.lon).name;
    return L(`the station, over ${the(place)}: ${belowText(spaceAt)} below`, `空间站，在${place}上空：下面${belowText(spaceAt)}`);
  }
  const rain = reading('rain', c), air = reading('air', c);
  const drops = rain?.params?.theme === 'rain' && rain.params.p.dropsPerSec > 0, beat = air?.params?.theme === 'air' && air.params.p.bpm > 0;
  return homePart === 'room' ? L('a home: someone cooking', '家：有人在炒菜')
    : homePart === 'rain' ? (drops ? L('the rain: drops on the window', '雨：窗上的雨滴') : L('the rain: none, a quiet window', '雨：没有，窗外安静'))
    : homePart === 'air' ? (beat ? L('the air: a heartbeat, and the home shut in', '空气：心跳，家里闷了') : L('the air: clean, no heartbeat', '空气：干净，没有心跳'))
    : '';
}

async function hearAt(q: Question, c: City, my: number) {
  const id = THEME[q];
  if (!P.themeAvailable(id) || my !== run) return;
  if (state.theme !== id) await P.setTheme(id, { quiet: true });
  if (my !== run) return;
  now = { q: now?.q ?? q, at: c }; render();
  P.setListen({ lat: c.lat, lon: c.lon }, 'quiet');
  const r = reading(q, c); if (!r) return;
  const l = P.themeLayer(id) as LayerEntry;
  if (q === 'fever') {
    const ds = r.decades ?? [];
    await AE.playNotes(ds.map(d => climateParams(d.v, null)), GAP, i => { if (my === run) P.setStep(ds[i].lastIndex); });
  } else {
    P.setStep(l.steps.length - 1);
    if (r.params) await AE.previewOnce(r.params, HOLD);
  }
}

/** After a question: both places' answers in one sentence (spoken form for speech, written form for the screen). */
function resultSentence(q: Ask, spoken: boolean): string {
  if (q === 'song') {
    const d = lastSong;
    return d ? `${L(`Home song for ${cityName(d.c)}`, `${cityName(d.c)}的歌`)}: ${(['melody', 'air', 'rain', 'lightning', 'lights'] as SongVoice[]).map(v => voiceText(v, d, spoken)).join(L('; ', '；'))}.` : '';
  }
  if (q === 'space') {
    const s = lastSpace;
    return s ? L(`The station, at ${clock(s.fix.t)}: over ${the(placeName(s.fix.lat, s.fix.lon).name)}; below it, in NASA's data ${dayWord()}: ${belowText(s, spoken ? 'spoken' : 'written')}.`,
      `空间站，${clock(s.fix.t)}：在${placeName(s.fix.lat, s.fix.lon).name}上空；它下面（NASA ${dayWord()}的数据）：${belowText(s, spoken ? 'spoken' : 'written')}。`)
      : L('The station\'s position is not available.', '空间站的位置不可用。');
  }
  if (q === 'both') {
    const s = lastSpace;
    const sp = s ? L(`The station, at ${clock(s.fix.t)}: over ${the(placeName(s.fix.lat, s.fix.lon).name)}; below it, in NASA's data ${dayWord()}: ${belowText(s, spoken ? 'spoken' : 'written')}.`,
      `空间站，${clock(s.fix.t)}：在${placeName(s.fix.lat, s.fix.lon).name}上空；它下面（NASA ${dayWord()}的数据）：${belowText(s, spoken ? 'spoken' : 'written')}。`)
      : L('The station\'s position is not available.', '空间站的位置不可用。');
    return crew === 'astronaut' ? `${sp} ${resultSentence('home', spoken)}` : `${resultSentence('home', spoken)} ${sp}`;
  }
  if (q === 'home') {
    const at = (c: City) => [reading('rain', c), reading('air', c)].map(r => (r ? (spoken ? r.spoken : r.answer) : L('no data', '无数据'))).join(spoken ? L(', and the air: ', '，空气：') : '; ');
    return `${cityName(home)}: ${at(home)}.${other ? ` ${cityName(other)}: ${at(other)}.` : ''}`;
  }
  const a = reading(q, home), b = other ? reading(q, other) : null;
  const one = (c: City, r: Reading | null) => `${cityName(c)}: ${r ? (spoken ? r.spoken : r.answer) : L('no data', '无数据')}`;
  let rel = '';
  if (q === 'air' && a?.v != null && b?.v != null && other && Math.max(a.v, b.v) / Math.max(.5, Math.min(a.v, b.v)) >= 1.15) {
    const k = (Math.max(a.v, b.v) / Math.max(.5, Math.min(a.v, b.v))).toFixed(1), dirtier = a.v > b.v ? cityName(home) : cityName(other);
    rel = L(` ${dirtier}'s air is ${k} times dirtier.`, ` ${dirtier}的空气脏 ${k} 倍。`);
  }
  return `${one(home, a)}.${b && other ? ` ${one(other, b)}.` : ''}${rel}`;
}

export async function hear(q: Ask | 'all') {
  const my = ++run;
  await startAudio();
  if (my !== run) return;
  AE.stopSolo();
  if (loading) await ensureGrids();
  if (my !== run) return;
  now = { q, at: home }; lastAsked = null; state.listening = true; render();
  if (q === 'space') {
    lastSpace = null;
    if (state.eyes) await sayAsync(L('Where the station is.', '空间站那边。'));
    await hearSpaceAt(my);
    if (my !== run) return;
    const s = resultSentence('space', true);
    if (state.eyes) await sayAsync(s); else announce(s);
    if (my !== run) return;
    now = null; lastAsked = 'space'; homePart = null; state.listening = false;
    render();
    return;
  }
  if (q === 'both') {
    // here, then there: the astronaut hears the station's side first, the family hears home first
    const order = crew === 'astronaut' ? ['space', 'home'] : ['home', 'space'];
    lastSpace = null;
    for (const side of order) {
      if (my !== run) return;
      if (state.eyes) await sayAsync(side === 'space' ? L('Where the station is.', '空间站那边。') : `${L('Home', '家')}: ${cityName(home)}.`);
      if (side === 'space') await hearSpaceAt(my); else await hearHomeAt(home, my, 'both');
      if (my === run) await wait(500);
    }
    if (my !== run) return;
    const s = resultSentence('both', true);
    if (state.eyes) await sayAsync(s); else announce(s);
    if (my !== run) return;
    now = null; lastAsked = 'both'; homePart = null; state.listening = false;
    P.setListen({ lat: home.lat, lon: home.lon }, 'quiet');
    render();
    return;
  }
  if (q === 'song') {
    if (state.eyes) await sayAsync(`${ask('song')}: ${cityName(home)}.`);
    await hearSongAt(home, my);
    if (my !== run) return;
    const s = resultSentence('song', true);
    if (state.eyes) await sayAsync(s); else announce(s);
    if (my !== run) return;
    now = null; lastAsked = 'song'; state.listening = false;
    render();
    return;
  }
  if (q === 'home') {
    if (state.eyes) await sayAsync(`${ask('home')}: ${cityName(home)}.`);
    await hearHomeAt(home, my);
    if (other && my === run) { await wait(450); if (state.eyes && my === run) await sayAsync(cityName(other)); await hearHomeAt(other, my); }
    if (my !== run) return;
    const s = resultSentence('home', true);
    if (state.eyes) await sayAsync(s); else announce(s);
    if (my !== run) return;
    now = null; lastAsked = 'home'; state.listening = false;
    P.setListen({ lat: home.lat, lon: home.lon }, 'quiet');
    render();
    return;
  }
  const list = q === 'all' ? QUESTIONS : [q];
  for (const one of list) {
    if (my !== run) return;
    if (state.eyes) await sayAsync(`${ask(one)} ${cityName(home)}.`);
    if (my !== run) return;
    await hearAt(one, home, my);
    if (other && my === run) { await wait(450); if (state.eyes && my === run) await sayAsync(cityName(other)); await hearAt(one, other, my); }
    if (my !== run) return;
    const s = resultSentence(one, true);
    if (state.eyes) await sayAsync(s); else announce(s);
    if (list.length > 1) await wait(500);
  }
  if (my !== run) return;
  now = null; lastAsked = q; state.listening = false;
  P.setListen({ lat: home.lat, lon: home.lon }, 'quiet');
  render();
}

export function stopHearing() { run++; now = null; homePart = null; spaceAt = null; songNow = null; songBar = -1; state.listening = false; AE.stopSolo(); render(); window.dispatchEvent(new CustomEvent('hb:song', { detail: '' })); }

// ---------- choosing home ----------
export function setHome(c: City) {
  stopHearing();
  home = c; save(c);
  if (other && other.id === c.id) other = null;
  lastAsked = null;
  P.setListen({ lat: c.lat, lon: c.lon }, 'quiet');
  render();
  announce(L(`Home: ${cityName(c)}.`, `家：${cityName(c)}。`));
}
/** A tap on the globe while Home is open makes that point home. */
export function setHomeAt(lat: number, lon: number) { setHome({ id: 'custom', en: '', zh: '', lat, lon }); }

// ---------- open / close ----------
/** Open Home: `v` = 'mine' for "Hear my home", 'crew' for the signed-in role's page; omitted, the last page shown. */
export async function openHome(v?: 'crew' | 'mine') {
  if (v) view = v;
  if (!stationTimer) stationTimer = window.setInterval(tickStation, 2000);
  if (!open) {
    open = true;
    document.getElementById('app')!.classList.add('homeview');
    AE.setIdle(true);
  }
  P.setPlaying(false);
  P.setListen({ lat: home.lat, lon: home.lon }, 'quiet');
  if (state.dist > 2.6) state.dist = 2.6;
  loading = true; render();
  void ensureRoom().then(() => { if (open) render(); });
  await ensureGrids();
  loading = false; render();
}
export function closeHome() {
  if (!open) return;
  stopHearing();
  open = false; state.station = null;
  document.getElementById('app')!.classList.remove('homeview');
  AE.setIdle(false);
  render();
}

// ---------- rendering ----------
function options(sel: City | null, none?: string) {
  const groups = HOME_GROUPS.map(g => `<optgroup label="${L(g.en, g.zh)}">${g.cities.map(c => `<option value="${c.id}"${sel?.id === c.id ? ' selected' : ''}>${L(c.en, c.zh)}</option>`).join('')}</optgroup>`).join('');
  const custom = sel?.id === 'custom' ? `<option value="custom" selected>${cityName(sel)}</option>` : '';
  return `${none != null ? `<option value=""${sel ? '' : ' selected'}>${none}</option>` : ''}${custom}${groups}`;
}

export function render() {
  const card = $('home');
  // keep keyboard focus on the same control across re-renders
  const fa = document.activeElement as HTMLElement | null;
  const focusKey = fa && card.contains(fa) ? (fa.dataset.q ? `[data-q="${fa.dataset.q}"]` : fa.id ? `#${fa.id}` : '') : '';
  card.hidden = !open;
  renderEyes();
  if (!open) { card.innerHTML = ''; return; }
  const playing = (q: Ask, c: City) => `<span class="hm-now">${L('Now playing', '正在播放')}: ${homePart || q === 'song' ? partLabel(c) : cityName(c)}</span>`;
  const btn = (q: Ask, color: string, cls: string, ans: string, disabled = false) => {
    const on = !!now && now.q === q;
    return `<button type="button" class="hm-q ${cls}${on ? ' on' : ''}" data-q="${q}" style="--qc:${color}" aria-pressed="${on}"${loading || disabled ? ' disabled' : ''}>
      <span class="hm-play" aria-hidden="true">${on ? '■' : '▶'}</span>
      <span class="hm-ask">${ask(q)}</span>${ans ? `<span class="hm-ans num">${ans}</span>` : ''}
      <span class="hm-how">${how(q)}</span>${on && now ? playing(q, now.at) : ''}</button>`;
  };
  const homeAns = (c: City) => `${reading('rain', c)?.answer ?? '—'} · ${reading('air', c)?.answer ?? '—'}`;
  const hasRoom = roomClips.length > 0;
  const room = hasRoom ? `<label class="hm-room"><input type="checkbox" id="homeRoom"${roomOn ? ' checked' : ''}> <span>${L('Home sounds', '家里的声音')}</span></label>` : '';
  const rain = P.themeLayer('rain'), cl = P.themeLayer('climate');
  const when = rain ? `${P.whenLabel(rain, rain.steps.length - 1)}${ageNote()}` : '';
  const pick = `<label class="hm-pick"><span class="sr">${L('Choose your home', '选择你的家')}</span><select id="homeSel">${options(home)}</select></label>`;
  const result = lastAsked ? `<p class="hm-res" role="status">${resultText()}</p>` : '';

  // which page this is: the astronaut's, the family's, or "Hear my home"
  const app = document.getElementById('app')!;
  const role = shown();
  app.classList.toggle('crew-astro', open && role === 'astronaut');
  app.classList.toggle('crew-family', open && role === 'family');
  astroLayout();
  state.crewView = open ? role : null;
  state.homeMark = open && role ? { lat: home.lat, lon: home.lon } : null;

  if (role) {
    const lt = liveTexts(), canSpace = !!lt;
    const off = canSpace ? '' : `<p class="tg-off">${stationLine()}</p>`;
    const badge = `<div class="tg-top"><span class="tg-badge">${crew === 'astronaut' ? L('Astronaut · demo account', '宇航员 · 演示账号') : L('Family · demo account', '家人 · 演示账号')}</span>
      <button type="button" class="hm-out" id="homeSignOut">${L('Sign out', '退出登录')}</button></div>`;
    const fine = `<div class="tg-fine"><label class="hm-pick"><span>${L('Home', '家')}</span><select id="homeSel">${options(home)}</select></label>${room}
      <span>${L(`NASA data: rain and air ${when}; the station's trajectory. Home sound: a public recording, not your home.`, `NASA 数据：雨和空气 ${when}；空间站轨道。家里的声音是公开录音，不是你家。`)}</span></div>`;
    card.innerHTML = crew === 'astronaut' ? `
    <div class="tg tg-astro">
      <h2 class="sr" id="homeTitle">${L(`Home: ${cityName(home)}`, `家：${cityName(home)}`)}</h2>
      ${badge}
      <p class="tg-place" id="togetherLive">${lt?.place ?? ''}</p>
      ${canSpace ? `<p class="tg-count"><span class="tg-big" id="tgCount">${lt!.count}</span><span class="tg-sub" id="tgCountSub">${lt!.sub}</span></p>` : off}
      <div class="tg-acts">
        ${btn('home', 'var(--hearth)', 'hm-big tg-main', homeAns(home))}
        ${btn('both', 'var(--orbit)', 'tg-second', '', !canSpace)}
      </div>
      ${result}${fine}
    </div>` : `
    <div class="tg tg-family">
      <h2 class="sr" id="homeTitle">${L('Your astronaut', '你的宇航员')}</h2>
      ${badge}
      <p class="tg-kicker" aria-hidden="true">${L('Your astronaut is', '你的宇航员')}</p>
      <p class="tg-big" id="togetherLive">${lt?.place ?? L('on the space station', '在空间站上')}</p>
      ${canSpace ? `<p class="tg-sub" id="tgDist">${(lt as { dist?: string }).dist ?? ''}</p>
      <p class="tg-next"><span id="tgCount">${lt!.count}</span><small id="tgCountSub">${lt!.sub}</small></p>` : off}
      <div class="tg-acts">
        ${btn('space', 'var(--orbit)', 'hm-big tg-main', '', !canSpace)}
        ${btn('both', 'var(--hearth)', 'tg-second', '', !canSpace)}
      </div>
      ${result}${fine}
    </div>`;
  } else {
    const rows = QUESTIONS.map(q => {
      const t = THEMES[THEME[q]], a = reading(q, home), b2 = other ? reading(q, other) : null;
      const on = !!now && (now.q === q || now.q === 'all') && (now.q !== 'all' || state.theme === THEME[q]);
      const ans = loading ? L('Loading NASA data…', '正在载入 NASA 数据…')
        : `${other ? `<b>${cityName(home)}</b> ` : ''}${a?.answer ?? '—'}${other ? `<br><b>${cityName(other)}</b> ${b2?.answer ?? '—'}` : ''}`;
      return `<li><button type="button" class="hm-q${on ? ' on' : ''}" data-q="${q}" style="--qc:${t.color}" aria-pressed="${on}"${loading ? ' disabled' : ''}>
        <span class="hm-play" aria-hidden="true">${on ? '■' : '▶'}</span>
        <span class="hm-ask">${ask(q)}</span>
        <span class="hm-ans num">${ans}</span>
        <span class="hm-how">${how(q)}</span>${on && now ? `<span class="hm-now">${L('Now playing', '正在播放')}: ${cityName(now.at)}</span>` : ''}</button></li>`;
    }).join('');
    const hAns = loading ? L('Loading NASA data…', '正在载入 NASA 数据…') : [home, other].filter((c): c is City => !!c).map(c => `${other ? `<b>${cityName(c)}</b> ` : ''}${homeAns(c)}`).join('<br>');
    const src = [rain ? L(`Rain and air: NASA Earth Information Center (GEOS model), ${when}`, `降雨和空气：NASA 地球信息中心（GEOS 模式），${when}`) : '',
      cl ? L(`warming: NASA GISTEMP v4, ${cl.steps[0].t}–${cl.steps[cl.steps.length - 1].t}`, `变暖：NASA GISTEMP v4，${cl.steps[0].t}–${cl.steps[cl.steps.length - 1].t}`) : ''].filter(Boolean).join(' · ');
    card.innerHTML = `
    <div class="hm-head"><span class="micro">${L('Home', '家')}</span>${pick}</div>
    ${crew ? `<button type="button" class="hm-out hm-back" id="homeCrewView">${crew === 'astronaut' ? L('← Astronaut page', '← 宇航员页面') : L('← Family page', '← 家人页面')}</button>` : ''}
    <h2 class="hm-title" id="homeTitle">${L(`How is ${cityName(home)} doing?`, `${cityName(home)}${newestStep() && isToday(newestStep()!) ? '今天' : ''}好吗？`)}</h2>
    <p class="hm-sub">${L('Press to hear NASA\'s data, then read the number.', '按一下，听 NASA 的数据，再看数字。')}</p>
    <div class="hm-home">
      ${btn('home', 'var(--hearth)', 'hm-big', hAns).replace(`<span class="hm-ans num">${homeAns(home)}</span>`, `<span class="hm-ans num">${hAns}</span>`)}
      ${room ? `<div class="hm-row">${room}<span class="hm-note">${L('A public recording, not your home.', '公开录音，不是你家。')}</span></div>` : ''}
      ${btn('song', 'var(--song)', 'hm-song', '')}
    </div>
    <p class="hm-or micro">${L('Or ask one at a time', '或者一个一个问')}</p>
    <ol class="hm-qs">${rows}</ol>
    <div class="hm-row">
      <button type="button" class="cu-btn" id="homeAll"${loading ? ' disabled' : ''}>${now?.q === 'all' ? L('■ Stop', '■ 停止') : L('▶ Hear all three', '▶ 三个都听')}</button>
      <label class="hm-cmp"><span>${L('Compare with', '对比')}</span><select id="homeCmp">${options(other, L('nowhere else', '不对比'))}</select></label>
    </div>
    ${result}
    <p class="hm-src">${src}</p>`;
  }
  card.querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.q as Ask;
    if (now && (now.q === q)) stopHearing(); else hear(q);
  }));
  document.getElementById('homeRoom')?.addEventListener('change', e => { stopHearing(); setRoomOn((e.target as HTMLInputElement).checked); });
  document.getElementById('homeCrewView')?.addEventListener('click', () => { stopHearing(); view = 'crew'; tickStation(); render(); ($('homeTitle') as HTMLElement | null)?.focus?.(); });
  document.getElementById('homeSignOut')?.addEventListener('click', () => { signOut(); ($('homeSel') as HTMLElement).focus(); });
  document.getElementById('homeAll')?.addEventListener('click', () => { if (now?.q === 'all') stopHearing(); else hear('all'); });
  $<HTMLSelectElement>('homeSel').addEventListener('change', e => { const c = homeById((e.target as HTMLSelectElement).value); if (c) setHome(c); });
  document.getElementById('homeCmp')?.addEventListener('change', e => {
    const v = (e.target as HTMLSelectElement).value; stopHearing();
    other = v ? homeById(v) ?? null : null; lastAsked = null; render();
    announce(other ? L(`Comparing with ${cityName(other)}.`, `与${cityName(other)}对比。`) : L('No comparison.', '不对比。'));
  });
  if (focusKey) (card.querySelector(focusKey) as HTMLElement | null)?.focus();
}

/** The astronaut's page on a desktop or laptop window: the porthole on the left, as large as the window's height allows,
 *  and the panel beside it (nothing on top of the porthole, nothing cut off on a short window); the globe's centre
 *  follows the porthole's centre. Phones keep the stacked page (porthole above, panel below). */
function astroLayout() {
  const app = document.getElementById('app'), viz = document.getElementById('viz'); if (!app || !viz) return;
  const on = open && shown() === 'astronaut' && window.innerWidth > 860;
  app.classList.toggle('astro-side', on);
  if (!on) {
    state.viewCenter = null;
    for (const p of ['--phx', '--phy', '--ph']) viz.style.removeProperty(p);
    for (const p of ['--hud-left', '--hud-w']) app.style.removeProperty(p);
    return;
  }
  const W = viz.clientWidth, H = viz.clientHeight, top = 84, pad = 28;
  const r = Math.max(110, Math.min((H - top) / 2 - 22, W * .26));
  const cx = Math.max(r + 32, W * .28), cy = top + (H - top) / 2;
  const free = cx + r + 40, hudW = Math.max(300, Math.min(520, W - pad - free));
  viz.style.setProperty('--phx', `${cx}px`); viz.style.setProperty('--phy', `${cy}px`); viz.style.setProperty('--ph', `${r}px`);
  app.style.setProperty('--hud-left', `${free + Math.max(0, (W - pad - free - hudW) / 2)}px`); app.style.setProperty('--hud-w', `${hudW}px`);
  state.viewCenter = { x: cx / W, y: cy / H };
}
window.addEventListener('resize', () => { if (open) astroLayout(); });

/** In eyes-closed mode the three questions are large buttons on the black screen. */
function renderEyes() {
  const box = document.getElementById('eyesHome'); if (!box) return;
  if (!open) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const fa = document.activeElement as HTMLElement | null;
  const key = fa && box.contains(fa) ? (fa.dataset.q ? `[data-q="${fa.dataset.q}"]` : 'all' in fa.dataset ? '[data-all]' : 'explore' in fa.dataset ? '[data-explore]' : '') : '';
  box.innerHTML = `<p class="et-title">${L(`Home: ${cityName(home)}`, `家：${cityName(home)}`)}</p>
    ${shown() ? `<p class="et-sub">${stationLine()}</p>` : ''}
    <div class="et-row">${((shown() ? ['both', 'home'] : ['home', 'song', ...QUESTIONS]) as Ask[]).map(q => `<button type="button" class="k" data-q="${q}">${ask(q)}</button>`).join('')}
      ${shown() ? '' : `<button type="button" class="k" data-all>${L('All three', '三个都听')}</button>`}
      <button type="button" class="k" data-explore>${L('Explore the globe', '探索整个地球')}</button></div>`;
  box.querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b => b.addEventListener('click', () => hear(b.dataset.q as Ask)));
  box.querySelector('[data-all]')?.addEventListener('click', () => hear('all'));
  box.querySelector('[data-explore]')?.addEventListener('click', () => { closeHome(); say(L('Exploring the globe. Use the arrow keys to move.', '探索地球。用方向键移动。')); });
  if (key) (box.querySelector(key) as HTMLElement | null)?.focus();
}

/** Spoken introduction for eyes-closed mode while Home is open. */
export const homeIntro = () => L(`Home: ${cityName(home)}. Press "hear home" for a home, then NASA's rain and air ${dayWord()}, one at a time, or ask one of three questions: is it raining, is the air clean, and how much warmer than in 1951 to 1980.`,
  `家：${cityName(home)}。按“听听家里”，先听一个家，再一样一样听 NASA 数据里${dayWord()}的雨和空气；或者问三个问题之一：在下雨吗，空气干净吗，比 1951 至 1980 年暖了多少。`);

/** For tests. */
export const homeDebug = () => ({ open, loading, crew: !!crew, role: crew, view: shown() ? 'crew' : 'mine', station: station ? { start: station.start, stop: station.stop, now: stationAt(station, stationNow()), onGlobe: !!state.station } : null, space: spaceAt ? { lat: spaceAt.fix.lat, lon: spaceAt.fix.lon, rain: spaceAt.rain?.dropsPerSec ?? 0, bpm: spaceAt.air?.bpm ?? 0, lv: spaceAt.lv, taps: spaceAt.lightning?.tapsPerSec ?? 0 } : null, stationLine: stationLine(), dataToday: !!newestStep() && isToday(newestStep()!), home: { ...home }, other: other ? { ...other } : null, now: now ? { q: now.q, at: now.at.id } : null, part: homePart, lastResult: resultText(), roomOn, roomClips: roomClips.map(c => c.id), engine: AE.homeState(), song: songNow ? { bar: songBar, line: songLine() } : null, songResult: resultSentence('song', false) });
