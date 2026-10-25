-- Race photos: what a runner's private link may read (brief slice 4, decisions 7 and 8, ADR-067).
--
-- A runner reaches their photos through a private link emailed to them (slice 5), and nothing
-- else: no public bib search, no account. The link is `/nn/<year>/photos/p/<token>/`; the
-- Worker hashes the token and asks with the hash, and `photos.link` holds only hashes.
--
-- =========================================================================================
-- Four functions `anon` may call, and why that is safe
-- =========================================================================================
-- A runner is signed out, so the Worker asks as `anon`. **This is the brief's own design
-- (§8), confirmed on 24 October 2026**, and each function gives nothing away to a caller
-- without the right key:
--
--   * `runner_photos()` and `runner_photo()` answer only to the SHA-256 of an **active** link's
--     token, for a running whose photos are **published**, and never a photo taken down. A
--     token is 32 random bytes (`packages/shared/src/photos-runner.ts`), so the hash is not
--     guessable, and every refusal is the same `null` — a link that never existed, one that was
--     replaced, and one for photos not yet published cannot be told apart.
--   * `servable_photo()` answers whether one photo may be served as an image at all: published,
--     in that running, not taken down. A photo's id is random and is only ever printed on a
--     page a link opened, so knowing one is knowing a link.
--   * `photos_ready()` is one public bit — the running's photos are published and the links
--     have gone out — so `/nn/<year>/results/` can show its banner without reading anything
--     else, `timing.results_published_at()`'s reasoning exactly.
--
-- **`anon` still holds no table privilege anywhere in `photos`**, and `authenticated` is granted
-- none of these: the Worker asks as `anon` whoever is reading, because a private link does not
-- depend on who is signed in.
--
-- =========================================================================================
-- What counts as a runner's own photo, and what is "Could be you"
-- =========================================================================================
-- ⚠️ **This reads the marks slice 3 writes, and it must keep reading them the same way**
-- (ADR-065):
--
--   * **Their own**: a photo with a **confirmed** row for their bib.
--   * **Could be you**: a photo with an **unconfirmed, undismissed** row their bib fits — a part
--     read (`12?` fits `120` to `129`, the same length) or an unsure whole read of their bib —
--     that is not already their own, and **is no longer waiting to be checked**: a photo still on
--     the check page's queue (`photos.is_unsure()`) is nobody's yet, however its read looks.
--   * A **dismissed** row is shown to nobody, and a photo **taken down** is shown to nobody.
--
-- Never anybody's own until a person confirms a whole bib (ADR-058). "That's me" on the page
-- opens an email; it changes nothing here.
--
-- **What a page may show is a photo's short ID, spot, time, photographer's credit and size.**
-- No other runner's bib is returned, and the schema holds no runner's name or address.

-- =========================================================================================
-- Helpers, granted to nobody
-- =========================================================================================

-- Whether a read fits a bib: the bib itself, or a part read of the same length whose `?`s each
-- stand for one digit. The one statement of ADR-058's rule in SQL.
create or replace function photos.fits_bib(p_read text, p_bib text)
  returns boolean
  language sql
  immutable
  set search_path = pg_catalog
as $$
  select p_read = p_bib
      or (p_read ~ '\?'
          and length(p_read) = length(p_bib)
          and p_bib ~ ('^' || replace(p_read, '?', '[0-9]') || '$'));
$$;

revoke all on function photos.fits_bib(text, text) from public;

-- One photo as a runner's page shows it.
create or replace function photos.runner_card(p_photo_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select jsonb_build_object(
    'id', p.id,
    'short_id', p.short_id,
    'spot', p.spot,
    'taken_at', p.taken_at,
    'photographer', p.photographer,
    'width', p.width,
    'height', p.height
  )
  from photos.photo p
  where p.id = p_photo_id;
$$;

revoke all on function photos.runner_card(uuid) from public;

-- =========================================================================================
-- A runner's photos, for their link
-- =========================================================================================
create or replace function photos.runner_photos(p_event_slug text, p_token_hash text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_link photos.link%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select l.* into v_link
    from photos.link l
    join photos.event e on e.slug = l.event_slug
   where l.token_hash = p_token_hash
     and l.event_slug = p_event_slug
     and l.replaced_at is null
     and e.published_at is not null;

  -- ⚠️ One answer for every refusal, so a hash cannot be used to learn which of them it is.
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'event_slug', v_link.event_slug,
    'event_name', (select t.name from timing.events t where t.slug = v_link.event_slug),
    -- The address the club answers race mail at, as the entry emails use it — a fact held in
    -- the database rather than in markup. Null for a running not entered on this site.
    'contact', (select ev.from_address::text from entries.events ev where ev.slug = v_link.event_slug),
    'bib', v_link.bib,
    'mine', coalesce(
      (select jsonb_agg(photos.runner_card(p.id) order by p.taken_at nulls last, p.short_id)
         from photos.photo p
        where p.event_slug = v_link.event_slug
          and p.hidden_at is null
          and exists (
            select 1 from photos.photo_bib b
             where b.photo_id = p.id and b.confirmed and b.bib_text = v_link.bib
          )),
      '[]'::jsonb),
    'could_be', coalesce(
      (select jsonb_agg(
                photos.runner_card(p.id) || jsonb_build_object(
                  'read',
                  (select min(b.bib_text collate "C")
                     from photos.photo_bib b
                    where b.photo_id = p.id
                      and not b.confirmed
                      and not b.dismissed
                      and photos.fits_bib(b.bib_text, v_link.bib))
                )
                order by p.taken_at nulls last, p.short_id)
         from photos.photo p
        where p.event_slug = v_link.event_slug
          and p.hidden_at is null
          and not photos.is_unsure(p.check_state, p.checked_by, p.hidden_at)
          and not exists (
            select 1 from photos.photo_bib b
             where b.photo_id = p.id and b.confirmed and b.bib_text = v_link.bib
          )
          and exists (
            select 1 from photos.photo_bib b
             where b.photo_id = p.id
               and not b.confirmed
               and not b.dismissed
               and photos.fits_bib(b.bib_text, v_link.bib)
          )),
      '[]'::jsonb)
  );
end;
$$;

comment on function photos.runner_photos(text, text) is
  'A runner''s own photos and their "Could be you" photos, for the hash of an active private link to a published running. Null for every refusal.';

revoke all on function photos.runner_photos(text, text) from public, authenticated;
grant execute on function photos.runner_photos(text, text) to anon;

-- =========================================================================================
-- One photo, for a link
-- =========================================================================================
-- Only a photo that link's page would show, so a link cannot be used to open somebody else's.
create or replace function photos.runner_photo(
  p_event_slug text,
  p_token_hash text,
  p_short_id text
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
declare
  v_page jsonb;
  v_photo jsonb;
  v_mine boolean := true;
begin
  v_page := photos.runner_photos(p_event_slug, p_token_hash);

  if v_page is null or p_short_id is null then
    return null;
  end if;

  select card into v_photo
    from jsonb_array_elements(v_page -> 'mine') as card
   where card ->> 'short_id' = upper(btrim(p_short_id));

  if v_photo is null then
    v_mine := false;
    select card into v_photo
      from jsonb_array_elements(v_page -> 'could_be') as card
     where card ->> 'short_id' = upper(btrim(p_short_id));
  end if;

  if v_photo is null then
    return null;
  end if;

  return jsonb_build_object(
    'event_slug', v_page -> 'event_slug',
    'event_name', v_page -> 'event_name',
    'contact', v_page -> 'contact',
    'bib', v_page -> 'bib',
    'mine', v_mine,
    'photo', v_photo
  );
end;
$$;

comment on function photos.runner_photo(text, text, text) is
  'One photo a runner''s private link would show, by its short ID. Null for anything else.';

revoke all on function photos.runner_photo(text, text, text) from public, authenticated;
grant execute on function photos.runner_photo(text, text, text) to anon;

-- =========================================================================================
-- May this image be served?
-- =========================================================================================
create or replace function photos.servable_photo(p_event_slug text, p_photo_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select jsonb_build_object('short_id', p.short_id)
    from photos.photo p
    join photos.event e on e.slug = p.event_slug
   where p.id = p_photo_id
     and p.event_slug = p_event_slug
     and p.hidden_at is null
     and e.published_at is not null;
$$;

comment on function photos.servable_photo(text, uuid) is
  'Whether one photo may be served as an image: published, in this running, not taken down. Null otherwise.';

revoke all on function photos.servable_photo(text, uuid) from public, authenticated;
grant execute on function photos.servable_photo(text, uuid) to anon;

-- =========================================================================================
-- Are this running's photos out?
-- =========================================================================================
create or replace function photos.photos_ready(p_event_slug text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = photos, pg_catalog
as $$
  select coalesce(
    (select e.published_at is not null and e.links_sent_at is not null
       from photos.event e
      where e.slug = p_event_slug),
    false);
$$;

comment on function photos.photos_ready(text) is
  'Whether a running''s photos are published and its links have gone out — one public bit, for the results page''s banner.';

revoke all on function photos.photos_ready(text) from public, authenticated;
grant execute on function photos.photos_ready(text) to anon;
