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
