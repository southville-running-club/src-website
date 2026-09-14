-- ==========================================================================================
-- A rehearsal can be wiped, and a published race cannot
-- ==========================================================================================
--
-- Issue [#254](https://github.com/southville-running-club/src-website/issues/254), under
-- [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
-- The piece [#207](https://github.com/southville-running-club/src-website/issues/207) needs in
-- order to run the race simulation more than once against `nn-2026` without leaving a
-- rehearsal's crossings in the row the results page reads.
--
-- The old application had a `reset_event` and it is the model here, **with the two corrections
-- it recorded against itself**:
--
--   1. **It deleted teams before crossings**, and `crossings.team_id` is `on delete set null`.
--      So the reset manufactured exactly the orphans it existed to remove: a table of captures
--      belonging to teams that no longer existed, indistinguishable on the triage page from a
--      bib nobody owns. Crossings go first here, and the order is load-bearing rather than
--      tidy.
--   2. **It predated `finished_at`** and cleared only `actually_started_at`, so a wiped race
--      came back marked finished — nothing captured, nobody entered, and the race director's
--      "this race is over" still standing. #207's own rehearsal step names that as the thing to
--      check afterwards.
--
-- ## ⚠️ This migration depends on #241 and the `do` block below says so out loud
--
-- The published guard reads `timing.events.results_published_at`, which
-- [#241](https://github.com/southville-running-club/src-website/issues/241) adds. **plpgsql
-- resolves a field of a `%rowtype` variable lazily**, at first execution rather than at
-- `create function` time, so without the check below this migration would apply perfectly
-- against a database that has not got the column and then raise at the one moment somebody
-- pressed the button. A latent dependency that fails in front of a volunteer is the worse of
-- the two failures, so it is made loud: applied out of order, `db push` stops here with a
-- sentence naming the migration it is waiting for.
--
-- Once #241 is applied the block is a no-op forever. It is deliberately **not** a
-- `create column if not exists` — inventing half of #241's state machine is the thing
-- `20260912100000`, `20260913170000` and `20260913240000` have each already declined to do.
--
-- ## What this does not touch, and why each one is a decision
--
--   * **`timing.marshals`** — the roster is who the club asked to stand at a corner, which is
--     true whether or not a rehearsal's captures are being thrown away. Wiping it would mean
--     re-rostering every marshal between two runs of the same simulation, which is the cost
--     #207 is trying to avoid rather than one it is trying to pay twice.
--   * **`timing.admin_actions`** — a reset is a thing somebody did to a race, and a function
--     that deleted the record of what was done to a race would be able to delete the record of
--     itself. It **gains** a row; it never removes one.
--   * **`timing.events`' own row** — the race, its name, its format, its start time, its
--     distance and its course notes all survive. This is a reset, not a delete: the whole point
--     is that the next rehearsal runs against the same slug.

-- ------------------------------------------------------------------------------------------
-- The ordering guard — see the header
-- ------------------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'timing'
       and table_name = 'events'
       and column_name = 'results_published_at'
  ) then
    raise exception using
      message = 'timing.events.results_published_at is missing',
      detail  = '20260914110000_timing_reset_event.sql reads the column #241 adds, in '
                || '20260914100000_timing_publish_results.sql. Apply that one first.',
      hint    = 'This is the ordering #254 accepts rather than works around: a reset that '
                || 'could run against a published race is the one thing the function exists '
                || 'to refuse.';
  end if;
end;
$$;

-- ------------------------------------------------------------------------------------------
-- reset_event — put a race back to nothing captured and nobody entered
-- ------------------------------------------------------------------------------------------
-- A writer, so the `{ok, reason}` envelope rather than `null`: by the time somebody posts this
-- form the door has already admitted them, and every refusal here is something the page can and
-- should say out loud. `writes.ts` carries that split in full.
--
-- ## ⚠️ `p_confirmation` is checked in the database rather than only on the page
--
-- The typed confirmation **is** the modal — there is no second "are you sure?" on top of it —
-- and a control that only the page enforces is a control that a POST straight at PostgREST does
-- not meet. Every rule in this platform is enforced where the data is; Slice G found nine of
-- these in `entries` by attempting each bypass with an anonymous client, and `entries.test.ts`
-- has re-attempted them ever since. So the phrase is compared here, and the page's own
-- `required` attribute is the courtesy rather than the control.
--
-- Trimmed and never case-folded. A slug is lower case and a phone keyboard will offer a capital
-- for the first letter, so the page turns autocapitalise off — but **accepting `NN-2026` for
-- `nn-2026` would make the confirmation weaker than the thing it guards**, and the whole
-- mechanism is "type this exact string". The trim is for the trailing space a long-press on a
-- phone keyboard inserts, which is invisible on screen and would read as the function refusing
-- a phrase somebody can see is right.
--
-- ## The argument name is `p_event_slug`, which is not what the issue wrote
--
-- #254 says `reset_event(p_slug, p_confirmation)`. Every other function in this schema takes
-- `p_event_slug` — `event_detail`, `finish_event`, `start_event`, `record_crossing` and eleven
-- more — and PostgREST calls these **by name**, so one function spelling it differently is a
-- caller that has to remember which. A deliberate deviation from the issue's shorthand, stated
-- here rather than left to be noticed in a diff.
create or replace function timing.reset_event(
  p_event_slug text,
  p_confirmation text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_crossings integer;
  v_teams integer;
  v_runners integer;
begin
  if not identity.has_permission('timing.event.manage') then
    return jsonb_build_object('ok', false, 'reason', 'refused');
  end if;

  -- ⚠️ **`for update` rather than a bare select**, and it is the counts that need it rather
  -- than the deletes. Two volunteers pressing at once would each count the same rows before
  -- either deleted any, and the second would then report a blast radius it did not remove —
  -- which is the one number this function exists to return. The lock is on the event row, so
  -- it serialises resets against each other and against `start_event()` and `finish_event()`,
  -- and it does not block `record_crossing()`, which reads the event without one.
  select * into v_event from timing.events where slug = p_event_slug for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  -- ⚠️ **Publication is checked before the phrase**, deliberately. Somebody who typed the slug
  -- correctly into a published race is owed *"this race is published"* rather than being sent
  -- back to type it again — the refusal they need to act on is the one about the record, and
  -- the other order would hide it behind a typo. A published race is the club's permanent
  -- record; unpublishing first is a separate audited act behind `timing.result.publish`, which
  -- this caller may well not hold.
  if v_event.results_published_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'published');
  end if;

  if btrim(coalesce(p_confirmation, '')) is distinct from v_event.slug then
    return jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  end if;

  -- **Counted before the DML**, which is what makes the returned figures the blast radius
  -- somebody agreed to rather than a description of an empty table. `runners` is counted
  -- through its team, because the delete below reaches it by cascade and never names it.
  select count(*)::int into v_crossings
    from timing.crossings c where c.event_id = v_event.id;

  select count(*)::int into v_teams
    from timing.teams t where t.event_id = v_event.id;

  select count(*)::int into v_runners
    from timing.runners r
    join timing.teams t on t.id = r.team_id
   where t.event_id = v_event.id;

  -- ⚠️ **Crossings first. This order is the first of the old function's two corrections.**
  -- `crossings.team_id` is `on delete set null`, so deleting teams first would leave every
  -- capture behind as an orphan — a bib pointing at nothing, which is precisely the population
  -- #252's triage page exists to chase and precisely what a reset is meant to leave none of.
  delete from timing.crossings where event_id = v_event.id;

  -- Runners go with their team, by `on delete cascade`. Bib overrides live on the team row and
  -- go with it too, which is right: a bib is derived from a team number, and neither survives.
  delete from timing.teams where event_id = v_event.id;

  -- ⚠️ **`finished_at` as well as `actually_started_at` — the second correction.** The old
  -- function cleared only the start, so a wiped race came back still marked finished. Splits
  -- are measured against `coalesce(actually_started_at, start_at)`, so leaving the start set
  -- would measure the next rehearsal against the last one's gun.
  update timing.events
     set actually_started_at = null,
         finished_at = null
   where id = v_event.id;

  -- ⚠️ **Audited even when every count is zero.** The intent is the auditable fact: somebody
  -- typed the slug of a race and asked for it to be wiped, and *"it turned out to be empty"* is
  -- not a reason for that to go unrecorded. It is also what makes a second press legible
  -- afterwards — two rows an hour apart say the reset ran twice, which is the ordinary shape of
  -- a rehearsal day.
  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    auth.uid(),
    'event_reset',
    jsonb_build_object(
      'crossings', v_crossings,
      'teams', v_teams,
      'runners', v_runners
    )
  );

  return jsonb_build_object(
    'ok', true,
    'slug', v_event.slug,
    'crossings', v_crossings,
    'teams', v_teams,
    'runners', v_runners
  );
end;
$$;

-- `anon` holds nothing in this schema and this is the last function anybody should be tempted
-- to make an exception for. `packages/db/tests/timing.test.ts` pins the granted list by name,
-- which is what makes a thirtieth entry a decision somebody takes in a diff.
revoke all on function timing.reset_event(text, text) from public, anon;
grant execute on function timing.reset_event(text, text) to authenticated;
