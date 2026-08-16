// The one footer, rendered below `<main>` on every `/timing` page.
//
// **The opposite number of `apps/main/src/components/SiteFooter.astro`.** The addresses and
// the artwork are `SOCIAL_LINKS` in `@src/shared/social`; only the tags are duplicated,
// which is the honest price of Astro on one side of the hostname and Next on the other.
//
// **Why `/timing` had no footer.** The club's front door grew one and this app did not, so
// somebody who landed here from a search had the club's colours, the club's banner, and no
// way to reach the club anywhere it actually posts. The bar at the top links to the old
// site; this links to the places the club is read.
//
// Outside `<main>`, which is what makes it the page's single `contentinfo` landmark — the
// holding page's own sign-off `<footer>` is inside `<main>` and is therefore generic, the
// same arrangement `/` uses.
import { SOCIAL_ICON_VIEWBOX, SOCIAL_LINKS } from '@src/shared/social';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer-heading">Follow the club</p>
      <ul className="site-footer-social">
        {SOCIAL_LINKS.map((link) => (
          <li key={link.name}>
            <a href={link.href} aria-label={link.name}>
              {/* `aria-hidden` on the mark and the name on the link: an icon row where every
                  link is announced as "graphic" is a link list nobody can navigate. */}
              <svg
                viewBox={SOCIAL_ICON_VIEWBOX}
                width="24"
                height="24"
                aria-hidden="true"
                focusable="false"
              >
                <path d={link.d} fill="currentColor" />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
