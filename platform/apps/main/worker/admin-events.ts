import {
  createUserClient,
  formatLondon,
  formatPence,
  type SupabaseConfig,
} from '@src/shared';

import { html, raw } from './html';
import { ADMIN_PREFIX } from './routing';
import { masthead, notFound, page, type AdminViewer } from './admin-shell';
import { formatSocialDate } from './events';

/**
 * `/admin/events/` — the club's socials, and who has bought a ticket to each.
 *
 * ADR-033 shipped `store` with no admin surface at all and said so: *"who is coming is the
 * runbook's queries and Stripe's dashboard … this is the biggest gap and the first thing to
 * build next."* This is that, and it needed the eleventh permission — `store.ticket.read`,
 * taken by the club on 6 September 2026.
 *
 * ## Two pages, because one flat list was wrong
 *
 * `/admin/events/` is the index: every social, with what has been sold against it.
 * `/admin/events/<slug>/` is the tickets for one of them.
 *
 * **The first version was a single table of every ticket ever sold**, which reads fine with
 * one party in the database and becomes unusable with three — the question a volunteer has is
 * never "who has bought anything" but "who is coming to *this*".
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
const INDEX_CAPTION_ID = 'admin-events-caption';

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

export interface SocialRow {
  slug: string;
  display_name: string;
  social_date: string | null;
  venue: string | null;
  sales_open_at: string | null;
  sales_close_at: string | null;
  capacity: number | null;
  price_pence: number | null;
  paid_tickets: number;
  paid_orders: number;
  taken_pence: number;
  held_tickets: number;
}

/**
 * Whether a social is selling, in the words a volunteer needs.
 *
 * **Two independent reasons it might not be**, and saying which is the whole value of this
 * column: a window that has not opened is waiting on the runbook, and a missing price is
 * waiting on the committee. "Not on sale" for both would send somebody to the wrong place.
 */
export function salesWords(social: SocialRow, now = Date.now()): string {
  if (social.price_pence === null) {
    return 'No price set';
  }

  if (social.sales_open_at === null) {
    return 'Not on sale';
  }

  if (Date.parse(social.sales_open_at) > now) {
    return 'Opens later';
  }

  if (social.sales_close_at !== null && Date.parse(social.sales_close_at) <= now) {
    return 'Closed';
  }

  return 'On sale';
}

/**
 * What the club has taken, rendered for a **total** rather than for a price.
 *
 * ⚠️ **`formatPence(0)` is `'Free'`, and that is right for a price and wrong here.** In a
 * "Taken" column it reads as *this event is free* rather than as *nothing has been taken* —
 * which is a claim about what the club charges, on the page a director checks sales on, and
 * it was on screen before anybody noticed.
 *
 * **A dash rather than a hand-written `£0.00`.** `formatPence()` is the one function allowed
 * to render money to text, and writing the zero case by hand here would be the seventh
 * instance of the pattern issue #175 already tracks — a template building its own currency
 * string beside a call to the function that exists to build it. A dash writes no money at
 * all, which is the only way to say "none" without saying it in pounds.
 */
export function taken(pence: number): string {
  return pence === 0 ? '—' : formatPence(pence);
}

export async function handleEventsSection(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  segments: string[],
): Promise<Response> {
  if (request.method !== 'GET') {
    return notFound();
  }

  if (segments.length === 0) {
    return socialIndex(viewer, cfg);
  }

  if (segments.length === 1) {
    return ticketList(viewer, cfg, segments[0] ?? '');
  }

  return notFound();
}

/** Every social, with what has been sold against it. */
async function socialIndex(viewer: AdminViewer, cfg: SupabaseConfig): Promise<Response> {
  const asPerson = createUserClient(cfg, viewer.accessToken);
  const { data, error } = await asPerson.schema('store').rpc('admin_social_list');

  if (error) {
    console.error(
      `store.admin_social_list unavailable — ${error.code}: ${error.message}`,
    );
    return unreachable(viewer, 'Events', 'say what the club has on');
  }

  const socials = (Array.isArray(data) ? data : []) as SocialRow[];

  return page(
    'Events',
    html`${masthead(viewer)}
      <main class="admin-page" id="main">
        <h1>Events</h1>

        ${
          socials.length === 0
            ? html`<p>
                There are no socials yet. One is a row in
                <span class="admin-mono">store.socials</span>, added by a migration — see
                the events-tickets runbook.
              </p>`
            : html`<div
                class="admin-scroll"
                tabindex="0"
                role="region"
                aria-labelledby="${raw(INDEX_CAPTION_ID)}"
              >
                <table class="admin-table">
                  <caption class="admin-visually-hidden" id="${raw(INDEX_CAPTION_ID)}">
                    The club’s socials and what has been sold against each
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col" class="admin-col-wide">When</th>
                      <th scope="col" class="admin-col-wide">Where</th>
                      <th scope="col">Tickets</th>
                      <th scope="col" class="admin-col-wide">Taken</th>
                      <th scope="col">Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${socials.map(
                      (social) =>
                        html`<tr>
                          <th scope="row">
                            ${
                              /* **The name is the link, and it is the only one.** A row that
                                 is entirely clickable hides where it goes from anybody
                                 reading with a keyboard or a screen reader. */
                              null
                            }
                            <a href="${ADMIN_PREFIX}/events/${social.slug}/"
                              >${social.display_name}</a
                            >
                            <span class="admin-stack admin-break">
                              ${
                                social.social_date === null
                                  ? 'Date to be confirmed'
                                  : formatSocialDate(social.social_date)
                              }
                            </span>
                          </th>
                          <td class="admin-col-wide">
                            ${
                              /* Null is a real state — the committee has not confirmed one —
                                 and it is rendered as itself rather than as a blank cell. */
                              social.social_date === null
                                ? 'To be confirmed'
                                : formatSocialDate(social.social_date)
                            }
                          </td>
                          <td class="admin-col-wide admin-break">
                            ${social.venue ?? 'To be confirmed'}
                          </td>
                          <td class="admin-mono">
                            ${social.paid_tickets}${
                              social.capacity === null ? '' : ` / ${social.capacity}`
                            }
                          </td>
                          <td class="admin-col-wide admin-mono">
                            ${taken(social.taken_pence)}
                          </td>
                          <td>${salesWords(social)}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
        }
      </main>`,
  );
}

/** Who has bought a ticket to one social. */
async function ticketList(
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  slug: string,
): Promise<Response> {
  const asPerson = createUserClient(cfg, viewer.accessToken);

  // **Both reads, and the index one is what says whether the social exists at all.** A slug
  // nobody has ever used and a social with no tickets sold both come back as an empty ticket
  // list, and they are not the same answer: the first is a 404 and the second is a page
  // saying nothing has sold yet. Without this the first would render as the second, which is
  // a page inventing an occasion.
  const [{ data, error }, { data: socialData, error: socialError }] = await Promise.all([
    asPerson.schema('store').rpc('admin_ticket_list', { p_social_slug: slug }),
    asPerson.schema('store').rpc('admin_social_list'),
  ]);

  if (error || socialError) {
    // **Never a claim that nobody has bought a ticket.** That is the same rule
    // `/admin/people/` follows and the same one `/account/entries/` follows: an unreadable
    // database says so, because "the list is empty" is a statement about the club's records.
    const failure = error ?? socialError;
    console.error(
      `store ticket read unavailable — ${failure?.code}: ${failure?.message}`,
    );

    return unreachable(viewer, 'Tickets', 'say who has bought a ticket');
  }

  const socials = (Array.isArray(socialData) ? socialData : []) as SocialRow[];
  const social = socials.find((row) => row.slug === slug);

  if (social === undefined) {
    // Same 404 as every other address under this prefix, for the same reason.
    return notFound();
  }

  const rows = (Array.isArray(data) ? data : []) as TicketRow[];
  const totals = figures(rows);

  return page(
    social.display_name,
    html`${masthead(viewer)}
      <main class="admin-page" id="main">
        <p><a href="${ADMIN_PREFIX}/events/">← All events</a></p>

        <h1>${social.display_name}</h1>

        <p>
          <span class="admin-mono">${totals.paidTickets}</span>
          ${totals.paidTickets === 1 ? 'ticket' : 'tickets'} paid for across
          <span class="admin-mono">${totals.paidOrders}</span>
          ${totals.paidOrders === 1 ? 'order' : 'orders'}, totalling
          <span class="admin-mono">${taken(totals.takenPence)}</span>.
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
                Nobody has bought a ticket to this yet. Sales are
                <strong>${salesWords(social).toLowerCase()}</strong> — see the
                events-tickets runbook for what opens them.
              </p>`
            : html`<div
                class="admin-scroll"
                tabindex="0"
                role="region"
                aria-labelledby="${raw(CAPTION_ID)}"
              >
                <table class="admin-table">
                  <caption class="admin-visually-hidden" id="${raw(CAPTION_ID)}">
                    Everybody who has bought a ticket to ${social.display_name}
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
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
        }
      </main>`,
  );
}

/**
 * The page a failed read produces.
 *
 * **It never says the list is empty.** "Nobody has bought a ticket" is a statement about the
 * club's records, and a database this Worker could not reach has told it nothing at all —
 * the same rule `/admin/people/` and `/account/entries/` both follow.
 */
function unreachable(viewer: AdminViewer, title: string, what: string): Response {
  return page(
    title,
    html`${masthead(viewer)}
      <main class="admin-page" id="main">
        <h1>${title}</h1>
        <p>
          The club’s database could not be reached, so this page cannot ${what}.
          <strong>It is not saying there is nothing to show.</strong> Try again in a
          moment.
        </p>
      </main>`,
    { status: 503 },
  );
}
