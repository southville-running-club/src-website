import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * `/nn/` and `/nn/2026/` **before entries open** — the state production is in today, and the
 * state the migration seeds.
 *
 * `entries.events.entries_open_at` is null for Nightingale Nightmare because the opening
 * time has not been decided. To somebody looking at either page that means the same thing as
 * "not yet": the race page carries the interest form, and the year page says entries are not
 * open and points back at it.
 *
 * The other half of this — everything that only exists once entries are open — is a separate
 * run against a moved window: `tests/worker/entries-open/`. See
 * `vitest.worker.entries-open.config.ts` for why it is a second config rather than a
 * `beforeAll`.
 *
 * **Needs the local Supabase stack**, because which state to show is answered by
 * `entries.entry_state()` and `entries.current_entry_state()`.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

/** The entry form posts to the running it is for, which is its own address. */
function submitEntry(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/2026/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    // Without this the runtime follows a redirect and the status under test disappears.
    redirect: 'manual',
  });
}

/** The interest form posts to the race, which is where it lives. */
function submitInterest(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

const racePage = () => SELF.fetch(`${SITE}/nn/`).then((response) => response.text());
const yearPage = () => SELF.fetch(`${SITE}/nn/2026/`).then((response) => response.text());

describe('the race page, while entries are not open', () => {
  it('serves the interest form and says nothing about entries being open', async () => {
    const html = await racePage();

    expect(html).toContain('Register your interest');
    expect(html).not.toMatch(/data-nn-interest hidden/);
    expect(html).toMatch(/data-nn-entries-open[^>]*hidden/);
  });

  it('offers the interest form from the hero button', async () => {
    const html = await racePage();

    expect(html).toMatch(
      /<a class="nn-cta" href="#register"[^>]*>Register your interest/,
    );
  });

  it('carries no entry form at all, open or shut', async () => {
    // **The entry form is on the year page and must not be copied here.** Two forms writing
    // to one table is two places for a rule to be wrong, and this is the assertion that says
    // the split actually happened rather than being described.
    const html = await racePage();

    expect(html).not.toContain('data-entry-form');
    expect(html).not.toContain('data-nn-entry');
  });

  it('still links to this year’s running, painted from the event row', async () => {
    // **A front door, not a dead end.** The links are revealed whether or not entries are
    // open — somebody wants the race-day plan either way — and none of them is written into
    // the markup, which is what makes 2027 a row rather than an edit.
    const html = await racePage();

    expect(html).not.toMatch(/data-nn-running[^-][^>]*hidden/);
    expect(html).toContain('The 2026 race');
    expect(html).toContain('href="/nn/2026/" data-nn-running-link="year"');
    expect(html).toContain('href="/nn/2026/race-day/"');
    expect(html).toContain('href="/nn/2026/spectators/"');
  });

  it('links to no year except through the ones the Worker paints', async () => {
    // **The failure this guards is a year typed into a link.** It would work perfectly for a
    // year and then quietly point at a page that no longer exists, and it would not look
    // wrong in a diff. Every year-bearing href in the page **body** has to be one
    // `renderNnRaceView` wrote, so a fourth appearing means somebody hard-coded a route.
    //
    // Scoped to `<main>`: the navigation bar sits outside it and carries three year links of
    // its own, which `nn-nav.test.ts` owns.
    const html = await (await SELF.fetch(`${SITE}/nn/`)).text();
    const body = html.slice(html.indexOf('<main id="main">'));

    const yearLinks = [...body.matchAll(/href="([^"]*)"/g)]
      .map((match) => match[1]!)
      .filter((href) => /\/nn\/\d{4}\b/.test(href));

    expect(yearLinks).toEqual([
      '/nn/2026/',
      '/nn/2026/race-day/',
      '/nn/2026/spectators/',
    ]);
  });

  it('paints the heading with the year it is pointing at', async () => {
    const html = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(html).toContain('<h2 data-nn-running-heading>The 2026 race</h2>');
  });
});

describe('the year page, while entries are not open', () => {
  it('says entries are not open and hides the entry form', async () => {
    const html = await yearPage();

    expect(html).toMatch(/data-nn-entry hidden/);
    expect(html).not.toMatch(/data-nn-not-open[^>]*hidden/);
    expect(html).toContain('Entries are not open yet');
  });

  it('points back at the interest form rather than at nothing', async () => {
    const html = await yearPage();

    expect(html).toContain('Leave your name on the race page');
    expect(html).toContain('href="/nn/"');
  });

  it('paints no price onto a page that cannot take an entry', async () => {
    // The three fee cards are in `dist/` and stay hidden with their prices unpainted. A price
    // on a page nobody can enter through is a claim about a race that is not open. The same
    // assertion in `serves.test.ts` guards the rest of the page.
    const html = await yearPage();

    expect(html).not.toMatch(/£\s?\d/);
  });

  it('leaves the enhancement without the rules it needs, so it does nothing', async () => {
    // Without an event date the browser-side script returns immediately. Belt and braces:
    // the whole form it would enhance is hidden anyway.
    const html = await yearPage();

    expect(html).toContain('data-entry-event-date=""');
  });
});

describe('an entry POST while entries are not open', () => {
  it('is refused with 409, and says so rather than looking unchanged', async () => {
    // Somebody opens the page at 6:59 and presses the button at 7:01 on the last day. That
    // is an ordinary sequence rather than an attack, and it is why the Worker re-checks the
    // window when the form arrives instead of trusting whenever the page was served.
    //
    // 409 rather than 422 or 503: the submission was well-formed and the state of the world
    // moved.
    const response = await submitEntry({ firstName: 'Grace' });
    const html = await response.text();

    expect(response.status).toBe(409);
    expect(html).toMatch(/data-entry-closed[^>]*autofocus/);
    expect(html).toContain('Entries are not open');
    expect(html).toContain('nothing has been stored and nothing has been charged');
  });

  it('reveals the entry section so the notice can actually be seen', async () => {
    // The notice lives inside `[data-nn-entry]`, which is hidden in this state. Somebody who
    // pressed a button deserves to be told what happened rather than handed a page that
    // looks as though nothing did.
    const response = await submitEntry({ firstName: 'Grace' });
    const html = await response.text();

    expect(html).not.toMatch(/data-nn-entry hidden/);
    expect(html).toMatch(/data-nn-not-open[^>]*hidden/);
  });

  it('is answered on the year page it was posted to, not on the race page', async () => {
    const html = await (await submitEntry({ firstName: 'Grace' })).text();

    expect(html).toContain(
      'rel="canonical" href="https://new.southvillerunningclub.co.uk/nn/2026/"',
    );
  });

  it('accepts the address without its trailing slash', async () => {
    // Astro insists on the slash for the page, but a form posting to the other spelling must
    // not have its submission 404'd on the way in — the person filled it in either way.
    const response = await SELF.fetch(`${SITE}/nn/2026`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ firstName: 'Grace' }),
      redirect: 'manual',
    });

    expect(response.status).toBe(409);
  });
});

describe('the two forms, at their two addresses', () => {
  it('leaves the interest form working exactly as it did', async () => {
    // The route move must not have cost the form that was already here anything.
    const response = await submitInterest({
      name: 'Grace Hopper',
      email: 'worker-still-works@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/nn/?signup=ok`);
  });

  it('reads a POST to the race page as the interest form, whatever the body says', async () => {
    // **The address is the discriminator now, and the hidden `form` field is gone with the
    // ambiguity that needed it.** A stale cached page posting `form=entry` to `/nn/` is still
    // an interest submission, which is the harmless direction: that form takes no money.
    const response = await submitInterest({
      form: 'entry',
      name: 'Grace Hopper',
      email: 'worker-stale-field@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
  });

  it('404s a POST to a year nobody has published a page for', async () => {
    // `/nn/1999/` resolves to the event `nn-1999`, which does not exist — and there is
    // nothing in `dist/` at that address either, so the page the Worker would re-serve the
    // outcome on is a 404. That is the right answer rather than a rendered notice.
    const response = await SELF.fetch(`${SITE}/nn/1999/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ firstName: 'Grace' }),
      redirect: 'manual',
    });

    expect(response.status).toBe(404);
  });
});
