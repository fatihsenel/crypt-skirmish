// Procedural background music, built on the same Web Audio primitives as the sound
// effects (sfx.tone / sfx.noise) and played through their stone-room reverb.
//
// One clock (84 bpm, sixteenth steps) drives three layers over a four-bar loop in
// A minor (Am F Dm E). Each layer has its own gain, and the mood sets which are heard:
//   calm     the title and camp: the exploring layer, softer
//   explore  in a room nobody has noticed you in yet: a slow pad and stray bell notes
//   combat   monsters are on to you: drums, a bass ostinato and strings come in
//   boss     the sanctum and the barrow: combat plus brass swells and quick ticks
// Moods crossfade over a couple of seconds, so a fight builds and then dies away.

import { sfx } from './sfx.js';

const STORAGE_KEY = 'crypt-skirmish:music';
const BPM = 84;
const STEP = 60 / BPM / 4; // a sixteenth note, in seconds
const LOOKAHEAD = 0.25;    // schedule this far ahead of the audio clock

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
// Am, F, Dm, E (the E major chord's G# gives the harmonic-minor bite).
const CHORDS = [
  [57, 60, 64], // A C E
  [53, 57, 60], // F A C
  [50, 53, 57], // D F A
  [52, 56, 59], // E G# B
];
const BELLS = [69, 72, 74, 76, 79, 81]; // A minor pentatonic, up high

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
    this.out.connect(sfx.bus); // through the reverb; sfx.master handles muting
    this.layers = {};
    for (const name of ['explore', 'combat', 'boss']) {
      const g = c.createGain();
      g.gain.value = 0.0001;
      g.connect(this.out);
      this.layers[name] = g;
    }
    this.next = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 60);
    this.apply(2.5);
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
      if (s === 0) {
        // a slow pad: root low, then third and fifth
        sfx.tone(t, { type: 'triangle', freq: midi(chord[0] - 12), dur: bar * 1.15, gain: 0.07, attack: 0.9, lowpass: 700, out: L.explore });
        for (const n of chord.slice(1)) {
          sfx.tone(t + 0.05, { type: 'triangle', freq: midi(n), dur: bar * 1.1, gain: 0.025, attack: 1.2, lowpass: 1100, out: L.explore });
        }
      }
      // stray bell notes, never two in a row
      if (s % 2 === 0 && rnd() < 0.09 && this.lastBell !== step - 2) {
        this.lastBell = step;
        const n = BELLS[Math.floor(rnd() * BELLS.length)];
        sfx.tone(t, { type: 'sine', freq: midi(n), dur: 2.4, gain: 0.03, attack: 0.005, out: L.explore });
        sfx.tone(t, { type: 'sine', freq: midi(n) * 2.76, dur: 0.6, gain: 0.006, attack: 0.002, out: L.explore }); // bell partial
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
      // strings: a held fifth that swells through the bar
      if (s === 0) {
        for (const [n, d] of [[chord[0], 1], [chord[0] + 7, 1.004]]) {
          sfx.tone(t, { type: 'sawtooth', freq: midi(n) * d, dur: bar * 1.05, gain: 0.018, attack: bar * 0.7, lowpass: 1500, out: L.combat });
        }
      }
    }

    if (this.audible('boss')) {
      // brass swell on the low root every other bar
      if (s === 0 && step % 32 === 0) {
        for (const d of [1, 1.006]) {
          sfx.tone(t, { type: 'sawtooth', freq: midi(chord[0] - 24) * d, dur: bar * 1.8, gain: 0.05, attack: 0.5, lowpass: 600, out: L.boss });
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
