import { z } from 'zod';

import type { AnonClient } from './supabase';

/**
 * A runner's private link to their race photos (brief slice 4, decisions 7 and 8; ADR-067).
 *
 * ## The token, and the one place it becomes a hash
 *
 * A link is `/nn/<year>/photos/p/<token>/`. **The token is 32 random bytes, written in URL-safe
 * base64 without padding** — 43 characters — so it cannot be guessed, and `photos.link` holds
 * only its SHA-256. This module is the one place the two meet: the Worker refuses anything that
 * is not a token's shape before it asks the database anything, and hashes what is.
 *
 * Slice 5 mints the tokens and sends them; this slice only reads them, and `mintLinkToken()` is
 * here so the two can never disagree about the shape.
 *
 * ⚠️ **A token is a key.** It never goes in a log, an error, a database row or a URL other than
 * the runner's own page, which is why the pages that carry one send `Referrer-Policy:
 * no-referrer` (`worker/nn-photos.ts`).
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isLinkToken(value: string): boolean {
  return TOKEN.test(value);
}

/** 32 random bytes, URL-safe base64, no padding: the shape `isLinkToken()` accepts. */
export function mintLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The SHA-256 of a token, as the 64 lower-case hex digits `photos.link.token_hash` holds. */
export async function linkTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** What a downloaded copy is called: the photo's own short ID, the number a runner quotes. */
export function photoDownloadName(shortId: string): string {
  return `${shortId}.jpg`;
}

/**
 * A ready-written email, as a `mailto:` link. **It changes nothing**: "That's me" and a
 * takedown request both open the runner's own email program, addressed to the club, and the
 * decision is a person's (brief §2 decision 8).
 */
export function mailtoLink(address: string, subject: string, body: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface RunnerPhoto {
  id: string;
  shortId: string;
  spot: string;
  takenAt: string | null;
  photographer: string;
  width: number;
  height: number;
}

export interface CouldBePhoto extends RunnerPhoto {
  /** What was read in it — `12?` — so the page can say what it fits. */
  read: string;
}

export interface RunnerPage {
  eventSlug: string;
  eventName: string;
  /** The address the club answers race mail at. Null for a running not entered on this site. */
  contact: string | null;
  bib: string;
  mine: RunnerPhoto[];
  couldBe: CouldBePhoto[];
}

export interface RunnerOnePhoto {
  eventSlug: string;
  eventName: string;
  contact: string | null;
  bib: string;
  /** True for one of the runner's own photos; false for one that could be them. */
  mine: boolean;
  photo: RunnerPhoto;
}

type Unavailable = { status: 'unavailable'; error: string };

const cardSchema = z.object({
  id: z.string().uuid(),
  short_id: z.string().min(1),
  spot: z.string().min(1),
  taken_at: z.string().nullable(),
  photographer: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

function toPhoto(card: z.infer<typeof cardSchema>): RunnerPhoto {
  return {
    id: card.id,
    shortId: card.short_id,
    spot: card.spot,
    takenAt: card.taken_at,
    photographer: card.photographer,
    width: card.width,
    height: card.height,
  };
}

const pageSchema = z.object({
  event_slug: z.string().min(1),
  event_name: z.string().min(1),
  contact: z.string().nullable(),
  bib: z.string().min(1),
  mine: z.array(cardSchema),
  could_be: z.array(cardSchema.extend({ read: z.string().min(1) })),
});

export type RunnerPageResult =
  { status: 'ok'; page: RunnerPage } | { status: 'none' } | Unavailable;

/**
 * A runner's page for a link's hash. `none` is every refusal — no such link, a replaced one,
 * photos not published — because the database answers all of them with the same `null`.
 */
export async function fetchRunnerPhotos(
  client: AnonClient,
  eventSlug: string,
  tokenHash: string,
): Promise<RunnerPageResult> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('runner_photos', { p_event_slug: eventSlug, p_token_hash: tokenHash });

    if (error) {
      return {
        status: 'unavailable',
        error: `photos.runner_photos — ${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    if (data === null) return { status: 'none' };

    const parsed = pageSchema.safeParse(data);
    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'photos.runner_photos returned an unexpected shape',
      };
    }

    return {
      status: 'ok',
      page: {
        eventSlug: parsed.data.event_slug,
        eventName: parsed.data.event_name,
        contact: parsed.data.contact,
        bib: parsed.data.bib,
        mine: parsed.data.mine.map(toPhoto),
        couldBe: parsed.data.could_be.map((card) => ({
          ...toPhoto(card),
          read: card.read,
        })),
      },
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: `photos.runner_photos threw: ${String(cause)}`,
    };
  }
}

const onePhotoSchema = z.object({
  event_slug: z.string().min(1),
  event_name: z.string().min(1),
  contact: z.string().nullable(),
  bib: z.string().min(1),
  mine: z.boolean(),
  photo: cardSchema,
});

export type RunnerOnePhotoResult =
  { status: 'ok'; photo: RunnerOnePhoto } | { status: 'none' } | Unavailable;

/** One photo a link's page would show, by short ID. `none` for anything else. */
export async function fetchRunnerPhoto(
  client: AnonClient,
  eventSlug: string,
  tokenHash: string,
  shortId: string,
): Promise<RunnerOnePhotoResult> {
  try {
    const { data, error } = await client.schema('photos').rpc('runner_photo', {
      p_event_slug: eventSlug,
      p_token_hash: tokenHash,
      p_short_id: shortId,
    });

    if (error) {
      return {
        status: 'unavailable',
        error: `photos.runner_photo — ${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    if (data === null) return { status: 'none' };

    const parsed = onePhotoSchema.safeParse(data);
    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'photos.runner_photo returned an unexpected shape',
      };
    }

    return {
      status: 'ok',
      photo: {
        eventSlug: parsed.data.event_slug,
        eventName: parsed.data.event_name,
        contact: parsed.data.contact,
        bib: parsed.data.bib,
        mine: parsed.data.mine,
        photo: toPhoto(parsed.data.photo),
      },
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: `photos.runner_photo threw: ${String(cause)}`,
    };
  }
}

export type ServableResult =
  { status: 'ok'; shortId: string } | { status: 'none' } | Unavailable;

/** Whether one photo may be served as an image: published, in this running, not taken down. */
export async function fetchServablePhoto(
  client: AnonClient,
  eventSlug: string,
  photoId: string,
): Promise<ServableResult> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('servable_photo', { p_event_slug: eventSlug, p_photo_id: photoId });

    if (error) {
      return {
        status: 'unavailable',
        error: `photos.servable_photo — ${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    if (data === null) return { status: 'none' };

    const parsed = z.object({ short_id: z.string().min(1) }).safeParse(data);
    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'photos.servable_photo returned an unexpected shape',
      };
    }

    return { status: 'ok', shortId: parsed.data.short_id };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: `photos.servable_photo threw: ${String(cause)}`,
    };
  }
}

/**
 * Whether a running's photos are published and its links have gone out. **False on any
 * failure**: a banner that is missing is a recoverable disappointment, and one that says the
 * photos are ready when they are not is a claim about a record.
 */
export async function fetchPhotosReady(
  client: AnonClient,
  eventSlug: string,
): Promise<boolean> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('photos_ready', { p_event_slug: eventSlug });

    return !error && data === true;
  } catch {
    return false;
  }
}
