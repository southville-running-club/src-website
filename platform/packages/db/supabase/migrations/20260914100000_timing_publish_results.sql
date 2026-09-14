-- ==========================================================================================
-- Publication is an act somebody takes, and it is refused until the race is finished
-- ==========================================================================================
--
-- Issue [#241](https://github.com/southville-running-club/src-website/issues/241), under
-- [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
-- and [ADR-042](../../../../docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
-- `timing.result.publish` has existed since `20260911100000` and gated nothing: no function, no
-- column, no code path. This is what it opens.
--
-- ## ⚠️ What this supersedes, in a migration that may not be edited
--
-- `20260911180000_nn_results_read.sql` is applied, so its header stands as written and this is
-- the correction a reader should find. Two of its sentences are now wrong:
--
--   * *"the club has not decided how or when a result is published"* — **it has**, and the
--     answer is this file: after the race is finished, by somebody deciding to.
--   * *"which is what lets the club later publish results by widening who holds the
--     permission, without anything in the Worker changing"* — **publication is not a widening
--     of `nn.results.read`.** That was the shape imagined in September and it is not what was
--     built, because a permission is a fact about a person and publication is a fact about a
--     race: widening the permission would publish every race at once, for ever, and could not
--     be undone for one of them. `results_published_at` is a column on the event, and
--     `nn.results.read` goes back to meaning only what its own description says — seeing a
--     race's results **before** they are published.
--
-- Nothing in that migration is edited. Editing an applied migration changes what a fresh
-- `db reset` produces without changing what any existing database holds, which this repository
-- has paid for once already.
--
-- ## The state machine
--
--     capturing ──finish_event()──▶ finished ──publish_results()──▶ published
--        ▲                            │  ▲                              │
--        └──── (reversible, label) ───┘  └──── unpublish_results() ─────┘
--
-- **Finishing does not publish.** They are two acts by two permissions — `timing.event.manage`
-- calls the race over, `timing.result.publish` says the times are the club's answer — and the
-- gap between them is where somebody reads the table before the internet does.
--
-- ## ⚠️ `finished_at` is still never a gate on capture, and it is a gate on this
--
-- `20260913240000`'s header is emphatic that nothing may refuse a crossing because the race was
-- called: the last runner crosses after the director has said it is over. That rule is
-- untouched — `record_crossing()`, the resolution functions and `set_race_status()` all go on
-- ignoring `finished_at`, and the test file asserts it. What `finished_at` gates is *this*
-- function and nothing else, which is the only place it was ever meant to mean something.
--
-- ## ⚠️ The `open_anomalies` refusal uses the triage list's predicate, exactly, on purpose
--
-- #241 says to refuse while *"any crossing carries an unresolved anomaly or has no team"*. The
-- literal reading of the second half also catches a crossing with **no bib at all** — a tap
-- whose marshal never typed a number. `timing.open_anomalies()` deliberately excludes those
-- (`bib is not null`), because they are *"not something an admin can resolve from a desk"*.
--
-- So the literal reading would refuse publication over a row **no screen shows and nobody can
-- clear**: the anomalies page says the list is empty, the publish button says there are open
-- anomalies, and the two are both right. The refusal here is therefore the *same* predicate the
-- triage list is built from, restated once below, so the count this returns is the number of
-- rows a volunteer can actually go and deal with.
--
-- ⚠️ **A restated predicate is the shape `entries` learned to fear** — two branches widening one
-- closed list, both merging clean, the second silently dropping the first's addition. This one
-- is not a constraint and cannot be dropped and re-added, but it is duplicated prose about the
-- same rule: **if `open_anomalies()`'s `where` clause changes, this one changes with it**, and
-- `timing.test.ts` asserts that a published-blocking orphan is exactly a row on the triage list.
--
-- ## The first `anon` grant in this schema
--
-- `results_for_event()` becomes callable by `anon`, and that is the decision this migration is
-- most worth reviewing for. Three things make it safe, and all three are asserted:
--
--   1. **The function answers `null` unless the event is published**, so the grant discloses
--      nothing that publication has not already made public.
--   2. **`anon` still holds no grant on any table in `timing`** — RLS on, no policy, no table
--      grant. Exposing a schema routes a request to a table only for Postgres to answer
--      `42501`, which is `store`'s precedent and `timing.test.ts`'s standing assertion.
--   3. **The answer is unchanged in shape**: still no email address and no club. Publishing a
--      result publishes a name, a category and a time — what `/nn/privacy/` already says the
--      club publishes results by — and not the row behind it.
--
-- ⚠️ **The refusal ordering had to change to do this, and it discloses nothing.** The function
-- used to check the permission and *then* look the event up. It cannot now: whether a caller
-- may read depends on the event's own state, so the event is read first. Both paths still
-- return the same bare `null`, so "no such race" and "not published to you" remain
-- indistinguishable — which is the property `/nn/<year>/results/` 404s on.
--
-- ## The debt this pays on the way past
--
-- **`reopen_event()` is refused once results are published**, which #253 asked for and
-- `20260913240000` deferred to this file **by name**, because the column did not exist yet. See
-- the section on it below. It is a debt rather than scope: `CLAUDE.md` says in as many words
-- that #241 adds the guard in the change that makes publication reachable, and this is it.
--
-- ## What #241 asks for and this does not build, deliberately
--
-- **No `reset_event()` guard.** #241 says reset is refused once published; that function does
-- not exist on this branch. It is [#254](https://github.com/southville-running-club/src-website/issues/254),
-- written concurrently as `20260914110000_timing_reset_event.sql`, and it carries its own
-- `published` refusal against the column added here. Adding a guard to a function that does not
-- exist would be a `create or replace` racing another branch for the same body.
--
-- **No `results_published_at` in `event_detail()`.** #205 owns the preview screen and the
-- button that calls these two functions; this migration is the state machine and the schema,
-- which is what #241's own title says. The read that page needs is a one-line addition in the
-- change that has a page to put it on.
--
-- **No publish button anywhere.** Same reason. Until #205, these are called from a SQL client
-- or a test — which is the ordinary state of a rung on this ladder, not a gap.

-- ------------------------------------------------------------------------------------------
-- The two columns
-- ------------------------------------------------------------------------------------------
-- Expand only: both nullable, both defaulting to null, nothing deployed reads either. Every
-- race in the database is unpublished the moment this applies, which is the safe direction and
-- the true one.
alter table timing.events
  add column if not exists results_published_at timestamptz,
  add column if not exists results_published_by uuid references auth.users (id) on delete set null;

-- ⚠️ **`on delete set null` would break the pair, so the constraint below tolerates it.** A
-- person's `auth.users` row going away must not un-publish a race — the results are the club's,
-- not the volunteer's — so the coherence check is one-directional: a `published_by` without a
-- `published_at` is incoherent and refused; a `published_at` whose actor has since been deleted
-- is an ordinary, expected state.
--
-- **Validated rather than `NOT VALID`**, for `20260913220000`'s reason: `timing` holds no
-- production data at all, so there is no row to disagree with it.
alter table timing.events
  add constraint events_publication_coherent
  check (results_published_by is null or results_published_at is not null);

comment on column timing.events.results_published_at is
  'When somebody holding timing.result.publish published this race''s results. Null means the results are visible only to nn.results.read holders, as a preview. Set by timing.publish_results(), cleared by timing.unpublish_results().';

comment on column timing.events.results_published_by is
  'Who published them. Null once that person''s account is deleted, which does not unpublish the race.';

-- ------------------------------------------------------------------------------------------
-- publish_results — the act
-- ------------------------------------------------------------------------------------------
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

  -- ⚠️ **`open_anomalies()`'s predicate, restated — see the header.** Both halves: a flagged
  -- capture, and an orphan whose bib matched no team. `bib is not null` narrows the orphan half
  -- exactly as the triage list does, so every row counted here is a row somebody can open a
  -- page and clear.
  select count(*) into v_open
    from timing.crossings c
   where c.event_id = v_event.id
     and c.resolved_at is null
     and (c.anomaly_flag or (c.team_id is null and c.bib is not null));

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
-- unpublish_results — and why a correction is unpublish, fix, publish
-- ------------------------------------------------------------------------------------------
-- ⚠️ **The page goes back to 404 in between, and that is the design rather than a side effect.**
-- The alternative is serving a result that is being edited, where a spectator who refreshes
-- sees two different answers and has no way to tell which one the club stands behind. A 404 is
-- the honest state for a table that is mid-correction.
--
-- **No refusal of its own beyond the permission and the state.** Unpublishing is how a mistake
-- gets fixed, so nothing about the race's condition may stand in its way — in particular an
-- anomaly discovered *after* publication is exactly when somebody needs this most, and refusing
-- it for an open anomaly would trap the club on the published wrong answer.
create or replace function timing.unpublish_results(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_was timestamptz;
begin
  if not identity.has_permission('timing.result.publish') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  v_was := v_event.results_published_at;

  update timing.events
     set results_published_at = null,
         results_published_by = null
   where id = v_event.id
     and results_published_at is not null
  returning * into v_event;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_published');
  end if;

  -- Audited as loudly as the publishing was, for `set_race_status()`'s reason: the old
  -- application recorded the act and not its reversal, which is backwards for anybody asking
  -- why a result they had seen is no longer there.
  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'results_unpublished',
    jsonb_build_object('was_published_at', v_was)
  );

  return jsonb_build_object('ok', true, 'slug', v_event.slug);
end;
$$;

revoke all on function timing.unpublish_results(text) from public, anon;
grant execute on function timing.unpublish_results(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- reopen_event — the guard `20260913240000` deferred to this migration by name
-- ------------------------------------------------------------------------------------------
-- ⚠️ **This is a debt being paid, not scope creep.** #253 asked for it, `20260913240000`'s
-- header declined it *"because `timing.events` has no `results_published_at` column"* and named
-- #241 as its owner, and `CLAUDE.md` says in as many words that **#241 adds the guard in the
-- change that makes publication reachable**. This is that change, and the column now exists.
--
-- **Why refusing is the only coherent answer.** `reopen_event()` clears `finished_at`, and
-- publication was conditional on `finished_at` being set. Allowing it would produce a race that
-- is published and not finished — a state the state machine has no arrow into and no wording
-- for. So a race whose results are out is reopened by unpublishing first, which is the same
-- *unpublish, fix, publish* shape a correction takes, said out loud.
--
-- ⚠️ **`finish_event()` is deliberately not guarded.** Finishing a race that is already
-- published is a no-op — it is already finished, so the idempotent branch answers
-- `already_finished` — and a race can only be published if it was finished first.
--
-- Everything else about the function is byte-for-byte what `20260913240000` wrote. It is
-- restated whole because `create or replace function` has no smaller unit.
create or replace function timing.reopen_event(p_event_slug text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  -- The guard, checked before the update so the refusal is distinguishable from `not_finished`.
  -- A published race is finished by definition, so without this the two would be told apart
  -- only by which one happened to be tested first.
  select * into v_event from timing.events where slug = p_event_slug;
  if found and v_event.results_published_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'published');
  end if;

  update timing.events
     set finished_at = null
   where slug = p_event_slug
     and finished_at is not null
  returning * into v_event;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_finished');
  end if;

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (v_event.id, auth.uid(), 'race_reopened', jsonb_build_object());

  return jsonb_build_object('ok', true, 'slug', v_event.slug);
end;
$$;

revoke all on function timing.reopen_event(text) from public, anon;
grant execute on function timing.reopen_event(text) to authenticated;

-- ------------------------------------------------------------------------------------------
-- results_for_event — the same answer, to a wider audience once it is published
-- ------------------------------------------------------------------------------------------
-- Replaced whole, because `create or replace function` has no smaller unit. What changed:
--
--   * the event is looked up **before** the permission is consulted, since the event's own
--     state is now half of who may read it — both paths still answer a bare `null`;
--   * `results_published_at` joins the event object, so the page can tell a preview from a
--     published table and say something true in the banner;
--   * `anon` is granted EXECUTE, which is the first such grant in this schema.
--
-- ⚠️ **`results_published_by` is deliberately not in the answer.** Nothing on a results page
-- needs to know which volunteer pressed the button, and the same minimisation rule that keeps
-- a runner's email address and club out of this payload applies to a staff member's id.
create or replace function timing.results_for_event(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
begin
  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  -- `null`, not an exception, and the same `null` as above: a refused read has to be
  -- indistinguishable from a race that does not exist, or the 404 on `/nn/<year>/results/`
  -- becomes a confirmation that something is there. `identity.has_permission` reads
  -- `auth.uid()` from the request's own token, which `security definer` does not change, and
  -- it is false for an anonymous caller.
  if v_event.results_published_at is null
     and not identity.has_permission('nn.results.read') then
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
          -- Names, gender and age - what a results table and a prize band need. Not email,
          -- not club: unchanged, and now that this answer can reach the internet it is the
          -- assertion in `timing.test.ts` that matters most.
          'runners', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'leg', r.leg,
                'firstname', r.firstname,
                'lastname', r.lastname,
                'gender', r.gender,
                'age_on_day', r.age_on_day
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

-- ⚠️ **The decision this migration is most worth reviewing for.** See the header for the three
-- properties that make it safe. `anon` needs USAGE on the schema to *name* the function at all;
-- it grants no table, and every table here still refuses both roles.
grant usage on schema timing to anon;

revoke all on function timing.results_for_event(text) from public;
grant execute on function timing.results_for_event(text) to anon, authenticated;
