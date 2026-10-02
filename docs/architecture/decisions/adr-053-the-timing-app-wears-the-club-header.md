# ADR-053: The timing app wears the club header, and two race-day screens wear a focus header

**Status:** Accepted — **to merge after Nightingale Nightmare on 1 November 2026**
**Date:** 1 October 2026
**Supersedes:** [ADR-048](adr-048-the-club-website-is-its-own-surface.md) **in part** — its
fence around `apps/timing` only. Extends [ADR-052](adr-052-one-club-header-on-the-account-and-admin-pages.md),
which did the same for `/account/*` and `/admin/*`.

## Context

After ADR-052 the timing app was the last place a member could reach with neither the club's
header nor its navigation: a welcome banner in the money pages' words, no bar, and no way back
to the club but the wordmark. Its pages had no section navigation either — a race's entry
list, roster, leaderboard, results and console were reached only through the race's overview
page, and the races list was not linked from the landing page's bar because there was none.

It also runs Nightingale Nightmare. So this lands on a branch now and **merges after
1 November**, outside any race-week freeze.

## Decision

### 1. One of four frames on every page, chosen by a route table

| Frame | Pages |
| --- | --- |
| **`TimingFrame`** — the club header, a "Race timing" bar (Overview · Races), breadcrumbs, the club footer | `/timing`, `/timing/events` |
| **`RaceFrame`** — the club header, the race's own bar (Overview · Live leaderboard · Results · Entry list · Marshals · Race console) with its tab current, breadcrumbs, the footer | a race's overview, leaderboard, results, entry list, marshals, danger zone |
| **`FocusFrame`** — a slim dark header: the screen, the race, and one way out | **the race console** and **the marshal's capture screen** |
| **`ClubFrame`** — the club header and footer, reading nothing | not found (both statuses), the error page |

The root layout draws the document and nothing else, because the frame depends on what only
the page knows — which race, its name, which tab. **`apps/timing/lib/chrome.ts` is the table,
and `tests/unit/chrome.test.ts` reads every `page.tsx` and fails unless it is in the table and
uses the frame named for it**, so a page cannot ship with no header, nor with the club's
navigation on a race-day screen.

### 2. The focus header is on the two screens used mid-race, and nothing else

The race console — start, finish, statuses, anomalies, crossings since ADR-045 — and the
marshal's capture screen are used on a phone, by a marshal at the line or the race director
with the race running. **No club navigation, no section bar, no footer**: one stray tap on
"News" must not take them off the race. The way out goes to the race's overview for whoever
may open it, and to `/timing` — which lists what they may open — for a marshal and for
somebody who only resolves crossings, who would get a 404 at the overview. The live
leaderboard keeps the ordinary header.

### 3. Tabs are filtered, never locked

Every page here needs a session and a permission, so a lock would sit on every tab. A tab is
drawn exactly when `canOpen()` — the table `middleware.ts` enforces — says its door would open,
for the reason ADR-052 gave the account bar: a link to a 404 tells somebody the page exists.
**No "Captures" tab** (a console section) and **no danger-zone tab** (linked from the overview,
deliberately a step away from "Results").

### 4. The not-found page reads nothing

It is what every refusal at the door is rewritten to (ADR-044), so it must stay prerendered.
`ClubFrame` lives in its own module that imports nothing which reads the session; the build
output still lists `/_not-found` as static. A race that does not exist renders the same body
in the same frame, so the 200 and 404 bodies stay identical.

### 5. One piece of data moved

`club.json` moved from `apps/main/src/content/` to `packages/shared/content/`, because the club
footer here needs the meeting place and the legal name. Measured: no change on the club pages.

## Consequences

- **The club header's markup exists three times** — Astro, the `apps/main` Worker, and here.
  The items cannot drift; the tags can, and `club-chrome.spec.ts` compares this one with the
  Astro one in a browser.
- **Every club link here is a plain `<a>`**: Next's `<Link>` would prefix it with `/timing`.
- **Each race page reads the permissions once more**, for its tabs — shared with the page's
  own read by `cache()`, so it is one read per request.
- **`/timing/events/` showing "Not found" was never a trailing-slash defect** and nothing here
  changes it: OpenNext answers the slash form with a 308, and the 404 after it is the door's
  ordinary refusal (`CLAUDE.md`).

## Alternatives considered

- **Route groups, so the layout draws the chrome.** Rejected: the console and the capture
  screen sit under segments the club-framed pages share, the not-found page renders with the
  root layout alone, and the race's name is not known to a layout without a read that some of
  the people on these pages are not permitted to make.
- **Locks on every tab, as the mockup draws them.** Rejected for 404 disclosure.
- **The focus header on the leaderboard too.** Declined: it is a staff board rather than a
  capture screen, and nobody presses anything on it mid-race.

## References

- [ADR-052](adr-052-one-club-header-on-the-account-and-admin-pages.md),
  [ADR-048](adr-048-the-club-website-is-its-own-surface.md),
  [ADR-044](adr-044-a-missing-race-under-timing-answers-200.md),
  [ADR-045](adr-045-race-night-is-one-console.md),
  [ADR-036](adr-036-timing-staff-are-identity-permissions.md)
- `apps/timing/lib/chrome.ts`, `apps/timing/app/chrome/`, `apps/timing/tests/unit/chrome.test.ts`
