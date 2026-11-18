// Player settings kept in the browser: a volume for each kind of sound (music, effects and
// voices, each 0 to 1, under the main sound switch) and how fast monster turns play out.

export const SETTINGS_KEY = 'crypt-skirmish:settings';

/** Monster-turn speeds: how many times faster than normal their animations and pauses run. */
export const SPEEDS = { normal: 1, fast: 1.75, fastest: 3 };

export const DEFAULT_SETTINGS = Object.freeze({ music: 1, effects: 1, voices: 1, speed: 'normal' });

const level = (v, fallback) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Parse stored settings; anything missing or unreadable takes its default. */
export function parseSettings(text) {
  let raw;
  try {
    raw = JSON.parse(text ?? '{}');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const d = DEFAULT_SETTINGS;
  return {
    music: level(raw.music, d.music),
    effects: level(raw.effects, d.effects),
    voices: level(raw.voices, d.voices),
    speed: Object.hasOwn(SPEEDS, raw.speed) ? raw.speed : d.speed,
  };
}

export function loadSettings() {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return parseSettings(null);
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: the settings last until the page closes */
  }
}

/** A slider's 0..1 level as a gain: squared, so the middle of the slider sounds about half as loud. */
export const levelGain = (v) => v * v;
