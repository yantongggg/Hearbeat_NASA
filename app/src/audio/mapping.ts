/**
 * Data → sound parameters. Pure functions, unit-tested, so it is checkable that each data voice (drops,
 * heartbeat, year notes, the muffling) is driven by the NASA value at the listening point and nothing else.
 * The quiet musical bed (chords, plucks), the random pitch of each drop and the home recordings are not data.
 */
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const logN = (v: number, lo: number, hi: number) => clamp01(Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo));

export interface Nearby { coverage: number; pan: number }
export type Sound = 'music' | 'precise';

/** Pentatonic scale degrees used by melodic voices; keeps sonified data musical. */
export const PENTA = [0, 2, 4, 7, 9];
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** MIDI note for scale step n (0 = root) in a pentatonic scale on `root`. */
export const pentaMidi = (root: number, n: number, scale = PENTA) => root + 12 * Math.floor(n / 5) + scale[((n % 5) + 5) % 5];

export interface RainParams {
  level: number;            // 0..1, log of rain rate 0.1..20 mm/h
  dropsPerSec: number;      // raindrop events per second
  drum: boolean;            // heavy rain pulse
  rush: number;             // 0..1 loudness of nearby-rain noise
  pan: number;              // -1 west .. 1 east, where nearby rain lies
  brightness: number;       // 0..1 pad filter opening
  preciseHz: number;        // pitch in precise mode
}
export function rainParams(mm: number | null, near: Nearby): RainParams {
  const v = mm ?? 0;
  const dry = v < 0.105;   // the lowest stored code (0.1 mm/h) means dry or ≤ 0.1
  const level = dry ? 0 : logN(v, 0.1, 20);
  return {
    level,
    dropsPerSec: dry ? 0 : 1 + level * 9,          // 1 drop/s at 0.1 mm/h … 10 drops/s at 20 mm/h
    drum: v >= 7.6,
    rush: clamp01(near.coverage * 2.2),
    pan: near.pan,
    brightness: 1 - level * 0.75,
    preciseHz: 220 * Math.pow(2, level * 2)          // 220 Hz dry → 880 Hz at 20 mm/h
  };
}

export interface AirParams {
  level: number;            // 0..1, log of PM2.5 2..300 µg/m³
  cutoffHz: number;         // low-pass on the music: clean = open, dirty = muffled
  dark: boolean;            // above the WHO 24-hour guideline (15 µg/m³)
  beat: number;             // 0..1 how far above the guideline (0 at 15, 1 at 150 µg/m³, log)
  bpm: number;              // heartbeat speed: 0 (none) at or below the guideline, 60 bpm just above it … 140 bpm at 150 µg/m³
  pan: number;
  rush: number;
  preciseHz: number;
}
/** WHO 2021 24-hour guideline for PM2.5, µg/m³. */
export const WHO_PM25_24H = 15;
export function airParams(pm: number | null, near: Nearby): AirParams {
  const v = pm ?? 0;
  const level = logN(v, 2, 300);
  return {
    level,
    cutoffHz: 9000 * Math.pow(350 / 9000, level),   // 9 kHz clean → 350 Hz at 300 µg/m³
    dark: v > WHO_PM25_24H,
    beat: v <= WHO_PM25_24H ? 0 : clamp01(Math.log(v / WHO_PM25_24H) / Math.log(10)),
    bpm: v <= WHO_PM25_24H ? 0 : 60 + 80 * clamp01(Math.log(v / WHO_PM25_24H) / Math.log(10)),
    pan: near.pan,
    rush: clamp01(near.coverage * 1.6) * 0.6,
    preciseHz: 220 * Math.pow(2, level * 2)
  };
}

export interface ClimateParams {
  hasData: boolean;
  midi: number;             // melody note for this year at the listening point
  brightness: number;       // 0..1 timbre warmth
  droneMidi: number;        // global mean anomaly
  preciseHz: number;
}
/** Anomaly range mapped onto two octaves of the pentatonic scale: −2 °C → lowest, +4 °C → highest. */
export const CLIMATE_LO = -2, CLIMATE_HI = 4, CLIMATE_STEPS = 12;
export function climateParams(anom: number | null, globalAnom: number | null): ClimateParams {
  const u = anom == null ? 0.33 : clamp01((anom - CLIMATE_LO) / (CLIMATE_HI - CLIMATE_LO));
  const g = globalAnom == null ? 0 : globalAnom;
  return {
    hasData: anom != null,
    midi: pentaMidi(57, Math.round(u * CLIMATE_STEPS)),               // A major pentatonic, A3 … C#6 (played an octave up)
    brightness: u,
    droneMidi: 33 + Math.round(clamp01((g + 0.6) / 2.2) * 12),        // A1 at −0.6 °C … A2 at +1.6 °C
    preciseHz: 220 * Math.pow(2, u * 2)
  };
}

export interface LightsParams {
  level: number;            // 0..1, log of the light index 1..60
  twinklesPerSec: number;   // twinkle events per second (none in the dark)
  preciseHz: number;
}
/** Night lights: a relative index 0..100 read from NASA's picture. Dark (< 1) is silent; 1..60 → 1..8 twinkles a second. */
export function lightsParams(v: number | null): LightsParams {
  const x = v ?? 0, dark = x < 1, level = dark ? 0 : logN(x, 1, 60);
  return { level, twinklesPerSec: dark ? 0 : 1 + level * 7, preciseHz: 220 * Math.pow(2, level * 2) };
}

export interface LightningParams {
  level: number;            // 0..1, log of the share 0.05..50 %
  tapsPerSec: number;       // marimba taps per second (none where no lightning was seen)
  preciseHz: number;
}
/** Lightning: share (%) of the area covered with NASA's marks. None seen (≤ 0.0105) is silent; 0.05..50 % → 1..6 taps a second. */
export function lightningParams(v: number | null): LightningParams {
  const x = v ?? 0, none = x <= 0.0105, level = none ? 0 : logN(x, 0.05, 50);
  return { level, tapsPerSec: none ? 0 : 1 + level * 5, preciseHz: 220 * Math.pow(2, level * 2) };
}

/** Haptic pattern for entering a category: longer buzz for a worse/heavier class. */
export const hapticFor = (level: number) => (level <= 0 ? [12] : [18 + Math.round(level * 50), 40, 18 + Math.round(level * 50)]);
