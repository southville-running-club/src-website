# Runbook — Nightingale Nightmare onto the club domain

Getting a working page served at `nn.southvillerunningclub.co.uk`.

Part of [Phase 3](../phases.md#phase-3--hello-world-for-nightingale-nightmare).
**Stages here are internal to this runbook** and are not the programme's phases.

**Scope: the network path only.** A hello-world page, proving repository → build → Worker →
HTTPS → club hostname. **No form, no database** until Stage 3 — so that when the form goes
wrong there is only one thing it can be.

| | |
| --- | --- |
| **Time** | Stage 1 an evening, **plus a separate evening for the workspace root** if this is the first code in the repository. Stage 2 is minutes |
| **Risk** | **None at any step.** Everything is additive or internal to Cloudflare |
| **Blocked by** | A Cloudflare account both volunteers can reach |

> **This runbook got simpler on 8 August 2026.** It used to require a Pages project plus a
> hand-added CNAME at Fasthosts, in a specific order or you got a 522. Now the nameservers are
> on Cloudflare, **a Worker custom domain creates its own DNS record and certificate**.

---

## Stage 0 — before you start

| | Check | Why it is here |
| --- | --- | --- |
| **0.1** | Cloudflare account is **club-owned** and **both volunteers are admins** | [Shared ownership](../../foundations/requirements.md#shared-ownership). Doing it now avoids a transfer, and transfers are the step that never happens |
| **0.2** | Two-factor authentication on the Cloudflare account | It now controls the club's DNS as well as its hosting |
| **0.3** | **Agree who runs this — consider the volunteer who did *not* set up Cloudflare** | Stage 1 is low-stakes and touches nothing live, which makes it the cheapest possible test of whether *"both volunteers can reach everything"* is **true** rather than asserted |
| **0.4** | **The repository is already in the club organisation** | ⚠️ Moving a repository between a personal account and an organisation **after** connecting Cloudflare is a documented way to desync the git link. Relevant to `src-race-timing` — **move it first, connect afterwards** |

> **Stop condition.** If 0.1 is not true, fix it before Stage 1. A Cloudflare project created
> under a personal account is a club asset held personally, which is
> [the problem this programme exists to fix](../../foundations/problem-statement.md).

---

## Stage 1 — a Worker on `workers.dev`, with no DNS involved

The point of this stage is that **it cannot involve DNS**, so nothing that goes wrong here is
a DNS problem.

### 1.1 — Create the workspace root

**This repository is documentation-only today.** Before there can be an `apps/nn` there has to
be a monorepo to put it in, per
[ADR-001](../../architecture/decisions/adr-001-one-monorepo.md).

```
package.json          { "workspaces": ["apps/*", "packages/*"], "private": true }
.nvmrc                22
.gitignore            node_modules, dist, .env
tsconfig.base.json    strict: true
.github/workflows/    lint, typecheck, build
```

**Its own pull request**, separate from the app scaffold. It is the commit that turns a
documentation repository into a code one, and deserves reviewing as that.

> **What this commits the club to:** a lockfile, a dependency-update stream, CI minutes, and a
> repository that can no longer be casually edited in the GitHub web interface. All intended —
> but it starts here.

### 1.2 — Scaffold the app

**Genuinely minimal** — a heading and nothing else. Every extra thing is another candidate
cause when the deploy misbehaves.

Static Astro, **no adapter**, deployed as a **Worker with static assets** — per
[the build brief](../nn-build-brief.md#build-it-as-a-worker).

```
apps/nn/
├── src/pages/index.astro     "Nightingale Nightmare" and nothing else
├── wrangler.jsonc            assets.directory -> dist
├── astro.config.mjs          output: 'static'
├── package.json
└── .nvmrc                    22
```

**Versions, confirmed August 2026:** Astro 6.0 is stable and requires **Node ≥ 22.12.0**, and
does **not** support odd-numbered Node releases. Cloudflare's build image honours `.nvmrc` —
pin it, because Workers Builds already defaults to Node 24.

```bash
npm install
npm --workspace apps/nn run build     # must succeed, and produce dist/
```

**Done when** `dist/index.html` exists and contains the expected text.

> **Merge both pull requests before the next step.** Builds run from a branch, so the scaffold
> must be on `main` before a project can point at it — otherwise the first build fails on an
> empty directory and you debug a problem that does not exist.

### 1.3 — Create the Worker

Dashboard → Workers & Pages → Create → **Import a repository**.

| Setting | Value |
| --- | --- |
| **Worker name** | **Decide deliberately — see below** |
| Repository | `southville-running-club/src-website` |
| Production branch | `main` |
| **Root directory** | **`apps/nn`** ← the monorepo setting |
| Build command | `npm run build` |
| **Build watch paths** | **exclude `docs/*`.** Leave includes at `*` — see below |

**The Worker name is effectively permanent.** It becomes `<name>.<account>.workers.dev`, which
is where preview URLs live. Choose a *pattern* rather than a name — there will be at least
three of these.

**Watch paths: exclude, do not include.** The instinct is to narrow to `apps/nn/*`, and that
is **wrong in a workspace** — a change to `packages/shared`, `packages/db`, the root
`package.json` or the lockfile would then trigger no rebuild, and the site would silently stay
stale. Excluding `docs/*` skips the frequent thing that cannot affect the build and keeps
everything that can.

> **Connect a repository rather than uploading.** A git-connected project can later be driven
> by `wrangler deploy` from CI if wanted; the reverse conversion is not available. Git keeps
> both deployment models open.

### 1.4 — Verify it serves

```bash
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' "https://<worker>.<account>.workers.dev"
#   expect: 200 0            (0 = certificate verified)
```

**Stop condition.** Do not proceed to Stage 2 until this passes. Every failure mode in Stage 2
is DNS or TLS; if the app itself is broken you will misdiagnose it.

### 1.5 — Confirm a preview appears on a pull request

Open a trivial pull request and check a preview URL is produced. This is the review mechanism
[everything as code](../../foundations/requirements.md#everything-is-defined-as-code) depends
on — the other volunteer clicking a link, not reading a diff and imagining it.

---

## Stage 2 — the club hostname

**One action, and Cloudflare does the DNS.**

Worker → Settings → **Domains & Routes** → **Add** → Custom Domain →
`nn.southvillerunningclub.co.uk`.

Cloudflare creates the DNS record, issues the certificate, and sets the proxy state. **Do not
add anything at Fasthosts** — its DNS panel is no longer authoritative and a change there would
save successfully and do nothing.

> **`nn` is proxied, and that is correct.** The nameserver move ran on *nothing is proxied*,
> which applied to records pointing at Squarespace and Fasthosts mail. Here **Cloudflare is the
> origin**. See [adding a hostname](adding-a-hostname.md#the-proxy-rule-which-now-has-two-halves).

### Verify

```bash
D=nn.southvillerunningclub.co.uk
dig +short "$D"
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' "https://$D"
#   expect: 200 0     — may take a few minutes while the certificate issues
```

Then **send and receive a club email**. It cannot be affected by this change — the habit is
the point, and it costs a minute.

**Do not announce the address until this passes.** A name that did not resolve is remembered
as not existing for an hour.

---

## Stage 3 — connect it to Supabase

**The network path is proven, so from here anything that breaks is application code.** That
separation is the whole reason Stages 1 and 2 involve no database.

[Phase 3](../phases.md#phase-3--hello-world-for-nightingale-nightmare) is not finished until
this stage is, but it is [the build brief](../nn-build-brief.md)'s territory. In outline:

| | |
| --- | --- |
| **3.1** | `intake.nn_interest` — name, email, consent, timestamp. **Nothing else.** [ADR-002](../../architecture/decisions/adr-002-schema-layout.md) |
| **3.2** | RLS: **anonymous `insert` only**, on a schema holding no membership data. The negative test — an anonymous client *cannot read* `club` — is the one that matters |
| **3.3** | The form as a **Worker route**, with server-side validation. It must work with **JavaScript disabled** |
| **3.4** | Migrations applied from CI, schema-scoped. [ADR-003](../../architecture/decisions/adr-003-local-development-and-pipeline.md) |
| **3.5** | Acceptance tests green, including **axe at zero violations** |

**The anon key is public and belongs in the client. The service role key does not exist here**
— if the build appears to want it, the RLS policy is wrong and that is the thing to fix.

---

## What could go wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Certificate warning, or HTTPS fails | Certificate not issued yet | Wait. Minutes, occasionally longer. **Do not delete and retry** — that restarts issuance |
| `dig` returns nothing | Not propagated | Remember [negative caching is an hour](../dns-first.md#the-zone-as-measured) — a name that did not exist is remembered as not existing |
| Custom domain stuck pending | Cloudflare cannot complete validation | Check the zone is Active and the hostname is not already claimed by another project |
| Page loads but is stale | Build did not run | Check the watch paths, and which version is live |
| **Club email stops** | **Not this change.** Nothing here touches mail | Check what else changed, then [the nameserver runbook's](nameserver-move.md#rollback) rollback |

## Rollback

| Stage | Undo | Effective in |
| --- | --- | --- |
| Stage 1 | Delete the Worker | Immediately. Nothing external referenced it |
| Stage 2 | Remove the custom domain | Seconds — Cloudflare removes the record with it |

**Nothing in this runbook can break the existing website or club email.** The apex, `www` and
every mail record are untouched throughout.

---

## Done when

- [ ] The page serves over HTTPS at `nn.southvillerunningclub.co.uk` with a valid certificate
- [ ] `dig` on the apex still returns **Squarespace's** addresses
- [ ] A club email has been **sent and received** since the change
- [ ] A pull request produces a preview URL
- [ ] The page is legible at **320 px** — [70% of visitors are on a phone](../../foundations/requirements.md#users)
- [ ] **What was done by hand is written down** — the Worker settings, who did it, how to redo it
- [ ] **The updated zone is exported from Cloudflare and committed** — [ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md)
- [ ] **The volunteer who did not create the Cloudflare account can reach the Worker**

## Then, not before

**The build brief takes over** — the real page, the sign-up form, the privacy notice. The
network path is proven, so anything that breaks from here is application code.
