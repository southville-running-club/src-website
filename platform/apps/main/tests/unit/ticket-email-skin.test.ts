import { describe, expect, it } from 'vitest';

import { ticketEmailBody, type TicketOutboxMessage } from '@src/shared';
import {
  renderTicketEmailHtml,
  TICKET_BANNER_CONTENT_ID,
} from '../../worker/ticket-email-skin';

/**
 * The ticket confirmation's HTML part — ADR-041.
 *
 * **Why this is asserted rather than reviewed by eye**, which is `email-skin.test.ts`'s
 * argument one email along: an HTML email cannot be opened in the browser the way a page can,
 * so nothing in the ordinary loop looks at it. The facts it states, the escaping it does and
 * the degradation it promises are all invisible until somebody has already been sent one.
 *
 * The two rules worth stating outright, because everything below is a case of one of them:
 *
 *   1. **The HTML may never state a fact the text does not.** Both render from the same
 *      message, so a test that reads a value out of the text and finds it in the HTML is
 *      checking the property that actually matters.
 *   2. **Nothing a person typed reaches the markup unescaped.**
 */

const message: TicketOutboxMessage = {
  id: '11111111-2222-3333-4444-555555555555',
  template: 'ticket_confirmed',
  recipient: 'alex@example.com',
  attempts: 1,
  reference: 'CHRISTMASPARTY2026-0007-05092026',
  socialSlug: 'christmas-party-2026',
  socialName: 'SRC Christmas Party 2026',
  socialDate: '2026-12-05',
  venue: 'The Cock & Tail',
  startTime: '19:30:00',
  endTime: '01:00:00',
  amountPence: 2400,
  quantity: 2,
  purchaserName: 'Alex Example',
  replyTo: 'info@southvillerunningclub.co.uk',
};

describe('the confirmation card', () => {
  it('states the four facts the stub promises', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';

    expect(html).toContain('Saturday 5 December 2026');
    // The venue carries an ampersand, so finding it proves the escaping and the fact at once.
    expect(html).toContain('The Cock &amp; Tail');
    expect(html).toContain('2 tickets');
    expect(html).toContain('£24.00');
    expect(html).toContain('CHRISTMASPARTY2026-0007-05092026');
  });

  it('greets the buyer and asks about dietary requirements, which is the one thing not stored', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';

    expect(html).toContain('You&rsquo;re all set, Alex Example.');
    expect(html).toContain('Dietary requirements?');
    expect(html).toContain('mailto:info@southvillerunningclub.co.uk');
  });

  it('states nothing the text part does not', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';
    const text = ticketEmailBody(message).text;

    // The date, the count, the amount and the reference are the load-bearing four. Each is
    // read out of the text and looked for in the HTML, so the two cannot drift apart without
    // this failing — which is the property ADR-026 established and ADR-041 inherits.
    for (const fact of [
      'Saturday 5 December 2026',
      '2 tickets',
      '£24.00',
      'CHRISTMASPARTY2026-0007-05092026',
    ]) {
      expect(text).toContain(fact);
      expect(html).toContain(fact.replace('&', '&amp;'));
    }
  });

  it('leaves no placeholder unfilled', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';

    // The supplied template was written with `{{name}}` style placeholders. If one survived
    // the port it would be sent to a real person verbatim, and it would look exactly like a
    // broken mail-merge — which is what somebody who has just paid £24 would conclude.
    expect(html).not.toContain('{{');
    expect(html).not.toContain('}}');
  });
});

describe('escaping', () => {
  it('cannot be broken out of by a name', () => {
    const html =
      renderTicketEmailHtml(
        {
          ...message,
          purchaserName: '<script>alert(1)</script> & "friends"',
        },
        true,
      ) ?? '';

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;friends&quot;');
  });

  it('escapes the reply-to address in both the href and the visible text', () => {
    const html =
      renderTicketEmailHtml({ ...message, replyTo: 'a&b@example.com' }, true) ?? '';

    expect(html).not.toContain('a&b@example.com');
    expect(html).toContain('mailto:a&amp;b@example.com');
  });
});

describe('what it does when a fact is missing', () => {
  it('says the date is coming rather than printing null', () => {
    const html = renderTicketEmailHtml({ ...message, socialDate: null }, true) ?? '';

    expect(html).toContain('We will confirm nearer the time');
    expect(html).not.toContain('null');
  });

  it('says the venue is to be confirmed rather than leaving the cell blank', () => {
    const html = renderTicketEmailHtml({ ...message, venue: null }, true) ?? '';

    expect(html).toContain('To be confirmed');
    expect(html).not.toContain('null');
  });

  it('omits the times line entirely when there are no hours', () => {
    const withHours = renderTicketEmailHtml(message, true) ?? '';
    const without =
      renderTicketEmailHtml({ ...message, startTime: null, endTime: null }, true) ?? '';

    expect(withHours).toContain('7:30pm–1am');
    expect(without).not.toContain('7:30pm');
    // The day is still there — losing the hours must not lose the date with them.
    expect(without).toContain('Saturday 5 December 2026');
  });
});

describe('the banner', () => {
  it('references the attachment by content id when there is one', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';

    expect(html).toContain(`cid:${TICKET_BANNER_CONTENT_ID}`);
    // The alt text is built from the row, so a second social cannot inherit the party's date.
    expect(html).toContain('alt="SRC Christmas Party 2026 — Saturday 5 December 2026');
  });

  it('leaves the image out altogether when the file could not be read', () => {
    const html = renderTicketEmailHtml(message, false) ?? '';

    // **Not an `<img>` pointing at a cid nothing will resolve.** Several clients render that
    // as a broken-image icon, which reads as a broken email rather than as a plain one.
    expect(html).not.toContain('cid:');
    expect(html).not.toContain('<img');

    // The hero still carries its own words and its own red, so nothing is lost but decoration.
    expect(html).toContain('You&rsquo;re all set, Alex Example.');
    expect(html).toContain('#7A1E17');
  });
});

describe('what has no design', () => {
  it('returns null for the refund, so it sends as text alone', () => {
    expect(renderTicketEmailHtml({ ...message, template: 'ticket_refunded' }, true)).toBe(
      null,
    );
  });

  it('returns null for a template from a database ahead of this Worker', () => {
    expect(renderTicketEmailHtml({ ...message, template: 'ticket_reminder' }, true)).toBe(
      null,
    );
  });
});

describe('the shape an email client needs', () => {
  it('is a whole document, declares its charset and pins itself to light', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8"');
    // Without these two an aggressive client inverts a cream card into something unreadable.
    expect(html).toContain('name="color-scheme" content="light"');
    expect(html).toContain('name="supported-color-schemes" content="light"');
  });

  it('carries every responsive rule as an inline equivalent too', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';

    // Gmail's web client drops the media query, so the 600px width and the padding have to be
    // stated inline as well or the message arrives unstyled rather than merely unresponsive.
    expect(html).toContain('style="width:600px; max-width:600px;"');
    expect(html).toContain('padding:32px 34px 8px 34px');
  });

  it('draws the garland and the tear line from table cells, never an image', () => {
    const html = renderTicketEmailHtml(message, true) ?? '';

    // One `<img>` for the banner and nothing else — a decorative image is a second thing to
    // be blocked, and Outlook will not render a background image at all.
    expect(html.match(/<img/g)?.length).toBe(1);
    expect(html).toContain('bgcolor="#00C85A"');
    expect(html).toContain('bgcolor="#D8CEBA"');
    expect(html).not.toContain('background-image');
  });
});
