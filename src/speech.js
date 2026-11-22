// What figures say in their speech bubbles (render/speechBubble.js), and when. Only the
// moments that matter speak: a hero's first attack of a fight, a critical hit, a kill, a hero
// falling (a friend calls out), a big spell, healing a friend, getting back up from dying, a
// named foe coming into view, and now and then a monster's attack or spell (most of a named
// foe's), with a minion now and then answering its boss. A figure under a quarter of its HP
// says so once, the turned dead cry out as they flee, and a won fight's last hero (or a lost
// fight's boss) has the last word. Between rooms two heroes trade a line in camp (`banter`).
// Lines are picked with Math.random, never the fight's dice, so they never touch a replay.

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
    win: ['That’s the lot.', 'Anyone else? No?', 'Done. Who’s hungry?', 'Good work, all.'],
    hurt: ['Just a scratch!', 'Not… yet.', 'I’ve had worse!', 'Still standing!'],
    thanks: ['Not dead yet.', 'Ugh. Thanks.', 'Back on my feet!', 'Where’s my sword?'],
  },
  P: { // the Paladin: righteous
    first: ['For the light!', 'Face me, foul thing!', 'Stand with me!', 'By my oath!'],
    crit: ['Judgement!', 'The light finds you!', 'Smitten!', 'Feel my vow!'],
    kill: ['Rest now.', 'Back to the dark.', 'It is ended.', 'Be at peace.'],
    down: ['Hold fast, {name}!', 'I’m coming, {name}!', 'Not {name}! Not today!'],
    win: ['The light prevails.', 'It is done. Rest now.', 'Well fought, friends.', 'Peace returns here.'],
    hurt: ['My faith holds!', 'Not while I stand!', 'Light, sustain me!', 'I will not yield!'],
    heal: ['Rise, {name}.', 'Be whole, {name}.', 'The light mends you.', 'Stand firm, {name}.'],
    thanks: ['My oath holds.', 'The light kept me.', 'I stand again!', 'Thank you, friend.'],
  },
  W: { // the Wizard: dry
    first: ['Do keep still.', 'Observe.', 'Let’s be quick.', 'Hm. Fine.'],
    crit: ['Textbook.', 'Precisely there.', 'As calculated.', 'Elegant, no?'],
    kill: ['Noted.', 'Tidy.', 'Hypothesis confirmed.', 'Moving on.'],
    down: ['{name}, don’t you dare!', 'Someone help {name}!', '{name}! Get up!'],
    win: ['Well. That’s settled.', 'Shall we move on?', 'Thoroughly concluded.', 'As predicted.'],
    hurt: ['That was my good robe!', 'Ow. Noted.', 'Someone, a little help?', 'Ah. Blood. Mine.'],
    blast: ['Duck!', 'Mind your eyebrows!', 'Stand back.', 'Watch this.', 'Everyone, clear!'],
    thanks: ['How undignified.', 'I’m fine. Mostly.', 'Noted. Thank you.', 'Where was I?'],
  },
  K: { // the Warlock: wry and dark
    first: ['My patron says hello.', 'Shall we?', 'This will sting.', 'Hold still, darling.'],
    crit: ['Delicious.', 'Oh, that’s lovely.', 'Feel that pact?', 'Mm. Perfect.'],
    kill: ['Paid in full.', 'Another for the pact.', 'Sweet dreams.', 'Shh.'],
    down: ['Not yet, {name}!', '{name}! Stay with us!', 'Up, {name}! Now!'],
    win: ['My patron is pleased.', 'That was fun, darling.', 'All paid up.', 'Lovely. Next?'],
    hurt: ['Patron… a little help?', 'Oh, now I’m cross.', 'That stung. Rudely.', 'Not like this, darling.'],
    blast: ['Burn, darling.', 'A gift from below.', 'Let’s light this up.', 'Feel the pact!'],
    thanks: ['Not today, patron.', 'Missed me, did you?', 'Too soon. Thanks.', 'Back from the dark.'],
  },
  R: { // the Rogue: cocky
    first: ['Didn’t see me, did you?', 'Surprise!', 'Hello there.', 'Too slow.'],
    crit: ['Right between the plates!', 'Ooh, that’s a nerve.', 'Bullseye!', 'Sneaky, sneaky.'],
    kill: ['Easy.', 'Lights out.', 'Mine, I think.', 'Too easy.'],
    down: ['{name}! No, no, no!', 'Hang on, {name}!', 'Somebody grab {name}!'],
    win: ['Told you. Easy.', 'Dibs on the loot!', 'Not even sweating.', 'Right. Pockets out.'],
    hurt: ['Ow! Ow! Ow!', 'That’s not fair!', 'I need a minute!', 'Bad plan. Bad plan.'],
    thanks: ['Knew you’d miss me.', 'All part of the plan.', 'That didn’t happen.', 'I owe you one.'],
  },
  A: { // the Ranger: calm hunter
    first: ['Steady.', 'Got you marked.', 'Breathe. Loose.', 'Hunt’s on.'],
    crit: ['Clean shot.', 'Through the heart.', 'Right on target.', 'Dead centre.'],
    kill: ['Down.', 'One less.', 'Next mark.', 'Quiet now.'],
    down: ['{name}! Hold on!', 'Cover {name}!', 'Stay down, {name}! I’ve got you!'],
    win: ['Quiet again.', 'Clear. Moving on.', 'The hunt is done.', 'Good shooting, all.'],
    hurt: ['Hit. Still steady.', 'Fall back… breathe.', 'Need cover!', 'Bleeding. Keep on.'],
    thanks: ['Still breathing.', 'Thanks. Back to it.', 'On my feet.', 'Good. Let’s finish this.'],
  },
  C: { // the Cleric: warm
    first: ['Light, guide my hand.', 'Be gone!', 'Stay behind me!', 'Grace go with us.'],
    crit: ['Blessed blow!', 'The light is with us!', 'By the dawn!', 'Mercy, that hurt.'],
    kill: ['Go in peace.', 'Rest, poor thing.', 'Light keep you.', 'It is over.'],
    down: ['Hold on, {name}! I’m coming!', '{name}! Stay with me!', 'Breathe, {name}!'],
    win: ['Thank the dawn.', 'Everyone all right?', 'Rest, all of you.', 'We made it. Bless.'],
    hurt: ['Physician, heal thyself…', 'Light, steady me…', 'I’m hurt! Hold on!', 'Not yet, not yet…'],
    heal: ['Up you get, {name}!', 'Easy, {name}. I’ve got you.', 'Light mend you!', 'Not on my watch!'],
    thanks: ['Thank the dawn.', 'Back with you.', 'I’m all right.', 'Bless you.'],
  },
  B: { // the Bard: flamboyant
    first: ['A little music?', 'Places, everyone!', 'Curtain up!', 'Let’s make a scene!'],
    crit: ['Bravo!', 'Encore!', 'What a finish!', 'That’s going in a song!'],
    kill: ['And… scene.', 'Exit, stage left.', 'Bow out, darling.', 'The end!'],
    down: ['{name}! Not in the second act!', 'Hold on, {name}!', 'Up, {name}! The show goes on!'],
    win: ['Curtain! Bows, all!', 'What a show!', 'They’ll sing of this!', 'And the crowd roars!'],
    hurt: ['Not the face!', 'I’m dying! Dramatically!', 'Ow! Rude!', 'This isn’t the ending!'],
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
    hurt: ['No hurt me! No hurt!', 'Mercy! Mercy!', 'I give up! Mostly!'],
    reply: ['Yes, boss!', 'Get ’em, boys!', 'Boss is right!'],
    gloat: ['Ha ha! Boots for all!', 'We won! We won!', 'Who’s small now?'],
  },
  o: { // the orc: one word
    attack: ['CRUSH!', 'SMASH!', 'BLOOD!', 'RAAH!', 'BREAK!', 'DIE!'],
    kill: ['WEAK!', 'NEXT!', 'HAH!'],
    hurt: ['NOT… DONE!', 'MORE PAIN!', 'GRAAH!'],
    reply: ['YES, BOSS!', 'CRUSH THEM!', 'HRAH!'],
    gloat: ['WEAK ALL!', 'ORC WIN!', 'HAH! HAH!'],
  },
  b: { // Grukk, the goblin boss
    attack: ['Grukk smash you!', 'Bow to Grukk!', 'You in Grukk’s house!', 'Grukk is king here!', 'Stop wriggling!'],
    kill: ['Grukk wins again!', 'Who next for Grukk?', 'Ha! Too small!'],
    intro: ['Who comes in Grukk’s warren?', 'Fresh boots for Grukk!', 'Get them, boys!'],
    hurt: ['Boys! Help Grukk!', 'Ow! Not fair!', 'Grukk not like this!'],
    gloat: ['Grukk is king!', 'All the boots! Mine!', 'Hah! Bow to Grukk!'],
  },
  n: { // Morvath, the necromancer
    attack: ['Kneel.', 'Your bones will serve.', 'Death is patient.', 'How warm you are.', 'Join them.'],
    kill: ['Rise for me.', 'One more servant.', 'How fitting.'],
    cast: ['Rise. Serve.', 'Tremble.', 'Up, my pet.', 'Fear me.'],
    intro: ['Ah. Fresh bones.', 'Visitors. How kind.', 'You’ll all serve me.'],
    hurt: ['You… dare…', 'My servants! To me!', 'This flesh is weak…'],
    gloat: ['Rise, my new servants.', 'Such fine bones.', 'Death always wins.'],
  },
  u: { // ghouls
    attack: ['Fresh meat…', 'Hungry… so hungry…', 'Warm one…', 'Taste…', 'Mine to eat…'],
    kill: ['Feast…', 'Still warm…', 'Ahh…'],
    hurt: ['Hurts… hurts…', 'Hungry… still…'],
    reply: ['Yesss… master…', 'Feed us… master…', 'Meat… for master…'],
    flee: ['Burns! Burns!', 'Away… away…', 'The light! No!'],
    gloat: ['Feast now…', 'All ours…', 'Warm… so warm…'],
  },
  h: { // ghasts
    attack: ['Smell that fear…', 'Rot with us…', 'So soft…', 'Come closer…'],
    kill: ['Rot well.', 'Ripe now.', 'Ahh, fear…'],
    reply: ['As you wish…', 'Ours, master…'],
    flee: ['No… the light…', 'Too bright…', 'Away!'],
    gloat: ['Ripe… all ripe…', 'Rot well, little ones.'],
  },
  w: { // Varek, the wight
    attack: ['You trespass.', 'Your life is mine.', 'I remember warmth.', 'Yield.', 'The barrow is mine.'],
    kill: ['Another for the barrow.', 'Be still.', 'It ends.'],
    cast: ['Know dread.', 'Tremble.', 'Feel the grave.'],
    intro: ['You trespass in my barrow.', 'Thieves. In my barrow.', 'Leave, or lie here.'],
    hurt: ['I was a king once…', 'You cannot end me.', 'The barrow… holds…'],
    flee: ['This light… burns…', 'You have not won.'],
    gloat: ['The barrow keeps you.', 'Lie here forever.', 'Rest. As I did.'],
  },
  q: { // Ysolde, the banshee
    attack: ['Leave this place!', 'Hear me weep!', 'You will not leave.', 'Why do you wake me?'],
    kill: ['Weep with me.', 'Sleep forever.', 'Hush now…'],
    cast: ['Fear my sorrow!', 'Weep!', 'Despair!'],
    intro: ['Who disturbs my throne?', 'Leave me to my grief!', 'You should not be here.'],
    hurt: ['Why… won’t you leave?', 'My grief… breaks…'],
    flee: ['Not the light!', 'Leave me be!'],
    gloat: ['Now we weep together.', 'Sleep, and grieve.'],
  },
  t: { // wraiths
    attack: ['Your light… give it.', 'Cold… forever cold…', 'Fade with me.', 'Nothing remains.'],
    kill: ['Darkness keeps you.', 'Fade…', 'Gone.'],
    cast: ['Fear the dark.', 'Shiver…', 'Despair…'],
    reply: ['We obey…', 'The dark hears you…', 'Yesss…'],
    flee: ['The light… flee…', 'Burning…', 'Not… the light…'],
    gloat: ['Darkness keeps all.', 'Nothing remains.'],
  },
  x: { // the fallen knight
    attack: ['Stand and be judged.', 'For my dark lord!', 'My oath is broken.', 'Defend yourself.', 'Yield!'],
    kill: ['Rest, fool.', 'Unworthy.', 'As I once fell.'],
    intro: ['None pass the armory.', 'My lord awaits. You won’t.', 'Draw, then.'],
    hurt: ['My oath… still binds.', 'Not yet, fool.', 'Again!'],
    reply: ['As my lord commands.', 'For the lord!', 'At once.'],
    flee: ['My oath… burns…', 'Fall back!'],
    gloat: ['Unworthy. All of you.', 'My lord is served.', 'Judged and found wanting.'],
  },
  l: { // Nekhet, the mummy lord
    attack: ['You defile my tomb!', 'Kneel before Nekhet!', 'Dust you are.', 'My curse upon you!', 'Thieves!'],
    kill: ['To dust.', 'The tomb keeps you.', 'Kneel forever.'],
    cast: ['Fear my curse!', 'Tremble, thief!', 'Dread me!'],
    intro: ['Who wakes Nekhet?', 'Thieves in my tomb!', 'You will join my house.'],
    hurt: ['You dare strike Nekhet?', 'I have slept an age…', 'My house! To me!'],
    flee: ['This light offends me!', 'You will pay for this!'],
    gloat: ['Dust to dust.', 'Join my house forever.', 'The tomb is sealed.'],
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
 * A line for `unit` at `moment` ('first', 'crit', 'kill', 'down', 'blast', 'heal', 'thanks',
 * 'hurt', 'win' for heroes; 'attack', 'kill', 'cast', 'intro', 'hurt', 'reply', 'flee',
 * 'gloat' for monsters), never the same line twice running for one kind of speaker.
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

/**
 * A minion that answers its boss: the nearest of a kind with a 'reply', in sight and within
 * 6 tiles of the boss. Null if none.
 */
export function replySpeaker(boss, units, seen = () => true) {
  const dist = (u) => Math.max(Math.abs(u.x - boss.x), Math.abs(u.z - boss.z));
  const near = units.filter((u) => u.team === 'monsters' && u !== boss && u.alive && !NAMED.has(u.code)
    && canSay(u, 'reply') && dist(u) <= 6 && seen(u));
  return near.sort((a, b) => dist(a) - dist(b))[0] ?? null;
}

/**
 * Who has the last word when a fight ends: on a victory a hero still up (the one whose turn
 * it is, if it can be seen), on a defeat a named foe still standing, else any monster that
 * gloats. Null: nobody in sight to say it.
 */
export function lastWordsSpeaker(over, units, current, seen = () => true) {
  const up = (u) => u.alive && !u.corpse && seen(u);
  if (over === 'victory') {
    if (current?.team === 'heroes' && up(current) && canSay(current, 'win')) return current;
    return units.find((u) => u.team === 'heroes' && up(u) && canSay(u, 'win')) ?? null;
  }
  const foes = units.filter((u) => u.team === 'monsters' && up(u) && canSay(u, 'gloat'));
  return foes.find((u) => NAMED.has(u.code)) ?? foes[0] ?? null;
}

/**
 * Camp talk after a won room: two heroes trade a line each. [first line, answer]. `down`: a
 * friend teases the one who dropped ({name}); `boss`: after a boss; `pairs`: a pair of classes'
 * own, first speaker's class then the second's; `any`: anyone.
 */
const BANTER = {
  down: [
    ['Don’t do that again, {name}.', 'No promises.'],
    ['You scared me back there, {name}.', 'Scared myself.'],
    ['Next time, duck, {name}.', 'I did duck. Badly.'],
    ['How’s the head, {name}?', 'Still attached. Mostly.'],
    ['We nearly lost you, {name}.', 'Nearly doesn’t count.'],
  ],
  boss: [
    ['That’s the worst of it.', 'Don’t say that. It never is.'],
    ['Is it really dead this time?', 'Kick it, just in case.'],
    ['We should take a trophy.', 'We should take a nap.'],
    ['Did anyone else hear it scream?', 'I’m trying not to think about it.'],
  ],
  pairs: {
    FW: ['Could you aim that fire away from me?', 'I aimed it near you. There’s a difference.'],
    WF: ['You might try thinking first.', 'I might. I won’t.'],
    RF: ['Did you even see me in there?', 'I heard you. Stabbing things.'],
    FC: ['Thanks for the patching.', 'Try getting hit less.'],
    RW: ['Can you magic this lock open?', 'I can magic your hands off it.'],
    CW: ['You’re bleeding on your book.', 'It’s a very old book. It’s seen worse.'],
    CR: ['Did you pocket something back there?', 'Define “pocket”.'],
    PK: ['Your patron worries me.', 'He worries me too, darling.'],
    KP: ['Do you ever take that armour off?', 'Do you ever stop smirking?'],
    BF: ['I’m writing a song about you.', 'Please don’t.'],
    BW: ['What rhymes with “fireball”?', 'Nothing. Please stop.'],
    AR: ['You’re loud for a rogue.', 'You’re quiet for a person.'],
    RA: ['Bet I can get more than you next room.', 'You’re on.'],
    PC: ['The light was with us today.', 'It usually is. We just don’t notice.'],
    BP: ['Smile, paladin! We’re alive!', 'I am smiling.'],
    KC: ['Your god and my patron should meet.', 'Absolutely not.'],
    AW: ['Do your spells ever miss?', 'Never. Do your arrows?'],
    FA: ['Good shooting back there.', 'Good shield. I aimed past it.'],
    BK: ['Sing with me, warlock!', 'My patron forbids it. Mercifully.'],
    PR: ['Whose purse is that?', 'Mine now. Finders keepers.'],
  },
  any: [
    ['Anyone else hungry?', 'Always.'],
    ['How deep does this place go?', 'Deeper than I’d like.'],
    ['I keep hearing footsteps.', 'That’s us. Hopefully.'],
    ['Remind me why we came down here.', 'Gold. Glory. Bad judgement.'],
    ['That went well, I think.', 'Define “well”.'],
    ['I’ll take first watch.', 'Wake me if anything rattles.'],
  ],
};

/**
 * Two heroes' camp talk after a won room, or null with fewer than two heroes up.
 * `heroes`: [{ name, code }] still up; `downed`: names of those who dropped in the fight;
 * `boss`: the room had a boss. Returns [[name, line], [name, line]].
 */
export function banter(heroes, { downed = [], boss = false } = {}, rand = Math.random) {
  if (heroes.length < 2) return null;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const two = (a, b, [first, answer], name = '') => [[a.name, first.replaceAll('{name}', name)], [b.name, answer]];
  const fell = heroes.filter((h) => downed.includes(h.name));
  if (fell.length) {
    const b = pick(fell);
    return two(pick(heroes.filter((h) => h !== b)), b, pick(BANTER.down), b.name);
  }
  if (boss && rand() < 0.6) {
    const a = pick(heroes);
    return two(a, pick(heroes.filter((h) => h !== a)), pick(BANTER.boss));
  }
  const pairs = [];
  for (const a of heroes) for (const b of heroes) if (a !== b && BANTER.pairs[a.code + b.code]) pairs.push([a, b, BANTER.pairs[a.code + b.code]]);
  if (pairs.length && rand() < 0.75) return two(...pick(pairs));
  const a = pick(heroes);
  return two(a, pick(heroes.filter((h) => h !== a)), pick(BANTER.any));
}

/** For tests and the README: every line, by speaker and moment. */
export const SPEECH = { HEROES, MONSTERS, NAMED, BLASTS, HEALS, BANTER };
