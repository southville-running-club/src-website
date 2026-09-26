import { escapeHtml } from './html';
import { formatPriceWords, type MembershipOutboxMessage } from '@src/shared';

/**
 * The HTML part of the membership acknowledgement — the message an applicant gets back.
 *
 * ADR-026's rule for the race emails and ADR-041's for the ticket one, applied to `membership`:
 * the text part is unchanged and stays authoritative, and this renders from the **same
 * `MembershipOutboxMessage`** rather than from `membershipEmailBody()`'s output. So the two can
 * differ in presentation and can never differ in what they state.
 *
 * ## The design is a specification, not a starting point
 *
 * Every colour, size, font stack and structural measurement here is transcribed from
 * `src-application-received.html`, the approved design supplied with this change.
 * `tests/unit/membership-email-skin.test.ts` pins the substituted values and the escaping;
 * nothing here was tidied, re-spaced or "improved" on the way in.
 *
 * ⚠️ **The MSO conditionals are load-bearing and are not dead markup.** Outlook's Word
 * rendering engine ignores `max-width` entirely, so the `<!--[if mso]-->` pair wraps the fluid
 * card in a second, literal `width="600"` table that only Outlook parses. Every other client's
 * DOM never sees it. Deleting either half makes the card full-window-width in the one client
 * this would otherwise leave alone.
 *
 * ## Why this is a TypeScript module and not an `.html` file
 *
 * A Worker has no filesystem to read a template out of at runtime, and this repository has no
 * bundler text-import precedent to lean on. Both existing skins — `email-skin.ts` and
 * `ticket-email-skin.ts` — are modules that build the markup with **plain, untagged** template
 * literals and call `escapeHtml()` by hand at each interpolation, and this is the third.
 *
 * ⚠️ **Untagged is the part that matters, and it is why no `.prettierignore` entry is needed.**
 * Prettier reformats the contents of a `` html`…` ``-tagged template — reflowing nested elements
 * onto their own lines and rewriting `attr='x'` to `attr="x"` — which would quietly undo the
 * transcription above. It leaves an untagged literal exactly as written. `worker/html.ts`'s tag
 * is for `/admin/*`, and reusing it here under another name would cost the fidelity this file
 * exists to keep.
 *
 * ## ⚠️ What this may never grow
 *
 * **A fact about the applicant beyond these three.** `membership.claim_outbox_batch()` returns
 * `details: null` for this template, so the row this renders from does not contain a home
 * address, a date of birth, a phone number or an England Athletics number — there is nothing
 * here to disclose, and that is the property to preserve. An edit that reaches for one of those
 * has to widen the query first, and widening the query is what the split exists to prevent.
 *
 * **A remote asset.** No hosted image, no webfont `<link>`, no tracking pixel — the design asks
 * for none and the font stack falls back Inter → system → Arial. Unlike the other two skins
 * there is no banner here, so this send carries no CID attachment and needs no `ASSETS` read.
 */

/** The approved palette, named. Hex rather than `--colour-*`, for `ticket-email-skin.ts`'s reason:
 * a custom property is a stylesheet feature, and an email has no stylesheet it can rely on
 * reaching the reader. */
const COLOUR = {
  page: '#F4F6F2',
  card: '#FFFFFF',
  green: '#00C85A',
  ink: '#2C2C2C',
  muted: '#4A5568',
  rule: '#E1E5DE',
} as const;

const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * The acknowledgement's markup, or `null` for a template this skin has no design for.
 *
 * ⚠️ **`application_submitted` gets `null` deliberately, and it is the safe answer twice over.**
 * No design was supplied for the club's own copy, and that message is the one carrying the whole
 * form — a home address, a date of birth, a phone number. It sends as text alone rather than not
 * at all, which is exactly what `ticket-email-skin.ts` does for `ticket_refunded`.
 */
export function renderMembershipEmailHtml(
  message: MembershipOutboxMessage,
): string | null {
  if (message.template !== 'application_received') return null;

  // The same inputs the text part reads, formatted by the same function — never the text's own
  // output, which is what would let the two drift into stating different things.
  const name = escapeHtml(message.firstName);
  const membership = escapeHtml(message.membershipName);
  const price = escapeHtml(formatPriceWords(message.pricePence));

  return `<!DOCTYPE html>
<html lang="en-GB" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>We've got your application to join Southville Running Club</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>table, td { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${COLOUR.page}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;" bgcolor="${COLOUR.page}">

  <!-- Preheader: shows in the inbox preview, hidden in the email -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${COLOUR.page};">
    Thanks for applying. Nothing has been charged and there is nothing you need to do for now.&nbsp;&#8199;&#847;&nbsp;&#8199;&#847;&nbsp;&#8199;&#847;&nbsp;&#8199;&#847;&nbsp;&#8199;&#847;&nbsp;&#8199;&#847;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOUR.page}" style="background-color:${COLOUR.page};">
    <tr>
      <td align="center" style="padding-top:24px; padding-bottom:24px; padding-left:12px; padding-right:12px;">

        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">

          <!-- Green panel: wordmark + headline -->
          <tr>
            <td bgcolor="${COLOUR.green}" style="background-color:${COLOUR.green}; padding-top:36px; padding-bottom:36px; padding-left:32px; padding-right:32px; border-radius:12px 12px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${SANS}; font-size:13px; line-height:18px; font-weight:500; color:${COLOUR.ink}; padding-bottom:20px;">
                    Southville Running Club
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${SANS}; font-size:34px; line-height:40px; font-weight:700; letter-spacing:-0.5px; color:${COLOUR.ink};">
                    We&#8217;ve got your application.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding-top:32px; padding-bottom:8px; padding-left:32px; padding-right:32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <tr>
                  <td style="font-family:${SANS}; font-size:17px; line-height:26px; font-weight:400; color:${COLOUR.ink}; padding-bottom:16px;">
                    Hello ${name},
                  </td>
                </tr>

                <tr>
                  <td style="font-family:${SANS}; font-size:17px; line-height:26px; font-weight:400; color:${COLOUR.ink}; padding-bottom:20px;">
                    Thanks for applying to join Southville Running Club. We have your application for:
                  </td>
                </tr>

                <!-- What they chose: the one piece of data in the email -->
                <tr>
                  <td style="padding-bottom:24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOUR.page}" style="background-color:${COLOUR.page}; border-radius:12px;">
                      <tr>
                        <td style="padding-top:18px; padding-bottom:18px; padding-left:20px; padding-right:20px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="font-family:${SANS}; font-size:17px; line-height:24px; font-weight:600; color:${COLOUR.ink}; padding-bottom:4px;">
                                ${membership}
                              </td>
                            </tr>
                            <tr>
                              <td style="font-family:${SANS}; font-size:15px; line-height:22px; font-weight:400; color:${COLOUR.muted};">
                                ${price} a year
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="font-family:${SANS}; font-size:17px; line-height:26px; font-weight:400; color:${COLOUR.ink}; padding-bottom:20px;">
                    The Membership Officer will be in touch about paying. <strong style="font-weight:600;">Nothing has been charged yet</strong> and there is nothing you need to do for now.
                  </td>
                </tr>

                <tr>
                  <td style="font-family:${SANS}; font-size:17px; line-height:26px; font-weight:400; color:${COLOUR.ink}; padding-bottom:28px;">
                    You are welcome at a run in the meantime, member or not. Tuesdays and Thursdays at the Southbank Club, Dean Lane. Meet 6.00pm for a 6.15pm start.
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card}; padding-top:0; padding-bottom:32px; padding-left:32px; padding-right:32px; border-radius:0 0 12px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top:1px solid ${COLOUR.rule}; font-size:0; line-height:0; height:1px;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="font-family:${SANS}; font-size:15px; line-height:22px; font-weight:600; color:${COLOUR.ink}; padding-top:24px; padding-bottom:4px;">
                    Southville Running Club
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${SANS}; font-size:15px; line-height:22px; font-weight:400; color:${COLOUR.muted};">
                    Reply to this email if you need to ask us anything.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->

      </td>
    </tr>
  </table>
</body>
</html>
`;
}
