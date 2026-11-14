/**
 * "Home song": the five tracks as one piece of music for one place. Pure arrangement rules, unit-tested;
 * the engine (engine.ts, hearSong) plays them and the data decides what each voice does.
 *
 * One key (D major), one tempo (84 bpm, the tracks' tempo), one chord loop (D – Bm – G – A). 20 bars, about
 * 57 seconds: two bars of chords; then the melody (warming: one note per decade, 1880s → 2020s, higher =
 * warmer) and the other voices joining every two bars, so each can be heard on its own first; then the
 * chorus, all five together with the melody again; then two bars to end.
 * The single tracks keep their own keys and sounds; only the song moves them into D major.
 */
import { pentaMidi, clamp01 } from './mapping';

export const SONG_STEP = 60 / 84 / 4;      // a sixteenth note at 84 bpm, as in the tracks
export const SONG_BARS = 20;
export type SongVoice = 'melody' | 'air' | 'rain' | 'lightning' | 'lights';
/** the bar where each voice joins (the chorus starts at bar 10, when the last one joins) */
export const SONG_ENTER: Record<SongVoice, number> = { melody: 2, air: 4, rain: 6, lightning: 8, lights: 10 };
export const SONG_ORDER: SongVoice[] = ['melody', 'air', 'rain', 'lightning', 'lights'];
export const SONG_CHORUS = 10, SONG_OUTRO = 18;
/** D – Bm – G – A, every note above 200 Hz (no rumble on a phone or in headphones) */
export const SONG_CHORDS = [[57, 62, 66, 69], [59, 62, 66, 71], [59, 62, 67, 71], [57, 61, 64, 69]];
/** the air's bass notes (tenor register, above 190 Hz): D4, B3, G3, A3 */
export const SONG_ROOTS = [62, 59, 55, 57];

export const songSeconds = () => SONG_BARS * 16 * SONG_STEP;

/** Which voices sound in this bar. */
export function songVoices(bar: number): Record<SongVoice, boolean> {
  const on = (v: SongVoice) => bar >= SONG_ENTER[v] && bar < SONG_OUTRO;
  return { melody: on('melody'), air: on('air'), rain: on('rain'), lightning: on('lightning'), lights: on('lights') };
}

/** The decade the melody plays at this sixteenth (two decades a bar, verse and chorus each run 1880s → 2020s),
 *  or null between notes and outside the melody. */
export function melodyIndex(bar: number, st: number): number | null {
  if (bar < SONG_ENTER.melody || bar >= SONG_OUTRO || st % 8 !== 0) return null;
  return ((bar - SONG_ENTER.melody) % 8) * 2 + st / 8;
}

/** The melody note for a decade's temperature anomaly: −1 °C lowest … +2 °C highest, nine steps of D major
 *  pentatonic (D4 … A5; the music-box voice sounds an octave higher). */
export const SONG_MEL_LO = -1, SONG_MEL_HI = 2;
export const melodyMidi = (anom: number) => pentaMidi(62, Math.round(clamp01((anom - SONG_MEL_LO) / (SONG_MEL_HI - SONG_MEL_LO)) * 8));

/** A note of this bar's chord, `oct` octaves up (so drops, taps and bells always fit the harmony). */
export const chordTone = (bar: number, pick: number, oct: number) => SONG_CHORDS[bar % 4][((pick % 4) + 4) % 4] + 12 * oct;

/** What the song is doing in this bar, for the screen: the voice that joined last, or the start / chorus / end. */
export type SongPart = 'intro' | SongVoice | 'chorus' | 'outro';
export function songPart(bar: number): SongPart {
  if (bar >= SONG_OUTRO) return 'outro';
  if (bar >= SONG_CHORUS + 2) return 'chorus';
  for (let i = SONG_ORDER.length - 1; i >= 0; i--) if (bar >= SONG_ENTER[SONG_ORDER[i]]) return SONG_ORDER[i];
  return 'intro';
}
