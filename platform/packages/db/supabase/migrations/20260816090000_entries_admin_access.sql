-- The first read path in this schema, and the door it goes through.
--
-- Every read before this one returned a fixed, non-personal shape: `entry_state()` answers
-- with configuration, `entry_completion_state()` answers with one word. **Nothing in this
-- platform has ever read a person out of `entries`.** The admin surface does — names, clubs,
-- England Athletics numbers, emergency contacts and, behind a deliberate act, medical notes.
-- So the access model is settled here, in its own migration, before anything reads anything.
--
-- ADR-013 is the argument. This file is the mechanism.
--
-- =========================================================================================
-- The constraint that decides the shape
-- =========================================================================================
-- **Every request this platform makes to Postgres carries the anon key, and the anon key is
-- published in page source.** There is no second credential: `config.toml`'s `[auth]` block
-- has `enable_signup` off and nothing here signs in, the service role key never reaches a
-- Worker or this repository, and ADR-010 already refused the remaining option in as many
-- words — *"inventing one — a second Postgres role reached with a hand-minted JWT — would be
-- the least boring thing in the repository, resting on assumptions about a hosted platform
-- that fail silently."*
--
-- So an admin read function **must** be granted to `anon`, exactly like the seven before it,
-- and the grant is made safe by a key rather than by the role. That is `record_checkout_event`'s
-- shape and it is deliberately reused rather than reinvented: one mechanism in this schema for
-- "a caller who holds more than the published key", one place to audit it.
--
-- =========================================================================================
-- Two credentials, and why one is not enough
-- =========================================================================================
-- **`ENTRIES_ADMIN_KEY` — a Worker secret.** It gates every admin function below and every
-- admin route in the Worker. Its SHA-256 digest lives in `entries.webhook_secrets` under the
-- name `admin`, and it ships **null**, which refuses everything. That is the whole of the
-- authorisation: without it, nothing in the admin surface can be reached, and the routes do
-- not answer at all.
--
-- **A per-person key — a row in `entries.admin_keys`.** It answers a different question:
-- *which human*. The Worker cannot answer that from a secret it holds itself, and §3 of this
-- slice requires an export to record who took it. One shared password would make that line a
-- fiction, and would mean revoking one volunteer's access revokes both.
--
-- The two compose so that neither is redundant:
--
--   * A person key alone is worthless — every function checks the Worker's key **first**, and
--     `admin_sign_in` refuses on it before it looks at the person key at all. So the published
--     anon key does not become an oracle for guessing person keys.
--   * The Worker's key alone identifies nobody — it is what lets the Worker read, not what
--     says who asked.
--
-- **Revoking one person is one `update` and no deploy.** Rotating the Worker's key is one
-- `wrangler secret put` and one `update`. Neither touches the other.
--
-- =========================================================================================
-- What is still true after this migration
-- =========================================================================================
-- **The anon role still holds no grant on any table in this schema**, and Slice A's refusals
-- — every table, every verb, by error code — pass untouched. Two new tables are added to that
-- walk in the same commit. If one of those refusals ever starts failing, something granted a
-- privilege that a key published in page source would then carry.
--
-- =========================================================================================
-- Expand, migrate, contract
-- =========================================================================================
-- Two tables nobody reads, one row with a null digest, and three functions nobody calls.
-- Nothing existing changes shape and nothing is removed, so both deploy orders survive:
--
--   * **Migration first, Worker later.** Objects the deployed Worker has never heard of.
--   * **Worker first, migration later.** `admin_sign_in` does not exist, PostgREST answers
--     `PGRST202`, and the Worker treats an unreadable answer as a refused sign-in. The failure
--     direction is towards nobody getting in, which is the only safe direction for a door.

-- -----------------------------------------------------------------------------------------
-- The Worker's key — a second row in the table that already does this
-- -----------------------------------------------------------------------------------------
-- **`entries.webhook_secrets` is now narrower in name than in contents, and renaming it was
-- considered and refused.** What the table actually holds is "the digest of a shared key a
-- caller must present, never the key" — which is exactly what this needs, down to the null
-- default meaning "not connected yet". A rename is a contract step: it buys a better noun and
-- costs a window in which the deployed webhook cannot find its own secret. Expand, migrate,
-- contract says the rename waits for a migration that has a reason of its own.
comment on table entries.webhook_secrets is
  'The digest of a shared key a caller must present, never the key. Two rows: `stripe` for the payment webhook, `admin` for the admin surface. RLS on, no policy, no grant — reachable only from the security definer functions that check them. If tests/entries.test.ts stops refusing this table, two credential digests became readable with a key that is published in page source.';

-- Ships null, which refuses everything. Installing it is one documented manual step in
-- `apps/main/README.md`, and until it is done `/nn/admin` does not answer.
insert into entries.webhook_secrets (name) values ('admin')
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------------------
-- entries.admin_keys — one row per person who may look
-- -----------------------------------------------------------------------------------------
-- **`name` is a handle, not a person's name, and that is a data-protection decision rather
-- than a naming convention.** It goes into every audit row below, so a first name here would
-- put personal data into a table whose whole purpose is to be kept and read later. The
-- check constraint enforces the slug shape; **the runbook holds the mapping from handle to
-- human**, which is the one place it belongs.
--
-- **The digest, never the key** — the same property `webhook_secrets` has and for the same
-- reason: a leak of this table yields SHA-256 over 32 random bytes, which is not a preimage
-- anybody is finding. It is also why the comparison in `admin_sign_in` need not be constant
-- time: a perfect timing oracle would reveal the digest, which is already assumed public.
--
-- **No rows.** A key issued by a migration would be a credential in this repository. Issuing
-- one is a documented manual step, and the local development fixture lives in `seed.sql`,
-- which never runs against production.
create table entries.admin_keys (
  name text primary key check (name ~ '^[a-z][a-z0-9-]{0,39}$'),

  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),

  issued_at timestamptz not null default now(),

  -- **Non-null is how one person is turned off without touching anybody else.** Not a
  -- delete: the audit rows below name a handle, and a handle that no longer exists anywhere
  -- makes six months of audit unreadable.
  revoked_at timestamptz,

  -- The only signal that a key is in use. A key that has never been used is either a spare
  -- or a mistake, and both are worth being able to see.
  last_used_at timestamptz
);

comment on table entries.admin_keys is
  'One row per person who may read the admin surface. The digest of their key, never the key. `name` is a handle and never a person''s name — it lands in entries.admin_audit, and the handle-to-human mapping lives in docs/delivery/runbooks/entries-admin.md.';
comment on column entries.admin_keys.revoked_at is
  'Set to turn one person off. Not a delete — the audit rows name this handle, and removing it would make them unreadable.';

alter table entries.admin_keys enable row level security;

-- -----------------------------------------------------------------------------------------
-- entries.admin_audit — what was looked at, by which handle, and when
-- -----------------------------------------------------------------------------------------
-- **Four actions, not every page view.** A row per list render would be a table nobody reads,
-- growing on every refresh, and it would bury the entries that actually matter. What is
-- recorded is the four things somebody might later have to answer for:
--
--   `sign_in`        somebody opened the door.
--   `medical_note`   somebody read one entrant's special category data, on screen.
--   `medical_export` somebody took **a copy of every medical note** out of the platform.
--   `export`         somebody took a copy of the other data out.
--
-- **`medical_export` is its own value rather than `export` with a kind, and that is the whole
-- point of the split.** The question an access review asks is *"who has read medical data"*,
-- and the honest answer has to include the person who downloaded the entire file — by far the
-- larger disclosure — beside the person who clicked one note. With one `export` value the
-- query that answers that question has to know to look inside `detail ->> 'kind'`, and the
-- runbook's did not: it matched `medical_note` only, so the CSV was invisible and the single
-- note was not. Making it a value means the two medical reads are found by
-- `action in ('medical_note', 'medical_export')` and cannot be missed by forgetting a `->>`.
--
-- It also means adding a fifth kind of read has to change this check constraint, which is a
-- diff somebody looks at — the property this schema keeps reaching for.
--
-- **The contents are never recorded, and no constraint can enforce that** — so the callers
-- are written so there is nothing to enforce: `detail` carries an event slug, an export kind,
-- a row count and, for a medical read, the entrant id whose note was shown. The entrant id is
-- the point of that row; a linkage between a handle and an entrant is exactly what an audit of
-- special category data is for.
create table entries.admin_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),

  -- The handle from `admin_keys`. Not a foreign key: a revoked handle may be deleted one day
  -- and these rows must outlive it, which is the same reasoning `entry_purchases` uses for
  -- not cascading from `events`.
  actor text not null check (length(trim(actor)) between 1 and 40),

  action text not null
    check (action in ('sign_in', 'medical_note', 'medical_export', 'export')),

  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

comment on table entries.admin_audit is
  'Who opened the admin surface, who read a medical note, and who exported what. Never the contents of any of them. Written inside the same transaction as the read it records, so a read cannot happen unlogged.';
comment on column entries.admin_audit.actor is
  'The handle from entries.admin_keys. Never a person''s name — the mapping is in the runbook.';

create index admin_audit_at_idx on entries.admin_audit (at desc);

alter table entries.admin_audit enable row level security;

-- -----------------------------------------------------------------------------------------
-- entries.admin_key_ok() — the gate, in one place
-- -----------------------------------------------------------------------------------------
-- **Granted to nobody**, like `raise_attention`. It is reachable only from the definer
-- functions that call it, which run as this schema's owner. A helper that answers "is this the
-- admin key" has no business being callable by a key in page source: on its own it would be
-- precisely the oracle the two-credential arrangement exists to avoid.
--
-- A null digest — the shipped state — refuses everything, including a null key. `is distinct
-- from` rather than `<>` so a null on either side is a refusal rather than a null.
--
-- `stable`: it reads one row and does not read the clock.
create or replace function entries.admin_key_ok(p_key text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (
      select secret.key_sha256 is not null
         and p_key is not null
         and pg_catalog.encode(
               pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
             ) is not distinct from secret.key_sha256
        from entries.webhook_secrets as secret
       where secret.name = 'admin'
    ),
    false
  );
$$;

comment on function entries.admin_key_ok(text) is
  'Whether the caller presented the admin surface''s shared key. Granted to nobody — reachable only from the security definer functions that gate on it, because on its own it would be an oracle for the key.';

revoke all on function entries.admin_key_ok(text) from public;

-- -----------------------------------------------------------------------------------------
-- entries.record_admin_action() — the audit write, and nobody may forge one
-- -----------------------------------------------------------------------------------------
-- **Granted to nobody, for the same reason `raise_attention` is.** An audit trail that the
-- published anon key can write to is an audit trail somebody can fill with noise, or use to
-- claim a read happened that did not. It is called only from the functions below, in the same
-- transaction as the read it describes — so **a medical note cannot be read without the row
-- that says so being written**, and an export cannot happen unlogged. That property is why the
-- audit write lives in the database rather than in the Worker.
create or replace function entries.record_admin_action(
  p_actor text,
  p_action text,
  p_detail jsonb
) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  insert into entries.admin_audit (actor, action, detail)
  values (
    -- **Capped, and given a sentinel rather than an empty string.** The actor arrives from a
    -- cookie the Worker signed itself, so it cannot be blank in practice — `readAdminSession`
    -- refuses anything that is not a handle. The point of the fallback is that **the audit
    -- write must never be the thing that fails a read**: `admin_audit.actor` is `check (length
    -- (trim(actor)) between 1 and 40)`, so a null or blank would fire the constraint and roll
    -- the whole transaction back, taking the read with it and leaving no trace that anybody
    -- tried.
    --
    -- An earlier version coalesced to `''` and claimed this property in a comment without
    -- having it — the cap defended and the coalesce did not. A row saying an unattributed read
    -- happened is a louder signal than a rolled-back transaction that says nothing at all.
    --
    -- The sentinel is deliberately **not a possible handle**: `entries.admin_keys.name` is
    -- constrained to `^[a-z][a-z0-9-]{0,39}$`, which parentheses cannot satisfy, so this can
    -- never be confused with a person.
    pg_catalog.left(
      coalesce(nullif(pg_catalog.btrim(coalesce(p_actor, '')), ''), '(unattributed)'),
      40
    ),
    p_action,
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

comment on function entries.record_admin_action(text, text, jsonb) is
  'Writes one audit row. Granted to nobody — reachable only from the admin functions, inside the same transaction as the read it records, so a read cannot happen unlogged and an entry cannot be forged.';

revoke all on function entries.record_admin_action(text, text, jsonb) from public;

-- -----------------------------------------------------------------------------------------
-- entries.admin_sign_in() — which human, and the only place a person key is checked
-- -----------------------------------------------------------------------------------------
-- The Worker presents its own key and the key the person typed. On success it learns the
-- handle, and nothing else — there is no session, no token and no expiry here. The Worker
-- mints a short-lived signed cookie carrying the handle, which is what every later request
-- presents; the person's key is never stored anywhere by anything.
--
-- ## What it refuses, and how much it says about why
--
--   `unauthorised`  the Worker's key is wrong, or nobody has installed the digest yet. A
--                   deployment state, and one worth telling apart **in a log** — the Worker
--                   renders the identical page either way, so nothing reaches a browser that
--                   distinguishes them.
--   `refused`       there is no unrevoked key with this digest. One answer for "no such key",
--                   "revoked" and "mistyped", because which of the three it is tells somebody
--                   who is guessing more than it tells somebody who fumbled a paste.
--
-- **The order is load-bearing.** The Worker's key is checked before the person key is looked
-- at, so a caller holding only the published anon key cannot use this to test candidate person
-- keys at all.
--
-- `volatile`: it stamps `last_used_at` and writes an audit row.
create or replace function entries.admin_sign_in(
  p_key text,
  p_person_key text
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_name text;
begin
  if not entries.admin_key_ok(p_key) then
    return jsonb_build_object('ok', false, 'reason', 'unauthorised');
  end if;

  if p_person_key is null or pg_catalog.btrim(p_person_key) = '' then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  -- Matched on the digest of exactly what was typed. **Not trimmed**: a key is a credential
  -- rather than a name, and silently accepting a variant of it would mean two strings open the
  -- same door, only one of which anybody wrote down.
  select key.name into v_name
    from entries.admin_keys as key
   where key.key_sha256 = pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(p_person_key, 'UTF8')), 'hex'
         )
     and key.revoked_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  update entries.admin_keys set last_used_at = pg_catalog.now() where name = v_name;

  perform entries.record_admin_action(v_name, 'sign_in', '{}'::jsonb);

  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

comment on function entries.admin_sign_in(text, text) is
  'Checks the Worker''s shared key, then the person''s own key, and answers with the handle it belongs to. The Worker''s key is checked first so the published anon key cannot be used to test candidate person keys.';

revoke all on function entries.admin_sign_in(text, text) from public;

-- **anon, and the key.** The same grant every other function in this schema has, made safe by
-- the same mechanism ADR-010 established: the role is not the control, the key is.
grant execute on function entries.admin_sign_in(text, text) to anon;
