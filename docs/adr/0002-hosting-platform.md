# ADR-0002 — Hosting platform: Cloudflare, Vercel, or split

- **Status:** **Proposed — blocking**
- **Date:** 2026-08-05
- **Owner:** Board, on the platform volunteer's recommendation
- **Blocks:** All of [Workstream 3](../roadmap.md#workstream-3--the-new-club-website-this-repository). The website must be built once, on its final home.

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

**Not yet made.** The proposal's author leans B or C.

## Consequences (whichever is chosen)

- The website is built once, against the chosen platform's deployment model, adapter
  behaviour and edge/runtime constraints.
- Under B, the timing-app migration is a separate scheduled project with its own
  race-simulation gate, never near an event
  ([P7](../principles.md#p7--race-day-is-safety-critical-the-website-is-not)).
- Under C, the split must be documented explicitly so nobody later assumes a single
  platform, and Q3 must be answered first.
- Under A, the ~£190/yr line goes into the club's budget from the entries phase onward.

## Revisit if

Vercel changes its free-tier commercial-use terms; Cloudflare's Next.js support
regresses; or entry volumes move far enough that the break-even table's conclusion
flips.
