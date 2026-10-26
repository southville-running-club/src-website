import { z } from 'zod';

import { plural } from './plural';
import type { AnonClient, UserClient } from './supabase';

/**
 * Emailing each runner their private photos link (race photos brief, slice 5; ADR-069).
 *
 * Three callers, and each has its own wrapper here:
 *
 *   * **the photo-admin's button**, `sendPhotoLinks()` and `fetchSendFigures()`, signed in;
 *   * **the lost-link form**, `requestPhotoLink()`, signed out and holding the entry key;
 *   * **the drain**, `claimPhotosOutboxBatch()` and `recordPhotosSendResult()`, holding the
 *     webhook key — `worker/photos-outbox.ts`.
 *
 * As in `photos-check.ts`, nothing the database says is rendered: a refusal is one of a closed
 * set of results the page words itself, and an answer this build does not recognise is
 * `unavailable` rather than a silent success.
 *
 * ## ⚠️ The email's words are the brief's draft copy, for Kayleigh's sign-off
 *
 * `PHOTOS_EMAIL_COPY` is §10's three sentences and subject, word for word, plus the link and a
 * sign-off. Nothing else may be added to it without her (brief §4). It is text only: the race
 * emails' HTML skin is a design nobody has supplied for this message, and a text email sends.
 */

export const PHOTOS_EMAIL_COPY = {
  subject: 'Your Nightingale Nightmare photos are ready',
  found: (count: number) =>
    `We found you in ${plural(count, '1 photo', `${String(count)} photos`)} from Sunday's race.`,
  justForYou:
    "This link is just for you, so there's no password. Forward this email to anyone you'd like to see them.",
  takeDown:
    "Not keen on one of them? Reply with the photo ID shown under it and we'll take it down.",
  signOff: 'Southville Running Club',
} as const;

/** Everything `photos.claim_outbox_batch()` hands back about one email. */
export interface PhotosLinkMessage {
  id: string;
  /** `first_link` from the photo-admin's send; `new_link` from the lost-link form. */
  reason: 'first_link' | 'new_link';
  eventSlug: string;
  eventName: string | null;
  bib: string;
  recipient: string;
  /** The race's own reply address, so a takedown request by reply reaches its mailbox. */
  replyTo: string | null;
  /** How many photos the page shows as theirs — the same predicate as the page. */
  photoCount: number;
  attempts: number;
}

/**
 * The email, as text. **The link is its own line**, so no email program wraps it into a
 * sentence and breaks it.
 */
export function photosLinkEmailBody(
  message: PhotosLinkMessage,
  link: string,
): { subject: string; text: string } {
  return {
    subject: PHOTOS_EMAIL_COPY.subject,
    text: [
      PHOTOS_EMAIL_COPY.found(message.photoCount),
      '',
      link,
      '',
      PHOTOS_EMAIL_COPY.justForYou,
      '',
      PHOTOS_EMAIL_COPY.takeDown,
      '',
      PHOTOS_EMAIL_COPY.signOff,
    ].join('\n'),
  };
}

// -----------------------------------------------------------------------------------------
// The drain
// -----------------------------------------------------------------------------------------

const messageShape = z
  .object({
    id: z.string().uuid(),
    reason: z.enum(['first_link', 'new_link']),
    event_slug: z.string().min(1),
    event_name: z.string().nullable(),
    bib: z.string().regex(/^[0-9]{1,8}$/),
    recipient: z.string().min(3),
    reply_to: z.string().nullable(),
    photo_count: z.number().int().positive(),
    attempts: z.number().int().min(0),
  })
  .transform((row): PhotosLinkMessage => ({
    id: row.id,
    reason: row.reason,
    eventSlug: row.event_slug,
    eventName: row.event_name,
    bib: row.bib,
    recipient: row.recipient,
    replyTo: row.reply_to,
    photoCount: row.photo_count,
    attempts: row.attempts,
  }));

export async function claimPhotosOutboxBatch(
  client: AnonClient,
  key: string,
  limit = 10,
): Promise<PhotosLinkMessage[]> {
  const { data, error } = await client.schema('photos').rpc('claim_outbox_batch', {
    p_key: key,
    p_limit: limit,
  });

  if (error !== null || data === null || typeof data !== 'object') return [];

  const rows = (data as { messages?: unknown }).messages;
  if (!Array.isArray(rows)) return [];

  const messages: PhotosLinkMessage[] = [];
  for (const candidate of rows) {
    const parsed = messageShape.safeParse(candidate);
    // **A row that does not parse is skipped, not thrown on**, as in the other outboxes: one
    // malformed message must not stop the batch behind it.
    if (parsed.success) messages.push(parsed.data);
  }
  return messages;
}

export async function recordPhotosSendResult(
  client: AnonClient,
  key: string,
  id: string,
  outcome: {
    sent: boolean;
    /** The SHA-256 of the token the email carried. Required when it was sent. */
    tokenHash?: string | null;
    providerMessageId?: string | null;
    error?: string | null;
    rateLimited?: boolean;
  },
): Promise<void> {
  // Optional arguments omitted rather than `undefined`, for `exactOptionalPropertyTypes` —
  // `membership-email.ts` says why.
  const tokenHash = outcome.tokenHash ?? null;
  const providerMessageId = outcome.providerMessageId ?? null;
  const error = outcome.error ?? null;

  await client.schema('photos').rpc('record_send_result', {
    p_key: key,
    p_id: id,
    p_sent: outcome.sent,
    ...(tokenHash === null ? {} : { p_token_hash: tokenHash }),
    ...(providerMessageId === null ? {} : { p_provider_message_id: providerMessageId }),
    ...(error === null ? {} : { p_error: error }),
    p_rate_limited: outcome.rateLimited ?? false,
  });
}

// -----------------------------------------------------------------------------------------
// The lost-link form
// -----------------------------------------------------------------------------------------

/**
 * Ask for a new link for an address. **What comes back is only whether the call worked**,
 * never whether the address entered: the database answers `{ ok: true }` either way, and the
 * form says the same sentence either way.
 */
export async function requestPhotoLink(
  client: AnonClient,
  key: string,
  eventSlug: string,
  email: string,
): Promise<
  { status: 'ok' } | { status: 'unauthorised' } | { status: 'unavailable'; error: string }
> {
  try {
    const { data, error } = await client.schema('photos').rpc('request_link', {
      p_key: key,
      p_event_slug: eventSlug,
      p_email: email,
    });
    if (error !== null) {
      return {
        status: 'unavailable',
        error: `photos.request_link — ${error.code ?? 'unknown'}`,
      };
    }

    if (z.object({ ok: z.literal(true) }).safeParse(data).success)
      return { status: 'ok' };
    if (
      z
        .object({ ok: z.literal(false), reason: z.literal('unauthorised') })
        .safeParse(data).success
    ) {
      return { status: 'unauthorised' };
    }
    return {
      status: 'unavailable',
      error: 'photos.request_link returned an unexpected shape',
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: `photos.request_link threw: ${cause instanceof Error ? cause.name : 'unknown'}`,
    };
  }
}

// -----------------------------------------------------------------------------------------
// The photo-admin's button and figures
// -----------------------------------------------------------------------------------------

type Unavailable = { status: 'unavailable'; error: string };
type Unauthorised = { status: 'unauthorised' };

const count = z.number().int().min(0);

export type SendLinksResult =
  | { status: 'ok'; queued: number; runners: number; noAddress: number }
  | { status: 'not-published' }
  | { status: 'no-such-event' }
  | Unauthorised
  | Unavailable;

export async function sendPhotoLinks(
  client: UserClient,
  eventSlug: string,
): Promise<SendLinksResult> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('send_links', { p_event_slug: eventSlug });
    if (error !== null) {
      return {
        status: 'unavailable',
        error: `photos.send_links — ${error.code ?? 'unknown'}`,
      };
    }

    const ok = z
      .object({ ok: z.literal(true), queued: count, runners: count, no_address: count })
      .safeParse(data);
    if (ok.success) {
      return {
        status: 'ok',
        queued: ok.data.queued,
        runners: ok.data.runners,
        noAddress: ok.data.no_address,
      };
    }

    const refused = z
      .object({ ok: z.literal(false), reason: z.string() })
      .safeParse(data);
    if (refused.success) {
      if (refused.data.reason === 'refused') return { status: 'unauthorised' };
      if (refused.data.reason === 'not_published') return { status: 'not-published' };
      if (refused.data.reason === 'no_such_event') return { status: 'no-such-event' };
    }
    return {
      status: 'unavailable',
      error: 'photos.send_links returned an unexpected shape',
    };
  } catch (cause) {
    return { status: 'unavailable', error: `photos.send_links threw: ${String(cause)}` };
  }
}

export interface PhotoSendFigures {
  slug: string;
  linksSentAt: string | null;
  /** Null is no limit. */
  dailySendLimit: number | null;
  /** Runners with a photo of their own. */
  runners: number;
  /** Of those, how many the club has no address for. */
  noAddress: number;
  /** Reachable and not yet sent a first link: what the button would queue. */
  toSend: number;
  waiting: number;
  sent: number;
  failed: number;
  /** First links sent in the last 24 hours, against the daily limit. */
  sentLastDay: number;
}

export type SendFiguresResult =
  { status: 'ok'; events: PhotoSendFigures[] } | Unauthorised | Unavailable;

const figuresSchema = z.object({
  ok: z.literal(true),
  events: z.array(
    z.object({
      slug: z.string().min(1),
      links_sent_at: z.string().nullable(),
      daily_send_limit: z.number().int().positive().nullable(),
      runners: count,
      no_address: count,
      to_send: count,
      waiting: count,
      sent: count,
      failed: count,
      sent_last_day: count,
    }),
  ),
});

export async function fetchSendFigures(client: UserClient): Promise<SendFiguresResult> {
  try {
    const { data, error } = await client.schema('photos').rpc('send_figures');
    if (error !== null) {
      return {
        status: 'unavailable',
        error: `photos.send_figures — ${error.code ?? 'unknown'}`,
      };
    }

    const parsed = figuresSchema.safeParse(data);
    if (parsed.success) {
      return {
        status: 'ok',
        events: parsed.data.events.map((event) => ({
          slug: event.slug,
          linksSentAt: event.links_sent_at,
          dailySendLimit: event.daily_send_limit,
          runners: event.runners,
          noAddress: event.no_address,
          toSend: event.to_send,
          waiting: event.waiting,
          sent: event.sent,
          failed: event.failed,
          sentLastDay: event.sent_last_day,
        })),
      };
    }

    if (
      z.object({ ok: z.literal(false), reason: z.literal('refused') }).safeParse(data)
        .success
    ) {
      return { status: 'unauthorised' };
    }
    return {
      status: 'unavailable',
      error: 'photos.send_figures returned an unexpected shape',
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: `photos.send_figures threw: ${String(cause)}`,
    };
  }
}
