// Each act's mood: the colour of the sky and ground light, the main light and the dark around
// the board, set through stage.setMood. Subtle on purpose: a grade, not a new palette. The first
// act keeps the look the game always had. An Endless Crypt floor takes the moods in turn, five
// floors each.

// `grade`: the finished image's tint, saturation and contrast for the act (post.js, with Glow on).
const MOODS = [
  { sky: 0x9fb4ff, ground: 0x2a1d12, sun: 0xffe0b5, bg: 0x0d0b10, grade: { tint: [0.97, 1, 1.05], sat: 0.96, contrast: 1.04 } }, // I: the crypt, cold blue
  { sky: 0x98cca8, ground: 0x1c2616, sun: 0xdcecbc, bg: 0x0a0f0b, grade: { tint: [0.96, 1.04, 0.96], sat: 0.9, contrast: 1.05 } }, // II: catacombs and barrow, grave-green
  { sky: 0xb8a2ff, ground: 0x281a32, sun: 0xdccaff, bg: 0x0f0a17, grade: { tint: [1.02, 0.97, 1.07], sat: 0.94, contrast: 1.04 } }, // III: nest, gallery, throne, ghostly violet
  { sky: 0xe0bf8c, ground: 0x33220c, sun: 0xffc682, bg: 0x140d06, grade: { tint: [1.07, 1.01, 0.9], sat: 1.05, contrast: 1.05 } }, // IV: sunken halls and tomb, warm amber
  { sky: 0xdc9c94, ground: 0x34140f, sun: 0xffb496, bg: 0x150808, grade: { tint: [1.08, 0.95, 0.92], sat: 1.06, contrast: 1.07 } }, // V: bridge, den and labyrinth, ember red
];

const ACT = {
  crypt: 0, warren: 0, ossuary: 0, sanctum: 0,
  catacombs: 1, vault: 1, cistern: 1, larder: 1, barrow: 1,
  nest: 2, gallery: 2, throne: 2,
  halls: 3, armory: 3, tomb: 3,
  bridge: 4, lair: 4, undercroft: 4, labyrinth: 4,
};

/** The act (0–4) a room belongs to, for its look; an Endless floor's goes in turn, five floors each. */
export function actFor(id = '') {
  const deep = /^deep:[^:]+:(\d+)/.exec(id);
  if (deep) return Math.floor((Number(deep[1]) - 1) / 5) % MOODS.length;
  return ACT[id] ?? 0;
}

/** The mood for a room id (a campaign room, or an Endless floor 'deep:<seed>:<floor>…'). */
export function moodFor(id = '') {
  return MOODS[actFor(id)];
}
