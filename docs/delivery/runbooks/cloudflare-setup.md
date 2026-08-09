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

- [ ] Authorise the **`southville-running-club`** organisation, not a personal account, and
      select **`src-website`**.

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

## Adding a hostname later

You do not come back to this runbook. A new hostname — `new.`, the apex, `www` — is a
`routes` entry in `wrangler.jsonc` under `env.production`, reviewed as a pull request.
Cloudflare creates the record and the certificate on the next deploy.

That is the difference this arrangement buys: **the hostname is code.** See
[ADR-006](../../architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md).
