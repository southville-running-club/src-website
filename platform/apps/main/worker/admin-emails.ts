import {
  createUserClient,
  fetchOutboxList,
  formatLondon,
  resendOutboxMessage,
  type OutboxFigures,
  type OutboxRow,
  type SupabaseConfig,
} from '@src/shared';

import { html, raw, type Html } from './html';
import { can, masthead, notFound, page, type AdminViewer } from './admin-shell';
import { CSRF_COOKIE, CSRF_FIELD, csrfCookie, csrfOk, mintCsrfToken } from './csrf';
import { cookieValue } from './cookies';

/**
 * `/admin/emails/` — what the club has told people, and what it still owes them.
 *
 * ## Why this page exists
 *
 * #73 made the club send four messages about an entry and gave nobody anywhere to look at
 * them. A volunteer whose runner said *"I entered and never heard anything"* had the Worker's
 * logs in the Cloudflare dashboard and Resend's own console — two credentials and a tab nobody
 * has open on a Sunday, to answer a question that arrives by text message.
 *
 * **The queue is also the monitoring.** Resend's free tier is 100 emails a day account-wide
 * against 250 places, and the club's plan is a decision it revisits by looking at whether
 * anything is routinely still waiting the next morning. That is a number on this page or it is
 * a number nobody has.
 *
 * ## Two readings, and the same split `/admin/people/` makes
 *
 * **`nn.entry.read` opens the page; `nn.entry.cancel` opens the buttons on it.** Reading the
 * queue is strictly less than the entry list already shows — these addresses appear there
 * beside a name, a date of birth and an emergency contact — so it needs no permission of its
 * own. Asking for a message again is an act with an outside effect, so it is gated separately.
 *
 * ⚠️ **`nn.entry.cancel` is not what that permission is named for.** It is reused rather than
 * adding an eighth, which is the same trade `transfer_entry()` made and which CLAUDE.md names
 * as a stop-and-ask. A dedicated `nn.email.resend` is the cleaner answer and is a decision the
 * club can take later; the migration says so too.
 *
 * ## What this page will not do
 *
 *   * **Compose anything.** There is no way to send somebody a message the club does not
 *     already owe them. The queue is written by a trigger, in the transaction that made the
 *     obligation true, and a page that could add to it would be a second source of truth about
 *     what the club has promised.
 *   * **Re-send a message that has already gone.** `admin_outbox_resend()` refuses, and the
 *     reason is that the club cannot un-send an email: the usual cause of "I never got it" is
 *     a spam folder, and the cost of being wrong is a duplicate confirmation to somebody who
 *     is already entered. Forwarding from the race's own mailbox is the honest act, and it is
 *     obvious to the recipient that a human did it.
 *   * **Show what a message said.** The wording lives in `worker/email.ts` and is the same for
 *     everybody with that template. Rendering it here would be a second copy to drift.
 *
 * ## No personal data in any log on this page
 *
 * The same rule the rest of the admin surface follows. Every `console.error` below carries a
 * code and a function name and never a recipient — this page is a list of email addresses, and
 * it is the one place where a careless error line would be the whole leak.
 */

const CAPTION_ID = 'emails-table-caption';

/** What went wrong, in the words the volunteer needs rather than the database's. */
const REFUSALS: Record<string, string> = {
  'already-sent':
    'That message has already been sent, so it was not sent again. If somebody says they did not receive it, ask them to check their spam folder — and forward it from the race mailbox if they still cannot find it.',
  'already-queued':
    'That message is already waiting to go out, so nothing changed. It will send on the next run, within about five minutes.',
  'no-such-message': 'That message is no longer in the queue.',
  unauthorised: 'You are no longer allowed to do that, so nothing changed.',
};

/**
 * What each template is, in the club's words.
 *
 * **A lookup rather than the raw slug**, because `entry_transferred_out` on screen makes a
 * volunteer work out which side of a transfer they are looking at while somebody waits on the
 * phone. An unknown template falls back to its own name rather than to "unknown": a row this
 * build has not heard of is a database ahead of this Worker, and the slug is more use than a
 * word that says nothing.
 */
const TEMPLATES: Record<string, string> = {
  entry_confirmed: 'Entry confirmed',
  entry_refunded: 'Entry cancelled and refunded',
  entry_transferred_out: 'Place transferred away',
  entry_transferred_in: 'Place transferred to them',
};

const STATUS_WORDING: Record<OutboxRow['status'], string> = {
  pending: 'Waiting',
  sent: 'Sent',
  failed: 'Failed',
};

export async function handleEmailsSection(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  segments: string[],
  secure: boolean,
): Promise<Response> {
  if (segments.length > 0) {
    return notFound();
  }

  if (request.method === 'GET') {
    return listPage(viewer, cfg, secure, null, null);
  }

  if (request.method === 'POST') {
    // **Gated here, before the form is read.** `admin.ts` lets anybody holding
    // `nn.entry.read` reach this file, and somebody served a table with no buttons can still
    // hand-craft this POST. `admin_outbox_resend()` refuses them as well, and that is the
    // enforcement; this is the door being shut in the right order.
    if (!can(viewer, 'nn.entry.cancel')) {
      return notFound();
    }

    return handleResend(request, viewer, cfg, secure);
  }

  return notFound();
}

async function handleResend(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
): Promise<Response> {
  const form = await readForm(request);

  // The CSRF check comes first, before the form is read for anything else: a request that
  // failed it is not a request from this page and nothing in it should be acted on.
  if (
    form === null ||
    !csrfOk(
      cookieValue(request.headers.get('cookie'), CSRF_COOKIE),
      asText(form, CSRF_FIELD),
    )
  ) {
    return notFound();
  }

  const id = asText(form, 'message');

  if (id === null || !isUuid(id)) {
    return notFound();
  }

  const asPerson = createUserClient(cfg, viewer.accessToken);
  const outcome = await resendOutboxMessage(asPerson, id);

  if (outcome.status === 'unavailable') {
    console.error(`entries.admin_outbox_resend unavailable — ${outcome.error}`);
    return listPage(viewer, cfg, secure, 'That could not be done. Try again.', null);
  }

  if (outcome.status === 'ok') {
    return listPage(
      viewer,
      cfg,
      secure,
      null,
      `That message is back in the queue and will go out within about five minutes.`,
    );
  }

  return listPage(viewer, cfg, secure, REFUSALS[outcome.status] ?? null, null);
}

async function listPage(
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  secure: boolean,
  error: string | null,
  notice: string | null,
): Promise<Response> {
  const asPerson = createUserClient(cfg, viewer.accessToken);
  const result = await fetchOutboxList(asPerson);

  if (result.status === 'unauthorised') {
    // The permission was revoked between the door and this read. Same answer as everybody
    // else who may not be here.
    return notFound();
  }

  if (result.status === 'unavailable') {
    console.error(`entries.admin_outbox_list unavailable — ${result.error}`);
    return page(
      'Emails',
      html`${masthead(viewer)}
        <main class="admin-page" id="main">
          <h1>Emails</h1>
          <p class="admin-error" role="alert">
            The queue could not be read. Try again in a moment.
          </p>
        </main>`,
    );
  }

  // **No token for somebody who cannot act, and no cookie either.** Same reasoning as
  // `/admin/people/`: a token binds a form to this browser, and a page with no forms has
  // nothing to bind.
  const token = can(viewer, 'nn.entry.cancel') ? mintCsrfToken() : null;

  return page(
    'Emails',
    emailsBody(viewer, result.figures, result.messages, token, error, notice),
    { cookies: token === null ? [] : [csrfCookie(token, secure)] },
  );
}

function emailsBody(
  viewer: AdminViewer,
  figures: OutboxFigures,
  messages: OutboxRow[],
  token: string | null,
  error: string | null,
  notice: string | null,
): Html {
  return html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Emails</h1>
      <p>
        Every message the club owes somebody about an entry, and whether it has gone.
        ${
          token === null
            ? html`<strong>You can see the queue, and not change it</strong> — ask
                somebody who can cancel an entry to re-send a failed message.`
            : html`<strong>Nothing here is lost</strong> — a message that has not gone yet
                is still owed, and the club tries again every five minutes.`
        }
      </p>
      ${error === null ? null : html`<p class="admin-error" role="alert">${error}</p>`}
      ${notice === null ? null : html`<p class="admin-banner" role="status">${notice}</p>`}
      ${capacityNote(figures)}
      ${
        messages.length === 0
          ? html`<p>
              No emails yet. The first one goes out when somebody pays for a place.
            </p>`
          : html`<div
              class="admin-scroll"
              tabindex="0"
              role="region"
              aria-labelledby="${raw(CAPTION_ID)}"
            >
              <table class="admin-table">
                <caption class="admin-visually-hidden" id="${raw(CAPTION_ID)}">
                  ${
                    token === null
                      ? 'Every email the club owes somebody about an entry, and whether it has gone'
                      : 'Every email the club owes somebody about an entry, whether it has gone, and the controls that send a failed one again'
                  }
                </caption>
                <thead>
                  <tr>
                    <th scope="col">To</th>
                    <th scope="col">About</th>
                    <th scope="col">State</th>
                    <th scope="col">When</th>
                    ${token === null ? null : html`<th scope="col">Send again</th>`}
                  </tr>
                </thead>
                <tbody>
                  ${messages.map((message) => messageRow(message, token))}
                </tbody>
              </table>
            </div>`
      }
    </main>`;
}

/**
 * The figures, and the sentence that stops them being read as the cap.
 *
 * ⚠️ **`sentToday` is the club's own count and Resend counts more than this.** Account emails
 * — confirming an address, resetting a password — go through the same Resend account and are
 * not in this table, so the real usage against the daily cap is this number plus those. It is
 * a floor, and the page says so rather than presenting a figure somebody would subtract from
 * 100 and act on.
 */
function capacityNote(figures: OutboxFigures): Html {
  return html`<div class="admin-figs">
      <div class="admin-fig">
        <p class="admin-fig-label">Waiting</p>
        <p class="admin-fig-value">
          <span class="admin-mono">${String(figures.pending)}</span>
        </p>
      </div>
      <div class="admin-fig">
        <p class="admin-fig-label">Failed</p>
        <p class="admin-fig-value">
          <span class="admin-mono">${String(figures.failed)}</span>
        </p>
      </div>
      <div class="admin-fig">
        <p class="admin-fig-label">Sent today</p>
        <p class="admin-fig-value">
          <span class="admin-mono">${String(figures.sentToday)}</span>
        </p>
      </div>
      <div class="admin-fig">
        <p class="admin-fig-label">Sent, all time</p>
        <p class="admin-fig-value">
          <span class="admin-mono">${String(figures.sent)}</span>
        </p>
      </div>
    </div>
    <p>
      <strong>“Sent today” counts entry emails only.</strong> Account emails — confirming
      an address, resetting a password — go through the same Resend account and are not
      counted here, so the club’s real usage against Resend’s daily allowance is higher
      than this number.
      ${
        figures.oldestPendingAt === null
          ? 'Nothing is waiting.'
          : html`The oldest message still waiting has been queued since
            ${formatLondon(figures.oldestPendingAt)}.`
      }
    </p>`;
}

function messageRow(message: OutboxRow, token: string | null): Html {
  return html`<tr>
    <th scope="row">${message.recipient}</th>
    <td>
      ${TEMPLATES[message.template] ?? message.template}
      <span class="admin-quiet">${message.eventName}</span>
    </td>
    <td>
      ${STATUS_WORDING[message.status]}
      ${
        /* **The error is shown, and it is the club's own short code rather than the
           provider's message.** `worker/email.ts` never records Resend's own text, because
           an error message can quote the address it rejected. */
        message.lastError === null
          ? null
          : html`<span class="admin-quiet">${message.lastError}</span>`
      }
      ${
        message.attempts === 0
          ? null
          : html`<span class="admin-quiet"
              >${String(message.attempts)}
              attempt${message.attempts === 1 ? '' : 's'}</span
            >`
      }
    </td>
    <td>
      ${message.sentAt === null ? formatLondon(message.createdAt) : formatLondon(message.sentAt)}
    </td>
    ${
      token === null
        ? null
        : html`<td>
            ${
              /* **A button only where one would do something.** A `sent` message is refused
                 by the database and a `pending` one is already owed, so offering either is a
                 control that teaches a volunteer the page cannot be trusted. */
              message.status === 'failed'
                ? html`<form method="post" action="/admin/emails/">
                    <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
                    <input type="hidden" name="message" value="${message.id}" />
                    <button type="submit" class="admin-button">
                      Send again<span class="admin-visually-hidden">
                        to ${message.recipient}</span
                      >
                    </button>
                  </form>`
                : null
            }
          </td>`
    }
  </tr>`;
}

/** A form body, or null if the request did not carry one this page can read. */
async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function asText(form: FormData, field: string): string | null {
  const value = form.get(field);
  return typeof value === 'string' ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}
