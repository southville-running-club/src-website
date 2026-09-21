// ⚠️ **`URL` is imported from `node:url`, not taken from the global.** This project's tsconfig
// pulls in the DOM lib, so the ambient `URL` is the DOM one — and `fileURLToPath` wants Node's,
// which is a different type with a different iterator. The error names `searchParams.entries()`
// and `Symbol.dispose`, which says nothing at all about the actual problem. `nn-nav.test.ts`
// and `events.test.ts` already import it this way; this is that, copied.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PRICE_TO_BE_CONFIRMED,
  clubSchema,
  committeeSchema,
  linksSchema,
  membershipSchema,
  newslettersSchema,
  paceSchema,
  parseClub,
  parseCommittee,
  parseLinks,
  parseMembership,
  parseNewsletters,
  parseEvents,
  parsePace,
  parsePartners,
  partnersSchema,
  comingUpOn,
  eventsSchema,
} from '@src/shared/club-content';
import { formatPriceWords } from '@src/shared/money';

/**
 * The club's content files, and the behaviour that keeps a placeholder off the site.
 *
 * ## Two jobs
 *
 * **The schemas actually accept the real files.** A schema nothing validates against is a
 * schema that drifts from its data, and the failure would be a build error on a page nobody
 * edited. These read the committed JSON rather than a fixture, so a hand edit to a content
 * file is caught here rather than at deploy.
 *
 * **An absent fact renders honestly.** This is the half that matters. The rule is *"never
 * ship a placeholder"*, and the alternative to a tested behaviour is not a tidier convention —
 * it is `undefined` reaching a page, a bracketed marker surviving a copy-paste, or somebody
 * filling in a plausible number for the England Athletics licence because three are quoted on
 * the old site and one of them is probably right.
 */

const content = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../src/content/${name}`, import.meta.url)),
      'utf8',
    ),
  );

describe('the content files parse', () => {
  it.each([
    ['club.json', parseClub],
    ['links.json', parseLinks],
    ['pace.json', parsePace],
    ['membership.json', parseMembership],
    ['partners.json', parsePartners],
    ['committee.json', parseCommittee],
    ['newsletters.json', parseNewsletters],
    ['events.json', parseEvents],
  ])('%s', (name, parse) => {
    expect(() => parse(content(name))).not.toThrow();
  });
});

describe('the schemas refuse a malformed file', () => {
  /**
   * ⚠️ **Each of these is a real shape of mistake rather than arbitrary rubbish.** A schema
   * that only rejects `null` is a schema that will accept the edit somebody actually makes.
   */
  it('refuses a club file missing the map link', () => {
    const club = content('club.json') as Record<string, unknown>;
    const meet = { ...(club.meet as Record<string, unknown>) };
    delete meet.mapUrl;

    expect(() => clubSchema.parse({ ...club, meet })).toThrow();
  });

  it('refuses a map link that is not a URL', () => {
    const club = content('club.json') as Record<string, unknown>;
    const meet = { ...(club.meet as Record<string, unknown>), mapUrl: 'BS3 1DB' };

    expect(() => clubSchema.parse({ ...club, meet })).toThrow();
  });

  it('refuses a link whose `where` is neither old nor new', () => {
    const links = content('links.json') as Record<string, unknown>;
    const join = { ...(links.join as Record<string, unknown>), where: 'somewhere' };

    expect(() => linksSchema.parse({ ...links, join })).toThrow();
  });

  it('refuses a links file with a key missing', () => {
    const links = { ...(content('links.json') as Record<string, unknown>) };
    delete links.committee;

    expect(() => linksSchema.parse(links)).toThrow();
  });

  it('refuses a newsletter month that is not YYYY-MM', () => {
    for (const month of ['July 2026', '2026-7', '2026-13', '26-07', '']) {
      expect(
        () => newslettersSchema.parse({ issues: [{ month, title: 'An issue' }] }),
        month,
      ).toThrow();
    }
  });

  it('refuses an empty pace table', () => {
    expect(() => paceSchema.parse({ rows: [], alsoRunning: 'and the rest' })).toThrow();
  });

  it('refuses a partner with no category', () => {
    expect(() =>
      partnersSchema.parse({ categories: ['Coaching'], partners: [{ name: 'Someone' }] }),
    ).toThrow();
  });

  it('refuses a committee role that is an empty string', () => {
    expect(() =>
      committeeSchema.parse({
        officers: [{ role: '' }],
        volunteers: [{ role: 'Web Manager' }],
      }),
    ).toThrow();
  });

  it('refuses a negative price', () => {
    const membership = content('membership.json') as Record<string, unknown>;

    expect(() =>
      membershipSchema.parse({ ...membership, membershipPerYearPence: -400 }),
    ).toThrow();
  });
});

describe('an absent fact renders honestly', () => {
  /**
   * ⚠️ **The England Athletics licence price, which is the sharpest case on the site.**
   *
   * The old site quotes **£23, £24 and £27** and the club has not said which is right. So the
   * card reads "Price to be confirmed" and still links to Join. What it may never do is pick
   * one of the three, render `£NaN`, render an empty string, or render the word `null` —
   * every one of which is a plausible outcome of somebody "simplifying" the branch away.
   */
  it('renders the England Athletics price as to-be-confirmed while it is null', () => {
    const membership = parseMembership(content('membership.json'));

    expect(membership.englandAthleticsPence).toBeNull();

    const shown =
      membership.englandAthleticsPence === null
        ? PRICE_TO_BE_CONFIRMED
        : formatPriceWords(membership.englandAthleticsPence);

    expect(shown).toBe('Price to be confirmed');
    expect(shown).not.toBe('');
    expect(shown).not.toContain('undefined');
    expect(shown).not.toContain('null');
    expect(shown).not.toContain('NaN');
    // And it is not quietly one of the three figures the old site quotes.
    for (const guess of ['£23', '£24', '£27']) expect(shown).not.toContain(guess);
  });

  it('renders a supplied England Athletics price through formatPriceWords', () => {
    // The other half of the branch, so that confirming the figure is a one-key edit and the
    // rendering is already proved.
    const shown = formatPriceWords(2400);

    expect(shown).toBe('£24');
  });

  it('shows the club’s own prices in the club’s own words', () => {
    const m = parseMembership(content('membership.json'));

    // "Run for 50p. Join for £4." — the page's heading, and what these have to produce.
    expect(formatPriceWords(m.payPerRunPence)).toBe('50p');
    expect(formatPriceWords(m.membershipPerYearPence)).toBe('£4');
    expect(formatPriceWords(m.subscriptionPerMonthPence)).toBe('£2.50');
  });

  /**
   * No partner has agreed an offer, so no card may state one. This asserts the **data**, not
   * a rendering: the page cannot show an offer line it has nothing to fill.
   */
  it('carries no partner offer until one is confirmed', () => {
    const { partners } = parsePartners(content('partners.json'));

    expect(partners.length).toBeGreaterThan(0);
    for (const partner of partners) {
      expect(
        partner.offer,
        `${partner.name} has an unconfirmed offer on it`,
      ).toBeUndefined();
      expect(partner.category).not.toMatch(/\[|placeholder|tbc|confirm/iu);
    }
  });

  it('names no committee member until the club supplies one', () => {
    const { officers, volunteers } = parseCommittee(content('committee.json'));

    for (const person of [...officers, ...volunteers]) {
      expect(person.name, `${person.role} has a name on it`).toBeUndefined();
      expect(person.role).not.toMatch(/\[|name|placeholder/iu);
    }
  });

  it('marks exactly the two welfare roles', () => {
    const { officers, volunteers } = parseCommittee(content('committee.json'));
    const welfare = [...officers, ...volunteers].filter((p) => p.welfare === true);

    // Somebody looking for these is usually looking for them urgently.
    expect(welfare.map((p) => p.role)).toEqual([
      'Lead Welfare Officer',
      'Welfare Officer',
    ]);
  });

  /**
   * ⚠️ **No issue has a per-issue address**, so every card links to the archive instead. A
   * guessed URL is worse than the archive: it 404s on the old site, where the club cannot fix
   * it, and nothing here would notice.
   */
  it('links no newsletter to a guessed address', () => {
    const { issues } = parseNewsletters(content('newsletters.json'));

    for (const issue of issues) {
      expect(issue.href, `${issue.title} has a guessed address`).toBeUndefined();
      expect(issue.summary, `${issue.title} has a placeholder summary`).toBeUndefined();
      expect(issue.title).not.toMatch(/\[|placeholder|summary/iu);
    }
  });

  it('runs monthly from December 2024 to the latest issue, with no gaps', () => {
    const { issues } = parseNewsletters(content('newsletters.json'));
    const months = issues.map((i) => i.month);

    // Newest first, which is the order the page renders.
    expect([...months].sort().reverse()).toEqual(months);
    expect(months.at(-1)).toBe('2024-12');
    expect(new Set(months).size, 'an issue is listed twice').toBe(months.length);

    // A gap is the failure this catches: a month quietly missing reads as a month the club
    // skipped, which is a claim about the club's own record.
    const step = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
    for (let i = 1; i < months.length; i += 1) {
      expect(step(months[i - 1]!) - step(months[i]!), `a gap before ${months[i]!}`).toBe(
        1,
      );
    }
  });
});

describe('links.json is the only place an old-site address lives', () => {
  it('points every old-site action at an absolute address', () => {
    const links = parseLinks(content('links.json'));

    for (const [key, link] of Object.entries(links)) {
      if (link.where === 'old-site') {
        expect(link.href, `${key} is not absolute`).toMatch(/^https:\/\//u);
      } else {
        // A new-site address is root-relative **with the trailing slash**: `trailingSlash` is
        // `'always'`, and `/x` against `/x/` is two answers for one page.
        expect(link.href, `${key} is not root-relative`).toMatch(/^\/[^/]/u);
        expect(link.href.endsWith('/'), `${key} has no trailing slash`).toBe(true);
      }
      expect(link.label.trim()).not.toBe('');
    }
  });

  /**
   * ⚠️ **There is no `kit-order` key.** Club kit is out of scope for this build, and an
   * address for it sitting unused in this file is how it quietly comes back.
   */
  it('carries no key for anything out of scope', () => {
    expect(Object.keys(content('links.json') as object)).not.toContain('kit-order');
  });
});

describe('what is coming up', () => {
  const events = parseEvents(content('events.json'));

  it('links Nightingale Nightmare at the evergreen address', () => {
    const race = events.comingUp.find((e) => e.key === 'nightingale-nightmare');

    // ⚠️ **`/nn/` and not `/nn/2026/`.** That address paints on whichever running is current,
    // so the card keeps working when 2027 is published — and the entry journey from there is
    // untouched by this change.
    expect(race?.href).toBe('/nn/');
  });

  it('takes its date from race.json rather than restating one', () => {
    const race = events.comingUp.find((e) => e.key === 'nightingale-nightmare');

    expect(race?.dateFrom).toBe('race');

    // A copy here would be a second place to change it, and the failure is silent: a card
    // showing last year's date looks exactly like one showing this year's.
    expect(race?.startsAt).toBeUndefined();

    // ⚠️ **The words a reader sees, not the whole entry.** `showUntil` is `2026-11-01…` and
    // has to be — it is when the card stops being "coming up", which is a different fact from
    // the date printed on it and cannot be derived from `race.json`. An earlier version of
    // this assertion stringified the entry and failed on that, which would have pushed
    // somebody towards deleting the expiry rather than the duplication.
    for (const shown of [race?.title, race?.summary, race?.cta]) {
      expect(shown ?? '', 'a date is written into the card').not.toMatch(
        /\b(20\d\d|January|February|March|April|May|June|July|August|September|October|November|December)\b/u,
      );
    }
  });

  it('refuses an href that is not root-relative with a trailing slash', () => {
    for (const href of ['/nn', 'nn/', 'https://example.com/nn/', '//nn/']) {
      expect(
        () =>
          eventsSchema.parse({
            comingUp: [
              { key: 'x', title: 'x', summary: 'x', href, cta: 'x', dateFrom: 'own' },
            ],
          }),
        href,
      ).toThrow();
    }
  });

  /**
   * ⚠️ **The clocks-change weekend, which is why this filter compares instants.**
   *
   * British Summer Time ends at 02:00 BST on Sunday 25 October 2026, and Nightingale
   * Nightmare is run the **following** Sunday. A filter built on a civil date — anything of
   * the shape `new Date().toISOString().slice(0, 10)` — names the wrong day for an hour on a
   * BST morning, and this is precisely the week it would matter.
   *
   * Two instants have no timezone to get wrong, and these assert that across the change.
   */
  it('keeps the race card through the clocks-change weekend', () => {
    for (const instant of [
      '2026-10-24T22:30:00Z', // Saturday evening, still BST
      '2026-10-25T00:30:00Z', // 01:30 BST — before the change
      '2026-10-25T01:30:00Z', // the repeated hour: 01:30 GMT
      '2026-10-25T02:30:00Z', // after the change
      '2026-11-01T09:00:00Z', // race morning
      '2026-11-01T23:00:00Z', // race night, still showing
    ]) {
      const shown = comingUpOn(events, new Date(instant)).map((e) => e.key);

      expect(shown, `the race card vanished at ${instant}`).toContain(
        'nightingale-nightmare',
      );
    }
  });

  it('drops the race card once the race has been run', () => {
    // The single most embarrassing thing for a club's front page to still be advertising.
    const shown = comingUpOn(events, new Date('2026-11-02T00:00:00Z')).map((e) => e.key);

    expect(shown).not.toContain('nightingale-nightmare');
  });

  it('keeps an entry that never expires', () => {
    // There is always a latest newsletter, so that card carries no `showUntil` at all.
    const newsletter = events.comingUp.find((e) => e.key === 'latest-newsletter');
    expect(newsletter?.showUntil).toBeUndefined();

    const shown = comingUpOn(events, new Date('2030-01-01T00:00:00Z')).map((e) => e.key);
    expect(shown).toContain('latest-newsletter');
  });

  /** ⚠️ Club kit is out of scope, and an entry for it is how it quietly returns. */
  it('carries no club kit entry', () => {
    for (const entry of events.comingUp) {
      expect(entry.title.toLowerCase()).not.toContain('kit');
    }
  });
});
