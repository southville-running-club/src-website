# Database architecture

How many Supabase projects, how the data inside one is separated, who may change the
schema, and what happens when it needs restoring.

**Postgres in `eu-west-2` is settled** —
[decision 002](../../decisions/decision-log.md#002--hold-the-clubs-data-in-supabase-on-the-free-tier).
**The schema-separation question below is settled too** —
[ADR-002](../decisions/adr-002-schema-layout.md), later extended by `entries` and `identity`
as those were built. Everything below is the shape the decision was reasoned from.

---

## Project topology

### One project, not one per application

**This is close to forced rather than chosen**, and the forcing requirement is
[C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically):

> A page per race per year... **derived from timing data rather than re-keyed.**

The results archive has to read the timing tables. **Two Supabase projects are two Postgres
instances and cannot join** — the website would have to call an API, replicate the data, or
re-key it. Re-keying is the thing this programme exists to stop, and the other two are
architecture built to work around a decision nobody had to make.

### What the free tier actually allows

Confirmed against Supabase's own documentation, because two of these are load-bearing and
one is a trap:

| | |
| --- | --- |
| **Two active projects** | And the limit applies **across every organisation where you are an Owner or Administrator** — so a volunteer's unrelated side project consumes the club's allowance |
| **Paused projects do not count** | Unlimited paused projects |
| **Free projects pause after one week of inactivity** | Judged on database activity |
| **500 MB database, 1 GB file storage** | Files belong in R2 anyway |
| **Branching requires Pro** | So a database per pull request is not available. See [local development](local-development.md) |

**Two consequences the club should plan around.**

**The two-project ceiling is per person, not per club.** Before relying on a second project
for staging, check what each volunteer already owns or administers elsewhere. This is not
in the existing documentation and it is exactly the kind of thing that surfaces at the
wrong moment.

**A staging project will pause**, because staging is idle by definition. That is tolerable
— it resumes on request, slowly — but it means staging cannot be relied on for anything
time-sensitive, and it is an argument for doing validation locally instead.

### Data residency

`eu-west-2` (London) throughout, for
[C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully). The timing project
is already there; anything new matches it.

---

## Schema design

### Proposed schemas

| Schema | Holds | Owner | Public read |
| --- | --- | --- | --- |
| `public` | **Timing, unchanged** — `events`, `teams`, `runners`, `crossings`, `marshals`, `staff_assignments`, `admin_actions` | Timing platform | Yes, per existing RLS |
| `private` | **Unchanged** — helper functions with pinned `search_path` | Timing platform | No |
| `club` | Members, membership periods, EA registrations, session-subscription payers, benefits directory, document metadata | Website | No |
| `intake` | Public form submissions — interest registrations, new-member forms, mailing-list requests | Website | No |

**Nothing in `public` changes.** Not a column, not a policy. Until the timing platform is
ported it is treated as another team's database.

### Why `intake` is separate from `club`

The most important line in the table, and the reason to separate at all.

Public forms need an RLS policy allowing **anonymous `insert`**. Getting that policy wrong
on a schema that also holds the membership list is a personal-data incident. Getting it
wrong on a schema that holds only what somebody just typed into a public form is a
nuisance.

> **The schema boundary is the blast radius.**

[C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) is *"not a feature,
it is a condition on everything else"*, and this is what that looks like in a schema.

### Nightingale Nightmare is an event, not an application

A correction worth making before any table exists, because the instinct is to mirror the
timing app and it would be wrong.

The [glossary](../../foundations/glossary.md#club-and-races) defines an **event** as one
running of one race in one year, and
[`events.format` has carried `'relay' | 'solo'` since the timing app's first
migration](../../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know) —
solo is modelled, not hypothetical.

So when Nightingale Nightmare takes **real entries**, they belong in the **same** event and
entry model as Pass the Buck. A parallel copy would fork the results archive, the bib
scheme and the category system — and
[C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
asks for one permanent archive across all of them.

**But v1 is not an entry.** The [build brief](../../delivery/nn-build-brief.md#scope) scopes it
to *name, email, consent, timestamp* — an expression of interest, with no bib, no category,
no payment and no event relationship.

> `intake.nn_interest`. Not `public`, not a second project, and not the timing app's
> `teams` table.

That resolves the brief's own
[open item](../../delivery/nn-build-brief.md#deliberately-left-open).

### Two tables that must not be merged

[C4](../../foundations/requirements.md#c4--take-payments) says it in terms:

> The £2.50 subscription **is not membership** and its payers are not a membership list —
> conflating them will produce a wrong data model.

Roughly **103 people** pay the subscription; **94** are members; the sets overlap without
being the same, and the subscription is explicitly open to non-members. `club.members` and
`club.subscribers` are **distinct tables with distinct lifecycles.**

Recorded here because a schema built the obvious way gets this wrong, and it is expensive
to unpick once there are rows in it.

### Inherit the PII boundary

The timing app **drops date of birth, address, phone, emergency contact and medical
information at the parser boundary**, before anything reaches the database, and stores a
computed `age_on_day` rather than a birth date. The raw CSV in storage is the audit trail;
the table holds operational data only.

[The review](../../reference/timing-app-review.md#runners) calls this *"C10 already
implemented, and the pattern any new entry surface should inherit."*

Nightingale Nightmare needs age bands, so it needs date of birth **at the moment of entry**
— and should still store only the derived age.

---

## Row-level security

RLS is the club's actual access-control layer. There is no API tier between the browser and
Postgres, which is what makes a public leaderboard possible without one — and what makes a
policy mistake load-bearing.

| | |
| --- | --- |
| **Enabled on every table**, from its first migration. No exceptions, no "we'll add it later" | |
| **The anon key is public** and appears in client code. **The service role key never reaches the browser and never enters the repository** | If a build seems to want the service role key, the policy is wrong and that is the thing to fix |
| **Helper functions live in a `private` schema with pinned `search_path`** | The pattern the timing app already uses |
| **RLS recursion is a known hazard here** | The timing app has [a migration existing specifically to fix it](../../reference/timing-app-review.md#row-level-security). Worth reading before writing policies against these tables |
| **Policies are tested, not asserted** | See [local development](local-development.md#what-only-a-real-postgres-can-test) |

---

## Migrations

### The hazard: two repositories, one migration history

Supabase tracks applied migrations in a single table per project. **Two repositories
running `supabase db push` against one project will desync** — each CLI sees the other's
migrations as missing — and it surfaces at the worst moment, which is when somebody is
trying to ship a fix.

The club is about to have exactly that: the timing platform owns `public`, and whatever
builds the website owns `club` and `intake`, both against one database.

**How bad this is depends entirely on [repository shape](repositories.md):**

| Under | What happens |
| --- | --- |
| **C — a dedicated schema repository** | **Dissolved by construction.** One owner, one history. This is option C's strongest argument |
| **A or E — monorepo** | Dissolved once the timing app is absorbed; the hazard exists in the window before that |
| **B or D — timing stays separate** | **Real and permanent.** The rule below has to hold indefinitely |

### Schema scoping works — confirmed

This was the load-bearing unknown, and it came back positive:

> *"By default, all schemas in the target database are diffed. Use the `--schema
> public,extensions` flag to restrict diffing to a subset of schemas."*
> — [Supabase migration docs](https://supabase.com/docs/guides/deployment/database-migrations)

So the rule is workable:

> **One schema has exactly one owning repository. Diff and push are schema-scoped.
> `supabase db reset` is never run against the shared remote** — it is a local command, and
> treating it otherwise destroys the other application.

### Declarative schemas are probably the better tool

Newer than the documentation this repository was written against, and a genuinely better
fit for a club that wants everything reviewable.

| | Imperative migrations | Declarative schemas |
| --- | --- | --- |
| **Source of truth** | A directory of ordered change scripts | `supabase/schemas/*.sql` — the **desired state** |
| **Reviewing a change** | Read a diff of instructions | Read a diff of **the table definition itself** |
| **Related information** | Scattered across many migration files | In one file per object |
| **How migrations are produced** | Hand-written | Generated by `supabase db diff` |

The second row is the one that matters for a club whose whole premise is *"a change is
proposed, seen by the other volunteer, and merged."* Reviewing a policy change is far
easier when the diff shows the policy rather than an `ALTER`.

**One trap, and it is sharp:** changes made in Studio, the SQL editor or `psql` are
**invisible to the diff** — it reports no changes and the edit is silently lost on the next
generation. That is a discipline requirement, not a tooling problem, and it should be
written into the conventions.

### Generated types

`supabase gen types typescript` output is **committed**, and CI fails if it is stale.

That is how the website gets compile-time knowledge of the timing schema without reaching
into the timing repository — [convergence](../../foundations/requirements.md#convergence) at
the type level while the code stays separate. Under a monorepo it is a workspace directory;
under separate repositories it is the published package that makes option C work.

### Ordering

[Expand–migrate–contract](../../foundations/glossary.md#platform-and-delivery), always. The
timing app's registration migration
[already documents its own deploy-then-migrate sequence](../../reference/timing-app-review.md#what-is-strong)
to avoid a `42703` window in production — expand-migrate-contract reasoning applied by
hand, before it was named as a convention.

**No migrations during a race [change
freeze](../../foundations/glossary.md#platform-and-delivery).**

---

## C6 and the 200-connection ceiling

[Decision 002](../../decisions/decision-log.md#002--hold-the-clubs-data-in-supabase-on-the-free-tier)
carries a **binding design constraint**: the live leaderboard must not be served from
Supabase Realtime, because a race-night crowd would exceed 200 concurrent connections and
force Supabase Pro at £237/yr.

**That constraint still holds, and the alternative is now cheaper than recorded.**

The existing analysis prices the Cloudflare route by **polling** — 300 spectators once a
second is 1.6 M requests over a 90-minute race, 16× the daily free allowance. But polling
is not how this would be built:

| | |
| --- | --- |
| **SQLite-backed Durable Objects are on the Workers Free plan** | 5 GB per account, 1 GB per object — the leaderboard needs approximately none of it |
| **Outgoing WebSocket messages are not billed** | The broadcast to 300 spectators costs nothing |
| **Incoming messages bill at 20:1** | 400 marshal crossings over a race → 20 billable requests |
| **Hibernation** | Connections stay open while the object sleeps, and duration is not billed while idle |

A whole race night is roughly **300 connection requests plus 20 message requests** against
100,000 a day.

**So the £47/yr Workers Paid line is insurance rather than a requirement** — worth
budgeting, but the free tier is no longer the binding constraint it appeared to be. What
remains binding is the *design*: **push from Cloudflare, do not poll, and do not use
Supabase Realtime for the public leaderboard.** That is a £237/yr decision and it should be
taken deliberately when C6 is built.

---

## Backups

**The Supabase free tier has no automated backups**, and this is currently unanswered
anywhere in the documentation. It is the largest gap in the data architecture.

[Continuity](../../foundations/requirements.md#continuity) is explicit:

> The results archive is permanent. Whatever holds it must not sleep, expire, or lose data
> without a restorable backup. **A URL published in 2026 should resolve in 2036.**

**Proposed:** a scheduled `pg_dump` to R2 — a Cron Trigger once the site is a Worker, or a
GitHub Actions schedule before then. R2 charges no egress, so retrieval is free.

What still needs deciding, and the last one is the one usually skipped:

| | |
| --- | --- |
| Frequency and retention | Daily with 30 days is the obvious starting point |
| Encryption at rest, and who holds the key | It contains member personal data |
| Who can reach it | Both volunteers, per [shared ownership](../../foundations/requirements.md#shared-ownership) |
| **Whether anyone has actually restored from it** | **An untested backup is a belief, not a backup** |

---

## Still to answer

| | |
| --- | --- |
| **Declarative schemas or imperative migrations** | Declarative reviews better; it is newer, and "boring" is a hard requirement. Worth a small trial before committing |
| **Which repository owns schema** | Follows from [repository shape](repositories.md) |
| **Is there a staging project at all** | It will pause, the two-project limit is per person, and local development may make it unnecessary |
| **The backup runbook**, including a tested restore | The biggest gap here |
| **Retention policy per table** | [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) requires one; nothing is written |
| **Whether `intake` rows are ever promoted into `club`** | An interest registration becoming a member is a real flow with a real lawful-basis question |
