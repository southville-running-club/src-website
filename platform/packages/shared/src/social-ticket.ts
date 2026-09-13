import { z } from 'zod';

import type { DbClient } from './supabase';
import type { SocialState } from './social-state';

/**
 * The ticket form — what is asked, and what is deliberately not.
 *
 * ## Four fields, and the shortness is the decision
 *
 * A name, an email address, that address again, and how many tickets. That is the whole of
 * it, plus whatever consents the occasion declares.
 *
 * `packages/shared/src/nn-entry.ts` next door asks for nineteen things, and every one of them
 * was argued for individually because a race needs them: a date of birth to award a category,
 * an emergency contact because somebody is running ten kilometres off road in the dark, a
 * medical note because a first-aider may need it. **None of that applies to a party**, and
 * asking for it because the machinery next door happens to ask for it is precisely the
 * "minimised at the boundary" breach the principles name.
 *
 * ### What was asked for and is not collected
 *
 * The 2025 party page asked people to state dietary requirements while booking. That is not
 * collected here, and the decision is recorded rather than silent: an allergy is health data
 * and a religious diet reveals belief, so both sit under Article 9 and both would need an
 * explicit condition, a retention period, and items added to two privacy notices. The
 * confirmation email asks people to reply with dietary requirements instead, which puts the
 * answer in a mailbox the club already runs rather than in a database it would then have to
 * account for. See ADR-033.
 *
 * ### Why the address is typed twice
 *
 * **The confirmation email is the ticket.** A typo means somebody has paid and has nothing,
 * and the club has no way to find them — there is no account, no phone number and no other
 * address on the row. This is the same reasoning the entry form uses, and it matters more
 * here because there is less to fall back on.
 */

export const TICKET_NAME_MAX_LENGTH = 120;
export const TICKET_EMAIL_MAX_LENGTH = 254;

/** What an unvalued HTML checkbox posts when ticked; an unticked one posts nothing. */
const CHECKED = 'on';

export interface SocialTicketOrder {
  purchaserName: string;
  email: string;
  quantity: number;
  ticketCode: string;
  /** Keyed by the consent name the occasion declared. Empty when it declares none. */
  consents: Record<string, boolean>;
}

export type SocialTicketErrors = Partial<
  Record<
    'purchaserName' | 'email' | 'emailConfirm' | 'quantity' | 'ticketCode' | 'consents',
    string
  >
>;

export type SocialTicketResult =
  { ok: true; value: SocialTicketOrder } | { ok: false; errors: SocialTicketErrors };

export const SOCIAL_TICKET_MESSAGES = {
  nameMissing: 'Enter your name.',
  nameTooLong: `That name is too long — ${TICKET_NAME_MAX_LENGTH} characters at most.`,
  nameNoLetters: 'Enter the name the ticket should be in.',
  emailMissing: 'Enter your email address.',
  emailInvalid: 'Enter an email address, like you@example.com.',
  emailTooLong: 'That email address is too long.',
  emailConfirmMissing: 'Type your email address again, to check it.',
  emailConfirmMismatch: 'The two email addresses do not match. Check them both.',
  quantityMissing: 'Choose how many tickets you want.',
  quantityNotANumber: 'Choose how many tickets you want from the list.',
  quantityTooFew: 'Choose at least one ticket.',
  ticketCodeMissing: 'Choose a ticket type.',
  ticketCodeUnknown: 'Choose one of the ticket types listed.',
  consentMissing: 'Tick the box to agree before buying a ticket.',
} as const;

/**
 * How many tickets one purchase may cover, and why the cap is a message rather than a silent
 * clamp: somebody who asked for eight and got six has been told they have six, not left to
 * find out at the door.
 */
function quantityTooManyMessage(max: number): string {
  return `You can buy at most ${max} tickets in one go.`;
}

/**
 * A name has to contain a letter.
 *
 * `'...'` and `'123'` both pass a length check and neither is a name — the same guard the
 * entry form applies, for the same reason: this is what goes on the door list.
 */
const HAS_A_LETTER = /\p{L}/u;

/**
 * Validate a submitted ticket order **against the occasion it is for**.
 *
 * The rules that vary — which ticket types exist, how many one person may buy, which consents
 * are required — are read from `SocialState` rather than hard-coded, because every one of them
 * is a column. That is what makes a second social a row rather than a deploy.
 *
 * ⚠️ **This is the form's control, not the system's.** Every rule here is enforced again in
 * `store.create_pending_purchase()`, which is what a caller reaching PostgREST directly with
 * the published anon key actually meets. Slice E found the entry path trusting Zod for a rule
 * the database did not check, and two ordinary HTTP calls bought a place £2 under. Nothing
 * below is the only place its rule lives.
 */
export function parseSocialTicket(
  input: unknown,
  social: SocialState,
): SocialTicketResult {
  const body = z.record(z.string(), z.unknown()).safeParse(input);

  if (!body.success) {
    return {
      ok: false,
      errors: {
        purchaserName: SOCIAL_TICKET_MESSAGES.nameMissing,
        email: SOCIAL_TICKET_MESSAGES.emailMissing,
      },
    };
  }

  const read = (key: string): string =>
    typeof body.data[key] === 'string' ? (body.data[key] as string).trim() : '';

  const errors: SocialTicketErrors = {};

  const purchaserName = read('purchaserName');

  if (purchaserName.length === 0) {
    errors.purchaserName = SOCIAL_TICKET_MESSAGES.nameMissing;
  } else if (purchaserName.length > TICKET_NAME_MAX_LENGTH) {
    errors.purchaserName = SOCIAL_TICKET_MESSAGES.nameTooLong;
  } else if (!HAS_A_LETTER.test(purchaserName)) {
    errors.purchaserName = SOCIAL_TICKET_MESSAGES.nameNoLetters;
  }

  const email = read('email');
  const emailConfirm = read('emailConfirm');

  if (email.length === 0) {
    errors.email = SOCIAL_TICKET_MESSAGES.emailMissing;
  } else if (email.length > TICKET_EMAIL_MAX_LENGTH) {
    errors.email = SOCIAL_TICKET_MESSAGES.emailTooLong;
  } else if (!z.string().email().safeParse(email).success) {
    errors.email = SOCIAL_TICKET_MESSAGES.emailInvalid;
  }

  if (emailConfirm.length === 0) {
    errors.emailConfirm = SOCIAL_TICKET_MESSAGES.emailConfirmMissing;
  } else if (
    errors.email === undefined &&
    emailConfirm.toLowerCase() !== email.toLowerCase()
  ) {
    // **Compared case-insensitively**, because the column is `citext` and telling somebody
    // their two identical addresses do not match because one has a capital letter is a
    // needless refusal at the moment they are trying to pay.
    errors.emailConfirm = SOCIAL_TICKET_MESSAGES.emailConfirmMismatch;
  }

  const quantityRaw = read('quantity');
  let quantity = 0;

  if (quantityRaw.length === 0) {
    errors.quantity = SOCIAL_TICKET_MESSAGES.quantityMissing;
  } else if (!/^[0-9]+$/u.test(quantityRaw)) {
    errors.quantity = SOCIAL_TICKET_MESSAGES.quantityNotANumber;
  } else {
    quantity = Number.parseInt(quantityRaw, 10);

    if (quantity < 1) {
      errors.quantity = SOCIAL_TICKET_MESSAGES.quantityTooFew;
    } else if (quantity > social.maxTicketsPerPurchase) {
      errors.quantity = quantityTooManyMessage(social.maxTicketsPerPurchase);
    }
  }

  const ticketCode = read('ticketCode');

  if (ticketCode.length === 0) {
    errors.ticketCode = SOCIAL_TICKET_MESSAGES.ticketCodeMissing;
  } else if (!social.ticketTypes.some((kind) => kind.code === ticketCode)) {
    errors.ticketCode = SOCIAL_TICKET_MESSAGES.ticketCodeUnknown;
  }

  const consents: Record<string, boolean> = {};

  for (const name of social.requiredConsents) {
    const ticked = body.data[`consent_${name}`] === CHECKED;
    consents[name] = ticked;

    if (!ticked) {
      errors.consents = SOCIAL_TICKET_MESSAGES.consentMissing;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { purchaserName, email, quantity, ticketCode, consents },
  };
}

// -------------------------------------------------------------------------------------------
// Holding the tickets
// -------------------------------------------------------------------------------------------

/**
 * Every way `store.create_pending_purchase()` can refuse, as it names them.
 *
 * **A closed list, so an unrecognised one is a defect rather than a shrug.** The Worker maps
 * each to words a buyer can act on; a reason that reached the page unmapped would render as
 * nothing at all, which is the failure mode a bare `if (!ok)` invites.
 */
export const TICKET_PURCHASE_REASONS = [
  'bad_key',
  'no_such_social',
  'pre_open',
  'closed',
  'sold_out',
  'invalid_quantity',
  'invalid_ticket_type',
  'consents_missing',
  'free_place',
] as const;

export type TicketPurchaseReason = (typeof TICKET_PURCHASE_REASONS)[number];

export interface PendingTicketPurchase {
  purchaseId: string;
  amountPence: number;
  quantity: number;
  ticketLabel: string;
  holdExpiresAt: string | null;
}

export type TicketPurchaseOutcome =
  | { ok: true; value: PendingTicketPurchase }
  | { ok: false; reason: TicketPurchaseReason | 'unavailable'; error?: string };

const purchaseShape = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  purchase_id: z.string().uuid().nullable(),
  amount_pence: z.number().int().nullable(),
  quantity: z.number().int().nullable(),
  ticket_label: z.string().nullable(),
  hold_expires_at: z.string().nullable(),
});

export interface TicketPurchaseInput {
  entryKey: string;
  socialSlug: string;
  order: SocialTicketOrder;
  /** Set only when the buyer is signed in, and read from the session — never from the form. */
  personId?: string | null;
  /** Runs every rule and returns before the first write. Nothing held, nothing spent. */
  preview?: boolean;
}

/**
 * Hold the tickets and price them, or find out why not.
 *
 * **Never throws.** A database this Worker cannot reach comes back as `unavailable`, and the
 * page says the club could not be reached rather than showing a payment button that would
 * take money against nothing.
 */
export async function createPendingTicketPurchase(
  client: DbClient,
  input: TicketPurchaseInput,
): Promise<TicketPurchaseOutcome> {
  const { data, error } = await client.schema('store').rpc('create_pending_purchase', {
    p_key: input.entryKey,
    p_social_slug: input.socialSlug,
    p_ticket_code: input.order.ticketCode,
    p_purchaser_name: input.order.purchaserName,
    p_purchaser_email: input.order.email,
    p_quantity: input.order.quantity,
    p_consents: input.order.consents,
    p_preview: input.preview ?? false,
    // **Omitted rather than passed as `undefined`.** `exactOptionalPropertyTypes` is on and
    // the generated argument type says `p_person_id?: string`, so the key has to be absent
    // when there is no session — which is also what lets the function's own `default null`
    // apply. The same shape `entry-purchase.ts` uses for its discount code.
    ...(input.personId ? { p_person_id: input.personId } : {}),
  });

  if (error) {
    return { ok: false, reason: 'unavailable', error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const parsed = purchaseShape.safeParse(row);

  if (!parsed.success) {
    return { ok: false, reason: 'unavailable', error: 'The answer did not parse' };
  }

  if (!parsed.data.ok) {
    const reason = parsed.data.reason ?? '';

    const known = (TICKET_PURCHASE_REASONS as readonly string[]).includes(reason)
      ? (reason as TicketPurchaseReason)
      : 'unavailable';

    return { ok: false, reason: known };
  }

  return {
    ok: true,
    value: {
      // A preview returns no id, and the caller is the one that knows it asked for one.
      purchaseId: parsed.data.purchase_id ?? '',
      amountPence: parsed.data.amount_pence ?? 0,
      quantity: parsed.data.quantity ?? 0,
      ticketLabel: parsed.data.ticket_label ?? '',
      holdExpiresAt: parsed.data.hold_expires_at,
    },
  };
}

/** Write Stripe's session id onto the held purchase. See the migration on why this is keyless. */
export async function attachTicketCheckoutSession(
  client: DbClient,
  purchaseId: string,
  sessionId: string,
): Promise<boolean> {
  const { data, error } = await client.schema('store').rpc('attach_checkout_session', {
    p_purchase_id: purchaseId,
    p_session_id: sessionId,
  });

  return !error && data === true;
}

export interface TicketHoldSweep {
  expired: number;
  attention: number;
  attentionOldestHours: number;
}

export type TicketHoldSweepResult =
  ({ ok: true } & TicketHoldSweep) | { ok: false; error: string };

const sweepShape = z.object({
  expired: z.number().int().min(0),
  attention: z.number().int().min(0),
  attention_oldest_hours: z.number().int().min(0),
});

/** The five-minute cron's third job. Never throws — see the handler's own comment. */
export async function expireTicketHolds(
  client: DbClient,
): Promise<TicketHoldSweepResult> {
  const { data, error } = await client.schema('store').rpc('expire_pending_holds');

  if (error) {
    return { ok: false, error: error.message };
  }

  const parsed = sweepShape.safeParse(Array.isArray(data) ? data[0] : data);

  if (!parsed.success) {
    return { ok: false, error: 'The sweep answer did not parse' };
  }

  return {
    ok: true,
    expired: parsed.data.expired,
    attention: parsed.data.attention,
    attentionOldestHours: parsed.data.attention_oldest_hours,
  };
}

// -------------------------------------------------------------------------------------------
// Confirming the payment
// -------------------------------------------------------------------------------------------

/**
 * What `store.record_checkout_event()` did.
 *
 * **`ok: false` is ours rather than Stripe's** — the key did not match, or the digest is not
 * installed — and the webhook maps it to a 5xx so Stripe retries. Every `ok: true` result is a
 * real, final answer, including `already_paid`, which is what a retry of a payment already
 * recorded looks like and is a success rather than an error.
 */
export type CheckoutRecordResult =
  | { ok: true; result: 'paid' | 'already_paid' | 'already_refunded' | 'no_such_session' }
  | { ok: false; result: 'bad_key' | 'unavailable'; error?: string };

const recordShape = z.object({
  ok: z.boolean(),
  result: z.string().min(1),
});

/**
 * Record that Stripe says a ticket was paid for.
 *
 * ⚠️ **The failure direction is inverted here, and only here.** Everything else in this
 * platform fails towards taking no money. By the time this runs the money has gone — so *our*
 * failures must be answered 5xx and retried, and only "this is not Stripe" gets a 400. A 200
 * on an outage drops a real payment silently.
 */
export async function recordTicketCheckoutEvent(
  client: DbClient,
  input: {
    key: string;
    sessionId: string | null;
    paymentIntentId: string | null;
    amountTotal: number | null;
    eventType: string;
  },
): Promise<CheckoutRecordResult> {
  if (input.sessionId === null) {
    // A verified Stripe event with no session id is not something to retry — there is nothing
    // to look the purchase up by. It is answered as a final, known result.
    return { ok: true, result: 'no_such_session' };
  }

  const { data, error } = await client.schema('store').rpc('record_checkout_event', {
    p_key: input.key,
    p_session_id: input.sessionId,
    p_event_type: input.eventType,
    // Both omitted rather than passed as `undefined`, for the reason above — and both are
    // genuinely optional facts: Stripe may send a session with neither.
    ...(input.paymentIntentId ? { p_payment_intent: input.paymentIntentId } : {}),
    ...(input.amountTotal === null ? {} : { p_amount_total: input.amountTotal }),
  });

  if (error) {
    return { ok: false, result: 'unavailable', error: error.message };
  }

  const parsed = recordShape.safeParse(Array.isArray(data) ? data[0] : data);

  if (!parsed.success) {
    return { ok: false, result: 'unavailable', error: 'The answer did not parse' };
  }

  const result = parsed.data.result;

  // **The result decides, not the `ok` flag, and that ordering is the fix.** This tested `ok`
  // first and reported `bad_key` for everything it refused — which was right while the database
  // only ever refused for one reason, and became wrong the moment `no_such_session` came back
  // with `ok = false`. The cost was not the 503: it was the log line, which named a credential
  // and sent a volunteer to re-check a digest that was correct. Measured on 13 September 2026
  // against production, on the endpoint's own test event.
  //
  // **Reading `result` also makes the rollback direction safe.** A database that predates
  // `20260913230000` answers `(false, 'no_such_session')` and a database after it answers
  // `(true, 'no_such_session')`; both land in the same branch below, so neither half of this
  // change depends on the other having shipped.
  if (
    result === 'paid' ||
    result === 'already_paid' ||
    result === 'already_refunded' ||
    result === 'no_such_session'
  ) {
    return { ok: true, result };
  }

  if (result === 'bad_key') {
    return { ok: false, result: 'bad_key' };
  }

  // **`ok = false` with a result nothing here knows.** Treated as the credential case rather
  // than as an unknown, because that is what it has always meant and a 503 is the safe answer:
  // Stripe retries, and a retry after somebody installs the digest is exactly what is wanted.
  if (!parsed.data.ok) {
    return { ok: false, result: 'bad_key' };
  }

  // A result this Worker does not know, from a database ahead of it. Retried rather than
  // treated as final, because the alternative is silently dropping a payment.
  return { ok: false, result: 'unavailable', error: `unknown result ${result}` };
}
