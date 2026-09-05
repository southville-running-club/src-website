import { z } from 'zod';

import type { DbClient } from './supabase';

/**
 * One ticketed club social, as a page needs to see it.
 *
 * ## Why this is not `entry-state.ts` with a wider type
 *
 * A race entry and a party ticket look alike from a distance and differ in every field that
 * matters. An entry has a start time, an age category, a capacity measured in runners and a
 * medical-note retention promise; a ticket has a venue, an end time, a quantity and none of
 * the rest. Widening `EntryState` to hold both would give every caller a type where half the
 * fields are null for reasons it has to know about — which is how `/nn/` ends up rendering a
 * venue and `/events/` ends up rendering an age category against a date of birth nobody
 * asked for. See ADR-033.
 *
 * ## Null means "not confirmed", everywhere in this file
 *
 * Five of these come back null today, because nobody has supplied them: the date, both times,
 * the venue and the age limit. **That is a real state and it is rendered as one** — the page
 * says the details are still to be confirmed. Nothing here substitutes last year's value, and
 * nothing downstream may either.
 */

export const TICKET_SALES_STATES = ['pre_open', 'open', 'closed'] as const;

export type TicketSalesState = (typeof TICKET_SALES_STATES)[number];

export interface TicketType {
  code: string;
  label: string;
  pricePence: number;
}

export interface SocialState {
  slug: string;
  displayName: string;
  /**
   * Civil, as published — `2026-12-05`. Not an instant: "Saturday 5 December, 7:30pm" is what
   * a poster says and it does not move if somebody reads it from another timezone.
   *
   * **Null means the committee has not confirmed a date.**
   */
  socialDate: string | null;
  /** `HH:MM:SS` as Postgres renders a `time`, or null when not confirmed. */
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  /**
   * Null means no age check. **No date of birth is collected here**, so an age limit on a
   * party ticket is a declaration the buyer makes rather than a fact the club verifies —
   * which is the honest trade against asking everybody at a party for their birthday.
   */
  minimumAge: number | null;
  state: TicketSalesState;
  maxTicketsPerPurchase: number;
  requiredConsents: string[];
  consentVersion: string;
  /** Null means no limit on how many may come. */
  capacity: number | null;
  /** Null when there is no capacity to count against. */
  ticketsRemaining: number | null;
  /** Empty until a price is confirmed — and an empty list is why nothing can be sold. */
  ticketTypes: TicketType[];
}

export type SocialStateResult =
  { ok: true; value: SocialState } | { ok: false; error: string };

const ticketTypeShape = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  price_pence: z.number().int().min(0),
});

const socialStateShape = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  social_date: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  venue: z.string().nullable(),
  minimum_age: z.number().int().nullable(),
  sales_state: z.enum(TICKET_SALES_STATES),
  max_tickets_per_purchase: z.number().int().positive(),
  required_consents: z.array(z.string()),
  consent_version: z.string().min(1),
  capacity: z.number().int().positive().nullable(),
  tickets_remaining: z.number().int().min(0).nullable(),
  ticket_types: z.array(ticketTypeShape),
});

/**
 * Read one social's public configuration.
 *
 * **Never throws, and never resolves to `open` on a failure it does not understand.** Every
 * unhappy path — the function missing because a migration has not landed, an unknown slug, a
 * shape that does not parse — comes back as `ok: false`, and the caller treats that exactly
 * as it treats a closed window.
 *
 * The failure direction is towards selling nothing, which is the only safe direction for a
 * page attached to a card payment. It is the same rule `fetchEntryState` follows and for the
 * same reason.
 */
export async function fetchSocialState(
  client: DbClient,
  slug: string,
): Promise<SocialStateResult> {
  const { data, error } = await client.schema('store').rpc('social_state', {
    p_slug: slug,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return { ok: false, error: `No social with slug ${slug}` };
  }

  const parsed = socialStateShape.safeParse(row);

  if (!parsed.success) {
    return { ok: false, error: 'The social configuration did not parse' };
  }

  const value = parsed.data;

  return {
    ok: true,
    value: {
      slug: value.slug,
      displayName: value.display_name,
      socialDate: value.social_date,
      startTime: value.start_time,
      endTime: value.end_time,
      venue: value.venue,
      minimumAge: value.minimum_age,
      state: value.sales_state,
      maxTicketsPerPurchase: value.max_tickets_per_purchase,
      requiredConsents: value.required_consents,
      consentVersion: value.consent_version,
      capacity: value.capacity,
      ticketsRemaining: value.tickets_remaining,
      ticketTypes: value.ticket_types.map((kind) => ({
        code: kind.code,
        label: kind.label,
        pricePence: kind.price_pence,
      })),
    },
  };
}

/**
 * Whether a ticket can actually be bought right now.
 *
 * **Two conditions, and both are load-bearing.** The window has to be open *and* there has to
 * be a price — an occasion with no `ticket_types` row is one whose price nobody has
 * confirmed, and a form that offers to charge an unconfirmed price is the thing this whole
 * schema is arranged to make impossible. Either alone is sufficient to keep the form hidden,
 * which is the belt and braces the 2026 party ships with.
 */
export function ticketsAreOnSale(social: SocialState): boolean {
  return social.state === 'open' && social.ticketTypes.length > 0;
}

/**
 * Whether the club has published enough about this occasion to describe it at all.
 *
 * The page renders a "still to be confirmed" note when this is false, rather than a list of
 * blank rows or — far worse — last year's answers.
 */
export function socialDetailsConfirmed(social: SocialState): boolean {
  return social.socialDate !== null && social.venue !== null && social.startTime !== null;
}
