-- The `entries` schema — paid race entries, and the event configuration that drives them.
--
-- **A third schema, and the reason is the same one that gave us the first two.** `club` is
-- membership, `intake` is what a stranger may post into. An entry is neither: it is a
-- commercial transaction with a payment reference attached, held for a season and then
-- reduced. The schema boundary is the blast radius, and a policy that is wrong on `entries`
-- is wrong about money and about special category data at the same time.
--
-- Entries were going to live in their own repository. They do not, and
-- adr-009-entries-in-the-monorepo.md records why — this monorepo already runs two Workers
-- behind one hostname, and a third repository would have duplicated CI, conventions and
-- review load for two volunteers.
--
-- ---------------------------------------------------------------------------------------
-- What this migration deliberately does NOT do
-- ---------------------------------------------------------------------------------------
-- **It grants the anon role nothing on any table in this schema.** Not insert, not select.
-- The entry form built alongside this migration validates and stops; it does not write. The
-- grant and the policy arrive with the thing that needs them, in the pull request that can
-- test them — which is exactly the order `intake.nn_interest` was built in, and the safe
-- one. RLS on from the first migration with no policy denies everybody, including the role
-- whose key is published in client code.
--
-- `tests/entries.test.ts` asserts that refusal on every table below, by error code, and that
-- assertion is written to outlive this slice: when a policy is added it will be added for
-- one verb on one table, and the other refusals must still hold.
--
-- ---------------------------------------------------------------------------------------
-- The one door, and why it is a function rather than a grant
-- ---------------------------------------------------------------------------------------
-- The page at `/nn/` has to know whether entries are open, because that is what decides
-- whether it shows the entry form or the interest form — and the brief is explicit that the
-- switch is driven by this event row rather than by a deploy.
--
-- A select grant on `entries.events` would do it, and it is the wrong shape: it would make
-- the "anon can select nothing here" test carry an exception from its first day, and an
-- exception in an access-control test is how the next one gets waved through. So the door
-- is `entries.entry_state()` at the foot of this file — a `security definer` function
-- returning the handful of public facts a form needs, with `execute` to anon and **no table
-- privilege anywhere**. The refusal test stays literally true, forever.
--
-- The helper belongs in a `private` schema by the pattern the timing platform uses. It is
-- not there, because `private` belongs to the timing platform and this repository does not
-- touch it (adr-002, and `scripts/check-migration-scope.mjs` enforces it). It lives in
-- `entries` with the same `search_path` pinning, which is the property that mattered.
--
-- See docs/architecture/principles.md#row-level-security-is-the-access-control

-- ---------------------------------------------------------------------------------------
-- citext
-- ---------------------------------------------------------------------------------------
-- **A new extension in a shared production database, so it is worth being explicit.** It is
-- additive and reversible, it ships with Postgres, and Supabase installs it into the
-- `extensions` schema like every other one.
--
-- Two columns want it and both are things a person types twice: a discount code read off a
-- club newsletter, and an email address typed by somebody who capitalises the first letter.
-- `intake.nn_interest` solves the same problem with a unique index on `lower(email)`, which
-- works and which makes every comparison after it the caller's problem to remember. Here
-- the same address is matched from more than one direction — a webhook, a confirmation
-- resend, a duplicate check — so the case-insensitivity belongs in the type.
create extension if not exists citext with schema extensions;

create schema if not exists entries;

comment on schema entries is
  'Race entries, event configuration and payment references. RLS on every table; anon reaches it only through entries.entry_state(). Owned by packages/db.';

-- `usage` lets a request name an object in the schema. It grants nothing on the objects
-- themselves — every table below has RLS enabled and no grant at all, so naming one gets a
-- 42501 rather than a row.
grant usage on schema entries to anon, authenticated;

-- Belt and braces against a future table arriving without its own explicit grant decision.
alter default privileges in schema entries revoke all on tables from anon, authenticated;
alter default privileges in schema entries revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------
-- events — every event-specific value, so a future race is an INSERT and not a deploy
-- ---------------------------------------------------------------------------------------
-- **This table is the argument against hard-coding Nightingale Nightmare.** The minimum
-- age, whether a date of birth is collected at all, how many people one entry covers, when
-- the window opens: all of them are columns here rather than constants in TypeScript,
-- because the next race the club puts on will differ in exactly these ways and should not
-- need a build to say so. There is no event-creation interface and there does not need to
-- be one; a new event is a reviewed `insert` in a migration.
--
-- **`event_date` and `start_time` are civil time, not an instant, and that is deliberate.**
-- "Sunday 1 November 2026, 11:00" is what the committee decided and what the poster says;
-- it does not move if somebody reads it from another timezone. The storage-UTC rule governs
-- *instants* — `created_at`, `paid_at`, `entries_open_at` — and every one of those below is
-- `timestamptz`. Storing the start as a `timestamptz` would have meant choosing an offset
-- for a race held six days after the clocks go back, which is precisely the foot-gun
-- `packages/shared/src/london-time.ts` exists to keep away from.
create table entries.events (
  id uuid primary key default gen_random_uuid(),

  -- What a URL and a test can name an event by, and it never changes once published.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  display_name text not null check (length(trim(display_name)) between 1 and 120),

  event_date date not null,
  start_time time not null,

  -- 1 for Nightingale Nightmare, 2 for Pass the Buck. It is what decides how many entrant
  -- blocks the form renders, and it is why `entrants` is a separate table from the purchase
  -- rather than a set of columns on it.
  entrants_per_entry int not null default 1 check (entrants_per_entry between 1 and 8),

  capacity int not null check (capacity > 0),

  -- **Null means "not yet", and that is a real state rather than a missing value.** The
  -- 2026 entry-opening time has not been decided, and a plausible placeholder here would be
  -- a published claim about when a race opens. `entry_state()` reads a null `entries_open_at`
  -- as `pre_open`, which is what a visitor should be told: you cannot enter yet.
  entries_open_at timestamptz,
  entries_close_at timestamptz,

  -- **Null means no check, and it is null for Nightingale Nightmare.** A minimum age of 18
  -- is *implied* by the category structure — the youngest category is Senior 18–39 — and it
  -- has not been confirmed by the committee. Inferring a rule that turns entrants away from
  -- a prize category that happens to start at 18 is not a build decision. Turning it on when
  -- it is confirmed is one `update` and no deploy, which is the whole point of it being a
  -- column.
  minimum_age int check (minimum_age between 0 and 120),

  -- Date of birth is collected because the age categories are derived from it. An event that
  -- does not award age categories should not be asking, and this is what lets it not.
  requires_dob boolean not null default true,

  -- Where confirmation email for this event is sent from. Operational, never rendered to a
  -- browser, and deliberately absent from what `entry_state()` returns.
  from_address text not null check (position('@' in from_address) > 1),

  -- Which wording of the consents an entry was taken under. Stored again on each purchase,
  -- so a later change to the wording cannot rewrite what somebody actually agreed to.
  consent_version text not null check (length(trim(consent_version)) between 1 and 40),

  active boolean not null default true,

  -- A window that closes before it opens is a configuration mistake that would read to a
  -- visitor as an outage. Cheaper to refuse it here than to debug it in November.
  constraint events_window_ordered check (
    entries_open_at is null
    or entries_close_at is null
    or entries_close_at > entries_open_at
  )
);

comment on table entries.events is
  'One running of one race in one year, and every value that differs between events. A new event is an INSERT, not a deploy.';
comment on column entries.events.minimum_age is
  'Null means no age check. Null for NN 2026: 18 is implied by the category structure and has not been confirmed by the committee.';
comment on column entries.events.entries_open_at is
  'Null means entries have not opened and no opening time has been decided. Never a placeholder.';
comment on column entries.events.start_time is
  'Civil local time, as published. Not an instant — see the note in this migration about the clocks change.';

-- ---------------------------------------------------------------------------------------
-- fees — the price, and the only place it exists
-- ---------------------------------------------------------------------------------------
-- **The price lives here and never as a Stripe Product or Price object.** It is passed as
-- `price_data` when a Checkout session is created, so what the club charges is what this
-- row says at that moment, reviewable in a migration and readable without logging into a
-- payment processor. A price held in two systems is a price that will disagree with itself,
-- and the copy that is wrong will be the one in the dashboard nobody opened.
--
-- Pence, as an integer. Money in a float is a defect waiting for a discount percentage.
create table entries.fees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references entries.events (id) on delete cascade,

  -- **Adding a fourth code is a migration, deliberately.** A fee code is what the form
  -- offers and what the card is charged; it should arrive in a diff somebody approved
  -- rather than as a row somebody inserted. A team-entry code for Pass the Buck is the
  -- known next one.
  code text not null check (code in ('affiliated', 'unaffiliated', 'vi_guide')),

  label text not null check (length(trim(label)) between 1 and 60),
  price_pence int not null check (price_pence >= 0),

  -- Affiliated entry is £2 cheaper because England Athletics rebates the levy for a
  -- registered athlete. The number is collected and format-checked and **is not verified** —
  -- see the note in packages/shared/src/nn-entry.ts.
  requires_ea_number boolean not null default false,

  -- An early-bird price is a second row with a window rather than an edit to this one, so
  -- what an entry was sold at stays readable after the price moves.
  valid_from timestamptz,
  valid_to timestamptz,

  active boolean not null default true,

  unique (event_id, code),

  constraint fees_window_ordered check (
    valid_from is null or valid_to is null or valid_to > valid_from
  )
);

comment on table entries.fees is
  'What an entry costs, in pence. The only definition of the price — never a Stripe Price object.';

-- ---------------------------------------------------------------------------------------
-- discount_codes — the table, and no rows
-- ---------------------------------------------------------------------------------------
-- A Long Ashton code existed in 2023: 10% off an unaffiliated entry, 22 places. **Whether
-- it returns for 2026 has not been decided**, so the table is here and it is empty. Seeding
-- a code nobody has agreed to would be a discount the club is offering.
create table entries.discount_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references entries.events (id) on delete cascade,

  -- citext: somebody typing a code off a newsletter should not have to match its case.
  code extensions.citext not null check (length(trim(code::text)) between 1 and 40),

  percent_off int not null check (percent_off between 1 and 100),

  -- Null is unlimited. The 2023 code was capped at 22, which is the shape this is for.
  max_uses int check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),

  active boolean not null default true,

  unique (event_id, code),

  constraint discount_codes_within_max_uses check (max_uses is null or uses <= max_uses)
);

comment on table entries.discount_codes is
  'Percentage discounts, per event. Deliberately empty: the 2023 LHGRC code has not been confirmed for 2026.';

-- ---------------------------------------------------------------------------------------
-- entry_purchases — one payment, covering one or more entrants
-- ---------------------------------------------------------------------------------------
-- The purchase is the transaction and the entrant is the runner. They are separate because
-- one payment can cover two runners in a paired race, and because a refund, an expiry and a
-- Stripe reference all belong to the money rather than to the person.
create table entries.entry_purchases (
  id uuid primary key default gen_random_uuid(),

  -- No cascade. An event with money taken against it is not something to delete by removing
  -- its parent row, and the restriction is the reminder.
  event_id uuid not null references entries.events (id),

  status text not null check (status in ('pending', 'paid', 'expired', 'refunded')),

  -- **The reference, never the instrument.** No card number, no last four, no expiry
  -- reaches this database — Stripe Checkout is hosted by Stripe, which is what keeps the
  -- club out of PCI scope. Unique so a webhook delivered twice cannot create two purchases.
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,

  -- What was actually charged, after any discount. Stored rather than recomputed, because
  -- the fee row may legitimately change afterwards and a receipt must not.
  amount_pence int not null check (amount_pence >= 0),

  fee_id uuid not null references entries.fees (id),
  discount_code_id uuid references entries.discount_codes (id),

  purchaser_email extensions.citext not null
    check (position('@' in purchaser_email::text) > 1),
  purchaser_name text not null check (length(trim(purchaser_name)) between 1 and 120),

  -- What was ticked, as ticked. A jsonb object rather than a column per checkbox: the set of
  -- consents differs between events and between years, and a boolean column added for one
  -- race is a column every other race carries a null in.
  consents jsonb not null check (jsonb_typeof(consents) = 'object'),
  consent_version text not null check (length(trim(consent_version)) between 1 and 40),

  -- A place held while somebody is on Stripe's payment page. Null once paid.
  hold_expires_at timestamptz,
  paid_at timestamptz,

  created_at timestamptz not null default now(),

  -- A purchase cannot be paid without saying when. The two facts always travel together and
  -- a `paid` row with a null timestamp is the kind of thing only a reconciliation finds.
  constraint entry_purchases_paid_has_timestamp check (
    (status = 'paid') = (paid_at is not null)
  )
);

comment on table entries.entry_purchases is
  'One payment for one or more entrants. Holds the Stripe reference and never the payment instrument.';
comment on column entries.entry_purchases.consents is
  'What was ticked, as ticked, under consent_version. Medical consent is recorded here even though the notes live in entrant_medical.';

create index entry_purchases_event_status_idx
  on entries.entry_purchases (event_id, status);
create index entry_purchases_purchaser_email_idx
  on entries.entry_purchases (purchaser_email);

-- ---------------------------------------------------------------------------------------
-- entrants — the runner
-- ---------------------------------------------------------------------------------------
-- **No age column, and no category column.** The category is derived at read time from
-- `date_of_birth` and `gender` against the event's date, exactly as the timing platform
-- derives it. A stored category is wrong the moment a birthday passes or an event date
-- moves, and it is wrong silently.
create table entries.entrants (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: an entrant without a purchase is not a thing. Deleting the purchase is how an
  -- entry is removed, and it must not leave a runner behind.
  purchase_id uuid not null references entries.entry_purchases (id) on delete cascade,

  first_name text not null check (length(trim(first_name)) between 1 and 60),
  last_name text not null check (length(trim(last_name)) between 1 and 60),

  date_of_birth date not null,

  -- **Three values, and the gap between them and the prize categories is not resolved
  -- here.** A non-binary option existed on the 2023 form and there were no non-binary
  -- categories to put those entrants in. Recording the answer somebody gave is right;
  -- inventing a category structure to receive it is a committee decision.
  gender text not null check (gender in ('female', 'male', 'non_binary')),

  club text check (club is null or length(trim(club)) between 1 and 120),

  -- Format-checked at the boundary, never verified — England Athletics publishes no
  -- verification API. See packages/shared/src/nn-entry.ts.
  ea_number text check (ea_number is null or ea_number ~ '^[0-9]{6,8}$'),

  -- Null for a solo race. Which leg of a paired race this runner takes.
  leg int check (leg is null or leg > 0),

  emergency_contact_name text not null
    check (length(trim(emergency_contact_name)) between 1 and 120),
  emergency_contact_phone text not null
    check (length(trim(emergency_contact_phone)) between 1 and 40),

  created_at timestamptz not null default now()
);

comment on table entries.entrants is
  'One runner on one entry. Age category is derived from date_of_birth and gender at read time, never stored.';
comment on column entries.entrants.ea_number is
  'Format-checked only. England Athletics publishes no verification API; the affiliated discount is spot-checked by a human.';

create index entrants_purchase_idx on entries.entrants (purchase_id);

-- ---------------------------------------------------------------------------------------
-- entrant_medical — a separate table, and the reason is the law
-- ---------------------------------------------------------------------------------------
-- **Free-text medical information is special category data under UK GDPR (Article 9).** It
-- is not "one more optional field on the entrant"; it needs its own explicit consent, its
-- own access control, and a shorter retention than the rest of an entry.
--
-- A separate table is what makes each of those a simple thing rather than a careful thing:
--
--   * **Retention.** "Delete the medical information one month after the race" is
--     `delete from entries.entrant_medical` joined to the event. As a column on `entrants`
--     it would be a column-scoped `update ... set notes = null` that has to be right about
--     which rows it touches, run against the table holding everybody's name.
--
--   * **Access.** A future policy granting a first-aid lead sight of medical notes grants it
--     on this table and reaches nothing else. On a column it would need column-level
--     privileges and a policy that agrees with them.
--
--   * **Consent.** The row exists only when the separate medical consent was given, so the
--     absence of a row is the record of a withheld consent. There is no state where notes
--     are stored and the consent that would have permitted them is false — a filter cannot
--     be forgotten if there is nothing to filter.
--
-- The consent itself is recorded on the purchase alongside the others; the *notes* are only
-- here. Minimisation happens at the boundary: `apps/main/worker/nn-entry.ts` drops the notes
-- before they reach the database when the box is not ticked, rather than storing them and
-- filtering later.
create table entries.entrant_medical (
  entrant_id uuid primary key references entries.entrants (id) on delete cascade,
  notes text not null check (length(trim(notes)) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table entries.entrant_medical is
  'Special category data under UK GDPR Article 9. Separate table so retention is a DELETE and access is a policy on one object. A row exists only where the separate medical consent was given.';

-- ---------------------------------------------------------------------------------------
-- Row-level security, on every table, from its first migration
-- ---------------------------------------------------------------------------------------
-- With RLS enabled and no policy, nothing reaches these tables through PostgREST at all —
-- and with no grant either, a request is refused a step earlier still, at `42501`, before
-- row-level security is consulted. Two independent locks, and this migration opens neither.
alter table entries.events enable row level security;
alter table entries.fees enable row level security;
alter table entries.discount_codes enable row level security;
alter table entries.entry_purchases enable row level security;
alter table entries.entrants enable row level security;
alter table entries.entrant_medical enable row level security;

-- ---------------------------------------------------------------------------------------
-- The Nightingale Nightmare 2026 event, and its three fees
-- ---------------------------------------------------------------------------------------
-- Seeded by migration rather than by `seed.sql`, because this is a real event and not a
-- local fixture: production needs this row, and `seed.sql` never runs against production.
--
-- **Every value here is confirmed.** Date, start time, distance and field size come from the
-- club's published campaign artwork, the same source `src/content/race.json` already quotes.
-- The two that are not confirmed are `null` rather than plausible: the entry window, and the
-- minimum age.
insert into entries.events (
  slug,
  display_name,
  event_date,
  start_time,
  entrants_per_entry,
  capacity,
  entries_open_at,
  entries_close_at,
  minimum_age,
  requires_dob,
  from_address,
  consent_version,
  active
) values (
  'nn-2026',
  'Nightingale Nightmare 2026',
  date '2026-11-01',
  time '11:00',
  1,
  250,
  -- Not decided. `pre_open` until it is, which is what the site says today.
  null,
  null,
  -- Not confirmed. See the column comment.
  null,
  true,
  'nightingalenightmare@gmail.com',
  'nn-2026-v1',
  true
)
on conflict (slug) do nothing;

-- £15 affiliated, £17 unaffiliated, £0 for a visually impaired runner's guide. The guide is
-- free because they are not racing; they are how somebody else can.
insert into entries.fees (event_id, code, label, price_pence, requires_ea_number)
select
  event.id,
  fee.code,
  fee.label,
  fee.price_pence,
  fee.requires_ea_number
from entries.events as event
cross join (
  values
    ('affiliated', 'Affiliated', 1500, true),
    ('unaffiliated', 'Unaffiliated', 1700, false),
    ('vi_guide', 'VI guide', 0, false)
) as fee (code, label, price_pence, requires_ea_number)
where event.slug = 'nn-2026'
on conflict (event_id, code) do nothing;

-- ---------------------------------------------------------------------------------------
-- entries.entry_state() — the only thing anon may call, and all it may learn
-- ---------------------------------------------------------------------------------------
-- Returns what a browser needs to render an entry form and nothing else: whether the window
-- is open, the handful of configuration values the shared validation schema needs, and the
-- fees with their prices.
--
-- **What it deliberately leaves out**, because minimisation applies to configuration too:
--
--   * `from_address` — operational, and an address in page source is an address a scraper
--     collects.
--   * the event's `id` — a browser has no use for a primary key it cannot write with.
--   * `entries_open_at` / `entries_close_at` — the page cannot say "entries open at 7am on
--     the 1st" because nobody has decided that, and a field returned before it has a
--     meaning is a field somebody renders. Adding them later is additive.
--   * anything at all from the four tables holding a person.
--
-- `security definer` so it can read tables the caller has no privilege on; `set search_path
-- = ''` and fully-qualified names throughout, because an unpinned search_path on a definer
-- function is the standard Postgres escalation. Both are the pattern `intake.health()`
-- already follows and the timing platform pins on every one of its helpers.
--
-- `stable` rather than `immutable`: it reads tables and it reads the clock.
create or replace function entries.entry_state(p_slug text)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
    'slug', event.slug,
    'display_name', event.display_name,
    'state',
      case
        when not event.active then 'closed'
        when event.entries_open_at is null then 'pre_open'
        when pg_catalog.now() < event.entries_open_at then 'pre_open'
        when event.entries_close_at is not null
             and pg_catalog.now() >= event.entries_close_at then 'closed'
        else 'open'
      end,
    'event_date', event.event_date,
    'start_time', event.start_time,
    'entrants_per_entry', event.entrants_per_entry,
    'capacity', event.capacity,
    'minimum_age', event.minimum_age,
    'requires_dob', event.requires_dob,
    'consent_version', event.consent_version,
    'fees', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'code', fee.code,
                   'label', fee.label,
                   'price_pence', fee.price_pence,
                   'requires_ea_number', fee.requires_ea_number
                 )
                 -- Dearest first is not a display choice made here; it is a stable order so
                 -- the radio group cannot reshuffle itself between two page loads.
                 order by fee.price_pence desc, fee.code
               )
          from entries.fees as fee
         where fee.event_id = event.id
           and fee.active
           and (fee.valid_from is null or fee.valid_from <= pg_catalog.now())
           and (fee.valid_to is null or fee.valid_to > pg_catalog.now())
      ),
      '[]'::jsonb
    )
  )
  from entries.events as event
  where event.slug = p_slug;
$$;

comment on function entries.entry_state(text) is
  'Public configuration for one event: window state and fees. Reads no personal data and returns no table privilege. The only object in this schema anon may reach.';

-- `from public` is the PUBLIC pseudo-role — everyone — not a schema. Revoking first means
-- the grant below is the complete list of who may call this.
revoke all on function entries.entry_state(text) from public;
grant execute on function entries.entry_state(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Why this is safe to deploy in either order
-- ---------------------------------------------------------------------------------------
-- Nothing sequences a migration against the Cloudflare deploy — Workers Builds triggers on
-- the push, not on a green CI run — so this and the Worker that reads it go out
-- concurrently and in no guaranteed order. Both directions are survivable:
--
--   * **Migration first, Worker later.** The deployed Worker knows nothing about
--     `entry_state()`, so a function it never calls changes nothing for it.
--
--   * **Worker first, migration later.** `entry_state()` does not exist, the RPC fails, and
--     `apps/main/worker/nn-entry.ts` treats an unreadable event exactly as it treats a
--     closed one: it shows the interest form, which is the page that was already there.
--     A window it cannot read is never resolved as "open" — the failure direction is
--     towards taking no entries rather than towards taking entries nobody can be charged
--     for.
--
-- Expand, migrate, contract: this is an expand step with nothing to contract, because it
-- removes nothing and changes no existing object.
