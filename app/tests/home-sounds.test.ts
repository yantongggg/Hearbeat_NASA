import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRoomManifest, roomCutoff, roomLevel, normGain, ROOM_KINDS, ROOM_MIX, clipMix, credit, homeParts, type RoomClip } from '../src/data/home-sounds';
import { airParams } from '../src/audio/mapping';

const clip: RoomClip = {
  id: 'dishes', kind: 'dishes', file: 'dishes.mp3', en: 'Dishes', zh: '碗碟', title: 'Some recording', author: 'Someone',
  license: 'Public domain', licenseUrl: '', source: 'https://commons.wikimedia.org/wiki/File:Some.ogg',
  excerpt: '0:05–0:30', changes: 'trimmed, converted to MP3', people: 'none'
};

describe('Sounds of a home', () => {
  it('clean air leaves the window open; dirtier air shuts the room in, step by step', () => {
    expect(roomCutoff(null)).toBe(12000);
    expect(roomCutoff(10)).toBe(12000);
    expect(roomLevel(15)).toBe(1);
    const pms = [16, 24, 50, 90, 150, 400];
    const cut = pms.map(roomCutoff), lev = pms.map(roomLevel);
    for (let i = 1; i < pms.length; i++) { expect(cut[i]).toBeLessThanOrEqual(cut[i - 1]); expect(lev[i]).toBeLessThanOrEqual(lev[i - 1]); }
    expect(cut[0]).toBeLessThan(7000);
    expect(roomCutoff(150)).toBeCloseTo(3000, 6);
    expect(roomLevel(150)).toBeCloseTo(.75, 6);
    // the home never drops out: a pan's sizzle lives above 3 kHz, and the level stays at three quarters or more
    expect(Math.min(...cut)).toBeGreaterThanOrEqual(3000 - 1e-6);
    expect(Math.min(...lev)).toBeGreaterThanOrEqual(.75 - 1e-9);
    // Kuala Lumpur (24 µg/m³) and Jakarta (90 µg/m³) on 4 Nov still sound different
    expect(roomCutoff(24) / roomCutoff(90)).toBeGreaterThan(1.5);
  });
  it('hear home is one thing at a time: the home, then the rain, then the air; without recordings, the rain, then the air', () => {
    const a = homeParts(true), b = homeParts(false);
    expect(a.parts.map(p => p.part)).toEqual(['room', 'rain', 'air']);
    expect(b.parts.map(p => p.part)).toEqual(['rain', 'air']);
    for (const x of [a, b]) {
      expect(x.parts[0].start).toBe(0);
      x.parts.forEach((p, i) => { if (i) expect(p.start).toBeCloseTo(x.parts[i - 1].start + x.parts[i - 1].seconds, 9); expect(p.seconds).toBeGreaterThanOrEqual(3); });
      const last = x.parts[x.parts.length - 1];
      expect(x.total).toBeCloseTo(last.start + last.seconds, 9);
    }
    expect(a.total).toBe(12);
    // a heartbeat at the slowest speed (60 a minute) still beats at least four times in its part
    expect(a.parts[2].seconds * 60 / 60).toBeGreaterThanOrEqual(4);
  });
  it('the room closes on the same scale as the heartbeat: no heartbeat means an open room', () => {
    for (const pm of [5, 15]) { expect(airParams(pm, { coverage: 0, pan: 0 }).bpm).toBe(0); expect(roomCutoff(pm)).toBe(12000); }
    for (const pm of [20, 60, 150]) { expect(airParams(pm, { coverage: 0, pan: 0 }).bpm).toBeGreaterThan(0); expect(roomCutoff(pm)).toBeLessThan(12000); }
  });
  it('every recording is brought to the same loudness, never boosted without limit', () => {
    expect(normGain(.05)).toBeCloseTo(1, 6);
    expect(normGain(.1)).toBeCloseTo(.5, 6);
    expect(normGain(.001)).toBe(8);
    expect(normGain(0)).toBe(0);
    for (const k of ROOM_KINDS) expect(ROOM_MIX[k].gain).toBeLessThanOrEqual(1);
  });
  it('a clip must say where it is from, be free of restrictions, and contain no voice', () => {
    expect(() => checkRoomManifest({ clips: [clip] })).not.toThrow();
    expect(() => checkRoomManifest({ clips: [{ ...clip, license: 'CC0' }] })).not.toThrow();
    expect(() => checkRoomManifest({ clips: [{ ...clip, license: 'All rights reserved' }] })).toThrow(/licence/);
    // the Space Apps terms need third-party material without restriction: attribution and share-alike are restrictions
    for (const l of ['CC BY 4.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0']) expect(() => checkRoomManifest({ clips: [{ ...clip, license: l }] })).toThrow(/licence/);
    // …and no recognizable voice of anyone under 18 (adults need consent): shipped clips have no voices at all
    expect(() => checkRoomManifest({ clips: [{ ...clip, people: 'a father and his son' }] })).toThrow(/no person's voice/);
    expect(() => checkRoomManifest({ clips: [{ ...clip, people: undefined }] })).toThrow(/no person's voice/);
    expect(() => checkRoomManifest({ clips: [{ ...clip, gain: 1.5 }] })).toThrow(/gain/);
    expect(clipMix(clip)).toEqual(ROOM_MIX.dishes);
    expect(clipMix({ ...clip, gain: .5, pan: -.3 })).toEqual({ gain: .5, pan: -.3 });
    expect(() => checkRoomManifest({ clips: [{ ...clip, source: 'https://example.com/x.ogg' }] })).toThrow(/Commons/);
    expect(() => checkRoomManifest({ clips: [{ ...clip, author: '' }] })).toThrow(/author/);
    expect(() => checkRoomManifest({ clips: [clip, clip] })).toThrow(/unique/);
    expect(() => checkRoomManifest({ clips: [{ ...clip, kind: 'tv' }] })).toThrow(/kind/);
    expect(() => checkRoomManifest({})).toThrow();
    expect(credit(clip)).toContain('Someone, Public domain');
  });
  it('the shipped manifest (if present) is valid and every file it names exists', () => {
    const dir = join(__dirname, '../public/home-sounds'), mf = join(dir, 'manifest.json');
    if (!existsSync(mf)) return;
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    checkRoomManifest(m);
    expect(m.clips.length).toBeGreaterThan(0);
    for (const c of m.clips) expect(existsSync(join(dir, c.file)), c.file).toBe(true);
  });
});
