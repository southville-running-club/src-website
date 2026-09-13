import { ticketEmailDate, formatPence, type TicketOutboxMessage } from '@src/shared';

import { escapeHtml } from './html';
import { formatSocialTimes } from './events';

/**
 * The HTML part of a ticket confirmation — **ADR-041**.
 *
 * ## The change ADR-033 deferred, made
 *
 * [ADR-033](../../../../docs/architecture/decisions/adr-033-a-ticket-is-not-an-entry.md) shipped
 * ticket mail as plain text and said so in as many words — *"plain text for now… A ticket skin
 * is a separate change."* This is that change, so it completes a decision rather than reversing
 * one. What it does **not** do is the thing ADR-033 actually ruled out: reusing
 * [ADR-026](../../../../docs/architecture/decisions/adr-026-an-html-part-joins-the-outbox-emails.md)'s
 * race skin, which is written against an entry — a reference, an entrant, a race date — and
 * which would have to branch on its caller to cope with a ticket. This is a **second skin**, and
 * `email-skin.ts` is untouched and still knows nothing about a ticket.
 *
 * **The text part is unchanged and stays authoritative.** This renders from the same
 * `TicketOutboxMessage` the text reads — never from the text's own output — so the two can
 * differ in presentation and can never differ in which facts they state. Where a fact needs
 * formatting, both call the same function: `ticketEmailDate()` for the day, `formatPence()` for
 * the money, `formatEntryReference()` upstream for the reference.
 *
 * ## Only the confirmation, deliberately
 *
 * `ticket_refunded` returns null here and goes out as text alone. Its design was not part of
 * what the club supplied, and inventing a cancellation treatment to sit beside a supplied
 * confirmation is the club's call rather than this file's. A null is a real state the caller
 * already handles — the race path does the same for templates with no banner — so nothing
 * breaks and nothing is guessed.
 *
 * ## The rules this markup obeys, which are not the web's
 *
 * Email clients are twenty years behind a browser and disagree with each other, so:
 *
 *   * **Tables for layout, inline styles for everything.** The `<style>` block carries the
 *     responsive rules only, and every one of them has an inline equivalent — Gmail's web
 *     client drops media queries and Outlook desktop ignores most of a stylesheet, and the
 *     message has to be complete and legible in both.
 *   * **No background images, no gradients, no border-radius load-bearing.** The garland and
 *     the tear line are table cells with `bgcolor`, which renders identically everywhere.
 *   * **The banner is additive.** The club name sits above it as live text and the headline
 *     below it, and the cell keeps its own red background — so a blocked or failed image costs
 *     a decoration and leaves a red band, never a white hole with no words in it.
 *   * **`cid:` and not `https:`.** The image is attached to the message, which is ADR-026's
 *     answer to the open-tracker question: a remote `<img>` in an email is a request the
 *     client makes when somebody reads it, and there is nothing the club wants to learn from
 *     one. It also means the artwork shows on first open rather than behind a "display
 *     images" prompt.
 *
 * ## Escaping
 *
 * **Every interpolated value goes through `escapeHtml`, including ones that look safe.** A
 * purchaser's name is free text somebody typed into a form — `O'Brien & Sons` is an ordinary
 * name and `<` is an ordinary typo — and this file builds strings with template literals
 * rather than through the `html` tag, so nothing escapes on the author's behalf.
 * `tests/unit/ticket-email-skin.test.ts` asserts it on a name written to break out.
 */

/** The content id the attachment and the `<img>` have to agree on. */
export const TICKET_BANNER_CONTENT_ID = 'src-party-email-banner';

const SANS =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/**
 * The supplied palette, named.
 *
 * **Hex values rather than `--colour-*` tokens, and that is not the admin surface's rule being
 * broken.** A custom property is a stylesheet feature; an email has no stylesheet it can rely
 * on reaching the reader, so every colour has to be written where it is used. Naming them here
 * is what stops the same red being typed eleven times and drifting on the twelfth.
 */
const COLOUR = {
  /** The page behind the card. */
  ground: '#EFE7DA',
  /** The hero, and what a blocked banner leaves behind. */
  deepRed: '#7A1E17',
  /** The garland's red, brighter than the hero so it reads against it. */
  red: '#D23B2C',
  green: '#00C85A',
  cream: '#F7EFDC',
  /** Body copy on the hero — cream is too bright for a paragraph. */
  creamSoft: '#F2DFC9',
  card: '#FFFFFF',
  ink: '#2C2C2C',
  /** Labels and the footer. 7.3:1 on white. */
  muted: '#4A5568',
  /** The dietary note's wash, and the tear line's dash. */
  mint: '#E9F9EF',
  dash: '#D8CEBA',
} as const;

/**
 * One row of bunting, built from `bgcolor` cells.
 *
 * Five repeats of a six-cell group, which is what the supplied markup spells out by hand. It is
 * generated here because thirty hand-written `<td>`s are thirty chances to mistype a hex value,
 * and because Prettier reflows a long line of them into something unreadable either way.
 */
function garland(): string {
  const group = [
    COLOUR.red,
    COLOUR.cream,
    COLOUR.red,
    COLOUR.cream,
    COLOUR.green,
    COLOUR.cream,
  ];

  const cells = Array.from({ length: 5 }, () => group)
    .flat()
    .map(
      (colour) =>
        `<td width="20" height="10" bgcolor="${colour}" style="background-color:${colour}; width:20px; height:10px; font-size:0; line-height:0;">&nbsp;</td>`,
    )
    .join('');

  return `<tr><td style="font-size:0; line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; table-layout:fixed;"><tr>${cells}</tr></table></td></tr>`;
}

/**
 * The perforation across the ticket, so the facts above it read as a stub.
 *
 * The two end cells are the page's own ground colour, which is what makes the dashes look
 * punched out of the card rather than drawn on it.
 */
function tearLine(): string {
  const end = `<td width="18" bgcolor="${COLOUR.ground}" style="background-color:${COLOUR.ground}; width:18px; font-size:0; line-height:0;">&nbsp;</td>`;

  const dashes = Array.from({ length: 13 }, () =>
    [COLOUR.dash, COLOUR.card]
      .map(
        (colour) =>
          `<td height="2" bgcolor="${colour}" style="background-color:${colour}; height:2px; font-size:0; line-height:0;">&nbsp;</td>`,
      )
      .join(''),
  ).join('');

  return `<tr><td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; font-size:0; line-height:0; padding:18px 0 18px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; table-layout:fixed;"><tr>${end}${dashes}${end}</tr></table></td></tr>`;
}

/** One label-and-value cell in the two-by-two stub. `mono` is for figures that line up. */
function fact(label: string, value: string, options: { mono?: boolean } = {}): string {
  const family = options.mono === true ? MONO : SANS;
  const weight = options.mono === true ? '700' : '600';

  return `<div style="font-family:${SANS}; font-size:12px; line-height:18px; font-weight:600; letter-spacing:0.10em; text-transform:uppercase; color:${COLOUR.muted};">${escapeHtml(label)}</div>
                      <div style="font-family:${family}; font-size:18px; line-height:26px; font-weight:${weight}; color:${COLOUR.ink}; padding-top:3px;">${escapeHtml(value)}</div>`;
}

/**
 * `Saturday 12 December 2026` → `Sat 12 Dec`, for the preheader line.
 *
 * **Derived from the long form rather than formatted a second time**, so there is exactly one
 * place the month names live and the two can never name different months.
 */
function shortDate(long: string | null): string | null {
  if (long === null) {
    return null;
  }

  const parts = long.split(' ');

  if (parts.length !== 4) {
    return null;
  }

  return `${parts[0]?.slice(0, 3)} ${parts[1]} ${parts[2]?.slice(0, 3)}`;
}

/**
 * Render the HTML part, or null when this template has no design.
 *
 * `hasBanner` is false when the attachment could not be read, in which case the `<img>` row is
 * left out entirely rather than emitted pointing at a `cid:` nothing will resolve — an
 * unresolved content id shows a broken-image icon in several clients, which looks worse than
 * the deliberate red band the hero already provides.
 */
export function renderTicketEmailHtml(
  message: TicketOutboxMessage,
  hasBanner: boolean,
): string | null {
  if (message.template !== 'ticket_confirmed') {
    return null;
  }

  const when = ticketEmailDate(message.socialDate);
  const times = formatSocialTimes(message.startTime, message.endTime);

  const name = escapeHtml(message.purchaserName);
  const amount = escapeHtml(formatPence(message.amountPence));
  const tickets = message.quantity === 1 ? '1 ticket' : `${message.quantity} tickets`;
  const verb = message.quantity === 1 ? 'is' : 'are';

  // **The same three honest non-answers the text part gives**, rather than a blank cell or the
  // word "null". A social can be sold before its room or its hours are settled.
  const whenValue = when ?? 'We will confirm nearer the time';
  const whereValue = message.venue ?? 'To be confirmed';

  // The alt text states the same facts as the cells below it, so somebody reading with images
  // off or with a screen reader loses nothing — and it is built from the row rather than
  // written out, so a second social cannot inherit the party's date.
  const bannerAlt = [message.socialName, when, message.venue]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' — ');

  const preheader = [`${tickets} confirmed`, shortDate(when), message.venue]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part) => escapeHtml(part))
    .join(' &middot; ');

  const bannerRow = hasBanner
    ? `<tr>
              <td bgcolor="${COLOUR.deepRed}" align="center" style="background-color:${COLOUR.deepRed}; font-size:0; line-height:0;">
                <img src="cid:${TICKET_BANNER_CONTENT_ID}" width="600" height="320" alt="${escapeHtml(bannerAlt)}" style="display:block; width:100%; max-width:600px; height:auto; border:0; outline:none; text-decoration:none;" />
              </td>
            </tr>`
    : '';

  // A second line under the day, only when there are hours to state. `7:30pm–1am` in the club's
  // own register, from the same function the page uses.
  const timesRow =
    times === null
      ? ''
      : `<div style="font-family:${SANS}; font-size:15px; line-height:22px; font-weight:400; color:${COLOUR.muted}; padding-top:2px;">${escapeHtml(times)}</div>`;

  return `<!doctype html>
<html lang="en-GB" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Your ${escapeHtml(message.socialName)} ${escapeHtml(tickets)} ${escapeHtml(verb)} confirmed</title>
    <!--[if mso]>
      <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
    <![endif]-->
    <style>
      @media only screen and (max-width: 620px) {
        .wrap { width: 100% !important; }
        .pad { padding-left: 22px !important; padding-right: 22px !important; }
        .stack { display: block !important; width: 100% !important; }
        .stack-gap { padding-bottom: 18px !important; }
        .h1 { font-size: 28px !important; line-height: 34px !important; }
        .ref { font-size: 17px !important; }
      }
    </style>
  </head>

  <body style="margin:0; padding:0; background-color:${COLOUR.ground};">
    <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${COLOUR.ground};">
      &#10052;&#65039; ${preheader}
      &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOUR.ground}" style="background-color:${COLOUR.ground};">
      <tr>
        <td align="center" style="padding:28px 12px 44px 12px;">
          <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->

          <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

            <tr>
              <td bgcolor="${COLOUR.deepRed}" class="pad" align="center" style="background-color:${COLOUR.deepRed}; padding:24px 34px 20px 34px; border-radius:14px 14px 0 0;">
                <div style="font-family:${SANS}; font-size:13px; line-height:18px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:${COLOUR.cream};">
                  Southville&nbsp;Running&nbsp;Club
                </div>
              </td>
            </tr>
${bannerRow}
            <tr>
              <td bgcolor="${COLOUR.deepRed}" class="pad" align="center" style="background-color:${COLOUR.deepRed}; padding:28px 34px 6px 34px;">
                <h1 class="h1" style="margin:0; font-family:${SANS}; font-size:34px; line-height:40px; font-weight:700; letter-spacing:-0.02em; color:${COLOUR.cream};">
                  You&rsquo;re all set, ${name}.
                </h1>
              </td>
            </tr>

            <tr>
              <td bgcolor="${COLOUR.deepRed}" class="pad" align="center" style="background-color:${COLOUR.deepRed}; padding:12px 34px 30px 34px;">
                <p style="margin:0; font-family:${SANS}; font-size:17px; line-height:26px; color:${COLOUR.creamSoft};">
                  ${escapeHtml(tickets)} confirmed, and we&rsquo;ve received your payment of ${amount}.
                </p>
              </td>
            </tr>

${garland()}

            <tr>
              <td bgcolor="${COLOUR.card}" class="pad" style="background-color:${COLOUR.card}; padding:32px 34px 8px 34px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="stack stack-gap" width="50%" valign="top" style="padding-bottom:22px; padding-right:12px;">
                      ${fact('When', whenValue)}${timesRow}
                    </td>
                    <td class="stack stack-gap" width="50%" valign="top" style="padding-bottom:22px;">
                      ${fact('Where', whereValue)}
                    </td>
                  </tr>
                  <tr>
                    <td class="stack stack-gap" valign="top" style="padding-bottom:10px; padding-right:12px;">
                      ${fact('Tickets', tickets)}
                    </td>
                    <td class="stack stack-gap" valign="top" style="padding-bottom:10px;">
                      ${fact('Paid', formatPence(message.amountPence), { mono: true })}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

${tearLine()}

            <tr>
              <td bgcolor="${COLOUR.card}" class="pad" style="background-color:${COLOUR.card}; padding:0 34px 30px 34px;">
                <div style="font-family:${SANS}; font-size:12px; line-height:18px; font-weight:600; letter-spacing:0.10em; text-transform:uppercase; color:${COLOUR.muted};">Your reference</div>
                <div class="ref" style="font-family:${MONO}; font-size:20px; line-height:30px; font-weight:700; letter-spacing:0.01em; color:${COLOUR.ink}; padding-top:4px; word-break:break-all;">${escapeHtml(message.reference)}</div>
                <div style="font-family:${SANS}; font-size:14px; line-height:21px; color:${COLOUR.muted}; padding-top:8px;">
                  Quote this if you need to change anything. No need to print it &mdash; we&rsquo;ll have you on the list.
                </div>
              </td>
            </tr>

            <tr>
              <td bgcolor="${COLOUR.card}" class="pad" style="background-color:${COLOUR.card}; padding:0 34px 34px 34px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOUR.mint}" style="background-color:${COLOUR.mint}; border-radius:12px;">
                  <tr>
                    <td width="5" bgcolor="${COLOUR.green}" style="background-color:${COLOUR.green}; width:5px; font-size:0; line-height:0; border-radius:12px 0 0 12px;">&nbsp;</td>
                    <td style="padding:18px 20px 19px 18px; font-family:${SANS}; font-size:16px; line-height:25px; color:${COLOUR.ink};">
                      <strong style="font-weight:700;">Dietary requirements?</strong>
                      If you or anyone you&rsquo;re bringing has any, just reply to this email and let us know.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="${COLOUR.card}" class="pad" style="background-color:${COLOUR.card}; padding:0 34px 34px 34px;">
                <p style="margin:0; font-family:${SANS}; font-size:17px; line-height:26px; color:${COLOUR.ink};">
                  See you there.<br />
                  <strong style="font-weight:700;">Southville Running Club</strong>
                </p>
              </td>
            </tr>

${garland()}

            <tr>
              <td class="pad" align="center" style="padding:26px 34px 0 34px;">
                <p style="margin:0 0 10px 0; font-family:${SANS}; font-size:13px; line-height:20px; color:${COLOUR.muted};">
                  You&rsquo;re receiving this because you bought tickets for the ${escapeHtml(message.socialName)}. It&rsquo;s a one-off confirmation, not a mailing list.
                </p>
                <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:20px; color:${COLOUR.muted};">
                  Questions, changes or a refund: reply to this email, or write to
                  <a href="mailto:${escapeHtml(message.replyTo)}" style="color:${COLOUR.ink}; text-decoration:underline;">${escapeHtml(message.replyTo)}</a>.
                </p>
              </td>
            </tr>

          </table>

          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
