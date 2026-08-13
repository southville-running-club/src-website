import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * `/nn/` **before entries open** — the state production is in today, and the state the
 * migration seeds.
 *
 * `entries.events.entries_open_at` is null for Nightingale Nightmare because the opening
 * time has not been decided. To somebody looking at the page that means the same thing as
 * "not yet", so they get the interest form, which is the form that was already here.
 *
 * The other half of this — everything that only exists once entries are open — is a separate
 * run against a moved window: `tests/worker/entries-open/`. See
 * `vitest.worker.entries-open.config.ts` for why it is a second config rather than a
 * `beforeAll`.
 *
 * **Needs the local Supabase stack**, because which form to show is answered by
 * `entries.entry_state()`.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

function submit(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    // Without this the runtime follows a redirect and the status under test disappears.
    redirect: 'manual',
  });
}

const page = () => SELF.fetch(`${SITE}/nn/`).then((response) => response.text());

describe('which of the two forms the page shows', () => {
  it('serves the interest form and hides the entry form', async () => {
    const html = await page();

    expect(html).toContain('Register your interest');
    expect(html).toMatch(/data-nn-entry hidden/);
    expect(html).not.toMatch(/data-nn-interest hidden/);
  });

  it('offers the interest form from the hero button', async () => {
    const html = await page();

    expect(html).toMatch(
      /<a class="nn-cta" href="#register"[^>]*>Register your interest/,
    );
  });

  it('paints no price onto a page that cannot take an entry', async () => {
    // The three fee cards are in `dist/` and stay hidden with their prices unpainted. A price
    // on a page nobody can enter through is a claim about a race that is not open. The same
    // assertion in `serves.test.ts` guards the rest of the page.
    const html = await page();

    expect(html).not.toMatch(/£\s?\d/);
  });

  it('leaves the enhancement without the rules it needs, so it does nothing', async () => {
    // Without an event date the browser-side script returns immediately. Belt and braces:
    // the whole form it would enhance is hidden anyway.
    const html = await page();

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
    const response = await submit({ form: 'entry', firstName: 'Grace' });
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
    const response = await submit({ form: 'entry', firstName: 'Grace' });
    const html = await response.text();

    expect(html).not.toMatch(/data-nn-entry hidden/);
    expect(html).toMatch(/data-nn-interest hidden/);
  });
});

describe('the fork between the page’s two forms', () => {
  it('leaves the interest form working exactly as it did', async () => {
    // The routing fork must not have cost the form that was already here anything.
    const response = await submit({
      form: 'interest',
      name: 'Grace Hopper',
      email: 'worker-still-works@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/nn/?signup=ok`);
  });

  it('treats a submission with no form field as the interest form', async () => {
    // **The harmless side of the fork.** A stale cached page with no hidden field is read as
    // the form that takes no money rather than as the one that will, and an unlabelled bot
    // post lands there too.
    const response = await submit({
      name: 'Grace Hopper',
      email: 'worker-no-kind@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
  });

  it('treats an unrecognised form field the same way', async () => {
    const response = await submit({
      form: 'something-else',
      name: 'Grace Hopper',
      email: 'worker-odd-kind@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
  });
});
