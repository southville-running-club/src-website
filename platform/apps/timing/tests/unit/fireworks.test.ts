import { describe, expect, it } from 'vitest';
import {
  BURST_SPREAD_MS,
  brightness,
  explode,
  GRAVITY,
  planBursts,
  SPARKS_PER_BURST,
  step,
  type Random,
} from '../../lib/fireworks';

/**
 * The presenter's fireworks — `lib/fireworks.ts`, the arithmetic without the canvas.
 *
 * What matters is that they stay out of the way: above the winner's name, gone in a few seconds,
 * and nothing that fills the screen at once.
 */

/** A fixed, repeating sequence, so every assertion is about the same fireworks. */
function sequence(...values: number[]): Random {
  let index = 0;
  return () => values[index++ % values.length]!;
}

const PALETTE = ['#209d50', '#ffe9a8', '#f1f7ef'];

describe('planBursts', () => {
  it('spreads the bursts over the first moments, first to last', () => {
    const bursts = planBursts(1280, 720, PALETTE, sequence(0.5), 5);
    expect(bursts.map((burst) => burst.atMs)).toEqual([
      0,
      BURST_SPREAD_MS / 4,
      BURST_SPREAD_MS / 2,
      (BURST_SPREAD_MS * 3) / 4,
      BURST_SPREAD_MS,
    ]);
  });

  it('keeps them across the middle and in the upper half, above the winner’s name', () => {
    for (const edge of [0, 0.999]) {
      for (const burst of planBursts(1000, 800, PALETTE, sequence(edge))) {
        expect(burst.x).toBeGreaterThanOrEqual(150);
        expect(burst.x).toBeLessThanOrEqual(850);
        expect(burst.y).toBeGreaterThanOrEqual(96);
        expect(burst.y).toBeLessThan(400);
      }
    }
  });

  it('takes its colours from the palette in turn', () => {
    const bursts = planBursts(800, 600, PALETTE, sequence(0.3), 4);
    expect(bursts.map((burst) => burst.colour)).toEqual([...PALETTE, PALETTE[0]]);
  });

  it('plans nothing without a colour to draw in', () => {
    expect(planBursts(800, 600, [], sequence(0.3))).toEqual([]);
  });
});

describe('explode', () => {
  const burst = { atMs: 0, x: 400, y: 200, colour: '#209d50' };

  it('is a ring of sparks from one point, in the burst’s colour', () => {
    const sparks = explode(burst, 720, sequence(0.5));
    expect(sparks).toHaveLength(SPARKS_PER_BURST);
    for (const spark of sparks) {
      expect([spark.x, spark.y, spark.ageMs, spark.colour]).toEqual([
        400,
        200,
        0,
        '#209d50',
      ]);
    }
  });

  it('sends them every way rather than one, at a speed scaled to the screen', () => {
    const sparks = explode(burst, 720, sequence(0.5));
    expect(sparks.some((spark) => spark.vx > 0)).toBe(true);
    expect(sparks.some((spark) => spark.vx < 0)).toBe(true);
    expect(sparks.some((spark) => spark.vy > 0)).toBe(true);
    expect(sparks.some((spark) => spark.vy < 0)).toBe(true);

    const speed = (scale: number) => {
      const [spark] = explode(burst, scale, sequence(0.5), 1);
      return Math.hypot(spark!.vx, spark!.vy);
    };
    expect(speed(1440)).toBeCloseTo(speed(720) * 2);
  });
});

describe('step', () => {
  const spark = {
    x: 100,
    y: 100,
    vx: 0.1,
    vy: 0,
    ageMs: 0,
    lifeMs: 1000,
    colour: '#209d50',
  };

  it('moves a spark along its way and pulls it down', () => {
    const [moved] = step([spark], 16);
    expect(moved!.x).toBeGreaterThan(100);
    expect(moved!.vy).toBeCloseTo(GRAVITY * 16);
    expect(moved!.y).toBeGreaterThan(100);
    expect(moved!.ageMs).toBe(16);
  });

  it('slows it as it goes', () => {
    const [moved] = step([spark], 100);
    expect(moved!.vx).toBeLessThan(spark.vx);
  });

  it('drops a spark once it has burnt out, so the screen empties by itself', () => {
    expect(step([spark], 999)).toHaveLength(1);
    expect(step([spark], 1000)).toEqual([]);
  });
});

describe('brightness', () => {
  it('fades from lit to out over a spark’s life', () => {
    const at = (ageMs: number) =>
      brightness({ x: 0, y: 0, vx: 0, vy: 0, ageMs, lifeMs: 1000, colour: '#fff' });
    expect(at(0)).toBe(1);
    expect(at(500)).toBeCloseTo(0.5);
    expect(at(1000)).toBe(0);
    expect(at(2000)).toBe(0);
  });
});
