import {
  claimPhotosOutboxBatch,
  createAnonClient,
  deriveLinkToken,
  linkTokenHash,
  photosLinkEmailBody,
  recordPhotosSendResult,
  type PhotosLinkMessage,
} from '@src/shared';

import { nnPhotosPath } from './routing';

/**
 * The race photos outbox drain — each runner's private link, by email (brief slice 5,
 * ADR-069).
 *
 * ADR-021's mechanism, a fourth time, and `membership-outbox.ts`'s loop. The obligation was
 * written by `photos.send_links()` or `photos.request_link()`; this only delivers it, and a
 * failure here loses nothing: the row stays `pending` and the five-minute cron picks it up.
 *
 * ## ⚠️ The link is made here, and never stored
 *
 * `deriveLinkToken(PHOTOS_LINK_KEY, row id)` is the token the email carries; the database is
 * told only its SHA-256, and only once Resend has accepted the email — that is when it becomes
 * the runner's one active link. A retry of the same row makes the same token, so Resend's
 * idempotency key (the row id) stops a second copy instead of a second email arriving with a
 * different link and the first one dead.
 *
 * ## Three secrets, or nothing happens
 *
 * `PHOTOS_WEBHOOK_KEY` opens the drain's two functions, `PHOTOS_LINK_KEY` makes the links and
 * never leaves this Worker, and `RESEND_API_KEY` sends. **With any one missing the drain does
 * nothing**, silently, and the rows wait. That is what makes a laptop or a test run safe
 * whatever its `.dev.vars` holds: the preview script binds no webhook or link key.
 *
 * ## ⚠️ What must never be logged
 *
 * Counts and short codes. **Never a token, a recipient, a bib or the provider's own error
 * text** — a token is a key to somebody's photos, and Resend's error can quote an address.
 */

export interface PhotosOutboxEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  PHOTOS_WEBHOOK_KEY?: string;
  PHOTOS_LINK_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_API_BASE?: string;
}

/** The race emails' sender: the one verified subdomain (`email.ts` says why). */
const FROM = 'Southville Running Club <nn@send.southvillerunningclub.co.uk>';

/**
 * Where a link points. **The production hostname, always** — every email the club sends names
 * it (`email.ts`), and a link in an email has to work from wherever it is opened.
 */
const SITE = 'https://new.southvillerunningclub.co.uk';

const RESEND_API_BASE = 'https://api.resend.com';

/** `claim_outbox_batch()` refuses more than 50, and a batch rarely holds more than one. */
const BATCH_SIZE = 50;

export interface PhotosEmailConfig {
  apiKey: string;
  apiBase: string;
}

interface SendOutcome {
  ok: boolean;
  providerMessageId?: string | null;
  rateLimited?: boolean;
  error?: string;
}

/** The link an email carries, or null for a running whose address the site cannot make. */
export function photosLink(eventSlug: string, token: string): string | null {
  const path = nnPhotosPath(eventSlug);
  return path === null ? null : `${SITE}${path}p/${token}/`;
}

/**
 * Send one email, and answer what happened.
 *
 * **Exported so a test can read what actually leaves the Worker** — the request body Resend
 * receives — which is `email.ts`'s argument for exporting `sendOutboxMessage()`.
 */
export async function sendPhotosMessage(
  message: PhotosLinkMessage,
  link: string,
  config: PhotosEmailConfig,
): Promise<SendOutcome> {
  const body = photosLinkEmailBody(message, link);

  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        // **The row id, so a retry is the same request.** The token is derived from the same
        // id, so the body is identical too, and Resend sends it once.
        'idempotency-key': `photos-outbox:${message.id}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [message.recipient],
        // Omitted rather than null: Resend's validation rejects a null field.
        ...(message.replyTo === null ? {} : { reply_to: message.replyTo }),
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
    // The provider never looked at it, so the attempt is given back.
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
 * Drain what is owed. **Never throws** — it shares the cron with the race's hold sweep and
 * the medical-note retention promise, and an exception here would take both down.
 */
export async function drainPhotosOutbox(env: PhotosOutboxEnv): Promise<void> {
  const webhookKey = env.PHOTOS_WEBHOOK_KEY;
  const linkKey = env.PHOTOS_LINK_KEY;
  const apiKey = env.RESEND_API_KEY;

  if (
    webhookKey === undefined ||
    webhookKey === '' ||
    linkKey === undefined ||
    linkKey === '' ||
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

    const messages = await claimPhotosOutboxBatch(client, webhookKey, BATCH_SIZE);
    if (messages.length === 0) return;

    let sent = 0;
    let failed = 0;

    for (const message of messages) {
      const token = await deriveLinkToken(linkKey, message.id);
      const link = photosLink(message.eventSlug, token);

      if (link === null) {
        // A running this site has no address for. One message fails; the batch goes on.
        await recordPhotosSendResult(client, webhookKey, message.id, {
          sent: false,
          error: 'no_page_for_running',
        });
        failed += 1;
        continue;
      }

      const outcome = await sendPhotosMessage(message, link, config);

      await recordPhotosSendResult(client, webhookKey, message.id, {
        sent: outcome.ok,
        tokenHash: outcome.ok ? await linkTokenHash(token) : null,
        providerMessageId: outcome.providerMessageId ?? null,
        error: outcome.error ?? null,
        rateLimited: outcome.rateLimited ?? false,
      });

      if (outcome.ok) {
        sent += 1;
      } else {
        failed += 1;
      }

      // A rate limit stops the batch, as in the other outboxes: everything behind it would be
      // refused too.
      if (outcome.rateLimited === true) break;
    }

    if (failed > 0) {
      console.warn(`photos outbox — ${String(sent)} sent, ${String(failed)} failed`);
    }
  } catch (cause) {
    console.error(
      `photos outbox drain failed — ${cause instanceof Error ? cause.name : 'unknown'}`,
    );
  }
}
