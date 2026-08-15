import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * `/nn/2026/` **when the race is full**, in the real Workers runtime.
 *
 * A third run rather than a third describe block, because capacity is global state and a
 * sold-out event inside the entries-open run would make every other assertion there depend on
 * whether it had happened yet. `global-setup.ts` books the only place and puts it back.
 *
 * **Losing somebody's typing is the failure this file is really about.** Being told the race
 * went while you were filling in fourteen fields is bad enough; being handed an empty form
 * afterwards is what turns it into a grievance, and it is the one moment somebody might want
 * to write and ask about a waiting list.
 *
 * `packages/db/tests/entries-capacity.test.ts` proves that two simultaneous transactions
 * cannot both take the last place. **This proves the answer reaches a page** — which depends
 * on the refusal being returned rather than raised, on the notice's selector matching
 * something in `dist/`, and on the form being re-painted before the notice is revealed.
 */

const SITE = 'https://new.southvillerunningclub.co.uk';

function goodEntry(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    // No `form` field: the address is what says this is an entry.
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'sold-out@example.com',
    emailConfirm: 'sold-out@example.com',
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

/** The entry form posts to the running it is for, which is its own address. */
function submit(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}/nn/2026/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

describe('a valid entry for a race that has just filled up', () => {
  it('answers 409 and says so in words', async () => {
    // 409, not 422 or 503: the submission was well-formed and the state of the world moved
    // between the page being served and the button being pressed — the same shape as entries
    // closing mid-form, one table along.
    const response = await submit(goodEntry());
    const html = await response.text();

    expect(response.status).toBe(409);
    expect(html).toMatch(/data-entry-soldout[^>]*autofocus/);
    expect(html).toContain('The race is full.');
    expect(html).toContain('Nothing has been charged and no entry has been taken.');
  });

  it('never reaches Stripe at all', async () => {
    // **The capacity check comes before the payment page.** `vitest.worker.sold-out.config.ts`
    // points `STRIPE_API_BASE` at a port nothing is listening on, so a submission that did
    // reach Stripe would fail rather than quietly succeed against a stub — which is what
    // makes this assertion mean something.
    const response = await submit(goodEntry());

    expect(response.status).toBe(409);
    expect(response.headers.get('location')).toBeNull();
  });

  it('keeps every typed value, including the ones easiest to lose', async () => {
    // The date-of-birth parts, the chosen fee and the medical notes are the three that a
    // naive re-render drops: three inputs for one question, a radio rather than a value, and
    // a textarea whose content is not an attribute.
    const response = await submit(
      goodEntry({
        club: "O'Sullivan Runners",
        feeCode: 'affiliated',
        eaNumber: '1234567',
        medicalNotes: 'Type 1 diabetic.',
        medicalConsent: 'on',
      }),
    );
    const html = await response.text();

    expect(html).toContain('data-entry-value="firstName" value="Grace"');
    expect(html).toContain(`value="O'Sullivan Runners"`);
    expect(html).toContain('data-entry-value="dobDay" value="9"');
    expect(html).toContain('data-entry-value="dobMonth" value="12"');
    expect(html).toContain('data-entry-value="dobYear" value="1986"');
    expect(html).toContain('data-entry-value="eaNumber" value="1234567"');
    expect(html).toMatch(/data-entry-checked="feeCode:affiliated" checked/);
    expect(html).toMatch(/data-entry-text="medicalNotes">Type 1 diabetic\./);
    expect(html).toMatch(/data-entry-checked="medicalConsent" checked/);
    expect(html).toMatch(/<option value="female"[^>]*selected/);
  });

  it('leaves the entry form on the page, with its prices, rather than hiding it', async () => {
    // Somebody who has just been told the race is full should still be looking at what they
    // filled in — not at a bare notice with the form gone from under it.
    const response = await submit(goodEntry());
    const html = await response.text();

    expect(html).not.toMatch(/data-nn-entry hidden/);
    expect(html).toMatch(/data-entry-fee-price="unaffiliated">£17\.00/);
  });

  it('is not held by any cache, because the page now holds what somebody typed', async () => {
    const response = await submit(goodEntry());

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('still refuses an invalid submission on its contents first', async () => {
    // Validation comes before capacity, and it should: telling somebody the race is full when
    // they have also mistyped their email address gives them one problem to solve and then
    // another. 422 with the summary is the same answer it would be on an empty race.
    const response = await submit(goodEntry({ firstName: '   ' }));
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toMatch(/data-entry-summary[^>]*autofocus/);
    expect(html).not.toMatch(/data-entry-soldout[^>]*autofocus/);
  });
});
