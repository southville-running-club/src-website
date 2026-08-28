import { z } from 'zod';
import type { Json } from '@src/db';
import type { AnonClient, UserClient } from './supabase';
import { NN_ENTRY_GENDERS } from './nn-entry';

/**
 * Reading the admin surface — through the key, and now through the `nn-admin` role as well.
 *
 * ## Two doors, one room
 *
 * #57 gave four of these reads a role-checked counterpart in the database: same read, behind
 * `identity.has_role('nn-admin')` instead of a shared key. Each pair calls the same `read_*`
 * helper down there, and each pair is parsed by the same `parse*` function up here, so the two
 * doors cannot come to disagree about what is in the room. The key path is unchanged and stays
 * until #63 retires it — deliberately, because nothing sequences a migration against a
 * Cloudflare deploy and a surface that reads the club's entries is a poor place to find that
 * out.
 *
 * ## Why these are RPCs, like everything else here
 *
 * The same reason `entry-state.ts` and `entry-purchase.ts` are: there is no API tier between
 * the Worker and Postgres, and the anon role holds no grant on any table in `entries`. A select
 * would need one, and a grant on a table of names, ages, emergency contacts and payment
 * references is the thing that schema is deliberately without.
 *
 * ## The key travels on every call, and it is never logged
 *
 * `ENTRIES_ADMIN_KEY` is a Worker secret. It is the second factor that makes a grant to the
 * published anon role safe — the mechanism ADR-010 established for the payment webhook and
 * ADR-013 extends here. Every function below refuses on it before it reads anything, so
 * `unauthorised` says nothing about whether an event, an entrant or a single entry exists.
 *
 * ## Every result is parsed rather than trusted
 *
 * `supabase gen types` types every one of these returns as `Json`, honestly — Postgres builds
 * them with `jsonb_build_object`. Parsing with Zod means a migration that renames a key fails in
 * one place with a message, rather than rendering an empty table that reads as "nobody has
 * entered yet". On a page an organiser uses to decide how many bibs to set out, that
 * distinction is the whole point.
 *
 * @see docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md
 */

/**
 * What went wrong, in the three shapes a caller has to tell apart.
 *
 *   `unauthorised` — the key was refused, or nobody has installed the digest. The Worker must
 *                    answer as though the route did not exist.
 *   `unavailable`  — the question could not be asked: the migration has not landed, the network
 *                    failed, the shape did not parse. **Nothing is known**, and a page must not
 *                    imply an empty list.
 *   `not-found`    — the thing named does not exist, asked by somebody who was allowed to ask.
 */
export type AdminFailure =
  | { status: 'unauthorised' }
  | { status: 'unavailable'; error: string }
  | { status: 'not-found' };

export type AdminResult<T> = ({ status: 'ok' } & T) | AdminFailure;

/**
 * PostgREST's answer, turned into one of the three failures or handed on.
 *
 * **The error string can carry a code and a message and nothing else.** These functions raise
 * nothing that carries a row, so there is no path by which a person's details reach a log
 * through here — which is the property the whole surface depends on.
 */
function readEnvelope(
  data: unknown,
  error: { code?: string | null; message: string } | null,
  label: string,
): { ok: true; value: Record<string, unknown> } | AdminFailure {
  if (error) {
    return {
      status: 'unavailable',
      error: `${error.code ?? 'unknown'}: ${error.message}`,
    };
  }

  const envelope = z
    .object({ ok: z.boolean(), reason: z.string().optional() })
    .safeParse(data);

  if (!envelope.success) {
    return { status: 'unavailable', error: `${label} returned an unexpected shape` };
  }

  if (!envelope.data.ok) {
    return envelope.data.reason === 'unauthorised'
      ? { status: 'unauthorised' }
      : { status: 'not-found' };
  }

  return { ok: true, value: data as Record<string, unknown> };
}

/**
 * Make the call, turn a refusal into a failure, and hand the envelope to whoever knows its
 * shape.
 *
 * **This exists because there are two doors into each of these four reads and only one room
 * behind them** — the key path, and #57's `nn-admin` role path. The database extracted the
 * read itself into a helper granted to nobody so that the two could not come to disagree; this
 * is the same move one layer up. Whichever function answered, the shape it answered with is
 * parsed by exactly one piece of code.
 *
 * `label` is the database function's own name, so an "unexpected shape" error names the
 * function that actually returned it rather than whichever door was fashionable.
 */
async function callAndParse<T>(
  label: string,
  call: () => PromiseLike<{
    data: unknown;
    error: { code?: string | null; message: string } | null;
  }>,
  parse: (value: Record<string, unknown>, label: string) => AdminResult<T>,
): Promise<AdminResult<T>> {
  try {
    const { data, error } = await call();

    const envelope = readEnvelope(data, error, label);
    if (!('ok' in envelope)) {
      return envelope;
    }

    return parse(envelope.value, label);
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

// -----------------------------------------------------------------------------------------
// Signing in
// -----------------------------------------------------------------------------------------

const signInShape = z.object({ ok: z.literal(true), name: z.string().min(1) });

/**
 * Check the Worker's key and the person's own key, and learn which handle it belongs to.
 *
 * **The person's key goes no further than this call.** It is not stored, not cached and not put
 * in the cookie the Worker mints afterwards — that carries the handle and an expiry, signed, and
 * nothing that would open the door a second time if it leaked.
 *
 * `refused` and `not-found` collapse into one answer for the caller, because the page must read
 * identically whether the key was mistyped, revoked or never existed.
 */
export async function adminSignIn(
  client: AnonClient,
  key: string,
  personKey: string,
): Promise<AdminResult<{ name: string }>> {
  try {
    const { data, error } = await client.schema('entries').rpc('admin_sign_in', {
      p_key: key,
      p_person_key: personKey,
    });

    const envelope = readEnvelope(data, error, 'admin_sign_in');
    if (!('ok' in envelope)) {
      return envelope;
    }

    const parsed = signInShape.safeParse(envelope.value);

    return parsed.success
      ? { status: 'ok', name: parsed.data.name }
      : { status: 'unavailable', error: 'admin_sign_in returned an unexpected shape' };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

// -----------------------------------------------------------------------------------------
// The entries for one event
// -----------------------------------------------------------------------------------------

/** Every status a purchase can be in, as the table's own check constraint spells them. */
export const ENTRY_STATUSES = ['paid', 'pending', 'expired', 'refunded'] as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export interface AdminEntry {
  /**
   * **Null for a cancelled entry, and that is the whole of #116.** `entries.cancel_entry()`
   * deletes the entrants — deliberately, so the club stops holding personal data for a race
   * somebody is not running — and `read_entry_list()` left joins them, so a refunded purchase
   * arrives here as a row with no runner on it.
   *
   * The row is the **purchase**: it is what has a status, an amount and a Stripe reference.
   * The runner is a fact about it that a refund legitimately removes, exactly as
   * `entries.my_entries()` has always reported it to `/account/entries/`.
   */
  entrantId: string | null;
  purchaseId: string;
  firstName: string | null;
  lastName: string | null;
  club: string | null;
  /**
   * Completed years at the event date, computed in Postgres by the same expression
   * `create_pending_purchase()` enforces the minimum age with. **The date of birth it came from
   * never leaves the database** — see the migration.
   *
   * Null alongside the name for a cancelled entry: it was derived from a date of birth that
   * was deleted with the entrant.
   */
  age: number | null;
  /** The race category — what the results and the prize list are grouped by. */
  gender: (typeof NN_ENTRY_GENDERS)[number] | null;
  /**
   * How this runner described their gender, or null because they did not say — which is most
   * of them, and is an answer rather than a gap. Shown here and nowhere else: it is not on the
   * start list, not in an export, and not on any page a runner or a spectator can reach.
   * Collecting it and never surfacing it would be collecting it for no purpose; surfacing it
   * any wider would out somebody. See ADR-020.
   */
  genderIdentity: string | null;
  /**
   * Which of the people on this purchase the row is, or null for a cancelled entry.
   *
   * **`amountPence` below belongs to the purchase, not to this row.** A visually impaired
   * runner and their guide are two rows of one entry, so rendering the amount on both would
   * show £20.00 twice while the figures panel — which sums over purchases — showed £20. The
   * page reads this to render the amount against the runner and the guide's row as the free
   * place it is.
   */
  role: 'runner' | 'guide' | null;
  /**
   * The discount code this entry was bought with, or null — which is most of them.
   *
   * Shown so a volunteer can see who used the Left Handed Giant allocation without cross-referencing
   * anything. It is the code itself rather than an id, because an id means nothing to the
   * person reading the page.
   */
  discountCode: string | null;
  eaNumber: string | null;
  feeCode: string;
  feeLabel: string;
  requiresEaNumber: boolean;
  amountPence: number;
  status: EntryStatus;
  /** Non-null means somebody has to look at this row. `over_capacity` is the loud one. */
  attention: string | null;
  attentionResolved: boolean;
  /**
   * What the entrant has asked the club to do with this entry, or null.
   *
   * **A request, not a status.** A paid entry carrying a cancellation request is still paid and
   * still holds a place, and stays that way until a volunteer acts on it — which is why this is
   * its own field rather than a fifth `status`, invisible to the capacity predicate.
   */
  requestedAction: 'cancel' | 'transfer' | null;
  /**
   * Why they asked, in their own words, or null because they did not say.
   *
   * **Read here and nowhere else.** It is not on the start list, not in any export and never
   * published — a free-text box is where somebody writes a medical fact without meaning to, and
   * a document read by marshals is the wrong place for that to surface.
   */
  requestReason: string | null;
  requestResolved: boolean;
  /** Whether a medical note exists. **Never the note** — that is its own audited read. */
  hasMedical: boolean;
  createdAt: string;
  paidAt: string | null;
  /**
   * When this purchase's hold runs out, if it has one.
   *
   * **`status` alone cannot tell a live hold from a lapsed one** — a `pending` row stays `pending`
   * until the five-minute sweep reaches it — and the difference is "somebody is paying right now"
   * against "this place is about to come back". `null` when the database predates the figures
   * migration, which reads the same as a purchase with no hold: the page says "Held" and stops
   * short of claiming a time.
   */
  holdExpiresAt: string | null;
  /** The payment arrived after the hold had lapsed. */
  revived: boolean;
}

/**
 * The figures the page **states**, as opposed to the rows it lists.
 *
 * ## Why these are one block rather than a dozen optional fields
 *
 * They arrive together, from one `create or replace` in
 * `20260818120000_entries_admin_figures.sql`, so the only two states worth modelling are "the
 * migration has landed" and "it has not". A dozen separately-optional numbers would let a caller
 * render eleven figures and a hole, which is a panel that looks complete and is not.
 *
 * ## Why the absent case is `null` and never `0`
 *
 * **`0` and "this database cannot tell me yet" are opposite claims that look identical.** "No
 * entrant has written a medical note" is a reason not to print the sheet; "the function predates
 * this Worker" is a reason to go and look another way. Nothing sequences a migration against the
 * Cloudflare deploy, so the Worker-first ordering is real and this is the field that survives it.
 *
 * ## Every count here is over **every** purchase, uncapped
 *
 * `AdminEntryList.entries` is capped at the most recent 2,000 — abandoned holds are unbounded
 * because `create_pending_purchase()` is granted to anon. So these are asked of the database
 * rather than counted off the array, and the two must never be mixed on one panel: a `paid`
 * figure over all rows beside a `holds returned` figure over the newest 2,000 would disagree on a
 * busy race, and somebody sets out bibs from them.
 */
export interface AdminEventFigures {
  /** **Null for Nightingale Nightmare today** — the club has not decided. Never invented. */
  entriesOpenAt: string | null;
  entriesCloseAt: string | null;
  paid: number;
  /** Paid, flagged `over_capacity`, unresolved. A subset of `paid` — there is no fifth status. */
  overCapacity: number;
  /** Pending with a hold that has **not** run out. Not `count(status = 'pending')`. */
  held: number;
  /** Places that came back: marked `expired`, or pending with a lapsed hold the sweep has not
   * reached. This is what explains a `taken` figure going *down*. */
  holdsReturned: number;
  refunded: number;
  /** Paid only. Not net of Stripe's card fees, and the page says so. */
  feesPence: number;
  /** How many paid entrants wrote something. **A count, never a note.** */
  medicalCount: number;
  affiliated: number;
  /**
   * Claimed a fee requiring an England Athletics number, and gave none.
   *
   * **Reachable, and not by a legacy row.** `nn-entry.ts` requires the number, but that is the
   * form's control — `create_pending_purchase()` writes `ea_number` through unchecked and is
   * granted to anon. See the migration header.
   */
  affiliatedMissingEa: number;
  /** The interval the deletion job enforces, as Postgres renders it (`1 mon`). */
  medicalRetention: string;
  /**
   * `event_date + medical_retention`, as a civil date.
   *
   * **The mechanism, not the published sentence.** `race.json`'s `privacy.medicalRetention` is
   * what `/nn/privacy/` promises; this is what actually deletes. A page that told a volunteer a
   * date derived from the promise would be reading the wrong one of the two.
   */
  medicalDeleteAfter: string;
}

export interface AdminEntryEvent {
  slug: string;
  displayName: string;
  eventDate: string;
  capacity: number;
  /** Places held right now, by the capacity predicate rather than by counting paid rows. */
  taken: number;
  /** Purchases flagged for a human and not yet resolved. */
  attention: number;
  /** `null` when the database predates the figures migration. **Never a block of zeroes.** */
  figures: AdminEventFigures | null;
}

/**
 * One discount code on the event, and how much of it has gone.
 *
 * **This is the only place a code can be read.** It is minted by a migration and deliberately
 * never written into the repository, which is public — so `/admin/nn/` is how somebody finds
 * out what to tell the club it belongs to.
 */
export interface AdminDiscountCode {
  code: string;
  percentOff: number;
  /** Null means unlimited. 22 for the Left Handed Giant allocation. */
  maxUses: number | null;
  /**
   * How many are gone **right now**, which goes down as well as up: a lapsed hold and a refund
   * each give one back. A number that looks wrong mid-rush is probably a hold that has not
   * expired yet.
   */
  uses: number;
  active: boolean;
  /** Which fee it applies to, or null for any. "10% off an unaffiliated entry" is two facts. */
  feeCode: string | null;
}

export interface AdminEntryList {
  event: AdminEntryEvent;
  /** Every code on this event. Empty until one is minted. */
  discountCodes: AdminDiscountCode[];
  /** Every entrant against this event, whatever their status. */
  entries: AdminEntry[];
  /** How many there really are. Differs from `entries.length` only if the cap bit. */
  total: number;
  returned: number;
}

const entryShape = z.object({
  // **Every runner column is nullable, because a cancelled entry has no runner.** See
  // `AdminEntry` above and the `20260827091000` migration. `age` and `gender` go with the
  // name: they are derived from a `date_of_birth` that was deleted with the entrant, so a
  // non-null shape here would refuse to parse the very rows the Refunded filter exists for.
  entrant_id: z.uuid().nullable(),
  purchase_id: z.uuid(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  club: z.string().nullable(),
  age: z.number().int().nullable(),
  gender: z.enum(NN_ENTRY_GENDERS).nullable(),
  // `.catch` for the same reason every optional field on this shape has one: a Worker deployed
  // ahead of its migration renders the row rather than refusing the page.
  gender_identity: z.string().nullable().catch(null),
  // Same `.catch` reasoning: a Worker deployed ahead of its migration finds no `role` and
  // renders every row as a runner, which is what every row was before guides existed.
  role: z.enum(['runner', 'guide']).nullable().catch(null),
  // Same `.catch` reasoning as every optional field here: a Worker deployed ahead of its
  // migration renders the row rather than refusing the page.
  discount_code: z.string().nullable().catch(null),
  ea_number: z.string().nullable(),
  fee_code: z.string(),
  fee_label: z.string(),
  requires_ea_number: z.boolean(),
  amount_pence: z.number().int(),
  // **`.catch` rather than a hard failure.** Nothing sequences a migration against the deploy,
  // so a fifth status added one day must degrade to a row that renders rather than to a page
  // that will not. `pending` is the honest fallback: it claims nothing and looks unfinished.
  status: z.enum(ENTRY_STATUSES).catch('pending'),
  attention: z.string().nullable(),
  attention_resolved: z.boolean(),
  // Same `.catch` reasoning as every optional field on this shape: a Worker deployed ahead of
  // its migration renders the row rather than refusing the page.
  requested_action: z.enum(['cancel', 'transfer']).nullable().catch(null),
  request_reason: z.string().nullable().catch(null),
  request_resolved: z.boolean().catch(false),
  has_medical: z.boolean(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  // Absent on a database that predates the figures migration, which must degrade to a row that
  // renders rather than to a page that will not.
  hold_expires_at: z.string().nullable().optional(),
  revived: z.boolean(),
});

const entryListShape = z.object({
  ok: z.literal(true),
  event: z.object({
    slug: z.string().min(1),
    display_name: z.string().min(1),
    event_date: z.string(),
    capacity: z.number().int().positive(),
    taken: z.number().int().min(0),
    attention: z.number().int().min(0),
  }),
  total: z.number().int().min(0),
  returned: z.number().int().min(0),
  entries: z.array(entryShape),
  // `.catch([])` rather than a hard failure, for the reason every optional field here has one:
  // a Worker deployed ahead of its migration renders the page without the panel rather than
  // refusing to render the entries at all.
  discount_codes: z
    .array(
      z.object({
        code: z.string().min(1),
        percent_off: z.number().int(),
        max_uses: z.number().int().nullable(),
        uses: z.number().int().min(0),
        active: z.boolean(),
        fee_code: z.string().nullable(),
      }),
    )
    .catch([]),
});

/**
 * The figures block, parsed **separately from the same raw event object**.
 *
 * Two passes over one object rather than a dozen `.optional()` keys on the shape above, because
 * the two questions are genuinely different: the first pass decides whether this is an entry list
 * at all — a failure there is a page that must not render — and the second decides whether this
 * database can answer the figures yet, where a failure is one panel saying so.
 *
 * `z.object` strips keys it was not told about, which is why this cannot read them off
 * `entryListShape`'s output and has to be handed the raw value.
 */
const figuresShape = z.object({
  entries_open_at: z.string().nullable(),
  entries_close_at: z.string().nullable(),
  paid: z.number().int().min(0),
  over_capacity: z.number().int().min(0),
  held: z.number().int().min(0),
  holds_returned: z.number().int().min(0),
  refunded: z.number().int().min(0),
  fees_pence: z.number().int().min(0),
  medical_count: z.number().int().min(0),
  affiliated: z.number().int().min(0),
  affiliated_missing_ea: z.number().int().min(0),
  medical_retention: z.string().min(1),
  medical_delete_after: z.string().min(1),
});

/** The figures, or `null` if this database predates the migration that added them. */
function readFigures(rawEvent: unknown): AdminEventFigures | null {
  const parsed = figuresShape.safeParse(rawEvent);

  if (!parsed.success) {
    return null;
  }

  return {
    entriesOpenAt: parsed.data.entries_open_at,
    entriesCloseAt: parsed.data.entries_close_at,
    paid: parsed.data.paid,
    overCapacity: parsed.data.over_capacity,
    held: parsed.data.held,
    holdsReturned: parsed.data.holds_returned,
    refunded: parsed.data.refunded,
    feesPence: parsed.data.fees_pence,
    medicalCount: parsed.data.medical_count,
    affiliated: parsed.data.affiliated,
    affiliatedMissingEa: parsed.data.affiliated_missing_ea,
    medicalRetention: parsed.data.medical_retention,
    medicalDeleteAfter: parsed.data.medical_delete_after,
  };
}

function parseEntryList(
  value: Record<string, unknown>,
  label: string,
): AdminResult<AdminEntryList> {
  const parsed = entryListShape.safeParse(value);

  if (!parsed.success) {
    return { status: 'unavailable', error: `${label} returned an unexpected shape` };
  }

  return {
    status: 'ok',
    event: {
      slug: parsed.data.event.slug,
      displayName: parsed.data.event.display_name,
      eventDate: parsed.data.event.event_date,
      capacity: parsed.data.event.capacity,
      taken: parsed.data.event.taken,
      attention: parsed.data.event.attention,
      figures: readFigures((value as { event?: unknown }).event),
    },
    discountCodes: parsed.data.discount_codes.map((code) => ({
      code: code.code,
      percentOff: code.percent_off,
      maxUses: code.max_uses,
      uses: code.uses,
      active: code.active,
      feeCode: code.fee_code,
    })),
    total: parsed.data.total,
    returned: parsed.data.returned,
    entries: parsed.data.entries.map((entry) => ({
      entrantId: entry.entrant_id,
      purchaseId: entry.purchase_id,
      firstName: entry.first_name,
      lastName: entry.last_name,
      club: entry.club,
      age: entry.age,
      gender: entry.gender,
      genderIdentity: entry.gender_identity,
      role: entry.role,
      discountCode: entry.discount_code,
      eaNumber: entry.ea_number,
      feeCode: entry.fee_code,
      feeLabel: entry.fee_label,
      requiresEaNumber: entry.requires_ea_number,
      amountPence: entry.amount_pence,
      status: entry.status,
      attention: entry.attention,
      attentionResolved: entry.attention_resolved,
      requestedAction: entry.requested_action,
      requestReason: entry.request_reason,
      requestResolved: entry.request_resolved,
      hasMedical: entry.has_medical,
      createdAt: entry.created_at,
      paidAt: entry.paid_at,
      holdExpiresAt: entry.hold_expires_at ?? null,
      revived: entry.revived,
    })),
  };
}

export async function fetchAdminEntryList(
  client: AnonClient,
  key: string,
  eventSlug: string,
): Promise<AdminResult<AdminEntryList>> {
  return callAndParse(
    'admin_entry_list',
    () =>
      client
        .schema('entries')
        .rpc('admin_entry_list', { p_key: key, p_event_slug: eventSlug }),
    parseEntryList,
  );
}

/** The same list, for a signed-in caller holding `nn-admin`. No key, and no actor. */
export async function fetchEntryList(
  client: UserClient,
  eventSlug: string,
): Promise<AdminResult<AdminEntryList>> {
  return callAndParse(
    'entry_list',
    () => client.schema('entries').rpc('entry_list', { p_event_slug: eventSlug }),
    parseEntryList,
  );
}

// -----------------------------------------------------------------------------------------
// The interest list
// -----------------------------------------------------------------------------------------

export interface AdminInterest {
  id: string;
  name: string;
  email: string;
  /** **Shown, never filtered on.** A row with this false is one the club must not write to. */
  consent: boolean;
  createdAt: string;
}

export interface AdminInterestList {
  interest: AdminInterest[];
  total: number;
  returned: number;
  consented: number;
}

const interestListShape = z.object({
  ok: z.literal(true),
  total: z.number().int().min(0),
  returned: z.number().int().min(0),
  consented: z.number().int().min(0),
  interest: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      consent: z.boolean(),
      created_at: z.string(),
    }),
  ),
});

function parseInterestList(
  value: Record<string, unknown>,
  label: string,
): AdminResult<AdminInterestList> {
  const parsed = interestListShape.safeParse(value);

  if (!parsed.success) {
    return { status: 'unavailable', error: `${label} returned an unexpected shape` };
  }

  return {
    status: 'ok',
    total: parsed.data.total,
    returned: parsed.data.returned,
    consented: parsed.data.consented,
    interest: parsed.data.interest.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      consent: row.consent,
      createdAt: row.created_at,
    })),
  };
}

export async function fetchAdminInterestList(
  client: AnonClient,
  key: string,
): Promise<AdminResult<AdminInterestList>> {
  return callAndParse(
    'admin_interest_list',
    () => client.schema('entries').rpc('admin_interest_list', { p_key: key }),
    parseInterestList,
  );
}

/** The same list, for a signed-in caller holding `nn-admin`. */
export async function fetchInterestList(
  client: UserClient,
): Promise<AdminResult<AdminInterestList>> {
  return callAndParse(
    'interest_list',
    () => client.schema('entries').rpc('interest_list'),
    parseInterestList,
  );
}

// -----------------------------------------------------------------------------------------
// One medical note
// -----------------------------------------------------------------------------------------

export interface AdminMedicalNote {
  entrantId: string;
  eventSlug: string;
  firstName: string;
  lastName: string;
  club: string | null;
  /**
   * `null` means there is no note — either none was written, or the separate medical consent
   * was withheld and nothing was ever stored. The two are the same absence by design.
   */
  notes: string | null;
}

const medicalShape = z.object({
  ok: z.literal(true),
  entrant_id: z.uuid(),
  event_slug: z.string().min(1),
  first_name: z.string(),
  last_name: z.string(),
  club: z.string().nullable(),
  notes: z.string().nullable(),
});

/**
 * Read one entrant's medical note.
 *
 * **The audit row is written by the database, in the same transaction**, so there is no
 * ordering in which this returns a note and nothing records that it did. `actor` is the handle
 * out of the Worker's own signed cookie.
 */
function parseMedicalNote(
  value: Record<string, unknown>,
  label: string,
): AdminResult<AdminMedicalNote> {
  const parsed = medicalShape.safeParse(value);

  if (!parsed.success) {
    return { status: 'unavailable', error: `${label} returned an unexpected shape` };
  }

  return {
    status: 'ok',
    entrantId: parsed.data.entrant_id,
    eventSlug: parsed.data.event_slug,
    firstName: parsed.data.first_name,
    lastName: parsed.data.last_name,
    club: parsed.data.club,
    notes: parsed.data.notes,
  };
}

export async function fetchAdminMedicalNote(
  client: AnonClient,
  key: string,
  actor: string,
  entrantId: string,
): Promise<AdminResult<AdminMedicalNote>> {
  return callAndParse(
    'admin_entrant_medical',
    () =>
      client.schema('entries').rpc('admin_entrant_medical', {
        p_key: key,
        p_actor: actor,
        p_entrant_id: entrantId,
      }),
    parseMedicalNote,
  );
}

/**
 * The same note, for a signed-in caller holding `nn-admin`.
 *
 * **There is no `actor` to pass, and that is the improvement rather than the omission.** The
 * database reads `auth.uid()` itself, so the audit row names the subject of a token GoTrue
 * issued rather than a handle this Worker asserted from a cookie it signed. See ADR-013 on why
 * that column is a pseudonym either way.
 */
export async function fetchMedicalNote(
  client: UserClient,
  entrantId: string,
): Promise<AdminResult<AdminMedicalNote>> {
  return callAndParse(
    'entrant_medical',
    () => client.schema('entries').rpc('entrant_medical', { p_entrant_id: entrantId }),
    parseMedicalNote,
  );
}

// -----------------------------------------------------------------------------------------
// The three exports
// -----------------------------------------------------------------------------------------

/**
 * What each export is for, and it is the reason each is separate.
 *
 *   `ea`          the £2 England Athletics check. Numbers and names, no contact details.
 *   `start-list`  race day. Categories and **emergency contacts**, which are needed at the
 *                 finish line and nowhere else.
 *   `medical`     special category data, on its own, taken on purpose.
 */
export const EXPORT_KINDS = ['ea', 'start-list', 'medical'] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(value);
}

export interface AdminExportEvent {
  slug: string;
  displayName: string;
  eventDate: string;
}

export interface EaExportRow {
  lastName: string;
  firstName: string;
  club: string | null;
  eaNumber: string | null;
  feeLabel: string;
  amountPence: number;
}

export interface StartListExportRow {
  lastName: string;
  firstName: string;
  club: string | null;
  age: number;
  gender: (typeof NN_ENTRY_GENDERS)[number];
  /**
   * `guide` for somebody running with a visually impaired entrant, `runner` for everybody
   * else — and null only from a database that predates guides.
   *
   * **A guide is on the start list and is marked on it.** They are on the road, so a marshal
   * has to be able to account for them; they are not being timed and are in no age category,
   * so a row that looks like every other row is misleading in the one document nobody has
   * time to read carefully.
   */
  role: 'runner' | 'guide' | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

export interface MedicalExportRow {
  lastName: string;
  firstName: string;
  club: string | null;
  notes: string;
}

export type AdminExport =
  | { kind: 'ea'; event: AdminExportEvent; rows: EaExportRow[] }
  | { kind: 'start-list'; event: AdminExportEvent; rows: StartListExportRow[] }
  | { kind: 'medical'; event: AdminExportEvent; rows: MedicalExportRow[] };

const exportEventShape = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  event_date: z.string(),
});

const eaRowShape = z.object({
  last_name: z.string(),
  first_name: z.string(),
  club: z.string().nullable(),
  ea_number: z.string().nullable(),
  fee_label: z.string(),
  amount_pence: z.number().int(),
});

const startListRowShape = z.object({
  last_name: z.string(),
  first_name: z.string(),
  club: z.string().nullable(),
  age: z.number().int(),
  gender: z.enum(NN_ENTRY_GENDERS),
  // `.catch` for the reason every optional field here has one: a Worker deployed ahead of its
  // migration prints the sheet rather than refusing it.
  role: z.enum(['runner', 'guide']).nullable().catch(null),
  emergency_contact_name: z.string(),
  emergency_contact_phone: z.string(),
});

const medicalRowShape = z.object({
  last_name: z.string(),
  first_name: z.string(),
  club: z.string().nullable(),
  notes: z.string(),
});

/**
 * Take one export, and record that it was taken.
 *
 * **The row shape is decided by the database, not chosen here.** Asking for a start list does
 * not hand this Worker a medical note to discard — the note is never selected. That is
 * minimisation at the boundary applied to a read, and it is the reason `p_kind` is an argument
 * to the function rather than a filter in this file.
 */
function parseExport(
  value: Record<string, unknown>,
  label: string,
): AdminResult<{ export: AdminExport }> {
  const outer = z
    .object({
      ok: z.literal(true),
      kind: z.enum(EXPORT_KINDS),
      event: exportEventShape,
    })
    .safeParse(value);

  if (!outer.success) {
    return { status: 'unavailable', error: `${label} returned an unexpected shape` };
  }

  const event: AdminExportEvent = {
    slug: outer.data.event.slug,
    displayName: outer.data.event.display_name,
    eventDate: outer.data.event.event_date,
  };

  const rows = (value as { rows?: unknown }).rows;

  if (outer.data.kind === 'ea') {
    const parsed = z.array(eaRowShape).safeParse(rows);
    return parsed.success
      ? {
          status: 'ok',
          export: {
            kind: 'ea',
            event,
            rows: parsed.data.map((row) => ({
              lastName: row.last_name,
              firstName: row.first_name,
              club: row.club,
              eaNumber: row.ea_number,
              feeLabel: row.fee_label,
              amountPence: row.amount_pence,
            })),
          },
        }
      : { status: 'unavailable', error: `${label} returned an unexpected ea row` };
  }

  if (outer.data.kind === 'start-list') {
    const parsed = z.array(startListRowShape).safeParse(rows);
    return parsed.success
      ? {
          status: 'ok',
          export: {
            kind: 'start-list',
            event,
            rows: parsed.data.map((row) => ({
              lastName: row.last_name,
              firstName: row.first_name,
              club: row.club,
              age: row.age,
              gender: row.gender,
              role: row.role,
              emergencyContactName: row.emergency_contact_name,
              emergencyContactPhone: row.emergency_contact_phone,
            })),
          },
        }
      : {
          status: 'unavailable',
          error: `${label} returned an unexpected start-list row`,
        };
  }

  const parsed = z.array(medicalRowShape).safeParse(rows);
  return parsed.success
    ? {
        status: 'ok',
        export: {
          kind: 'medical',
          event,
          rows: parsed.data.map((row) => ({
            lastName: row.last_name,
            firstName: row.first_name,
            club: row.club,
            notes: row.notes,
          })),
        },
      }
    : { status: 'unavailable', error: `${label} returned an unexpected medical row` };
}

export async function fetchAdminExport(
  client: AnonClient,
  key: string,
  actor: string,
  eventSlug: string,
  kind: ExportKind,
): Promise<AdminResult<{ export: AdminExport }>> {
  return callAndParse(
    'admin_export',
    () =>
      client.schema('entries').rpc('admin_export', {
        p_key: key,
        p_actor: actor,
        p_event_slug: eventSlug,
        p_kind: kind,
      }),
    parseExport,
  );
}

/**
 * The same file, for a signed-in caller holding `nn-admin`.
 *
 * `p_kind` is still an argument to the database function rather than a filter here, for the
 * reason the key path's docstring gives: an export that is not about medical notes must never
 * carry one to this Worker in the first place.
 */
export async function fetchExport(
  client: UserClient,
  eventSlug: string,
  kind: ExportKind,
): Promise<AdminResult<{ export: AdminExport }>> {
  return callAndParse(
    'export',
    () =>
      client.schema('entries').rpc('export', { p_event_slug: eventSlug, p_kind: kind }),
    parseExport,
  );
}

// -----------------------------------------------------------------------------------------
// The retention sweep
// -----------------------------------------------------------------------------------------

export interface MedicalRetentionSweep {
  /** Medical notes deleted on this run. Zero on all but a handful of days a year. */
  deleted: number;
  /** How many events they belonged to, so a log line says whether it was one race or four. */
  events: number;
}

/**
 * Delete the medical notes the club has published a promise to delete.
 *
 * Called by the five-minute cron alongside the hold sweep, and safe to call as often as that:
 * on every run but a handful a year it deletes nothing and returns zero. **A count and nothing
 * else comes back** — these are the rows the whole retention rule is about.
 */
export async function deleteExpiredMedicalNotes(
  client: AnonClient,
): Promise<({ ok: true } & MedicalRetentionSweep) | { ok: false; error: string }> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('delete_expired_medical_notes');

    if (error) {
      return { ok: false, error: `${error.code ?? 'unknown'}: ${error.message}` };
    }

    const parsed = z
      .object({
        deleted: z.number().int().min(0),
        events: z.number().int().min(0).catch(0),
      })
      .safeParse(data);

    return parsed.success
      ? { ok: true, deleted: parsed.data.deleted, events: parsed.data.events }
      : { ok: false, error: 'delete_expired_medical_notes returned an unexpected shape' };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.name : 'unknown' };
  }
}

// -----------------------------------------------------------------------------------------
// Cancelling an entry
// -----------------------------------------------------------------------------------------

/**
 * Cancelling is two calls, and the order between them is the decision.
 *
 * `entries.cancellable_purchase()` says what there is to refund; the Worker refunds it
 * through Stripe; `entries.cancel_entry()` then records it, deletes the entrant and returns
 * the place. **Stripe first, the record second**, because that ordering is the one a retry
 * repairs: the refund is idempotent on the purchase id, so running the whole thing again
 * after a failed second half returns the same refund and completes the record. The other
 * ordering leaves a cancelled entry the club has kept the money for, with nothing on the row
 * saying a refund is owed.
 *
 * @see docs/architecture/decisions/adr-018-cancelling-an-entry.md
 */

export interface CancellablePurchase {
  /** **`purchaseStatus`, not `status`.** The result wrapper below already spends `status` on
   *  its own discriminant, and a second one of a different type would intersect to `never` —
   *  a type error that reads as though the parse were wrong rather than the naming. */
  purchaseStatus: EntryStatus;
  amountPence: number;
  /** Null for a purchase that never reached a card — a `pending` hold, or an `expired` one.
   *  The Worker skips the refund entirely for those: there is nothing to send back. */
  paymentIntentId: string | null;
}

/**
 * `already-cancelled` is its own outcome rather than a failure.
 *
 * `readEnvelope` collapses every reason but `unauthorised` into `not-found`, which is right
 * for the reads — a volunteer asking about an entry that is not there and one asking about an
 * entry they may not see should get the same answer. It is wrong here: pressing the button
 * twice is an ordinary thing to do, and "that does not exist" is a lie about what happened.
 */
export type CancelResult<T> =
  | ({ status: 'ok' } & T)
  | { status: 'already-cancelled' }
  /**
   * The fee this place was bought on requires an England Athletics number and the transfer
   * form did not carry one.
   *
   * **Its own outcome for the same reason `already-cancelled` is.** Collapsed into `not-found`
   * it is indistinguishable from "that entry does not exist" — and before it existed at all the
   * refusal arrived as a raised `check_violation` that `readCancelEnvelope` could only report
   * as `unavailable`, so every affiliated transfer told a volunteer the database was down.
   */
  | { status: 'ea-number-required' }
  | AdminFailure;

function readCancelEnvelope<T>(
  data: unknown,
  error: { code?: string | null; message: string } | null,
  label: string,
  parse: (value: Record<string, unknown>) => CancelResult<T>,
): CancelResult<T> {
  if (error) {
    return {
      status: 'unavailable',
      error: `${error.code ?? 'unknown'}: ${error.message}`,
    };
  }

  const envelope = z
    .object({ ok: z.boolean(), reason: z.string().optional() })
    .safeParse(data);

  if (!envelope.success) {
    return { status: 'unavailable', error: `${label} returned an unexpected shape` };
  }

  if (!envelope.data.ok) {
    if (envelope.data.reason === 'unauthorised') {
      return { status: 'unauthorised' };
    }

    if (envelope.data.reason === 'already_cancelled') {
      return { status: 'already-cancelled' };
    }

    if (envelope.data.reason === 'ea_number_required') {
      return { status: 'ea-number-required' };
    }

    return { status: 'not-found' };
  }

  return parse(data as Record<string, unknown>);
}

const cancellableShape = z.object({
  status: z.enum(ENTRY_STATUSES),
  amount_pence: z.number().int().min(0),
  payment_intent_id: z.string().nullable(),
});

/** What there is to refund, before anything is changed. */
export async function fetchCancellablePurchase(
  client: UserClient,
  purchaseId: string,
): Promise<CancelResult<CancellablePurchase>> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('cancellable_purchase', { p_purchase_id: purchaseId });

    return readCancelEnvelope(data, error, 'cancellable_purchase', (value) => {
      const parsed = cancellableShape.safeParse(value);

      return parsed.success
        ? {
            status: 'ok',
            purchaseStatus: parsed.data.status,
            amountPence: parsed.data.amount_pence,
            paymentIntentId: parsed.data.payment_intent_id,
          }
        : {
            status: 'unavailable',
            error: 'cancellable_purchase returned an unexpected shape',
          };
    });
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

export interface CancelledEntry {
  /** True when the purchase was already `refunded` — a retry, not an error. */
  already: boolean;
  entrantsDeleted: number;
}

/**
 * Record the cancellation: audit it, delete the entrant and their medical note, and move the
 * purchase to `refunded` so the place returns to capacity.
 *
 * `refundReference` is Stripe's refund id when there was one to make, and null for a purchase
 * that never reached a card. It goes into the audit detail rather than onto the purchase row:
 * the row already carries the payment intent, and a refund id is a fact about what a person
 * did on a particular day, which is exactly what the audit trail is for.
 */
/** The new runner, as the transfer form collects them. */
export interface TransferTo {
  email: string;
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`, already validated by the form. */
  dateOfBirth: string;
  gender: (typeof NN_ENTRY_GENDERS)[number];
  club: string | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
  /**
   * **The new runner's own number, never the previous runner's.**
   *
   * Null when they did not give one, which the function refuses with `ea_number_required` if the
   * fee this place was bought on needs one, and drops if it does not. The Worker cannot decide
   * that for itself — the transfer form does not know which fee the purchase was on, and the fee
   * is read from the purchase rather than from anything the caller passes.
   */
  eaNumber: string | null;
}

export interface TransferredEntry {
  status: 'ok';
  /** Who the place belonged to before, for the sentence the outcome page shows. */
  previousRunner: string;
}

/**
 * Move one paid entry to a different runner.
 *
 * **No money moves.** The purchase keeps its amount and its Stripe references, and the place
 * never returns to the pool — which is the difference between this and cancelling, and the
 * reason a transfer cannot be taken by somebody else in between.
 *
 * Every rule that matters is re-applied inside `entries.transfer_entry()` rather than here: the
 * permission, the minimum age, and one-runner-one-place. This is the form's control; that is
 * the system's.
 */
export async function transferEntry(
  client: UserClient,
  purchaseId: string,
  to: TransferTo,
): Promise<CancelResult<TransferredEntry>> {
  try {
    const { data, error } = await client.schema('entries').rpc('transfer_entry', {
      p_purchase_id: purchaseId,
      p_email: to.email,
      p_first_name: to.firstName,
      p_last_name: to.lastName,
      p_date_of_birth: to.dateOfBirth,
      p_gender: to.gender,
      // **Empty string rather than null.** `p_club` has no SQL default, so the generated type
      // makes it required and non-nullable; the function turns an empty string back into null
      // with `nullif(btrim(coalesce(...)))`, which is where "no club" belongs anyway.
      p_club: to.club ?? '',
      p_emergency_contact_name: to.emergencyContactName,
      p_emergency_contact_phone: to.emergencyContactPhone,
      // Empty string rather than null, for the reason `p_club` above gives: the generated
      // argument type is required and non-nullable, and the function turns an empty string back
      // into null with `nullif(btrim(coalesce(...)))`.
      p_ea_number: to.eaNumber ?? '',
    });

    return readCancelEnvelope(data, error, 'transfer_entry', (value) => {
      const parsed = z
        .object({ previous_runner: z.string().nullable().catch(null) })
        .safeParse(value);

      return parsed.success
        ? {
            status: 'ok',
            previousRunner: parsed.data.previous_runner ?? 'the previous runner',
          }
        : { status: 'unavailable', error: 'transfer_entry returned an unexpected shape' };
    });
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

/**
 * Why `entries.create_manual_entry()` refused, in its own words.
 *
 * **Not folded into `CancelResult`'s three, and that is the point.** `readCancelEnvelope`
 * collapses everything that is not "unauthorised" into "not found", which is right for a
 * surface where disclosing that a purchase exists is itself a disclosure. Nothing here is
 * about somebody else's record: the volunteer typed these details a moment ago and needs to
 * be told *which* rule stopped them, because "the race is full" and "this runner already has
 * a place" ask for completely different things next.
 */
export const MANUAL_ENTRY_REASONS = [
  'unauthorised',
  'no_such_event',
  'closed',
  'no_complimentary_fee',
  'sold_out',
  'invalid_entrants',
  'under_minimum_age',
  'consents_missing',
  'already_entered',
  'unknown',
] as const;

export type ManualEntryReason = (typeof MANUAL_ENTRY_REASONS)[number];

/** One person on a complimentary entry — the runner, or the guide running with them. */
export interface ManualEntrant {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`, already validated by the form. */
  dateOfBirth: string;
  gender: (typeof NN_ENTRY_GENDERS)[number];
  club: string | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

export interface ManualEntryInput {
  slug: string;
  purchaserName: string;
  purchaserEmail: string;
  runner: ManualEntrant;
  /** The person running with a visually impaired entrant. Takes a second place, pays nothing. */
  guide: ManualEntrant | null;
  /** Why this place was given. Goes to the audit trail, and is never shown to the runner. */
  reason: string | null;
}

export type ManualEntryResult =
  | { status: 'ok'; purchaseId: string; entrants: number }
  | { status: 'refused'; reason: ManualEntryReason }
  | { status: 'unavailable'; error: string };

/**
 * Assign a complimentary place: one paid purchase at £0, with its entrants.
 *
 * **No medical information travels on this path, and that is deliberate rather than an
 * omission.** The public form asks the runner and stores it under their own consent; a
 * volunteer typing somebody's medical condition into a form on their behalf is a worse
 * arrangement than that person telling the first aiders directly, and it would mean recording
 * an Article 9 consent that the person never gave. So `p_medical` is nulls, and a
 * complimentary entrant who has something to declare is told to email the club.
 *
 * `entryTerms` is ticked by the volunteer, which is why `entries.create_manual_entry()` marks
 * the stored consents `recorded_by_admin`. The agreement itself is the club's to obtain out
 * of band, before the place is given.
 *
 * Every rule that matters is re-applied inside the function rather than here: the permission,
 * capacity, the minimum age and one-runner-one-place. This is the form's control; that is the
 * system's.
 */
export async function createManualEntry(
  client: UserClient,
  input: ManualEntryInput,
): Promise<ManualEntryResult> {
  const asPayload = (person: ManualEntrant, role: 'runner' | 'guide'): Json => ({
    first_name: person.firstName,
    last_name: person.lastName,
    date_of_birth: person.dateOfBirth,
    gender: person.gender,
    gender_identity: null,
    club: person.club,
    // Never on a complimentary place: the number justifies the affiliated rebate and nothing
    // here was charged.
    ea_number: null,
    leg: null,
    emergency_contact_name: person.emergencyContactName,
    emergency_contact_phone: person.emergencyContactPhone,
    role,
  });

  const entrants: Json[] = [asPayload(input.runner, 'runner')];
  if (input.guide) {
    entrants.push(asPayload(input.guide, 'guide'));
  }

  try {
    const params = {
      p_slug: input.slug,
      p_purchaser_name: input.purchaserName,
      p_purchaser_email: input.purchaserEmail,
      p_entrants: entrants as unknown as Json,
      p_medical: entrants.map(() => null) as unknown as Json,
      p_consents: {
        entryTerms: true,
        medical: false,
        // What lets the function accept a second entrant at all.
        vi: input.guide !== null,
      } as unknown as Json,
      // Omitted rather than set to `undefined` — `p_reason` has a SQL default, so
      // `exactOptionalPropertyTypes` makes the two different types and PostgREST applies the
      // Postgres default only for an absent key. Same rule as `cancelEntry` below.
      ...(input.reason === null ? {} : { p_reason: input.reason }),
    };

    const { data, error } = await client
      .schema('entries')
      .rpc('create_manual_entry', params);

    if (error) {
      return {
        status: 'unavailable',
        error: `${error.code ?? 'unknown'}: ${error.message}`,
      };
    }

    const envelope = z
      .object({
        ok: z.boolean(),
        reason: z.enum(MANUAL_ENTRY_REASONS).catch('unknown').optional(),
        purchase_id: z.uuid().optional(),
        entrants: z.number().int().min(1).optional(),
      })
      .safeParse(data);

    if (!envelope.success) {
      return {
        status: 'unavailable',
        error: 'create_manual_entry returned an unexpected shape',
      };
    }

    if (!envelope.data.ok) {
      return { status: 'refused', reason: envelope.data.reason ?? 'unknown' };
    }

    if (envelope.data.purchase_id === undefined || envelope.data.entrants === undefined) {
      return {
        status: 'unavailable',
        error: 'create_manual_entry reported success without a purchase',
      };
    }

    return {
      status: 'ok',
      purchaseId: envelope.data.purchase_id,
      entrants: envelope.data.entrants,
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}

export async function cancelEntry(
  client: UserClient,
  purchaseId: string,
  refundReference: string | null,
): Promise<CancelResult<CancelledEntry>> {
  try {
    // **The key is omitted rather than set to `undefined`.** `p_refund_reference` has a SQL
    // default, so `supabase gen types` renders it optional — and this workspace compiles with
    // `exactOptionalPropertyTypes`, under which an optional property and one explicitly set to
    // `undefined` are different types. Building the object two ways is what satisfies both
    // that rule and PostgREST, which applies the Postgres default only for an absent key.
    const params =
      refundReference === null
        ? { p_purchase_id: purchaseId }
        : { p_purchase_id: purchaseId, p_refund_reference: refundReference };

    const { data, error } = await client.schema('entries').rpc('cancel_entry', params);

    return readCancelEnvelope(data, error, 'cancel_entry', (value) => {
      const parsed = z
        .object({
          already: z.boolean(),
          entrants_deleted: z.number().int().min(0).catch(0),
        })
        .safeParse(value);

      return parsed.success
        ? {
            status: 'ok',
            already: parsed.data.already,
            entrantsDeleted: parsed.data.entrants_deleted,
          }
        : { status: 'unavailable', error: 'cancel_entry returned an unexpected shape' };
    });
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}
