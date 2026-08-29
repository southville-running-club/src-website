import { z } from 'zod';
import type { Database } from '@src/db';
import type { AnonClient, DbClient } from './supabase';
import { toIsoDate } from './age-category';
import type { NnEntry, NnEntryGuide } from './nn-entry';

/**
 * Holding a place, and writing back the Stripe reference once there is one.
 *
 * ## Two calls, and why there are two
 *
 * A Checkout session carries the purchase id as its `client_reference_id`, so the purchase
 * has to exist before the session can be created — and the session id can only be written
 * back afterwards. That is the whole reason `attachCheckoutSession` exists as a second call
 * rather than as another argument to the first.
 *
 * ## Why these are RPCs and not inserts
 *
 * The same reason `entry-state.ts` is. There is no API tier between the browser and
 * Postgres, so an insert would need a grant on `entries.entry_purchases` — and a grant on a
 * table holding names, dates of birth, emergency contacts and payment references is the one
 * thing that schema is deliberately without. `packages/db/tests/entries.test.ts` asserts
 * that every table refuses the anon role, for every verb, by error code, and that assertion
 * is written to outlive every slice. So the door is a `security definer` function which
 * decides everything that matters — the price, the capacity, the consent version — and
 * accepts only the facts a form can legitimately supply.
 *
 * ## Why the result is validated rather than trusted
 *
 * `supabase gen types` types the return as `Json`, which is honest: Postgres builds it with
 * `jsonb_build_object` and TypeScript cannot know its shape. Parsing it with the same
 * library the form is validated with means a migration that renames a key fails here, in one
 * place, with a message — rather than surfacing as `undefined` inside a redirect that sends
 * somebody to Stripe for `NaN` pence.
 *
 * @see docs/architecture/principles.md#row-level-security-is-the-access-control
 */

/**
 * Why the database refused, in its own words.
 *
 * **`unknown` is not a defensive flourish.** Nothing sequences a migration against the
 * Cloudflare deploy, so a reason added by a later migration can reach an older Worker. An
 * unrecognised reason has to degrade to "we could not complete this" rather than to a crash,
 * and `.catch()` is what makes that true without a second code path.
 */
export const PENDING_PURCHASE_REASONS = [
  'no_such_event',
  'closed',
  'sold_out',
  'invalid_fee',
  'invalid_discount',
  'invalid_entrants',
  'under_minimum_age',
  // **Drift if it ever reaches the deployed form**, because `parseNnEntry` refuses it first —
  // which is exactly why it is named rather than folded into `invalid_entrants`. A log line
  // saying `consents_missing` says the form and the database disagree about what was agreed;
  // one saying `invalid_entrants` says something, somewhere, in the entrant block. Only the
  // first is actionable at four in the morning.
  //
  // **`ea_number_required` was here until 29 August 2026**, when the club stopped asking for
  // England Athletics numbers. `create_pending_purchase()` still carries the branch and no fee
  // can reach it — `fees_ea_number_not_collected` sees to that — so a reason nothing can
  // return has no place on a list whose whole job is to make a log line actionable. If one
  // ever arrives it lands on `unknown`, which is the right answer to a refusal this build has
  // never heard of.
  'consents_missing',
  // **The one reason on this list that a person is meant to meet.** Everything above it is
  // either drift or a race the club lost; this is the ordinary case of somebody who already
  // has a place filling the form in again — most often because they are not sure the first
  // one worked, which is a thing the confirmation page cannot reassure them about and the
  // absent confirmation email cannot either. So it gets its own notice rather than folding
  // into `failed`, and the notice points at `/account/entries/`.
  'already_entered',
  'unknown',
] as const;

export type PendingPurchaseReason = (typeof PENDING_PURCHASE_REASONS)[number];

export interface PendingPurchase {
  /** The purchase row's id. Becomes Stripe's `client_reference_id`, and nothing else. */
  purchaseId: string;
  /** What to charge, **as the database computed it**. Never a number from a form. */
  amountPence: number;
  /** The fee's own label, for the Checkout line item. */
  feeLabel: string;
  /** When the held place lapses. The Checkout session is set to expire with it. */
  holdExpiresAt: Date;
}

/**
 * Three outcomes, and the middle one is the interesting one.
 *
 *   `created`     — a place is held and there is something to charge for.
 *   `refused`     — the database said no, and said why. `sold_out` is a page somebody reads,
 *                   not an error somebody debugs.
 *   `unavailable` — the question could not be asked at all: the migration has not landed,
 *                   the network failed, the shape did not parse. **Nothing was written**, and
 *                   the caller must not tell anybody otherwise.
 */
export type PendingPurchaseOutcome =
  | { status: 'created'; purchase: PendingPurchase }
  | { status: 'refused'; reason: PendingPurchaseReason }
  | { status: 'unavailable'; error: string };

const refusedShape = z.object({
  ok: z.literal(false),
  reason: z.enum(PENDING_PURCHASE_REASONS).catch('unknown'),
});

const createdShape = z.object({
  ok: z.literal(true),
  purchase_id: z.uuid(),
  amount_pence: z.number().int().min(0),
  fee_label: z.string().min(1),
  hold_expires_at: z.string().min(1),
});

/**
 * One runner, in the column names the function expects.
 *
 * **Snake case, matching `entries.entrants` exactly**, so the mapping is readable against
 * the table rather than against a convention. The function reads these keys and nothing
 * else; anything extra is ignored rather than stored.
 *
 * `leg` is null because Nightingale Nightmare is a solo race. It is stated rather than
 * omitted so that the first paired race meets a field to fill in rather than a field to
 * discover.
 */
export function nnEntrantPayload(entry: NnEntry): Record<string, string | null> {
  return {
    first_name: entry.firstName,
    last_name: entry.lastName,
    date_of_birth: toIsoDate(entry.dateOfBirth),
    gender: entry.gender,
    gender_identity: entry.genderIdentity,
    club: entry.club,
    // **No `ea_number` key at all since 29 August 2026.** The column is still there and
    // `create_pending_purchase()` still reads for it; sending nothing is the same as sending
    // null to `coalesce(v_entrant ->> 'ea_number', '')`, and it says plainly that this build
    // has no such thing to send.
    emergency_contact_name: entry.emergencyName,
    emergency_contact_phone: entry.emergencyPhone,
    leg: null,
    // **Stated rather than left to the column default**, because the function checks the role
    // against the position and a payload that says nothing would be agreeing by accident.
    role: 'runner',
  };
}

/**
 * The guide, in the same column names.
 *
 * **Three keys are null and each is null for a reason**, rather than because the guide's form
 * did not ask. `gender_identity` and `club` are questions nothing derives anything from for
 * somebody in no category; `leg` is a paired-race field on a solo race.
 */
export function nnGuidePayload(guide: NnEntryGuide): Record<string, string | null> {
  return {
    first_name: guide.firstName,
    last_name: guide.lastName,
    date_of_birth: toIsoDate(guide.dateOfBirth),
    // **Their own address, and the one key a runner's payload does not carry.** A runner is
    // reachable through `entry_purchases.purchaser_email`; a guide has no purchase of their
    // own, so this is the club's only way to reach the second person on the course.
    email: guide.email,
    // **Null, and the column allows it for exactly this row.** A guide is in no prize
    // category — not timed, not placed, rendered as `Guide` wherever a band would go — so
    // asking which one they would be in was collecting an answer nothing could use. A runner
    // with a null here is still refused, by `entrants_gender_unless_guide`.
    gender: null,
    gender_identity: null,
    club: null,
    emergency_contact_name: guide.emergencyName,
    emergency_contact_phone: guide.emergencyPhone,
    leg: null,
    // **The last element, and it must say so.** `create_pending_purchase()` refuses a payload
    // whose roles and positions disagree rather than reordering it, because a silently
    // reordered entry records a place against somebody nobody meant.
    role: 'guide',
  };
}

export interface NnPendingPurchaseInput {
  slug: string;
  entry: NnEntry;
  /**
   * Overrides the code on the entry itself. Present because the preview and the real call
   * must send **the same** code — a page that priced one code and charged against another
   * would be a page that lied about the total.
   */
  discountCode?: string | null;
}

/**
 * The arguments for `entries.create_pending_purchase`, built once and used twice.
 *
 * **Shared between the preview and the real call deliberately.** They differ in exactly one
 * flag, and any second difference would mean the amount somebody was shown was computed from
 * something other than the entry they went on to buy.
 *
 * One entrant, or two when a guide has been declared. A paired race gets its own builder
 * alongside this one rather than a third case here — the shape of "who is entering" is
 * exactly the thing that differs between races, and a guide is not a second competitor.
 */
type CreatePendingPurchaseArgs =
  Database['entries']['Functions']['create_pending_purchase']['Args'];

function nnPendingPurchaseArgs(input: NnPendingPurchaseInput): CreatePendingPurchaseArgs {
  const { entry } = input;
  const discountCode = (input.discountCode ?? entry.discountCode)?.trim();
  const guide = entry.guide;

  return {
    p_slug: input.slug,
    p_fee_code: entry.feeCode,
    p_purchaser_name: `${entry.firstName} ${entry.lastName}`,
    p_purchaser_email: entry.email,
    p_entrants: guide
      ? [nnEntrantPayload(entry), nnGuidePayload(guide)]
      : [nnEntrantPayload(entry)],
    // **Aligned with `p_entrants` by position, and already null unless consent was given.**
    // `parseNnEntry` drops the notes at the boundary when the box is unticked, and the
    // function drops them again — two locks, and neither depends on the other.
    p_medical: guide ? [entry.medicalNotes, guide.medicalNotes] : [entry.medicalNotes],
    p_consents: {
      entryTerms: entry.consents.entryTerms,
      medical: entry.consents.medical,
      // **What decides whether a second entrant is allowed at all**, which is why it is sent
      // whether or not it is true rather than only when it is.
      vi: entry.consents.vi,
    },
    // **Omitted rather than passed as `undefined`.** `exactOptionalPropertyTypes` is on, and
    // the generated argument type says `p_discount_code?: string` — so the key has to be
    // absent when there is no code, which is also what lets the function's own `default null`
    // apply.
    ...(discountCode ? { p_discount_code: discountCode } : {}),
  };
}

/**
 * Hold a place and record a pending purchase.
 *
 * **Never throws.** Every failure it can meet is one of the three outcomes, because there is
 * a person on a phone waiting for a page rather than a caller who can retry.
 */
export async function createNnPendingPurchase(
  client: DbClient,
  input: NnPendingPurchaseInput,
): Promise<PendingPurchaseOutcome> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('create_pending_purchase', nnPendingPurchaseArgs(input));

    if (error) {
      // **The code and the message, and neither can carry personal data**: PostgREST reports
      // its own failures, and this function raises nothing carrying a row. `PGRST202` means
      // the migration has not landed yet, which is a deployment state rather than a bug.
      return {
        status: 'unavailable',
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    const refused = refusedShape.safeParse(data);
    if (refused.success) {
      return { status: 'refused', reason: refused.data.reason };
    }

    const created = createdShape.safeParse(data);
    if (!created.success) {
      return {
        status: 'unavailable',
        error: 'create_pending_purchase returned an unexpected shape',
      };
    }

    const holdExpiresAt = new Date(created.data.hold_expires_at);
    if (Number.isNaN(holdExpiresAt.getTime())) {
      return {
        status: 'unavailable',
        error: 'create_pending_purchase returned an unusable hold_expires_at',
      };
    }

    return {
      status: 'created',
      purchase: {
        purchaseId: created.data.purchase_id,
        amountPence: created.data.amount_pence,
        feeLabel: created.data.fee_label,
        holdExpiresAt,
      },
    };
  } catch (cause) {
    // A network failure, or `createAnonClient` refusing a key that looks like a service role
    // key. Neither can carry personal data, and neither is worth a 500 at a person who has
    // just filled in fourteen fields.
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

/**
 * What an entry would cost, established without holding anything.
 *
 * `listPricePence` is the fee's own price and `amountPence` is what would be charged. The
 * saving is the difference, and it comes from the database rather than being recomputed here
 * — a saving worked out in the Worker from a price the Worker assumed is how the number on
 * the page and the number on the card start disagreeing.
 */
export interface PricedNnEntry {
  amountPence: number;
  listPricePence: number;
  feeLabel: string;
  /** Whether a code was actually applied, as opposed to none having been typed. */
  discountApplied: boolean;
}

export type NnEntryPriceOutcome =
  | { status: 'priced'; priced: PricedNnEntry }
  | { status: 'refused'; reason: PendingPurchaseReason }
  | { status: 'unavailable'; error: string };

const pricedShape = z.object({
  ok: z.literal(true),
  preview: z.literal(true),
  amount_pence: z.number().int().min(0),
  list_price_pence: z.number().int().min(0),
  fee_label: z.string().min(1),
  discount_applied: z.boolean(),
});

/**
 * Price an entry without holding a place or spending a discount code use.
 *
 * **The same function, the same arguments, one flag different.** It runs every rule the real
 * call runs — the window, the entrants, the consents, the capacity, the fee, the England
 * Athletics number, the age, one-runner-one-place — and returns immediately before the first
 * write. So a `refused` here is exactly the refusal the real call would have given, which is
 * what makes it safe to show somebody a total and then charge it.
 *
 * **It is not a code-checking endpoint and must not become one.** Reaching a `priced` result
 * costs a complete, valid submission; that is what keeps it from being a cheaper oracle for
 * guessing codes than the entry path already is. See the header of
 * `20260828140000_entries_discounts_and_guides.sql`.
 */
export async function priceNnEntry(
  client: DbClient,
  input: NnPendingPurchaseInput,
): Promise<NnEntryPriceOutcome> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('create_pending_purchase', {
        ...nnPendingPurchaseArgs(input),
        p_preview: true,
      });

    if (error) {
      return {
        status: 'unavailable',
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    const refused = refusedShape.safeParse(data);
    if (refused.success) {
      return { status: 'refused', reason: refused.data.reason };
    }

    const priced = pricedShape.safeParse(data);
    if (!priced.success) {
      // **Including the case where an older database answered with a real purchase.** A
      // deployment in which this Worker is ahead of the migration would have `p_preview`
      // ignored and a place actually held — so anything that is not the preview shape is
      // treated as the question not having been asked, and the caller falls back to the
      // one-step path rather than showing a total it cannot vouch for.
      return {
        status: 'unavailable',
        error: 'create_pending_purchase did not return a preview',
      };
    }

    return {
      status: 'priced',
      priced: {
        amountPence: priced.data.amount_pence,
        listPricePence: priced.data.list_price_pence,
        feeLabel: priced.data.fee_label,
        discountApplied: priced.data.discount_applied,
      },
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

/**
 * Write the Checkout session id onto the purchase it belongs to.
 *
 * **Its failure is never a reason to fail a payment.** Slice C's webhook finds the purchase
 * by `client_reference_id`, which is set when the session is created and cannot go missing;
 * this column is for reconciliation. A caller that cannot attach should log the fact and
 * send the person to Stripe anyway.
 */
export async function attachCheckoutSession(
  client: DbClient,
  purchaseId: string,
  sessionId: string,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('attach_checkout_session', {
        p_purchase_id: purchaseId,
        p_session_id: sessionId,
      });

    return !error && data === true;
  } catch {
    return false;
  }
}

/** What the five-minute sweep found. */
export interface PendingHoldSweep {
  /** Places that came back into the pool since the last run. Usually zero. */
  expired: number;
  /**
   * Purchases waiting for a human — an over-capacity payment, an amount that disagreed with
   * Stripe, a completed event for something already refunded. **Non-zero is the alarm**, and
   * it stays non-zero until somebody sets `attention_resolved_at` by hand. See the runbook.
   */
  attention: number;
  /** How long the oldest unresolved one has been waiting, in whole hours. */
  attentionOldestHours: number;
}

/**
 * Move lapsed holds to `expired`, and report anything waiting for a human.
 *
 * **The expiry half is housekeeping, not the mechanism.** A lapsed hold stops consuming a place
 * the instant it lapses, because the capacity count in `create_pending_purchase` excludes it —
 * whether or not anything has swept it. If this never runs again, nobody is turned away.
 *
 * **The attention half is not housekeeping**, and it is why this call is worth making even in
 * the common case where nothing expired. It is the only repeating channel this platform has:
 * there is no alerting stack and no email until Slice D, so a flag on a row that a cron shouts
 * about every five minutes is what stands between an oversold race and nobody finding out.
 *
 * **The two counts are folded into one call deliberately.** Every anon-executable object is
 * surface reachable with a key that is published in page source, and this needs no new one and
 * no extra round trip on a job that already runs.
 */
export async function expirePendingHolds(
  client: AnonClient,
): Promise<({ ok: true } & PendingHoldSweep) | { ok: false; error: string }> {
  try {
    const { data, error } = await client.schema('entries').rpc('expire_pending_holds');

    if (error) {
      return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
    }

    const parsed = z
      .object({
        expired: z.number().int().min(0),
        // **Optional, because this Worker may be talking to a database that predates the
        // webhook migration.** Nothing sequences the two, and a cron that threw on a missing
        // key would take the expiry sweep down with it for the length of a deploy.
        attention: z.number().int().min(0).catch(0),
        attention_oldest_hours: z.number().int().min(0).catch(0),
      })
      .safeParse(data);

    return parsed.success
      ? {
          ok: true,
          expired: parsed.data.expired,
          attention: parsed.data.attention,
          attentionOldestHours: parsed.data.attention_oldest_hours,
        }
      : { ok: false, error: 'expire_pending_holds returned an unexpected shape' };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }
}
