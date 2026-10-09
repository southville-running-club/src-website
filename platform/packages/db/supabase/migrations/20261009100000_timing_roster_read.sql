-- The roster, readable by a race's marshals — ADR-056.
--
-- The club decided on 9 October 2026 that a marshal's tabs are Home, Marshal and Roster, and
-- that on the Roster a marshal **looks up only**: search a runner by name or bib, and see their
-- category and status, on the races they are marshalling. Admins use the same page and can also
-- fix it. Until now no marshal could read a single name — every roster read was behind
-- `timing.event.manage` or `timing.registration.import`, an admin's permissions — so this is a
-- decision about who sees the field, taken in a diff, which is what it has to be.
--
-- ## One new permission, not an admin one handed down
--
-- `timing.roster.read` opens the Roster page and this read, and nothing else. Giving marshals
-- `timing.event.manage` instead would also let them start, finish and wipe a race; giving them
-- `timing.registration.import` would let them import an entry list. ADR-036's whole shape is
-- that each power is its own permission so the club can hand out one without the others.
--
-- `src-admin` holds every permission as an explicit row rather than a wildcard, so the
-- nineteenth needs a row of its own here — and `identity-permissions.test.ts` fails until it is
-- written down, which is the feature.
--
-- ## The read: one row per runner, and what it leaves out
--
-- `desk_roster()` answers the race's name and format, and one row per **runner** rather than per team: Nightingale Nightmare is
-- a solo race, so a team is one runner, and a visually impaired runner's guide is a second
-- runner on that team who wears a bib of their own. It carries what the desk needs to find
-- somebody and nothing more:
--
-- - name, bib, race status, and the inputs a category is worked out from;
-- - `role`, because a guide is in no category and the page has to say so rather than leave the
--   column blank. The start list volunteers already hold marks guides the same way;
-- - **`age_on_day` only for somebody holding `timing.event.manage`.** A marshal is shown the
--   race category without its age band, because the band is computed from an exact age and a
--   marshal looking a runner up has no need of that age. Computing the band here instead would
--   be a second statement of `packages/shared/src/age-category.ts`, which `CLAUDE.md` says is
--   the one module that names a band.
--
-- Never carried: email, club, gender identity, anything from `entries`.
--
-- ## Which races a marshal may read
--
-- The races they are on the roster for, and only those — the same scope as the capture screen
-- (ADR-036). An admin (`timing.event.manage`) reads any race. The answer is the same `null` for
-- no permission, no such race and not rostered, so a slug cannot be probed for existence.

insert into identity.permissions (slug, description) values
  ('timing.roster.read',
   'Look a runner up on a race''s roster — name, bib, category and status — on a race you '
   'marshal, or on any race if you run races. Changes nothing.')
on conflict (slug) do nothing;

insert into identity.role_permissions (role, permission) values
  ('timing-marshal', 'timing.roster.read'),
  ('timing-admin', 'timing.roster.read'),
  ('src-admin', 'timing.roster.read')
on conflict (role, permission) do nothing;

create or replace function timing.desk_roster(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_admin boolean;
begin
  if not identity.has_permission('timing.roster.read') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  v_admin := identity.has_permission('timing.event.manage');

  -- A marshal reads the races they are marshalling, and no others.
  if not v_admin and not exists (
    select 1 from timing.marshals m
     where m.event_id = v_event.id and m.user_id = auth.uid()
  ) then
    return null;
  end if;

  return jsonb_build_object(
    -- The race's name and format, because a marshal cannot read `event_detail()` and the page
    -- has to say which race it is. Nothing else about the race: no counts, no start time.
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'name', v_event.name,
      'format', v_event.format
    ),
    'runners', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'runner_id', r.id,
        'team_id', t.id,
        'leg', r.leg,
        'firstname', r.firstname,
        'lastname', r.lastname,
        'bib', timing.effective_bib(
          case when r.leg = 1 then t.bib_leg1 else t.bib_leg2 end,
          t.team_number,
          r.leg,
          v_event.format
        ),
        'race_status', t.race_status,
        'gender', r.gender,
        'result_placement', r.result_placement,
        'role', r.role,
        'age_on_day', case when v_admin then r.age_on_day end
      ) order by lower(r.lastname), lower(r.firstname), r.id
    )
    from timing.runners r
    join timing.teams t on t.id = r.team_id
    where t.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function timing.desk_roster(text) is
  'One row per runner on a race, for the Roster page (ADR-056). timing.roster.read, and a marshal '
  'only on a race they are rostered for. Age only for timing.event.manage. Null for every refusal.';

revoke all on function timing.desk_roster(text) from public, anon;
grant execute on function timing.desk_roster(text) to authenticated;
