-- The first table: `intake.nn_interest`.
--
-- Four columns, and no more. **Adding a fifth is a committee decision, not a build
-- decision** — see C10. Not date of birth, not phone, not emergency contact, not England
-- Athletics number. The timing platform already implements this boundary at its CSV parser
-- and drops those columns before they reach storage; this table inherits the same rule by
-- never having them.
--
-- Shape decided in ADR-002. Created now because the seeding process needs somewhere real
-- to put rows, and a fabricated table would have drifted from the one that matters.
--
--   name       what the person typed
--   email      how the club replies
--   consent    explicit, and false is a legitimate stored value
--   created_at UTC, always
--
-- **No policies yet, deliberately.** RLS is enabled, so with no policy the table is
-- unreachable through PostgREST by anyone — anon and authenticated alike. The
-- anonymous-insert policy arrives with the sign-up form that needs it, in the pull request
-- that can test it. Enabling RLS from the first migration and adding policies later is the
-- safe order; the reverse leaves a window.

create table intake.nn_interest (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  email text not null check (position('@' in email) > 1),
  consent boolean not null,
  created_at timestamptz not null default now()
);

comment on table intake.nn_interest is
  'Expressions of interest in Nightingale Nightmare. Four columns by design — adding one is a committee decision (C10).';
comment on column intake.nn_interest.consent is
  'Explicit consent to be contacted about the race. Recorded as given, never assumed.';

-- One person, one expression of interest. This is what makes a double-submitted form
-- harmless: the second insert conflicts rather than creating a second row, which is the
-- behaviour the acceptance tests will assert against.
create unique index nn_interest_email_key
  on intake.nn_interest (lower(email));

-- Row-level security from the first migration, with no exceptions and no "we will add it
-- later". With RLS on and no policy, nothing reaches this table through the API at all.
alter table intake.nn_interest enable row level security;
