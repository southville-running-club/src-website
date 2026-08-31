import { z } from 'zod';
import type { UserClient } from './supabase';
import { parseIsoDate, type CivilDate } from './age-category';
import { missingFunctionCause, type EntryStatus, type UnavailableCause } from './admin';
import { entryRequestShape, readEntryRequest, type EntryRequest } from './entry-request';

/**
 * What a runner may see about their own entry.
 *
 * ## Why this is not a filtered version of the admin read
 *
 * `entries.admin_entry_list()` and its role-checked counterpart return everything the club
 * holds about an entrant — the date of birth, the emergency contact, the age category, the
 * Stripe references. `/account/entries/` is reached by
 * anybody with an account, so the read behind it is a **different function returning a
 * different, smaller shape**, not the same one with fields dropped on the way out.
 *
 * That is the minimisation rule this repository applies at every other boundary: the medical
 * notes never reach the database without consent rather than being filtered later, and the
 * sensitive fields are dropped before storage rather than after. A read that fetched
 * everything and trimmed it in TypeScript would be one refactor away from not trimming it.
 *
 * ## Two ways an entry is yours
 *
 * `entries.my_entries()` matches on `person_id = auth.uid()` **or** on a `purchaser_email`
 * equal to the caller's confirmed address. The second is what makes this work at all: an
 * account is not required to enter and is never created by entering, so the overwhelming
 * majority of purchases have a null `person_id` and are claimed by registering afterwards
 * with the same address.
 *
 * ## What the page may say about money
 *
 * `status` arrives as stored and the page words it. **No state makes a negative claim** — a
 * lapsed hold is reported as not completed, never as "you were not charged", because the
 * webhook may simply be late and somebody who believes that pays twice. That is
 * `/nn/<year>/entry/complete/`'s rule and it governs here for the same reason.
 */

/**
 * How much somebody may write when they ask the club about their entry.
 *
 * **Mirrored from `entry_purchases.request_reason`'s own check constraint**, so the form can
 * quote the number and the textarea can stop at it. The database is the control; a submission
 * that passes here and fails there means the two have drifted, which is a defect rather than a
 * bad submission.
 */
export const ENTRY_REQUEST_REASON_MAX_LENGTH = 500;

export interface MyEntrant {
  firstName: string;
  lastName: string;
  /** Null when they entered unattached. */
  club: string | null;
}

export interface MyEntry {
  purchaseId: string;
  /**
   * The per-event entry number, or `null` on a purchase written before the column existed.
   *
   * **Half a reference.** `formatEntryReference()` is the one place it becomes the string
   * `NN2026-0042-01092026`; the page never assembles it, exactly as no page assembles a `£`.
   */
  entryNo: number | null;
  eventSlug: string;
  eventName: string;
  /** Civil, as published. Not an instant — see age-category.ts. */
  eventDate: CivilDate;
  /** `HH:MM:SS` as Postgres renders a `time`. */
  startTime: string;
  status: EntryStatus;
  amountPence: number;
  feeLabel: string;
  purchaserName: string;
  /** ISO 8601, UTC. Null unless the webhook has confirmed the payment. */
  paidAt: string | null;
  createdAt: string;
  /**
   * What this person has asked the club to do with this entry, or null for nothing asked.
   *
   * **A request and never a state.** It does not change what the entry *is* — a paid entry
   * with a cancellation request is still a paid entry holding a place, and stays one until a
   * volunteer acts. Keeping it off `status` is what stops it being mistaken for a fifth
   * status, which the capacity predicate would not count.
   */
  requestedAction: 'cancel' | 'transfer' | null;
  /**
   * Why they asked, in the words they used, or null because they did not say.
   *
   * Read back to them on `/account/entries/` so the ask is visible as something the club has
   * rather than something they hope arrived, and read by a volunteer on `/admin/nn/`. Nowhere
   * else, and in no export.
   */
  requestReason: string | null;
  /** Whether a volunteer has marked the request above as dealt with. */
  requestResolved: boolean;
  /**
   * **Every ask this person has made about this entry, newest first.**
   *
   * The three fields above hold the most recent one, because that is what the column on the
   * purchase holds and a second ask overwrote the first in it. Somebody who asked to transfer,
   * changed their mind and asked to cancel was then shown a page still saying the club had a
   * transfer request — which reads exactly like the second press having done nothing, and the
   * next thing they do is email the club to ask why.
   *
   * Empty on a database that predates the history table, which reads the same as never having
   * asked.
   */
  requests: EntryRequest[];
  entrants: MyEntrant[];
}

export type MyEntriesResult =
  | { ok: true; entries: MyEntry[] }
  /** One reason for every failure there is, because the page answers them identically: it
   *  says it cannot show the entries right now and gives the club's address. Distinguishing
   *  "the migration has not landed" from "your session expired" helps nobody reading it. */
  | { ok: false; error: string };

const entrantShape = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  club: z.string().nullable(),
});

const entryShape = z.object({
  purchase_id: z.string().min(1),
  // `.catch(null)` for the reason every optional key on an entries read has one: nothing
  // sequences a migration against the Cloudflare deploy, and a Worker that arrives first must
  // print the reference it always printed rather than refuse the page.
  entry_no: z.number().int().nullable().catch(null),
  event_slug: z.string().min(1),
  event_name: z.string().min(1),
  event_date: z.string(),
  start_time: z.string(),
  status: z.enum(['pending', 'paid', 'expired', 'refunded']),
  amount_pence: z.number().int().min(0),
  fee_label: z.string().min(1),
  purchaser_name: z.string().min(1),
  paid_at: z.string().nullable(),
  created_at: z.string(),
  // **`.catch` on both, because nothing sequences a migration against the Cloudflare deploy.**
  // A Worker newer than the database asks for columns that are not there yet and must render
  // the entry rather than fail the page.
  requested_action: z.enum(['cancel', 'transfer']).nullable().catch(null),
  request_reason: z.string().nullable().catch(null),
  request_resolved: z.boolean().catch(false),
  // Same `.catch` reasoning: a Worker newer than the database finds no history and renders the
  // summary alone, which is what it rendered before the history existed.
  requests: z.array(entryRequestShape).catch([]),
  entrants: z.array(entrantShape),
});

const envelopeShape = z.object({
  ok: z.literal(true),
  entries: z.array(entryShape),
});

/**
 * Read every entry belonging to the signed-in caller.
 *
 * Never throws. **The failure direction is towards showing nothing rather than showing
 * somebody else's entry** — a shape that does not parse is a failure, not a partial list,
 * because a partial list is indistinguishable from a complete one on the page.
 *
 * An entry whose `event_date` will not parse is dropped rather than failing the whole read:
 * one unreadable row should not hide the other three, and the date is the only field the
 * page cannot render without.
 */
export type EntryActionRequest = 'cancel' | 'transfer';

export type RequestEntryActionResult =
  | { ok: true; action: EntryActionRequest }
  /**
   * One reason for every failure, deliberately. `request_entry_action()` answers `no_such_entry`
   * for "not yours", "not there" and "not paid" alike so that a purchase id — which is on the
   * confirmation page and now on `/account/entries/` — cannot be used to find out whether it
   * names a real paid entry belonging to somebody else.
   */
  | {
      ok: false;
      error: string;
      /**
       * **Set only when the database has not got the function this build is calling.**
       *
       * The page's ordinary refusal — *"that could not be recorded just now, please try again
       * in a moment"* — is false in both halves when that is the cause: nothing is wrong that
       * a moment will fix, and the record is fine. It happened on 29 August 2026, when a
       * deploy went out ahead of migrations that had not applied at all, and the message sent
       * a runner round a loop that could never end.
       */
      cause?: UnavailableCause | undefined;
    };

/**
 * Ask the club to cancel or transfer one of your own entries.
 *
 * **Records the ask and performs nothing.** Cancelling has its own function and its own
 * permission; transferring has neither, because whether this club transfers a place at all is a
 * decision nobody has taken. See the migration.
 *
 * Never throws. A failure here must leave the page usable — somebody who cannot lodge a request
 * still has the club's email address in front of them.
 */
export async function requestEntryAction(
  client: UserClient,
  input: {
    purchaseId: string;
    action: EntryActionRequest;
    /**
     * Why they are asking, in their own words, or null because the box was left empty.
     *
     * **Optional here and optional in the database.** Somebody who has just broken an ankle
     * should not be held at a required textarea; the box exists so a volunteer has something to
     * act on, not so the club can interrogate somebody about their own entry.
     */
    reason: string | null;
  },
): Promise<RequestEntryActionResult> {
  try {
    const { data, error } = await client.schema('entries').rpc('request_entry_action', {
      p_purchase_id: input.purchaseId,
      p_action: input.action,
      // Empty string rather than null, for the reason the transfer path gives: the generated
      // argument type is required and non-nullable, and the function normalises an empty string
      // back to null with `nullif(btrim(coalesce(...)))`.
      p_reason: input.reason ?? '',
    });

    if (error) {
      return {
        ok: false,
        error: `${error.code ?? 'unknown'}: ${error.message}`,
        cause: missingFunctionCause(error.code),
      };
    }

    const answer = data as { ok?: unknown; reason?: unknown } | null;

    if (answer?.ok !== true) {
      return {
        ok: false,
        error: typeof answer?.reason === 'string' ? answer.reason : 'unknown',
      };
    }

    return { ok: true, action: input.action };
  } catch (cause) {
    // The name only. A fetch failure cannot carry personal data, but a message might quote
    // the request — the same rule `worker/stripe.ts` follows.
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }
}

export async function fetchMyEntries(client: UserClient): Promise<MyEntriesResult> {
  try {
    const { data, error } = await client.schema('entries').rpc('my_entries');

    if (error) {
      // A PostgREST code and message, neither of which can carry personal data: this
      // function returns none on the path that fails.
      return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
    }

    const parsed = envelopeShape.safeParse(data);

    if (!parsed.success) {
      return { ok: false, error: 'my_entries returned an unexpected shape' };
    }

    const entries: MyEntry[] = [];

    for (const row of parsed.data.entries) {
      const eventDate = parseIsoDate(row.event_date);

      if (eventDate === null) {
        continue;
      }

      entries.push({
        purchaseId: row.purchase_id,
        entryNo: row.entry_no,
        eventSlug: row.event_slug,
        eventName: row.event_name,
        eventDate,
        startTime: row.start_time,
        status: row.status,
        amountPence: row.amount_pence,
        feeLabel: row.fee_label,
        purchaserName: row.purchaser_name,
        paidAt: row.paid_at,
        createdAt: row.created_at,
        requestedAction: row.requested_action,
        requestReason: row.request_reason,
        requestResolved: row.request_resolved,
        requests: row.requests.map(readEntryRequest),
        entrants: row.entrants.map((entrant) => ({
          firstName: entrant.first_name,
          lastName: entrant.last_name,
          club: entrant.club,
        })),
      });
    }

    return { ok: true, entries };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }
}

/**
 * What a person should be told about one entry, given only its status.
 *
 * **Exported and tested on its own** because the wording is the part that carries the risk,
 * not the fetch. Four statuses, four sentences, and the rule that binds them is that **none
 * of them says anything was not charged**:
 *
 *   `paid`      the only one that makes a positive claim, and it is the true one.
 *   `pending`   deliberately vague about money. The hold may be live, or the webhook may be
 *               late, and the page cannot tell the two apart from here.
 *   `expired`   the hold lapsed. Still no claim about the card — a payment that arrives late
 *               is still honoured, and `record_checkout_event()` will move this row to `paid`
 *               if Stripe eventually says so.
 *   `refunded`  the club cancelled it and sent the money back.
 */
export function entryStatusWording(status: EntryStatus): string {
  switch (status) {
    case 'paid':
      return 'Confirmed. You have a place.';
    case 'pending':
      return 'Not completed yet. If you paid, this page will catch up shortly — please check your email for a receipt before trying again.';
    case 'expired':
      return 'This entry was not completed in time and the place was released. If you were charged, please get in touch before entering again.';
    case 'refunded':
      return 'Cancelled and refunded by the club.';
  }
}
