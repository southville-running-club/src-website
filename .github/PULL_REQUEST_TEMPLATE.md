# What and why

<!-- What changes, and why it is needed. Link the issue. -->

## How to check it

<!-- What a reviewer should do. Preview URL, steps, what "correct" looks like. -->

## What I did not test

<!-- Be honest. This section is more useful than the one above. -->

---

## Checklist

- [ ] Tests cover this, including at least one awkward case
- [ ] Database changes are tested against the containerised PostgreSQL, migrations
      applied from empty
- [ ] Accessible — semantic HTML, keyboard navigable, WCAG 2.2 AA
- [ ] Works on a phone on a slow connection
- [ ] No personal data in logs, URLs, analytics or error reports
- [ ] No secrets added to the repository
- [ ] Documentation updated in this pull request
- [ ] An ADR is included, or this change does not need one

## Database migrations

- [ ] Not applicable
- [ ] Expand–migrate–contract: the currently deployed version still runs against the new
      schema
- [ ] Rollback path stated below
- [ ] Does not modify historical event data (or has explicit sign-off, linked below)

## Shared platform / timing path

- [ ] Does not touch the timing path
- [ ] Touches it — race-simulation checklist completed and recorded below, and signed off
      by the race director
- [ ] Not inside a change freeze (72 hours before a race until results are signed off)

## Payments or personal data

- [ ] Not applicable
- [ ] Governance gates confirmed in place: data-protection advice taken, club Stripe
      account under treasurer oversight, refund policy and entry terms agreed
