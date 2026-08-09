# Runbook — GitHub, and the three secrets everything else needs

Getting the repository into a state where the pipeline can deploy. **About fifteen
minutes**, done once.

**Prerequisites:** you are an admin on the `southville-running-club` organisation.

**Do this one first.** Both the [Supabase](supabase-setup.md) and
[Cloudflare](cloudflare-setup.md) runbooks end by pushing something through this pipeline.

---

## What GitHub actually holds

Worth stating plainly, because the asymmetry looks like an oversight and is not:

| | Credential in GitHub? | Why |
| --- | --- | --- |
| **Supabase** | **Yes — three secrets** | A database has no git integration. The alternative is a volunteer running migrations from a laptop: unreviewed, unlogged, invisible to the other volunteer |
| **Cloudflare** | **No, none** | Workers Builds connects from Cloudflare's side. **A credential that does not exist cannot leak** |

---

## 1. People, before anything else

**Settings → Collaborators and teams.**

- [ ] **Both volunteers are admins.** [No system is reachable by only one
      person](../../architecture/principles.md#no-system-is-reachable-by-only-one-person) is
      a principle, and the club is currently failing it on four systems. Not this one.
- [ ] The repository is in the **organisation**, not a personal account.

> **`src-race-timing` is still in a personal account.** Moving it is [a small action with a
> large effect](../../reference/timing-app-review.md#governance-findings), and it must
> happen **before** Cloudflare is connected to it or the git integration desynchronises.
> Not this runbook, but do not lose it.

## 2. Protect `main`

**Settings → Rules → Rulesets → New branch ruleset**, targeting `main`.

- [ ] **Require a pull request before merging.** This is what makes shared ownership a
      property of the workflow rather than a promise.
- [ ] **Require status checks to pass** — select **`Lint, types, tests, build`**. It only
      appears in the list once CI has run at least once, so if it is missing, open a pull
      request first and come back.
- [ ] **Require branches to be up to date before merging.**
- [ ] **Block force pushes.**

Leave **required approvals at zero** if you are two people and one of you is on holiday —
requiring an approval you cannot get is how the rule ends up disabled at the worst moment.
The pull request itself is the control; the approval is the courtesy.

## 3. Actions permissions

**Settings → Actions → General.**

- [ ] **Allow all actions and reusable workflows** — the workflows use `actions/checkout`
      and `actions/setup-node` only.
- [ ] **Workflow permissions: Read repository contents.** Nothing here writes to the
      repository, so nothing needs write.

## 4. The production environment

`deploy-db.yml` runs in an environment named `production`, which is what makes the
migration step attributable and, later, gateable.

**Settings → Environments → New environment → `production`.**

- [ ] Created.
- [ ] **Optional, and worth it before the first real migration:** add the other volunteer
      as a **required reviewer**. A schema change against the shared database then waits for
      a second pair of eyes. It is the cheapest possible guard on the one action that can
      destroy the timing platform's data.

## 5. The three secrets

**Settings → Secrets and variables → Actions → New repository secret.**

All three come from [the Supabase runbook](supabase-setup.md) — do that one to get them.

| Name | What it is | Where it comes from |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A personal access token | Supabase → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | `ovpvzabtjxbszsqschqy` | Supabase → Settings → General |
| `SUPABASE_DB_PASSWORD` | The database password | Supabase → Settings → Database |

Or from a terminal, which keeps the value out of a browser field and out of your clipboard
history:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo southville-running-club/src-website
```

- [ ] All three listed under **Actions secrets**. The values are never displayable again —
      that is the point. Keep them in the club's password manager as well.

> **A secret that was ever committed is compromised and must be rotated, not deleted.** Git
> history keeps it. This is why none of these ever goes in a file.

**What is deliberately *not* a secret:** `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY` are committed in `wrangler.jsonc`, in the open. They are public
by design — row-level security is what protects the data, not the key. If that feels wrong,
[read why](../../architecture/principles.md#row-level-security-is-the-access-control) before
changing it.

## 6. Prove it

- [ ] Open a pull request. **`Lint, types, tests, build`** runs and passes — eight gates
      including a real Postgres and migrations applied from zero.
- [ ] **Actions → Deploy database → Run workflow.** It checks the three secrets first and
      fails immediately with `Missing repository secrets: …` if any is absent, rather than
      with a Supabase CLI error several steps later.

Once the Cloudflare Workers exist, a third workflow appears on merges to `main`:

- [ ] **Smoke test** — seven assertions against the live site. It fails until the Workers
      are created, which is it reporting the truth.

---

## What runs, and when

| Workflow | Trigger | Does |
| --- | --- | --- |
| **CI** | Every pull request, and pushes to `main` | Lint, types, generated types current, unit, Worker, migrations from zero, build, Playwright + axe |
| **Deploy database** | Merges to `main` touching `platform/packages/db/supabase/migrations/**` | `supabase db push --linked` |
| **Smoke test** | Merges to `main`, daily at 08:17, and by hand | Seven checks against the live site |

**Nothing in GitHub deploys the Workers.** Cloudflare does that itself when it sees the
push, which means the migration and the code that uses it go out concurrently and in no
guaranteed order. That is survivable only because
[expand–migrate–contract](../../architecture/principles.md#expand-migrate-contract) is a
principle rather than a preference.

**No migrations during a race-week
[change freeze](../../foundations/glossary.md#platform-and-delivery).**
