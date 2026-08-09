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

## 2. Protecting `main` — **not available yet, and the decision is open**

> **Skip this step for now.** It is here so that nobody spends an evening discovering why
> the setting is missing.

**`src-website` is private on the GitHub Free plan, and branch protection on a private
repository requires GitHub Team.** The rulesets API answers plainly:
`403 — Upgrade to GitHub Pro or make this repository public to enable this feature.` Being
an organisation does not help; GitHub Free *for organizations* excludes it too.

**What still works today, and it is most of what matters:**

| | |
| --- | --- |
| Pull requests | ✅ Open, review, comment, approve, request changes — all of it |
| CI on every pull request | ✅ Runs and reports, and a red check is visible on the PR |
| **Requiring** a pull request before merge | ❌ Needs Team |
| **Requiring** CI to pass before merge | ❌ Needs Team |
| Blocking a direct push to `main` | ❌ Needs Team |

So **the convention is available; only its enforcement is not.** You can work by pull
request from today. What you cannot do is stop yourself deviating from it.

### The three ways out, and none is urgent

| | Cost | |
| --- | --- | --- |
| **A CI guard** | £0 | A workflow that fails loudly when a commit reaches `main` without a pull request. Detection rather than prevention — exactly the trade [ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) already ratified for DNS |
| **GitHub Team** | ~£70–90/yr for two | Real enforcement, and it also unlocks the environment protection in step 4 |
| **Make the repository public** | £0 | Full enforcement and unlimited Actions minutes. Needs the [DNS zone export](../../reference/zone-fasthosts-2026-08-08.txt) moved or redacted first, and makes the club's infrastructure reasoning public |

**Deliberately not decided.** It is a recurring cost against a programme trying to reduce
one, and the gap it leaves is the same gap the club has already accepted elsewhere. Recorded
in the [decision log](../../decisions/decision-log.md) so it is a deferral rather than an
oversight.

## 3. Actions permissions

**Settings → Actions → General.**

- [ ] **Allow all actions and reusable workflows** — the workflows use `actions/checkout`
      and `actions/setup-node` only.
- [ ] **Workflow permissions: Read repository contents.** Nothing here writes to the
      repository, so nothing needs write.

## 4. The production environment — **also unavailable, same reason**

> **Skip this step too.** `deploy-db.yml` does *not* declare an environment, deliberately.

GitHub's wording: *"Organizations with GitHub Team and users with GitHub Pro can configure
environments for private repositories."* On the free plan a workflow declaring
`environment: production` **fails outright**, so the workflow does not declare one.

**This is the strongest argument for paying, and it is worth stating plainly.** With an
environment you could add the other volunteer as a **required reviewer** on
`supabase db push` — a second pair of eyes on the one automated action that can destroy the
timing platform's data. Without it, a merge that touches a migration applies it
unsupervised.

Two things reduce that risk in the meantime, and neither removes it:

- Migrations are **scoped** — `--schema club,intake` — so this repository cannot propose
  dropping the timing app's tables.
- `supabase db reset`, the destructive one, is a **local command** and appears nowhere in
  any workflow.

Carried in the [decision log](../../decisions/decision-log.md) with the plan question.

## 5. The three secrets

**Settings → Secrets and variables → Actions → New repository secret.**

All three come from [the Supabase runbook](supabase-setup.md) — do that one to get them.

| Name | What it is | Where it comes from |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A personal access token | Supabase → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | `ketipxpyjjglwpqazsft` | Supabase → Settings → General |
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
