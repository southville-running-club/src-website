import Link from 'next/link';
import { formatLondon } from '@src/shared';
import { readTiming } from '../../../../lib/reads';
import { outcomeFor } from '../../../../lib/marshal-outcomes';

/**
 * `/timing/events/<slug>/marshals/` — who is standing at the line for one race.
 *
 * Issue [#245](https://github.com/southville-running-club/src-website/issues/245), under
 * [ADR-036](../../../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
 * Behind `timing.marshal.assign`; `lib/access.ts` maps it and `middleware.ts` enforces it.
 * ⚠️ **This page does not gate itself** — see `app/page.tsx`'s header for the measurement that
 * settled that.
 *
 * ## What a roster is, and the sentence this page has to keep saying
 *
 * ⚠️ **The roster narrows a permission and cannot grant one.** Adding somebody here does not
 * make them a marshal; it says which races a person who is *already* a marshal may record a
 * crossing on. Granting `timing-marshal` happens at `/admin/people/` behind
 * `identity.role.grant`, where every other grant on this platform lives — so the picker below
 * offers only people who already hold `timing.crossing.record`, and `assign_marshal()` refuses
 * anybody else outright rather than writing a row that means nothing.
 *
 * **A `timing-admin` is not on every roster by holding the role.** The old application let a
 * global admin bypass the roster entirely; ADR-036 checks it after the permission for
 * everybody, so an admin who is going to stand at the line adds themselves like anybody else.
 * The page says so, because otherwise the first time anybody finds out is on a start line.
 *
 * ## Why names are missing, and why the picker shows an address when the roster does not
 *
 * `identity.people.name` is nullable and nothing writes it yet — that column's own migration
 * says so, until #61. So the roster renders **“No name recorded”** rather than falling back to
 * an address, because a roster is who is at the line and not how to contact them. The picker
 * is the deliberate exception and the argument is safety rather than convenience: its whole job
 * is identifying one specific person before putting them on a race, and with every name null a
 * picker carrying no address is a list of indistinguishable rows whose failure mode is
 * assigning the wrong person. `20260912110000_timing_marshal_roster.sql`'s header carries the
 * full reasoning for both halves.
 */
export const dynamic = 'force-dynamic';

interface RosterMember {
  person_id: string;
  name: string | null;
  assigned_at: string;
}

interface Roster {
  event: { slug: string; name: string };
  marshals: RosterMember[];
}

interface AssignableMarshal {
  person_id: string;
  name: string | null;
  email: string | null;
}

/**
 * How one person is named in a list, when the club records no name for anybody yet.
 *
 * Kept as a function rather than inlined twice, so the roster and the picker cannot drift into
 * describing the same missing name two different ways.
 */
function nameOf(person: { name: string | null }): string {
  return person.name ?? 'No name recorded';
}

export default async function MarshalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: both are Promises and have to be awaited.
  const { slug } = await params;
  const query = await searchParams;

  // A repeated parameter arrives as an array; only a single value can name an outcome, and an
  // array falls through to `undefined`, which renders nothing.
  const outcomeParam = query.outcome;
  const outcome = outcomeFor(typeof outcomeParam === 'string' ? outcomeParam : undefined);

  const roster = await readTiming<Roster>('roster_for_event', {
    p_event_slug: slug,
  });

  if (roster.state === 'unavailable') {
    return (
      <>
        <h1>Marshals</h1>
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so this roster could not be
          read. Nothing has been changed. Try again in a moment.
        </p>
      </>
    );
  }

  if (roster.state === 'none') {
    // Word for word `app/not-found.tsx`, because a refusal must be indistinguishable from an
    // address that does not exist — `roster_for_event()` answers the same `null` for both.
    return (
      <>
        <h1>Not found</h1>
        <p>There is nothing at this address.</p>
      </>
    );
  }

  const { event, marshals } = roster.data;
  const rostered = new Set(marshals.map((m) => m.person_id));

  // ⚠️ **Read after the roster and never instead of it.** If this one fails the page still
  // renders the roster and the remove buttons — the half a volunteer is most likely to need in
  // a hurry — and says the picker is the part that is missing. A page that gave up entirely
  // because a *second* read failed would be an outage wider than the outage.
  const assignable = await readTiming<AssignableMarshal[]>('assignable_marshals');
  const candidates =
    assignable.state === 'ok'
      ? assignable.data.filter((person) => !rostered.has(person.person_id))
      : [];

  const action = `/timing/events/${encodeURIComponent(slug)}/marshals/update`;

  return (
    <>
      <h1>Marshals</h1>

      <p className="lede">Who may record a crossing for {event.name}.</p>

      {outcome === null ? null : (
        <p
          className={outcome.tone === 'ok' ? 'notice notice-ok' : 'notice notice-bad'}
          // ⚠️ **`role="status"` announces nothing here today, and that is worth saying rather
          // than letting somebody believe it does.** A live region only announces a change,
          // and every path to this message is a **full page load** after the route handler's
          // 303 — so a screen reader reads it in document order, above the roster it is about,
          // which is why it is placed there. The role costs nothing, is the correct semantic
          // for the content, and is what makes the message announce properly if this page is
          // ever enhanced to update in place. It is not standing in for a live region that
          // this page needs and does not have.
          role="status"
        >
          {outcome.message}
        </p>
      )}

      <h2>On the roster</h2>

      {marshals.length === 0 ? (
        <p>
          Nobody is on this roster yet, so nobody can record a crossing for this race —
          including a timing admin, who is not on a roster by holding the role and adds
          themselves like anybody else.
        </p>
      ) : (
        <ul className="summary-list">
          {marshals.map((person) => (
            <li key={person.person_id}>
              <h3>{nameOf(person)}</h3>
              <dl>
                <dt>Added</dt>
                {/* `formatLondon` and nothing else. A bare `toLocale*String` takes the
                    ambient timezone, and this race is the weekend after the clocks go back. */}
                <dd>{formatLondon(person.assigned_at)}</dd>
              </dl>
              <form method="post" action={action}>
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="person_id" value={person.person_id} />
                {/*
                  ⚠️ **`aria-label` rather than a visually-hidden span**, and the reason is in
                  `base.css` at `.admin-scroll`: this stylesheet has no visually-hidden
                  utility at all, and the one in `nn-admin.css` is `position: absolute` — which
                  laid a span out against the *document* and made a whole admin page scroll
                  sideways at 320px. Inventing one here would be re-importing that trap to give
                  a button a longer name. The label is the accessible name outright; the
                  visible word stays "Remove", which is what a volunteer is looking for.
                */}
                <button
                  className="button"
                  type="submit"
                  aria-label={`Remove ${nameOf(person)} from this roster`}
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2>Add somebody</h2>

      {assignable.state === 'unavailable' ? (
        <p className="notice notice-bad">
          The club&rsquo;s database could not be reached, so the list of people who could
          be added is not available. The roster above was read before that happened and is
          correct. Try again in a moment.
        </p>
      ) : candidates.length === 0 ? (
        <p>
          {marshals.length === 0
            ? 'Nobody at the club holds the timing-marshal role yet. It is granted at /admin/people/, and this page can only narrow it to a race.'
            : 'Everybody who can record a crossing is already on this roster.'}
        </p>
      ) : (
        <form method="post" action={action}>
          <input type="hidden" name="intent" value="assign" />

          <div className="field">
            <label className="field-label" htmlFor="person_id">
              Who to add
            </label>
            <p className="field-hint" id="person_id-hint">
              Only people who already hold the timing-marshal role are listed. Adding
              somebody here lets them record a crossing for this race and no other.
            </p>
            <select
              className="field-input"
              id="person_id"
              name="person_id"
              aria-describedby="person_id-hint"
              required
            >
              {/* No pre-selected person: the first option is deliberately empty so that
                  submitting without choosing is refused rather than quietly assigning
                  whoever happened to sort first. */}
              <option value="">Choose somebody</option>
              {candidates.map((person) => (
                <option key={person.person_id} value={person.person_id}>
                  {person.name ?? person.email ?? nameOf(person)}
                </option>
              ))}
            </select>
          </div>

          <button className="button" type="submit">
            Add to this roster
          </button>
        </form>
      )}

      <p>
        <Link href={`/events/${slug}`}>Back to {event.name}</Link>
      </p>
    </>
  );
}
