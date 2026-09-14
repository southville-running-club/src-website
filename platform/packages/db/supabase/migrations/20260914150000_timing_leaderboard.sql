-- ==========================================================================================
-- The read behind the live leaderboard — staff only, and a third audience for one shape
-- ==========================================================================================
--
-- Issue [#204](https://github.com/southville-running-club/src-website/issues/204), rung 3 of
-- [#257](https://github.com/southville-running-club/src-website/issues/257), under
-- [ADR-038](../../../../docs/architecture/decisions/adr-038-the-leaderboard-is-staff-only-in-2026.md)
-- and [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
--
-- ## ⚠️ Why this is a third function and not a third caller of an existing one
--
-- There are now three audiences for *"the teams, the runners and the crossings of one race"*,
-- and the difference between them is a permission and a column list rather than a shape:
--
-- | | Behind | Carries |
-- | --- | --- | --- |
-- | `results_for_event()` | `nn.results.read`, **and `anon` once published** | the published answer: no `role`, no `result_placement` |
-- | `results_preview()` | `timing.result.publish` | the above **plus** `role` and `result_placement`, because a prize list is wrong without both |
-- | `leaderboard()` — this one | `timing.event.manage` **or** `timing.crossing.resolve` | the above **plus** `role`, and deliberately **not** `result_placement` |
--
-- `20260914140000`'s header records why the second had to exist: `timing-admin` deliberately does
-- not hold `nn.results.read`, so `results_for_event()` answers `null` to the very person the
-- preview screen is for. The same finding decides this one, one step further out — the people who
-- run a race hold `timing.event.manage` and `timing.crossing.resolve`, and a race director
-- watching the board mid-race is not necessarily somebody the club has trusted to publish.
-- ADR-038 names those two permissions in as many words, and in the same table says **"not a new
-- permission"**, so this function asks for either and adds none.
--
-- **`results_preview()` would have been the lazy answer and it is the wrong one twice over.** It
-- is behind the publish permission, which is a narrower audience than ADR-038 decided on; and it
-- carries `result_placement`, which a leaderboard has no use for. Widening its permission to
-- open it to the leaderboard would have quietly handed the raw placement answer to everybody who
-- can manage a race.
--
-- ## ⚠️ `runners.role` is here, and `20260914130000` withholds it — both are right
--
-- That migration's header is emphatic, and this function is the case it was written to be read
-- against:
--
--   > a published payload saying *"leg 2 is a guide"* says *"leg 1 is visually impaired"* about a
--   > named person — to anybody holding the published anon key.
--
-- The disclosure is real and it is a disclosure **to the public**. `results_for_event()` is
-- `anon`-callable, so whatever it returns is on the open internet the moment a race is
-- published, and ADR-043 withholds the column there. This function is granted to
-- `authenticated` alone and authorises against a `timing.*` permission before it answers
-- anything, so its audience is the handful of volunteers running the race — the same people who
-- read the printed start list, **which marks a guide**, because a marshal at a junction needs to
-- know that two people crossing together are one entry.
--
-- **It is needed rather than merely permitted.** On a solo race — Nightingale Nightmare is one —
-- `import_from_entries()` puts a visually impaired runner on leg 1 and their guide on leg 2 of
-- **the same team**, so a leaderboard row for that entry carries two names and one bib. Without
-- `role` the board cannot say which of the two is the runner whose time it is showing, and it
-- would print a guide as though they had a result of their own — ADR-022 says they have none.
--
-- ⚠️ **The next person adding a `timing` read should copy the reasoning and not the answer.** The
-- question is not *"is this like the leaderboard"*; it is *"can `anon` reach this, ever, by any
-- route"*. If the answer is yes or might become yes, `role` stays out.
--
-- ## And `result_placement` is deliberately **not** here, which is the narrower payload
--
-- `results_preview()` carries it because a prize list is `effectiveCategory()`'s answer, which is
-- `gender` **and** the placement together — and ADR-031 spent a decision on removing the third
-- branch that reading them separately would need. A leaderboard ranks by **time** and groups by
-- `teams.category`, the race's own entry-list category, which is what `sortResults(_, 'category')`
-- has always read. It computes no band, awards nothing, and therefore has no use for the raw
-- answer to *"where should my result count"*.
--
-- **Personal data is minimised at the boundary**, and a column a surface does not use is a column
-- that does not travel to it. The day the live board grows a prize-band column, that is the change
-- that adds the key and states why.
--
-- ## What this deliberately does not add
--
-- **No permission.** ADR-038 settles it: *"a seventh `timing.*` slug is a decision in its own
-- right, and this one has no separate audience to justify it"*. `identity-permissions.test.ts` is
-- untouched — nine roles, eighteen permissions.
--
-- **No `anon` grant, and that is the decision the grant list exists to make visible.** ADR-038
-- declines the old application's fully anonymous `/live/<slug>`: the public sees nothing about a
-- running race, and `/nn/<year>/results/` after publication is the only public surface.
-- `packages/db/tests/timing.test.ts` keeps `anon` at exactly the two functions it holds.
--
-- **No column, no table and no trigger.** Splits are derived and never stored — the rule the
-- timing app has held since its own first migration — so a live leaderboard is a read and nothing
-- else. There is no `timing.leaderboard` table to keep in step with `crossings`, and the Durable
-- Object in front of this function holds no copy of the answer either.
--
-- **No date rendered to text.** `start_at`, `actually_started_at` and `captured_at` go out as
-- timestamps; every one of them reaches a screen through
-- `packages/shared/src/london-time.ts`, and a duration is computed in UTC milliseconds by
-- `packages/shared/src/timing/leaderboard.ts`. This repository has exactly one path a timezone
-- conversion may take and no SQL is on it.

-- ------------------------------------------------------------------------------------------
-- leaderboard — one race as it stands, for somebody running it
-- ------------------------------------------------------------------------------------------
-- ⚠️ **Both refusals are the same bare `null`**, exactly as every other read in this schema: "you
-- may not" and "no such race" must stay indistinguishable, or a slug can be probed for existence.
-- `apps/timing/lib/reads.ts` carries the three-answer discipline on the page's side, and the third
-- answer — *the call failed* — must never render as the second.
--
-- **Available at every point in the lifecycle, and it has to be.** A board somebody opens before
-- the gun shows a field of pending rows, which is what a race director checking the start line
-- wants; one opened after publication shows the same times the public can now read. The page says
-- which state the race is in from `actually_started_at`, `finished_at` and
-- `results_published_at` — and the derivation says out loud when it is measuring against a
-- scheduled start rather than a recorded one, because a start that has not been broadcast makes
-- every time on the board a guess.
create or replace function timing.leaderboard(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  -- ⚠️ **`or`, and ADR-038's own words.** Two permissions rather than one because the record says
  -- two; `apps/timing/lib/access.ts` carries the same pair for the address, so the door and the
  -- function cannot disagree about who may look. As at this migration both are held by
  -- `timing-admin` and `src-admin` and by nobody else, so this grants nothing that
  -- `timing.event.manage` alone would not — which is the argument for writing down the rule that
  -- was decided rather than the narrower one that happens to be equivalent today.
  if not (
    identity.has_permission('timing.event.manage')
    or identity.has_permission('timing.crossing.resolve')
  ) then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'name', v_event.name,
      'format', v_event.format,
      -- ⚠️ **Both start columns, and the derivation needs both rather than the winner of the
      -- two.** `raceStartIso()` coalesces `actually_started_at` over `start_at`, which is the
      -- rule every split in this platform is measured by; the board additionally has to *say*
      -- which one it used, because a race whose start was never broadcast produces times
      -- measured against a schedule, and presenting those as results is the one thing a live
      -- board must not do quietly. Coalescing here would throw away the fact that matters.
      'start_at', v_event.start_at,
      'actually_started_at', v_event.actually_started_at,
      'finished_at', v_event.finished_at,
      'results_published_at', v_event.results_published_at
    ),
    -- The same count `open_anomaly_count()` gives the preview screen and the publish refusal —
    -- `20260914140000` made that predicate one expression, and a third statement of it here is
    -- exactly what that migration's header forbids. A row-level "suspect" mark is derived from
    -- the crossings below; this is the race-level figure, and it is a **superset**, because an
    -- orphan whose bib matched no team carries no flag and still needs a human.
    'open_anomalies', timing.open_anomaly_count(v_event.id),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'team_number', t.team_number,
          'name', t.name,
          'category', t.category,
          'bib_leg1', t.bib_leg1,
          'bib_leg2', t.bib_leg2,
          'race_status', t.race_status,
          'dnf_at', t.dnf_at,
          'runners', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'leg', r.leg,
                'firstname', r.firstname,
                'lastname', r.lastname,
                'gender', r.gender,
                'age_on_day', r.age_on_day,
                -- ⚠️ **Here, and withheld by `results_for_event()`. See the header.** A guide
                -- shares a team with the runner they guide, so a board with no `role` cannot say
                -- whose time the row is — and would print a guide as though they had one.
                -- `result_placement` is deliberately absent: this surface computes no prize band.
                'role', r.role
              ) order by r.leg
            )
            from timing.runners r
            where r.team_id = t.id
          ), '[]'::jsonb)
        ) order by t.team_number
      )
      from timing.teams t
      where t.event_id = v_event.id
    ), '[]'::jsonb),
    -- Every crossing, including the discarded and the flagged ones, because `buildResults()`
    -- decides what each means: a `discarded` resolution removes a capture from timing, and a
    -- flagged one still contributes its time *and* marks the row suspect. Filtering here would
    -- move that decision out of the one tested place it lives.
    'crossings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bib', c.bib,
          'captured_at', c.captured_at,
          'anomaly_flag', c.anomaly_flag,
          'resolved_at', c.resolved_at,
          'resolved_action', c.resolved_action
        ) order by c.captured_at
      )
      from timing.crossings c
      where c.event_id = v_event.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function timing.leaderboard(text) from public, anon;
grant execute on function timing.leaderboard(text) to authenticated;

comment on function timing.leaderboard(text) is
  'One race as it stands, for somebody holding timing.event.manage or timing.crossing.resolve: the event with both of its start columns, the teams with their runners and role, and every crossing. Never granted to anon — ADR-038 makes the live leaderboard staff-only in 2026, and the public surface for a result is /nn/<year>/results/ after publication. Carries runners.role, which the published answer withholds, and deliberately not result_placement, which no live board computes a band from.';
