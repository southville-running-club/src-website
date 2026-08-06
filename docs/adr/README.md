# Architecture decision records

Short documents capturing a decision, the context that forced it, and the consequences we
accepted. They exist so the next volunteer can find out *why* without asking anyone — see
[P6](../principles.md#p6--boring-by-default) and
[P12](../principles.md#p12--documentation-is-part-of-done).

Numbers are chronological and mean nothing on their own. The grouping below is how to read
them.

## Why we are doing this

Start here. These two explain the programme; everything else is implementation.

| # | Decision | Status |
| --- | --- | --- |
| [0010](0010-leaving-squarespace.md) | Leaving Squarespace | Accepted |
| [0002](0002-hosting-platform.md) | Cloudflare rather than Vercel | Accepted |

## Platform

| # | Decision | Status |
| --- | --- | --- |
| [0003](0003-nextjs-and-typescript.md) | Next.js and TypeScript | Accepted |
| [0004](0004-postgres-on-supabase.md) | PostgreSQL on Supabase | Accepted |
| [0005](0005-dns.md) | DNS — registrar at Fasthosts, nameservers at Cloudflare | Accepted |
| [0013](0013-delegation-approach.md) | How and when to delegate DNS | **Proposed — decision open** |
| [0006](0006-repository-shape.md) | Repository shape — one repository per service | Accepted |
| [0011](0011-nightingale-nightmare-routing.md) | Nightingale Nightmare on a subdomain | Accepted |
| [0012](0012-one-supabase-project-many-services.md) | Database boundaries between services | Accepted |
| [0007](0007-stripe-for-payments.md) | Stripe for payments | Proposed, gated |

## Delivery

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0008](0008-github-actions-pipeline.md) | GitHub Actions for the pipeline | Proposed |
| [0009](0009-containerised-environments.md) | Containerised local and CI environments | Proposed |

## Statuses

- **Proposed** — written, not yet agreed.
- **Accepted** — in force. Build to it.
- **Superseded by NNNN** — replaced; kept for the history.
- **Deprecated** — no longer applies and nothing replaced it.

## Writing one

Copy [`template.md`](template.md), take the next number, keep it short. One decision per
record. Never edit an accepted record to change the decision — write a new one that
supersedes it, and update the old one's status. The record of a decision that turned out
badly is more useful than no record.

Anything that introduces a framework, language, hosting dependency or infrastructure
primitive needs one ([P6](../principles.md#p6--boring-by-default)).
