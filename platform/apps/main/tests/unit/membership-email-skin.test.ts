import { afterEach, describe, expect, it, vi } from 'vitest';

import { membershipEmailBody, type MembershipOutboxMessage } from '@src/shared';
import { renderMembershipEmailHtml } from '../../worker/membership-email-skin';
import { sendMembershipMessage } from '../../worker/membership-outbox';

/**
 * The membership acknowledgement's HTML part.
 *
 * **Why this is asserted rather than reviewed by eye**, which is `email-skin.test.ts`'s
 * argument two emails along: an HTML email cannot be opened in the browser the way a page can,
 * so nothing in the ordinary loop looks at it. What it states, what it escapes and what it
 * refuses to carry are all invisible until somebody has already been sent one.
 *
 * Three rules, and everything below is a case of one of them:
 *
 *   1. **The HTML may never state a fact the text does not.** Both render from the same
 *      message, so reading a value out of the text and finding it in the HTML checks the
 *      property that actually matters.
 *   2. **Nothing a person typed reaches the markup unescaped.**
 *   3. ⚠️ **The acknowledgement carries three facts about the applicant and no fourth.**
 *      `claim_outbox_batch()` returns `details: null` for this template, so there is nothing
 *      else in the row to leak — the fixture below sets `details` anyway, with a real address
 *      and date of birth in it, so the test would fail the day somebody widened the query and
 *      reached for one.
 */

const message: MembershipOutboxMessage = {
  id: '11111111-2222-3333-4444-555555555555',
  template: 'application_received',
  recipient: 'alex@example.com',
  attempts: 1,
  firstName: 'Alex',
  lastName: 'Example',
  membershipName: 'SRC membership and an England Athletics licence',
  pricePence: 2700,
  replyTo: 'membership@southvillerunningclub.co.uk',
  details: null,
};

/**
 * The same applicant, with every answer the club's own copy would carry.
 *
 * ⚠️ **Every value here is chosen not to collide with the template's own boilerplate**, and
 * that is not fussiness — it is the trap this repository already paid for with a leak
 * assertion matching `2000` against an SVG namespace. The club's real address is *Dean Lane,
 * Southville*, and both words are printed in this email as the club's own name and meeting
 * place. A fixture using either as the applicant's address makes `not.toContain()` fail on a
 * template that leaked nothing — or, written the other way round, pass on one that did.
 * **A needle for a leak test has to be a string only a leak could put there.**
 */
const withDetails: MembershipOutboxMessage = {
  ...message,
  details: {
    title: 'Mx',
    email: 'alex@example.com',
    phone: '07700900123',
    dateOfBirth: '1990-04-12',
    addressLine1: '221B Pemberton Row',
    addressLine2: 'Marlbury Wharf',
    cityTown: 'Kirkbourne',
    postcode: 'ZZ9 4QX',
    country: 'GB',
    membershipType: 'club_ea',
    previousAffiliation: true,
    previousClubName: 'Example Harriers',
    eaUrn: '1234567',
    consentsVersion: '2026-09-25',
  },
};

describe('the three facts it states', () => {
  it('greets the applicant by the name the text part greets them by', () => {
    const html = renderMembershipEmailHtml(message);
    const { text } = membershipEmailBody(message);

    expect(text).toContain('Hello Alex,');
    expect(html).toContain('Hello Alex,');
  });

  it('names the membership they chose, as the text part names it', () => {
    const html = renderMembershipEmailHtml(message);
    const { text } = membershipEmailBody(message);

    expect(text).toContain('SRC membership and an England Athletics licence');
    expect(html).toContain('SRC membership and an England Athletics licence');
  });

  it('states the price the text part states, formatted the same way', () => {
    const html = renderMembershipEmailHtml(message);
    const { text } = membershipEmailBody(message);

    // Derived from the fixture rather than written as a literal: a hard-coded `£27` stops
    // testing anything the moment the club reprices, and does so silently.
    expect(text).toContain('£27 a year');
    expect(html).toContain('£27 a year');
  });

  it('states a free membership as the text part does, rather than as £0', () => {
    const free = { ...message, pricePence: 0 };

    expect(renderMembershipEmailHtml(free)).toContain('Free a year');
    expect(membershipEmailBody(free).text).toContain('Free a year');
  });
});

describe('what it may never carry', () => {
  /**
   * ⚠️ **The fixture has a home address and a date of birth and the markup may contain
   * neither.** This is the assertion that would fail if `claim_outbox_batch()` were ever
   * widened to return `details` for the acknowledgement and somebody reached for one.
   */
  it('renders no field from the applicant row but the three it is allowed', () => {
    const html = renderMembershipEmailHtml(withDetails) ?? '';

    for (const secret of [
      '221B Pemberton Row',
      'Marlbury Wharf',
      'Kirkbourne',
      'ZZ9 4QX',
      '1990-04-12',
      '07700900123',
      '1234567',
      'Example Harriers',
      'club_ea',
      // The surname is on the row and is not one of the three: the greeting is a first name.
      'Example',
    ]) {
      expect(html).not.toContain(secret);
    }
  });

  it('has no remote asset, no webfont link and no tracking pixel', () => {
    const html = renderMembershipEmailHtml(message) ?? '';

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('http://');
    // The two `xmlns:` declarations are namespace identifiers Outlook parses, not fetches.
    expect(html.replace(/xmlns:[a-z]+="[^"]*"/g, '')).not.toContain('https://');
  });

  it('gives the club’s own copy no HTML part at all, rather than the applicant’s', () => {
    expect(
      renderMembershipEmailHtml({ ...withDetails, template: 'application_submitted' }),
    ).toBeNull();
  });
});

describe('escaping', () => {
  it('renders a name containing markup as text', () => {
    const html =
      renderMembershipEmailHtml({ ...message, firstName: '<script>alert(1)</script>' }) ??
      '';

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes an ampersand and an apostrophe in a name', () => {
    const html =
      renderMembershipEmailHtml({ ...message, firstName: "Ben & O'Hara" }) ?? '';

    expect(html).toContain('Ben &amp; O&#39;Hara');
    expect(html).not.toContain("O'Hara");
  });

  it('escapes the membership name, which is a database value like any other', () => {
    const html =
      renderMembershipEmailHtml({ ...message, membershipName: 'Club & <b>EA</b>' }) ?? '';

    expect(html).toContain('Club &amp; &lt;b&gt;EA&lt;/b&gt;');
    expect(html).not.toContain('<b>EA</b>');
  });
});

describe('the markup the design specifies', () => {
  /**
   * ⚠️ **Outlook's Word engine ignores `max-width`**, so the conditional pair is what stops the
   * card filling the window there. It is invisible to every other client, which is exactly why
   * a tidy-up would delete it without anything going red.
   */
  it('gives Outlook a literal 600px table and everyone else a fluid one', () => {
    const html = renderMembershipEmailHtml(message) ?? '';

    expect(html).toContain('<!--[if mso]><table role="presentation" width="600"');
    expect(html).toContain('<!--[if mso]></td></tr></table><![endif]-->');
    expect(html).toContain('style="max-width:600px; width:100%;"');
  });

  it('carries the preheader, hidden, saying nothing has been charged', () => {
    const html = renderMembershipEmailHtml(message) ?? '';

    expect(html).toContain('mso-hide:all');
    expect(html).toContain('Thanks for applying. Nothing has been charged');
  });
});

describe('the text part', () => {
  /**
   * ⚠️ **Pinned exactly, because this change must not have touched it.** The text is
   * authoritative and the HTML is the addition; a diff that moved a word here would mean the
   * two had been allowed to drift.
   */
  it('is unchanged, byte for byte', () => {
    const { subject, text } = membershipEmailBody(message);

    expect(subject).toBe("We've got your application to join Southville Running Club");
    expect(text).toBe(
      [
        'Hello Alex,',
        '',
        'Thanks for applying to join Southville Running Club. We have your application for SRC membership and an England Athletics licence, £27 a year.',
        '',
        'The Membership Officer will set your membership up on the England Athletics portal, and England Athletics will email you the link to pay. Nothing is paid on the club website.',
        '',
        'You are welcome at a run in the meantime, member or not. Tuesdays and Thursdays at the Southbank Club, Dean Lane. Meet 6.00pm for a 6.15pm start.',
        '',
        'Southville Running Club',
        'Reply to this email if you need to ask us anything.',
      ].join('\n'),
    );
  });
});

describe('what actually leaves the Worker', () => {
  /**
   * Captures the one `POST /emails` and answers it the way Resend does, which is
   * `email.test.ts`'s helper one schema along. The request body is the thing worth
   * protecting — reading it is checking exactly what the provider receives.
   */
  async function bodyOf(input: MembershipOutboxMessage): Promise<{
    subject: string;
    text: string;
    html?: string;
  }> {
    let captured: { subject: string; text: string; html?: string } | null = null;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = JSON.parse(String(init.body)) as typeof captured;
        return new Response(JSON.stringify({ id: 'msg_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const outcome = await sendMembershipMessage(input, {
      apiKey: 'not-a-real-key',
      apiBase: 'https://api.example.invalid',
    });

    expect(outcome.ok, `send failed: ${JSON.stringify(outcome)}`).toBe(true);
    expect(captured).not.toBeNull();

    return captured!;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the acknowledgement as both html and text', async () => {
    const body = await bodyOf(message);

    expect(body.text).toContain('Hello Alex,');
    expect(body.html).toContain('Hello Alex,');
    expect(body.html).toContain('<!DOCTYPE html>');
  });

  /**
   * ⚠️ **Omitted rather than sent as null**, because Resend's own validation rejects a null
   * `html` — so the club's copy would stop sending altogether rather than send as text.
   */
  it('omits html entirely on the club’s copy rather than sending null', async () => {
    const body = await bodyOf({ ...withDetails, template: 'application_submitted' });

    expect(body.text).toContain('has applied to join');
    expect('html' in body).toBe(false);
  });
});
