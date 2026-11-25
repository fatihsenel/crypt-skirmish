// Plays back what the rules engine already resolved: attacks, moves, chests, actions and
// spells as animations, effects, floating text and sound. The engine has moved on by the time
// these run; they only show it. `play(unit, kind, result)` is the way in.

import { ACTIONS } from './game/abilities.js';
import { ITEMS } from './game/items.js';
import { shootProjectile, floatText } from './render/unitView.js';
import { rollBadge, attackRoll, saveRoll } from './render/rollBadge.js';
import { lobFx, missileFx, coneFx, mistFx, shieldFx, healFx, alertFx, radiantFx, turnFx, raiseFx, fireballFx, iceStormFx, hitFx, fireBurstFx, d20Fx, lightningFx, spiritWeapon, burstFx, SHATTER_TINT, ENTANGLE_TINT, STORM_TINT, CAVE_TINT, FOG_TINT, GREASE_TINT } from './render/effects.js';
import { wait, tween, easeOut } from './render/tween.js';
import { JELLY_SCALE } from './render/models.js';
import { sfx } from './audio/sfx.js';
import { voices } from './audio/voices.js';
import { attackMoment, spellMoment, lineFor, downSpeaker, replySpeaker, lastWordsSpeaker, canSay, SPEECH } from './speech.js';
import { hear } from './game/bestiary.js';
import { speak, speaking } from './render/speechBubble.js';

/**
 * The controller's view of the fight: `stage`, `hud`, `settings` and `spiritWeapons` (the
 * clerics' weapons by caster id), and as functions `game()`, `board()`, `view(u)`, `addView(u)`,
 * `unseen(u)`, `inView(tile)`, `selected()`, `busy()`, `touching()`, `autoplaying()`,
 * `replaying()`, `flushReveals()`, `syncStatus()` and `keepInView(u)`.
 */
export function createAnimations(app) {
  const { stage, hud, settings, spiritWeapons, owls, view, addView, unseen, inView, flushReveals, syncStatus, keepInView } = app;
  let risings = []; // Nekhet's house rising, shown once the blow that bloodied him has played
  const attacked = new WeakMap(); // each fight's attackers so far: a hero's first attack speaks
  const recentLines = new Map(); // the last line of each kind of speaker, so it doesn't repeat
  const spokeIn = new WeakMap(); // each fight's monster kinds -> the round one last spoke in (a pack takes turns)

  const winced = new WeakSet(); // figures that have said they're badly hurt (once a fight)
  const fled = new WeakSet(); // turned monsters that have cried out as they ran
  const seen = (u) => !unseen(u) && !!view(u)?.group.visible;

  /**
   * `unit` says a line for `moment` in a speech bubble (speech.js), if it's in sight. A named
   * foe's minion in sight answers it now and then, once the boss has finished. A monster's
   * line goes in the bestiary (`hear`). Returns whether it spoke.
   */
  function quip(unit, moment, name) {
    if (!settings.bubbles || !unit || !seen(unit)) return false;
    const line = lineFor(unit, moment, { name, recent: recentLines });
    const shown = line ? speak(view(unit), line) : 0;
    if (!shown) return false;
    if (unit.team === 'monsters') hear(unit.code, line);
    if (SPEECH.NAMED.has(unit.code) && ['intro', 'attack', 'cast'].includes(moment) && Math.random() < 0.5) {
      const fight = app.game();
      const minion = replySpeaker(unit, fight.units, seen);
      if (minion) setTimeout(() => { if (app.game() === fight && minion.alive && !speaking()) quip(minion, 'reply'); }, shown + 150);
    }
    return true;
  }

  /** Blessed Healer: the cleric's own small heal, shown just above them. */
  function blessedHealerFx(caster, amount) {
    if (!amount) return;
    floatText(stage.scene, { x: caster.x, z: caster.z - 0.5 }, `+${amount}`, 'heal');
    view(caster).updateHp();
  }

  /**
   * Plays back an attack the engine already resolved.
   * `at` overrides the target's position (opportunity attacks happen mid-move).
   */
  async function animateAttack(r, at = r.target) {
    const { attacker, target, attack } = r;
    const av = view(attacker);
    const tv = view(target);
    const pos = { x: at.x, z: at.z };
    let reaction = null;
    const fight = app.game();
    if (!attacked.has(fight)) attacked.set(fight, new Set());
    const first = !attacked.get(fight).has(attacker.id);
    attacked.get(fight).add(attacker.id);
    const landed = r.hit && !r.shielded;
    if (!spokeIn.has(fight)) spokeIn.set(fight, new Map());
    const kindSpoke = spokeIn.get(fight).get(attacker.code) === fight.round;
    const moment = attackMoment({ attacker, target, hit: landed, crit: r.crit, killed: landed && !target.alive, first, kindSpoke });
    if (moment === 'attack' && attacker.team === 'monsters') spokeIn.get(fight).set(attacker.code, fight.round);
    if (moment === 'first' || moment === 'attack') quip(attacker, moment);
    // The roll pops up over the attacker; on the hero's own turn the player throws it.
    // (Settings can turn both off; then only natural 20s and 1s get a die, thrown on the board.)
    if (!unseen(attacker)) {
      if (settings.rolls || throwsOwn(r)) {
        if (throwsOwn(r)) {
          // The hint repeats it, in case the figure is behind a panel or off screen.
          hud.hint(app.touching() ? `${attacker.name}’s ${attack.name}: tap anywhere to roll the d20`
            : `${attacker.name}’s ${attack.name}: click anywhere or press Space to roll the d20`);
          await rollBadge(stage.scene, attacker, badgeHeight(attacker), attackRoll(r), throwPrompt());
          hud.hint('');
          hud.releaseLog();
        } else {
          sfx.dice();
          await rollBadge(stage.scene, attacker, badgeHeight(attacker), attackRoll(r));
        }
      } else if (r.d20 === 20 || r.d20 === 1) {
        sfx.dice();
        await d20Fx(stage.scene, attacker, r.d20);
      }
    }
    const onImpact = () => {
      if (r.mods?.adv.some((a) => a.startsWith('help from'))) tv.updateStatus(); // the Help is used up
      if (attack.projectile === 'fire') fireBurstFx(stage.scene, pos);
      if (r.inspired) {
        floatText(stage.scene, { x: attacker.x, z: attacker.z - 0.6 }, `Inspired +${r.inspired.total}`, 'spell');
        view(attacker).updateStatus();
      }
      if (r.cutting) {
        sfx.lute(false);
        floatText(stage.scene, r.cutting.by, `Cutting Words −${r.cutting.total}`, 'spell');
        view(r.cutting.by).updateStatus();
      }
      if (r.shielded) {
        sfx.shield();
        shieldFx(stage.scene, pos);
        floatText(stage.scene, pos, 'Shield!', 'spell');
        tv.updateStatus();
        hud.renderActionBar(app.game(), { selected: app.selected(), busy: app.busy() });
      } else if (r.hit) {
        sfx.hit(target.code, { crit: r.crit, fire: attack.projectile === 'fire' });
        hitFx(stage.scene, { ...pos, undead: target.undead }, attacker, { crit: r.crit });
        if (r.crit) stage.shake(0.3, 420);
        if (r.uncanny) floatText(stage.scene, { x: pos.x, z: pos.z - 0.6 }, 'Uncanny Dodge ½', 'spell');
        if (r.resisted) floatText(stage.scene, { x: pos.x, z: pos.z - 0.6 }, r.target.swarm ? 'Swarm ½' : 'Rage ½', 'spell');
        if (r.deflect) floatText(stage.scene, { x: pos.x, z: pos.z - 0.6 }, `Deflected −${r.deflect.total}`, 'spell');
        if (r.bonus) floatText(stage.scene, { x: attacker.x, z: attacker.z - 0.6 }, BONUS_STRIKE[r.bonus], 'spell');
        if (r.charge) floatText(stage.scene, { x: attacker.x, z: attacker.z - 0.6 }, 'Charge!', 'crit');
        for (const t of [r.stun, r.topple, r.knock].filter(Boolean)) {
          if (!target.alive) break;
          wait(t === r.stun ? 350 : 500).then(() => floatText(stage.scene, { x: pos.x, z: pos.z - 0.5 }, t.success ? 'Resists' : CONDITION_FLOAT[t.condition], t.success ? 'miss' : 'cond'));
          tv.updateStatus();
        }
        if (r.smite) {
          sfx.radiant();
          radiantFx(stage.scene, pos);
          floatText(stage.scene, { x: pos.x, z: pos.z - 0.6 }, 'Divine Smite!', 'spell');
        }
        const hunter = [r.mark && (r.mark.spell === 'hex' ? 'Hex' : 'Hunter’s Mark'), r.colossus && 'Colossus Slayer'].filter(Boolean).join(' · ');
        if (hunter) floatText(stage.scene, { x: pos.x, z: pos.z - 0.6 }, hunter, 'spell');
        if (attack.damage) floatText(stage.scene, pos, r.crit ? `CRIT −${r.damage}` : `−${r.damage}`, r.crit ? 'crit' : 'dmg');
        tv.updateHp();
        if (r.rider && target.alive) {
          const text = r.rider.success ? 'Resists' : CONDITION_FLOAT[r.rider.condition];
          wait(350).then(() => floatText(stage.scene, { x: pos.x, z: pos.z - 0.5 }, text, r.rider.success ? 'miss' : 'cond'));
          tv.updateStatus();
        }
        reaction = r.thrown?.push?.fall ? null : damageReaction(target); // over the edge: playThrown shows the fall
        if (moment === 'kill' || moment === 'crit') quip(attacker, moment);
      } else {
        sfx.miss();
        floatText(stage.scene, pos, 'Miss', 'miss');
      }
    };
    if (attack.projectile) {
      await av.shoot(pos, attack.projectile, () => shootProjectile(stage.scene, attacker, pos, attack.projectile), onImpact);
    } else {
      await av.swing(pos, onImpact);
    }
    await reaction;
    if (r.split) await playSplit(target, r.split);
    if (r.thrown) await playThrown(r);
    if (r.rebuke) await playRebuke(r.rebuke);
    if (r.barbs) await playBarbs(r.barbs);
    if (r.caveIns) await playCaveIns(r.caveIns);
    hud.renderInitiative(app.game());
  }

  /** Rules 10: cracked ceilings come down: dust, the saves, the hurt, and rubble left on the floor. */
  async function playCaveIns(list) {
    for (const c of list) {
      const b = app.board();
      b.setCeilings(app.game().ceilings);
      sfx.fall();
      stage.shake(0.35, 500);
      if (inView(c)) floatText(stage.scene, { x: c.x, z: c.z - 0.5 }, 'Cave-in!', 'warn');
      await turnFx(stage.scene, c, 1.5, CAVE_TINT);
      b.addRubble(c.tiles);
      await showSaves(c.saves, 'DEX', c.dc);
      await Promise.all(c.saves.map((s) => {
        if (unseen(s.unit)) { view(s.unit)?.updateHp(); if (!s.unit.alive) view(s.unit)?.die(); return null; }
        floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage} · Prone!`, 'crit');
        if (s.damage) hitFx(stage.scene, s.unit);
        view(s.unit)?.updateStatus();
        return damageReaction(s.unit);
      }));
    }
  }

  /** Rules 6: an ochre jelly struck in two: it shrinks, and the new half oozes out beside it. */
  async function playSplit(jelly, spawn) {
    const v = view(jelly);
    const nv = addView(spawn);
    nv.figure.rotation.y = v.figure.rotation.y;
    const shown = !unseen(jelly);
    if (shown) {
      sfx.hit('j');
      floatText(stage.scene, { x: jelly.x, z: jelly.z - 0.5 }, 'Splits!', 'cond');
      burstFx(stage.scene, jelly, { colors: [0xc8962a, 0xe0b040, 0x8a6014], count: 12, speed: 1, size: 0.05, y: 0.25, life: 600 });
    }
    const from = v.model.root.scale.x, to = JELLY_SCALE[jelly.size] ?? from;
    const end = JELLY_SCALE[spawn.size] ?? to;
    nv.model.root.scale.setScalar(0.01);
    const pos = nv.group.position;
    await tween(shown ? 450 : 1, (t) => {
      v.model.root.scale.setScalar(from + (to - from) * t);
      nv.model.root.scale.setScalar(Math.max(0.01, end * t));
      pos.x = jelly.x + (spawn.x - jelly.x) * t;
      pos.z = jelly.z + (spawn.z - jelly.z) * t;
    }, easeOut);
    v.updateHp();
    nv.updateHp?.();
    syncStatus?.();
    hud.renderInitiative(app.game());
  }

  /**
   * Rules 5: pushed into a stairwell: a stagger onto the stair, a tumble down the flight to the
   * stair at its foot, the knock and the damage there, then prone.
   */
  async function tumbleDown(target, push) {
    const v = view(target);
    const board = app.board();
    if (push.stair.x !== push.from.x || push.stair.z !== push.from.z) await v.shoved(push.stair.x, push.stair.z);
    if (push.crash) { // rules 6: the cracked floor gives way under them
      board.breakCrack?.(push.stair.x, push.stair.z);
      if (inView(push.stair)) burstFx(stage.scene, push.stair, { colors: [0x4b423a, 0x6b6259, 0x2a241f], count: 18, speed: 1.4, size: 0.07, y: 0.05, life: 700 });
      sfx.fall();
      stage.shake(0.05, 220);
      await v.takeStairs(push.stair, push.to, { dx: 0, dz: 0, down: true }, null, () => {}, { tumble: true });
    } else {
      sfx.stairway(true);
      await v.takeStairs(push.stair, push.to, board.flightAt?.(push.stair.x, push.stair.z), board.flightAt?.(push.to.x, push.to.z), () => {}, { tumble: true });
    }
    if (inView(push.to)) burstFx(stage.scene, push.to, { colors: [0x6b6259, 0x8a8076, 0x4d463f], count: 14, speed: 1.2, size: 0.06, y: 0.08, life: 700 });
    sfx.hit(target.code);
    stage.shake(0.04, 200);
    if (push.tumble) floatText(stage.scene, push.to, `−${push.tumble.damage}`, 'crit');
    await damageReaction(target);
    v.updateStatus();
    keepInView(push.to);
  }

  /** Rules 4: thrown back by a gargoyle or Tharok: a stagger, coals, the chasm, or a grab at its edge. */
  async function playThrown({ target, thrown: t }) {
    const v = view(target);
    if (t.success) {
      floatText(stage.scene, { x: target.x, z: target.z - 0.5 }, 'Holds firm', 'miss');
      return;
    }
    if (t.edge?.success) {
      floatText(stage.scene, { x: target.x, z: target.z - 0.5 }, 'Catches the edge!', 'cond');
      sfx.scrabble();
      v.updateStatus();
      return;
    }
    if (!t.push) return;
    if (t.push.fall) {
      floatText(stage.scene, t.push.from, 'Over the edge!', 'crit');
      await v.shoved((t.push.from.x + t.push.to.x) / 2, (t.push.from.z + t.push.to.z) / 2);
      if (!unseen(target)) voices.bark(target, 'die');
      sfx.fall();
      if (target.team === 'heroes') quip(downSpeaker(target, app.game().units, seen), 'down', target.name);
      await v.plunge();
      stage.shake(0.06, 260); // far below, it lands
      return;
    }
    if (t.push.stair) {
      floatText(stage.scene, t.push.from, t.push.crash ? 'Through the floor!' : 'Down the stairs!', 'crit');
      await tumbleDown(target, t.push);
      return;
    }
    floatText(stage.scene, { x: target.x, z: target.z - 0.5 }, 'Thrown back!', 'cond');
    await v.shoved(t.push.to.x, t.push.to.z);
    v.updateStatus();
    if (t.push.burn) {
      sfx.fireImpact();
      floatText(stage.scene, target, `Burns −${t.push.burn.damage}`, 'crit');
      hitFx(stage.scene, target);
      await damageReaction(target);
    }
  }

  /** A Barbed elite's spines cut the foe that struck it in melee. */
  async function playBarbs({ target, damage }) {
    floatText(stage.scene, { x: target.x, z: target.z - 0.5 }, `Barbs −${damage}`, 'crit');
    hitFx(stage.scene, target);
    view(target)?.updateHp();
    await damageReaction(target);
  }

  /** Hellish Rebuke: the hurt warlock answers with flames around the attacker. */
  async function playRebuke(r) {
    const { caster, target } = r;
    if (!unseen(target) || !unseen(caster)) {
      floatText(stage.scene, { x: caster.x, z: caster.z - 0.5 }, 'Hellish Rebuke!', 'spell');
      view(caster)?.updateStatus();
      await view(caster).cast(target, async () => {
        sfx.fireCone();
        await shootProjectile(stage.scene, caster, target, 'fire');
        fireBurstFx(stage.scene, target);
      });
      await showSaves([{ ...r.save, unit: target }], 'DEX', r.dc);
    }
    floatText(stage.scene, target, r.save.success ? `Save −${r.damage}` : `−${r.damage}`, 'crit');
    if (r.damage) hitFx(stage.scene, target);
    view(target)?.updateHp();
    await damageReaction(target);
  }

  /** An attack on a hero's own turn, which the player throws (Settings can turn it off). */
  const throwsOwn = (r) => settings.throwDice && !app.autoplaying() && !app.replaying() && r.attacker.team === 'heroes'
    && app.game().current === r.attacker && !unseen(r.attacker);

  /**
   * The player's throw: a click or tap anywhere (but the top buttons and open panels), or
   * Space or Enter. That press does nothing else.
   */
  function throwPrompt() {
    return {
      label: app.touching() ? 'Tap to roll' : 'Click to roll',
      thrown: () => new Promise((resolve) => {
        const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
        const done = (ev) => {
          swallow(ev);
          window.removeEventListener('pointerdown', onPointer, true);
          window.removeEventListener('keydown', onKey, true);
          // The press's click (and a touch's mouse emulation) shouldn't move or attack.
          window.addEventListener('click', swallow, true);
          setTimeout(() => window.removeEventListener('click', swallow, true), 450);
          sfx.dice();
          resolve();
        };
        const onPointer = (ev) => {
          if (ev.button !== 0 || ev.target.closest('#audio, #settings, #log, #help, #initiative')) return;
          done(ev);
        };
        const onKey = (ev) => {
          if ((ev.code === 'Space' || ev.code === 'Enter') && !ev.repeat) done(ev);
        };
        window.addEventListener('pointerdown', onPointer, true);
        window.addEventListener('keydown', onKey, true);
      }),
    };
  }

  /** Just above a unit's name label. */
  const badgeHeight = (unit) => (view(unit)?.model.height ?? 1.6) + 0.2;

  /**
   * Saving throws over everyone in sight who rolled one, all at once. A crowd (three or more)
   * gets just the die and the result, so the badges don't pile up.
   */
  function showSaves(saves, stat, dc) {
    const shown = settings.rolls ? saves.filter((s) => !unseen(s.unit)) : [];
    if (!shown.length) return Promise.resolve();
    sfx.dice();
    return Promise.all(shown.map((s) => {
      const roll = saveRoll(s, stat, dc);
      if (shown.length > 2) roll.line = '';
      return rollBadge(stage.scene, s.unit, badgeHeight(s.unit), roll);
    }));
  }

  const BONUS_STRIKE = { flurry: 'Flurry of Blows', martial: 'Martial Arts', frenzy: 'Frenzy' };
  const CONDITION_FLOAT = { prone: 'Prone!', poisoned: 'Poisoned!', frightened: 'Frightened!', restrained: 'Webbed!', rotting: 'Rotting!', mocked: 'Mocked!', paralyzed: 'Paralysed!', stunned: 'Stunned!', petrified: 'Turned to stone!', burning: 'Burning!', engulfed: 'Engulfed!', pit: 'In a pit!' };

  function damageReaction(unit) {
    const v = view(unit);
    v.updateHp();
    // A hero falls: the nearest friend in sight calls out.
    if (unit.team === 'heroes' && !unit.alive && !v.down && !unseen(unit)) {
      quip(downSpeaker(unit, app.game().units, seen), 'down', unit.name);
    }
    // Under a quarter of its HP, a figure says so, once a fight (most monsters only now and then).
    if (unit.alive && unit.hp <= unit.maxHp / 4 && !winced.has(unit) && canSay(unit, 'hurt')) {
      winced.add(unit);
      if (unit.team === 'heroes' || SPEECH.NAMED.has(unit.code) || Math.random() < 0.4) quip(unit, 'hurt');
    }
    // Heroes grunt when hit; monsters only cry out when they fall.
    if (!unseen(unit) && (!unit.alive || unit.team === 'heroes')) voices.bark(unit, unit.alive ? 'hurt' : 'die');
    if (unit.alive) return v.flinch();
    sfx.death(unit.code);
    return v.die();
  }

  async function animateSteps(unit, steps) {
    for (const step of steps) {
      if (!view(unit)) return; // the game was replaced mid-animation
      switch (step.type) {
        case 'walk': {
          // Out of sight, a monster just arrives where it comes into view (or its end tile).
          let path = step.path;
          if (unit.team === 'monsters') {
            const first = path.findIndex((t) => inView(t));
            const from = first < 0 ? path.length - 1 : Math.max(0, first - 1);
            if (from > 0) {
              view(unit).group.position.set(path[from].x, 0, path[from].z);
              view(unit).faceTowards(path[from].x * 2 - path[from - 1].x, path[from].z * 2 - path[from - 1].z);
              path = path.slice(from);
            }
          }
          await view(unit).moveAlong(path);
          break;
        }
        case 'stairs': { // to the room's other floor; out of sight, a monster just arrives
          const v = view(unit);
          if (unit.team === 'monsters' && !inView(step.from) && !inView(step.to)) {
            v.group.position.set(step.to.x, 0, step.to.z);
            break;
          }
          const where = step.down ? 'down the stairs to the lower hall' : 'up the stairs to the hall above';
          hud.log(`<span class="${unit.team}" data-unit="${unit.id}">${unit.name}</span> goes ${where}.`);
          const flight = (at) => app.board().flightAt?.(at.x, at.z);
          const out = flight(step.from), back = flight(step.to);
          sfx.stairway(step.down);
          await v.takeStairs(step.from, step.to, out, back, (at) => {
            if (inView(at)) burstFx(stage.scene, at, { colors: [0x6b6259, 0x8a8076, 0x4d463f], count: 10, speed: 0.9, size: 0.06, y: 0.08, life: 700 });
            if (at === step.to) sfx.step(unit.code);
          });
          keepInView(step.to);
          break;
        }
        case 'bash': { // rules 8: a monster throws itself at a barred door
          const r = step.result;
          if (r.success) app.board().breakBar(r.x, r.z);
          if (unseen(unit) && !inView(r)) break;
          await view(unit).turnTowards(r.x, r.z);
          sfx.whoosh(true);
          await wait(160);
          sfx.trap();
          stage.shake(r.success ? 0.1 : 0.05, 200);
          burstFx(stage.scene, r, { colors: [0x6b4524, 0x4a2e16, 0x8a6a40], count: r.success ? 18 : 8, speed: r.success ? 1.2 : 0.6, size: 0.045, y: 0.4, life: 500 });
          floatText(stage.scene, r, r.success ? 'Broken!' : 'Holds', r.success ? 'crit' : 'miss');
          await wait(300);
          break;
        }
        case 'door':
          await view(unit).turnTowards(step.x, step.z);
          sfx.door();
          await app.board().openDoor(step.x, step.z);
          break;
        case 'opportunity': {
          const r = step.result;
          sfx.alert();
          alertFx(stage.scene, step.at);
          floatText(stage.scene, r.attacker, 'Opportunity!', 'warn');
          await wait(250);
          await animateAttack(r, step.at);
          break;
        }
        case 'readied': { // stepped into a readied hero's reach or view
        const r = step.result;
        sfx.alert();
        alertFx(stage.scene, step.at);
        const hero = r.attacker ?? r.caster;
        floatText(stage.scene, hero, 'Readied!', 'warn');
        view(hero).updateStatus();
        await wait(250);
        if (r.kind === 'spell') { // aimed where the foe stepped, though it may have walked on since
          const there = Object.assign(Object.create(r.target), step.at);
          const at = (t) => (t === r.target ? there : t);
          await playSpell({ ...r, target: there, rays: r.rays?.map((ray) => ({ ...ray, target: at(ray.target) })) });
        } else await animateAttack(r, step.at);
        break;
      }
      case 'burn': { // walked onto a tipped brazier's coals
          const r = step.result;
          sfx.fireImpact();
          if (unseen(unit)) {
            view(unit).updateHp();
            if (!unit.alive) view(unit).die();
            break;
          }
          floatText(stage.scene, r.unit, `Burns −${r.damage}`, 'crit');
          hitFx(stage.scene, r.unit);
          await damageReaction(r.unit);
          hud.renderInitiative(app.game());
          break;
        }
        case 'caltrops': { // rules 6: walked onto caltrops
          const r = step.result;
          if (unseen(unit)) {
            view(unit).updateHp();
            if (!unit.alive) view(unit).die();
            break;
          }
          floatText(stage.scene, r.unit, r.success ? 'Steps clear' : 'Caltrops −1', r.success ? 'miss' : 'crit');
          if (!r.success) {
            sfx.hit(unit.code);
            await damageReaction(r.unit);
          }
          break;
        }
        case 'slip': { // rules 10: walked onto Grease
          const r = step.result;
          if (unseen(unit)) { view(unit).updateStatus(); break; }
          floatText(stage.scene, r.unit, r.success ? 'Keeps footing' : 'Slips! Prone', r.success ? 'miss' : 'cond');
          if (!r.success) {
            sfx.fall();
            view(r.unit).updateStatus();
            await wait(300);
          }
          break;
        }
        case 'trap': {
          const r = step.result;
          sfx.trap();
          if (unseen(unit)) {
            view(unit).updateHp();
            if (!unit.alive) view(unit).die();
            break;
          }
          await app.board().showTrap(r.trap);
          if (r.pit) { // rules 10: the planks give way
            if (r.success) floatText(stage.scene, r.unit, 'Catches the edge', 'miss');
            else {
              sfx.fall();
              floatText(stage.scene, r.unit, `Falls in −${r.damage}`, 'crit');
              hitFx(stage.scene, r.unit);
              await damageReaction(r.unit);
              view(r.unit).updateStatus();
            }
            hud.renderInitiative(app.game());
            break;
          }
          floatText(stage.scene, r.unit, r.success ? `Save −${r.damage}` : `Trap −${r.damage}`, 'crit');
          hitFx(stage.scene, r.unit);
          await damageReaction(r.unit);
          if (r.prone && r.unit.alive) {
            floatText(stage.scene, r.unit, 'Prone!', 'cond');
            view(r.unit).updateStatus();
          }
          app.board().retractTrap(r.trap);
          hud.renderInitiative(app.game());
          break;
        }
        default:
          throw new Error(`animateSteps: unknown step "${step.type}"`);
      }
    }
  }

  async function playMove(unit, r) {
    await animateSteps(unit, r.steps);
    flushReveals();
    syncStatus();
  }

  async function playChest(unit, r) {
    const { x, z } = r.chest;
    await view(unit).turnTowards(x, z);
    if (r.mimic) {
      // The chest yawns open on a mouthful of teeth and lunges.
      sfx.chest();
      app.board().removeChest(x, z);
      addView(r.mimic);
      floatText(stage.scene, { x, z }, 'Mimic!', 'warn');
      stage.shake(0.25, 350);
      await wait(450);
      if (r.bite?.ok) await animateAttack(r.bite);
      hud.renderInitiative(app.game());
      return;
    }
    sfx.chest();
    await app.board().openChest(x, z);
    const n = r.loot.filter((l) => l === 'potion').length;
    const items = r.loot.filter((l) => l !== 'potion').map((l) => ITEMS[l].name);
    const text = [...(n ? [`+${n} potion${n > 1 ? 's' : ''}`] : []), ...items].join(' · ');
    if (items.length) sfx.discover();
    floatText(stage.scene, { x, z }, text || 'Empty', 'heal');
    await wait(300);
  }

  /** A lever thrown: every portcullis crashes down (with a shake) or grinds back up. */
  async function playLever(unit, r) {
    const { x, z } = r.lever;
    await view(unit).turnTowards(x, z);
    sfx.portcullis(r.down);
    await app.board().setGates(r.down);
    if (r.down) stage.shake(0.1, 220);
    await wait(200);
  }

  /** Rules 9: the owl flies to its perch and harries the foe beside it. */
  async function playOwl(r) {
    const owl = owls?.get(r.unit.id);
    sfx.whoosh();
    if (owl) await owl.flyTo(r.x, r.z);
    if (r.target && !unseen(r.target)) {
      floatText(stage.scene, { x: r.target.x, z: r.target.z - 0.5 }, 'Distracted!', 'cond');
      view(r.target)?.updateStatus();
    }
    await wait(200);
  }

  /** Rules 9: a hero breaks the prisoner's chains; they slip away. */
  async function playFree(unit, r) {
    await view(unit).turnTowards(r.x, r.z);
    sfx.maneuver();
    await wait(250);
    app.board().removeProp(r.x, r.z);
    floatText(stage.scene, { x: r.x, z: r.z - 0.5 }, 'Freed!', 'heal');
    if (r.loot.length) {
      sfx.chest();
      await wait(350);
      floatText(stage.scene, { x: unit.x, z: unit.z - 0.5 }, `+${r.loot.length} item${r.loot.length > 1 ? 's' : ''}`, 'heal');
    }
    view(unit)?.updateStatus();
    await wait(300);
  }

  /** A tipped brazier: it goes over, coals spill, and whoever stood there is burned. */
  async function playBrazier(unit, r) {
    const { x, z } = r.brazier;
    await view(unit).turnTowards(x, z);
    sfx.brazier();
    await app.board().tipBrazier(x, z, unit.x, unit.z);
    app.board().setFire(app.game().burningTiles());
    stage.shake(0.12, 250);
    for (const h of r.hits) {
      if (unseen(h.unit)) continue;
      floatText(stage.scene, h.unit, h.success ? `Save −${h.damage}` : `Burned −${h.damage}`, 'crit');
      hitFx(stage.scene, h.unit);
    }
    await Promise.all(r.hits.map((h) => damageReaction(h.unit)));
    hud.renderInitiative(app.game());
    await wait(250);
  }

  async function playShove(r) {
    const { attacker, target } = r;
    if (r.push) return playPush(r);
    await view(attacker).swing(target, () => {
      if (r.success) {
        sfx.hit(target.code);
        floatText(stage.scene, target, 'Prone!', 'cond');
        view(target).updateStatus();
      } else {
        floatText(stage.scene, target, 'Holds firm', 'miss');
      }
    });
    hud.renderInitiative(app.game());
  }

  /** Push (rules 3): a stagger 5 ft back, then maybe coals, or over a chasm's edge. */
  async function playPush(r) {
    const { attacker, target, push } = r;
    const v = view(target);
    await view(attacker).swing(target, () => {});
    sfx.hit(target.code);
    if (push.fall) {
      floatText(stage.scene, push.from, 'Over the edge!', 'crit');
      const edge = { x: (push.from.x + push.to.x) / 2, z: (push.from.z + push.to.z) / 2 };
      await v.shoved(edge.x, edge.z);
      if (!unseen(target)) voices.bark(target, 'die');
      sfx.fall();
      await v.plunge();
      stage.shake(0.06, 260); // far below, it lands
    } else if (push.stair) {
      floatText(stage.scene, target, push.crash ? 'Through the floor!' : 'Down the stairs!', 'crit');
      await tumbleDown(target, push);
    } else {
      floatText(stage.scene, target, 'Pushed!', 'cond');
      await v.shoved(push.to.x, push.to.z);
      if (push.burn) {
        sfx.fireImpact();
        floatText(stage.scene, target, `Burns −${push.burn.damage}`, 'crit');
        hitFx(stage.scene, target);
        await damageReaction(target);
      }
      v.updateStatus();
    }
    hud.renderInitiative(app.game());
  }

  async function playGrapple(r) {
    const { attacker, target } = r;
    await view(attacker).swing(target, () => {
      if (r.success) {
        sfx.hit(target.code);
        floatText(stage.scene, target, 'Grappled!', 'cond');
      } else {
        floatText(stage.scene, target, 'Twists free', 'miss');
      }
      view(target).updateStatus();
    });
    hud.renderInitiative(app.game());
  }

  /** A dying hero the heal reached gets back up (death saves). */
  async function rises(unit) {
    if (!unit.alive || !view(unit)?.down) return;
    await view(unit).getUp();
    quip(unit, 'thanks');
    hud.renderInitiative(app.game());
  }

  async function playFeed(r) {
    await view(r.unit).turnTowards(r.target.x, r.target.z);
    if (r.thrown) { // rules 6: tossed across, drunk as it lands
      sfx.whoosh?.();
      await lobFx(stage.scene, r.unit, r.target);
    }
    sfx.potion();
    floatText(stage.scene, r.target, `+${r.healed}`, 'heal');
    view(r.target).updateHp();
    await healFx(stage.scene, r.target);
    await rises(r.target);
    hud.renderInitiative(app.game());
  }

  /** Rules 6: a flask of alchemist's fire lobbed at a foe: it bursts into flame, or smashes wide. */
  async function playFlask(r) {
    const v = view(r.unit);
    await v.turnTowards(r.target.x, r.target.z);
    sfx.whoosh();
    const miss = { x: r.target.x + 0.45, z: r.target.z + 0.35 };
    await lobFx(stage.scene, r.unit, r.hit ? r.target : miss, { color: 0xff7a1a, light: 0xffa040 });
    sfx.fireImpact();
    if (!r.hit) {
      floatText(stage.scene, r.target, 'Miss', 'miss');
      burstFx(stage.scene, miss, { colors: [0xff7a1a, 0xffc040], count: 10, speed: 0.9, size: 0.05, y: 0.05, life: 500 });
      await wait(300);
      return;
    }
    fireBurstFx(stage.scene, r.target);
    floatText(stage.scene, r.target, `${r.crit ? 'Crit! ' : ''}−${r.damage}`, 'crit');
    await damageReaction(r.target);
    if (r.target.alive) {
      wait(350).then(() => floatText(stage.scene, { x: r.target.x, z: r.target.z - 0.5 }, 'Burning!', 'cond'));
      view(r.target).updateStatus();
    }
    hud.renderInitiative(app.game());
  }

  /** Rules 6: a bag of caltrops spread over a tile. */
  async function playCaltrops(r) {
    await view(r.unit).turnTowards(r.x, r.z);
    sfx.chest?.();
    burstFx(stage.scene, { x: r.x, z: r.z }, { colors: [0x9a9aa4, 0x6a6a72], count: 12, speed: 0.6, size: 0.03, y: 0.05, life: 400 });
    app.board().setCaltrops(app.game().caltropTiles);
    await wait(300);
  }

  /** Rules 7: a torch tossed onto a tile, or the Light cantrip set on one. */
  async function playLight(r) {
    await view(r.unit).turnTowards(r.x, r.z);
    if (r.spell) {
      sfx.cast();
      await wait(200);
      burstFx(stage.scene, { x: r.x, z: r.z }, { colors: [0xfff4c8, 0xffe08a], count: 14, speed: 0.6, size: 0.05, y: 0.7, life: 600 });
    } else {
      sfx.whoosh();
      await lobFx(stage.scene, r.unit, { x: r.x, z: r.z }, { color: 0xffa040, light: 0xffa050 });
      burstFx(stage.scene, { x: r.x, z: r.z }, { colors: [0xffa040, 0xffd080], count: 10, speed: 0.7, size: 0.04, y: 0.1, life: 450 });
    }
    app.board().addLamp(r.x, r.z, r.radius, r.spell);
    await wait(300);
  }

  /** Rules 7: a barrel or crate takes a blow, and breaks at 0. */
  async function playSmash(r) {
    const v = view(r.unit);
    await v.turnTowards(r.x, r.z);
    sfx.whoosh(true);
    await wait(180);
    sfx.trap();
    stage.shake(r.broken ? 0.12 : 0.05, 200);
    burstFx(stage.scene, { x: r.x, z: r.z }, { colors: [0x7a5a34, 0x5a3a20, 0xa07a4a], count: r.broken ? 22 : 8, speed: r.broken ? 1.3 : 0.7, size: 0.05, y: 0.35, life: 550 });
    if (r.broken) {
      app.board().removeProp(r.x, r.z);
      floatText(stage.scene, { x: r.x, z: r.z }, 'Smashed!', 'crit');
    } else floatText(stage.scene, { x: r.x, z: r.z }, `−${r.damage}`, 'dmg');
    await wait(350);
  }

  /** Rules 8: a hero swings a door shut and drops its bar. */
  async function playBar(r) {
    await view(r.unit).turnTowards(r.x, r.z);
    sfx.door();
    await app.board().shutDoor(r.x, r.z);
    sfx.maneuver();
    floatText(stage.scene, { x: r.x, z: r.z }, 'Barred!', 'spell');
    await wait(350);
  }

  /** Rules 8: a hero works at a trap: rigged against the monsters, a fumble, or it goes off. */
  async function playDisarm(r) {
    const board = app.board();
    await view(r.unit).turnTowards(r.x, r.z);
    sfx.maneuver();
    await wait(250);
    if (r.success) {
      await board.showTrap(app.game().grid.traps.get(`${r.x},${r.z}`)); // drawn now if it wasn't, green-edged
      sfx.discover();
      floatText(stage.scene, { x: r.x, z: r.z }, 'Rigged!', 'spell');
    } else if (!r.sprung) floatText(stage.scene, { x: r.x, z: r.z }, 'Fumbled', 'miss');
    else {
      const t = r.sprung;
      sfx.trap();
      await board.showTrap(t.trap);
      floatText(stage.scene, t.unit, t.success ? `Save −${t.damage}` : `Trap −${t.damage}`, 'crit');
      hitFx(stage.scene, t.unit);
      await damageReaction(t.unit);
      if (t.prone && t.unit.alive) {
        floatText(stage.scene, t.unit, 'Prone!', 'cond');
        view(t.unit).updateStatus();
      }
      board.retractTrap(t.trap);
      hud.renderInitiative(app.game());
    }
    await wait(300);
  }

  async function playHelp(r) {
    sfx.maneuver();
    await view(r.unit).turnTowards(r.target.x, r.target.z);
    floatText(stage.scene, r.target, 'Distracted', 'spell');
    view(r.target).updateStatus();
    await wait(450);
    hud.renderInitiative(app.game());
  }

  async function playAction(unit, r) {
    const v = view(unit);
    switch (r.id) {
      case 'secondWind':
      case 'potion':
        if (r.id === 'potion') sfx.potion();
        else sfx.heal();
        floatText(stage.scene, unit, `+${r.healed}`, 'heal');
        v.updateHp();
        await healFx(stage.scene, unit);
        break;
      case 'turnUndead':
        sfx.turnUndead();
        await v.cast(null, () => turnFx(stage.scene, unit, ACTIONS.turnUndead.range));
        await showSaves(r.saves, 'WIS', r.dc);
        for (const s of r.saves) {
          floatText(stage.scene, s.unit, s.success ? 'Resists' : s.destroyed ? 'Destroyed!' : 'Turned!', s.success ? 'miss' : s.destroyed ? 'crit' : 'spell');
          view(s.unit).updateStatus();
        }
        await Promise.all(r.saves.filter((s) => s.destroyed).map((s) => damageReaction(s.unit)));
        await wait(500);
        break;
      case 'hide':
      case 'cunningHide':
      case 'nimbleHide':
        if (unit.team === 'heroes') floatText(stage.scene, unit, `Stealth ${r.total}`, 'spell');
        else if (!unseen(unit)) floatText(stage.scene, unit, 'Hides!', 'warn');
        v.updateStatus();
        await wait(400);
        break;
      case 'ready':
        sfx.maneuver();
        floatText(stage.scene, unit, 'Ready', 'spell');
        v.updateStatus();
        await wait(450);
        break;
      case 'rage':
        sfx.roar();
        stage.shake(0.15, 300);
        floatText(stage.scene, unit, 'Rage!', 'crit');
        v.updateStatus();
        await wait(550);
        break;
      case 'reckless':
      case 'quicken':
      case 'stunningStrike':
        sfx.maneuver();
        if (r.armed !== false) floatText(stage.scene, unit, r.name, 'spell');
        v.updateStatus();
        await wait(r.armed === false ? 0 : 350);
        break;
      case 'flurry':
      case 'patientDefense':
      case 'stepOfTheWind':
        sfx.maneuver();
        floatText(stage.scene, unit, `${r.name} · ${r.left} ki`, 'spell');
        v.updateStatus();
        await wait(450);
        break;
      case 'wholeness':
        sfx.heal();
        floatText(stage.scene, unit, `+${r.healed}`, 'heal');
        v.updateHp();
        await healFx(stage.scene, unit);
        break;
      case 'aggressive':
        sfx.roar();
        if (!unseen(unit)) floatText(stage.scene, unit, 'Charge!', 'warn');
        await wait(500);
        break;
      case 'search':
        if (!unseen(unit)) floatText(stage.scene, unit, 'Searching…', 'spell');
        await wait(450);
        syncStatus(); // "Found!" over anyone it turned up
        break;
      default: // dash, dodge, disengage and their bonus-action versions
        sfx.maneuver();
        if (!unseen(unit)) floatText(stage.scene, unit, r.name, 'spell');
        v.updateStatus();
        await wait(450);
    }
    hud.renderInitiative(app.game());
  }

  async function playSpell(r) {
    const { caster, id } = r;
    const cv = view(caster);
    if (unseen(caster) && id === 'animateDead') {
      // Raised out of sight: no show, the risen one is simply there when you find it.
      sfx.raise();
      view(r.corpse).vanish();
      addView(r.risen);
      await wait(300);
      hud.renderInitiative(app.game());
      return;
    }
    // A big spell, a heal on a friend, or now and then a monster's spell, said as it's cast.
    const healed = r.heals ? r.heals.map((h) => h.unit) : r.healed != null && r.target ? [r.target] : [];
    if (r.countered) { // rules 10: a hero's Counterspell
      const c = r.countered;
      await cv.cast(r.target ?? null, async () => { sfx.cast(); });
      sfx.shield();
      floatText(stage.scene, c.by, 'Counterspell!', 'spell');
      view(c.by).updateStatus();
      if (c.d20 != null && settings.rolls) await rollBadge(stage.scene, c.by, badgeHeight(c.by), { rolls: [c.d20], d20: c.d20, line: `Check ${c.total} vs DC ${c.dc}`, result: c.success ? 'Stops it' : 'Fails', tone: c.success ? 'save' : 'fail' });
      if (c.success) {
        await shieldFx(stage.scene, caster);
        if (!unseen(caster)) floatText(stage.scene, { x: caster.x, z: caster.z - 0.5 }, 'Countered', 'miss');
        hud.renderInitiative(app.game());
        return;
      }
      floatText(stage.scene, { x: caster.x, z: caster.z - 0.5 }, 'Breaks through', 'warn');
      await wait(300);
    }
    if (r.scroll && !unseen(caster)) floatText(stage.scene, { x: caster.x, z: caster.z - 0.6 }, 'Scroll', 'spell');
    const said = spellMoment({ caster, id, healed });
    if (said) quip(caster, said.moment, said.friend?.name);
    switch (id) {
      case 'fogCloud': // rules 10
        await cv.cast(r.center, async () => {
          sfx.cast();
          await turnFx(stage.scene, r.center, r.spell.radius + 0.5, FOG_TINT);
        });
        app.board().setFog(app.game().fogTiles());
        break;
      case 'grease': // rules 10
        await cv.cast(r.center, async () => {
          sfx.cast();
          await turnFx(stage.scene, r.center, r.spell.radius + 0.5, GREASE_TINT);
        });
        app.board().setGrease(app.game().grease.keys());
        await showSaves(r.saves, 'DEX', r.dc);
        for (const s of r.saves) {
          floatText(stage.scene, s.unit, s.success ? 'Keeps footing' : 'Slips! Prone', s.success ? 'miss' : 'cond');
          view(s.unit).updateStatus();
        }
        await wait(300);
        break;
      case 'magicMissile':
        await cv.cast(r.target, async () => {
          sfx.cast();
          await Promise.all(r.darts.map(async (dmg, i) => {
            await wait(i * 120);
            sfx.missile(i);
            await missileFx(stage.scene, caster, r.target, i, r.darts.length);
            sfx.missileHit();
            floatText(stage.scene, r.target, `−${dmg}`, 'dmg');
            hitFx(stage.scene, r.target, caster);
          }));
        });
        await damageReaction(r.target);
        break;
      case 'burningHands': {
        const aim = { x: caster.x + r.dir.x, z: caster.z + r.dir.z };
        await cv.cast(aim, async () => {
          sfx.fireCone();
          await coneFx(stage.scene, caster, r.tiles);
        });
        await showSaves(r.saves, 'DEX', r.dc);
        await Promise.all(r.saves.map((s) => {
          floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage}`, 'crit');
          if (s.damage) hitFx(stage.scene, s.unit);
          return damageReaction(s.unit);
        }));
        break;
      }
      case 'lightningBolt':
        await cv.cast(r.toward, async () => {
          sfx.thunder();
          stage.shake(0.25, 400);
          await lightningFx(stage.scene, caster, r.tiles);
        });
        await showSaves(r.saves, 'DEX', r.dc);
        await Promise.all(r.saves.map((s) => {
          floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage}`, 'crit');
          if (s.damage) hitFx(stage.scene, s.unit);
          return damageReaction(s.unit);
        }));
        break;
      case 'spiritualWeapon': {
        let w = spiritWeapons.get(caster.id);
        const summon = async () => {
          sfx.radiant();
          w = spiritWeapon(stage.scene, r.from.x === caster.x && r.from.z === caster.z ? r.to : r.from);
          spiritWeapons.set(caster.id, w);
          await radiantFx(stage.scene, r.to);
        };
        if (!w) await cv.cast(r.target, summon);
        await w.flyTo(r.to);
        await w.strike(r.target);
        if (r.hit) {
          sfx.chime();
          sfx.hit(r.target.code, { crit: r.crit });
          floatText(stage.scene, r.target, r.crit ? `CRIT −${r.damage}` : `−${r.damage}`, r.crit ? 'crit' : 'dmg');
          hitFx(stage.scene, r.target, r.to, { crit: r.crit });
          await damageReaction(r.target);
        } else {
          sfx.miss();
          floatText(stage.scene, r.target, 'Miss', 'miss');
        }
        break;
      }
      case 'fireball':
        await cv.cast(r.center, async () => {
          sfx.fireballLaunch();
          await fireballFx(stage.scene, caster, r.center, r.tiles, () => {
            sfx.explosion();
            stage.shake(0.45, 650);
          });
        });
        await showSaves(r.saves, 'DEX', r.dc);
        await Promise.all(r.saves.map((s) => {
          floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage}`, 'crit');
          if (s.damage) hitFx(stage.scene, s.unit);
          return damageReaction(s.unit);
        }));
        break;
      case 'iceStorm':
        await cv.cast(r.center, async () => {
          sfx.cast();
          await iceStormFx(stage.scene, r.center, r.tiles, () => {
            sfx.thunder();
            sfx.freeze();
            stage.shake(0.3, 500);
            app.board().setIce(app.game().icyTiles());
          });
        });
        await showSaves(r.saves, 'DEX', r.dc);
        await Promise.all(r.saves.map((s) => {
          floatText(stage.scene, s.unit, s.success ? (s.damage ? `Save −${s.damage}` : 'Evaded') : `−${s.damage}`, 'crit');
          if (s.damage) hitFx(stage.scene, s.unit);
          return damageReaction(s.unit);
        }));
        break;
      case 'deathWard':
        await cv.cast(r.target, async () => {
          sfx.radiant();
          floatText(stage.scene, r.target, 'Death Ward', 'heal');
          await radiantFx(stage.scene, r.target);
        });
        break;
      case 'massHealingWord':
        await cv.cast(null, async () => {
          sfx.heal();
          await Promise.all(r.heals.map(async (h) => {
            floatText(stage.scene, h.unit, `+${h.healed}`, 'heal');
            view(h.unit).updateHp();
            await healFx(stage.scene, h.unit);
            await rises(h.unit);
          }));
          blessedHealerFx(caster, r.selfHeal);
        });
        break;
      case 'mistyStep':
        sfx.teleport();
        await cv.cast(null, async () => {
          mistFx(stage.scene, r.from);
          await cv.teleport(r.to.x, r.to.z);
          mistFx(stage.scene, r.to);
        });
        break;
      case 'scorchingRay':
        await cv.cast(r.target, async () => {
          sfx.cast();
          for (const ray of r.rays) {
            if (settings.rolls || settings.throwDice) {
              sfx.dice();
              await rollBadge(stage.scene, caster, badgeHeight(caster), attackRoll({ ...ray, shielded: false }));
            }
            await shootProjectile(stage.scene, caster, ray.target, 'fire');
            fireBurstFx(stage.scene, ray.target);
            if (ray.hit) {
              sfx.hit(ray.target.code, { crit: ray.crit, fire: true });
              hitFx(stage.scene, ray.target, caster, { crit: ray.crit });
              floatText(stage.scene, ray.target, ray.crit ? `CRIT −${ray.damage}` : `−${ray.damage}`, ray.crit ? 'crit' : 'dmg');
            } else {
              sfx.miss();
              floatText(stage.scene, ray.target, 'Miss', 'miss');
            }
            view(ray.target).updateHp();
            await wait(120);
          }
        });
        await Promise.all([...new Set(r.rays.filter((ray) => ray.hit).map((ray) => ray.target))].map((t) => damageReaction(t)));
        break;
      case 'sacredFlame':
        await cv.cast(r.target, async () => {
          sfx.radiant();
          await radiantFx(stage.scene, r.target);
        });
        if (r.damage) {
          sfx.hit(r.target.code);
          floatText(stage.scene, r.target, `−${r.damage}`, 'dmg');
          hitFx(stage.scene, r.target);
          await damageReaction(r.target);
        } else {
          floatText(stage.scene, r.target, 'Save', 'miss');
        }
        break;
      case 'dread':
        await cv.cast(r.target, async () => {
          sfx.necro();
          await shootProjectile(stage.scene, caster, r.target, 'necro');
        });
        floatText(stage.scene, r.target, r.save.success ? 'Resists' : 'Frightened!', r.save.success ? 'miss' : 'cond');
        view(r.target).updateStatus();
        await wait(300);
        break;
      case 'viciousMockery':
        await cv.cast(r.target, async () => {
          sfx.lute(false);
          floatText(stage.scene, caster, '♪', 'spell');
          await wait(350);
        });
        if (r.damage) {
          sfx.hit(r.target.code);
          floatText(stage.scene, r.target, `−${r.damage} Mocked!`, 'cond');
          hitFx(stage.scene, r.target);
          view(r.target).updateStatus();
          await damageReaction(r.target);
        } else {
          floatText(stage.scene, r.target, 'Shrugs it off', 'miss');
        }
        break;
      case 'bardicInspiration':
        await cv.cast(r.target, async () => {
          sfx.lute();
          floatText(stage.scene, r.target, `Inspired d${r.die}`, 'spell');
          view(r.target).updateStatus();
          await radiantFx(stage.scene, r.target);
        });
        break;
      case 'shatter':
        await cv.cast(r.center, async () => {
          sfx.shatter();
          stage.shake(0.3, 450);
          await turnFx(stage.scene, r.center, r.spell.radius + 0.5, SHATTER_TINT);
        });
        await showSaves(r.saves, 'CON', r.dc);
        await Promise.all(r.saves.map((s) => {
          floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage}`, 'crit');
          if (s.damage) hitFx(stage.scene, s.unit);
          return damageReaction(s.unit);
        }));
        break;
      case 'thunderwave':
        await cv.cast(null, async () => {
          sfx.shatter();
          stage.shake(0.3, 400);
          await turnFx(stage.scene, caster, 1.5, SHATTER_TINT);
        });
        await showSaves(r.saves, 'CON', r.dc);
        await Promise.all(r.saves.map((s) => {
          floatText(stage.scene, s.unit, s.success ? `Save −${s.damage}` : `−${s.damage} · Prone!`, 'crit');
          if (s.damage) hitFx(stage.scene, s.unit);
          view(s.unit)?.updateStatus();
          return damageReaction(s.unit);
        }));
        break;
      case 'entangle':
        await cv.cast(r.center, async () => {
          sfx.cast();
          await turnFx(stage.scene, r.center, r.spell.radius + 0.5, ENTANGLE_TINT);
        });
        await showSaves(r.saves, 'STR', r.dc);
        for (const s of r.saves) {
          floatText(stage.scene, s.unit, s.success ? 'Resists' : 'Entangled!', s.success ? 'miss' : 'cond');
          view(s.unit).updateStatus();
        }
        await wait(300);
        break;
      case 'callLightning':
        await cv.cast(r.center, async () => {
          sfx.thunder();
          stage.shake(0.35, 450);
          radiantFx(stage.scene, r.center);
          await turnFx(stage.scene, r.center, r.spell.radius + 0.5, STORM_TINT);
        });
        await showSaves(r.saves, 'DEX', r.dc);
        await Promise.all(r.saves.map((s) => {
          floatText(stage.scene, s.unit, s.success ? (s.damage ? `Save −${s.damage}` : 'Evaded') : `−${s.damage}`, 'crit');
          if (s.damage) hitFx(stage.scene, s.unit);
          return damageReaction(s.unit);
        }));
        cv.updateStatus();
        break;
      case 'fear': {
        const aim = { x: caster.x + r.dir.x, z: caster.z + r.dir.z };
        await cv.cast(aim, async () => {
          sfx.necro();
          await coneFx(stage.scene, caster, r.tiles, 'fear');
        });
        await showSaves(r.saves, 'WIS', r.dc);
        for (const s of r.saves) {
          floatText(stage.scene, s.unit, s.success ? 'Resists' : 'Frightened!', s.success ? 'miss' : 'cond');
          view(s.unit).updateStatus();
        }
        await wait(300);
        break;
      }
      case 'greaterInvisibility':
        await cv.cast(r.target === caster ? null : r.target, async () => {
          sfx.teleport();
          mistFx(stage.scene, r.target);
          floatText(stage.scene, r.target, 'Invisible', 'spell');
          for (const u of app.game().units) view(u)?.updateStatus();
          await wait(300);
        });
        break;
      case 'layOnHands':
        await cv.cast(r.target === caster ? null : r.target, async () => {
          sfx.heal();
          floatText(stage.scene, r.target, `+${r.healed}`, 'heal');
          view(r.target).updateHp();
          await healFx(stage.scene, r.target);
          await rises(r.target);
        });
        break;
      case 'huntersMark':
      case 'hex':
        if (r.unmarked) view(r.unmarked)?.updateStatus();
        await cv.cast(r.target, async () => {
          if (id === 'hex') sfx.necro();
          else sfx.bow();
          floatText(stage.scene, r.target, id === 'hex' ? 'Hexed' : 'Marked', 'spell');
          view(r.target).updateStatus();
          await radiantFx(stage.scene, r.target);
        });
        break;
      case 'shieldOfFaith':
        await cv.cast(r.target === caster ? null : r.target, async () => {
          sfx.radiant();
          floatText(stage.scene, r.target, 'AC +2', 'heal');
          await radiantFx(stage.scene, r.target);
        });
        break;
      case 'cureWounds':
      case 'healingWord':
        await cv.cast(r.target === caster ? null : r.target, async () => {
          sfx.heal();
          floatText(stage.scene, r.target, `+${r.healed}`, 'heal');
          view(r.target).updateHp();
          await healFx(stage.scene, r.target);
          await rises(r.target);
          blessedHealerFx(caster, r.selfHeal);
        });
        break;
      case 'animateDead':
        await cv.cast(r.corpse, async () => {
          sfx.raise();
          const fx = raiseFx(stage.scene, r.corpse);
          await wait(450);
          view(r.corpse).vanish();
          await addView(r.risen).rise();
          await fx;
        });
        break;
      default:
        throw new Error(`playSpell: no animation for "${id}"`);
    }
    if (r.caveIns) await playCaveIns(r.caveIns);
    hud.renderInitiative(app.game());
  }

  /** Play back a resolved command or monster step (`kind`: its type), then anything it set off. */
  async function play(unit, kind, r) {
    // A turned monster cries out as it starts to run (once a fight).
    if (kind === 'move' && unit.turned && !fled.has(unit)) {
      fled.add(unit);
      quip(unit, 'flee');
    }
    await playStep(unit, kind, r);
    await flushRisings();
  }

  /** Nekhet's house rises: the glare, then the dead climbing up, one after another. */
  async function flushRisings() {
    const list = risings;
    risings = [];
    for (const r of list) {
      const lord = r.unit;
      if (!unseen(lord)) keepInView(lord);
      hud.logRising(r);
      sfx.raise();
      stage.shake(0.25, 450);
      floatText(stage.scene, { x: lord.x, z: lord.z - 0.5 }, 'Rise!', 'cond');
      await wait(400);
      for (const g of r.glare) {
        floatText(stage.scene, g.target, g.success ? 'Resists' : 'Frightened!', g.success ? 'miss' : 'cond');
        view(g.target)?.updateStatus();
      }
      await Promise.all(r.risen.map(async (e, i) => {
        await wait(i * 250);
        const fx = raiseFx(stage.scene, e.unit);
        await wait(300);
        if (e.body) view(e.body)?.vanish();
        await addView(e.unit).rise();
        await fx;
      }));
      hud.renderInitiative(app.game());
      await wait(250);
    }
  }

  function playStep(unit, kind, r) {
    switch (kind) {
      case 'move': return playMove(unit, r);
      case 'attack': return animateAttack(r);
      case 'shove': return playShove(r);
      case 'help': return playHelp(r);
      case 'grapple': return playGrapple(r);
      case 'feed': return playFeed(r);
      case 'flask': return playFlask(r);
      case 'caltrops': return playCaltrops(r);
      case 'torch': return playLight(r);
      case 'smash': return playSmash(r);
      case 'bar': return playBar(r);
      case 'disarm': return playDisarm(r);
      case 'chest': return playChest(unit, r);
      case 'brazier': return playBrazier(unit, r);
      case 'lever': return playLever(unit, r);
      case 'owl': return playOwl(r);
      case 'free': return playFree(unit, r);
      case 'bonus':
      case 'action': return playAction(unit, r);
      case 'spell': return playSpell(r);
      default: return null; // smite and end have nothing to show
    }
  }

  return {
    play, damageReaction, throwsOwn,
    /** The fight is over (`over`): its last hero standing, or a gloating foe, has the last word. */
    lastWords: (over) => {
      const fight = app.game();
      return quip(lastWordsSpeaker(over, fight.units, fight.current, seen), over === 'victory' ? 'win' : 'gloat');
    },
    /** A named foe comes into view for the first time this fight: it says who it is. */
    intro: (unit) => quip(unit, 'intro'),
    /** A rising to show after the step that set it off (see flushRisings). */
    queueRising: (r) => risings.push(r),
    clearRisings: () => { risings = []; },
  };
}
