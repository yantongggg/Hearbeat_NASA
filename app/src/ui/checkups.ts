/**
 * Check-ups: four questions about the NASA data on screen, each with a goal, a hint and an answer
 * the app checks. Every attempt is logged (time, result, hints, eyes-closed or not) so a listening
 * test can be run with the app itself; the log stays in this browser and can be copied as CSV.
 */
import { $ } from '../core/util';
import { L, getLang } from '../core/i18n';
import { state, live } from '../core/state';
import { layer, gridSync, getGrid } from '../data/manifest';
import { sample } from '../data/grid';
import {
  SEA, inBox, cellsIn, rainGoal, nearestAtLeast, dryStart, KL, PARTNERS, pickPartner, worstDay,
  feverBand, FEVER_BANDS, toCsv, type City, type FeverBand, type LogRow, type Cell
} from '../data/checkup-logic';
import { THEMES, category, catName, type ThemeId } from '../themes';
import * as P from '../player';
import { dirName, bearing, placeName } from '../geo/places';
import { say, announce, toast } from './speech';
import { startAudio } from './controls';
import { AE } from '../audio/engine';
import { closeHome } from './home';

type Opt = { id: string; label: string };
interface Active {
  n: number; id: string; theme: ThemeId; t0: number; hints: number; done: boolean;
  title: string; goal: string; kind: 'find' | 'choose';
  // find
  goalV?: number; cells?: Cell[];
  // choose
  options?: Opt[]; answer?: string; explain?: (picked: string) => string; listen?: City[];
  // haze: each day's average, to listen to one at a time
  days?: Array<{ day: string; mean: number; step: number }>; playingDay?: string;
  // the answer's result; kept here so that a later re-render (a day's preview ending, a mode switch) still shows it
  result?: { text: string; ok: boolean };
  hint: () => string;
}

export const CHECKUPS: Array<{ id: string; sign: [string, string]; title: [string, string] }> = [
  { id: 'rain', sign: ['Circulation', '循环'], title: ['Where is it raining hardest in Southeast Asia in the newest NASA data?', '最新的 NASA 数据里，东南亚哪里雨下得最大？'] },
  { id: 'air', sign: ['Breathing', '呼吸'], title: ['Whose air is dirtier in the newest NASA data?', '最新的 NASA 数据里，谁的空气更脏？'] },
  { id: 'haze', sign: ['Breathing over time', '五天的呼吸'], title: ['On which day was Kuala Lumpur\'s air at its worst?', '吉隆坡哪一天的空气最差？'] },
  { id: 'fever', sign: ['Fever', '发烧'], title: ['How much warmer was Kuala Lumpur in 2025 than in 1951–1980?', '2025 年的吉隆坡比 1951–1980 年暖了多少？'] }
];

let A: Active | null = null;
const LOG_KEY = 'hearthbeat-checkups-v1';
const readLog = (): LogRow[] => { try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]'); } catch { return []; } };
const writeLog = (rows: LogRow[]) => { try { localStorage.setItem(LOG_KEY, JSON.stringify(rows)); } catch { /* storage blocked: keep in memory */ } };
let memLog: LogRow[] = readLog();
export const checkupLog = () => memLog;
export const activeCheckup = () => A;

const cityName = (c: City) => L(c.en, c.zh);
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dayLabel = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z');
  return getLang() === 'zh' ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日` : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

function valueAtLayer(key: string, step: number, lat: number, lon: number): number | null {
  const l = layer(key), q = gridSync(key, step); if (!l || !q) return null;
  return sample(q, lat, lon, l.grid, l.encoding);
}

// ---------- the four check-ups ----------
async function setupRain(): Promise<Partial<Active>> {
  await P.setTheme('rain', { quiet: true });
  const l = P.themeLayer('rain')!, step = l.steps.length - 1;
  P.setStep(step);
  const q = (await getGrid(l.key, step))!;
  const cells = cellsIn(q, l.grid, l.encoding, SEA), goal = rainGoal(cells);
  // start in the Indian Ocean on the western edge of the region, wherever it is driest
  const start = dryStart(cells, goal, [{ lat: -10, lon: 95 }, { lat: 8, lon: 92 }, { lat: 17, lon: 90 }, { lat: -10, lon: 106 }]);
  P.setListen(start, 'preset');
  state.center = { lat: 5, lon: 112 }; state.target = null;
  return {
    kind: 'find', goalV: goal, cells,
    goal: L(`Find a place in Southeast Asia with at least ${goal.toFixed(1)} mm/h of rain. Move the stethoscope (tap or click a place, or use the arrow keys) and listen: the more drops, the harder it rains.`,
      `在东南亚找到雨量至少 ${goal.toFixed(1)} mm/h 的地方。移动听诊器（点击某个地方，或用方向键）并聆听：雨滴越密，雨越大。`),
    hint: () => {
      const n = nearestAtLeast(cells, state.listen, goal);
      if (!n) return L('No place in the box reaches the goal at this hour.', '这个时刻没有地方达到目标。');
      return L(`Rain that heavy is about ${Math.round(n.km / 100) * 100} km to the ${dirName(bearing(state.listen, n))}.`,
        `那么大的雨在${dirName(bearing(state.listen, n))}方向约 ${Math.round(n.km / 100) * 100} 公里处。`);
    }
  };
}

async function setupAir(): Promise<Partial<Active>> {
  await P.setTheme('air', { quiet: true });
  const l = P.themeLayer('air')!, step = l.steps.length - 1;
  P.setStep(step);
  await getGrid(l.key, step);
  const klV = valueAtLayer(l.key, step, KL.lat, KL.lon) ?? 0;
  const pick = pickPartner(klV, PARTNERS.map(city => ({ city, v: valueAtLayer(l.key, step, city.lat, city.lon) })));
  const other = pick?.city ?? PARTNERS[0], oV = pick?.v ?? 0;
  P.setListen({ lat: KL.lat, lon: KL.lon }, 'preset');
  const t = THEMES.air, x = (v: number) => (v / 15).toFixed(v < 30 ? 1 : 0);
  const answer = klV >= oV ? KL.id : other.id;
  return {
    kind: 'choose', listen: [KL, other],
    goal: L(`Listen to ${cityName(KL)} and to ${cityName(other)}. The faster the heartbeat (and the more muffled the music), the dirtier the air. Then choose.`,
      `分别听${cityName(KL)}和${cityName(other)}。心跳越快（音乐越闷），空气越脏。然后作答。`),
    options: [{ id: KL.id, label: cityName(KL) }, { id: other.id, label: cityName(other) }], answer,
    explain: () => L(`${cityName(KL)}: ${t.fmt(klV)} (${x(klV)}× the WHO guideline). ${cityName(other)}: ${t.fmt(oV)} (${x(oV)}×).`,
      `${cityName(KL)}：${t.fmt(klV)}（世卫指导值的 ${x(klV)} 倍）。${cityName(other)}：${t.fmt(oV)}（${x(oV)} 倍）。`),
    hint: () => L('At each city, press “Read aloud” (or Enter while the globe has focus) to hear the exact number.', '在每个城市按“读出数值”（或在地球获得焦点时按 Enter），可以听到准确数字。')
  };
}

async function setupHaze(): Promise<Partial<Active>> {
  await P.setTheme('air', { quiet: true });
  const l = P.themeLayer('air')!;
  await Promise.all(l.steps.map((_, i) => getGrid(l.key, i)));
  const series = l.steps.map((s, i) => ({ t: s.t, v: valueAtLayer(l.key, i, KL.lat, KL.lon) }));
  const w = worstDay(series)!;
  P.setListen({ lat: KL.lat, lon: KL.lon }, 'preset');
  const noonOf = (day: string) => { const i = l.steps.findIndex(s => s.t.startsWith(`${day}T12`)); return i >= 0 ? i : l.steps.findIndex(s => s.t.startsWith(day)); };
  const days = w.days.map(d => ({ ...d, step: noonOf(d.day) }));
  P.setStep(days[0]?.step ?? 0);
  const t = THEMES.air;
  return {
    kind: 'choose', days,
    goal: L(`Tap each day to hear ${cityName(KL)}'s air on that day (the day's average). The faster the heartbeat, the dirtier the air. Then choose the worst day.`,
      `逐个点每一天，听${cityName(KL)}当天的空气（当天平均）。心跳越快，空气越脏。然后选出最差的那一天。`),
    options: w.days.map(d => ({ id: d.day, label: dayLabel(d.day) })), answer: w.day,
    explain: () => L(`Daily means: ${w.days.map(d => `${dayLabel(d.day)} ${t.fmt(d.mean)}`).join(', ')}.`,
      `每日平均：${w.days.map(d => `${dayLabel(d.day)} ${t.fmt(d.mean)}`).join('，')}。`),
    hint: () => L('Tap two days one after the other and compare how fast the heartbeat is. Keep the faster one and compare it with the next day.', '先后点两天，比较心跳的快慢；留下较快的那天，再和下一天比较。')
  };
}

async function setupFever(): Promise<Partial<Active>> {
  P.setListen({ lat: KL.lat, lon: KL.lon }, 'preset');
  await P.setTheme('climate', { quiet: true });
  const l = P.themeLayer('climate')!, last = l.steps.length - 1;
  await getGrid(l.key, last);
  const v = valueAtLayer(l.key, last, KL.lat, KL.lon) ?? 0;
  P.setStep(0); P.setPlaying(true);
  const label: Record<FeverBand, [string, string]> = {
    cooler: ['Cooler', '更冷'], same: ['About the same (within 0.5 °C)', '差不多（0.5 °C 以内）'],
    warmer: ['Warmer by 0.5–1.5 °C', '暖 0.5–1.5 °C'], much: ['Warmer by more than 1.5 °C', '暖超过 1.5 °C']
  };
  const g = l.series?.global?.find(s => s.t === l.steps[last].t)?.v;
  return {
    kind: 'choose',
    goal: L(`The years play from 1880. Each note is one year in ${cityName(KL)}: the higher, the warmer. Listen to how high the last notes are, then choose.`,
      `年份从 1880 年开始播放。每个音是${cityName(KL)}的一年：音越高越暖。听最后几个音有多高，然后作答。`),
    options: FEVER_BANDS.map(b => ({ id: b, label: L(label[b][0], label[b][1]) })), answer: feverBand(v),
    explain: () => L(`${cityName(KL)} in 2025: ${THEMES.climate.fmt(v)} compared with 1951–1980${g != null ? `; the whole planet: ${THEMES.climate.fmt(g)}` : ''}.`,
      `2025 年的${cityName(KL)}：与 1951–1980 年相比 ${THEMES.climate.fmt(v)}${g != null ? `；全球：${THEMES.climate.fmt(g)}` : ''}。`),
    hint: () => L('Wait for 2025 (the end), then press “Read aloud” (or Enter while the globe has focus) to hear the exact number.', '等到 2025 年（结尾），再按“读出数值”（或在地球获得焦点时按 Enter）听准确数字。')
  };
}

const SETUP: Record<string, () => Promise<Partial<Active>>> = { rain: setupRain, air: setupAir, haze: setupHaze, fever: setupFever };
const THEME_OF: Record<string, ThemeId> = { rain: 'rain', air: 'air', haze: 'air', fever: 'climate' };

export async function startCheckup(n: number) {
  const def = CHECKUPS[n]; if (!def) return;
  if (!P.themeAvailable(THEME_OF[def.id])) { toast(L('This check-up needs a track that is unavailable in this data build.', '这个检查需要的曲目本次不可用。')); return; }
  startAudio();
  closeHome();
  if (A && !A.done) finish('skipped', '');
  P.setPlaying(false);
  AE.setFocus(true);
  const extra = await SETUP[def.id]();
  A = { n, id: def.id, theme: THEME_OF[def.id], t0: performance.now(), hints: 0, done: false, title: L(def.title[0], def.title[1]), ...extra } as Active;
  render();
  const intro = `${L(`Check-up ${n + 1} of 4`, `第 ${n + 1} 项检查，共 4 项`)}. ${A.title} ${A.goal}`;
  announce(intro);
  if (state.eyes) say(intro);
}

function finish(result: LogRow['result'], detail: string) {
  if (!A || A.done) return;                    // one log row per check-up, however often a button is pressed
  A.done = true;
  const row: LogRow = { when: new Date().toISOString(), checkup: A.id, mode: state.eyes ? 'eyes-closed' : 'eyes-open', lang: getLang(),
    seconds: (performance.now() - A.t0) / 1000, result, hints: A.hints, detail };
  memLog = [...memLog, row]; writeLog(memLog);
  return row;
}

function solved(msg: string, ok: boolean, detail: string) {
  if (!A || A.done) return;
  const row = finish(ok ? (A.kind === 'find' ? 'found' : 'correct') : 'wrong', detail)!;
  const head = ok ? L(`Well done — ${fmtSec(row.seconds)}.`, `完成——用时 ${fmtSec(row.seconds)}。`) : L('Not quite.', '不对。');
  const text = `${head} ${msg}`;
  A.result = { text, ok };
  render(true);
  if (state.eyes) say(text); else announce(text);
  try { navigator.vibrate?.(ok ? [30, 60, 30] : [120]); } catch { /* unsupported */ }
}

/** Called by the app loop: completes a "find" check-up when the listening point reaches the goal. */
export function tickCheckup() {
  if (!A || A.done || A.kind !== 'find' || state.theme !== A.theme) { renderTimer(); return; }
  const v = live.v;
  if (v != null && A.goalV != null && v >= A.goalV && inBox(state.listen.lat, state.listen.lon, SEA)) {
    const name = placeName(state.listen.lat, state.listen.lon).name, t = THEMES[A.theme];
    solved(L(`You found ${catName(category(t, v))} at ${name}: ${t.fmt(v)}.`, `你在${name}找到了${catName(category(t, v))}：${t.fmt(v)}。`), true, `${name} ${t.fmt(v)}`);
  }
  renderTimer();
}

/** Check-up 3: hold the sound on one day's average for a few seconds (and show that day on the globe). */
function playDay(day: string) {
  const d = A?.days?.find(x => x.day === day); if (!A || !d) return;
  startAudio();
  A.playingDay = day;
  if (d.step >= 0) P.setStep(d.step);
  AE.previewOnce(P.paramsFor('air', d.mean), 4).then(() => { if (A?.playingDay === day) { A.playingDay = undefined; if (!A.done) render(); } });
  render();
}

function choose(id: string) {
  if (!A || A.done || A.kind !== 'choose') return;
  const ok = id === A.answer, label = A.options?.find(o => o.id === id)?.label ?? id;
  const right = A.options?.find(o => o.id === A!.answer)?.label ?? '';
  solved(`${ok ? '' : L(`The answer is ${right}. `, `答案是${right}。`)}${A.explain?.(id) ?? ''}`, ok, `picked ${label}`);
}

function hint() {
  if (!A || A.done) return;
  A.hints++;
  const h = A.hint();
  $('cuHint').textContent = h; $('cuHint').hidden = false;
  if (state.eyes) say(h); else announce(h);
}

// ---------- rendering ----------
let timerEl: HTMLElement | null = null;
function renderTimer() {
  if (!A || !timerEl) return;
  if (!A.done) timerEl.textContent = fmtSec((performance.now() - A.t0) / 1000);
}

/** Draw the check-up card. `focusNext` moves focus to the next button (only right after an answer). */
export function render(focusNext = false) {
  const card = $('checkup');
  if (!A) { card.hidden = true; renderEyes(); return; }
  const result = A.result?.text, ok = A.result?.ok;
  // the card is redrawn whole; remember which of its buttons had keyboard focus, to give it back
  const act = document.activeElement as HTMLElement | null, d = act && card.contains(act) ? act.dataset : null;
  const held = !act || !d ? '' : act.id ? `#${act.id}` : d.day ? `[data-day="${d.day}"]` : d.opt ? `[data-opt="${d.opt}"]` : d.listen ? `[data-listen="${d.listen}"]` : '';
  card.hidden = false;
  const def = CHECKUPS[A.n];
  const listen = A.listen ? `<div class="cu-row">${A.listen.map(c => `<button type="button" class="cu-btn ghost" data-listen="${c.id}">${L('Listen', '听')}: ${cityName(c)}</button>`).join('')}</div>` : '';
  const dayRow = A.days && !A.done ? `<div class="cu-row" role="group" aria-label="${L('Listen to a day', '听某一天')}"><span class="cu-lbl micro" aria-hidden="true">${L('Listen', '听')}</span>${A.days.map(d => `<button type="button" class="cu-btn ghost${A!.playingDay === d.day ? ' on' : ''}" data-day="${d.day}" aria-pressed="${A!.playingDay === d.day}">▶ ${dayLabel(d.day)}</button>`).join('')}</div>` : '';
  const opts = A.options && !A.done ? `<div class="cu-row" role="group" aria-label="${L('Your answer', '你的答案')}"><span class="cu-lbl micro" aria-hidden="true">${L('Your answer', '你的答案')}</span>${A.options.map(o => `<button type="button" class="cu-btn" data-opt="${o.id}">${o.label}</button>`).join('')}</div>` : '';
  const next = A.n < CHECKUPS.length - 1 ? `<button type="button" class="cu-btn" id="cuNext">${L('Next check-up', '下一项检查')} →</button>` : `<button type="button" class="cu-btn" id="cuAll">${L('See results', '查看结果')}</button>`;
  card.innerHTML = `
    <div class="cu-head"><span class="micro">${L(`Check-up ${A.n + 1} / 4`, `检查 ${A.n + 1} / 4`)} · ${L(def.sign[0], def.sign[1])}</span>
      <span class="cu-time num" id="cuTime" aria-hidden="true"></span>
      <button type="button" class="cu-x" id="cuClose" aria-label="${L('Close check-up', '关闭检查')}">×</button></div>
    <h2 class="cu-title" id="cuTitle">${A.title}</h2>
    ${A.done ? '' : `<p class="cu-goal">${A.goal}</p>`}
    ${A.done ? '' : listen}${dayRow}${opts}
    <p class="cu-hint" id="cuHint" hidden></p>
    ${result ? `<p class="cu-result ${ok ? 'ok' : 'bad'}" role="status">${result}</p>` : ''}
    <div class="cu-row cu-foot">${A.done ? next : `<button type="button" class="cu-btn ghost" id="cuHintBtn">${L('Hint', '提示')}</button><button type="button" class="cu-btn ghost" id="cuSkip">${L('Skip', '跳过')}</button>`}</div>`;
  timerEl = $('cuTime'); renderTimer();
  card.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach(b => b.addEventListener('click', () => choose(b.dataset.opt!)));
  card.querySelectorAll<HTMLButtonElement>('[data-day]').forEach(b => b.addEventListener('click', () => playDay(b.dataset.day!)));
  card.querySelectorAll<HTMLButtonElement>('[data-listen]').forEach(b => b.addEventListener('click', () => {
    const c = A?.listen?.find(x => x.id === b.dataset.listen); if (!c) return;
    startAudio(); P.setListen({ lat: c.lat, lon: c.lon }, 'preset');
  }));
  card.querySelector('#cuHintBtn')?.addEventListener('click', hint);
  card.querySelector('#cuSkip')?.addEventListener('click', () => {
    const n = A?.n ?? 0; finish('skipped', '');
    if (n >= CHECKUPS.length - 1) { closeCheckup(); openResults(); } else startCheckup(n + 1);   // skipping the last one shows the results
  });
  card.querySelector('#cuNext')?.addEventListener('click', () => startCheckup((A?.n ?? 0) + 1));
  card.querySelector('#cuAll')?.addEventListener('click', () => { closeCheckup(); openResults(); });
  card.querySelector('#cuClose')?.addEventListener('click', closeCheckup);
  if (focusNext) (card.querySelector('#cuNext, #cuAll') as HTMLElement | null)?.focus();
  else if (held) (card.querySelector(held) as HTMLElement | null)?.focus();
  renderEyes(result);
}

export function closeCheckup() {
  if (A && !A.done) finish('skipped', '');
  A = null; AE.setFocus(false); render();
}

/** In eyes-closed mode the check-up appears as large buttons on the black screen too. */
function renderEyes(result?: string) {
  const box = $('eyesTask');
  if (!A) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<p class="et-title">${L(`Check-up ${A.n + 1}`, `检查 ${A.n + 1}`)}: ${A.title}</p>
    ${result ? `<p class="et-res">${result}</p>` : ''}
    <div class="et-row">
      ${!A.done && A.listen ? A.listen.map(c => `<button type="button" class="k" data-listen="${c.id}">${L('Listen', '听')}: ${cityName(c)}</button>`).join('') : ''}
      ${!A.done && A.days ? A.days.map(d => `<button type="button" class="k" data-day="${d.day}">${L('Listen', '听')}: ${dayLabel(d.day)}</button>`).join('') : ''}
      ${!A.done && A.options ? A.options.map(o => `<button type="button" class="k" data-opt="${o.id}">${L('Answer', '回答')}: ${o.label}</button>`).join('') : ''}
      ${A.done ? (A.n < CHECKUPS.length - 1 ? `<button type="button" class="k" data-next>${L('Next check-up', '下一项检查')}</button>` : '') : `<button type="button" class="k" data-hint>${L('Hint', '提示')}</button><button type="button" class="k" data-goal>${L('Repeat the question', '重复问题')}</button>`}
    </div>`;
  box.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach(b => b.addEventListener('click', () => choose(b.dataset.opt!)));
  box.querySelectorAll<HTMLButtonElement>('[data-day]').forEach(b => b.addEventListener('click', () => playDay(b.dataset.day!)));
  box.querySelectorAll<HTMLButtonElement>('[data-listen]').forEach(b => b.addEventListener('click', () => {
    const c = A?.listen?.find(x => x.id === b.dataset.listen); if (c) P.setListen({ lat: c.lat, lon: c.lon }, 'preset');
  }));
  box.querySelector('[data-hint]')?.addEventListener('click', hint);
  box.querySelector('[data-goal]')?.addEventListener('click', () => { if (A) say(`${A.title} ${A.goal}`); });
  box.querySelector('[data-next]')?.addEventListener('click', () => startCheckup((A?.n ?? 0) + 1));
}

// ---------- results dialog ----------
export function openResults() {
  const dlg = $<HTMLDialogElement>('results');
  renderResults();
  if (!dlg.open) dlg.showModal();
}
function renderResults() {
  const rows = memLog;
  const name = (id: string) => { const c = CHECKUPS.find(x => x.id === id); return c ? `${CHECKUPS.indexOf(c) + 1}. ${L(c.sign[0], c.sign[1])}` : id; };
  const res = (r: LogRow['result']) => ({ found: L('found', '找到'), correct: L('correct', '正确'), wrong: L('wrong', '错误'), skipped: L('skipped', '跳过') })[r];
  const summary = CHECKUPS.map((c, i) => {
    const rs = rows.filter(r => r.checkup === c.id && r.result !== 'skipped');
    const ok = rs.filter(r => r.result === 'found' || r.result === 'correct');
    const t = ok.map(r => r.seconds).sort((a, b) => a - b), med = t.length ? t[Math.floor(t.length / 2)] : null;
    return `<li><button type="button" class="cu-btn" data-start="${i}">${i + 1}. ${L(c.title[0], c.title[1])}</button>
      <span class="num">${rs.length ? `${ok.length}/${rs.length} ${L('right', '正确')}${med != null ? ` · ${L('median', '中位数')} ${fmtSec(med)}` : ''}` : L('not tried yet', '还没做过')}</span></li>`;
  }).join('');
  $('resultsBody').innerHTML = `
    <p>${L('Each check-up asks a real question about the NASA data on screen, and the app checks the answer against that data. Results stay in this browser. For a listening test, note who took part (for example, blindfolded sighted volunteers are not visually impaired users).',
      '每项检查都针对屏幕上的 NASA 数据提出一个真实问题，答案由程序根据这些数据核对。结果只保存在这个浏览器里。做聆听测试时，请记下参与者是谁（例如蒙眼的明眼志愿者不等于视障用户）。')}</p>
    <ol class="cu-list">${summary}</ol>
    <p class="cu-pack">${L('For teachers: the classroom pack (PDF) has a 40-minute lesson, the four check-up cards in large print, a listening-test guide and a tactile map.', '给老师：课堂资料包（PDF）包括 40 分钟课堂、四张大字检查卡、聆听测试指南和触觉地图。')}
      <a href="classroom/hearthbeat-classroom-pack-en.pdf" target="_blank" rel="noopener">${L('English', '英文版')}</a> · <a href="classroom/hearthbeat-classroom-pack-zh.pdf" target="_blank" rel="noopener" lang="zh">中文</a></p>
    <h3>${L('Log', '记录')} (${rows.length})</h3>
    ${rows.length ? `<div class="cu-tablewrap"><table><thead><tr><th>${L('When', '时间')}</th><th>${L('Check-up', '检查')}</th><th>${L('Mode', '模式')}</th><th>${L('Time', '用时')}</th><th>${L('Result', '结果')}</th><th>${L('Hints', '提示')}</th></tr></thead><tbody>
      ${rows.slice().reverse().map(r => `<tr><td class="num">${r.when.slice(0, 16).replace('T', ' ')}</td><td>${name(r.checkup)}</td><td>${r.mode === 'eyes-closed' ? L('eyes closed', '闭眼') : L('eyes open', '睁眼')}</td><td class="num">${fmtSec(r.seconds)}</td><td>${res(r.result)}</td><td class="num">${r.hints}</td></tr>`).join('')}
    </tbody></table></div>` : `<p>${L('No check-ups yet.', '还没有检查记录。')}</p>`}
    <div class="cu-row"><button type="button" class="cu-btn" id="cuCopy" ${rows.length ? '' : 'disabled'}>${L('Copy results (CSV)', '复制结果（CSV）')}</button>
      <button type="button" class="cu-btn ghost" id="cuClear" ${rows.length ? '' : 'disabled'}>${L('Clear results', '清除结果')}</button></div>
    <textarea id="cuCsv" class="cu-csv" readonly hidden aria-label="CSV"></textarea>`;
  $('resultsBody').querySelectorAll<HTMLButtonElement>('[data-start]').forEach(b => b.addEventListener('click', () => { $<HTMLDialogElement>('results').close(); startCheckup(+b.dataset.start!); }));
  $('cuCopy').addEventListener('click', async () => {
    const csv = toCsv(memLog);
    try { await navigator.clipboard.writeText(csv); toast(L('Copied.', '已复制。')); }
    catch { const ta = $<HTMLTextAreaElement>('cuCsv'); ta.hidden = false; ta.value = csv; ta.focus(); ta.select(); }
  });
  const clear = $('cuClear');
  clear.addEventListener('click', () => {
    if (clear.dataset.armed) { memLog = []; writeLog(memLog); renderResults(); return; }
    clear.dataset.armed = '1'; clear.textContent = L('Click again to clear', '再点一次以清除');
  });
}

/** For tests: the active check-up's answer (never shown in the interface). */
export const checkupDebug = () => (A ? { id: A.id, kind: A.kind, answer: A.answer, goalV: A.goalV, done: A.done } : null);
