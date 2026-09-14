/**
 * What the results screen says after somebody publishes, unpublishes, or is refused — #205.
 *
 * The sixth module of this shape, after `start-outcomes.ts`, `marshal-outcomes.ts`,
 * `anomaly-outcomes.ts`, `status-outcomes.ts` and `reset-outcomes.ts`, and the two rules those
 * carry apply unchanged: **nothing from the query string is ever rendered**, and **an unknown
 * value says nothing at all**.
 *
 * ## ⚠️ The wording has to survive the one thing nothing else here does — being read by the public
 *
 * Every other write on this platform changes a record a handful of volunteers can see.
 * Publishing puts a table on the open internet under the club's name, and unpublishing takes it
 * away again while somebody may be looking at it. So each sentence says **who can see what
 * now**, not merely that a button worked:
 *
 *   * publishing says the results are public, because a volunteer who thought they were only
 *     confirming something would have just published a race;
 *   * unpublishing says the page is a 404 again — *"the page has gone"* is the fact somebody
 *     needs before they answer a spectator asking where the results went;
 *   * `open_anomalies` names the rule rather than the number, because the page is already
 *     showing the live count with a link beside it — and the count that came back with the
 *     refusal is a moment old by the time anybody reads it.
 *
 * ⚠️ **No sentence here carries a value from the query string, interpolated or otherwise.** The
 * count on the page comes from the read, not from `?open=`; this module's job is the club's
 * words, and `sync-outcomes.ts` states the rule as *nothing the database says is ever rendered
 * on a card*.
 */

export type OutcomeTone = 'ok' | 'bad';

export interface Outcome {
  tone: OutcomeTone;
  message: string;
}

const OUTCOMES: Record<string, Outcome> = {
  published: {
    tone: 'ok',
    // ⚠️ Says **public**, in as many words. Somebody who believed this was an internal
    // confirmation has just put a table of names on the internet.
    message:
      'These results are published. Anybody can read them now, signed in or not, at the race’s results page. To correct something, unpublish first — the page goes back to not found while you do.',
  },
  already_published: {
    tone: 'ok',
    message:
      'These results were already published, so nothing was changed. The time below is the one that stands.',
  },
  unpublished: {
    tone: 'ok',
    // ⚠️ **"The page has gone"** rather than "unpublished", because that is the fact a
    // volunteer needs when a spectator asks where the results went.
    message:
      'These results are no longer published. The public results page has gone back to not found, which is the honest state for a table being corrected. Publish again when it is right.',
  },
  not_published: {
    tone: 'bad',
    message: 'These results were not published, so there was nothing to take down.',
  },
  not_finished: {
    tone: 'bad',
    // The club's own rule, said as a rule rather than as an error: finishing is a separate act
    // by a separate permission, and this sentence is where somebody meets that for the first
    // time.
    message:
      'This race has not been marked finished, so its results cannot be published yet. Finishing and publishing are two separate decisions — finish the race first.',
  },
  open_anomalies: {
    tone: 'bad',
    message:
      'These results were not published, because captures on this race are still to be resolved. Publication is the one moment a suspect capture must not pass through quietly — the count below is the live one, and clearing them is what unblocks this.',
  },
  no_such_event: {
    tone: 'bad',
    message: 'There is no race at this address, so nothing was changed.',
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
    // ⚠️ **Never a refusal.** `writes.ts`' header: a page that says "that was refused" after an
    // outage tells a volunteer they may not do something they may do.
    message:
      'The club’s database could not be reached, so nothing was changed. Try again in a moment — this page will say what the race holds once it can be read.',
  },
};

/**
 * The outcome this query parameter names, or `null` for anything not written down above.
 *
 * `Object.hasOwn` rather than `OUTCOMES[value] ?? null` — an object literal inherits from
 * `Object.prototype`, so `OUTCOMES['toString']` is a function and `??` would hand it back.
 * Five sibling modules carry the same fix, found in `lib/access.ts` as a real defect.
 */
export function resultsOutcomeFor(value: string | undefined): Outcome | null {
  if (value === undefined || !Object.hasOwn(OUTCOMES, value)) {
    return null;
  }

  return OUTCOMES[value] ?? null;
}

/**
 * Which of the three lifecycle states a race is in, in the club's own words — #241's state
 * machine, named on the screen rather than left for somebody to infer from two timestamps.
 *
 * ⚠️ **Derived from the two columns and never stored.** There is no lifecycle enum in
 * `timing.events`, deliberately: `finished_at` and `results_published_at` are the facts, and a
 * third column saying which state they add up to is a column that can disagree with them.
 */
export type LifecycleState = 'capturing' | 'finished' | 'published';

export function lifecycleStateFor(event: {
  finished_at: string | null;
  results_published_at: string | null;
}): LifecycleState {
  if (event.results_published_at !== null) return 'published';
  return event.finished_at === null ? 'capturing' : 'finished';
}

/** The heading word for each state, and the sentence under it. */
export const LIFECYCLE_WORDS: Record<LifecycleState, { label: string; detail: string }> =
  {
    capturing: {
      label: 'Capturing',
      detail:
        'Crossings are still being recorded. These times are a preview and can change; nobody outside this page can see them.',
    },
    finished: {
      label: 'Finished, not published',
      detail:
        'The race has been called finished and the results are not public yet. Crossings can still be recorded and corrected — finishing is a label, not a cut-off.',
    },
    published: {
      label: 'Published',
      detail:
        'These results are public. Anybody can read them at the race’s results page, signed in or not.',
    },
  };
