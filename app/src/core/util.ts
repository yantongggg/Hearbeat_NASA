export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const gauss = (x: number, m: number, s: number) => Math.exp(-(((x - m) / s) ** 2));
export const dlon = (a: number, b: number) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
export const wrapLon = (l: number) => ((l + 540) % 360) - 180;
export const g2 = (lat: number, lon: number, la: number, lo: number, sl: number, so: number) =>
  Math.exp(-(((lat - la) / sl) ** 2) - ((dlon(lon, lo) / so) ** 2));
const sig = (x: number) => 1 / (1 + Math.exp(-x));
export const sbox = (lat: number, lon: number, a1: number, a2: number, o1: number, o2: number, s: number) =>
  sig((lat - a1) / s * 2) * sig((a2 - lat) / s * 2) * sig((lon - o1) / s * 2) * sig((o2 - lon) / s * 2);
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const RM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const simClock = () => performance.now() / 1000;
export const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
