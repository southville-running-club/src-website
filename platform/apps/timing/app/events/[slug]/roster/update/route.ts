import { NextResponse } from 'next/server';
import { scheduleLeaderboardNudge } from '../../../../../lib/leaderboard-nudge';
import { readTiming } from '../../../../../lib/reads';
import { writeTiming } from '../../../../../lib/writes';
import type { DeskRoster } from '../../../../../lib/desk-roster';

/**
 * `POST /timing/events/<slug>/roster/update` — the admin half of the Roster (ADR-056).
 *
 * Two intents, each made of functions the database already has plus one new one:
 *
 * - **`edit`** — a runner's name (`rename_runner()`, a compare-and-swap), their bib
 *   (`set_bib_override()`, which refuses a bib somebody else holds), and their race status
 *   (`set_race_status()`). Only what changed is sent, in that order; the first refusal stops the
 *   rest and is what the page says.
 * - **`add`** — an on-the-day runner (`add_walk_in()`, which gives the next free bib), then the
 *   bib the desk is handing over if it is a different spare (`set_bib_override()`).
 *
 * The door is `timing.registration.import` (`lib/access.ts`), the entry list's own permission.
 * A status change also needs `timing.event.manage`, which `set_race_status()` checks itself.
 *
 * ⚠️ **No name ever goes in the address.** On a bib somebody else holds, the redirect carries the
 * holder's runner id and the page names them from the roster it reads anyway.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: Record<string, string | null> = {
  normal: null,
  dns: 'dns',
  dnf: 'dnf',
  dq: 'dq',
};
const GENDERS = new Set(['female', 'male', 'non_binary']);

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

function backTo(
  request: Request,
  slug: string,
  params: Record<string, string>,
): NextResponse {
  const target = new URL(
    `/timing/events/${encodeURIComponent(slug)}/roster`,
    request.url,
  );
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target, 303);
}

/** Who holds a bib on this race, by runner id — read only when a bib was refused as taken. */
async function holderOf(slug: string, bib: string, exceptTeam: string): Promise<string> {
  const read = await readTiming<DeskRoster>('desk_roster', { p_event_slug: slug });
  if (read.state !== 'ok') return '';
  const holder = read.data.runners.find((r) => r.bib === bib && r.team_id !== exceptTeam);
  return holder?.runner_id ?? '';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return backTo(request, slug, { outcome: 'incomplete' });
  }

  const intent = text(form, 'intent');
  const q = text(form, 'q');

  if (intent === 'edit') {
    const runnerId = text(form, 'runner_id');
    const teamId = text(form, 'team_id');
    if (!UUID.test(runnerId) || !UUID.test(teamId)) {
      return backTo(request, slug, { q, outcome: 'incomplete' });
    }
    const again = { q, edit: runnerId };

    const first = text(form, 'firstname');
    const last = text(form, 'lastname');
    if (first === '' || last === '') {
      return backTo(request, slug, { ...again, outcome: 'incomplete' });
    }

    const bib = text(form, 'bib');
    if (bib !== '' && !/^\d+$/.test(bib)) {
      return backTo(request, slug, { ...again, outcome: 'bib_digits' });
    }

    let changed = false;

    // 1. The name, if it moved — compare-and-swap on what the form was drawn with.
    const expectedFirst = String(form.get('expected_firstname') ?? '');
    const expectedLast = String(form.get('expected_lastname') ?? '');
    if (first !== expectedFirst || last !== expectedLast) {
      const renamed = await writeTiming('rename_runner', {
        p_event_slug: slug,
        p_runner_id: runnerId,
        p_firstname: first,
        p_lastname: last,
        p_expected_firstname: expectedFirst,
        p_expected_lastname: expectedLast,
      });
      if (renamed.state === 'unavailable') {
        return backTo(request, slug, { ...again, outcome: 'unavailable' });
      }
      if (renamed.state === 'refused') {
        return backTo(request, slug, { ...again, outcome: renamed.reason });
      }
      changed = true;
    }

    // 2. The bib, if it moved. A blank bib clears the override and the runner wears their
    //    assigned number again.
    const expectedBib = text(form, 'expected_bib');
    if (bib !== expectedBib) {
      const leg = Number(text(form, 'leg')) === 2 ? 2 : 1;
      const set = await writeTiming('set_bib_override', {
        p_event_slug: slug,
        p_team_id: teamId,
        p_leg: leg,
        p_bib: bib === '' ? null : bib,
      });
      if (set.state === 'unavailable') {
        return backTo(request, slug, { ...again, outcome: 'unavailable' });
      }
      if (set.state === 'refused') {
        const holder =
          set.reason === 'bib_taken' ? await holderOf(slug, bib, teamId) : '';
        return backTo(request, slug, {
          ...again,
          outcome: set.reason,
          bib: set.reason === 'bib_taken' ? bib : '',
          holder,
        });
      }
      changed = true;
    }

    // 3. The status, if it moved and was offered.
    const status = text(form, 'status');
    const expectedStatus = text(form, 'expected_status');
    if (status !== '' && status !== expectedStatus && Object.hasOwn(STATUSES, status)) {
      const marked = await writeTiming('set_race_status', {
        p_event_slug: slug,
        p_team_id: teamId,
        p_status: STATUSES[status] ?? null,
      });
      if (marked.state === 'unavailable') {
        return backTo(request, slug, { ...again, outcome: 'unavailable' });
      }
      if (marked.state === 'refused') {
        return backTo(request, slug, { ...again, outcome: marked.reason });
      }
      if (marked.data.changed === true) {
        changed = true;
        await scheduleLeaderboardNudge(slug);
      }
    }

    return backTo(request, slug, {
      q,
      outcome: changed ? 'saved' : 'unchanged',
      saved: runnerId,
    });
  }

  if (intent === 'add') {
    const first = text(form, 'firstname');
    const last = text(form, 'lastname');
    if (first === '' || last === '') {
      return backTo(request, slug, { add: '1', outcome: 'incomplete' });
    }

    const gender = text(form, 'gender');
    if (gender !== '' && !GENDERS.has(gender)) {
      return backTo(request, slug, { add: '1', outcome: 'incomplete' });
    }

    // ⚠️ **An age, never a date of birth** — the desk must never ask for one.
    const age = text(form, 'age_on_day');
    if (age !== '' && !/^\d{1,3}$/.test(age)) {
      return backTo(request, slug, { add: '1', outcome: 'incomplete' });
    }

    const bib = text(form, 'bib');
    if (bib !== '' && !/^\d+$/.test(bib)) {
      return backTo(request, slug, { add: '1', outcome: 'bib_digits' });
    }

    const added = await writeTiming('add_walk_in', {
      p_event_slug: slug,
      p_firstname: first,
      p_lastname: last,
      p_gender: gender === '' ? null : gender,
      p_age_on_day: age === '' ? null : Number(age),
      p_club_name: null,
    });
    if (added.state === 'unavailable') {
      return backTo(request, slug, { add: '1', outcome: 'unavailable' });
    }
    if (added.state === 'refused') {
      return backTo(request, slug, { add: '1', outcome: added.reason });
    }

    const teamId = String(added.data.team_id ?? '');
    const given = String(added.data.team_number ?? '');

    // The spare the desk is handing over, if it is not the number they were given.
    if (bib !== '' && bib !== given && UUID.test(teamId)) {
      const set = await writeTiming('set_bib_override', {
        p_event_slug: slug,
        p_team_id: teamId,
        p_leg: 1,
        p_bib: bib,
      });
      if (set.state !== 'ok') {
        // The runner is added, with the number they were given. Say so, and why the spare
        // was not taken, rather than leaving the desk to wonder.
        const holder =
          set.state === 'refused' && set.reason === 'bib_taken'
            ? await holderOf(slug, bib, teamId)
            : '';
        return backTo(request, slug, {
          outcome: set.state === 'refused' ? set.reason : 'unavailable',
          bib: set.state === 'refused' && set.reason === 'bib_taken' ? bib : '',
          holder,
          added_team: teamId,
        });
      }
    }

    return backTo(request, slug, { outcome: 'added', added_team: teamId });
  }

  // An intent nobody wrote down. Nothing was read and nothing was written.
  return backTo(request, slug, { q, outcome: 'refused' });
}
