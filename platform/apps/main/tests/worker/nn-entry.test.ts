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

/**
 * The entry form posts to the running it is for, and says which form it is.
 *
 * **Both forms are on this page**, one shown at a time, so the hidden field is what tells them
 * apart — not the window state, which would read somebody's interest submission as an entry if
 * entries opened between the page loading and the button being pressed.
 */
function submitEntry(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/2026/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ form: 'entry', ...fields }),
    // Without this the runtime follows a redirect and the status under test disappears.
    redirect: 'manual',
  });
}

/** The interest form posts to the running it is an interest in, like the entry form. */
function submitInterest(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/2026/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

const racePage = () => SELF.fetch(`${SITE}/nn/`).then((response) => response.text());
const yearPage = () => SELF.fetch(`${SITE}/nn/2026/`).then((response) => response.text());

describe('the race page, while entries are not open', () => {
  it('carries neither form, and says nothing about entries being open', async () => {
    // **Both forms are on the running now.** This page links to them; the panel's fee line is
    // the only thing that appears when entries open, and it is hidden here.
    const html = await racePage();

    expect(html).not.toContain('data-nn-interest');
    expect(html).not.toContain('data-entry-form');
    expect(html).toMatch(/data-nn-panel-open[^>]*hidden/);
  });

  it('offers the running from the panel, in its quiet weight', async () => {
    // The hero has no button: it pointed at `#register`, and that form moved. An anchor to
    // nothing looks like a control, is reached by keyboard, and does nothing at all.
    const html = await racePage();

    expect(html).not.toMatch(/\sdata-nn-cta\b/);
    expect(html).toMatch(/class="nn-ghost" href="\/nn\/2026\/"/);
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
    // **A front door, not a dead end.** The panel is revealed whether or not entries are
    // open — somebody wants the date and the race-day plan either way — and none of its links
    // is written into the markup, which is what makes 2027 a row rather than an edit.
    const html = await racePage();

    expect(html).not.toMatch(/data-nn-panel[^-][^>]*hidden/);
    expect(html).toContain('The 2026 race');
    expect(html).toContain('href="/nn/2026/" data-nn-panel-action');
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

  it('paints the action with the year it is pointing at', async () => {
    // The panel's own label is "The next race", which is true and vague. The button is the one
    // thing that says which running it is sending somebody to, so it names it.
    const html = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(html).toMatch(/data-nn-panel-link="year">\s*The 2026 race\s*</);
  });
});

describe('the year page, while entries are not open', () => {
  it('shows the interest form and hides the entry form', async () => {
    // **The interest form is the shut state now.** It moved here from `/nn/` with this slice:
    // interest in what — the race in general, or this year's running? It is this year's, and
    // this page reads as one thing in both states.
    const html = await yearPage();

    expect(html).toMatch(/data-nn-entry hidden/);
    expect(html).not.toMatch(/data-nn-interest[^>]*hidden/);
    expect(html).toContain('Register your interest');
  });

  it('posts the interest form to the page it is on', async () => {
    const html = await yearPage();

    expect(html).toContain(
      '<form class="signup nn-card" method="post" action="/nn/2026/">',
    );
    expect(html).toContain('<input type="hidden" name="form" value="interest">');
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
    expect(html).toMatch(/data-nn-interest[^>]*hidden/);
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
      body: new URLSearchParams({ form: 'entry', firstName: 'Grace' }),
      redirect: 'manual',
    });

    expect(response.status).toBe(409);
  });
});

describe('the two forms, at their two addresses', () => {
  it('leaves the interest form working exactly as it did', async () => {
    // The move must not have cost the form anything. It posts to the running now, and the
    // acknowledgement comes back to the same page.
    const response = await submitInterest({
      form: 'interest',
      name: 'Grace Hopper',
      email: 'worker-still-works@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/nn/2026/?signup=ok`);
  });

  it('reads a submission with no form field as the interest form', async () => {
    // **The harmless side of the fork.** A stale cached page with no hidden field is read as
    // the form that takes no money rather than as the one that will, and an unlabelled bot
    // post lands there too.
    const response = await submitInterest({
      name: 'Grace Hopper',
      email: 'worker-no-kind@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
  });

  it('refuses a POST to the race page, which no form posts to any more', async () => {
    // The interest form was here and moved to the running. Nothing posts to `/nn/`, so the
    // request falls past every predicate to the assets binding — which answers **405**,
    // because the page exists and the method does not apply to it. That is a better answer
    // than the 404 a missing page would get, and it is the same one `/nn/privacy/` has always
    // given.
    const response = await SELF.fetch(`${SITE}/nn/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Grace', email: 'a@example.com', consent: 'on' }),
      redirect: 'manual',
    });

    expect(response.status).toBe(405);
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
