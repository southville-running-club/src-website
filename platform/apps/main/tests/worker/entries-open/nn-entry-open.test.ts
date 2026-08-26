import { afterEach, describe, expect, it } from 'vitest';
import {
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import worker from '../../../worker/index';

/**
 * `/nn/` **with entries open**, in the real Workers runtime, against the real build output.
 *
 * The window is moved by `global-setup.ts` before this run and put back afterwards — by the
 * same `update` the committee will run, with no preview flag and no local-only var that
 * could force a form open in production.
 *
 * `packages/shared/tests/unit/nn-entry.test.ts` proves the schema and
 * `packages/db/tests/entries.test.ts` proves the grants and the seeded rows. **Neither can
 * prove that any of it reaches a page**: that depends on `run_worker_first`, on the POST
 * handler being ordered before `env.ASSETS.fetch`, on the hidden `form` field routing to the
 * right processor, and on every `HTMLRewriter` selector matching something in `dist/`. A
 * mistyped `data-entry-*` hook leaves every other suite green and the form silently broken,
 * which is what this file is for.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

/**
 * A submission with nothing wrong with it, as the form would post it.
 *
 * **Overriding `email` moves the confirmation box with it**, unless a test says otherwise.
 * The two have to match to be valid, and leaving that to each caller cost half an hour once:
 * a test that only wanted a different address to write to got a 422 about the confirmation
 * box and read as though the thing under test had broken.
 */
function goodEntry(overrides: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = {
    // **Both forms are on this page again**, one shown at a time, so the hidden field is what
    // tells them apart. Inferring it from the entry window would read somebody's interest
    // submission as an entry if entries opened between the page loading and the button being
    // pressed.
    form: 'entry',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'worker-entry@example.com',
    emailConfirm: 'worker-entry@example.com',
    dobDay: '9',
    dobMonth: '12',
    dobYear: '1986',
    gender: 'female',
    feeCode: 'unaffiliated',
    emergencyName: 'Margaret Hamilton',
    emergencyPhone: '0117 496 0000',
    entryTerms: 'on',
    ...overrides,
  };

  if (overrides.email !== undefined && overrides.emailConfirm === undefined) {
    fields.emailConfirm = overrides.email;
  }

  return fields;
}

/**
 * A submission the server will refuse, so the page comes back with a body to assert on.
 *
 * **A valid entry now 303s to Stripe and answers with nothing at all**, so every test about
 * what appears in the HTML has to arrange a refusal first. A mismatched confirmation box is
 * the least intrusive way to do it: it leaves every other field alone, including whichever
 * one the test is actually about.
 */
function refusedEntry(overrides: Record<string, string> = {}): Record<string, string> {
  return goodEntry({ emailConfirm: 'a-different-address@example.com', ...overrides });
}

/** The entry form posts to the running it is for, which is its own address. */
function submit(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}${YEAR_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

/** The page the entry form is on. `/nn/` is the race; this is the 2026 running of it. */
const YEAR_PATH = '/nn/2026/';

const page = () => SELF.fetch(`${SITE}${YEAR_PATH}`).then((response) => response.text());

const racePage = () => SELF.fetch(`${SITE}/nn/`).then((response) => response.text());

/**
 * The fake Stripe's own counter, which is how this layer knows a session was created.
 *
 * **`pg` cannot run inside `workerd`**, so a test here cannot look in the database — that is
 * `packages/db/tests/entries-capacity.test.ts`'s job, and the acceptance suite's. What this
 * layer *can* see is that exactly one Checkout session was asked for, and since the session
 * carries the purchase id as its `client_reference_id`, one session means one purchase.
 */
async function sessionsCreated(): Promise<number> {
  const response = await fetch('http://127.0.0.1:8789/__stub/health');
  return ((await response.json()) as { created: number }).created;
}

/** The stub key the pool binds. Never a real one — see `vitest.worker.entries-open.config.ts`. */
const STUB_KEY = 'sk_test_STUB_NOT_A_REAL_KEY_0000000000';

describe('the race page, once the event row says entries are open', () => {
  it('changes the panel’s weight rather than adding a banner', async () => {
    // **The difference in prominence is the message.** The action goes from an outline to the
    // filled button and the fee line appears beneath it; there is deliberately no badge and no
    // sentence saying "entries are open", because the button already says it.
    const html = await racePage();

    expect(html).toMatch(
      /class="nn-cta"[^>]*href="\/nn\/2026\/#enter"[^>]*data-nn-panel-action/,
    );
    expect(html).toMatch(/data-nn-panel-shut[^>]*hidden/);
    expect(html).not.toMatch(/data-nn-panel-open[^>]*hidden/);
    expect(html.toLowerCase()).not.toContain('entries are open');
  });

  it('quotes the fees from the database, dearest first, without the free place', async () => {
    // `entries.fees` is the only place a price exists. A guide's place is left out: "Free"
    // beside two prices reads as an offer anybody can take, and it is not.
    const html = await racePage();

    expect(html).toContain('£20.00 unaffiliated · £18.00 affiliated');
    expect(html).not.toContain('>Free<');
  });

  it('keeps the panel in the order it had while entries were shut', async () => {
    // **Nothing moves when entries open**, so nobody has to relearn the page at the one moment
    // they are trying to do something. Only the action's weight and the note beneath it change.
    const html = await racePage();

    const at = (marker: string) => html.indexOf(marker);

    expect(at('data-nn-panel-date')).toBeLessThan(at('data-nn-panel-time'));
    expect(at('data-nn-panel-time')).toBeLessThan(at('data-nn-panel-action'));
    expect(at('data-nn-panel-action')).toBeLessThan(at('data-nn-panel-link="race-day"'));
  });

  it('has no entry form on it, and never will', async () => {
    // An entry is an entry to one running, and two forms writing to one table is two places
    // for a rule to be wrong.
    expect(await racePage()).not.toContain('data-entry-form');
  });

  it('relabels the navigation button, on the race page and on the year page', async () => {
    // The bar is painted from the same read. "Enter" is honest now, and it was not before.
    for (const html of [await racePage(), await page()]) {
      expect(html).toContain('aria-label="Enter the race"');
      expect(html).toContain('>Enter<');
    }
  });

  it('carries neither form, and points its one action at the entry', async () => {
    // **Neither form is on the race page any more** — both moved to the running. What changes
    // here when entries open is the panel's action: where it goes, what it says, and its
    // weight. There is no separate hero button; an anchor to a form that is not on the page
    // looks like a control and does nothing.
    const html = await racePage();

    expect(html).not.toContain('data-nn-interest');
    expect(html).not.toContain('data-entry-form');
    // Precisely: the navigation's button is `data-nn-nav-cta`, which contains this string.
    expect(html).not.toMatch(/\sdata-nn-cta\b/);
    expect(html).toMatch(/class="nn-cta" href="\/nn\/2026\/#enter"/);
  });
});

describe('the year page, once the event row says entries are open', () => {
  it('serves the entry form and hides the interest form', async () => {
    const html = await page();

    expect(html).toContain('Enter the race');
    expect(html).toMatch(/data-nn-interest[^>]*hidden/);
    expect(html).not.toMatch(/data-nn-entry hidden/);
  });

  it('takes its prices from entries.fees and none from the markup', async () => {
    // £18 and £20 live in `entries.fees.price_pence` and nowhere else. Nothing in `dist/`
    // knows either number — `nn-entry.test.ts` asserts the same page carries no `£` at all
    // when the window is shut.
    const html = await page();

    expect(html).toMatch(/data-entry-fee-price="affiliated">£18\.00/);
    expect(html).toMatch(/data-entry-fee-price="unaffiliated">£20\.00/);
    // A guide's place is free, and reads "Free" rather than "£0.00" — a price of nothing set
    // in the same figures as a price of something reads like a mistake.
    expect(html).toMatch(/data-entry-fee-price="vi_guide">Free/);
  });

  it('reveals every fee the event offers, and nothing it does not', async () => {
    const html = await page();

    for (const code of ['affiliated', 'unaffiliated', 'vi_guide']) {
      expect(html).not.toMatch(new RegExp(`data-entry-fee="${code}"[^>]*hidden`));
    }

    // **"and nothing it does not" was a claim this test did not check until #107 gave it
    // something to be wrong about.** `nn-2026` now carries a fourth fee — £1, gated behind
    // `nn.entry.before_open` — and this request is anonymous, so `entry_state()` must not
    // return it and the card must stay hidden.
    //
    // The window being *open* is what makes this the sharp version of the test: it proves the
    // fee is hidden by the **permission** rather than by the form not being on offer, which is
    // the only thing standing between a £1 entry and a page every runner can reach.
    expect(html).toMatch(/data-entry-fee="tester"[^>]*hidden/);
  });

  it('hands the enhancement the two rules it cannot read off the DOM', async () => {
    const html = await page();

    expect(html).toContain('data-entry-event-date="2026-11-01"');
    // **18, and it arrived without this file changing.** It was empty here until the
    // committee confirmed the minimum age on 13 August 2026; landing it was one `update` to
    // `entries.events.minimum_age` in a migration, and the form, the enhancement and this
    // attribute all picked it up with no markup moving. That is what the column is for.
    expect(html).toContain('data-entry-minimum-age="18"');
  });

  it('repoints the hero button at the entry form', async () => {
    const html = await page();

    expect(html).toMatch(/<a class="nn-cta" href="#enter"[^>]*>Enter the race/);
  });
});

describe('a valid entry, which now holds a place and goes to Stripe', () => {
  it('303s to a checkout.stripe.com address, and creates exactly one session', async () => {
    // **The handoff, and only the handoff.** Stripe's hosted page is a third party's; what
    // this asserts is that the Worker sends somebody *there* rather than somewhere else, and
    // that it asked for exactly one session doing it. Following the redirect would be testing
    // Stripe.
    const before = await sessionsCreated();

    const response = await submit(goodEntry());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(
      /^https:\/\/checkout\.stripe\.com\//,
    );
    // The page now belongs to one person's payment and nothing in front of it may hold a
    // copy.
    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(await sessionsCreated()).toBe(before + 1);
  });

  it('answers with no body at all, so nothing about the entry travels in it', async () => {
    const response = await submit(goodEntry({ email: 'worker-body@example.com' }));

    await expect(response.text()).resolves.toBe('');
  });

  it('is never mistaken for a sign-up acknowledgement', async () => {
    // The interest form's 303 and the entry's 303 are both redirects, and they used to be
    // reachable from one address — so this checks where it goes rather than that it is not a
    // redirect at all. The two forms are on two pages now and this is belt and braces.
    const response = await submit(goodEntry({ email: 'worker-fork@example.com' }));

    expect(response.headers.get('location')).not.toContain('signup=ok');
  });
});

describe('a free place, which a payment page cannot take a payment for', () => {
  it('is refused honestly, and nothing is written', async () => {
    // A visually impaired runner's guide pays nothing. Completing that would mean deciding
    // here that an unpaid entry counts as paid, and **nothing in this repository moves a
    // purchase to `paid`** — so it stops before a place is held and says so, with the race
    // address to write to.
    const before = await sessionsCreated();

    const response = await submit(goodEntry({ feeCode: 'vi_guide' }));
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).toMatch(/data-entry-free[^>]*autofocus/);
    expect(html).toContain("A guide's place cannot be booked online yet.");
    expect(html).toContain('Nothing has been charged.');

    expect(await sessionsCreated()).toBe(before);
  });

  it('keeps everything typed, so nothing has to be entered twice', async () => {
    const response = await submit(
      goodEntry({ club: "O'Sullivan Runners", feeCode: 'vi_guide' }),
    );
    const html = await response.text();

    expect(html).toContain('data-entry-value="firstName" value="Grace"');
    expect(html).toContain(`value="O'Sullivan Runners"`);
    expect(html).toMatch(/data-entry-checked="feeCode:vi_guide" checked/);
  });
});

describe('when no Stripe secret is configured, which is the deployed state today', () => {
  // The binding is removed for the length of one test and put straight back. This file is the
  // only one in its Vitest run and a file's tests run in order, so nothing else can see the
  // gap — the same reasoning the two window states are separate runs for, one scale down.
  afterEach(() => {
    (env as Record<string, unknown>).STRIPE_SECRET_KEY = STUB_KEY;
  });

  it('validates, stops, and stores nothing', async () => {
    // **Slice A's answer, word for word, and it has to stay true.** The Worker checks for a
    // key *before* it holds a place, so "nothing has been stored" is literally true rather
    // than nearly true — a place held against a payment that can never be taken would be a
    // number out of a 250-place race for half an hour.
    delete (env as Record<string, unknown>).STRIPE_SECRET_KEY;

    const before = await sessionsCreated();
    const response = await submit(goodEntry({ email: 'worker-nokey@example.com' }));
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).toMatch(/data-entry-unavailable[^>]*autofocus/);
    expect(html).toContain('payment is not connected yet');
    expect(html).toContain('nothing has been stored and nothing has been charged');

    expect(await sessionsCreated()).toBe(before);
  });

  it('still keeps every value in the boxes', async () => {
    delete (env as Record<string, unknown>).STRIPE_SECRET_KEY;

    const response = await submit(
      goodEntry({ club: "O'Sullivan Runners", email: 'worker-nokey2@example.com' }),
    );
    const html = await response.text();

    expect(html).toContain('data-entry-value="firstName" value="Grace"');
    expect(html).toContain(`value="O'Sullivan Runners"`);
  });
});

describe('the Stripe key, which must not appear anywhere a person can see', () => {
  it('is in no response body on any path through the form', async () => {
    // **A key rendered into a page is the failure nobody notices until it is public.** Every
    // outcome is checked rather than the happy one, because an error path is exactly where a
    // "print the request so we can debug it" would go in.
    const responses = await Promise.all([
      submit(goodEntry({ email: 'leak-ok@example.com' })),
      submit(goodEntry({ firstName: '   ' })),
      submit(goodEntry({ feeCode: 'vi_guide' })),
      SELF.fetch(`${SITE}/nn/`),
      SELF.fetch(`${SITE}/nn/2026/entry/complete/?session=cs_test_notreal`),
    ]);

    for (const response of responses) {
      const body = await response.text();

      for (const secret of [
        'sk_' + 'test_',
        'sk_' + 'live_',
        'rk_' + 'live_',
        STUB_KEY,
      ]) {
        expect(body).not.toContain(secret);
      }
    }
  });
});

describe('the cron that sweeps lapsed holds', () => {
  it('runs, and reports how many places came back', async () => {
    // **Housekeeping, and the assertion is that it does not throw rather than that it does
    // anything.** Capacity already excludes a lapsed hold, so a run that expires nothing is
    // the ordinary case and the correct one — `packages/db/tests/entries-capacity.test.ts`
    // covers what it moves. What this layer proves is that the handler is wired up, reaches
    // Postgres through the same anon client every request uses, and needs no privileged
    // credential to do it.
    const context = createExecutionContext();

    await worker.scheduled?.(
      createScheduledController(),
      env as Parameters<NonNullable<typeof worker.scheduled>>[1],
      context,
    );

    await waitOnExecutionContext(context);
  });
});

describe('an entry the server refuses', () => {
  it('answers 422 with the summary in focus and each message attached', async () => {
    const response = await submit(
      goodEntry({ firstName: '   ', emailConfirm: 'wrong@example.com' }),
    );
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toMatch(/data-entry-summary[^>]*autofocus/);
    expect(html).toContain('Enter your first name.');
    expect(html).toContain('The two email addresses do not match');
  });

  it('lists every problem at once rather than one at a time', async () => {
    // The property that matters most on a fourteen-field form: somebody on a phone should not
    // discover a second problem after fixing the first.
    const response = await submit(
      goodEntry({ firstName: '   ', gender: '', emergencyPhone: '' }),
    );
    const html = await response.text();

    for (const field of ['firstName', 'gender', 'emergencyPhone']) {
      expect(html).not.toMatch(new RegExp(`data-entry-summary-item="${field}" hidden`));
    }
  });

  it('keeps the textarea, the select and the checkboxes as well as the text boxes', async () => {
    const response = await submit(
      goodEntry({
        firstName: '   ',
        feeCode: 'affiliated',
        eaNumber: '1234567',
        medicalNotes: 'Type 1 diabetic.',
        medicalConsent: 'on',
      }),
    );
    const html = await response.text();

    expect(html).toContain('data-entry-value="firstName" value="   "');
    expect(html).toContain('data-entry-value="eaNumber" value="1234567"');
    expect(html).toMatch(/data-entry-text="medicalNotes">Type 1 diabetic\./);
    expect(html).toMatch(/data-entry-checked="medicalConsent" checked/);
    expect(html).toMatch(/data-entry-checked="entryTerms" checked/);
    expect(html).toMatch(/<option value="female"[^>]*selected/);
  });

  it('marks only the fields that actually have a message', async () => {
    const response = await submit(goodEntry({ firstName: '   ' }));
    const html = await response.text();

    expect(html).toMatch(/data-entry-value="firstName"[^>]*aria-invalid="true"/);
    expect(html).not.toMatch(/data-entry-value="lastName"[^>]*aria-invalid/);
  });

  it('marks all three date boxes, because the question is one question', async () => {
    const response = await submit(goodEntry({ dobDay: '31', dobMonth: '2' }));
    const html = await response.text();

    expect(html).toContain('That is not a date.');
    for (const part of ['dobDay', 'dobMonth', 'dobYear']) {
      expect(html).toMatch(
        new RegExp(`data-entry-value="${part}"[^>]*aria-invalid="true"`),
      );
    }
  });

  it('asks for an England Athletics number only when affiliated was chosen', async () => {
    const affiliated = await submit(goodEntry({ feeCode: 'affiliated' }));
    expect(await affiliated.text()).toContain('Enter your England Athletics number');

    const unaffiliated = await submit(goodEntry({ feeCode: 'unaffiliated' }));
    expect(await unaffiliated.text()).not.toContain(
      'Enter your England Athletics number',
    );
  });

  it('refuses a fee code the event is not offering', async () => {
    const response = await submit(goodEntry({ feeCode: 'mates_rates' }));

    expect(response.status).toBe(422);
    expect(await response.text()).toContain('Choose one of the entry types listed.');
  });

  it('refuses medical notes written without the separate consent', async () => {
    // Special category data under UK GDPR Article 9. Ticking the entry terms is not consent
    // to hold it, and the form does not quietly bin what somebody wrote either.
    const response = await submit(
      goodEntry({ medicalNotes: 'Asthma. Carries an inhaler.' }),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).toContain('Tick the box to let the club hold it');
  });

  it('is not held by any cache, because the page now holds what somebody typed', async () => {
    const response = await submit(goodEntry({ firstName: '   ' }));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

/**
 * **What "escaped" means differs between an attribute and element content**, and the
 * assertions below have to know which they are looking at or they test nothing.
 *
 * `setAttribute` escapes `&` and `"`. It leaves `<`, `>` and `'` alone, and that is correct
 * rather than a gap: inside a double-quoted attribute value those three are ordinary
 * characters with no way to end the attribute or start an element. The **`"` is the whole
 * defence**, because it is the only character that could close the value early and let what
 * follows be parsed as markup.
 *
 * `setInnerContent` in its default text mode escapes `<`, `>` and `&`, which is what element
 * content needs.
 *
 * So an assertion of the form `expect(html).not.toContain('<script>')` is the wrong test for
 * an attribute — the substring is genuinely there and genuinely inert. The right test is
 * that the quote never survives, which is what these assert. `nn-entry.spec.ts` asserts the
 * end of the same story in a real browser, where the value comes back as a value.
 */
describe('what must never reach the HTML unescaped', () => {
  it('cannot break out of the attribute it is returned into', async () => {
    // `"><script>` is a perfectly legal thing to be called as far as this form is concerned.
    // The guarantee is that no handler in `worker/nn-entry.ts` calls `setInnerContent` in
    // html mode — there is deliberately no such call anywhere in this repository to audit.
    // Refused rather than valid, because a valid entry now redirects and has no body at all
    // to look for a payload in. The refusal is on the confirmation box; the payload is still
    // in the first-name field, which is what this is about.
    const response = await submit(
      refusedEntry({ firstName: '"><script>window.__xss=1</script>' }),
    );
    const html = await response.text();

    // The quote is escaped, so the value never ends where the attacker wanted it to.
    expect(html).toContain('value="&quot;><script>window.__xss=1</script>"');
    // And there is no unquoted escape anywhere: the raw sequence that *would* have closed
    // the attribute does not appear.
    expect(html).not.toContain('value=""><script>');
  });

  it('escapes markup posted into the medical textarea', async () => {
    // The one field returned as element content rather than as an attribute, so it is the one
    // where an html-mode write would put live markup on the page instead of breaking an
    // attribute.
    const response = await submit(
      goodEntry({
        firstName: '   ',
        medicalNotes: '</textarea><script>window.__xss=1</script>',
        medicalConsent: 'on',
      }),
    );
    const html = await response.text();

    expect(html).not.toContain('</textarea><script>');
    expect(html).toContain('&lt;/textarea&gt;');
  });

  it('holds the same line on every text field, not just the first one', async () => {
    const response = await submit(
      goodEntry({
        firstName: '   ',
        club: '"><img src=x onerror=alert(1)>',
        emergencyName: '" onfocus="alert(1)',
      }),
    );
    const html = await response.text();

    expect(html).toContain('value="&quot;><img src=x onerror=alert(1)>"');
    expect(html).not.toContain('value=""><img');
    expect(html).toContain('value="&quot; onfocus=&quot;alert(1)"');
    expect(html).not.toContain('value="" onfocus="alert(1)"');
  });

  it('leaves a literal ampersand alone, which is a fidelity limit and not a hole', async () => {
    // **`setAttribute` escapes `"` and not `&`, and this records that rather than wishing
    // otherwise.** It is not a way out of the attribute: the parser fixes attribute
    // boundaries before it decodes entities, so `&quot;` in the output is a quote *inside*
    // the value and never a delimiter. What it does cost is round-trip fidelity — somebody
    // who literally types `&quot;` gets a `"` back when the form re-renders.
    //
    // Ordinary ampersands are unaffected: `Bath & Wells AC` is not a valid entity and comes
    // back as typed. The interest form's `ValueHandler` behaves identically, so this is the
    // Workers runtime's behaviour rather than something either form chose. Worth a test so
    // the next person meets the number rather than the surprise.
    const response = await submit(
      goodEntry({ firstName: '   ', club: 'Bath & Wells AC' }),
    );
    const html = await response.text();

    expect(html).toContain('value="Bath & Wells AC"');
  });
});
