# ADR-0010 — Leaving Squarespace

- **Status:** Accepted
- **Date:** 2026-08-06
- **Owner:** Committee, on the platform volunteer's recommendation

## Context

The club's website has run on Squarespace since before the platform existed. It works, the
committee is used to it, and replacing it is months of volunteer effort. That is the case
for staying, and it is not a weak one.

Four things weigh against it.

**Cost.** Squarespace is the club's only recurring website bill, at roughly £170–£420 a
year depending on plan. A site the club builds and hosts itself costs the domain
registration plus, at most, a small hosting tier — roughly £15–£63 a year. Over a decade
that is the difference between a few thousand pounds and a few hundred.

**Ownership.** A Squarespace site's state lives inside a browser session. It cannot be
versioned, reviewed, diffed, tested or rolled back. Nobody can answer "what changed, when,
and why" except from memory. Every principle in [principles.md](../principles.md) —
everything is code, every change reversible, nothing merges untested — is unreachable
while the site is configured by clicking.

**Results.** The club already owns a race timing platform that timed Pass the Buck 2026
end to end and holds every crossing and result in a PostgreSQL database. Squarespace cannot
reach that data. So results are published by hand, in a format copied from the previous
year, and the archive is only as complete as somebody's diligence. A site the club builds
reads the same database the timing app writes, which makes the permanent public archive —
every race, every year, at a stable URL — a property of the system rather than a chore.

**Data.** Membership payments and, later, race entries mean holding personal data. Under
the club's own platform that data sits somewhere the club controls, with a stated retention
policy. Under Squarespace it sits wherever Squarespace puts it, on terms the club does not
set.

## Decision

**The club builds and hosts its own website, and Squarespace is cancelled.**

Sequencing is set by two conditions, not by readiness of the code:

1. The £2.50 member fund is re-homed **before the apex cutover**, not merely before
   cancellation — the fund page lives on the Squarespace site and the cutover removes it.
2. Squarespace stays paid until the new site has run for a week, so the rollback target
   still exists.

## Consequences

### The cost we are accepting

**Committee members lose visual editing.** On Squarespace, anyone on the committee can
change a page by clicking it. On our own site they cannot, at least at first. This is the
single real loss in the exchange and it should not be minimised — it is the thing most
likely to make somebody regret this decision eighteen months from now.

Three mitigations, in order of importance:

- **Anything that changes comes from the database**, not from a template. Race dates,
  race information, results, records — these update themselves
  ([P2](../principles.md#p2--the-database-is-the-source-of-truth-for-anything-that-changes)).
- **Genuinely static content is kept minimal**, so there is little left to want to edit.
- **An editing interface is added only if the committee proves it needs one** — measured
  against what they actually ask to change after launch, not guessed at beforehand
  ([P14](../principles.md#p14--prefer-deleting-to-adding)). Building a CMS nobody asked for
  is how volunteer projects die.

### What we gain

- The website's every byte, deployment and configuration is defined in a repository and
  changed by a reviewed commit.
- Race pages and the results archive publish themselves from the timing app's database.
- The recurring bill falls to roughly the domain registration.
- Personal data sits under club control with a written retention policy.

### What it costs to get there

- Months of volunteer effort, concentrated in one person
  ([R1](../risks.md#r1--key-person-dependency)).
- A DNS migration with a live site and live email attached
  ([ADR-0005](0005-dns.md)).
- A content inventory and a redirect for every existing URL, or the club loses its search
  results and every printed link.
- The club takes on hosting, backups and uptime, which Squarespace previously absorbed.

## Revisit if

The editing trade-off proves worse in practice than on paper and a lightweight editing
surface does not fix it; or the volunteer effort required stops being available, in which
case a managed platform is a legitimate answer and this record should not be read as
forbidding it.
