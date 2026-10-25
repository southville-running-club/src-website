/**
 * Fireworks for the prize presenter, when a winner lands — the arithmetic, with no canvas in it.
 *
 * `presenter-reel.tsx` draws them; everything that decides where a burst goes, how a spark moves
 * and when it has burnt out is here, so it can be tested without a browser. The randomness is
 * passed in rather than reached for, for the same reason.
 *
 * ⚠️ **Decoration and nothing else.** The canvas is hidden from assistive technology, takes no
 * pointer events, removes itself when the last spark is out, and is never drawn for somebody
 * whose browser asks for less motion. The winner is shown and announced whether or not any of
 * this runs.
 *
 * ⚠️ **No flash.** Each burst is a ring of small sparks fading over about a second; nothing fills
 * the screen or changes its brightness at once, which is what WCAG 2.3.1's three-flash rule is
 * about on a projector a whole room is looking at.
 */

/** A source of numbers in [0, 1) — `Math.random` on the page, a fixed sequence in a test. */
export type Random = () => number;

/** When to set one off, where, and in which colour. Pixels from the top left of the screen. */
export interface Burst {
  atMs: number;
  x: number;
  y: number;
  colour: string;
}

/** One spark. Velocities in pixels per millisecond. */
export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  colour: string;
}

/** How many bursts, set off over how long. */
export const BURSTS = 7;
export const BURST_SPREAD_MS = 1600;
/** Sparks in one burst. */
export const SPARKS_PER_BURST = 48;
/** How long a spark lasts, before the jitter. */
export const SPARK_LIFE_MS = 1100;
/** Downward pull, pixels per millisecond squared. */
export const GRAVITY = 0.00012;
/** The share of its speed a spark keeps per millisecond — air resistance, more or less. */
export const DRAG = 0.9985;

/**
 * Where and when the bursts go: spread over the first `BURST_SPREAD_MS`, across the middle of
 * the screen and its upper half — above the winner's name rather than over it.
 */
export function planBursts(
  width: number,
  height: number,
  palette: readonly string[],
  random: Random,
  count = BURSTS,
): Burst[] {
  if (palette.length === 0) return [];
  return Array.from({ length: count }, (_, index) => ({
    atMs: Math.round((index / Math.max(count - 1, 1)) * BURST_SPREAD_MS),
    x: width * (0.15 + random() * 0.7),
    y: height * (0.12 + random() * 0.33),
    colour: palette[index % palette.length] ?? palette[0]!,
  }));
}

/**
 * One burst's sparks: a ring, evenly spaced with a little jitter so it does not look drawn with
 * a compass, flying outwards at speeds scaled to the screen so a projector and a laptop look
 * alike.
 */
export function explode(
  burst: Burst,
  scale: number,
  random: Random,
  count = SPARKS_PER_BURST,
): Spark[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.2;
    const speed = scale * (0.00012 + random() * 0.00016);
    return {
      x: burst.x,
      y: burst.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ageMs: 0,
      lifeMs: SPARK_LIFE_MS * (0.75 + random() * 0.5),
      colour: burst.colour,
    };
  });
}

/** Every spark moved on by `dtMs`, and those that have burnt out dropped. */
export function step(sparks: readonly Spark[], dtMs: number): Spark[] {
  const keep = Math.pow(DRAG, dtMs);
  return sparks
    .map((spark) => {
      const vx = spark.vx * keep;
      const vy = spark.vy * keep + GRAVITY * dtMs;
      return {
        ...spark,
        x: spark.x + vx * dtMs,
        y: spark.y + vy * dtMs,
        vx,
        vy,
        ageMs: spark.ageMs + dtMs,
      };
    })
    .filter((spark) => spark.ageMs < spark.lifeMs);
}

/** How bright a spark still is: 1 when it is lit, falling to 0 as it burns out. */
export function brightness(spark: Spark): number {
  return Math.min(1, Math.max(0, 1 - spark.ageMs / spark.lifeMs));
}
