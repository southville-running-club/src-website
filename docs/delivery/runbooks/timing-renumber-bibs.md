# Numbering the field in surname order

**A one-off, run by hand in the Supabase SQL editor, before any race number has gone
anywhere.** It gives Nightingale Nightmare 2026 its race numbers again from 001, in surname
order, so the pile of vests at the desk is in the same order as the collection sheet. Nothing
is deployed and no migration is applied, which is why it can be done during the race-week
change freeze.

**Decided by a maintainer on 30 October 2026.** The club asked for surname order; nothing
anybody had been given carried a number yet.

---

## Why Assign bibs cannot do this

**Assign bibs only fills in a missing number and never renumbers anybody**, because once a
vest is handed over its number is that runner's
([ADR-067](../../architecture/decisions/adr-067-assign-bibs-numbers-a-guide.md)). And its own
order is not entry order, although
[`20260913140000_timing_bibs.sql`](../../../platform/packages/db/supabase/migrations/20260913140000_timing_bibs.sql)
says it is. It orders by `csv_row_index`, then `teams.created_at`, then `teams.id`:

- `csv_row_index` is null for every entry the club's own import creates. Only a CSV upload
  sets it.
- `created_at` is `now()`, which is **the same instant for every row written in one
  transaction**, so one press of **Import from entries** gives the whole field one time.
- That leaves `id`, a random UUID. **Within one import, the numbers are effectively random.**

Whether Assign bibs should number by surname from 2027 is a decision for after the race.

---

## Step 0 — before you start

- [ ] **No race number has gone anywhere** — not printed beside a name, not packed into an
      envelope, not told to a runner. **If one has, stop**: renumbering then puts two runners
      on one vest.
- [ ] **Nothing has been captured on the race — and this check comes before the import.** The
      script refuses if anything has, because a capture keeps the runner it matched when their
      number changes. ⚠️ **Do not press Reset unless something has been captured.** Reset in the
      race's **Danger zone** deletes the captures **and the whole entry list with every number
      on it**, not only a rehearsal's captures. It cost the 2026 field on 30 October 2026, when
      nothing had been captured and the reset was not needed. The step 1 preview shows nobody
      at all if the entry list is empty, which is the tell. If you do reset, import again
      before going on.
- [ ] **The field is final.** Cancel any tester entry, then press **Import from entries** on
      `/timing/events/nn-2026/registration/` (`timing-race-night.md` step 1.5). You do not need
      to press **Assign bibs** first: this numbers everybody, with a number or without one.
- [ ] **Any name corrected on the Roster since the last import is still corrected.** A Roster
      **Edit** changes the timing app's copy only, so a reset and re-import brings back the name
      as it was entered. Re-do the correction before numbering: the order is by name.
- [ ] **Nobody else is on the Registration or Roster page.** The script locks the tables while
      it runs, which takes well under a second, but a number typed in a moment before it starts
      is replaced.
- [ ] You are in the **Supabase SQL editor for the production project**. This needs no service
      role key and no application credential.

---

## Step 1 — read the new numbers first

**A plain `select`, which changes nothing.** It lists every runner in the order they will be
numbered, with the number each will get, their guide's number if they have one, and the number
they hold now. It is the same order and the same arithmetic as the script in step 2, checked
row for row against it.

- [ ] **Read down the surnames.** They should run A to Z, with "smith" and "Smith" together and
      "de Souza" under D.
- [ ] **A guide does not get a row of their own.** Their number is `guide_new_number` on their
      runner's row, the one after the runner's. So the numbers jump by two after anybody with a
      guide, and the guide's own surname plays no part.
- [ ] **Look for a surname that has landed out of place**: a stray leading space, or a surname
      typed into the first-name box. The order is the names exactly as they are held, so fix the
      name on the Roster's **Edit** panel first and run this again.

```sql
-- Read-only: the number each runner and guide on nn-2026 would get. Changes nothing.
with field as (
  select r.lastname,
         r.firstname,
         coalesce(nullif(btrim(coalesce(t.bib_leg1, '')), ''), t.team_number) as wearing_now,
         exists (
           select 1 from timing.runners g
            where g.team_id = t.id and g.leg = 2 and g.role = 'guide'
         ) as has_guide,
         row_number() over (
           order by lower(r.lastname) collate "en-GB-x-icu",
                    lower(r.firstname) collate "en-GB-x-icu",
                    r.id
         ) as place
    from timing.teams t
    join timing.events e on e.id = t.event_id and e.slug = 'nn-2026'
    join timing.runners r on r.team_id = t.id and r.leg = 1
),
numbered as (
  select field.*,
         1 + coalesce(sum(case when has_guide then 2 else 1 end) over (
           order by place rows between unbounded preceding and 1 preceding), 0) as n
    from field
)
select timing.padded_bib(n::integer, e.bib_pad_width) as new_number,
       lastname,
       firstname,
       case when has_guide
            then timing.padded_bib((n + 1)::integer, e.bib_pad_width) end as guide_new_number,
       wearing_now
  from numbered
  join timing.events e on e.slug = 'nn-2026'
 order by place;
```

---

## Step 2 — the dry run

Paste the whole block below into the SQL editor and run it **as it is**, with `v_commit`
false. It does all the work, then throws it away, and **ends in an error on purpose**:

> `DRY RUN - nothing was changed. <runners> runners numbered 001 to <last>, with <guides> guides each straight after their runner. …`

Check that:

- [ ] **The runner count is the Registration page's Entries figure**, and runners plus guides
      is its Runners figure.
- [ ] **The last number is 250 or under.** The vests stop at 250 and the script refuses
      beyond it.
- [ ] **The two "cleared" and "replaced" figures are what you expect.** They are numbers
      somebody typed in by hand — a walk-in's suggested number or a guide's — which this replaces
      with the surname order's.

If it says **Refused** instead, nothing was changed; the message says why.

```sql
-- Renumber nn-2026 in surname order. Runs as a dry run until v_commit is true.
do $$
declare
  v_commit constant boolean := false;     -- ← true only after a clean dry run
  v_slug constant text := 'nn-2026';
  v_highest_vest constant integer := 250; -- the printed vests run 001 to 250

  v_event timing.events%rowtype;
  v_crossings integer;
  v_no_runner integer;
  v_teams integer;
  v_guides integer;
  v_leg1_overrides integer;
  v_leg2_numbers integer;
  v_previous jsonb;
  v_team record;
  v_next integer := 1;
  v_bib text;
  v_first text;
  v_last text;
  v_twice integer;
  v_summary text;
begin
  -- Nobody may assign, add or capture while this runs.
  lock table timing.teams in exclusive mode;
  lock table timing.crossings in share mode;

  select * into v_event from timing.events where slug = v_slug;
  if not found then
    raise exception 'Refused: there is no timing event %.', v_slug;
  end if;
  if v_event.format <> 'solo' then
    raise exception 'Refused: % is a % race, and this is written for a solo race.',
      v_slug, v_event.format;
  end if;
  if v_event.actually_started_at is not null
     or v_event.finished_at is not null
     or v_event.results_published_at is not null then
    raise exception 'Refused: % has been started, finished or published.', v_slug;
  end if;

  -- A crossing already matched to a team keeps that team when its number changes.
  select count(*) into v_crossings from timing.crossings where event_id = v_event.id;
  if v_crossings > 0 then
    raise exception 'Refused: % crossing(s) are already recorded on %. Clear the rehearsal '
      'from the Danger zone first.', v_crossings, v_slug;
  end if;

  select count(*) into v_no_runner
    from timing.teams t
   where t.event_id = v_event.id
     and not exists (
       select 1 from timing.runners r
        where r.team_id = t.id and r.leg = 1 and r.role = 'runner'
     );
  if v_no_runner > 0 then
    raise exception 'Refused: % entr(y/ies) on % have no runner on leg 1.', v_no_runner, v_slug;
  end if;

  select count(*),
         count(*) filter (where exists (
           select 1 from timing.runners g
            where g.team_id = t.id and g.leg = 2 and g.role = 'guide')),
         count(*) filter (where nullif(btrim(coalesce(t.bib_leg1, '')), '') is not null),
         count(*) filter (where nullif(btrim(coalesce(t.bib_leg2, '')), '') is not null),
         coalesce(jsonb_agg(jsonb_build_object(
           'team_id', t.id,
           'team_number', t.team_number,
           'bib_leg1', t.bib_leg1,
           'bib_leg2', t.bib_leg2) order by t.team_number), '[]'::jsonb)
    into v_teams, v_guides, v_leg1_overrides, v_leg2_numbers, v_previous
    from timing.teams t
   where t.event_id = v_event.id;

  if v_teams + v_guides > v_highest_vest then
    raise exception 'Refused: % runners and % guides need % numbers, and the vests stop at %.',
      v_teams, v_guides, v_teams + v_guides, v_highest_vest;
  end if;

  -- Clear everybody first: a race's team numbers are unique, so handing out 001 while somebody
  -- still holds it would collide. Hand-typed numbers go too, so every number is the new order's.
  update timing.teams
     set team_number = null, bib_leg1 = null, bib_leg2 = null
   where event_id = v_event.id;

  -- Surname, then first name, as the Roster sorts: lower() so "smith" and "Smith" are one name.
  -- A guide takes the number straight after their runner, as Assign bibs does (ADR-067).
  for v_team in
    select t.id,
           exists (
             select 1 from timing.runners g
              where g.team_id = t.id and g.leg = 2 and g.role = 'guide'
           ) as has_guide
      from timing.teams t
      join timing.runners r on r.team_id = t.id and r.leg = 1
     where t.event_id = v_event.id
     order by lower(r.lastname) collate "en-GB-x-icu",
              lower(r.firstname) collate "en-GB-x-icu",
              r.id
  loop
    v_bib := timing.padded_bib(v_next, v_event.bib_pad_width);
    update timing.teams set team_number = v_bib where id = v_team.id;
    v_first := coalesce(v_first, v_bib);
    v_last := v_bib;
    v_next := v_next + 1;

    if v_team.has_guide then
      v_bib := timing.padded_bib(v_next, v_event.bib_pad_width);
      update timing.teams set bib_leg2 = v_bib where id = v_team.id;
      v_last := v_bib;
      v_next := v_next + 1;
    end if;
  end loop;

  -- No number worn twice, runners' and guides' together.
  select count(*) into v_twice
    from (
      select bib from (
        select team_number as bib from timing.teams where event_id = v_event.id
        union all
        select bib_leg2 from timing.teams where event_id = v_event.id and bib_leg2 is not null
      ) worn
      group by bib having count(*) > 1
    ) clashes;
  if v_twice > 0 then
    raise exception 'Refused: % number(s) would be worn twice. Nothing was changed.', v_twice;
  end if;

  -- The audit row carries every previous number, which is what the undo restores from.
  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (
    v_event.id,
    null,
    'bibs_renumbered',
    jsonb_build_object(
      'order', 'surname, then first name',
      'runbook', 'docs/delivery/runbooks/timing-renumber-bibs.md',
      'numbered', v_teams,
      'guides_numbered', v_guides,
      'first', v_first,
      'last', v_last,
      'hand_typed_runner_numbers_cleared', v_leg1_overrides,
      'guide_numbers_replaced', v_leg2_numbers,
      'previous', v_previous
    )
  );

  v_summary := format(
    '%s runners numbered %s to %s, with %s guides each straight after their runner. '
    '%s hand-typed runner number(s) cleared; %s guide number(s) replaced.',
    v_teams, coalesce(v_first, '-'), coalesce(v_last, '-'), v_guides,
    v_leg1_overrides, v_leg2_numbers);

  if not v_commit then
    raise exception 'DRY RUN - nothing was changed. %', v_summary
      using hint = 'If that is right, set v_commit to true and run it again.';
  end if;

  raise notice 'Done. %', v_summary;
end
$$;
```

**What it does, in order:** refuses unless the race is a solo race that has not started,
finished or published, has nothing captured, and has a runner on leg 1 of every entry; keeps
every current number; clears them all, because a race's team numbers are unique and 001 cannot
be handed out while somebody still holds it; numbers the entries by surname then first name,
**each guide straight after their runner** as Assign bibs does; checks no number is worn twice;
and writes a `bibs_renumbered` row to `timing.admin_actions` carrying every previous number,
which is what the undo below restores from.

**The order is the Roster page's**, `desk-roster.ts`'s `en-GB` sort, so a printed sheet sorted
by name reads 001 down. `lower()` makes "smith" and "Smith" one surname, as the Roster does.
One difference is left: two surnames that differ **only by an accent**, such as Olander and
Ölander, are put unaccented first rather than sorted by first name. That is harmless; it
swaps two neighbours.

---

## Step 3 — keep it

- [ ] Change `false` to `true` on the `v_commit` line, and run the block again.
- [ ] The editor reports success. The notice reading **"Done. …"** repeats the dry run's
      figures; some versions of the editor do not show notices, which is fine.

---

## Step 4 — check it

- [ ] Open **`/timing/events/nn-2026/roster`** and sort by **Bib**. The names read A to Z,
      and every guide's number is the one after their runner's.
- [ ] Sort by **Name** and press **Print**. That is the collection sheet, and its numbers now
      run 001 down the page.
- [ ] Fill in a row in [the record](#record-of-runs) below, in the same pull request as
      anything else you change.

---

## Afterwards — late entries

**This is a one-off, and the field stays in surname order only until it changes.**

- **A late entry or a given place** is imported and numbered by **Assign bibs** as usual, which
  carries on from the highest number. It goes on the end, not into its alphabetical place.
- **A transfer keeps the number and changes the name**, so that runner is out of place too.
- **Neither needs anything doing.** The collection sheet sorted by name still finds them.
  Running this script again after numbers have been handed out is exactly what Step 0 forbids.

---

## Undo

Restores the numbers the race had before the most recent renumbering, **while nothing has been
captured**. Dry run first, exactly as above. An entry imported after the renumbering has no
previous number, is left without one, and is numbered by pressing **Assign bibs**.

```sql
-- Put back the numbers nn-2026 had before the most recent renumbering. Dry run until v_commit.
do $$
declare
  v_commit constant boolean := false;     -- ← true only after a clean dry run
  v_slug constant text := 'nn-2026';

  v_event timing.events%rowtype;
  v_crossings integer;
  v_previous jsonb;
  v_restored integer;
  v_unknown integer;
begin
  lock table timing.teams in exclusive mode;
  lock table timing.crossings in share mode;

  select * into v_event from timing.events where slug = v_slug;
  if not found then
    raise exception 'Refused: there is no timing event %.', v_slug;
  end if;

  select count(*) into v_crossings from timing.crossings where event_id = v_event.id;
  if v_crossings > 0 then
    raise exception 'Refused: % crossing(s) are already recorded on %.', v_crossings, v_slug;
  end if;

  select a.detail -> 'previous' into v_previous
    from timing.admin_actions a
   where a.event_id = v_event.id and a.action = 'bibs_renumbered'
   order by a.created_at desc
   limit 1;
  if v_previous is null then
    raise exception 'Refused: % has never been renumbered.', v_slug;
  end if;

  update timing.teams
     set team_number = null, bib_leg1 = null, bib_leg2 = null
   where event_id = v_event.id;

  update timing.teams t
     set team_number = p ->> 'team_number',
         bib_leg1 = p ->> 'bib_leg1',
         bib_leg2 = p ->> 'bib_leg2'
    from jsonb_array_elements(v_previous) p
   where t.event_id = v_event.id
     and t.id = (p ->> 'team_id')::uuid;
  get diagnostics v_restored = row_count;

  -- An entry imported after the renumbering has no previous number, and is left without one.
  select count(*) into v_unknown
    from timing.teams t
   where t.event_id = v_event.id
     and not exists (
       select 1 from jsonb_array_elements(v_previous) p where (p ->> 'team_id')::uuid = t.id
     );

  insert into timing.admin_actions (event_id, actor_id, action, detail)
  values (v_event.id, null, 'bibs_renumbering_undone',
          jsonb_build_object('restored', v_restored, 'left_unnumbered', v_unknown));

  if not v_commit then
    raise exception 'DRY RUN - nothing was changed. Would restore % entries; % newer entr(ies) '
      'would be left without a number for Assign bibs.', v_restored, v_unknown
      using hint = 'If that is right, set v_commit to true and run it again.';
  end if;

  raise notice 'Done. Restored % entries; % left for Assign bibs.', v_restored, v_unknown;
end
$$;
```

---

## Record of runs

| Date | By | What the "Done." line said |
| --- | --- | --- |
| 30 October 2026, about 19:00 GMT | bindalshah, maintainer. Run through the Supabase connector by Claude Code on that go-ahead, rather than pasted into the editor | 246 runners numbered 001 to 248, with 2 guides each straight after their runner. 0 hand-typed runner number(s) cleared; 0 guide number(s) replaced. |

**30 October 2026, what led up to it.** Assign bibs had numbered the field at 18:23 in its own
order. At 18:50 the race was **Reset** from the Danger zone with nothing captured, which deleted
all 246 entries and their numbers; that is what the Step 0 warning above is for. The field was
imported again, and the script ran on an unnumbered field. **A Roster name correction made at
18:24 was lost with the reset and had not been re-done**, so one runner held with a one-letter
surname was numbered under that letter, as held. A read-only check afterwards found 248
different three-digit numbers with no gaps, every guide one above their runner, the number
order matching the surname order for all 246 runners, and nothing captured.

---

## How this was tested

Against a local database, inside a transaction that was rolled back, on fifteen invented
runners in a deliberately awkward order: an apostrophe, a lower-case "smith" beside "Smith",
"de Souza", "Ölander" beside "Olander", "Smith Jones" beside "Smith-Jones", a guide who already
had a number, a guide who had none, and a runner with a hand-typed number. The dry run left
every number as it was; the real run numbered them 001 to 017 in the same order as
`Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' })`, the Roster's own sort; the
undo put back every original number; and one recorded crossing made it refuse. **The step 1
preview, run on the same runners before the script, matched the script's result row for
row**, every runner's number and every guide's.
