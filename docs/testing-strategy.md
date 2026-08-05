# Testing strategy

The promise: **a green pipeline means the change is safe to ship.** Everything here
exists to make that sentence true rather than aspirational.

Governing principles: [P5](principles.md#p5--nothing-merges-untested),
[P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not),
[P8](principles.md#p8--personal-data-is-a-liability-not-an-asset).

---

## Layers

### 1. Static analysis

Type checking (strict), linting, formatting, and dependency vulnerability scanning.
Cheap, runs first, fails fast.

### 2. Unit tests

Pure logic in isolation: category and age-band assignment, pace and time formatting,
result ordering and tie-breaking, price calculation, date/timezone handling.

Fast (whole layer under ~30 seconds), no I/O, no database.

### 3. Integration tests — against a real database

Run against **PostgreSQL in a container**, migrated from empty on every run and seeded
with synthetic fixtures.

Covers: queries and views, row-level security policies (including the negative case —
that the website role *cannot* write to timing tables), migration correctness,
constraints, and the data access layer.

This is the layer that earns the "containerised test environment" requirement. Mocking
the database here would mean testing our idea of PostgreSQL rather than PostgreSQL.

### 4. Contract tests — external services

Stripe, Resend and the England Athletics licence-check API are tested against recorded
contracts and provider sandboxes, never against live production services in CI.

Every external call has an explicit failure test: what the site does when EA is down,
when a Stripe webhook arrives twice, when email delivery fails. Idempotency of webhook
handling is tested, not assumed.

### 5. End-to-end tests

Real browser (Playwright) against a fully built application in the containerised
environment. Journeys, not clicks:

- Find a race, read its details, find last year's results.
- Navigate the archive across multiple years; permanent URLs resolve.
- Membership and entry journeys, as those phases land.
- Mobile viewport and slow-network conditions
  ([P11](principles.md#p11--built-for-a-phone-in-a-field-on-bad-signal)).

### 6. Accessibility

Automated axe checks on every page in CI, WCAG 2.2 AA as the standard, plus keyboard
navigation assertions on the primary journeys. Automated checks catch perhaps half of
real accessibility problems, so a manual pass is part of the launch checklist.

### 7. Performance and resilience

Lighthouse budgets enforced in CI (page weight, Largest Contentful Paint, Cumulative
Layout Shift). Results pages tested against realistic volumes — a full field, not three
rows of fixture data.

### 8. Manual race simulation — the gate automation cannot replace

Before anything touching the shared platform's timing path reaches production, and
**always** before a hosting migration:

- Multiple marshal devices capturing simultaneously.
- Deliberate connectivity loss and recovery, verifying the offline queue drains
  correctly with no duplicated or lost crossings.
- Anomaly resolution, DNS/DNF/DQ handling, walk-in bibs.
- Live leaderboard under concurrent public load.
- A run against the **real race date**, especially where a clocks change is involved.

This is a checklist executed by a human, recorded in the pull request, and signed off by
the race director. It is the reason
[P7](principles.md#p7--race-day-is-safety-critical-the-website-is-not) exists.

---

## Test data

- **Always synthetic.** Generated fixtures, never a copy of production. Real entrant
  and member data does not leave production —
  [P8](principles.md#p8--personal-data-is-a-liability-not-an-asset).
- Fixtures cover the awkward cases on purpose: duplicate names, missing dates of birth,
  a runner in two teams, DNS/DNF/DQ, a crossing recorded twice, a clocks-change race, a
  field large enough to be slow.
- Fixtures live in this repository and are versioned with the schema.

---

## What blocks a merge

| Check | Blocks |
| --- | --- |
| Lint, format, type check | Yes |
| Unit tests | Yes |
| Integration tests (containerised DB, migrations from empty) | Yes |
| Contract tests | Yes |
| End-to-end tests | Yes |
| Accessibility (axe, WCAG 2.2 AA) | Yes |
| Performance budgets | Yes |
| Race-simulation checklist | Yes, for shared-platform/timing-path changes only |
| Coverage below threshold | Yes |

There is no "skip CI". A test that is wrong gets fixed or deleted with a reason in the
pull request; it does not get disabled quietly.

---

## Coverage

Coverage thresholds are a floor, not a target. The number that matters is whether the
awkward cases in the fixtures are exercised. A high percentage on tests that assert
nothing is worse than an honest gap, because it hides the gap.

Where a bug reaches production, the fix begins with a failing test that reproduces it.

---

## Flakiness

A flaky test is a broken test. It is quarantined immediately with an issue attached and
fixed or deleted within one week. Nothing corrodes
[P5](principles.md#p5--nothing-merges-untested) faster than a suite people have learned
to re-run.
