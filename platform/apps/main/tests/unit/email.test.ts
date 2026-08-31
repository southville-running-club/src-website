import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendOutboxMessage, type EmailConfig } from '../../worker/email';
import type { OutboxMessage } from '@src/shared';

/**
 * What the club's four transactional messages actually say, asserted with no network in the
 * way — the same argument `stripe.test.ts` makes about the Checkout body.
 *
 * **The money sentences are the whole reason this file exists.** Two of the four quote an
 * amount, and both were written for a purchase that went through Stripe. ADR-028 then made a
 * purchase that did not: a place the club *gives*, `paid` at £0 on a £0 fee — Kinsi's two, and
 * the free place a visually impaired runner's guide is given. Against one of those the
 * confirmation said *"we have received your payment of £0.00"* and the cancellation said
 * *"we have refunded £0.00 to the card you paid with"*, which names a card nobody gave.
 *
 * The second is the one that costs somebody an afternoon: they go and look at a card statement
 * for a refund that is not coming. #150.
 *
 * `render` is not exported, deliberately — the thing worth protecting is what leaves the
 * Worker, so these go through `sendOutboxMessage` and read the request body, exactly as the
 * provider would.
 */

const CONFIG: EmailConfig = {
  apiKey: 'not-a-real-key',
  apiBase: 'https://api.example.invalid',
  // `null` here on purpose: this file asserts the text part, which email-skin.ts's own
  // header comment says never changes with the banner's availability. The attachment
  // mechanics themselves are asserted in the "the banner attachment" block below.
  bannerAttachment: null,
};

function message(overrides: Partial<OutboxMessage> = {}): OutboxMessage {
  return {
    id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    template: 'entry_confirmed',
    recipient: 'runner@example.com',
    attempts: 0,
    purchaseReference: '11111111-2222-3333-4444-555555555555',
    eventName: 'Nightingale Nightmare 2026',
    eventDate: '1 November 2026',
    amountPence: 2000,
    entrantFirstName: 'Ada',
    replyTo: 'nightingalenightmare@example.com',
    ...overrides,
  };
}

/**
 * Captures the one `POST /emails` and answers it the way Resend does. Returns the parsed body,
 * which is what every assertion below reads.
 */
interface CapturedBody {
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    content_type: string;
    content_id: string;
  }>;
}

async function bodyOf(
  input: OutboxMessage,
  config: EmailConfig = CONFIG,
): Promise<CapturedBody> {
  let captured: CapturedBody | null = null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body)) as CapturedBody;
      return new Response(JSON.stringify({ id: 'msg_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  const outcome = await sendOutboxMessage(config, input);

  expect(outcome.ok, `send failed: ${JSON.stringify(outcome)}`).toBe(true);
  expect(captured).not.toBeNull();

  return captured!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a place that was paid for', () => {
  it('says what was received, and what it was', async () => {
    const body = await bodyOf(message());

    expect(body.text).toContain('we have received your payment of £20.00');
  });

  it('tells somebody cancelled how long their bank will take', async () => {
    // **Stated, because not stating it is what generates the email asking where the money
    // is.** Stripe reports a card refund as pending for several days routinely.
    const body = await bodyOf(message({ template: 'entry_refunded' }));

    expect(body.text).toContain('we have refunded £20.00 to the card you paid with');
    expect(body.text).toContain('five to ten working days');
  });
});

describe('a place the club gave away', () => {
  it('does not tell somebody the club received a payment of nothing', async () => {
    const body = await bodyOf(message({ amountPence: 0 }));

    expect(body.text).toContain('The club has given you this place');
    expect(body.text).toContain('there is nothing to pay');
    expect(body.text).not.toContain('£0.00');
    expect(body.text).not.toContain('received your payment');
  });

  it('does not tell somebody money is on its way back to a card they never gave', async () => {
    // **The sharper of the two.** The old wording sent somebody to check a card statement for
    // a refund that could never arrive, about a place they were given.
    const body = await bodyOf(message({ template: 'entry_refunded', amountPence: 0 }));

    expect(body.text).toContain('Nothing was paid for this place');
    expect(body.text).toContain('there is nothing to refund');
    expect(body.text).not.toContain('£0.00');
    expect(body.text).not.toContain('the card you paid with');
    // **And the bank's timing goes with it**, rather than being left in as harmless filler:
    // it tells somebody to expect money in their account, which is the exact wrong thing to
    // say to somebody who is owed none.
    expect(body.text).not.toContain('five to ten working days');
  });

  it('is otherwise the same message, because a given place is a real place', async () => {
    // It holds one of the 250, it is on the start list, and it appears on
    // `/account/entries/`. Only the sentence about money differs, because only the money does.
    const body = await bodyOf(message({ amountPence: 0 }));

    expect(body.subject).toBe('Your place in Nightingale Nightmare 2026 is confirmed');
    expect(body.text).toContain('Hello Ada,');
    expect(body.text).toContain(
      'Your reference is 11111111-2222-3333-4444-555555555555.',
    );
    expect(body.text).toContain('/account/entries/');
  });

  it('leaves no gap where the sentence it dropped used to be', async () => {
    // `join` renders a `null` as an empty string, so a dropped line would have left a
    // two-line gap in the middle of the message — which reads as a template fault rather than
    // as a deliberate omission.
    const body = await bodyOf(message({ template: 'entry_refunded', amountPence: 0 }));

    expect(body.text).not.toContain('\n\n\n');
  });
});

describe('the banner attachment', () => {
  const withBanner: EmailConfig = {
    ...CONFIG,
    bannerAttachment: {
      filename: 'nn-email-banner-1080x566.png',
      content: 'ZmFrZS1wbmctYnl0ZXM=',
      contentType: 'image/png',
      contentId: 'nn-email-banner',
    },
  };

  it('is attached when this run has one', async () => {
    const body = await bodyOf(message(), withBanner);

    expect(body.attachments, 'no attachments array sent').toBeDefined();
    expect(body.attachments).toEqual([
      {
        filename: 'nn-email-banner-1080x566.png',
        content: 'ZmFrZS1wbmctYnl0ZXM=',
        content_type: 'image/png',
        content_id: 'nn-email-banner',
      },
    ]);
  });

  it('is not sent as a null field when this run does not have one', async () => {
    // The one CONFIG every other test in this file uses already has `bannerAttachment: null`
    // — asserted here explicitly, so a future change to that default does not go unnoticed.
    const body = await bodyOf(message());

    expect(body.attachments).toBeUndefined();
    expect(Object.hasOwn(body, 'attachments')).toBe(false);
  });

  it('does not stop the message sending when the banner could not be fetched', async () => {
    // The whole point of the null case: a runner still gets told they have a place.
    const outcome = await bodyOf(message({ template: 'entry_refunded' }));

    expect(outcome.text).toContain('has been cancelled');
  });
});
