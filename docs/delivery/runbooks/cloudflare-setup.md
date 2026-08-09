# Runbook — Cloudflare, the two Workers, and why GitHub needs no credential

Getting the serving half of the platform deployable. **About thirty minutes**, done once
per Worker.

**Prerequisites:** you are an admin on the club's Cloudflare account, the
`southvillerunningclub.co.uk` zone is active there (it has been since 8 August 2026), and
[the Supabase runbook](supabase-setup.md) is done — the Workers read that database.

---

## The short answer on credentials

> **GitHub needs no Cloudflare credential, and that is deliberate.**

Cloudflare **Workers Builds** connects to the repository from Cloudflare's side: it watches
GitHub, pulls, builds and deploys. Nothing in GitHub Actions holds a Cloudflare token,
because **a credential that does not exist cannot leak.**

The asymmetry with Supabase — which does need three secrets — is the whole reason the
deploys are arranged this way.

**The one thing you give up** is ordering: Workers Builds triggers on the push, not on a
green CI run, so a deploy can land before its migration. That is
[survivable only because expand–migrate–contract is a
principle](../../architecture/principles.md#expand-migrate-contract). If you ever want
strict ordering instead, the cost is a `CLOUDFLARE_API_TOKEN` and a
`CLOUDFLARE_ACCOUNT_ID` in Actions secrets and deploying with `wrangler deploy` — a
[decision to record](../../architecture/decisions/), not a settings change.

---

## How Cloudflare and GitHub are actually joined

Worth understanding before you click *Authorise*, because the trust runs the opposite way
from what most people assume.

### The direction of trust

**Cloudflare holds a credential for GitHub. GitHub holds nothing for Cloudflare.**

The joining piece is a **GitHub App** called *Cloudflare Workers and Pages*, installed on
the club's GitHub organisation. Once installed:

```
   push to main
        │
        ▼
    GitHub ──── push event ───▶ Cloudflare ──▶ clone, build, deploy
        │                       (holds an installation token)
        │
        └── GitHub Actions ───▶ Supabase   (holds the three secrets)
```

Cloudflare clones the repository into **its own build container**, runs the build and
deploy commands there, and publishes the Worker. Nothing runs on GitHub's side, and
nothing in the repository needs to know Cloudflare exists beyond `wrangler.jsonc`.

### What that means, and it cuts both ways

| | |
| --- | --- |
| **No Cloudflare token in GitHub** | The thing this arrangement buys. There is no secret to rotate, leak, or forget to scope |
| **But Cloudflare can read the repository** | The installation token is real. **Cloudflare account access is therefore read access to private club code** — which is an argument for both volunteers holding named logins on a club-owned Cloudflare account, not a shared one |
| **Installing it is an organisation-level action** | You must be an **organisation owner**, or hold the **GitHub App Manager** role. A repository admin cannot do it alone |
| **Scope it to one repository** | The install offers *All repositories* or *Only select repositories*. **Choose the latter and pick `src-website`.** It is the difference between Cloudflare being able to read one private repository and every one the club ever creates |

### Read the permission screen

GitHub shows the exact permissions the App is requesting at the moment you authorise it.
**Read that screen rather than trusting this document** — Cloudflare does not publish the
list, and it can change. What it asks for should be recognisable as "clone this repository
and report build status": repository contents, metadata, and the ability to write commit
statuses and deployments.

If it asks for anything you cannot account for — organisation administration, member
management, write access to code — **stop and ask** before continuing.

### The kill switch, and it is on the right side

**GitHub → Settings → Applications → Installed GitHub Apps → *Cloudflare Workers and
Pages* → Configure → Uninstall.**

New builds stop immediately. **Workers already deployed keep serving.** That is the useful
property: revoking access in a hurry stops future deploys without taking the site down, so
it is a safe thing to do at 11pm when something looks wrong and you want it to stop.

You can also narrow the scope rather than remove it — *Repository access → Only select
repositories* — which is the same screen and the gentler version.

### The ordering trap

**Move a repository into the club organisation *before* connecting Cloudflare to it.**

The App installation is bound to the account that owned the repository at connect time, so
transferring it afterwards desynchronises the git link and builds stop with an unhelpful
error. This matters for `src-race-timing`, which is
[still in a personal account](../../reference/timing-app-review.md#governance-findings).

---

## 1. Check the zone

**Dashboard → Websites → southvillerunningclub.co.uk.**

- [ ] Status is **Active**, nameservers `bonnie` / `hans`.
- [ ] Under **Members**, **both volunteers** have access.

**Do not add any DNS record by hand in this runbook.** The custom domains come from
`wrangler.jsonc`, and Cloudflare creates the records and certificates itself.

## The shape you are building

**One hostname, two Workers, told apart by path.**
[ADR-007](../../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).

| | Worker | Attached by |
| --- | --- | --- |
| `new.<apex>/` and `/nn` | `src-main-production` | **Custom Domain** — creates the DNS record and certificate |
| `new.<apex>/timing/*` | `src-timing-production` | **Route** — no DNS record of its own |

Cloudflare matches most-specific-first, and a route carrying a path beats a Custom Domain
on the same hostname, so `/timing/*` is dispatched to the timing Worker at the edge.

**Order matters: `src-main-production` first.** Its Custom Domain creates the `new` record;
until that exists, the timing route has no hostname to attach to.

## 2. Create the `src-main-production` Worker

**Workers & Pages → Create → Workers → Import a repository.**

- [ ] Authorise the **`southville-running-club`** organisation, not a personal account.
- [ ] Choose **Only select repositories** → **`src-website`**. Not *All repositories*.
- [ ] **Read the permission screen** before authorising — see
      [how the two are joined](#read-the-permission-screen) above.

If the organisation does not appear as an option, you are not an organisation owner and do
not hold the GitHub App Manager role. That is the fix, not a workaround.

Then the settings that matter. **The root directory is the one people get wrong:**

| Setting | Value |
| --- | --- |
| **Worker name** | `src-main-production` |
| **Root directory** | **`platform`** — *not* `platform/apps/main` |
| **Build command** | `npm run build --workspace=apps/main` |
| **Deploy command** | `npx wrangler deploy --env production --config apps/main/wrangler.jsonc` |
| **Build branch** | `main` |

> **Why `platform` and not the app.** `@src/shared` and `@src/db` are npm workspace links
> that exist only because the install ran at `platform/`. Point the root at
> `platform/apps/main` and Cloudflare installs *there* instead, the links are never
> created, and the build dies on `Cannot find module '@src/shared'`.

> **Why the name has `-production` in it.** Wrangler appends the environment name and will
> not let it be overridden. The environment is what carries the custom domain and the real
> database, so the suffix is a fact rather than a choice.

- [ ] **Settings → Builds → Build watch paths**, include:

```
platform/apps/main/**
platform/packages/**
platform/package-lock.json
```

> **Not optional.** The free plan allows **500 builds a month**; without watch paths every
> push rebuilds every application. `platform/packages/**` must be there — a change to the
> shared `Europe/London` module has to rebuild both apps.

## 3. Create the `src-timing-production` Worker

**After `src-main-production` has deployed at least once**, so the `new` DNS record exists.

The same again, with three differences:

| Setting | Value |
| --- | --- |
| **Worker name** | `src-timing-production` |
| **Root directory** | **`platform`** |
| **Build command** | `npm run build:worker --workspace=apps/timing` |
| **Deploy command** | `npx wrangler deploy --env production --config apps/timing/wrangler.jsonc` |
| **Watch paths** | `platform/apps/timing/**`, `platform/packages/**`, `platform/package-lock.json` |

`build:worker`, not `build` — it runs the OpenNext bundle, which is what actually deploys.

- [ ] After it deploys, check **Workers → src-timing-production → Settings → Domains &
      Routes**. It should show the **route** `new.southvillerunningclub.co.uk/timing/*`,
      and **no Custom Domain**. A Custom Domain here would take the whole hostname and
      break the website.

## 4. Let the first build run

- [ ] Watch **Deployments**. A build takes a few minutes.
- [ ] If it fails on `Cannot find module '@src/shared'`, the root directory is wrong. Go
      back to step 2.

Cloudflare will have created, from `wrangler.jsonc` and without being asked:

- [ ] **One** proxied `new` record and its certificate — **additive**: nothing resolved
      that name before, so it cannot break anything, and deleting it restores the previous
      state exactly.
- [ ] **No record for `timing`**, and none is needed. The timing Worker attaches by route
      to the same hostname.
- [ ] **No existing record was modified or deleted.** Confirm in **DNS → Records**.

## 5. Confirm the club's email still works

- [ ] **Send and receive a test message on a club address.**

A Worker custom domain cannot affect mail, and confirming it costs a minute. After any
change touching the zone, this is the first thing checked, not the last.

## 6. Prove the whole thing

From a laptop:

```bash
cd platform && npm run smoke
```

Seven checks against the real hostname: the website, `/nn` and `/timing` all served over
HTTPS with a valid certificate, both applications reaching the database, the timing app's
assets resolving under `/timing/_next/` — which is what proves `basePath` is right — and an
unbuilt page returning 404.

- [ ] All seven pass.

**The same seven run automatically** on every push to `main`, and daily at 08:17 — because
[permanent means permanent](../../foundations/requirements.md#continuity), and a free tier
that quietly stops serving is exactly the failure nobody notices until somebody tries to
enter a race.

If the database checks fail with *"could not reach the database"*, the publishable key in
`wrangler.jsonc` is still the placeholder. [Supabase runbook](supabase-setup.md), step 3.

## 7. Write down what you did

Both app READMEs carry a **manual steps** table with *pending* in the "By" column. Replace
it with who did it and when. That is the
[accepted exception](../../foundations/requirements.md#everything-is-defined-as-code) to
everything-as-code, and it only works if it is actually filled in.

---

## When it goes wrong

The failures this setup actually produces, and what each one means. Every one of these has
a specific cause — none of them is "try again".

| What you see | What it means |
| --- | --- |
| `Cannot find module '@src/shared'` | **The root directory is wrong.** It must be `platform`, not `platform/apps/main`. The workspace links only exist where the install ran |
| `Missing entry-point to Worker script` | The deploy command is missing `--config`, so wrangler is looking in the root directory rather than the app |
| The build succeeds, the site 404s everywhere | The deploy ran without `--env production`, so the Worker has no routes. Check **Settings → Domains & Routes** |
| `/timing` returns the website's 404 page | The timing Worker's route is missing or was created as a Custom Domain. It must be the **route** `new.southvillerunningclub.co.uk/timing/*` |
| `/timing` loads but is unstyled | `basePath` is not taking effect — the assets are 404ing under `/timing/_next/`. Rebuild; the bundle is stale |
| Both pages say *could not reach the database* | The publishable key is still `REPLACE_ME_publishable_key` in `wrangler.jsonc`. [Supabase runbook](supabase-setup.md), step 3 |
| Certificate error for a few minutes | Normal. Cloudflare issues on first request and it can take a little while. If it persists past ~15 minutes, the record is probably not proxied |
| Builds stopped happening after a repository move | The GitHub App installation is bound to the previous owner. Reconnect it |
| Every push rebuilds both Workers | **Watch paths are not set.** At 500 builds a month that allowance goes quickly |

## Rolling back

Worth knowing before you need it, because the answer is not "revert and wait for a build".

**Workers → the Worker → Deployments → a previous version → Rollback.** It takes effect in
seconds, which is the actual answer to *"every change has a previous state to return to"*.

**Roll code back; roll schema forward.** Never roll a migration back to match — that is
what [expand–migrate–contract](../../architecture/principles.md#expand-migrate-contract)
exists to make unnecessary.

## Adding a hostname later

You do not come back to this runbook. A new hostname — `new.`, the apex, `www` — is a
`routes` entry in `wrangler.jsonc` under `env.production`, reviewed as a pull request.
Cloudflare creates the record and the certificate on the next deploy.

That is the difference this arrangement buys: **the hostname is code.** See
[ADR-006](../../architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md).
