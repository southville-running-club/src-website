# ADR-035 — The timing schema is written here, as `timing`, and `public` stays empty

**Accepted**, 10 September 2026. **Supersedes**
[ADR-002](adr-002-schema-layout.md)'s *"Who may migrate what"* section and its `public` /
`private` rows. Everything else ADR-002 decided stands — `club`, `intake`, the blast-radius
argument for separating them, and *"a v1 sign-up is not an entry"*.

| | |
| --- | --- |
| **Requirement** | [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [C5](../../foundations/requirements.md#c5--capture-race-timing-data-tolerant-of-no-signal), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [convergence](../../foundations/requirements.md#convergence) |
| **Supersedes** | [ADR-002](adr-002-schema-layout.md), in part |

## Context

ADR-002 was written on a premise that has since stopped being true in two ways.

**It assumed one project with two tenants.** Its table gives `public` and `private` to the
timing platform, says *"nothing in `public` or `private` changes — not a column, not a
policy"*, and writes a rule for who may migrate what *"until the monorepo contains the timing
platform"*. In fact the timing platform runs on **its own Supabase project**,
`ovpvzabtjxbszsqschqy`, and the club's project `ketipxpyjjglwpqazsft` has never held a timing
table. The [phases](../../delivery/phases.md#phase-4--the-timing-app-on-cloudflare) document
says *"Same database. One project, schema-separated. Nothing migrates"*; the
[Supabase runbook](../../delivery/runbooks/supabase-setup.md) says the opposite in as many
words. **Two documents disagreeing about where the club's race history lives is the actual
defect**, and it is why this is a record rather than an edit.

**And under [ADR-034](adr-034-the-timing-platform-is-rewritten-on-cloudflare.md) the tables are
written rather than moved.** There is no migration history to inherit and no second migrator
to coordinate with. The rule ADR-002 needed dissolves rather than being replaced.

## Decision

**The timing tables are written into a `timing` schema in `packages/db`, in the club's
project. `public` holds no application table, and `private` is not created.**

| | |
| --- | --- |
| **`timing`, not `public`** | ADR-002 put timing in `public` because that is where it already was in another project. Writing it fresh, there is no reason to inherit that: `public` is the schema everything lands in by accident, and an application schema should be named after what it holds — exactly as `club`, `intake`, `entries`, `identity` and `store` are |
| **No `private` schema** | Helper functions live in `timing` with a pinned `search_path`, which is what `entries` already does and why it does it. A second helper schema is a second place to look |
| **`packages/db` is the only migration home** | One repository, one project, one migration history. New migrations at current timestamps, in this repository's style |
| **The 19 old migrations are not copied** | Their *model* is — `events`, `teams`, `runners`, `crossings`, `marshals`, `admin_actions`. Their files are not. Copying them would put April-to-July 2026 versions behind a remote whose newest is September, and `supabase db push` refuses a version earlier than the remote's newest by refusing **the whole push** |
| **`timing` is added to `[api].schemas`** | `identity`'s and `store`'s precedent exactly. Without it PostgREST answers `PGRST106 Invalid schema` to every call. It is the `[api]` block, not `[auth]` — but `config.toml` still ships to production on the next merge touching a migration, with no partial apply, so `db push` creating the schema must run first. It does |
| **RLS on every table from its first migration** | Public `select` on `events`, `teams` and `crossings` is what makes an anonymous live leaderboard possible with no API tier — which is the same mechanism the results archive will read |

**The event model is copied deliberately, not by default.** `events.format` has carried
`'relay' | 'solo'` since the old app's first migration, `effectiveBib` resolves solo bibs and
the results export already branches on format. A second event model would fork the results
archive, the bib scheme and the categories — which is the argument ADR-002 made and this record
keeps. **And the glossary's reserved word is used correctly here**: an *event* is one running
of one race in one year, which is precisely what `timing.events` holds. `store` had to call its
table `socials` for the opposite reason.

**Three shapes are fixed now because the data import depends on them**, even though the import
is a later step:

- **`teams.purchase_order_id`** stays the import idempotency anchor.
- **`crossings.id` is the client-generated UUID**, so the offline queue's idempotent upsert
  works and so old rows land under their own identity.
- **A bib is `text`**, opaque, exact equality. Never an integer.

**The PII boundary is carried across unchanged and is now a repository-wide rule rather than
one application's habit.** Date of birth, address, phone, emergency contact and medical
information are dropped **at the parser boundary** and never reach the database;
`runners.age_on_day` is computed against the event's race date, and the CSV's own `AgeOnDay`
column is ignored in favour of computing it. That is
[C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) and it is the same
sentence as *personal data is minimised at the boundary*.

## Consequences

- **`packages/db/scripts/check-migration-scope.mjs` is retargeted.** It currently fails any
  migration naming `public` or `private`, to make ADR-002's *"this repository cannot propose
  dropping the timing app's tables"* real rather than assumed. That tenant is gone. The guard
  is worth keeping for a different reason — **`public` should stay empty** — so it keeps
  failing on `public` and stops mentioning `private`, and its header records why the reason
  changed.
- **`CLAUDE.md`'s stop-and-ask on *"the `public` and `private` schemas"* is rewritten** in the
  same change, or it forbids the work this record authorises.
- **The migration-ordering trap applies with full force.** Timing migrations land alongside
  live `entries` and `store` ones. A branch whose migrations sort before a branch that merges
  first strands **every** migration after it, and the symptom reaching a volunteer is *"the
  club's database could not be reached"* on a healthy database. `ls` the migrations directory
  after any rebase.
- **The old project stays authoritative until the import**, and this record does not perform
  it. It only makes the destination shaped to receive it.
- **`auth.users` does not cross projects.** Every marshal and admin re-onboards. That is
  [ADR-036](adr-036-timing-staff-are-identity-permissions.md)'s to answer, not this one's.
- **Nothing here touches `ovpvzabtjxbszsqschqy`.** The old project is read from, exported from,
  and eventually deleted — never migrated.

## Exit cost

**Low while it is only a schema.** Until the data import runs, `timing` holds fixtures, and
dropping it is one migration. After the import it holds the club's only race history, and the
exit cost is whatever the export is worth — which is the argument for taking the manual export
first and keeping it.

## Revisit when

- **The import rehearsal finds the model cannot receive the old rows.** That is a finding about
  this record, and it is why the import is rehearsed rather than attempted.
- **A second race needs a shape `events.format` cannot express.**
- **`public` acquires an application table**, which means the guard was retargeted wrongly.
