// The story between fights: a scene at camp right after certain rooms, with a choice the run
// remembers. Answers live in the campaign's `story` ({ scene: option }); a scene waits at camp
// until it's answered, and the way on opens after. Nothing here reaches a fight: what a choice
// gives comes as potions, gold, HP or a stop on the map, so fight records and links are the
// same. Endless dives, dailies and challenges never see a scene.
//
// Three threads run through the five acts: Hesk the gravedigger, who may follow the party and
// patch them up between rooms; Morvath's journal, which may open the hidden study and later
// try to strike a bargain; and Ysolde's locket. The last room's outro ends each one.

/**
 * Each scene: `after` (the room it follows), `when` (the answers it needs, if any), its title
 * and words, and its options' label, what the button says it does (`desc`) and the camp's news
 * once it's chosen (`news`).
 */
export const SCENES = {
  gravedigger: {
    after: 'crypt',
    title: 'The Gravedigger',
    text: 'Behind the last coffin a man in a muddy coat is hiding, spade raised: Hesk, the village gravedigger. He came down after the dead began walking out of his graves, and has been too frightened to go back up.',
    options: {
      take: {
        label: 'Bring him along', desc: 'He follows at a distance and tends you in camp: after every room, each hero gets 4 HP more back.',
        news: 'Hesk shoulders his spade and follows. “I’ve buried worse than you lot,” he says, not unkindly.',
      },
      send: {
        label: 'Show him the way out', desc: 'He presses his savings on you: 25 gold.',
        news: 'Hesk climbs back toward the light, and leaves you his purse: 25 gold.',
      },
    },
  },
  journal: {
    after: 'sanctum',
    title: 'Morvath’s Journal',
    text: 'Among Morvath’s things lies a journal bound in grey skin. Its last pages name the others who serve the same hunger: a wight, a banshee, a mummy lord, and something in a labyrinth that was never dead at all.',
    options: {
      keep: {
        label: 'Read on', desc: 'A page marks a hidden study on the way to the Barrow: it shows on the map. The journal stays in your pack.',
        news: 'You read until the candle gutters. A page marks a hidden study past the catacombs, reached through the vault or the cistern.',
      },
      burn: {
        label: 'Burn it', desc: 'What it knows dies with it. The party’s spirits lift: two potions, shared out.',
        news: 'The pages curl and the smoke smells of graves. Tucked in the spine were two potions of healing.',
      },
    },
  },
  hesk: {
    after: 'barrow',
    when: { gravedigger: 'take' },
    title: 'The Old Lord',
    text: 'Hesk kneels by Varek’s broken crown. “My family has buried his line for six generations,” he says. “I knew his face.” His hands are shaking.',
    options: {
      stay: {
        label: 'Ask him to stay', desc: 'He keeps tending you after every room, to the end of the road.',
        news: 'Hesk wipes his eyes and picks up his spade. “Someone has to bury the rest of them properly.”',
      },
      home: {
        label: 'Let him take the crown home', desc: 'He goes to bury it in the village churchyard, and leaves you his remedies: a potion for every hero. No more tending.',
        news: 'Hesk wraps the crown in his coat and goes. He leaves a potion for every hero.',
      },
    },
  },
  lament: {
    after: 'throne',
    title: 'Ysolde’s Lament',
    text: 'As Ysolde fades, her wail becomes a name: Corin. In the dust where she stood lies a silver locket, a boy’s face painted inside.',
    options: {
      vow: {
        label: 'Promise to find him', desc: 'Keep the locket. At the end of the road, Corin may yet be found.',
        news: 'You close the locket and make a promise to a ghost that is no longer there to hear it.',
      },
      sell: {
        label: 'Keep the silver', desc: 'The pedlar will pay well for it: 40 gold.',
        news: 'The locket is heavy, good silver. 40 gold, near enough.',
      },
    },
  },
  bargain: {
    after: 'tomb',
    when: { journal: 'keep' },
    title: 'The Journal Speaks',
    text: 'With Nekhet gone, the journal in your pack grows warm, and a dry voice you last heard in the Sanctum speaks from its pages. “The minotaur is beyond you,” Morvath says. “Carry me down, and I will see you rich.”',
    options: {
      refuse: {
        label: 'Throw it into the dark', desc: 'No bargain. The journal is gone for good.',
        news: 'The journal falls into a crack in the floor, still talking. Then it isn’t.',
      },
      bargain: {
        label: 'Strike the bargain', desc: 'Gold seeps from its pages: 100 gold. It stays in your pack.',
        news: 'Old coins slide from between the pages, 100 gold of them. The journal stays warm against your back.',
      },
    },
  },
};

/** Gold each answer gives. */
const GOLD = { 'gravedigger:send': 25, 'lament:sell': 40, 'bargain:bargain': 100 };
/** Potions: how many, shared out to whoever carries fewest, or 'each'. */
const POTIONS = { 'journal:burn': 2, 'hesk:home': 'each' };
/** The HP Hesk's tending gives each hero after a room. */
export const TENDING = 4;

const answers = (state) => state?.story ?? {};

/** True when every answer in `need` ({ scene: option }) was given. */
export const storyHas = (state, need) => Object.entries(need ?? {}).every(([k, v]) => answers(state)[k] === v);

/** The scene waiting at camp, or null: the one after the room the party is at, not yet answered. */
export function pendingScene(state) {
  if (!state || state.endless || state.done || !state.at) return null;
  for (const [id, s] of Object.entries(SCENES)) {
    if (s.after === state.at && !(id in answers(state)) && storyHas(state, s.when)) return id;
  }
  return null;
}

/** Why option `opt` of scene `id` can't be chosen now, or null. */
export function sceneProblem(state, id, opt) {
  if (!SCENES[id]?.options[opt]) return 'No such choice';
  if (pendingScene(state) !== id) return 'Not now';
  return null;
}

/** Choose option `opt` in scene `id`. Returns { state, report: { scene, option, gold, potions } }. */
export function takeScene(prev, id, opt) {
  const problem = sceneProblem(prev, id, opt);
  if (problem) throw new Error(problem);
  const state = structuredClone(prev);
  state.story = { ...answers(state), [id]: opt };
  const key = `${id}:${opt}`;
  const gold = GOLD[key] ?? 0;
  if (gold) state.gold = (state.gold ?? 0) + gold;
  const codes = Object.keys(state.party);
  let potions = 0;
  if (POTIONS[key] === 'each') {
    for (const c of codes) state.party[c].potions++;
    potions = codes.length;
  } else if (POTIONS[key]) {
    for (let i = 0; i < POTIONS[key]; i++) {
      const c = codes.reduce((a, b) => (state.party[b].potions < state.party[a].potions ? b : a));
      state.party[c].potions++;
      potions++;
    }
  }
  return { state, report: { scene: id, option: opt, gold, potions } };
}

/** Is Hesk following the party now? */
export const heskTends = (state) => !state?.endless && answers(state).gravedigger === 'take' && answers(state).hesk !== 'home';

/** A saved `story`, checked: known scenes and options only (anything else is dropped). */
export function cleanStory(story) {
  if (!story || typeof story !== 'object') return undefined;
  const out = Object.fromEntries(Object.entries(story).filter(([id, opt]) => Object.hasOwn(SCENES, id) && typeof opt === 'string' && Object.hasOwn(SCENES[id].options, opt)));
  return Object.keys(out).length ? out : undefined;
}

/** The last room's outro, with how each thread the run followed ended. */
export function storyOutro(state, base = '') {
  const a = answers(state);
  const lines = [base];
  if (a.lament === 'vow') lines.push('Deep in Tharok’s maze, a boy’s name is cut into the wall a hundred times: Corin. You hang Ysolde’s locket beneath it, and far above, a wail you had learned to dread falls silent for good.');
  if (a.journal === 'burn') lines.push('Morvath’s secrets went up in smoke in the Sanctum; no one will raise the dead from them again.');
  if (a.bargain === 'refuse') lines.push('Morvath’s journal lies at the bottom of the dark, where no one will ever read it.');
  if (a.bargain === 'bargain') lines.push('But the journal in your pack is still warm, and on quiet nights it whispers. Morvath is patient.');
  if (a.gravedigger === 'take' && a.hesk !== 'home') lines.push('Hesk leads you up into the daylight, then goes back down with his spade to bury the last of the dead, slowly and carefully, as they should have been buried all along.');
  if (a.hesk === 'home') lines.push('In the village churchyard Hesk has dug a proper grave for Varek’s crown, and has the ale waiting.');
  if (a.gravedigger === 'send') lines.push('In the village, Hesk tells anyone who’ll listen that you saved his life.');
  return lines.filter(Boolean).join(' ');
}
