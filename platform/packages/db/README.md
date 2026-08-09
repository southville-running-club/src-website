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

Two schemas and one function. **No tables** — where rows land is already decided by
ADR-002, and none of it is needed to prove a pipeline.

|  |  |
| --- | --- |
| `club` | Members, memberships, benefits, documents. Closed: no grants, and **not exposed through PostgREST at all** |
| `intake` | Public form submissions. Anonymous insert only, when tables arrive |
| `intake.health()` | Returns `now()`. The skeleton's connectivity check — see below |

`intake.health()` earns its place: one call proves the migration applied, the schema is
exposed, the anon key is right, the grant is right, and the Worker can reach the network.
It reads nothing and holds nothing.

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
```

`database.types.ts` is **generated**. Editing it by hand will be silently undone, and CI
fails when it drifts.

## Seeding

`supabase/seed.sql` is committed and currently empty — there are no tables. The rules are
written in the file itself, so the next person adding a row inherits them: data only never
schema, deterministic, realistic shapes with invented people, **include the awkward
states**, and never a dump of production. [C10](../../../docs/foundations/requirements.md#c10--hold-personal-data-lawfully)
applies to laptops as much as to servers.

## Testing

`tests/schemas.test.ts` runs against the real local Postgres. The assertion that matters is
the **negative** one — that `club` cannot be reached anonymously — and it asserts the
PostgREST error code rather than merely that something failed, so it cannot start passing
for the wrong reason.

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
