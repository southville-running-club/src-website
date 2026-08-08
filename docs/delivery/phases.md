# The phases

The shape of the programme, end to end. **Start here**, then use [the plan](plan.md) for the
numbered steps and the [runbooks](runbooks/) for the procedures.

| | | Ends when |
| --- | --- | --- |
| **[1](#phase-1--prove-the-hosting-path)** ✅ | ~~Prove the hosting path~~ | **Done 8 Aug 2026** |
| **[2](#phase-2--move-the-nameservers)** ✅ | ~~Nameservers to Cloudflare~~ | **Done 8 Aug 2026** |
| **[3](#phase-3--hello-world-for-nightingale-nightmare)** | **Hello-world for NN** — Workers + Supabase, defined as code | A page reaches production through the whole pipeline and writes to the club's database |
| **[4](#phase-4--hello-world-for-timing)** | **Hello-world for timing** — same shape, same database | `timing.<apex>` serves a Worker. **The real app is untouched** |
| **[5](#phase-5--nightingale-nightmare-built-out)** | Nightingale Nightmare built out | Sign-ups open — **late August** |
| **[6](#phase-6--port-the-timing-app)** | The timing app **ported for real**, off Vercel | **After the race.** Race simulation signed off |
| **[7](#phase-7--the-new-website)** | The new website at `new.<apex>` | Every page the old site has, the new one has |
| **[8](#phase-8--move-the-member-payments)** | Member payments move | All ~103 payers have re-established their payment |
| **[9](#phase-9--decommission-squarespace)** | Decommission Squarespace | Cancelled, **before 21 March 2027** |

**Phases 3–6 are defined below. 7–9 are sketches** — far enough out that detail written now
would be rewritten before anyone used it.

> **Splitting "hello-world" from "built out" is the good idea in this plan**, and it applies
> twice. Phase 3 proves the *pipeline* — repository, build, deploy, hostname, TLS, database —
> with a page that has nothing to get wrong. Phase 5 then builds the real thing knowing every
> remaining failure is application code.
>
> **Phase 4 does the same for timing, and it is what makes Phase 6 safe.** A hello-world
> Worker at `timing.<apex>` proves the deployment path — Workers Builds, custom domain,
> Supabase connectivity — **without touching the race-critical application at all.** So it can
> happen before the race, while [the port itself cannot](#phase-6--port-the-timing-app).

---

## Everything is a Worker now

Phases 1 and 2 changed what is possible, and the documentation has been brought in line.

| | Before 8 Aug 2026 | **Now** |
| --- | --- | --- |
| Serving a club hostname | **Pages only** — Workers custom domains need an active zone | **Workers**, which is where Cloudflare is investing |
| Adding the DNS record | By hand at Fasthosts, in the right order or 522 | **Cloudflare creates it**, with the certificate |
| `@astrojs/cloudflare` adapter | Unusable — static output only | Available, if SSR is ever wanted |
| Next.js on Cloudflare | Impossible on the club domain | **`@opennextjs/cloudflare` on Workers** — what Phase 6 needs |

**Static Astro still needs no adapter.** A static build plus one Worker route is still the
right shape for a page and a form — what changed is that it deploys as a **Worker with static
assets** rather than a Pages project, and the hostname attaches itself.

*Pages is not deprecated and the NN build would still work on it. But Cloudflare's guidance
for new projects is Workers, and there is no longer a reason to take the other path.*

---

## What "defined as code" means here

Phases 3 and 4 say *via IaC*. Pinned down so it does not quietly conflict with
[ADR-005](../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md): **it means
the frontend and its pipeline**, not the DNS records.

| | |
| --- | --- |
| **Code** | The app, `wrangler.jsonc`, schema and RLS as migrations, the CI pipeline, local stack and seed data, generated types |
| **Manual, and written down** | Creating the Worker, creating the Supabase project, secrets, any hand-added DNS |

**Everything that changes often is code. Everything once-ever is manual and documented** —
see [infrastructure as code](../architecture/investigations/infrastructure-as-code.md) for the
arithmetic. Note there is now *less* manual DNS than a week ago, because attaching a custom
domain creates its own record.

---

## Phase 1 — prove the hosting path

> ## ✅ Done — 8 August 2026
>
> A throwaway project served a page at `nn.southvillerunningclub.co.uk` over HTTPS, via a
> Pages project and a CNAME at Fasthosts. **Deleted afterwards** — its whole purpose was to
> prove the path before anything depended on it.

**What it established:** Cloudflare could serve a club hostname from third-party DNS, the
certificate issued automatically, and the ordering trap was real — associate the custom
domain first, or get a 522.

**What it cost:** an afternoon, with nothing at stake at any point.

*The pattern is worth repeating: prove the path with something disposable, then build the real
thing knowing the path works. That is exactly what Phases 3 and 4 are.*

---

## Phase 2 — move the nameservers

> ## ✅ Done — 8 August 2026, 15:54 UTC
>
> Delegation is `bonnie.ns.cloudflare.com` / `hans.ns.cloudflare.com`, confirmed at both `.uk`
> registry servers. All 18 records verified identical before and after; nothing proxied; the
> site still served by Squarespace; mail routing unchanged through Fasthosts; all four DKIM
> chains resolving to live public keys.
>
> **Outstanding:** the 48-hour window closes 10 August; the Cloudflare zone export needs
> committing; the Fasthosts zone is kept until **8 September** as the rollback.

**Why it happened this early.** It was the riskiest change in the programme — the only one
carrying club email and the only one reversible in *up to 48 hours* rather than minutes. So it
was taken in a quiet week when nothing depended on it, which is what
[move the DNS first](dns-first.md) always argued for.

**What it unblocked:** Workers custom domains — and therefore Phases 4 and 6 — plus the
current Astro adapter, Cron Triggers, and a Phase 9 apex cutover that is now a record edit
rather than a migration.

[What actually happened](runbooks/nameserver-move.md#what-actually-happened-8-august-2026) is
worth reading before any similar change: **Cloudflare's scan found 12 of 18 records**, missing
all four DKIM CNAMEs.

---

## Phase 3 — hello-world for Nightingale Nightmare

**A page reaching production through the whole pipeline, on the club's domain, writing to the
club's own database.** Everything after this is more of the same shape.

Each piece is proven separately — build, deploy, hostname, TLS, database — so a failure has
one candidate cause.

| | |
| --- | --- |
| **The monorepo exists** | Workspace root, `apps/nn`, `packages/db`. [ADR-001](../architecture/decisions/adr-001-one-monorepo.md) |
| **The pipeline exists** | `localhost` with fabricated data; CI brings up the same stack and runs acceptance tests. [ADR-003](../architecture/decisions/adr-003-local-development-and-pipeline.md) |
| **A Worker**, git-connected, `main` deploys production | Static Astro output plus one Worker route |
| **`nn.<apex>`** | Attached as a **custom domain on the Worker** — Cloudflare creates the record |
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
- [ ] **Both volunteers** can reach the repository, the Worker and Supabase

### Unknowns

| | |
| --- | --- |
| **The Worker name** | Becomes the `workers.dev` preview hostname. Pick a *pattern* — there will be at least three |
| **Git-integration builds, or CI-driven deploy?** | Git integration needs no credential but leaves build config in the dashboard. Switchable later |

---

## Phase 4 — hello-world for timing

**The same shape, the same database, a different hostname — and deliberately nothing to do
with the timing application itself.**

| | |
| --- | --- |
| **A second Worker** in the monorepo | Proves the pattern generalises beyond one app |
| **`timing.<apex>`** | Attached as a custom domain. The hostname does not exist today, so this breaks nothing |
| **Reads from Supabase** | The *existing* project — `public` schema, read-only. Proves cross-app database access works |
| **The real timing app** | **Untouched, still on Vercel, still serving races** |

### Why this phase exists

**It de-risks Phase 6 without any of Phase 6's risk.** The port has to prove several things at
once — OpenNext on Workers, the bundle-size ceiling, the CPU limit, Supabase Auth redirects,
the offline queue. Doing the *deployment* half first, with a page that does nothing, means the
port only has to prove the application half.

**And it can happen before the race**, because it touches nothing race-critical.

### Unknowns

| | |
| --- | --- |
| **Does hello-world go on `timing.<apex>` or a scratch hostname?** | `timing.` is unused and unpublished, so it is probably fine — but the moment it is announced, it has to keep working |
| **Does it read real data or fabricated?** | Read-only against `public` proves more. It also means a production credential in a toy app |

---

## Phase 5 — Nightingale Nightmare built out

The real page, the real form, sign-ups open. **Hard date: late August**, with the race on
Halloween weekend.

| | |
| --- | --- |
| The page, the form and the **privacy notice** | [Build brief](nn-build-brief.md) |
| **Name, email, consent, timestamp. Nothing else** | Adding a field is a committee decision, not a build decision |
| Race facts in **one file** | The exact day is not fixed and nothing waits on it |
| Tested with **JavaScript off**, duplicate submission, bad input, at 320 px | |

### Unknowns

| | |
| --- | --- |
| **2026 entries — own site or Full On Sport?** | **Due now.** Own site pulls [C3](../foundations/requirements.md#c3--accept-race-sign-ups-and-entries), [C4](../foundations/requirements.md#c4--take-payments) and the governance gates forward |
| **The exact race date** | 31 October or 1 November. Clocks go back **Sunday 25 October**, so either is safely after |
| **Entry price** | Assumed £8–£10, unconfirmed, not needed for sign-ups |
| **Page copy** | The committee's to write |

**No payment code** until data-protection advice and treasurer-controlled arrangements exist.
Firm gates.

---

## Phase 6 — port the timing app

**Off Vercel, onto Workers, same Supabase database.** The most technically demanding phase and
the only one touching a system that cannot be re-run.

> ### ⚠️ After the Nightingale Nightmare race, not before
>
> NN needs the timing app on race day. Rebuilding it first means racing on a freshly ported
> system, and *a race happens once a year and cannot be re-run*. **NN 2026 runs on the existing
> Vercel deployment.** Same conclusion [ADR-001](../architecture/decisions/adr-001-one-monorepo.md)
> reached independently.

| | |
| --- | --- |
| **`@opennextjs/cloudflare`** on Workers | Not Pages — `@cloudflare/next-on-pages` is **deprecated** and Edge-runtime only |
| **The repository joins the monorepo** | **Move it into the club org *first*, then connect Cloudflare** — doing it after desyncs the git link |
| **`timing.<apex>`** switches from the Phase 4 hello-world to the real app | The hostname is already proven |
| Database unchanged | Same project; `public` and `private` untouched |

### Three things a port must not break

From the [architecture review](../reference/timing-app-review.md#what-the-website-and-the-port-need-to-know),
each learned the hard way:

1. **The IndexedDB offline queue** and its idempotent-upsert contract.
2. **The TypeScript/SQL lockstep** on bib resolution — the same logic in `lib/bib.ts` and
   `private.resolve_crossing_team_id()`.
3. **`Europe/London` pinning.** One tested path, `TZ=UTC` in tests.

**Sign-off is a full manual race simulation** — multiple devices, real connectivity loss, the
real race date. No test suite replaces it.

### Unknowns

| | |
| --- | --- |
| **The Workers bundle-size ceiling** | 3 MB compressed free, 10 MB paid. Unmeasured for this app |
| **The 10 ms CPU limit** on free Workers | Against server-rendered pages. May force Workers Paid |
| **[C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators) — the live leaderboard** | **Durable Objects, not Supabase Realtime.** Realtime caps at 200 concurrent and Pro is £237/yr; hibernatable WebSockets on the free plan make this close to free. **A rebuild, not a port** |
| **Multi-event hardcoding** | `LOCATION_LABEL = "Ashton Court"` and evening-start copy |
| **Solo-race gaps** | The leaderboard derivation is relay-shaped; age-band categories do not exist yet |

---

## Phase 7 — the new website

*Sketch.*

The old site keeps running throughout; the new one grows beside it at `new.<apex>` with
**paths matching the old site**, so every address is proven long before anything switches.
[Decision 004](../decisions/decision-log.md).

**Order within the phase is the important part.** The **payment page is built first**, and
every *new* subscriber is sent to it from that day — the old list grows by about **45 payments
a month**, and this is what turns Phase 8 from a growing problem into a fixed one. Then the
results archive (16.6% of traffic, typed by hand today), the main pages (61%), the newsletter
mirror, documents, membership forms, and the kit section **re-scoped before it is built**.

`noindex` across the subdomain until cutover, or two copies of the same content split the
club's search results.

---

## Phase 8 — move the member payments

*Sketch.*

⚠️ **The one part that asks anything of members.** ~103 people, each personally
re-establishing a payment, because Squarespace Payments mandates cannot be transferred.

**A communications exercise measured in months.** The longest part of the programme and the
only part that cannot be sped up by working harder.

**Gates, in order:** data-protection advice; treasurer-controlled payment arrangements; and
**decide card or Direct Debit before anybody is asked to move** — worth about £250/yr, and
deciding late means asking 103 people twice.

**Starts during Phase 7, not after it.** It needs the payment page, not the finished website.

---

## Phase 9 — decommission Squarespace

*Sketch.* **Phase 2 already unblocked this** — Cloudflare is authoritative, so the apex
cutover is a record change rather than a migration.

**One coordinated moment**, because Squarespace 301-redirects every secondary domain to its
primary, so the old site cannot live at `old.` while it still serves `www`. Decide first where
the old site goes — `old.<apex>`, or simply its built-in `*.squarespace.com` address, which
needs no DNS at all.

Then point the apex and `www` at the new site, tidy the SPF record, remove `noindex`, redirect
`new.` → apex, and walk every old address for 404s.

**Confirm five things before cancelling:** the site is rebuilt and serving the apex; every URL
resolves; the member fund has moved; every document, newsletter and image is held by the club;
and the treasurer can reconcile.

**Then cancel — before 21 March 2027.**

---

## What it costs when this is done

| | Per year |
| --- | --- |
| Today | **£735** |
| After Phase 9 | **£427** |
| With Direct Debit as well | **£177** |

**The money was never the point.** The larger return is the [manual
work](../foundations/problem-statement.md#3-volunteers-are-doing-work-the-system-should-do)
this removes.
