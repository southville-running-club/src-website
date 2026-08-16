// The bar that says which site this is — the same one `/` and `/nn` carry.
//
// **The opposite number of `apps/main/src/components/SiteBanner.astro`.** Every word comes
// from `SITE_BANNER` in `@src/shared/brand`, so the copy cannot drift between the two front
// doors; only the tags are duplicated. `apps/main/tests/worker/serves.test.ts` asserts both
// render the same sentence.
//
// **A `div`, not a `header`.** A `<header>` outside `main` maps to the `banner` landmark.
// `/timing` has no masthead today, so there would be nothing to compete with — but the rule
// this bar follows on the club's side is the reason it is a `div` there, and a bar that is a
// landmark on one path and not on the other is precisely the inconsistency this change is
// meant to end.
//
// **Why `/timing` never had one.** It imported `base.css` and nothing else: the club's
// colours with none of the club's identity, on a page whose entire message is "not open yet".
// Somebody landing here from a search had no route back to the club at all.
import { ClubLogo } from './club-logo';
import { SITE_BANNER } from '@src/shared/brand';

export function SiteBanner() {
  return (
    <div className="site-banner">
      <div className="site-banner-inner">
        {/* The mark links home rather than being decoration. On this path it matters more
            than it does on the club's own pages: it is the only route back. */}
        <a
          className="site-banner-mark"
          href="/"
          aria-label="Southville Running Club, home"
        >
          <ClubLogo className="site-logo" width={132} labelled={false} />
        </a>

        <p>
          {/* Three parts, each its own element rather than one sentence with tags inside it.
              They are flex items and the gap does the spacing, which is what lets each part
              drop onto its own line on a phone. */}
          <strong>{SITE_BANNER.welcome}</strong>
          <span>{SITE_BANNER.scope}</span>
          <a href={SITE_BANNER.clubWebsite}>{SITE_BANNER.clubWebsiteLabel}</a>
        </p>
      </div>
    </div>
  );
}
