/**
 * The HTML part of the four entry emails: one card skin, four bodies.
 *
 * ## The design is a specification, not a starting point
 *
 * Every colour, font stack, size and structural measurement here is taken from
 * `nn-email-reference-template.html`, the approved design supplied with this slice, and from
 * `nn-email-mockups-reference.html`, which settles which facts rows and which CTA belong to
 * which send. `tests/unit/email-skin.test.ts` asserts the seven colours, the three font stacks
 * and the six sizes exhaustively — nothing else may appear in the rendered output.
 *
 * ## Why this is not a tagged template named `html`
 *
 * `worker/html.ts`'s `html` tag is for `/admin/nn` and Prettier reformats its contents on every
 * save — reflowing markup onto its own lines and normalising quotes, which breaks an
 * exact-output assertion the moment the file is formatted. A design-fidelity test that checks
 * for `margin-top:-19px` and `rotate(-2deg)` needs the markup to stay exactly as written, so
 * this file builds strings with plain template literals and calls `escapeHtml` at each
 * interpolation point by hand, rather than reusing that tag under a different name.
 *
 * ## The one deliberate deviation from the reference file: fluid width, not fixed
 *
 * `nn-email-reference-template.html`'s card is a literal `width="600"` — correct for the
 * approved *look*, and a genuine defect on a phone. A mail client that auto-fits desktop-width
 * HTML to the screen (most native apps) hides this; one that does not (several in-browser
 * webmail views) renders the card at its full 600px and lets the message scroll sideways,
 * which is the wrong failure mode for a race-entry receipt somebody is reading on a phone in a
 * car park.
 *
 * So the card table here is `width="100%"` with `max-width:600px` in its own style — identical
 * pixels at 600px and wider, and it shrinks to fit anything narrower, with no dependence on a
 * client's own scaling behaviour. **Outlook's Word rendering engine ignores `max-width`
 * entirely**, so it would draw the fluid table at the full width of whatever window it is in —
 * the one client this change would otherwise make worse. The `<!--[if mso]-->` pair around the
 * card wraps it in a second, literal `width="600"` table that only Outlook parses; every other
 * client's DOM never sees it. `email-skin.test.ts`'s "gives Outlook a literal 600px table,
 * everyone else a fluid one" is what keeps the two from drifting apart.
 *
 * ## What is deliberately not here
 *
 * **No `Numbers from` facts row.** The reference template's fourth facts row states a time and
 * a venue — 09:15, Ashton Park School — and nothing in `entries.claim_outbox_batch()`'s
 * projection carries either. Race facts belong to `race.json`, which no file in `worker/`
 * imports; hardcoding "09:15, Ashton Park School" here would be exactly the invented race fact
 * this repository forbids in a template. The CTA below carries a runner to the race-day page,
 * which is where that fact actually lives and can never go stale.
 *
 * **No name in the transfer-out heading.** The mockup shows `Hello, {{FIRST_NAME}}.` for the
 * runner giving up a place, but `entrant_first_name` at send time is joined from
 * `entries.entrants` by `purchase_id` alone — and by the time this message is drained,
 * `transfer_entry()` has already replaced that row with the *new* runner's. Printing a name
 * here would print the wrong person's. `worker/email.ts`'s plain-text render made the same call
 * for the same reason; this keeps it.
 *
 * **No CTA and no facts row on the cancellation or transfer-in sends.** Neither has an approved
 * mockup of its own — the mockup file's "Email 3" is the withdrawn request-acknowledgement
 * concept, not this one, and the transfer-in card is marked "Draft only — not approved."
 * Both bodies already state the race, the date and (for the cancellation) the amount as plain
 * sentences, so a facts table would only restate them.
 */

import { escapeHtml } from './html';
import { formatPence, type OutboxMessage } from '@src/shared';

/** The seven colours the reference design uses, and no others. */
const COLOUR = {
  page: '#E9E9E4',
  card: '#FFFFFF',
  border: '#E3E3E3',
  ink: '#161616',
  hairline: '#D2D2D2',
  muted: '#565656',
  oxblood: '#7A0E0E',
} as const;

const SERIF = "Georgia, 'Times New Roman', serif";
const SERIF_VALUE = 'Georgia, serif';
const MONO = "'Courier New', Courier, monospace";

/**
 * A stable absolute URL for the campaign banner, matching the pattern the account-entries link
 * two lines below already uses — a literal, because there is no site-origin binding a Worker
 * can read (`wrangler.jsonc` has none) and the alternative is a config change well beyond this
 * slice.
 *
 * **The file itself still needs committing to `public/` before this URL resolves.** That is a
 * separate, deliberate step — see `apps/main/README.md`.
 */
export const BANNER_URL =
  'https://new.southvillerunningclub.co.uk/nn-email-banner-1080x566.png';

const BANNER_ALT =
  'Southville Running Club presents Nightingale Nightmare — 10km off-road, Sunday 1 November 2026';

const RACE_DAY_URL = 'https://new.southvillerunningclub.co.uk/nn/2026/race-day/';
const ACCOUNT_ENTRIES_URL = 'https://new.southvillerunningclub.co.uk/account/entries/';

interface FactsRow {
  label: string;
  value: string;
}

/** One escaped `<tr>` in the ticket-stub facts table, dashed top rule, last row dashed both. */
function factsRow(row: FactsRow, isLast: boolean): string {
  const border = isLast
    ? `border-top:1px dashed ${COLOUR.hairline}; border-bottom:1px dashed ${COLOUR.hairline};`
    : `border-top:1px dashed ${COLOUR.hairline};`;

  return `
        <tr>
          <td style="padding: 11px 0; ${border} font-family:${MONO}; font-size:11px; letter-spacing:1.5px; color:${COLOUR.muted}; text-transform:uppercase; width:44%;">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding: 11px 0; ${border} font-family:${SERIF_VALUE}; font-size:15px; color:${COLOUR.ink}; text-align:right;">
            ${escapeHtml(row.value)}
          </td>
        </tr>`;
}

function factsTable(rows: FactsRow[]): string {
  if (rows.length === 0) {
    return '';
  }

  const body = rows
    .map((row, index) => factsRow(row, index === rows.length - 1))
    .join('');

  return `
  <tr>
    <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding: 24px 32px 4px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}
      </table>
    </td>
  </tr>`;
}

function ctaButton(label: string, href: string): string {
  return `
  <tr>
    <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding: 24px 32px 6px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td bgcolor="${COLOUR.ink}" style="background-color:${COLOUR.ink};">
            <a href="${escapeHtml(href)}" style="display:inline-block; padding: 13px 26px; font-family:${MONO}; font-weight:700; font-size:13px; letter-spacing:2px; color:#FFFFFF; text-decoration:none; text-transform:uppercase;">
              ${escapeHtml(label)}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

interface CardParams {
  stamp: string;
  bodyHtml: string;
  factsRowsHtml: string;
  ctaHtml: string;
  signOffHtml: string;
  replyTo: string;
}

/**
 * The wrapper every send shares — banner, stamp, footer — byte-identical regardless of which
 * body, facts table or CTA is slotted in. `email-skin.test.ts` renders all four and asserts
 * exactly that.
 */
function card(params: CardParams): string {
  const replyTo = escapeHtml(params.replyTo);

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0; padding:0; background-color:${COLOUR.page}; font-family:${SERIF};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOUR.page};">
<tr>
<td align="center" style="padding: 28px 14px;">
<!--[if mso]>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
<![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; margin:0 auto; background-color:${COLOUR.card}; border:1px solid ${COLOUR.border};">
  <tr>
    <td style="padding:0; line-height:0; font-size:0;">
      <img src="${BANNER_URL}" alt="${escapeHtml(BANNER_ALT)}" width="598" style="display:block; width:100%; max-width:598px; height:auto; border:0;">
    </td>
  </tr>
  <tr>
    <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding: 0 0 0 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:-19px;">
        <tr>
          <td bgcolor="${COLOUR.oxblood}" style="background-color:${COLOUR.oxblood}; padding: 7px 16px 6px 16px; -webkit-transform: rotate(-2deg); transform: rotate(-2deg); mso-hide:all;">
            <span style="font-family:${MONO}; font-size:12px; font-weight:700; letter-spacing:2.5px; color:#FFFFFF; text-transform:uppercase;">
              ${escapeHtml(params.stamp)}
            </span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding: 26px 32px 4px 32px;">
      ${params.bodyHtml}
    </td>
  </tr>${params.factsRowsHtml}${params.ctaHtml}
  <tr>
    <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding: 28px 32px 4px 32px;">
      ${params.signOffHtml}
    </td>
  </tr>
  <tr>
    <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding: 30px 32px 30px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="border-top:1px dashed ${COLOUR.hairline}; font-size:0; line-height:0; padding-bottom:18px;">&nbsp;</td></tr>
      </table>
      <p style="font-family:${SERIF}; font-size:12px; line-height:1.6; color:${COLOUR.muted}; margin:0 0 8px 0;">
        Questions about your entry? Reply to this email or write to
        <a href="mailto:${replyTo}" style="color:${COLOUR.oxblood};">${replyTo}</a>.
      </p>
      <p style="font-family:${SERIF}; font-size:12px; line-height:1.6; color:${COLOUR.muted}; margin:0;">
        Southville Running Club Ltd &middot; Bristol
      </p>
    </td>
  </tr>
</table>
<!--[if mso]>
</td></tr></table>
<![endif]-->
</td>
</tr>
</table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<div style="font-family:${SERIF}; font-weight:700; font-size:25px; line-height:1.3; color:${COLOUR.ink}; margin-bottom:16px;">${text}</div>`;
}

function paragraph(text: string, marginBottom: number): string {
  return `<p style="font-family:${SERIF}; font-size:16px; line-height:1.65; color:${COLOUR.ink}; margin:0 0 ${String(marginBottom)}px 0;">${text}</p>`;
}

/**
 * `20px` top margin for "The Nightingale Nightmare team", which closes two lead-in
 * paragraphs and reads as a signature separated from the body; `6px` for "Southville Running
 * Club" standing alone. The reference template and the mockups agree on both values exactly —
 * they are not the same sign-off styled two ways, they are two different top margins for two
 * different contexts.
 */
function signOffParagraph(text: string, marginTop: 6 | 20): string {
  return `<p style="font-family:${SERIF}; font-size:15px; line-height:1.6; color:${COLOUR.ink}; margin:${String(marginTop)}px 0 0 0;">${escapeHtml(text)}</p>`;
}

/** `Hello,` with no name, or `Hello {name},` — the same rule `worker/email.ts`'s `greeting` uses. */
function greetingHeading(firstName: string | null): string {
  return heading(firstName === null ? 'Hello,' : `Hello ${escapeHtml(firstName)},`);
}

/**
 * `entry_confirmed`'s heading text is the one line in this file taken verbatim from copy the
 * reference template marks **"Approved copy, unchanged"** rather than derived from the live
 * plain-text greeting — the tone ("Commiserations") is specific to this send and is not
 * reused anywhere else in this file for exactly that reason.
 */
function confirmedHeading(firstName: string | null): string {
  return heading(
    firstName === null ? 'Commiserations.' : `Commiserations, ${escapeHtml(firstName)}.`,
  );
}

function renderEntryConfirmed(message: OutboxMessage): string {
  const free = message.amountPence === 0;
  const eventName = escapeHtml(message.eventName);
  const eventDate = escapeHtml(message.eventDate);
  const amount = formatPence(message.amountPence);

  const bodyHtml = [
    confirmedHeading(message.entrantFirstName),
    paragraph(
      free
        ? `Your entry to ${eventName} on <strong>${eventDate}</strong> is confirmed. The club has given you this place, so there is nothing to pay.`
        : `Your entry to ${eventName} on <strong>${eventDate}</strong> is confirmed, and we have received your payment of <strong>${amount}</strong>.`,
      14,
    ),
    paragraph(
      `Your confirmation number is <strong>${escapeHtml(message.purchaseReference)}</strong>.`,
      4,
    ),
  ].join('\n      ');

  const factsRowsHtml = factsTable([
    { label: 'Race', value: message.eventName },
    { label: 'Date', value: message.eventDate },
    { label: 'Paid', value: amount },
  ]);

  const ctaHtml = ctaButton('Race Day Essentials', RACE_DAY_URL);

  const signOffHtml = [
    paragraph('We look forward to punishing your enthusiasm.', 14),
    paragraph('Good luck.', 0),
    signOffParagraph('The Nightingale Nightmare team', 20),
  ].join('\n      ');

  return card({
    stamp: 'Entry Confirmed',
    bodyHtml,
    factsRowsHtml,
    ctaHtml,
    signOffHtml,
    replyTo: message.replyTo,
  });
}

function renderEntryRefunded(message: OutboxMessage): string {
  const free = message.amountPence === 0;
  const eventName = escapeHtml(message.eventName);
  const eventDate = escapeHtml(message.eventDate);
  const amount = formatPence(message.amountPence);

  const bodyHtml = [
    greetingHeading(message.entrantFirstName),
    paragraph(
      free
        ? `Your entry to ${eventName} on <strong>${eventDate}</strong> has been cancelled. Nothing was paid for this place, so there is nothing to refund.`
        : `Your entry to ${eventName} on <strong>${eventDate}</strong> has been cancelled, and we have refunded <strong>${amount}</strong> to the card you paid with.`,
      free ? 14 : 4,
    ),
    // **Kept as a separate sentence rather than folded into the paragraph above**, so the
    // free branch can omit it without leaving an empty tag — the same reason the plain-text
    // render keeps it inside one `\n\n`-joined string rather than a fixed slot.
    free
      ? ''
      : paragraph(
          'Refunds usually reach your account within five to ten working days, depending on your bank.',
          14,
        ),
    paragraph(
      `Your reference is <strong>${escapeHtml(message.purchaseReference)}</strong>.`,
      4,
    ),
  ]
    .filter((part) => part !== '')
    .join('\n      ');

  const signOffHtml = signOffParagraph('Southville Running Club', 6);

  return card({
    stamp: 'Entry Cancelled',
    bodyHtml,
    factsRowsHtml: '',
    ctaHtml: '',
    signOffHtml,
    replyTo: message.replyTo,
  });
}

function renderEntryTransferredOut(message: OutboxMessage): string {
  const eventName = escapeHtml(message.eventName);
  const eventDate = escapeHtml(message.eventDate);

  const bodyHtml = [
    // **No name — see this file's header comment.** `entrant_first_name` at send time names
    // the runner the place moved *to*, not the one this message is addressed to.
    heading('Hello,'),
    paragraph(
      `Your place in ${eventName} on <strong>${eventDate}</strong> has been transferred to another runner at your request, and you are no longer entered.`,
      14,
    ),
    paragraph(
      'No money has been refunded, as a transfer moves the place rather than cancelling it.',
      4,
    ),
  ].join('\n      ');

  const factsRowsHtml = factsTable([
    { label: 'Race', value: message.eventName },
    { label: 'Date', value: message.eventDate },
  ]);

  const signOffHtml = signOffParagraph('Southville Running Club', 6);

  return card({
    stamp: 'Place Transferred',
    bodyHtml,
    factsRowsHtml,
    ctaHtml: '',
    signOffHtml,
    replyTo: message.replyTo,
  });
}

function renderEntryTransferredIn(message: OutboxMessage): string {
  const eventName = escapeHtml(message.eventName);
  const eventDate = escapeHtml(message.eventDate);

  const bodyHtml = [
    greetingHeading(message.entrantFirstName),
    paragraph(
      `A place in ${eventName} on <strong>${eventDate}</strong> has been transferred to you, and you are now entered.`,
      14,
    ),
    paragraph(
      `Your reference is <strong>${escapeHtml(message.purchaseReference)}</strong>.`,
      4,
    ),
    paragraph(
      `You can see this entry any time by signing in at <a href="${ACCOUNT_ENTRIES_URL}" style="color:${COLOUR.oxblood};">${ACCOUNT_ENTRIES_URL}</a> — if you do not have an account yet, register with this email address and your entry will be there.`,
      4,
    ),
  ].join('\n      ');

  const signOffHtml = signOffParagraph('Southville Running Club', 6);

  return card({
    stamp: 'Place Received',
    bodyHtml,
    factsRowsHtml: '',
    ctaHtml: '',
    signOffHtml,
    replyTo: message.replyTo,
  });
}

/**
 * The HTML part for one outbox message, or `null` for a template this file does not know —
 * mirroring `render()`'s own contract in `worker/email.ts`, for the same reason: an unrecognised
 * template is a normal expand/migrate/contract intermediate state, not a crash.
 */
export function renderEntryEmailHtml(message: OutboxMessage): string | null {
  switch (message.template) {
    case 'entry_confirmed':
      return renderEntryConfirmed(message);
    case 'entry_refunded':
      return renderEntryRefunded(message);
    case 'entry_transferred_out':
      return renderEntryTransferredOut(message);
    case 'entry_transferred_in':
      return renderEntryTransferredIn(message);
    default:
      return null;
  }
}
