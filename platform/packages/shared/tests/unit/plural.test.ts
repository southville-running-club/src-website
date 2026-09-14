import { describe, expect, it } from 'vitest';

import { outboxAttemptsWords } from '../../src/admin-outbox.js';
import { plural } from '../../src/plural.js';

/**
 * The one place a count chooses between two sentences, and the one noun that already drifted.
 *
 * ## Why the outbox wording is asserted in this file rather than its own
 *
 * It is the same defect. `plural()` was file-local to `worker/nn-admin.ts`, so `/admin/emails/`
 * re-derived the rule and named the **same** `entries.email_outbox.attempts` column a different
 * thing: *"3 attempts"* on the queue against *"Failed after 3 tries"* on the entry timeline.
 * Sharing the conditional is half the fix; sharing the noun is the other half, and the two are
 * one change. Issue
 * [#175](https://github.com/southville-running-club/src-website/issues/175).
 *
 * ⚠️ **What this layer can and cannot hold.** It can hold the words, which is where the
 * divergence actually lived. It cannot hold that both Worker surfaces still call the shared
 * function — that is markup rendered under Miniflare — so the guard against a third surface
 * inventing a third noun is that there is one exported function to call and nothing in
 * `apps/main/worker/` defining a second.
 */
describe('plural', () => {
  it('takes the singular at one and the plural at everything else', () => {
    expect(plural(1, 'note', 'notes')).toBe('note');
    expect(plural(2, 'note', 'notes')).toBe('notes');
    expect(plural(250, 'note', 'notes')).toBe('notes');
  });

  it('takes the plural at zero, which is what English does', () => {
    // "0 notes", not "0 note". The admin surface prints several counts that are legitimately
    // zero — no guides, no flagged purchases, nothing waiting.
    expect(plural(0, 'note', 'notes')).toBe('notes');
  });

  it('carries a whole sentence rather than pluralising a noun', () => {
    // The reason the third argument is a built string: the noun and its verb move together,
    // and #173 is what happens when they do not.
    expect(plural(1, 'purchase is', 'purchases are')).toBe('purchase is');
    expect(plural(2, 'purchase is', 'purchases are')).toBe('purchases are');
    expect(plural(1, 'One ask', '4 asks')).toBe('One ask');
  });

  it('leaves the count to the caller, so markup can hold the figure', () => {
    // It never interpolates the number itself. Several call sites print it inside a
    // `<span class="admin-mono">` this function knows nothing about.
    expect(plural(3, 'paid entry', 'paid entries')).toBe('paid entries');
  });
});

describe('the outbox attempt count', () => {
  it('is "attempt", which is the word the club already wrote down', () => {
    // `docs/delivery/runbooks/entries-email.md` says "three attempts" and "attempt count", and
    // says "tries" nowhere. This assertion is the record of that choice: changing the club's
    // word means changing it here and in one function, rather than finding two surfaces.
    expect(outboxAttemptsWords(3)).toBe('3 attempts');
    expect(outboxAttemptsWords(3)).not.toContain('tries');
  });

  it('says "1 attempt" at one, which is the half that was wrong', () => {
    // `/admin/emails/` got this right by hand and `/admin/nn/entry/` rendered "Failed after
    // 1 try" for the same row. Both read from this now.
    expect(outboxAttemptsWords(1)).toBe('1 attempt');
    expect(`Failed after ${outboxAttemptsWords(1)}`).toBe('Failed after 1 attempt');
  });

  it('words zero rather than refusing it, and the caller decides whether to show it', () => {
    // The queue renders nothing at all for a message nobody has tried yet. That decision is at
    // the call site on purpose — a function answering '' for zero would hide it.
    expect(outboxAttemptsWords(0)).toBe('0 attempts');
  });
});
