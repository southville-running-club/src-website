import {
  createUserClient,
  formatLondon,
  formatPence,
  type SupabaseConfig,
} from '@src/shared';

import { html, raw } from './html';
import { masthead, notFound, page, type AdminViewer } from './admin-shell';

/**
 * `/admin/events/` — who has bought a ticket to a club social.
 *
 * ADR-033 shipped `store` with no admin surface at all and said so: *"who is coming is the
 * runbook's queries and Stripe's dashboard … this is the biggest gap and the first thing to
 * build next."* This is that, and it needed the eleventh permission — `store.ticket.read`,
 * taken by the club on 6 September 2026.
 *
 * ## It shows everything the club holds, which is three things
 *
 * A name, an email address and a quantity. That is not this page being careful; it is
 * everything `store.ticket_purchases` has. There is no date of birth, no medical note and no
 * per-attendee list, because ADR-033 decided a party ticket collects none of them — so unlike
 * `/admin/nn/`, which had to decide what not to render, this page renders the row.
 *
 * ## Why there is no export button
 *
 * `nn.entry.export` is its own permission precisely because a file leaves the building. A CSV
 * of the club's members' email addresses is a twelfth permission and a separate decision, not
 * a button somebody adds to a page that already reads the data.
 *
 * ## Why non-`paid` rows are shown
 *
 * A volunteer asking *"did Alex get a ticket"* needs to see an abandoned checkout to answer
 * it. `/admin/nn/` learned this expensively: `read_entry_list()` inner-joined the entrant, so
 * a refunded purchase could not appear on the page at all and a volunteer concluded there had
 * been no refunds. Every row is here, and the status column says which is which.
 */

export interface TicketRow {
  ticket_no: number | null;
  social_slug: string;
  social_name: string;
  purchaser_name: string;
  purchaser_email: string;
  quantity: number;
  amount_pence: number;
  status: string;
  attention: string | null;
  created_at: string;
  paid_at: string | null;
  purchase_id: string;
}

const CAPTION_ID = 'admin-tickets-caption';

/**
 * Sold, held, and what the club has actually taken.
 *
 * **Counted off the rows rather than asked of the database**, for `/admin/nn/`'s reason: the
 * arithmetic lives in one place. **Exported so it can be read in a test** — the same reason
 * `checkoutSessionParams` is, and it matters more here because the acceptance layer cannot
 * reach this page without a signed-in staff fixture.
 */
export function figures(rows: TicketRow[]): {
  paidTickets: number;
  paidOrders: number;
  takenPence: number;
  heldTickets: number;
} {
  let paidTickets = 0;
  let paidOrders = 0;
  let takenPence = 0;
  let heldTickets = 0;

  for (const row of rows) {
    if (row.status === 'paid') {
      paidTickets += row.quantity;
      paidOrders += 1;
      takenPence += row.amount_pence;
    } else if (row.status === 'pending') {
      heldTickets += row.quantity;
    }
  }

  return { paidTickets, paidOrders, takenPence, heldTickets };
}

/** The words a volunteer reads, rather than the column's own value. Exported to be tested. */
export function statusWords(status: string): string {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'pending':
      return 'Not paid yet';
    case 'expired':
      return 'Not completed';
    case 'refunded':
      return 'Refunded';
    default:
      // A status this Worker does not know, from a database ahead of it. Shown rather than
      // hidden: a row nobody can read is better than a row nobody can see.
      return status;
  }
}

export async function handleEventsSection(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  segments: string[],
): Promise<Response> {
  if (segments.length > 0 || request.method !== 'GET') {
    return notFound();
  }

  const asPerson = createUserClient(cfg, viewer.accessToken);

  const { data, error } = await asPerson.schema('store').rpc('admin_ticket_list', {});

  if (error) {
    // **Never a claim that nobody has bought a ticket.** That is the same rule
    // `/admin/people/` follows and the same one `/account/entries/` follows: an unreadable
    // database says so, because "the list is empty" is a statement about the club's records.
    console.error(
      `store.admin_ticket_list unavailable — ${error.code}: ${error.message}`,
    );

    return page(
      'Tickets',
      html`${masthead(viewer)}
        <main class="admin-page" id="main">
          <h1>Tickets</h1>
          <p>
            The club’s database could not be reached, so this page cannot say who has
            bought a ticket. <strong>It is not saying nobody has.</strong> Try again in a
            moment.
          </p>
        </main>`,
      { status: 503 },
    );
  }

  const rows = (Array.isArray(data) ? data : []) as TicketRow[];
  const totals = figures(rows);

  return page(
    'Tickets',
    html`${masthead(viewer)}
      <main class="admin-page" id="main">
        <h1>Tickets</h1>

        <p>
          <span class="admin-mono">${totals.paidTickets}</span>
          ${totals.paidTickets === 1 ? 'ticket' : 'tickets'} paid for across
          <span class="admin-mono">${totals.paidOrders}</span>
          ${totals.paidOrders === 1 ? 'order' : 'orders'}, totalling
          <span class="admin-mono">${formatPence(totals.takenPence)}</span>.
          ${
            totals.heldTickets > 0
              ? html`<span class="admin-mono">${totals.heldTickets}</span> more are held
                  while somebody is at the payment page.`
              : null
          }
        </p>

        ${
          rows.length === 0
            ? html`<p>
                Nobody has bought a ticket yet. Tickets go on sale when
                <span class="admin-mono">sales_open_at</span> is set — see the
                events-tickets runbook.
              </p>`
            : html`<div
                class="admin-scroll"
                tabindex="0"
                role="region"
                aria-labelledby="${raw(CAPTION_ID)}"
              >
                <table class="admin-table">
                  <caption class="admin-visually-hidden" id="${raw(CAPTION_ID)}">
                    Everybody who has bought a ticket to a club social
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      ${
                        /* **`admin-col-wide`, so these fold under the name below 48rem.** An
                           email address is the longest value in this table and a fourth
                           column at 320px is what starts a page sliding sideways — the
                           defect `/admin/nn/` documents and this table would repeat. */
                        null
                      }
                      <th scope="col" class="admin-col-wide">Email</th>
                      <th scope="col">Tickets</th>
                      <th scope="col" class="admin-col-wide">Paid</th>
                      <th scope="col">Status</th>
                      <th scope="col" class="admin-col-wide">Bought</th>
                      <th scope="col" class="admin-col-wide">Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(
                      (row) =>
                        html`<tr>
                          <th scope="row">
                            ${row.purchaser_name}
                            ${
                              /* The narrow layout's job: everything `admin-col-wide` hides
                                 reappears here, under the name it belongs to. */
                              null
                            }
                            <span class="admin-stack admin-break">
                              <span class="admin-mono">${row.purchaser_email}</span>
                            </span>
                            ${
                              row.attention === null
                                ? null
                                : html`<span class="admin-stack"
                                    ><strong
                                      >Needs a human: ${row.attention}</strong
                                    ></span
                                  >`
                            }
                          </th>
                          <td class="admin-col-wide admin-break">
                            <span class="admin-mono">${row.purchaser_email}</span>
                          </td>
                          <td class="admin-mono">${row.quantity}</td>
                          <td class="admin-col-wide admin-mono">
                            ${formatPence(row.amount_pence)}
                          </td>
                          <td>${statusWords(row.status)}</td>
                          <td class="admin-col-wide admin-mono">
                            ${formatLondon(row.created_at)}
                          </td>
                          <td class="admin-col-wide">${row.social_name}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
        }
      </main>`,
  );
}
