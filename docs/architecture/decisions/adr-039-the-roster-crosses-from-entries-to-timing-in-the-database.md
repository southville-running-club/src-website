# ADR-039 — The Nightingale roster crosses from `entries` to `timing` in the database, and what it may carry

**Accepted**, 12 September 2026. **Supersedes** no ADR. It is the first function on this
platform to read across two application schemas, so the carry list is written here rather than
left to whoever writes the SQL.

| | |
| --- | --- |
| **Requirement** | [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [convergence](../../foundations/requirements.md#convergence) |
| **Relates to** | [ADR-035](adr-035-the-timing-schema-joins-this-project.md), [ADR-020](adr-020-race-category-and-gender-are-two-questions.md), [ADR-022](adr-022-a-guide-rides-on-the-runners-entry.md), [ADR-031](adr-031-a-non-binary-entrant-says-where-to-be-placed.md) |

## Context

**The import that exists is built for the wrong race.** `parseRegistrationCsv()` and #202's
screens read a Full On Sport export — that is where Pass the Buck 2026's roster came from and
where its walk-ins were typed. **Nightingale Nightmare 2026's roster is `entries.entrants`**,
in this same database, 110 rows and counting. There is no CSV unless somebody makes one.

Two ways those runners reach `timing.teams` and `timing.runners`:

| | The CSV round trip | A function in the database |
| --- | --- | --- |
| Mechanism | `/admin/nn/`'s start-list export, re-uploaded with a second parser format | `timing.import_from_entries(p_event_slug)`, joining `entries` in one transaction |
| Age on day | not in that export today, and **adding a date of birth to a CSV is a new audience for Article-9-adjacent data** | computed in SQL against `timing.events.start_at`; the date never leaves `entries` |
| Idempotency anchor | whatever the file carries | `entry_purchases.id`, which is what `purchase_order_id` was always modelled on |
| Transfers, cancellations, late entries | re-export, re-upload, hope nothing was hand-edited | re-run |
| A second parser to maintain | yes | no |

**The database wins, and the deciding argument is the date of birth.** Everything else is
convenience; that row is the one that would make a roster export hold a field the club has
spent three ADRs keeping out of places it does not belong. [ADR-035](adr-035-the-timing-schema-joins-this-project.md)
put both schemas in one project precisely so *"two projects cannot join"* stopped being true.

## Decision

**`timing.import_from_entries(p_event_slug text)`, `security definer`, behind
`timing.registration.import`, granted to `authenticated` and to nobody else.** It joins
`entries.entrants` to `entries.entry_purchases` inside one transaction and writes
`timing.teams` and `timing.runners`.

### What it carries, and what it may not

| From `entries.entrants` | Carried? | |
| --- | --- | --- |
| `first_name`, `last_name` | **yes** | `runners.firstname` / `lastname` |
| `date_of_birth` | ⚠️ **never** | Read to compute `age_on_day` against `events.start_at`, and **discarded in the same expression**. There is no date-of-birth column in `timing` and there is not going to be one |
| `gender` | **yes** | See *One vocabulary* below |
| `result_placement` | **yes** | ADR-031's answer. Without it a non-binary entrant has no prize band in `timing`, which is the gap ADR-031 closed in `entries` and would silently re-open here |
| `role` | **yes**, as a flag | ADR-022's guide. See below |
| `club` | **yes** | `runners.club_name`; already on the start list |
| `email` | ⚠️ **guides only** | `entrants.email` is a guide's own address and null for a runner. A runner is reachable through `purchaser_email`, which is a **purchase** fact and does not belong on a roster row |
| `gender_identity` | ⚠️ **never** | ADR-020: it is on `/admin/nn/` and **nowhere else**. Not the start list, not the three exports, not published. A timing roster is none of those things and copying it would make it all three |
| `phone` | ⚠️ **never** | ADR-025 collected it to tell a runner about a change to the race. That is not this |
| `emergency_contact_name`, `emergency_contact_phone` | ⚠️ **never** | Somebody else's personal data, given for one purpose |
| the medical note (`entries.entrant_medical`) | ⚠️ **never** | Article 9, a separate table, a separate consent, and a published retention promise that `timing` has no part in |
| `ea_number` | **n/a** | Null everywhere since decision 007 |

**The rule, stated once so it is not re-derived per column:** `timing` holds what is needed to
put somebody on a start line, time them, and place them in a prize band. Everything the club
holds *about* an entrant — how to reach them, who to ring, what a doctor should know, how they
describe themselves — stays in `entries`, which is the schema with the privacy notice.

### Three things this cannot do without a schema change, and they are part of #248

The decision above does not fit the tables as they stand on 12 September 2026. Naming that
here rather than discovering it in the SQL:

1. **`timing.runners` has no `result_placement`.** ADR-031's placement has nowhere to land, so
   `effectiveCategory()` cannot be answered on the timing side and every non-binary entrant
   would fall to `not-placed`. The column is added.
2. **`timing.runners` has no way to say "guide".** ADR-022's guide takes one of the 250, runs
   the course, gets a bib, and is in **no category and no prize** — `startListCategory()` in
   `nn-admin.ts` answers `'Guide'` by checking `role` *before* it asks about a category. There
   is no `role` in `timing`, so a guide would arrive as a runner with a null gender and be
   rendered as *"No category yet"*, which is a different and wrong statement. The column is
   added.
3. ⚠️ **One vocabulary in `timing.runners.gender`, and it is `entries`'.** The column's own
   comment describes `'M'` / `'F'` *"as the import found it"*, which is the Full On Sport CSV's
   shape. `entries` says `'female' | 'male' | 'non_binary'`, and that is what
   `effectiveCategory()` takes. **A column with two vocabularies written by two importers is
   the restated-closed-list trap in data form** — both writers are correct, both pass review,
   and whichever ran last decides what the prize list says. So the vocabulary is `entries`', in
   one place, and **`parseRegistrationCsv()` maps into it at the parser boundary**, which is
   where that file already drops everything else it must not carry.

### The anchor is `entry_purchases.id`

`teams.purchase_order_id` is `text` and unique per event, and it is *"the import idempotency
anchor"* by its own comment. The purchase id goes in, cast to text.

**Not `entry_no`**, even though it is the human-readable half of the reference somebody quotes
back at the club: it is nullable by design — ADR-030 made it the expand step, and a purchase
from before 31 August 2026 has none. An anchor that is sometimes null is not an anchor.

### A guide gets a bib

ADR-022's guide runs the course and takes one of the 250, so they are on the start line and
something has to be pinned to them. They are **flagged** on the roster, exactly as the start
list flags them, **excluded from awards** the way `computeAwards` already excludes, and in no
category. This matches what the club already does on paper.

### Re-running is the point

A transfer replaces the runner on that team; a refunded entry's runner is removed; a late entry
arrives. **`team_number` and both bib overrides are never touched**, for the reason
`import_registration()`'s header already gives: re-running after bibs are assigned would
renumber a field against numbers already printed and pinned on. `race_status` and `dnf_at` are
race-day facts and an entry list has no opinion about who did not finish.

A cancellation needs no special case: `cancel_entry()` **deletes the entrant rows** and sets the
purchase to `refunded`, so a join on `status = 'paid'` already returns nothing for it. The
removal falls out of the join rather than being coded.

## Consequences

- **`packages/db/tests/timing.test.ts`'s grant pin goes from four functions to five**, and that
  is the mechanism working rather than a chore. It has already gone red once, the day the
  registration import added three, which is the argument for reading the test rather than any
  count written in prose.
- **The bypass test is the one that matters.** It posts **every** `entrants` column at the
  function and asserts `timing.runners` gained none of them — `date_of_birth`, `phone`,
  `gender_identity`, both emergency-contact fields and the medical note. That is
  `entries-rules.test.ts`'s shape: attempt the bypass, assert the specific refusal, never
  assert the constraint's text.
- ⚠️ **A `security definer` function reading across schemas can see rows its caller cannot, and
  that is the whole point and the whole risk.** The permission check is the only thing standing
  between `timing.registration.import` and every entrant the club holds. It is checked first,
  before anything is read, and it returns `{ok: false, reason: 'refused'}` rather than raising
  — `import_registration()`'s shape.
- **`search_path` is pinned.** The `timing` functions use `timing, pg_catalog` and the `entries`
  ones use `''` with everything qualified. This one reaches into `entries`, so it qualifies
  every `entries` identifier regardless of which convention it follows; `entries.read_interest_list()`
  reading `intake.nn_interest` is the existing precedent for the shape.
- **#202 keeps its CSV screens**, for Pass the Buck's history and for walk-ins typed at a desk.
  They stop being on the critical path for Nightingale Nightmare, which is what makes them
  lower priority rather than dead code.
- **The `entries` schema is unchanged.** Nothing is added to it, nothing is read that the admin
  surface does not already read, and no new consent is required — the runners are already
  entered in a race the club is timing.

## Exit cost

**One migration.** The function is `create or replace`-able and writes rows that
`import_registration()` could have written; dropping it costs the roster, not the race. The
three schema additions outlive it, and two of them (`result_placement`, the guide flag) are
owed to `timing` regardless of how the roster arrives.

## Revisit when

- **A race is timed that is not entered through `entries`.** Pass the Buck is the existing
  case and it keeps the CSV path; a third route would be the moment to ask whether two
  importers is still right.
- **`timing` ever needs a field this record refuses.** The answer is not to widen the function
  quietly — every row in the carry list above is somebody's decision, and three of them are
  ADRs.
