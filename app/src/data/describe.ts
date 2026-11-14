/**
 * Plain-language description of one frame, for screen readers and speech: what the whole picture
 * shows, then what is around the listening point. Built only from the grid values.
 */
import { L } from '../core/i18n';
import { placeName, bearing, dirName } from '../geo/places';
import { THEMES, category, catName, type ThemeId } from '../themes';
import { extremes, neighbourhood, sample, summarize, type Encoding, type GridSpec } from './grid';

export interface FrameCtx {
  theme: ThemeId; q: Uint8Array; grid: GridSpec; enc: Encoding;
  when: string; lat: number; lon: number; globalMean?: number | null;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : L(`${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`, xs.join('、')));

export function describeFrame(c: FrameCtx): string {
  const t = THEMES[c.theme];
  const s = summarize(c.q, c.grid, c.enc);
  const here = sample(c.q, c.lat, c.lon, c.grid, c.enc);
  const hereName = placeName(c.lat, c.lon).name;
  const parts: string[] = [];
  if (c.theme === 'rain') {
    const rainy = s.cells.filter(x => x[0] >= 0.5).length / Math.max(1, s.cells.length);
    const top = extremes(s.cells, c.grid, 3, 1500).filter(x => x.v >= 1);
    parts.push(L(`${c.when}. Rain heavier than 0.5 millimetres per hour covers about ${Math.round(rainy * 100)} percent of the globe.`,
      `${c.when}。每小时超过 0.5 毫米的降雨约覆盖全球 ${Math.round(rainy * 100)}%。`));
    if (top.length) parts.push(L(`The heaviest rain is near ${list(top.map(x => `${placeName(x.lat, x.lon).name} (${t.fmt(x.v)})`))}.`,
      `最强降雨在${list(top.map(x => `${placeName(x.lat, x.lon).name}（${t.fmt(x.v)}）`))}附近。`));
  } else if (c.theme === 'air') {
    const bad = s.cells.filter(x => x[0] > 15).length / Math.max(1, s.cells.length);
    const top = extremes(s.cells, c.grid, 3, 1500);
    parts.push(L(`${c.when}. About ${Math.round(bad * 100)} percent of the globe is above the WHO guideline of 15 micrograms per cubic metre.`,
      `${c.when}。全球约 ${Math.round(bad * 100)}% 的地区超过世卫组织 15 微克每立方米的指导值。`));
    if (top.length) parts.push(L(`The dirtiest air is near ${list(top.map(x => `${placeName(x.lat, x.lon).name} (${t.fmt(x.v)})`))}.`,
      `空气最差的地方在${list(top.map(x => `${placeName(x.lat, x.lon).name}（${t.fmt(x.v)}）`))}附近。`));
  } else if (c.theme === 'lights' || c.theme === 'lightning') {
    const top = extremes(s.cells, c.grid, 3, 2500);
    const what = c.theme === 'lights' ? L('The brightest lights are', '灯光最亮的地方在') : L('The space station saw the most lightning', '空间站看到闪电最多的地方在');
    parts.push(L(`${c.when}.`, `${c.when}。`));
    if (top.length) parts.push(L(`${what} near ${list(top.map(x => `${placeName(x.lat, x.lon).name} (${t.fmt(x.v)})`))}.`,
      `${what}${list(top.map(x => `${placeName(x.lat, x.lon).name}（${t.fmt(x.v)}）`))}附近。`));
  } else {
    const g = c.globalMean;
    parts.push(g != null
      ? L(`${c.when}. The planet as a whole was ${t.fmt(g)} compared with 1951 to 1980.`, `${c.when}。全球整体比 1951–1980 年平均 ${t.fmt(g)}。`)
      : L(`${c.when}.`, `${c.when}。`));
    const warm = extremes(s.cells, c.grid, 2, 2500, true), cold = extremes(s.cells, c.grid, 1, 2500, false);
    if (warm.length) parts.push(L(`Warmest anomalies near ${list(warm.map(x => `${placeName(x.lat, x.lon).name} (${t.fmt(x.v)})`))}`,
      `最暖的地方在${list(warm.map(x => `${placeName(x.lat, x.lon).name}（${t.fmt(x.v)}）`))}附近`)
      + (cold.length ? L(`; coldest near ${placeName(cold[0].lat, cold[0].lon).name} (${t.fmt(cold[0].v)}).`, `；最冷在${placeName(cold[0].lat, cold[0].lon).name}（${t.fmt(cold[0].v)}）。`) : '.'));
    parts.push(L(`Measurements cover ${Math.round(s.validFraction * 100)} percent of the globe this year.`, `这一年观测覆盖全球 ${Math.round(s.validFraction * 100)}%。`));
  }
  parts.push(here == null
    ? L(`At ${hereName}: no data.`, `${hereName}：无数据。`)
    : L(`At ${hereName}: ${t.fmt(here)}, ${catName(category(t, here))}.`, `${hereName}：${t.fmt(here)}，${catName(category(t, here))}。`));
  if (c.theme !== 'climate') {
    const n = neighbourhood(c.q, c.lat, c.lon, c.grid, c.enc, 1500, t.presence);
    if (n.peak && n.peak.km > 150 && n.peak.v >= t.presence) {
      const dir = dirName(bearing({ lat: c.lat, lon: c.lon }, { lat: n.peak.lat, lon: n.peak.lon }));
      parts.push(L(`Within 1500 kilometres, the strongest is ${t.fmt(n.peak.v)}, about ${Math.round(n.peak.km / 50) * 50} kilometres to the ${dir}.`,
        `1500 公里内最强的是 ${t.fmt(n.peak.v)}，在${dir}方约 ${Math.round(n.peak.km / 50) * 50} 公里处。`));
    }
  }
  return parts.join(' ');
}
