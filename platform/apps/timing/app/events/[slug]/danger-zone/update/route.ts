import { NextResponse } from 'next/server';
import { scheduleLeaderboardNudge } from '../../../../../lib/leaderboard-nudge';
import { writeTiming } from '../../../../../lib/writes';

/**
 * `POST /timing/events/<slug>/danger-zone/update` — wipe a race back to nothing captured.
 *
 * Issue [#254](https://github.com/southville-running-club/src-website/issues/254). Behind
 * `timing.event.manage`, mapped in `lib/access.ts` and enforced by `middleware.ts`.
 *
 * ## ⚠️ This handler decides nothing
 *
 * It reads one field and hands it to `timing.reset_event()`, which checks the permission, the
 * publication state and the typed phrase for itself. **That is deliberate and it is the rule
 * `writes.ts` states**: a check here would be a second statement of a rule the database already
 * holds, and the second statement is the one that goes stale. In particular this handler does
 * **not** compare the confirmation against the slug — a POST that skipped the page has to meet
 * the same control as one that did not, and the only place that can be true is the database.
 *
 * ## Why there is no `intent`
 *
 * Every sibling handler here carries a closed `INTENTS` record because its page has two or more
 * buttons. This page has one, and there is nothing to distinguish — so an intent field would be
 * a value that can only ever be one thing, which is a check that always passes. The address is
 * what is gated, and a spelling nobody wrote down in `EVENT_SECTION_ACTIONS` is refused before
 * this file runs.
 */

function backTo(request: Request, slug: string, outcome: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/timing/events/${encodeURIComponent(slug)}/danger-zone?outcome=${encodeURIComponent(outcome)}`,
      request.url,
    ),
    303,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 16: `params` is a Promise and has to be awaited.
  const { slug } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return backTo(request, slug, 'incomplete');
  }

  // ⚠️ **An absent field becomes an empty string rather than an early return.** `reset_event()`
  // answers `not_confirmed` for it, which is the same sentence a wrong phrase gets — and that
  // is right: "you did not type it" and "what you typed was not it" are one thing to the person
  // reading the page, and two branches here would be two ways of saying so that could drift.
  const confirmation = String(form.get('confirmation') ?? '');

  const result = await writeTiming('reset_event', {
    p_event_slug: slug,
    p_confirmation: confirmation,
  });

  if (result.state === 'ok') {
    // ⚠️ **A wiped race has to reach a board that is already open**, or a screen at a rehearsal
    // goes on showing a field that no longer exists — and the room holds no copy of it to go
    // stale, so one nudge and every screen re-reads an empty race. Advisory, as ever:
    // `lib/leaderboard-nudge.ts`.
    await scheduleLeaderboardNudge(slug);

    return backTo(request, slug, 'wiped');
  }

  return backTo(
    request,
    slug,
    result.state === 'unavailable' ? 'unavailable' : result.reason,
  );
}
