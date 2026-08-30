/**
 * Resend, over `fetch`, with no SDK — and the four messages the club sends about an entry.
 *
 * ## Why no SDK
 *
 * The same argument `worker/stripe.ts` makes, and it lands harder here: this file makes one
 * call, `POST /emails`, and reads one field off the answer. `resend` the npm package carries
 * its own HTTP client and a React renderer nobody here uses.
 *
 * ## What must never leak
 *
 * Two things, and they are different kinds:
 *
 *   * **`RESEND_API_KEY`.** A Worker secret, never in this repository, and it appears in one
 *     place: the `Authorization` header. Never logged, never rendered, never in an error.
 *   * **The request body.** It carries a runner's email address and their first name. So the
 *     body is never logged — not on success, and especially not on failure, which is exactly
 *     where a "log the whole request to debug it" would go in.
 *
 * A failure is recorded as its HTTP status and a short code of our own, **never as Resend's
 * `message`**: a provider's error text can quote the value it rejected, which is how an email
 * address ends up in an observability tool that was never assessed to hold one.
 *
 * ## The `From` is not the race's address, and that is deliberate
 *
 * Resend may only send as a **verified domain**, which is `send.southvillerunningclub.co.uk`.
 * `entries.events.from_address` is `nightingalenightmare@gmail.com` — a real, monitored
 * mailbox, and one Resend cannot send as. So it becomes **`Reply-To`**, which is the useful
 * half anyway: pressing Reply on one of these reaches a human.
 *
 * ⚠️ **That is the opposite of the account emails**, which GoTrue sends with no `reply_to`
 * field at all and which therefore bounce when replied to. The difference is that this path
 * calls Resend's REST API, where `reply_to` is simply a field, and GoTrue speaks SMTP.
 */

import { formatPence, type OutboxMessage } from '@src/shared';

/** What the Worker needs before it can send anything at all. */
export interface EmailConfig {
  /** `RESEND_API_KEY` — a Worker secret, set with `wrangler secret put`. */
  apiKey: string;
  /**
   * Where the API is. `https://api.resend.com` everywhere that matters.
   *
   * **Overridable only so the acceptance suite can run without a Resend account**, exactly as
   * `StripeConfig.apiBase` is, and passed on the `wrangler dev` command line rather than
   * living in `wrangler.jsonc` so there is no path by which it reaches a deployed Worker.
   */
  apiBase: string;
}

/**
 * The sending identity. **A constant rather than a column**, because it is a property of the
 * Resend account's verified domain and not of any one race — a per-event value here would be a
 * second place for a domain to be wrong, and the failure is a silent delivery drop.
 */
const FROM = 'Southville Running Club <nn@send.southvillerunningclub.co.uk>';

/** What one send produced. Never throws; the drain decides what to do with each shape. */
export type SendOutcome =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; rateLimited: boolean; error: string };

interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * **Plain text, and no HTML part at all.**
 *
 * Four short transactional messages do not need a rendered layout, and an HTML part is a
 * second copy of every sentence that will eventually disagree with the first. It also removes
 * a whole class of deliverability problem — a text-only message from a verified domain is
 * about as unlikely to be filtered as email gets, which matters most for the one message a
 * runner is waiting for.
 *
 * **A greeting only when there is a name to use.** `entrant_first_name` is null after a
 * cancellation, which deletes the entrants, and after a transfer, which replaces them. So
 * every template is written to read correctly with no name, rather than greeting somebody as
 * "Hello ,".
 */
function render(message: OutboxMessage): RenderedEmail | null {
  const greeting =
    message.entrantFirstName === null ? 'Hello,' : `Hello ${message.entrantFirstName},`;

  const reference = `Your reference is ${message.purchaseReference}.`;
  const signOff = `Southville Running Club\nReply to this email if you need to ask us anything.`;

  /**
   * **A place that cost nothing, which two of these templates quoted a figure at anyway.**
   *
   * ADR-021 gives a place away as a `paid` purchase at £0 on a £0 fee — Kinsi's two, and the
   * free place a visually impaired runner's guide is given. Both money sentences below were
   * written for a purchase that went through Stripe, and neither is true of one that did not:
   * the confirmation said *"we have received your payment of £0.00"*, and the cancellation said
   * *"we have refunded £0.00 to the card you paid with"* — which names a card that was never
   * charged, to somebody who never gave one.
   *
   * The second is the worse of the two. Somebody reading it goes looking for a refund that is
   * not coming, and the first thing they check is a card statement.
   *
   * **Nothing else about the message changes.** A given place is a real place: it is confirmed
   * the same way, it holds one of the 250, and it appears on `/account/entries/` like any
   * other. Only the sentence about money differs, because only the money differs. #150.
   */
  const free = message.amountPence === 0;

  switch (message.template) {
    case 'entry_confirmed':
      return {
        subject: `Your place in ${message.eventName} is confirmed`,
        text: [
          greeting,
          '',
          free
            ? `Your entry to ${message.eventName} on ${message.eventDate} is confirmed. The club has given you this place, so there is nothing to pay.`
            : `Your entry to ${message.eventName} on ${message.eventDate} is confirmed, and we have received your payment of ${formatPence(message.amountPence)}.`,
          '',
          reference,
          '',
          'You can see this entry any time by signing in at https://new.southvillerunningclub.co.uk/account/entries/ — if you do not have an account yet, register with this email address and your entry will be there.',
          '',
          signOff,
        ].join('\n'),
      };

    case 'entry_refunded':
      return {
        subject: `Your entry to ${message.eventName} has been cancelled`,
        text: [
          greeting,
          '',
          // **The bank's timing is part of the paid sentence rather than a line after it**, so
          // that dropping it on a free place drops no blank line with it. `join` renders a
          // `null` as an empty string, which would have left the message with a two-line gap
          // where a sentence used to be — the sort of thing that reads as a template fault.
          //
          // Stating the timing at all is what stops the email asking where the money is:
          // Stripe reports a card refund as pending for several days routinely, and that is
          // the bank rather than the club. Saying it to somebody owed nothing would be the
          // exact wrong thing — they would go and look at a card statement.
          free
            ? `Your entry to ${message.eventName} on ${message.eventDate} has been cancelled. Nothing was paid for this place, so there is nothing to refund.`
            : `Your entry to ${message.eventName} on ${message.eventDate} has been cancelled, and we have refunded ${formatPence(message.amountPence)} to the card you paid with.\n\nRefunds usually reach your account within five to ten working days, depending on your bank.`,
          '',
          reference,
          '',
          signOff,
        ].join('\n'),
      };

    case 'entry_transferred_out':
      return {
        subject: `Your place in ${message.eventName} has been transferred`,
        text: [
          // **No name, deliberately.** This message goes to the address the entry has just
          // been transferred *away from*, and the entrant record now describes somebody else.
          'Hello,',
          '',
          `Your place in ${message.eventName} on ${message.eventDate} has been transferred to another runner at your request, and you are no longer entered.`,
          '',
          // The honest statement of what a transfer is, because somebody expecting a refund
          // and receiving nothing will otherwise ask.
          'No money has been refunded, as a transfer moves the place rather than cancelling it.',
          '',
          signOff,
        ].join('\n'),
      };

    case 'entry_transferred_in':
      return {
        subject: `You have a place in ${message.eventName}`,
        text: [
          greeting,
          '',
          `A place in ${message.eventName} on ${message.eventDate} has been transferred to you, and you are now entered.`,
          '',
          reference,
          '',
          'You can see this entry any time by signing in at https://new.southvillerunningclub.co.uk/account/entries/ — if you do not have an account yet, register with this email address and your entry will be there.',
          '',
          // **Nothing is asked for here any more.** This line used to ask the new runner to
          // reply with their England Athletics number, because the transfer cleared the
          // previous runner's and only they could supply it. The club stopped asking for and
          // holding numbers on 29 August 2026, so asking would be collecting something nothing
          // can store — and an email that asks for a reply nobody acts on is worse than no
          // line at all. What the place was bought at does not change on a transfer.
          signOff,
        ].join('\n'),
      };

    default:
      // **An unknown template is not a crash.** The column has a check constraint, so this is
      // only reachable if a migration added a fifth name and this file was not deployed with
      // it — which expand/migrate/contract makes a normal intermediate state. The drain marks
      // it failed with a code a human can read, rather than throwing inside a cron.
      return null;
  }
}

/**
 * Send one message.
 *
 * **`429` is separated from every other failure** and handed back as `rateLimited`, because
 * the database gives the attempt back for it: Resend refusing to look at a message is not the
 * message being wrong, and burning attempts on the daily cap would mark a whole day's overflow
 * `failed` before the cap reset.
 */
export async function sendOutboxMessage(
  config: EmailConfig,
  message: OutboxMessage,
): Promise<SendOutcome> {
  const rendered = render(message);

  if (rendered === null) {
    return {
      ok: false,
      rateLimited: false,
      error: `unknown template ${message.template}`,
    };
  }

  let response: Response;

  try {
    response = await fetch(`${config.apiBase}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        // **Resend's own idempotency, on top of the database's.** The outbox's unique
        // `dedupe_key` already stops a second row being written; this stops a second *send*
        // of the same row, which is the case where the Worker sent successfully and then died
        // before recording it. Belt and braces, and the braces are free.
        'idempotency-key': `outbox:${message.id}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [message.recipient],
        reply_to: message.replyTo,
        subject: rendered.subject,
        text: rendered.text,
      }),
      // Shorter than the refund's twenty seconds and longer than Checkout's ten: nobody is
      // waiting on this, but a cron that hangs on a provider outage is a cron that stops
      // sweeping holds and deleting medical notes.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    return {
      ok: false,
      rateLimited: false,
      error: cause instanceof Error ? cause.name : 'unknown',
    };
  }

  if (response.status === 429) {
    return { ok: false, rateLimited: true, error: '429 rate limited' };
  }

  if (!response.ok) {
    // **The status and nothing else.** Resend's body can quote the address it rejected.
    return { ok: false, rateLimited: false, error: `http ${response.status}` };
  }

  const body: unknown = await response.json().catch(() => null);
  const id = (body as { id?: unknown } | null)?.id;

  return { ok: true, providerMessageId: typeof id === 'string' ? id : null };
}
