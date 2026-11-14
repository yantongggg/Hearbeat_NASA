/** The Jukebox: which track and time step is playing, what the data says at the listening point, and what it sounds like. */
import { $, dlon, wrapLon } from './core/util';
import { L, getLang } from './core/i18n';
import { state, live, type LatLon } from './core/state';
import { DATA, layer, gridSync, getGrid, alignedStep, stepDate, type LayerEntry } from './data/manifest';
import { sample, neighbourhood, resolutionAt } from './data/grid';
import { describeFrame } from './data/describe';
import { THEMES, THEME_IDS, category, catName, tname, type ThemeId, type Category } from './themes';
import { AE, type Params } from './audio/engine';
import { rainParams, airParams, climateParams, lightsParams, lightningParams, hapticFor } from './audio/mapping';
import { loadFrame, frameReady, showFrames, setDataVisible, setEvenLight, setNightLight, releaseFrames } from './globe/earth';
import { updateSun } from './geo/sky';
import { placeName, fmtLL } from './geo/places';
import { say, sayAsync, announce, toast } from './ui/speech';

export const themeLayerKey = (id: ThemeId) => DATA.manifest?.themes[id]?.layer;
export const themeLayer = (id: ThemeId = state.theme): LayerEntry | null => layer(themeLayerKey(id));
export const themeAvailable = (id: ThemeId) => !!themeLayer(id);

// ---------- time labels ----------
const MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] };
const WD = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] };
const p2 = (n: number) => String(n).padStart(2, '0');
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 1..12 → "November" / "11 月" (short: "Nov" / "11月") */
export const monthName = (m: number, short = false) => L(short ? MON.en[m - 1] : MONTH_LONG[m - 1], short ? MON.zh[m - 1] : `${m} 月`);
/** The step of a month layer for this moment's calendar month (UTC), or the last step. */
export function monthStep(l: LayerEntry, ms = Date.now()): number {
  const i = l.steps.findIndex(s => +s.t === new Date(ms).getUTCMonth() + 1);
  return i < 0 ? l.steps.length - 1 : i;
}
export function whenLabel(l: LayerEntry, i: number, long = false): string {
  const s = l.steps[i]; if (!s) return '—';
  if (l.time.label === 'year') return s.t;
  if (l.time.label === 'month') {
    const st = s.stats ?? {}, span = st.firstYear && st.lastYear ? `${st.firstYear}–${st.lastYear}` : '';
    return long && span ? L(`${monthName(+s.t)}, average ${span}`, `${monthName(+s.t)}，${span} 年平均`) : monthName(+s.t);
  }
  const d = stepDate(s, 'datetime'), zh = getLang() === 'zh';
  const day = zh ? `${MON.zh[d.getUTCMonth()]}${d.getUTCDate()}日` : `${d.getUTCDate()} ${MON.en[d.getUTCMonth()]}`;
  const wd = zh ? WD.zh[d.getUTCDay()] : WD.en[d.getUTCDay()];
  return long ? `${wd} ${day} ${d.getUTCFullYear()} · ${p2(d.getUTCHours())}:00 UTC` : `${day} ${p2(d.getUTCHours())}:00 UTC`;
}
export function solarTime(l: LayerEntry, i: number, lon: number) {
  if (l.time.label !== 'datetime') return '';
  const d = stepDate(l.steps[i], 'datetime');
  let h = d.getUTCHours() + lon / 15; h = ((h % 24) + 24) % 24;
  return `${p2(Math.floor(h))}:${p2(Math.floor((h % 1) * 60))}`;
}
export const spokenUnits = (s: string) => s
  .replace(/mm\/h/g, L('millimetres per hour', '毫米每小时'))
  .replace(/µg\/m³/g, L('micrograms per cubic metre', '微克每立方米'))
  .replace(/°C/g, L('degrees', '摄氏度'))
  .replace(/ \/100/g, L(' out of 100', '（满分 100）'))
  .replace(/(\d+(?:\.\d+)?) %/g, L('$1 percent', '百分之$1'))
  .replace(/−/g, L('minus ', '负')).replace(/^\+|(\s)\+/g, `$1${L('plus ', '正')}`);

// ---------- values at the listening point ----------
export function valueAt(id: ThemeId, step: number, lat: number, lon: number): number | null {
  const key = themeLayerKey(id), l = layer(key); if (!key || !l) return null;
  const q = gridSync(key, step); if (!q) return null;
  return sample(q, lat, lon, l.grid, l.encoding);
}
export function globalMeanAt(l: LayerEntry, step: number): number | null {
  const s = l.series?.global?.find(x => x.t === l.steps[step]?.t);
  return s?.v ?? null;
}
/** Typical error for the readout: accuracy report MAE if measured, else the storage resolution. */
export function errorNote(id: ThemeId, v: number | null): string {
  const key = themeLayerKey(id), l = layer(key); if (!l || v == null) return '';
  if (l.source.values?.from === 'nasa-model-output') {
    return L(`Value from NASA ${l.source.product ?? ''} model output for the same hour · picture: NASA EIC frame`,
      `数值直接来自 NASA ${l.source.product ?? ''} 模式输出（同一小时）· 画面：NASA EIC 原始帧`);
  }
  if (l.picture?.mode === 'lightning') {
    return L('Read from the NASA picture · share of the area with lightning marks, a relative measure', '由 NASA 画面读出 · 有闪电标记的面积占比，是相对量');
  }
  if (l.source.kind === 'eic-svs-movie') {
    return L('Read from the NASA picture · a relative index (the picture has no colour scale)', '由 NASA 画面读出 · 相对指数（画面没有色标）');
  }
  const acc = key ? DATA.accuracy?.layers?.[key] : undefined;
  if (acc && typeof acc.mae === 'number') {
    return L(`Recovered from the NASA picture · typical error ±${acc.mae.toPrecision(2)} ${l.unit} vs NASA raw model data`,
      `由 NASA 图像反算 · 与 NASA 原始模式数据相比典型误差 ±${acc.mae.toPrecision(2)} ${l.unit}`);
  }
  const res = resolutionAt(Math.max(Math.abs(v), l.encoding.min > 0 ? l.encoding.min : 0.01), l.encoding);
  return l.source.kind === 'gistemp-netcdf'
    ? L(`NASA GISTEMP v4 annual mean · stored to ±${(res / 2).toFixed(2)} ${l.unit}`, `NASA GISTEMP v4 年平均 · 存储精度 ±${(res / 2).toFixed(2)} ${l.unit}`)
    : L(`Recovered from the NASA picture · accuracy test not run yet`, `由 NASA 图像反算 · 尚未运行准确度测试`);
}

let lastCat: Category | null = null, lastCatKey = '';
let nearKey = '';
export function refreshLive() {
  const l = themeLayer(); const key = themeLayerKey(state.theme);
  if (!l || !key) { live.v = null; return; }
  const t = THEMES[state.theme];
  const q = gridSync(key, state.step);
  let v = q ? sample(q, state.listen.lat, state.listen.lon, l.grid, l.encoding) : null;
  // between datetime steps, glide the value toward the next one so the sound moves smoothly
  if (state.playing && l.time.label === 'datetime' && state.frac > 0 && v != null) {
    const qn = gridSync(key, Math.min(l.steps.length - 1, state.step + 1));
    const vn = qn ? sample(qn, state.listen.lat, state.listen.lon, l.grid, l.encoding) : null;
    if (vn != null) v = v + (vn - v) * state.frac;
  }
  live.v = v;
  const nk = `${key}:${state.step}:${state.listen.lat.toFixed(2)}:${state.listen.lon.toFixed(2)}`;
  if (q && nk !== nearKey && state.theme !== 'climate') {
    nearKey = nk;
    const n = neighbourhood(q, state.listen.lat, state.listen.lon, l.grid, l.encoding, 1000, t.presence);
    live.nearby = { coverage: n.coverage, pan: n.pan };
  }
  live.globalMean = globalMeanAt(l, state.step);
  live.context = {};
  for (const ck of DATA.manifest?.themes[state.theme]?.context ?? []) {
    const cl = layer(ck), si = alignedStep(key, state.step, ck);
    const cq = si == null ? null : gridSync(ck, si);
    live.context[ck] = cl && cq ? sample(cq, state.listen.lat, state.listen.lon, cl.grid, cl.encoding) : null;
  }
  AE.set(paramsFor(state.theme, v));
  // haptics + eyes-closed cue when the class under the listening point changes
  const c = category(t, v), ck2 = `${state.theme}`;
  if (c && (lastCatKey !== ck2 || c !== lastCat)) {
    if (lastCatKey === ck2 && lastCat) {
      try { navigator.vibrate?.(hapticFor(c.level)); } catch { /* unsupported */ }
    }
    lastCat = c; lastCatKey = ck2;
  }
}

export function paramsFor(id: ThemeId, v: number | null): Params {
  if (id === 'rain') return { theme: 'rain', p: rainParams(v, live.nearby) };
  if (id === 'air') return { theme: 'air', p: airParams(v, live.nearby) };
  if (id === 'lights') return { theme: 'lights', p: lightsParams(v) };
  if (id === 'lightning') return { theme: 'lightning', p: lightningParams(v) };
  return { theme: 'climate', p: climateParams(v, live.globalMean) };
}

// ---------- readout ----------
export function renderReadout() {
  const l = themeLayer(), t = THEMES[state.theme];
  const pn = placeName(state.listen.lat, state.listen.lon);
  $('placeName').textContent = pn.name;
  const st = l ? solarTime(l, state.step, state.listen.lon) : '';
  $('placeMeta').textContent = `${fmtLL(state.listen.lat, state.listen.lon)}${pn.sub ? ' · ' + pn.sub : ''}${st ? ' · ' + L(`solar time ${st}`, `当地太阳时 ${st}`) : ''}`;
  $('quantity').textContent = L(t.quantity[0], t.quantity[1]);
  const v = live.v, c = category(t, v);
  const [num, unit] = v == null ? ['—', ''] : (() => { const s = t.fmt(v); const i = s.lastIndexOf(' '); return [s.slice(0, i), s.slice(i + 1)]; })();
  $('bigV').textContent = num; $('bigU').textContent = unit;
  const catEl = $('cat'); catEl.textContent = catName(c);
  catEl.style.setProperty('--catc', c ? `color-mix(in srgb, ${t.color} ${30 + c.level * 70}%, #ff5a4a ${c.level * 40}%)` : '#5d6977');
  $('hearing').innerHTML = hearingNow();
  $('hearing').style.setProperty('--catc', catEl.style.getPropertyValue('--catc'));
  const badge = l?.simulated ? `<span class="badge sim">SIMULATED</span>` : l?.stale ? `<span class="badge stale">${L('OLDER RUN', '旧数据')}</span>` : `<span class="badge nasa">NASA</span>`;
  $('errNote').innerHTML = `${errorNote(state.theme, v)}${l ? badge : ''}`;
  renderVitals();
  const ctx = $('ctx'); ctx.innerHTML = '';
  if (state.compareA) {
    const a = state.compareA;
    ctx.insertAdjacentHTML('beforeend', `<dt>A · ${placeName(a.lat, a.lon).name}</dt><dd class="num">${a.v == null ? '—' : t.fmt(a.v)}</dd>`);
  }
}

/** One plain sentence: what the sound is doing right now, and what that means here. */
export function hearingNow(): string {
  const v = live.v, t = THEMES[state.theme], c = category(t, v);
  if (state.sound === 'precise') {
    return L(`<b>One steady tone.</b> <span>Higher pitch = more ${t.quantity[0].toLowerCase()}.</span>`, `<b>单一音调。</b><span>音越高 = ${t.quantity[1]}越大。</span>`);
  }
  const near = live.nearby, side = near.pan < -.25 ? L('on your left (west)', '在左边（西边）') : near.pan > .25 ? L('on your right (east)', '在右边（东边）') : L('all around', '在四周');
  if (state.theme === 'rain') {
    const p = rainParams(v, near);
    if (v == null) return L('<b>Silence.</b> <span>No data here.</span>', '<b>没有声音。</b><span>这里没有数据。</span>');
    const wash = p.rush > .15 ? L(` A soft wash ${side}: rain nearby.`, ` 柔和的雨声${side}：附近在下雨。`) : '';
    if (p.dropsPerSec === 0) return L(`<b>Music only, no drops:</b> <span>dry here.${wash}</span>`, `<b>只有音乐，没有雨滴：</b><span>这里没下雨。${wash}</span>`);
    const n = Math.round(p.dropsPerSec);
    return L(`<b>${n} drop${n === 1 ? '' : 's'} a second${p.drum ? ' + a soft low note' : ''}:</b> <span>${catName(c)} here. More drops = harder rain.${wash}</span>`,
      `<b>每秒 ${n} 滴${p.drum ? '，加上一个柔和的低音' : ''}：</b><span>这里是${catName(c)}。雨滴越密，雨越大。${wash}</span>`);
  }
  if (state.theme === 'air') {
    const p = airParams(v, near);
    if (v == null) return L('<b>Silence.</b> <span>No data here.</span>', '<b>没有声音。</b><span>这里没有数据。</span>');
    if (!p.dark) return L('<b>Clear, open music:</b> <span>the air here is within the WHO guideline (15 µg/m³).</span>', '<b>清澈开阔的音乐：</b><span>这里的空气在世卫组织指导值（15 µg/m³）以内。</span>');
    const x = (v / 15).toFixed(v < 30 ? 1 : 0);
    return L(`<b>Muffled music with a soft heartbeat:</b> <span>${x}× the WHO guideline here. The dirtier the air, the duller the music and the faster the heartbeat.</span>`,
      `<b>沉闷的音乐，伴随轻柔的心跳声：</b><span>这里是世卫组织指导值的 ${x} 倍。空气越脏，音乐越闷，心跳越快。</span>`);
  }
  if (state.theme === 'lights') {
    if (v == null) return L('<b>Silence.</b> <span>No data here.</span>', '<b>没有声音。</b><span>这里没有数据。</span>');
    const lp = lightsParams(v), n = Math.round(lp.twinklesPerSec);
    return lp.twinklesPerSec === 0
      ? L('<b>Only the night chord, no twinkles:</b> <span>dark here at night.</span>', '<b>只有夜曲和弦，没有星点：</b><span>这里夜里很黑。</span>')
      : L(`<b>${n} twinkle${n === 1 ? '' : 's'} a second:</b> <span>${catName(category(THEMES.lights, v))} here at night. More twinkles = more light.</span>`,
        `<b>每秒 ${n} 个星点：</b><span>这里夜里${catName(category(THEMES.lights, v))}。星点越密，灯光越多。</span>`);
  }
  if (state.theme === 'lightning') {
    if (v == null) return L('<b>Silence.</b> <span>No data here.</span>', '<b>没有声音。</b><span>这里没有数据。</span>');
    const lp = lightningParams(v), n = Math.round(lp.tapsPerSec), cn = catName(category(THEMES.lightning, v));
    return lp.tapsPerSec === 0
      ? L('<b>Only the chord, no taps:</b> <span>the space station saw no lightning here this month.</span>', '<b>只有和弦，没有敲击：</b><span>这个月空间站在这里没看到闪电。</span>')
      : L(`<b>${n} tap${n === 1 ? '' : 's'} a second:</b> <span>${cn} here this month. More taps = more lightning.</span>`,
        `<b>每秒 ${n} 下敲击：</b><span>这个月这里${cn}。敲击越密，闪电越多。</span>`);
  }
  const p = climateParams(v, live.globalMean);
  if (!p.hasData) return L('<b>A soft tap instead of a note:</b> <span>no measurements here this year.</span>', '<b>只有轻轻一下敲击，没有音符：</b><span>这一年这里没有观测数据。</span>');
  const rel = v != null && v > .2 ? L('warmer than 1951–1980 here', '这里比 1951–1980 年更暖') : v != null && v < -.2 ? L('cooler than 1951–1980 here', '这里比 1951–1980 年更冷') : L('about the same as 1951–1980 here', '这里与 1951–1980 年差不多');
  return L(`<b>One note per year — ${p.brightness > .5 ? 'a high' : p.brightness > .3 ? 'a middle' : 'a low'} note:</b> <span>${rel}. The soft held chord is the whole planet; it rises as the Earth warms.</span>`,
    `<b>每年一个音——${p.brightness > .5 ? '高音' : p.brightness > .3 ? '中音' : '低音'}：</b><span>${rel}。柔和的持续和弦代表全球，地球变暖时它会升高。</span>`);
}

// ---------- vital signs: all three tracks at the listening point ----------
export interface Vital { id: ThemeId; step: number; v: number | null; when: string; text: string; spoken: string }
/** The step of layer `key` that matches what is on screen: the current step for the active track,
 *  the same hour for other datetime tracks, otherwise the newest step. */
function stepFor(id: ThemeId): number | null {
  const key = themeLayerKey(id), l = layer(key); if (!key || !l) return null;
  if (id === state.theme) return state.step;
  const cur = themeLayer();
  if (cur && cur.time.label === 'datetime' && l.time.label === 'datetime') return alignedStep(cur.key, state.step, key) ?? l.steps.length - 1;
  if (l.time.label === 'month') return monthStep(l);   // lightning: this calendar month
  return l.steps.length - 1;
}
export function vitals(): Vital[] {
  const out: Vital[] = [];
  for (const id of THEME_IDS) {
    const key = themeLayerKey(id), l = layer(key), step = stepFor(id);
    if (!key || !l || step == null) continue;
    const q = gridSync(key, step);
    if (!q) getGrid(key, step);
    const v = q ? sample(q, state.listen.lat, state.listen.lon, l.grid, l.encoding) : null;
    const t = THEMES[id], c = category(t, v), when = whenLabel(l, step);
    let text = '—', sp = L('no data', '无数据');
    if (v != null) {
      if (id === 'rain') { text = `${catName(c)} · ${t.fmt(v)}`; sp = `${catName(c)}, ${spokenUnits(t.fmt(v))}`; }
      else if (id === 'air') {
        const x = v / 15, xs = x < 2 ? x.toFixed(1) : x.toFixed(0);
        text = v <= 15 ? `${L('within WHO guideline', '在世卫指导值内')} · ${t.fmt(v)}` : `${L(`${xs}× WHO`, `世卫 ${xs} 倍`)} · ${t.fmt(v)}`;
        sp = v <= 15 ? `${spokenUnits(t.fmt(v))}, ${L('within the WHO guideline', '在世卫组织指导值以内')}` : `${spokenUnits(t.fmt(v))}, ${L(`${xs} times the WHO guideline`, `世卫组织指导值的 ${xs} 倍`)}`;
      } else if (id === 'lights' || id === 'lightning') {
        text = `${catName(c)} · ${t.fmt(v)}`; sp = `${catName(c)}, ${spokenUnits(t.fmt(v))}`;
      } else {
        const g = l.series?.global?.find(x => x.t === l.steps[step].t)?.v;
        text = `${t.fmt(v)}${g != null ? ` (${L('planet', '全球')} ${t.fmt(g).replace(' °C', '')})` : ''}`;
        sp = `${L(`in ${l.steps[step].t}`, `${l.steps[step].t} 年`)} ${spokenUnits(t.fmt(v))} ${L('compared with 1951 to 1980', '（与 1951 至 1980 年相比）')}${g != null ? `; ${L('the whole planet', '全球')} ${spokenUnits(t.fmt(g))}` : ''}`;
      }
    }
    out.push({ id, step, v, when, text, spoken: sp });
  }
  return out;
}
function renderVitals() {
  const ul = $('vitals'); if (!ul) return;
  const vs = vitals();
  const html = vs.map(x => {
    const t = THEMES[x.id], on = x.id === state.theme;
    return `<li><button type="button" class="vrow${on ? ' on' : ''}" data-vital="${x.id}" style="--tc:${t.color}" aria-pressed="${on}">
      <span class="vs">${L(t.sign[0], t.sign[1])}</span><span class="vv num">${x.text}</span><span class="vw num">${x.when}</span></button></li>`;
  }).join('');
  if (ul.dataset.html !== html) {
    ul.dataset.html = html; ul.innerHTML = html;
    ul.querySelectorAll<HTMLButtonElement>('[data-vital]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.vital as ThemeId)));
  }
}
export function readVitals() {
  const pn = placeName(state.listen.lat, state.listen.lon).name;
  const parts = vitals().map(x => `${L(THEMES[x.id].sign[0], THEMES[x.id].sign[1])}: ${x.spoken}`);
  say(L(`Vital signs at ${pn}. ${parts.join('. ')}.`, `${pn}的生命体征。${parts.join('。')}。`));
}

// ---------- speech actions ----------
export function valueSentence(withTime = true): string {
  const l = themeLayer(), t = THEMES[state.theme];
  if (!l) return L('This track has no data in this build.', '这首曲目本次没有数据。');
  const pn = placeName(state.listen.lat, state.listen.lon).name, v = live.v, c = category(t, v);
  const when = withTime ? `${whenLabel(l, state.step, true)}. ` : '';
  const val = v == null ? L('no data here', '这里没有数据') : `${spokenUnits(t.fmt(v))}, ${catName(c)}`;
  let extra = '';
  if (state.theme === 'climate' && live.globalMean != null) extra = L(` The whole planet: ${spokenUnits(t.fmt(live.globalMean))}.`, ` 全球：${spokenUnits(t.fmt(live.globalMean))}。`);
  return L(`${pn}. ${when}${L(t.quantity[0], t.quantity[1])}: ${val}.${extra}`, `${pn}。${when}${L(t.quantity[0], t.quantity[1])}：${val}。${extra}`);
}
export const readAloud = () => say(valueSentence(true));

export function describe(): string {
  const l = themeLayer(), key = themeLayerKey(state.theme);
  const q = key ? gridSync(key, state.step) : null;
  if (!l || !q) return L('No frame loaded.', '画面还没有载入。');
  const text = describeFrame({ theme: state.theme, q, grid: l.grid, enc: l.encoding, when: whenLabel(l, state.step, true),
    lat: state.listen.lat, lon: state.listen.lon, globalMean: live.globalMean });
  const out = $('descOut'); out.hidden = false; out.textContent = text;
  say(spokenUnits(text));
  return text;
}

let legendBusy = false;
export async function legend() {
  if (legendBusy) return; legendBusy = true;
  const t = THEMES[state.theme];
  const out = $('descOut'); out.hidden = false;
  out.innerHTML = t.hear.map(h => `• ${L(h[0], h[1])}`).join('<br>');
  try {
    await sayAsync(L(`${tname(t)}. ${t.hear[0][0]}`, `${tname(t)}。${t.hear[0][1]}`));
    for (const v of t.legend) {
      const c = category(t, v);
      await sayAsync(`${spokenUnits(t.fmt(v))}: ${catName(c)}.`);
      const saved = { ...live.nearby };
      live.nearby = { coverage: state.theme === 'climate' ? 0 : (c?.level ?? 0) * .4, pan: 0 };
      await AE.previewOnce(paramsFor(state.theme, v), 2.6);
      live.nearby = saved;
    }
    await sayAsync(L('Now you are hearing the real data again.', '现在重新播放真实数据。'));
  } finally { legendBusy = false; }
}

export function compare() {
  const t = THEMES[state.theme];
  if (!state.compareA) {
    state.compareA = { ...state.listen, v: live.v };
    $('compareBtn').setAttribute('aria-pressed', 'true');
    say(L(`A marked at ${placeName(state.listen.lat, state.listen.lon).name}: ${live.v == null ? 'no data' : spokenUnits(t.fmt(live.v))}. Move, then press C again to compare.`,
      `已在${placeName(state.listen.lat, state.listen.lon).name}标记 A：${live.v == null ? '无数据' : spokenUnits(t.fmt(live.v))}。移动到 B 后再按 C 对比。`));
    return;
  }
  const a = state.compareA, b = live.v, an = placeName(a.lat, a.lon).name, bn = placeName(state.listen.lat, state.listen.lon).name;
  if (a.v == null || b == null) { say(L('One of the two places has no data.', '其中一个地点没有数据。')); return; }
  let rel: string;
  if (state.theme === 'climate') {
    const d = b - a.v;
    rel = L(`${bn} is ${Math.abs(d).toFixed(2)} degrees ${d >= 0 ? 'warmer' : 'cooler'} in anomaly than ${an}.`, `${bn}的距平比${an}${d >= 0 ? '高' : '低'} ${Math.abs(d).toFixed(2)} 摄氏度。`);
  } else {
    const lo = Math.max(Math.min(a.v, b), state.theme === 'rain' ? 0.1 : 0.4), ratio = Math.max(a.v, b) / lo;
    const more = b >= a.v;
    rel = ratio < 1.15
      ? L(`${bn} and ${an} are about the same.`, `${bn}和${an}差不多。`)
      : L(`${bn} has ${ratio.toFixed(1)} times ${more ? 'more' : 'less'} than ${an}.`, `${bn}是${an}的${more ? '' : '几分之一，约 1/'}${ratio.toFixed(1)}${more ? ' 倍' : ''}。`);
  }
  say(L(`A, ${an}: ${spokenUnits(t.fmt(a.v))}. B, ${bn}: ${spokenUnits(t.fmt(b))}. ${rel}`, `A，${an}：${spokenUnits(t.fmt(a.v))}。B，${bn}：${spokenUnits(t.fmt(b))}。${rel}`));
}
export function clearCompare() { state.compareA = null; $('compareBtn').setAttribute('aria-pressed', 'false'); }

// ---------- moving the listening point ----------
/** `quiet`: move without announcing (the caller says what matters, e.g. the Home view). */
export function setListen(p: LatLon, how: 'pick' | 'key' | 'preset' | 'init' | 'quiet' = 'pick') {
  state.listen = { lat: Math.max(-89.5, Math.min(89.5, p.lat)), lon: wrapLon(p.lon) };
  state.lastInteract = performance.now();
  if (how !== 'pick') state.target = { ...state.listen };
  refreshLive(); renderReadout();
  if (how !== 'init' && how !== 'quiet') {
    const t = THEMES[state.theme], v = live.v;
    const msg = `${placeName(state.listen.lat, state.listen.lon).name}: ${v == null ? L('no data', '无数据') : `${spokenUnits(t.fmt(v))}, ${catName(category(t, v))}`}`;
    announce(msg);
    if (how === 'pick') { try { navigator.vibrate?.(8); } catch { /* ignore */ } }
  }
}
export function moveBy(dLat: number, dLon: number) {
  const k = Math.max(0.25, Math.cos(state.listen.lat * Math.PI / 180));
  setListen({ lat: state.listen.lat + dLat, lon: state.listen.lon + dLon / k }, 'key');
}
export function nextPreset() {
  const ps = THEMES[state.theme].presets;
  state.presetIdx = (state.presetIdx + 1) % ps.length;
  const [lat, lon] = ps[state.presetIdx];
  setListen({ lat, lon }, 'preset');
}

// ---------- time ----------
const stepListeners: Array<() => void> = [];
export const onStep = (f: () => void) => { stepListeners.push(f); };
export function setStep(i: number, user = false) {
  const l = themeLayer(); if (!l) return;
  const n = l.steps.length;
  state.step = Math.max(0, Math.min(n - 1, i)); state.frac = 0;
  ensureFrames(state.step);
  refreshLive(); renderReadout();
  stepListeners.forEach(f => f());
  if (state.theme === 'climate' && state.playing) AE.yearNote();
  if (user) announce(`${whenLabel(l, state.step, true)}. ${valueSentence(false)}`);
}

/** Load pictures around the current step first, then the rest of the track in order. */
let frameQueueTheme = '';
export function ensureFrames(center: number) {
  const l = themeLayer(); if (!l) return;
  const urls = l.steps.map(s => DATA.base + s.image);
  [center, center + 1, center - 1, center + 2].forEach(i => { if (urls[i]) loadFrame(urls[i]).catch(() => { /* reported by validation */ }); });
  if (frameQueueTheme !== state.theme) {
    frameQueueTheme = state.theme;
    releaseFrames(new Set(urls));                 // another track's pictures are let go (they reload from the browser cache)
    const order = urls.map((_, i) => i).sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
    let k = 0; const tid = state.theme;
    const pump = () => { if (state.theme !== tid) return; const i = order[k++]; if (i == null) return; loadFrame(urls[i]).catch(() => undefined).finally(pump); };
    for (let c = 0; c < 4; c++) pump();
  }
}
export function stepReady(i: number) {
  const l = themeLayer(); if (!l || !l.steps[i]) return false;
  return frameReady(DATA.base + l.steps[i].image) && !!gridSync(l.key, i);
}

/** Seconds of playback per step at 1×. */
export const secPerStep = (l: LayerEntry) => (l.time.label === 'year' && l.steps.length > 40 ? 0.28 : 1.25);   // a long record of years runs fast; a dozen years, one a second

export function advance(dt: number): boolean {
  const l = themeLayer(); if (!l || !state.playing) return false;
  const n = l.steps.length;
  if (state.step >= n - 1) { setPlaying(false); return false; }
  if (!stepReady(state.step + 1)) { ensureFrames(state.step + 1); return false; }   // wait: never play ahead of the pictures
  state.frac += dt * state.speed / secPerStep(l);
  if (state.frac >= 1) setStep(state.step + 1);
  return true;
}

export function setPlaying(on: boolean) {
  const l = themeLayer();
  if (on && l && state.step >= l.steps.length - 1) setStep(0);
  state.playing = on && !!l;
  AE.yearDriven = state.playing && state.theme === 'climate';
  document.getElementById('app')!.classList.toggle('playing', state.playing);
  const b = $('playBtn');
  b.setAttribute('aria-label', state.playing ? L('Pause', '暂停') : L('Play', '播放'));
  $('playIcon').setAttribute('d', state.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l11-6.5z');
  if (state.playing && state.theme === 'climate') AE.yearNote();
}

// ---------- tracks ----------
export async function setTheme(id: ThemeId, opts: { quiet?: boolean; keepStep?: boolean } = {}) {
  if (!themeAvailable(id)) {
    const why = DATA.manifest?.errors[themeLayerKey(id) ?? ''] ?? L('not in this data build', '本次数据构建中没有');
    toast(L(`${tname(THEMES[id])} is unavailable: ${why}`, `${tname(THEMES[id])} 暂不可用：${why}`));
    return;
  }
  const wasPlaying = state.playing; setPlaying(false);
  state.theme = id; state.presetIdx = 0; clearCompare(); nearKey = ''; lastCatKey = '';
  const app = document.getElementById('app')!; app.dataset.theme = id;
  const l = themeLayer(id)!;
  setEvenLight(l.time.label === 'year' && l.picture?.mode !== 'lights');
  // night lights, and lightning (NASA draws it on a dark Earth), are shown on a night-time Earth
  setNightLight(l.picture?.mode === 'lights' || l.picture?.mode === 'lightning');
  const start = id === 'climate' ? 0 : l.time.label === 'month' ? monthStep(l) : l.steps.length - 1;
  const key = l.key;
  await Promise.all([getGrid(key, start), ...(DATA.manifest?.themes[id]?.context ?? []).map(ck => { const si = alignedStep(key, start, ck); return si == null ? null : getGrid(ck, si); })]);
  // preload the rest of this track's grids (and context grids) in the background
  l.steps.forEach((_, i) => { getGrid(key, i); (DATA.manifest?.themes[id]?.context ?? []).forEach(ck => { const si = alignedStep(key, i, ck); if (si != null) getGrid(ck, si); }); });
  frameQueueTheme = '';
  setStep(start);
  setDataVisible(true);
  window.dispatchEvent(new CustomEvent('hb:theme'));
  if (!opts.quiet) {
    const t = THEMES[id];
    const span = `${whenLabel(l, 0)} – ${whenLabel(l, l.steps.length - 1)}`;
    announce(L(`Track ${t.no}, ${t.name[0]}. ${t.question[0]} ${l.steps.length} steps, ${span}. ${valueSentence(false)}`,
      `第 ${t.no} 首，${t.name[1]}。${t.question[1]} 共 ${l.steps.length} 步，${span}。${valueSentence(false)}`));
  }
  if (wasPlaying || id === 'climate') { /* climate is a story: start it playing from 1880 */ }
  if (id === 'climate' && state.started && !opts.quiet) setPlaying(true);
}
export function nextTheme() {
  const avail = THEME_IDS.filter(themeAvailable);
  const i = avail.indexOf(state.theme);
  return setTheme(avail[(i + 1) % avail.length]);
}

/** Globe frame for the current position (called every animation frame). */
export function updateGlobeFrames() {
  const l = themeLayer(); if (!l) return;
  const a = DATA.base + l.steps[state.step].image;
  const b = DATA.base + l.steps[Math.min(l.steps.length - 1, state.step + 1)].image;
  const frac = state.playing && l.time.label === 'datetime' ? state.frac : 0;
  showFrames(a, b, frac);
  if (l.time.label === 'datetime') {
    // the sun where it was at this step's hour, moving smoothly toward the next step while playing
    const t0 = stepDate(l.steps[state.step], 'datetime').getTime();
    const t1 = stepDate(l.steps[Math.min(l.steps.length - 1, state.step + 1)], 'datetime').getTime();
    updateSun(new Date(t0 + (t1 - t0) * frac));
  }
}

/** Keep the globe turning toward the listening point after keyboard moves. */
export function followTarget() {
  if (!state.target) return;
  const d1 = dlon(state.target.lon, state.center.lon), da = state.target.lat - state.center.lat;
  state.center = { lon: wrapLon(state.center.lon + d1 * .08), lat: state.center.lat + da * .08 };
  if (Math.abs(d1) < .05 && Math.abs(da) < .05) state.target = null;
}
