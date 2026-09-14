-- ==========================================================================================
-- What a published result carries, and the one bit a link may ask about
-- ==========================================================================================
--
-- Issue [#242](https://github.com/southville-running-club/src-website/issues/242), under
-- [ADR-042](../../../../docs/architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md)
-- and [ADR-043](../../../../docs/architecture/decisions/adr-043-a-published-result-carries-a-name-a-category-and-a-time.md).
-- #241 made `timing.results_for_event()` answer `anon` once a race is published. This decides
-- **what that answer says to the internet**, and adds the one small read a link to the page
-- needs.
--
-- ## ⚠️ The disclosure #241 opened, which nothing on the page would have shown
--
-- `results_for_event()` returns, per named runner, `firstname`, `lastname`, `gender` and
-- `age_on_day` — an **exact age on race day**. `20260914100000`'s own header argues the grant
-- is safe partly because *"the answer's shape is unchanged — no email address, no club"*, which
-- is true and is a claim about the two columns somebody thought to leave out. It is not a claim
-- about the one that was left in.
--
-- `/nn/<year>/results/` renders a category and no age at all, so **nothing about looking at the
-- page would ever have revealed it** — which is exactly what made it easy to miss. The review
-- on [#284](https://github.com/southville-running-club/src-website/pull/284) found it and #242
-- was asked to settle it.
--
-- **#242's own definition of done already contains the club's answer**: *a published result
-- carries a name, a category and a time, which `/nn/privacy/` already says the club publishes
-- results by — and a field beyond those is a stop-and-ask.* An exact age beside a full name is
-- a field beyond those. So this is not a new decision being taken here; it is the recorded one
-- being applied to a payload that had quietly stopped matching it.
--
-- ## The rule: the exact age is withheld once the race is published
--
-- Not *"withheld from `anon`"*, and the difference is the whole design:
--
--   * **Withheld by publication**, so once a race is published **every caller gets the same
--     answer** — a holder of `nn.results.read` included. `/nn/<year>/results/` is then the same
--     bytes for everybody, which is the only arrangement in which it can carry a **public**
--     `Cache-Control` at all. A payload that varied by permission on a publicly cacheable
--     address is a cache-poisoning defect waiting to be written, and #242 asks for that address
--     to be cacheable.
--   * **The preview keeps it**, because the preview exists so that somebody can check the data
--     before the internet reads it, and an age is exactly the kind of thing being checked. A
--     race is unpublished while it is being prepared, and a correction after publication is
--     *unpublish, fix, publish* — ADR-042 — so the age is available at every moment somebody is
--     working on the data.
--
-- ⚠️ **It is returned as `null` rather than dropped from the object**, deliberately: the key is
-- nullable already (`add_walk_in()` writes a runner with no age), so every reader already
-- handles a null, and dropping a key would be the kind of shape change that compiles and then
-- throws. The consequence a reader should expect is that a published page shows a race
-- **category** and not an age band — see ADR-043 for what that costs and who has to decide it.
--
-- ## What is added to the answer, and why it is the opposite direction
--
-- `result_placement` and `role` join each runner. Neither is new personal data on a page:
--
--   * **`result_placement`** is [ADR-031](../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s
--     answer — which of the two categories the club awards prizes in a non-binary runner asked
--     for their result to count in. Without it the page would have had to read `gender` alone,
--     which is precisely the third branch ADR-031 exists to prevent: every non-binary runner
--     would render as no category at all, whatever they actually asked for.
--     `placementFor()` in `packages/shared/src/timing/gender.ts` is the one resolver, and it
--     needs both halves.
--   * **`role`** is [ADR-022](../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md)'s
--     — a visually impaired runner's guide runs the course, wears a bib and is in **no category
--     and no prize**. `awards.ts` already excludes them and could only do so because it is
--     handed the column; a results page that was not would put a guide in a prize band.
--
-- ⚠️ **`packages/shared/src/timing/rows.ts` has declared both on `TimingRunner` since #202 and
-- this answer did not carry them**, so `apps/main/worker/nn-results.ts` was casting a payload
-- that provably did not satisfy the type it named. It compiled, because the cast is
-- `as unknown as`. That is the mismatch `rows.ts`'s own header warns about in as many words:
-- *"a column named differently in the migration would compile fine and fail at runtime"*.
--
-- ## The second `anon`-callable function in this schema, and why it is not the first one again
--
-- ⚠️ `results_published_at()` is granted to `anon`, and `20260914100000`'s header calls its own
-- grant *"the first `anon` grant in this schema"* while ADR-042's consequences call it *"and
-- the only one"*. That sentence is superseded on sight by ADR-043 rather than edited here, and
-- the argument for a second is narrow:
--
--   * **`/nn/` and `/nn/<year>/` must link to the results only once they are published**,
--     because a link to a 404 is a claim about a record. So the Worker has to ask a question
--     on those two pages, for a signed-out visitor, on every view.
--   * **The question is one bit**, and `results_for_event()` answers it by returning the entire
--     field — every team, every runner and every crossing — which on a full Nightingale
--     Nightmare is two hundred and fifty teams of payload to decide whether to paint an anchor.
--   * **It discloses exactly what the link discloses**, which is the test that matters: the
--     rendered page already tells anybody that this race's results are public, so a function
--     answering the same fact adds nothing a visitor could not read off the markup.
--
-- It returns `null` for a race that does not exist and for one that is not published, and the
-- two are indistinguishable — the property `/nn/<year>/results/`'s 404 rests on.
-- `packages/db/tests/timing.test.ts` pins the granted list by name, so a third is a decision
-- somebody takes in a diff.
--
-- ## Expand, migrate, contract
--
-- Expand only. No column changes, no constraint changes. The **deployed** Worker reads
-- `event`, `teams`, `crossings` and the runner keys it already reads; two keys are added and
-- one keeps its name and answers `null` more often, all of which the deployed reader survives
-- unchanged — it renders `teams.category`, which is untouched, and never looks at `age_on_day`.

-- ------------------------------------------------------------------------------------------
-- results_published_at — the one bit a link may ask about
-- ------------------------------------------------------------------------------------------
-- `security definer` for the reason every read in this schema is: the six tables have RLS on
-- and no policy, so nothing reaches them except through a function that authorises inside
-- itself. This one authorises by answering a fact that publication has already made public.
--
-- `language sql` rather than `plpgsql`, and the column is qualified: an unqualified
-- `results_published_at` inside a PL/pgSQL body would be ambiguous against the function's own
-- name, and this file is short enough not to need a body at all.
create or replace function timing.results_published_at(p_event_slug text)
  returns timestamptz
  language sql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
  select e.results_published_at
    from timing.events e
   where e.slug = p_event_slug;
$$;

comment on function timing.results_published_at(text) is
  'When this race''s results became public, or null for a race that is not published and for '
  'one that does not exist - the two are deliberately indistinguishable. Public: it answers '
  'the same fact the published page already states. See ADR-043.';

revoke all on function timing.results_published_at(text) from public;
grant execute on function timing.results_published_at(text) to anon, authenticated;

-- ------------------------------------------------------------------------------------------
-- results_for_event — the same answer, minus the exact age, plus what a category needs
-- ------------------------------------------------------------------------------------------
-- Replaced whole, because `create or replace function` has no smaller unit. Everything above
-- the runner object is `20260914100000`'s, unchanged.
create or replace function timing.results_for_event(p_event_slug text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = timing, pg_catalog
as $$
declare
  v_event timing.events%rowtype;
  v_published boolean;
begin
  select * into v_event from timing.events where slug = p_event_slug;
  if not found then
    return null;
  end if;

  v_published := v_event.results_published_at is not null;

  -- `null`, not an exception, and the same `null` as above: a refused read has to be
  -- indistinguishable from a race that does not exist, or the 404 on `/nn/<year>/results/`
  -- becomes a confirmation that something is there. `identity.has_permission` reads
  -- `auth.uid()` from the request's own token, which `security definer` does not change, and
  -- it is false for an anonymous caller.
  if not v_published and not identity.has_permission('nn.results.read') then
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
          -- Names and what a race category is derived from. Not email, not club: unchanged,
          -- and the assertion in `timing.test.ts` that matters most now that this answer can
          -- reach the internet.
          --
          -- ⚠️ **`age_on_day` is null once the race is published** - see the header. The
          -- published answer is the same answer for every caller, which is what lets the page
          -- carry a public `Cache-Control`, and an exact age beside a full name is a field
          -- beyond the name, category and time the club publishes a result by.
          'runners', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'leg', r.leg,
                'firstname', r.firstname,
                'lastname', r.lastname,
                'gender', r.gender,
                'result_placement', r.result_placement,
                'role', r.role,
                'age_on_day', case when v_published then null else r.age_on_day end
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

-- Restated rather than assumed. `create or replace` keeps the existing grants, and a migration
-- that relied on that would be one rebase away from a function the public could execute.
revoke all on function timing.results_for_event(text) from public;
grant execute on function timing.results_for_event(text) to anon, authenticated;
