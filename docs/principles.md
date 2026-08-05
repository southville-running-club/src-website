# Foundational principles

These are the rules everything in this repository is held to. They are deliberately
few and deliberately blunt. If a change conflicts with one of these, the change is
wrong, or the principle needs an
[architecture decision record](adr/) explaining why it moved.

Each principle states the rule, why it exists here specifically, and what it forbids.

---

## P1 — Everything is code; nothing is clicked

The site, its infrastructure, its database schema, its configuration, its DNS records
and its deployment process are all defined in this repository and changed by a commit.

*Why:* the club is leaving Squarespace precisely because its state lives in someone's
browser session. Recreating that on a different platform gains nothing.

*Forbidden:* configuring production through a web console as the way things are done.
If a setting can only be made in a dashboard, record it in this repo — what it is, why,
and who changed it — and treat that as a gap to close.

---

## P2 — The database is the source of truth for anything that changes

Race dates, race information, results, records, news — these live in PostgreSQL and
the site renders them. Hard-coded content is reserved for things that genuinely do not
change.

*Why:* results must appear automatically and permanently, and the committee must not
need a developer to change a race date. This is the mitigation for the editability
trade-off we accept by leaving Squarespace.

*Forbidden:* pasting a results table into a page template. Re-keying anything the
timing app already knows.

---

## P3 — Results are permanent and append-only

Every running of every race is its own event with its own roster, crossings and
results. Nothing is ever overwritten, and every past year keeps a stable public URL.

*Why:* the archive is one of the two things the club is actually buying here.

*Forbidden:* destructive migrations against historical event data; "just fix it in
prod"; URLs that change shape between years.

---

## P4 — Deployment is a pipeline, never a person

Merging to `main` is the only way code reaches production. The pipeline builds, tests,
migrates and deploys. Humans approve; they do not deploy.

*Why:* one volunteer maintains this. A deployment process that lives in that person's
head is an outage waiting for a holiday.

*Forbidden:* deploying from a laptop. Applying a database migration by hand. Editing
files on the host. Pipeline steps that only work with one person's credentials.

---

## P5 — Nothing merges untested

Every change arrives by pull request, and the pull request must pass the full automated
suite. The suite runs against a **containerised environment** — real PostgreSQL, real
migrations, not mocks standing in for the database.

*Why:* "it worked on my machine" is not a defence anyone will be around to hear.

*Forbidden:* merging red. Skipping tests to unblock a release. Tests that pass because
they assert nothing.

See [Testing strategy](testing-strategy.md).

---

## P6 — Boring by default

Prefer the mainstream, well-documented, widely-known option over the clever one.
Prefer fewer dependencies. Prefer the framework's default way of doing a thing.

*Why:* key-person dependency is the club's top risk. Every unusual choice is a tax on
whoever inherits this, and they are a volunteer with a day job.

*Forbidden:* introducing a new framework, language, or infrastructure primitive without
an ADR. Bespoke abstractions over things the platform already does.

---

## P7 — Race day is safety-critical; the website is not

The website may be redeployed freely. Anything touching timing, live capture or a
roster is held to a different standard: a change freeze around events, a full manual
race-simulation pass before it matters, and never a hosting migration near a race.

*Why:* the timing system is proven in production in front of a live race. Proven is an
asset that a careless change spends.

*Forbidden:* website work that reaches into the timing app's race-day path. Shared code
changes shipped during a race week without the simulation pass.

---

## P8 — Personal data is a liability, not an asset

Collect the minimum fields the race and the categories actually need. Retain to a
written policy. Never log personal data. Never copy production personal data into a
test or development environment — seed with synthetic data.

*Why:* entrant and member data means names, dates of birth, EA numbers and emergency
contacts held under the club's own responsibility. Data-protection advice is a
prerequisite to collecting it, not a follow-up.

*Forbidden:* production data dumps on laptops. Personal data in URLs, logs, analytics or
error reports. Fields collected "in case we need them".

---

## P9 — Secrets never enter the repository

API keys, database credentials and tokens live in the hosting platform's secret store
and are injected at build or run time. The repository contains their names and the
process for rotating them, never their values.

*Forbidden:* `.env` files with real values committed. Secrets in CI logs. Sharing a
production credential to unblock someone.

---

## P10 — Every change is reversible

Deployments roll back. Migrations are written so the previous release still runs
against the new schema (expand, migrate, contract). Backups exist and are restored on
purpose at least once, not just configured.

*Why:* the recovery path is the only part of an incident you get to design in advance.

*Forbidden:* single-step destructive migrations. A release whose only rollback plan is
"roll forward quickly".

---

## P11 — Built for a phone, in a field, on bad signal

Runners, marshals and members reach this on mobile data at a race venue. Pages are
static or cached wherever possible, payloads are small, and the site works without
JavaScript for anything that is just reading information.

Accessibility is part of this, not a separate concern: semantic HTML, real contrast,
keyboard navigation, WCAG 2.2 AA as the target.

---

## P12 — Documentation is part of "done"

A change that alters how the system is run, deployed, tested or reasoned about updates
its documentation in the same pull request. Decisions with consequences get an ADR.

*Why:* see P6. The runbook and these documents are the handover.

---

## P13 — Governance gates come before the code they enable

Certain work does not begin until a club-level prerequisite is in place. These are hard
gates, agreed at the QGM, not sequencing preferences:

- **No payment work** before data-protection advice is taken and a club Stripe account
  exists under treasurer oversight, with a written refund policy and entry terms.
- **No Squarespace cancellation** before the treasurer confirms the member-fund income
  has fully moved.
- **No hosting migration** for the timing app close to an event.

---

## P14 — Prefer deleting to adding

The smallest system that meets the goal is the one most likely to still be running in
five years. Before adding a page, a dependency, a service or a feature, check whether
removing something achieves the same end.
