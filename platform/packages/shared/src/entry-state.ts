import { z } from 'zod';
import type { AnonClient } from './supabase';
import { parseIsoDate, type CivilDate } from './age-category';

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
  /** Whether choosing this fee makes the England Athletics number a required field. */
  requiresEaNumber: boolean;
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
  requires_ea_number: z.boolean(),
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
  client: AnonClient,
  slug: string,
): Promise<EntryStateResult> {
  const { data, error } = await client.schema('entries').rpc('entry_state', {
    p_slug: slug,
  });

  if (error) {
    // The code and the message from PostgREST, neither of which can carry personal data:
    // this function reads none. `PGRST202` means the function is not there yet and
    // `PGRST106` means the schema is not exposed — both are deployment states rather than
    // bugs, and both should read as such in a log.
    return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
  }

  // A slug with no row comes back as SQL null rather than an error, because "no such event"
  // is a legitimate answer to a legitimate question.
  if (data === null) {
    return { ok: false, error: `No event with slug ${slug}` };
  }

  const parsed = entryStateShape.safeParse(data);

  if (!parsed.success) {
    return { ok: false, error: `entry_state returned an unexpected shape for ${slug}` };
  }

  const eventDate = parseIsoDate(parsed.data.event_date);

  if (eventDate === null) {
    return {
      ok: false,
      error: `entry_state returned an unusable event_date for ${slug}`,
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
        requiresEaNumber: fee.requires_ea_number,
      })),
    },
  };
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
