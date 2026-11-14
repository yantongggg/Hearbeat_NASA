import { describe, it, expect } from 'vitest';
import { SONG_BARS, SONG_ENTER, SONG_ORDER, SONG_CHORUS, SONG_OUTRO, SONG_CHORDS, SONG_ROOTS, songVoices, melodyIndex, melodyMidi, chordTone, songPart, songSeconds } from '../src/audio/song';
import { mtof } from '../src/audio/mapping';

const D_MAJOR = new Set([2, 4, 6, 7, 9, 11, 1]);   // D E F# G A B C#
describe('home song: all five tracks as one piece', () => {
  it('is about a minute long', () => {
    expect(SONG_BARS).toBe(20);
    expect(songSeconds()).toBeGreaterThan(50); expect(songSeconds()).toBeLessThan(65);
  });
  it('voices join one at a time, two bars apart, in order; all five in the chorus; none at the end', () => {
    const firsts = SONG_ORDER.map(v => SONG_ENTER[v]);
    expect(firsts).toEqual([2, 4, 6, 8, 10]);
    for (let bar = 0; bar < SONG_BARS; bar++) {
      const on = Object.values(songVoices(bar)).filter(Boolean).length;
      if (bar < 2 || bar >= SONG_OUTRO) expect(on).toBe(0);
      else if (bar >= SONG_CHORUS) expect(on).toBe(5);
      else expect(on).toBe(1 + Math.floor((bar - 2) / 2));
    }
    expect(songPart(0)).toBe('intro'); expect(songPart(5)).toBe('air'); expect(songPart(13)).toBe('chorus'); expect(songPart(19)).toBe('outro');
  });
  it('one key: every chord note is in D major and above 200 Hz; the bass above 190 Hz', () => {
    for (const ch of SONG_CHORDS) for (const m of ch) { expect(D_MAJOR.has(m % 12)).toBe(true); expect(mtof(m)).toBeGreaterThan(200); }
    for (const m of SONG_ROOTS) { expect(D_MAJOR.has(m % 12)).toBe(true); expect(mtof(m)).toBeGreaterThan(190); }
    for (let bar = 0; bar < 8; bar++) for (let k = 0; k < 4; k++) expect(SONG_CHORDS[bar % 4].map(x => x % 12)).toContain(chordTone(bar, k, 2) % 12);
  });
  it('the melody runs through the 15 decades twice (verse, then chorus), two decades a bar', () => {
    const seq: number[] = [];
    for (let bar = 0; bar < SONG_BARS; bar++) for (let st = 0; st < 16; st++) { const i = melodyIndex(bar, st); if (i != null) seq.push(i); }
    expect(seq).toEqual([...Array.from({ length: 16 }, (_, i) => i), ...Array.from({ length: 16 }, (_, i) => i)]);
  });
  it('warmer decades are higher notes, in D major pentatonic, from -1 to +2 degrees', () => {
    const ms = [-1.5, -1, -.5, 0, .5, 1, 1.5, 2, 3].map(melodyMidi);
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThanOrEqual(ms[i - 1]);
    expect(ms[0]).toBe(ms[1]); expect(ms[ms.length - 1]).toBe(ms[ms.length - 2]);
    expect(melodyMidi(1)).toBeGreaterThan(melodyMidi(0));
    for (const m of ms) expect([2, 4, 6, 9, 11]).toContain(m % 12);
  });
});
