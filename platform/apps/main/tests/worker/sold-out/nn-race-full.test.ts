import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  checkNnEntryCapacity,
  renderNnEntryView,
  renderNnNav,
  renderNnRaceView,
  type NnEntryView,
  type NnRaceView,
  type NnRunning,
} from '../../../worker/nn-entry';
import type { EntryState } from '@src/shared';

/**
 * **A race that is full before anybody opens the page** — ADR-070.
 *
 * `nn-entry-sold-out.test.ts` beside this is about the other moment: the last place going
 * while somebody was filling the form in, where the answer is the sold-out notice over a form
 * that still holds everything they typed. This file is about everybody who arrives afterwards,
 * who until 27 October 2026 were served the same twenty-field form, a filled "Enter the race"
 * button and "0 places left", and only found out at the end.
 *
 * Two halves, and they are proved differently on purpose:
 *
 *   * **Through the Worker**, against this run's real sold-out event (`global-setup.ts` books
 *     the only place). What matters is what a browser receives, on all three pages that carry
 *     a way in: the year page, `/nn/`, and the bar's button on every campaign page.
 *
 *   * **Against the renderers directly**, for the states the seeded database cannot hold in
 *     the same run — above all a count that could not be read, which must leave the form up.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

const get = (path: string): Promise<string> =>
  SELF.fetch(`${SITE}${path}`).then((response) => response.text());

/**
 * Every opening tag carrying this attribute **exactly** — `data-nn-panel` does not match
 * `data-nn-panel-full`, and `data-nn-cta` does not match the bar's `data-nn-nav-cta`.
 */
const tagsWith = (html: string, marker: string): string[] =>
  html.match(new RegExp(`<[^>]*\\s${marker}(?=[\\s>=])[^>]*>`, 'g')) ?? [];

/**
 * `hidden` on the first element carrying this attribute, in whichever order the two appear —
 * `HideHandler` appends it at the end of a tag the markup shipped visible.
 */
const isHidden = (html: string, marker: string): boolean => {
  const [tag] = tagsWith(html, marker);

  if (tag === undefined) {
    throw new Error(`no element carries ${marker}`);
  }

  return /\shidden(?=[\s>=])/.test(tag);
};

describe('the year page, when every place has gone before it loads', () => {
  it('says the race is full, in place of the form', async () => {
    const response = await SELF.fetch(`${SITE}/nn/2026/`);
    const html = await response.text();

    // An ordinary page, not a refusal: nobody asked for anything that was refused.
    expect(response.status).toBe(200);
    expect(isHidden(html, 'data-nn-full')).toBe(false);
    expect(html).toContain('<h2>The race is full</h2>');
    expect(isHidden(html, 'data-nn-entry')).toBe(true);
  });

  it('offers no way in that looks live', async () => {
    const html = await get('/nn/2026/');

    // **Every hero button**, not merely the first — the page carries three, and the one that
    // follows the reader down the page is the easiest to forget.
    const ctas = tagsWith(html, 'data-nn-cta');
    expect(ctas.length).toBeGreaterThan(0);
    for (const tag of ctas) {
      expect(tag).toMatch(/\shidden\b/);
    }

    // The interest form asks to be told when entries *open*, and they are open.
    expect(isHidden(html, 'data-nn-interest')).toBe(true);
    expect(isHidden(html, 'data-nn-closed')).toBe(true);
    // "Entries open — Tuesday 1 September" is a date that has been and gone.
    expect(isHidden(html, 'data-nn-entries-open')).toBe(true);
  });

  it('says so on the sticky entry card, in the button’s place', async () => {
    // The card follows the reader down the page. With its button hidden and nothing in its
    // place it was a price beside every paragraph of a race nobody could enter.
    const html = await get('/nn/2026/');
    const start = html.indexOf(' data-nn-card-full');
    const card = html.slice(start, html.indexOf('</div>', start));

    expect(isHidden(html, 'data-nn-card-full')).toBe(false);
    expect(card).toContain(
      '<strong>The race is full.</strong> Every place has been taken.',
    );
    // To the notice, which is where the email sentence is — and the notice has to carry the id.
    expect(card).toContain('href="#race-full"');
    expect(tagsWith(html, 'data-nn-full')[0]).toContain('id="race-full"');
  });

  it('gives the address the sold-out notice already offers, word for word', async () => {
    // Two wordings of one offer would be two offers. The notice somebody meets when the last
    // place goes under them is where this sentence was first published.
    const html = await get('/nn/2026/');
    const start = html.indexOf(' data-nn-full');
    const full = html.slice(start, html.indexOf('</div>', start));

    expect(full).toContain(
      'If you would like to be told about a place if one comes back, email',
    );
    expect(full).toMatch(/href="mailto:[^"]+@[^"]+"/);
    expect(full).toContain('href="/nn/2026/race-day/"');
  });

  it('still states the price, which is a fact about the race rather than an offer', async () => {
    // The facts list quotes the fee in every state but an unreachable database.
    expect(await get('/nn/2026/')).toMatch(/data-nn-fee[^>]*>£20\.00 unaffiliated/);
  });

  it('labels the bar’s button for what the page now offers', async () => {
    // "Enter" over a page with no form on it is the control this change exists to retire. It
    // borrows the closed pair, because the destination offers what a closed one does.
    for (const path of ['/nn/2026/', '/nn/2026/race-day/', '/nn/privacy/']) {
      const html = await get(path);

      expect(html, path).toContain('aria-label="Race details"');
      expect(html, path).not.toContain('aria-label="Enter the race"');
    }
  });
});

describe('the race page, when every place has gone', () => {
  const panel = (html: string): string => {
    const start = html.indexOf('data-nn-panel');
    return start === -1 ? '' : html.slice(start, html.indexOf('</section>', start));
  };

  it('says so in place of the fee line, and does not shout "Enter"', async () => {
    const html = panel(await get('/nn/'));

    expect(isHidden(html, 'data-nn-panel-full')).toBe(false);
    expect(html).toContain('the race is full');
    expect(isHidden(html, 'data-nn-panel-open')).toBe(true);
    expect(isHidden(html, 'data-nn-panel-shut')).toBe(true);

    // The outlined action every non-open state uses, to the running's own page — which is
    // where how to ask about a place that comes back is said.
    expect(html).toMatch(/class="nn-ghost"[^>]*href="\/nn\/2026\/"/);
    expect(html).toContain('The 2026 race');
    expect(html).not.toContain('Enter the race');
  });
});

describe('a submission that loses the last place still keeps its form', () => {
  it('re-renders the form under the sold-out notice, not the full page', async () => {
    // **The reason the capacity question is asked by the GET alone.** Asked here too, it would
    // hide the form — and every value in it — on the one submission the sold-out notice
    // promises to keep them for. `nn-entry-sold-out.test.ts` asserts the values themselves.
    const response = await SELF.fetch(`${SITE}/nn/2026/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        form: 'entry',
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'race-full@example.com',
        emailConfirm: 'race-full@example.com',
        dobDay: '9',
        dobMonth: '12',
        dobYear: '1986',
        gender: 'female',
        feeCode: 'unaffiliated',
        emergencyName: 'Margaret Hamilton',
        phone: '0117 496 0100',
        emergencyPhone: '0117 496 0000',
        entryTerms: 'on',
      }),
      redirect: 'manual',
    });
    const html = await response.text();

    expect(response.status).toBe(409);
    expect(isHidden(html, 'data-entry-soldout')).toBe(false);
    expect(isHidden(html, 'data-nn-entry')).toBe(false);
    expect(isHidden(html, 'data-nn-full')).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------
// The renderers, driven directly
// -----------------------------------------------------------------------------------------

const STATE: EntryState = {
  slug: 'nn-2026',
  displayName: 'Nightingale Nightmare 2026',
  state: 'open',
  eventDate: { year: 2026, month: 11, day: 1 },
  startTime: '11:00:00',
  entrantsPerEntry: 1,
  capacity: 250,
  minimumAge: 18,
  requiresDob: true,
  consentVersion: 'nn-2026-v1',
  medicalRetention: '1 mon',
  fees: [{ code: 'unaffiliated', label: 'Unaffiliated', pricePence: 2000 }],
};

const OPEN_VIEW: NnEntryView = {
  show: 'entry',
  state: STATE,
  early: false,
  entered: false,
  accountEmail: null,
};

const running = (overrides: Partial<NnRunning> = {}): NnRaceView => ({
  running: {
    year: '2026',
    yearPath: '/nn/2026/',
    state: 'open',
    date: '1 November 2026',
    startTime: '11:00',
    fees: STATE.fees,
    previous: [],
    ...overrides,
  },
});

/**
 * An environment whose database is a port nothing listens on. `isFull()` must read that as
 * "not known to be full" — never as full.
 */
const UNREACHABLE = {
  PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
  PUBLIC_SUPABASE_ANON_KEY: 'not-a-key',
};

describe('deciding whether the year page is full', () => {
  it('reuses the bar’s answer for the same running, without asking again', async () => {
    // The environment cannot reach anything, so a second read would answer "not full" — this
    // can only come back `full` if the masthead's answer was used.
    const view = await checkNnEntryCapacity(
      UNREACHABLE,
      OPEN_VIEW,
      running({ full: true }),
    );

    expect(view).toEqual({ show: 'closed', window: 'full', fees: STATE.fees });
  });

  it('leaves the form up when the count cannot be read', async () => {
    // **The failure direction.** Wrongly saying "full" turns a runner away from a race they
    // could have entered; wrongly leaving the form up costs them their typing and the database
    // refuses the entry anyway.
    expect(await checkNnEntryCapacity(UNREACHABLE, OPEN_VIEW)).toBe(OPEN_VIEW);
    expect(await checkNnEntryCapacity(UNREACHABLE, OPEN_VIEW, { running: null })).toBe(
      OPEN_VIEW,
    );
  });

  it('asks for itself when the bar is about a different running', async () => {
    // A past year's page while another running is current, or a tester on a window that has
    // not opened: the bar's answer is about something else, so it is not borrowed.
    const other = running({ yearPath: '/nn/2027/', full: true });

    expect(await checkNnEntryCapacity(UNREACHABLE, OPEN_VIEW, other)).toBe(OPEN_VIEW);
  });

  it('passes a page that is not offering the form straight through', async () => {
    const shut: NnEntryView = { show: 'closed', window: 'ended', fees: [] };

    expect(await checkNnEntryCapacity(UNREACHABLE, shut, running({ full: true }))).toBe(
      shut,
    );
  });
});

describe('what the full state paints', () => {
  const transform = async (rewriter: HTMLRewriter, markup: string): Promise<string> =>
    rewriter
      .transform(new Response(markup, { headers: { 'content-type': 'text/html' } }))
      .text();

  it('on the year page: the notice, and nothing that can be entered', async () => {
    const PAGE = [
      '<a data-nn-cta href="#register">Register interest</a>',
      '<dl data-nn-entries-open><dt>Entries open</dt></dl>',
      '<div data-nn-interest><h2 id="register">Register your interest</h2></div>',
      '<div data-nn-closed hidden><h2>Entries have closed</h2></div>',
      '<div data-nn-full hidden><h2>The race is full</h2></div>',
      '<div data-nn-card-full hidden><p>The race is full.</p></div>',
      '<div data-nn-entry hidden><form></form></div>',
    ].join('');

    const html = await transform(
      renderNnEntryView(new HTMLRewriter(), {
        show: 'closed',
        window: 'full',
        fees: STATE.fees,
      }),
      PAGE,
    );

    expect(isHidden(html, 'data-nn-full')).toBe(false);
    expect(isHidden(html, 'data-nn-closed')).toBe(true);
    expect(isHidden(html, 'data-nn-entry')).toBe(true);
    expect(isHidden(html, 'data-nn-interest')).toBe(true);
    expect(isHidden(html, 'data-nn-cta')).toBe(true);
    expect(isHidden(html, 'data-nn-entries-open')).toBe(true);
    expect(isHidden(html, 'data-nn-card-full')).toBe(false);
  });

  it('on the year page, never once the window has simply ended', async () => {
    // The two shut states share a shape and must not share a sentence: "full" says places can
    // come back, which is false once entries have closed.
    const PAGE =
      '<div data-nn-closed hidden></div><div data-nn-full hidden></div>' +
      '<div data-nn-card-full hidden></div>';

    const html = await transform(
      renderNnEntryView(new HTMLRewriter(), {
        show: 'closed',
        window: 'ended',
        fees: [],
      }),
      PAGE,
    );

    expect(isHidden(html, 'data-nn-full')).toBe(true);
    expect(isHidden(html, 'data-nn-card-full')).toBe(true);
    expect(isHidden(html, 'data-nn-closed')).toBe(false);
  });

  const PANEL = [
    '<section data-nn-panel hidden>',
    '<a class="nn-ghost" href="" data-nn-panel-action data-nn-panel-link="year">x</a>',
    '<p data-nn-panel-shut>Entries are not open yet.</p>',
    '<p data-nn-panel-open hidden><span data-nn-panel-fees></span></p>',
    '<p data-nn-panel-full hidden>Every place has been taken — the race is full.</p>',
    '</section>',
  ].join('');

  it('on the race page: the full note, no fee line, and the outlined action', async () => {
    const html = await transform(
      renderNnRaceView(new HTMLRewriter(), running({ full: true })),
      PANEL,
    );

    expect(isHidden(html, 'data-nn-panel-full')).toBe(false);
    expect(isHidden(html, 'data-nn-panel-open')).toBe(true);
    expect(isHidden(html, 'data-nn-panel-shut')).toBe(true);
    expect(html).toMatch(/class="nn-ghost"[^>]*href="\/nn\/2026\/"/);
    expect(html).not.toContain('Enter the race');
  });

  it('on the race page: an open race with places is unchanged', async () => {
    // `full` absent is how every view built before ADR-070 looks, and it must render as the
    // open race it always did.
    for (const view of [running(), running({ full: false })]) {
      const html = await transform(renderNnRaceView(new HTMLRewriter(), view), PANEL);

      expect(isHidden(html, 'data-nn-panel-full')).toBe(true);
      expect(isHidden(html, 'data-nn-panel-open')).toBe(false);
      expect(html).toMatch(/class="nn-cta"[^>]*href="\/nn\/2026\/#enter"/);
    }
  });

  it('in the bar: "Race details" when full, "Enter the race" when not', async () => {
    const BAR = [
      '<a href="" data-nn-nav-cta hidden aria-label="x">',
      '<span data-nn-nav-cta-long></span><span data-nn-nav-cta-short></span>',
      '</a>',
    ].join('');

    const full = await transform(
      renderNnNav(new HTMLRewriter(), running({ full: true })),
      BAR,
    );
    const open = await transform(renderNnNav(new HTMLRewriter(), running()), BAR);

    expect(full).toContain('aria-label="Race details"');
    expect(full).toContain('>Details<');
    expect(open).toContain('aria-label="Enter the race"');
    expect(open).toContain('>Enter<');
  });
});
