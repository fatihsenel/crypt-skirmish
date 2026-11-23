// Synthesized character voices: short made-up barks, no audio files.
//
// A voice is a buzz (sawtooth at the speaker's pitch) sent through three resonant filters
// tuned to a vowel's formants, the way a mouth shapes the sound of the vocal cords, plus
// breath and consonant bursts made of filtered noise. Each speaker has a profile: pitch,
// mouth size (scales the formants: small = bright, big = dark), rasp (a growl wobble),
// breathiness and speed. Lines are strings of syllables like 'hrah' or 'ka-sei-tor'.
//
// Everything goes through sfx's reverb bus, so the sound toggle mutes voices too.

import { sfx } from './sfx.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Formant frequencies (Hz) of each vowel for an average adult voice. */
const VOWELS = {
  a: [780, 1180, 2700],
  e: [520, 1800, 2500],
  i: [300, 2250, 2950],
  o: [470, 840, 2600],
  u: [330, 720, 2400],
};

/**
 * Speaker profiles. f0: pitch in Hz. size: formant scale (>1 a smaller, brighter mouth).
 * rasp: growl depth 0..1. breath: noise mixed into the voice. speed: syllable rate.
 */
const PROFILES = {
  F: { f0: 102, size: 0.88, rasp: 0.45, breath: 0.12, speed: 1 },     // the fighter: gruff, low
  P: { f0: 118, size: 0.9, rasp: 0.12, breath: 0.1, speed: 0.95 },    // the paladin: clear, ringing
  W: { f0: 212, size: 1.16, rasp: 0, breath: 0.22, speed: 1.15 },     // the wizard: crisp, quick
  R: { f0: 182, size: 1.1, rasp: 0.05, breath: 0.35, speed: 1.3 },    // the rogue: breathy, fast
  A: { f0: 150, size: 1.02, rasp: 0.1, breath: 0.3, speed: 1.1 },     // the ranger: low and even
  C: { f0: 196, size: 1.12, rasp: 0, breath: 0.18, speed: 1 },        // the cleric: warm
  B: { f0: 220, size: 1.1, rasp: 0, breath: 0.12, speed: 1.2 },       // the bard: bright and quick
  Z: { f0: 96, size: 0.86, rasp: 0.6, breath: 0.15, speed: 1.05 },    // the barbarian: a roar
  S: { f0: 204, size: 1.14, rasp: 0.04, breath: 0.16, speed: 1.1 },   // the sorcerer: proud, clear
  M: { f0: 140, size: 1, rasp: 0, breath: 0.4, speed: 0.85 },         // the monk: soft and slow
  D: { f0: 178, size: 1.06, rasp: 0.08, breath: 0.28, speed: 0.95 },  // the druid: earthy
  g: { f0: 330, size: 1.38, rasp: 0.15, breath: 0.15, speed: 1.7 },   // goblins: high, nasal chatter
  b: { f0: 228, size: 1.25, rasp: 0.4, breath: 0.15, speed: 1.4 },    // Grukk: a bigger goblin
  o: { f0: 84, size: 0.78, rasp: 0.9, breath: 0.2, speed: 0.85 },     // the orc: a growl
  n: { f0: 92, size: 0.9, rasp: 0.35, breath: 0.55, speed: 0.75 },    // the necromancer: a whispered chant
  v: { f0: 66, size: 0.7, rasp: 1, breath: 0.25, speed: 0.8 },        // Tharok: a bull's bellow
};

/** Every hero class says these; letters are syllables, '-' joins them into one line. */
const HERO_LINES = {
  attack: ['hah', 'hyah', 'hrah', 'tah', 'heh'],
  cast: ['ka-sei', 'vo-ra-tes', 'il-ka-nor', 'se-ta-ri', 'mo-ra-ka-te', 'ka-tor'],
  hurt: ['nuh', 'uh', 'agh', 'oof'],
  die: ['aaaoo'],
  turn: ['ha', 'mm-hm', 'ri-ight', 'o-kay'],
};

/** Monster lines, where they have their own voice (others keep sfx.voice). */
const MONSTER_LINES = {
  g: { attack: ['ki-ki-yah', 'yi-yi', 'kah-ki', 'nye-he-he'], hurt: ['eek', 'yi'] },
  b: { attack: ['grah-kah', 'gra-ka-ka', 'hrah'], hurt: ['agh', 'gruk'] },
  o: { attack: ['graah', 'hrooah', 'grah'], hurt: ['hrung', 'grah'] },
  n: { attack: ['heh-heh', 'ha'], cast: ['mor-va-thul', 'u-ma-ra-goth', 'se-ke-mor'], hurt: ['hah', 'agh'] },
  v: { attack: ['hrrooo', 'graah', 'hruh-hruh'], hurt: ['hrung', 'mrooh'] },
};

/**
 * Every bark goes through one gain stage so voices can sit at the level of the hit
 * sounds (formant filters are narrow, so the raw voice is quiet). One per audio
 * context, made on first use.
 */
const VOICE_LEVEL = 2.4;
const voiceBuses = new WeakMap();
function voiceBus() {
  let b = voiceBuses.get(sfx.ctx);
  if (!b) {
    b = sfx.ctx.createGain();
    b.gain.value = VOICE_LEVEL;
    b.connect(sfx.voiceLevel); // the voices level, then the reverb
    voiceBuses.set(sfx.ctx, b);
  }
  return b;
}

/** Consonants: how each starts a syllable. Returns the time the vowel starts. */
function consonant(t, ch, p) {
  const out = voiceBus();
  switch (ch) {
    case 'h': sfx.noise(t, { dur: 0.06, filter: 'bandpass', freq: 1400 * p.size, q: 0.7, gain: 0.07, attack: 0.01, out }); return t + 0.045;
    case 'k': case 'g': sfx.noise(t, { dur: 0.03, filter: 'bandpass', freq: 2200 * p.size, q: 2, gain: 0.16, out }); return t + 0.035;
    case 't': case 'd': sfx.noise(t, { dur: 0.022, filter: 'highpass', freq: 3800, gain: 0.12, out }); return t + 0.028;
    case 's': case 'z': sfx.noise(t, { dur: 0.09, filter: 'bandpass', freq: 6200, q: 3, gain: 0.1, attack: 0.015, out }); return t + 0.08;
    case 'v': case 'f': sfx.noise(t, { dur: 0.06, filter: 'highpass', freq: 3000, gain: 0.05, attack: 0.01, out }); return t + 0.05;
    case 'n': case 'm': case 'r': case 'l': case 'y': case 'w': return t; // voiced: they colour the vowel's attack instead
    default: return t;
  }
}

/** One voiced vowel through three formant filters. */
function vowel(t, p, { v, v2 = v, dur, f0, f1 = f0, gain = 1, glide = null, attack = 0.025, out = voiceBus() }) {
  const c = sfx.ctx;
  const g = c.createGain();
  const peak = 0.11 * gain;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(attack, dur * 0.4));
  g.gain.setValueAtTime(peak, t + Math.max(dur * 0.6, Math.min(attack, dur * 0.4)));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);

  // The source: a buzz at the pitch, a second one a hair off (a fuller, rougher voice), breath.
  const src = c.createGain();
  const oscs = [];
  for (const [detune, level] of [[0, 1], [p.rasp ? 14 : 5, 0.45]]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (glide) glide(o.frequency, t, dur);
    else o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const lg = c.createGain();
    lg.gain.value = level;
    o.connect(lg).connect(src);
    oscs.push(o);
  }
  // Rasp: a fast wobble on the loudness, like a growl or vocal fry.
  if (p.rasp) {
    const lfo = c.createOscillator();
    lfo.frequency.value = rand(28, 42);
    const depth = c.createGain();
    depth.gain.value = 0.5 * p.rasp;
    const wob = c.createGain();
    wob.gain.value = 1 - 0.5 * p.rasp;
    lfo.connect(depth).connect(wob.gain);
    src.connect(wob);
    oscs.push(lfo);
    routeFormants(wob);
  } else {
    routeFormants(src);
  }
  if (p.breath) {
    const b = c.createBufferSource();
    b.buffer = sfx.noiseBuf;
    b.loop = true;
    const bg = c.createGain();
    bg.gain.value = p.breath * 0.6;
    b.connect(bg);
    routeFormants(bg);
    b.start(t, Math.random());
    b.stop(t + dur + 0.05);
  }
  for (const o of oscs) {
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function routeFormants(node) {
    const from = VOWELS[v];
    const to = VOWELS[v2];
    from.forEach((f, i) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      const hz = f * p.size;
      bp.frequency.setValueAtTime(hz, t);
      if (v2 !== v) bp.frequency.linearRampToValueAtTime(to[i] * p.size, t + dur * 0.8);
      bp.Q.value = hz / (70 + 40 * i); // narrower bands sound more like a voice
      const fg = c.createGain();
      fg.gain.value = [1, 0.55, 0.22][i] * (i === 0 ? 1 : 1.6); // upper formants are quieter but carry the vowel
      node.connect(bp).connect(fg).connect(g);
    });
  }
}

/**
 * Say a line like 'ka-sei' or 'hrah' in profile `p`. `shape` sets the pitch:
 * 'shout' falls, 'ask' rises, 'flat' stays, 'fall' sinks a long way (a dying cry).
 */
function say(t, p, line, shape = 'shout', loud = 1) {
  const syllables = line.split('-');
  const len = (s) => (s.match(/[aeiou]/g)?.length ?? 1);
  let at = t;
  syllables.forEach((s, i) => {
    const last = i === syllables.length - 1;
    const onset = s.match(/^[^aeiou]+/)?.[0] ?? '';
    const vowels = s.match(/[aeiou]+/)?.[0] ?? 'a';
    for (const ch of onset) at = consonant(at, ch, p);
    // A drawn-out vowel ('aaaoo') glides from its first letter to its last.
    const dur = (shape === 'fall' ? 0.9 : 0.1 + 0.05 * len(s)) / p.speed;
    const base = p.f0 * rand(0.96, 1.04) * (1 + (shape === 'ask' ? 0.06 * i : -0.03 * i));
    const [f0, f1] = {
      shout: [base * 1.25, base * (last ? 0.82 : 1.05)],
      ask: [base, base * (last ? 1.3 : 1.05)],
      flat: [base, base * 0.97],
      fall: [base * 1.3, base * 0.55],
    }[shape];
    vowel(at, p, { v: vowels[0], v2: vowels.at(-1), dur, f0, f1, gain: 2.2 * loud }); // vowels lose most to the filters
    at += dur * 0.92;
    // a final consonant ('ngh', 'hss'): a short tail of breath
    if (last && /[a-z]$/.test(s) && !/[aeiou]$/.test(s)) consonant(at, s.at(-1), p);
  });
  return at - t;
}

// --- monsters with voices that aren't speech ------------------------------------

/** A specter's moan: a hollow, wavering "oooOOOooo". */
function moan(t, len = 1, pitch = 1) {
  const p = { f0: 0, size: 1, rasp: 0, breath: 0.6, speed: 1 };
  const dur = 1.1 * len;
  vowel(t, p, {
    v: 'u', v2: 'o', dur, f0: 240 * pitch, gain: 1.6,
    glide: (freq, at, d) => {
      freq.setValueAtTime(240 * pitch, at);
      freq.linearRampToValueAtTime(330 * pitch, at + d * 0.45);
      freq.linearRampToValueAtTime(210 * pitch, at + d);
    },
  });
  // a second voice a little apart: a choir of one
  vowel(t + 0.08, p, { v: 'o', v2: 'u', dur: dur * 0.95, f0: 238 * pitch * 1.5, f1: 200 * pitch * 1.5, gain: 0.6 });
}

/** Ysolde's wail: a high, sliding keen with a tremble, and a ghostly octave under it. */
function wail(t, len = 1, falling = false) {
  const p = { f0: 0, size: 1.2, rasp: 0, breath: 0.25, speed: 1 };
  const dur = 1.3 * len;
  const top = rand(820, 900);
  const glide = (freq, at, d) => {
    freq.setValueAtTime(falling ? top : top * 0.6, at);
    if (falling) {
      freq.exponentialRampToValueAtTime(top * 1.1, at + d * 0.15);
      freq.exponentialRampToValueAtTime(top * 0.3, at + d);
    } else {
      freq.exponentialRampToValueAtTime(top, at + d * 0.35);
      freq.setValueAtTime(top, at + d * 0.55);
      freq.exponentialRampToValueAtTime(top * 0.7, at + d);
    }
  };
  vowel(t, p, { v: 'a', v2: 'i', dur, f0: top, gain: 0.55, glide });
  vowel(t, p, { v: 'o', v2: 'u', dur, f0: top / 2, gain: 0.3, glide: (freq, at, d) => glide(freq, at, d) });
  // the tremble: a quick shimmer of breath on top
  sfx.noise(t, { dur, filter: 'bandpass', freq: 3200, q: 4, gain: 0.05, attack: dur * 0.3, out: voiceBus() });
}

/** A giant spider: a dry hiss and a burst of mandible clicks. */
function chitter(t, len = 1) {
  sfx.noise(t, { dur: 0.35 * len, filter: 'bandpass', freq: 5200, freqEnd: 3800, q: 2, gain: 0.16, attack: 0.02, out: voiceBus() });
  for (let i = 0; i < 7 * len; i++) sfx.click(t + 0.03 * i + rand(0, 0.015), rand(2200, 3400), 0.12);
}

/** A skeleton: a clack of the jaw and a hollow, voiceless breath through the ribs. */
function rattle(t, len = 1) {
  for (let i = 0; i < 3; i++) sfx.click(t + i * 0.05, rand(900, 1500), 0.35);
  sfx.noise(t + 0.05, { dur: 0.4 * len, filter: 'bandpass', freq: 480, freqEnd: 360, q: 3, gain: 0.3, attack: 0.08, out: voiceBus() });
  sfx.noise(t + 0.05, { dur: 0.4 * len, filter: 'bandpass', freq: 900, freqEnd: 700, q: 4, gain: 0.15, attack: 0.08, out: voiceBus() });
}

// --- who says what --------------------------------------------------------------

const ACTIONS = new Set(['attack', 'cast', 'hurt', 'die', 'turn']);

/** Which voice a unit uses: its class for heroes, its monster code otherwise. */
function voiceOf(unit) {
  if (unit.name?.startsWith('Risen')) return 's';
  return unit.code;
}

class Voices {
  constructor() {
    this.busyUntil = 0;  // the end of the line being spoken, so barks don't pile up
    this.last = new Map(); // unit id -> when it last spoke
  }

  /**
   * A unit speaks: kind is 'attack', 'cast', 'hurt', 'die' or 'turn'. Hurt and turn barks
   * are skipped while someone else is talking; a unit never repeats itself within a second.
   * Returns true if it said something (callers may skip their own monster sound then).
   */
  bark(unit, kind) {
    if (!sfx.ready || sfx.muted || !ACTIONS.has(kind) || !unit) return false;
    const now = sfx.ctx.currentTime;
    const minor = kind === 'hurt' || kind === 'turn';
    if (minor && now < this.busyUntil) return false;
    if (kind !== 'die' && now - (this.last.get(unit.id) ?? -9) < 1) return false;
    const len = this.speak(voiceOf(unit), unit.team === 'heroes', kind, now + 0.02);
    if (len == null) return false;
    this.last.set(unit.id, now);
    this.busyUntil = Math.max(this.busyUntil, now + len);
    return true;
  }

  /** Schedule the sound; returns its length in seconds, or null if this unit has nothing to say. */
  speak(code, hero, kind, t) {
    if (hero) {
      const p = PROFILES[code] ?? PROFILES.F;
      if (kind === 'turn' && Math.random() > 0.35) return null; // now and then, not every turn
      const line = pick(HERO_LINES[kind]);
      const shape = { attack: 'shout', cast: 'flat', hurt: 'shout', die: 'fall', turn: 'ask' }[kind];
      const loud = { attack: 1, cast: 0.75, hurt: 0.9, die: 1, turn: 0.55 }[kind];
      return say(t, p, line, shape, loud);
    }
    switch (code) {
      case 'e': // specters
        if (kind === 'turn' || kind === 'cast') return null;
        moan(t, kind === 'die' ? 1.6 : kind === 'hurt' ? 0.6 : 1, kind === 'hurt' ? 1.25 : kind === 'die' ? 0.8 : 1);
        return 1.1;
      case 'q': // Ysolde
        if (kind === 'turn') return null;
        wail(t, kind === 'die' ? 2 : kind === 'hurt' ? 0.5 : kind === 'cast' ? 1.2 : 0.9, kind === 'die');
        return 1.2;
      case 'k': // giant spiders
        if (kind === 'turn' || kind === 'cast') return null;
        chitter(t, kind === 'die' ? 1.6 : kind === 'hurt' ? 0.7 : 1);
        return 0.4;
      case 's': // skeletons and the risen dead
        if (kind !== 'attack') return null;
        rattle(t);
        return 0.45;
      default: {
        const lines = MONSTER_LINES[code]?.[kind];
        if (!lines) return null;
        return say(t, PROFILES[code], pick(lines), kind === 'cast' ? 'flat' : 'shout', 0.85);
      }
    }
  }
}

export const voices = new Voices();
