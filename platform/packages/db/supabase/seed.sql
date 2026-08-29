-- Local fixtures. Applied on `supabase start` and on every `supabase db reset`.
--
-- **Every person below is invented.** No production data reaches a laptop, ever — C10
-- applies to laptops exactly as it applies to servers, and "just for testing" is how that
-- rule gets broken.
--
-- The rules, which matter more than the rows:
--
--   * **Data only, never schema.** Schema comes from migrations. A seed file that creates
--     a table drifts from production silently, and nobody finds out until a restore.
--
--   * **Deterministic.** Fixed UUIDs, fixed timestamps. A test can then assert on them.
--     Random fixtures produce tests that fail on Tuesdays.
--
--   * **Realistic shapes, invented people.** Names that look like names, addresses at
--     example.com, which is reserved by the IETF and cannot receive mail.
--
--   * **Include the awkward states.** The rows that break rendering are the interesting
--     ones — consent withheld, an apostrophe in a name, a non-ASCII name, an address at
--     the length limit, a submission either side of the clocks change.
--
--   * **Idempotent.** `on conflict do nothing`, so re-running the seed over an existing
--     database is harmless.
--
-- See docs/architecture/decisions/adr-003-local-development-and-pipeline.md

insert into intake.nn_interest (id, name, email, consent, created_at) values
  -- The ordinary case.
  ('11111111-1111-4111-8111-111111111111', 'Alice Fernsby',    'alice@example.com',   true,  '2026-08-01T09:15:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'Bruno Castellani', 'bruno@example.com',   true,  '2026-08-01T18:42:00Z'),

  -- **Consent withheld.** A legitimate stored value, not a missing one, and the row the
  -- club must never email. Anything that treats absence of consent as consent fails here.
  ('33333333-3333-4333-8333-333333333333', 'Cerys Idris',      'cerys@example.com',   false, '2026-08-02T07:03:00Z'),

  -- An apostrophe and a non-ASCII name. Both routinely break naive escaping and naive
  -- rendering, and both are ordinary in a Bristol running club.
  ('44444444-4444-4444-8444-444444444444', E'Dara O\'Sullivan', 'dara@example.com',   true,  '2026-08-02T21:30:00Z'),
  ('55555555-5555-4555-8555-555555555555', 'Émile Boisvert',   'emile@example.com',   true,  '2026-08-03T12:00:00Z'),

  -- **Either side of the clocks change**, 25 October 2026. These two are one hour apart
  -- and both render as 01:30 in Europe/London. Any code reasoning about local time alone
  -- loses that hour, which is why UTC is what gets stored — and why Nightingale Nightmare,
  -- raced the following weekend, cares.
  ('66666666-6666-4666-8666-666666666666', 'Fiona Wray',       'fiona@example.com',   true,  '2026-10-25T00:30:00Z'),
  ('77777777-7777-4777-8777-777777777777', 'Gareth Pyne',      'gareth@example.com',  true,  '2026-10-25T01:30:00Z')
on conflict do nothing;

-- =========================================================================================
-- The admin surface — the keys that open it locally, and something to look at behind it
-- =========================================================================================
-- **Both keys below are fixtures and both are worthless.** They are the same kind of thing as
-- the anon key in `wrangler.jsonc` and `sk_test_STUB_NOT_A_REAL_KEY` in `apps/main`'s preview
-- script: strings that exist so a laptop can run the whole path end to end. This file **never
-- runs against production** — `deploy-db.yml` runs `supabase db push`, never `db reset`, and
-- the two digest columns ship null there, which refuses everything until a human installs a
-- real key by hand.
--
-- They are written as `sha256(...)` of a literal rather than as a hex constant so that what
-- opens the door is readable in this file rather than being a hash somebody has to reverse.

-- The Worker's key. `apps/main`'s preview script passes the same string as ENTRIES_ADMIN_KEY.
update entries.webhook_secrets
   set key_sha256 = encode(sha256(convert_to('local-development-only-not-a-real-key', 'UTF8')), 'hex'),
       updated_at = now()
 where name = 'admin';

-- One person, and the handle is a role rather than a name — which is the rule the real table
-- follows too, because this handle lands in every audit row.
insert into entries.admin_keys (name, key_sha256) values
  (
    'local-volunteer',
    encode(sha256(convert_to('local-development-only-person-key', 'UTF8')), 'hex')
  )
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------------------
-- A fabricated running, with the five states the admin list has to render
-- -----------------------------------------------------------------------------------------
-- **`race_slug` is `zz-admin` and never `nn`, deliberately** — the same rule
-- `packages/db/tests/entries.test.ts` follows for its window fixtures. A fixture claiming to be
-- a running of the real race would change what `current_entry_state('nn')` answers, and the
-- acceptance suite reads that on every `/nn/` request, so the site's front door would start
-- depending on the seed.
--
-- **Nothing is seeded against `nn-2026`, and that is not tidiness either.** `tests/entries-db.ts`
-- `clearPurchases()` deletes every purchase against the real event before each entry test, so a
-- seeded row there would vanish partway through a suite and take this page's fixtures with it.
--
-- **Capacity is 3 against four places held**, so a laptop shows the state that must be
-- impossible to miss: a race that is one over its field because somebody paid after their hold
-- had lapsed. It is the hardest thing on the page to get right and the easiest to never see.
--
-- Dates of birth are chosen against the event date of 6 December 2026 so that every category
-- band appears, including the two that have no band at all.
insert into entries.events (
  id, slug, display_name, race_slug, event_date, start_time, entrants_per_entry, capacity,
  entries_open_at, entries_close_at, minimum_age, requires_dob, from_address, consent_version,
  active
) values (
  '0e0e0e0e-0000-4000-8000-000000000001',
  'zz-admin-demo',
  'Fixture Race 2026',
  'zz-admin',
  date '2026-12-06',
  time '10:30',
  1,
  3,
  '2026-01-01T00:00:00Z',
  null,
  18,
  true,
  'fixture@example.com',
  'zz-admin-v1',
  true
)
on conflict (slug) do nothing;

-- **`affiliated` rather than `requires_ea_number`, since 29 August 2026.** The club stopped
-- asking for England Athletics numbers; what survives is which fee is the affiliated price,
-- which is what the figures panel and the England Athletics export count. Every fee here is
-- requires_ea_number = false by the column's own default, and fees_ea_number_not_collected
-- refuses anything else.
insert into entries.fees (id, event_id, code, label, price_pence, affiliated) values
  ('0e0e0e0e-0000-4000-8000-000000000011', '0e0e0e0e-0000-4000-8000-000000000001',
   'affiliated',   'Affiliated',   1500, true),
  ('0e0e0e0e-0000-4000-8000-000000000012', '0e0e0e0e-0000-4000-8000-000000000001',
   'unaffiliated', 'Unaffiliated', 1700, false),
  ('0e0e0e0e-0000-4000-8000-000000000013', '0e0e0e0e-0000-4000-8000-000000000001',
   'vi_guide',     'VI guide',        0, false)
on conflict (event_id, code) do nothing;

insert into entries.entry_purchases (
  id, event_id, status, amount_pence, fee_id, purchaser_email, purchaser_name,
  consents, consent_version, hold_expires_at, paid_at, revived_at,
  attention, attention_at, attention_detail, created_at
) values
  -- Paid, affiliated, and the one with a medical note behind the deliberate act.
  ('0e0e0e0e-0000-4000-8000-000000000101', '0e0e0e0e-0000-4000-8000-000000000001',
   'paid', 1500, '0e0e0e0e-0000-4000-8000-000000000011',
   'harriet@example.com', 'Harriet Nwosu',
   '{"entryTerms":true,"medical":true}'::jsonb, 'zz-admin-v1',
   '2026-08-01T09:31:00Z', '2026-08-01T09:12:00Z', null, null, null, null,
   '2026-08-01T09:00:00Z'),

  -- Paid, unaffiliated, **and every awkward string in one row**: an apostrophe, a non-ASCII
  -- letter, a comma inside a field and a double quote. It is the CSV escaping case and the
  -- HTML escaping case at the same time, which is why it is one entrant rather than four.
  ('0e0e0e0e-0000-4000-8000-000000000102', '0e0e0e0e-0000-4000-8000-000000000001',
   'paid', 1700, '0e0e0e0e-0000-4000-8000-000000000012',
   'ines@example.com', 'Inés O''Rourke',
   '{"entryTerms":true,"medical":false}'::jsonb, 'zz-admin-v1',
   '2026-08-02T10:31:00Z', '2026-08-02T10:20:00Z', null, null, null, null,
   '2026-08-02T10:00:00Z'),

  -- A live hold: somebody is on the payment page right now, and the place is theirs for
  -- thirty-one minutes. Dated from `now()` so it is always live on whatever day this is run.
  ('0e0e0e0e-0000-4000-8000-000000000103', '0e0e0e0e-0000-4000-8000-000000000001',
   'pending', 1700, '0e0e0e0e-0000-4000-8000-000000000012',
   'jonah@example.com', 'Jonah Pike',
   '{"entryTerms":true,"medical":false}'::jsonb, 'zz-admin-v1',
   now() + interval '31 minutes', null, null, null, null, null,
   now()),

  -- A hold that ran out. The place went back into the pool the instant it lapsed.
  ('0e0e0e0e-0000-4000-8000-000000000104', '0e0e0e0e-0000-4000-8000-000000000001',
   'expired', 1700, '0e0e0e0e-0000-4000-8000-000000000012',
   'kwame@example.com', 'Kwame Adjei',
   '{"entryTerms":true,"medical":false}'::jsonb, 'zz-admin-v1',
   '2026-08-03T11:31:00Z', null, null, null, null, null,
   '2026-08-03T11:00:00Z'),

  -- **The row this page exists to make impossible to miss.** Their hold lapsed, the last place
  -- went, and then their payment arrived. The money is real, the place is consumed, and until
  -- somebody clears the flag the field is one larger than capacity.
  ('0e0e0e0e-0000-4000-8000-000000000105', '0e0e0e0e-0000-4000-8000-000000000001',
   'paid', 1500, '0e0e0e0e-0000-4000-8000-000000000011',
   'lena@example.com', 'Lena Sørensen',
   '{"entryTerms":true,"medical":false}'::jsonb, 'zz-admin-v1',
   '2026-08-04T12:31:00Z', '2026-08-04T12:58:00Z', '2026-08-04T12:58:00Z',
   'over_capacity', '2026-08-04T12:58:00Z',
   '{"capacity":3,"taken":3,"wanted":1}'::jsonb,
   '2026-08-04T12:00:00Z'),

  -- Refunded, which returns the place and — an oddity Slice C recorded rather than fixed —
  -- erases when the money arrived.
  ('0e0e0e0e-0000-4000-8000-000000000106', '0e0e0e0e-0000-4000-8000-000000000001',
   'refunded', 1700, '0e0e0e0e-0000-4000-8000-000000000012',
   'marek@example.com', 'Marek Toms',
   '{"entryTerms":true,"medical":false}'::jsonb, 'zz-admin-v1',
   '2026-08-05T13:31:00Z', null, null, null, null, null,
   '2026-08-05T13:00:00Z')
on conflict (id) do nothing;

-- **No ea_number column here since 29 August 2026**, and not because the fixtures were
-- tidied: entrants_ea_number_not_collected refuses a value in it, so a seed that named one
-- would fail to load. The affiliated entry below is still affiliated — it is the fee that says
-- so, and nothing about the runner.
insert into entries.entrants (
  id, purchase_id, first_name, last_name, date_of_birth, gender, club,
  emergency_contact_name, emergency_contact_phone, created_at
) values
  -- 40 on race day: the boundary of Vet 40, and the birthday-on-race-day rule with it.
  ('0e0e0e0e-0000-4000-8000-000000000201', '0e0e0e0e-0000-4000-8000-000000000101',
   'Harriet', 'Nwosu', date '1986-12-06', 'female', 'Southville Running Club',
   'Ada Nwosu', '0117 496 0001', '2026-08-01T09:00:00Z'),

  -- The awkward one. The club name carries a comma **and** a double quote on purpose.
  ('0e0e0e0e-0000-4000-8000-000000000202', '0e0e0e0e-0000-4000-8000-000000000102',
   'Inés', 'O''Rourke', date '2000-12-07', 'female',
   'Bristol & West AC, "the Bees"',
   'Séamus O''Rourke', '0117 496 0002', '2026-08-02T10:00:00Z'),

  -- Non-binary: the club has no category at any age, and the page has to say that rather
  -- than guess one.
  ('0e0e0e0e-0000-4000-8000-000000000203', '0e0e0e0e-0000-4000-8000-000000000103',
   'Jonah', 'Pike', date '1994-04-02', 'non_binary', null,
   'Rae Pike', '0117 496 0003', now()),

  ('0e0e0e0e-0000-4000-8000-000000000204', '0e0e0e0e-0000-4000-8000-000000000104',
   'Kwame', 'Adjei', date '1975-06-30', 'male', 'Left Handed Giant RC',
   'Afua Adjei', '0117 496 0004', '2026-08-03T11:00:00Z'),

  ('0e0e0e0e-0000-4000-8000-000000000205', '0e0e0e0e-0000-4000-8000-000000000105',
   'Lena', 'Sørensen', date '1960-01-15', 'female', null,
   'Nils Sørensen', '0117 496 0005', '2026-08-04T12:00:00Z'),

  ('0e0e0e0e-0000-4000-8000-000000000206', '0e0e0e0e-0000-4000-8000-000000000106',
   'Marek', 'Toms', date '1999-02-28', 'male', null,
   'Eva Toms', '0117 496 0006', '2026-08-05T13:00:00Z')
on conflict (id) do nothing;

-- **One note, on one entrant, and it exists only because that entrant's separate medical
-- consent is true.** The absence of a row is the record of a withheld consent — there is no
-- state in which notes are stored and the consent that would have permitted them is false.
insert into entries.entrant_medical (entrant_id, notes, created_at) values
  (
    '0e0e0e0e-0000-4000-8000-000000000201',
    'Asthma — carries a blue inhaler in a waist belt. Allergic to ibuprofen.',
    '2026-08-01T09:00:00Z'
  )
on conflict (entrant_id) do nothing;
