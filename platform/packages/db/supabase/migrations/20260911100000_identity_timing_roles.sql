-- Who may run a race, and who may only stand at the line.
--
-- Two stop-and-asks in one migration, both taken deliberately in
-- `docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md`: **six new
-- permissions** and **two new roles**. Six roles and eleven permissions become eight and
-- seventeen.
--
-- =========================================================================================
-- What this replaces, and why it is not copied
-- =========================================================================================
-- `bindalshah/src-race-timing` carries two layers of authority. `staff_assignments(user_id,
-- role)` is the global one, holding `'admin'` or `'marshal'`; `marshals(event_id, user_id)`
-- is the per-event roster saying whether somebody who holds the marshal role globally may act
-- on *this* event.
--
-- That is a reasonable design and it is a **second answer to a question this schema already
-- answered**. Since ADR-017 a role is a bundle of permissions and code checks the permission,
-- never a role name. Carrying `staff_assignments` across would mean two role tables, two
-- grant paths, and two places a volunteer has to be switched off.
--
-- **And the migration is free, because nobody carries over anyway.** `auth.users` is
-- per-project: every marshal and admin re-registers against the club's project whatever the
-- authority table looks like. There is no account to preserve and so no reason to preserve
-- the shape around it.
--
-- The per-event roster survives, in the `timing` schema, meaning something narrower — *which
-- events* somebody may act on, checked **after** the permission rather than instead of it.
-- Deleting it outright would let anybody holding `timing.crossing.record` write crossings
-- into any race.
--
-- =========================================================================================
-- Neither role is staff, and that is deliberate rather than an omission
-- =========================================================================================
-- `STAFF_ROLES` in `apps/main/worker/admin-shell.ts` is what opens `/admin/` at all, and
-- **neither `timing-admin` nor `timing-marshal` is added to it.** Race-day capture and race
-- administration live at `/timing`, behind these permissions; `/admin/` is the club's back
-- office and answers 404 to anybody who may not be there.
--
-- ⚠️ **A marshal is emphatically not staff.** They are a volunteer with a phone at a line for
-- two hours, and `nn-tester` is the existing precedent for a role that holds a permission and
-- opens no back office. If a timing page is ever added under `/admin/`, that is the moment to
-- revisit this line — not before.
--
-- =========================================================================================
-- `src-admin` gets all six, and that is the recurring cost working as intended
-- =========================================================================================
-- The club's master role holds its permissions as **explicit rows rather than a wildcard**,
-- so that a new permission does not reach every director the day somebody creates it. The
-- price is that every addition forces a decision, and this is that decision for six of them:
-- directors get all six, and `identity-permissions.test.ts` fails until this file says so.
--
-- `super-admin` gets **none** of them, for the reason it holds no `nn.*` permission either: it
-- is the role that grants roles, and a super-admin who needs to run a race grants themselves
-- `timing-admin` — which writes a row in `identity.audit`.

-- -----------------------------------------------------------------------------------------
-- The six permissions
-- -----------------------------------------------------------------------------------------
-- The descriptions are what `/admin/people/` renders beside a role, and they are the only
-- place a volunteer granting one can see what they are handing over. So each says what it
-- actually opens rather than restating its own name.
insert into identity.permissions (slug, description) values
  ('timing.event.manage',
   'Set up a race for timing: its details, the bib numbers, and starting and finishing it.'),
  ('timing.crossing.record',
   'Record runners crossing the line, on a race they are rostered to. What a marshal does.'),
  ('timing.crossing.resolve',
   'Clear a flagged crossing, and correct or discard one that was recorded wrongly.'),
  ('timing.registration.import',
   'Upload the entry list for a race. Reads entrants'' names, emails and ages from the file.'),
  ('timing.result.publish',
   'Finish a race and publish its results and prize list.'),
  ('timing.marshal.assign',
   'Put somebody on a race''s marshal roster, or take them off it.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- The seventh and eighth roles
-- -----------------------------------------------------------------------------------------
insert into identity.roles (slug, description) values
  ('timing-admin',
   'Runs a race on the timing system: sets it up, imports the entry list, assigns bibs, starts and finishes it, resolves flagged crossings and publishes the results.'),
  ('timing-marshal',
   'Records runners crossing the line, on races they have been rostered to. Opens nothing else.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- Who holds what
-- -----------------------------------------------------------------------------------------
-- ⚠️ **`timing-marshal` holds exactly one permission**, and the narrowness is the point. A
-- marshal's phone is used at a line, in a crowd, often by somebody who joined that morning —
-- and the roster row in `timing.marshals` narrows it again to the race they were put on.
insert into identity.role_permissions (role, permission) values
  ('timing-admin', 'timing.crossing.record'),
  ('timing-admin', 'timing.crossing.resolve'),
  ('timing-admin', 'timing.event.manage'),
  ('timing-admin', 'timing.marshal.assign'),
  ('timing-admin', 'timing.registration.import'),
  ('timing-admin', 'timing.result.publish'),
  ('timing-marshal', 'timing.crossing.record'),
  ('src-admin', 'timing.crossing.record'),
  ('src-admin', 'timing.crossing.resolve'),
  ('src-admin', 'timing.event.manage'),
  ('src-admin', 'timing.marshal.assign'),
  ('src-admin', 'timing.registration.import'),
  ('src-admin', 'timing.result.publish')
on conflict (role, permission) do nothing;
