import { z } from 'zod';
import type { AnonClient } from './supabase';

/**
 * The two calls that exist because a payment was confirmed — one that writes it, one that
 * reads it back.
 *
 * ## Why these are RPCs and not queries
 *
 * The same reason every other call in this schema is. There is no API tier between the browser
 * and Postgres; the anon role holds **no grant on any table in `entries`**, and
 * `packages/db/tests/entries.test.ts` asserts that on every table, for every verb, by error
 * code. So the door is a `security definer` function that decides everything that matters, and
 * accepts only the facts a caller can legitimately supply.
 *
 * ## The one thing that is different about the write
 *
 * `recordCheckoutEvent` takes a **key**, and no other call in this repository does.
 *
 * Every other function here is safe to hand an anonymous caller because none of them can be
 * abused with what they accept. A function that writes `paid` can: the anon key is published in
 * page source, and `entries.create_pending_purchase()` issues a real purchase id and its amount
 * to anybody who asks. Two ordinary calls with the published key would otherwise buy a free
 * race entry. The key is a Worker secret — `ENTRIES_WEBHOOK_KEY`, never in this repository —
 * and the database holds only its SHA-256 digest. The full argument is in the migration.
 *
 * ## Why the results are validated rather than trusted
 *
 * `supabase gen types` types both returns as `Json`, which is honest: Postgres builds them with
 * `jsonb_build_object` and TypeScript cannot know their shape. Parsing with the same library
 * the forms are validated with means a migration that renames a key fails here, in one place,
 * with a message — rather than surfacing as `undefined` in a branch that decides whether to
 * tell Stripe to retry.
 *
 * @see docs/architecture/principles.md#row-level-security-is-the-access-control
 */

/**
 * What the database did about one Stripe event.
 *
 * **`unknown` is not a defensive flourish.** Nothing sequences a migration against the
 * Cloudflare deploy, so an outcome added by a later migration can reach an older Worker. An
 * unrecognised outcome has to degrade to something the caller can still turn into an HTTP
 * status, and `.catch()` is what makes that true without a second code path.
 */
export const CHECKOUT_EVENT_OUTCOMES = [
  /** The key did not match, or no digest has been installed. **Our problem, so retry.** */
  'unauthorised',
  /** No purchase of ours names this session. Somebody else's payment; not an error. */
  'not_ours',
  /** A pending or revived purchase became `paid`. The only outcome that moves money's record. */
  'applied',
  /** It was already `paid`. A duplicate delivery, which is the ordinary case, not a fault. */
  'already_paid',
  /** A pending purchase became `expired`. */
  'expired',
  /** An event this endpoint does not act on, or a transition that no longer applies. */
  'ignored',
  /** Stripe's amount or currency disagreed with the purchase. **Nothing was written.** */
  'amount_mismatch',
  /** A completed event for a purchase somebody had already refunded. Nothing written. */
  'paid_after_refund',
  /** The purchase already names a different Checkout session. Nothing written. */
  'session_mismatch',
  /** Two purchases claim one session id. Nothing written. */
  'session_conflict',
  'unknown',
] as const;

export type CheckoutEventOutcome = (typeof CHECKOUT_EVENT_OUTCOMES)[number];

export interface CheckoutEventResult {
  /**
   * **False means this Worker or its configuration is at fault**, and the caller must ask
   * Stripe to try again. True means the question was answered, whatever the answer was.
   */
  ok: boolean;
  outcome: CheckoutEventOutcome;
  /** Whether this delivery is the one that changed the row. False on every repeat. */
  applied: boolean;
  /** The payment arrived after the row had stopped holding a place. */
  revived: boolean;
  /** It was paid, and there was no room. Somebody at the club has to decide what happens. */
  overCapacity: boolean;
  /** Set only on `amount_mismatch`, so the mismatch can be logged with both numbers. */
  expectedPence?: number;
  stripePence?: number;
}

/**
 * Three outcomes, and only the middle one is a real answer.
 *
 *   `recorded`    — the function ran and said what it did.
 *   `unavailable` — the question could not be asked: the migration has not landed, the network
 *                   failed, the shape did not parse. **Nothing was written**, and the caller
 *                   must ask Stripe to retry rather than answering 200 to a payment it did not
 *                   record.
 */
export type RecordCheckoutOutcome =
  | { status: 'recorded'; result: CheckoutEventResult }
  | { status: 'unavailable'; error: string };

const checkoutEventShape = z.object({
  ok: z.boolean(),
  outcome: z.enum(CHECKOUT_EVENT_OUTCOMES).catch('unknown'),
  applied: z.boolean().catch(false),
  revived: z.boolean().catch(false),
  over_capacity: z.boolean().catch(false),
  expected_pence: z.number().int().optional(),
  stripe_pence: z.number().int().optional(),
});

export interface CheckoutEventInput {
  /** `ENTRIES_WEBHOOK_KEY`. A Worker secret; never logged, never rendered. */
  key: string;
  /** Stripe's `type`. Passed through rather than filtered here — the database decides. */
  eventType: string;
  sessionId: string | null;
  /** The purchase id, as `client_reference_id` carried it. Anything else is `not_ours`. */
  clientReferenceId: string | null;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  /** Stripe's event id. Recorded as evidence, and never used as a key. */
  eventId: string | null;
}

/**
 * Apply one Stripe checkout event to the purchase it names.
 *
 * **Never throws**, because the caller owes Stripe an HTTP status either way and an exception
 * would become a 500 that says nothing about whether a retry would help.
 *
 * **Nothing here is logged by this function.** The payload it was built from carries an email
 * address, and the values passed on are a uuid, an integer and a classification — the caller
 * logs those, and never the body they came from.
 */
export async function recordCheckoutEvent(
  client: AnonClient,
  input: CheckoutEventInput,
): Promise<RecordCheckoutOutcome> {
  try {
    // **Absent keys rather than null ones.** `exactOptionalPropertyTypes` is on and the
    // generated argument types have no null in them, so an argument this Worker does not have
    // is omitted and the function's own `default null` applies. That is the same call, and it
    // is the pattern `createNnPendingPurchase` already uses for `p_discount_code`.
    //
    // Every one of these really can be missing. Stripe sends a session with no
    // `client_reference_id` for a payment this code never created — which is an ordinary thing
    // for this endpoint to receive, not an error.
    const { data, error } = await client.schema('entries').rpc('record_checkout_event', {
      p_key: input.key,
      p_event_type: input.eventType,
      ...(input.sessionId === null ? {} : { p_session_id: input.sessionId }),
      ...(input.clientReferenceId === null
        ? {}
        : { p_client_reference_id: input.clientReferenceId }),
      ...(input.amountTotal === null ? {} : { p_amount_total: input.amountTotal }),
      ...(input.currency === null ? {} : { p_currency: input.currency }),
      ...(input.paymentIntentId === null
        ? {}
        : { p_payment_intent_id: input.paymentIntentId }),
      ...(input.eventId === null ? {} : { p_stripe_event_id: input.eventId }),
    });

    if (error) {
      // The code and the message, neither of which can carry personal data: PostgREST reports
      // its own failures, and this function raises nothing carrying a row. `PGRST202` means the
      // migration has not landed, which is a deployment state rather than a bug — and the one
      // the caller must answer with a retry rather than a 200.
      return {
        status: 'unavailable',
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    const parsed = checkoutEventShape.safeParse(data);
    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'record_checkout_event returned an unexpected shape',
      };
    }

    return {
      status: 'recorded',
      result: {
        ok: parsed.data.ok,
        outcome: parsed.data.outcome,
        applied: parsed.data.applied,
        revived: parsed.data.revived,
        overCapacity: parsed.data.over_capacity,
        // Omitted rather than set to `undefined`: `exactOptionalPropertyTypes` is on.
        ...(parsed.data.expected_pence === undefined
          ? {}
          : { expectedPence: parsed.data.expected_pence }),
        ...(parsed.data.stripe_pence === undefined
          ? {}
          : { stripePence: parsed.data.stripe_pence }),
      },
    };
  } catch (cause) {
    // A network failure, or `createAnonClient` refusing a key that looks like a service role
    // key. Neither can carry personal data.
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

// -----------------------------------------------------------------------------------------
// Reading it back, for /nn/entry/complete/
// -----------------------------------------------------------------------------------------

/**
 * The five things `/nn/entry/complete/` may be told, and **the only thing it is told**.
 *
 *   `paid`      the webhook has recorded a payment. The one positive claim this page can make.
 *   `pending`   a place is held; no payment recorded yet. Usually seconds old.
 *   `lapsed`    the hold ran out and no payment is recorded. **Not "nothing was charged"** —
 *               the webhook may simply be late, and telling somebody their card was not
 *               charged when it was is how they pay twice.
 *   `refunded`  somebody at the club refunded it.
 *   `unknown`   no purchase names this session id. A made-up one lands here, and so does a very
 *               old one, and they are indistinguishable on purpose.
 */
export const ENTRY_COMPLETION_STATES = [
  'paid',
  'pending',
  'lapsed',
  'refunded',
  'unknown',
] as const;

export type EntryCompletionState = (typeof ENTRY_COMPLETION_STATES)[number];

export type EntryCompletionResult =
  { ok: true; state: EntryCompletionState } | { ok: false; error: string };

const completionShape = z.object({
  // **`.catch('unknown')` rather than a failure.** A state added by a later migration reaching
  // an older Worker must render the page that claims least, not a 500 at somebody who has just
  // paid.
  state: z.enum(ENTRY_COMPLETION_STATES).catch('unknown'),
});

/**
 * What the club has recorded about one Checkout session.
 *
 * **Never throws, and never guesses `paid`.** Every failure — the migration not landed, the
 * database unreachable, a shape that does not parse — is `ok: false`, and the page renders the
 * state that claims nothing. A page that cannot reach the database must not tell somebody they
 * are entered.
 */
export async function fetchEntryCompletionState(
  client: AnonClient,
  sessionId: string,
): Promise<EntryCompletionResult> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('entry_completion_state', { p_session_id: sessionId });

    if (error) {
      return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
    }

    const parsed = completionShape.safeParse(data);

    return parsed.success
      ? { ok: true, state: parsed.data.state }
      : { ok: false, error: 'entry_completion_state returned an unexpected shape' };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }
}
