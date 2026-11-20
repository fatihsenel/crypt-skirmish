// Test helpers: window.__debug for the console and scripted play-testing, and the sample run
// behind ?victory. Nothing here is reached in normal play.

import * as THREE from 'three';
import { newCampaign, runSummary, runShareText } from './game/campaign.js';
import { levelById } from './game/maps.js';
import { partyAt } from './game/daily.js';

/**
 * ?victory: the banner arguments for the won-campaign screen of a made-up run, to try Save
 * image and Copy result without playing to the end. &tier=2 or deeper: New Game+, with elites.
 */
export function sampleVictory(search) {
  const run = partyAt(newCampaign('normal'), 8);
  const gear = { F: ['weaponPlus2', 'gauntletsOgre'], W: ['bracersDefense', 'ringProtection', 'amuletHealth'], R: ['weaponPlus1', 'cloakProtection'], C: ['periaptPoison', 'cloakProtection', 'weaponPlus1'] };
  for (const [code, items] of Object.entries(gear)) run.party[code].items = items;
  run.cleared = ['crypt', 'ossuary', 'chapel', 'sanctum', 'catacombs', 'vault', 'barrow', 'nest', 'gallery', 'throne', 'halls', 'armory', 'tomb'];
  run.xp = 14350;
  const tally = (damage, kills, crits, healing, downed) => ({ damage, kills, crits, healing, downed });
  run.stats = {
    won: 13, lost: 1, rounds: 95,
    heroes: { F: tally(612, 31, 9, 0, 2), W: tally(540, 22, 1, 0, 1), R: tally(488, 19, 6, 0, 0), C: tally(301, 9, 2, 356, 1) },
  };
  run.tier = Math.max(0, Math.min(99, Math.floor(Number(new URLSearchParams(search).get('tier')) || 0)));
  if (run.tier >= 2) run.stats.elites = { regenerating: 3, relentless: 4, frenzied: 2, swift: 2, warded: 2 };
  const summary = runSummary(run);
  const tomb = levelById('tomb');
  return ['victory', { round: 9, level: tomb.name, final: true, xp: 0, outro: tomb.outro, summary, share: runShareText(summary) }];
}

/** Win (`team` 'monsters') or lose ('heroes') on the spot: through Relentless and Death Ward too. */
function felled(app, team) {
  const game = app.game();
  for (const u of game.living(team)) {
    for (let blows = 0; u.alive && blows < 3; blows++) game.applyDamage(u, u.hp, null);
    app.damageReaction(u);
  }
  app.checkGameOver();
}

/** window.__debug, from the controller's state and actions in `app` (see main.js). */
export function installDebug(app) {
  window.__debug = {
    game: app.game,
    /** How many tiles each threat layer shows right now, and whose zone it is. */
    threats: () => {
      const board = app.board();
      const { on, focus } = app.threatState();
      return {
        on, focus: focus?.name ?? null,
        melee: board?.threatMelee.meshes.filter((m) => m.visible).length ?? 0,
        ranged: board?.threatRanged.meshes.filter((m) => m.visible).length ?? 0,
      };
    },
    views: app.views,
    stage: app.stage,
    sfx: app.sfx,
    /** Give the current hero a command, e.g. __debug.command({ type: 'move', x: 3, z: 4 }). */
    command: app.command,
    /** The monster AI plays the heroes too (the fight can't be replayed after). */
    autoplay: app.autoplay,
    /** Jump into a room with a fresh party (no save), e.g. __debug.level(4). */
    level: app.level,
    campaign: app.campaign,
    win: () => felled(app, 'monsters'),
    lose: () => felled(app, 'heroes'),
    /** Zoom the camera onto a tile, e.g. __debug.focus(11, 2, 3). */
    focus: (x, z, zoom = 2.5) => app.lookAt(x, z, zoom),
    /** Screen position (CSS px) of a tile, useful for scripted play-testing. */
    tileToScreen(x, z) {
      const v = new THREE.Vector3(x, 0, z).project(app.stage.camera);
      const r = app.stage.dom.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
  };
}
