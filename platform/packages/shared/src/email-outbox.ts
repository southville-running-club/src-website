/**
 * The email outbox, from the Worker's side — #73.
 *
 * Two calls, both keyed, both against functions that ship refusing everything until the digest
 * in `entries.webhook_secrets` is installed. Neither ever throws: this runs on a Cron Trigger
 * beside the hold sweep and the medical-note deletion, and an exception here would take a
 * published retention promise down with it.
 *
 * **What must never be logged.** A claimed message carries a real email address. Nothing in
 * this file logs a message, a recipient or a provider error string — the same rule
 * `worker/stripe.ts` follows for Stripe's error text and `worker/nn-signup.ts` for Postgres's,
 * and for the same reason: a provider's error can quote the value it rejected.
 */

import { z } from 'zod';

import type { AnonClient } from './supabase';

/** One message the outbox says the club owes somebody. */
export interface OutboxMessage {
  id: string;
  template: string;
  recipient: string;
  attempts: number;
  purchaseReference: string;
  eventName: string;
  eventDate: string;
  amountPence: number;
  /** Null once the entrant has been deleted by a cancellation or replaced by a transfer. */
  entrantFirstName: string | null;
  replyTo: string;
}

const messageSchema = z.object({
  id: z.string().uuid(),
  template: z.string().min(1),
  recipient: z.string().min(3),
  attempts: z.number().int().min(0),
  purchase_reference: z.string().min(1),
  event_name: z.string().min(1),
  event_date: z.string().min(1),
  amount_pence: z.number().int().min(0),
  entrant_first_name: z.string().nullable(),
  reply_to: z.string().min(3),
});

/**
 * Claim up to `limit` messages for delivery.
 *
 * **Claiming counts as an attempt**, recorded by the database in the same statement that hands
 * the rows over. A Worker that dies mid-batch therefore leaves its messages counted rather than
 * pristine, which is what stops one poisonous row being retried forever.
 */
export async function claimOutboxBatch(
  client: AnonClient,
  key: string,
  limit = 10,
): Promise<{ ok: true; messages: OutboxMessage[] } | { ok: false; error: string }> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('claim_outbox_batch', { p_key: key, p_limit: limit });

    if (error) {
      return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
    }

    const parsed = z
      .object({
        ok: z.boolean(),
        reason: z.string().optional(),
        messages: z.array(messageSchema).optional(),
      })
      .safeParse(data);

    if (!parsed.success) {
      return { ok: false, error: 'claim_outbox_batch returned an unexpected shape' };
    }

    if (!parsed.data.ok) {
      // **`unauthorised` here means the digest is not installed**, which is a deployment
      // state rather than an attack. It is worth a distinct string so the log line says
      // something a volunteer can act on.
      return { ok: false, error: parsed.data.reason ?? 'refused' };
    }

    return {
      ok: true,
      messages: (parsed.data.messages ?? []).map((row) => ({
        id: row.id,
        template: row.template,
        recipient: row.recipient,
        attempts: row.attempts,
        purchaseReference: row.purchase_reference,
        eventName: row.event_name,
        eventDate: row.event_date,
        amountPence: row.amount_pence,
        entrantFirstName: row.entrant_first_name,
        replyTo: row.reply_to,
      })),
    };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }
}

/**
 * Record what happened to one delivery attempt.
 *
 * `rateLimited` is separate from `ok: false` on purpose: the database gives the attempt back
 * when the provider refused to look at the message, so a day spent over the cap does not mark
 * the whole overflow `failed` before the cap has reset.
 */
export async function recordSendResult(
  client: AnonClient,
  key: string,
  input: {
    id: string;
    ok: boolean;
    providerMessageId?: string | null;
    error?: string | null;
    rateLimited?: boolean;
  },
): Promise<{ ok: true; applied: boolean } | { ok: false; error: string }> {
  try {
    // **The optional two are omitted rather than sent as null**, which is the same call: each
    // has a `default null` in the function signature and PostgREST applies it when the key is
    // absent. The pattern `create_pending_purchase`'s `p_discount_code` already uses — and
    // under `exactOptionalPropertyTypes` an explicit `undefined` is not the same as absent,
    // which is why this is a spread rather than a ternary in the literal.
    const { data, error } = await client.schema('entries').rpc('record_send_result', {
      p_key: key,
      p_id: input.id,
      p_ok: input.ok,
      p_rate_limited: input.rateLimited ?? false,
      ...(input.providerMessageId == null
        ? {}
        : { p_provider_message_id: input.providerMessageId }),
      ...(input.error == null ? {} : { p_error: input.error }),
    });

    if (error) {
      return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
    }

    const parsed = z
      .object({ ok: z.boolean(), applied: z.boolean().optional() })
      .safeParse(data);

    if (!parsed.success || !parsed.data.ok) {
      return { ok: false, error: 'record_send_result refused' };
    }

    return { ok: true, applied: parsed.data.applied ?? false };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }
}
