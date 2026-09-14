-- ==========================================================================================
-- The preview somebody reads before they publish, and the one predicate that refuses them
-- ==========================================================================================
--
-- Issue [#205](https://github.com/southville-running-club/src-website/issues/205), rung 4 of
-- [#257](https://github.com/southville-running-club/src-website/issues/257), behind
-- [#241](https://github.com/southville-running-club/src-website/issues/241) and under
-- [ADR-042](../../../../docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
--
-- #241 built the state machine and said in as many words what it was leaving here:
--
--   > **No `results_published_at` in `event_detail()`.** #205 owns the preview screen and the
--   > button that calls these two functions … The read that page needs is a one-line addition
--   > in the change that has a page to put it on.
--
-- This is that change. It adds three things and fixes one bug found on the way.
--
-- ## ⚠️ `results_for_event()` answers `null` to the very person the preview page is for
--
-- This is the finding that decided the shape of this migration, and it is not obvious from
-- either issue. `timing.result.publish` is held by `timing-admin` and `src-admin`;
-- `nn.results.read` is held by `nn-results` and `src-admin`, and
-- `identity-permissions.test.ts` says out loud that `timing-admin` holding the second is
-- **deliberately not the case**:
--
--   > Deliberately not by `timing-admin`: running a race and seeing its results before they
--   > are public are different powers, and the club asked for the second to sit behind its own
--   > role.
--
-- So before publication `results_for_event()` refuses an ordinary `timing-admin` — the person
-- who presses the publish button. A preview screen reading it would show them nothing and then
-- offer to publish it. `results_preview()` below is therefore **necessary rather than
-- convenient**, and the two functions are two audiences rather than two spellings.
--
-- ## ⚠️ And the preview carries two columns the public answer must never carry
--
-- `results_for_event()` is `anon`-callable since #241, so whatever it returns is on the public
-- internet the moment a race is published. It deliberately holds no email address and no club.
-- Two more belong on that list and are needed by a *staff* screen:
--
--   * **`runners.role`.** A `'guide'` is a visually impaired runner's guide
--     ([ADR-022](../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md)),
--     so publishing the role publishes, by inference, that the runner they are paired with is
--     visually impaired — Article 9 data, about somebody who was never asked. It must not be
--     in a public payload.
--   * **`runners.result_placement`.**
--     [ADR-031](../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s
--     answer. The *resolved* category is published, because that is what a prize list is; the
--     raw answer is a fact about how somebody asked to be treated and belongs with
--     `gender_identity`, which is on `/admin/nn/` and nowhere else.
--
-- ⚠️ **Both are needed to get a prize list right, which is why the preview is the surface that
-- gets them.** `awards.ts` excludes a guide from every prize by reading `role`; with no `role`
-- in the payload, `isGuide()` can never be true and a guide wins a band — discovered at the
-- presentation, in front of the club. And the category is `effectiveCategory()`'s answer,
-- which is `gender` **and** `result_placement` together, or it is a third branch ADR-031 spent
-- a decision removing.
--
-- ## The open-anomaly predicate now has one statement fewer, not one more
--
-- `20260914100000`'s header is emphatic about this and it is the constraint this migration had
-- to work around:
--
--   > **if `open_anomalies()`'s `where` clause changes, this one changes with it** … A restated
--   > predicate is the shape `entries` learned to fear.
--
-- The preview page has to show the count *before* somebody presses publish, so a naive version
-- of this file would have been a **third** copy. Instead `open_anomaly_count(uuid)` below is
-- the count, stated once, and `publish_results()` is replaced to call it rather than to restate
-- it. Two sites remain — the list in `open_anomalies()` and the count here — where there were
-- two before, and the one that refuses publication and the one the page displays are now
-- provably the same expression rather than two that agree today.
--
-- ⚠️ **`event_detail()` was the third copy already, and it was narrower.** Its
-- `counts.open_anomalies` read `anomaly_flag and resolved_at is null` and said nothing about
-- orphans — so a race with three unmatched bibs and no flags showed **0 open anomalies** on the
-- hub and then refused publication for open anomalies, which is exactly the "both screens are
-- right and they disagree" failure #241's header describes. It reads the shared count now, so
-- the hub, the preview and the refusal are one number.
--
-- ## What this deliberately does not do
--
-- **It does not touch `results_for_event()`.** Widening it is the disclosure above;
-- `/nn/<year>/results/` and everything the public sees is
-- [#242](https://github.com/southville-running-club/src-website/issues/242), being built
-- concurrently.
--
-- **It adds no permission.** Whether a results export wants one of its own is the question #205
-- asks to be answered in the diff, and the answer is in the pull request body and in
-- `apps/timing/lib/access.ts`: it rides on `timing.result.publish`. A nineteenth permission is
-- a stop-and-ask, and the argument against needing one is that publication makes exactly these
-- fields public to the entire internet — somebody trusted with that is trusted with a file of
-- it. `identity-permissions.test.ts` is untouched.

-- ------------------------------------------------------------------------------------------
-- open_anomaly_count — the predicate, stated once
-- ------------------------------------------------------------------------------------------
-- Granted to **nobody**, and reachable only from the three `security definer` functions below
-- that call it. The `raise_attention()` precedent: a function that answers a question about a
-- race nobody may otherwise ask is not a function to expose, and an internal helper with no
-- grant cannot become an oracle.
--
-- ⚠️ **Both halves of the predicate, and `bib is not null` is one of them.** A tap whose marshal
-- never typed a number is not on the triage list — `open_anomalies()` excludes it because it is
-- *"not something an admin can resolve from a desk"* — so it must not block publication either,
-- or the anomalies page says the list is empty while the publish button says it is not.
create or replace function timing.open_anomaly_count(p_event_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
  select count(*)::int
    from timing.crossings c
   where c.event_id = p_event_id
     and c.resolved_at is null
     and (c.anomaly_flag or (c.team_id is null and c.bib is not null));
$$;

revoke all on function timing.open_anomaly_count(uuid) from public, anon, authenticated;

comment on function timing.open_anomaly_count(uuid) is
  'How many captures on this race are open: flagged, or an orphan carrying a bib nobody owns. The one statement of the predicate that refuses publication — timing.open_anomalies() returns the same rows as a list. Granted to nobody; called only by the definer functions in this schema.';

-- ------------------------------------------------------------------------------------------
-- publish_results — unchanged but for where the count comes from
-- ------------------------------------------------------------------------------------------
-- Restated whole because `create or replace function` has no smaller unit. Every branch, every
-- reason string and every comment is `20260914100000`'s; the only change is that the `select
-- count(*)` with the predicate written out is now a call to the helper above.
create or replace function timing.publish_results(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_id uuid;
  v_open integer;
begin
  if not identity.has_permission('timing.result.publish') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- Idempotent by its own state rather than by anything a caller does, like `start_event()` and
  -- `finish_event()`: the second of two presses is answered with the time the first one set, so
  -- two devices agree on the moment rather than one of them seeing an error.
  if v_event.results_published_at is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_published',
      'results_published_at', v_event.results_published_at
    );
  end if;

  -- The club's own rule, and the reason this rung exists. Checked before the anomaly count
  -- because "the race is not over" is the more useful of the two things to be told.
  if v_event.finished_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_finished');
  end if;

  -- ⚠️ **The predicate is not written out here any more — see this migration's header.** The
  -- number that refuses publication and the number `results_preview()` shows on the page are
  -- now the same expression rather than two that happen to agree.
  v_open := timing.open_anomaly_count(v_event.id);

  if v_open > 0 then
    -- The count, because "there are open anomalies" and "there are three open anomalies" are
    -- different amounts of help on a race night.
    return jsonb_build_object('ok', false, 'reason', 'open_anomalies', 'open', v_open);
  end if;

  -- ⚠️ **Held separately, because `returning … into` sets every field to null when no row
  -- matched.** The re-read below would otherwise look for `where id is null` and find nothing,
  -- turning a lost race into a bare `already_published` with no time on it — which is precisely
  -- the case this branch exists to answer well.
  v_id := v_event.id;

  update timing.events
     set results_published_at = now(),
         results_published_by = auth.uid()
   where id = v_id
     and results_published_at is null
  returning * into v_event;

  -- Lost the race to another press between the read above and this update. Answer the winner's
  -- time, which is the same thing the idempotent branch above says.
  if not found then
    select * into v_event from timing.events where id = v_id;
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_published',
      'results_published_at', v_event.results_published_at
    );
  end if;

  -- Update first, audit second: an audit row claiming a change that did not happen is what
  -- somebody disputing a result would be shown. `20260913220000`'s rule.
  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'results_published',
    jsonb_build_object(
      'results_published_at', v_event.results_published_at,
      -- What the race looked like at the moment it was published, so a later "why was this
      -- allowed" is answerable from the trail rather than from the tables as they are now.
      'finished_at', v_event.finished_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'slug', v_event.slug,
    'results_published_at', v_event.results_published_at
  );
end;
$$;

revoke all on function timing.publish_results(text) from public, anon;
grant execute on function timing.publish_results(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- event_detail — the one-line addition #241 left here, and a count that was quietly wrong
-- ------------------------------------------------------------------------------------------
-- Two changes, restated whole for `create or replace`'s reason:
--
--   * **`results_published_at` joins the answer.** `20260912100000` declined it because the
--     column did not exist and *"a page rendering a lifecycle state nothing can reach"* is
--     worse than no key; #241 added the column and named this change as its owner. The hub,
--     the finish screen and the preview all read this function, and all three have to be able
--     to say which of the three states a race is in.
--   * ⚠️ **`counts.open_anomalies` was narrower than the thing that refuses publication.** It
--     counted flagged rows only. An orphan — a bib nobody owns — blocks publication and was
--     invisible here, so the hub could read *"0 open anomalies"* beside a publish button that
--     refuses for open anomalies. Both screens right, and disagreeing. It reads the shared
--     count now.
--
-- ⚠️ **That widening changes a number a deployed page already renders**, which is the one thing
-- worth checking before this applies: `/timing/events/<slug>/` shows it as "Open anomalies",
-- and the number it shows can only go **up**, never down, because the new predicate is a
-- superset of the old one. A page saying there is more to do than it used to is the safe
-- direction, and it is the true one.
create or replace function timing.event_detail(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.event.manage') then
    return null;
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'slug', v_event.slug,
    'name', v_event.name,
    'format', v_event.format,
    'start_at', v_event.start_at,
    'actually_started_at', v_event.actually_started_at,
    'finished_at', v_event.finished_at,
    -- #241's column, and the third state of the lifecycle. Null means capturing or finished;
    -- set means the results are the club's published answer.
    'results_published_at', v_event.results_published_at,
    'distance_m', v_event.distance_m,
    'course_notes', v_event.course_notes,
    'created_at', v_event.created_at,
    -- **`editable` is answered here rather than re-derived by every caller.** The page, the
    -- form and `update_event` must agree about whether the race has started, and a rule
    -- restated in three places is one that drifts in two of them.
    'editable', v_event.actually_started_at is null,
    'counts', jsonb_build_object(
      'teams', (select count(*)::int from timing.teams t where t.event_id = v_event.id),
      'runners', (
        select count(*)::int
          from timing.runners r
          join timing.teams t on t.id = r.team_id
         where t.event_id = v_event.id
      ),
      'crossings', (
        select count(*)::int from timing.crossings c where c.event_id = v_event.id
      ),
      -- See the header: this used to be a narrower predicate written out here, and an orphan
      -- was invisible to it.
      'open_anomalies', timing.open_anomaly_count(v_event.id),
      'marshals', (
        select count(*)::int from timing.marshals m where m.event_id = v_event.id
      )
    )
  );
end;
$$;

revoke all on function timing.event_detail(text) from public, anon;
grant execute on function timing.event_detail(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- results_preview — what a person holding timing.result.publish reads before they press it
-- ------------------------------------------------------------------------------------------
-- The same shape `results_for_event()` returns, plus the two runner columns a prize list needs
-- and the open-anomaly count, behind `timing.result.publish` and granted to `authenticated`
-- alone.
--
-- ⚠️ **`anon` is never granted this and that is the point of it being a second function.** See
-- the header: the public answer and the staff answer differ by exactly the fields that must not
-- be public, and making that a property of the schema rather than a branch inside one function
-- is what stops a later edit flattening it by accident. `timing.test.ts` asserts the grant.
--
-- ⚠️ **Both refusals are the same bare `null`**, exactly as every other read in this schema:
-- "you may not" and "no such race" must stay indistinguishable, or a slug can be probed for
-- existence. `lib/reads.ts` carries the three-answer discipline on the page's side.
--
-- **Available at every point in the lifecycle, and it has to be.** Capturing, finished and
-- published all read the same table; the page says which state it is in from
-- `results_published_at` and `finished_at`, and a function that refused a race that was not yet
-- finished would leave a volunteer with no way to check the times *before* calling it over,
-- which is the entire purpose of a preview.
create or replace function timing.results_preview(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.result.publish') then
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
      'start_at', v_event.start_at,
      'actually_started_at', v_event.actually_started_at,
      'finished_at', v_event.finished_at,
      'results_published_at', v_event.results_published_at
    ),
    -- The number that will refuse the publish button, read from the one place it is stated.
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
                -- ⚠️ **The two columns `results_for_event()` must never carry.** A guide's role
                -- discloses their runner's disability by inference, and a placement is ADR-031's
                -- raw answer rather than the published category derived from it. Here because a
                -- prize list is wrong without both, and nowhere a member of the public can ask.
                'result_placement', r.result_placement,
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

revoke all on function timing.results_preview(text) from public, anon;
grant execute on function timing.results_preview(text) to authenticated;

comment on function timing.results_preview(text) is
  'One race''s results as somebody holding timing.result.publish reads them before publishing: the same shape timing.results_for_event() returns, plus runners.role and runners.result_placement — which a prize list needs and a public payload may not carry — and the open-anomaly count that will refuse publication.';
