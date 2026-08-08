import type { Metadata } from 'next';
// The same stylesheet apps/main uses, imported rather than copied. See packages/shared.
import '@src/shared/styles/base.css';

export const metadata: Metadata = {
  title: 'Race timing — deployment skeleton',
  description: 'A placeholder proving the timing platform can run on Cloudflare Workers.',
  // Nothing here is finished, and none of it should be found in a search yet.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
