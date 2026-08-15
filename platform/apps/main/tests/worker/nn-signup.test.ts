import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * The sign-up form's POST half, in the real Workers runtime, against the real build output.
 *
 * `packages/shared/tests/unit/nn-signup.test.ts` proves the schema and
 * `packages/db/tests/nn-interest.test.ts` proves the grant and the policy. **Neither of
 * them can prove that a POST reaches this Worker at all** — that depends on
 * `run_worker_first`, on the handler being ordered before `env.ASSETS.fetch`, and on the
 * static-assets binding never getting a chance to refuse the method. Those three would all
 * still be broken with every other suite green, which is what this file is for.
 *
 * **Needs the local Supabase stack**, because a submission that cannot reach Postgres is
 * `unavailable` rather than accepted. CI starts it before this command runs.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

/** Deterministic and invented, at the domain the IETF reserves. */
const ALREADY_SEEDED = 'alice@example.com';

function submit(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    // Without this the runtime follows the 303 and the status under test disappears.
    redirect: 'manual',
  });
}

describe('a submission that should be taken', () => {
  it('answers with a redirect rather than a page', async () => {
    // POST/Redirect/GET. A refresh afterwards re-requests the acknowledgement rather than
    // re-posting the form, so nobody is left wondering whether they signed up twice.
    const response = await submit({
      name: 'Grace Hopper',
      email: 'worker-hopper@example.com',
      consent: 'on',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SITE}/nn/?signup=ok`);
  });

  it('answers a repeated address exactly the same way, and says nothing about it', async () => {
    // `alice@example.com` is in the seed, so this is a duplicate on its first attempt.
    //
    // **The identical answer is the point.** Telling somebody the address is already on the
    // list would disclose membership of the list to anyone who can type an address into a
    // form — so a duplicate is a 303 to the same place, with the same acknowledgement, and
    // nothing in the response that distinguishes it.
    const first = await submit({
      name: 'Alice Fernsby',
      email: ALREADY_SEEDED,
      consent: 'on',
    });
    const second = await submit({
      name: 'Someone Else Entirely',
      email: ALREADY_SEEDED.toUpperCase(),
      consent: 'on',
    });

    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    expect(second.headers.get('location')).toBe(first.headers.get('location'));
  });

  it('acknowledges it on the page the redirect lands on', async () => {
    const page = await (await SELF.fetch(`${SITE}/nn/?signup=ok`)).text();

    // Revealed, and given focus — which is how focus moves with JavaScript disabled.
    expect(page).toMatch(/data-signup-ack[^>]*autofocus/);
    expect(page).not.toMatch(/data-signup-ack[^>]*hidden/);
    expect(page).toContain('your interest is registered');
  });

  it('says nothing on an ordinary visit', async () => {
    const page = await (await SELF.fetch(`${SITE}/nn/`)).text();

    expect(page).toMatch(/data-signup-ack[^>]*hidden/);
  });
});

describe('a submission that should be refused', () => {
  it('rejects a name that is only whitespace, and keeps every box filled', async () => {
    // Whitespace passes an HTML `required` attribute, so this is a submission that a
    // browser lets through and the server must not. **Losing the rest of the form on the
    // way back is the failure that actually matters** — on a phone, on bad signal, it is
    // the difference between one more tap and giving up.
    const response = await submit({
      name: '   ',
      email: 'worker-invalid@example.com',
      consent: 'on',
    });
    const page = await response.text();

    expect(response.status).toBe(422);
    expect(page).toContain('Enter your name.');
    expect(page).toMatch(/id="signup-name"[^>]*aria-invalid="true"/);
    // What they typed, still in the boxes — including the whitespace, because correcting
    // it for them is not this response's job.
    expect(page).toContain('value="   "');
    expect(page).toContain('value="worker-invalid@example.com"');
    expect(page).toMatch(/id="signup-consent"[^>]*checked/);
  });

  it('shows an error summary that takes focus', async () => {
    const page = await (await submit({ name: '', email: 'nope', consent: 'on' })).text();

    // `[ >]` after the attribute name on purpose: `data-signup-summary-item` starts with
    // the same characters, and a looser pattern matches the still-hidden consent entry and
    // reports the summary as hidden when it is not.
    expect(page).toMatch(/data-signup-summary[ >][^>]*autofocus/);
    expect(page).not.toMatch(/data-signup-summary[ >][^>]*hidden/);
    // One entry per offending field, and the consent entry still hidden because that one
    // was fine.
    expect(page).not.toMatch(/data-signup-summary-item="name"[^>]*hidden/);
    expect(page).not.toMatch(/data-signup-summary-item="email"[^>]*hidden/);
    expect(page).toMatch(/data-signup-summary-item="consent"[^>]*hidden/);
  });

  it('rejects a submission with the consent box unticked', async () => {
    // An unticked checkbox posts nothing at all, so this is what actually arrives.
    const response = await submit({ name: 'Grace Hopper', email: 'grace@example.com' });
    const page = await response.text();

    expect(response.status).toBe(422);
    expect(page).toContain('Tick the box to say we can email you when entries open.');
  });

  it('rejects a body that is not a form at all', async () => {
    // A bot, or a JSON post. There is nothing to preserve and nothing to say about
    // individual fields, and it must not throw.
    const response = await SELF.fetch(`${SITE}/nn/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mallory', email: 'mallory@example.com' }),
      redirect: 'manual',
    });

    expect(response.status).toBe(422);
  });

  it('is never cached, because the response now holds what somebody typed', async () => {
    const response = await submit({ name: '', email: '', consent: 'on' });

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('what a hostile submission gets back', () => {
  const HOSTILE = '"><script>alert(1)</script>';

  it('never breaks out of the attribute it is returned in', async () => {
    // The whole defence is that user input re-enters the page through `setAttribute` and
    // text-mode `setInnerContent`, both of which escape, and that there is no html-mode
    // call anywhere in `worker/nn-signup.ts` to audit.
    //
    // Asserting on the **breakout sequence** rather than on the substring `<script>`:
    // inside a double-quoted attribute value those characters are data, and a test that
    // banned them outright would fail for the wrong reason and teach the wrong lesson.
    // The email is deliberately malformed so this comes back as a re-rendered page rather
    // than a 303 — **`"><script>alert(1)</script>` is a perfectly valid name** as far as
    // this form is concerned, and a submission carrying one is accepted. It is what the
    // *page* does with it afterwards that has to be right.
    const page = await (
      await submit({ name: HOSTILE, email: 'not-an-address', consent: 'on' })
    ).text();

    expect(page).not.toContain(`"><script>`);
    expect(page).toContain('&quot;');
  });

  it('comes back as a value, not as an element', async () => {
    const page = await (
      await submit({ name: HOSTILE, email: HOSTILE, consent: 'on' })
    ).text();

    // The only `<script` in the document should be the one inside an attribute value. If a
    // real element ever appeared, the closing quote of the attribute would be before it.
    const inAttribute = page.match(/value="[^"]*&quot;><script>/);
    expect(inAttribute).not.toBeNull();
  });
});

describe('what the sign-up route does not claim', () => {
  it('leaves a POST to the privacy page alone', async () => {
    // A page, not an endpoint. It falls through to the assets binding, which refuses the
    // method — which is the honest answer and the one it gave before this form existed.
    const response = await SELF.fetch(`${SITE}/nn/privacy/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Mallory' }),
      redirect: 'manual',
    });

    expect(response.status).toBe(405);
  });

  it('leaves a POST to the root alone', async () => {
    const response = await SELF.fetch(`${SITE}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Mallory' }),
      redirect: 'manual',
    });

    expect(response.status).toBe(405);
  });
});

describe('a page that is reporting a failed submission', () => {
  it('carries no diagnostics either', async () => {
    // **This test used to assert the opposite, and the change is worth recording.**
    //
    // The two status markers were rewritten onto every HTML response including this one, on
    // the argument that a submission which just failed is exactly when somebody wants to know
    // whether the Worker can reach Postgres. That argument is right about the *need* and wrong
    // about the *audience*: the person reading this page is a runner whose form did not save,
    // and a database timestamp beside the apology helps them not at all. It is the maintainer
    // who wants it, and the maintainer has `/_health`, which answers whatever this page says.
    //
    // What the person gets instead is the notice — "nothing has been recorded, and nothing you
    // typed has been lost" — which is the sentence that was always doing the work.
    const page = await (await submit({ name: '', email: '', consent: '' })).text();

    expect(page).not.toContain('data-health');
    expect(page).not.toContain('data-pipeline-check');
    expect(page).not.toContain('What this page proves');
  });
});
