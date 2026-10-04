# ADR-054: The signed-in area is an app shell, not the public site's navigation

**Status:** Accepted
**Date:** 3 October 2026 · accepted 4 October 2026
**Supersedes:** [ADR-053](adr-053-the-timing-app-wears-the-club-header.md) **§1 only** — the
club header, the club footer and the breadcrumbs on `/timing` pages. ADR-053's §2 to §5 stand,
and so do [ADR-045](adr-045-race-night-is-one-console.md) (one race console) and
[ADR-052](adr-052-one-club-header-on-the-account-and-admin-pages.md) (the account and admin
pages, until they adopt this shell after the race).

## Context

ADR-053 put the club website's public header and footer on every timing page, plus a "Race
timing" bar, a bar per race and breadcrumbs. It merged on 2 October 2026. Seen live on
3 October, a race page on a 390px phone carries the old-site banner, the club header, two bars
and a breadcrumb trail: about 320px before the page's own heading. On a page that is used under
race-day pressure, most of that is navigation to places a volunteer timing a race has no reason
to go — Membership, News, "Come for a run".

Pass the Buck's timing app (July 2026) was easy to use because it had one flat nav that showed
each role what that role could use, and nothing else. The club's decision (Bindal, 3 October
2026) is that once somebody is signed in, the pages they reach are an application: their
navigation is built from what an admin has granted them, not from the public site's menu.

## Decision

### 1. Timing pages wear an app shell instead of the club header and footer

| Part | What it carries |
|---|---|
| **App header** | The club logo (links to the public home page); the **areas** this person may use, as pill links — Your account · Race timing · Club admin — with the current one `aria-current="page"` and the website's 3px brand underline; **"Signed in as {name}" as plain text**. On a phone: the logo, the current area's name, and a `<details>` Menu with the same areas. Somebody with one area sees its name and no switcher |
| **Area bar** | The current area's pages, as `.club-section`. In Race timing it is named after the race, and holds Overview · Race console · Live leaderboard · Results · Entry list · Marshals — each drawn only when `canOpen()` admits it |
| **Slim footer** | Privacy notice · Club website |
| **Not carried** | The public nav, the old-site banner, the breadcrumbs, the public footer |

**Which areas a person sees** uses the predicates `/account/` already uses, so the two cannot
disagree: Race timing when `holdsAnyTimingPermission()` (`packages/shared/src/timing/door.ts`),
Club admin when `isStaff()` (`apps/main/worker/admin-shell.ts`). So a `timing-admin` sees Your
account · Race timing; `src-admin` sees all three; a `timing-marshal` sees Your account · Race
timing **and no area bar**. In race-day order (D1), the bar is Overview · Race console · Live
leaderboard · Results · Entry list · Marshals, because none of the bar's pages admit
`timing.crossing.record` alone.

### 2. What carries over from ADR-053 unchanged

- **`canOpen()` is the nav's one source of truth.** A tab is drawn exactly when the door would
  open; tabs are filtered, never locked; nobody is shown a link to a 404.
- **The frame table** (`apps/timing/lib/chrome.ts`) **and its test**
  (`tests/unit/chrome.test.ts`), which fails any `page.tsx` not in the table or not using its
  frame. The frames change; the mechanism does not.
- **The focus header** on the race console and the marshal's capture screen (ADR-053 §2): no
  app header, no area bar.
- **The danger zone is never a tab.** It is linked from the race overview as a danger-text
  action.
- **The not-found page reads nothing** and stays prerendered (ADR-053 §4).

### 3. Record crossings is not a tab

The capture screen's door is roster-scoped (`timing.marshal_event()`), and `canOpen()` does not
check the roster — only the door does. A tab would 404 for any admin not rostered on the race.
So Record crossings appears **on the timing home's Marshalling card and on the race
overview**, only for races the person is rostered on, from `timing.my_marshal_events()`.

### 4. There is no sign-out control here, for now

Signing out is `POST /account/sign-out/` with a CSRF token the main Worker issues, and the
timing app holds no such token. So the header shows "Signed in as {name}" as plain text and
carries no sign-out link: "Your account" is already in the header and is where the real Sign out
is. A link labelled "Sign out" that only leads to another page would promise something it does
not do. A real button comes with the shared shell after the race.

### 5. The two race-day screens are always light

The race console and the capture screen are used outdoors in daylight, so they are drawn in the
light palette whatever the phone's setting (brief D5, 4 October 2026). Every other page follows
the phone. This is done by re-declaring the light `--club-*` values for those two screens inside
the dark media query, in the timing app's own stylesheet, so `club-chrome.css` is not touched.

### 6. It is built to travel

The shell's markup and classes (`.app-header`, `.app-areas`, `.app-user`, `.app-footer`) are
self-contained and painted only with `--club-*` tokens, so `/account/*` and `/admin/*` can adopt
it after 1 November without a redesign (§6). That rollout, and removing the duplicate "Race timing"
and "Club admin" links from those bars, is in `docs/delivery/phases.md`.

## Consequences

- **`club-chrome.spec.ts`'s timing half goes.** It compares timing's club header with the
  Astro one, and timing no longer has one. Removing it is argued in the pull request, not done
  silently.
- **The club header's third copy (ADR-053's Consequences) goes away**, replaced by a shell that
  exists once.
- **A member who reaches `/timing` loses the route to Membership and News except through the
  logo.** Accepted: the logo is one tap, and the pages here are tools.
- **Lands before the race, by 23 October 2026** (the last merge date), and is exercised by the
  mock race on 27 October. It is a presentation change on the timing Worker only; nothing under
  `packages/` changes before the race.

## Alternatives considered

- **Keep ADR-053's frames and restyle the content only.** Leaves the 320px of chrome, which is
  the complaint.
- **Hide the public nav with CSS on timing pages.** Two sources of truth for one header, and a
  hidden nav is still in the accessibility tree unless removed properly.
- **A Record crossings tab for everybody holding `timing.crossing.record`.** A link to a 404
  for the unrostered, which ADR-053 §3 rules out.

## References

- `docs/timing/nn-timing-redesign-brief.md` §7.4, and its HALT 1 decisions
- `docs/timing/redesign-inventory.md` §5
- `docs/timing/mockups/` — the Phase 2 mockups of this shell
