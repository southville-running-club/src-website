# ADR-0002 — Hosting platform: Cloudflare, Vercel, or split

- **Status:** **Accepted — Cloudflare**
- **Date:** 2026-08-05 (proposed), 2026-08-05 (accepted)
- **Owner:** Board, on the platform volunteer's recommendation
- **Unblocks:** the website build, and the [plan of attack](../plan-of-attack.md)

## Context

The platform lives on Vercel today, on the free tier, and the timing app has been proven
there in front of a live race.

**Vercel's free tier prohibits commercial use.** The moment race entries are taken on our
own site, the Pro plan becomes mandatory (~£190/yr). Cloudflare's free tier carries no
such restriction: 100,000 dynamic requests a day, unlimited static pages, and no
bandwidth charges on any plan, with a paid tier at roughly a quarter of Vercel's price
for headroom.

The member fund forces this on neither platform — Stripe hosts its payment pages. The
question is triggered only by the race-entries build, where the form and payment flow
genuinely run on our site.

| | Vercel (today) | Cloudflare |
| --- | --- | --- |
| Free tier allows payments | No — Pro required | Yes |
| Fixed cost with payments | ~£190/yr | £0 (or ~£48 paid tier) |
| Bandwidth charges | Above included allowance | None, on any plan |
| Next.js support | First-party, zero-friction | Official adapter (OpenNext); mature but a translation layer |
| Migration effort | None | One project + full race-simulation testing |
| Race-day risk | None — proven in production | Real until re-proven; never migrate near an event |

Break-even on entries, given Full On Sport's fee is paid by entrants and the pot the club
creates is ~70p per paid transaction:

| Paid transactions/yr | Gross pot | Net on Vercel (~£190 fixed) | Net on Cloudflare (£0–£48) |
| --- | --- | --- | --- |
| 150 | ~£105 | ~£85 behind | ~£57–£105 ahead |
| 230 (illustrative current) | ~£160 | ~£30 behind | ~£112–£160 ahead |
| 350 | ~£245 | ~£55 ahead | ~£197–£245 ahead |

At realistic volumes the Vercel route does not pay for itself on entries; Cloudflare is
ahead from the first entry.

## Options

### A — Stay on Vercel, pay Pro when entries start
Simplest, dearest. Zero migration risk. Adds ~£145/yr to the delivered club-borne cost.

### B — Move everything to Cloudflare before the entries build
Cheapest. One well-scheduled migration, in the quiet season, with the full manual
race-simulation pass before any event depends on it. Accepts OpenNext as a translation
layer with occasional rough edges, and accepts that a production-proven system becomes
unproven until re-proven.

### C — Split: website and entries on Cloudflare, timing app untouched on Vercel free
Captures the saving without touching the proven race-day system. Costs: operating two
platforms, and it rests on a reading of Vercel's terms — that the timing app remains
non-commercial while entries are taken elsewhere — which is worth confirming in writing
([Q3](../open-questions.md)).

## Decision

**Option B — Cloudflare is the platform's end target.** Everything the club builds from
here targets Cloudflare Workers: the Nightingale Nightmare sign-up service, the rebuilt
club website, and eventually the timing app.

The deciding reason is commercial: Vercel's free tier prohibits commercial use, and the
club intends to take money on its own site. Option C (split) was rejected because it
rests on an unconfirmed reading of Vercel's terms ([Q3](../open-questions.md)) and
commits a one-volunteer club to operating two platforms permanently.

**The timing app is the exception in timing, not in direction.** It moves last, in the
quiet season, with a full race-simulation pass, and never near an event
([P7](../principles.md#p7--race-day-is-safety-critical-the-website-is-not)). Until then
it stays on Vercel's free tier, where it is proven. Sequencing is in the
[plan of attack](../plan-of-attack.md).

## Verified before accepting

- **Next.js 16 is supported by `@opennextjs/cloudflare`** — all minor and patch versions.
  The timing app is on 16.2.4, so no framework downgrade is implied. Next.js 16.2 also
  introduced a stable Adapter API built with Cloudflare as a named partner.
- **Middleware is supported**; *Node* middleware is not. The timing app's `proxy.ts` is
  standard edge middleware, so this does not bite.
- **`nodejs_compat` covers the one Node built-in in use** (`randomInt` from
  `node:crypto`).

## Consequences

- **Workers Paid (~£48/yr) should be budgeted, not hoped against.** The free plan caps a
  Worker at 3 MB compressed and **10 ms CPU per request**; the paid plan raises these to
  10 MB and 5 minutes, and removes the 100,000 requests/day cap. A server-rendered
  Next.js app is a poor fit for a 10 ms CPU budget. Static and lightly-dynamic pages may
  well stay inside the free tier; the timing app under race-night load should not be
  asked to. This is still an order of magnitude below Vercel Pro's ~£190/yr.
- **Bundle size becomes a design constraint.** Dependencies are now a hosting cost, which
  reinforces [P6](../principles.md#p6--boring-by-default) and
  [P14](../principles.md#p14--prefer-deleting-to-adding).
- **The zone must move to Cloudflare** before any club-domain hostname can be served by a
  Worker — see [ADR-0010](0010-dns-delegation-to-cloudflare.md). This is the first
  dependency in the whole programme and it was not obvious from the proposal.
- Each service deploys as its own Worker with its own custom domain, which suits the
  microservice shape settled in [ADR-0006](0006-repository-shape.md).
- The timing app carries migration risk until re-proven on Cloudflare
  ([R4](../risks.md#r4--timing-app-hosting-migration)). Vercel stays deployable in parallel as the
  rollback until it is.
- Vercel remains in the picture, on the free tier, for as long as the timing app has not
  moved. The club operates two platforms *temporarily* — a transition state with an end
  date, not option C.

## Revisit if

Cloudflare's Next.js support regresses; the Workers Paid plan stops covering club
traffic; or OpenNext's translation layer produces a race-day defect that Vercel would not
have had.
