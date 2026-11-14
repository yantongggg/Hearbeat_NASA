import './styles.css';
import { $, RM, wrapLon, lerp } from './core/util';
import { L, onLangChange } from './core/i18n';
import { state, live, view } from './core/state';
import { initLand } from './geo/land';
import { updateSun } from './geo/sky';
import { DATA, loadData } from './data/manifest';
import { AE } from './audio/engine';
import { initEarth, resizeEarth, renderEarth, globeDebug, framesHeld } from './globe/earth';
import { initOverlay, resizeOverlay, drawOverlay, pulse } from './globe/overlay';
import { THEMES, THEME_IDS } from './themes';
import * as P from './player';
import { applyStatic } from './ui/text';
import { wireControls, renderTracks, renderTimeline, startAudio, setEyes } from './ui/controls';
import { spoken } from './ui/speech';
import { startCheckup, tickCheckup, checkupDebug, checkupLog } from './ui/checkups';
import { openHome, closeHome, homeOpen, homeDebug, hear, reading, signIn, homeOptions, cityName, stopHearing, setStationClock, type Role } from './ui/home';
import { closeCheckup } from './ui/checkups';
import { homeById } from './data/home-logic';
import { announce } from './ui/speech';
import { toast } from './ui/speech';
import { overlayDebug } from './globe/overlay';

const viz = $('viz'), gl = $<HTMLCanvasElement>('gl');
initLand();
updateSun();
let texOk = false;
initEarth(gl, 'tex/', () => { texOk = true; gateReady(); });
initOverlay($<HTMLCanvasElement>('ov'));

/**
 * Slow devices (cheap phones, software rendering): when frames keep taking longer than 50 ms, the globe is
 * drawn at a lower resolution, down to half, so sound and controls stay responsive. It never goes back up.
 */
let quality = 1, slowFrames = 0, countedFrames = 0;
const pixelRatio = () => Math.min(2, window.devicePixelRatio || 1) * quality;
function govern(ms: number) {
  if (ms > 1000) return;                       // the tab was hidden: not a slow frame
  countedFrames++; if (ms > 50) slowFrames++;
  if (countedFrames < 60) return;
  if (slowFrames > 40 && quality > .5) { quality = Math.max(.5, quality - .25); resize(); }
  slowFrames = 0; countedFrames = 0;
}
function resize() {
  view.W = viz.clientWidth || 1; view.H = viz.clientHeight || 1; view.DPR = pixelRatio();
  resizeEarth(); resizeOverlay();
}
/** Re-measure whenever the stage's real size or pixel ratio changed (a stale size stretches the globe). */
function ensureSize() {
  const dpr = pixelRatio();
  if (viz.clientWidth && viz.clientHeight && (viz.clientWidth !== view.W || viz.clientHeight !== view.H || dpr !== view.DPR)) resize();
}

/** Every sound event is drawn at the stethoscope, so a sighted viewer sees what the listener hears. */
AE.onEvent = (e, s) => {
  live.glow = Math.min(1, live.glow + (e === 'drop' ? .12 : .35));
  pulse(e, s, THEMES[state.theme].color);
};

/**
 * Logic runs on its own timer, not on animation frames, so playback and sound keep going when the tab is in the
 * background on a computer (drawing pauses there). Phones suspend a page whose screen is off; that is not covered.
 */
let lastL = performance.now(), uiT = 0;
function logic() {
  const now = performance.now(), dt = Math.min(1.2, (now - lastL) / 1000); lastL = now;
  if (state.started) P.advance(dt);
  P.refreshLive();
  if (now - uiT > 200) { uiT = now; P.renderReadout(); }
  if (state.started) tickCheckup();
}
let last = performance.now();
function frame(now: number) {
  ensureSize();
  govern(now - last);
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  P.followTarget();
  if (!state.target && !RM && state.started && !state.playing && now - state.lastInteract > 9000 && !state.eyes && !homeOpen()) {
    state.center = { lat: lerp(state.center.lat, state.listen.lat * .6, .002), lon: wrapLon(state.center.lon + dt * 1.2) };
  } else if (!state.started && !RM) state.center = { lat: state.center.lat, lon: wrapLon(state.center.lon + dt * 3) };
  live.glow *= .93;
  P.updateGlobeFrames();
  renderEarth();
  drawOverlay(THEMES[state.theme].color);
  requestAnimationFrame(frame);
}

let dataOk = false;
function gateReady() {
  const st = $('gateStatus');
  if (!dataOk) return;
  const m = DATA.manifest!;
  const n = THEME_IDS.filter(P.themeAvailable).length;
  st.textContent = texOk
    ? L(`NASA data ready · ${n} of ${THEME_IDS.length} tracks · built ${m.generated.replace('T', ' ').replace(/:\d\dZ$/, ' UTC')}`, `NASA 数据已就绪 · ${n}/${THEME_IDS.length} 首曲目 · 构建于 ${m.generated.replace('T', ' ').replace(/:\d\dZ$/, ' UTC')}`)
    : L('NASA data ready · loading Earth imagery…', 'NASA 数据已就绪 · 正在载入地球影像…');
  for (const id of GATE_BUTTONS) ($(id) as HTMLButtonElement).disabled = false;
}
const GATE_BUTTONS = ['goCrew', 'goHome', 'go', 'goEyes', 'goCheck'];

/** Nothing is spoken on a sighted start (the screen shows it; screen readers get the live region). */
async function begin(mode: 'home' | 'free' | 'eyes' | 'check', view?: 'crew' | 'mine') {
  // never wait for ever on the browser's audio (after an interruption `resume()` can stall): the gate must open
  await Promise.race([startAudio(), new Promise(r => window.setTimeout(r, 1500))]);
  state.started = true;
  $('gate').hidden = true; $('app').classList.remove('gated');
  state.lastInteract = performance.now();
  if (mode === 'home') { await openHome(view); ($('home').querySelector('[data-q]') as HTMLElement | null)?.focus({ preventScroll: true }); return; }
  if (mode === 'eyes') { openHome(); setEyes(true); }
  else $('gl').focus({ preventScroll: true });
  if (mode === 'check') startCheckup(0);
}
/** Back to the start page, to choose another part of the app. Stops every sound; a sign-in is kept. */
function showGate() {
  stopHearing(); AE.stopSolo(); P.setPlaying(false); closeCheckup(); closeHome();
  if (state.eyes) setEyes(false);
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d => d.close());
  state.started = false; state.target = null;
  $('gate').hidden = false; $('app').classList.add('gated');
  gateReady();
  $('goCrew').focus();
  announce(L('Start page. Choose what to do.', '首页。选择要做什么。'));
}
window.addEventListener('hb:explore', () => { $('gl').focus({ preventScroll: true }); toast(L('Exploring the whole globe: tap or click anywhere to listen there.', '探索整个地球：点击任何地方就能听那里。')); });
window.addEventListener('hb:checkups', () => { startCheckup(0); });

/** Sign-in: a demo. Choose astronaut or family, then one press signs in (no password; nothing is sent anywhere) and Home opens. */
function wireCrew() {
  const dlg = $<HTMLDialogElement>('crew'), sel = $<HTMLSelectElement>('crewHomeSel');
  const roles = [...dlg.querySelectorAll<HTMLButtonElement>('[data-role]')];
  let role: Role = 'astronaut';
  const pick = (r: Role, focus = false) => {
    role = r;
    for (const b of roles) { const on = b.dataset.role === r; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
  };
  roles.forEach(b => {
    b.addEventListener('click', () => pick(b.dataset.role as Role));
    b.addEventListener('keydown', e => {   // a radio group: arrow keys move between the two
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); pick(role === 'astronaut' ? 'family' : 'astronaut', true);
    });
  });
  $('goCrew').addEventListener('click', () => { sel.innerHTML = homeOptions(); pick(role); dlg.showModal(); (roles.find(b => b.dataset.role === role) ?? $('crewGo')).focus(); });
  $('crewClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  $('crewGo').addEventListener('click', async () => {
    const c = homeById(sel.value);
    dlg.close();
    signIn(role, c);
    await begin('home', 'crew');
    const here = homeDebug().home;
    announce(role === 'astronaut'
      ? L(`Signed in as astronaut, demo account. Home on Earth: ${cityName(here)}.`, `已登录：宇航员（演示账号）。地球上的家：${cityName(here)}。`)
      : L(`Signed in as family, demo account. Home: ${cityName(here)}.`, `已登录：家人（演示账号）。家：${cityName(here)}。`));
  });
}

async function boot() {
  resize(); addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(ensureSize).observe(viz);
  applyStatic();
  wireControls();
  for (const id of GATE_BUTTONS) ($(id) as HTMLButtonElement).disabled = true;
  wireCrew();
  $('goHome').addEventListener('click', () => begin('home', 'mine'));   // always "Hear my home", even when signed in
  $('startBtn').addEventListener('click', showGate);
  $('go').addEventListener('click', () => begin('free'));
  $('goEyes').addEventListener('click', () => begin('eyes'));
  $('goCheck').addEventListener('click', () => begin('check'));
  onLangChange(gateReady);
  requestAnimationFrame(frame);
  window.setInterval(logic, 50);
  dataOk = await loadData('data/');
  if (!dataOk) {
    const st = $('gateStatus'); st.classList.add('bad');
    st.textContent = L(`NASA data could not be loaded (${DATA.error}). Hearthbeat does not invent data, so there is nothing to play.`,
      `无法载入 NASA 数据（${DATA.error}）。Hearthbeat 不会编造数据，因此没有内容可播放。`);
    return;
  }
  const first = THEME_IDS.find(P.themeAvailable);
  renderTracks();
  if (first) await P.setTheme(first, { quiet: true });
  P.setListen({ lat: 3.14, lon: 101.69 }, 'init');
  state.center = { lat: 8, lon: 100 };
  renderTimeline();
  gateReady();
}
boot();

// test / debugging hook (read-only use in e2e tests)
(window as unknown as Record<string, unknown>).__hb = { quality: () => quality, framesHeld, state, live, AE, DATA, spoken, P, globeDebug, checkupDebug, checkupLog, startCheckup, overlayDebug, homeDebug, hear, reading, openHome, setStationClock };
