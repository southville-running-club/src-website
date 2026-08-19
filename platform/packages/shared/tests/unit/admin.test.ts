import { describe, expect, it } from 'vitest';
import {
  adminSignIn,
  deleteExpiredMedicalNotes,
  fetchAdminEntryList,
  fetchAdminExport,
  fetchAdminInterestList,
  fetchAdminMedicalNote,
  isExportKind,
} from '../../src/admin';
import { failingRpcClient, ok, pgError, rpcClient } from './support/rpc-client';

/**
 * The admin surface's parsing, and **only the half a real database cannot reach.**
 *
 * `packages/db/tests/entries-admin.test.ts` proves the five RPCs against a real Postgres and
 * `apps/main/tests/worker/admin/` drives the pages through the real runtime. Between them the
 * happy path is thoroughly covered, and nothing here repeats it.
 *
 * What neither can reach is what this module is mostly made of. `admin.ts` parses every answer
 * rather than trusting it, and each fallback exists because **nothing sequences a migration
 * against the Cloudflare deploy** — a Worker can be older or newer than the schema it is
 * talking to for the length of a deploy, and the rule is that the previously deployed code
 * keeps working. A correct database emits none of the payloads below, which is exactly why
 * they are here.
 *
 * The distinction that matters on this surface: **`unavailable` is not an empty list.** On a
 * page an organiser uses to decide how many bibs to set out, "the club has no entries" and
 * "the question could not be asked" must never render as the same thing.
 */

const KEY = 'zz-admin-key-not-a-real-one';
const ACTOR = 'ada';

/** Invented, fixed, and at example.com where an address is needed. */
const ENTRANT_ID = '11111111-1111-4111-8111-111111111111';
const PURCHASE_ID = '22222222-2222-4222-8222-222222222222';
const INTEREST_ID = '33333333-3333-4333-8333-333333333333';

const FIGURES = {
  entries_open_at: null,
  entries_close_at: null,
  paid: 2,
  over_capacity: 0,
  held: 1,
  holds_returned: 0,
  refunded: 0,
  fees_pence: 3200,
  medical_count: 1,
  affiliated: 1,
  affiliated_missing_ea: 0,
  medical_retention: '1 mon',
  medical_delete_after: '2026-12-01',
};

const ENTRY = {
  entrant_id: ENTRANT_ID,
  purchase_id: PURCHASE_ID,
  first_name: 'Inés',
  last_name: "O'Rourke",
  club: 'Southville Running Club',
  age: 34,
  gender: 'female',
  ea_number: '1234567',
  fee_code: 'affiliated',
  fee_label: 'Affiliated',
  requires_ea_number: true,
  amount_pence: 1500,
  status: 'paid',
  attention: null,
  attention_resolved: false,
  has_medical: true,
  created_at: '2026-08-01T09:00:00Z',
  paid_at: '2026-08-01T09:00:04Z',
  hold_expires_at: null,
  revived: false,
};

/** One entry against one event, as `admin_entry_list` builds it. Cloned per test. */
const entryListReply = (
  overrides: {
    event?: Record<string, unknown>;
    entries?: unknown[];
  } = {},
): Record<string, unknown> => ({
  ok: true,
  event: {
    slug: 'nn-2026',
    display_name: 'Nightingale Nightmare 2026',
    event_date: '2026-11-01',
    capacity: 250,
    taken: 3,
    attention: 0,
    ...FIGURES,
    ...overrides.event,
  },
  total: 1,
  returned: 1,
  entries: overrides.entries ?? [ENTRY],
});

// -------------------------------------------------------------------------------------------
// readEnvelope — the three-way classification every one of the five reads goes through
// -------------------------------------------------------------------------------------------

describe('the three failures, which a page has to tell apart', () => {
  it('reads a refusal as unauthorised, and says nothing else', () => {
    // `{ ok: false, reason: 'unauthorised' }` is what every one of these functions answers to a
    // key it does not accept, and the Worker turns it into the 404 an unpublished address gets.
    // **It must disclose nothing** — not whether the event exists, not whether the digest is
    // installed, not which of the two keys was wrong.
    const { client } = rpcClient(ok({ ok: false, reason: 'unauthorised' }));

    return expect(fetchAdminEntryList(client, KEY, 'nn-2026')).resolves.toEqual({
      status: 'unauthorised',
    });
  });

  it('reads any other refusal as not-found', async () => {
    const { client } = rpcClient(ok({ ok: false, reason: 'no_such_event' }));

    await expect(fetchAdminEntryList(client, KEY, 'nn-2099')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('reads a refusal with no reason at all as not-found', async () => {
    // `reason` is optional on the envelope shape. An older database that answers a bare
    // `{ ok: false }` must land somewhere defined rather than throwing.
    const { client } = rpcClient(ok({ ok: false }));

    await expect(fetchAdminEntryList(client, KEY, 'nn-2026')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('reports a PostgREST error as unavailable, carrying the code', async () => {
    // `PGRST202` is "the function does not exist", which is what an older database says to a
    // newer Worker. It is a deployment state, and the page must say so rather than render an
    // empty table that reads as "nobody has entered yet".
    const { client } = rpcClient(pgError('PGRST202', 'Could not find the function'));

    await expect(fetchAdminEntryList(client, KEY, 'nn-2026')).resolves.toEqual({
      status: 'unavailable',
      error: 'PGRST202: Could not find the function',
    });
  });

  it('still reports unavailable when PostgREST gives no code', async () => {
    const { client } = rpcClient(pgError(null, 'connection refused'));

    await expect(fetchAdminEntryList(client, KEY, 'nn-2026')).resolves.toEqual({
      status: 'unavailable',
      error: 'unknown: connection refused',
    });
  });

  it('reports an answer that is not an envelope at all as unavailable', async () => {
    // **The branch a working database cannot produce.** A migration that renamed `ok`, or a
    // function replaced by one returning a bare array, arrives here — and the whole reason
    // every answer is parsed rather than trusted is that this must be a message rather than an
    // empty table.
    const { client } = rpcClient(ok([{ first_name: 'Inés' }]));

    await expect(fetchAdminEntryList(client, KEY, 'nn-2026')).resolves.toEqual({
      status: 'unavailable',
      error: 'admin_entry_list returned an unexpected shape',
    });
  });

  it('names the function that disagreed, so a log line says which one', async () => {
    const { client } = rpcClient(ok(null));

    await expect(fetchAdminInterestList(client, KEY)).resolves.toEqual({
      status: 'unavailable',
      error: 'admin_interest_list returned an unexpected shape',
    });
  });

  it('turns a thrown network failure into a value, and keeps the cause out of it', async () => {
    // The payload these functions are built from carries names and email addresses. A caught
    // failure may report the error's *name* and nothing else — a message could carry a URL
    // with a query in it, and this is the one place that is decided.
    const client = failingRpcClient(new TypeError('fetch failed: https://…?key=secret'));

    await expect(fetchAdminEntryList(client, KEY, 'nn-2026')).resolves.toEqual({
      status: 'unavailable',
      error: 'TypeError',
    });
  });

  it('survives something thrown that is not an Error', async () => {
    const client = failingRpcClient('a string, because anything can be thrown');

    await expect(fetchAdminInterestList(client, KEY)).resolves.toEqual({
      status: 'unavailable',
      error: 'unknown',
    });
  });
});

// -------------------------------------------------------------------------------------------
// Signing in
// -------------------------------------------------------------------------------------------

describe('signing in', () => {
  it('learns the handle the key belongs to', async () => {
    const { client, calls } = rpcClient(ok({ ok: true, name: 'ada' }));

    await expect(adminSignIn(client, KEY, 'person-key')).resolves.toEqual({
      status: 'ok',
      name: 'ada',
    });

    // Both keys go to the database, and the schema is `entries` rather than the client's
    // default of `intake`.
    expect(calls).toEqual([
      {
        schema: 'entries',
        fn: 'admin_sign_in',
        args: { p_key: KEY, p_person_key: 'person-key' },
      },
    ]);
  });

  it('refuses a reply that says ok but names nobody', async () => {
    // The handle is what lands in the audit trail. A sign-in that succeeded without one would
    // put an empty actor on every read that followed, and an audit row naming nobody is worse
    // than a refused sign-in.
    const { client } = rpcClient(ok({ ok: true, name: '' }));

    await expect(adminSignIn(client, KEY, 'person-key')).resolves.toEqual({
      status: 'unavailable',
      error: 'admin_sign_in returned an unexpected shape',
    });
  });

  it('collapses a wrong key and an unknown one into one answer', async () => {
    // Mistyped, revoked, or never existed — the page must read identically, or it becomes an
    // oracle for which volunteer handles are real.
    const { client } = rpcClient(ok({ ok: false, reason: 'unauthorised' }));

    await expect(adminSignIn(client, KEY, 'wrong')).resolves.toEqual({
      status: 'unauthorised',
    });
  });
});

// -------------------------------------------------------------------------------------------
// The entry list, and the two fallbacks that are the expand-migrate-contract guarantee
// -------------------------------------------------------------------------------------------

describe('the entry list', () => {
  it('maps a row onto the names the page uses', async () => {
    const { client } = rpcClient(ok(entryListReply()));
    const result = await fetchAdminEntryList(client, KEY, 'nn-2026');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.entries[0]).toMatchObject({
      entrantId: ENTRANT_ID,
      firstName: 'Inés',
      lastName: "O'Rourke",
      status: 'paid',
      holdExpiresAt: null,
    });
    // **No date of birth and no email address on this shape at all.** The page renders a
    // derived age, and the mapping is where that would quietly stop being true.
    expect(Object.keys(result.entries[0] ?? {})).not.toContain('dateOfBirth');
    expect(Object.keys(result.entries[0] ?? {})).not.toContain('email');
  });

  it('degrades a status it has never heard of to pending', async () => {
    // **`z.enum(ENTRY_STATUSES).catch('pending')`, and the branch nothing else can reach.**
    // There are deliberately only four statuses — the capacity predicate counts `paid`, so a
    // fifth would be invisible to it — but a migration adding one still reaches a Worker
    // deployed before it. `pending` is the honest fallback: it claims nothing and looks
    // unfinished, where a hard failure would be a blank page on race week.
    const { client } = rpcClient(
      ok(entryListReply({ entries: [{ ...ENTRY, status: 'deferred' }] })),
    );

    const result = await fetchAdminEntryList(client, KEY, 'nn-2026');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.entries[0]?.status).toBe('pending');
  });

  it('renders a row from a database that predates the hold column', async () => {
    // `hold_expires_at` is `.nullable().optional()` for the same reason, one column along. The
    // row must still render.
    const { hold_expires_at: _omitted, ...withoutHold } = ENTRY;
    const { client } = rpcClient(ok(entryListReply({ entries: [withoutHold] })));

    const result = await fetchAdminEntryList(client, KEY, 'nn-2026');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.entries[0]?.holdExpiresAt).toBeNull();
  });

  it('reads the figures block when the database can answer it', async () => {
    const { client } = rpcClient(ok(entryListReply()));
    const result = await fetchAdminEntryList(client, KEY, 'nn-2026');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.event.figures).toMatchObject({
      paid: 2,
      feesPence: 3200,
      medicalRetention: '1 mon',
      medicalDeleteAfter: '2026-12-01',
      // Null because the club has not decided, and it is never invented.
      entriesOpenAt: null,
    });
  });

  it('gives back a null figures block rather than a block of zeroes', async () => {
    // **The distinction the whole two-pass parse exists for.** A database predating the figures
    // migration must not be reported as a race with no entries and no fees taken — that is a
    // number an organiser would act on. The list still renders; the panel says it cannot answer.
    const bare = {
      slug: 'nn-2026',
      display_name: 'Nightingale Nightmare 2026',
      event_date: '2026-11-01',
      capacity: 250,
      taken: 3,
      attention: 0,
    };
    const { client } = rpcClient(ok({ ...entryListReply(), event: bare }));

    const result = await fetchAdminEntryList(client, KEY, 'nn-2026');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.event.figures).toBeNull();
    // The list itself is unharmed, which is the half that must keep working.
    expect(result.entries).toHaveLength(1);
  });

  it('refuses the whole list when a row is missing a field the page needs', async () => {
    // The other side of the same decision: a *row* that does not parse is not a row to render
    // with gaps in it. One entrant silently missing from a start list is the failure this
    // catches, and it has to be loud.
    const { age: _dropped, ...withoutAge } = ENTRY;
    const { client } = rpcClient(ok(entryListReply({ entries: [withoutAge] })));

    await expect(fetchAdminEntryList(client, KEY, 'nn-2026')).resolves.toEqual({
      status: 'unavailable',
      error: 'admin_entry_list returned an unexpected shape',
    });
  });

  it('sends the key and the event, and nothing else', async () => {
    const { client, calls } = rpcClient(ok(entryListReply()));
    await fetchAdminEntryList(client, KEY, 'nn-2026');

    expect(calls[0]).toEqual({
      schema: 'entries',
      fn: 'admin_entry_list',
      args: { p_key: KEY, p_event_slug: 'nn-2026' },
    });
  });
});

// -------------------------------------------------------------------------------------------
// The interest list
// -------------------------------------------------------------------------------------------

describe('the interest list', () => {
  const interestReply = (rows: unknown[]) => ({
    ok: true,
    total: rows.length,
    returned: rows.length,
    consented: 1,
    interest: rows,
  });

  const ROW = {
    id: INTEREST_ID,
    name: 'Inés O’Rourke',
    email: 'ines@example.com',
    consent: true,
    created_at: '2026-08-01T09:00:00Z',
  };

  it('keeps a row whose consent was withheld, rather than filtering it out', async () => {
    // **Shown, never filtered.** The club must be able to see that somebody signed up and said
    // no — dropping the row here would make it look like they never signed up, and the count
    // the page shows would stop matching the table under it.
    const { client } = rpcClient(ok(interestReply([{ ...ROW, consent: false }])));

    const result = await fetchAdminInterestList(client, KEY);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.interest).toHaveLength(1);
    expect(result.interest[0]?.consent).toBe(false);
  });

  it('refuses a row whose id is not a uuid', async () => {
    const { client } = rpcClient(ok(interestReply([{ ...ROW, id: 'not-a-uuid' }])));

    await expect(fetchAdminInterestList(client, KEY)).resolves.toEqual({
      status: 'unavailable',
      error: 'admin_interest_list returned an unexpected shape',
    });
  });
});

// -------------------------------------------------------------------------------------------
// One medical note
// -------------------------------------------------------------------------------------------

describe('one medical note', () => {
  const NOTE = {
    ok: true,
    entrant_id: ENTRANT_ID,
    event_slug: 'nn-2026',
    first_name: 'Inés',
    last_name: 'O’Rourke',
    club: null,
    notes: 'Asthma — carries an inhaler',
  };

  it('carries the actor, because the database writes the audit row', async () => {
    // The audit row is written in the same transaction as the read, so there is no ordering in
    // which a note comes back and nothing records that it did. That only holds if the handle
    // actually travels, which is what this asserts.
    const { client, calls } = rpcClient(ok(NOTE));
    await fetchAdminMedicalNote(client, KEY, ACTOR, ENTRANT_ID);

    expect(calls[0]?.args).toEqual({
      p_key: KEY,
      p_actor: ACTOR,
      p_entrant_id: ENTRANT_ID,
    });
  });

  it('reads an absent note as null rather than as an empty string', async () => {
    // No note written and medical consent withheld are the same absence by design — there is
    // nothing stored in either case, and the page must not distinguish them.
    const { client } = rpcClient(ok({ ...NOTE, notes: null }));
    const result = await fetchAdminMedicalNote(client, KEY, ACTOR, ENTRANT_ID);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.notes).toBeNull();
  });

  it('reads an entrant nobody has as not-found, not as an empty note', async () => {
    // **The difference matters more here than anywhere else on this surface.** "There is no
    // note" and "there is no such entrant" render differently, and a marshal reading the first
    // when the second is true is being told something false about a runner.
    const { client } = rpcClient(ok({ ok: false, reason: 'no_such_entrant' }));

    await expect(fetchAdminMedicalNote(client, KEY, ACTOR, ENTRANT_ID)).resolves.toEqual({
      status: 'not-found',
    });
  });
});

// -------------------------------------------------------------------------------------------
// The three exports
// -------------------------------------------------------------------------------------------

describe('which exports exist', () => {
  it('accepts the three the club takes', () => {
    expect(isExportKind('ea')).toBe(true);
    expect(isExportKind('start-list')).toBe(true);
    expect(isExportKind('medical')).toBe(true);
  });

  it('refuses anything else, because the kind reaches the database as an argument', () => {
    // `p_kind` is passed through to `admin_export`, and the row shape is decided there rather
    // than filtered here — so this predicate is what stands between a URL segment somebody
    // typed and that argument.
    expect(isExportKind('entries')).toBe(false);
    expect(isExportKind('EA')).toBe(false);
    expect(isExportKind('start_list')).toBe(false);
    expect(isExportKind('')).toBe(false);
  });
});

describe('taking an export', () => {
  const EVENT = {
    slug: 'nn-2026',
    display_name: 'Nightingale Nightmare 2026',
    event_date: '2026-11-01',
  };

  it('reads the England Athletics rows, which carry no contact details', async () => {
    const { client } = rpcClient(
      ok({
        ok: true,
        kind: 'ea',
        event: EVENT,
        rows: [
          {
            last_name: 'O’Rourke',
            first_name: 'Inés',
            club: null,
            ea_number: '1234567',
            fee_label: 'Affiliated',
            amount_pence: 1500,
          },
        ],
      }),
    );

    const result = await fetchAdminExport(client, KEY, ACTOR, 'nn-2026', 'ea');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.export.kind).toBe('ea');
    expect(result.export.rows[0]).toEqual({
      lastName: 'O’Rourke',
      firstName: 'Inés',
      club: null,
      eaNumber: '1234567',
      feeLabel: 'Affiliated',
      amountPence: 1500,
    });
  });

  it('reads the start list, which is the only one carrying an emergency contact', async () => {
    const { client } = rpcClient(
      ok({
        ok: true,
        kind: 'start-list',
        event: EVENT,
        rows: [
          {
            last_name: 'O’Rourke',
            first_name: 'Inés',
            club: null,
            age: 34,
            gender: 'female',
            emergency_contact_name: 'Sam Frost',
            emergency_contact_phone: '01179 000000',
          },
        ],
      }),
    );

    const result = await fetchAdminExport(client, KEY, ACTOR, 'nn-2026', 'start-list');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.export.kind).toBe('start-list');
    expect(result.export.rows[0]).toMatchObject({
      emergencyContactName: 'Sam Frost',
      gender: 'female',
    });
  });

  it('reads the medical export, which is taken on purpose and on its own', async () => {
    const { client } = rpcClient(
      ok({
        ok: true,
        kind: 'medical',
        event: EVENT,
        rows: [
          {
            last_name: 'O’Rourke',
            first_name: 'Inés',
            club: null,
            notes: 'Asthma — carries an inhaler',
          },
        ],
      }),
    );

    const result = await fetchAdminExport(client, KEY, ACTOR, 'nn-2026', 'medical');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Narrowed rather than merely asserted: `AdminExport` is a discriminated union, and the
    // whole point of that shape is that a caller cannot reach a medical note without having
    // established it is holding a medical export. A test that read `.notes` off the union
    // would be proving the opposite of what the type is for.
    expect(result.export.kind).toBe('medical');
    if (result.export.kind !== 'medical') return;
    expect(result.export.rows[0]?.notes).toBe('Asthma — carries an inhaler');
  });

  it('names the export whose rows did not parse, per kind', async () => {
    // Three separate messages rather than one, because the three row shapes are what tell the
    // exports apart and "which one broke" is the first thing somebody needs to know.
    const badRows = [{ last_name: 'O’Rourke' }];

    const cases = [
      ['ea', 'admin_export returned an unexpected ea row'],
      ['start-list', 'admin_export returned an unexpected start-list row'],
      ['medical', 'admin_export returned an unexpected medical row'],
    ] as const;

    for (const [kind, error] of cases) {
      const { client } = rpcClient(ok({ ok: true, kind, event: EVENT, rows: badRows }));

      await expect(
        fetchAdminExport(client, KEY, ACTOR, 'nn-2026', kind),
      ).resolves.toEqual({ status: 'unavailable', error });
    }
  });

  it('refuses a reply whose kind is not one of the three', async () => {
    // A fourth export added by a migration reaches an older Worker here. It must decline
    // rather than fall through to the medical branch, which is the last one and the one
    // holding special category data.
    const { client } = rpcClient(
      ok({ ok: true, kind: 'contacts', event: EVENT, rows: [] }),
    );

    await expect(fetchAdminExport(client, KEY, ACTOR, 'nn-2026', 'ea')).resolves.toEqual({
      status: 'unavailable',
      error: 'admin_export returned an unexpected shape',
    });
  });

  it('answers the kind the database says, not the kind that was asked for', async () => {
    // The rows are shaped by `p_kind` inside the function. If the two ever disagreed, parsing
    // against the *requested* kind would be reading a start list as though it were an England
    // Athletics list — with an emergency contact quietly landing in a column labelled
    // something else.
    const { client } = rpcClient(
      ok({
        ok: true,
        kind: 'medical',
        event: EVENT,
        rows: [
          { last_name: 'O’Rourke', first_name: 'Inés', club: null, notes: 'Asthma' },
        ],
      }),
    );

    const result = await fetchAdminExport(client, KEY, ACTOR, 'nn-2026', 'ea');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.export.kind).toBe('medical');
  });
});

// -------------------------------------------------------------------------------------------
// The retention sweep
// -------------------------------------------------------------------------------------------

describe('the medical retention sweep', () => {
  it('reports what it deleted, which is a count and never a note', async () => {
    const { client, calls } = rpcClient(ok({ deleted: 4, events: 1 }));

    await expect(deleteExpiredMedicalNotes(client)).resolves.toEqual({
      ok: true,
      deleted: 4,
      events: 1,
    });

    // **No key.** This is the one anon-callable function that takes none, deliberately: it can
    // only delete what `/nn/privacy/` has published a promise to delete, and gating it would
    // make a legal retention obligation stop being kept on any day the admin key was not
    // installed.
    expect(calls[0]).toEqual({
      schema: 'entries',
      fn: 'delete_expired_medical_notes',
      args: undefined,
    });
  });

  it('reads a missing event count as zero rather than refusing the sweep', async () => {
    // `events` is `.catch(0)` — it is there so a log line can say whether it was one race or
    // four. A database that does not report it must not turn a successful deletion into a
    // failure the cron shouts about.
    const { client } = rpcClient(ok({ deleted: 2 }));

    await expect(deleteExpiredMedicalNotes(client)).resolves.toEqual({
      ok: true,
      deleted: 2,
      events: 0,
    });
  });

  it('refuses a reply with no count in it at all', async () => {
    // `deleted` has no fallback, and should not: a sweep that cannot say how many notes it
    // removed has not answered the only question worth asking it.
    const { client } = rpcClient(ok({ events: 1 }));

    await expect(deleteExpiredMedicalNotes(client)).resolves.toEqual({
      ok: false,
      error: 'delete_expired_medical_notes returned an unexpected shape',
    });
  });

  it('reports a database that has not got the function yet', async () => {
    const { client } = rpcClient(pgError('PGRST202', 'Could not find the function'));

    await expect(deleteExpiredMedicalNotes(client)).resolves.toEqual({
      ok: false,
      error: 'PGRST202: Could not find the function',
    });
  });

  it('turns a thrown failure into a value, so the cron logs rather than crashes', async () => {
    const client = failingRpcClient(new TypeError('fetch failed'));

    await expect(deleteExpiredMedicalNotes(client)).resolves.toEqual({
      ok: false,
      error: 'TypeError',
    });
  });
});
