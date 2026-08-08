# ADR-002 — Four schemas in one project, and Nightingale Nightmare sign-ups land in `intake`

**Accepted**, 8 August 2026. Implements
[decision 002](../../decisions/decision-log.md#002--hold-the-clubs-data-in-supabase-on-the-free-tier).

| | |
| --- | --- |
| **Requirement** | [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully), [C17](../../foundations/requirements.md#c17--collect-form-submissions) |
| **Options** | [database](../investigations/database.md#schema-design) |

## Context

[Decision 002](../../decisions/decision-log.md) put website and timing data in **one
Supabase project**. That is close to forced rather than chosen:
[C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
requires results *derived from timing data rather than re-keyed*, and two Supabase projects
are two Postgres instances that cannot join.

What that decision did not settle is the separation **inside** the project, and the
[build brief](../../delivery/nn-build-brief.md#deliberately-left-open) left *"where the rows
land"* explicitly open, to be decided before the sign-up form persists anything.

The form needs a table now: **sign-ups open in roughly two weeks.**

## Decision

**Four schemas.**

| Schema | Holds | Owner | Anonymous write |
| --- | --- | --- | --- |
| `public` | **Timing, unchanged** — `events`, `teams`, `runners`, `crossings`, `marshals`, `staff_assignments`, `admin_actions` | Timing platform | No |
| `private` | **Unchanged** — helper functions, pinned `search_path` | Timing platform | No |
| `club` | Members, membership periods, EA registrations, session-subscription payers, benefits, document metadata | `packages/db` | **Never** |
| `intake` | Public form submissions | `packages/db` | **Yes, insert only** |

**Nightingale Nightmare v1 sign-ups go to `intake.nn_interest`** — name, email, consent,
timestamp. Nothing else. Timestamps UTC.

**Nothing in `public` or `private` changes.** Not a column, not a policy.

### Why `intake` is separate from `club`

Public forms need an RLS policy permitting **anonymous `insert`**. Getting that wrong on a
schema that also holds the membership list is a personal-data incident. Getting it wrong on
a schema holding only what somebody just typed into a public form is a nuisance.

> **The schema boundary is the blast radius.**

### Why this is not the timing app's event model

Nightingale Nightmare **is an event, not a second application** — and
[`events.format` has carried `'relay' | 'solo'` since the timing app's first
migration](../../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know),
so when the race takes **real entries** they belong in that model rather than a copy of it.
A copy would fork the results archive, the bib scheme and the categories.

**But a v1 sign-up is not an entry.** It has no bib, no category, no payment and no event
relationship — it is an expression of interest. So it belongs in `intake`, and not in the
timing model either.

### Who may migrate what

The monorepo ([ADR-001](adr-001-one-monorepo.md)) does not yet contain the timing platform,
so **two repositories share one database** until it does. Supabase keeps a single migration
history per project, so this needs a rule rather than good intentions:

| | |
| --- | --- |
| `public`, `private` | Migrated from `src-race-timing`, as today |
| `club`, `intake` | Migrated from `packages/db` |
| **Diff and push are schema-scoped** | `supabase db diff --schema club,intake`. [Confirmed supported](https://supabase.com/docs/guides/deployment/database-migrations) |
| **`supabase db reset` against the shared remote** | **Never.** It is a local command, and treating it otherwise destroys the other application |

When the timing platform joins the monorepo, `packages/db` becomes the single migration home
and this rule retires.

## Consequences

- **The anonymous-insert policy is confined to one schema** that holds no membership data.
- **`club.members` and `club.subscribers` will be distinct tables.**
  [C4](../../foundations/requirements.md#c4--take-payments) is explicit that the £2.50
  subscription *"is not membership and its payers are not a membership list"* — ~103 pay it,
  94 are members, and it is open to non-members.
- **A future migration is implied**: when Nightingale Nightmare takes paid entries, those go
  into the event model, and `intake.nn_interest` becomes a historical record rather than the
  entry table. That is expected, not technical debt.
- **Promoting an `intake` row into `club`** — an interested person becoming a member — is a
  real flow with a lawful-basis question, and is **not** designed yet.
- Any new entry surface [inherits the timing app's PII
  boundary](../../reference/timing-app-review.md#runners): derive and store age, never store
  date of birth.

## Exit cost

**Low.** Schemas rename with `ALTER SCHEMA`; the data is a standard `pg_dump` either way.
Moving a table between schemas does not rewrite it.

## Revisit when

- Nightingale Nightmare takes paid entries — the entry model question becomes live.
- A form needs to write anything that is not safe under an anonymous-insert policy.
- `intake` rows need promoting into `club`, which needs a lawful basis first.
- The database approaches 500 MB, per
  [decision 002](../../decisions/decision-log.md)'s own trigger.
