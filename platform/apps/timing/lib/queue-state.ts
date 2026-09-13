/**
 * The capture queue's state machine, with nothing in it that touches a browser.
 *
 * Issue [#203](https://github.com/southville-running-club/src-website/issues/203), under
 * [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * which makes `bindalshah/src-race-timing` the specification for the rewrite. The old
 * application kept these rules inside `lib/queue-db.ts` and `marshal-screen.tsx`, tangled with
 * IndexedDB and with React. **The behaviour below is the old application's; what changed is
 * that it is separable and therefore assertable.**
 *
 * ## Why this is its own file
 *
 * `queue-db.ts` next door needs `indexedDB`, and `marshal-screen.tsx` needs a DOM. Neither is
 * available to a unit test here, so anything that lives in them is covered only by Playwright
 * — which is the slowest layer and the one that cannot easily reach a tenth retry. **The
 * rules a race depends on are pure functions and belong where a test can call them a hundred
 * times**: this repository's four-layer rule, applied to the one surface where a defect cannot
 * be re-run.
 *
 * ## The rule the whole file is built around
 *
 * ⚠️ **At the line the scarce resource is the moment, not the marshal's attention.** The
 * button timestamps immediately and asks for a bib afterwards; every state below exists to
 * make that safe. **An anomaly flags and never blocks** — a duplicate bib marks the card and
 * says why, and the marshal confirms anyway. ADR-034 names both as decisions rather than
 * implementation details, and they are the two a rewrite is most likely to "improve" by
 * accident.
 */

import {
  checkAnomaly,
  formatAnomalyMessage,
  type EventFormat,
} from '@src/shared/timing/anomaly';

/**
 * ⚠️ **`failed` is a state of its own and not a flag on `queued`.**
 *
 * The old application's reason survives verbatim: *an offline tap must never look like an
 * error, and a real error must never look routine*. A marshal with no signal is having an
 * ordinary morning and their cards say `queued`; a marshal whose crossing was refused has a
 * problem somebody has to look at. Collapsing the two — a `queued` card with an error string
 * on it — is how one becomes invisible inside the other.
 *
 * `awaiting-bib` is the card between the tap and the keypad. It is **never synced**: a
 * crossing with no bib is a row nothing can resolve a team from, and the whole point of the
 * queue model is that the time is already safe locally while the bib is still being typed.
 */
export type CardState = 'awaiting-bib' | 'queued' | 'syncing' | 'failed';

/**
 * One tap, from the moment it happens until the database has it.
 *
 * ⚠️ **`id` is generated on the phone and is `timing.crossings.id`.** That is what makes a
 * retry idempotent: `record_crossing()` inserts `on conflict (id) do nothing` and answers `ok`
 * either way, so a card whose response was lost is retired rather than recorded twice.
 */
export interface QueueCard {
  /** The client-generated UUID that is this crossing's primary key. */
  id: string;
  /** Which race this tap belongs to. Cards are per-origin, so the slug has to be on them. */
  eventSlug: string;
  /**
   * The phone's clock at the tap, ISO 8601.
   *
   * ⚠️ **Nothing replaces this at sync**, on the client or in the database. A drain an hour
   * after a signal gap would otherwise record when the signal came back, which is not a time
   * anybody ran.
   */
  capturedAt: string;
  /** The bib, once the keypad has been confirmed. `null` while `awaiting-bib`. */
  bib: string | null;
  state: CardState;
  /**
   * How many times a sync has been attempted and failed.
   *
   * ⚠️ **Never reset, including by a manual retry** — the old application's behaviour, kept
   * deliberately. A counter a marshal can zero by pressing a button is a counter that never
   * reaches the cap, and the cap is the only thing that turns a card nobody can send into a
   * card somebody is told about.
   */
  retries: number;
  /**
   * The verdict at confirm time, frozen.
   *
   * ⚠️ **Never recomputed, on the client or in the database.** It is what the marshal was
   * looking at in the moment they confirmed; re-deriving it later against rows that have since
   * changed would silently rewrite what somebody actually saw.
   * `20260912120000_timing_record_crossing.sql` carries the same rule for the server half.
   */
  anomalyFlag: boolean;
  anomalyReason: string | null;
  /**
   * What to tell the marshal about the last failure — **the club's own wording, never the
   * database's**.
   *
   * ⚠️ **This field is why `lib/sync-outcomes.ts` exists.** The old application put the
   * `PostgrestError` straight on the card, and a `PostgrestError` is a plain object rather
   * than an `Error`, so a card once read `[object Object]`. A marshal on a finish line cannot
   * do anything with a Postgres error code, and the one thing the card has to say is whether
   * to keep going or fetch somebody.
   */
  lastError: string | null;
}

/**
 * How many failures before a card stops draining by itself and asks for a human.
 *
 * ⚠️ **Ten, with the thirty-second drain, is about five minutes** — and whether that is long
 * enough for Ashton Court's signal is an open question the old application recorded against
 * itself and never answered. It is carried into
 * [#207](https://github.com/southville-running-club/src-website/issues/207)'s checklist rather
 * than guessed at here: the simulation is what can answer it, and changing the number on a
 * hunch would be changing the one behaviour that decides whether a crossing is lost quietly.
 */
export const RETRY_CAP = 10;

/** A card the marshal has to deal with by hand: it has failed as often as it is going to. */
export function atRetryCap(card: QueueCard): boolean {
  return card.retries >= RETRY_CAP;
}

/**
 * Whether this string is a bib a marshal may confirm.
 *
 * ⚠️ **Digits only, leading zeros preserved, and no leg-prefix rule** — which is deliberately
 * weaker than `parseBib()` next door in `@src/shared/timing/anomaly`. That function refuses `0147`,
 * because on a relay there is no leg 0; **this one accepts it, because a walk-in is handed
 * whatever bib is in the pool** and the desk records the number on the card rather than a
 * number a scheme derived. A screen that refused those would refuse a runner who is on the
 * course.
 *
 * So the two disagree on purpose and the disagreement is the feature: the *form* rule is what
 * a marshal may type, and the *anomaly* rule is what the club thinks of it afterwards. An
 * unparseable bib simply produces no anomaly and is stored as it was typed —
 * `record_crossing()` takes an unknown bib with `team_id` null and no error, for the same
 * reason.
 */
export function validateBib(bib: string): boolean {
  return /^\d+$/.test(bib.trim());
}

/** The tap: a card with a time and no bib yet. The one thing that must never be slow. */
export function newCard(id: string, eventSlug: string, capturedAt: string): QueueCard {
  return {
    id,
    eventSlug,
    capturedAt,
    bib: null,
    state: 'awaiting-bib',
    retries: 0,
    anomalyFlag: false,
    anomalyReason: null,
    lastError: null,
  };
}

/** What a crossing already in the database looks like to the anomaly check. */
export interface KnownCrossing {
  id: string;
  bib: string | null;
  captured_at: string;
}

/**
 * Confirming the keypad: the bib goes on, the anomaly is decided **once**, and the card joins
 * the queue.
 *
 * Returns `null` for a bib that is not one, so the caller cannot queue a crossing nothing can
 * ever resolve. That is the one place this file blocks anything, and it blocks a *typo* rather
 * than a *crossing* — the time is already recorded on the card either way.
 */
export function confirmBib(
  card: QueueCard,
  bib: string,
  format: EventFormat,
  known: readonly KnownCrossing[],
): QueueCard | null {
  const trimmed = bib.trim();
  if (!validateBib(trimmed)) {
    return null;
  }

  // ⚠️ **Flag and never block.** `checkAnomaly` answers, the card carries the answer, and the
  // crossing queues regardless. The marshal has already been shown what it says.
  const anomaly = checkAnomaly(
    trimmed,
    format,
    known.map((c) => ({ bib: c.bib, captured_at: c.captured_at })),
  );

  return {
    ...card,
    bib: trimmed,
    state: 'queued',
    anomalyFlag: anomaly.flag,
    anomalyReason: anomaly.flag ? formatAnomalyMessage(anomaly.reason) : null,
  };
}

/**
 * A card the drain has picked up. `queued` and `failed` both go to `syncing`; anything else is
 * left alone — a card `awaiting-bib` has no bib to send, and one already `syncing` is in
 * flight.
 */
export function beginSync(card: QueueCard): QueueCard {
  return card.state === 'queued' || card.state === 'failed'
    ? { ...card, state: 'syncing' }
    : card;
}

/**
 * A sync that did not land. The counter goes up, the wording goes on, and the card is `failed`
 * — visibly, in its own state, rather than quietly back in the queue.
 */
export function syncFailed(card: QueueCard, wording: string): QueueCard {
  return {
    ...card,
    state: 'failed',
    retries: card.retries + 1,
    lastError: wording,
  };
}

/**
 * What the reload reconcile decides about the cards that were `syncing` when the page went
 * away.
 *
 * ⚠️ **This is the case a reload is most dangerous in, and it is why the check is by id.** A
 * card left `syncing` is one whose request was sent and whose answer was never seen: it may be
 * in the database and it may not. Re-sending it is safe — the insert is idempotent on the id —
 * so the only real cost of getting this wrong is a card that sits on the screen for ever, or
 * one that disappears while its crossing was never recorded. Reading the ids back answers it
 * outright.
 *
 * A card in any other state is left exactly as it was: `awaiting-bib` still wants a keypad,
 * `queued` still wants a drain, and `failed` still wants the marshal to see it.
 */
export function reconcile(
  cards: readonly QueueCard[],
  knownIds: ReadonlySet<string>,
): { retire: string[]; keep: QueueCard[] } {
  const retire: string[] = [];
  const keep: QueueCard[] = [];

  for (const card of cards) {
    if (card.state === 'syncing' && knownIds.has(card.id)) {
      // It landed. The response was what went missing, not the crossing.
      retire.push(card.id);
      continue;
    }

    // ⚠️ **Back to `queued`, not left `syncing`.** Nothing is in flight after a reload — the
    // request died with the page — so a card left `syncing` would be skipped by `beginSync`
    // for ever and never drain again.
    keep.push(card.state === 'syncing' ? { ...card, state: 'queued' } : card);
  }

  return { retire, keep };
}

/**
 * The order the cards are shown in: **newest tap first**.
 *
 * The card a marshal is typing a bib into is the one they just made, and a list that grew
 * downwards would put it below the fold within a dozen crossings. Ties break on id so the
 * order is stable across renders — two taps inside the same millisecond are rare and a list
 * that reshuffles under a thumb is not.
 */
export function sortCards(cards: readonly QueueCard[]): QueueCard[] {
  return [...cards].sort((a, b) =>
    a.capturedAt === b.capturedAt
      ? a.id.localeCompare(b.id)
      : b.capturedAt.localeCompare(a.capturedAt),
  );
}
