/** Loads the pipeline's data (docs/DATA.md v2): manifest, accuracy report, validation report and grids. */
import type { Encoding, GridSpec } from './grid';

export interface Step { t: string; grid: string; image?: string; frame?: string; stats?: Record<string, number> }
export interface LayerEntry {
  key: string; title: string; unit: string; simulated: boolean; stale?: boolean;
  encoding: Encoding; grid: GridSpec;
  source: { kind: string; agency?: string; product?: string; page?: string; svs?: number; url?: string; citation?: string;
    values?: { from: 'picture-colorbar' | 'nasa-model-output'; variable?: string; datasets?: string[]; label?: string } };
  time: { cadence: string; label: 'datetime' | 'year' | 'month'; timing?: string };
  steps: Step[];
  colorbar: { image: string; scale: string; min: number; max: number; source?: string };
  picture?: { mode: 'rain-clouds' | 'field' | 'none' | 'lights' | 'lightning'; from?: string | null };
  overlays?: number[][];
  pack?: string;
  series?: { global?: Array<{ t: string; v: number | null }> };
  notes: string;
}
export interface Manifest {
  version: number; generated: string;
  themes: Record<string, { layer: string; context?: string[] }>;
  layers: Record<string, LayerEntry>;
  errors: Record<string, string>;
  /** where the space station is (Together): NASA's predicted trajectory, written to station.json */
  station?: { file?: string; start?: string; stop?: string; created?: string; source?: string; error?: string };
}
export interface AccuracyLayer {
  unit?: string; n?: number; bias?: number; mae?: number; rmse?: number; r?: number;
  medianAbsErr?: number; p90AbsErr?: number; clipped?: number; bestOffsetHours?: number;
  frameTime?: string; raw?: { dataset?: string; variable?: string; url?: string; time?: string };
  extra?: Record<string, unknown>; notes?: string;
}
export interface Accuracy { generated: string; method?: string; layers: Record<string, AccuracyLayer>; errors?: Record<string, string> }
export interface Validation { ok: boolean; checked?: string; errors: string[]; warnings: string[] }

export const DATA = {
  base: 'data/',
  manifest: null as Manifest | null,
  accuracy: null as Accuracy | null,
  validation: null as Validation | null,
  error: '' as string,
  grids: new Map<string, Uint8Array>()
};

async function json<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? (await r.json()) as T : null; } catch { return null; }
}

/** Throws a readable message if the manifest is unusable, so the app can say so instead of inventing data. */
export function checkManifest(m: unknown): asserts m is Manifest {
  const x = m as Manifest;
  if (!x || typeof x !== 'object') throw new Error('manifest.json is missing or not JSON');
  if (x.version !== 2) throw new Error(`manifest version ${x.version}, expected 2`);
  if (!x.layers || typeof x.layers !== 'object') throw new Error('manifest has no layers');
  for (const [k, l] of Object.entries(x.layers)) {
    if (!l.steps?.length) throw new Error(`layer ${k} has no steps`);
    if (!l.grid || l.grid.w * l.grid.h <= 0) throw new Error(`layer ${k} has a bad grid`);
    if (!l.encoding || !(l.encoding.max > l.encoding.min)) throw new Error(`layer ${k} has a bad encoding`);
  }
}

export async function loadData(base = 'data/'): Promise<boolean> {
  DATA.base = base;
  const m = await json<Manifest>(base + 'manifest.json');
  try { checkManifest(m); } catch (e) { DATA.error = (e as Error).message; return false; }
  DATA.manifest = m;
  [DATA.accuracy, DATA.validation] = await Promise.all([json<Accuracy>(base + 'accuracy.json'), json<Validation>(base + 'validation.json')]);
  return true;
}

export const layer = (key: string | undefined) => (key && DATA.manifest?.layers[key]) || null;

const packs = new Map<string, Promise<boolean>>();
/** Load every step grid of a layer from its pack (one request). Resolves false if the layer has no usable pack. */
function loadPack(key: string): Promise<boolean> {
  const l = layer(key);
  if (!l?.pack) return Promise.resolve(false);
  let p = packs.get(key);
  if (!p) {
    p = json<{ w: number; h: number; steps: string[] }>(DATA.base + l.pack).then(pk => {
      if (!pk || pk.steps?.length !== l.steps.length) return false;
      pk.steps.forEach((b64, i) => {
        const bin = atob(b64), q = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) q[j] = bin.charCodeAt(j);
        if (q.length === l.grid.w * l.grid.h) DATA.grids.set(`${key}:${i}`, q);
      });
      return true;
    });
    packs.set(key, p);
  }
  return p;
}

export async function getGrid(key: string, step: number): Promise<Uint8Array | null> {
  const id = `${key}:${step}`, hit = DATA.grids.get(id);
  if (hit) return hit;
  const l = layer(key), s = l?.steps[step];
  if (!l || !s) return null;
  if (await loadPack(key)) { const q = DATA.grids.get(id); if (q) return q; }
  try {
    const r = await fetch(DATA.base + s.grid);
    if (!r.ok) return null;
    const q = new Uint8Array(await r.arrayBuffer());
    if (q.length !== l.grid.w * l.grid.h) return null;
    DATA.grids.set(id, q);
    return q;
  } catch { return null; }
}
export const gridSync = (key: string, step: number) => DATA.grids.get(`${key}:${step}`) || null;

export async function preloadLayer(key: string) {
  const l = layer(key); if (!l) return;
  await Promise.all(l.steps.map((_, i) => getGrid(key, i)));
}

/** Step of `other` closest in time to step `i` of `key` (EIC layers share step times; this guards against drift). */
export function alignedStep(key: string, i: number, other: string): number | null {
  const a = layer(key), b = layer(other);
  if (!a || !b || a.time.label !== b.time.label) return null;
  const t = Date.parse(a.steps[i]?.t.replace('Z', ':00Z') ?? '');
  let best = -1, bd = Infinity;
  b.steps.forEach((s, j) => { const d = Math.abs(Date.parse(s.t.replace('Z', ':00Z')) - t); if (d < bd) { bd = d; best = j; } });
  return best >= 0 && bd <= 3 * 3600e3 ? best : null;
}

export const stepDate = (s: Step, label: 'datetime' | 'year' | 'month') =>
  label === 'year' ? new Date(Date.UTC(+s.t, 6, 1)) : label === 'month' ? new Date(Date.UTC(2000, +s.t - 1, 15)) : new Date(s.t.replace('Z', ':00Z'));
