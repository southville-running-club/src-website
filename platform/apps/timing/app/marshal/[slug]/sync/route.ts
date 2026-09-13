import { NextResponse } from 'next/server';
import { writeTiming } from '../../../../lib/writes';

/**
 * `POST /timing/marshal/<slug>/sync` — the drain: queued crossings, from the phone to the
 * database.
 *
 * Issue [#203](https://github.com/southville-running-club/src-website/issues/203). Behind
 * `timing.crossing.record` **and** a `timing.marshals` row for this race; `lib/access.ts` maps
 * it and `middleware.ts` enforces both, exactly as it does for the screen that posts here.
 *
 * ## ⚠️ Why the browser posts here rather than straight to PostgREST
 *
 * The old application wrote to Supabase from the page, which means the page holds an access
 * token. [#244](https://github.com/southville-running-club/src-website/issues/244) decided
 * against that: **the browser never holds the token**, the cookie does, and this route is what
 * turns one into the other. `writeTiming()` reads the cookie server-side and calls
 * `record_crossing()` as the marshal, so `auth.uid()` still names them and every check in the
 * function is made against the real person.
 *
 * ## JSON rather than a form, and this is the one address on this platform where that is right
 *
 * Every other write under `/timing` is a plain `<form method="post">` answered by a 303,
 * because every Playwright project here includes `no-javascript` and HTML cannot fail with
 * scripting off. ⚠️ **That argument does not reach this address.** The thing posting to it is
 * an offline queue in IndexedDB — there is no version of it that works without JavaScript, so
 * there is nothing to degrade to, and pretending otherwise with a form would be ceremony. The
 * page's *fallback* is what carries the no-script case, and it is a sentence rather than a
 * form: `page.tsx`'s header says what it says and why.
 *
 * ## A batch, and why it is a loop here rather than a function in the database
 *
 * #251 lists `record_crossings(jsonb)` as optional and says to measure first. The measurement
 * that matters is the marshal's: a drain of forty after a signal gap is **one request from the
 * phone** either way, and that is the round trip crossing a bad connection. What the shape
 * would save is forty Supabase calls the Worker makes over a good one. So the batch lives
 * here, and the day a drain is actually slow there is a second contract to add rather than one
 * already built ahead of its caller.
 *
 * ⚠️ **{@link MAX_BATCH} is a Cloudflare limit and not a preference.** A Worker request may
 * make a bounded number of subrequests, so an unbounded array from the client would be a way
 * to make this route fail on its own limit. The client chunks; each chunk is independently
 * idempotent, so a chunk that fails costs a retry of itself and nothing else.
 *
 * ## Every row answers for itself
 *
 * A 200 with per-row outcomes rather than one status for the batch. ⚠️ **A card that landed
 * must be retired even if the card beside it was refused** — one 4xx for the whole batch would
 * make the queue re-send crossings that are already in the database, for ever, because the
 * refused one never stops being refused.
 *
 * ⚠️ **There is no authorisation check in this file, deliberately.** The door has admitted the
 * request and `record_crossing()` asks `identity.has_permission()` and the roster itself,
 * against the caller's own token. A third check here would be a third statement of one rule,
 * and the third is the one that goes stale.
 */

/** How many crossings one request may carry. See the header — a Workers subrequest budget. */
const MAX_BATCH = 20;

/** One crossing as the queue holds it. Nothing here is trusted; every field is checked. */
interface Incoming {
  id: string;
  bib: string;
  capturedAt: string;
  anomalyFlag: boolean;
  anomalyReason: string | null;
}

type Outcome =
  | { id: string; state: 'ok' }
  | { id: string; state: 'refused'; reason: string }
  | { id: string; state: 'unavailable' };

/**
 * A crossing this route will act on, or `null`.
 *
 * ⚠️ **Shape only, and never a judgement about the values.** `captured_at` is the phone's
 * clock and may be minutes behind or ahead; a bib may match no team at all. Both are the
 * database's business — an unknown bib is *stored* with `team_id` null and never refused,
 * because an anomaly flags and never blocks. What is checked here is that the four fields the
 * function needs are present and of the right type, so a malformed body is one refusal rather
 * than a PostgREST error per row.
 */
function incomingFrom(value: unknown): Incoming | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const row = value as Record<string, unknown>;

  if (
    typeof row.id !== 'string' ||
    typeof row.bib !== 'string' ||
    typeof row.capturedAt !== 'string' ||
    row.id === '' ||
    row.capturedAt === ''
  ) {
    return null;
  }

  return {
    id: row.id,
    bib: row.bib,
    capturedAt: row.capturedAt,
    anomalyFlag: row.anomalyFlag === true,
    // The frozen verdict from confirm time, carried verbatim on every retry. A non-string is
    // dropped rather than coerced — `String(undefined)` in this column would be a sentence a
    // volunteer later reads as the club's.
    anomalyReason: typeof row.anomalyReason === 'string' ? row.anomalyReason : null,
  };
}

async function record(slug: string, crossing: Incoming): Promise<Outcome> {
  const result = await writeTiming('record_crossing', {
    p_id: crossing.id,
    p_event_slug: slug,
    p_bib: crossing.bib,
    p_captured_at: crossing.capturedAt,
    // ⚠️ **Always `tap`.** `manual` is the desk's, for a crossing typed in after the fact, and
    // this route is only ever the queue draining. A client that could name the source could
    // make a tap look like an admin's correction.
    p_source: 'tap',
    p_anomaly_flag: crossing.anomalyFlag,
    p_anomaly_reason: crossing.anomalyReason,
  });

  if (result.state === 'ok') {
    return { id: crossing.id, state: 'ok' };
  }

  // ⚠️ **`unavailable` is carried through as itself and never flattened into a refusal.** The
  // difference is the whole behaviour of the card: an outage is retried on the drain and reads
  // as "no signal", and a refusal is a card somebody has to do something about.
  return result.state === 'unavailable'
    ? { id: crossing.id, state: 'unavailable' }
    : { id: crossing.id, state: 'refused', reason: result.reason };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const raw = (body as { crossings?: unknown })?.crossings;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH) {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const crossings = raw.map(incomingFrom);
  if (crossings.some((c) => c === null)) {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  // In parallel: each call is an independent, idempotent insert, and the wait is Supabase's
  // rather than this Worker's. `MAX_BATCH` is what keeps the fan-out inside the subrequest
  // budget.
  const results = await Promise.all(
    (crossings as Incoming[]).map((crossing) => record(slug, crossing)),
  );

  // ⚠️ **`no-store`, and it is not housekeeping.** A cached sync response is a queue that
  // believes crossings landed because a *previous* batch did.
  return NextResponse.json({ results }, { headers: { 'cache-control': 'no-store' } });
}
