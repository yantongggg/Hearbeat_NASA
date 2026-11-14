/**
 * Home: the places a listener can call home, and the pure helpers behind the three questions
 * (no DOM, no state), so they are unit-tested.
 */
import type { City } from './checkup-logic';

export interface HomeGroup { en: string; zh: string; cities: City[] }
/** Malaysia first (the app was made in Kuala Lumpur), then the region, then the world. */
export const HOME_GROUPS: HomeGroup[] = [
  { en: 'Malaysia', zh: '马来西亚', cities: [
    { id: 'kl', en: 'Kuala Lumpur', zh: '吉隆坡', lat: 3.14, lon: 101.69 },
    { id: 'penang', en: 'George Town, Penang', zh: '槟城乔治市', lat: 5.41, lon: 100.33 },
    { id: 'ipoh', en: 'Ipoh', zh: '怡保', lat: 4.6, lon: 101.08 },
    { id: 'melaka', en: 'Melaka', zh: '马六甲', lat: 2.19, lon: 102.25 },
    { id: 'jb', en: 'Johor Bahru', zh: '新山', lat: 1.49, lon: 103.74 },
    { id: 'kuching', en: 'Kuching', zh: '古晋', lat: 1.55, lon: 110.34 },
    { id: 'kk', en: 'Kota Kinabalu', zh: '亚庇', lat: 5.98, lon: 116.07 }
  ] },
  { en: 'Asia', zh: '亚洲', cities: [
    { id: 'singapore', en: 'Singapore', zh: '新加坡', lat: 1.35, lon: 103.82 },
    { id: 'jakarta', en: 'Jakarta', zh: '雅加达', lat: -6.2, lon: 106.85 },
    { id: 'bangkok', en: 'Bangkok', zh: '曼谷', lat: 13.75, lon: 100.5 },
    { id: 'manila', en: 'Manila', zh: '马尼拉', lat: 14.6, lon: 120.98 },
    { id: 'hcmc', en: 'Ho Chi Minh City', zh: '胡志明市', lat: 10.82, lon: 106.63 },
    { id: 'hanoi', en: 'Hanoi', zh: '河内', lat: 21.03, lon: 105.85 },
    { id: 'hongkong', en: 'Hong Kong', zh: '香港', lat: 22.3, lon: 114.17 },
    { id: 'taipei', en: 'Taipei', zh: '台北', lat: 25.03, lon: 121.56 },
    { id: 'shanghai', en: 'Shanghai', zh: '上海', lat: 31.23, lon: 121.47 },
    { id: 'beijing', en: 'Beijing', zh: '北京', lat: 39.9, lon: 116.4 },
    { id: 'seoul', en: 'Seoul', zh: '首尔', lat: 37.57, lon: 126.98 },
    { id: 'tokyo', en: 'Tokyo', zh: '东京', lat: 35.68, lon: 139.69 },
    { id: 'dhaka', en: 'Dhaka', zh: '达卡', lat: 23.81, lon: 90.41 },
    { id: 'delhi', en: 'New Delhi', zh: '新德里', lat: 28.61, lon: 77.21 },
    { id: 'mumbai', en: 'Mumbai', zh: '孟买', lat: 19.08, lon: 72.88 },
    { id: 'dubai', en: 'Dubai', zh: '迪拜', lat: 25.2, lon: 55.27 }
  ] },
  { en: 'World', zh: '世界', cities: [
    { id: 'sydney', en: 'Sydney', zh: '悉尼', lat: -33.87, lon: 151.21 },
    { id: 'cairo', en: 'Cairo', zh: '开罗', lat: 30.04, lon: 31.24 },
    { id: 'lagos', en: 'Lagos', zh: '拉各斯', lat: 6.52, lon: 3.38 },
    { id: 'nairobi', en: 'Nairobi', zh: '内罗毕', lat: -1.29, lon: 36.82 },
    { id: 'london', en: 'London', zh: '伦敦', lat: 51.5, lon: -0.13 },
    { id: 'paris', en: 'Paris', zh: '巴黎', lat: 48.86, lon: 2.35 },
    { id: 'moscow', en: 'Moscow', zh: '莫斯科', lat: 55.75, lon: 37.62 },
    { id: 'newyork', en: 'New York', zh: '纽约', lat: 40.71, lon: -74.0 },
    { id: 'houston', en: 'Houston', zh: '休斯敦', lat: 29.76, lon: -95.37 },
    { id: 'losangeles', en: 'Los Angeles', zh: '洛杉矶', lat: 34.05, lon: -118.24 },
    { id: 'mexicocity', en: 'Mexico City', zh: '墨西哥城', lat: 19.43, lon: -99.13 },
    { id: 'saopaulo', en: 'São Paulo', zh: '圣保罗', lat: -23.55, lon: -46.63 }
  ] }
];
export const HOMES: City[] = HOME_GROUPS.flatMap(g => g.cities);
export const homeById = (id: string): City | undefined => HOMES.find(c => c.id === id);

export interface Decade { decade: number; v: number | null; years: number; lastIndex: number }
/**
 * Decade means of a yearly series (steps "1880" … "2025"): one note per decade for the warming question.
 * `v` is null when no year in the decade has data; `lastIndex` is the series index of the decade's last year.
 */
export function decadeMeans(series: Array<{ t: string; v: number | null }>): Decade[] {
  const out: Array<Decade & { sum: number }> = [];
  series.forEach((s, i) => {
    const y = parseInt(s.t, 10); if (!Number.isFinite(y)) return;
    const d = Math.floor(y / 10) * 10;
    let cur = out[out.length - 1];
    if (!cur || cur.decade !== d) { cur = { decade: d, v: null, years: 0, lastIndex: i, sum: 0 }; out.push(cur); }
    cur.lastIndex = i;
    if (s.v != null) { cur.sum += s.v; cur.years++; cur.v = cur.sum / cur.years; }
  });
  return out.map(({ decade, v, years, lastIndex }) => ({ decade, v, years, lastIndex }));
}

/** Hours between a data step ("2026-11-04T18:00Z") and now; null if the step is not a date. */
export function ageHours(stepIso: string, now = Date.now()): number | null {
  const t = Date.parse(stepIso);
  return Number.isFinite(t) ? (now - t) / 3600e3 : null;
}
/** Data may be called "today" only when its newest step is within 36 hours of now (either side: the newest NASA step can be a short forecast). */
export const isToday = (stepIso: string, now = Date.now()) => { const h = ageHours(stepIso, now); return h != null && Math.abs(h) <= 36; };

/** How the air compares with the WHO 24-hour guideline, as a multiple (1 decimal under 2×, else whole). */
export const whoMultiple = (v: number, who = 15) => { const x = v / who; return x < 2 ? x.toFixed(1) : x.toFixed(0); };
