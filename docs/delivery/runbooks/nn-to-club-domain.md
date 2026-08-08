# Runbook — Nightingale Nightmare onto the club domain

Getting a working page served at `nn.southvillerunningclub.co.uk`.

Part of [Phase 1](../phases.md#phase-1--nightingale-nightmare-and-timing-on-the-club-domain).
**Stages here are internal to this runbook** and are not the programme's phases.

**Scope: the network path only.** A hello-world page, proving repository → build → Cloudflare
→ HTTPS → club hostname. **No form, no database.** The sign-up form is
[the build brief](../nn-build-brief.md)'s job and follows after this, so that when it goes
wrong there is only one thing it can be.

| | |
| --- | --- |
| **Time** | Stage 1 an evening, **plus a separate evening for the workspace root** if this is the first code in the repository. Stage 2 fifteen minutes plus a TTL wait |
| **Risk** | **None at any step.** Everything here is additive or internal to Cloudflare |
| **Blocks** | Nothing. **Does not require the [nameserver move](nameserver-move.md)** |
| **Blocked by** | A Cloudflare account both volunteers can reach |

---

## Stage 0 — before you start

Cheap things that make everything after them easier.

| | Check | Why it is here |
| --- | --- | --- |
| **0.1** | Cloudflare account is **club-owned** and **both volunteers are admins** | [Shared ownership](../../foundations/requirements.md#shared-ownership). Doing it now avoids a transfer, and transfers are the step that never happens |
| **0.2** | Two-factor authentication on the Cloudflare account | It can now change where the club's website points |
| **0.3** | **Agree who runs this — and consider making it the volunteer who did *not* set up the Cloudflare account** | Stage 1 is low-stakes, reversible and touches nothing live, which makes it the ideal way to find out whether *"both volunteers can reach everything"* is **true** rather than asserted. Better to discover it here than during [the nameserver move](nameserver-move.md) |
| **0.4** | The current Fasthosts zone is **captured and committed** | [Plan](../plan.md) step 23. It is the rollback reference for everything DNS, and you want it before touching the zone at all — not before touching Cloudflare |
| **0.5** | Decide the **ordering** — [Path A or Path B](#stage-2--the-club-hostname) | Affects Stage 2 only. Stage 1 is identical either way |
| **0.6** | **The repository is already in the club organisation**, and an org owner can approve the Cloudflare GitHub App | ⚠️ **Order matters.** Moving a repository between a personal account and an organisation **after** connecting Pages is a documented way to desync the link so it cannot cleanly reconnect. Relevant to `src-race-timing`, which [plan](../plan.md) step 11 moves into the org — **move it first, connect Pages afterwards** |

> **Stop condition.** If 0.1 is not true, fix it before Stage 1. A Cloudflare project created
> under a personal account is a club asset held personally, which is
> [the problem this programme exists to fix](../../foundations/problem-statement.md).

---

## Stage 1 — a page on `pages.dev`, with no DNS involved

The point of this stage is that **it cannot involve DNS**, so nothing that goes wrong here is
a DNS problem.

### 1.1 — Create the workspace root

**This repository is documentation-only today.** Before there can be an `apps/nn` there has
to be a monorepo to put it in, per
[ADR-001](../../architecture/decisions/adr-001-one-monorepo.md).

```
package.json          { "workspaces": ["apps/*", "packages/*"], "private": true }
.nvmrc                22
.gitignore            node_modules, dist, .env
tsconfig.base.json    strict: true
.github/workflows/    lint, typecheck, build
```

**Its own pull request**, separate from the app scaffold. It is the commit that turns a
documentation repository into a code one, and it deserves to be reviewed as that rather than
smuggled in alongside an Astro template.

> **What this commits the club to:** a lockfile, a dependency-update stream, CI minutes, and
> a repository that can no longer be casually edited in the GitHub web interface. All
> intended — but it starts here, not later.

### 1.2 — Scaffold the app

Minimum viable, and **genuinely minimum** — a heading and nothing else. Every extra thing is
another candidate cause when the deploy misbehaves. Layout, styling and content arrive with
the real page.

Astro static output, **no adapter** — per
[the build brief](../nn-build-brief.md#the-adapter-constraint--read-this-before-choosing-anything).
For a static-only site Astro needs no Cloudflare adapter at all.

```
apps/nn/
├── src/pages/index.astro     "Nightingale Nightmare" and nothing else
├── astro.config.mjs          output: 'static'
├── package.json
└── .nvmrc                    22
```

**Versions, confirmed August 2026:** Astro 6.0 is stable and requires **Node ≥ 22.12.0**. It
does **not** support odd-numbered Node releases (23, 25). Cloudflare's Pages v3 build image
defaults to Node 22.16.0 and honours `.nvmrc`, so nothing extra is needed — but pin it
anyway, because Workers Builds already defaults to Node 24 and this project may move there.

```bash
npm install
npm --workspace apps/nn run build     # must succeed, and produce dist/
```

**Done when** `dist/index.html` exists and contains the expected text.

> **Merge both pull requests before the next step.** Pages builds from a branch, so the
> scaffold must be on `main` before a project can point at it — otherwise the first build
> fails on an empty root directory and you debug a problem that does not exist.

### 1.3 — Create the Cloudflare Pages project

Dashboard → Workers & Pages → Create → Pages → **Import an existing Git repository**.

> **Not "Drag and drop your files".** Cloudflare is explicit: *"If you choose Direct Upload,
> you cannot switch to Git integration later. You will have to create a new project."* The
> reverse **is** possible — a Git-connected project can later disable automatic deployments
> and be driven by `wrangler pages deploy` instead.
>
> **So Git integration keeps both deployment models open and Direct Upload closes one
> permanently.** And because the project name is the CNAME target, recreating a project means
> redoing the DNS record and the certificate too.
>
> Drag-and-drop is fine for a genuine throwaway that proves the network path — **delete it
> afterwards.** It also cannot serve Pages Functions, which the sign-up form needs.

| Setting | Value |
| --- | --- |
| **Project name** | **Decide deliberately — see below** |
| Repository | `southville-running-club/src-website` |
| Production branch | `main` |
| **Root directory** | **`apps/nn`** ← the monorepo setting |
| Build command | `npm run build` |
| Build output directory | `dist` |
| **Build watch paths** | **exclude `docs/*`.** Leave includes at `*` — see below |

**The project name is effectively permanent.** It determines `<project>.pages.dev`, which is
the hostname the club's CNAME will point at, and **a Pages project cannot be renamed** — you
would delete and recreate it. Generic names are likely already taken, so choose something
club-specific, and choose a *pattern* rather than a name, because the main website will need
a second one later.

**Watch paths: exclude, do not include.** Pages defaults includes to `*`. The instinct is to
narrow it to `apps/nn/*`, and that is **wrong in a workspace** — a change to
`packages/shared`, `packages/db`, the root `package.json` or the lockfile would then trigger
no rebuild, and the site would silently stay stale. That is a genuinely unpleasant thing to
diagnose.

Excluding `docs/*` skips the frequent thing that cannot affect the build, and leaves
everything that can. Narrow it further when a second app exists, not before.

*Why this matters at all: the free plan allows **500 builds a month**, and this repository's
documentation changes far more often than its code.*

**Why Pages and not Workers.** Cloudflare now recommends Workers for new projects, but
**Workers custom domains require an active Cloudflare zone** and the club's zone is at
Fasthosts. Pages serves a subdomain from third-party DNS; Workers cannot. See
[deployment](../../architecture/investigations/deployment.md#pages-or-workers) — and if
Path B is chosen, this constraint disappears and Workers becomes available.

### 1.4 — Verify it actually serves

```bash
PROJECT=<project>.pages.dev

curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' "https://$PROJECT"
#   expect: 200 0            (0 = certificate verified)

curl -sS "https://$PROJECT" | grep -i nightingale
#   expect: the page text
```

**Done when** the page loads over HTTPS at `<project>.pages.dev` with a valid certificate.

**Stop condition.** Do not proceed to Stage 2 until this passes. Every failure mode in Stage
2 is DNS or TLS; if the site itself is broken you will misdiagnose it.

### 1.5 — Confirm a preview deployment appears

Open a trivial pull request and check Cloudflare comments a preview URL on it.

This is the review mechanism [everything as
code](../../foundations/requirements.md#everything-is-defined-as-code) depends on — the other
volunteer clicking a link, not reading a diff and imagining it.

---

## Stage 2 — the club hostname

Two paths. **They differ only in where the record lives**, and both end at the same place.

| | **Path A — CNAME at Fasthosts** | **Path B — after the nameserver move** |
| --- | --- | --- |
| **When** | Now. Zone still at Fasthosts | After [the nameserver move](nameserver-move.md) has settled |
| **Risk** | **None** — [additive](../../foundations/glossary.md#domains-and-dns); the name does not resolve today | **None** — a change inside Cloudflare |
| **Rollback** | Delete the record. Effective within the TTL | Delete it. Seconds |
| **Squarespace impact** | **None** — touches neither the apex nor `www` | **None** |
| **Speed to live** | Minutes, plus TTL | Immediate |
| **Also unlocks** | Nothing further | Workers, the Astro adapter, server rendering, Cron Triggers |

**Recommendation with sign-ups two weeks out: Path A.** It is free of risk and does not wait
on the one change with a 48-hour rollback window. Path B is the better *end state* and the
nameserver move should still happen — just not as a prerequisite for this.

### Path A — one additive CNAME at Fasthosts

#### A.1 Associate the custom domain in Cloudflare **first**

Pages project → Custom domains → Set up a custom domain →
`nn.southvillerunningclub.co.uk`.

Cloudflare will report it as pending and tell you what record to create.

> **The order is the trap.** Adding the DNS record before associating the domain in the
> dashboard produces a **522**. [Plan](../plan.md) step 37 says the same thing.

#### A.2 Add the record at Fasthosts

*Fasthosts' control panel layout is not publicly documented — **confirm the exact screen in
the panel**. What matters is the record, not the click path.*

| Field | Value |
| --- | --- |
| Type | **CNAME** |
| Name / host | **`nn`** |
| Target | **`<project>.pages.dev`** |
| TTL | Lowest the panel allows |

**Do not modify or delete anything else.** Additive only.

#### A.3 Verify

```bash
D=nn.southvillerunningclub.co.uk

dig +short "$D" CNAME
#   expect: <project>.pages.dev.

dig +short "$D" A
#   expect: Cloudflare addresses — this hostname SHOULD resolve to Cloudflare

curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' "https://$D"
#   expect: 200 0     — may take a few minutes while the certificate issues
```

Then in Cloudflare, confirm the custom domain has gone from **Pending** to **Active**.

#### A.4 Confirm club email still works

Send a message to a club address and reply from it.

**The CNAME cannot affect mail** — it touches no MX, SPF, DKIM or DMARC record. Confirming
costs a minute and it is the habit that matters: after any zone change, mail first.

### Path B — a record inside Cloudflare

If the nameservers have already moved, `nn` is created *by* Cloudflare rather than by you.

#### B.1 Associate the custom domain

Pages project → Custom domains → `nn.southvillerunningclub.co.uk`. Cloudflare creates the
DNS record and issues the certificate itself.

#### B.2 The one proxy exception, and how to avoid having to reason about it

[The nameserver move](nameserver-move.md) is built on a rule: **nothing is proxied, eleven
grey clouds, not one thing orange.** That rule is about records pointing at Squarespace and
at Fasthosts' mail.

**`nn` is different — Cloudflare *is* the origin for it**, so its record is expected to be
**proxied**, and it is the one record in the zone where orange is correct.

> **Do not hand-craft this record.** Let the Pages dashboard create it and leave whatever
> proxy state Cloudflare sets. If a hand-made CNAME from Path A already exists, **delete it
> and re-add the custom domain through the dashboard** rather than trying to convert it.

*This is recorded as an [open question](../../architecture/README.md#open-questions) rather
than a verified fact — the dashboard-managed route sidesteps needing to know.*

#### B.3 Verify

The same checks as [A.3](#a3-verify), plus:

```bash
dig +short southvillerunningclub.co.uk A
#   expect: SQUARESPACE addresses, NOT Cloudflare's
#   a Cloudflare address here means the apex got proxied — fix that first
```

---

## Stage 3 — connect it to Supabase

**The network path is proven, so from here anything that breaks is application code.** That
separation is the whole reason Stages 1 and 2 involve no database.

[Phase 1](../phases.md#phase-1--nightingale-nightmare-and-timing-on-the-club-domain) is not
finished until this stage is, but it is
[the build brief](../nn-build-brief.md)'s territory rather than this runbook's. In outline:

| | |
| --- | --- |
| **3.1** | `intake.nn_interest` — name, email, consent, timestamp. **Nothing else.** [ADR-002](../../architecture/decisions/adr-002-schema-layout.md) |
| **3.2** | RLS: **anonymous `insert` only**, on a schema holding no membership data. The negative test — an anonymous client *cannot read* `club` — is the one that matters |
| **3.3** | The form as a **Pages Function**, with server-side validation. It must work with **JavaScript disabled** |
| **3.4** | Migrations applied from CI, schema-scoped. [ADR-003](../../architecture/decisions/adr-003-local-development-and-pipeline.md) |
| **3.5** | Acceptance tests green, including **axe at zero violations** |

**The anon key is public and belongs in the client. The service role key does not exist
here** — if the build appears to want it, the RLS policy is wrong and that is the thing to
fix.

---

## What could go wrong, and what to do

| Symptom | Cause | Fix |
| --- | --- | --- |
| **522** | DNS record added before the custom domain was associated | Associate it in the dashboard, then wait. The record is fine |
| Certificate warning, or HTTPS fails | Certificate not issued yet | Wait. Minutes, occasionally longer. Do not delete and retry — that restarts the clock |
| `dig` returns nothing | Not propagated, or the record is wrong | Check the record at Fasthosts. Remember [negative caching is an hour](../dns-first.md#the-zone-as-measured) — a name that did not exist is remembered as not existing |
| Custom domain stuck **Pending** | Cloudflare cannot see the expected record | Compare the target exactly, including the trailing dot |
| Page loads but is stale | Cached deployment | Check which deployment is live in the dashboard |
| **Club email stops** | **Not this change.** Nothing here touches mail | Check whether anything else changed. Then [the nameserver runbook's](nameserver-move.md) rollback |

---

## Rollback

| Stage | Undo | Effective in |
| --- | --- | --- |
| Stage 1 | Delete the Pages project | Immediately. Nothing external referenced it |
| Path A | Delete the `nn` CNAME at Fasthosts | Within the TTL |
| Path B | Delete the custom domain in Cloudflare | Seconds |

**Nothing in this runbook can break the existing website or club email.** The apex, `www` and
every mail record are untouched throughout. That is why it can run in parallel with
everything else.

---

## Done when

- [ ] The page serves over HTTPS at `nn.southvillerunningclub.co.uk` with a valid certificate
- [ ] The Cloudflare custom domain shows **Active**
- [ ] `dig` on the apex still returns **Squarespace's** addresses
- [ ] A club email has been **sent and received** since the change
- [ ] A pull request produces a preview URL
- [ ] The page is legible at **320 px** — [70% of visitors are on a
      phone](../../foundations/requirements.md#users)
- [ ] **What was done by hand is written down** — the Pages settings, the record, who did it,
      and how to redo it
- [ ] The `nn` record is reflected in the committed zone file
- [ ] **The volunteer who did not create the Cloudflare account can reach the project** — the
      point of 0.3, and worth confirming rather than assuming

## Then, not before

**The build brief takes over** — the real page, the sign-up form, the privacy notice, and
`intake.nn_interest` per [ADR-002](../../architecture/decisions/adr-002-schema-layout.md).
The network path is proven, so anything that breaks from here is application code.
