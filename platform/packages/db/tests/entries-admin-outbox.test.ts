import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Reading the email queue, and asking for one message again — `/admin/emails/`.
 *
 * **The negative cases are the point of this file**, per the repository's rule. Two functions
 * are granted to `authenticated`, which is a role anybody who registers holds, so the grant
 * only says *you may ask* — every one of these tests is a way of asking that must be refused:
 *
 *   * an anonymous client, which holds no permission because `auth.uid()` is null;
 *   * a plain `registered` account, which is what a member of the public gets;
 *   * `nn-tester`, which holds a permission and is deliberately not staff;
 *   * `people-admin`, which opens `/admin/people/` and must not open this;
 *   * and, for the re-send specifically, `nn-admin` acting on a message it may not act on.
 *
 * **A wrong answer here is the club's entire entrant mailing list**, which is why the read is
 * tested from four directions rather than one.
 */

const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

const PASSWORD = 'outbox-fixture-password-1';
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const EVENT_ID = '0e0e0e0e-7301-4000-8000-000000000001';
const EVENT_SLUG = 'zz-outbox-admin';

const NN_ADMIN_EMAIL = 'outbox-nn-admin@example.com';
const PEOPLE_ADMIN_EMAIL = 'outbox-people-admin@example.com';
const TESTER_EMAIL = 'outbox-tester@example.com';
const PLAIN_EMAIL = 'outbox-plain@example.com';
const EMAILS = [NN_ADMIN_EMAIL, PEOPLE_ADMIN_EMAIL, TESTER_EMAIL, PLAIN_EMAIL];

const db = new Client({ connectionString: LOCAL_DB });
const connected = db.connect();

const anon = createClient(LOCAL_API, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let nnAdmin: { id: string; client: SupabaseClient };
let peopleAdmin: { id: string; client: SupabaseClient };
let tester: { id: string; client: SupabaseClient };
let plain: { id: string; client: SupabaseClient };

async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await db.query(sql, values);
  return result.rows as T[];
}

async function fixturePerson(
  email: string,
): Promise<{ id: string; client: SupabaseClient }> {
  const client = createClient(LOCAL_API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signUp = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signUp.error) throw signUp.error;

  const [row] = await query<{ id: string }>(
    `update auth.users set email_confirmed_at = now() where email = $1 returning id`,
    [email],
  );
  if (!row) throw new Error(`signUp did not create auth.users row for ${email}`);

  const signIn = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
    options: { captchaToken: DUMMY_CAPTCHA_TOKEN },
  });
  if (signIn.error) throw signIn.error;

  return { id: row.id, client };
}

async function grant(personId: string, role: string): Promise<void> {
  await query(
    `insert into identity.role_grants (person_id, role, granted_by)
     values ($1, $2, null) on conflict do nothing`,
    [personId, role],
  );
}

/** A paid place, which is what makes the trigger owe a confirmation. */
async function makePaidPurchase(serial: number): Promise<string> {
  const purchaseId = randomUUID();

  const [fee] = await query<{ id: string }>(
    `select id from entries.fees where event_id = $1 and code = 'unaffiliated'`,
    [EVENT_ID],
  );

  await query(
    `insert into entries.entry_purchases
       (id, event_id, purchaser_email, purchaser_name, fee_id, amount_pence, status,
        hold_expires_at, consents, consent_version)
     values ($1, $2, $3, 'Outbox Fixture', $4, 2000, 'pending',
             now() + interval '30 minutes', '{"entryTerms": true}'::jsonb, 'nn-2026-v1')`,
    [purchaseId, EVENT_ID, `outbox-admin-${serial}@example.com`, fee!.id],
  );

  await query(
    `insert into entries.entrants
       (purchase_id, first_name, last_name, date_of_birth, gender,
        emergency_contact_name, emergency_contact_phone)
     values ($1, 'Outbox', $2, date '1986-03-07', 'female', 'Next Of Kin', '0117 496 0000')`,
    [purchaseId, `AdminFixture${serial}`],
  );

  await query(
    `update entries.entry_purchases set status = 'paid', paid_at = now() where id = $1`,
    [purchaseId],
  );

  return purchaseId;
}

/** The one message that purchase now owes, put into whatever state a test needs. */
async function messageFor(
  purchaseId: string,
  state: { status: string; attempts?: number; lastError?: string | null },
): Promise<string> {
  const [row] = await query<{ id: string }>(
    `update entries.email_outbox
        set status = $2, attempts = $3, last_error = $4,
            sent_at = case when $2 = 'sent' then now() else null end
      where purchase_id = $1
      returning id`,
    [purchaseId, state.status, state.attempts ?? 0, state.lastError ?? null],
  );

  if (!row) throw new Error('the trigger did not write an outbox row');
  return row.id;
}

beforeAll(async () => {
  await connected;

  await query(
    `insert into entries.events
       (id, slug, display_name, race_slug, event_date, start_time, entrants_per_entry,
        capacity, minimum_age, requires_dob, from_address, consent_version, active)
     values ($1, $2, 'Outbox Admin Fixture 2026', 'zz-outbox-admin', date '2026-12-06',
             time '10:30', 1, 50, 18, true, 'fixture@example.com', 'nn-2026-v1', true)
     on conflict (slug) do nothing`,
    [EVENT_ID, EVENT_SLUG],
  );

  await query(
    `insert into entries.fees (event_id, code, label, price_pence)
     values ($1, 'unaffiliated', 'Unaffiliated', 2000) on conflict do nothing`,
    [EVENT_ID],
  );

  nnAdmin = await fixturePerson(NN_ADMIN_EMAIL);
  peopleAdmin = await fixturePerson(PEOPLE_ADMIN_EMAIL);
  tester = await fixturePerson(TESTER_EMAIL);
  plain = await fixturePerson(PLAIN_EMAIL);

  await grant(nnAdmin.id, 'nn-admin');
  await grant(peopleAdmin.id, 'people-admin');
  await grant(tester.id, 'nn-tester');
});

afterAll(async () => {
  await query(`delete from entries.entry_purchases where event_id = $1`, [EVENT_ID]);
  await query(`delete from entries.events where id = $1`, [EVENT_ID]);
  await query('delete from auth.users where email = any($1::text[])', [EMAILS]);
  await db.end();
});

// -----------------------------------------------------------------------------------------
// Reading the queue
// -----------------------------------------------------------------------------------------

describe('entries.admin_outbox_list(), and the four ways of being refused it', () => {
  it('refuses an anonymous caller at the grant, before the function runs at all', async () => {
    const { data, error } = await anon.schema('entries').rpc('admin_outbox_list', {});

    // **`42501`, not an `unauthorised` envelope, and the difference is the point.** Neither
    // of these functions is granted to `anon` — they are on `authenticated` only — so an
    // anonymous caller is refused by Postgres before a line of the body executes. That is a
    // stronger refusal than the one inside the function, and asserting the envelope here
    // would have been asserting a weaker guarantee than the one that actually holds.
    //
    // The in-function check is what stops a *signed-in* caller, and the four tests below are
    // where that is proved.
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('refuses a plain registered account', async () => {
    const { data } = await plain.client.schema('entries').rpc('admin_outbox_list', {});

    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  it('refuses nn-tester, which holds a permission and is not staff', async () => {
    // The role exists to buy a £1 entry before the window opens. It reads nothing, and this
    // is the assertion that says so about the club's mailing list.
    const { data } = await tester.client.schema('entries').rpc('admin_outbox_list', {});

    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  it('refuses people-admin, which opens a different page entirely', async () => {
    const { data } = await peopleAdmin.client
      .schema('entries')
      .rpc('admin_outbox_list', {});

    expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  it('cannot be reached by selecting the table, as anybody', async () => {
    const asAnon = await anon.schema('entries').from('email_outbox').select('*');
    const asAdmin = await nnAdmin.client
      .schema('entries')
      .from('email_outbox')
      .select('*');

    // RLS with no policy. **Holding `nn.entry.read` does not open the table** — it opens the
    // function, which is the only thing that decides what a reader sees.
    expect(asAnon.error).not.toBeNull();
    expect(asAdmin.error).not.toBeNull();
  });

  it('answers nn-admin with the queue and the figures in one call', async () => {
    const purchaseId = await makePaidPurchase(1);

    const { data } = await nnAdmin.client.schema('entries').rpc('admin_outbox_list', {});
    const answer = data as {
      ok: boolean;
      figures: { pending: number; sent: number; failed: number; sent_today: number };
      messages: { purchase_reference: string; recipient: string; status: string }[];
    };

    expect(answer.ok).toBe(true);

    const mine = answer.messages.find((row) => row.purchase_reference === purchaseId);

    expect(mine).toMatchObject({
      recipient: 'outbox-admin-1@example.com',
      template: 'entry_confirmed',
      status: 'pending',
      event_name: 'Outbox Admin Fixture 2026',
    });

    // The counts come from the same query that listed the rows, which is what stops two
    // panels on one page disagreeing.
    expect(answer.figures.pending).toBeGreaterThanOrEqual(1);
  });

  it('counts a message sent today, and not one sent before today', async () => {
    const today = await makePaidPurchase(2);
    const before = await makePaidPurchase(3);

    await messageFor(today, { status: 'sent' });
    await query(
      `update entries.email_outbox
          set status = 'sent', sent_at = now() - interval '3 days'
        where purchase_id = $1`,
      [before],
    );

    const { data } = await nnAdmin.client.schema('entries').rpc('admin_outbox_list', {});
    const figures = (data as { figures: { sent_today: number; sent: number } }).figures;

    // **`sent_today` is a Europe/London day**, not a UTC one, so a page read at 00:30 BST
    // reports what the club remembers happening rather than yesterday's total.
    expect(figures.sent_today).toBe(1);
    expect(figures.sent).toBeGreaterThanOrEqual(2);
  });
});

// -----------------------------------------------------------------------------------------
// Asking for one message again
// -----------------------------------------------------------------------------------------

describe('entries.admin_outbox_resend(), and what it refuses', () => {
  it('refuses everybody without nn.entry.cancel, including the reader', async () => {
    const purchaseId = await makePaidPurchase(4);
    const id = await messageFor(purchaseId, { status: 'failed', attempts: 3 });

    // **Anonymous is refused at the grant**, before the body runs — same as the read above.
    const anonymously = await anon
      .schema('entries')
      .rpc('admin_outbox_resend', { p_id: id });

    expect(anonymously.error?.code).toBe('42501');

    // **Everybody else is refused inside the function**, which is the check that matters:
    // each of these holds `authenticated`, so the grant lets them ask and only
    // `identity.has_permission('nn.entry.cancel')` says no. `nn-tester` holds a permission
    // and is deliberately not staff; `people-admin` opens a different page entirely.
    for (const caller of [plain.client, tester.client, peopleAdmin.client]) {
      const { data } = await caller
        .schema('entries')
        .rpc('admin_outbox_resend', { p_id: id });

      expect(data).toMatchObject({ ok: false, reason: 'unauthorised' });
    }

    const [after] = await query<{ status: string }>(
      `select status from entries.email_outbox where id = $1`,
      [id],
    );

    // **Untouched.** A refusal that still moved the row would be a way to make the club send
    // an email without holding the permission to.
    expect(after?.status).toBe('failed');
  });

  it('puts a failed message back in the queue and resets its attempts', async () => {
    const purchaseId = await makePaidPurchase(5);
    const id = await messageFor(purchaseId, {
      status: 'failed',
      attempts: 3,
      lastError: 'http 422',
    });

    const { data } = await nnAdmin.client
      .schema('entries')
      .rpc('admin_outbox_resend', { p_id: id });

    expect(data).toMatchObject({ ok: true, template: 'entry_confirmed' });

    const [after] = await query<{
      status: string;
      attempts: number;
      last_error: string | null;
    }>(`select status, attempts, last_error from entries.email_outbox where id = $1`, [
      id,
    ]);

    // Back to zero: a human deciding to try again is a new judgement, not a fourth automatic
    // attempt at something that already failed three times.
    expect(after).toMatchObject({ status: 'pending', attempts: 0, last_error: null });
  });

  it('refuses a message that has already been sent', async () => {
    // **The club cannot un-send an email.** The usual cause of "I never got it" is a spam
    // folder, so the direction to fail in is the one that sends fewer.
    const purchaseId = await makePaidPurchase(6);
    const id = await messageFor(purchaseId, { status: 'sent' });

    const { data } = await nnAdmin.client
      .schema('entries')
      .rpc('admin_outbox_resend', { p_id: id });

    expect(data).toMatchObject({ ok: false, reason: 'already_sent' });

    const [after] = await query<{ status: string }>(
      `select status from entries.email_outbox where id = $1`,
      [id],
    );
    expect(after?.status).toBe('sent');
  });

  it('says so plainly when the message is already waiting', async () => {
    const purchaseId = await makePaidPurchase(7);
    const id = await messageFor(purchaseId, { status: 'pending', attempts: 1 });

    const { data } = await nnAdmin.client
      .schema('entries')
      .rpc('admin_outbox_resend', { p_id: id });

    // Not an error and not a change — the drain will reach it. Reporting success would be
    // reporting something that did not happen.
    expect(data).toMatchObject({ ok: false, reason: 'already_queued' });

    const [after] = await query<{ attempts: number }>(
      `select attempts from entries.email_outbox where id = $1`,
      [id],
    );
    expect(after?.attempts).toBe(1);
  });

  it('answers no_such_message for an id that is not there', async () => {
    const { data } = await nnAdmin.client
      .schema('entries')
      .rpc('admin_outbox_resend', { p_id: randomUUID() });

    expect(data).toMatchObject({ ok: false, reason: 'no_such_message' });
  });

  it('writes an audit row naming who asked, and never the recipient', async () => {
    const purchaseId = await makePaidPurchase(8);
    const id = await messageFor(purchaseId, { status: 'failed', attempts: 3 });

    await nnAdmin.client.schema('entries').rpc('admin_outbox_resend', { p_id: id });

    const [audit] = await query<{ actor: string; detail: Record<string, unknown> }>(
      `select actor, detail from entries.admin_audit
        where action = 'resend_email' and detail ->> 'outbox_id' = $1`,
      [id],
    );

    expect(audit?.actor).toBe(nnAdmin.id);

    // **`entries.admin_audit` is not a second place the club's email addresses live.** The
    // outbox row holds the recipient and `outbox_id` points at it.
    expect(JSON.stringify(audit?.detail)).not.toContain('@');
  });
});
