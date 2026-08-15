import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { feeLine, renderNnPreviousYears, NN_PREVIOUS_SLOTS } from '../../worker/nn-entry';

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

  it('links to the rest of this running from inside the panel', async () => {
    const html = panel(await front());

    expect(html).toContain('href="/nn/2026/race-day/"');
    expect(html).toContain('href="/nn/2026/spectators/"');
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
          requiresEaNumber: false,
        },
        {
          code: 'affiliated',
          label: 'Affiliated',
          pricePence: 1500,
          requiresEaNumber: true,
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
          requiresEaNumber: false,
        },
        { code: 'vi_guide', label: 'VI guide', pricePence: 0, requiresEaNumber: false },
      ]),
    ).toBe('£17.00 unaffiliated');
  });

  it('is empty when an event offers nothing priced', () => {
    expect(feeLine([])).toBe('');
  });
});
