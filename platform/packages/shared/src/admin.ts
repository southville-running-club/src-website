import { z } from 'zod';
import type { AnonClient } from './supabase';
import { NN_ENTRY_GENDERS } from './nn-entry';

/**
 * Reading the admin surface, through the six functions that are the whole of it.
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
 * `supabase gen types` types all six returns as `Json`, honestly — Postgres builds them with
 * `jsonb_build_object`. Parsing with Zod means a migration that renames a key fails here, in
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
  entrantId: string;
  purchaseId: string;
  firstName: string;
  lastName: string;
  club: string | null;
  /**
   * Completed years at the event date, computed in Postgres by the same expression
   * `create_pending_purchase()` enforces the minimum age with. **The date of birth it came from
   * never leaves the database** — see the migration.
   */
  age: number;
  gender: (typeof NN_ENTRY_GENDERS)[number];
  eaNumber: string | null;
  feeCode: string;
  feeLabel: string;
  requiresEaNumber: boolean;
  amountPence: number;
  status: EntryStatus;
  /** Non-null means somebody has to look at this row. `over_capacity` is the loud one. */
  attention: string | null;
  attentionResolved: boolean;
  /** Whether a medical note exists. **Never the note** — that is its own audited read. */
  hasMedical: boolean;
  createdAt: string;
  paidAt: string | null;
  /** The payment arrived after the hold had lapsed. */
  revived: boolean;
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
}

export interface AdminEntryList {
  event: AdminEntryEvent;
  /** Every entrant against this event, whatever their status. */
  entries: AdminEntry[];
  /** How many there really are. Differs from `entries.length` only if the cap bit. */
  total: number;
  returned: number;
}

const entryShape = z.object({
  entrant_id: z.uuid(),
  purchase_id: z.uuid(),
  first_name: z.string(),
  last_name: z.string(),
  club: z.string().nullable(),
  age: z.number().int(),
  gender: z.enum(NN_ENTRY_GENDERS),
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
  has_medical: z.boolean(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
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
});

export async function fetchAdminEntryList(
  client: AnonClient,
  key: string,
  eventSlug: string,
): Promise<AdminResult<AdminEntryList>> {
  try {
    const { data, error } = await client.schema('entries').rpc('admin_entry_list', {
      p_key: key,
      p_event_slug: eventSlug,
    });

    const envelope = readEnvelope(data, error, 'admin_entry_list');
    if (!('ok' in envelope)) {
      return envelope;
    }

    const parsed = entryListShape.safeParse(envelope.value);

    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'admin_entry_list returned an unexpected shape',
      };
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
      },
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
        eaNumber: entry.ea_number,
        feeCode: entry.fee_code,
        feeLabel: entry.fee_label,
        requiresEaNumber: entry.requires_ea_number,
        amountPence: entry.amount_pence,
        status: entry.status,
        attention: entry.attention,
        attentionResolved: entry.attention_resolved,
        hasMedical: entry.has_medical,
        createdAt: entry.created_at,
        paidAt: entry.paid_at,
        revived: entry.revived,
      })),
    };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
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

export async function fetchAdminInterestList(
  client: AnonClient,
  key: string,
): Promise<AdminResult<AdminInterestList>> {
  try {
    const { data, error } = await client
      .schema('entries')
      .rpc('admin_interest_list', { p_key: key });

    const envelope = readEnvelope(data, error, 'admin_interest_list');
    if (!('ok' in envelope)) {
      return envelope;
    }

    const parsed = interestListShape.safeParse(envelope.value);

    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'admin_interest_list returned an unexpected shape',
      };
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
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
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
export async function fetchAdminMedicalNote(
  client: AnonClient,
  key: string,
  actor: string,
  entrantId: string,
): Promise<AdminResult<AdminMedicalNote>> {
  try {
    const { data, error } = await client.schema('entries').rpc('admin_entrant_medical', {
      p_key: key,
      p_actor: actor,
      p_entrant_id: entrantId,
    });

    const envelope = readEnvelope(data, error, 'admin_entrant_medical');
    if (!('ok' in envelope)) {
      return envelope;
    }

    const parsed = medicalShape.safeParse(envelope.value);

    if (!parsed.success) {
      return {
        status: 'unavailable',
        error: 'admin_entrant_medical returned an unexpected shape',
      };
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
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
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
export async function fetchAdminExport(
  client: AnonClient,
  key: string,
  actor: string,
  eventSlug: string,
  kind: ExportKind,
): Promise<AdminResult<{ export: AdminExport }>> {
  try {
    const { data, error } = await client.schema('entries').rpc('admin_export', {
      p_key: key,
      p_actor: actor,
      p_event_slug: eventSlug,
      p_kind: kind,
    });

    const envelope = readEnvelope(data, error, 'admin_export');
    if (!('ok' in envelope)) {
      return envelope;
    }

    const outer = z
      .object({
        ok: z.literal(true),
        kind: z.enum(EXPORT_KINDS),
        event: exportEventShape,
      })
      .safeParse(envelope.value);

    if (!outer.success) {
      return {
        status: 'unavailable',
        error: 'admin_export returned an unexpected shape',
      };
    }

    const event: AdminExportEvent = {
      slug: outer.data.event.slug,
      displayName: outer.data.event.display_name,
      eventDate: outer.data.event.event_date,
    };

    const rows = (envelope.value as { rows?: unknown }).rows;

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
        : { status: 'unavailable', error: 'admin_export returned an unexpected ea row' };
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
                emergencyContactName: row.emergency_contact_name,
                emergencyContactPhone: row.emergency_contact_phone,
              })),
            },
          }
        : {
            status: 'unavailable',
            error: 'admin_export returned an unexpected start-list row',
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
      : {
          status: 'unavailable',
          error: 'admin_export returned an unexpected medical row',
        };
  } catch (cause) {
    return {
      status: 'unavailable',
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }
}
