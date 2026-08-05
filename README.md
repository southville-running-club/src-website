# Southville Running Club — Website Platform

This repository holds the Southville Running Club (SRC) public website: source,
infrastructure definition, database migrations, tests, and deployment pipeline.

The club currently runs <https://www.southvillerunningclub.co.uk/> on Squarespace.
This repository exists to replace that with a site the club builds, owns, hosts and
controls entirely in code.

## Status

**Documentation and planning only.** No application code has been written yet.
The architecture, hosting decision and delivery approach are being settled first —
see [docs/](docs/) — so the site is built once, on its final home.

## Start here

| If you want to know… | Read |
| --- | --- |
| Why this exists and what "done" looks like | [Mission and goals](docs/mission-and-goals.md) |
| The rules everything here must follow | [Foundational principles](docs/principles.md) |
| How the pieces fit together | [Architecture](docs/architecture.md) |
| Environments, pipeline, how code reaches production | [Delivery and environments](docs/delivery-and-environments.md) |
| What we test and what blocks a merge | [Testing strategy](docs/testing-strategy.md) |
| What we're building, in what order | [Roadmap](docs/roadmap.md) |
| What could go wrong | [Risk register](docs/risks.md) |
| What the club still has to decide | [Open questions](docs/open-questions.md) |
| Why a decision was made | [Decision records](docs/adr/) |
| The board proposal this all derives from | [Platform proposal v8](docs/reference/platform-proposal-v8.md) |
| Domain vocabulary | [Glossary](docs/glossary.md) |

Working in this repo — conventions, workflow, definition of done:
[CONTRIBUTING.md](CONTRIBUTING.md). Instructions for AI coding agents:
[CLAUDE.md](CLAUDE.md).

## The wider platform

The website is one of three front doors onto a single club platform, alongside the
race-timing app (already live — it timed Pass the Buck 2026 end to end) and the
payments/membership surface. They are intended to share one PostgreSQL database, so
race information and results published on the website are the same records the timing
app writes. See [Architecture](docs/architecture.md).

## Licence

Not yet decided — see [open questions](docs/open-questions.md).
