# Runbook — GitHub, and the five secrets everything else needs

Getting the repository into a state where the pipeline can deploy. **About fifteen
minutes**, done once.

**Prerequisites:** you can sign in as, or are a collaborator on, `southville-running-club`.

> **`southville-running-club` is a personal account, not an organisation** — `type: User`,
> with both volunteers added as collaborators. That is club-owned, which is most of what
> [shared ownership](../../foundations/requirements.md#shared-ownership) asks for, but it is
> a shared password rather than a named login each.
> [Recorded and left as it is](../../decisions/decision-log.md), with the conditions that
> would reopen it.

**Do this one first.** Both the [Supabase](supabase-setup.md) and
[Cloudflare](cloudflare-setup.md) runbooks end by pushing something through this pipeline.

---

## What GitHub actually holds

Worth stating plainly, because the asymmetry looks like an oversight and is not:

| | Credential in GitHub? | Why |
| --- | --- | --- |
| **Supabase** | **Yes — five secrets** | A database has no git integration. The alternative is a volunteer running migrations from a laptop: unreviewed, unlogged, invisible to the other volunteer |
| **Cloudflare** | **No, none** | Workers Builds connects from Cloudflare's side. **A credential that does not exist cannot leak** |

---

## 1. People, before anything else

**Settings → Collaborators and teams.**

- [ ] **Both volunteers appear under Collaborators**, so neither depends on the other to
      reach the code. [No system is reachable by only one
      person](../../architecture/principles.md#no-system-is-reachable-by-only-one-person) is
      a principle, and the club is currently failing it on four systems. Not this one.
- [ ] The repository is owned by **`southville-running-club`**, not by an individual.

> **`src-race-timing` is still in a personal account.** Moving it is [a small action with a
> large effect](../../reference/timing-app-review.md#governance-findings), and it must
> happen **before** Cloudflare is connected to it or the git integration desynchronises.
> Not this runbook, but do not lose it.

## 2. Protecting `main` — **not available yet, and the decision is open**

> **Skip this step for now.** It is here so that nobody spends an evening discovering why
> the setting is missing.

**`src-website` is private on the GitHub Free plan, and branch protection on a private
repository requires a paid plan.** The rulesets API answers plainly:
`403 — Upgrade to GitHub Pro or make this repository public to enable this feature.`

**Converting to an organisation would not help** — GitHub Free *for organizations* excludes
protected branches on private repositories exactly as Free for users does. The two
questions are orthogonal, and
[both are recorded](../../decisions/decision-log.md).

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
| **A CI guard** ✅ | £0 | **Built** — `.github/workflows/main-guard.yml`. It fails on a push to `main` whose commit belongs to no pull request. Detection rather than prevention, which is exactly the trade [ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) already ratified for DNS |
| **GitHub Team** | ~£70–90/yr for two | Real enforcement, and it also unlocks the environment protection in step 4 |
| **Make the repository public** | £0 | Full enforcement and unlimited Actions minutes. Needs the [DNS zone export](../../reference/zone-fasthosts-2026-08-08.txt) moved or redacted first, and makes the club's infrastructure reasoning public |

**Deliberately not decided.** It is a recurring cost against a programme trying to reduce
one, and the gap it leaves is the same gap the club has already accepted elsewhere. Recorded
in the [decision log](../../decisions/decision-log.md) so it is a deferral rather than an
oversight.

## 3. Repository settings — **admin only, and none of it can be done from a diff**

> **Everything in this section needs the shared `southville-running-club` login.**
> `chessser` and `bindalshah` are *collaborators* with write, and every setting below is
> admin-gated: `PATCH /repos/{owner}/{repo}` is refused, and both
> `/actions/permissions` and `/vulnerability-alerts` answer `404` to a write-level token
> rather than reporting their state. So a volunteer cannot even *confirm* these, let alone
> change them.
>
> That is why the four workflow-permission declarations moved **into the workflow files**,
> where they are reviewed in a pull request. This section is what is left over.

> ### ✅ Done — 15 August 2026
>
> All of 3a–3c were set by Mark through the shared login. What is recorded below is what the
> settings **are**, not what somebody once intended; re-read it before changing any of them.

### 3a. Actions → General

**Settings → Actions → General**, as the shared login.

- [x] **Allow all actions and reusable workflows** — the workflows use `actions/checkout`
      and `actions/setup-node` only.
- [x] **Workflow permissions: Read repository contents.** Belt and braces now: all four
      workflows declare `permissions: contents: read` themselves, so this is the floor rather
      than the only control. Set it anyway — a workflow added later without a `permissions:`
      block inherits this.
- [x] **Checked 15 August 2026.** The state is invisible to everybody else, so an unrecorded
      check is the same as no check.

### 3b. Merge behaviour — **squash only**

**Settings → General → Pull Requests.**

- [x] **Automatically delete head branches.** On since 15 August 2026. Merged branches no
      longer accumulate — and note the consequence: **after a merge the branch is gone**, so
      the pre-squash commits survive only on the pull request page, not in any ref.
- [x] **One merge method: "Squash and merge".** Merge commits and rebase are both off.

> **This reverses what this runbook first recommended, and the correction is the point.**
> It said to keep merge commits, on the grounds that the history already was merge commits
> and that `Merge pull request #N` is how a commit is traced back to its review. **The second
> half of that was simply wrong**: GitHub appends the number to a squashed subject too, so
> traceability is identical —
>
> ```
> c88d994 Correct the branch-protection claim, and notice a push that skips review (#29)
> ```
>
> `main-guard.yml` is unaffected: it asks GitHub which pull request a commit belongs to, and a
> squashed commit is associated exactly as a merge commit is. Verified on the merge of #29,
> which is the line above.

**What squash actually costs, and it is worth knowing before writing a branch.** Every commit
in a pull request collapses into one on `main`. A branch that tells a story commit by commit
arrives as a single entry, so:

- **Do not mix two unrelated changes in one pull request.** Under merge commits that was untidy;
  under squash it is unfixable, because the two cannot be reverted or bisected apart afterwards.
- Put the reasoning in the **pull request body and the commit message**, not in the shape of the
  branch — the branch's shape does not survive.

### 3c. Dependabot

- [x] **Settings → Code security → Dependabot alerts.** Checked and set 15 August 2026.

### 3d. What is *not* here, and why

**Nothing in this section is enforcement.** Branch protection, required reviews, required
checks and the required reviewer on `supabase db push` all need a paid plan — sections
[2](#2-protecting-main--not-available-yet-and-the-decision-is-open) and
[4](#4-the-production-environment--also-unavailable-same-reason). These are the settings that
are free, have never been set, and need no committee decision.

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

## 5. The five secrets

**Settings → Secrets and variables → Actions → New repository secret.**

The first three come from [the Supabase runbook](supabase-setup.md) — do that one to get
them. The last two are Turnstile's and Resend's own secrets, added later as `[auth.captcha]`
and `[auth.email.smtp]` were switched on; both are documented in full, with where each value
comes from, in [`apps/main/README.md`'s manual-steps table, steps 9 and
13](../../../platform/apps/main/README.md#manual-steps).

| Name | What it is | Where it comes from |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A personal access token | Supabase → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | `ketipxpyjjglwpqazsft` | Supabase → Settings → General |
| `SUPABASE_DB_PASSWORD` | The database password | Supabase → Settings → Database |
| `SUPABASE_AUTH_CAPTCHA_SECRET` | The Turnstile **secret** key | Cloudflare Turnstile — #53 |
| `SUPABASE_AUTH_SMTP_PASSWORD` | A Resend API key, Sending access only | Resend — #50 |

Or from a terminal, which keeps the value out of a browser field and out of your clipboard
history:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --repo southville-running-club/src-website
```

- [ ] All five listed under **Actions secrets**. The values are never displayable again —
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
- [ ] **Actions → Deploy database → Run workflow.** It checks all five secrets first and
      fails immediately with `Missing repository secrets: …` if any is absent, rather than
      with a Supabase CLI error several steps later.

Once the Cloudflare Workers exist, a third workflow appears on merges to `main`:

- [ ] **Smoke test** — seven assertions against the live site. It fails until the Workers
      are created, which is it reporting the truth.

---

## What runs, and when

| Workflow | Trigger | Does |
| --- | --- | --- |
| **CI** | Every pull request. **Not pushes to `main`** | Lint, types, generated types current, unit, Worker, migrations from zero, build, Playwright + axe |
| **Main guard** | Every push to `main` | Fails if the commit belongs to no pull request. Seconds, and the only thing watching that path |
| **Deploy database** | Merges to `main` touching `platform/packages/db/supabase/migrations/**` | `supabase db push --linked` |
| **Smoke test** | Merges to `main`, daily at 08:17, and by hand | The live-site checks |

> **This table said CI ran on pushes to `main`. It never has.** The claim came from
> `ci.yml`'s own comment, which asserted a branch protection that does not exist on this
> plan — so the row that was meant to reassure was describing the exact gap. Corrected in
> both places, and **Main guard** is what now watches that path. Issue #26 has the full
> account.

**Nothing in GitHub deploys the Workers.** Cloudflare does that itself when it sees the
push, which means the migration and the code that uses it go out concurrently and in no
guaranteed order. That is survivable only because
[expand–migrate–contract](../../architecture/principles.md#expand-migrate-contract) is a
principle rather than a preference.

**No migrations during a race-week
[change freeze](../../foundations/glossary.md#platform-and-delivery).**
