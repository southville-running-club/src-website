import { claimOutboxBatch, createAnonClient, recordSendResult } from '@src/shared';

import { fetchBannerAttachment, sendOutboxMessage, type EmailConfig } from './email';

/**
 * Draining the email outbox — #73, and the job that actually tells a runner they have a place.
 *
 * ## What this is not
 *
 * It is not the thing that decides an email is owed. That happens in the database, in the same
 * transaction as the payment, the refund or the transfer — see the migration. By the time this
 * runs, the club already owes the message and the only question is whether it has gone yet.
 * **Every failure in this file is therefore recoverable**: nothing here can lose a message, it
 * can only fail to deliver one this time round.
 *
 * ## Who calls this, and why there are two of them — ADR-032
 *
 * **`nudgeOutbox()` in `worker/index.ts` is the one that delivers.** It runs this from
 * `ctx.waitUntil()` the moment a request finishes that made the club owe a message — the
 * Stripe webhook, or any POST under `/admin/`. That is what makes a confirmation arrive in
 * seconds rather than at the next tick of a clock.
 *
 * **The five-minute cron still calls it, and it is the retry net.** `waitUntil` is a best
 * effort: an isolate can be evicted, and a `429` stops a batch by design. Those rows stay
 * `pending`, and the cron is what notices. Without it a failed send would be permanent, which
 * is the one outcome the outbox exists to rule out. On the normal path it now finds an empty
 * queue, makes one call, and logs nothing.
 *
 * Overlapping runs are safe structurally: `claim_outbox_batch()` selects
 * `for update skip locked`, so two drains take disjoint rows, and Resend's `Idempotency-Key`
 * is the outbox row id, so even a genuine double claim cannot send twice.
 *
 * ## Sequential, not parallel
 *
 * The messages in a batch are sent one at a time, and the first `429` stops the batch with
 * everything behind it left `pending` and its attempt returned. **This is no longer about
 * rationing a free tier** — the club pays for Resend now. It is that sending harder into a
 * provider that has just refused earns more refusals, and on the normal path a batch holds one
 * message anyway. Concurrency is a real option and ADR-032 says why it was not taken here.
 *
 * ## What is logged
 *
 * Counts and short codes. **Never a recipient, never a subject, never the provider's own error
 * text** — the rule `worker/stripe.ts` and `worker/nn-signup.ts` both follow, and it matters
 * more here because every row in this queue is an email address.
 */

export interface EmailOutboxEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  ENTRIES_WEBHOOK_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_API_BASE?: string;
  /** Read once per run to attach the banner as a CID image — see `fetchBannerAttachment()`. */
  ASSETS: Fetcher;
}

/**
 * How many to attempt per run, and it is `claim_outbox_batch()`'s own ceiling — ADR-032.
 *
 * **It was 10, chosen when a five-minute cron was the only thing that ever drained this and
 * the club was rationing 100 sends a day.** Neither holds now: the club pays for Resend, and
 * `nudgeOutbox()` drains the moment a message is owed, so on the normal path this batch holds
 * one message and the size decides nothing at all.
 *
 * What it does decide is **how fast a backlog clears** — a Resend outage, or a run of `429`s.
 * At 10 a five-minute cron recovers 120 an hour, which is slower than a 250-place race can
 * fill. At 50 it is 600, and the queue is empty again in one pass rather than twenty-five.
 *
 * The database refuses more than 50 anyway, so this is the ceiling rather than a preference.
 *
 * WARNING: **The sends are still sequential and a `429` still stops the batch.** That is not
 * politeness towards Resend, it is that continuing into a refusal earns more refusals; the
 * rows keep their attempt and the cron takes them. Sending a batch concurrently is a real
 * option now the cap is gone and is deliberately not taken here — see ADR-032.
 */
const BATCH_SIZE = 50;

export async function drainEmailOutbox(env: EmailOutboxEnv): Promise<void> {
  // **Both secrets, or nothing happens — and nothing happening is safe.** The rows stay
  // `pending`, `/admin/emails/` shows them, and they send when the key arrives. This is the
  // state a machine with no `.dev.vars` is in, and the state production is in until the
  // digest half of `ENTRIES_WEBHOOK_KEY` is installed.
  //
  // Silent, because it is a deployment state rather than a fault: logging it every five
  // minutes on every machine that has never had a key would be 288 lines a day saying the
  // configuration is what it has always been.
  if (
    env.RESEND_API_KEY === undefined ||
    env.RESEND_API_KEY === '' ||
    env.ENTRIES_WEBHOOK_KEY === undefined ||
    env.ENTRIES_WEBHOOK_KEY === ''
  ) {
    return;
  }

  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  const claimed = await claimOutboxBatch(client, env.ENTRIES_WEBHOOK_KEY, BATCH_SIZE);

  if (!claimed.ok) {
    // **`unauthorised` names a specific, fixable state** — the Worker has a key and the
    // database has no digest, or they disagree. It is worth a line, because the symptom
    // otherwise is a queue that grows and never moves.
    console.error(
      `entries.claim_outbox_batch failed — ${claimed.error}. ` +
        'No entry email can be sent until this clears. See docs/delivery/runbooks/entries-email.md',
    );
    return;
  }

  if (claimed.messages.length === 0) {
    return;
  }

  // **Once per batch, not once per message.** Every send in this run wants the same file, and
  // base64-encoding a 142KB PNG once per message would be pure waste. `null` on
  // any failure — the outbox drain does not stop for a missing image, and every send below is
  // written to cope with either shape.
  const bannerAttachment = await fetchBannerAttachment(env.ASSETS);

  if (bannerAttachment === null) {
    console.warn('entries: banner attachment unavailable this run; sending without it');
  }

  const config: EmailConfig = {
    apiKey: env.RESEND_API_KEY,
    apiBase: env.RESEND_API_BASE ?? 'https://api.resend.com',
    bannerAttachment,
  };

  let sent = 0;
  let failed = 0;
  let rateLimited = false;

  for (const message of claimed.messages) {
    // **Stop the batch on the first `429`.** Everything after it would get the same answer,
    // and each one is a wasted round trip against a provider that has already said no.
    if (rateLimited) {
      // The remaining claims are given their attempt back so a capped day does not count
      // against the three any message gets.
      await recordSendResult(client, env.ENTRIES_WEBHOOK_KEY, {
        id: message.id,
        ok: false,
        rateLimited: true,
        error: '429 rate limited',
      });
      continue;
    }

    const outcome = await sendOutboxMessage(config, message);

    if (outcome.ok) {
      sent += 1;
    } else if (outcome.rateLimited) {
      rateLimited = true;
    } else {
      failed += 1;
    }

    const recorded = await recordSendResult(client, env.ENTRIES_WEBHOOK_KEY, {
      id: message.id,
      ok: outcome.ok,
      providerMessageId: outcome.ok ? outcome.providerMessageId : null,
      error: outcome.ok ? null : outcome.error,
      rateLimited: !outcome.ok && outcome.rateLimited,
    });

    // **A send that happened and was not recorded is the one dangerous case here**, because
    // the row stays `pending` and the next run would send it again. Resend's own
    // `Idempotency-Key` is what actually prevents the duplicate; this line is so somebody
    // knows it was relied on.
    if (!recorded.ok) {
      console.error(
        `entries.record_send_result failed after a send — ${recorded.error}. ` +
          'The message may be re-attempted; Resend idempotency should suppress a duplicate',
      );
    }
  }

  if (sent > 0) {
    console.warn(`entries: sent ${sent} entry email(s)`);
  }

  if (failed > 0) {
    console.error(
      `entries: ${failed} entry email(s) failed to send. ` +
        'See /admin/emails/ — a message that has failed three times needs a human',
    );
  }

  if (rateLimited) {
    // **The cap, named, because it is a known and expected state on a busy day** and the
    // action is a plan decision rather than a bug hunt. The queue is not lost; it is late.
    console.error(
      "entries: Resend's daily cap was reached and the rest of the queue is waiting. " +
        'This is the free tier at 100/day. See docs/delivery/runbooks/entries-email.md',
    );
  }
}
