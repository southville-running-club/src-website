/**
 * What the anomalies page and the timing log say after their forms have been posted — #252.
 *
 * The third module of this shape, after `lib/start-outcomes.ts` and `lib/marshal-outcomes.ts`,
 * and the two rules those carry apply here unchanged:
 *
 * 1. ⚠️ **Nothing from the query string is ever rendered.** The parameter selects a sentence
 *    written here; it is never itself the sentence. The reasons below come from the database,
 *    and a reason nobody has written wording for is **silent** rather than generic.
 * 2. **An unknown value says nothing at all**, because a sentence invented to cover every case
 *    says nothing useful about any of them.
 *
 * ## ⚠️ The refusal that is not a failure, and must not read as one
 *
 * `already_resolved` and `changed_elsewhere` are what the compare-and-swap answers when
 * **another volunteer got there first**. On a race morning that is the *normal* case: there is
 * one anomalies page and everybody free is looking at it. Nothing is broken, nothing is lost,
 * and the previous decision stands — so both are toned `ok` and both say to look again rather
 * than to try again, because trying again would resolve it twice on top of somebody else's
 * call.
 *
 * This is `start-outcomes.ts`'s `already_started` one surface along, and for the same reason:
 * the losing half of a race between two volunteers is the single most likely thing either page
 * will ever show.
 */

/** The tone a message is rendered in — `base.css`'s `.notice-ok` and `.notice-bad`. */
export type OutcomeTone = 'ok' | 'bad';

export interface Outcome {
  tone: OutcomeTone;
  message: string;
}

const OUTCOMES: Record<string, Outcome> = {
  marked_valid: {
    tone: 'ok',
    message:
      'Marked as valid. The capture stands exactly as it was recorded and is no longer waiting for anybody.',
  },
  edited: {
    tone: 'ok',
    message:
      'The bib has been corrected and the capture is no longer waiting for anybody.',
  },
  // ⚠️ **Says where it went, not only that it went.** A discard is the one resolution that
  // changes a result, and the person doing it at 11:40 on a race morning needs to know it can
  // be undone without asking anybody.
  discarded: {
    tone: 'ok',
    message:
      'Discarded. It no longer counts towards any result, and it is still on the timing log below if it needs restoring.',
  },
  restored: {
    tone: 'ok',
    message:
      'Restored. It counts towards results again and is back on the list to be resolved.',
  },
  saved: {
    tone: 'ok',
    message: 'Saved.',
  },
  /**
   * ⚠️ **The edited bib that still matches nothing.** Not a failure — the admin has recorded
   * what they believe the bib was, and `record_crossing()` stores an unknown bib deliberately
   * — but it must be said out loud, because the screen would otherwise look like it had
   * finished the job. What has to change next is the roster, not this page.
   */
  edited_orphan: {
    tone: 'bad',
    message:
      'The bib has been corrected and it still matches no team on this race. The capture is resolved, and it will not appear in any result until a team carries that bib — check the entry list.',
  },
  already_resolved: {
    tone: 'ok',
    // See the header: the losing half of two volunteers on one triage list, which is the
    // ordinary case rather than the exceptional one.
    message:
      'Somebody else resolved this one first, so nothing was changed. Their decision stands — the list below has been re-read.',
  },
  changed_elsewhere: {
    tone: 'ok',
    message:
      'Somebody else changed this capture while this page was open, so nothing was saved. The log below shows what it says now — make the change again if it is still wrong.',
  },
  not_discarded: {
    tone: 'bad',
    message: 'There is nothing to restore here — this capture is not discarded.',
  },
  no_such_crossing: {
    tone: 'bad',
    message: 'There is no capture with that reference, so nothing was changed.',
  },
  bib_required: {
    tone: 'bad',
    message: 'A corrected bib is needed to edit a capture. Nothing was changed.',
  },
  invalid_action: {
    tone: 'bad',
    message: 'That is not something this page can do, so nothing was changed.',
  },
  incomplete: {
    tone: 'bad',
    message: 'Nothing was asked for, so nothing was changed.',
  },
  refused: {
    tone: 'bad',
    message: 'That was refused, so nothing was changed.',
  },
  unavailable: {
    tone: 'bad',
    message:
      'The club’s database could not be reached, so nothing was changed. Try again in a moment — the list below may be out of date until it can be read.',
  },
};

/**
 * The outcome this query parameter names, or `null` for anything not written down above.
 *
 * ⚠️ **`Object.hasOwn` rather than `OUTCOMES[value] ?? null`.** An object literal inherits from
 * `Object.prototype`, so `OUTCOMES['toString']` is a *function* — truthy, so `??` would hand it
 * back and the page would read `.message` off it and render `undefined` in a notice.
 * `?outcome=constructor` is a URL anybody can type. `lib/access.ts`, `lib/start-outcomes.ts`
 * and `lib/marshal-outcomes.ts` carry the same fix, found there as a real defect.
 */
export function anomalyOutcomeFor(value: string | undefined): Outcome | null {
  if (value === undefined || !Object.hasOwn(OUTCOMES, value)) {
    return null;
  }

  return OUTCOMES[value] ?? null;
}
