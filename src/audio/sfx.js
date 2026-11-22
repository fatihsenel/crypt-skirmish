// Procedural sound effects with the Web Audio API — no audio files needed.
// Every sound is built from two primitives: filtered noise bursts and
// oscillator tones with exponential envelopes, run through a small reverb
// so it sounds like a stone crypt.
//
// Browsers only allow audio after a user gesture, so call sfx.unlock() from
// the first click / key press. Until then every play call is a silent no-op.

import { loadSettings, levelGain } from '../game/settings.js';

const STORAGE_KEY = 'crypt-skirmish:muted';
const rand = (a, b) => a + Math.random() * (b - a);
/** Monsters that borrow another's voice: the ghast and the ghosts hiss like ghouls, spiders like rats. */
const SOUND_ALIAS = { h: 'u', e: 'u', q: 'u', k: 'r', y: 'u', t: 'u', x: 'w', l: 'w' };

function loadMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = loadMuted();
    this.volume = 0.7;
    /** Each kind of sound's own level (0..1), under the mute switch: see setLevel. */
    this.levels = (({ music, effects, voices }) => ({ music, effects, voices }))(loadSettings());
    this.ambientOn = false;
    this.woke = false; // the first-tap toll has played
  }

  // --- setup ----------------------------------------------------------------
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      // On an iPhone, Web Audio is "ambient" by default: the silent switch mutes it. As playback
      // it sounds like a video's would (Safari 17+; elsewhere navigator.audioSession is absent).
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* keep the default */ }
      const c = (this.ctx = new Ctx());
      // Silent in the background (another tab or app, a locked screen), back on return. If the
      // browser won't resume without a tap (Safari), the next tap does it (main.js).
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          if (c.state !== 'running') return;
          this.away = true;
          c.suspend().catch(() => {});
        } else if (this.away) {
          this.away = false;
          c.resume().catch(() => {});
        }
      });

      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);

      // Effects go dry + through a generated "stone room" reverb.
      this.bus = c.createGain();
      this.bus.connect(this.master);
      const verb = c.createConvolver();
      verb.buffer = this.makeImpulse(1.9, 2.8);
      const wet = c.createGain();
      wet.gain.value = 0.28;
      this.bus.connect(verb).connect(wet).connect(this.master);

      // One level stage per kind of sound: effects (and the ambience, kept dry), music, voices.
      const stage = (kind, to) => {
        const g = c.createGain();
        g.gain.value = levelGain(this.levels[kind]);
        g.connect(to);
        return g;
      };
      this.fx = stage('effects', this.bus);
      this.ambLevel = stage('effects', this.master);
      this.musicLevel = stage('music', this.bus);
      this.voiceLevel = stage('voices', this.bus);

      this.noiseBuf = this.makeNoise(2);
    }
    // 'interrupted' is Safari's after a call or the app going to the background.
    // Called from a gesture: wake it, with a silent blip started inside the gesture itself
    // (some iPhones only wake for that, even when the context says it's running).
    // The first time it runs, a low toll answers the tap: the music and the hum fade in, so
    // without it a first tap seems to do nothing.
    this.ctx.resume().then(() => {
      if (this.woke || !this.ready) return;
      this.woke = true;
      this.wake();
    }, () => {});
    const blip = this.ctx.createBufferSource();
    blip.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    blip.connect(this.ctx.destination);
    blip.start();
    this.startAmbient();
  }

  get ready() {
    return this.ctx && this.ctx.state === 'running';
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable: setting just won't persist */
    }
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, t, 0.05);
    }
  }

  /** Set one kind of sound's level: 'music', 'effects' or 'voices', 0..1. */
  setLevel(kind, value) {
    this.levels[kind] = value;
    if (!this.ctx) return;
    const nodes = { effects: [this.fx, this.ambLevel], music: [this.musicLevel], voices: [this.voiceLevel] }[kind];
    const t = this.ctx.currentTime;
    for (const n of nodes ?? []) {
      n.gain.cancelScheduledValues(t);
      n.gain.setTargetAtTime(levelGain(value), t, 0.03);
    }
  }

  makeNoise(seconds) {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds, decay) {
    const c = this.ctx;
    const len = c.sampleRate * seconds;
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // --- primitives -----------------------------------------------------------
  env(t, gain, attack, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  noise(t, { dur = 0.2, filter = 'bandpass', freq = 1000, freqEnd, q = 1, gain = 0.4, attack = 0.004, out } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    src.connect(f).connect(this.env(t, gain, attack, dur)).connect(out || this.fx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone(t, { type = 'sine', freq = 440, freqEnd, dur = 0.2, gain = 0.2, attack = 0.004, lowpass, out } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    let node = o;
    if (lowpass) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = o.connect(f);
    }
    node.connect(this.env(t, gain, attack, dur)).connect(out || this.fx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  click(t, freq = 3000, gain = 0.15) {
    this.noise(t, { dur: 0.025, filter: 'bandpass', freq, q: 4, gain });
  }

  /** Run fn(t) only if audio is unlocked; t = now + delay seconds. */
  play(fn, delay = 0) {
    if (!this.ready || this.muted) return;
    fn(this.ctx.currentTime + delay);
  }

  // --- movement -------------------------------------------------------------
  step(code) {
    code = SOUND_ALIAS[code] ?? code; // a ghast sounds like a ghoul, a spider like a rat
    if (code === 'P') code = 'F'; // a paladin clanks like a fighter
    this.play((t) => {
      if (code === 'F' || code === 'C') {
        this.noise(t, { dur: 0.09, filter: 'lowpass', freq: 380, gain: 0.35 });
        this.tone(t + 0.01, { type: 'triangle', freq: rand(2200, 2800), dur: 0.06, gain: 0.025 }); // armor clink
        if (code === 'C') this.noise(t + 0.02, { dur: 0.06, filter: 'highpass', freq: 5000, gain: 0.05 }); // chain mail
      } else if (code === 's') {
        this.click(t, rand(2200, 3200), 0.18);
        this.click(t + 0.035, rand(1500, 2500), 0.12);
      } else if (code === 'g' || code === 'b') {
        this.noise(t, { dur: 0.05, filter: 'bandpass', freq: rand(700, 1000), q: 1.5, gain: 0.18 });
      } else if (code === 'o') {
        this.tone(t, { type: 'sine', freq: 70, freqEnd: 40, dur: 0.15, gain: 0.45 }); // heavy stomp
        this.noise(t, { dur: 0.1, filter: 'lowpass', freq: 300, gain: 0.4 });
      } else if (code === 'r') {
        for (let i = 0; i < 3; i++) this.click(t + i * 0.03, rand(3500, 5500), 0.06); // claws skitter
      } else if (code === 'u') {
        this.noise(t, { dur: 0.16, filter: 'bandpass', freq: rand(350, 500), q: 1.2, gain: 0.16, attack: 0.04 }); // a dragging shuffle
      } else if (code === 'w') {
        this.noise(t, { dur: 0.09, filter: 'lowpass', freq: 380, gain: 0.35 });
        this.noise(t + 0.01, { dur: 0.08, filter: 'highpass', freq: 4500, gain: 0.07 }); // rusted mail
      } else if (code === 'm') {
        this.tone(t, { type: 'sine', freq: 85, freqEnd: 50, dur: 0.14, gain: 0.35 }); // a heavy, wet hop
        this.noise(t, { dur: 0.12, filter: 'lowpass', freq: 500, gain: 0.25 });
      } else if (code === 'R') {
        this.noise(t, { dur: 0.05, filter: 'lowpass', freq: 500, gain: 0.07 }); // barely a sound
      } else {
        this.noise(t, { dur: 0.08, filter: 'lowpass', freq: 600, gain: 0.14 }); // soft robe/boots
      }
    });
  }

  // --- attacks --------------------------------------------------------------
  whoosh(heavy = false) {
    this.play((t) => {
      this.noise(t, {
        dur: heavy ? 0.3 : 0.2,
        filter: 'bandpass',
        freq: heavy ? 250 : 500,
        freqEnd: heavy ? 1400 : 2600,
        q: 1.8,
        gain: heavy ? 0.4 : 0.32,
        attack: 0.06,
      });
    });
  }

  bow() {
    this.play((t) => {
      this.noise(t, { dur: 0.02, filter: 'highpass', freq: 2500, gain: 0.25 });
      this.tone(t, { type: 'triangle', freq: 210, freqEnd: 170, dur: 0.28, gain: 0.22 });
      this.tone(t, { type: 'sine', freq: 420, freqEnd: 340, dur: 0.15, gain: 0.08 });
      this.noise(t + 0.03, { dur: 0.3, filter: 'bandpass', freq: 3200, freqEnd: 1600, q: 3, gain: 0.07 }); // arrow whistle
    });
  }

  cast() {
    this.play((t) => {
      this.noise(t, { dur: 0.45, filter: 'bandpass', freq: 250, freqEnd: 3000, q: 1.2, gain: 0.3, attack: 0.15 });
      this.tone(t, { type: 'sawtooth', freq: 180, freqEnd: 720, dur: 0.4, gain: 0.07, attack: 0.1, lowpass: 1600 });
      for (let i = 0; i < 6; i++) this.click(t + 0.1 + Math.random() * 0.3, rand(1500, 4000), 0.06); // crackle
    });
  }

  fireImpact() {
    this.play((t) => {
      this.noise(t, { dur: 0.6, filter: 'lowpass', freq: 2400, freqEnd: 180, gain: 0.6 });
      this.tone(t, { type: 'sine', freq: 95, freqEnd: 38, dur: 0.4, gain: 0.55 });
      for (let i = 0; i < 10; i++) this.click(t + 0.05 + Math.random() * 0.6, rand(1200, 4500), rand(0.04, 0.1));
    });
  }

  /** Sound of a blow landing; depends on what got hit. */
  hit(targetCode, { crit = false, fire = false } = {}) {
    targetCode = SOUND_ALIAS[targetCode] ?? targetCode;
    if (targetCode === 'P') targetCode = 'F';
    if (fire) this.fireImpact();
    this.play((t) => {
      if (!fire) {
        if (targetCode === 'F') {
          // steel on plate: inharmonic ringing partials
          for (const [f, g] of [[520, 0.09], [1310, 0.06], [2150, 0.05], [3460, 0.035]]) {
            this.tone(t, { type: 'sine', freq: f * rand(0.97, 1.03), dur: 0.5, gain: g, attack: 0.002 });
          }
          this.noise(t, { dur: 0.04, filter: 'highpass', freq: 3000, gain: 0.3 });
        } else if (targetCode === 'C') {
          this.noise(t, { dur: 0.18, filter: 'highpass', freq: 4000, gain: 0.25 }); // chain mail rattle
        } else if (targetCode === 'r') {
          this.squeakNow(t, 0.7);
        } else if (targetCode === 's') {
          for (let i = 0; i < 6; i++) this.click(t + Math.random() * 0.14, rand(1800, 3600), 0.2); // bones clatter
        } else if (targetCode === 'u') {
          this.hissNow(t, 0.5);
        } else if (targetCode === 'w') {
          for (const [f, g] of [[380, 0.07], [960, 0.05], [1720, 0.03]]) {
            this.tone(t, { type: 'sine', freq: f * rand(0.97, 1.03), dur: 0.35, gain: g, attack: 0.002 }); // dull, rusted mail
          }
          this.groanNow(t + 0.05, 0.5);
        } else if (targetCode === 'm') {
          this.noise(t, { dur: 0.1, filter: 'highpass', freq: 1800, gain: 0.12 });
          this.click(t + 0.02, 600, 0.2); // splintering lid
        } else if (targetCode === 'o') {
          this.tone(t, { type: 'sawtooth', freq: 130, freqEnd: 95, dur: 0.22, gain: 0.12, lowpass: 800 }); // a grunt
        }
        // body thud underneath everything
        this.tone(t, { type: 'sine', freq: 150, freqEnd: 55, dur: 0.2, gain: 0.5 });
        this.noise(t, { dur: 0.12, filter: 'lowpass', freq: 900, gain: 0.35 });
      }
      if (crit) {
        this.tone(t, { type: 'sine', freq: 70, freqEnd: 35, dur: 0.5, gain: 0.5 });
        this.tone(t + 0.05, { type: 'triangle', freq: 1320, dur: 0.6, gain: 0.05 });
        this.tone(t + 0.05, { type: 'triangle', freq: 1980, dur: 0.6, gain: 0.035 });
      }
    });
  }

  miss() {
    this.play((t) => {
      this.noise(t, { dur: 0.16, filter: 'bandpass', freq: 2200, freqEnd: 900, q: 2, gain: 0.12, attack: 0.03 });
      this.click(t + 0.12, 1200, 0.08); // glances off the floor
    });
  }

  death(code) {
    code = SOUND_ALIAS[code] ?? code; // a ghast sounds like a ghoul, a spider like a rat
    if (code === 'P') code = 'F'; // a paladin clanks like a fighter
    this.play((t) => {
      if (code === 'g' || code === 'b') {
        this.tone(t, { type: 'sawtooth', freq: code === 'b' ? 520 : 820, freqEnd: 180, dur: 0.5, gain: 0.12, lowpass: 2200 }); // squeal
      } else if (code === 'r') {
        this.squeakNow(t, 1.4);
      } else if (code === 'o') {
        this.tone(t, { type: 'sawtooth', freq: 160, freqEnd: 60, dur: 0.9, gain: 0.16, lowpass: 700 }); // dying groan
      } else if (code === 'n') {
        this.tone(t, { type: 'sawtooth', freq: 300, freqEnd: 80, dur: 1.4, gain: 0.1, lowpass: 1200 });
        this.noise(t, { dur: 1.4, filter: 'bandpass', freq: 600, freqEnd: 120, q: 1, gain: 0.25, attack: 0.2 }); // the soul escapes
      } else if (code === 's') {
        for (let i = 0; i < 16; i++) this.click(t + 0.1 + Math.random() * 0.6, rand(1500, 3800), rand(0.08, 0.2));
      } else if (code === 'u') {
        this.hissNow(t, 1.6);
        this.tone(t + 0.2, { type: 'sawtooth', freq: 140, freqEnd: 60, dur: 0.6, gain: 0.08, lowpass: 600 }); // a gurgle
      } else if (code === 'w') {
        this.groanNow(t, 2);
        this.noise(t + 0.3, { dur: 1.4, filter: 'bandpass', freq: 500, freqEnd: 100, q: 1, gain: 0.22, attack: 0.3 }); // crumbles to dust
      } else if (code === 'm') {
        for (let i = 0; i < 8; i++) this.click(t + Math.random() * 0.4, rand(400, 1200), rand(0.15, 0.3)); // the lid splits
        this.tone(t + 0.1, { type: 'sawtooth', freq: 90, freqEnd: 40, dur: 0.8, gain: 0.14, lowpass: 500 });
      } else {
        this.tone(t, { type: 'triangle', freq: 330, freqEnd: 120, dur: 0.7, gain: 0.12, lowpass: 900 });
      }
      // body hits the floor
      this.tone(t + 0.55, { type: 'sine', freq: 110, freqEnd: 45, dur: 0.3, gain: 0.5 });
      this.noise(t + 0.55, { dur: 0.2, filter: 'lowpass', freq: 600, gain: 0.35 });
    });
  }

  /** A monster's cry as it attacks: rat squeak, ghoul hiss, wight groan, mimic chomp, orc grunt. */
  voice(code) {
    code = SOUND_ALIAS[code] ?? code; // a ghast sounds like a ghoul, a spider like a rat
    if (code === 'P') code = 'F'; // a paladin clanks like a fighter
    this.play((t) => {
      if (code === 'r') this.squeakNow(t, 1);
      else if (code === 'u') this.hissNow(t, 1);
      else if (code === 'w') this.groanNow(t, 1);
      else if (code === 'o') this.tone(t, { type: 'sawtooth', freq: 120, freqEnd: 150, dur: 0.3, gain: 0.12, attack: 0.03, lowpass: 900 });
      else if (code === 'm') {
        // jaws gape (a creak) and slam shut (two wet clacks)
        this.tone(t, { type: 'sawtooth', freq: 70, freqEnd: 110, dur: 0.25, gain: 0.08, lowpass: 700 });
        for (const d of [0.26, 0.31]) {
          this.click(t + d, rand(500, 800), 0.35);
          this.noise(t + d, { dur: 0.08, filter: 'lowpass', freq: 900, gain: 0.3 });
        }
      }
    });
  }

  /** Ghoul hiss: breathy noise through a narrow band, falling. */
  hissNow(t, len = 1) {
    this.noise(t, { dur: 0.45 * len, filter: 'bandpass', freq: 4200, freqEnd: 2600, q: 2.5, gain: 0.22, attack: 0.03 });
    this.noise(t, { dur: 0.3 * len, filter: 'highpass', freq: 6000, gain: 0.06, attack: 0.02 });
  }

  /** Wight groan: two low, detuned voices sliding down. */
  groanNow(t, len = 1) {
    this.tone(t, { type: 'sawtooth', freq: 105, freqEnd: 75, dur: 0.6 * len, gain: 0.12, attack: 0.08, lowpass: 650 });
    this.tone(t, { type: 'sawtooth', freq: 111, freqEnd: 78, dur: 0.6 * len, gain: 0.09, attack: 0.08, lowpass: 650 });
    this.noise(t, { dur: 0.5 * len, filter: 'bandpass', freq: 420, q: 2, gain: 0.12, attack: 0.1 });
  }

  /** Rat squeak (attacks, hits, deaths). */
  squeak() {
    this.play((t) => this.squeakNow(t, 1));
  }

  squeakNow(t, len = 1) {
    this.tone(t, { type: 'square', freq: rand(2600, 3400), freqEnd: rand(1800, 2400), dur: 0.09 * len, gain: 0.045, lowpass: 5000 });
    this.tone(t + 0.1 * len, { type: 'square', freq: rand(2800, 3600), freqEnd: rand(1500, 2000), dur: 0.12 * len, gain: 0.04, lowpass: 5000 });
  }

  /** Orc war cry (Aggressive). */
  roar() {
    this.play((t) => {
      this.tone(t, { type: 'sawtooth', freq: 110, freqEnd: 150, dur: 0.7, gain: 0.2, attack: 0.08, lowpass: 900 });
      this.tone(t, { type: 'sawtooth', freq: 165, freqEnd: 210, dur: 0.7, gain: 0.1, attack: 0.08, lowpass: 900 });
      this.noise(t, { dur: 0.7, filter: 'bandpass', freq: 500, q: 1.5, gain: 0.3, attack: 0.08 });
    });
  }

  // --- spells & abilities -----------------------------------------------------
  /** Chill Touch: a hollow, ghostly moan. */
  necro() {
    this.play((t) => {
      this.tone(t, { type: 'sine', freq: 220, freqEnd: 140, dur: 0.6, gain: 0.12, attack: 0.1 });
      this.tone(t, { type: 'sine', freq: 233, freqEnd: 147, dur: 0.6, gain: 0.1, attack: 0.1 }); // beating, eerie
      this.noise(t, { dur: 0.5, filter: 'bandpass', freq: 900, freqEnd: 300, q: 4, gain: 0.12, attack: 0.15 });
    });
  }

  /** Sacred Flame: a bright bell and a whoosh from above. */
  radiant() {
    this.play((t) => {
      [1047, 1319, 1568].forEach((f, i) => this.tone(t + i * 0.03, { type: 'sine', freq: f, dur: 0.9, gain: 0.06 }));
      this.noise(t, { dur: 0.5, filter: 'bandpass', freq: 3000, freqEnd: 500, q: 1, gain: 0.3, attack: 0.05 });
      this.tone(t + 0.15, { type: 'sine', freq: 120, freqEnd: 50, dur: 0.4, gain: 0.35 });
    });
  }

  /** Turn Undead: a choir-like chord swelling up. */
  turnUndead() {
    this.play((t) => {
      for (const f of [262, 330, 392, 523, 659]) {
        this.tone(t, { type: 'triangle', freq: f, dur: 1.4, gain: 0.05, attack: 0.3, lowpass: 2500 });
        this.tone(t, { type: 'triangle', freq: f * 1.004, dur: 1.4, gain: 0.04, attack: 0.3, lowpass: 2500 });
      }
      this.noise(t + 0.2, { dur: 0.9, filter: 'bandpass', freq: 2000, freqEnd: 6000, q: 2, gain: 0.08, attack: 0.3 });
    });
  }

  /** Animate Dead: a low rumble and bones knitting together. */
  raise() {
    this.play((t) => {
      this.tone(t, { type: 'sawtooth', freq: 55, freqEnd: 82, dur: 1.4, gain: 0.2, attack: 0.3, lowpass: 400 });
      this.noise(t, { dur: 1.2, filter: 'lowpass', freq: 200, freqEnd: 900, gain: 0.35, attack: 0.3 });
      for (let i = 0; i < 18; i++) this.click(t + 0.5 + Math.random() * 0.9, rand(1500, 3800), rand(0.06, 0.16));
    });
  }

  /** Potion: cork pop and a few gulps. */
  potion() {
    this.play((t) => {
      this.tone(t, { type: 'sine', freq: 500, freqEnd: 1400, dur: 0.06, gain: 0.25 }); // pop
      for (let i = 0; i < 3; i++) this.tone(t + 0.25 + i * 0.22, { type: 'sine', freq: 180, freqEnd: 110, dur: 0.12, gain: 0.3 });
    });
    this.heal();
  }

  // --- the dungeon ------------------------------------------------------------
  /** A heavy wooden door creaking open. */
  door() {
    this.play((t) => {
      this.click(t, 900, 0.25); // latch
      this.tone(t + 0.08, { type: 'sawtooth', freq: 190, freqEnd: 330, dur: 0.6, gain: 0.05, attack: 0.1, lowpass: 1400 });
      this.tone(t + 0.3, { type: 'sawtooth', freq: 300, freqEnd: 240, dur: 0.4, gain: 0.04, attack: 0.05, lowpass: 1600 });
      this.tone(t + 0.75, { type: 'sine', freq: 90, freqEnd: 45, dur: 0.3, gain: 0.3 }); // thud against the wall
    });
  }

  /** A lever thrown, the chain rattling, and the portcullis crashing down (or grinding up). */
  portcullis(down) {
    this.play((t) => {
      this.click(t, 600, 0.3); // the lever
      for (let i = 0; i < 6; i++) this.noise(t + 0.1 + i * 0.06, { dur: 0.04, filter: 'bandpass', freq: 2200 + i * 150, gain: 0.18 }); // chain
      if (down) {
        this.tone(t + 0.5, { type: 'sine', freq: 70, freqEnd: 35, dur: 0.45, gain: 0.45 }); // the bars hit the floor
        for (const [f, g] of [[620, 0.06], [1310, 0.04], [2090, 0.03]]) this.tone(t + 0.5, { type: 'triangle', freq: f, dur: 0.8, gain: g });
      } else {
        this.tone(t + 0.15, { type: 'sawtooth', freq: 110, freqEnd: 150, dur: 0.7, gain: 0.04, attack: 0.1, lowpass: 900 }); // grinding up
      }
    });
  }

  /** Spikes shooting out of the floor. */
  trap() {
    this.play((t) => {
      this.click(t, 1500, 0.3); // click of the plate
      this.noise(t + 0.08, { dur: 0.12, filter: 'highpass', freq: 2500, gain: 0.4 });
      for (const [f, g] of [[880, 0.06], [1870, 0.04], [2900, 0.03]]) {
        this.tone(t + 0.08, { type: 'sine', freq: f, dur: 0.35, gain: g });
      }
    });
  }

  /** A hidden trap is spotted. */
  discover() {
    this.play((t) => {
      this.tone(t, { type: 'triangle', freq: 784, dur: 0.18, gain: 0.07 });
      this.tone(t + 0.12, { type: 'triangle', freq: 1175, dur: 0.3, gain: 0.07 });
    });
  }

  /** A new monster for the bestiary: a soft, low bell and its answer, under the fight's noise. */
  bestiary() {
    this.play((t) => {
      this.tone(t, { type: 'sine', freq: 659, dur: 0.6, gain: 0.045, attack: 0.01 });
      this.tone(t, { type: 'sine', freq: 1318, dur: 0.35, gain: 0.015, attack: 0.01 });
      this.tone(t + 0.16, { type: 'sine', freq: 988, dur: 0.8, gain: 0.04, attack: 0.01 });
    }, 0.25);
  }

  /** An elite comes into view: a low horn-like swell under a bright gold ring. */
  elite() {
    this.play((t) => {
      this.tone(t, { type: 'sawtooth', freq: 147, dur: 0.7, gain: 0.05, attack: 0.06, lowpass: 900 });
      this.tone(t + 0.18, { type: 'sawtooth', freq: 220, dur: 0.8, gain: 0.045, attack: 0.06, lowpass: 1100 });
      this.tone(t + 0.18, { type: 'triangle', freq: 1320, dur: 0.6, gain: 0.03 });
    }, 0.1);
  }

  /** Chest lid creaks open, coins and glass clink. */
  chest() {
    this.play((t) => {
      this.tone(t, { type: 'sawtooth', freq: 140, freqEnd: 260, dur: 0.4, gain: 0.05, attack: 0.05, lowpass: 1200 });
      for (let i = 0; i < 8; i++) {
        this.tone(t + 0.35 + i * rand(0.03, 0.07), { type: 'sine', freq: rand(2800, 4600), dur: 0.12, gain: 0.05 });
      }
    });
  }

  /** The way down opens up. */
  stairs() {
    this.play((t) => {
      [392, 523, 659].forEach((f, i) => this.tone(t + i * 0.18, { type: 'sine', freq: f, dur: 0.9, gain: 0.07, attack: 0.05 }));
    });
  }

  /** One Magic Missile dart: a bright descending zap. */
  missile(i = 0) {
    this.play((t) => {
      this.tone(t, { type: 'square', freq: 1400 + i * 180, freqEnd: 500, dur: 0.18, gain: 0.05, lowpass: 3500 });
      this.tone(t, { type: 'sine', freq: 2100 + i * 240, freqEnd: 900, dur: 0.22, gain: 0.06 });
    });
  }

  missileHit() {
    this.play((t) => {
      this.tone(t, { type: 'sine', freq: 600, freqEnd: 140, dur: 0.18, gain: 0.25 });
      this.noise(t, { dur: 0.08, filter: 'highpass', freq: 2500, gain: 0.15 });
    });
  }

  /** Burning Hands: a roaring gout of flame. */
  fireCone() {
    this.play((t) => {
      this.noise(t, { dur: 0.9, filter: 'lowpass', freq: 600, freqEnd: 3200, gain: 0.55, attack: 0.08 });
      this.noise(t + 0.05, { dur: 0.8, filter: 'bandpass', freq: 1200, freqEnd: 400, q: 0.8, gain: 0.3, attack: 0.1 });
      this.tone(t, { type: 'sine', freq: 80, freqEnd: 45, dur: 0.8, gain: 0.35, attack: 0.05 });
      for (let i = 0; i < 14; i++) this.click(t + 0.1 + Math.random() * 0.8, rand(1200, 4500), rand(0.04, 0.1));
    });
  }

  /** A brazier going over: an iron clang, then the coals' roar and sparks. */
  brazier() {
    this.play((t) => {
      this.tone(t, { type: 'triangle', freq: 340, freqEnd: 300, dur: 0.5, gain: 0.25, attack: 0.002 });
      this.tone(t, { type: 'square', freq: 523, freqEnd: 500, dur: 0.18, gain: 0.06, attack: 0.002 });
    });
    this.fireCone();
  }

  /** Lightning Bolt: a crackling crack and a rolling rumble. */
  thunder() {
    this.play((t) => {
      this.noise(t, { dur: 0.12, filter: 'highpass', freq: 2500, gain: 0.7, attack: 0.002 });
      for (let i = 0; i < 18; i++) this.click(t + Math.random() * 0.35, rand(2000, 7000), rand(0.06, 0.16));
      this.noise(t + 0.05, { dur: 1.3, filter: 'lowpass', freq: 900, freqEnd: 90, gain: 0.6, attack: 0.02 });
      this.tone(t + 0.04, { type: 'sine', freq: 60, freqEnd: 32, dur: 1.1, gain: 0.5 });
    });
  }

  /** Ice Storm's frost spreading: a dry crackle over a glassy shimmer. */
  freeze() {
    this.play((t) => {
      for (let i = 0; i < 24; i++) this.click(t + 0.15 + (i / 24) * 0.9 + Math.random() * 0.05, rand(3500, 8000), rand(0.03, 0.08));
      this.noise(t + 0.1, { dur: 1.1, filter: 'highpass', freq: 5000, freqEnd: 8000, gain: 0.08, attack: 0.3 });
      this.tone(t + 0.2, { type: 'sine', freq: 2093, dur: 0.9, gain: 0.025, attack: 0.2 });
      this.tone(t + 0.3, { type: 'sine', freq: 3136, dur: 0.8, gain: 0.015, attack: 0.2 });
    });
  }

  /** The frost thawing: a few soft drips. */
  thaw() {
    this.play((t) => {
      [0, 0.22, 0.5, 0.71].forEach((d, i) => {
        const f = [1400, 1150, 1650, 1250][i];
        this.tone(t + d, { type: 'sine', freq: f, freqEnd: f * 1.6, dur: 0.09, gain: 0.07, attack: 0.003 });
      });
      this.noise(t, { dur: 0.9, filter: 'lowpass', freq: 700, gain: 0.05, attack: 0.2 });
    });
  }

  /** Spiritual Weapon: a ringing chime as the spectral mace strikes. */
  chime() {
    this.play((t) => {
      this.tone(t, { type: 'triangle', freq: 1175, dur: 0.7, gain: 0.08, attack: 0.005 });
      this.tone(t + 0.02, { type: 'sine', freq: 1760, dur: 0.6, gain: 0.05 });
      this.tone(t, { type: 'sine', freq: 220, freqEnd: 140, dur: 0.18, gain: 0.25 });
    });
  }

  /** A bard's spell: a quick run of plucked strings, up for a gift, down for a jibe. */
  lute(up = true) {
    this.play((t) => {
      const notes = up ? [392, 494, 587, 784] : [622, 523, 415, 311];
      notes.forEach((f, i) => {
        this.tone(t + i * 0.07, { type: 'triangle', freq: f, dur: 0.5, gain: 0.07, attack: 0.003 });
        this.tone(t + i * 0.07, { type: 'sine', freq: f * 2, dur: 0.25, gain: 0.02, attack: 0.003 });
      });
    });
  }

  /** Shatter: a ringing crack. */
  shatter() {
    this.play((t) => {
      this.noise(t, { dur: 0.5, filter: 'highpass', freq: 2500, gain: 0.3, attack: 0.002 });
      for (const f of [1320, 1980, 2640]) this.tone(t, { type: 'sine', freq: f, freqEnd: f * 0.97, dur: 1.1, gain: 0.05, attack: 0.002 });
      this.tone(t, { type: 'sine', freq: 90, freqEnd: 50, dur: 0.4, gain: 0.3 });
    });
  }

  /** Fireball: a hiss as the bead flies. */
  fireballLaunch() {
    this.play((t) => {
      this.noise(t, { dur: 0.6, filter: 'bandpass', freq: 900, freqEnd: 2600, q: 1.5, gain: 0.25, attack: 0.05 });
      this.tone(t, { type: 'sawtooth', freq: 220, freqEnd: 520, dur: 0.5, gain: 0.05, lowpass: 1400 });
    });
  }

  /** Fireball: the blast. */
  explosion() {
    this.play((t) => {
      this.noise(t, { dur: 1.4, filter: 'lowpass', freq: 3200, freqEnd: 120, gain: 0.8, attack: 0.005 });
      this.tone(t, { type: 'sine', freq: 70, freqEnd: 28, dur: 1.1, gain: 0.7 });
      this.tone(t, { type: 'triangle', freq: 140, freqEnd: 40, dur: 0.6, gain: 0.3 });
      for (let i = 0; i < 22; i++) this.click(t + 0.1 + Math.random() * 1.1, rand(900, 4500), rand(0.04, 0.12));
    });
  }

  /** Level up fanfare. */
  levelUp() {
    this.play((t) => {
      [523, 659, 784, 1047].forEach((f, i) => {
        this.tone(t + i * 0.11, { type: 'triangle', freq: f, dur: 0.5, gain: 0.12, attack: 0.01 });
      });
      this.tone(t + 0.44, { type: 'sine', freq: 1568, dur: 0.8, gain: 0.06, attack: 0.02 });
    });
  }

  /** Misty Step: a shimmering vanish/appear. */
  teleport() {
    this.play((t) => {
      for (let i = 0; i < 5; i++) {
        this.tone(t + i * 0.05, { type: 'sine', freq: 880 * 2 ** (i / 4), dur: 0.5, gain: 0.05, attack: 0.03 });
      }
      this.noise(t, { dur: 0.5, filter: 'bandpass', freq: 4000, freqEnd: 900, q: 2, gain: 0.12, attack: 0.1 });
    });
  }

  /** Shield: a glassy ward snapping into place. */
  shield() {
    this.play((t) => {
      this.tone(t, { type: 'triangle', freq: 1760, dur: 0.6, gain: 0.08 });
      this.tone(t, { type: 'sine', freq: 2640, dur: 0.5, gain: 0.05 });
      this.tone(t, { type: 'sine', freq: 300, freqEnd: 600, dur: 0.15, gain: 0.2 });
      this.noise(t, { dur: 0.05, filter: 'highpass', freq: 5000, gain: 0.2 });
    });
  }

  heal() {
    this.play((t) => {
      [523, 659, 784].forEach((f, i) => this.tone(t + i * 0.08, { type: 'sine', freq: f, dur: 0.6, gain: 0.08, attack: 0.04 }));
      this.noise(t, { dur: 0.6, filter: 'bandpass', freq: 3000, q: 3, gain: 0.05, attack: 0.2 });
    });
  }

  /** Short sting when someone provokes an opportunity attack. */
  alert() {
    this.play((t) => {
      this.tone(t, { type: 'square', freq: 740, dur: 0.08, gain: 0.05, lowpass: 2500 });
      this.tone(t + 0.09, { type: 'square', freq: 990, dur: 0.12, gain: 0.05, lowpass: 2500 });
    });
  }

  /** Dash / Dodge / Disengage: a quick rustle and a breath. */
  maneuver() {
    this.play((t) => {
      this.noise(t, { dur: 0.25, filter: 'bandpass', freq: 600, freqEnd: 1800, q: 1.2, gain: 0.2, attack: 0.05 });
      this.tone(t, { type: 'sine', freq: 440, freqEnd: 660, dur: 0.15, gain: 0.04 });
    });
  }

  // --- game flow ------------------------------------------------------------
  dice() {
    this.play((t) => {
      let at = t;
      for (let i = 0; i < 7; i++) {
        at += rand(0.04, 0.11) * (1 + i * 0.15);
        this.click(at, rand(2500, 4200), 0.2 * (1 - i / 9));
      }
    });
  }

  turn() {
    this.play((t) => {
      this.tone(t, { type: 'sine', freq: 660, dur: 0.5, gain: 0.07 });
      this.tone(t + 0.09, { type: 'sine', freq: 990, dur: 0.6, gain: 0.06 });
    });
  }

  ui() {
    this.play((t) => this.click(t, 1800, 0.08));
  }

  /** The crypt waking: a low stone toll, the answer to the first tap. */
  wake() {
    this.play((t) => {
      this.tone(t, { type: 'sine', freq: 98, dur: 1.6, gain: 0.22, attack: 0.01 });
      this.tone(t, { type: 'sine', freq: 196.5, dur: 1.1, gain: 0.08, attack: 0.01 });
      this.noise(t, { dur: 0.12, filter: 'lowpass', freq: 500, gain: 0.18 });
    });
  }

  /** The title skull's moves, when it's clicked: gape, chatter, twitch, laugh, lunge, gutter. */
  skull(move) {
    this.play((t) => {
      if (move === 'gape') {
        // the jaw creaks open, then snaps shut
        this.tone(t, { type: 'sawtooth', freq: 58, freqEnd: 92, dur: 1.1, gain: 0.06, attack: 0.25, lowpass: 480 });
        this.noise(t, { dur: 1.1, filter: 'bandpass', freq: 320, freqEnd: 520, q: 9, gain: 0.12, attack: 0.3 });
        this.click(t + 1.95, 700, 0.3);
        this.noise(t + 1.95, { dur: 0.08, filter: 'lowpass', freq: 900, gain: 0.25 });
      } else if (move === 'chatter') {
        for (let i = 0; i < 13; i++) this.click(t + i * 0.075 + rand(0, 0.015), rand(1700, 2600), 0.2 * (1 - i / 16));
      } else if (move === 'twitch') {
        // a neck bone cracks
        this.click(t, 1300, 0.28);
        this.click(t + 0.05, 900, 0.2);
        this.noise(t, { dur: 0.06, filter: 'lowpass', freq: 700, gain: 0.2 });
      } else if (move === 'laugh') {
        // a dry, breathy cackle that falls away, with the teeth clacking under it
        for (let i = 0; i < 6; i++) {
          const at = t + i * 0.24;
          this.noise(at, { dur: 0.14, filter: 'bandpass', freq: 760 - i * 50, q: 3, gain: 0.2 - i * 0.02, attack: 0.02 });
          this.tone(at, { type: 'sawtooth', freq: 150 - i * 8, freqEnd: 120 - i * 8, dur: 0.14, gain: 0.05, attack: 0.02, lowpass: 900 });
          this.click(at + 0.1, rand(1800, 2400), 0.1);
        }
      } else if (move === 'lunge') {
        this.hissNow(t, 1.5);
        this.tone(t, { type: 'sine', freq: 95, freqEnd: 50, dur: 0.4, gain: 0.25 });
      } else if (move === 'gutter') {
        // the flame gasps low and sputters back
        this.noise(t, { dur: 0.45, filter: 'lowpass', freq: 900, freqEnd: 140, gain: 0.3, attack: 0.02 });
        for (let i = 0; i < 6; i++) this.click(t + 0.4 + Math.random() * 0.5, rand(300, 900), rand(0.06, 0.14));
      }
    });
  }

  victory() {
    this.play((t) => {
      [523, 659, 784, 1047].forEach((f, i) => {
        this.tone(t + i * 0.14, { type: 'triangle', freq: f, dur: i === 3 ? 1.1 : 0.3, gain: 0.14 });
      });
      this.tone(t + 0.42, { type: 'triangle', freq: 784, dur: 1.1, gain: 0.08 });
    });
  }

  defeat() {
    this.play((t) => {
      [440, 349, 294, 220].forEach((f, i) => {
        this.tone(t + i * 0.32, { type: 'sine', freq: f, dur: i === 3 ? 1.6 : 0.5, gain: 0.15 });
      });
    });
  }

  // --- ambience: low drone, distant wind and the odd water drip -------------
  startAmbient() {
    if (this.ambientOn || !this.ctx) return;
    this.ambientOn = true;
    const c = this.ctx;
    const amb = c.createGain();
    amb.gain.value = 0.0001;
    amb.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.2);
    amb.connect(this.ambLevel);

    for (const f of [55, 55.6, 82.4]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0.025;
      o.connect(g).connect(amb);
      o.start();
    }
    const wind = c.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 260;
    const wg = c.createGain();
    wg.gain.value = 0.05;
    wind.connect(wf).connect(wg).connect(amb);
    wind.start();

    const drip = () => {
      if (this.ready && !this.muted) {
        const t = c.currentTime;
        this.tone(t, { type: 'sine', freq: rand(1100, 1500), freqEnd: rand(1700, 2300), dur: 0.08, gain: 0.04 });
      }
      setTimeout(drip, rand(3500, 9000));
    };
    setTimeout(drip, 2500);
  }
}

export const sfx = new Sfx();
