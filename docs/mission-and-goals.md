# Mission and goals

## Mission

Give Southville Running Club a website it owns outright — one that publishes every
race, every result and every year permanently, costs the club almost nothing to run,
and can be handed to the next volunteer without a handover meeting.

## Why now

Three things converged:

1. **The platform already exists.** Pass the Buck 2026 was timed start to finish on
   software the club built and owns — marshal capture on phones, live leaderboard,
   published results. The expensive part is done and has survived a live race.
2. **Squarespace is the club's only recurring website bill**, at roughly £170–£420 a
   year, and it is also where the £2.50 member fund currently sits (94 recurring
   payers, ~£2,820 a year).
3. **Race results and race information should come from one place.** Today the
   website and the timing system are separate worlds, and results are copied between
   them by hand.

## Goals

**G1 — Own the website outright.** Replace Squarespace with a site whose every
byte, deployment and configuration is defined in this repository.

**G2 — Publish results automatically and permanently.** A page per race, per year,
drawing from the same database the timing app writes to. Nothing overwritten, no
manual copying, no year lost.

**G3 — Cost the club near-nothing.** Target ongoing club-borne website cost of
~£15–£63 a year (domain plus optional paid hosting tier), down from £170–£420.

**G4 — Deploy programmatically, every time.** No human ever pushes code to
production by hand. The pipeline is the only route in.

**G5 — Be safe to change.** A full automated test suite and a containerised test
environment that matches production closely enough that "it passed CI" means
something.

**G6 — Survive its author.** Boring, mainstream technology and current documentation,
so a second volunteer can pick this up cold. This is the single biggest risk the club
carries and the design answers to it first.

**G7 — Keep committee content editable in practice.** Squarespace lets any committee
member edit a page visually; our site initially does not. The answer is to make
frequently-changing content (race dates, details, results, news) database-driven so it
updates itself, and to keep genuinely static content minimal.

**G8 — Handle personal data properly.** Entrant and member data is a liability before
it is an asset. Collect the minimum, retain it to a written policy, and take
data-protection advice before the first record is stored.

## Non-goals (for now)

- **Not** rebuilding the timing app. It is proven in production; the website consumes
  its data and does not touch its race-day path.
- **Not** taking payments in phase 1. Membership payments move to Stripe-hosted pages
  first; on-site card entry comes later and only once governance prerequisites are met.
- **Not** building a general-purpose CMS. If the committee needs visual editing later,
  add the narrowest thing that works.
- **Not** migrating the timing app's hosting as part of the website build. That is a
  separate, scheduled, fully re-tested project that never happens near a race.

## What success looks like

By the end of the website workstream:

- `southvillerunningclub.co.uk` serves a site built from this repository, deployed by
  pipeline, with DNS pointing at our own hosting.
- Every past Pass the Buck and Nightingale Nightmare result is reachable at a stable,
  permanent URL.
- The Squarespace subscription is cancelled — **after** the member fund has been
  re-homed and the treasurer has confirmed the income moved.
- A new contributor can clone the repo, run `docker compose up`, and have a working
  local site with a seeded database inside ten minutes.
- The club's ongoing website bill is the domain registration.
