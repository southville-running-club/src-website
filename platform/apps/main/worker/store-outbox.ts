import {
  claimTicketOutboxBatch,
  createAnonClient,
  recordTicketSendResult,
  ticketEmailBody,
  type TicketOutboxMessage,
} from '@src/shared';
import { fetchBannerAttachment, type BannerAttachment } from './email-attachment';
import { renderTicketEmailHtml, TICKET_BANNER_CONTENT_ID } from './ticket-email-skin';

/**
 * The ticket outbox drain — the club's outgoing mail about a party ticket.
 *
 * ADR-021's mechanism, for `store`: the obligation to send was written in the same transaction
 * as the payment, so this only has to deliver it, and a failure here loses nothing. It is
 * called from `ctx.waitUntil()` after the ticket webhook — so a confirmation goes out as soon
 * as it is owed rather than at the next tick of a clock, which is ADR-032 — and again from the
 * five-minute cron, which is the retry net.
 *
 * ## Two parts since ADR-041, and the text is still the authoritative one
 *
 * ADR-033 shipped this drain as plain text and called a ticket skin *"a separate change"*. That
 * change arrived on 13 September 2026 as `ticket-email-skin.ts` — **a second skin, not a
 * widened `email-skin.ts`**, which is the part ADR-033 actually ruled out and which still knows
 * nothing about a ticket.
 *
 * The text part is unchanged. `renderTicketEmailHtml()` reads the same `TicketOutboxMessage`
 * that `ticketEmailBody()` does and never that function's output, so the two can differ in
 * presentation and can never differ in the facts. **A template the skin has no design for
 * returns null and sends as text alone** rather than not at all, which today is
 * `ticket_refunded`.
 *
 * ## What must never be logged
 *
 * Counts and short codes. **Never a recipient, never a subject, never the provider's own error
 * text** — a provider's error can quote the address it rejected.
 */

export interface TicketOutboxEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  /** The same key `store.record_checkout_event()` takes — see the migration on why not a third. */
  STORE_WEBHOOK_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_API_BASE?: string;
  /** Read once per run to attach the banner as a CID image — see `email-attachment.ts`. */
  ASSETS: Fetcher;
}

/**
 * The artwork each social's confirmation carries, by slug.
 *
 * **A constant rather than a column, and that is the same trade `SITE_NAV`'s submenu takes.** A
 * social already needs its own content page and is therefore already a deploy, so the artwork
 * arriving in the same commit costs nothing that was not already being paid — while a column
 * would be a file path in the database that nothing validates, failing as a broken image in
 * somebody's inbox rather than as a missing file at review.
 *
 * **A slug that is not here gets no banner and still gets its email.** The hero keeps its red
 * background and its live text either way, so the artwork is genuinely additive — which is what
 * makes forgetting to add a row here a disappointment rather than an incident.
 */
const SOCIAL_BANNERS: Record<string, { filename: string; contentType: string }> = {
  'christmas-party-2026': {
    filename: 'christmas-party-2026-email-banner-1200x640.jpg',
    contentType: 'image/jpeg',
  },
};

/** `claim_outbox_batch()`'s own ceiling, matching the race drain. */
const BATCH_SIZE = 50;

/**
 * The sending identity. **A constant rather than a column**, because it is a property of the
 * Resend account's verified sending domain and not of any one occasion — a per-occasion value
 * here would be a second place for a domain to be wrong, and the failure is a silent delivery
 * drop. The race drain says the same of its own copy.
 *
 * **`nn@` is the verified mailbox and the display name is what a recipient actually sees**, so
 * a Christmas party email arrives from "Southville Running Club" rather than from anything
 * race-shaped. It is the sending subdomain, which has no MX — which is exactly why every
 * message sets `Reply-To` to the club's real mailbox from `store.socials.reply_to`.
 */
const FROM = 'Southville Running Club <nn@send.southvillerunningclub.co.uk>';

type SendOutcome =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; rateLimited: boolean; error: string };

async function sendTicketMessage(
  config: { apiKey: string; apiBase: string; replyTo: string },
  message: TicketOutboxMessage,
  banner: BannerAttachment | null,
): Promise<SendOutcome> {
  let body: { subject: string; text: string };

  try {
    body = ticketEmailBody(message);
  } catch {
    // A template the database allowed and this Worker does not know — the expand/migrate/
    // contract seam. One message fails; the batch behind it goes on.
    return {
      ok: false,
      rateLimited: false,
      error: `unknown template ${message.template}`,
    };
  }

  // **The HTML part is rendered after the text and never from it** — ADR-041. `null` for a
  // template the skin has no design for, which today is `ticket_refunded`: that message sends
  // as text alone rather than not at all.
  const html = renderTicketEmailHtml(message, banner !== null);

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
        'idempotency-key': `store-outbox:${message.id}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [message.recipient],
        // **The club's own mailbox, because this email asks for a reply.** It is the one
        // place dietary requirements are collected, so a reply that bounces would lose the
        // answer entirely — see `ticket-outbox.ts` on why they are not a database column.
        reply_to: message.replyTo,
        subject: body.subject,
        text: body.text,
        // **Both omitted rather than sent as null.** Resend's own validation rejects a null
        // `html`, and an empty `attachments` array is a multipart boundary for nothing — the
        // same shape `email.ts` settled on for the race, and for the same reason.
        ...(html === null ? {} : { html }),
        ...(html === null || banner === null
          ? {}
          : {
              attachments: [
                {
                  filename: banner.filename,
                  content: banner.content,
                  content_type: banner.contentType,
                  content_id: banner.contentId,
                },
              ],
            }),
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
    return { ok: false, rateLimited: true, error: '429 rate limited' };
  }

  if (!response.ok) {
    // **The status and nothing else.** Resend's body can quote the address it rejected.
    return { ok: false, rateLimited: false, error: `http ${response.status}` };
  }

  const parsed: unknown = await response.json().catch(() => null);
  const id = (parsed as { id?: unknown } | null)?.id;

  return { ok: true, providerMessageId: typeof id === 'string' ? id : null };
}

/**
 * Drain what is owed. **Never throws** — this shares a cron with the hold sweep and with a
 * published medical-note retention promise, and an exception here would take both down.
 */
export async function drainTicketOutbox(env: TicketOutboxEnv): Promise<void> {
  // **Both secrets, or nothing happens — and nothing happening is safe.** The rows stay
  // `pending` and send when the key arrives. Silent, because it is a deployment state rather
  // than a fault: logging it every five minutes on a machine that has never had a key would
  // be 288 lines a day saying the configuration is what it has always been.
  if (!env.RESEND_API_KEY || !env.STORE_WEBHOOK_KEY) {
    return;
  }

  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  const messages = await claimTicketOutboxBatch(
    client,
    env.STORE_WEBHOOK_KEY,
    BATCH_SIZE,
  );

  if (messages.length === 0) {
    return;
  }

  const config = {
    apiKey: env.RESEND_API_KEY,
    apiBase: env.RESEND_API_BASE ?? 'https://api.resend.com',
    replyTo: 'info@southvillerunningclub.co.uk',
  };

  // **Read once per social, not once per message.** Fifty confirmations for one party would
  // otherwise be fifty reads of the same file, and a batch can hold more than one occasion.
  const banners = new Map<string, BannerAttachment | null>();

  async function bannerFor(slug: string): Promise<BannerAttachment | null> {
    const cached = banners.get(slug);

    if (cached !== undefined) {
      return cached;
    }

    const spec = SOCIAL_BANNERS[slug];
    const attachment =
      spec === undefined
        ? null
        : await fetchBannerAttachment(env.ASSETS, {
            ...spec,
            contentId: TICKET_BANNER_CONTENT_ID,
          });

    banners.set(slug, attachment);
    return attachment;
  }

  let sent = 0;
  let failed = 0;
  let rateLimited = false;

  for (const message of messages) {
    // **Stop the batch on the first `429`.** Everything after it would get the same answer,
    // and each one is a wasted round trip against a provider that has already said no. The
    // remaining claims are given their attempt back, so a capped day does not count against
    // the three any message gets.
    if (rateLimited) {
      await recordTicketSendResult(client, env.STORE_WEBHOOK_KEY, {
        id: message.id,
        status: 'pending',
        error: '429 rate limited',
      });
      continue;
    }

    const outcome = await sendTicketMessage(
      { ...config, replyTo: message.replyTo || config.replyTo },
      message,
      await bannerFor(message.socialSlug),
    );

    if (outcome.ok) {
      sent += 1;
    } else if (outcome.rateLimited) {
      rateLimited = true;
    } else {
      failed += 1;
    }

    const recorded = await recordTicketSendResult(client, env.STORE_WEBHOOK_KEY, {
      id: message.id,
      // **`pending` on a rate limit, `failed` on anything else.** A capped day is not the
      // message's fault and must not spend one of its three attempts; the database moves a
      // row to `failed` on its own once the attempts run out.
      status: outcome.ok ? 'sent' : outcome.rateLimited ? 'pending' : 'failed',
      providerMessageId: outcome.ok ? outcome.providerMessageId : null,
      error: outcome.ok ? null : outcome.error,
    });

    // **A send that happened and was not recorded is the one dangerous case here**, because
    // the row stays `pending` and the next run would send it again. Resend's own
    // `Idempotency-Key` is what actually prevents the duplicate; this line is so somebody
    // knows it was relied on.
    if (!recorded) {
      console.error(
        'store.record_send_result failed after a send. ' +
          'The message may be re-attempted; Resend idempotency should suppress a duplicate',
      );
    }
  }

  if (sent > 0) {
    console.warn(`store: sent ${sent} ticket email(s)`);
  }

  if (failed > 0) {
    console.error(
      `store: ${failed} ticket email(s) failed to send. ` +
        'A message that has failed three times needs a human',
    );
  }

  if (rateLimited) {
    console.error(
      "store: Resend's rate limit was reached and the rest of the queue is waiting. " +
        'The queue is not lost; it is late. See docs/delivery/runbooks/events-tickets.md',
    );
  }
}
