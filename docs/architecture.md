# Architecture

> Status: **target state, under decision.** The hosting choice
> ([ADR-0002](adr/0002-hosting-platform.md)) and the repository shape
> ([ADR-0006](adr/0006-repository-shape.md)) are open. Everything below marked
> *proposed* changes if those land differently.

## The shape of it

One codebase, one database, three front doors:

```
                    ┌──────────────────────────────────────────┐
                    │            PostgreSQL (Supabase)          │
                    │  events · rosters · crossings · results   │
                    │  members · entries · content              │
                    └───────────────▲──────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────┴────────┐        ┌─────────┴────────┐        ┌─────────┴────────┐
│  Club website  │        │ Membership and   │        │   Timing app     │
│  (this repo)   │        │ entry payments   │        │  (live today)    │
│                │        │                  │        │                  │
│ about, news,   │        │ join flow, EA    │        │ marshal capture, │
│ sessions,      │        │ check, £2.50     │        │ live leaderboard │
│ race pages,    │        │ fund, entry      │        │ anomaly tools,   │
│ results archive│        │ forms            │        │ results export   │
└────────────────┘        └──────────────────┘        └──────────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
        ┌─────┴─────┐        ┌──────┴──────┐      ┌───────┴───────┐
        │  Stripe   │        │   Resend    │      │ England       │
        │  cards    │        │   email     │      │ Athletics API │
        └───────────┘        └─────────────┘      └───────────────┘
```

Each additional front door costs little because the expensive part — the data model and
the proven timing engine — already exists.

## Components

### Club website (this repository)

Public-facing site: about, membership, training sessions, news, and a page per race
drawing information and results directly from the shared database. Predominantly static
or statically-rendered; dynamic only where it must be.

### Race timing app (existing, separate today)

Next.js app, live in production, currently hosted on Vercel with a Supabase database.
Example of current output: <https://src-race-timing.vercel.app/live/pass-the-buck-2026>.
Carried Pass the Buck 2026 end to end. **This repository does not change it.** The
website reads the data it produces.

### Membership and entries surface (later phases)

The join flow (England Athletics check → payment → welcome email → single-use WhatsApp
link) and, later, race entry forms with Stripe checkout. Phase-gated behind
[P13](principles.md#p13--governance-gates-come-before-the-code-they-enable).

## The stack

| Layer | Choice | Status | Record |
| --- | --- | --- | --- |
| Framework | Next.js (React, TypeScript) | Inherited from the timing app | [ADR-0003](adr/0003-nextjs-and-typescript.md) |
| Database | PostgreSQL on Supabase | Accepted | [ADR-0004](adr/0004-postgres-on-supabase.md) |
| Hosting | Cloudflare (leaning) vs Vercel | **Open** | [ADR-0002](adr/0002-hosting-platform.md) |
| DNS | Fasthosts (registrar), records repointed to our hosting | Accepted | [ADR-0005](adr/0005-dns-at-fasthosts.md) |
| Payments | Stripe | Proposed, gated | [ADR-0007](adr/0007-stripe-for-payments.md) |
| Transactional email | Resend, from a verified club domain | Proposed | — |
| CI/CD | GitHub Actions | Proposed | [ADR-0008](adr/0008-github-actions-pipeline.md) |
| Local/test environment | Docker Compose + Supabase local stack | Proposed | [ADR-0009](adr/0009-containerised-environments.md) |

## Data ownership boundaries

The database is shared, but not everything is everyone's to write:

| Data | Written by | Read by the website |
| --- | --- | --- |
| Events, rosters, crossings, results | Timing app | Yes — read-only |
| Race information (dates, distances, course, prices) | Website admin surface *(proposed)* | Yes |
| Site content (news, sessions, pages) | Website | Yes |
| Members, EA verification state | Membership flow | Only aggregate/non-personal |
| Entries and payments | Entry flow / Stripe webhooks | No |

**The website never writes to timing tables.** Enforced at the database level with
row-level security and a dedicated, least-privilege role for the website
— see [P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not).

## Current state, for reference

| Thing | Today | Target |
| --- | --- | --- |
| Website | Squarespace, ~£170–£420/yr | This repo, ~£15/yr domain |
| Website hosting | Squarespace | Cloudflare (leaning) |
| DNS | Fasthosts registrar → Squarespace | Fasthosts registrar → our hosting |
| Timing app | Vercel free tier + Supabase free tier | Unchanged in this phase |
| Race entries | Full On Sport (fee added on top, paid by entrants) | Stripe on our site, phase 3 |
| Member fund | Squarespace donation fund, 94 recurring payers | Stripe payment links, phase 2 |
| Results publication | Manual, in the 2025 website format | Automatic from the database |

## Cross-cutting constraints

- **Free-tier realities.** Supabase's free tier pauses a project after roughly a week
  of inactivity and has no automated backups. A permanent results archive cannot be
  paused. Public website traffic may keep it warm; if not, Supabase Pro (~£240/yr) is
  pre-approved contingency. This is an operational risk, not a design assumption —
  see [Risks](risks.md).
- **Commercial use.** Vercel's free tier prohibits commercial use, which the moment
  entries are taken on our site makes Pro mandatory. Cloudflare's free tier carries no
  such restriction. This is the crux of [ADR-0002](adr/0002-hosting-platform.md).
- **Clocks change.** Nightingale Nightmare sits on or near the clocks-change weekend.
  All timestamps are stored in UTC and rendered in `Europe/London`; this is tested
  explicitly against the real race date.
