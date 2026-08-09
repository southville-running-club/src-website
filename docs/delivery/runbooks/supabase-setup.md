# Runbook — Supabase, and its three credentials in GitHub

Getting the database half of the platform deployable. **About twenty minutes**, done once.

> **What is actually manual here is small, and that is the point.** Create the project,
> issue a token, note the password, put three secrets into GitHub. **Everything else — the
> schemas, the grants, the policies, the exposed-schema list — is applied by
> `deploy-db.yml` on merge to `main`**, from the repository, reviewably.
>
> If you find yourself clicking something in the Supabase dashboard that is not on that
> list, stop: it probably belongs in `config.toml` or a migration, and doing it by hand
> means the next merge overwrites it.

**Prerequisites:** you can sign in to the club's Supabase account, and you are an admin on
the `southville-running-club` GitHub organisation.

> **The project is `ketipxpyjjglwpqazsft`, created fresh on a club-owned account on
> 9 August 2026.** It is empty apart from what this repository puts in it.
>
> **This is not the project the timing platform runs on.** That one — `ovpvzabtjxbszsqschqy`,
> under a personal account — still holds Pass the Buck 2026's data and is
> [the club's single most valuable asset](../../reference/timing-app-review.md#governance-findings).
> Nothing here touches it.
>
> **The consequence, and it is deferred rather than solved:** until the timing platform is
> ported onto this project, there is no race data here for a results archive to derive
> from, so [C2](../../foundations/requirements.md#c2--publish-race-results-permanently-and-automatically)
> cannot be met. That port is [Phase 4](../phases.md#phase-4--the-timing-app-on-cloudflare),
> and it is the moment the two databases become one.
>
> One thing that gets easier meanwhile: with no `public`/`private` schemas here yet,
> [ADR-002's rule about two repositories sharing one migration
> history](../../architecture/decisions/adr-002-schema-layout.md#who-may-migrate-what) does
> not bite. It will when the port lands, so the schema scoping stays.

---

## 1. Confirm the project, and that two people can reach it

**Dashboard → your organisation → the project.**

- [ ] The project reference is **`ketipxpyjjglwpqazsft`**. It is in the URL, and under
      **Settings → General**.
- [ ] The region is **West EU (London)**. If it is not, stop — [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully)
      is a legal constraint, not a preference, and moving a project is not a runbook step.
- [ ] **Settings → Team** lists **both volunteers**. If it lists one,
      [no system is reachable by only one person](../../architecture/principles.md#no-system-is-reachable-by-only-one-person)
      is being broken right now, and this is the moment to fix it.

## 2. Expose the `intake` schema — **nothing to do; the pipeline does it**

**This is not a dashboard step, and it is not a laptop step either.** The exposed-schema
list lives in the committed `config.toml`, and `deploy-db.yml` applies it with
`supabase config push` on every merge to `main` — alongside the migrations, in the same
run, from the same credentials.

That answers one of the open
["which Supabase settings are dashboard-only"](../../architecture/investigations/infrastructure-as-code.md#still-to-answer)
questions: **this one is not.**

- [ ] Confirm the committed file says what you expect. That is the whole of this step:

```toml
[api]
schemas = ["public", "graphql_public", "intake"]
```

- [ ] **`club` is deliberately absent.** Even if a grant on a `club` table were wrong one
      day, PostgREST would have no route to it. Adding it is a decision, not a convenience.

> ⚠️ **`config push` sends the whole file**, not only the `[api]` block — auth, storage and
> email settings travel with it. That is the point, and also the hazard: **anything changed
> by hand in the dashboard is overwritten on the next merge.** If you need a setting, put it
> in the file.

### Local, branch CI and production all read this one file

Which is what makes a pull request meaningful — it exercises the real exposure rules rather
than an approximation:

| | How it is applied |
| --- | --- |
| **Local** | `supabase start` reads `config.toml` into the Docker containers |
| **Branch CI** | The same, in Actions |
| **Production** | `supabase config push`, on merge to `main` |

Guarded twice: `tests/unit/config.test.ts` asserts the list directly, and
`tests/schemas.test.ts` catches the same mistake by its effect when `club` stops returning
`PGRST106`. Adding `club` to the list fails both, immediately.

**If you ever need it by hand** — bootstrapping before the secrets exist, or debugging:

```bash
cd platform/packages/db
npx supabase login                                   # browser, once per machine
npx supabase link --project-ref ketipxpyjjglwpqazsft # asks for the database password
npx supabase config push
```

### The three layers, because they are easy to confuse

`public` is the name of a Postgres schema. It has **nothing** to do with public access.

| | Where it is controlled | |
| --- | --- | --- |
| **Does it exist?** | Migrations | `create schema`, `create table` |
| **Can the API route to it?** | `config.toml` → `[api] schemas` | Off the list means `PGRST106`, whatever the grants say |
| **Who may do what?** | Migrations | `grant`, and RLS policies |

All three are code. A schema is only reachable when **both** the second and third say so,
which is why `club` is blocked twice and `intake.nn_interest` holds rows nobody can read.

## 3. Collect the two public values

**Settings → API keys.**

- [ ] Copy the **Project URL** — `https://ketipxpyjjglwpqazsft.supabase.co`.
- [ ] Copy the **publishable** key (labelled `anon` on older dashboards). It begins
      `sb_publishable_` or is a long JWT.

**These two are public by design.** They appear in client code, and row-level security is
what protects the data. They go into `wrangler.jsonc` in the repository, in the open, and
that is correct.

- [ ] **Do not copy the `service_role` / secret key.** It appears on the same page. It must
      never reach a browser, a repository or a Worker. If something appears to need it, the
      row-level security policy is wrong and that is the thing to fix.

### Put them in the repository

Both apps declare the same project, and a test fails if they ever differ. Replace
`REPLACE_ME_publishable_key` in **both** files:

- `platform/apps/main/wrangler.jsonc` → `env.production.vars`
- `platform/apps/timing/wrangler.jsonc` → `env.production.vars`

```bash
cd platform && npm test          # supabase-config.test.ts checks the two agree
```

## 4. Create the access token

This is the one that **is** secret.

**Account → Access Tokens** *(top-right avatar → Account preferences)*.

- [ ] **Generate new token**. Name it `github-actions-src-website`, so a stray token is
      identifiable a year from now.
- [ ] **Copy it immediately** — it is shown once.

## 5. Find the database password

**Settings → Database → Database password.**

- [ ] If nobody knows it, **Reset database password** and copy the new one. Resetting is
      safe here: nothing else uses this project yet, and it does not affect the publishable
      key.
- [ ] Store it in the club's password manager, not just in GitHub. GitHub secrets cannot be
      read back.

## 6. Put the three secrets into GitHub

**github.com/southville-running-club/src-website → Settings → Secrets and variables →
Actions → New repository secret.**

| Name | Value | From |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | the token from step 4 | Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | `ketipxpyjjglwpqazsft` | Settings → General |
| `SUPABASE_DB_PASSWORD` | the password from step 5 | Settings → Database |

Or from a terminal, which avoids the value ever being in a browser field:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo southville-running-club/src-website
```

- [ ] All three appear under **Actions secrets**. Values are never displayable again — that
      is the point.

> **A secret that was ever committed is compromised and must be rotated, not deleted.** Git
> history keeps it.

## 7. Prove it works

- [ ] **Actions → Deploy database → Run workflow.** It fails fast and clearly if a secret
      is missing, then runs `supabase db push --linked`.
- [ ] Green means the `club` and `intake` schemas now exist on the remote, and
      `intake.health()` with them.

Check by hand, substituting the publishable key:

```bash
curl -X POST -H "apikey: <publishable-key>" -H "Content-Profile: intake" \
  -H "Content-Type: application/json" \
  https://ketipxpyjjglwpqazsft.supabase.co/rest/v1/rpc/health -d '{}'
```

- [ ] A timestamp comes back. **That single call proves** the migration applied, the schema
      is exposed, the key is right and the grant is right.
- [ ] And the negative, which matters more:

```bash
curl -H "apikey: <publishable-key>" -H "Accept-Profile: club" \
  https://ketipxpyjjglwpqazsft.supabase.co/rest/v1/members
```

- [ ] Returns **`PGRST106 — Invalid schema: club`**. Anything else, and `club` is reachable
      when it should not be. Stop and fix that before going further.

And the table that *is* in an exposed schema, which should still be unreachable:

```bash
curl -H "apikey: <publishable-key>" -H "Accept-Profile: intake" \
  https://ketipxpyjjglwpqazsft.supabase.co/rest/v1/nn_interest
```

- [ ] Returns **`42501 — permission denied for table nn_interest`**. It has row-level
      security enabled and no policies, so nothing reaches it through the API. The
      anonymous-insert policy arrives with the sign-up form, in the pull request that can
      test it. **If this returns rows, stop** — that is a personal-data surface open to the
      internet.

---

## What is still true afterwards

**Nothing sequences the migration against the Cloudflare deploy.** Workers Builds triggers
on the push, not on a green Actions run, so schema and code go out concurrently and in no
guaranteed order. That is survivable only because
[expand–migrate–contract](../../architecture/principles.md#expand-migrate-contract) is a
principle: every schema change must keep the previously deployed code working.

**No migrations during a race-week [change freeze](../../foundations/glossary.md#platform-and-delivery).**

**`supabase db reset` is a local command.** It drops everything and rebuilds from
migrations. Today that would cost this project's sign-ups; after the timing platform is
ported onto it, it would cost the club its race history. There is no version of this
runbook where you run it against production.
