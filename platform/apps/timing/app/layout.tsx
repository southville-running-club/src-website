import type { Metadata } from 'next';
// The same stylesheet apps/main uses, imported rather than copied. See packages/shared. It
// pulls in `tokens.css`, which is where the club's brand actually lives — so this app is on
// the club's palette by importing one file, and stays on it without a second edit here.
import '@src/shared/styles/base.css';
import { SiteBanner } from './site-banner';

export const metadata: Metadata = {
  // **A browser tab is consumer-facing too.** This said "Race timing — deployment skeleton",
  // with a description about proving the platform could run on Cloudflare Workers — which is
  // what somebody saw in their tab strip, in their history, and in anything they shared.
  title: 'Race timing — Southville Running Club',
  description: 'Live results and finish times for Southville Running Club races.',
  // Still `noindex`: the page is honest now, but it is a holding page, and there is no reason
  // for it to be the club's first search result for its own race timing.
  robots: { index: false, follow: false },
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
      </body>
    </html>
  );
}
