/**
 * The club website's own navigation and its own banner sentence.
 *
 * ## Why this is a second file rather than two more exports in `brand.ts`
 *
 * `brand.ts` holds `SITE_NAV` and `SITE_BANNER`, and those two are rendered by
 * `SiteNav.astro` and by `worker/site-chrome.ts` onto `/nn/*`, `/account/*` and
 * `/events/<slug>/` — every page that takes or handles money. Until after the race on
 * **1 November 2026** those pages are frozen: not their markup, not their styles, not the
 * shared files they render through.
 *
 * Adding an export to `brand.ts` would not change what those pages render. It would still be
 * an edit to a file on the money path, reviewed by two volunteers who would each have to
 * satisfy themselves it changed nothing — during an entry window, on the module that decides
 * what the entry pages' navigation says. A new file costs one import and asks nobody that
 * question.
 *
 * **So the two navigations coexist on purpose, and they are allowed to disagree.** The money
 * pages keep today's four labels (Home, Nightingale Nightmare, Events, Account) and today's
 * banner sentence; the club pages get these. After the race a separate change moves the money
 * pages onto this chrome and deletes the other one. Until then, a member clicking "Events" in
 * the old bar lands on a page headed "Races and events" in the new chrome — a seam that is
 * visible, temporary, and very much cheaper than the alternative.
 *
 * ## The shapes here mirror `brand.ts` deliberately
 *
 * `match` is a regular expression rather than an href, which is the convention `SITE_NAV` and
 * `NnNav` already use: a section marks itself current from any page inside it, so
 * `/nn/2026/entry/complete/` highlights "Races and events" without anybody listing it.
 *
 * Resolved at **build time** from `Astro.url.pathname`. Nothing here runs in a browser.
 */

export interface ClubNavItem {
  href: string;
  label: string;
  /** Which pathnames mark this item as the section being read. */
  match: RegExp;
}

/**
 * The bar, left to right after the wordmark.
 *
 * **Nightingale Nightmare is not a top-level item any more, and that is the one removal.**
 * It is reached through "Races and events" and from the home page's "Coming up". The race is
 * one of two the club puts on and one of a dozen things it does; a permanent tab for it was
 * the old site's shape rather than a decision, and the hub is where somebody looking for
 * *a race* actually starts.
 *
 * ⚠️ **`/nn/**` still highlights "Races and events"**, so a runner deep in the entry flow is
 * told which section they are in even though the bar on those pages is `NnNav` rather than
 * this one. That costs nothing today and is what makes the mapping correct on the day the
 * money pages move onto this chrome.
 *
 * **Account is `/account/`, not `/account/sign-in/`.** The club pages are static, so nothing
 * rendering this bar knows whether anybody is signed in, and a link straight to the sign-in
 * form would show a signed-in member a form they do not need. `/account/` already does the
 * branch itself — it renders the account page for a session and 303s to `/account/sign-in/`
 * without one — so the destination is right either way. This is `SITE_NAV`'s reasoning,
 * unchanged, and the reason it is restated here is that this file is where somebody would
 * otherwise "fix" it.
 */
export const CLUB_NAV: readonly ClubNavItem[] = [
  { href: '/run-with-us/', label: 'Run with us', match: /^\/run-with-us(\/|$)/u },
  {
    href: '/events/',
    label: 'Races and events',
    // `/events/**` and `/nn/**` are one section to a reader: the hub lists the races, and the
    // race pages are what it lists. The schema calls a party a `social` and a running of a
    // race an `event`, and neither word appears here — a navigation label is written for
    // whoever is looking at it. ADR-033.
    match: /^\/(events|nn)(\/|$)/u,
  },
  { href: '/membership/', label: 'Membership', match: /^\/membership(\/|$)/u },
  { href: '/news/', label: 'News', match: /^\/news(\/|$)/u },
  { href: '/about/', label: 'About', match: /^\/about(\/|$)/u },
  { href: '/account/', label: 'Account', match: /^\/account(\/|$)/u },
];

/**
 * The call to action, in the header and again in the home page's hero.
 *
 * **"Come for a run" is not a page.** It is this button, and it goes to `/run-with-us/`,
 * which is the first-night guide. A separate page would say the same thing twice and give
 * the club two places to keep it true.
 */
export const CLUB_CTA = {
  href: '/run-with-us/',
  label: 'Come for a run',
} as const;

/** The wordmark's link home, and the accessible name it is announced by. */
export const CLUB_HOME = {
  href: '/',
  label: 'Southville Running Club, home',
  /** What marks the wordmark as the current page, since it is the Home link. */
  match: /^\/$/u,
} as const;

/**
 * The bar that says which site this is — the club pages' version of it.
 *
 * **`SITE_BANNER`'s sentence stopped being true when these pages shipped.** It reads *"We
 * just have Nightingale Nightmare for now"*, which was accurate while `/` was a holding page
 * and is not once the club's own pages are here. The money pages keep saying it until they
 * move, because their markup is frozen and because on `/nn/` it is still very nearly true.
 *
 * **Two parts, for the reason `SITE_BANNER` gives and which is worth repeating because it is
 * invisible and expensive:** Astro compresses the newline between a tag and the text after it
 * to *nothing*, so a sentence written across a line break silently loses the space at the
 * join. `lead` therefore ends in its own trailing space, `linkLabel` carries none of its own,
 * and `tail` supplies the full stop. Do not reflow these strings onto separate lines in the
 * markup that renders them.
 */
export const CLUB_BANNER = {
  /** The club website as it stands today — everything not yet moved across. */
  clubWebsite: 'https://southvillerunningclub.co.uk',
  welcome: "Welcome to Southville Running Club's new website.",
  /** Ends right before the linked words, with its own trailing space. */
  lead: 'Some pages are still on ',
  /**
   * The words that become the inline link. Short deliberately: with the hostname spelled out
   * this wraps to two lines on a 320px phone and the banner eats a third of the first screen.
   * It still says where it goes when a screen reader reads it out of a link list, which
   * "click here" never does.
   */
  linkLabel: 'the old site',
  /** The rest of the sentence, closing it. */
  tail: ' while we move across.',
} as const;
