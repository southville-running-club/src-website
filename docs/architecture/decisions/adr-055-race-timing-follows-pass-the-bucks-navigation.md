# ADR-055: Race timing follows Pass the Buck's navigation

**Status:** Accepted
**Date:** 9 October 2026
**Supersedes:**
- [ADR-045](adr-045-race-night-is-one-console.md) — race night on one console.
- [ADR-054](adr-054-the-signed-in-area-is-an-app-shell.md), **its area bars and its focus
  frame only**. The app header, the slim footer, forced light on the race-day screens (D5) and
  the confirm before "Start the race" (D4) all stand.

## Context

Volunteers timed Pass the Buck in July 2026 on the old timing app, and found it easy to pick up
on the night. It had **one flat nav**, in the same order on every page, showing each role only
what that role could use.

Nightingale Nightmare's timing, rebuilt here, drifted from that.
- ADR-045 merged Start, Finish, Race status, Anomalies and the Timing log into one console of
  collapsible sections, behind a door wider than any section in it.
- ADR-054 gave each race a bar of six tabs in "race-day order", hid the danger zone, and dropped
  all navigation on the console and the capture screen.

So somebody who had timed Pass the Buck met different names, a different order and a different
shape, and had to be briefed.

On 9 October 2026 the club asked, in a brief written from Pass the Buck's own audit, for the
NN timing area to match Pass the Buck's navigation, page set and page layouts. The goal is
that anyone who used Pass the Buck can run Nightingale Nightmare without a briefing. NN's
timing logic was to stay exactly as it is.

## Decision

### 1. One nav, Pass the Buck's tabs in Pass the Buck's order

Every race page carries one nav strip directly under the app header:
`<nav aria-label="Race timing">`. The tabs are, in this order:

| Tab | Address under `/timing/events/<slug>` | Permission |
|---|---|---|
| Home | the race's own page | `timing.event.manage` |
| Start | `/start` | `timing.event.manage` |
| Anomalies | `/anomalies` | `timing.crossing.resolve` |
| Timing log | `/crossings` | `timing.crossing.resolve` |
| Results | `/results` | `timing.result.publish` |
| Prizes | `/prizes` | `timing.result.publish` |
| Marshal | `/timing/marshal/<slug>` | `timing.crossing.record`, **and on this race's roster** |
| Live | `/leaderboard` | `timing.event.manage` or `timing.crossing.resolve` |
| Staff | `/marshals` | `timing.marshal.assign` |
| Registrations | `/registration` | `timing.registration.import` |
| Roster | `/roster` | `timing.event.manage` |
| Danger | `/danger-zone` | `timing.event.manage` |

- **A tab is drawn only when the door would open it.** `raceNav()` in `lib/chrome.ts` asks
  `canOpen()`, the same table `middleware.ts` enforces. So the nav can never offer a link that
  404s.
- **Marshal also needs the roster**, which `canOpen()` deliberately does not check. Otherwise an
  admin who is not marshalling this race would be offered a tab that 404s.
- **Home** is the race's own page for anybody who may open it. For a marshal, who may not,
  Home is `/timing`, their list of races. So a marshal's nav is **Home · Marshal**.
- **Away from a race**, on `/timing` and `/timing/events`, the nav is Home and Races (Races for
  admins only).
- **A nav of one tab is not drawn.**
- **On a phone there is no hamburger.** The list scrolls sideways, tabs never shrink or wrap,
  and the current tab is brought into view.
- **The current tab** carries `aria-current="page"`, and is drawn bold, at full strength and
  underlined. The underline means it is not told apart by colour alone.

### 2. The console is five pages again

- **Start** holds the race control and finishing.
- **Anomalies** and **Timing log** are pages of their own.
- **Race status** (DNS, DNF and DQ) is **Roster**.
- **Prizes** leaves the results page and is a page of its own.

Each page's door is the **one** permission its own forms already post with. So ADR-045's
two-permission console door is gone, and the leaderboard is again the only address with two.
**No write address moved**: every form posts where it always did, carrying the same
permission. The console, `finish` and `status` redirect to the page each became, including a
`?section=` link to the page that section became.

**Roster is admin-only.** In Pass the Buck a marshal could open the roster. In NN, reading the
field's names is not something a marshal has been granted, and this ADR does not grant it.

### 3. Every race page has the nav, the capture screen included

ADR-054's focus frame is gone. The capture screen sits under the header and the nav, as Pass
the Buck's did, and still fills the rest of the screen. It keeps forced light, and so does
Start (D5).

### 4. Every standard page opens the same way

`app/chrome/page-head.tsx` draws the top of every page:
1. an eyebrow, such as "Admin · Nightingale Nightmare 2026";
2. a one- or two-word heading ending in a full stop;
3. a one-paragraph intro;
4. a status row with a monospace count, the London time it was read, and a Refresh link.

Refresh is a link to the page itself, so it works with scripting off. Times, bibs, entry
numbers and counts use the system monospace.

**This change applies the head to the five new pages.** The others gain it page by page.

### 5. Link rows at the foot of a page go

The nav is how somebody moves between pages, so "Back to this race" rows and their like are
removed rather than kept beside it.

## What this does not change

- No timing logic: capture, times, categories and the order of results.
- No database function, grant, permission or role.
- No published address: the redirects keep every old one working.

Pass the Buck's own login, `/forbidden` page and staff account creation are **not** adopted.
- The club site's sign-in is the way in.
- A refusal is still the ordinary 404 (ADR-037, ADR-044).
- Creating accounts with a generated password would need the service role key, which is on
  `CLAUDE.md`'s stop-and-ask list.

## Consequences

- **Somebody who timed Pass the Buck finds the same tabs, in the same order, with the same
  names.**
- **One stray tap can now leave the capture screen**, which is what ADR-054's focus frame
  guarded against. The trade is taken deliberately: Pass the Buck had the nav there too, and the
  queue survives navigation because it is in IndexedDB rather than on the page.
- **Anomalies and Timing log still read `event_detail()`, which needs `timing.event.manage`.**
  So somebody holding only `timing.crossing.resolve` would get the not-found page. This is
  ADR-045's latent defect carried over unchanged. No role holds resolve without manage today.
- **Twelve tabs do not fit on a phone**, so the nav scrolls sideways there. That is the cost of
  Pass the Buck's flat list over grouped menus, and it is the list volunteers already know.

## Amendment, 9 October 2026: the capture screen is Pass the Buck's too

§3 put the capture screen under the app header and the nav. The club then asked for the
**screen itself** to match Pass the Buck's, and Pass the Buck's has no site header at all. So
the capture screen now has:
- the nav at the very top, with no app header and no footer;
- **a dark status bar**: the race and the marshal's name, how many crossings are waiting for a
  bib, an Online/Offline pill, and a ⋯ menu;
- the big **Crossed now** tile;
- the queue on a band of its own, with "Queue's empty." when nothing is waiting.

The ⋯ menu carries who is signed in, the syncing, queued and failed counts, and a link to Your
account. It has no Sign out, because signing out needs a token only the club's own site issues.

**Nothing about capture changed**: tap first, bib after, the offline queue, the retry cap and
the anomaly rules are exactly as they were. The Online pill reads the browser's own network
events, so it says whether the phone has a network, not whether the club's site answers. The
queue's sync states remain the truth.

## Amendment, 10 October 2026: Home and Start are Pass the Buck's brand pages

Below the nav, the race's **Home** and its **Start** screen are club green from edge to edge,
with the page's ink on it. That is `--club-on-brand` on `--club-brand`, 5.07:1; white on that
green is 3.5:1 and is never used.

- **Home** is Pass the Buck's role hub:
  - a small eyebrow, then the race in large type ending in a full stop;
  - one status line: when it starts, "Race in progress", or "Race complete — view final
    results";
  - **Live results** as the primary button, then "Signed in as …";
  - the tools as full-width buttons: race-night tools solid, then setup, then after the race.

  ⚠️ **The tools are built from the nav's own tabs** (`hubTools()`), so a button is on the hub
  exactly when its tab is in the nav. The race's details are a collapsed "Race details" block at
  the foot. A marshal on one race gets that race's hub at `/timing`, with their Marshal and
  Roster buttons.
- **Start** is one state at a time, with one big action each:
  - **Runners to the start.** — Start the race, asked twice with scripting on;
  - **Race in progress.** — the clock and **Mark race finished**, plus Clear the start while
    nobody has been timed;
  - **Race finished.** — Results, and **Reopen the race**.

  Finishing moved into the running state, as in Pass the Buck. The forms still post to
  `start/update` and `finish/update`, unchanged.

**Not adopted:**
- **Pass the Buck's "It can't be undone" on the start confirm.** It isn't true here: the start
  can be cleared until somebody is timed.
- **Updating the Start screen live when another device starts the race.** The losing press is
  already told the winning time.
