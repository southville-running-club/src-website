# The seven phases

The shape of the programme, end to end. **Start here**, then use [the plan](plan.md) for the
numbered steps and the [runbooks](runbooks/) for the procedures.

| | | Ends when |
| --- | --- | --- |
| **[1](#phase-1--hello-world-on-the-club-domain)** | Hello-world at `nn.<apex>`, on Supabase, defined as code | A page reaches production through the whole pipeline and writes to the club's database |
| **[2](#phase-2--nightingale-nightmare-built-out)** | Nightingale Nightmare built out | Sign-ups are open and working |
| **[3](#phase-3--the-timing-app-rebuilt-on-cloudflare)** | The timing app **rebuilt on Cloudflare**, off Vercel, same database | `timing.<apex>` serves the timing platform from Cloudflare |
| **[4](#phase-4--move-the-nameservers)** ✅ | ~~Nameservers move to Cloudflare~~ — **done 8 Aug 2026** | Cloudflare answers for the zone, nothing else changed |
| **[5](#phase-5--the-new-website-at-newapex)** | The new website at `new.<apex>` | Every page the old site has, the new one has |
| **[6](#phase-6--move-the-member-payments)** | Member payments move to the new site | All ~103 payers have re-established their payment |
| **[7](#phase-7--decommission-squarespace)** | Decommission Squarespace | Cancelled, **before 21 March 2027** |

**Phases 1–3 are defined below. Phases 4–7 are sketched deliberately** — they are far enough
out that detail written now would be rewritten before it was used. Phase 4 in particular is
[flagged as needing its own investigation](#phase-4--move-the-nameservers).

---

## Two ordering problems

### Phase 3 depended on Phase 4 (resolved)

**Phase 4 was brought forward and executed**, so this dependency is discharged. Workers
custom domains are available and Phase 3 is unblocked. The reasoning is kept below because it
explains why the order changed.

**The timing app could not serve `timing.<apex>` from Cloudflare until the nameservers
moved.**

| | |
| --- | --- |
| The timing app is **Next.js** using Node APIs — [`randomInt` from `node:crypto`](../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know) | So it needs **`@opennextjs/cloudflare`**, which targets **Workers**. The Pages alternative, `@cloudflare/next-on-pages`, is **Edge-runtime only** and would mean reworking the app |
| **Workers Custom Domains require an active Cloudflare zone** — Cloudflare's words: *"To add a Custom Domain, you must have an active Cloudflare zone"* | The club's zone is at Fasthosts until Phase 4 |
| The fallback is `*.workers.dev` | Cloudflare states this *"is intended for personal or hobby projects that aren't business-critical"* and recommends a custom domain for production. **Race-critical makes that worse, not better** |

**This is why `nn` works today and `timing` will not:** Pages serves a subdomain from
third-party DNS, Workers does not. It is the same constraint that put Nightingale Nightmare
on Pages in the first place.

> **This was actioned.** The nameservers moved on 8 August 2026, ahead of Phases 2 and 3,
> which is also where [move the DNS first](dns-first.md) always argued it belonged — taken in
> a quiet week when nothing depended on it.

### Phase 3 must still come after the race

[NN needs the timing app to work on race day.](../foundations/requirements.md#risk)
Rebuilding it beforehand means racing on a rebuilt system — and *a race happens once a year
and cannot be re-run*.

**So NN 2026 runs on the existing Vercel deployment**, and Phase 3 starts after Halloween
weekend. That is the same conclusion
[ADR-001](../architecture/decisions/adr-001-one-monorepo.md) already reached for bringing the
repository into the monorepo: with the Cloudflare port, after the 2026 race.

---

## What "defined as code" means here

Phase 1 says *fully IaC'ed*, and that is worth pinning down so it does not quietly conflict
with [ADR-005](../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md).

| | |
| --- | --- |
| **Code** | Schema and RLS (migrations), the app, `wrangler.jsonc`, CI pipeline, local stack and seed data, generated types |
| **Manual, and written down** | The CNAME at Fasthosts (no usable API), creating the Cloudflare project, creating the Supabase project, secrets |

**Everything that changes often is code. Everything once-ever is manual and documented.**
That is the principle, not a compromise — see
[infrastructure as code](../architecture/investigations/infrastructure-as-code.md) for the
arithmetic behind it.

---

## Phase 1 — hello-world on the club domain

**A page reaching production through the whole pipeline, on the club's domain, writing to the
club's own database.** Everything after this is more of the same shape.

The point is that each piece is proven separately: build, deploy, hostname, TLS, database. A
failure has one candidate cause.

| | |
| --- | --- |
| **The monorepo exists** | Workspace root, `apps/nn`, `packages/db`. [ADR-001](../architecture/decisions/adr-001-one-monorepo.md) |
| **The pipeline exists** | `localhost` with fabricated data; CI brings up the same stack and runs acceptance tests. [ADR-003](../architecture/decisions/adr-003-local-development-and-pipeline.md) |
| **Cloudflare Pages project**, git-connected, `main` deploys production | **Import an existing Git repository** — Direct Upload cannot convert to Git later |
| **`nn.<apex>`** | One additive CNAME at Fasthosts. **No nameserver change needed** |
| **Supabase** | `intake.nn_interest`, RLS, migrations applied from CI. [ADR-002](../architecture/decisions/adr-002-schema-layout.md) |

**Procedure:** [Nightingale Nightmare onto the club domain](runbooks/nn-to-club-domain.md).

### Running alongside, and it should start now

**Rescue everything Squarespace deletes at cancellation** — ~45 documents, 33 newsletters,
every image, plus the seven on Google Drive. Free today, **impossible after cancellation**,
and depends on nothing. [Plan](plan.md) steps 12–15.

### Done when

- [ ] `nn.<apex>` serves over HTTPS with a valid certificate
- [ ] A submission writes exactly one row to `intake.nn_interest`
- [ ] An anonymous client **cannot** read anything in `club`
- [ ] CI green: lint, types, migrations from zero, unit, Worker, Playwright + axe at zero
- [ ] A pull request produces a preview URL
- [ ] **Club email still works**
- [ ] **Both volunteers** can reach repository, Cloudflare project and Supabase

### Unknowns

| | |
| --- | --- |
| **The Pages project name** | Permanent — it is the CNAME target and projects cannot be renamed. Pick a *pattern*; the website needs a second one |
| **Git-integration builds, or CI-driven deploy?** | Git integration needs no credential but leaves build config in the dashboard. Switchable later without recreating the project |

---

## Phase 2 — Nightingale Nightmare built out

The real page, the real form, and sign-ups open. **Hard date: sign-ups want to open around
late August**, with the race on Halloween weekend.

| | |
| --- | --- |
| The page, the form and the **privacy notice** | [Build brief](nn-build-brief.md) |
| **Name, email, consent, timestamp. Nothing else** | Adding a field is a committee decision, not a build decision |
| Race facts in **one file**, so changing the date is a one-line edit | The exact day is not fixed and nothing waits on it |
| Tested with **JavaScript off**, duplicate submission, bad input, at 320 px | |

### Unknowns

| | |
| --- | --- |
| **2026 entries — own site or Full On Sport?** | **Due now.** Own site pulls [C3](../foundations/requirements.md#c3--accept-race-sign-ups-and-entries), [C4](../foundations/requirements.md#c4--take-payments) and the governance gates forward |
| **The exact race date** | 31 October or 1 November. Clocks go back on **Sunday 25 October**, so either is safely after |
| **Entry price** | Assumed £8–£10, unconfirmed, not needed for sign-ups |
| **Page copy** | The committee's to write |

**No payment code** until data-protection advice and treasurer-controlled arrangements
exist. Firm gates.

---

## Phase 3 — the timing app rebuilt on Cloudflare

**Off Vercel, onto Cloudflare, pointing at the same Supabase database.** The most technically
demanding phase and the only one touching a system that cannot be re-run.

**Read the [ordering problems](#two-ordering-problems) first.**

### What it involves

| | |
| --- | --- |
| **`@opennextjs/cloudflare`** on Workers | Not Pages — Pages' Next.js route is Edge-runtime only |
| **The repository joins the monorepo** | [ADR-001](../architecture/decisions/adr-001-one-monorepo.md). **Move it into the club org *before* connecting Cloudflare** — doing it after desyncs the link |
| **`timing.<apex>`** as a Workers Custom Domain | **Needs the zone on Cloudflare** |
| Database unchanged | Same project, `public` and `private` schemas untouched |

### Three things a port must not break

From the [architecture review](../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know),
and each was learned the hard way:

1. **The IndexedDB offline queue** and its idempotent-upsert contract. A marshal's capture
   must survive no signal.
2. **The TypeScript/SQL lockstep** on bib resolution — the same logic exists in `lib/bib.ts`
   and in `private.resolve_crossing_team_id()`, and they must stay in step.
3. **`Europe/London` pinning.** One tested path, `TZ=UTC` in tests.

**Sign-off is a full manual race simulation** — multiple devices, real connectivity loss, the
real race date. No test suite replaces it.

### Unknowns

| | |
| --- | --- |
| **Does the nameserver move come first?** | [Recommended, and close to required](#phase-3-depended-on-phase-4-resolved) |
| **The Workers bundle-size ceiling** | 3 MB compressed free, 10 MB paid. Unmeasured for this app |
| **The 10 ms CPU limit** on free Workers | Against server-rendered pages. May force Workers Paid |
| **[C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators) — the live leaderboard** | **Durable Objects, not Supabase Realtime.** Realtime caps at 200 concurrent and Pro is £237/yr. Hibernatable WebSockets on the free plan make this roughly free — but it is a rebuild of the leaderboard, not a port |
| **Multi-event hardcoding** | `LOCATION_LABEL = "Ashton Court"` and evening-start copy. Deferred until a second event landed — that is now |
| **Solo-race gaps** | The leaderboard derivation is relay-shaped; age-band categories do not exist yet |

---

## Phase 4 — move the nameservers

> ## ✅ Done — 8 August 2026, 15:54 UTC
>
> Delegation is `bonnie.ns.cloudflare.com` / `hans.ns.cloudflare.com`, confirmed at both `.uk`
> registry servers. All 18 records verified identical before and after; nothing proxied; the
> site serving from Squarespace; mail routing unchanged through Fasthosts; all four DKIM
> chains resolving to live public keys.
>
> **Brought forward ahead of Phases 2 and 3**, because Phase 3 was gated on it and
> [move the DNS first](dns-first.md) always argued for taking the risk in a quiet week.
>
> **Still open:** the 48-hour observation window closes 10 August; the Cloudflare zone export
> needs committing; the Fasthosts zone is kept until **8 September** as the rollback.
> [What actually happened](runbooks/nameserver-move.md#what-actually-happened-8-august-2026).

**It was flagged as needing its own investigation, and it got one.**

| | |
| --- | --- |
| **What changes** | One setting at Fasthosts: the nameservers |
| **What does not** | Registration, mail routing, where the website is served, every record's value |
| **Risk** | **Real — it carries club email.** The only change reversible in *up to 48 hours* |
| **Effort** | Three evenings and a morning, over ~2 weeks because of two waiting periods |

**The groundwork is already done:** [move the DNS first](dns-first.md) has the zone measured
— no DNSSEC, no CAA, 18 records, and the two clocks that govern it — and
[the runbook](runbooks/nameserver-move.md) is an executable checklist.

**What it unblocks:** Workers Custom Domains (so Phase 3), the current Astro adapter, Cron
Triggers, and it turns Phase 7's apex cutover into a record edit that reverses in seconds.

### Unknowns

| | |
| --- | --- |
| **When** | Not race week, not near the Squarespace renewal, not the week NN launches, not a Friday |
| **Whether it moves before Phase 3** | [The dependency above](#phase-3-depended-on-phase-4-resolved) says it should |
| **Whether a ~£10 throwaway domain is bought to rehearse** | The only way to practise this or test mail authentication, since [ADR-004](../architecture/decisions/adr-004-no-staging-environment.md) declined a staging environment |
| **Who does the independent verification** | Non-negotiable, and it needs a named second person |

---

## Phase 5 — the new website at `new.<apex>`

*Sketch. To be defined when Phase 3 is done.*

The old site keeps running throughout; the new one grows beside it with **paths matching the
old site**, so every address is proven long before anything switches.
[Decision 004](../decisions/decision-log.md).

**Order within the phase is the important part.** The **payment page is built first**, and
every *new* subscriber is sent to it from that day — the old list grows by about **45
payments a month**, and this is what turns Phase 6 from a growing problem into a fixed one.
Then the results archive (16.6% of traffic, typed by hand today), the main pages (61%), the
newsletter mirror, documents, membership forms, and the kit section **re-scoped before it is
built**.

`noindex` across the subdomain until cutover, or two copies of the same content split the
club's search results.

**Needs a subdomain, not the apex** — so it does not depend on Phase 4, though by then the
nameservers will have moved anyway.

---

## Phase 6 — move the member payments

*Sketch.*

⚠️ **The one part that asks anything of members.** ~103 people, each personally
re-establishing a payment, because Squarespace Payments mandates cannot be transferred.

**A communications exercise measured in months.** The longest part of the programme and the
only part that cannot be sped up by working harder.

**Gates, in order:** data-protection advice; treasurer-controlled payment arrangements; and
**decide card or Direct Debit before anybody is asked to move** — worth about £250/yr, and
deciding late means asking 103 people twice.

**Starts during Phase 5, not after it.** It needs the payment page, not the finished website.

---

## Phase 7 — decommission Squarespace

*Sketch.* **Requires Phase 4** — Cloudflare cannot serve the bare domain otherwise.

**One coordinated moment**, because Squarespace 301-redirects every secondary domain to its
primary, so the old site cannot live at `old.` while it still serves `www`. Decide first
where the old site goes — `old.<apex>`, or simply its built-in `*.squarespace.com` address,
which needs no DNS at all.

Then point the apex and `www` at the new site, tidy the SPF record, remove `noindex`,
redirect `new.` → apex, and walk every old address for 404s.

**Confirm five things before cancelling:** the site is rebuilt and serving the apex; every
URL resolves; the member fund has moved; every document, newsletter and image is held by the
club; and the treasurer can reconcile.

**Then cancel — before 21 March 2027.**

---

## What it costs when this is done

| | Per year |
| --- | --- |
| Today | **£735** |
| After Phase 7 | **£427** |
| With Direct Debit as well | **£177** |

**The money was never the point.** The larger return is the [manual
work](../foundations/problem-statement.md#3-volunteers-are-doing-work-the-system-should-do)
this removes.
