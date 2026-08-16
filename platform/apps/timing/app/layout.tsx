import type { Metadata } from 'next';
// The same stylesheet apps/main uses, imported rather than copied. See packages/shared. It
// pulls in `tokens.css`, which is where the club's brand actually lives — so this app is on
// the club's palette by importing one file, and stays on it without a second edit here.
import '@src/shared/styles/base.css';
import { SiteBanner } from './site-banner';
import { SiteFooter } from './site-footer';

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {/* Above `<main>`, like it is on the club's side, so "Skip to content" keeps meaning
            what it says rather than skipping to something that is already behind it. */}
        <SiteBanner />
        <main id="main">{children}</main>
        {/* Below `<main>`, like it is on the club's side, and for the same reason: a
            `<footer>` outside `main` is the page's one `contentinfo` landmark. */}
        <SiteFooter />
      </body>
    </html>
  );
}
