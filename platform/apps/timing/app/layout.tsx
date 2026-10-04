import type { Metadata } from 'next';
// The same stylesheet apps/main uses, imported rather than copied. See packages/shared. It
// pulls in `tokens.css`, which is where the club's brand actually lives — so this app is on
// the club's palette by importing one file, and stays on it without a second edit here.
import '@src/shared/styles/base.css';
// The club website's header, section bars, breadcrumbs, focus header and footer — ADR-052.
// **After `base.css`, and never `club.css`**: every rule in this one is `.club-*`-scoped, so the
// pages' own bodies are drawn by `base.css` exactly as before, where `club.css` would restyle
// every bare `h1`, `p` and `a` on them.
import '@src/shared/styles/club-chrome.css';
// The club website's content components and the timing layer, both opt-in by class — ADR-054
// and `docs/timing/nn-timing-redesign-brief.md`. **In this order, and after the two above**:
// `timing.css` scopes its restatements of `club.css`'s bare rules with `:where()`, so they tie
// with `base.css` on specificity and win only because they load later. Loading them changes no
// page until a frame puts `.timing-ui` around it.
import './styles/club-content.css';
import './styles/timing.css';

export const metadata: Metadata = {
  // **A browser tab is consumer-facing too.** This said "Race timing — deployment skeleton",
  // with a description about proving the platform could run on Cloudflare Workers — which is
  // what somebody saw in their tab strip, in their history, and in anything they shared.
  title: 'Race timing — Southville Running Club',
  description: 'Live results and finish times for Southville Running Club races.',
  // Still `noindex`: the page is honest now, but it is a holding page, and there is no reason
  // for it to be the club's first search result for its own race timing.
  robots: { index: false, follow: false },
  // The old site (southvillerunningclub.co.uk, still Squarespace) sets no theme-color meta
  // tag at all, so there is nothing there to match. This is the club's own brand green from
  // tokens.css's `--src-green`, applied the same way apps/main now does.
  themeColor: '#00c85a',
  // **`/favicon.svg`, not a copy of it under `/timing`.** The tab strip is the one place the
  // club appears as three letters — `CLUB_MONOGRAM`, because a wordmark at 16px is a smear —
  // and this app had no icon at all, so `/timing` showed a browser's blank page glyph beside
  // two club-branded tabs.
  //
  // The file is `apps/main/public/favicon.svg`, served by the club's Worker at the root of
  // the same hostname: `/timing` is one path on `new.southvillerunningclub.co.uk`, not a site
  // of its own, so a second copy of the artwork here would be a second thing to keep in step
  // for no gain. **The leading slash is load-bearing** — `basePath: '/timing'` prefixes
  // `next/link` and nothing in `metadata`, which is what lets this point outside the app; the
  // Playwright assertion in `site.spec.ts` is what would catch that changing.
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
  /**
   * The web app manifest — [#203](https://github.com/southville-running-club/src-website/issues/203).
   *
   * ⚠️ **`/timing/manifest.webmanifest` is written out in full for the reason the favicon
   * above is not**: `basePath` prefixes `next/link` and nothing in `metadata`, so a bare
   * `/manifest.webmanifest` would point at the club's Worker, which does not serve one. The
   * file is `apps/timing/public/`, which Next serves under the base path.
   *
   * It exists so a marshal can put the capture screen on a home screen and open it as an
   * application rather than a tab — which on a phone in a pocket, on a course, is the
   * difference between a screen that survives and one that gets swiped away. `scope` and
   * `start_url` are `/timing/`, matching the service worker's.
   *
   * ⚠️ **Its only icon is the club's SVG, and a PNG pair is owed.** Chrome accepts an SVG with
   * `sizes: "any"`; iOS does not, and will use a screenshot of the page instead. Committing a
   * 192px and a 512px PNG is what closes that, and it is artwork rather than code — it belongs
   * with #256's runbook work, not invented here.
   */
  manifest: '/timing/manifest.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        {/* **The document and nothing else.** Which header a page wears depends on what only the
            page knows — which race, what it is called, which tab is current — so every page
            wraps itself in one of the frames in `app/chrome/frames.tsx`, and `lib/chrome.ts`'s
            route table, held by `tests/unit/chrome.test.ts`, says which. The skip link, the
            header, `<main id="main">` and the footer are all drawn there. */}
        {children}
      </body>
    </html>
  );
}
