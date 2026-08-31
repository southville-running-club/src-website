# Southville Running Club — Platform

Documentation for the Southville Running Club platform: what the club needs, what its
options are, and what order things happen in.

**Requirements first, solutions second.** Nothing here names a vendor as a decision. The
club is replacing a website it does not control and adding sign-ups, payments and a
permanent results archive around a race-timing system it already owns and runs. Getting
the requirements written down before the products means a choice can be re-opened later
without starting the thinking over.

**The first application code landed on 8 August 2026**, as a skeleton in
[`platform/`](platform/) that proved the hosting, database and pipeline path end to end.
It does considerably more than that now: race entries, Stripe payments, member accounts, an
admin back office and a transactional-email outbox are all built and live. Eight decisions
are recorded in the [decision log](docs/decisions/decision-log.md), each ratified by the
committee.

## Start here

| Read this | For |
| --- | --- |
| [`docs/README.md`](docs/README.md) | **An index of everything below** — which documents are live and which are historical |
| [Problem statement](docs/foundations/problem-statement.md) | **Why this is happening at all** |
| [Current state](docs/foundations/current-state.md) | What exists today, as fact. The baseline any option has to beat |
| [Target state](docs/foundations/target-state.md) | **What the club has when this is finished** |
| [Requirements](docs/foundations/requirements.md) | The capabilities the platform must provide, and what bounds how |
| [Options](docs/solutions/options.md) | The solution space per capability, and the criteria to judge by |
| [Platform options](docs/solutions/platform-options.md) | **Named candidates, priced** — Vercel, Cloudflare, Netlify, AWS, VPS — with a recommendation |
| [DNS and domain](docs/solutions/dns-and-domain.md) | Whether to move off Fasthosts, what it risks, and the cutover runbook |
| [Cloudflare or Netlify](docs/solutions/cloudflare-vs-netlify.md) | **Settled — Cloudflare**, 8 August 2026. Kept for the apex/DNS-move reasoning, not as an open question |
| [Email](docs/solutions/email.md) | Getting off forwarding-to-Gmail, and how the platform sends mail — ~£30/yr |
| [Architecture principles](docs/architecture/principles.md) | **The as-is — read before writing code.** The rules that are not under discussion |
| [Architecture investigations](docs/architecture/investigations/) | Options and trade-offs: [repositories](docs/architecture/investigations/repositories.md), [networking](docs/architecture/investigations/networking.md), [database](docs/architecture/investigations/database.md), [deployment](docs/architecture/investigations/deployment.md), [local development](docs/architecture/investigations/local-development.md) |
| [What is happening, in ten steps](docs/delivery/overview.md) | **Plain summary for the committee** — safe to forward, no technical knowledge assumed |
| [The phases](docs/delivery/phases.md) | **Start here for shape** — NN, the timing rebuild, the nameservers, the new site, payments, decommission |
| [The plan](docs/delivery/plan.md) | **What happens when** — 72 numbered steps, labelled by phase |
| [Move the DNS first](docs/delivery/dns-first.md) | **The plan** — take the risky change now, while nothing depends on it |
| [Runbooks](docs/delivery/runbooks/) | **Step by step** — setting up [GitHub](docs/delivery/runbooks/github-setup.md), [Supabase](docs/delivery/runbooks/supabase-setup.md) and [Cloudflare](docs/delivery/runbooks/cloudflare-setup.md), [adding a hostname](docs/delivery/runbooks/adding-a-hostname.md), and [the nameserver move](docs/delivery/runbooks/nameserver-move.md) ✅ |
| [Nightingale Nightmare first](docs/delivery/nn-first-delivery.md) | **What gets built first**, and what it forces to be decided |
| [Priorities](docs/delivery/priorities.md) | The two fixed dates, and everything else in dependency order |
| [Decision log](docs/decisions/decision-log.md) | **Eight decisions taken** — Cloudflare, Supabase free, mailboxes bought, parallel running, member accounts, the £18/£20 entry fees, no England Athletics numbers, a runner's phone number |
| [Architecture decisions](docs/architecture/decisions/) | Technical decisions the build takes, and [which log a choice belongs in](docs/architecture/decisions/README.md#two-decision-homes-and-which-one-a-choice-belongs-in) |
| [The platform](platform/README.md) | **The code.** How to run it, and what will bite you |

Supporting material:

| | |
| --- | --- |
| [Timing app review](docs/reference/timing-app-review.md) | How the club's existing race-timing system works, read from source |
| [Platform proposal v8](docs/reference/platform-proposal-v8.md) | The July 2026 board proposal, transcribed |
| [Cloudflare WAF rules](docs/reference/cloudflare-waf-rules.md) | Every rate-limiting rule considered, and which one is actually live |
| [Design](docs/design/) | The approved visual designs, and the rule for reading a mockup safely |
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
- **Four systems are reachable by one person each**, and the two volunteers cannot cover
  for one another.
- ~~**Nightingale Nightmare** has no online presence at all.~~ **Built.** Seven pages, an
  entry form taking real payments, a privacy notice, and an admin back office to run it
  from — see [the phases](docs/delivery/phases.md).

Two constraints shape every answer: **two volunteers with day jobs build and maintain all
of it**, so boring and easy-to-leave beats optimal; and **everything is defined as code**,
so that ownership is shared, changes are reviewable and reversible, and a third person can
pick it up.

## Two fixed dates

Everything else is ordered by dependency rather than by calendar.

1. ~~**Nightingale Nightmare sign-ups live — two weeks.**~~ **Done.** The entry window opens
   1 September 2026, the day after this line was last corrected.
2. **Off the current website platform before it renews — 21 March 2027.**

See [priorities](docs/delivery/priorities.md).

## Working here

```bash
./dev up      # the whole site on http://localhost:8787
./dev check   # rebuild the database, then lint, types, unit and database tests
./dev test    # the Worker and acceptance tests, then stop everything
./dev e2e     # one Playwright spec on one engine — the fast loop; add --linux before pushing layout changes
./dev down    # stop the Workers and the database
```

Documentation lives at the root; the application code lives in
[`platform/`](platform/README.md), which is where `npm` works — **not the root, which has
no `package.json` on purpose.** `./dev` knows the difference so you do not have to.

[`CLAUDE.md`](CLAUDE.md) is the short version of how to work here, for a person or an
agent: the non-negotiables, the stop-and-ask triggers, and the traps that have already cost
somebody an evening.

Every change by pull request; documentation ships with the change it describes; markdown
wraps at roughly 90 characters.

Use the [glossary](docs/foundations/glossary.md)'s words exactly — an "event" is one
running of one race in one year, a "race" is the recurring thing, and a "team" is the unit
of entry even when it holds one runner. Getting this wrong in a schema is expensive.

## Licence

Not yet decided.
