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
    // Shared by an edit and an add since ADR-071, so it names neither.
    message: 'A bib is needed. Nothing was changed.',
  },
  /**
   * ADR-071's add, and the refusals `timing.add_crossing()` and `lib/typed-time.ts` give. ⚠️
   * **Every one of them points at the paper**, because that is what the person is copying from
   * and the likeliest place the mistake is — and none says "try again", which would add the
   * same wrong thing twice.
   */
  added: {
    tone: 'ok',
    message:
      'Added. It counts towards results straight away — it is the capture shown below, marked as added by hand.',
  },
  already_captured: {
    tone: 'bad',
    message:
      'That bib already has a crossing that counts, so nothing was added. It is shown below — correct its time there instead.',
  },
  unknown_bib: {
    tone: 'bad',
    message:
      'No team on this race carries that bib, so nothing was added. Check it against the paper and the entry list.',
  },
  before_start: {
    tone: 'bad',
    message:
      'That time is before this race started, so nothing was added. Check the hour against the paper.',
  },
  in_future: {
    tone: 'bad',
    message:
      'That time has not happened yet, so nothing was changed. Check the hour against the paper.',
  },
  published: {
    tone: 'bad',
    message:
      'This race’s results are published, so nothing was added. Unpublish them on the Results page, make the correction, then publish again.',
  },
  time_required: {
    tone: 'bad',
    message: 'A time is needed, in hours, minutes and seconds. Nothing was changed.',
  },
  time_unreadable: {
    tone: 'bad',
    message:
      'That time could not be read. Type it in hours, minutes and seconds, like 11:47:32. Nothing was changed.',
  },
  time_ambiguous: {
    tone: 'bad',
    message:
      'That time happened twice on the race’s date, because the clocks went back, and this page cannot tell which was meant. Nothing was changed.',
  },
  time_nonexistent: {
    tone: 'bad',
    message:
      'That time never happened on the race’s date, because the clocks went forward over it. Nothing was changed.',
  },
  no_such_event: {
    tone: 'bad',
    message: 'There is no race at this address, so nothing was changed.',
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
