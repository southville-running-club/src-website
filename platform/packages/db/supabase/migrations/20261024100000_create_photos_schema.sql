-- Race photos: where tagged photos are recorded once they leave the laptop.
--
-- =========================================================================================
-- What this is, and how rows arrive
-- =========================================================================================
-- The laptop tool (`tools/photos/`, ADR-059) reads bibs, fixes camera clocks and makes the
-- three stripped copies (ADR-060). It uploads the copies to R2 and writes **every read,
-- checked or not**, to a SQL file that a volunteer runs by hand in the Supabase editor
-- (brief §2 decision 6). That file is the only writer this migration expects: nothing on the
-- website writes here yet, and no role can.
--
-- The website's half arrives in later slices, each with its own functions and the grants
-- they need: the shared check page (slice 3), the runners' pages (slice 4) and the private
-- links (slice 5). **This migration grants nothing to anybody** and does not expose the schema
-- through PostgREST, so until those slices land the tables are reachable only from the SQL
-- editor.
--
-- =========================================================================================
-- What is deliberately NOT here
-- =========================================================================================
-- ⚠️ **No runner names and no email addresses** (brief §3). A photo is linked to a runner by a
-- bib number and nothing else (ADR-058). A runner's first name or address is read at the
-- moment it is needed, from where it already lives (`timing.runners`, which the race's own
-- import fills), and copied into nothing here.
--
-- ⚠️ **No private link tokens.** `link` holds the SHA-256 of a token, never the token, so a
-- read of this table cannot be turned into a working link.
--
-- **No camera serial, no GPS, no file names.** The laptop never sends them (ADR-060).

-- =========================================================================================
-- The schema
-- =========================================================================================
-- `usage` but no table privileges, exactly as `store` and `membership` do. Functions are
-- revoked from `public` by default, so a later slice's function is callable by nobody until
-- its own migration grants it — a grant is a decision taken in a diff.
create schema if not exists photos;

grant usage on schema photos to anon, authenticated;

alter default privileges in schema photos revoke all on tables from anon, authenticated;
alter default privileges in schema photos revoke execute on functions from public;

-- =========================================================================================
-- One row per running of a race that has photos
-- =========================================================================================
-- Keyed by the running's own slug, `nn-2026`, and tied to `timing.events` so a photo can never
-- be filed against a running that does not exist. Publishing is one column: nothing is shown
-- to a runner while it is null (slice 4), and the links are sent once (slice 5).
create table if not exists photos.event (
  slug text primary key references timing.events (slug) on update cascade on delete restrict,
  published_at timestamptz,
  links_sent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table photos.event is
  'One row per running with photos. Nothing is shown to a runner until published_at is set.';

alter table photos.event enable row level security;

-- =========================================================================================
-- One row per photo
-- =========================================================================================
-- `id` is the laptop's random photo ID and the R2 key prefix (`nn-2026/<id>/full.jpg`), so it
-- is supplied rather than defaulted: the same photo must have the same ID in the bucket and
-- here. `short_id` is what a person reads out and replies with, and never changes once given.
-- `burst_id` does change: the laptop works it out again on every run and the SQL file
-- overwrites it (brief §8).
create table if not exists photos.photo (
  id uuid primary key,
  event_slug text not null references photos.event (slug) on delete restrict,
  short_id text not null,

  -- The photographer's credit and the spot, as photographers.csv gave them. A credit is the
  -- one name this schema holds, and it is a volunteer's, given to be shown.
  photographer text not null,
  spot text not null,

  -- When it was taken, after the camera's clock was fixed. Null when the camera recorded no
  -- time, or the corrected time fell in the hour the clocks repeated or skipped.
  taken_at timestamptz,
  burst_id text,

  -- The full copy's size, so a page can reserve the space before the image arrives.
  width integer not null,
  height integer not null,

  -- Where the photo stands. The laptop sets it; the check page moves it on (slice 3).
  check_state text not null,

  -- Who settled it on the website, and when (slice 3). ⚠️ **The laptop's SQL file never
  -- touches check_state once this is set**, so running it again after the team has checked a
  -- photo cannot undo their decision. A decision made on the laptop leaves both null: the
  -- laptop has no account.
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz,

  -- A checker's hold on the photo, so two people never get the same one (slice 3).
  held_by uuid references auth.users (id) on delete set null,
  held_until timestamptz,

  -- Taken down. Never shown and never served once set (slices 3 and 4).
  hidden_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint photo_short_id_unique unique (event_slug, short_id),
  constraint photo_short_id_shaped check (short_id ~ '^[A-Z0-9]{2,8}-[0-9]{4,}$'),
  constraint photo_credit_present check (length(trim(photographer)) > 0),
  constraint photo_spot_present check (length(trim(spot)) > 0),
  constraint photo_size_sane check (width > 0 and height > 0),
  constraint photo_check_state_shaped check (
    check_state in ('tagged', 'checked', 'part_read', 'needs_check', 'no_bib_seen')
  ),
  constraint photo_hold_coherent check ((held_by is null) = (held_until is null)),
  constraint photo_checker_has_a_time check (checked_by is null or checked_at is not null)
);

comment on table photos.photo is
  'One row per uploaded photo. id is the R2 key prefix; short_id is what people read out and never changes.';

alter table photos.photo enable row level security;

-- =========================================================================================
-- The bibs read in each photo
-- =========================================================================================
-- Several rows per photo. A part read keeps its `?` (`12?`) and is "Could be you" to every
-- bib it fits, never anybody's own until a person confirms a whole bib (ADR-058), which is
-- why a confirmed row may not hold a `?`. `decided_by` is the checker's account when the
-- decision was made on the website, and null when it was made on the laptop, which has no
-- account; `decided_at` says when either way.
create table if not exists photos.photo_bib (
  photo_id uuid not null references photos.photo (id) on delete cascade,
  bib_text text not null,
  confidence numeric(4, 3),
  confirmed boolean not null default false,
  source text not null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,

  primary key (photo_id, bib_text),

  constraint photo_bib_text_shaped check (bib_text ~ '^[0-9?]{1,8}$' and bib_text ~ '[0-9]'),
  constraint photo_bib_confirmed_is_whole check (not confirmed or bib_text !~ '\?'),
  constraint photo_bib_confidence_sane check (confidence is null or confidence between 0 and 1),
  constraint photo_bib_source_shaped check (source in ('model', 'person')),
  constraint photo_bib_decider_has_a_time check (decided_by is null or decided_at is not null)
);

comment on table photos.photo_bib is
  'The bibs read in a photo. A part read keeps its ? and is never confirmed; a bib, never a name, is the only link to a runner.';

alter table photos.photo_bib enable row level security;

-- =========================================================================================
-- Private links, as hashes
-- =========================================================================================
-- One active link per bib per running; a lost-link request replaces it rather than adding a
-- second (slice 5). Only the SHA-256 of the token is stored, so nothing read from here opens
-- a runner's page.
create table if not exists photos.link (
  token_hash text primary key,
  event_slug text not null references photos.event (slug) on delete restrict,
  bib text not null,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,

  constraint link_token_hash_shaped check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint link_bib_shaped check (bib ~ '^[0-9]{1,8}$')
);

create unique index if not exists link_one_active_per_bib
  on photos.link (event_slug, bib)
  where replaced_at is null;

comment on table photos.link is
  'Private links to a runner''s photos, stored as SHA-256 hashes only. One active link per bib per running.';

alter table photos.link enable row level security;
