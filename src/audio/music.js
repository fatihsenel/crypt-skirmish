// Procedural background music, built on the same Web Audio primitives as the sound
// effects (sfx.tone / sfx.noise) and played through their stone-room reverb.
//
// One clock (72 bpm, sixteenth steps) drives three layers over a four-bar loop in
// A minor with a horror turn: Am, B♭ (a half step up), Dm, and E with a clashing F on top.
// Each layer has its own gain, and the mood sets which are heard:
//   calm     the title and camp: the exploring layer, softer
//   explore  in a room nobody has noticed you in yet: a beating tritone drone under a soft,
//            dark pad
//   combat   monsters are on to you: drums, a bass ostinato and trembling strings that
//            grind a half step against the chord
//   boss     the final rooms: combat plus a low drone that keeps sinking, and quick ticks
// Moods crossfade over a couple of seconds, so a fight builds and then dies away.

import { sfx } from './sfx.js';

const STORAGE_KEY = 'crypt-skirmish:music';
const BPM = 72;
const STEP = 60 / BPM / 4; // a sixteenth note, in seconds
const LOOKAHEAD = 0.25;    // schedule this far ahead of the audio clock

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
// Am, B♭, Dm, E(♭9): the B♭ and the F over E are the half-step rubs that make it uneasy.
const CHORDS = [
  [57, 60, 64], // A C E
  [58, 62, 65], // B♭ D F
  [50, 53, 57], // D F A
  [52, 56, 59, 65], // E G# B F
];
/** Target gain of each layer, per mood. */
const MIX = {
  off: { explore: 0, combat: 0, boss: 0 },
  calm: { explore: 0.55, combat: 0, boss: 0 },
  explore: { explore: 1, combat: 0, boss: 0 },
  combat: { explore: 0.45, combat: 1, boss: 0 },
  boss: { explore: 0.35, combat: 1, boss: 1 },
};

function loadEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

class Music {
  constructor() {
    this.enabled = loadEnabled();
    this.mood = 'calm';
    this.layers = null;
    this.step = 0;
    this.next = 0;
    this.timer = null;
    this.volume = 0.55;
  }

  /** Start once sfx has its AudioContext (after the first click or key press). */
  start() {
    if (this.layers || !sfx.ctx) return;
    const c = sfx.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0.0001;
    this.out.connect(sfx.musicLevel); // the music level, then the reverb; sfx.master handles muting
    this.layers = {};
    for (const name of ['explore', 'combat', 'boss']) {
      const g = c.createGain();
      g.gain.value = 0.0001;
      g.connect(this.out);
      this.layers[name] = g;
    }
    this.next = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 60);
    this.apply(1.2); // quick enough that the first tap is heard
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable: setting just won't persist */
    }
    this.apply(0.6);
  }

  /** 'calm' | 'explore' | 'combat' | 'boss'. Cheap to call often: only a change does anything. */
  setMood(mood) {
    if (mood === this.mood) return;
    // Fights build quickly and fade slowly.
    const rising = (MIX[mood]?.combat ?? 0) > (MIX[this.mood]?.combat ?? 0);
    this.mood = mood;
    this.apply(rising ? 1.2 : 3.5);
  }

  /** Ramp every layer toward the current mood over roughly `seconds`. */
  apply(seconds) {
    if (!this.layers) return;
    const t = sfx.ctx.currentTime;
    const ramp = (param, v) => {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(Math.max(v, 0.0001), t, seconds / 3);
    };
    ramp(this.out.gain, this.enabled ? this.volume : 0);
    const mix = MIX[this.mood] ?? MIX.calm;
    for (const [name, g] of Object.entries(this.layers)) ramp(g.gain, mix[name]);
  }

  /** Is this layer loud enough to be worth scheduling notes for? */
  audible(name) {
    return (this.enabled && (MIX[this.mood]?.[name] ?? 0) > 0) || this.layers[name].gain.value > 0.02;
  }

  schedule() {
    if (!sfx.ready || sfx.muted) {
      // Nothing to hear: keep the clock current so it doesn't burst back in.
      if (sfx.ctx) this.next = Math.max(this.next, sfx.ctx.currentTime + 0.05);
      return;
    }
    const now = sfx.ctx.currentTime;
    if (this.next < now - 0.1) this.next = now + 0.05; // tab was asleep: skip, don't catch up
    while (this.next < now + LOOKAHEAD) {
      this.playStep(this.step, this.next);
      this.step = (this.step + 1) % 64;
      this.next += STEP;
    }
  }

  playStep(step, t) {
    const s = step % 16;
    const chord = CHORDS[Math.floor(step / 16)];
    const bar = 16 * STEP;
    const L = this.layers;
    const rnd = Math.random;

    if (this.audible('explore')) {
      // the drone: low A against a low E♭ (a tritone), each a pair a hair apart so they beat
      if (step % 64 === 0) {
        for (const [n, d, g] of [[33, 1, 0.07], [33, 1.003, 0.05], [39, 1, 0.025], [39, 0.996, 0.02]]) {
          sfx.tone(t, { type: 'triangle', freq: midi(n) * d, dur: bar * 4.2, gain: g, attack: bar * 1.2, lowpass: 400, out: L.explore });
        }
      }
      // the pad: the chord low and hushed, one swell per bar
      if (s === 0) {
        chord.slice(0, 3).forEach((n, i) => {
          sfx.tone(t, { type: 'triangle', freq: midi(n - 12) * (1 + (i - 1) * 0.002), dur: bar * 1.2, gain: 0.03, attack: bar * 0.4, lowpass: 700, out: L.explore });
        });
      }
    }

    if (this.audible('combat')) {
      // low drum: a heartbeat with a pickup into the next bar
      if (s === 0 || s === 6 || s === 8 || (s === 14 && rnd() < 0.6)) {
        sfx.tone(t, { type: 'sine', freq: 82, freqEnd: 42, dur: 0.35, gain: s === 0 ? 0.32 : 0.22, out: L.combat });
        sfx.noise(t, { dur: 0.08, filter: 'lowpass', freq: 400, gain: 0.12, out: L.combat });
      }
      // frame drum on the backbeat
      if (s === 4 || s === 12) sfx.noise(t, { dur: 0.16, filter: 'bandpass', freq: 900, q: 1.2, gain: 0.1, out: L.combat });
      // bass ostinato in eighths
      if (s % 2 === 0 && [1, 0, 1, 1, 0, 1, 0, 1][s / 2]) {
        const n = chord[0] - 24 + (s === 10 ? 7 : 0);
        sfx.tone(t, { type: 'sawtooth', freq: midi(n), dur: STEP * 1.8, gain: 0.07, attack: 0.01, lowpass: 420, out: L.combat });
      }
      // strings: tremolo on the root and fifth, with a half step above the root grinding
      // against them, swelling through the bar
      if (s % 2 === 0) {
        for (const [n, g] of [[chord[0], 0.016], [chord[0] + 7, 0.012], [chord[0] + 1, 0.007]]) {
          const swell = 0.4 + 0.6 * (s / 16);
          sfx.tone(t, { type: 'sawtooth', freq: midi(n) * (1 + (rnd() - 0.5) * 0.004), dur: STEP * 1.9, gain: g * swell, attack: 0.02, lowpass: 1600, out: L.combat });
        }
      }
    }

    if (this.audible('boss')) {
      // a low drone that slides down a half step every other bar
      if (s === 0 && step % 32 === 0) {
        for (const d of [1, 1.006]) {
          sfx.tone(t, { type: 'sawtooth', freq: midi(chord[0] - 24) * d, freqEnd: midi(chord[0] - 25) * d, dur: bar * 1.9, gain: 0.05, attack: 0.6, lowpass: 600, out: L.boss });
        }
      }
      // quick ticks in sixteenths, accents on the beat
      sfx.noise(t, { dur: 0.03, filter: 'highpass', freq: 6000, gain: s % 4 === 0 ? 0.05 : 0.025, out: L.boss });
      // an extra drum hit that drives the bar
      if (s === 10 || s === 11) sfx.tone(t, { type: 'sine', freq: 110, freqEnd: 55, dur: 0.2, gain: 0.16, out: L.boss });
    }
  }
}

export const music = new Music();
