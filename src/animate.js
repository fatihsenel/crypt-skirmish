// Plays back what the rules engine already resolved: attacks, moves, chests, actions and
// spells as animations, effects, floating text and sound. The engine has moved on by the time
// these run; they only show it. `play(unit, kind, result)` is the way in.

import { ACTIONS } from './game/abilities.js';
import { ITEMS } from './game/items.js';
import { shootProjectile, floatText } from './render/unitView.js';
import { rollBadge, attackRoll, saveRoll } from './render/rollBadge.js';
import { missileFx, coneFx, mistFx, shieldFx, healFx, alertFx, radiantFx, turnFx, raiseFx, fireballFx, iceStormFx, hitFx, fireBurstFx, d20Fx, lightningFx, spiritWeapon } from './render/effects.js';
import { wait } from './render/tween.js';
import { sfx } from './audio/sfx.js';
import { voices } from './audio/voices.js';

/**
 * The controller's view of the fight: `stage`, `hud`, `settings` and `spiritWeapons` (the
 * clerics' weapons by caster id), and as functions `game()`, `board()`, `view(u)`, `addView(u)`,
 * `unseen(u)`, `inView(tile)`, `selected()`, `busy()`, `touching()`, `autoplaying()`,
 * `replaying()`, `flushReveals()`, `syncStatus()` and `keepInView(u)`.
 */
export function createAnimations(app) {
  const { stage, hud, settings, spiritWeapons, view, addView, unseen, inView, flushReveals, syncStatus, keepInView } = app;
  let risings = []; // Nekhet's house rising, shown once the blow that bloodied him has played

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
        reaction = damageReaction(target);
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
    if (r.rebuke) await playRebuke(r.rebuke);
    if (r.barbs) await playBarbs(r.barbs);
    hud.renderInitiative(app.game());
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

  const CONDITION_FLOAT = { prone: 'Prone!', poisoned: 'Poisoned!', frightened: 'Frightened!', restrained: 'Webbed!', rotting: 'Rotting!' };

  function damageReaction(unit) {
    const v = view(unit);
    v.updateHp();
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
        floatText(stage.scene, r.attacker, 'Readied!', 'warn');
        view(r.attacker).updateStatus();
        await wait(250);
        await animateAttack(r, step.at);
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
        case 'trap': {
          const r = step.result;
          sfx.trap();
          if (unseen(unit)) {
            view(unit).updateHp();
            if (!unit.alive) view(unit).die();
            break;
          }
          await app.board().showTrap(r.trap);
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

  async function playFeed(r) {
    sfx.potion();
    await view(r.unit).turnTowards(r.target.x, r.target.z);
    floatText(stage.scene, r.target, `+${r.healed}`, 'heal');
    view(r.target).updateHp();
    await healFx(stage.scene, r.target);
    hud.renderInitiative(app.game());
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
    switch (id) {
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
      case 'layOnHands':
        await cv.cast(r.target === caster ? null : r.target, async () => {
          sfx.heal();
          floatText(stage.scene, r.target, `+${r.healed}`, 'heal');
          view(r.target).updateHp();
          await healFx(stage.scene, r.target);
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
    hud.renderInitiative(app.game());
  }

  /** Play back a resolved command or monster step (`kind`: its type), then anything it set off. */
  async function play(unit, kind, r) {
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
      case 'chest': return playChest(unit, r);
      case 'brazier': return playBrazier(unit, r);
      case 'bonus':
      case 'action': return playAction(unit, r);
      case 'spell': return playSpell(r);
      default: return null; // smite and end have nothing to show
    }
  }

  return {
    play, damageReaction, throwsOwn,
    /** A rising to show after the step that set it off (see flushRisings). */
    queueRising: (r) => risings.push(r),
    clearRisings: () => { risings = []; },
  };
}
