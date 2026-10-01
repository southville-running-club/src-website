import { describe, expect, it } from 'vitest';
import { CLUB_HOME, CLUB_NAV, activeClubNavItem } from '../../src/club-nav';

// `activeClubNavItem()` is the one answer to "which link in the club bar is this page's
// section". The Astro header, its phone menu and the Worker's copy for `/account/**` and
// `/admin/**` all ask it, so a wrong answer here is a wrong `aria-current` on every surface at
// once — which is why each frozen address is pinned by name rather than by pattern.

function activeLabel(pathname: string): string | undefined {
  return activeClubNavItem(pathname)?.label;
}

describe('activeClubNavItem', () => {
  it.each([
    ['/run-with-us/', 'Run with us'],
    ['/events/', 'Races and events'],
    ['/events/christmas-party-2026/', 'Races and events'],
    ['/events/christmas-party-2026/complete/', 'Races and events'],
    ['/membership/', 'Membership'],
    ['/membership/join/', 'Membership'],
    ['/membership/join/complete/', 'Membership'],
    ['/news/', 'News'],
    ['/about/', 'About'],
    ['/account/', 'Account'],
    ['/account/sign-in/', 'Account'],
    ['/account/entries/', 'Account'],
    ['/account/reset/confirm/', 'Account'],
  ])('marks %s as %s', (pathname, label) => {
    expect(activeLabel(pathname)).toBe(label);
  });

  // ⚠️ `/nn/**` highlights "Races and events" on purpose, and the comment on `CLUB_NAV` says
  // why: the race pages render `NnNav` rather than this bar today, so nothing visible depends
  // on it, and the mapping is right on the day they move across.
  it.each(['/nn/', '/nn/2026/', '/nn/2026/entry/complete/', '/nn/privacy/'])(
    'marks %s as Races and events',
    (pathname) => {
      expect(activeLabel(pathname)).toBe('Races and events');
    },
  );

  // The same boundary `isTimingPath()` routes by: the prefix itself, or the prefix and a slash.
  it.each(['/timing', '/timing/', '/timing/events', '/timing/events/nn-2026/console'])(
    'marks %s as Races and events',
    (pathname) => {
      expect(activeLabel(pathname)).toBe('Races and events');
    },
  );

  it.each(['/timings', '/timing-results/', '/eventsx/', '/accounts/', '/news-letter/'])(
    'does not mistake %s for a section it only starts like',
    (pathname) => {
      expect(activeClubNavItem(pathname)).toBeUndefined();
    },
  );

  it.each(['/', '/privacy/', '/brand/', '/admin/', '/admin/nn/', '/no-such-page/'])(
    'marks nothing in the bar on %s',
    (pathname) => {
      expect(activeClubNavItem(pathname)).toBeUndefined();
    },
  );

  it('leaves the home page to the wordmark', () => {
    expect(CLUB_HOME.match.test('/')).toBe(true);
    expect(activeClubNavItem('/')).toBeUndefined();
  });

  it('can never mark two items, because no pathname matches two', () => {
    const samples = [
      '/run-with-us/',
      '/events/',
      '/nn/2026/',
      '/timing/events',
      '/membership/join/',
      '/news/',
      '/about/',
      '/account/data/',
    ];
    for (const pathname of samples) {
      expect(CLUB_NAV.filter(({ match }) => match.test(pathname))).toHaveLength(1);
    }
  });

  it('returns the item itself, so a renderer can compare by identity', () => {
    expect(activeClubNavItem('/news/')).toBe(
      CLUB_NAV.find(({ label }) => label === 'News'),
    );
  });
});
