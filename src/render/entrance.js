// How a monster comes on, at a fight's start (as the room finishes rising) and when it arrives
// mid-fight: the buried dead claw up out of the floor in a burst of dirt, a spider lowers on a
// thread, a gargoyle swoops down, ghosts gather out of a pale haze, and the rest step out of the
// dark. Drawn only; under reduced motion a figure is simply there.

import { calm } from './tween.js';
import { burstFx, dustFx } from './effects.js';

/** Which entrance a monster makes. */
export function entranceKind(unit) {
  const c = unit.code;
  if (c === 'm') return null; // the mimic is already there, a chest
  if (c === 'k') return 'thread';
  if ('eqtp'.includes(c)) return 'mist';
  if (unit.flies) return 'drop';
  if (unit.undead) return 'dig';
  return 'step';
}

const DIRT = [0x4a3a2a, 0x5e4a34, 0x382c20];

/**
 * `view` (a UnitView in `scene`) comes on after `delay` ms. `from`: the way it steps in from,
 * away from the heroes (a direction), for those that step out of the dark.
 */
export function enterView(scene, view, delay = 0, from = null) {
  if (calm()) return Promise.resolve();
  const kind = entranceKind(view.unit);
  if (!kind) return Promise.resolve();
  const at = { x: view.unit.x, z: view.unit.z };
  const floor = () => view.raise.position.y;
  const onStart = () => {
    if (kind === 'dig') {
      burstFx(scene, at, { colors: DIRT, count: 14, speed: 2.2, size: 0.06, y: floor() + 0.05, life: 700 });
      dustFx(scene, at, { color: 0x6b5a46, count: 9, size: 0.55, y: floor(), life: 900 });
    } else if (kind === 'mist') {
      dustFx(scene, at, { color: 0xc9d6e2, count: 12, size: 0.7, y: floor() + 0.2, life: 1100 });
      burstFx(scene, at, { colors: [0xb8d0e8], count: 8, speed: 0.6, size: 0.035, y: floor() + 0.3, glowing: true, rise: true, life: 1000 });
    }
  };
  const done = view.enter(kind === 'thread' ? 'drop' : kind, delay, { thread: kind === 'thread', from, onStart });
  view.entered = done; // its turn waits for it (main.js)
  if (kind === 'thread' || kind === 'drop') {
    // A puff of dust where it lands.
    done.then(() => dustFx(scene, at, { color: 0x8a7c68, count: 6, size: 0.4, y: floor(), life: 600 }));
  }
  return done;
}
