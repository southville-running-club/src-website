import { z } from 'zod';

import { formatEntryReference } from './entry-reference';
import { formatPence } from './entry-state';
import type { DbClient } from './supabase';

/**
 * The ticket outbox, from the Worker's side.
 *
 * ADR-021's mechanism, for `store`. The obligation to send is written in the same transaction
 * as the payment; delivery is separate and retryable, so **nothing can lose a message — it can
 * only be late**.
 *
 * ## What must never be logged
 *
 * A claimed message carries a real email address and a real name. Nothing in this file logs a
 * message, a recipient or a provider error string — the same rule `worker/stripe.ts` follows
 * for Stripe's error text, and for the same reason: a provider's error can quote the value it
 * rejected, which is how an address ends up in a tool that was never assessed to hold one.
 *
 * ## Why this is not `email-outbox.ts` with a wider type
 *
 * The two claim from different schemas behind different keys, and the messages differ in every
 * field: a ticket has a quantity and a purchaser, an entry has an entrant and a race date. What
 * they share is the *loop* — claim, send, record — and that lives in the Worker's
 * `store-outbox.ts`, which is written against this module's shape. The duplication is in the
 * parsing, which is the part that must differ.
 */

/** One message the outbox says the club owes somebody about a ticket. */
export interface TicketOutboxMessage {
  id: string;
  template: string;
  recipient: string;
  attempts: number;
  /**
   * What the message calls the purchase — `CHRISTMASPARTY2026-0007-05122026`.
   *
   * **Built by `formatEntryReference()`**, the same function the race emails use. A second
   * implementation of a reference is exactly the defect that function's own header warns
   * about: the string is quoted back at the club, so every surface that prints one has to
   * print the same characters.
   */
  reference: string;
  /**
   * Which social this is about — `christmas-party-2026`.
   *
   * **Kept rather than consumed into `reference` and discarded.** The drain picks the banner
   * artwork by slug (ADR-041), because the artwork is per-occasion and a Christmas banner on a
   * summer barbecue's confirmation is the failure a single hardcoded filename would guarantee.
   */
  socialSlug: string;
  socialName: string;
  /** Null when the committee has not confirmed a date. The template says so rather than lying. */
  socialDate: string | null;
  /**
   * The three below are read by the HTML part and by nothing else — ADR-041.
   *
   * **Each is nullable and each is rendered only when it is there**, for `socialDate`'s reason:
   * a social can be sold before its room or its hours are settled, and a Where cell reading
   * "null" is worse than one that is absent. `christmas-party-2026` itself shipped in exactly
   * that state, with the venue supplied a day later.
   */
  venue: string | null;
  startTime: string | null;
  endTime: string | null;
  amountPence: number;
  quantity: number;
  purchaserName: string;
  replyTo: string;
}

const messageShape = z.object({
  id: z.string().uuid(),
  template: z.string().min(1),
  recipient: z.string().min(3),
  attempts: z.number().int().min(0),
  ticket_no: z.number().int().nullable(),
  social_slug: z.string().min(1),
  social_name: z.string().min(1),
  social_date: z.string().nullable(),
  // **`.nullish()` rather than `.nullable()`, and that is the rollback direction.** A Worker
  // carrying this parse can meet a database that has not had the widening migration yet, where
  // these three keys are absent rather than null — and a `.nullable()` would refuse the whole
  // batch, which stops every ticket email rather than dropping three facts from one of them.
  venue: z.string().nullish(),
  start_time: z.string().nullish(),
  end_time: z.string().nullish(),
  purchase_created_at: z.string().min(1),
  purchase_id: z.string().uuid(),
  amount_pence: z.number().int().min(0),
  quantity: z.number().int().min(1),
  purchaser_name: z.string().min(1),
  reply_to: z.string().min(3),
});

/**
 * Take the next batch of owed messages, marking each as attempted.
 *
 * **Never throws.** This runs on a cron beside the hold sweep, and an exception here would
 * take the other jobs on that schedule down with it.
 */
export async function claimTicketOutboxBatch(
  client: DbClient,
  key: string,
  limit = 10,
): Promise<TicketOutboxMessage[]> {
  const { data, error } = await client.schema('store').rpc('claim_outbox_batch', {
    p_key: key,
    p_limit: limit,
  });

  if (error || !Array.isArray(data)) {
    return [];
  }

  const messages: TicketOutboxMessage[] = [];

  for (const row of data) {
    const parsed = messageShape.safeParse(row);

    // **A row that does not parse is skipped, not thrown on.** One malformed message must not
    // stop the batch behind it — that is the difference between one person not hearing and
    // everybody not hearing.
    if (!parsed.success) {
      continue;
    }

    const value = parsed.data;

    messages.push({
      id: value.id,
      template: value.template,
      recipient: value.recipient,
      attempts: value.attempts,
      reference: formatEntryReference({
        eventSlug: value.social_slug,
        entryNo: value.ticket_no,
        createdAt: value.purchase_created_at,
        purchaseId: value.purchase_id,
      }),
      socialSlug: value.social_slug,
      socialName: value.social_name,
      socialDate: value.social_date,
      // `?? null`, because `.nullish()` admits `undefined` from a database that predates the
      // widening and the rest of this module deals in null.
      venue: value.venue ?? null,
      startTime: value.start_time ?? null,
      endTime: value.end_time ?? null,
      amountPence: value.amount_pence,
      quantity: value.quantity,
      purchaserName: value.purchaser_name,
      replyTo: value.reply_to,
    });
  }

  return messages;
}

/** Record what happened to one send. Never throws, for the reason above. */
export async function recordTicketSendResult(
  client: DbClient,
  key: string,
  input: {
    id: string;
    status: 'sent' | 'pending' | 'failed';
    providerMessageId?: string | null;
    error?: string | null;
  },
): Promise<boolean> {
  const { data, error } = await client.schema('store').rpc('record_send_result', {
    p_key: key,
    p_id: input.id,
    p_status: input.status,
    // Omitted rather than passed as `undefined` — `exactOptionalPropertyTypes` is on, so an
    // optional key has to be absent rather than present and undefined.
    ...(input.providerMessageId
      ? { p_provider_message_id: input.providerMessageId }
      : {}),
    ...(input.error ? { p_error: input.error } : {}),
  });

  return !error && data === true;
}

/**
 * `2026-12-05` → `Saturday 5 December 2026`, for an email.
 *
 * **A second copy of the Worker's `formatSocialDate`, and that is a real cost.** It is here
 * rather than imported because `packages/shared` may not import from `apps/main/worker`, and
 * moving the Worker's copy here would put page-rendering concerns in the shared package. The
 * pair is asserted against each other in `tests/unit/ticket-email.test.ts`, so they cannot
 * drift silently — which is the property that actually matters.
 *
 * **Exported since ADR-041, because the HTML part needs the same string.** The two parts of one
 * message may differ in presentation and may never differ in the facts they state, so the date
 * is computed once here rather than twice — which is the same rule `formatPence()` and
 * `formatEntryReference()` already carry, for the same reason.
 *
 * **Not `london-time.ts`, and that is not an exception to the repository-wide rule.** That
 * module converts an *instant* — a `timestamptz` — into London's calendar, which is where an
 * hour of drift can be introduced. `social_date` is a bare `date`: it names a day and carries
 * no time and no zone, so there is nothing to convert and a zone conversion could only break
 * it. Hence the arithmetic below on the three parsed parts, and never a `Date` in a zone.
 */
export function ticketEmailDate(date: string | null): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date ?? '');

  if (parts === null) {
    return null;
  }

  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return `${days[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${day} ${months[month - 1]} ${year}`;
}

export interface TicketEmail {
  subject: string;
  text: string;
}

/**
 * The two messages the club sends about a ticket.
 *
 * ## Why the date is a branch rather than an interpolation
 *
 * `socialDate` can be null, because the committee may not have confirmed one — and a
 * confirmation email reading *"your ticket to the SRC Christmas Party 2026 on null"* is worse
 * than one that does not mention a date at all. **The branch says "we will confirm the date
 * nearer the time"**, which is true and is what somebody who has just paid needs to hear.
 *
 * ## Why it asks about dietary requirements rather than storing them
 *
 * The 2025 party collected them on the booking form. This platform does not: an allergy is
 * health data and a religious diet reveals belief, so both are Article 9 and both would need
 * an explicit condition, a retention period, and items on two privacy notices before a single
 * one could be stored. Asking here puts the answer in a mailbox the club already runs, and
 * `Reply-To` on the message is the club's own address. See ADR-033.
 */
export function ticketEmailBody(message: TicketOutboxMessage): TicketEmail {
  const when = ticketEmailDate(message.socialDate);
  const occasion =
    when === null ? message.socialName : `${message.socialName} on ${when}`;

  const tickets = message.quantity === 1 ? '1 ticket' : `${message.quantity} tickets`;

  const greeting = `Hello ${message.purchaserName},`;
  const reference = `Your reference is ${message.reference}.`;
  const signOff = 'Southville Running Club';

  const dateNote =
    when === null
      ? '\n\nWe will confirm the date, time and venue nearer the time — keep an eye on https://new.southvillerunningclub.co.uk/events/'
      : '';

  switch (message.template) {
    case 'ticket_confirmed':
      return {
        subject: `Your ticket to ${message.socialName} is confirmed`,
        text: [
          greeting,
          '',
          `Your ${tickets} for ${occasion} ${message.quantity === 1 ? 'is' : 'are'} confirmed, and we have received your payment of ${formatPence(message.amountPence)}.${dateNote}`,
          '',
          reference,
          '',
          // The one thing this platform deliberately does not hold, asked for by reply.
          'If you or anybody you are bringing has dietary requirements, just reply to this email and let us know.',
          '',
          signOff,
        ].join('\n'),
      };

    case 'ticket_refunded':
      return {
        subject: `Your ticket to ${message.socialName} has been cancelled`,
        text: [
          greeting,
          '',
          `Your ${tickets} for ${occasion} ${message.quantity === 1 ? 'has' : 'have'} been cancelled, and we have refunded ${formatPence(message.amountPence)} to the card you paid with.`,
          '',
          // Stripe reports a card refund as pending for several days routinely, and that is
          // the bank rather than the club. Saying so is what stops the email asking where the
          // money is.
          'Refunds usually reach your account within five to ten working days, depending on your bank.',
          '',
          reference,
          '',
          signOff,
        ].join('\n'),
      };

    default:
      // **A template the database allowed and this file does not know.** The closed list on
      // `store.email_outbox.template` is what makes this unreachable; it is here so that
      // widening that list without widening this one fails loudly rather than sending a blank.
      throw new Error(`Unknown ticket email template: ${message.template}`);
  }
}
