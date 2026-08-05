# CLAUDE.md

Guidance for Claude Code and other AI coding agents working in this repository.

## What this is

The Southville Running Club website — replacing a Squarespace site with one the club
owns and controls entirely in code. Part of a wider platform: one database behind three
front doors (this website, the payments/membership surface, and a **live, production,
race-day-critical timing app**).

## Current state — read this before writing anything

**There is no application code yet, and that is deliberate.** The repository is
documentation only. Two decisions block the scaffold:

- [ADR-0002 — hosting platform](docs/adr/0002-hosting-platform.md): Cloudflare, Vercel,
  or split. Undecided.
- [ADR-0006 — repository shape](docs/adr/0006-repository-shape.md): one repository or
  several. Undecided.

**Do not scaffold an application, choose a hosting target, or write migrations until
those land.** Building past them means building twice. If asked to start implementation,
say what is blocked and offer to help resolve the ADR instead.

## Read before working

| Document | Why |
| --- | --- |
| [docs/principles.md](docs/principles.md) | The fourteen rules. Non-negotiable. Read in full. |
| [docs/architecture.md](docs/architecture.md) | The three front doors and the shared database |
| [docs/delivery-and-environments.md](docs/delivery-and-environments.md) | Environments and pipeline |
| [docs/testing-strategy.md](docs/testing-strategy.md) | What blocks a merge |
| [docs/open-questions.md](docs/open-questions.md) | What is undecided — check before assuming |
| [docs/glossary.md](docs/glossary.md) | Domain vocabulary — use these words exactly |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow and definition of done |

## Hard rules

These come from [docs/principles.md](docs/principles.md). Violating one is a defect, not
a style disagreement.

1. **Never write to timing tables.** Events, rosters, crossings and results are the
   timing app's. The website reads them through a least-privilege role. If a change
   appears to need write access, stop and ask.
2. **Never touch the race-day path.** The timing app is proven in production. Website
   work does not reach into it.
3. **No secrets in the repository.** Names and purposes in `.env.example`; values in the
   platform's secret store.
4. **No personal data outside production.** Seed and test data is synthetic and
   generated. Never suggest copying production data anywhere.
5. **No personal data in logs, URLs, analytics or error reports.**
6. **No manual deployment or hand-applied migrations.** The pipeline is the only route.
7. **Nothing merges untested.** Tests run against a containerised PostgreSQL with
   migrations applied from empty — not mocks.
8. **Payment and entrant-data work is gated** on data-protection advice, a
   treasurer-controlled Stripe account, and written refund/entry terms. Agreed at the
   QGM. Do not start it because it looks technically ready.
9. **UTC in storage, `Europe/London` for display.** A race sits on the clocks-change
   weekend; this is a real hazard, not pedantry.
10. **Boring beats clever.** A new dependency, framework or pattern needs an ADR. The
    next maintainer is a volunteer with a day job.

## Conventions

- Branches: `type/short-description`. Commits: conventional (`feat:`, `fix:`, `docs:`,
  `test:`, `chore:`, `ci:`, `refactor:`).
- Every change by pull request; squash merge; `main` always deployable.
- Documentation updates ship in the same pull request as the change.
- Use the [glossary](docs/glossary.md)'s words in code and prose. An "event" is one
  running of one race in one year; a "race" is the recurring thing. Getting this wrong in
  a schema is expensive.
- Markdown wraps at roughly 90 characters. Tables and links may run over.

## When writing documentation here

Plain English, short sentences, no filler. Mark proposed things as proposed and unknown
things as unknown. Cross-link rather than repeat. Do not invent facts, figures or
decisions — if a number is not in
[the proposal](docs/reference/platform-proposal-v8.md) or an ADR, it does not exist.

## When you are unsure

Check [open questions](docs/open-questions.md) first. If it is there, it is unanswered on
purpose — do not resolve it by assumption. Say what is blocked, name the owner, and
proceed with everything that does not depend on the answer.
