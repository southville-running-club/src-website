# Southville Running Club — Platform

Documentation for the Southville Running Club platform: what the club needs, what its
options are, and what order things happen in.

**Requirements first, solutions second.** Nothing here names a vendor as a decision. The
club is replacing a website it does not control and adding sign-ups, payments and a
permanent results archive around a race-timing system it already owns and runs. Getting the
requirements written down before the products means a choice can be re-opened later without
starting the thinking over.

**There is no application code yet, and no decisions have been recorded.** That is
deliberate.

## Start here

| Read this | For |
| --- | --- |
| [Current state](docs/current-state.md) | What exists today, as fact. The baseline any option has to beat |
| [Requirements](docs/requirements.md) | The eleven capabilities the platform must provide, and what bounds how |
| [Options](docs/options.md) | The solution space per capability, and the criteria to judge by |
| [Priorities](docs/priorities.md) | The two fixed dates, and everything else in dependency order |
| [Decision log](docs/decision-log.md) | Where choices get recorded — and how they get re-opened |

Supporting material:

| | |
| --- | --- |
| [Timing app review](docs/reference/timing-app-review.md) | How the club's existing race-timing system works, read from source |
| [Platform proposal v8](docs/reference/platform-proposal-v8.md) | The July 2026 board proposal, transcribed |
| [Glossary](docs/glossary.md) | Domain vocabulary — an *event* is one running of one race in one year |

## The shape of the problem

The club has one genuinely valuable asset: a **race-timing system that works**. It timed
Pass the Buck 2026 end to end — marshals capturing on their phones, offline-tolerant, live
leaderboard, published results. Everything else is about building around it.

Four things need to change:

- The **website** is on a platform the club cannot version, review or roll back, and which
  cannot reach the timing data. So results are published by hand.
- **Race entries** go through a third party at 8–10%, and arrive as a CSV to import.
- **Membership payments** run through the website platform, costing the club £340–£450 a
  year in fees on £2,820 of income.
- **Nightingale Nightmare** has no online presence at all.

And one constraint shapes every answer: **one volunteer builds and maintains all of it.**
That makes boring, well-documented and easy-to-leave worth more than optimal.

## Two fixed dates

Everything else is ordered by dependency rather than by calendar.

1. **Nightingale Nightmare sign-ups live — two weeks.**
2. **Off the current website platform before it renews — April.**

See [priorities](docs/priorities.md).

## Working here

Documentation only for now. Every change by pull request; documentation ships with the
change it describes; markdown wraps at roughly 90 characters.

Use the [glossary](docs/glossary.md)'s words exactly — an "event" is one running of one race
in one year, a "race" is the recurring thing, and a "team" is the unit of entry even when it
holds one runner. Getting this wrong in a schema is expensive.

## Licence

Not yet decided.
