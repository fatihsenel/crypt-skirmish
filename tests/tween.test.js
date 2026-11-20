import { describe, it, expect, vi, afterEach } from 'vitest';

/** render/tween.js as loaded on a system that does (or doesn't) ask for reduced motion. */
async function tweenWith(reduce) {
  vi.resetModules();
  vi.stubGlobal('matchMedia', (q) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)' }));
  return import('../src/render/tween.js');
}

describe('reduced motion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the system setting', async () => {
    expect((await tweenWith(true)).calm()).toBe(true);
    expect((await tweenWith(false)).calm()).toBe(false);
  });

  it('lets the Motion setting override the system', async () => {
    const calmSystem = await tweenWith(true);
    calmSystem.setMotion('full');
    expect(calmSystem.calm()).toBe(false);
    const busySystem = await tweenWith(false);
    busySystem.setMotion('reduce');
    expect(busySystem.calm()).toBe(true);
    busySystem.setMotion('system');
    expect(busySystem.calm()).toBe(false);
  });

  it('counts as off where there is no matchMedia (tests, the simulator)', async () => {
    vi.resetModules();
    vi.stubGlobal('matchMedia', undefined);
    expect((await import('../src/render/tween.js')).calm()).toBe(false);
  });
});
