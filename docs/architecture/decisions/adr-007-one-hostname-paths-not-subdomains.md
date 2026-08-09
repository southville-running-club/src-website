# ADR-007 — One hostname, told apart by path

**Accepted**, 9 August 2026. **Supersedes the hostname decision in
[ADR-006](adr-006-apps-main-and-hostnames-as-code.md)**; the rest of ADR-006 —
`apps/main`, hostnames declared in code, the `platform/` layout — stands unchanged.

| | |
| --- | --- |
| **Requirement** | [Continuity](../../foundations/requirements.md#continuity), [people](../../foundations/requirements.md#people), [everything as code](../../foundations/requirements.md#everything-is-defined-as-code) |

## Context

ADR-006 gave each surface its own subdomain — `nn.<apex>` for the race, `timing.<apex>` for
the timing platform — with the club website eventually taking `new.<apex>` and then the
apex.

Three subdomains means three cutovers. It also means that when the website is finally
built, deciding where the race and the timing app live *inside* it is a live question again,
with two live URLs already published against the old answer.

**The alternative is to pick the end state now and build straight into it.**

## Decision

**One Cloudflare hostname, and the surfaces are paths beneath it.**

```
new.southvillerunningclub.co.uk/            the club website        apps/main
new.southvillerunningclub.co.uk/nn          Nightingale Nightmare   apps/main
new.southvillerunningclub.co.uk/timing      race timing             apps/timing
```

**`nn.<apex>` and `timing.<apex>` are not created.**

At the Squarespace cutover the hostname changes and **nothing else does** — `<apex>/nn` and
`<apex>/timing` are the same paths on a different name. The website can be built up around
the race and the timing platform without either of them moving, which is the property the
club actually wants.

### How two Workers share one hostname

This is the part that had to be checked rather than assumed. It works, and it is a
documented Cloudflare arrangement rather than a trick:

| | |
| --- | --- |
| `new.<apex>` | A **Custom Domain** on `src-main-production`. Cloudflare creates the DNS record and issues the certificate |
| `new.<apex>/timing/*` | A **Route** on `src-timing-production` |

Cloudflare matches *"the most specific route pattern wins"*, and a route carrying a path
beats a Custom Domain on the same hostname. Their own documentation describes exactly this
shape: *"A Worker running on a Custom Domain is treated as an origin. Any Workers running
on routes before your Custom Domain can optionally call the Worker registered on your
Custom Domain."*

So `/timing/*` is dispatched at the edge and **never reaches `apps/main`**.

### What it costs

Recorded honestly, because two of these are real and were argued against before being
accepted.

| | |
| --- | --- |
| **`basePath: '/timing'`** | Next.js prefixes every route, link and asset. One setting, but it touches everything the timing app serves |
| **Service worker scope** | Becomes `/timing/`, and anyone with the app already installed holds a registration for the old scope. **This is the offline capture queue** — the part of the port to rehearse rather than assume |
| **Shared cookie scope** | Auth cookies on `new.<apex>` are visible to the website as well as the timing app, where a subdomain would have host-scoped them |
| **Shared blast radius** | One record, one certificate, one route table. A website mistake that breaks the hostname takes timing with it. Mitigated by the [race-week change freeze](../../foundations/glossary.md#platform-and-delivery), which already freezes the whole repository |
| **Route greediness** | Any future website page under `/timing/…` silently routes to the timing Worker. Asserted against in `apps/main/tests/unit/routing.test.ts`, which checks `/timings/` and `/timing-results/` stay with the website |

**Against those: one hostname, one certificate, one cutover, and an end state that needs no
migration.** For a platform two volunteers maintain, not having to move published URLs twice
is worth more than host-scoped cookies.

### Local development is the same shape

`localhost:8787` serves the whole site, `/timing` included. `apps/main` forwards `/timing/*`
to the timing Worker when `TIMING_ORIGIN` is set — which it is locally and is not in
production.

That is a stand-in for Cloudflare's router, not a difference in behaviour, and it is what
lets the local site be **the public shape rather than an approximation of it.** The absence
of `TIMING_ORIGIN` in `env.production` is load-bearing: if it were ever set there, the
platform would be proxying itself through an extra hop.

## Consequences

- **The `/nn` layout was already right.** ADR-006 put the pages at `/nn/` in the build so
  the apex could serve them one day; that is now simply the address.
- **`apps/main`'s hostname routing is deleted**, not kept for hosts nobody uses. One
  function remains — whether a path belongs to the timing Worker.
- **The public NN sign-up URL is `new.<apex>/nn`** for the 22 August deadline, becoming
  `<apex>/nn` at the cutover. `new.` in a race URL is a wart for a few months and a
  redirect afterwards.
- **`<apex>/nn` forwarding is Squarespace's problem** until the cutover, and deliberately
  outside this repository.
- **The timing port now carries `basePath`.** It is one line, and the service worker scope
  is the thing to rehearse.

## Exit cost

**Low, and lower than the alternative it replaces.** Giving the timing app its own
subdomain later is a `wrangler.jsonc` route change, removing `basePath`, and a redirect from
`/timing/*`. The reverse — collapsing published subdomains into paths — means moving URLs
people have already bookmarked.

That asymmetry is the argument: **the reversible choice is the one that keeps everything on
one name.**

## Revisit when

- The timing platform's race-day risk profile makes a shared hostname uncomfortable — most
  likely if the website starts changing during race season.
- Auth cookie scope becomes a real concern rather than a theoretical one, e.g. when the
  website takes payments or holds member sessions.
- A third surface arrives that does not fit under one origin.
