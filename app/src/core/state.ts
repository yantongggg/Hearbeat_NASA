import type { ThemeId } from '../themes';
import type { Sound } from '../audio/mapping';

export interface LatLon { lat: number; lon: number }

/** Everything the UI, globe and audio share. One object, so modules stay decoupled. */
export const state = {
  theme: 'rain' as ThemeId,
  step: 0,
  /** fractional playback position between step and step+1 (for cross-fading pictures) */
  frac: 0,
  playing: false,
  speed: 1,
  sound: 'music' as Sound,
  listen: { lat: 3.14, lon: 101.69 } as LatLon,
  center: { lat: 8, lon: 100 } as LatLon,
  target: null as LatLon | null,
  dist: 2.95,
  started: false,
  eyes: false,
  lastInteract: 0,
  presetIdx: 0,
  compareA: null as (LatLon & { v: number | null }) | null,
  /** Together (signed in): where the space station is now and its next 95 minutes of ground track */
  station: null as { lat: number; lon: number; track: LatLon[] } | null,
  /** signed in and on the Together page: whose view it is (the astronaut's or the family's) */
  crewView: null as null | 'astronaut' | 'family',
  /** home, marked on the globe in the Together views */
  homeMark: null as LatLon | null,
  /** a sound asked for in Home is playing (the stethoscope shows where) */
  listening: false,
  /** where the globe's centre is drawn, as fractions of the stage (the astronaut's porthole); null = the middle */
  viewCenter: null as null | { x: number; y: number }
};

/** Latest values at the listening point (refreshed by main.ts). */
export const live = {
  v: null as number | null,
  context: {} as Record<string, number | null>,
  nearby: { coverage: 0, pan: 0 },
  globalMean: null as number | null,
  glow: 0
};

export const view = { W: 800, H: 600, DPR: 1 };
