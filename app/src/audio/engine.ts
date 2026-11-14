/**
 * Web Audio engine. A lookahead step sequencer whose voices are driven only by the parameters
 * from mapping.ts (computed from the NASA value at the listening point). Two styles:
 * - music: a quiet musical bed in a fixed key (kept low, and lower still during check-ups), plus ONE
 *   data voice per track in front of it: rain = drops, air = a heartbeat whose speed is the PM2.5 above
 *   the WHO guideline (and a muffled bed), climate = one note per year.
 * - precise: one sine tone whose pitch is the value, pulsing four times a second.
 * Idle mode (the Home view): silent until a sound is asked for (previewOnce / playNotes / hearHome), so
 * every sound the listener hears answers a question they just asked. Home always uses the musical sound.
 * "Hear home" (hearHome): one thing at a time. First a recording of a home (the room) alone, then the rain drops
 * on its window, then the air heartbeat. The room is not data; in the air part dirtier air muffles it (see
 * data/home-sounds.ts).
 * Data voices carry energy above 300 Hz, because a phone speaker plays almost nothing below that.
 * Warm, never eerie: major keys only, round mallet and music-box tones (no noise bursts, no deep
 * thuds, no minor-key switch), short light reverb.
 */
import type { ThemeId } from '../themes';
import { mtof, pentaMidi, type RainParams, type AirParams, type ClimateParams, type LightsParams, type LightningParams, type Sound } from './mapping';
import { normGain, homeParts, type HomePart } from '../data/home-sounds';
import { SONG_BARS, SONG_OUTRO, SONG_CHORDS, SONG_ROOTS, songVoices, melodyIndex, melodyMidi, chordTone, songSeconds } from './song';

export type Params = { theme: 'rain'; p: RainParams } | { theme: 'air'; p: AirParams } | { theme: 'climate'; p: ClimateParams } | { theme: 'lights'; p: LightsParams } | { theme: 'lightning'; p: LightningParams };
export type SoundEvent = 'drop' | 'drum' | 'note' | 'whisper' | 'pulse' | 'beat' | 'twinkle' | 'spark';

const BPM = 84, STEP = 60 / BPM / 4;
/** level of the musical bed: normal, and during check-ups (focus) */
const BED = .42, BED_FOCUS = .14, BED_SOLO = .12;
/** Hear home is a quiet, close listen (team reviews found it noisy at full level, then cluttered with everything at
 *  once). The home is in front: ROOM is the recording's level; the data voices that join it, one at a time, are scaled
 *  down from their level in the questions, the heartbeat more than the drops, so each part is about as loud as the
 *  home alone (measured after the limiter at Kuala Lumpur's values: -22.6, -23.3 and -21.8 dBFS). */
const ROOM = .5, HOME_RAIN = .42, HOME_BEAT = .26;
/** Together: the station's chord, under the drops and heartbeat of the Earth below it; there the data voices are a little
 *  softer than in "hear home", so the station's side, all three together, is no louder than the home's (about -21 dBFS). */
const STATION = .045, SPACE_DATA = .8;
/** the lightning the station sees below it: sparse taps, a little under the drops */
const SPACE_LIGHTNING = .45;
/** Home song (song.ts): the chords at the tracks' bed level; the data voices a little under their solo level, so all
 *  five together stay about as loud as one track alone; the melody in front. */
const SONG_PAD = .013, SONG_DATA = .52, SONG_MEL = .085;

/** What the home song plays: each track's NASA value at one place, and the warming per decade for the melody. */
export interface SongSpec {
  rain: RainParams | null; air: AirParams | null; lightning: LightningParams | null; lights: LightsParams | null;
  /** temperature anomaly per decade, 1880s … 2020s (null = no measurements that decade) */
  melody: Array<number | null>;
}
const CHORDS: Record<ThemeId, number[][]> = {
  rain: [[50, 57, 61, 66], [47, 54, 57, 62], [43, 50, 54, 59], [45, 52, 57, 61]],      // Dmaj9 – Bm7 – Gmaj7 – A6
  air: [[40, 47, 51, 56], [44, 51, 54, 59], [45, 52, 56, 61], [47, 54, 57, 63]],       // E – G#m – A – B (E major)
  climate: [[45, 52, 57, 61], [42, 49, 52, 57], [50, 57, 61, 66], [40, 47, 52, 56]],   // A – F#m7 – Dmaj7 – E (A major)
  lights: [[52, 59, 64, 68], [49, 56, 61, 64], [45, 52, 57, 61], [47, 54, 59, 63]],    // E – C#m – A – B (E major), a night song
  lightning: [[55, 62, 67, 71], [52, 59, 64, 67], [60, 64, 67, 72], [62, 66, 69, 74]]  // G – Em – C – D (G major), every note above 150 Hz: storms, but warm
};

class Engine {
  c: AudioContext | null = null;
  on = false;
  sound: Sound = 'music';
  params: Params | null = null;
  counts = { drop: 0, drum: 0, note: 0, whisper: 0, pulse: 0, beat: 0, twinkle: 0, spark: 0 };
  onEvent: (e: SoundEvent, strength: number) => void = () => { /* set by UI */ };
  an!: AnalyserNode; wave = new Uint8Array(1024);
  private master!: GainNode; private bus!: GainNode; private filt!: BiquadFilterNode;
  private send!: GainNode; private noise!: AudioBuffer;
  private rushG!: GainNode; private rushPan!: StereoPannerNode | null; private rushF!: BiquadFilterNode;
  private droneG!: GainNode; private droneO: OscillatorNode[] = [];
  /** the musical bed (pads, plucks) goes through here so the data voice stays in front */
  private bed!: GainNode; focus = false;
  private holdUntil = 0; private liveParams: Params | null = null; private beatNext = 0;
  /** idle: silent unless a preview holds the sound; seq: a note sequence is playing (no automatic notes) */
  idle = false; private seq = false; private seqTimers: number[] = [];
  private precO!: OscillatorNode; private precG!: GainNode;
  private next = 0; private n = 0; private timer = 0;
  /** hear home: the data voices (one part at a time), the part playing, the decoded room recordings and the room playing now */
  private homeMix: { rain: RainParams | null; air: AirParams | null; lightning?: LightningParams | null } | null = null;
  private homePart: HomePart | 'space' | null = null;
  /** the station's chord while Together plays the station's side */
  private spaceOut: GainNode | null = null;
  private homeEnd: (() => void) | null = null;
  private roomBufs: Array<{ buf: AudioBuffer; gain: number; pan: number }> = [];
  private room: { g: GainNode; f: BiquadFilterNode; srcs: AudioBufferSourceNode[]; cutoff: number; level: number } | null = null;

  init() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = this.c = new AC();
    // iPhone: play even when the ring/silent switch is on silent (Safari 16.4+; ignored elsewhere)
    try { (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'playback'; } catch { /* not supported */ }
    this.master = c.createGain(); this.master.gain.value = 0;
    this.filt = c.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 12000; this.filt.Q.value = 0.6;
    // gentle glue, make-up gain, then a limiter (Web Audio compressors add their own make-up gain too):
    // loud enough for a phone speaker, peaks held near −2.5 dBFS
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 3; comp.attack.value = .006; comp.release.value = .25;
    const makeup = c.createGain(); makeup.gain.value = 1.7;
    const lim = c.createDynamicsCompressor(); lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .001; lim.release.value = .12;
    this.an = c.createAnalyser(); this.an.fftSize = 1024; this.wave = new Uint8Array(this.an.fftSize);
    this.bus = c.createGain();
    this.bus.connect(this.filt); this.filt.connect(this.master); this.master.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(this.an); this.an.connect(c.destination);
    this.bed = c.createGain(); this.bed.gain.value = BED; this.bed.connect(this.bus);
    // reverb
    const len = c.sampleRate * 1.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.6); }
    const rev = c.createConvolver(); rev.buffer = ir; this.send = c.createGain(); this.send.gain.value = .2;
    const revOut = c.createGain(); revOut.gain.value = .24; this.send.connect(rev); rev.connect(revOut); revOut.connect(this.filt);
    // noise sources
    const nb = this.noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const rush = c.createBufferSource(); rush.buffer = nb; rush.loop = true;
    this.rushF = c.createBiquadFilter(); this.rushF.type = 'lowpass'; this.rushF.frequency.value = 900; this.rushF.Q.value = .3;
    this.rushG = c.createGain(); this.rushG.gain.value = 0;
    this.rushPan = c.createStereoPanner ? c.createStereoPanner() : null;
    rush.connect(this.rushF); this.rushF.connect(this.rushG);
    if (this.rushPan) { this.rushG.connect(this.rushPan); this.rushPan.connect(this.bus); } else this.rushG.connect(this.bus);
    rush.start();
    // drone
    this.droneG = c.createGain(); this.droneG.gain.value = 0; this.droneG.connect(this.bus);
    this.droneO = [0, 1].map(() => { const o = c.createOscillator(); o.type = 'sine'; o.connect(this.droneG); o.start(); return o; });
    // precise tone
    this.precO = c.createOscillator(); this.precO.type = 'sine'; this.precG = c.createGain(); this.precG.gain.value = 0;
    this.precO.connect(this.precG); this.precG.connect(this.master); this.precO.start();
    this.next = c.currentTime + .1;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  async start() {
    if (!this.c) this.init();
    await this.c!.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(1, this.c!.currentTime, .3);
    this.next = Math.max(this.next, this.c!.currentTime + .05);
  }
  stop() { if (!this.c) return; this.on = false; this.master.gain.setTargetAtTime(0, this.c.currentTime, .15); }
  get running() { return !!this.c && this.on && this.c.state === 'running'; }

  /** Called ~20× a second with fresh parameters from the data (ignored while a preview holds the sound). */
  set(params: Params) {
    this.liveParams = params;
    if (performance.now() < this.holdUntil) return;
    this.apply(params);
  }
  /** Quieter background music so the data voice stands out (check-ups turn this on). */
  setFocus(on: boolean) {
    this.focus = on; this.bedLevel();
  }
  /** Home view: no sound until one is asked for; then the data voice plays almost alone. */
  setIdle(on: boolean) {
    this.idle = on; this.bedLevel();
    if (!on) this.stopSolo(); else if (this.liveParams && !this.holding) this.apply(this.liveParams);
  }
  private bedLevel() { if (this.c) this.bed.gain.setTargetAtTime(this.idle ? BED_SOLO : this.focus ? BED_FOCUS : BED, this.c.currentTime, .3); }
  private get holding() { return performance.now() < this.holdUntil; }
  /** Home always answers in the musical sound (its cards describe drops, a heartbeat and notes); "Precise" belongs to Explore. */
  private get mode(): Sound { return this.idle ? 'music' : this.sound; }
  /** True while sound may play: always, except in idle mode outside a requested sound. */
  get audible() { return !this.idle || this.holding; }
  /** End a requested sound now (and any note sequence). */
  stopSolo() {
    this.seqTimers.forEach(clearTimeout); this.seqTimers = []; this.seq = false;
    this.endSeq(); this.endHome(); this.endSong();
    this.holdUntil = 0; if (this.liveParams) this.apply(this.liveParams);
  }

  private apply(params: Params) {
    this.params = params;
    if (!this.c) return;
    const t = this.c.currentTime, music = this.mode === 'music' && this.audible;
    let cutoff = 12000, rush = 0, pan = 0, drone = 0, precise = 0;
    if (params.theme === 'rain') {
      rush = params.p.rush; pan = params.p.pan; cutoff = 3000 + params.p.brightness * 7000; precise = params.p.preciseHz;
    } else if (params.theme === 'air') {
      rush = params.p.rush * .5; pan = params.p.pan; cutoff = params.p.cutoffHz; precise = params.p.preciseHz;
    } else if (params.theme === 'lights' || params.theme === 'lightning') {
      precise = params.p.preciseHz; cutoff = 6000;
    } else {
      drone = this.seq ? 0 : 1; precise = params.p.preciseHz;
      // the whole planet: a soft open fifth, an octave above the mapping's note (low drones read as dread)
      this.droneO[0].frequency.setTargetAtTime(mtof(params.p.droneMidi + 12), t, .4);
      this.droneO[1].frequency.setTargetAtTime(mtof(params.p.droneMidi + 19), t, .4);
      cutoff = 1800 + params.p.brightness * 7000;
    }
    this.filt.frequency.setTargetAtTime(music ? cutoff : 12000, t, .12);
    // nearby rain: a faint wash in Explore only; in Home the drops alone answer "is it raining here?"
    this.rushG.gain.setTargetAtTime(music && !this.idle ? rush * .035 : 0, t, .4);
    this.rushF.frequency.setTargetAtTime(params.theme === 'air' ? 500 : 900, t, .3);
    if (this.rushPan) this.rushPan.pan.setTargetAtTime(pan * .9, t, .25);
    this.droneG.gain.setTargetAtTime(music ? drone * .03 : 0, t, .5);
    this.precO.frequency.setTargetAtTime(precise, t, .05);
  }

  private tick() {
    if (!this.c) return;
    const c = this.c;
    if (this.next < c.currentTime - .2) this.next = c.currentTime + .05;
    while (this.next < c.currentTime + .14) {
      if (this.on && this.song && this.holding) this.songStep(this.next);
      else if (this.on && this.homeMix && this.holding) this.homeStep(this.next);
      else if (this.on && this.params && this.audible) this.step(this.n, this.next);
      else if (this.precG) this.precG.gain.setTargetAtTime(0, this.next, .02);
      this.next += STEP; this.n++;
    }
    // air quality: a heartbeat whose speed is the data (independent of the bar, so any tempo works)
    const P = this.params;
    const air = this.song ? null : this.homeMix && this.holding ? (this.homePart === 'air' || this.homePart === 'space' ? this.homeMix.air : null) : this.mode === 'music' && P?.theme === 'air' ? P.p : null;
    const bpm = this.on && this.audible && air ? air.bpm : 0;
    if (air && bpm > 0) {
      if (this.beatNext < c.currentTime) this.beatNext = c.currentTime + .05;
      while (this.beatNext < c.currentTime + .14) {
        this.heart(this.beatNext, (.26 + air.beat * .12) * (this.homeMix && this.holding ? HOME_BEAT * (this.homePart === 'space' ? SPACE_DATA : 1) : 1));
        this.emit(this.beatNext, 'beat', air.beat);
        this.beatNext += 60 / bpm;
      }
    } else this.beatNext = 0;
  }

  private emit(t: number, e: SoundEvent, s: number) {
    this.counts[e]++;
    const ms = Math.max(0, (t - this.c!.currentTime) * 1000);
    window.setTimeout(() => this.onEvent(e, s), ms);
  }

  private step(n: number, t: number) {
    const P = this.params!, st = n % 16, bar = Math.floor(n / 16);
    if (this.mode === 'precise') { this.preciseStep(st, t); return; }
    this.precG.gain.setTargetAtTime(0, t, .02);
    if (P.theme === 'rain') {
      const p = P.p;
      if (st === 0) this.pad(t, CHORDS.rain[bar % 4], STEP * 16, .036 * (1 - p.level * .4));
      this.rain(p, t, st);
    } else if (P.theme === 'air') {
      const p = P.p, set = CHORDS.air;
      if (st === 0) { this.pad(t, set[bar % 4], STEP * 16, .042); this.emit(t, 'pulse', p.level); }
      if (st % 4 === 0) this.pluck(t, mtof(pentaMidi(64, [0, 2, 4, 3][Math.floor(st / 4)])), .032, .7, 0);
    } else if (P.theme === 'lights') {
      // night lights: a soft night chord, and twinkles as many as the light (none where it is dark)
      const p = P.p;
      if (st === 0) this.pad(t, CHORDS.lights[bar % 4], STEP * 16, .03);
      const expect = p.twinklesPerSec * STEP;
      let k = Math.floor(expect) + (Math.random() < expect % 1 ? 1 : 0);
      while (k-- > 0) {
        const dt = Math.random() * STEP;
        this.twinkle(t + dt, mtof(pentaMidi(81, Math.floor(Math.random() * 6), [0, 2, 4, 7, 9])), .07 + p.level * .05, Math.random() * 1.2 - .6);
        this.emit(t + dt, 'twinkle', p.level);
      }
    } else if (P.theme === 'lightning') {
      // lightning seen from the ISS: a warm chord, and soft marimba taps as many as the lightning (none where none was seen)
      const p = P.p;
      if (st === 0) this.pad(t, CHORDS.lightning[bar % 4], STEP * 16, .03);
      this.sparks(p, t);
    } else {
      const p = P.p;
      if (st === 0) this.pad(t, CHORDS.climate[bar % 4], STEP * 16, .03);
      if (!this.yearDriven && !this.seq && st % 8 === 0) this.yearNote(t);
    }
  }

  /** Raindrops for one step: as many per second as the data says, plus a soft low note twice a bar in heavy rain. */
  private rain(p: RainParams, t: number, st: number, scale = 1) {
    const expect = p.dropsPerSec * STEP;
    let k = Math.floor(expect) + (Math.random() < expect % 1 ? 1 : 0);
    while (k-- > 0) {
      const dt = Math.random() * STEP;
      // drops fall on D major pentatonic notes (the key of the chords), softly spread across the stereo field
      this.drop(t + dt, mtof(pentaMidi(74, Math.floor(Math.random() * 5))), (.2 + p.level * .12) * scale, Math.random() * 1.2 - .6);
      this.emit(t + dt, 'drop', p.level);
    }
    if (p.drum && (st === 0 || st === 8)) { this.drum(t, scale); this.emit(t, 'drum', 1); }
  }

  /** Lightning for one step: soft marimba taps on G major pentatonic notes, as many per second as the data says. */
  private sparks(p: LightningParams, t: number, scale = 1) {
    const expect = p.tapsPerSec * STEP;
    let k = Math.floor(expect) + (Math.random() < expect % 1 ? 1 : 0);
    while (k-- > 0) {
      const dt = Math.random() * STEP;
      this.spark(t + dt, mtof(pentaMidi(67, Math.floor(Math.random() * 7))), (.09 + p.level * .04) * scale, Math.random() * 1.2 - .6);
      this.emit(t + dt, 'spark', p.level);
    }
  }

  /** Hear home, one step: no music; in the rain part, the rain on the window (the heartbeat of the air part runs in tick).
   *  On the station's side, also the lightning the station sees below it. */
  private homeStep(t: number) {
    this.precG.gain.setTargetAtTime(0, t, .02);
    const space = this.homePart === 'space';
    const r = this.homePart === 'rain' || space ? this.homeMix?.rain : null; if (r) this.rain(r, t, this.n % 16, HOME_RAIN * (space ? SPACE_DATA : 1));
    const l = space ? this.homeMix?.lightning : null; if (l) this.sparks(l, t, SPACE_LIGHTNING);
  }

  /** Decode the home recordings and bring each to the same loudness (RMS). Needs the audio context. */
  async setRoom(clips: Array<{ data: ArrayBuffer; gain: number; pan: number }>, target: number) {
    if (!this.c) this.init();
    const out: Array<{ buf: AudioBuffer; gain: number; pan: number }> = [];
    for (const k of clips) {
      try {
        const buf = await this.c!.decodeAudioData(k.data.slice(0));
        let sum = 0, n = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i += 4) { sum += d[i] * d[i]; n++; } }
        const rms = Math.sqrt(sum / Math.max(1, n));
        out.push({ buf, gain: normGain(rms, target) * k.gain, pan: k.pan });
      } catch { /* a file that cannot be decoded is left out */ }
    }
    this.roomBufs = out;
    return out.length;
  }
  get roomCount() { return this.roomBufs.length; }

  /** Hear home, one thing at a time (see homeParts): the room alone (if given and loaded), then the rain drops on its
   *  window, then the air: the heartbeat, while the room is muffled and recedes as far as the air says. Then quiet again.
   *  `onPart` is called as each part begins. */
  hearHome(mix: { rain: RainParams | null; air: AirParams | null }, room: { cutoff: number; level: number } | null, onPart?: (p: HomePart) => void): Promise<void> {
    if (!this.c) return Promise.resolve();
    this.stopSolo();
    const t = this.c.currentTime, withRoom = !!room && this.roomBufs.length > 0;
    const { parts, total } = homeParts(withRoom);
    this.homeMix = mix; this.holdUntil = performance.now() + total * 1000;
    // the music, its filter, the rain wash and the drone stay out of the way
    this.filt.frequency.setTargetAtTime(12000, t, .1); this.rushG.gain.setTargetAtTime(0, t, .2); this.droneG.gain.setTargetAtTime(0, t, .2);
    if (withRoom) this.startRoom(room!, total, parts.find(p => p.part === 'air')!.start);
    return new Promise<void>(res => {
      this.homeEnd = res;
      const begin = (p: HomePart) => { this.homePart = p; onPart?.(p); };
      begin(parts[0].part);
      parts.slice(1).forEach(p => this.seqTimers.push(window.setTimeout(() => begin(p.part), p.start * 1000)));
      this.seqTimers.push(window.setTimeout(() => { this.seqTimers = []; this.holdUntil = 0; this.endHome(); if (this.liveParams) this.apply(this.liveParams); }, total * 1000));
    });
  }
  /** The room plays open and at full level until the air part begins (`airAt` seconds in); from then it is muffled and recedes. */
  private startRoom(room: { cutoff: number; level: number }, seconds: number, airAt: number) {
    const c = this.c!, t = c.currentTime, end = t + seconds, ta = t + airAt, shut = ROOM * room.level;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(ROOM, t + .8);
    g.gain.setValueAtTime(ROOM, ta); g.gain.linearRampToValueAtTime(shut, ta + 1);
    g.gain.setValueAtTime(shut, Math.max(ta + 1.1, end - 1.6)); g.gain.linearRampToValueAtTime(0, end);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = .5;
    f.frequency.setValueAtTime(12000, t); f.frequency.setValueAtTime(12000, ta); f.frequency.exponentialRampToValueAtTime(room.cutoff, ta + 1);
    // `out` is never automated: ending early fades it, so the scheduled envelope on `g` is left alone
    const out = c.createGain(); out.gain.value = 1;
    f.connect(g); g.connect(out); out.connect(this.master);
    const srcs = this.roomBufs.map(b => {
      const s = c.createBufferSource(); s.buffer = b.buf; s.loop = true;
      const v = c.createGain(); v.gain.value = b.gain; s.connect(v);
      let tail: AudioNode = v;
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = b.pan; v.connect(p); tail = p; }
      tail.connect(f);
      s.start(t); s.stop(end + .1);            // always from the start of the recording, where the cooking is busiest
      return s;
    });
    this.room = { g: out, f, srcs, cutoff: room.cutoff, level: room.level };
  }
  /** Together, the station's side: a soft chord for the station while the Earth passes below it, one segment of the
   *  ground track at a time (NASA's rain and air under the track; drops and heartbeat as in "hear home").
   *  `onSeg` is called as each segment begins. */
  hearSpace(segs: Array<{ rain: RainParams | null; air: AirParams | null; lightning?: LightningParams | null }>, segSeconds: number, onSeg?: (i: number) => void): Promise<void> {
    if (!this.c || !segs.length) return Promise.resolve();
    this.stopSolo();
    const t = this.c.currentTime, total = segs.length * segSeconds;
    this.homeMix = segs[0]; this.homePart = 'space'; this.holdUntil = performance.now() + total * 1000;
    this.filt.frequency.setTargetAtTime(12000, t, .1); this.rushG.gain.setTargetAtTime(0, t, .2); this.droneG.gain.setTargetAtTime(0, t, .2);
    this.stationChord(t, total);
    return new Promise<void>(res => {
      this.homeEnd = res;
      onSeg?.(0);
      segs.slice(1).forEach((m, i) => this.seqTimers.push(window.setTimeout(() => { this.homeMix = m; onSeg?.(i + 1); }, (i + 1) * segSeconds * 1000)));
      this.seqTimers.push(window.setTimeout(() => { this.seqTimers = []; this.holdUntil = 0; this.endHome(); if (this.liveParams) this.apply(this.liveParams); }, total * 1000));
    });
  }
  // ---------- the home song (song.ts) ----------
  private song: { spec: SongSpec; t0: number; out: GainNode; padCut: number } | null = null;
  private songEnd: (() => void) | null = null;
  /** Play the home song (about 57 s). `onBar` is called as each bar begins. Resolves when it ends or is stopped. */
  hearSong(spec: SongSpec, onBar?: (bar: number) => void): Promise<void> {
    if (!this.c) return Promise.resolve();
    this.stopSolo();
    const c = this.c, now = c.currentTime, t0 = now + .15, total = songSeconds();
    // `out` is never automated while the song plays: stopping fades it, so the scheduled notes are left alone
    const out = c.createGain(); out.gain.value = 1; out.connect(this.bus);
    // dirtier air muffles the chords (as it muffles the music in the Air track): 1600 Hz clean … 640 Hz at 10× WHO
    const padCut = 1600 * (1 - .6 * (spec.air?.beat ?? 0));
    this.song = { spec, t0, out, padCut };
    this.holdUntil = performance.now() + (total + 2.5) * 1000;
    this.next = t0;
    this.filt.frequency.setTargetAtTime(12000, now, .1); this.rushG.gain.setTargetAtTime(0, now, .2); this.droneG.gain.setTargetAtTime(0, now, .2);
    return new Promise<void>(res => {
      this.songEnd = res;
      for (let b = 0; b < SONG_BARS; b++) this.seqTimers.push(window.setTimeout(() => onBar?.(b), (t0 - now + b * 16 * STEP) * 1000));
      this.seqTimers.push(window.setTimeout(() => { this.seqTimers = []; this.holdUntil = 0; this.endSong(); if (this.liveParams) this.apply(this.liveParams); }, (t0 - now + total + 2) * 1000));
    });
  }
  private endSong() {
    if (!this.song) return;
    if (this.c) this.song.out.gain.setTargetAtTime(0, this.c.currentTime, .15);
    this.song = null;
    const done = this.songEnd; this.songEnd = null; done?.();
  }
  /** For tests: where the song is. */
  songState() { return this.song && this.c ? { bar: Math.floor((this.c.currentTime - this.song.t0) / (16 * STEP)), scheduledBar: Math.floor((this.next - STEP - this.song.t0) / (16 * STEP) + 1e-6), padCut: this.song.padCut } : null; }

  /** One sixteenth of the song: the chord, then each voice that has joined, every note taken from the bar's chord. */
  private songStep(t: number) {
    const S = this.song!, k = Math.round((t - S.t0) / STEP);
    this.precG.gain.setTargetAtTime(0, t, .02);
    if (k < 0) return;
    const bar = Math.floor(k / 16), st = k % 16, sp = S.spec, out = S.out;
    if (bar >= SONG_BARS) return;
    const on = songVoices(bar), rnd = (n: number) => Math.floor(Math.random() * n), pan = () => Math.random() * 1.2 - .6;
    if (st === 0) this.pad(t, SONG_CHORDS[bar % 4], STEP * 16, SONG_PAD * (bar >= SONG_OUTRO ? .8 : 1), out, S.padCut);
    // melody: the warming, one decade every half bar (music-box voice), with a soft echo a dotted eighth later
    const mi = melodyIndex(bar, st);
    if (on.melody && mi != null && mi < sp.melody.length) {
      const a = sp.melody[mi];
      if (a == null) { this.mallet(t, mtof(81), .05, .12, out); this.emit(t, 'whisper', 0); }
      else {
        const m = melodyMidi(a), b = (m - 62) / 21;
        this.bell(t, mtof(m), SONG_MEL, b, out); this.bell(t + 3 * STEP, mtof(m), SONG_MEL * .3, b, out);
        this.emit(t, 'note', b);
      }
    }
    if (bar === SONG_OUTRO && st === 0) {   // the end: the last decade once more, softly
      const last = [...sp.melody].reverse().find(x => x != null);
      if (last != null) this.bell(t, mtof(melodyMidi(last)), SONG_MEL * .6, .5, out);
    }
    // air: a calm bass on beats 1 and 3 when the air is clean; above the WHO guideline a heartbeat instead,
    // 2 to 4 lub-dubs a bar as the air gets dirtier
    if (on.air && sp.air) {
      const root = SONG_ROOTS[bar % 4], a = sp.air;
      if (a.bpm > 0) {
        const per = Math.min(4, 2 + Math.round(a.beat * 2)), at = per === 2 ? [0, 8] : per === 3 ? [0, 8, 12] : [0, 4, 8, 12];
        if (at.includes(st)) {
          const g = (.15 + a.beat * .06) * SONG_DATA;
          this.mallet(t, mtof(root + 7), g, .42, out); this.mallet(t + STEP, mtof(root), g * .7, .38, out);   // lub on the fifth, dub on the root: both above 190 Hz
          this.emit(t, 'beat', a.beat);
        }
      } else if (st === 0 || st === 8) { this.mallet(t, mtof(root), .15 * SONG_DATA, .5, out); this.emit(t, 'pulse', 0); }
    }
    // rain: drops on the sixteenths, as many as the rain (none when dry)
    if (on.rain && sp.rain && sp.rain.dropsPerSec > 0 && Math.random() < Math.min(.9, sp.rain.dropsPerSec * STEP)) {
      this.drop(t, mtof(chordTone(bar, rnd(4), 2)), (.16 + sp.rain.level * .08) * SONG_DATA, pan(), out);
      this.emit(t, 'drop', sp.rain.level);
    }
    // lightning: marimba on the eighths, as many as the lightning seen this month (none where none was seen)
    if (on.lightning && sp.lightning && sp.lightning.tapsPerSec > 0 && st % 2 === 0 && Math.random() < sp.lightning.tapsPerSec / 6 * .8) {
      this.spark(t, mtof(chordTone(bar, rnd(4), 1)), (.09 + sp.lightning.level * .04) * SONG_DATA, pan(), out);
      this.emit(t, 'spark', sp.lightning.level);
    }
    // night lights: high bells on the sixteenths, as many as the light (none in the dark)
    if (on.lights && sp.lights && sp.lights.twinklesPerSec > 0 && Math.random() < Math.min(.45, sp.lights.twinklesPerSec * STEP * .5)) {
      this.twinkle(t, mtof(chordTone(bar, rnd(4), 2 + rnd(2))), (.05 + sp.lights.level * .04) * SONG_DATA, pan(), out);
      this.emit(t, 'twinkle', sp.lights.level);
    }
  }

  /** The station: a warm D major chord with an added ninth, every note above 200 Hz (no rumble), breathing slowly. */
  private stationChord(t: number, dur: number) {
    const c = this.c!, out = c.createGain(), f = c.createBiquadFilter(), lfo = c.createOscillator(), lg = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 2200; f.Q.value = .4;
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(STATION, t + 1.5);
    out.gain.setValueAtTime(STATION, Math.max(t + 1.6, t + dur - 1.6)); out.gain.linearRampToValueAtTime(0, t + dur);
    lfo.frequency.value = .18; lg.gain.value = STATION * .25; lfo.connect(lg); lg.connect(out.gain);
    // `fade` is never automated: stopping early fades it, so the scheduled envelope and the slow breathing on `out` are left alone
    const fade = c.createGain(); fade.gain.value = 1;
    f.connect(out); out.connect(fade); fade.connect(this.master); fade.connect(this.send);
    [57, 62, 66, 69, 76].forEach((m, i) => (['sine', 'triangle'] as OscillatorType[]).forEach((type, j) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = (j ? 4 : -4) + (i % 2 ? 2 : -2);
      const g = c.createGain(); g.gain.value = (j ? .12 : .22) * (i === 4 ? .6 : 1); o.connect(g); g.connect(f); o.start(t); o.stop(t + dur + .3);
    }));
    lfo.start(t); lfo.stop(t + dur + .3);
    this.spaceOut = fade;
  }
  private endHome() {
    if (this.spaceOut && this.c) { this.spaceOut.gain.setTargetAtTime(0, this.c.currentTime, .15); this.spaceOut = null; }
    this.homeMix = null; this.homePart = null;
    if (this.room && this.c) {
      const t = this.c.currentTime, r = this.room;
      r.g.gain.setTargetAtTime(0, t, .12);
      r.srcs.forEach(s => { try { s.stop(t + .8); } catch { /* already stopped */ } });
    }
    this.room = null;
    const done = this.homeEnd; this.homeEnd = null; done?.();
  }
  /** For tests: what hear home is doing right now. */
  homeState() { return { mix: !!this.homeMix, part: this.homePart, rain: this.homeMix?.rain?.dropsPerSec ?? 0, bpm: this.homeMix?.air?.bpm ?? 0, room: this.room ? { cutoff: this.room.cutoff, level: this.room.level, clips: this.room.srcs.length } : null, loaded: this.roomBufs.length }; }

  /** In the Climate track the melody advances with the years: main.ts calls this on every new year while playing. */
  yearDriven = false;
  yearNote(at?: number) {
    if (!this.c || !this.on || !this.params || this.params.theme !== 'climate') return;
    const t = at ?? this.c.currentTime + .02, p = this.params.p;
    if (this.mode === 'precise' || !this.audible) return;
    if (!p.hasData) { this.whisper(t); this.emit(t, 'whisper', 0); return; }
    this.bell(t, mtof(p.midi), .11 + p.brightness * .05, p.brightness);
    this.emit(t, 'note', p.brightness);
  }

  /** Play a short sequence of climate notes (e.g. one per decade), `gap` seconds apart, then go quiet again.
   *  Notes are scheduled just in time, so stopSolo() can cut the sequence short. */
  playNotes(notes: ClimateParams[], gap = .5, onNote?: (i: number) => void): Promise<void> {
    if (!this.c || !notes.length) return Promise.resolve();
    this.stopSolo();
    const total = notes.length * gap + 1.4;
    this.seq = true; this.holdUntil = performance.now() + total * 1000;
    this.apply({ theme: 'climate', p: notes[notes.length - 1] });
    return new Promise<void>(res => {
      this.seqEnd = res;   // also resolved by stopSolo() and previewOnce(), so a cut sequence never hangs its caller
      notes.forEach((p, i) => this.seqTimers.push(window.setTimeout(() => {
        if (!this.c || !this.seq) return;
        const t = this.c.currentTime + .03;
        if (!p.hasData) { this.whisper(t); this.emit(t, 'whisper', 0); }
        else { this.bell(t, mtof(p.midi), .11 + p.brightness * .05, p.brightness); this.emit(t, 'note', p.brightness); }
        onNote?.(i);
      }, i * gap * 1000)));
      this.seqTimers.push(window.setTimeout(() => { this.seq = false; this.seqTimers = []; if (!this.holding || performance.now() >= this.holdUntil - 5) { this.holdUntil = 0; if (this.liveParams) this.apply(this.liveParams); } this.endSeq(); }, total * 1000));
    });
  }
  private seqEnd: (() => void) | null = null;
  private endSeq() { const done = this.seqEnd; this.seqEnd = null; done?.(); }

  private preciseStep(st: number, t: number) {
    const on = st % 4 === 0;
    if (!on) return;
    const P = this.params!;
    const silent = ((P.theme === 'rain' || P.theme === 'lights' || P.theme === 'lightning') && P.p.level === 0) || (P.theme === 'climate' && !P.p.hasData);
    if (silent) { this.tick2(t); return; }
    this.precG.gain.setValueAtTime(0, t); this.precG.gain.linearRampToValueAtTime(.3, t + .01);
    this.precG.gain.setValueAtTime(.3, t + STEP * 2.2); this.precG.gain.linearRampToValueAtTime(0, t + STEP * 2.6);
    this.emit(t, 'pulse', 1);
  }

  /** Short neutral click: "here, but nothing to report". */
  private tick2(t: number) {
    const c = this.c!, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 1800; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.025, t + .002); g.gain.exponentialRampToValueAtTime(.0005, t + .03);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .04);
  }

  /** Plays one value for the sound legend, independent of the listening point. */
  previewOnce(params: Params, seconds = 2.2) {
    this.seqTimers.forEach(clearTimeout); this.seqTimers = []; this.seq = false; this.endSeq(); this.endHome();
    this.holdUntil = performance.now() + seconds * 1000;
    this.apply(params);
    if (params.theme === 'climate') { this.yearNote(); window.setTimeout(() => this.yearNote(), 550); window.setTimeout(() => this.yearNote(), 1100); }
    return new Promise<void>(res => window.setTimeout(() => {
      if (performance.now() >= this.holdUntil - 5) { this.holdUntil = 0; if (this.liveParams) this.apply(this.liveParams); }
      res();
    }, seconds * 1000));
  }

  private pad(t: number, midis: number[], dur: number, gain: number, dest: AudioNode = this.bed, cutoff = 1600) {
    const c = this.c!, out = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = .5;
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(gain, t + Math.min(1.4, dur * .35));
    out.gain.setValueAtTime(gain, t + dur * .8); out.gain.linearRampToValueAtTime(0, t + dur + 1.2);
    f.connect(out); out.connect(dest); out.connect(this.send);
    midis.forEach((m, i) => (['triangle', 'sine'] as OscillatorType[]).forEach((type, j) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = (j ? 5 : -5) + (i % 2 ? 3 : -3);
      const g = c.createGain(); g.gain.value = j ? .6 : .3; o.connect(g); g.connect(f); o.start(t); o.stop(t + dur + 1.4);
    }));
  }
  /** A twinkle: a short, soft glass-like note (a sine and a faint third harmonic), 880-1760 Hz. */
  private twinkle(t: number, f: number, gain: number, pan: number, dest: AudioNode = this.bus) {
    const c = this.c!, g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .004); g.gain.exponentialRampToValueAtTime(.0004, t + .45);
    ([[1, 1], [3, .12]] as Array<[number, number]>).forEach(([m, a]) => {
      const o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.value = f * m; og.gain.value = a;
      o.connect(og); og.connect(g); o.start(t); o.stop(t + .5);
    });
    let tail: AudioNode = g;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }
    tail.connect(dest); tail.connect(this.send);
  }
  private drop(t: number, f: number, gain: number, pan: number, dest: AudioNode = this.bus) {
    const c = this.c!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + .03);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .004); g.gain.exponentialRampToValueAtTime(.0005, t + .22);
    o.connect(g);
    let tail: AudioNode = g;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }
    tail.connect(dest); tail.connect(this.send); o.start(t); o.stop(t + .25);
  }
  /** A soft wooden mallet note (marimba-like): a sine fundamental and a quickly fading 4th partial,
   *  which a phone speaker can play. No noise and no pitch drop: round, not a thud. */
  private mallet(t: number, f: number, gain: number, len: number, dest: AudioNode) {
    const c = this.c!;
    ([[1, 1, len], [4, .3, len * .22], [9.9, .05, len * .07]] as Array<[number, number, number]>).forEach(([m, a, l]) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f * m;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * a, t + .008); g.gain.exponentialRampToValueAtTime(.0005, t + l);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + l + .05);
    });
  }
  /** Heavy rain: a soft low mallet on D3 (the Rain key), not a kick drum. */
  private drum(t: number, scale = 1) { this.mallet(t, mtof(50), .2 * scale, .6, this.bus); }
  /** "lub-dub": two warm mallet notes in the key of the Air chords, E4 then B3, the second softer. */
  private heart(t: number, gain: number) {
    this.mallet(t, mtof(64), gain, .42, this.master);
    this.mallet(t + .17, mtof(59), gain * .7, .38, this.master);
  }
  private pluck(t: number, f: number, gain: number, len: number, pan: number) {
    const c = this.c!, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .006); g.gain.exponentialRampToValueAtTime(.0006, t + len);
    o.connect(g);
    let tail: AudioNode = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }
    tail.connect(this.bed); tail.connect(this.send); o.start(t); o.stop(t + len + .05);
  }
  /** A music-box note, an octave above the mapped pitch, with harmonic partials (not a tolling bell). */
  private bell(t: number, f: number, gain: number, bright: number, dest: AudioNode = this.bus) {
    const c = this.c!;
    ([[2, 1, 1.1], [4, .22 + bright * .15, .45], [6, .06 + bright * .08, .25]] as Array<[number, number, number]>).forEach(([m, a, l]) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f * m;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * a, t + .005); g.gain.exponentialRampToValueAtTime(.0004, t + l);
      o.connect(g); g.connect(dest); g.connect(this.send); o.start(t); o.stop(t + l + .05);
    });
  }
  /** Lightning: one soft marimba note (the mallet voice), placed across the stereo field. */
  private spark(t: number, f: number, gain: number, pan: number, to: AudioNode = this.bus) {
    const c = this.c!;
    let dest: AudioNode = to;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; p.connect(to); p.connect(this.send); dest = p; }
    this.mallet(t, f, gain, .5, dest);
  }
  /** No data that year: a soft, short wooden tap instead of a note. */
  private whisper(t: number) { this.mallet(t, mtof(81), .06, .12, this.bus); }
}

export const AE = new Engine();
