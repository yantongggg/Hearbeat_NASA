/** Wiring between the page and the player: tracks, transport, readout buttons, keyboard, pointer and eyes-closed mode. */
import { $, wrapLon } from '../core/util';
import { L, setLang, onLangChange, type Lang } from '../core/i18n';
import { state } from '../core/state';
import { DATA } from '../data/manifest';
import { THEMES, THEME_IDS, tname, type ThemeId } from '../themes';
import { AE } from '../audio/engine';
import { pick } from '../globe/earth';
import * as P from '../player';
import { say, announce, stopSpeech } from './speech';
import { applyStatic, KEYS } from './text';
import { renderAbout } from './about';
import { openResults, render as renderCheckup, closeCheckup } from './checkups';
import { homeOpen, setHomeAt, openHome, closeHome, homeIntro, render as renderHome, playSongAt, songPlaying, stopHearing } from './home';

/** Moving the stethoscope by keys or the big buttons means exploring: leave the (silent) Home view. */
/** Playing, stepping, changing track or moving means exploring: Home (silent until asked) closes first, so the live sound is heard. */
const leaveHome = () => { if (homeOpen()) closeHome(); };
const move = (dLat: number, dLon: number) => { leaveHome(); P.moveBy(dLat, dLon); };

// ---------- tracks ----------
export function renderTracks() {
  const ol = $('trackList'); ol.innerHTML = '';
  for (const id of THEME_IDS) {
    const t = THEMES[id], l = P.themeLayer(id), ok = !!l;
    const li = document.createElement('li');
    const sub = l ? `${l.source.agency ?? 'NASA'} ${l.source.product ?? ''} · ${l.steps.length} ${l.time.label === 'year' ? L('years', '年') : l.time.label === 'month' ? L('months', '个月') : L('steps', '步')} · ${P.whenLabel(l, 0)} – ${P.whenLabel(l, l.steps.length - 1)}` : '';
    const why = !ok ? (DATA.manifest?.errors[DATA.manifest?.themes[id]?.layer ?? ''] ?? L('not in this data build', '本次数据中没有')) : '';
    li.innerHTML = `<button type="button" class="track" data-theme="${id}" aria-pressed="${state.theme === id}" ${ok ? '' : 'disabled'} style="--tc:${t.color}">
      <span class="no">${t.no}</span>
      <span><span class="ttl">${tname(t)} <em class="sign">${L(t.sign[0], t.sign[1])}</em></span><span class="q">${L(t.question[0], t.question[1])}</span>${sub ? `<span class="sub">${sub}</span>` : ''}${why ? `<span class="unavail">${L('Unavailable', '不可用')}: ${why}</span>` : ''}</span>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></button>`;
    ol.appendChild(li);
  }
  ol.querySelectorAll<HTMLButtonElement>('.track').forEach(b => b.addEventListener('click', () => {
    if (songPlaying()) stopHearing();
    startAudio(); P.setTheme(b.dataset.theme as ThemeId);
  }));
  renderSongBtn();
}
/** "All five as one song" under the track list: the home song (audio/song.ts) for the listening point. */
let songText = '';
export function renderSongBtn() {
  const b = document.getElementById('songBtn'); if (!b) return;
  const on = songPlaying();
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = `<span class="st">${on ? L('■ Stop the song', '■ 停止') : L('▶ All five as one song', '▶ 五首合成一首歌')}</span>
    <span class="ss">${on && songText ? songText : L('Here, one by one, then together · 1 min', '这里的数据，一个一个加入，最后一起 · 1 分钟')}</span>`;
}
function wireSong() {
  document.getElementById('songBtn')?.addEventListener('click', () => {
    if (songPlaying()) { stopHearing(); return; }
    P.setPlaying(false); startAudio(); void playSongAt(state.listen.lat, state.listen.lon); renderSongBtn();
  });
  window.addEventListener('hb:song', e => { songText = (e as CustomEvent<string>).detail; renderSongBtn(); });
}
function syncTracks() { document.querySelectorAll<HTMLButtonElement>('.track').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === state.theme))); }

// ---------- transport ----------
export function renderTimeline() {
  const l = P.themeLayer(); const r = $<HTMLInputElement>('scrub'); const ticks = $('ticks');
  if (!l) return;
  r.max = String(l.steps.length - 1);
  ticks.innerHTML = '';
  const n = l.steps.length;
  l.steps.forEach((s, i) => {
    let lab = '';
    if (l.time.label === 'year') { if (+s.t % 20 === 0) lab = s.t; } else if (l.time.label === 'month') { if ((+s.t - 1) % 3 === 0) lab = P.monthName(+s.t, true); } else if (s.t.endsWith('T00:00Z')) lab = P.whenLabel(l, i).replace(/ 00:00 UTC$/, '');
    if (!lab) return;
    const sp = document.createElement('span'); sp.textContent = lab; sp.style.left = `${(i / (n - 1)) * 100}%`; ticks.appendChild(sp);
  });
  // "Go to…": every step of the track, grouped by day (EIC tracks) or by decade (warming, 1880-2025)
  const groups = new Map<string, string[]>();
  l.steps.forEach((s, i) => {
    const year = l.time.label === 'year', month = l.time.label === 'month';
    const span = month && s.stats?.firstYear ? `${Math.min(...l.steps.map(x => x.stats?.firstYear ?? 9999))}–${Math.max(...l.steps.map(x => x.stats?.lastYear ?? 0))}` : '';
    const g = month ? L(`Average ${span}`, `${span} 年平均`) : year ? `${Math.floor(+s.t / 10) * 10}s` : P.whenLabel(l, i).replace(/ \d\d:00 UTC$/, '');
    const lab = month ? P.monthName(+s.t) : year ? s.t : `${s.t.slice(11, 16)} UTC`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(`<option value="${i}">${lab}</option>`);
  });
  $<HTMLSelectElement>('timeSel').innerHTML = `<option value="" selected>${L('Go to…', '跳到…')}</option>` +
    [...groups].map(([g, o]) => `<optgroup label="${g}">${o.join('')}</optgroup>`).join('');
  syncTime();
}
export function syncTime() {
  const l = P.themeLayer(); if (!l) return;
  const r = $<HTMLInputElement>('scrub');
  r.value = String(state.step);
  const label = P.whenLabel(l, state.step, true);
  r.setAttribute('aria-valuetext', label);
  r.style.setProperty('--p', `${(state.step / Math.max(1, l.steps.length - 1)) * 100}%`);
  $('whenMain').textContent = l.time.label === 'year' ? l.steps[state.step].t : l.time.label === 'month' ? P.monthName(+l.steps[state.step].t) : label;
  $('whenSub').textContent = l.picture?.mode === 'lightning'
    ? L(`monthly average ${l.steps[state.step].stats?.firstYear ?? ''}–${l.steps[state.step].stats?.lastYear ?? ''} · lightning seen by LIS on the ISS · NASA SVS ${l.source.svs ?? ''}`,
      `${l.steps[state.step].stats?.firstYear ?? ''}–${l.steps[state.step].stats?.lastYear ?? ''} 年月平均 · 国际空间站 LIS 看到的闪电 · NASA SVS ${l.source.svs ?? ''}`)
    : l.picture?.mode === 'lights'
    ? L(`annual average · NASA EIC visualization SVS ${l.source.svs ?? ''}`, `年平均 · NASA EIC 可视化 SVS ${l.source.svs ?? ''}`)
    : l.time.label === 'year'
    ? L('annual mean · compared with 1951–1980', '年平均 · 与 1951–1980 年比较')
    : `${L('step', '第')} ${state.step + 1}/${l.steps.length}${L('', ' 步')} · ${L('NASA EIC frame', 'NASA EIC 原始帧')} SVS ${l.source.svs ?? ''}`;
  // colorbar + source line
  const img = $<HTMLImageElement>('cbImg');
  const src = DATA.base + l.colorbar.image; if (img.getAttribute('src') !== src) img.src = src;
  img.alt = L(`Colour legend from ${l.colorbar.min} to ${l.colorbar.max} ${l.unit}`, `色标：${l.colorbar.min} 至 ${l.colorbar.max} ${l.unit}`);
  const mid = l.colorbar.scale === 'log' ? Math.sqrt(l.colorbar.min * l.colorbar.max) : (l.colorbar.min + l.colorbar.max) / 2;
  const f = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1));
  $('cbLbl').innerHTML = `<span>${f(l.colorbar.min)}</span><span>${f(mid)}</span><span>${f(l.colorbar.max)} ${l.unit}</span>`;
  const s = l.steps[state.step];
  $('srcLine').innerHTML = `${l.source.agency ?? 'NASA'} · ${l.title}${s.frame ? ` · <a href="${s.frame}" target="_blank" rel="noopener">${L('original frame', '原始帧')}</a>` : ''} · <a href="${l.source.page}" target="_blank" rel="noopener">${l.source.svs ? 'SVS ' + l.source.svs : 'GISTEMP'}</a>`;
}

let audioStarted = false;
export async function startAudio() {
  if (audioStarted && AE.running) return;
  try { await AE.start(); audioStarted = true; } catch { /* autoplay blocked until a gesture */ }
}

function setSound(s: 'music' | 'precise') {
  state.sound = s; AE.sound = s;
  $('mMusic').setAttribute('aria-pressed', String(s === 'music')); $('mPrecise').setAttribute('aria-pressed', String(s === 'precise'));
  announce(s === 'music' ? L('Musical sound', '音乐声音') : L('Precise sound: one tone, higher means more', '精确声音：单一音调，越高表示越多'));
}

// ---------- eyes-closed ----------
export function setEyes(on: boolean) {
  state.eyes = on;
  $('eyes').hidden = !on;
  $('eyesBtn').setAttribute('aria-pressed', String(on));
  if (on) {
    startAudio();
    $('eyesKeys').innerHTML = KEYS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${L(d[0], d[1])}</span></div>`).join('');
    const l = P.themeLayer(), t = THEMES[state.theme];
    if (homeOpen()) say(`${L('Eyes-closed mode.', '闭眼模式。')} ${homeIntro()}`);
    else say(L(`Eyes-closed mode. Track: ${t.name[0]}. ${t.question[0]} ${P.valueSentence(true)} Use the arrow keys or the large buttons to move. Press H for help.`,
      `闭眼模式。曲目：${t.name[1]}。${t.question[1]} ${P.valueSentence(true)} 用方向键或大按钮移动，按 H 听帮助。`));
    if (!l) say(L('No data loaded.', '没有载入数据。'));
    window.setTimeout(() => $('eyesRead').focus(), 50);
  } else {
    stopSpeech(); announce(L('Eyes-closed mode off', '已退出闭眼模式')); $('eyesBtn').focus();
  }
}
const help = () => say(KEYS.map(([k, d]) => `${k.replace('← ↑ → ↓', L('Arrow keys', '方向键')).replace(', .', L('comma and full stop', '逗号和句号'))}: ${L(d[0], d[1])}`).join('. '));

// ---------- keyboard ----------
function onKey(e: KeyboardEvent) {
  const tgt = e.target as HTMLElement;
  if ((tgt.tagName === 'INPUT' && (tgt as HTMLInputElement).type !== 'range') || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA') return;
  if ($<HTMLDialogElement>('about').open || $<HTMLDialogElement>('results').open) return;
  if (!$('gate').hidden) return;
  const k = e.key, big = e.shiftKey ? 10 : 2;
  const onButton = tgt.tagName === 'BUTTON' || tgt.tagName === 'A';
  const onRange = tgt.tagName === 'INPUT';
  let handled = true;
  if (k === 'ArrowUp' && !onRange) move(big, 0);
  else if (k === 'ArrowDown' && !onRange) move(-big, 0);
  else if (k === 'ArrowLeft' && !onRange) move(0, -big);
  else if (k === 'ArrowRight' && !onRange) move(0, big);
  else if (k === 'Enter' && !onButton) P.readAloud();
  else if (k === ' ' && !onButton) { startAudio(); leaveHome(); P.setPlaying(!state.playing); announce(state.playing ? L('Playing', '播放') : L('Paused', '暂停')); }
  else if (k === ',' || k === '[') { leaveHome(); P.setStep(state.step - 1, true); }
  else if (k === '.' || k === ']') { leaveHome(); P.setStep(state.step + 1, true); }
  else if (k >= '1' && k <= '5' && k.length === 1) { startAudio(); leaveHome(); P.setTheme(THEME_IDS[+k - 1]); }
  else if (k === 'd' || k === 'D') P.describe();
  else if (k === 'l' || k === 'L') { if (!homeOpen()) { startAudio(); P.legend(); } }   // the legend belongs to Explore; Home's cards say what each sound means
  else if (k === 'p' || k === 'P') P.nextPreset();
  else if (k === 'v' || k === 'V') P.readVitals();
  else if (k === 'k' || k === 'K') openResults();
  else if (k === 'c' || k === 'C') { if (e.shiftKey) { P.clearCompare(); announce(L('Comparison cleared', '已清除对比')); } else P.compare(); }
  else if (k === 'm' || k === 'M') setSound(state.sound === 'music' ? 'precise' : 'music');
  else if (k === 'e' || k === 'E') setEyes(!state.eyes);
  else if (k === 'h' || k === 'H' || k === '?') help();
  else if (k === 'Escape' && state.eyes) setEyes(false);
  else handled = false;
  if (handled) { e.preventDefault(); state.lastInteract = performance.now(); }
}

// ---------- pointer on the globe ----------
function wirePointer(gl: HTMLCanvasElement) {
  const pts = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; t: number } | null = null, moved = false, pinch0 = 0, dist0 = 0;
  const rel = (e: PointerEvent) => { const r = gl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  gl.addEventListener('pointerdown', e => {
    gl.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e));
    if (pts.size === 1) { down = { ...rel(e), t: performance.now() }; moved = false; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = state.dist; }
    state.lastInteract = performance.now();
  });
  gl.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId)!, p = rel(e); pts.set(e.pointerId, p);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) state.dist = Math.max(1.6, Math.min(5.2, dist0 * pinch0 / d));
      moved = true; return;
    }
    if (down && Math.hypot(p.x - down.x, p.y - down.y) > 6) moved = true;
    if (moved) {
      gl.classList.add('drag');
      const k = 0.2 * ((state.dist - 1) / 2.3);
      state.center = { lat: Math.max(-75, Math.min(75, state.center.lat + (p.y - prev.y) * k)), lon: wrapLon(state.center.lon - (p.x - prev.x) * k) };
      state.target = null; state.lastInteract = performance.now();
    }
  });
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId); gl.classList.remove('drag');
    if (pts.size === 0 && down && !moved) {
      const p = rel(e), ll = pick(p.x, p.y);
      if (ll) { startAudio(); if (homeOpen()) setHomeAt(ll.lat, ll.lon); else P.setListen(ll, 'pick'); }
    }
    if (pts.size === 0) down = null;
  };
  gl.addEventListener('pointerup', up); gl.addEventListener('pointercancel', up);
  gl.addEventListener('wheel', e => { e.preventDefault(); state.dist = Math.max(1.6, Math.min(5.2, state.dist * Math.exp(e.deltaY * 0.0012))); state.lastInteract = performance.now(); }, { passive: false });
}

// ---------- everything else ----------
export function wireControls() {
  const gl = $<HTMLCanvasElement>('gl');
  wirePointer(gl);
  wireSong();
  document.addEventListener('keydown', onKey);
  $('playBtn').addEventListener('click', () => { startAudio(); P.setPlaying(!state.playing); });
  $('prevBtn').addEventListener('click', () => P.setStep(state.step - 1, true));
  $('nextBtn').addEventListener('click', () => P.setStep(state.step + 1, true));
  $<HTMLInputElement>('scrub').addEventListener('input', e => { P.setPlaying(false); P.setStep(+(e.target as HTMLInputElement).value, true); });
  $<HTMLSelectElement>('timeSel').addEventListener('change', e => {
    const sel = e.target as HTMLSelectElement, v = sel.value; sel.value = '';
    if (v === '') return;
    P.setPlaying(false); P.setStep(+v, true);
  });
  $<HTMLSelectElement>('speedSel').addEventListener('change', e => { state.speed = +(e.target as HTMLSelectElement).value; });
  $('mMusic').addEventListener('click', () => setSound('music'));
  $('mPrecise').addEventListener('click', () => setSound('precise'));
  $('readBtn').addEventListener('click', () => { startAudio(); P.readAloud(); });
  $('reportBtn').addEventListener('click', () => { startAudio(); P.readVitals(); });
  $('checkBtn').addEventListener('click', openResults);
  $('homeBtn').addEventListener('click', () => { startAudio(); closeCheckup(); openHome(); });
  const res = $<HTMLDialogElement>('results');
  $('resultsClose').addEventListener('click', () => res.close());
  res.addEventListener('click', e => { if (e.target === res) res.close(); });
  $('describeBtn').addEventListener('click', () => P.describe());
  $('legendBtn').addEventListener('click', () => { startAudio(); P.legend(); });
  $('compareBtn').addEventListener('click', () => P.compare());
  $('nextPlaceBtn').addEventListener('click', () => { startAudio(); P.nextPreset(); });
  $('eyesBtn').addEventListener('click', () => setEyes(!state.eyes));
  const dlg = $<HTMLDialogElement>('about');
  $('aboutBtn').addEventListener('click', () => { renderAbout(); dlg.showModal(); });
  $('aboutClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.setLang as Lang)));
  onLangChange(() => { applyStatic(); renderTracks(); renderTimeline(); P.renderReadout(); if (dlg.open) renderAbout(); renderCheckup(); renderHome(); if (res.open) openResults(); });
  // eyes-closed pad
  const step = 3;
  document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset.move; move(d === 'n' ? step : d === 's' ? -step : 0, d === 'e' ? step : d === 'w' ? -step : 0);
  }));
  $('eyesRead').addEventListener('click', () => P.readAloud());
  $('eyesPlay').addEventListener('click', () => { startAudio(); leaveHome(); P.setPlaying(!state.playing); say(state.playing ? L('Playing', '播放') : L('Paused', '暂停'), true); });
  $('eyesPrev').addEventListener('click', () => { leaveHome(); P.setStep(state.step - 1, true); });
  $('eyesNext').addEventListener('click', () => { leaveHome(); P.setStep(state.step + 1, true); });
  $('eyesDescribe').addEventListener('click', () => P.describe());
  $('eyesTrack').addEventListener('click', () => { leaveHome(); P.nextTheme(); });
  // after a phone call, a locked screen or a switch of app the browser suspends audio: any touch or key wakes it again
  const wake = () => { if (state.started && !AE.running) void startAudio(); };
  document.addEventListener('pointerdown', wake, true); document.addEventListener('keydown', wake, true);
  $('eyesPlace').addEventListener('click', () => P.nextPreset());
  $('eyesHelp').addEventListener('click', help);
  $('eyesExit').addEventListener('click', () => setEyes(false));
  window.addEventListener('hb:theme', () => { syncTracks(); renderTimeline(); });
  P.onStep(syncTime);
}
