# ADR-0002 — Cloudflare rather than Vercel

- **Status:** Accepted
- **Date:** 2026-08-06
- **Owner:** Board, on the platform volunteer's recommendation

## Context

The timing platform runs on Vercel today, on the free tier, and Pass the Buck 2026 was
timed there in front of a live race. Vercel is the company behind Next.js, the framework
the platform is built on, so hosting there is zero-friction. There is a real case for
staying.

**Vercel's free tier prohibits commercial use.** The club intends to take money on its own
site — first Nightingale Nightmare entries, later Pass the Buck. From that moment the Pro
plan is not optional, at roughly £190 a year.

**Cloudflare's free tier carries no such restriction**: 100,000 dynamic requests a day,
unlimited static pages, and no bandwidth charges on any plan, with a paid tier at about a
quarter of Vercel's price for headroom.

That is the decision in one paragraph. The rest is detail.

| | Vercel | Cloudflare |
| --- | --- | --- |
| Free tier allows payments | **No — Pro required** | **Yes** |
| Fixed cost once taking payments | ~£190/yr | £0, or ~£48/yr for the paid tier |
| Bandwidth charges | Above included allowance | None, on any plan |
| Next.js support | First-party, zero-friction | Official adapter (OpenNext); mature, but a translation layer |
| Migration effort | None | One project, plus full race-simulation testing |
| Race-day risk | None — proven in production | Real until re-proven |

### The money settles it

Because Full On Sport's fee is added on top of the entry price and paid by runners, the
club gains on entries only by holding prices level and keeping the difference — a blended
~70p per paid transaction.

| Paid transactions/yr | Gross pot | Net on Vercel (~£190 fixed) | Net on Cloudflare (£0–£48) |
| --- | --- | --- | --- |
| 150 | ~£105 | ~£85 behind | ~£57–£105 ahead |
| 230 (illustrative current) | ~£160 | ~£30 behind | ~£112–£160 ahead |
| 350 | ~£245 | ~£55 ahead | ~£197–£245 ahead |

At realistic volumes the Vercel route never repays itself on entries. Cloudflare is ahead
from the first one.

## Decision

**Cloudflare Workers is the platform's host.** Everything built from here targets it: the
Nightingale Nightmare service, the rebuilt club website, and eventually the timing app.

**The timing app is an exception in timing, not in direction.** It moves last, in the quiet
season, with a full race-simulation pass, and never near an event
([P7](../principles.md#p7--race-day-is-safety-critical-the-website-is-not)). Until then it
stays on Vercel's free tier where it is proven. Sequencing is in the
[plan of attack](../plan-of-attack.md).

### Checked before committing

- **`@opennextjs/cloudflare` supports all minor and patch versions of Next.js 16.** The
  timing app is on 16.2.4, so no framework downgrade is implied. Next.js 16.2 also
  introduced a stable Adapter API built with Cloudflare as a named partner.
- **Middleware is supported.** *Node* middleware is not — the timing app's `proxy.ts` is
  standard edge middleware, so this does not bite.
- **`nodejs_compat` covers the one Node built-in in use**, `randomInt` from `node:crypto`.

### Which Cloudflare plan

**A club-owned account on the free plan, plus Workers Paid (~£48/yr) when needed.**

**Workers Paid should be budgeted, not hoped against.** The free plan caps a Worker at 3 MB
compressed with **10 ms CPU per request** and 100,000 requests a day; the paid plan raises
these to 10 MB and 5 minutes with no request cap. A server-rendered Next.js app is a poor
fit for a 10 ms CPU budget. Static and lightly-dynamic pages may well stay free; the timing
app under race-night load should not be asked to. Real figures get measured on the
Nightingale Nightmare service before the timing app is committed.

**The Business plan was considered and rejected.** At around £1,900 a year it is eight to
ten times the club's entire projected platform budget of £180–230. It was raised because
its partial (CNAME) DNS setup appears to avoid moving nameservers — but Workers Custom
Domains *and* Workers Routes both require a full Cloudflare zone, so it would not achieve
that. It buys nothing this club needs. See [ADR-0005](0005-dns.md).

**Account ownership is free and non-negotiable**: club-owned, more than one administrator
([R1](../risks.md#r1--key-person-dependency)).

## Consequences

- **Bundle size becomes a design constraint.** Dependencies are now a hosting cost, which
  sharpens [P6](../principles.md#p6--boring-by-default) and
  [P14](../principles.md#p14--prefer-deleting-to-adding). CI should measure bundle size and
  fail on a budget breach.
- **The zone must move to Cloudflare** before any club hostname can be served by a Worker.
  This is the first dependency in the entire programme —
  [ADR-0005](0005-dns.md), [ADR-0013](0013-delegation-approach.md).
- Each service deploys as its own Worker with its own custom domain, which suits the shape
  settled in [ADR-0006](0006-repository-shape.md).
- The timing app carries migration risk until re-proven
  ([R4](../risks.md#r4--timing-app-hosting-migration)). Vercel stays deployable in parallel
  as the rollback until a race has run on Cloudflare.
- Vercel remains in the picture, free, until the timing app moves. The club operates two
  platforms **temporarily** — a transition with an end date, not a permanent split.
- OpenNext is a translation layer with occasional rough edges. The website rebuild goes
  first partly so those are learned on a content site rather than on race-critical
  software.

## Revisit if

Cloudflare's Next.js support regresses; Workers Paid stops covering club traffic; or
OpenNext produces a race-day defect that Vercel would not have had.
