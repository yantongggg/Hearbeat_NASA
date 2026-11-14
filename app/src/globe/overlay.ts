/**
 * 2D layer over the globe: the stethoscope (listening point), the A/B compare mark, and every sound
 * event drawn where it is heard, so a sighted viewer sees what the listener hears:
 * - drop: a small splash near the stethoscope (the more rain, the more splashes)
 * - drum: a wide ring (heavy rain)
 * - beat: a red double ring, lub-dub (air above the WHO guideline)
 * - pulse: a soft ring once a bar (air quality)
 * - note: a ring whose size follows the note's height (climate, one per year)
 * - whisper: a faint grey ring (no data that year)
 * - twinkle: a small four-pointed star near the stethoscope (night lights)
 * - spark: a small zigzag flash near the stethoscope (lightning)
 * Signed in (Together): the space station where NASA's trajectory puts it now, and its next 95 minutes of ground track.
 */
import { state, view, live } from '../core/state';
import { RM } from '../core/util';
import type { SoundEvent } from '../audio/engine';
import { toScreen } from './earth';

let ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement;
interface Mark { t0: number; kind: SoundEvent; s: number; color: string; dx: number; dy: number; delay: number }
const marks: Mark[] = [];
const counts: Record<string, number> = {};

export function initOverlay(c: HTMLCanvasElement) { cv = c; ctx = c.getContext('2d')!; }
export function resizeOverlay() { cv.width = view.W * view.DPR; cv.height = view.H * view.DPR; }

export function pulse(kind: SoundEvent, strength: number, color: string) {
  counts[kind] = (counts[kind] ?? 0) + 1;
  if (RM) return;
  if (marks.length > 60) marks.shift();
  const now = performance.now();
  if (kind === 'drop' || kind === 'twinkle' || kind === 'spark') {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 34;
    marks.push({ t0: now, kind, s: strength, color, dx: Math.cos(a) * r, dy: Math.sin(a) * r * .8, delay: 0 });
  } else if (kind === 'beat') {
    marks.push({ t0: now, kind, s: strength, color: '#ff6b5e', dx: 0, dy: 0, delay: 0 });
    marks.push({ t0: now, kind, s: strength * .7, color: '#ff6b5e', dx: 0, dy: 0, delay: 170 });
  } else marks.push({ t0: now, kind, s: strength, color: kind === 'whisper' ? 'rgba(200,208,216,.7)' : color, dx: 0, dy: 0, delay: 0 });
}
/** For tests: how many sound events were drawn, by kind. */
export const overlayDebug = () => ({ ...counts });

const LIFE: Record<SoundEvent, number> = { drop: 650, drum: 1300, beat: 900, pulse: 1600, note: 1500, whisper: 900, twinkle: 700, spark: 600 };

function drawMarks(x: number, y: number, now: number) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i], age = (now - m.t0 - m.delay) / LIFE[m.kind];
    if (age > 1) { marks.splice(i, 1); continue; }
    if (age < 0) continue;
    const fade = 1 - age;
    ctx.strokeStyle = m.color; ctx.fillStyle = m.color;
    switch (m.kind) {
      case 'drop': {
        ctx.globalAlpha = fade * (.55 + .4 * m.s); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x + m.dx, y + m.dy, 2 + age * 9, (2 + age * 9) * .55, 0, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'twinkle': {
        const s = (3 + 4 * m.s) * (1 - Math.abs(age - .35) * 1.2), x0 = x + m.dx, y0 = y + m.dy;
        ctx.globalAlpha = fade * (.6 + .4 * m.s); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x0 - s, y0); ctx.lineTo(x0 + s, y0); ctx.moveTo(x0, y0 - s); ctx.lineTo(x0, y0 + s); ctx.stroke();
        break;
      }
      case 'spark': {
        // a short zigzag, brightest at once and fading
        const s = 4 + 4 * m.s, x0 = x + m.dx, y0 = y + m.dy;
        ctx.globalAlpha = fade * (.65 + .35 * m.s); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x0 + s * .3, y0 - s); ctx.lineTo(x0 - s * .3, y0); ctx.lineTo(x0 + s * .3, y0); ctx.lineTo(x0 - s * .3, y0 + s); ctx.stroke();
        break;
      }
      case 'drum': ctx.globalAlpha = fade * .8; ctx.lineWidth = 2.2; ring(x, y, 14 + age * 70); break;
      case 'beat': ctx.globalAlpha = fade * (.55 + .45 * m.s); ctx.lineWidth = 2 + m.s * 1.5; ring(x, y, 12 + age * (28 + 30 * m.s)); break;
      case 'pulse': ctx.globalAlpha = fade * .45; ctx.lineWidth = 1.2; ring(x, y, 12 + age * 46); break;
      case 'note': ctx.globalAlpha = fade * .85; ctx.lineWidth = 1.5; ring(x, y, 10 + age * (14 + 60 * m.s)); break;
      case 'whisper': ctx.globalAlpha = fade * .5; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ring(x, y, 12 + age * 24); ctx.setLineDash([]); break;
    }
  }
  ctx.globalAlpha = 1;
}
const ring = (x: number, y: number, r: number) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); };

/** The stethoscope's chest piece, with its tube trailing up and to the left. */
function stethoscope(x: number, y: number, color: string) {
  const g = 1 + live.glow * .35;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x - 8, y - 8); ctx.bezierCurveTo(x - 20, y - 22, x - 34, y - 18, x - 40, y - 34); ctx.stroke();
  ctx.strokeStyle = 'rgba(233,238,243,.75)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(x - 8, y - 8); ctx.bezierCurveTo(x - 20, y - 22, x - 34, y - 18, x - 40, y - 34); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 4;
  ring(x, y, 10 * g);
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ring(x, y, 10 * g);
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
  ring(x, y, 5.5);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
}

/** Home, on the Together pages: a small house and its name. */
function drawHome() {
  const h = state.homeMark; if (!h) return;
  const [x, y, v] = toScreen(h.lat, h.lon); if (!v) return;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f2d7a6'; ctx.fillStyle = '#f2d7a6'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(0, -7); ctx.lineTo(6, -1); ctx.stroke();
  ctx.strokeRect(-4.5, -1, 9, 7); ctx.fillRect(-1.2, 2, 2.4, 4);
  ctx.font = '500 11px Archivo, sans-serif'; ctx.fillText(document.documentElement.lang === 'zh' ? '家' : 'Home', 14, 4);
  ctx.restore();
}

/** The station (a body and two solar wings) and its ground track ahead, dashed and fading. */
function drawStation() {
  const s = state.station; if (!s) return;
  ctx.save(); ctx.setLineDash([3, 5]); ctx.lineWidth = 1.2; ctx.strokeStyle = '#b9cdfa';
  let prev: [number, number, boolean] | null = null;
  s.track.forEach((p, i) => {
    const q = toScreen(p.lat, p.lon) as [number, number, boolean];
    if (prev && prev[2] && q[2] && Math.hypot(q[0] - prev[0], q[1] - prev[1]) < 120) {
      ctx.globalAlpha = .1 + .55 * (1 - i / s.track.length);
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
    prev = q;
  });
  ctx.restore();
  const [x, y, v] = toScreen(s.lat, s.lon); if (!v) return;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-14, -5, 28, 10);
  ctx.fillStyle = '#b9cdfa'; ctx.fillRect(-13, -3.5, 8, 7); ctx.fillRect(5, -3.5, 8, 7);
  ctx.fillStyle = '#eef2f6'; ctx.fillRect(-5, -1.5, 10, 3);
  ctx.font = '500 10px Archivo, sans-serif'; ctx.fillStyle = 'rgba(233,238,243,.9)'; ctx.fillText('ISS', 10, -9);
  ctx.restore();
}

export function drawOverlay(color: string) {
  const d = view.DPR;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, view.W, view.H);
  const [x, y, vis] = toScreen(state.listen.lat, state.listen.lon);
  const now = performance.now();
  if (state.compareA) {
    const [ax, ay, av] = toScreen(state.compareA.lat, state.compareA.lon);
    if (av) {
      ctx.strokeStyle = 'rgba(233,238,243,.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax - 6, ay - 6); ctx.lineTo(ax + 6, ay + 6); ctx.moveTo(ax + 6, ay - 6); ctx.lineTo(ax - 6, ay + 6); ctx.stroke();
      ctx.font = '500 10px Archivo, sans-serif'; ctx.fillStyle = 'rgba(233,238,243,.8)'; ctx.fillText('A', ax + 9, ay - 8);
    }
  }
  drawStation();
  drawHome();
  // on the Together pages the stethoscope appears only while a sound plays (it shows where the sound is)
  if (state.crewView && !state.listening) { marks.length = 0; return; }
  if (!vis) { marks.length = 0; return; }
  drawMarks(x, y, now);
  stethoscope(x, y, color);
}
