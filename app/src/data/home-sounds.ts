/**
 * Sounds of a home: public-domain recordings of a household (someone cooking; no voices) that open
 * "hear home" and stay under the data. They are NOT data and NOT the listener's own home; the data is
 * what happens next: the rain in NASA's newest data falls as drops on the window, and then dirtier air closes
 * the window (the room gets muffled and farther away) while the heartbeat speeds up.
 * Pure helpers only (no DOM, no audio), so they are unit-tested.
 */
import { clamp01 } from '../audio/mapping';

/** kinds of household sound; 'talk' and 'play' stay for a family's own recordings (with consent), none ship */
export type RoomKind = 'talk' | 'play' | 'cook' | 'dishes' | 'chop';
export const ROOM_KINDS: RoomKind[] = ['talk', 'play', 'cook', 'dishes', 'chop'];

export interface RoomClip {
  id: string; kind: RoomKind; file: string;
  /** who can be heard: must be "none" (see checkRoomManifest) */
  people: string;
  /** optional mix overrides for this clip (otherwise ROOM_MIX[kind]) */
  gain?: number; pan?: number;
  /** what you hear, in both languages */
  en: string; zh: string;
  /** the excerpt and the edits, in Chinese (optional) */
  zhExcerpt?: string; zhChanges?: string;
  title: string; author: string; license: string; licenseUrl: string; source: string;
  /** which part of the original was used, and what was changed */
  excerpt: string; changes: string;
}
export interface RoomManifest { clips: RoomClip[] }

/** Only material free of restrictions: the NASA Space Apps terms require third-party material to be
 *  "freely and publicly available without restriction" (or OSI-licensed), which CC BY and CC BY-SA are not. */
const LICENSES = ['Public domain', 'CC0'];

/** Throws a readable message if the manifest cannot be used. Every clip must say where it is from, be free of
 *  restrictions, and contain no person's voice (the terms bar recognizable voices of anyone under 18 and need
 *  the consent of any adult who is featured). */
export function checkRoomManifest(m: unknown): asserts m is RoomManifest {
  const x = m as RoomManifest;
  if (!x || !Array.isArray(x.clips)) throw new Error('home-sounds manifest has no clips');
  const ids = new Set<string>();
  for (const c of x.clips) {
    if (!c.id || ids.has(c.id)) throw new Error(`home sound without a unique id: ${c.id}`);
    ids.add(c.id);
    if (!ROOM_KINDS.includes(c.kind)) throw new Error(`home sound ${c.id}: unknown kind ${c.kind}`);
    if (!/^[\w.-]+\.(mp3|m4a|wav)$/.test(c.file)) throw new Error(`home sound ${c.id}: bad file name ${c.file}`);
    if (!LICENSES.includes(c.license)) throw new Error(`home sound ${c.id}: licence ${c.license} not allowed`);
    if (c.people !== 'none') throw new Error(`home sound ${c.id}: must contain no person's voice (people: "none")`);
    if (c.gain != null && !(c.gain > 0 && c.gain <= 1)) throw new Error(`home sound ${c.id}: gain must be between 0 and 1`);
    if (c.pan != null && !(c.pan >= -1 && c.pan <= 1)) throw new Error(`home sound ${c.id}: pan must be between -1 and 1`);
    for (const k of ['en', 'zh', 'title', 'author', 'source', 'excerpt', 'changes'] as const) if (!c[k]) throw new Error(`home sound ${c.id}: missing ${k}`);
    if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(c.source)) throw new Error(`home sound ${c.id}: source must be its Wikimedia Commons page`);
  }
}

/** Default place in the room (pan) and level of each kind of sound after RMS levelling; a clip's own
 *  `gain` / `pan` in the manifest win. Hissy sounds read louder than their RMS (measured with EBU R128),
 *  so cooking sits lower than dishes or steps. */
export const ROOM_MIX: Record<RoomKind, { gain: number; pan: number }> = {
  talk: { gain: 1, pan: -0.25 },
  play: { gain: .52, pan: .35 },
  cook: { gain: .8, pan: -.2 },
  dishes: { gain: .7, pan: .4 },
  chop: { gain: .7, pan: .1 }
};
export const clipMix = (c: RoomClip) => ({ gain: c.gain ?? ROOM_MIX[c.kind].gain, pan: c.pan ?? ROOM_MIX[c.kind].pan });
/** Each recording is brought to the same loudness first (RMS), so no clip jumps out. */
export const ROOM_TARGET_RMS = 0.05;
export const normGain = (rms: number, target = ROOM_TARGET_RMS) => (rms > 1e-5 ? Math.min(8, target / rms) : 0);

/** Share of the way from the WHO guideline (15 µg/m³) to ten times it; the heartbeat speed uses the same scale. */
const dirt = (pm: number | null) => (pm == null || pm <= 15 ? 0 : clamp01(Math.log(pm / 15) / Math.log(10)));
/** Dirtier air closes the window: the room's low-pass falls from open (12 kHz) to 7 kHz just above the guideline,
 *  down to 3 kHz at ten times it. It stops at 3 kHz because a pan's sizzle lives above that: with the earlier
 *  600 Hz floor the home all but vanished (10 dB down in Kuala Lumpur's air of 12 Nov 2026, 20 dB at ten times). */
export const roomCutoff = (pm: number | null) => (pm == null || pm <= 15 ? 12000 : 7000 * Math.pow(3000 / 7000, dirt(pm)));
/** …and the room sounds farther away: full level in clean air, three quarters at ten times the guideline. */
export const roomLevel = (pm: number | null) => 1 - .25 * dirt(pm);

/** Hear home is heard one thing at a time, so that each can be told apart: the home alone (someone cooking),
 *  then the rain on its window, then the air (a heartbeat, while the home is shut in). Seconds for each part. */
export type HomePart = 'room' | 'rain' | 'air';
export const HOME_PART_SECONDS: Record<HomePart, number> = { room: 3.5, rain: 4, air: 4.5 };
export function homeParts(withRoom: boolean) {
  let t = 0;
  const parts = ((withRoom ? ['room', 'rain', 'air'] : ['rain', 'air']) as HomePart[]).map(part => {
    const p = { part, start: t, seconds: HOME_PART_SECONDS[part] }; t += p.seconds; return p;
  });
  return { parts, total: t };
}

/** Credit line for one clip (used in About). */
export const credit = (c: RoomClip) => `“${c.title}” — ${c.author}, ${c.license} (Wikimedia Commons). ${c.excerpt}; ${c.changes}.`;
