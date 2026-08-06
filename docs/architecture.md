# Architecture

> Status: **target state, hosting settled.** Cloudflare is the end target
> ([ADR-0002](adr/0002-hosting-platform.md)) and each service is its own repository and
> its own Worker ([ADR-0006](adr/0006-repository-shape.md)). Sequencing is in the
> [plan of attack](plan-of-attack.md).

## The shape of it

One database, several services, several front doors:

```
        ┌──────────────────────────────────────────┐   ┌──────────────────┐
        │       PostgreSQL — main project           │   │ PostgreSQL — NN  │
        │  events · rosters · crossings · results   │   │  sign-ups        │
        │  members · entries · content              │   │                  │
        └───────────────▲──────────────────────────┘   └────────▲─────────┘
                        │                                       │
      ┌─────────────────┼─────────────────┐                     │  CSV export
      │                 │                 │                     │  on convergence
┌─────┴──────┐  ┌───────┴────────┐  ┌─────┴────────┐  ┌─────────┴────────┐
│Club website│  │ Membership and │  │  Timing app  │  │  Nightingale     │
│ (this repo)│  │ entry payments │  │ (live today) │  │  Nightmare       │
│            │  │                │  │              │  │                  │
│about, news,│  │ join flow, EA  │  │marshal capture│ │ sign-ups → pay → │
│race pages, │  │ check, £2.50   │  │live leaderboard││ timing → photos  │
│results     │  │ fund, entry    │  │anomaly tools, │ │                  │
│archive     │  │ forms          │  │results export │ │                  │
└────────────┘  └────────────────┘  └──────────────┘  └──────────────────┘
   apex+www          Stripe-hosted        timing.              nn.
      │                    │                  │                   │
      └────────────────────┴──────────────────┴───────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
        ┌─────┴─────┐       ┌──────┴──────┐     ┌───────┴───────┐
        │  Stripe   │       │   Resend    │     │   England     │
        │  cards    │       │   email     │     │ Athletics API │
        └───────────┘       └─────────────┘     └───────────────┘
```

Each additional service costs little because the expensive part — the data model and the
proven timing engine — already exists.

## Services

Each is its own repository, its own Cloudflare Worker, its own hostname and its own
release cadence ([ADR-0006](adr/0006-repository-shape.md),
[ADR-0011](adr/0011-nightingale-nightmare-routing.md)).

| Service | Repository | Hostname | Host |
| --- | --- | --- | --- |
| Club website | `admin-src/src-website` | apex + `www` (after cutover) | Cloudflare |
| Nightingale Nightmare | `admin-src/nightingale-nightmare` | `nn.` | Cloudflare |
| Race timing | `src-race-timing` | `timing.` (after port) | Vercel today |
| Payments/membership | — later — | Stripe-hosted first | — |

### Club website (this repository)

About, membership, training sessions, news, and a page per race drawing information and
results directly from the shared database. Predominantly static or statically-rendered;
dynamic only where it must be.

### Race timing app

Next.js 16 app, live in production on Vercel with Supabase. Carried Pass the Buck 2026
end to end. Example output:
<https://src-race-timing.vercel.app/live/pass-the-buck-2026>. **This repository does not
change it** — the website reads the data it produces.

A full read of its architecture, data model and race-night flow is in
[the timing app review](reference/timing-app-review.md). Read that before touching
anything that reads its tables.

### Nightingale Nightmare

A solo mass-start 10 km at Halloween, built as its own service on
`nn.southvillerunningclub.co.uk`. It grows in phases: sign-ups (name and email), then
payments, then timing and results, then photos.

**It starts on its own Supabase project**, so a public sign-up form cannot reach
race-critical data. When it needs results in the permanent archive, entries export to CSV
and import through the timing app's existing roster flow — the same path Full On Sport's
entries take today ([ADR-0012](adr/0012-one-supabase-project-many-services.md)).

### Membership and entries surface (later phases)

The join flow (England Athletics check → payment → welcome email → single-use WhatsApp
link) and, later, race entry forms with Stripe checkout. Phase-gated behind
[P13](principles.md#p13--governance-gates-come-before-the-code-they-enable). The £2.50
member fund moves to Stripe-hosted payment links first, needing no website at all.

## The stack

| Layer | Choice | Status | Record |
| --- | --- | --- | --- |
| Framework | Next.js 16 (React, TypeScript) | Inherited from the timing app | [ADR-0003](adr/0003-nextjs-and-typescript.md) |
| Database | PostgreSQL on Supabase; boundaries follow trust | Accepted | [ADR-0004](adr/0004-postgres-on-supabase.md), [ADR-0012](adr/0012-one-supabase-project-many-services.md) |
| Hosting | **Cloudflare Workers**, via `@opennextjs/cloudflare` | Accepted | [ADR-0002](adr/0002-hosting-platform.md) |
| DNS | Registrar Fasthosts; authoritative nameservers Cloudflare | Accepted | [ADR-0005](adr/0005-dns.md) |
| Repository shape | One repository per service | Accepted | [ADR-0006](adr/0006-repository-shape.md) |
| Payments | Stripe | Proposed, gated | [ADR-0007](adr/0007-stripe-for-payments.md) |
| Transactional email | Resend, from a verified club domain | Proposed | — |
| CI/CD | GitHub Actions | Proposed | [ADR-0008](adr/0008-github-actions-pipeline.md) |
| Local/test environment | Docker Compose + Supabase local stack | Proposed | [ADR-0009](adr/0009-containerised-environments.md) |

## Routing

Every service takes its own hostname, and the apex is left on Squarespace until last.
This is what lets old and new run side by side — see the
[plan of attack](plan-of-attack.md#running-old-and-new-side-by-side).

| Hostname | Serves | From |
| --- | --- | --- |
| apex + `www` | Squarespace, unchanged | today |
| `nn.` | NN Worker | after DNS delegation |
| `beta.` *(noindex)* | Rebuilt site Worker | during the rebuild |
| `timing.` | Timing Worker, parallel to Vercel | after the port |
| apex + `www` | **Site Worker** | at the apex cutover |

## Data ownership boundaries

Two Supabase projects. The main one holds the archive; Nightingale Nightmare starts
isolated ([ADR-0012](adr/0012-one-supabase-project-many-services.md)).

| Data | Project | Written by | Read by the website |
| --- | --- | --- | --- |
| Events, rosters, crossings, results | Main | Timing app | Yes — read-only |
| Race information (dates, distances, course, prices) | Main | Website admin surface *(proposed)* | Yes |
| Site content (news, sessions, pages) | Main | Website | Yes |
| Members, EA verification state | Main | Membership flow | Only aggregate/non-personal |
| Entries and payments | Main | Entry flow / Stripe webhooks | No |
| Nightingale Nightmare sign-ups | **NN's own** | NN service | No |

**The website never writes to timing tables.** Enforced at the database level with
row-level security and a dedicated, least-privilege role for the website
— see [P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not) and
[ADR-0012](adr/0012-one-supabase-project-many-services.md). The negative case is an
integration test, not a convention.

The schema has one home — **the timing app's `supabase/migrations/`**, where the model
was designed and where every migration already lives. Any service needing a schema change
proposes it there ([ADR-0006](adr/0006-repository-shape.md)).

## Current state, for reference

| Thing | Today | Target |
| --- | --- | --- |
| Website | Squarespace, ~£170–£420/yr | This repo on Cloudflare, ~£15–£63/yr |
| Website hosting | Squarespace | Cloudflare Workers |
| DNS | Fasthosts registrar **and** nameservers → Squarespace | Fasthosts registrar, Cloudflare nameservers → our Workers |
| Timing app | Vercel free tier + Supabase free tier | Cloudflare, quiet season, after NN 2026 |
| Nightingale Nightmare | No web presence | Own service on its own subdomain |
| Race entries | Full On Sport (fee added on top, paid by entrants) | Stripe on our site, phase 3 |
| Member fund | Squarespace donation fund, 94 recurring payers | Stripe payment links, phase 2 |
| Results publication | Manual, in the 2025 website format | Automatic from the database |

## Cross-cutting constraints

- **Workers limits are a design constraint.** The free plan caps a Worker at 3 MB
  compressed and 10 ms CPU per request, with 100,000 requests/day; the paid plan
  (~£48/yr) raises these to 10 MB and 5 minutes with no request cap. Server-rendered
  pages are a poor fit for 10 ms. Dependencies are now a hosting cost, which sharpens
  [P6](principles.md#p6--boring-by-default) and
  [P14](principles.md#p14--prefer-deleting-to-adding).
- **Free-tier realities.** Supabase's free tier pauses a project after roughly a week
  of inactivity and has no automated backups. A permanent results archive cannot be
  paused, and with three services on one project this stops being contingency and starts
  looking like a decision — see [Risks](risks.md).
- **Commercial use.** Vercel's free tier prohibits commercial use, which the moment
  entries are taken on our site makes Pro mandatory. Cloudflare's free tier carries no
  such restriction. This is why the club pivoted —
  [ADR-0002](adr/0002-hosting-platform.md).
- **Clocks change.** Nightingale Nightmare sits on or near the clocks-change weekend.
  All timestamps are stored in UTC and rendered in `Europe/London`; the timing app
  already pins this through one tested path (`lib/london-time.ts`) and it is tested
  explicitly against the real race date.
