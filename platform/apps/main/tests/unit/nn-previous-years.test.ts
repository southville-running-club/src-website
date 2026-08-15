import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NN_PREVIOUS_SLOTS } from '../../worker/nn-entry';

/**
 * The row of past runnings, proved in both directions without a database.
 *
 * ## Why it is proved here rather than end to end
 *
 * **The row renders nothing today, and that is correct**: there is exactly one running of this
 * race and it is the current one. Proving the *populated* case against real data would mean
 * seeding a running that has already happened — which this repository will not do, because a
 * past running has nowhere to point until there are results to point at, and inventing one is
 * inventing a race fact.
 *
 * So the mechanism is proved against a fabricated list, and the empty case is proved end to end
 * in `site.spec.ts` where it actually matters.
 *
 * ## What is still missing, and it is the data rather than the row
 *
 * `NnRunning.previous` is always `[]`. `entries.current_entry_state()` answers for **one**
 * running; listing the rest needs a second read of `entries.events`, which means another
 * function in that schema — and adding one was outside this slice. Everything on this side of
 * that call is finished: the markup, the paint, the slot limit and these assertions.
 */

const COMPONENT = readFileSync(
  fileURLToPath(new URL('../../src/components/NnPreviousYears.astro', import.meta.url)),
  'utf8',
);

describe('the markup and the Worker agree on how many pills there are', () => {
  it('declares the same number of slots in both places', () => {
    // **The constant is written twice on purpose.** Importing the Worker's into the component
    // would pull `worker/nn-entry.ts` — and with it zod and the whole shared entry module —
    // into the page build, to share one integer. This is the assertion that pays for that.
    const declared = /const SLOTS = (\d+);/.exec(COMPONENT)?.[1];

    expect(declared).toBe(String(NN_PREVIOUS_SLOTS));
  });

  it('ships the container and every pill hidden', () => {
    // Nothing renders until the Worker has something to put in it — no heading, no empty
    // container, no list of blank pills.
    expect(COMPONENT).toMatch(/data-nn-previous\s+hidden/);
    expect(COMPONENT).toMatch(/data-nn-previous-item=\{String\(index\)\}\s+hidden/);
  });

  it('gives every pill an empty href rather than a plausible one', () => {
    expect(COMPONENT).toMatch(/<a href=""/);
  });

  it('names no year, because every year is the Worker’s', () => {
    const code = COMPONENT.replace(/^\s*\/\/.*$/gm, '').replace(
      /\{\s*\/\*[\s\S]*?\*\/\s*\}/g,
      '',
    );

    expect(code).not.toMatch(/\d{4}/);
  });
});
