# ADR-0010 — Delegate DNS to Cloudflare; registrar stays Fasthosts

- **Status:** Accepted
- **Date:** 2026-08-05
- **Owner:** Platform volunteer
- **Supersedes:** [ADR-0005](0005-dns-at-fasthosts.md)
- **Blocks:** every club-domain hostname served by a Worker — Nightingale Nightmare, the rebuilt website, the ported timing app

## Context

[ADR-0002](0002-hosting-platform.md) settles Cloudflare as the platform's host.
ADR-0005 assumed authoritative DNS could stay at Fasthosts and only the records would
change. Checking that assumption against Cloudflare's documentation shows it does not
hold:

- **A Workers Custom Domain requires an active Cloudflare zone.** You cannot point
  `nightingale-nightmare.southvillerunningclub.co.uk` at a Worker while Fasthosts is
  authoritative for the zone.
- **Cloudflare's partial (CNAME) setup** — the mechanism for proxying individual
  hostnames while keeping nameservers elsewhere — **is Business/Enterprise only.** Not
  available to a running club.

So delegation is a hard prerequisite, and it is the *first* dependency in the entire
programme rather than a late step.

The important second observation: **delegating DNS is not migrating the website.** If
every existing record is replicated into Cloudflare exactly as it stands, Squarespace
continues to serve the site and club email continues to flow. Nothing user-visible
changes. The two have been conflated as "the apex migration"; they are separate events
that should sit months apart.

## Decision

**The domain stays registered at Fasthosts. The nameservers move to Cloudflare, early,
as a standalone change with no site cutover attached.**

Two distinct events, deliberately separated:

| | Event | When | Reversibility |
| --- | --- | --- | --- |
| 1 | **Delegation** — nameservers Fasthosts → Cloudflare, records replicated 1:1 | Early. Blocks everything else. | Slow — an NS change back, propagating over 24–48 h |
| 2 | **Apex origin cutover** — apex/`www` records repointed from Squarespace to our Worker | Late, once the rebuilt site is proven | Fast — a record change inside Cloudflare, seconds, TTL ours |

The risky event is the *first* one, and it is risky because of **email**, not the
website.

### Delegation procedure

1. Export the complete zone from Fasthosts. Every record, including `MX`, `SPF`, `DKIM`,
   `DMARC`, every `TXT`, and Squarespace's verification records.
2. Audit it against what is actually in use. An unnoticed `MX` or `TXT` is how club email
   silently stops.
3. Lower TTLs at Fasthosts to 300 s at least 48 hours ahead.
4. Create the zone in Cloudflare under a **club-owned account** with more than one
   administrator, and import every record.
5. Set every record **DNS-only (grey cloud)** initially. Squarespace records in
   particular: `verify.squarespace.com` **must** stay DNS-only, or Squarespace cannot
   verify the domain and the live site breaks.
6. Verify by querying Cloudflare's nameservers directly, before delegating. Compare
   record-for-record against the Fasthosts export.
7. Change the nameservers at Fasthosts.
8. Watch for 72 hours. Send and receive club email deliberately. Do not treat silence as
   success.

Only after this does any Worker custom domain get attached.

### Records after delegation

| Hostname | Points at | When |
| --- | --- | --- |
| apex + `www` | Squarespace (unchanged) | Until the apex cutover |
| `nightingale-nightmare.` | NN Worker | After delegation |
| `beta.` (noindex) | Rebuilt site Worker | During the rebuild |
| `timing.` (or similar) | Timing Worker | After the timing port |
| apex + `www` | Site Worker | **At the apex cutover** |

This is what lets the old and new sites run side by side, and it is why every new surface
gets its own hostname rather than waiting for the apex.

## Consequences

- Cloudflare becomes authoritative for club email routing as well as the website. The
  blast radius of a DNS mistake is now larger than the website, and the audit step is
  not optional.
- The apex cutover becomes cheap and fast to reverse, because by then we control the
  records and their TTLs. Risk moves out of the late, visible step into the early, quiet
  one — which is the right direction.
- The Cloudflare account is now critical club infrastructure. It must be club-owned with
  more than one administrator, alongside the Fasthosts account
  ([R1](../risks.md#r1--key-person-dependency)).
- DNS records are documented in this repository — what they are, what they point at, why.
  Still a console-driven change, and still a knowing exception to
  [P1](../principles.md#p1--everything-is-code-nothing-is-clicked); Cloudflare's
  Terraform provider or API would close it later.
- Resend's sending-domain verification records can be added in the same zone once
  delegated, closing the timing app's deferred Slice 6 runbook.
- Choose a quiet weekday morning, well away from any race and from a membership renewal
  cycle. Not the week before Nightingale Nightmare.

## Revisit if

The club moves registrar, or Cloudflare's DNS management proves limiting. Revisit the
console-driven exception once there is a second maintainer to benefit from
infrastructure-as-code.
