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
| [Problem statement](docs/foundations/problem-statement.md) | **Why this is happening at all** |
| [Current state](docs/foundations/current-state.md) | What exists today, as fact. The baseline any option has to beat |
| [Target state](docs/foundations/target-state.md) | **What the club has when this is finished** |
| [Requirements](docs/foundations/requirements.md) | The capabilities the platform must provide, and what bounds how |
| [Options](docs/solutions/options.md) | The solution space per capability, and the criteria to judge by |
| [Platform options](docs/solutions/platform-options.md) | **Named candidates, priced** — Vercel, Cloudflare, Netlify, AWS, VPS — with a recommendation |
| [DNS and domain](docs/solutions/dns-and-domain.md) | Whether to move off Fasthosts, what it risks, and the cutover runbook |
| [Nightingale Nightmare first](docs/delivery/nn-first-delivery.md) | **What gets built first**, and what it forces to be decided |
| [Priorities](docs/delivery/priorities.md) | The two fixed dates, and everything else in dependency order |
| [Decision log](docs/decisions/decision-log.md) | Where choices get recorded — and how they get re-opened |

Supporting material:

| | |
| --- | --- |
| [Timing app review](docs/reference/timing-app-review.md) | How the club's existing race-timing system works, read from source |
| [Platform proposal v8](docs/reference/platform-proposal-v8.md) | The July 2026 board proposal, transcribed |
| [Glossary](docs/foundations/glossary.md) | Domain vocabulary — an *event* is one running of one race in one year |

## The shape of the problem

The club has one genuinely valuable asset: a **race-timing system that works**. It timed
Pass the Buck 2026 end to end — marshals capturing on their phones, offline-tolerant, live
leaderboard, published results. Everything else is about building around it.

Four things need to change:

- The **website** costs £204 a year, sits on the middle tier only because that is what
  permits payments, cannot be versioned or rolled back, and cannot reach the timing data —
  so results are typed out by hand.
- **Volunteers do the joining-up**: WhatsApp requests checked against membership by hand,
  joiners and leavers processed manually, entries imported from CSV, newsletters mirrored
  from Mailchimp. This is the largest cost and it appears on no invoice.
- **Four systems are reachable by one person each**, and the two volunteers cannot cover for
  one another.
- **Nightingale Nightmare** has no online presence at all.

Two constraints shape every answer: **two volunteers with day jobs build and maintain all of
it**, so boring and easy-to-leave beats optimal; and **everything is defined as code**, so
that ownership is shared, changes are reviewable and reversible, and a third person can pick
it up.

## Two fixed dates

Everything else is ordered by dependency rather than by calendar.

1. **Nightingale Nightmare sign-ups live — two weeks.**
2. **Off the current website platform before it renews — April.**

See [priorities](docs/delivery/priorities.md).

## Working here

Documentation only for now. Every change by pull request; documentation ships with the
change it describes; markdown wraps at roughly 90 characters.

Use the [glossary](docs/foundations/glossary.md)'s words exactly — an "event" is one running
of one race in one year, a "race" is the recurring thing, and a "team" is the unit of entry
even when it holds one runner. Getting this wrong in a schema is expensive.

## Licence

Not yet decided.
