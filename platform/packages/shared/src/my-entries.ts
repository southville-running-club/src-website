import { z } from 'zod';
import type { UserClient } from './supabase';
import { parseIsoDate, type CivilDate } from './age-category';
import type { EntryStatus } from './admin';

/**
 * What a runner may see about their own entry.
 *
 * ## Why this is not a filtered version of the admin read
 *
 * `entries.admin_entry_list()` and its role-checked counterpart return everything the club
 * holds about an entrant — the date of birth, the England Athletics number, the emergency
 * contact, the age category, the Stripe references. `/account/entries/` is reached by
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

export interface MyEntrant {
  firstName: string;
  lastName: string;
  /** Null when they entered unattached. */
  club: string | null;
}

export interface MyEntry {
  purchaseId: string;
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
