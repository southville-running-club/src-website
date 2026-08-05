# ADR-0011 — Nightingale Nightmare on a subdomain

- **Status:** Accepted
- **Date:** 2026-08-05
- **Owner:** Platform volunteer
- **Depends on:** [ADR-0010](0010-dns-delegation-to-cloudflare.md)

## Context

Nightingale Nightmare is a separate race — a solo mass-start 10 km at Halloween — and is
being built as its own service in `admin-src/nightingale-nightmare`. It launches with
sign-ups and entrant data; payments, timing and results follow.

It needs a public address on the club domain. Two shapes were considered, and the brief
named both: "either a cname or a sub-domain (preferably a sub-domain, eg
`<apex>.co.uk/nightingale-nightmare`)" — where the stated preference is a subdomain but
the worked example is a **path**. They are materially different pieces of work, so this
record settles it.

The hard constraint: **the apex is still served by Squarespace** and will be for months.

## Options

### A — Subdomain: `nightingale-nightmare.southvillerunningclub.co.uk`

A new DNS record on a hostname Squarespace has never used, attached to the Worker as a
Custom Domain. **Touches nothing that is currently live.**

*For:* zero risk to the running site; independent deploys; own TLS; trivially rolled back
by deleting one record; works the moment the zone is delegated.
*Against:* longer to say; SEO authority is not shared with the apex; if auth cookies are
ever shared across the platform they must be scoped to the parent domain deliberately.

### B — Path on the apex: `southvillerunningclub.co.uk/nightingale-nightmare`

A Cloudflare Worker route intercepting that path prefix while everything else falls
through to the origin.

*For:* one domain, better SEO consolidation, matches the brief's example.
*Against:* while Squarespace serves the apex, this requires **proxying the apex through
Cloudflare (orange cloud)** so the route can fire. Squarespace's own guidance is to run
DNS-only, and `verify.squarespace.com` must stay DNS-only regardless. Proxying a live
Squarespace site to add a path is a real risk to the club's only current web presence, in
exchange for a nicer URL.

### C — Subdomain now, path alias later

Ship A. Once the apex is served by our own Worker, add the path as an alias if it is still
wanted.

## Decision

**Option C. `nightingale-nightmare.southvillerunningclub.co.uk` is the launch address and
the canonical one.**

The path form is not foreclosed. After the apex cutover, `/nightingale-nightmare` can
redirect to the subdomain, or — if SEO consolidation matters more by then — become
canonical with the subdomain redirecting to it. That is a cheap change once we own the
apex, and an expensive risk before.

**Interim address before delegation:** the service is developed and demoed on its
`*.workers.dev` address, which needs no DNS at all. So the build is not blocked by
[ADR-0010](0010-dns-delegation-to-cloudflare.md) — only the public launch is.

The same pattern applies to every other service: **its own hostname, its own Worker.**
The timing app takes a subdomain when it ports, and the rebuilt site takes `beta.` until
it takes the apex.

## Consequences

- Nightingale Nightmare can launch without the apex being touched, and without the
  Squarespace site being put at any risk.
- Rollback for the launch is deleting one DNS record.
- The club has to publicise a longer URL for the 2026 race. A printed QR code and a link
  from the existing Squarespace site cover this in practice.
- If Supabase Auth sessions are ever shared between services, cookie domain scoping
  becomes an explicit decision rather than an accident of same-origin. Given the timing
  app's auth model is staff-only and NN's sign-ups are public, they should **not** share
  a session by default.
- Search engines will index the subdomain. If the path form later becomes canonical,
  redirects must preserve the sign-up URLs people have bookmarked or printed.
- `beta.` must be `noindex` throughout the website rebuild, or the club competes with
  itself in search results.

## Revisit if

The apex cutover completes and the committee wants one domain for everything; or a future
service genuinely needs to share a session with another, which would make same-origin
worth its cost.
