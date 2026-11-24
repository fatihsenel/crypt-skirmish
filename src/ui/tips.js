// Tips for new players: short hints that pop up during the first fights, each at the
// moment it's useful, and each only once. They're optional: a switch on the title screen
// turns them on or off (on unless the player turned them off), "Turn tips off" on any tip
// does the same, and turning them back on from the title screen shows them all again.
//
// main.js reports what happens (tips.notice(event, ctx)); the first unseen tip that fits
// is shown, replacing any tip still open, since the player has moved on.

const STORAGE_KEY = 'crypt-skirmish:tips';

/** What the player can see right now, from main.js. */
// ctx: { unit, cmd, chestInSight, brazierNext, leverNext, waterInSight, chasmInSight, edgeFoe, foeNext,
//        foesComing, hurtAllyNext, dyingAlly, paralysed, petrified, rules, touch, report }
const click = (ctx, word = 'click') => (ctx.touch ? word.replace('click', 'tap').replace('Click', 'Tap') : word);

/**
 * In order of priority: when one event fits several, the first unseen one wins and the
 * rest wait for a later turn, so the party isn't buried in text.
 */
export const TIPS = [
  {
    id: 'move',
    on: 'heroTurn',
    text: (c) => `It’s <b>${c.unit.name}</b>’s turn: the gold ring and the lit portrait at the top show who acts. ` +
      `Blue tiles are where they can walk; ${click(c)} one to move` +
      (c.touch ? ' (tap once to see the path, again to go).' : '. Gold dots show the path first.'),
  },
  {
    id: 'potion',
    on: 'heroTurn',
    when: (c) => c.unit.hp <= c.unit.maxHp / 2 && c.unit.potions > 0,
    text: (c) => `<b>${c.unit.name}</b> is badly hurt. The <b>Potion</b> button heals 2d4 + 2 HP, using their action. ` +
      (c.rules >= 2 ? 'A hero at 0 HP is dying, and any healing brings them back.' : 'A hero at 0 HP falls, and is back up after the fight.'),
  },
  {
    id: 'dying',
    on: 'heroTurn',
    when: (c) => !!c.dyingAlly,
    text: (c) => `<b>${c.dyingAlly.name}</b> is <b>dying</b>. As each of their turns comes round they roll a death save: ` +
      '10 or more is a success, and the pips on their portrait count them. Three failures and they’re out for the fight. ' +
      'Any healing gets them back up: a healing spell, Lay on Hands, or <b>Give potion</b> from next to them.',
  },
  {
    id: 'paralysis',
    on: 'heroTurn',
    when: (c) => !!c.paralysed,
    text: (c) => `<b>${c.paralysed.name}</b> is <b>paralysed</b> by a ghoul’s claws: no move, action or reaction, ` +
      'and any hit from next to them is a critical. A CON save as each of their turns starts ends it. Keep the ghouls off them.',
  },
  {
    id: 'petrified',
    on: 'heroTurn',
    when: (c) => !!c.petrified,
    text: (c) => `<b>${c.petrified.name}</b> is turned to <b>stone</b> by a basilisk’s bite: no move, action or reaction ` +
      'until their next turn is over, STR and DEX saves fail, and hits on them come easy. It wears off by itself. Keep the basilisks off them.',
  },
  {
    id: 'push',
    on: 'heroTurn',
    when: (c) => !!c.edgeFoe,
    text: (c) => `<b>${c.edgeFoe.name}</b> stands at the chasm’s edge, right next to <b>${c.unit.name}</b>. ` +
      `<b>Push</b> (one attack: Athletics against its STR or DEX) sends it over, gone for good. ${click(c, 'Click')} Push, then the foe.`,
  },
  {
    id: 'chest',
    on: 'heroTurn',
    when: (c) => c.chestInSight,
    text: (c) => `There’s a <b>chest</b> in sight. Walk next to it and ${click(c)} it to open it: free, once per turn. ` +
      'Loot goes into the pack, and you hand it out at camp.',
  },
  {
    id: 'spells',
    on: 'heroTurn',
    when: (c) => c.unit.spells?.length > 0 && Object.keys(c.unit.slots ?? {}).length > 0,
    text: (c) => `<b>${c.unit.name}</b> has spells: the buttons under <b>Spells</b>. Pick one, then ${click(c)} a target. ` +
      'The ◆ marks are spell slots; they come back when the party rests.',
  },
  {
    id: 'brazier',
    on: 'heroTurn',
    when: (c) => c.brazierNext,
    text: (c) => `<b>${c.unit.name}</b> stands by a lit <b>brazier</b>. ${click(c, 'Click')} it to tip it over (your action): ` +
      'its coals spill on the tiles beyond, burn whoever stands there, and keep burning for 3 turns.',
  },
  {
    id: 'lever',
    on: 'heroTurn',
    when: (c) => c.leverNext,
    text: (c) => `<b>${c.unit.name}</b> stands by a <b>lever</b>. ${click(c, 'Click')} it (free, once a turn) to drop the portcullis: ` +
      'its bars stop anyone walking through, but not seeing or shooting. Pull it again to raise it. The clang wakes the room.',
  },
  {
    id: 'water',
    on: 'heroTurn',
    when: (c) => c.waterInSight,
    text: () => 'The dark tiles are <b>shallow water</b>: wading costs double movement. Flying foes skim over it.',
  },
  {
    id: 'chasm',
    on: 'heroTurn',
    when: (c) => c.chasmInSight,
    text: (c) => 'The black gaps are a <b>chasm</b>: no one crosses it, not even a flier, but you can see and shoot over it.' +
      (c.rules >= 3 ? ' A foe standing at its edge can be sent over with <b>Push</b>.' : ''),
  },
  {
    id: 'feed',
    on: 'heroTurn',
    when: (c) => c.hurtAllyNext && c.unit.potions > 0,
    text: (c) => `An ally next to <b>${c.unit.name}</b> is badly hurt. <b>Give potion</b> (under <b>More</b>) pours one of ${c.unit.name}’s potions into them, ` +
      'using the action: handy when theirs are gone.',
  },
  {
    id: 'ready',
    on: 'heroTurn',
    when: (c) => c.foesComing && !c.unit.actionUsed,
    text: (c) => 'Foes are hunting the party, out of sight. <b>Ready</b> holds an attack for their turn: ' +
      `${click(c)} Ready, then an attack. A sword strikes the first foe to step into reach, a bow or Fire Bolt the first to step into view.`,
  },
  {
    id: 'teamwork',
    on: 'heroTurn',
    when: (c) => c.foeNext,
    text: () => 'With a foe next to you there’s more than hitting it. <b>Help</b> distracts it, so an ally’s next attack has advantage; ' +
      '<b>Grapple</b> pins it in place, so it can’t reach the rest of the party. Both are under <b>More</b>.',
  },
  {
    id: 'attack',
    on: 'acted',
    when: (c) => c.cmd.type === 'move' && !c.unit.actionUsed,
    text: (c) => `Now <b>attack</b>: ${click(c)} an enemy on a red tile. Before you commit, the line above the buttons ` +
      'shows the chance to hit and the damage, and its HP bar shades what a hit would take off. Walls, barrels and crates between you give it cover.',
  },
  {
    id: 'concentration',
    on: 'acted',
    when: (c) => c.cmd.type === 'spell' && !!c.unit.concentrating,
    text: (c) => `<b>${c.unit.name}</b> is <b>concentrating</b> on that spell, and it lasts while they do. ` +
      'Taking damage calls for a CON save to hold on; dropping, being paralysed or casting another such spell ends it.',
  },
  {
    id: 'end',
    on: 'acted',
    when: (c) => c.cmd.type !== 'move' && c.cmd.type !== 'chest',
    text: (c) => 'Each turn a hero gets a <b>move</b> and an <b>action</b>, and some have a bonus action too. ' +
      `Anything not used is lost: ${c.touch ? 'tap' : 'press'} <b>End turn</b>${c.touch ? '' : ' (or Space)'} when you’re done.`,
  },
  {
    id: 'provoke',
    on: 'provoke',
    text: () => 'Red dots on the path mean you’d leave an enemy’s reach, and it gets a free swing at you ' +
      '(an <b>opportunity attack</b>). <b>Disengage</b> (under <b>More</b>) lets a hero walk away safely, at the cost of their action.',
  },
  {
    id: 'camp',
    on: 'camp',
    when: (c) => !!c.report && !c.report.rest,
    text: () => 'Back at <b>camp</b>. The party has rested and shared the XP. ' +
      'Give loot from the pack to a hero, then pick a gold room on the map and enter it.',
  },
];

/** The tip to show for this event, or null. Pure: used by Tips and the tests. */
export function pickTip(event, ctx, seen) {
  return TIPS.find((t) => t.on === event && !seen.has(t.id) && (!t.when || t.when(ctx))) ?? null;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return { on: s?.on ?? true, seen: new Set(s?.seen ?? []) };
  } catch {
    return { on: true, seen: new Set() };
  }
}

export class Tips {
  constructor() {
    const s = load();
    this.on = s.on;
    this.seen = s.seen;
    this.el = null;
    this.current = null;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ on: this.on, seen: [...this.seen] }));
    } catch {
      /* storage unavailable: tips just come back next visit */
    }
  }

  /** Turning tips on from the title screen shows them all again, from the start. */
  setOn(on) {
    if (on && !this.on) this.seen.clear();
    this.on = on;
    if (!on) this.hide();
    this.save();
  }

  notice(event, ctx) {
    if (!this.on) return;
    const tip = pickTip(event, ctx, this.seen);
    if (!tip) return;
    this.seen.add(tip.id);
    this.save();
    this.show(tip.text(ctx));
  }

  mount() {
    if (this.el) return this.el;
    const el = (this.el = document.createElement('div'));
    el.id = 'tip';
    el.setAttribute('role', 'status');
    el.innerHTML = `<p class="tip-text"></p>
      <div class="tip-buttons">
        <button type="button" class="tip-off">Turn tips off</button>
        <button type="button" class="tip-ok">Got it</button>
      </div>`;
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.tip-ok')) this.hide();
      if (ev.target.closest('.tip-off')) this.setOn(false);
    });
    document.getElementById('app').append(el);
    // Sit 12px above the action bar, wherever it is: its height changes with each hero, and on
    // a phone it's lifted clear of the home bar (safe-area-inset-bottom).
    const bar = document.getElementById('actionbar');
    const app = document.getElementById('app');
    this.place = () => {
      el.style.setProperty('--above', bar.offsetParent // no bar (the camp): near the bottom
        ? `${Math.round(app.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 12)}px`
        : 'calc(26px + env(safe-area-inset-bottom))');
    };
    new ResizeObserver(this.place).observe(bar);
    window.addEventListener('resize', this.place);
    this.place();
    return el;
  }

  show(html) {
    const el = this.mount();
    el.querySelector('.tip-text').innerHTML = html;
    this.place();
    el.classList.add('show');
    this.current = html;
  }

  hide() {
    this.el?.classList.remove('show');
    this.current = null;
  }
}

export const tips = new Tips();
