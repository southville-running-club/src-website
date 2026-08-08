# ADR-004 — No staging environment

**Accepted**, 8 August 2026.

| | |
| --- | --- |
| **Requirement** | [Money](../../foundations/requirements.md#money), [people](../../foundations/requirements.md#people), [C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) |
| **Options** | [local development](../investigations/local-development.md), [database](../investigations/database.md#what-the-free-tier-actually-allows) |

## Context

The obvious shape is local → staging → production. Three facts make the middle one a poor
deal here:

**A free Supabase project pauses after one week of inactivity.** Staging is idle by
definition, so it would be paused whenever somebody actually reached for it.

**The two-project free limit is per person, not per club** — it applies across every
organisation where a volunteer is Owner or Administrator. A staging project consumes an
allowance a volunteer's unrelated side project may already be using.

**[ADR-003](adr-003-local-development-and-pipeline.md) already covers what staging is
usually for.** The full stack runs locally against fabricated data, and the pipeline
reproduces it. Cloudflare gives a free preview deployment per pull request on top.

A staging environment holding fabricated data adds a third place to keep in sync. A staging
environment holding *real* data would be a
[C10](../../foundations/requirements.md#c10--hold-personal-data-lawfully) problem, which is
the reason not to want one at all.

## Decision

**No staging Supabase project and no staging hostname.**

| Environment | Where |
| --- | --- |
| **Local** | `localhost` — full stack, fabricated data |
| **Preview** | Automatic Cloudflare preview deployment per pull request, on `*.pages.dev` / `*.workers.dev`, pointing at **local or nothing**, never production data |
| **Production** | The real thing |

**Sharing a work in progress** uses a preview URL, or a Cloudflare Quick Tunnel on
`trycloudflare.com`. **Never the club domain.**

## Consequences

- **Production is the first place real DNS, TLS and mail behaviour is observed.** That is the
  real cost of this decision, and it is why the
  [throwaway-domain question](../investigations/local-development.md#what-cannot-be-tested-without-a-real-domain)
  stays open: mail authentication and the nameserver move have **no local equivalent**, and
  they are the one change in the programme that cannot be quickly un-broken.
- **Nothing user-facing may be announced on `*.pages.dev`, `*.workers.dev` or
  `trycloudflare.com`.** An announced address has to keep working; none of those promise to.
- The spare free-tier project slot stays unspent, which keeps an option open rather than
  consuming it for something that would be paused anyway.
- **Migrations reach production without a rehearsal against production-like data.** Mitigated
  by [expand–migrate–contract](../../foundations/glossary.md#platform-and-delivery) and by
  migrations having to apply from zero in CI — not eliminated.

## Exit cost

**Near zero.** A staging project is a `supabase projects create` and a hostname. Nothing in
this decision forecloses adding one; it declines to add one *now*.

## Revisit when

- **A DNS or mail rehearsal is needed** — that is the strongest trigger, and the answer is
  more likely a cheap second domain than a Supabase project.
- A migration goes wrong in production in a way a staging rehearsal would have caught.
- The club is on Supabase Pro for another reason, at which point branching gives per-pull-request
  databases and this decision is superseded rather than reversed.
- Real data volume starts to matter — 500 MB, or a results archive large enough that query
  behaviour differs from seeded data.
