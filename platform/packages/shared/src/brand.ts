/**
 * The club's brand, as data both front doors render from.
 *
 * `apps/main` is Astro and `apps/timing` is Next, so the masthead cannot be one component.
 * The *words* and the *geometry* can be one file, which is what this is: each app writes its
 * own dozen lines of markup around these values, and neither can drift from the other on
 * anything a visitor actually reads.
 *
 * **Two marks, split by the size they are drawn at.** `CLUB_LOGO` is the full lockup and is
 * the only one either app renders; `CLUB_MONOGRAM` is the "SRC" artwork and exists for the
 * favicon alone. The split is the whole point — see the note above each.
 *
 * The colours are not here. They are custom properties in `styles/tokens.css`, because a
 * stylesheet is where a colour belongs and because the logo below takes its fill from
 * `currentColor` — one asset that paints club green on the club's banner and bone on the
 * Nightingale Nightmare hero, decided by CSS rather than by which file was imported.
 */

/**
 * The club wordmark: the two-line "SOUTHVILLE RUNNING CLUB" lockup, traced to vector.
 *
 * **Restored 16 August 2026**, the same day it was replaced by the "SRC" monogram. The
 * monogram is real artwork supplied by the club and the argument for adopting it still
 * holds — the full lockup shrunk into a 16px tab strip is an illegible smear — but that
 * argument was only ever about the favicon, and it was applied to every surface at once.
 * A masthead has room for the club's name, and somebody arriving from a search reads a
 * name rather than recognising a monogram they have never seen before.
 *
 * So the two marks are split by the size they are drawn at: this one wherever there is
 * room for it — the site banner on `/`, `/nn` and `/timing`, and the Nightingale
 * Nightmare masthead — and `CLUB_MONOGRAM` in the favicon and nowhere else.
 *
 * **`apps/main/public/logo.svg` is the same artwork and must stay identical.** It is still
 * served at `/logo.svg` for anything that needs a standalone file — an `og:image`, a link
 * somebody has already shared — and `packages/shared/tests/unit/brand.test.ts` asserts the
 * two agree path for path. A logo that disagrees with itself across a site is the exact
 * failure this whole arrangement exists to end.
 *
 * The viewBox is the pixel size of the club's own artwork: the official PNG on
 * southvillerunningclub.co.uk is 876x267, and this trace matches it.
 */
export const CLUB_LOGO = {
  viewBox: '0 0 876 267',
  /** The accessible name. It is what the artwork *says*, not a description of it. */
  title: 'Southville Running Club',
  /**
   * Two paths: "SOUTHVILLE" and "RUNNING CLUB". Both are filled with `currentColor` by the
   * markup that renders them, never with a literal, which is what makes one file enough.
   * Each carries the `transform` its trace was exported with; the markup renders it, and
   * dropping it silently slides the letters off the viewBox.
   */
  paths: [
    {
      d: 'M348.918 547.276c-6.265-2.1-11.362-5.606-15.291-10.517-6.864-8.58-10.296-21.78-10.296-39.6h33.264c0 3.96.033 6.765.099 8.415.066 1.65.264 3.663.594 6.039.33 2.376.825 3.993 1.485 4.851.66.858 1.584 1.683 2.772 2.475 1.188.792 2.706 1.254 4.554 1.386 5.544 0 8.316-3.63 8.316-10.89 0-3.564-.594-6.402-1.782-8.514-1.188-2.112-2.64-3.762-4.356-4.95a304.805 304.805 0 0 0-10.89-6.93c-7.392-4.488-13.068-8.448-17.028-11.88-9.636-8.052-14.454-19.14-14.454-33.264 0-13.068 3.597-22.935 10.791-29.601 7.194-6.666 17.259-9.999 30.195-9.999 13.86 0 24.156 3.795 30.888 11.385 6.732 7.59 10.098 19.173 10.098 34.749h-33.264c0-6.336-.594-10.692-1.782-13.068-1.188-2.376-3.432-3.564-6.732-3.564-5.016 0-7.524 2.772-7.524 8.316 0 3.564 1.188 6.534 3.564 8.91 2.376 2.376 6.93 5.478 13.662 9.306l5.742 3.564c5.94 3.696 10.626 7.062 14.058 10.098 8.052 7.128 12.078 17.556 12.078 31.284 0 14.124-3.828 25.047-11.484 32.769a37.184 37.184 0 0 1-2.356 2.18 1014.466 1014.466 0 0 0-44.921 7.05ZM424.269 536.558c-4.381-5.525-7.513-12.323-9.396-20.391-2.31-9.9-3.465-22.968-3.465-39.204 0-15.444 1.056-28.182 3.168-38.214 4.62-23.1 18.48-34.65 41.58-34.65 12.408 0 21.912 3.168 28.512 9.504 6.072 6.072 10.263 14.091 12.573 24.057 2.31 9.966 3.465 23.067 3.465 39.303 0 15.444-1.056 28.182-3.168 38.214-1.246 6.197-3.161 11.557-5.744 16.083-24.246 1.243-46.77 3.082-67.525 5.298Zm42.975-34.845c.396-5.148.594-13.398.594-24.75s-.198-19.602-.594-24.75c-.396-5.412-1.419-9.438-3.069-12.078-1.65-2.64-4.323-3.96-8.019-3.96-3.696 0-6.468 1.386-8.316 4.158-1.584 2.772-2.574 6.798-2.97 12.078-.396 5.148-.594 13.332-.594 24.552 0 11.22.198 19.47.594 24.75.396 5.412 1.452 9.405 3.168 11.979 1.716 2.574 4.422 3.861 8.118 3.861 3.828 0 6.534-1.32 8.118-3.96 1.584-2.772 2.574-6.732 2.97-11.88ZM515.336 530.265c-4.099-7.988-6.149-18.825-6.149-32.512v-90.288h32.67v90.288c0 7.26.924 12.441 2.772 15.543 1.848 3.102 5.214 4.653 10.098 4.653 4.092 0 6.93-1.353 8.514-4.059 1.584-2.706 2.376-7.293 2.376-13.761v-92.664h32.472v90.288c0 13.454-1.944 24.154-5.833 32.1-27.147-.592-52.804-.392-76.92.412ZM634.488 531.33v-92.977H603.6v-30.888h94.446v30.888h-30.888v94.728a2027.645 2027.645 0 0 0-32.67-1.751ZM705.537 535.849V407.465h32.472v53.262h28.71v-53.262h32.472v137.479c-10.315-.912-20.977-2.015-32.472-3.213v-49.918h-28.71v46.983a2075.51 2075.51 0 0 0-32.472-2.947ZM870.24 407.465h33.264l-29.304 138.6h-39.204l-29.304-138.6h34.056l15.246 86.724 15.246-86.724ZM943.467 539.546c-11.673 1.737-22.434 3.146-32.472 4.266V407.465h32.472v132.081ZM961.848 536.661V407.465h32.67v107.514h39.002v13.978c-21.37.81-42.775 2.807-63.67 6.365-2.717.462-5.389.91-8.002 1.339ZM1043.99 528.653V407.465h32.66v107.514h39.01v16.051c-23.11-1.892-47.29-2.871-71.67-2.377ZM1126.12 531.954V407.465h70.89v30.888h-38.22v21.978h35.05v31.284h-35.05v23.364h39.8v26.842c-21.7-3.816-46.3-7.389-72.47-9.867Z',
      transform: 'translate(-323.331 -404.099)',
    },
    {
      d: 'm690.022 641.759 12.76 33.99h-19.14l-9.35-26.62h-3.3v26.62h-18.04v-77h22.22c16.5 0 24.75 7.48 24.75 22.44 0 10.12-3.3 16.977-9.9 20.57Zm-8.14-18.04c0-5.207-2.31-7.81-6.93-7.81h-3.96v16.17h2.86c2.567 0 4.547-.733 5.94-2.2 1.394-1.467 2.09-3.52 2.09-6.16ZM739.609 598.749h18.04v50.16c0 10.12-1.98 17.435-5.94 21.945-3.96 4.51-10.157 6.765-18.59 6.765-8.507 0-14.777-2.255-18.81-6.765-4.033-4.51-6.05-11.825-6.05-21.945v-50.16h18.15v50.16c0 4.033.513 6.912 1.54 8.635 1.027 1.723 2.897 2.585 5.61 2.585 2.273 0 3.85-.752 4.73-2.255.88-1.503 1.32-4.052 1.32-7.645v-51.48ZM821.756 598.749v77h-18.04l-18.26-41.14v41.14h-17.93v-77h18.7l17.71 40.81v-40.81h17.82ZM886.963 598.749v77h-18.04l-18.26-41.14v41.14h-17.93v-77h18.7l17.71 40.81v-40.81h17.82ZM898.49 598.749h18.04v77h-18.04zM982.287 598.749v77h-18.04l-18.26-41.14v41.14h-17.93v-77h18.7l17.71 40.81v-40.81h17.82ZM1013.5 650.559v-16.94h23.54v42.13h-14.19v-7.59c-2.2 6.38-6.63 9.57-13.31 9.57-5.64 0-9.97-1.833-12.976-5.5-2.787-3.52-4.675-8.048-5.665-13.585-.99-5.537-1.485-12.778-1.485-21.725 0-9.02.586-16.243 1.76-21.67 2.493-12.173 10.266-18.26 23.316-18.26 8.07 0 13.85 2.383 17.33 7.15 3.48 4.767 5.22 12.21 5.22 22.33h-18.48c-.07-4.987-.36-8.268-.88-9.845-.51-1.577-1.94-2.512-4.29-2.805-1.83 0-3.19.843-4.07 2.53-.8 1.76-1.32 4.07-1.54 6.93-.14 3.96-.22 8.58-.22 13.86 0 5.647.08 10.45.22 14.41.44 6.087 2.42 9.13 5.94 9.13 2.35 0 3.91-.752 4.68-2.255.77-1.503 1.15-4.125 1.15-7.865h-6.05ZM1092.09 677.729c-6.6 0-11.7-1.613-15.29-4.84-3.38-3.153-5.69-7.48-6.93-12.98-1.25-5.5-1.87-13.017-1.87-22.55 0-9.387.58-16.793 1.76-22.22 2.63-12.1 10.3-18.15 22.99-18.15 8.21 0 14.08 2.365 17.6 7.095 3.52 4.73 5.27 12.192 5.27 22.385h-18.25c0-4.547-.33-7.792-.99-9.735-.67-1.943-2.06-2.915-4.19-2.915-2.63.293-4.3 1.742-5 4.345-.7 2.603-1.05 7.902-1.05 15.895 0 7.553.12 13.09.33 16.61.22 3.593.72 6.16 1.49 7.7s2.04 2.31 3.8 2.31c2.34 0 3.86-1.173 4.56-3.52.7-2.347 1.05-6.27 1.05-11.77h18.37c0 11.073-1.89 19.232-5.67 24.475-3.78 5.243-9.77 7.865-17.98 7.865ZM1162.13 658.479v17.27h-39.82v-77h18.15v59.73h21.67ZM1199.51 598.749h18.04v50.16c0 10.12-1.98 17.435-5.94 21.945-3.96 4.51-10.16 6.765-18.59 6.765-8.51 0-14.78-2.255-18.81-6.765-4.03-4.51-6.05-11.825-6.05-21.945v-50.16h18.15v50.16c0 4.033.51 6.912 1.54 8.635 1.03 1.723 2.9 2.585 5.61 2.585 2.27 0 3.85-.752 4.73-2.255.88-1.503 1.32-4.052 1.32-7.645v-51.48ZM1273.85 652.649c0 6.527-2.04 12.008-6.11 16.445-4.07 4.437-9.92 6.655-17.54 6.655h-22.77v-77h24.86c6.23 0 11.03 1.797 14.41 5.39 3.37 3.593 5.06 8.25 5.06 13.97 0 4.253-.92 7.92-2.75 11-1.84 3.08-4.55 5.28-8.14 6.6 8.65 2.273 12.98 7.92 12.98 16.94Zm-28.38-23.87h3.19c1.39 0 2.58-.642 3.57-1.925.99-1.283 1.49-2.915 1.49-4.895 0-2.567-.5-4.382-1.49-5.445-.99-1.063-2.58-1.595-4.78-1.595h-1.98v13.86Zm10.23 22.11c0-5.353-2.24-8.03-6.71-8.03h-3.52v16.72h2.64c5.06 0 7.59-2.897 7.59-8.69Z',
      transform: 'translate(-523.331 -411.099)',
    },
  ],
} as const;

/**
 * The club's "SRC" monogram — the favicon's geometry, and nothing else's.
 *
 * Extracted path-for-path from `logo_src.pdf` on 16 August 2026: vector source supplied
 * directly by the club, not a hand trace of a rendered image. The viewBox is that PDF's own
 * page size — 412.236 x 215.679 — extracted rather than chosen.
 *
 * **Neither app renders this inline, and that is asserted rather than left to convention.**
 * A monogram is what a favicon needs, because 16px of tab strip cannot hold three words; it
 * is not what a masthead needs, because a header has room for the club's name and a visitor
 * who has never seen these three letters cannot decode them. Two marks, one rule: this one
 * below about 32px, `CLUB_LOGO` above it.
 *
 * It lives here rather than only in `apps/main/public/favicon.svg` so that a test can say
 * the file and this repository's idea of the monogram are the same artwork. The file itself
 * bakes in the brand green, because a static SVG cannot read a CSS custom property.
 */
export const CLUB_MONOGRAM = {
  viewBox: '0 0 412.236 215.679',
  /** The accessible name. The club's name, even though the mark itself reads "SRC". */
  title: 'Southville Running Club',
  /**
   * Three paths — S, R, C — each its own closed contour (the R's bowl is a second,
   * counter-wound subpath within its `d`, for the hole).
   */
  paths: [
    {
      d: 'M21.667 205.14 C19.412 203.209 17.337 201.06 15.444 198.693 C5.148 185.823 0 166.023 0 139.293 L49.896 139.293 C49.896 145.233 49.945 149.44 50.044 151.915 C50.144 154.39 50.44 157.41 50.936 160.974 C51.431 164.538 52.173 166.963 53.163 168.25 C54.153 169.537 55.539 170.775 57.321 171.963 C59.103 173.151 61.38 173.844 64.152 174.042 C72.468 174.042 76.626 168.597 76.626 157.707 C76.626 152.361 75.735 148.104 73.953 144.936 C72.171 141.768 69.993 139.293 67.419 137.511 C62.073 133.947 56.628 130.482 51.084 127.116 C39.996 120.384 31.482 114.444 25.542 109.296 C11.088 97.218 3.861 80.586 3.861 59.4 C3.861 39.798 9.257 24.997 20.048 14.998 C30.838 4.999 45.936 0 65.34 0 C86.13 0 101.574 5.692 111.672 17.077 C121.77 28.462 126.819 45.837 126.819 69.201 L76.923 69.201 C76.923 59.697 76.032 53.163 74.25 49.599 C72.468 46.035 69.102 44.253 64.152 44.253 C56.628 44.253 52.866 48.411 52.866 56.727 C52.866 62.073 54.648 66.528 58.212 70.092 C61.776 73.656 68.607 78.309 78.705 84.051 L87.318 89.397 C96.228 94.941 103.257 99.99 108.405 104.544 C120.483 115.236 126.522 130.878 126.522 151.47 C126.522 164.245 124.434 175.274 120.258 184.559 C98.597 185.049 74.864 188.538 48.225 196.712 C39.188 199.485 30.344 202.294 21.667 205.14 Z',
    },
    {
      d: 'M143.748 185.183 L143.748 4.752 L203.742 4.752 C248.292 4.752 270.567 24.948 270.567 65.34 C270.567 92.664 261.657 111.177 243.837 120.879 L278.289 212.652 L264.697 212.652 C250.773 209.663 236.938 205.604 222.695 201.502 L201.366 140.778 L192.456 140.778 L192.456 193.279 C177.176 189.544 161.113 186.489 143.748 185.183 Z M221.859 72.171 C221.859 58.113 215.622 51.084 203.148 51.084 L192.456 51.084 L192.456 94.743 L200.178 94.743 C207.108 94.743 212.454 92.763 216.216 88.803 C219.978 84.843 221.859 79.299 221.859 72.171 Z',
    },
    {
      d: 'M328.023 215.679 C319.689 213.555 312.714 209.972 307.098 204.93 C297.99 196.416 291.753 184.734 288.387 169.884 C285.021 155.034 283.338 134.739 283.338 108.999 C283.338 83.655 284.922 63.657 288.09 49.005 C295.218 16.335 315.909 0 350.163 0 C372.339 0 388.179 6.385 397.683 19.156 C407.187 31.927 411.939 52.074 411.939 79.596 L362.637 79.596 C362.637 67.32 361.746 58.558 359.964 53.311 C358.182 48.064 354.42 45.441 348.678 45.441 C341.55 46.233 337.046 50.143 335.164 57.172 C333.284 64.201 332.343 78.507 332.343 100.089 C332.343 120.483 332.64 135.432 333.234 144.936 C333.828 154.638 335.164 161.568 337.243 165.726 C339.322 169.884 342.738 171.963 347.49 171.963 C353.826 171.963 357.934 168.795 359.816 162.459 C361.696 156.123 362.637 145.53 362.637 130.68 L412.236 130.68 C412.236 154.048 409.121 172.608 402.893 186.359 L401.651 186.968 C397.776 188.887 393.929 190.859 390.117 192.899 C387.591 194.25 385.09 195.646 382.555 196.98 C379.273 198.706 375.948 200.352 372.581 201.905 C363.85 205.934 354.824 209.341 345.553 211.907 C339.896 213.473 334.155 214.711 328.357 215.628 L328.023 215.679 Z',
    },
  ],
} as const;

/**
 * The bar that says which site this is, rendered above everything on both front doors.
 *
 * Two parts, deliberately, rather than one sentence with a tag inside it: Astro compresses
 * the newline between a tag and the text after it to *nothing*, so a mixed form silently
 * loses a space at the join. `scope` therefore ends in the words that become the link, and
 * `scopeLinkLabel` (with its own leading space) is appended straight onto it with no
 * whitespace of its own to collapse, then `scopeEnd` supplies the closing full stop. They are
 * flex items and the gap does the spacing between `welcome` and `scope`, which is also what
 * lets each part drop onto its own line on a phone.
 */
export const SITE_BANNER = {
  /** The club website as it stands today — everything that is not `/nn` or `/timing`. */
  clubWebsite: 'https://southvillerunningclub.co.uk',
  welcome: "Welcome to Southville Running Club's new website.",
  /** Ends right before the linked words, with its own trailing space. */
  scope:
    "We just have Nightingale Nightmare for now — the rest of the club's website is " +
    'still on ',
  /**
   * The words that become the inline link to `clubWebsite`. Short deliberately: with the
   * hostname spelled out this wrapped to two lines on a 320px phone and the banner ate a
   * third of the first screen. The wording still says where it goes when a screen reader
   * reads it out of a link list, which "click here" never does.
   */
  scopeLinkLabel: 'the old site',
  /** The full stop that closes the sentence after the link. */
  scopeEnd: '.',
} as const;

/**
 * The bar that gets you between the parts of this site.
 *
 * **They had no route between them at all until this existed.** `/` linked on to `/nn/` and
 * `/timing` in a sentence of prose; nothing linked back, and `/account/` was reachable only by
 * typing it. Somebody who signed in and then wanted the race page had to edit the address bar.
 *
 * ## Where this bar appears, and where it must not
 *
 * **Club pages and the account area. Never on a Nightingale Nightmare page** — a layout
 * decision rather than a taste one. Those pages carry their own bar, stuck to the top, whose
 * height is paid for by a hand-written `scroll-padding-top` token per breakpoint
 * ([ADR-014](../../../../docs/architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md)).
 * A second bar above it moves every anchor and every keyboard focus behind the header, at every
 * width, with nothing visibly wrong. `Base.astro` keys off `theme === 'nn'`, which those pages
 * already carry.
 *
 * **They are not stranded by that.** `NnMasthead` has linked the club wordmark to `/` since it
 * was written, so the route home exists there already — as the mark rather than a tab, which
 * costs no height in a bar where height is the constrained resource.
 *
 * ## Labels
 *
 * `Account`, not `My account` or `Sign in`. **The club pages are static**, so nothing rendering
 * this bar on `/` knows whether anybody is signed in, and a label promising one state while
 * delivering the other is worse than a neutral one. `/account/` redirects to sign-in when there
 * is no session, so the destination is right either way.
 *
 * `match` is a shape rather than an href — the same convention `NnNav` uses — so a section
 * marks itself current from any page inside it.
 */
export const SITE_NAV = [
  { href: '/', label: 'Home', match: /^\/$/u },
  { href: '/nn/', label: 'Nightingale Nightmare', match: /^\/nn(\/|$)/u },
  { href: '/timing', label: 'Race timing', match: /^\/timing(\/|$)/u },
  { href: '/account/', label: 'Account', match: /^\/account(\/|$)/u },
] as const;
