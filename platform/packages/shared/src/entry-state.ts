import { z } from 'zod';
import type { DbClient } from './supabase';
import { parseIsoDate, toIsoDate, type CivilDate } from './age-category';
import { formatLondonDate } from './london-time';

/**
 * What `/nn/` needs to know before it can decide which form to show.
 *
 * ## Why this is an RPC and not a select
 *
 * There is no API tier between the browser and Postgres, so a select would need a grant on
 * `entries.events`, and the grant is the thing this schema is deliberately without. Every
 * table in `entries` refuses the anon role outright — `42501`, before row-level security is
 * even consulted — and `packages/db/tests/entries.test.ts` asserts that on all six of them.
 * That assertion is meant to survive every future slice, so the one public fact a browser
 * legitimately needs comes through a `security definer` function instead:
 * `entries.entry_state()`, which reads the tables the caller cannot and hands back
 * configuration rather than rows.
 *
 * ## Why it is validated here rather than trusted
 *
 * `supabase gen types` types the function's return as `Json`, which is honest — Postgres
 * builds it with `jsonb_build_object` and TypeScript cannot know its shape. Parsing it with
 * the same library the form is validated with means a migration that renames a key fails
 * here, in one place, with a message, instead of surfacing as `undefined` inside a template
 * three files away.
 *
 * @see docs/architecture/principles.md#row-level-security-is-the-access-control
 */

/**
 * `pre_open` covers both "not yet" and "nobody has decided yet", and that is not a fudge:
 * `entries.events.entries_open_at` is null for Nightingale Nightmare because the opening
 * time is not confirmed, and to somebody looking at the page both mean the same thing —
 * you cannot enter today. The interest form is what they get, which is what they get now.
 */
export const ENTRY_WINDOW_STATES = ['pre_open', 'open', 'closed'] as const;

export type EntryWindowState = (typeof ENTRY_WINDOW_STATES)[number];

export interface EntryFee {
  code: string;
  label: string;
  pricePence: number;
}

export interface EntryState {
  slug: string;
  displayName: string;
  state: EntryWindowState;
  /** Civil, as published. Not an instant — see age-category.ts. */
  eventDate: CivilDate;
  /** `HH:MM:SS` as Postgres renders a `time`. */
  startTime: string;
  entrantsPerEntry: number;
  capacity: number;
  /** Null means no age check at all. 18 for NN 2026, confirmed on 13 August 2026. */
  minimumAge: number | null;
  requiresDob: boolean;
  consentVersion: string;
  fees: EntryFee[];
}

export type EntryStateResult =
  { ok: true; value: EntryState } | { ok: false; error: string };

const feeShape = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  price_pence: z.number().int().min(0),
  // **`requires_ea_number` is still on the wire and is deliberately not parsed.** The club
  // stopped asking for England Athletics numbers on 29 August 2026 and every fee row is false;
  // the column survives only until the contract step, so reading it here would be reading a
  // fact about nothing. Zod strips a key it is not asked for, so the parse is unaffected
  // whichever side of that migration the database is on.
});

const entryStateShape = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  state: z.enum(ENTRY_WINDOW_STATES),
  event_date: z.string(),
  start_time: z.string(),
  entrants_per_entry: z.number().int().positive(),
  capacity: z.number().int().positive(),
  minimum_age: z.number().int().nullable(),
  requires_dob: z.boolean(),
  consent_version: z.string().min(1),
  fees: z.array(feeShape),
});

/**
 * Read one event's public configuration.
 *
 * Never throws, and never resolves to `open` on a failure it does not understand. Every
 * unhappy path — the function missing because a migration has not landed, an unknown slug,
 * a shape that does not parse — comes back as `ok: false`, and the Worker treats that
 * exactly as it treats a closed window. **The failure direction is towards taking no
 * entries**, which is the only safe direction for a page that will shortly be attached to a
 * card payment.
 */
export async function fetchEntryState(
  client: DbClient,
  slug: string,
): Promise<EntryStateResult> {
  const { data, error } = await client.schema('entries').rpc('entry_state', {
    p_slug: slug,
  });

  return readEntryState(data, error, `No event with slug ${slug}`, slug);
}

/**
 * Read the **current running** of a recurring race, without having to know which one it is.
 *
 * This is what `/nn/` uses, and the reason it exists is a route rather than a database
 * convenience: a page about the race in general has to link to the running that is on, and
 * naming that running in markup means every such page needs editing the year it changes.
 * `entries.events.race_slug` holds the answer and `entries.current_entry_state()` picks the
 * forthcoming running, or the most recent past one when there is no forthcoming one.
 *
 * **The answer carries its own `slug`**, which is how the caller learns *which* running it
 * got — and therefore which year page to point at. That is the one fact the evergreen page
 * needs and the one it must not hold itself.
 *
 * Same failure direction as `fetchEntryState`, for the same reason: a race with no readable
 * running is a page with no entry form and no year link, never a page that guesses.
 */
export async function fetchCurrentEntryState(
  client: DbClient,
  raceSlug: string,
): Promise<EntryStateResult> {
  const { data, error } = await client.schema('entries').rpc('current_entry_state', {
    p_race_slug: raceSlug,
  });

  return readEntryState(data, error, `No running of race ${raceSlug}`, raceSlug);
}

/**
 * The half both readers share: PostgREST's answer in, an `EntryState` or a reason out.
 *
 * Split out rather than duplicated because the *failure* handling is the part that matters,
 * and two copies of "never guess open" is one copy too many. The two RPCs differ only in
 * which name they ask for.
 */
function readEntryState(
  data: unknown,
  error: { code?: string | null; message: string } | null,
  emptyMessage: string,
  label: string,
): EntryStateResult {
  if (error) {
    // The code and the message from PostgREST, neither of which can carry personal data:
    // these functions read none. `PGRST202` means the function is not there yet and
    // `PGRST106` means the schema is not exposed — both are deployment states rather than
    // bugs, and both should read as such in a log.
    return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
  }

  // A name with no row comes back as SQL null rather than an error, because "no such thing"
  // is a legitimate answer to a legitimate question.
  if (data === null) {
    return { ok: false, error: emptyMessage };
  }

  const parsed = entryStateShape.safeParse(data);

  if (!parsed.success) {
    return { ok: false, error: `entry_state returned an unexpected shape for ${label}` };
  }

  const eventDate = parseIsoDate(parsed.data.event_date);

  if (eventDate === null) {
    return {
      ok: false,
      error: `entry_state returned an unusable event_date for ${label}`,
    };
  }

  return {
    ok: true,
    value: {
      slug: parsed.data.slug,
      displayName: parsed.data.display_name,
      state: parsed.data.state,
      eventDate,
      startTime: parsed.data.start_time,
      entrantsPerEntry: parsed.data.entrants_per_entry,
      capacity: parsed.data.capacity,
      minimumAge: parsed.data.minimum_age,
      requiresDob: parsed.data.requires_dob,
      consentVersion: parsed.data.consent_version,
      fees: parsed.data.fees.map((fee) => ({
        code: fee.code,
        label: fee.label,
        pricePence: fee.price_pence,
      })),
    },
  };
}

/**
 * The event's date, as a page shows it — **through the one formatter this repository has**.
 *
 * ## Why a civil date can go through an instant formatter, safely
 *
 * `event_date` is civil time, as published: "1 November 2026" is what the committee decided
 * and what the poster says, and it does not move if somebody reads it from another timezone.
 * `formatLondonDate` takes an *instant*. Handing it one built from the civil date needs an
 * argument, and this is it:
 *
 * **London's offset from UTC is never negative.** It is `+00:00` in winter and `+01:00` in
 * summer, so an instant at `00:00Z` on a given day is either `00:00` or `01:00` on **that same
 * day** in London. The calendar day therefore survives the conversion for every date in the
 * year, including the two on which the clocks change. `london-time.test.ts` pins the two
 * transition dates of 2026 and this module's own test pins a date either side of each.
 *
 * That is the whole of it. There is **no second formatter** here — this composes `toIsoDate`
 * with `formatLondonDate` and adds one `T00:00:00Z`. A second formatter is what the timezone
 * discipline in this repository exists to prevent, and it is what
 * `docs/architecture/decisions/adr-011-a-race-and-its-runnings.md` recorded as the reason
 * `/nn/` had no date at all. This closes that gap without opening the one it was avoiding.
 *
 * **Not `race.json`'s pre-formatted string.** That one says "Sunday 1 November 2026" and
 * belongs to the 2026 running; a page about the race cannot read it without naming a year.
 * This reads the running the database says is current, which is the point.
 */
export function formatEventDate(date: CivilDate): string {
  return formatLondonDate(`${toIsoDate(date)}T00:00:00Z`);
}

/**
 * The event's start time, as a page shows it: `11:00:00` → `11:00`.
 *
 * **Deliberately not put through `formatLondonTime`, and that is the interesting half.** A
 * start time is civil local time, as published — the same "11:00" the poster carries. It is
 * not an instant, and turning it into one to format it would mean choosing a date and an
 * offset for a race held six days after the clocks go back, which is precisely the conversion
 * the storage-UTC rule exists to keep away from. Postgres renders a `time` as `HH:MM:SS`;
 * dropping the seconds is a string operation and nothing more.
 */
export function formatEventStartTime(startTime: string): string {
  return /^\d{2}:\d{2}/.exec(startTime)?.[0] ?? startTime;
}

/**
 * Money, formatted once and in one place.
 *
 * **Not `toLocaleString`.** ESLint bans the timezone-taking members of that family
 * repository-wide and the currency one has the same shape of problem: it takes the ambient
 * locale, so a Worker in one region and a browser in another would render the same price
 * two ways. The club charges pounds sterling and always will; two decimal places and a `£`
 * is the whole requirement.
 *
 * Zero is "Free" rather than "£0.00" because that is what a VI guide's place is, and a
 * price of nothing set in the same figures as a price of something reads like a mistake.
 */
export function formatPence(pence: number): string {
  if (pence === 0) {
    return 'Free';
  }

  const pounds = Math.floor(pence / 100);
  const remainder = String(pence % 100).padStart(2, '0');

  return `£${pounds}.${remainder}`;
}
