# ADR-052: One club header on the account and admin pages

**Status:** Accepted
**Date:** 1 October 2026
**Supersedes:** [ADR-048](adr-048-the-club-website-is-its-own-surface.md) **in part** — its
fence around `/account/*` and `/admin/*` only. ADR-048's fence around `/nn/*`,
`/events/<slug>/`, `/privacy/`, `/404`, `/brand/` and `apps/timing` stands unchanged.

## Context

ADR-048 gave the club website its own stylesheet and chrome, and fenced every page that takes
or handles money onto the old chrome until after Nightingale Nightmare on 1 November 2026. So
the site had three generations of header at once:

- the club pages — `/`, `/run-with-us/`, `/events/`, `/membership/`, `/news/`, `/about/` — on
  the club header: the welcome strip, the wordmark, six items and "Come for a run";
- `/account/*` on the old banner and the four-item bar (Home · Nightingale Nightmare · Events ·
  Account), with **no skip link and no `id="main"`** on any of its nineteen `<main>`s;
- `/admin/*` on a masthead of its own, which repeated the wordmark, with no way to the club
  site but the address bar.

A member moving from `/about/` to `/account/` changed header, palette and navigation in one
click. Somebody holding a timing role had one link to `/timing` and it was in the body of
`/account/`. The club asked for one header, everywhere a member goes, and for navigation that
reflects what the person signed in may open.

**A freeze exception was granted in writing** for this change on these two prefixes, on the
understanding that it is chrome only: no URL changes, no page body changes, no schema change,
and nothing on `/nn/*` or `/events/<slug>/`.

## Decision

### 1. `/account/*` and `/admin/*` carry the club header and footer

The Worker builds both prefixes as strings, so it cannot render `ClubHeader.astro`.
**`apps/main/worker/club-chrome.ts` is the Worker's copy of the markup**, and it shares the
club pages' **data** rather than their components — the split `site-chrome.ts` already has with
`SiteNav.astro`. The items, labels, hrefs, order, call to action and banner sentence come from
`packages/shared/src/club-nav.ts` and nowhere else, and **`activeClubNavItem(pathname)` is the
one function that says which item is current**, called by the Astro header, its Menu and the
Worker's copy alike.

The tags are duplicated, and `tests/e2e/club-chrome.spec.ts` compares the Worker's header and
footer with the Astro ones in a browser — the same labels and hrefs in the same order — which
is what catches one copy being edited alone.

### 2. The chrome's styles are split out of `club.css`

`club.css` styles bare `body`, `h1`–`h4`, `p`, `a` and `main`, so loading it on an account page
would repaint every form there. The tokens, the heading face, the skip link, the header, the
Menu and the footer move to **`packages/shared/styles/club-chrome.css`**, where every rule is
scoped to a `.club-*` class and the values it used to borrow from `club.css`'s bare rules are
stated on the chrome itself.

- `ClubBase.astro` loads `club-chrome.css` then `club.css`, which keeps every rule in the order
  it had as one file. Measured: every computed property and box of every element on the eight
  club pages, at six widths, in both schemes, with the Menu open and shut — no difference.
- `/account.css` and `/admin.css` append `club-chrome.css` after `base.css`. Measured: every
  computed property of every element inside `<main>` on the account and admin pages is the same
  with and without it.
- `club.css` must never be added to either.

### 3. Admin: the club header on top, and a slim strip under it

The admin masthead stops being a second `<header>` — two `banner` landmarks is
`landmark-no-duplicate-banner` — and becomes a **slim strip**, a `<section>` named by its own
words: *"You are in **Club admin**"*, who is signed in, and "My account". It loses its wordmark,
because the club header carries it. **"Signed in as" stays**: it is what stops a volunteer
granting a role from the wrong one of their two accounts. The "Club admin" bar under it is
unchanged and still drawn from the person's permissions.

**The admin 404 stays bare.** The club header is added by `masthead()`, which every page a
member of staff can see calls and `notFound()` never does, so a signed-out stranger is still
linked into nothing — [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md)'s rule.

### 4. A section bar and breadcrumbs on the account pages

A white bar under the header names the section and links its pages, the current one marked
with `aria-current="page"`, the bar's 3px green line and a heavier weight. It scrolls sideways
on a phone rather than wrapping, and the current tab is not scrolled into view, because that
needs a script. Breadcrumbs — *Account › {page}* — are the first thing in `<main>`, as the
mockup draws them, on every account page but `/account/` itself. They take the page's own ink,
not the club palette's, because they sit on the page's background.

### 5. The navigation that depends on who is signed in is in the account bar, and only there

| Who | Account tabs |
| --- | --- |
| **A member** — an account and no role beyond `registered` | Your account · Your entries · Your details · Change your password · Your data |
| **A timing volunteer** — any `timing.*` permission | the five, and **Race timing** |
| **Staff** — `nn-admin`, `people-admin`, `super-admin`, `src-admin` | the five, and **Club admin** |
| **`src-admin`** | the five, and both |

**Each tab is drawn by the predicate its own door asks** — `holdsAnyTimingPermission()` for
`/timing`, `isStaff()` for `/admin/` — so a tab appears exactly when following it would open a
page and never when it would answer 404. `nn-tester` is not staff and gets neither. Read per
request; a failed read draws neither. **GET only**: a refused POST re-renders its form with the
five standard tabs and asks the database nothing.

**The public club bar is the same for everybody.** Its six items are public pages, and the club
pages are static — painting a per-person bar there would mean a database read on every page
view, which `club-nav.ts` and the `Events` submenu both declined for the same reason.

No new role and no new permission.

## Consequences

- **The account pages gained a skip link and `<main id="main">`**, which they never had.
- **The Worker's copy of the club header is a second copy of markup**, and a change to
  `ClubHeader.astro` has to be made in `worker/club-chrome.ts` too. The comparison in
  `club-chrome.spec.ts` fails when they drift.
- **Two reads per signed-in account page load** — `my_roles()` and `my_permissions()` — for the
  role-based tabs.
- **`site-chrome.ts`'s `siteNav()` and `siteBanner()` are still rendered**, by
  `/nn/<year>/results/`, which this change does not touch. They go when the race pages move.
- **`/admin/` has no current item in the club bar**: the back office is not one of its sections.
- **The `/timing` app is not part of this change.** Its header is a separate change to merge
  after the race; see `docs/delivery/phases.md`.

## Alternatives considered

- **Load `club.css` on the account and admin pages.** Rejected: it restyles bare elements and
  would repaint every form, which is exactly what the exception does not cover.
- **Keep the full admin masthead under the club header.** Built first, and rejected on review:
  two wordmarks stacked on every back-office page.
- **Role-based items in the public club bar.** Rejected for the static-page reason above, and
  because hiding public pages from somebody signed in helps nobody.
- **Thread the role-based tabs through every place an account page is built.** Rejected for a
  single slot filled on the way out of `handleAccount()`: thirty-odd call sites would each have
  needed a session they do not all hold.

## References

- [ADR-048](adr-048-the-club-website-is-its-own-surface.md) — the surface this extends
- [ADR-013](adr-013-the-admin-surface-and-who-may-read-it.md) — the bare admin 404
- [ADR-017](adr-017-permissions-are-what-code-checks.md) — permissions are what code checks
- `packages/shared/src/club-nav.ts`, `apps/main/worker/club-chrome.ts`,
  `packages/shared/styles/club-chrome.css`
