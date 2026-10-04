# HALT 2 — mockups for sign-off

> **Signed off 4 October 2026.** The decisions are at the top of
> [the brief](nn-timing-redesign-brief.md), under "Decisions at HALT 2". Since then the mockups
> drop the sign-out link for "Signed in as {name}", and the race console and capture screen are
> forced light (their dark screenshots are now identical to the light ones). This file is the
> record of what was put up for sign-off.

**3 October 2026** · branch `timing-redesign-inventory` (worktree `../src-website-timing-inventory`),
on `origin/main` at `a88416e` · nothing committed, nothing pushed, no database touched.

Open [`mockups-review.html`](mockups-review.html) in a browser: each row puts the mockup at 390
and 1280 next to NN today, the website page it should look like, and the PTB page whose
structure it follows.

## What the mockups show

| Mockup | Template | Notes |
|---|---|---|
| App shell, no role | — | One area (Your account), so no switcher. Timing is still a 404 for this person |
| App shell, timing marshal | T1 | `/timing` with a **Marshalling** card: date tile, race, Record crossings. **No area bar.** A line tells them what "Not found" means on race morning (the expired-session risk from the brief) |
| App shell, timing admin | T1/T3 | Your account · Race timing (no Club admin: `timing-admin` isn't staff). Bar: Overview · Races |
| Race launchpad | T1 | `src-admin`, so all three areas. Pills → facts band → Race day cards → Before the race → Starting again (danger link). Record crossings is a card shown only because this person is rostered |
| Record crossings ×3, + dark | T5 | Giant tile (287px phone / 180px desktop), queue scrolls alone, **no page scroll at 390×844**. Duplicate-bib warning, a failed card with Retry now, an offline pill + note |
| Race console ×3, + dark | T2 | The whole screen goes green under a one-row focus bar. One action per state, NN's captions verbatim. Below the fold: a sticky jump bar (Start and finish · Race status · Anomalies · Timing log) — D3 deferred, so these stay sections of the one page |
| Timing log | T3 | The console's `#crossings` section: status row, search, crossing cards (bib tile, state badge, Edit / Discard / Restore) |
| Live leaderboard | T4 | Freshness badge, category podium cards, sort pills, cards below 62em and a table above |
| Danger zone | T3 | Danger card, removed/kept lists, the Wipe pill **disabled with its reason beside it** |

## Checks (run by `docs/timing/mockups/shoot.mjs`, 30 screenshots)

- **axe, the suite's own tag list** (`AXE_TAGS` in `apps/main/tests/axe.ts`): **0 violations** on
  every screenshot, light and dark.
- **No sideways scroll** on any page at 390.
- **Exactly one `<h1>`** on every page.
- **Page title at 150px on a phone** with the app header and area bar (101px with no bar),
  against about 320px today.
- **Bricolage Grotesque's figures are tabular:** "11:11:11", "00:00:00" and "88:88:88" all
  measure 397.25px with `tabular-nums` (242px without). So the clock can stay in the display
  face (brief §7.2) and won't jitter.
- Every number here is fake. Names are placeholders (Alex Example, Pat Demo, …) and emails are
  `@example.com`.

## Things the mockups surfaced

1. **NN's start caption says "the button below".** So the caption sits *above* "Start the race",
   which keeps NN's wording true without editing it.
2. **The console needs a one-row focus bar** so the green fills exactly what's left of the screen.
   On a phone it drops "Southville RC" and shortens the race to "NN 2026". The full name stays in
   the `<title>` and the screen's first line.
3. **The capture screen's bar takes two rows on a phone:** where you are and Leave, then
   "{n} waiting" and the connection pill. The marshal's name isn't in it (§6.2 #10, optional).
   There's no room at 390 without dropping something else.
4. **The current tab scrolls into view with three lines of script.** With scripting off, the bar
   starts at its first tab, as today. (The race name shortens on phones too, which gets most of
   the way there without script.)
5. **"Sign out" links to `/account/#sign-out`**, which takes the person to the real button. That's
   one extra tap. The `#sign-out` anchor doesn't exist on the account page yet, and adding it
   touches `/account/`, which is frozen. So until then the link just lands on the page. Say if
   you'd rather the label be "Your account" to avoid promising a sign-out it doesn't perform.
6. **The danger zone stays enabled with scripting off**, and the server refuses a mismatch
   (`not_confirmed`). Only the script-on state can be disabled, because every spec runs in a
   `no-javascript` project.
7. **The mockups load the whole of `club.css`.** The build won't (D10): it copies the class-scoped
   rules timing needs into `apps/timing`. The look is the same; the mechanism is different.

## Files changed

**Docs only, outside `platform/`, so CI's change filter skips the suite:**

- `docs/timing/nn-timing-redesign-brief.md`: the brief, with the HALT 1 errata (12 marked
  `[erratum]`) and decisions at the top
- `docs/timing/redesign-inventory.md`: Phase 1
- `docs/timing/{ptb-reference,nn-current,src-website}/`: the screenshot pack (57 images)
- `docs/timing/mockups/`: `build.py`, `shoot.mjs`, `timing-mock.css`, `logo.svg.html`, 12
  `.html` mockups, `screens/` (30 PNGs and `report.json`)
- `docs/timing/mockups-review.html` and this file
- `docs/architecture/decisions/adr-054-the-signed-in-area-is-an-app-shell.md`: **Proposed**,
  supersedes ADR-053 §1 only. Plus its row in the ADR index
- `docs/delivery/phases.md`: the redesign's dates and its post-race list (content-file split,
  account/admin shell, console split, D4 behaviours, relay prize logic). Also corrects the
  claim that #330 merges after the race
- `CLAUDE.md`: the `crossing.resolve` console defect, under the timing app's "sharp things"

**Nothing under `platform/` changed.** No tests were run, because nothing they cover changed.
The mockup checks above are the only verification.

## Decisions needed at this halt

| | Question | Default if unanswered |
|---|---|---|
| — | Sign off the direction (shell, launchpad, green race control, capture tile) | — |
| — | Was #330 meant to be live early? (HALT 1 item 1 came back as a placeholder.) Not blocking | — |
| D1 | Nav order: race-day order (as mocked) or today's? | Race-day order |
| D4 | Which PTB behaviours, if any, come before the race. **The confirm before "Start the race" is the one the brief recommends.** It is new client behaviour on the start form, not presentation, so it needs your explicit yes | All after the race |
| D5 | Race-day screens: follow the phone's dark setting (as mocked), or force light outdoors? | Follow the phone |
| D6 | Leaderboard staff-only until published | Staff-only |
| D7 | Kayleigh approves public wording. Nothing here is public-facing: the marshal's "Not found" line is staff copy | — |
| D11 | Account/admin shell rollout | After the race (already in `phases.md`) |
| new | Sign-out label: "Sign out" (lands on Your account) or "Your account" | "Sign out" |
| new | ADR-054: accept as drafted? | Stays Proposed until you say |

## Next, once signed off

Slice A in a fresh session, on its own branch off `main`:

- baseline screenshots of the four non-timing pages
- the scoped copy of the club content rules into `apps/timing`, with its drift test against
  `club.css` and a contrast test for the timing layer
- the timing components from `timing-mock.css`

Then Slice B (the shell), C (launchpad), and D (console and capture), all by **Friday
23 October**.
