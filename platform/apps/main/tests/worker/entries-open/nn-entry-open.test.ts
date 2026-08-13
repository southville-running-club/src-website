import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

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

/** A submission with nothing wrong with it, as the form would post it. */
function goodEntry(overrides: Record<string, string> = {}): Record<string, string> {
  return {
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
}

function submit(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

const page = () => SELF.fetch(`${SITE}/nn/`).then((response) => response.text());

describe('the page, once the event row says entries are open', () => {
  it('serves the entry form and hides the interest form', async () => {
    const html = await page();

    expect(html).toContain('Enter the race');
    expect(html).toMatch(/data-nn-interest hidden/);
    expect(html).not.toMatch(/data-nn-entry hidden/);
  });

  it('takes its prices from entries.fees and none from the markup', async () => {
    // £15 and £17 live in `entries.fees.price_pence` and nowhere else. Nothing in `dist/`
    // knows either number — `nn-entry.test.ts` asserts the same page carries no `£` at all
    // when the window is shut.
    const html = await page();

    expect(html).toMatch(/data-entry-fee-price="affiliated">£15\.00/);
    expect(html).toMatch(/data-entry-fee-price="unaffiliated">£17\.00/);
    // A guide's place is free, and reads "Free" rather than "£0.00" — a price of nothing set
    // in the same figures as a price of something reads like a mistake.
    expect(html).toMatch(/data-entry-fee-price="vi_guide">Free/);
  });

  it('reveals every fee the event offers, and nothing it does not', async () => {
    const html = await page();

    for (const code of ['affiliated', 'unaffiliated', 'vi_guide']) {
      expect(html).not.toMatch(new RegExp(`data-entry-fee="${code}"[^>]*hidden`));
    }
  });

  it('hands the enhancement the two rules it cannot read off the DOM', async () => {
    const html = await page();

    expect(html).toContain('data-entry-event-date="2026-11-01"');
    // **Empty, because no minimum age has been confirmed.** Not `18`, which is inferred from
    // where a prize band starts, and not absent either.
    expect(html).toContain('data-entry-minimum-age=""');
  });

  it('repoints the hero button at the entry form', async () => {
    const html = await page();

    expect(html).toMatch(/<a class="nn-cta" href="#enter"[^>]*>Enter the race/);
  });
});

describe('a valid entry, which Slice A deliberately does not take', () => {
  it('is refused honestly, because there is no payment to send it to', async () => {
    // **The most important assertion in this file.** A confirmation for an entry that does
    // not exist is worth more than every other failure here put together, so a good
    // submission gets a 503 and a notice saying nothing was stored and nothing charged.
    const response = await submit(goodEntry());
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).toMatch(/data-entry-unavailable[^>]*autofocus/);
    expect(html).toContain('payment is not connected yet');
    expect(html).toContain('nothing has been stored and nothing has been charged');
  });

  it('is never mistaken for a sign-up acknowledgement', async () => {
    // The interest form's acknowledgement lives on the same page. If an entry POST ever took
    // the sign-up branch, this is what would notice.
    const response = await submit(goodEntry());
    const html = await response.text();

    expect(response.status).not.toBe(303);
    expect(html).not.toMatch(/data-signup-ack[^>]*autofocus/);
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
    const response = await submit(
      goodEntry({ firstName: '"><script>window.__xss=1</script>' }),
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
