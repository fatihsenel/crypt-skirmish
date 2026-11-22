// What figures say in their speech bubbles (render/speechBubble.js), and when. Only the
// moments that matter speak: a hero's first attack of a fight, a critical hit, a kill, a hero
// falling (a friend calls out), a big spell, healing a friend, getting back up from dying, a
// named foe coming into view, and now and then a monster's attack or spell (most of a named
// foe's). Lines are picked with Math.random, never the fight's dice, so they never touch a replay.

/**
 * Each hero class's lines: first attack of a fight, a critical hit, a kill, a friend down,
 * and (some classes) a big spell (`blast`), a heal on a friend, and thanks when brought back.
 */
const HEROES = {
  F: { // the Fighter: blunt
    first: ['Stand and fight!', 'Come on, then!', 'Who’s first?', 'Shields up!', 'Right. Let’s go.'],
    crit: ['Found the gap!', 'Felt that, did you?', 'Clean through!', 'And stay down!'],
    kill: ['Next!', 'One less.', 'That’s done.', 'Who else?'],
    down: ['{name}! Stay with me!', 'Hold on, {name}!', 'Get up, {name}!'],
    thanks: ['Not dead yet.', 'Ugh. Thanks.', 'Back on my feet!', 'Where’s my sword?'],
  },
  P: { // the Paladin: righteous
    first: ['For the light!', 'Face me, foul thing!', 'Stand with me!', 'By my oath!'],
    crit: ['Judgement!', 'The light finds you!', 'Smitten!', 'Feel my vow!'],
    kill: ['Rest now.', 'Back to the dark.', 'It is ended.', 'Be at peace.'],
    down: ['Hold fast, {name}!', 'I’m coming, {name}!', 'Not {name}! Not today!'],
    heal: ['Rise, {name}.', 'Be whole, {name}.', 'The light mends you.', 'Stand firm, {name}.'],
    thanks: ['My oath holds.', 'The light kept me.', 'I stand again!', 'Thank you, friend.'],
  },
  W: { // the Wizard: dry
    first: ['Do keep still.', 'Observe.', 'Let’s be quick.', 'Hm. Fine.'],
    crit: ['Textbook.', 'Precisely there.', 'As calculated.', 'Elegant, no?'],
    kill: ['Noted.', 'Tidy.', 'Hypothesis confirmed.', 'Moving on.'],
    down: ['{name}, don’t you dare!', 'Someone help {name}!', '{name}! Get up!'],
    blast: ['Duck!', 'Mind your eyebrows!', 'Stand back.', 'Watch this.', 'Everyone, clear!'],
    thanks: ['How undignified.', 'I’m fine. Mostly.', 'Noted. Thank you.', 'Where was I?'],
  },
  K: { // the Warlock: wry and dark
    first: ['My patron says hello.', 'Shall we?', 'This will sting.', 'Hold still, darling.'],
    crit: ['Delicious.', 'Oh, that’s lovely.', 'Feel that pact?', 'Mm. Perfect.'],
    kill: ['Paid in full.', 'Another for the pact.', 'Sweet dreams.', 'Shh.'],
    down: ['Not yet, {name}!', '{name}! Stay with us!', 'Up, {name}! Now!'],
    blast: ['Burn, darling.', 'A gift from below.', 'Let’s light this up.', 'Feel the pact!'],
    thanks: ['Not today, patron.', 'Missed me, did you?', 'Too soon. Thanks.', 'Back from the dark.'],
  },
  R: { // the Rogue: cocky
    first: ['Didn’t see me, did you?', 'Surprise!', 'Hello there.', 'Too slow.'],
    crit: ['Right between the plates!', 'Ooh, that’s a nerve.', 'Bullseye!', 'Sneaky, sneaky.'],
    kill: ['Easy.', 'Lights out.', 'Mine, I think.', 'Too easy.'],
    down: ['{name}! No, no, no!', 'Hang on, {name}!', 'Somebody grab {name}!'],
    thanks: ['Knew you’d miss me.', 'All part of the plan.', 'That didn’t happen.', 'I owe you one.'],
  },
  A: { // the Ranger: calm hunter
    first: ['Steady.', 'Got you marked.', 'Breathe. Loose.', 'Hunt’s on.'],
    crit: ['Clean shot.', 'Through the heart.', 'Right on target.', 'Dead centre.'],
    kill: ['Down.', 'One less.', 'Next mark.', 'Quiet now.'],
    down: ['{name}! Hold on!', 'Cover {name}!', 'Stay down, {name}! I’ve got you!'],
    thanks: ['Still breathing.', 'Thanks. Back to it.', 'On my feet.', 'Good. Let’s finish this.'],
  },
  C: { // the Cleric: warm
    first: ['Light, guide my hand.', 'Be gone!', 'Stay behind me!', 'Grace go with us.'],
    crit: ['Blessed blow!', 'The light is with us!', 'By the dawn!', 'Mercy, that hurt.'],
    kill: ['Go in peace.', 'Rest, poor thing.', 'Light keep you.', 'It is over.'],
    down: ['Hold on, {name}! I’m coming!', '{name}! Stay with me!', 'Breathe, {name}!'],
    heal: ['Up you get, {name}!', 'Easy, {name}. I’ve got you.', 'Light mend you!', 'Not on my watch!'],
    thanks: ['Thank the dawn.', 'Back with you.', 'I’m all right.', 'Bless you.'],
  },
  B: { // the Bard: flamboyant
    first: ['A little music?', 'Places, everyone!', 'Curtain up!', 'Let’s make a scene!'],
    crit: ['Bravo!', 'Encore!', 'What a finish!', 'That’s going in a song!'],
    kill: ['And… scene.', 'Exit, stage left.', 'Bow out, darling.', 'The end!'],
    down: ['{name}! Not in the second act!', 'Hold on, {name}!', 'Up, {name}! The show goes on!'],
    blast: ['Hit the high note!', 'Feel the bass!', 'Big finish!', 'From the top!'],
    heal: ['Up, {name}! Your cue!', 'A little tune for you.', 'Back on stage, {name}!', 'Applause for {name}!'],
    thanks: ['A dramatic return!', 'Did you miss me?', 'Not my final bow.', 'The crowd goes wild!'],
  },
};

/**
 * The monsters that speak (beasts, skeletons, specters and mummies don't): an attack now and
 * then, a kill, and for some a spell. Named foes speak on most attacks and have a line for
 * when the party first sees them (`intro`).
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
    intro: ['Who comes in Grukk’s warren?', 'Fresh boots for Grukk!', 'Get them, boys!'],
  },
  n: { // Morvath, the necromancer
    attack: ['Kneel.', 'Your bones will serve.', 'Death is patient.', 'How warm you are.', 'Join them.'],
    kill: ['Rise for me.', 'One more servant.', 'How fitting.'],
    cast: ['Rise. Serve.', 'Tremble.', 'Up, my pet.', 'Fear me.'],
    intro: ['Ah. Fresh bones.', 'Visitors. How kind.', 'You’ll all serve me.'],
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
    cast: ['Know dread.', 'Tremble.', 'Feel the grave.'],
    intro: ['You trespass in my barrow.', 'Thieves. In my barrow.', 'Leave, or lie here.'],
  },
  q: { // Ysolde, the banshee
    attack: ['Leave this place!', 'Hear me weep!', 'You will not leave.', 'Why do you wake me?'],
    kill: ['Weep with me.', 'Sleep forever.', 'Hush now…'],
    cast: ['Fear my sorrow!', 'Weep!', 'Despair!'],
    intro: ['Who disturbs my throne?', 'Leave me to my grief!', 'You should not be here.'],
  },
  t: { // wraiths
    attack: ['Your light… give it.', 'Cold… forever cold…', 'Fade with me.', 'Nothing remains.'],
    kill: ['Darkness keeps you.', 'Fade…', 'Gone.'],
    cast: ['Fear the dark.', 'Shiver…', 'Despair…'],
  },
  x: { // the fallen knight
    attack: ['Stand and be judged.', 'For my dark lord!', 'My oath is broken.', 'Defend yourself.', 'Yield!'],
    kill: ['Rest, fool.', 'Unworthy.', 'As I once fell.'],
    intro: ['None pass the armory.', 'My lord awaits. You won’t.', 'Draw, then.'],
  },
  l: { // Nekhet, the mummy lord
    attack: ['You defile my tomb!', 'Kneel before Nekhet!', 'Dust you are.', 'My curse upon you!', 'Thieves!'],
    kill: ['To dust.', 'The tomb keeps you.', 'Kneel forever.'],
    cast: ['Fear my curse!', 'Tremble, thief!', 'Dread me!'],
    intro: ['Who wakes Nekhet?', 'Thieves in my tomb!', 'You will join my house.'],
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
 * `first`: the attacker hasn't attacked yet this fight. `kindSpoke`: one of the attacker's
 * kind already spoke this round (a pack of ordinary monsters takes turns at it).
 */
export function attackMoment({ attacker, target, hit, crit, killed, first, kindSpoke }, rand = Math.random) {
  const m = [];
  if (killed && target.team !== 'heroes') m.push('kill');
  if (attacker.team === 'heroes') {
    if (hit && crit) m.push('crit');
    if (first) m.push('first');
  } else if (NAMED.has(attacker.code) ? (hit && crit) || rand() < 0.7 : !kindSpoke && ((hit && crit) || rand() < 1 / 3)) {
    m.push('attack'); // a crit always speaks, but a pack still takes turns at it
  }
  return m.find((moment) => canSay(attacker, moment)) ?? null;
}

/** Hero spells big enough to shout about, and the heals. */
const BLASTS = new Set(['burningHands', 'fireball', 'lightningBolt', 'iceStorm', 'shatter', 'fear']);
const HEALS = new Set(['cureWounds', 'healingWord', 'layOnHands', 'massHealingWord']);

/**
 * The moment a spell speaks for: a hero healing a friend ('heal', with the first friend
 * healed as `friend`) or casting a big spell ('blast'); a monster's spell now and then
 * ('cast', most of a named foe's). `healed`: the units the spell healed. Null: quiet.
 */
export function spellMoment({ caster, id, healed = [] }, rand = Math.random) {
  if (caster.team === 'heroes') {
    const friend = HEALS.has(id) ? healed.find((u) => u !== caster && u.team === 'heroes') : null;
    if (friend && canSay(caster, 'heal')) return { moment: 'heal', friend };
    if (BLASTS.has(id) && canSay(caster, 'blast')) return { moment: 'blast' };
    return null;
  }
  if (!canSay(caster, 'cast') || rand() >= (NAMED.has(caster.code) ? 0.7 : 1 / 3)) return null;
  return { moment: 'cast' };
}

/**
 * A line for `unit` at `moment` ('first', 'crit', 'kill', 'down', 'blast', 'heal', 'thanks'
 * for heroes; 'attack', 'kill', 'cast' and 'intro' for monsters), never the same line twice running for one kind of speaker.
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
export const SPEECH = { HEROES, MONSTERS, NAMED, BLASTS, HEALS };
