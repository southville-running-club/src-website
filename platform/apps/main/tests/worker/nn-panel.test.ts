import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  feeLine,
  renderNnEntryView,
  renderNnPreviousYears,
  NN_PREVIOUS_SLOTS,
  type NnEntryView,
} from '../../worker/nn-entry';

/**
 * The front door's year panel, and the row of past runnings beneath it.
 *
 * Two halves, and they are proved differently on purpose:
 *
 *   * **The panel** is fetched through the Worker, because it is painted from the real event
 *     row and what matters is what a browser receives. This file runs against the **seeded,
 *     closed** window, which is what production serves; `tests/worker/entries-open/` carries
 *     the open half.
 *
 *   * **The previous-years row** is driven against a fabricated list, because the real one is
 *     always empty — there is one running of this race and it is the current one. Proving the
 *     populated case against real data would mean seeding a running that has already happened,
 *     and a past running has nowhere to point until there are results to point at.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

const front = () => SELF.fetch(`${SITE}/nn/`).then((response) => response.text());

/** The panel's own markup, so nothing elsewhere on the page can satisfy an assertion. */
function panel(html: string): string {
  const start = html.indexOf('data-nn-panel');
  return start === -1 ? '' : html.slice(start, html.indexOf('</section>', start));
}

describe('the panel answers the two questions in the order they are asked', () => {
  it('is revealed, and states the date largest', async () => {
    // **"When is it" comes first**, and the date is the only thing in the panel at 24px.
    // Painted, not read from `race.json` — that file's date belongs to the 2026 running and
    // this page is about the race.
    const html = panel(await front());

    expect(html).not.toMatch(/^[^>]*hidden/);
    expect(html).toContain('>The next race<');
    expect(html).toContain(
      '<p class="nn-panel-date" data-nn-panel-date>1 November 2026</p>',
    );
  });

  it('states the start time, the distance and the field size beneath it', async () => {
    const html = panel(await front());

    expect(html).toContain('<span data-nn-panel-time>11:00</span>');
    expect(html).toContain('10 km, off-road');
    expect(html).toContain('250 places');
  });

  it('links to this running and to nothing else beside it', async () => {
    // **The panel held three year links and holds one.** "Race instructions" and "Spooktators"
    // sat under the action in a `<ul class="nn-panel-links">`; both came out on request, and
    // this asserted their hrefs.
    //
    // **Inverted rather than deleted, because the Worker still offers to paint them.**
    // `renderNnRaceView` registers `[data-nn-panel-link="race-day"]` and
    // `[data-nn-panel-link="spectators"]` and always will — `/nn/2026/` uses the same hooks — so
    // nothing in the Worker would go red if the markup came back. Asserting the absence is what
    // notices, and it is the same shape as the bar's own guard one file along.
    const html = panel(await front());

    expect(html).toContain('href="/nn/2026/"');
    expect(html).not.toContain('href="/nn/2026/race-day/"');
    expect(html).not.toContain('href="/nn/2026/spectators/"');
  });
});

describe('the shut state, which is what production serves', () => {
  it('offers the quiet outlined action, named for the running it goes to', async () => {
    const html = panel(await front());

    expect(html).toMatch(/class="nn-ghost"[^>]*href="\/nn\/2026\/"/);
    expect(html).toContain('The 2026 race');
  });

  it('says entries are not open, and names no month', async () => {
    // **The entry open and close times are on this repository's unconfirmed list**, and may
    // not appear anywhere. "Entries open in September" would be a claim nobody has authorised;
    // what is true without confirmation is that they are shut and that the club will say when
    // they are not.
    const html = panel(await front());

    expect(html).toContain('Entries are not open yet');
    expect(html).not.toMatch(
      /January|February|March|April|May|June|July|August|September|October|December/,
    );
  });

  it('quotes no fee, because there is nothing to enter', async () => {
    const html = panel(await front());

    expect(html).toMatch(/data-nn-panel-open[^>]*hidden/);
    expect(html).not.toMatch(/£\s?\d/);
  });

  it('shows no badge or banner announcing a state', async () => {
    // **The difference in prominence is the message.** A page that also said it in words
    // would be saying it twice.
    const html = panel(await front());

    expect(html.toLowerCase()).not.toContain('entries are open');
  });
});

describe('the row of previous years', () => {
  it('is hidden entirely when there are none, which is today', async () => {
    // **The whole section, not the pills inside it.** `hidden` on the container takes the
    // heading and the list with it, so there is no stray "Previous years" over an empty row.
    // That it is genuinely *not rendered* — rather than merely marked — is asserted in a
    // browser, in `site.spec.ts`.
    const html = await front();

    expect(html).toMatch(/<section class="nn-previous" data-nn-previous hidden/);
  });

  it('leaves every pill empty and hidden while nothing fills them', async () => {
    const html = await front();

    for (let index = 0; index < NN_PREVIOUS_SLOTS; index += 1) {
      expect(html, `slot ${index}`).toMatch(
        new RegExp(`data-nn-previous-item="${index}"[^>]*hidden`),
      );
    }
  });
});

describe('the previous-years paint, against a list nothing supplies yet', () => {
  // **The mechanism, proved in the runtime that has an `HTMLRewriter`.** The list is
  // fabricated because the real one is always empty — see the note at the head of this file.

  const MARKUP = `<section data-nn-previous hidden><ul>${Array.from(
    { length: NN_PREVIOUS_SLOTS },
    (_unused, index) =>
      `<li><a href="" data-nn-previous-item="${index}" hidden></a></li>`,
  ).join('')}</ul></section>`;

  const paint = async (previous: { year: string; yearPath: string }[]) => {
    const rewriter = renderNnPreviousYears(new HTMLRewriter(), previous);
    return rewriter
      .transform(new Response(MARKUP, { headers: { 'content-type': 'text/html' } }))
      .text();
  };

  it('reveals nothing for an empty list', async () => {
    const html = await paint([]);

    expect(html).toContain('data-nn-previous hidden');
    expect(html).toContain('data-nn-previous-item="0" hidden');
  });

  it('reveals the container and one pill for one past running', async () => {
    const html = await paint([{ year: '2025', yearPath: '/nn/2025/' }]);

    expect(html).not.toContain('data-nn-previous hidden');
    expect(html).toContain('href="/nn/2025/" data-nn-previous-item="0"');
    expect(html).toContain('>2025</a>');

    // The other three stay hidden and empty. A blank pill beside a real one would read as a
    // year the club forgot to name.
    expect(html).toContain('data-nn-previous-item="1" hidden');
  });

  it('fills as many pills as it was given, in order', async () => {
    const html = await paint([
      { year: '2025', yearPath: '/nn/2025/' },
      { year: '2024', yearPath: '/nn/2024/' },
    ]);

    expect(html).toContain('>2025</a>');
    expect(html).toContain('>2024</a>');
    expect(html).toContain('data-nn-previous-item="2" hidden');
  });

  it('shows the first four and drops the rest rather than overflowing the markup', async () => {
    // **A fixed number because the pills are markup rather than generated.** A fifth would
    // need one more `<a>` in the component, which is a deploy — the same trade the three fee
    // cards make. What must not happen is a silent loss of the *front* of the list.
    const html = await paint(
      ['2025', '2024', '2023', '2022', '2021'].map((year) => ({
        year,
        yearPath: `/nn/${year}/`,
      })),
    );

    for (const year of ['2025', '2024', '2023', '2022']) {
      expect(html, year).toContain(`>${year}</a>`);
    }
    expect(html).not.toContain('>2021</a>');
  });
});

describe('the fee line', () => {
  it('reads dearest first, from the database and nowhere else', () => {
    expect(
      feeLine([
        {
          code: 'unaffiliated',
          label: 'Unaffiliated',
          pricePence: 1700,
        },
        {
          code: 'affiliated',
          label: 'Affiliated',
          pricePence: 1500,
        },
      ]),
    ).toBe('£17.00 unaffiliated · £15.00 affiliated');
  });

  it('leaves a free place out', () => {
    // **"Free" beside two prices reads as an offer anybody can take**, and a guide's place is
    // not. The form says what it is at the moment somebody chooses it.
    expect(
      feeLine([
        {
          code: 'unaffiliated',
          label: 'Unaffiliated',
          pricePence: 1700,
        },
        { code: 'vi_guide', label: 'VI guide', pricePence: 0 },
      ]),
    ).toBe('£17.00 unaffiliated');
  });

  it('is empty when an event offers nothing priced', () => {
    expect(feeLine([])).toBe('');
  });
});

describe('the entry fee on the year page', () => {
  // **The shut state is the one that matters here**, because it is the one production is in
  // and the one this wiring exists for. `renderNnEntryView` returns early for anything that is
  // not the entry form; the fee is painted before that return, because a price is a fact about
  // the race rather than a property of the form.

  // **Dearest first, because that is the order `entry_state()` hands them over in** —
  // `order by fee.price_pence desc, fee.code`. A fixture in a different order would test a
  // shape the database never produces, and would have hidden that the rendered line reads
  // "£20.00 unaffiliated · £18.00 affiliated" rather than the other way round.
  const FEES = [
    {
      code: 'unaffiliated',
      label: 'Unaffiliated',
      pricePence: 2000,
    },
    { code: 'affiliated', label: 'Affiliated', pricePence: 1800 },
    { code: 'vi_guide', label: 'VI guide', pricePence: 0 },
  ];

  const render = async (view: NnEntryView): Promise<string> => {
    const html = '<dl><dt>Entry fee</dt><dd data-nn-fee>To be confirmed</dd></dl>';
    const response = renderNnEntryView(new HTMLRewriter(), view).transform(
      new Response(html, { headers: { 'content-type': 'text/html' } }),
    );
    return response.text();
  };

  it('states the fee even though the form is not on offer', async () => {
    const html = await render({ show: 'closed', window: 'pre_open', fees: FEES });

    expect(html).toContain('£20.00 unaffiliated · £18.00 affiliated');
    expect(html).not.toContain('To be confirmed');
  });

  it('leaves the shipped text alone when the database could not be reached', async () => {
    // **The failure direction, and the whole reason the cell ships with words in it.** No fees
    // means no claim: "To be confirmed" is true of a page that could not check, and a stale
    // number would not be. `resolveNnEntryView` yields an empty array for an unreachable
    // database, so this is that case exactly.
    // `unknown` is what `resolveNnEntryView` yields for an unreachable database, and it
    // renders as `pre_open` deliberately — see the note on `NnEntryView.window`.
    const html = await render({ show: 'closed', window: 'unknown', fees: [] });

    expect(html).toContain('To be confirmed');
    expect(html).not.toContain('£');
  });

  it('never advertises the free guide place as a price', async () => {
    const html = await render({ show: 'closed', window: 'pre_open', fees: FEES });

    expect(html).not.toContain('Free');
    expect(html).not.toContain('guide');
  });
});

/**
 * The three states of `/nn/2026/`, rendered from a stubbed view rather than a database.
 *
 * **The distinction these assert did not exist until now.** `NnEntryView`'s `closed` variant
 * collapsed four situations — not yet, no longer, no such event, and a database this Worker
 * could not reach — so the page could not tell a runner "come back on Tuesday" from "you have
 * missed it". `window` carries the reason and this is what holds it to the right rendering.
 *
 * The fixture markup is the page's own shape reduced to the elements the Worker touches: the
 * two form blocks, the closed notice, one call to action and the rail's entries-open line.
 */
describe('which of the three states the year page renders', () => {
  const PAGE = [
    '<a data-nn-cta href="#register">Register interest</a>',
    '<dl data-nn-entries-open><dt>Entries open</dt><dd>Tuesday 1 September</dd></dl>',
    '<div data-nn-interest><h2 id="register">Register your interest</h2></div>',
    '<div data-nn-closed hidden><h2>Entries have closed</h2></div>',
    '<div data-nn-entry hidden><form></form></div>',
  ].join('');

  const render = async (view: NnEntryView): Promise<string> => {
    const response = renderNnEntryView(new HTMLRewriter(), view).transform(
      new Response(PAGE, { headers: { 'content-type': 'text/html' } }),
    );
    return response.text();
  };

  /** `hidden` on the element carrying this attribute, whatever order the attributes are in. */
  const isHidden = (html: string, marker: string): boolean =>
    new RegExp(`<[^>]*\\b${marker}\\b[^>]*\\bhidden\\b`).test(html);

  it('offers the interest form before the window opens', async () => {
    const html = await render({ show: 'closed', window: 'pre_open', fees: [] });

    expect(isHidden(html, 'data-nn-interest')).toBe(false);
    expect(isHidden(html, 'data-nn-closed')).toBe(true);
    expect(isHidden(html, 'data-nn-entry')).toBe(true);
    // The opening date is still ahead, so it is still worth stating.
    expect(isHidden(html, 'data-nn-entries-open')).toBe(false);
  });

  it('says so plainly once the window has ended, and offers nothing', async () => {
    const html = await render({ show: 'closed', window: 'ended', fees: [] });

    expect(isHidden(html, 'data-nn-closed')).toBe(false);
    expect(isHidden(html, 'data-nn-interest')).toBe(true);
    expect(isHidden(html, 'data-nn-entry')).toBe(true);

    // **No control left looking live beside a shut door**, and no opening date that has been
    // and gone sitting above it.
    expect(isHidden(html, 'data-nn-cta')).toBe(true);
    expect(isHidden(html, 'data-nn-entries-open')).toBe(true);
  });

  /**
   * The one that matters most, and the one nobody would have written without the type change.
   *
   * A database this Worker could not reach must not produce a page claiming entries have
   * closed. That is a false statement about a race somebody may still be able to enter, and a
   * reader cannot tell it apart from a decision the club took — so an outage would read as
   * "you have missed it" on the morning of the first of September.
   */
  it('falls back to the interest form when it could not find out', async () => {
    const html = await render({ show: 'closed', window: 'unknown', fees: [] });

    expect(isHidden(html, 'data-nn-interest')).toBe(false);
    expect(isHidden(html, 'data-nn-closed')).toBe(true);
    expect(html).not.toContain('Entries have closed');
  });
});
