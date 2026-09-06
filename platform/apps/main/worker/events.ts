import {
  attachTicketCheckoutSession,
  createAnonClient,
  createPendingTicketPurchase,
  fetchSocialState,
  formatPence,
  parseSocialTicket,
  socialDetailsConfirmed,
  ticketsAreOnSale,
  type SocialState,
  type SocialTicketErrors,
  type TicketPurchaseReason,
} from '@src/shared';
import { eventsCompletePath, eventsSocialPath } from './routing';
import { createCheckoutSession, stripeConfig, type StripeEnv } from './stripe';

/**
 * `/events/` — the club's socials, and the ticket form for one of them.
 *
 * ## The same shape `/nn/<year>/` uses, and for the same reason
 *
 * The page is an Astro file in `dist/`. It ships with the **safe half visible**: the details
 * read "still to be confirmed", the ticket form is hidden *and disabled*, and a note says
 * tickets are not on sale. This Worker then reveals what the database actually supports.
 *
 * **Every failure lands on the shipped markup.** A database this Worker cannot reach, a slug
 * that does not exist, a shape that does not parse — all of them leave the page saying that
 * nothing is on sale, which is wrong in the harmless direction. A page that cannot reach the
 * database must never offer to take money.
 *
 * ## Why the form ships disabled as well as hidden
 *
 * ⚠️ `hidden` does not stop a control being validated. A `required` input inside a hidden
 * container is still constrained, still empty and still invalid, so the browser refuses to
 * submit the form and logs *"An invalid form control with name='…' is not focusable"* to a
 * console nobody has open — no request, no row, no error on the page, and a button that
 * simply does nothing. That took the live entry form down for every signed-in runner on
 * 31 August 2026 and was found by accident hours before entries opened.
 *
 * So `RevealFormHandler` clears `hidden` on the container **and** `disabled` on every control
 * inside it, and the markup ships both. The failure direction is right either way: a form
 * left hidden is also left disabled, so it cannot block the page it is on.
 */

/** What the page should show, once the Worker knows what the database says. */
export type SocialView =
  | { show: 'unavailable' }
  | {
      show: 'social';
      state: SocialState;
      onSale: boolean;
      detailsConfirmed: boolean;
      /** Set only when a submission came back with something to fix. */
      errors?: SocialTicketErrors;
      submitted?: Record<string, string>;
      /** A refusal the database made that the form itself could not have caught. */
      refusal?: string;
    };

interface SocialEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * Read one social, or find out that this page cannot be served from data.
 *
 * Never throws. `unavailable` is the answer to every unhappy path, and the page it produces
 * is the one that sells nothing.
 */
export async function resolveSocialView(
  env: SocialEnv,
  slug: string,
): Promise<SocialView> {
  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  const state = await fetchSocialState(client, slug);

  if (!state.ok) {
    return { show: 'unavailable' };
  }

  return {
    show: 'social',
    state: state.value,
    onSale: ticketsAreOnSale(state.value),
    detailsConfirmed: socialDetailsConfirmed(state.value),
  };
}

// -------------------------------------------------------------------------------------------
// Turning the facts into words
// -------------------------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * `2026-12-05` → `Saturday 5 December 2026`.
 *
 * **Built from the civil date's own parts, never through a `Date` in a timezone.** The value
 * is a `date` in Postgres and a published fact on a poster; parsing it as an instant and
 * formatting it back is how a party on the 5th becomes a party on the 4th for anybody east of
 * London. `Date.UTC` is used only to get the weekday, which is a property of the calendar day
 * rather than of any moment in it.
 *
 * Null in, null out — the page renders its "to be confirmed" line instead.
 */
export function formatSocialDate(date: string | null): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date ?? '');

  if (parts === null) {
    return null;
  }

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const weekday = DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];

  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * `19:30:00` → `7:30pm`, and `13:00:00` → `1pm`.
 *
 * The club's own register, taken from the 2025 party page — `7:30pm-1am`, lower case, no
 * space before the meridiem. A social is advertised in the twelve-hour clock even though the
 * race pages use the twenty-four hour one, because that is what the two audiences read.
 */
export function formatSocialTime(time: string | null): string | null {
  const parts = /^(\d{2}):(\d{2})/u.exec(time ?? '');

  if (parts === null) {
    return null;
  }

  const hour24 = Number(parts[1]);
  const minute = Number(parts[2]);

  if (hour24 > 23 || minute > 59) {
    return null;
  }

  const meridiem = hour24 < 12 ? 'am' : 'pm';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minutes = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;

  return `${hour12}${minutes}${meridiem}`;
}

/** `7:30pm–1am`, or just the start when there is no end, or null when there is no start. */
export function formatSocialTimes(
  startTime: string | null,
  endTime: string | null,
): string | null {
  const start = formatSocialTime(startTime);

  if (start === null) {
    return null;
  }

  const end = formatSocialTime(endTime);

  // An en dash rather than a hyphen: this is a range, and the club's own pages use one.
  return end === null ? start : `${start}–${end}`;
}

/**
 * The label for one quantity in the ticket picker — `2 tickets — £24.00`.
 *
 * **The total is rendered here, on the server, by `formatPence`.** The obvious alternative is
 * a client script that multiplies the price and writes a `£` beside it, and this repository
 * already carries six instances of exactly that pattern (issue #175) — one of them in the
 * entry form's own running total, which re-implements `formatPence`'s `£`/`.00`/`'Free'`
 * shape by hand. Putting the arithmetic in the option label costs nothing, works with
 * scripting off, and cannot disagree with what the card is charged, because both sides
 * multiply the same `price_pence`.
 */
export function quantityOptionLabel(quantity: number, pricePence: number): string {
  const tickets = quantity === 1 ? '1 ticket' : `${quantity} tickets`;

  return `${tickets} — ${formatPence(quantity * pricePence)}`;
}

/**
 * What to say when the database refused something the form could not have caught.
 *
 * **Every reason is mapped**, because an unmapped one renders as nothing at all — the failure
 * mode a bare `if (!ok)` invites, and the reason `TICKET_PURCHASE_REASONS` is a closed list.
 *
 * `bad_key` and `free_place` are deployment faults rather than anything the buyer did, so
 * they say what is true — the club cannot take a payment right now — rather than blaming
 * somebody for a key nobody installed.
 */
export function refusalMessage(reason: TicketPurchaseReason | 'unavailable'): string {
  switch (reason) {
    case 'sold_out':
      return 'There are not enough tickets left for that many. Try fewer, or get in touch with the club.';
    case 'pre_open':
      return 'Tickets are not on sale yet.';
    case 'closed':
      return 'Ticket sales for this have closed.';
    case 'invalid_quantity':
      return 'Choose how many tickets you want from the list.';
    case 'invalid_ticket_type':
      return 'Choose one of the ticket types listed.';
    case 'consents_missing':
      return 'Tick the box to agree before buying a ticket.';
    case 'no_such_social':
      return 'The club could not find that event.';
    case 'bad_key':
    case 'free_place':
    case 'unavailable':
    default:
      // **One message for three different faults, deliberately.** A missing key, a misconfigured
      // price and an unreachable database are all "the club cannot sell you this right now" to
      // the person reading, and distinguishing them on the page would disclose which of the
      // club's own pieces is missing. The Worker log is where they are told apart.
      return 'Tickets cannot be bought just now. Please try again shortly, or get in touch with the club.';
  }
}

/** Validate a submitted order against the occasion it is for. Re-exported so the handler and
 *  the tests reach the same function rather than two spellings of it. */
export { parseSocialTicket };

// -------------------------------------------------------------------------------------------
// Painting the page
// -------------------------------------------------------------------------------------------

/** Reveals an element that ships `hidden`. */
class RevealHandler {
  element(element: Element): void {
    element.removeAttribute('hidden');
  }
}

/** Hides an element that ships visible. */
class HideHandler {
  element(element: Element): void {
    element.setAttribute('hidden', '');
  }
}

/** Replaces an element's text, and optionally reveals it. */
class TextHandler {
  constructor(
    private readonly content: string,
    private readonly reveal: boolean = false,
  ) {}

  element(element: Element): void {
    element.setInnerContent(this.content);

    if (this.reveal) {
      element.removeAttribute('hidden');
    }
  }
}

/**
 * Puts a control back into the form — the other half of the `hidden`/`disabled` pair.
 *
 * ⚠️ **Clearing `hidden` alone is not enough and clearing `disabled` alone is not either.**
 * The container ships hidden so nothing is offered before it can be honoured; every control
 * inside it ships disabled so that a hidden `required` box cannot silently refuse the whole
 * form. Both are cleared here, together, and never separately — see this file's header.
 */
class EnableHandler {
  element(element: Element): void {
    element.removeAttribute('disabled');
  }
}

/**
 * Removes an element outright — the option for a quantity this occasion does not allow.
 *
 * **Removed rather than hidden or disabled.** A `<select>`'s children cannot be visually
 * hidden the way a container's can: an option left in it is still selectable with a keyboard,
 * and a `disabled` one is still announced. There is nothing to reveal later on this page, so
 * taking it out is both the simplest and the only correct answer.
 */
class RemoveHandler {
  element(element: Element): void {
    element.remove();
  }
}

/**
 * How many quantity options the page ships.
 *
 * **Twenty, because that is `store.socials.max_tickets_per_purchase`'s own check constraint.**
 * The markup ships one option per permitted quantity and this Worker fills the ones the
 * occasion allows and removes the rest — so shipping fewer than the constraint permits would
 * silently cap an occasion the database would have accepted, which is the kind of mismatch
 * nobody notices until somebody cannot buy the seventh ticket. `tests/unit/events.test.ts`
 * asserts the two numbers against each other.
 */
export const QUANTITY_OPTIONS = 20;

/** Returns a person's own input to the box they typed it into, and marks the box invalid. */
class ValueHandler {
  constructor(
    private readonly value: string,
    private readonly invalid: boolean,
  ) {}

  element(element: Element): void {
    element.setAttribute('value', this.value);

    if (this.invalid) {
      element.setAttribute('aria-invalid', 'true');
    }
  }
}

/**
 * Paint what the database says onto the social's page.
 *
 * **Nothing here invents a fact.** A null date, venue or time leaves the shipped "still to be
 * confirmed" line exactly where it is; there is no branch that falls back to a previous
 * year's answer, and adding one would be the club announcing a party it has not agreed.
 */
export function renderSocialView(rewriter: HTMLRewriter, view: SocialView): HTMLRewriter {
  if (view.show !== 'social') {
    // Every failure: the page keeps its shipped markup, which sells nothing and claims
    // nothing. Deliberately not an error message — a visitor reading about a party does not
    // need to be told which of the club's own systems is unreachable.
    return rewriter;
  }

  const { state } = view;

  rewriter.on('[data-social-name]', new TextHandler(state.displayName));

  const date = formatSocialDate(state.socialDate);
  const times = formatSocialTimes(state.startTime, state.endTime);

  // Each fact is painted only when it exists. The element ships carrying the "to be
  // confirmed" wording, so a null leaves the honest answer in place rather than a blank.
  if (date !== null) {
    rewriter.on('[data-social-date]', new TextHandler(date));
  }

  if (times !== null) {
    rewriter.on('[data-social-times]', new TextHandler(times));
  }

  if (state.venue !== null) {
    rewriter.on('[data-social-venue]', new TextHandler(state.venue));
  }

  if (state.minimumAge !== null) {
    rewriter.on(
      '[data-social-age]',
      new TextHandler(`Entry requirements: ${state.minimumAge}+`, true),
    );
  }

  // The price, wherever the page mentions one. A social with no ticket type has no price and
  // the line stays as shipped.
  const cheapest = state.ticketTypes[0];

  if (cheapest !== undefined) {
    rewriter.on('[data-social-price]', new TextHandler(formatPence(cheapest.pricePence)));
  }

  if (view.detailsConfirmed) {
    rewriter.on('[data-social-unconfirmed]', new HideHandler());
  }

  if (!view.onSale) {
    // **The form stays hidden and stays disabled.** Both, and this is the branch where that
    // matters most: a page whose tickets are not on sale must not carry controls that can
    // block a submission nobody can make anyway.
    return rewriter;
  }

  rewriter
    .on('[data-social-form]', new RevealHandler())
    .on('[data-social-form] input', new EnableHandler())
    .on('[data-social-form] select', new EnableHandler())
    .on('[data-social-form] button', new EnableHandler())
    .on('[data-social-closed]', new HideHandler());

  // **Never offer more tickets than are left.** `ticketsRemaining` is null when the occasion
  // has no capacity, in which case its own per-purchase cap is the only limit.
  const offered = Math.max(
    1,
    Math.min(
      state.maxTicketsPerPurchase,
      state.ticketsRemaining ?? state.maxTicketsPerPurchase,
    ),
  );

  // **Fill the ones this occasion allows and remove the rest**, rather than assembling
  // `<option>` markup and injecting it. There is deliberately no
  // `setInnerContent(..., { html: true })` anywhere in this repository to audit, and the fee
  // cards and the previous-years pills both ship empty and get filled for the same reason.
  for (let quantity = 1; quantity <= QUANTITY_OPTIONS; quantity += 1) {
    const selector = `[data-social-quantity='${quantity}']`;

    if (quantity > offered) {
      rewriter.on(selector, new RemoveHandler());
      continue;
    }

    // The label is built by `quantityOptionLabel`, which is where `formatPence` is called.
    // Nothing here writes a `£` of its own — that is the doubling defect (`££18.00`) the
    // entry form's own running total already risks.
    rewriter.on(
      selector,
      new TextHandler(quantityOptionLabel(quantity, cheapest?.pricePence ?? 0)),
    );
  }

  if (cheapest !== undefined) {
    rewriter.on('[data-social-ticket-code]', new ValueHandler(cheapest.code, false));
  }

  // What somebody typed, returned to them, with the problems named. Only ever present on the
  // re-render after a refused submission.
  if (view.errors !== undefined) {
    const errors = view.errors;

    rewriter.on('[data-social-error-summary]', new RevealHandler());

    for (const [field, message] of Object.entries(errors)) {
      if (message === undefined) {
        continue;
      }

      rewriter.on(`[data-social-error='${field}']`, new TextHandler(message, true));
    }

    for (const [field, value] of Object.entries(view.submitted ?? {})) {
      rewriter.on(
        `[data-social-field='${field}']`,
        new ValueHandler(value, errors[field as keyof SocialTicketErrors] !== undefined),
      );
    }
  }

  if (view.refusal !== undefined) {
    rewriter.on('[data-social-refusal]', new TextHandler(view.refusal, true));
  }

  return rewriter;
}

// -------------------------------------------------------------------------------------------
// Taking the order
// -------------------------------------------------------------------------------------------

export interface TicketOrderEnv extends SocialEnv, StripeEnv {
  /**
   * **A Worker secret**, and what lets anything hold a ticket at all.
   *
   * `store.create_pending_purchase()` is granted to `anon` — it has to be, a signed-out buyer
   * reaches PostgREST as `anon` — and it holds tickets before any money moves. Without this,
   * a loop with the published anon key would take every ticket to the party for nothing, and
   * Cloudflare's rate-limiting rule would never see it because PostgREST is a different
   * origin from this Worker. That is ADR-029's finding, applied here before it was needed
   * rather than four days after.
   *
   * Optional, and its absence is a real, safe state: with no key nothing can be held, so
   * nothing can be sold. The database holds only its SHA-256 digest, in `store.api_secrets`
   * under `entry`, and it ships null — which refuses everything.
   */
  STORE_ENTRY_KEY?: string;
}

export type TicketOrderOutcome =
  | { status: 'redirect'; url: string }
  | { status: 'invalid'; errors: SocialTicketErrors; submitted: Record<string, string> }
  | { status: 'closed' }
  | { status: 'stopped'; reason: TicketPurchaseReason | 'unavailable' };

/**
 * Validate an order, hold the tickets, and hand back where to send somebody to pay.
 *
 * ## The order of operations is the whole safety argument
 *
 *   1. **Is Stripe configured?** Checked *before* anything is written, so a Worker that
 *      cannot take a payment never holds a ticket it can never charge for.
 *   2. **Is this occasion selling?** Read fresh, not trusted from the page — somebody can
 *      open the page at one moment and press the button at another.
 *   3. **Does the submission validate?** Against the occasion's own columns.
 *   4. **Hold and price**, in one transaction under the social's advisory lock, keyed.
 *   5. **Create the session** for exactly the amount the database computed, and attach it.
 *
 * Step 5 failing leaves a held ticket with nothing to charge against it. That is the right
 * way round: the hold lapses in 31 minutes and the ticket returns to the pool on its own,
 * whereas a session created against a ticket nobody holds is a payment for nothing.
 */
export async function processTicketOrder(
  form: FormData | null,
  env: TicketOrderEnv,
  url: URL,
  slug: string,
): Promise<TicketOrderOutcome> {
  const view = await resolveSocialView(env, slug);

  if (view.show !== 'social') {
    return { status: 'stopped', reason: 'unavailable' };
  }

  if (!ticketsAreOnSale(view.state)) {
    return { status: 'closed' };
  }

  const submitted = readSubmitted(form);
  const parsed = parseSocialTicket(submitted, view.state);

  if (!parsed.ok) {
    // **What they typed goes back with the problems**, minus the fields nobody should see
    // returned. `readSubmitted` already narrows to the boxes this form has.
    return { status: 'invalid', errors: parsed.errors, submitted };
  }

  // **The configuration checks come after validation, and the order is the decision.** They
  // used to be first, on the reasoning that a Worker which cannot take a payment should never
  // hold a ticket — right about *writes*, wrong about the person. Validation writes nothing,
  // so no ticket is held either way; what the old order actually did was answer "tickets
  // cannot be bought just now" to somebody who had left the form blank, hiding a mistake they
  // could fix behind one they could not.
  //
  // Nothing above this line writes and nothing below it is reached with an invalid
  // submission, so the property that mattered is intact.
  const stripe = stripeConfig(env);

  if (stripe === null) {
    return { status: 'stopped', reason: 'unavailable' };
  }

  const entryKey = env.STORE_ENTRY_KEY?.trim();

  if (!entryKey) {
    return { status: 'stopped', reason: 'unavailable' };
  }

  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  const held = await createPendingTicketPurchase(client, {
    entryKey,
    socialSlug: slug,
    order: parsed.value,
  });

  if (!held.ok) {
    return { status: 'stopped', reason: held.reason };
  }

  const session = await createCheckoutSession(stripe, {
    purchaseId: held.value.purchaseId,
    eventSlug: slug,
    amountPence: held.value.amountPence,
    description: `${view.state.displayName} — ${held.value.ticketLabel} × ${held.value.quantity}`,
    purchaserEmail: parsed.value.email,
    successUrl: new URL(eventsCompletePath(slug), url).toString(),
    cancelUrl: new URL(eventsSocialPath(slug), url).toString(),
    // **The session dies with the hold.** A Checkout page that outlives the tickets it is for
    // is a page somebody can pay on after the tickets have gone back into the pool.
    expiresAt: new Date(held.value.holdExpiresAt ?? Date.now() + 31 * 60 * 1000),
  });

  if (!session.ok) {
    // The hold stands and lapses on its own. Nothing invents a destination — see
    // `createCheckoutSession`'s own note on exactly this.
    return { status: 'stopped', reason: 'unavailable' };
  }

  await attachTicketCheckoutSession(client, held.value.purchaseId, session.sessionId);

  return { status: 'redirect', url: session.url };
}

/**
 * The fields this form has, and nothing else.
 *
 * **A narrow read rather than iterating the body**, so a submission carrying extra keys
 * cannot get them echoed back into the page — which is how a reflected value becomes a
 * reflected script. The email confirmation box is read back too, because retyping an address
 * twice after a validation failure is the thing most likely to make somebody give up.
 */
function readSubmitted(form: FormData | null): Record<string, string> {
  const read = (key: string): string => {
    const value = form?.get(key);
    return typeof value === 'string' ? value : '';
  };

  return {
    purchaserName: read('purchaserName'),
    email: read('email'),
    emailConfirm: read('emailConfirm'),
    quantity: read('quantity'),
    ticketCode: read('ticketCode'),
  };
}
