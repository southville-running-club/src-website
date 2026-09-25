# ADR-049: What membership costs lives in the database

**Status:** Accepted
**Date:** 21 September 2026
**Supersedes:** nothing

## Context

The club settled its membership fees: **£4 a year** for club membership, and **£27** for club
membership with an England Athletics racing licence — of which **£23** is England Athletics'
own registration fee and is not the club's money.

Those two figures are quoted on three pages: the home page, `/membership/`, and the new-member
application form at `/membership/join/`. Until this change the first two read them from
`apps/main/src/content/membership.json`, which is a file in a repository, which means changing
a price is a pull request, a review by two volunteers with day jobs, and a deploy.

**The club asked for the opposite**, in as many words: that next year, when the prices go up,
it should be possible to write one SQL statement and have every page change. That is not an
optimisation — the fee rise happens once a year, on a schedule set by England Athletics rather
than by whoever is free to review a pull request that week, and the two most likely outcomes of
requiring a deploy are that the rise is published late or that one of the three pages is missed.

This repository already answers this question twice. Race entry fees are `entries.fees` and
have never been in markup; the Christmas party's ticket price is `store.ticket_types.price_pence`,
which is why confirming it on 6 September 2026 was an `update` and no deploy. Both of those are
money pages, and both are frozen until after Nightingale Nightmare on 1 November — so this is
the same pattern applied on the club surface rather than an extension of either.

The shape of the club site is what makes it a decision rather than a copy. `apps/main` builds
to static files with `output: 'static'`; a static page cannot read a price when somebody loads
it. The mechanism that already exists for this is the Worker rewriting the served HTML on its
way out — what `/nn/`, `/nn/<year>/` and `/events/<slug>/` do — and using it here means the
club's home page stops being a file that is identical for everybody.

## Decision

**The two membership prices, the England Athletics share and the minimum age live in
`membership.membership_types` and `membership.settings`, and are painted onto the page by the
Worker at request time.**

Four parts:

1. **`membership.membership_state()`** — one `security definer` function with a pinned
   `search_path`, granted to `anon` and `authenticated`, returning only active rows. The anon
   role holds no grant on either table, which is this repository's standing arrangement.
2. **`worker/membership.ts`** resolves that function and paints `[data-membership-*]` onto
   three addresses: `/`, `/membership/` and `/membership/join/`.
3. **`membership.json` no longer holds either figure**, and `membershipSchema` is `.strict()`
   so that re-adding one is refused rather than silently ignored.
4. **The built markup carries `PRICE_TO_BE_CONFIRMED`** where a price will be painted.

### The failure direction is towards the page as shipped

Every failure here paints **nothing**. An error, a timeout, an unparseable answer and an empty
result all produce the same thing: the page says it cannot show what membership costs just now
and links to the club's existing form.

⚠️ **A page that cannot reach the database must never quote a price.** A stale or invented
figure on a page somebody joins from is worse than no figure, because they will act on it. That
is the same direction `/events/<slug>/` takes with a date and `/nn/2026/` takes with the entry
form.

⚠️ **An empty answer is an outage, not a club that sells nothing.** Every row could only be
absent if somebody had deactivated all of them, which is not a state the club has a page for,
and painting "no memberships available" over an unreachable database would be the page
inventing a fact.

### An option nobody can price is an option nobody can choose

The application form's membership radios ship `hidden` **and** `disabled`, and the Worker
removes both together.

⚠️ **`hidden` alone would make the form unsubmittable.** A `required` control that is hidden and
empty makes the browser refuse to submit the form it is in — silently, with a console line
nobody has open and no request on the wire. That took the race entry form down for every
signed-in runner on 31 August 2026 and was found on production by luck, hours before entries
opened. `disabled` is the attribute that does both halves: skipped by constraint validation, and
left out of the submission.

So a membership type the database no longer returns disappears from the form without a deploy,
and cannot be chosen by anybody who reads the page source.

## Consequences

**A fee rise is one statement.**

```sql
update membership.membership_types set price_pence = 500 where code = 'club';
```

Every page changes on the next request. Nothing is deployed, nothing is reviewed, and no page
can be missed because no page restates the figure.

**Withdrawing or adding a membership type is also an `update`**, and it reaches the application
form as well as the two marketing pages — the form's radios are opened per code.

⚠️ **`/` is no longer edge-cacheable, and that is the real cost.** The assets binding serves
`dist/` with a strong `ETag` describing the *file*, and the Worker then rewrites the body — so
a painted response has to be marked uncacheable or a conditional request answers `304` with the
unpainted page. The club's home page therefore joins `/nn/*` in paying one database round trip
per view. The read touches two small tables, carries no personal data, and the Worker already
runs on every request because of `run_worker_first`.

That trade was weighed against two alternatives and both are worse. **Reading the price at build
time** puts the deploy straight back. **Keeping a copy in `membership.json` as a fallback** is a
second source that agrees on the day it is written and stops agreeing the day somebody runs the
statement above, with nothing looking wrong.

**The two prices that are not membership stay in the repository.** Paying 50p for one run is the
Southbank Club's hire cost and £2.50 a month is a subscription rather than membership; neither
is in `membership_types`, neither is sold by the application form, and both still move by
deploy. A page that read two prices from a database and two from a file would be confusing if
the split were arbitrary, and this one is not.

**The minimum age is painted too** — `membership.settings.minimum_age`, 18, the same 18
`entries.events.minimum_age` enforces for the race. Raising it is an `update`.

**`worker/index.ts` gained one branch**, and that file is on the frozen money path. The edit is
an import and a single conditional, both additive, and it is declared in the pull request
description under the money-page freeze. ⚠️ **The path predicate deliberately lives in
`worker/membership.ts` rather than in `routing.ts`**, which every money page resolves through:
adding an export there would be harmless and would still be an edit to that file two weeks
before the race, and it costs nothing to keep the club's route knowledge in the club's module.

## What this does not decide

**It does not decide that the club may take a membership application online.** The form at
`/membership/join/` renders, is validated, and is **linked from nowhere** — not the navigation,
not `/membership/` — because nothing stores an application. `membership.membership_applications`
does not exist, and two things are owed before it can:

1. **The committee's decision** on a table holding eighteen fields of personal data, a date of
   birth and a home address among them, with a retention period. That is a stop-and-ask under
   this repository's own rules and is not a build decision.
2. **Privacy-notice wording** for this collection and for passing a name, date of birth and
   email address to England Athletics. `/privacy/` says nothing about either today.

⚠️ **A form somebody can find and fill in that throws their answers away is worse than no form
at all**, so the absence of every link to it is asserted by a test rather than left to
intention — in `tests/e2e/membership-join.spec.ts` and `tests/worker/membership.test.ts`, both
of which say in their own comments to delete that assertion in the same change that adds the
table, and not before.

**It does not decide how membership is paid for.** No Stripe path exists here. The form's own
words say the Membership Officer will be in touch about paying, which is what the club does
today.

**It does not decide a retention period for anything**, because nothing is retained.
