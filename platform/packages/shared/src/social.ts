/**
 * The club's social profiles, and the artwork for each — one list, both front doors.
 *
 * **This moved out of `apps/main` because `/timing` needed the same footer.** It was four
 * `?raw` imports and a regular expression that pulled the `d` out of each file, which is a
 * Vite feature: Astro has it, Next does not, and copying the addresses into a second app
 * would have been two lists to keep in step. `simple-icons` publishes the same marks as an
 * ordinary ES module — `{ title, slug, hex, path }` per icon — so both bundlers can read it
 * and neither app owns the list.
 *
 * The icons stay a pinned dependency rather than hand-copied artwork, which is what makes
 * `npm outdated` able to tell the club a brand has changed its mark. `hex` is deliberately
 * not used: every icon is filled with `currentColor` so the footer decides its own colour,
 * the same way `CLUB_LOGO` is filled by whichever stylesheet is in charge.
 */
import { siFacebook, siInstagram, siTiktok, siX } from 'simple-icons';

export interface SocialLink {
  /** The accessible name of the link. The platform, not "our Instagram". */
  name: string;
  href: string;
  /** The mark's path data, drawn in a 24x24 viewBox. */
  d: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/southvillerunningclub/',
    d: siInstagram.path,
  },
  {
    name: 'Facebook',
    href: 'https://www.facebook.com/groups/22333122208',
    d: siFacebook.path,
  },
  {
    // The platform's current brand is "X"; the club's own link is still its legacy
    // twitter.com address, which X still resolves.
    name: 'X',
    href: 'https://twitter.com/SouthvilleRC',
    d: siX.path,
  },
  {
    name: 'TikTok',
    href: 'https://www.tiktok.com/@southvillerunningclub',
    d: siTiktok.path,
  },
] as const;

/** Every `simple-icons` mark is drawn in this box, so the markup states it rather than each entry. */
export const SOCIAL_ICON_VIEWBOX = '0 0 24 24';
