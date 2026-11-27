import { describe, it, expect } from 'vitest';
import { viewOf, inFront, compass, twistTurn } from '../src/render/view.js';

describe('the view direction', () => {
  it('reads the camera offset as a diagonal', () => {
    expect(viewOf(30, 30)).toEqual({ x: 1, z: 1 });
    expect(viewOf(-30, 30)).toEqual({ x: -1, z: 1 });
    expect(viewOf(-30, -29.9)).toEqual({ x: -1, z: -1 });
  });

  it('fades the wall between the camera and a figure, from each side', () => {
    const p = { x: 4, z: 4 };
    expect(inFront({ x: 5, z: 5 }, p, { x: 1, z: 1 })).toBe(true);
    expect(inFront({ x: 3, z: 3 }, p, { x: 1, z: 1 })).toBe(false);
    expect(inFront({ x: 3, z: 3 }, p, { x: -1, z: -1 })).toBe(true);
    expect(inFront({ x: 5, z: 5 }, p, { x: -1, z: -1 })).toBe(false);
    expect(inFront({ x: 3, z: 5 }, p, { x: -1, z: 1 })).toBe(true);
    expect(inFront({ x: 5, z: 3 }, p, { x: 1, z: -1 })).toBe(true);
  });

  it('leaves a wall off to the side alone', () => {
    expect(inFront({ x: 7, z: 1 }, { x: 4, z: 4 }, { x: 1, z: 1 })).toBe(false);
  });

  it('names the side the view is from', () => {
    expect(compass({ x: 1, z: 1 })).toBe('south-east');
    expect(compass({ x: -1, z: 1 })).toBe('south-west');
    expect(compass({ x: -1, z: -1 })).toBe('north-west');
    expect(compass({ x: 1, z: -1 })).toBe('north-east');
  });

  it('turns on a twist past 35°', () => {
    expect(twistTurn(0.3)).toBe(0);
    expect(twistTurn(0.7)).toBe(1);
    expect(twistTurn(-0.7)).toBe(-1);
  });
});
