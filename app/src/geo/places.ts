import { D2R, R2D } from '../core/util';
import { L } from '../core/i18n';
import { isLand } from './land';
import type { LatLon } from '../core/state';

/** [zh, lat, lon, city-light weight, en]. Weight 0 = a named region, not a city. */
export type Place = [string, number, number, number, string];
export const CITIES: Place[] = [
  ['吉隆坡', 3.14, 101.69, 1, 'Kuala Lumpur'], ['新加坡', 1.35, 103.82, 1, 'Singapore'], ['雅加达', -6.2, 106.85, 1, 'Jakarta'], ['曼谷', 13.75, 100.5, 1, 'Bangkok'],
  ['马尼拉', 14.6, 120.98, .9, 'Manila'], ['河内', 21.03, 105.85, .8, 'Hanoi'], ['香港', 22.3, 114.17, 1, 'Hong Kong'], ['台北', 25.03, 121.56, .9, 'Taipei'],
  ['上海', 31.23, 121.47, 1, 'Shanghai'], ['北京', 39.9, 116.4, 1, 'Beijing'], ['东京', 35.68, 139.69, 1, 'Tokyo'], ['首尔', 37.57, 126.98, 1, 'Seoul'],
  ['新德里', 28.61, 77.21, 1, 'New Delhi'], ['孟买', 19.08, 72.88, 1, 'Mumbai'], ['达卡', 23.81, 90.41, .9, 'Dhaka'], ['迪拜', 25.2, 55.27, .8, 'Dubai'],
  ['开罗', 30.04, 31.24, .9, 'Cairo'], ['拉各斯', 6.52, 3.38, .8, 'Lagos'], ['内罗毕', -1.29, 36.82, .6, 'Nairobi'], ['约翰内斯堡', -26.2, 28.05, .7, 'Johannesburg'],
  ['伦敦', 51.5, -0.13, 1, 'London'], ['巴黎', 48.86, 2.35, 1, 'Paris'], ['柏林', 52.52, 13.4, .8, 'Berlin'], ['莫斯科', 55.75, 37.62, .9, 'Moscow'],
  ['伊斯坦布尔', 41.01, 28.98, .9, 'Istanbul'], ['纽约', 40.71, -74.0, 1, 'New York'], ['洛杉矶', 34.05, -118.24, 1, 'Los Angeles'], ['墨西哥城', 19.43, -99.13, 1, 'Mexico City'],
  ['圣保罗', -23.55, -46.63, 1, 'São Paulo'], ['布宜诺斯艾利斯', -34.6, -58.38, .9, 'Buenos Aires'], ['利马', -12.05, -77.04, .7, 'Lima'], ['悉尼', -33.87, 151.21, .8, 'Sydney'],
  ['珀斯', -31.95, 115.86, .5, 'Perth'], ['雷克雅未克', 64.15, -21.94, .3, 'Reykjavík'], ['安克雷奇', 61.22, -149.9, .3, 'Anchorage'], ['休斯敦', 29.76, -95.37, .8, 'Houston'],
  ['多伦多', 43.65, -79.38, .8, 'Toronto'], ['古晋', 1.55, 110.34, .5, 'Kuching'], ['亚庇', 5.98, 116.07, .5, 'Kota Kinabalu'], ['槟城', 5.41, 100.33, .6, 'Penang'],
  ['撒哈拉沙漠', 23, 12, 0, 'Sahara'], ['亚马逊雨林', -3, -60, 0, 'Amazon rainforest'], ['西伯利亚', 62, 100, 0, 'Siberia'], ['青藏高原', 33, 88, 0, 'Tibetan Plateau'],
  ['澳洲内陆', -25, 133, 0, 'Australian Outback'], ['格陵兰', 72, -40, 0, 'Greenland'], ['南极洲', -80, 0, 0, 'Antarctica'], ['刚果雨林', -1, 22, 0, 'Congo rainforest'],
  ['阿拉伯沙漠', 23, 47, 0, 'Arabian Desert'], ['印度中部', 22, 79, 0, 'Central India'], ['中国中部', 31, 105, 0, 'Central China'], ['美国中部', 39, -98, 0, 'Central United States'],
  ['蒙古高原', 46, 103, 0, 'Mongolian Plateau'], ['加拿大北部', 62, -100, 0, 'Northern Canada'], ['婆罗洲', 0.5, 114, 0, 'Borneo'], ['苏门答腊', -0.5, 101.5, 0, 'Sumatra']
];

export function haversine(a1: number, o1: number, a2: number, o2: number) {
  const p1 = a1 * D2R, p2 = a2 * D2R, dp = (a2 - a1) * D2R, dl = (o2 - o1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function placeName(lat: number, lon: number): { name: string; sub: string } {
  let best: Place | null = null, bd = 1e9;
  for (const c of CITIES) { const d = haversine(lat, lon, c[1], c[2]); if (d < bd) { bd = d; best = c; } }
  if (best && bd < 700) return { name: L(best[4], best[0]), sub: bd < 40 ? '' : L(`${Math.round(bd)} km away`, `附近 ${Math.round(bd)} km`) };
  if (isLand(lat, lon)) return { name: lat < -62 ? L('Antarctica', '南极洲') : L('Open land', '无名陆地'), sub: '' };
  let o = ['Pacific Ocean', '太平洋'];
  if (lat < -50) o = ['Southern Ocean', '南大洋']; else if (lat > 66) o = ['Arctic Ocean', '北冰洋'];
  else if (lon > -80 && lon < 20) o = ['Atlantic Ocean', '大西洋']; else if (lon >= 20 && lon < 120 && lat < 25) o = ['Indian Ocean', '印度洋'];
  return { name: L(o[0], o[1]), sub: '' };
}
export const nameAt = (lat: number, lon: number) => placeName(lat, lon).name;

export const fmtLL = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}   ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;

export function bearing(a: LatLon, b: LatLon) {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D + 360) % 360;
}
const DIRS = [['north', '北'], ['north-east', '东北'], ['east', '东'], ['south-east', '东南'], ['south', '南'], ['south-west', '西南'], ['west', '西'], ['north-west', '西北']];
export const dirName = (b: number) => { const d = DIRS[Math.round((((b % 360) + 360) % 360) / 45) % 8]; return L(d[0], d[1]); };
