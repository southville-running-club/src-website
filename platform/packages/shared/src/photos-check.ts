import { z } from 'zod';

import type { UserClient } from './supabase';

/**
 * The race photos check page's reads and writes (brief slice 3; ADR-065 and ADR-066).
 *
 * One wrapper per `photos` function, each reading the answer through Zod and turning it into
 * a result the page can branch on. **Nothing the database says is rendered**: a refusal
 * becomes one of a closed set of reasons the page words in the club's own voice, and an
 * answer this build does not recognise is `unavailable` rather than a silent success — a
 * database ahead of the Worker is the usual cause, and reporting anything else would tell a
 * volunteer something happened when it did not.
 *
 * Every function asks `identity.has_permission()` itself and answers `refused` to somebody
 * without it. That arrives here as `unauthorised`, which the page answers with the same 404
 * as everybody else who may not be there.
 */

/** The three copies the laptop makes of every photo (ADR-060), and the only sizes served. */
export const PHOTO_SIZES = ['full', 'medium', 'thumb'] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

export function isPhotoSize(value: string): value is PhotoSize {
  return (PHOTO_SIZES as readonly string[]).includes(value);
}

/**
 * Where a copy lives in the bucket: `nn-2026/<photo id>/medium.jpg`. **The laptop writes the
 * same key** (`object_key()` in `tools/photos/racephotos/upload.py`), and the two must agree or
 * every image is a 404; `photos-check.test.ts` pins this side to the same example.
 */
export function photoObjectKey(
  eventSlug: string,
  photoId: string,
  size: PhotoSize,
): string {
  return `${eventSlug}/${photoId}/${size}.jpg`;
}

/**
 * The bibs typed into the check page's box, or null if any of them is not a bib.
 *
 * Several may be typed for a photo with several runners in it, separated by spaces or commas.
 * A bib is digits only, as worn — `0311` stays `0311` — and at most eight, which is the
 * database's own rule (`photo_bib_text_shaped`). Nothing typed is an empty list, not null.
 */
export function parseTypedBibs(typed: string): string[] | null {
  const parts = typed
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.some((part) => !/^[0-9]{1,8}$/.test(part))) {
    return null;
  }

  return [...new Set(parts)];
}

export interface PhotoRead {
  bibText: string;
  confidence: number | null;
  confirmed: boolean;
}

export interface PhotoToCheck {
  id: string;
  eventSlug: string;
  shortId: string;
  photographer: string;
  spot: string;
  takenAt: string | null;
  width: number;
  height: number;
  checkState: string;
  heldUntil: string | null;
  /** What the laptop read, minus anything a checker has set aside. */
  reads: PhotoRead[];
  /** The bibs worth offering as buttons: unsure whole reads, then the bibs a part read fits. */
  candidates: string[];
}

/** Whether a read is a part read — a `?` where a digit could not be made out. */
export function isPartRead(bibText: string): boolean {
  return bibText.includes('?');
}

const confidence = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => (value === null ? null : Number(value)));

const photoSchema = z.object({
  id: z.string().uuid(),
  event_slug: z.string().min(1),
  short_id: z.string().min(1),
  photographer: z.string().min(1),
  spot: z.string().min(1),
  taken_at: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  check_state: z.string().min(1),
  held_until: z.string().nullable(),
  reads: z.array(
    z.object({
      bib_text: z.string().min(1),
      confidence,
      confirmed: z.boolean(),
    }),
  ),
  candidates: z.array(z.string().min(1)),
});

function toPhoto(row: z.infer<typeof photoSchema>): PhotoToCheck {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    shortId: row.short_id,
    photographer: row.photographer,
    spot: row.spot,
    takenAt: row.taken_at,
    width: row.width,
    height: row.height,
    checkState: row.check_state,
    heldUntil: row.held_until,
    reads: row.reads.map((read) => ({
      bibText: read.bib_text,
      confidence: read.confidence,
      confirmed: read.confirmed,
    })),
    candidates: row.candidates,
  };
}

type Unavailable = { status: 'unavailable'; error: string };
type Unauthorised = { status: 'unauthorised' };

const refusal = z.object({ ok: z.literal(false), reason: z.string() });

function failed(name: string, error: { code?: string; message: string }): Unavailable {
  return {
    status: 'unavailable',
    error: `${name} — ${error.code ?? 'unknown'}: ${error.message}`,
  };
}

function unexpected(name: string): Unavailable {
  return { status: 'unavailable', error: `${name} returned an unexpected shape` };
}

// -----------------------------------------------------------------------------------------
// The next photo
// -----------------------------------------------------------------------------------------

export type NextPhotoResult =
  { status: 'ok'; photo: PhotoToCheck | null } | Unauthorised | Unavailable;

export async function fetchNextPhoto(client: UserClient): Promise<NextPhotoResult> {
  try {
    const { data, error } = await client.schema('photos').rpc('next_photo');
    if (error) return failed('photos.next_photo', error);

    const ok = z
      .object({ ok: z.literal(true), photo: photoSchema.nullable() })
      .safeParse(data);
    if (ok.success) {
      return {
        status: 'ok',
        photo: ok.data.photo === null ? null : toPhoto(ok.data.photo),
      };
    }

    const refused = refusal.safeParse(data);
    if (refused.success && refused.data.reason === 'refused')
      return { status: 'unauthorised' };

    return unexpected('photos.next_photo');
  } catch (cause) {
    return { status: 'unavailable', error: `photos.next_photo threw: ${String(cause)}` };
  }
}

// -----------------------------------------------------------------------------------------
// A decision, and undoing one
// -----------------------------------------------------------------------------------------

export const DECISION_ACTIONS = [
  'confirm',
  'correct',
  'keep_part',
  'no_bib',
  'skip',
] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** The refusals a decision can meet that a checker needs words for. */
export const DECISION_REFUSALS = [
  'already_decided',
  'not_waiting',
  'no_such_photo',
  'nothing_part_read',
  'bib_required',
  'invalid_bib',
] as const;
export type DecisionRefusal = (typeof DECISION_REFUSALS)[number];

export type DecisionResult =
  | { status: 'ok'; action: DecisionAction; unchanged: boolean }
  | { status: 'refused'; reason: DecisionRefusal }
  | Unauthorised
  | Unavailable;

export async function recordPhotoDecision(
  client: UserClient,
  photoId: string,
  action: DecisionAction,
  bibs: string[] | null,
): Promise<DecisionResult> {
  try {
    const { data, error } = await client.schema('photos').rpc('decide', {
      p_photo_id: photoId,
      p_action: action,
      ...(bibs === null ? {} : { p_bibs: bibs }),
    });
    if (error) return failed('photos.decide', error);

    const ok = z
      .object({
        ok: z.literal(true),
        action: z.enum(DECISION_ACTIONS),
        unchanged: z.boolean().optional(),
      })
      .safeParse(data);
    if (ok.success) {
      return {
        status: 'ok',
        action: ok.data.action,
        unchanged: ok.data.unchanged === true,
      };
    }

    const refused = refusal.safeParse(data);
    if (refused.success) {
      if (refused.data.reason === 'refused') return { status: 'unauthorised' };
      const reason = z.enum(DECISION_REFUSALS).safeParse(refused.data.reason);
      if (reason.success) return { status: 'refused', reason: reason.data };
    }

    return unexpected('photos.decide');
  } catch (cause) {
    return { status: 'unavailable', error: `photos.decide threw: ${String(cause)}` };
  }
}

export const UNDO_REFUSALS = [
  'nothing_to_undo',
  'not_yours',
  'changed_since',
  'no_such_photo',
] as const;
export type UndoRefusal = (typeof UNDO_REFUSALS)[number];

export type UndoResult =
  | { status: 'ok' }
  | { status: 'refused'; reason: UndoRefusal }
  | Unauthorised
  | Unavailable;

export async function undoPhotoDecision(
  client: UserClient,
  photoId: string,
): Promise<UndoResult> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('undo_decision', { p_photo_id: photoId });
    if (error) return failed('photos.undo_decision', error);

    if (z.object({ ok: z.literal(true) }).safeParse(data).success)
      return { status: 'ok' };

    const refused = refusal.safeParse(data);
    if (refused.success) {
      if (refused.data.reason === 'refused') return { status: 'unauthorised' };
      const reason = z.enum(UNDO_REFUSALS).safeParse(refused.data.reason);
      if (reason.success) return { status: 'refused', reason: reason.data };
    }

    return unexpected('photos.undo_decision');
  } catch (cause) {
    return {
      status: 'unavailable',
      error: `photos.undo_decision threw: ${String(cause)}`,
    };
  }
}

// -----------------------------------------------------------------------------------------
// Progress
// -----------------------------------------------------------------------------------------

export interface PhotoEventProgress {
  slug: string;
  name: string | null;
  publishedAt: string | null;
  photos: number;
  hidden: number;
  tagged: number;
  checked: number;
  partRead: number;
  noBibSeen: number;
  leftToCheck: number;
  heldNow: number;
  checkedHere: number;
}

export type ProgressResult =
  { status: 'ok'; events: PhotoEventProgress[] } | Unauthorised | Unavailable;

const count = z.number().int().min(0);

const progressSchema = z.object({
  ok: z.literal(true),
  events: z.array(
    z.object({
      slug: z.string().min(1),
      name: z.string().nullable(),
      published_at: z.string().nullable(),
      photos: count,
      hidden: count,
      tagged: count,
      checked: count,
      part_read: count,
      no_bib_seen: count,
      left_to_check: count,
      held_now: count,
      checked_here: count,
    }),
  ),
});

export async function fetchPhotoProgress(client: UserClient): Promise<ProgressResult> {
  try {
    const { data, error } = await client.schema('photos').rpc('progress');
    if (error) return failed('photos.progress', error);

    const ok = progressSchema.safeParse(data);
    if (ok.success) {
      return {
        status: 'ok',
        events: ok.data.events.map((event) => ({
          slug: event.slug,
          name: event.name,
          publishedAt: event.published_at,
          photos: event.photos,
          hidden: event.hidden,
          tagged: event.tagged,
          checked: event.checked,
          partRead: event.part_read,
          noBibSeen: event.no_bib_seen,
          leftToCheck: event.left_to_check,
          heldNow: event.held_now,
          checkedHere: event.checked_here,
        })),
      };
    }

    const refused = refusal.safeParse(data);
    if (refused.success && refused.data.reason === 'refused')
      return { status: 'unauthorised' };

    return unexpected('photos.progress');
  } catch (cause) {
    return { status: 'unavailable', error: `photos.progress threw: ${String(cause)}` };
  }
}

// -----------------------------------------------------------------------------------------
// Publish
// -----------------------------------------------------------------------------------------

export type PublishResult =
  | { status: 'ok'; already: boolean }
  | { status: 'left-to-check'; left: number }
  | { status: 'no-photos' }
  | { status: 'no-such-event' }
  | Unauthorised
  | Unavailable;

export async function publishPhotos(
  client: UserClient,
  eventSlug: string,
): Promise<PublishResult> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('publish', { p_event_slug: eventSlug });
    if (error) return failed('photos.publish', error);

    const ok = z.object({ ok: z.literal(true), already: z.boolean() }).safeParse(data);
    if (ok.success) return { status: 'ok', already: ok.data.already };

    const left = z
      .object({ ok: z.literal(false), reason: z.literal('left_to_check'), left: count })
      .safeParse(data);
    if (left.success) return { status: 'left-to-check', left: left.data.left };

    const refused = refusal.safeParse(data);
    if (refused.success) {
      if (refused.data.reason === 'refused') return { status: 'unauthorised' };
      if (refused.data.reason === 'no_photos') return { status: 'no-photos' };
      if (refused.data.reason === 'no_such_event') return { status: 'no-such-event' };
    }

    return unexpected('photos.publish');
  } catch (cause) {
    return { status: 'unavailable', error: `photos.publish threw: ${String(cause)}` };
  }
}

// -----------------------------------------------------------------------------------------
// Take a photo down
// -----------------------------------------------------------------------------------------

export type TakeDownResult =
  | { status: 'ok'; id: string; eventSlug: string; shortId: string; already: boolean }
  | { status: 'no-such-photo' }
  | Unauthorised
  | Unavailable;

export async function takeDownPhoto(
  client: UserClient,
  eventSlug: string,
  shortId: string,
): Promise<TakeDownResult> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('take_down', { p_event_slug: eventSlug, p_short_id: shortId });
    if (error) return failed('photos.take_down', error);

    const ok = z
      .object({
        ok: z.literal(true),
        id: z.string().uuid(),
        event_slug: z.string().min(1),
        short_id: z.string().min(1),
        already: z.boolean(),
      })
      .safeParse(data);
    if (ok.success) {
      return {
        status: 'ok',
        id: ok.data.id,
        eventSlug: ok.data.event_slug,
        shortId: ok.data.short_id,
        already: ok.data.already,
      };
    }

    const refused = refusal.safeParse(data);
    if (refused.success) {
      if (refused.data.reason === 'refused') return { status: 'unauthorised' };
      if (refused.data.reason === 'no_such_photo') return { status: 'no-such-photo' };
    }

    return unexpected('photos.take_down');
  } catch (cause) {
    return { status: 'unavailable', error: `photos.take_down threw: ${String(cause)}` };
  }
}

// -----------------------------------------------------------------------------------------
// An unpublished image
// -----------------------------------------------------------------------------------------

export type AdminImageResult =
  | { status: 'ok'; eventSlug: string; shortId: string }
  | { status: 'missing' }
  | Unauthorised
  | Unavailable;

export async function photoForAdminImage(
  client: UserClient,
  photoId: string,
): Promise<AdminImageResult> {
  try {
    const { data, error } = await client
      .schema('photos')
      .rpc('photo_for_admin_image', { p_photo_id: photoId });
    if (error) return failed('photos.photo_for_admin_image', error);

    const ok = z
      .object({
        ok: z.literal(true),
        event_slug: z.string().min(1),
        short_id: z.string().min(1),
      })
      .safeParse(data);
    if (ok.success) {
      return { status: 'ok', eventSlug: ok.data.event_slug, shortId: ok.data.short_id };
    }

    const refused = refusal.safeParse(data);
    if (refused.success) {
      if (refused.data.reason === 'refused') return { status: 'unauthorised' };
      if (refused.data.reason === 'no_such_photo') return { status: 'missing' };
    }

    return unexpected('photos.photo_for_admin_image');
  } catch (cause) {
    return {
      status: 'unavailable',
      error: `photos.photo_for_admin_image threw: ${String(cause)}`,
    };
  }
}
