# Architecture decision records

Short documents capturing a decision, the context that forced it, and the consequences
we accepted. They exist so the next volunteer can find out *why* without asking anyone —
see [P6](../principles.md#p6--boring-by-default) and
[P12](../principles.md#p12--documentation-is-part-of-done).

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-hosting-platform.md) | Hosting platform — Cloudflare, Vercel, or split | **Proposed — blocking** |
| [0003](0003-nextjs-and-typescript.md) | Next.js and TypeScript | Accepted |
| [0004](0004-postgres-on-supabase.md) | PostgreSQL on Supabase | Accepted |
| [0005](0005-dns-at-fasthosts.md) | DNS stays at Fasthosts | Accepted |
| [0006](0006-repository-shape.md) | Repository shape — one repo or several | **Proposed — blocking** |
| [0007](0007-stripe-for-payments.md) | Stripe for payments | Proposed |
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
