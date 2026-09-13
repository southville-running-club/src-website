-- The race-timing model, written rather than moved.
--
-- [ADR-035](../../../../../docs/architecture/decisions/adr-035-the-timing-schema-joins-this-project.md).
-- Six tables, every one of them new, in a schema that did not exist a moment ago.
--
-- =========================================================================================
-- ⚠️ This lands while the Nightingale Nightmare entry window is open and selling
-- =========================================================================================
-- 127 places of 250 were gone on the morning this was written, and `deploy-db.yml` applies a
-- migration to production on merge. So every choice below that could have gone two ways went
-- the way that cannot reach `entries`:
--
--   * **Purely additive.** A new schema and new tables. Not one statement alters, drops or
--     re-creates anything in `club`, `intake`, `entries`, `identity` or `store`.
--   * **Not exposed to PostgREST.** `timing` is deliberately *absent* from `[api].schemas`
--     in `config.toml`. Nothing needs to reach it yet - there is no surface - and that file's
--     own comment already makes the argument for `club`: a schema PostgREST has no route to
--     is safe even on the day a grant is wrong. It also means this change cannot perturb the
--     schema cache the live entry form is using. Exposing it is a later, separate line.
--   * **No grants, to anybody.** Not `anon`, not `authenticated`. See below.
--   * **Timestamped to sort last**, after `20260911100000`. `db push` refuses a version
--     earlier than the remote's newest by refusing the *whole* push - which would take the
--     entry form down with it, and is the failure this repository has already paid six hours
--     for.
--
-- =========================================================================================
-- RLS on, and no policy anywhere - which is a state, not an oversight
-- =========================================================================================
-- Every table below enables row-level security and **none of them has a policy**. Under
-- Postgres that means no row is readable or writable by `anon` or `authenticated` at all,
-- whatever the grants say. That is the correct state for a schema whose surfaces do not
-- exist: the results are locked, there is no capture screen, and nothing is published.
--
-- `store` shipped exactly this way and `packages/db/tests/store.test.ts` asserts it, which is
-- the precedent. **A policy arrives with the surface that needs it**, so that each one can be
-- argued about next to the screen it opens rather than written speculatively here.
--
-- =========================================================================================
-- What is deliberately not a column
-- =========================================================================================
-- ⚠️ **`timing.runners` holds no date of birth, no address, no phone number, no emergency
-- contact and no medical information.** The registration parser drops all of them at the
-- boundary and computes `age_on_day` against the race date instead; the raw CSV in storage is
-- the audit trail. That is C10, and it is the same sentence as *personal data is minimised at
-- the boundary*.
--
-- This is the half of that rule the database can actually hold. A parser can be changed; a
-- column that does not exist cannot be filled in by accident, and `timing.test.ts` asserts
-- that these columns are absent rather than merely unused.

create schema if not exists timing;

-- Nothing reaches this schema by being logged in. Every capability is a grant made later,
-- beside the surface that needs it.
revoke all on schema timing from public;

-- -----------------------------------------------------------------------------------------
-- events — one running of one race in one year
-- -----------------------------------------------------------------------------------------
-- The glossary reserves *event* for exactly this, so the name is correct here in a way it was
-- not in `store` - which had to call its table `socials` for the same rule.
create table timing.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,

  -- **`'relay' | 'solo'`, and the whole platform branches on it.** Pass the Buck is a relay;
  -- Nightingale Nightmare is solo. They derive bibs differently, they award different prizes,
  -- and their entry lists have a different number of runners per row.
  format text not null check (format in ('relay', 'solo')),

  start_at timestamptz not null,

  -- Set when the countdown screen broadcasts T-0. **Splits are measured against
  -- `coalesce(actually_started_at, start_at)`**, so a start delayed on the day does not
  -- inflate every runner's time - invisible until the one year the start slips.
  actually_started_at timestamptz,

  distance_m integer check (distance_m is null or distance_m > 0),
  course_notes text,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

alter table timing.events enable row level security;

-- -----------------------------------------------------------------------------------------
-- teams — the unit of entry, even when it holds one runner
-- -----------------------------------------------------------------------------------------
-- The glossary's word, and it is why a solo entrant is still a team: it keeps one model for
-- both races rather than forking the results archive, the bib scheme and the categories.
create table timing.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references timing.events (id) on delete cascade,

  -- Null until bibs are assigned. **A team with no number cannot derive a bib**, so nothing
  -- about it can be captured at the line.
  team_number text,
  name text,
  category text,
  entry_type text,

  -- **The import idempotency anchor.** Re-importing the same file is a no-op because of this
  -- column, which is why it is unique per event rather than merely stored.
  purchase_order_id text,
  csv_row_index integer,

  -- Per-leg overrides, for a walk-in handed a physical bib at the desk. Opaque strings:
  -- `effectiveBib` is `coalesce(override, derived)` and `"0311"` is not `"311"`.
  bib_leg1 text,
  bib_leg2 text,

  -- A whole-team terminal label that replaces the time and sorts last.
  race_status text check (race_status is null or race_status in ('dns', 'dnf', 'dq')),

  -- Frozen legacy column, honoured only as a fallback when `race_status` is null. Carried so
  -- that data already recorded that way still renders as DNF.
  dnf_at timestamptz,

  created_at timestamptz not null default now(),

  unique (event_id, purchase_order_id)
);

create index teams_event_idx on timing.teams (event_id);

alter table timing.teams enable row level security;

-- -----------------------------------------------------------------------------------------
-- runners — one row per participant
-- -----------------------------------------------------------------------------------------
create table timing.runners (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references timing.teams (id) on delete cascade,

  -- 1 or 2. A solo entry has leg 1 only, which is also the leg its bib derives from.
  leg smallint not null check (leg in (1, 2)),

  firstname text not null,
  lastname text not null,

  -- As the import found it - `'M'` / `'F'` in practice, or something it did not recognise.
  -- Unrecognised means no prize band rather than a guess.
  gender text,
  email text,
  club_name text,

  -- ⚠️ **Computed at import against the race date. There is no date of birth here and there
  -- is not going to be one.** This is the column that makes the minimisation rule survive
  -- contact with the prize list: `ageCategoryFor(age, category)` asks for an age, which is
  -- exactly what was kept.
  age_on_day integer check (age_on_day is null or age_on_day between 0 and 130),

  is_captain boolean not null default false,
  created_at timestamptz not null default now(),

  unique (team_id, leg)
);

create index runners_team_idx on timing.runners (team_id);

alter table timing.runners enable row level security;

-- -----------------------------------------------------------------------------------------
-- crossings — somebody went past the line
-- -----------------------------------------------------------------------------------------
create table timing.crossings (
  -- ⚠️ **Client-generated, and that is the offline queue's whole contract.** A marshal's
  -- phone mints this id when the tap happens and reuses it on every retry, so a commit is
  -- `upsert(on conflict (id) do nothing)` and a flaky signal cannot double-record a runner.
  -- `default gen_random_uuid()` is here for a row created any other way, not for the queue.
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null references timing.events (id) on delete cascade,
  marshal_id uuid references auth.users (id) on delete set null,

  -- ⚠️ **Nullable on purpose.** The capture screen is a queue: the button timestamps
  -- immediately and the bib is typed afterwards. At the line the scarce resource is the
  -- moment, not the marshal's attention - so a crossing exists before anybody knows whose.
  bib text,

  captured_at timestamptz not null,
  source text not null default 'tap' check (source in ('tap', 'manual')),

  -- **An anomaly flags and never blocks.** The marshal resolves it and confirms anyway; an
  -- admin clears it afterwards, when there is time to be right.
  anomaly_flag boolean not null default false,
  anomaly_reason text,
  resolved_at timestamptz,
  resolved_action text,

  -- Resolved from the bib by the trigger below. `on delete set null` rather than cascade: a
  -- team being removed must not delete the record that somebody crossed the line.
  team_id uuid references timing.teams (id) on delete set null,

  created_at timestamptz not null default now()
);

-- Each index earns its place, and the reasons are the ones the original recorded.
--
--   * `(event_id, bib)` covers the leaderboard's double join.
--   * `(event_id, captured_at desc)` covers the marshal's own feed of recent captures.
--   * the partial one keeps the admin's open-anomaly query cheap however many crossings
--     there are, because it indexes only the handful that are still open.
create index crossings_event_bib_idx on timing.crossings (event_id, bib);
create index crossings_event_captured_idx on timing.crossings (event_id, captured_at desc);
create index crossings_open_anomalies_idx on timing.crossings (event_id)
  where anomaly_flag and resolved_at is null;

alter table timing.crossings enable row level security;

-- -----------------------------------------------------------------------------------------
-- marshals — the per-event roster
-- -----------------------------------------------------------------------------------------
-- ⚠️ **This is a scope, not an authority.** Whether somebody may record a crossing at all is
-- `timing.crossing.record`, in `identity`. This says *which races* - and it is checked after
-- the permission rather than instead of it. ADR-036 says so in full; deleting this table
-- would let anybody holding that permission write crossings into any race.
create table timing.marshals (
  event_id uuid not null references timing.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table timing.marshals enable row level security;

-- -----------------------------------------------------------------------------------------
-- admin_actions — what was done to a race, and by whom
-- -----------------------------------------------------------------------------------------
create table timing.admin_actions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references timing.events (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index admin_actions_event_idx on timing.admin_actions (event_id, created_at desc);

alter table timing.admin_actions enable row level security;

-- =========================================================================================
-- Bib resolution — the SQL half of a lockstep
-- =========================================================================================
-- ⚠️ **This function and `packages/shared/src/timing/bib.ts` must agree, exactly.**
-- ADR-034 names that as one of three things the rewrite may not break, and it is the one with
-- **no symptom until a result is wrong** - a runner's time attributed to the wrong person,
-- found after the prizes have been given out.
--
-- The rule, in both places:
--
--   derived  relay: `${leg}${team_number}`  ·  solo: the team_number alone
--   override `teams.bib_leg1` / `bib_leg2`, an empty string treated as absent
--   effective  coalesce(override, derived)
--
-- A bib is an **opaque string**: exact equality, never `parseInt`, never leading-zero
-- normalised. `"0311"` is not `"311"` and team 100's legs are `"1100"` and `"2100"`.
--
-- `search_path` is pinned and the function lives in `timing` rather than a `private` schema -
-- which is what `entries` already does, and why ADR-035 creates no `private` schema at all.
create function timing.resolve_crossing_team_id()
returns trigger
language plpgsql
security definer
set search_path = timing, pg_catalog
as $$
declare
  v_format text;
begin
  if new.bib is null or new.bib = '' then
    new.team_id := null;
    return new;
  end if;

  select format into v_format from timing.events where id = new.event_id;

  select t.id into new.team_id
  from timing.teams t
  where t.event_id = new.event_id
    and (
      -- An override, on either leg. Compared verbatim - opaque.
      (t.bib_leg1 is not null and t.bib_leg1 <> '' and t.bib_leg1 = new.bib)
      or (t.bib_leg2 is not null and t.bib_leg2 <> '' and t.bib_leg2 = new.bib)
      -- Or the derived form, but only on a leg that has no override to beat it.
      or (
        t.team_number is not null
        and (
          (v_format = 'solo' and coalesce(nullif(t.bib_leg1, ''), t.team_number) = new.bib)
          or (
            v_format = 'relay'
            and (
              coalesce(nullif(t.bib_leg1, ''), '1' || t.team_number) = new.bib
              or coalesce(nullif(t.bib_leg2, ''), '2' || t.team_number) = new.bib
            )
          )
        )
      )
    )
  limit 1;

  return new;
end;
$$;

create trigger crossings_resolve_team
  before insert or update of bib, event_id on timing.crossings
  for each row
  execute function timing.resolve_crossing_team_id();

-- Granted to nobody. It is reachable only from the trigger above, which is the same shape
-- `entries` uses for the helpers that must not be callable in their own right.
revoke all on function timing.resolve_crossing_team_id() from public;
