# ADR-057: Staff tools are on the account home, not in the account bar

**Status:** Accepted
**Date:** 10 October 2026
**Supersedes:** [ADR-052](adr-052-one-club-header-on-the-account-and-admin-pages.md) **§5 only**
(the account bar's Race timing and Club admin tabs). The rest of ADR-052 stands. This also
brings forward one part of [ADR-054](adr-054-the-signed-in-area-is-an-app-shell.md) §6, removing
those links from the account bar, ahead of the account app shell. The shell itself, and its real
sign-out button, still come after the race.

## Context

The club reviewed `/account/` on 9 October 2026, from a screenshot (Bindal), and found four
problems:

- **The bar mixed areas.** It showed five account pages and then "Race timing" and "Club admin",
  which are different applications. Pressing either one silently left the section.
- **The body repeated the bar.** It was a column of four plain links to the same pages the bar
  already listed, with nothing saying what each one was for.
- **The page sat out of line with its own header.** It was a 32rem column centred in the window,
  so on a desktop it started a few hundred pixels to the right of the logo and the bar's first
  tab.
- **The loudest control was Sign out.** It was a solid primary button, while every useful
  destination was a plain link.

The club decided on 10 October 2026 (Bindal) to fix this before the race. The change is
presentation only. It adds no data, read, permission or address.

## Decision

1. **The account bar is the five account pages for everybody.** Their labels are unchanged,
   because each tab's label is its page's own `<h1>`.
2. **`/account/` is a short dashboard.** It shows which account is signed in, then one card per
   account page, each with a sentence saying what that page is for.
3. **Staff tools are a labelled group on `/account/` and nowhere else.**
   - Race timing appears when `holdsAnyTimingPermission()` is true, and Club admin when
     `isStaff()` is true. These are the predicates each door asks, so a card appears exactly
     when following it would open a page.
   - The roles and permissions are read on `/account/` only, so the other four pages make no
     role read at all. A failed read draws neither card and logs a code.
   - The old slot that was filled on the way out of `handleAccount()` is gone.
4. **Each card's link is its title alone.** The link's `::after` stretches over the card, so
   the whole card can be clicked while the link's accessible name stays the page's name.
5. **The page lines up with the header.** `.account-page` is as wide as `.club-wrap` and uses
   its gutter. Each child keeps the old 32rem measure, so every form on every account page is
   exactly as narrow as before and now starts where the logo does.
6. **Sign out is a secondary button.**

## Consequences

- **The other account pages lose a one-click way into `/timing` and `/admin/`.** Somebody on
  "Your details" goes back to "Your account" first. This is accepted, because those are the
  ways out of the section rather than pages of it. The timing app's own header still links
  back to "Your account".
- **Two reads per account page load become two reads on one page.**
- **Forms on every account page move from centred to left-aligned on a wide screen.** Their
  width is unchanged.

## Alternatives considered

- **Rename the first tab to "Overview" so "Account" is said fewer times.** Rejected for now,
  because it breaks the rule that a tab's label is its page's heading. The account app shell
  (ADR-054 §6) is where the bar's naming is redesigned.
- **Keep the staff tabs and add a divider before them.** Rejected: a divider still leaves two
  applications in the bar of a third.
- **A count on the "Your race entries" card.** Not built. It would cost a `my_entries()` read on
  every home page load, and a zero risks reading as "you have no place", which is the kind of
  negative claim the entries pages are written to avoid.

## References

- `apps/main/worker/account.ts`: `accountHome()`, `staffAreas()`, `tiles()`
- `packages/shared/styles/account.css`
- `apps/main/tests/unit/account.test.ts`: "the staff tools, which depend on who is signed in"
