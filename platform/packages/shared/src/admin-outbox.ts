/**
 * The email queue, from the admin surface's side — #73's second half.
 *
 * Two calls, both on `authenticated`, both authorising inside themselves. The Worker signs
 * them with the volunteer's own token through `createUserClient`, exactly as `/admin/people/`
 * and the entry list do, so `identity.has_permission()` resolves through `auth.uid()` rather
 * than through anything the caller supplies.
 *
 * **The refusals are kept apart rather than flattened.** `admin.ts`'s own `readEnvelope`
 * collapses every reason that is not `unauthorised` into `not-found`, which is right for four
 * reads that can only fail one way. It is wrong here: `already_sent` and `already_queued` are
 * both things a volunteer needs told in words, and "not found" would send them looking for a
 * message that is sitting in front of them.
 */

import { z } from 'zod';

import type { UserClient } from './supabase';

/** One row of the queue, as the page shows it. */
export interface OutboxRow {
  id: string;
  template: string;
  recipient: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  purchaseReference: string;
  eventName: string;
}

/**
 * The counts, computed by the database in the same query that listed the rows.
 *
 * ⚠️ **`sentToday` is a floor, not the figure Resend counts.** Account emails — confirmations,
 * password resets — go through the same Resend account and are not in this table at all, so
 * the real number against the daily cap is this plus however many the account area sent. The
 * page says so; a number presented as the cap usage would be wrong in the dangerous direction.
 */
export interface OutboxFigures {
  pending: number;
  sent: number;
  failed: number;
  sentToday: number;
  oldestPendingAt: string | null;
}

export type OutboxListResult =
  | { status: 'ok'; figures: OutboxFigures; messages: OutboxRow[] }
  | { status: 'unauthorised' }
  | { status: 'unavailable'; error: string };

export type ResendResult =
  | { status: 'ok'; template: string }
  | { status: 'already-sent' }
  | { status: 'already-queued' }
  | { status: 'no-such-message' }
  | { status: 'unauthorised' }
  | { status: 'unavailable'; error: string };

const rowSchema = z.object({
  id: z.string().uuid(),
  template: z.string().min(1),
  recipient: z.string().min(3),
  status: z.enum(['pending', 'sent', 'failed']),
  attempts: z.number().int().min(0),
  last_error: z.string().nullable(),
  created_at: z.string().min(1),
  sent_at: z.string().nullable(),
  purchase_reference: z.string().min(1),
  event_name: z.string().min(1),
});

const listSchema = z.object({
  ok: z.literal(true),
  figures: z.object({
    pending: z.number().int().min(0),
    sent: z.number().int().min(0),
    failed: z.number().int().min(0),
    sent_today: z.number().int().min(0),
    oldest_pending_at: z.string().nullable(),
  }),
  messages: z.array(rowSchema),
});

export async function fetchOutboxList(
  client: UserClient,
  limit = 200,
): Promise<OutboxListResult> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('admin_outbox_list', { p_limit: limit });

    if (error) {
      return {
        status: 'unavailable',
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    const envelope = z
      .object({ ok: z.boolean(), reason: z.string().optional() })
      .safeParse(data);

    if (!envelope.success) {
      return {
        status: 'unavailable',
        error: 'admin_outbox_list returned an unexpected shape',
      };
    }

    if (!envelope.data.ok) {
      return { status: 'unauthorised' };
    }

    const parsed = listSchema.safeParse(data);

    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'admin_outbox_list returned an unexpected shape',
      };
    }

    return {
      status: 'ok',
      figures: {
        pending: parsed.data.figures.pending,
        sent: parsed.data.figures.sent,
        failed: parsed.data.figures.failed,
        sentToday: parsed.data.figures.sent_today,
        oldestPendingAt: parsed.data.figures.oldest_pending_at,
      },
      messages: parsed.data.messages.map((row) => ({
        id: row.id,
        template: row.template,
        recipient: row.recipient,
        status: row.status,
        attempts: row.attempts,
        lastError: row.last_error,
        createdAt: row.created_at,
        sentAt: row.sent_at,
        purchaseReference: row.purchase_reference,
        eventName: row.event_name,
      })),
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

/** Every refusal `admin_outbox_resend()` can answer with, mapped one to one. */
const RESEND_REFUSALS: Record<string, ResendResult> = {
  unauthorised: { status: 'unauthorised' },
  already_sent: { status: 'already-sent' },
  already_queued: { status: 'already-queued' },
  no_such_message: { status: 'no-such-message' },
};

export async function resendOutboxMessage(
  client: UserClient,
  id: string,
): Promise<ResendResult> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('admin_outbox_resend', { p_id: id });

    if (error) {
      return {
        status: 'unavailable',
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    const parsed = z
      .object({
        ok: z.boolean(),
        reason: z.string().optional(),
        template: z.string().optional(),
      })
      .safeParse(data);

    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'admin_outbox_resend returned an unexpected shape',
      };
    }

    if (!parsed.data.ok) {
      // **An unrecognised reason is `unavailable`, not a silent success.** A refusal this
      // build has never heard of is a database ahead of this Worker, and reporting it as
      // anything else would tell a volunteer something happened when it did not.
      return (
        RESEND_REFUSALS[parsed.data.reason ?? ''] ?? {
          status: 'unavailable',
          error: `admin_outbox_resend refused: ${parsed.data.reason ?? 'no reason'}`,
        }
      );
    }

    return { status: 'ok', template: parsed.data.template ?? 'message' };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}
