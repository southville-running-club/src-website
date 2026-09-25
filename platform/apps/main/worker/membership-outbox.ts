import {
  claimMembershipOutboxBatch,
  createAnonClient,
  membershipEmailBody,
  recordMembershipSendResult,
  type MembershipOutboxMessage,
} from '@src/shared';

/**
 * The membership outbox drain — what the club sends about an application to join.
 *
 * ADR-021's mechanism, for `membership`. The obligation to send was written in the same
 * transaction as the application, so this only has to deliver it and a failure here loses
 * nothing: the row stays `pending` and the five-minute cron picks it up.
 *
 * It is called from `ctx.waitUntil()` after a successful submission — so somebody gets their
 * acknowledgement in seconds rather than at the next tick of a clock, which is ADR-032 — and
 * again from the cron, which is the retry net.
 *
 * ## ⚠️ Text only, deliberately, and this is the seam an HTML part lands on
 *
 * Both messages send as text today. `membershipEmailBody()` states every fact; an HTML part
 * would render from the **same `MembershipOutboxMessage`** and never from that function's
 * output, so the two could differ in presentation and never in what they say. That is ADR-026's
 * rule for the race emails and ADR-041's for the ticket one, and the same shape applies here.
 *
 * ## ⚠️ What must never be logged
 *
 * Counts and short codes. **Never a recipient, never a subject, never the provider's own error
 * text** — a provider's error can quote the address it rejected, and one of these two messages
 * carries a home address.
 */

export interface MembershipOutboxEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  /** The same key `membership.claim_outbox_batch()` and `record_send_result()` both take. */
  MEMBERSHIP_WEBHOOK_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_API_BASE?: string;
}

/**
 * ⚠️ **Resend may only send as the verified subdomain**, which is why the club's own address is
 * a `Reply-To` rather than a `From`. This is the same sender the race and ticket emails use —
 * one verified subdomain, one DNS setup, one thing to get wrong.
 */
const FROM = 'Southville Running Club <nn@send.southvillerunningclub.co.uk>';

const RESEND_API_BASE = 'https://api.resend.com';

interface SendOutcome {
  ok: boolean;
  providerMessageId?: string | null;
  rateLimited?: boolean;
  error?: string;
}

async function deliver(
  message: MembershipOutboxMessage,
  config: { apiKey: string; apiBase: string },
): Promise<SendOutcome> {
  let body: { subject: string; text: string };

  try {
    body = membershipEmailBody(message);
  } catch {
    // A template the database allowed and this Worker does not know — the expand/migrate/
    // contract seam. One message fails; the batch behind it goes on.
    return {
      ok: false,
      rateLimited: false,
      error: `unknown template ${message.template}`,
    };
  }

  let response: Response;

  try {
    response = await fetch(`${config.apiBase}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        // **Resend's own idempotency, on top of the database's.** The outbox's unique
        // `dedupe_key` stops a second row; this stops a second *send* of the same row, which
        // is the case where the Worker sent successfully and then died before recording it.
        'idempotency-key': `membership-outbox:${message.id}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [message.recipient],
        reply_to: message.replyTo,
        subject: body.subject,
        text: body.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    return {
      ok: false,
      rateLimited: false,
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }

  if (response.status === 429) {
    // ⚠️ **The provider never looked at the message**, so `record_send_result()` gives the
    // attempt back. With Resend's free tier at 100 a day account-wide, this is the failure
    // most likely to happen on a busy day, and spending one of three tries on it would turn
    // a delay into a permanent loss.
    return { ok: false, rateLimited: true, error: '429 rate limited' };
  }

  if (!response.ok) {
    // **The status and nothing else.** Resend's body can quote the address it rejected.
    return { ok: false, rateLimited: false, error: `http ${String(response.status)}` };
  }

  const parsed: unknown = await response.json().catch(() => null);
  const id = (parsed as { id?: unknown } | null)?.id;

  return { ok: true, providerMessageId: typeof id === 'string' ? id : null };
}

/**
 * Drain what is owed. **Never throws** — this shares a cron with the race hold sweep and with
 * a published medical-note retention promise, and an exception here would take both down.
 */
export async function drainMembershipOutbox(env: MembershipOutboxEnv): Promise<void> {
  const webhookKey = env.MEMBERSHIP_WEBHOOK_KEY;
  const apiKey = env.RESEND_API_KEY;

  // **Both secrets, or nothing happens — and nothing happening is safe.** The rows stay
  // `pending` and send when the keys arrive. Silent, because it is a deployment state rather
  // than a fault: logging it every five minutes on a machine that has never had a key would
  // spend a free-tier observability allowance on nothing.
  if (
    webhookKey === undefined ||
    webhookKey === '' ||
    apiKey === undefined ||
    apiKey === ''
  ) {
    return;
  }

  const config = { apiKey, apiBase: env.RESEND_API_BASE ?? RESEND_API_BASE };

  try {
    const client = createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    });

    const messages = await claimMembershipOutboxBatch(client, webhookKey);

    if (messages.length === 0) return;

    let sent = 0;
    let failed = 0;

    for (const message of messages) {
      const outcome = await deliver(message, config);

      await recordMembershipSendResult(client, webhookKey, message.id, {
        sent: outcome.ok,
        providerMessageId: outcome.providerMessageId ?? null,
        error: outcome.error ?? null,
        rateLimited: outcome.rateLimited ?? false,
      });

      if (outcome.ok) {
        sent += 1;
      } else {
        failed += 1;
      }

      // ⚠️ **A rate limit stops the batch rather than burning through it.** Every message
      // behind this one would meet the same refusal, and each refusal that reached
      // `record_send_result()` as an ordinary failure would spend an attempt.
      if (outcome.rateLimited === true) break;
    }

    // A count and nothing else. These rows carry names, addresses and dates of birth.
    if (failed > 0) {
      console.warn(`membership outbox — ${String(sent)} sent, ${String(failed)} failed`);
    }
  } catch (cause) {
    console.error(
      `membership outbox drain failed — ${cause instanceof Error ? cause.name : 'unknown'}`,
    );
  }
}
