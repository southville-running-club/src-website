# ADR-011 — A race and one running of it are different pages, at different addresses

**Accepted**, 15 August 2026. Extends
[ADR-007](adr-007-one-hostname-paths-not-subdomains.md) by one path segment and changes
nothing it decided.

| | |
| --- | --- |
| **Requirement** | [C17](../../foundations/requirements.md#c17--collect-form-submissions), [people](../../foundations/requirements.md#people) |
| **Supersedes** | No ADR |

## Context

[The glossary](../../foundations/glossary.md) has said since the first week that a **race** is
the recurring thing and an **event** is one running of it in one year. The database learned
that distinction on day one — `entries.events` is a row per running. **The routes never did.**

Every Nightingale Nightmare page lived at `/nn/` and described 2026:

```
/nn/            the race facts, the date, and the entry form
/nn/course/     the course
/nn/race-day/   the schedule, race HQ, the prizes
/nn/spectators/ where to watch
/nn/entry/complete/   where Stripe returns somebody
```

Publishing 2027 from there has exactly two shapes and both are bad. **Overwrite**, and 2026's
race-day plan stops existing the day the committee agrees next year's date — while people are
still looking up what happened. **Add a year underneath later**, and every published link
moves at once: the newsletter, the entry confirmations, whatever a runner bookmarked.

**This is the cheapest this will ever be.** Nothing is indexed — every page carries
`<meta name="robots" content="noindex">` — nothing is merged to `main`, and the only links to
these pages are internal ones that move in the same commit. Once an entry URL is published and
somebody bookmarks it, moving it costs redirects the site has no mechanism for and newsletters
nobody can edit.

## Decision

**The `/nn` prefix stays. One segment is added below it for the year.**

| | |
| --- | --- |
| `/nn/` | The race in general. **Evergreen, and it never names a year** |
| `/nn/course/` | Course and terrain. Evergreen |
| `/nn/privacy/` | The privacy notice. Evergreen |
| `/nn/2026/` | The 2026 running: the date, the entry form, the lot |
| `/nn/2026/race-day/` | The schedule, race HQ, parking, afterwards |
| `/nn/2026/spectators/` | Where to watch |
| `/nn/2026/entry/complete/` | Where Stripe returns somebody who has paid |

**A longer, fully-named prefix was considered and deliberately deferred.**
`/nightingale-nightmare/2026/` is a better address for a race the club wants found, and
choosing it now would move seven pages twice — once here and once at the club-site restructure,
when the whole site's URLs are on the table anyway. One move is cheaper than two.

### How `/nn/` finds the current running, without holding a year

**`entries.events` gained one column, `race_slug`** — the glossary's missing half, put where it
can be queried. `entries.current_entry_state('nn')` returns the **forthcoming** running of that
race, or the **most recent past** one when there is no forthcoming one, and hands back exactly
what `entry_state()` would have returned for it.

The Worker reads that on every request to `/nn/` and paints the links. There is no
`href="/nn/2026/"` anywhere in that page's markup, and there must never be one:

- **Publishing 2027 is a row and that year's content pages.** No edit to `/nn/`, no edit to the
  Worker, no edit to the navigation.
- **A year written into the evergreen page would be wrong quietly.** It would work perfectly
  for a year and then point at a page nobody had noticed was stale. `nn-entry.test.ts` asserts
  that every year-bearing link on `/nn/` is one the Worker painted.

**`/nn/<year>/` is the event `nn-<year>`**, and that convention is the whole of the coupling
between a URL and a database row. It lives in `worker/routing.ts` as two functions that are
inverses of each other and are tested as such — because two halves of one convention in two
places is where a convention drifts, and the symptom would be a Stripe return URL that 404s,
discovered by somebody who had just paid.

### Which pages are evergreen, and why each

**These are judgement calls and the reasoning is the point of recording them.**

| | | |
| --- | --- | --- |
| **Course** | Evergreen | The towpath, Nightingale Valley and Leigh Woods are the route, the terrain is the terrain, and the headphone rule is the race's. The evidence is that the page was drafted from the club's **2023** material and needed no route changes for 2026. **The caveat is real and belongs here:** if a running is ever diverted — flooding on the towpath is entirely plausible — that year's pages carry the diversion and this page keeps the normal route. It is not "the route can never change"; it is "a change belongs to a year" |
| **Spectators** | With the year | Read on the morning, in the same sitting as race day, and **entangled with race-day facts**: it names race HQ, it says prizegiving is there, and it links to the race-day page twice for the start's exact location. A spectator guide that says "prizegiving is at Ashton Park School" is asserting *this year's* HQ. The geography — the North Road gate, Brunel Lock Road, the footbridge — genuinely does not change, but splitting it out would leave two thin pages and a reader with two places to look |
| **Privacy** | Evergreen, **and it stays under `/nn/`** | It is **site-wide in substance**: the controller, the ICO route, the rights and the retention periods are the club's, and nothing in it is 2026-specific — the four undecided values are club decisions, not race ones. **The right home is eventually `/privacy/`**, once the club has a second form to cover. Moving it out of `/nn/` now would be a site-restructure decision taken in a route-reorganisation slice, so it is flagged rather than made |

### The navigation spans two levels, and only year pages get the second

> **Superseded by [ADR-012](adr-012-one-navigation-bar.md), 15 August 2026.** The bar is one
> row of five controls, identical on every page, with the year painted rather than routed
> around. What follows is left as it was accepted — the reasoning it gives for the two levels
> is the reasoning ADR-012 answers.

```
the race       Race · Course                    every Nightingale Nightmare page
the running    2026 · Race day · Spectators     year pages only
```

**An evergreen page shows only the race row.** It cannot know which running is current without
asking, and the two ways to give it one are both worse than the gap: a database call on every
content-page view — a new failure mode on pages that currently have none — or a year written
into a component, which is the thing this record exists to remove.

The cost is one extra tap: from `/nn/course/`, "Race" and then this year. `/nn/` is the first
link in the row on every page, and the front door it leads to carries the painted links.

Still no JavaScript, no dropdown and no hamburger. Two `<ul>`s inside one `<nav>` — two lists
because they are two lists, one landmark because it is one navigation.

## Consequences

**Good**

- 2027 is a row in `entries.events` plus that year's content pages. Nothing that exists moves.
- 2026's race-day plan and spectator guide survive the publication of 2027, at the addresses
  they have always had.
- A Checkout session's return URL names the running it was for, so a payment confirmation can
  never be reported against the wrong race.
- The database's race/event distinction and the site's are the same distinction, spelled the
  same way: `race_slug = 'nn'` and the path prefix `/nn`.

**Costs, and they are real**

- **An evergreen page that cannot reach the database has no link to the current running.** It
  falls back to the interest form and no year links — the page that existed before this slice.
  That is the same failure direction everything else here takes, and it is one fewer door in
  the front door rather than a link to a year nobody confirmed.
- **Content pages are two taps from each other across the levels.** Course to race day goes
  through `/nn/`.
- **Publishing a year means writing its pages**, not only inserting a row. The row is what
  `/nn/` follows; the prose is still prose somebody writes.
- **`/nn/<year>/` ⇒ `nn-<year>` is a convention, not a foreign key.** A running named some
  other way has no page, and the Worker logs it and paints no link rather than guessing.
- **`/nn/` states no date.** It cannot use `race.json`'s, which is 2026's, and painting one
  from `entry_state()`'s `event_date` would mean a **second date formatter** in a repository
  whose whole timezone discipline is that there is exactly one — on the page whose race is run
  the weekend after the clocks change. The date is one tap away, on the running the front door
  links to. **A gap, recorded, not a decision to leave closed**: if a civil-date formatter is
  ever wanted for another reason, this is the second caller for it.

  > **Closed, 15 August 2026, and with no second formatter.** `/nn/`'s year panel states the
  > date. `packages/shared`'s `formatEventDate` composes `toIsoDate` with the existing
  > `formatLondonDate` and one `T00:00:00Z`: **London's offset is never negative**, so an
  > instant at midnight UTC is either `00:00` or `01:00` on the same calendar day in London,
  > and the day survives the conversion for every date in the year. `event-format.test.ts`
  > asserts that across a whole year of them, and on both 2026 transitions by name. The start
  > time is *not* put through a formatter at all — it is civil time as published, and dropping
  > Postgres's seconds is a string operation.
- **`src/content/race.json` is not split in two.** It describes the 2026 running and it always
  has; which of its keys each page may read is a table in `apps/main/README.md` and two tests,
  rather than two files. Splitting it is a content change with its own review, and doing it
  inside a route reorganisation would have put two unrelated diffs in one commit.

**Neutral**

- **No redirects were added, deliberately.** `/nn/race-day/`, `/nn/spectators/` and
  `/nn/entry/complete/` existed only on this branch, only ever carried `noindex`, and were
  linked from nothing outside the repository. `serves.test.ts` asserts they 404. A redirect map
  is a thing somebody has to maintain and later remember to delete, and this site has no
  redirect mechanism to add one to — [ADR-005](adr-005-manual-with-a-reviewable-artefact.md)'s
  argument about machinery nobody asked for applies exactly.
- **No Stripe Checkout session has ever existed against a real API.** No key has been set on
  the deployed Worker, and locally every session is the stub's. There was nothing in flight to
  return to a dead URL.

## Exit cost

**An afternoon, and it grows the day something is published.** Today it is the reverse of this
commit: move three pages up, delete one column and one function, and re-point the links. Once
`/nn/2026/` is in a newsletter it costs a redirect mechanism this site does not have, which is
the whole reason for doing it now.

## Revisit when

**The club restructures the rest of the site**, and every URL is on the table. That is when
`/nn` becomes `/nightingale-nightmare` if it is going to, and when `/nn/privacy/` becomes
`/privacy/` with a race annex. Both are deferred here rather than declined.
