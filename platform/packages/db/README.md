# `packages/db` — schema, migrations and generated types

The schemas **this repository owns**: `club` and `intake`.
[ADR-002](../../../docs/architecture/decisions/adr-002-schema-layout.md).

## The rule that matters most

**Two repositories share one Postgres**, and will until the timing platform joins the
monorepo. Supabase keeps a single migration history per project, so this needs a rule
rather than good intentions:

|  |  |
| --- | --- |
| `public`, `private` | **The timing platform's.** Migrated from `src-race-timing`. Not a column, not a policy, not ever from here |
| `club`, `intake` | Migrated from here |
| Diff and push | Always schema-scoped — `--schema club,intake` |
| `supabase db reset` | **Local only.** Against the shared remote it destroys the other application's data |

## What is in it

Two schemas, one table and two functions.

|  |  |
| --- | --- |
| `club` | Members, memberships, benefits, documents. Closed: **no tables yet**, no grants, and **not exposed through PostgREST at all** |
| `intake` | Public form submissions |
| `intake.nn_interest` | Expressions of interest in Nightingale Nightmare. **Four columns and an id.** Anonymous **insert only** — see below |
| `intake.health()` | Returns `now()`. The skeleton's connectivity check |
| `intake.ping()` | Returns `'pipeline-ok'`. The same check for a migration added later |

`intake.health()` earns its place: one call proves the migration applied, the schema is
exposed, the anon key is right, the grant is right, and the Worker can reach the network.
It reads nothing and holds nothing.

### `intake.nn_interest`, and the one door into it

`name`, `email`, `consent`, `created_at`, and an `id`. **Adding a fifth column is a
committee decision, not a build decision** — not date of birth, not phone, not emergency
contact, not England Athletics number. `tests/seed.test.ts` asserts the exact column list,
and that test failing because somebody added one is the test doing its job.

The table was created with RLS on and **no policy and no grant**, which denied everyone.
The sign-up form is what needed the door, so the door arrived with it:

```sql
grant insert (name, email, consent) on table intake.nn_interest to anon;

create policy "anon may record an expression of interest, and read nothing back"
  on intake.nn_interest for insert to anon
  with check (
    length(trim(name)) between 1 and 100
    and position('@' in email) > 1
  );
```

Four things about that are load-bearing:

| | |
| --- | --- |
| **The grant is column-scoped** | `id` and `created_at` are absent, so they keep their defaults and **a caller cannot supply either** — no back-dated sign-up, no chosen primary key. PostgREST refuses the attempt with `42501` rather than ignoring the column |
| **There is no `select`, `update` or `delete` grant. Ever** | There is no API tier, so this grant *is* the access control. A select grant would make the interest list readable by anyone holding the anon key, which is **published in client code by design**. That is a personal-data incident, not a bug |
| **`with check` is stated, not defaulted** | It mirrors the table's own constraints, so the two cannot drift into disagreeing about what a valid row is |
| **It says nothing about consent** | Deliberately. The *form* currently requires the box to be ticked; `consent` is `not null` and `false` is a legitimate stored value. Reversing that decision is two lines of TypeScript and **no second migration** |

One visible consequence, and it is the right one: **`insert().select()` fails.** Asking for
the row back needs a select grant. `apps/main/worker/nn-signup.ts` never asks, and
`tests/nn-interest.test.ts` asserts that asking is refused.

**There is no rate limiting on the endpoint in front of this.** The unique index stops the
same address twice and nothing else. See
[`apps/main`](../../apps/main/README.md#what-it-deliberately-does-not-do).

**`club` is absent from `config.toml`'s `api.schemas`, and that absence is a second lock.**
Even if a grant on a `club` table were wrong one day, PostgREST would have no route to it.
Adding `club` there is a decision, not a convenience.

## Commands

```bash
npm run db:start        # Postgres, auth, storage — Docker
npm run db:reset        # migrations from zero, then seed
npm run db:diff         # generate a migration, scoped to club,intake
npm run db:types        # regenerate src/database.types.ts
npm run db:types:check  # fails if the committed types are stale
npm run db:config:push  # send config.toml to the linked project
```

## Three layers, and all three are code

Worth separating, because `public` is the name of a Postgres schema and has **nothing** to
do with public access.

| | Controlled in | |
| --- | --- | --- |
| **Does it exist?** | `supabase/migrations/` | `create schema`, `create table` |
| **Can the API route to it?** | `supabase/config.toml` → `[api] schemas` | Off the list means `PGRST106`, whatever the grants say |
| **Who may do what?** | `supabase/migrations/` | `grant`, and RLS policies |

Something is reachable only when **both** the second and third permit it. That is why
`club` is blocked twice — not exposed, and not granted — and why `intake.nn_interest` holds
seven seeded rows that no anonymous caller can read.

### One file, three environments

The middle layer is the one that could plausibly drift, so it deliberately does not have
three sources of truth:

| | How `[api] schemas` gets applied |
| --- | --- |
| **Local** | `supabase start` reads `config.toml` straight into the Docker containers |
| **Branch CI** | The same — `supabase start` runs in Actions and reads the same file |
| **Production** | `deploy-db.yml` runs `supabase config push` on merge to `main` |

So **a schema exposed here is exposed everywhere, and one missing here is missing
everywhere.** A pull request tests the real exposure rules rather than an approximation of
them, which is the whole argument for the list living in the repository.

Guarded twice over: `tests/unit/config.test.ts` asserts the list directly — no Docker, a
few milliseconds — and `tests/schemas.test.ts` catches the same mistake by its effect, when
`club` stops returning `PGRST106`.

`npm run db:config:push` runs it by hand for bootstrapping or debugging. **It pushes the
whole file**, not just `[api]` — read the diff it prints, and remember that anything set by
hand in the dashboard is overwritten on the next merge.

`database.types.ts` is **generated**. Editing it by hand will be silently undone, and CI
fails when it drifts.

## Seeding

`supabase/seed.sql` is committed and holds **seven invented rows** in
`intake.nn_interest`. The rules are written in the file itself, so the next person adding a
row inherits them: data only never schema, deterministic, realistic shapes with invented
people, **include the awkward states**, and never a dump of production.
[C10](../../../docs/foundations/requirements.md#c10--hold-personal-data-lawfully) applies to
laptops as much as to servers.

The awkward states are the ones that earn their place — consent withheld, an apostrophe in
a name, a non-ASCII name, and two submissions an hour apart either side of the clocks change
on 25 October 2026 that both render as 01:30 in `Europe/London`.

## Testing

Three files, all against the real local Postgres rather than a mock — there is no API tier
between the browser and the database, so a mock would only ever test the mock.

| | |
| --- | --- |
| `tests/schemas.test.ts` | That `intake` is reachable and **`club` is not** |
| `tests/seed.test.ts` | That the seed applied, and that the table has **exactly one policy** |
| `tests/nn-interest.test.ts` | The grant and the policy, **from both sides** |

**The assertions that matter are the negative ones**, and every one of them asserts the
error *code* rather than merely that something failed — a test that passes because a table
stopped existing is a test that has quietly stopped testing. `PGRST106` for a schema
PostgREST has no route to; `42501` for a missing grant or a refused row.

`tests/nn-interest.test.ts` writes to `intake.nn_interest` to prove the insert policy works
and **removes what it wrote afterwards**, so the seed's own seven rows are what
`seed.test.ts` still sees. The two files can run at the same time.

## Manual steps

| What | Why | By | How to redo |
| --- | --- | --- | --- |
| _Create the Supabase project_ | Cannot be code | Already done — project `ketipxpyjjglwpqazsft`, `eu-west-2` | — |
| _Add the GitHub Actions secrets_ | Migrations need a credential; Cloudflare does not | _pending_ | Repository → Settings → Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` |
| _Confirm `intake` is exposed on the remote_ | `config.toml` may not reach that setting | _pending_ | Dashboard → Settings → API → exposed schemas. **Record the answer here** — it is one of the open "which settings are dashboard-only" questions |

## One ordering fact worth knowing

**Nothing sequences the migration against the Cloudflare deploy.** Workers Builds triggers
on the push, not on a green CI run, so the schema change and the code that uses it go out
concurrently and in no guaranteed order.

That is survivable only because
[expand–migrate–contract](../../../docs/architecture/principles.md#expand-migrate-contract)
is a principle rather than a preference. **Every schema change must keep the previously
deployed code working.** If a change needs the migration to land first, that change is the
thing to fix.
