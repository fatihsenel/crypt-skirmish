// What figures say in their speech bubbles (render/speechBubble.js), and when. Only the
// moments that matter speak: a hero's first attack of a fight, a critical hit, a kill, a hero
// falling (a friend calls out), and now and then a monster's attack (most of a named foe's).
// Lines are picked with Math.random, never the fight's dice, so they never touch a replay.

/** Each hero class's lines: first attack of a fight, a critical hit, a kill, a friend down. */
const HEROES = {
  F: { // the Fighter: blunt
    first: ['Stand and fight!', 'Come on, then!', 'Who’s first?', 'Shields up!', 'Right. Let’s go.'],
    crit: ['Found the gap!', 'Felt that, did you?', 'Clean through!', 'And stay down!'],
    kill: ['Next!', 'One less.', 'That’s done.', 'Who else?'],
    down: ['{name}! Stay with me!', 'Hold on, {name}!', 'Get up, {name}!'],
  },
  P: { // the Paladin: righteous
    first: ['For the light!', 'Face me, foul thing!', 'Stand with me!', 'By my oath!'],
    crit: ['Judgement!', 'The light finds you!', 'Smitten!', 'Feel my vow!'],
    kill: ['Rest now.', 'Back to the dark.', 'It is ended.', 'Be at peace.'],
    down: ['Hold fast, {name}!', 'I’m coming, {name}!', 'Not {name}! Not today!'],
  },
  W: { // the Wizard: dry
    first: ['Do keep still.', 'Observe.', 'Let’s be quick.', 'Hm. Fine.'],
    crit: ['Textbook.', 'Precisely there.', 'As calculated.', 'Elegant, no?'],
    kill: ['Noted.', 'Tidy.', 'Hypothesis confirmed.', 'Moving on.'],
    down: ['{name}, don’t you dare!', 'Someone help {name}!', '{name}! Get up!'],
  },
  K: { // the Warlock: wry and dark
    first: ['My patron says hello.', 'Shall we?', 'This will sting.', 'Hold still, darling.'],
    crit: ['Delicious.', 'Oh, that’s lovely.', 'Feel that pact?', 'Mm. Perfect.'],
    kill: ['Paid in full.', 'Another for the pact.', 'Sweet dreams.', 'Shh.'],
    down: ['Not yet, {name}!', '{name}! Stay with us!', 'Up, {name}! Now!'],
  },
  R: { // the Rogue: cocky
    first: ['Didn’t see me, did you?', 'Surprise!', 'Hello there.', 'Too slow.'],
    crit: ['Right between the plates!', 'Ooh, that’s a nerve.', 'Bullseye!', 'Sneaky, sneaky.'],
    kill: ['Easy.', 'Lights out.', 'Mine, I think.', 'Too easy.'],
    down: ['{name}! No, no, no!', 'Hang on, {name}!', 'Somebody grab {name}!'],
  },
  A: { // the Ranger: calm hunter
    first: ['Steady.', 'Got you marked.', 'Breathe. Loose.', 'Hunt’s on.'],
    crit: ['Clean shot.', 'Through the heart.', 'Right on target.', 'Dead centre.'],
    kill: ['Down.', 'One less.', 'Next mark.', 'Quiet now.'],
    down: ['{name}! Hold on!', 'Cover {name}!', 'Stay down, {name}! I’ve got you!'],
  },
  C: { // the Cleric: warm
    first: ['Light, guide my hand.', 'Be gone!', 'Stay behind me!', 'Grace go with us.'],
    crit: ['Blessed blow!', 'The light is with us!', 'By the dawn!', 'Mercy, that hurt.'],
    kill: ['Go in peace.', 'Rest, poor thing.', 'Light keep you.', 'It is over.'],
    down: ['Hold on, {name}! I’m coming!', '{name}! Stay with me!', 'Breathe, {name}!'],
  },
  B: { // the Bard: flamboyant
    first: ['A little music?', 'Places, everyone!', 'Curtain up!', 'Let’s make a scene!'],
    crit: ['Bravo!', 'Encore!', 'What a finish!', 'That’s going in a song!'],
    kill: ['And… scene.', 'Exit, stage left.', 'Bow out, darling.', 'The end!'],
    down: ['{name}! Not in the second act!', 'Hold on, {name}!', 'Up, {name}! The show goes on!'],
  },
};

/**
 * The monsters that speak (beasts, skeletons, specters and mummies don't): an attack now and
 * then, and a kill. Named foes speak on most attacks.
 */
const MONSTERS = {
  g: { // goblins: squeaky, panicky
    attack: ['Stab the tall one!', 'Get ’em! Get ’em!', 'Mine! Mine!', 'Poke it! Poke it!', 'Shiny boots!', 'You first!'],
    kill: ['Hee hee! Got one!', 'Dibs on its boots!', 'I did that!'],
  },
  o: { // the orc: one word
    attack: ['CRUSH!', 'SMASH!', 'BLOOD!', 'RAAH!', 'BREAK!', 'DIE!'],
    kill: ['WEAK!', 'NEXT!', 'HAH!'],
  },
  b: { // Grukk, the goblin boss
    attack: ['Grukk smash you!', 'Bow to Grukk!', 'You in Grukk’s house!', 'Grukk is king here!', 'Stop wriggling!'],
    kill: ['Grukk wins again!', 'Who next for Grukk?', 'Ha! Too small!'],
  },
  n: { // Morvath, the necromancer
    attack: ['Kneel.', 'Your bones will serve.', 'Death is patient.', 'How warm you are.', 'Join them.'],
    kill: ['Rise for me.', 'One more servant.', 'How fitting.'],
  },
  u: { // ghouls
    attack: ['Fresh meat…', 'Hungry… so hungry…', 'Warm one…', 'Taste…', 'Mine to eat…'],
    kill: ['Feast…', 'Still warm…', 'Ahh…'],
  },
  h: { // ghasts
    attack: ['Smell that fear…', 'Rot with us…', 'So soft…', 'Come closer…'],
    kill: ['Rot well.', 'Ripe now.', 'Ahh, fear…'],
  },
  w: { // Varek, the wight
    attack: ['You trespass.', 'Your life is mine.', 'I remember warmth.', 'Yield.', 'The barrow is mine.'],
    kill: ['Another for the barrow.', 'Be still.', 'It ends.'],
  },
  q: { // Ysolde, the banshee
    attack: ['Leave this place!', 'Hear me weep!', 'You will not leave.', 'Why do you wake me?'],
    kill: ['Weep with me.', 'Sleep forever.', 'Hush now…'],
  },
  t: { // wraiths
    attack: ['Your light… give it.', 'Cold… forever cold…', 'Fade with me.', 'Nothing remains.'],
    kill: ['Darkness keeps you.', 'Fade…', 'Gone.'],
  },
  x: { // the fallen knight
    attack: ['Stand and be judged.', 'For my dark lord!', 'My oath is broken.', 'Defend yourself.', 'Yield!'],
    kill: ['Rest, fool.', 'Unworthy.', 'As I once fell.'],
  },
  l: { // Nekhet, the mummy lord
    attack: ['You defile my tomb!', 'Kneel before Nekhet!', 'Dust you are.', 'My curse upon you!', 'Thieves!'],
    kill: ['To dust.', 'The tomb keeps you.', 'Kneel forever.'],
  },
};

/** Foes with a name of their own: they speak on most of their attacks, not some. */
const NAMED = new Set(['b', 'n', 'w', 'q', 'x', 'l']);

/** Which lines a unit uses (null: it has no words). The risen dead are skeletons. */
function linesOf(unit) {
  if (unit.team === 'heroes') return HEROES[unit.code] ?? null;
  if (unit.name?.startsWith('Risen')) return null;
  return MONSTERS[unit.code] ?? null;
}

/** Can this unit say something at this moment? */
export const canSay = (unit, moment) => !!linesOf(unit)?.[moment]?.length;

/**
 * Picks the moment an attack speaks for, from what the engine resolved: a kill, else a
 * critical hit, else a hero's first attack of the fight, else (now and then) a monster's
 * attack. A hero falling is spoken by a friend instead (downLine), so a monster's kill of a
 * hero says nothing. Returns null when the attack stays quiet.
 * `first`: the attacker hasn't attacked yet this fight.
 */
export function attackMoment({ attacker, target, hit, crit, killed, first }, rand = Math.random) {
  const m = [];
  if (killed && target.team !== 'heroes') m.push('kill');
  if (hit && crit) m.push(attacker.team === 'heroes' ? 'crit' : 'attack');
  if (first && attacker.team === 'heroes') m.push('first');
  if (attacker.team === 'monsters' && rand() < (NAMED.has(attacker.code) ? 0.7 : 1 / 3)) m.push('attack');
  return m.find((moment) => canSay(attacker, moment)) ?? null;
}

/**
 * A line for `unit` at `moment` ('first', 'crit', 'kill', 'down' for heroes; 'attack' and
 * 'kill' for monsters), never the same line twice running for one kind of speaker.
 * `name` fills a '{name}' (the fallen friend). `recent` remembers the last line per kind.
 */
export function lineFor(unit, moment, { name = '', rand = Math.random, recent = new Map() } = {}) {
  const lines = linesOf(unit)?.[moment];
  if (!lines?.length) return null;
  const key = `${unit.team === 'heroes' ? 'h' : 'm'}:${unit.code}:${moment}`;
  const last = recent.get(key);
  const pool = lines.length > 1 ? lines.filter((l) => l !== last) : lines;
  const line = pool[Math.floor(rand() * pool.length)];
  recent.set(key, line);
  return line.replaceAll('{name}', name);
}

/**
 * Who calls out when a hero falls: the nearest friend still standing who can be seen, or
 * null. `seen(u)` says whether a unit is in view.
 */
export function downSpeaker(fallen, units, seen = () => true) {
  const friends = units.filter((u) => u.team === 'heroes' && u !== fallen && u.alive && !u.corpse && seen(u) && canSay(u, 'down'));
  const dist = (u) => Math.max(Math.abs(u.x - fallen.x), Math.abs(u.z - fallen.z));
  return friends.sort((a, b) => dist(a) - dist(b))[0] ?? null;
}

/** For tests and the README: every line, by speaker and moment. */
export const SPEECH = { HEROES, MONSTERS, NAMED };
