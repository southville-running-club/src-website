import { z } from 'zod';

// ⚠️ **No `.js` extension on a sibling import, and it is not a style preference.**
// `tsc` and vitest both resolve `'./money.js'` to `money.ts` quite happily, so a module written
// that way typechecks and unit-tests clean. **Next's webpack does not** — and it only ever
// sees these files once one of them is exported from `index.ts`, because that is what
// `apps/timing` imports. So the failure arrives on the day a module joins the barrel, in a
// build for an app that never referenced it, reported as `module-not-found` against a file
// that plainly exists. Every other module here omits the extension; this is why.
import { COUNTRIES } from './countries';
import { formatPriceWords } from './money';
import type { DbClient } from './supabase';

/**
 * The two messages the club owes about a membership application.
 *
 * ADR-021's mechanism, one schema along: the obligation was written in the same transaction as
 * the application, so this only has to render and deliver it, and a failure loses nothing.
 *
 * ## ⚠️ The two messages carry deliberately different amounts about the same person
 *
 * `application_received` goes to the **applicant** and says almost nothing about them: their
 * first name, what they chose, and what it costs. `application_submitted` goes to the **club**
 * and is the Membership Officer's working copy of the form — an address, a date of birth, a
 * phone number.
 *
 * **The split is enforced by the query, not by these templates.**
 * `membership.claim_outbox_batch()` returns `details: null` for the applicant's copy, so
 * `details` is genuinely absent rather than present-and-unused. An edit to the acknowledgement
 * cannot grow a home address, because there is no home address in the row it renders from.
 * That is the arrangement to preserve if either template is ever changed.
 *
 * ## Text is authoritative
 *
 * These are the text parts and they state every fact. An HTML part renders from the **same
 * `MembershipOutboxMessage`** and never from this function's output, so the two may differ in
 * presentation and can never differ in what they say — ADR-026's rule, and ADR-041's after it.
 */

/** Everything `claim_outbox_batch()` hands back about one message. */
export interface MembershipOutboxMessage {
  id: string;
  template: string;
  recipient: string;
  attempts: number;
  firstName: string;
  lastName: string;
  /** "SRC membership and an England Athletics licence". */
  membershipName: string;
  pricePence: number;
  /**
   * ⚠️ **Whose reply this message invites, decided in SQL rather than here.**
   *
   * On the club's copy it is the **applicant**, so a Membership Officer answering a new-member
   * email reaches the new member rather than the club's own inbox. On the applicant's copy it
   * is the club. Getting this backwards sends a reply into the void, which is why the query
   * settles it and this module only carries it.
   */
  replyTo: string;
  /** Null on the applicant's copy. Present only on the club's. */
  details: MembershipApplicationDetails | null;
}

export interface MembershipApplicationDetails {
  title: string;
  email: string;
  phone: string;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string;
  addressLine1: string;
  addressLine2: string | null;
  cityTown: string;
  postcode: string;
  country: string;
  membershipType: string;
  previousAffiliation: boolean;
  previousClubName: string | null;
  eaUrn: string | null;
  eaPortalConsent: boolean;
  consentsVersion: string;
}

const detailsShape = z.object({
  title: z.string(),
  email: z.string(),
  phone: z.string(),
  dateOfBirth: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  cityTown: z.string(),
  postcode: z.string(),
  country: z.string(),
  membershipType: z.string(),
  previousAffiliation: z.boolean(),
  previousClubName: z.string().nullable(),
  eaUrn: z.string().nullable(),
  eaPortalConsent: z.boolean(),
  consentsVersion: z.string(),
});

const messageShape = z.object({
  id: z.string(),
  template: z.string(),
  recipient: z.string(),
  attempts: z.number(),
  firstName: z.string(),
  lastName: z.string(),
  membershipName: z.string(),
  pricePence: z.number(),
  replyTo: z.string(),
  details: detailsShape.nullable(),
});

/** The club's meeting details, as the acknowledgement states them. */
const MEET =
  'Tuesdays and Thursdays at the Southbank Club, Dean Lane. Meet 6.00pm for a 6.15pm start.';

const SIGN_OFF =
  'Southville Running Club\nReply to this email if you need to ask us anything.';

/**
 * A country's name, falling back to the code.
 *
 * ⚠️ **A code in an email is a small tax every time somebody reads one.** `GB` is obvious and
 * `AX` is not, and the Membership Officer reads this on a phone. The fallback matters because
 * `COUNTRIES` is the *form's* list and a stored code must stay readable the day that list drops
 * an entry — which is the same reason the column is not a foreign key.
 */
function countryName(code: string): string {
  return COUNTRIES.find(([value]) => value === code)?.[1] ?? code;
}

/**
 * How old somebody is today, from a `YYYY-MM-DD` string.
 *
 * ⚠️ **Derived at send time and never stored**, for `entries.entrants`' reason: a stored age is
 * wrong the moment a birthday passes, and wrong silently. It is shown beside the date because
 * it is the number a Membership Officer actually acts on.
 */
function ageOnToday(dateOfBirth: string, today: Date): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateOfBirth);
  if (parts === null) return null;

  const [, year, month, day] = parts.map(Number) as [number, number, number, number];
  let age = today.getUTCFullYear() - year;

  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);

  if (beforeBirthday) age -= 1;
  return age;
}

/** `12 April 1990`, which is how a person reads a date. */
function readableDate(dateOfBirth: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateOfBirth);
  if (parts === null) return dateOfBirth;

  const [, year, month, day] = parts.map(Number) as [number, number, number, number];
  const months = [
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
  ];

  return `${String(day)} ${months[month - 1] ?? String(month)} ${String(year)}`;
}

/** Pads a label so the club's copy reads as a form rather than as prose. */
function row(label: string, value: string): string {
  return `${label.padEnd(16)}${value}`;
}

/**
 * The text body and subject for one message.
 *
 * Throws on a template this Worker does not know, which is the expand/migrate/contract seam:
 * the database may allow a template a deployed Worker has never heard of, and the drain catches
 * this so one message fails and the batch behind it goes on.
 */
export function membershipEmailBody(
  message: MembershipOutboxMessage,
  now: Date = new Date(),
): { subject: string; text: string } {
  const price = formatPriceWords(message.pricePence);

  switch (message.template) {
    case 'application_received':
      return {
        subject: "We've got your application to join Southville Running Club",
        text: [
          `Hello ${message.firstName},`,
          '',
          `Thanks for applying to join Southville Running Club. We have your application for ${message.membershipName}, ${price} a year.`,
          '',
          'The Membership Officer will be in touch about paying. Nothing has been charged yet and there is nothing you need to do for now.',
          '',
          `You are welcome at a run in the meantime, member or not. ${MEET}`,
          '',
          SIGN_OFF,
        ].join('\n'),
      };

    case 'application_submitted': {
      const details = message.details;

      // ⚠️ **The club's copy with no details is a real state, not an impossible one.** If the
      // query ever stopped returning them this would silently send an empty form; saying so
      // out loud is what turns that into something a volunteer reports.
      if (details === null) {
        return {
          subject: `New member application — ${message.firstName} ${message.lastName}`,
          text: [
            `${message.firstName} ${message.lastName} has applied to join, for ${message.membershipName}, ${price} a year.`,
            '',
            'The rest of the application could not be read. It is stored; please check with whoever looks after the website.',
            '',
            'Southville Running Club',
          ].join('\n'),
        };
      }

      const age = ageOnToday(details.dateOfBirth, now);
      const address = [
        details.addressLine1,
        details.addressLine2,
        details.cityTown,
        details.postcode,
        countryName(details.country),
      ].filter((line): line is string => line !== null && line.trim() !== '');

      return {
        subject: `New member application — ${message.firstName} ${message.lastName}`,
        text: [
          `${message.firstName} ${message.lastName} has applied to join.`,
          '',
          row('Membership', `${message.membershipName}, ${price} a year`),
          row('Name', `${details.title} ${message.firstName} ${message.lastName}`),
          row('Email', details.email),
          row('Phone', details.phone),
          row(
            'Date of birth',
            age === null
              ? readableDate(details.dateOfBirth)
              : `${readableDate(details.dateOfBirth)} (aged ${String(age)})`,
          ),
          row('Address', address[0] ?? ''),
          ...address.slice(1).map((line) => row('', line)),
          '',
          'England Athletics',
          row(
            '  Affiliated before',
            details.previousAffiliation
              ? `Yes${details.previousClubName === null ? '' : `, ${details.previousClubName}`}`
              : 'No',
          ),
          row('  URN', details.eaUrn ?? 'Not given'),
          row('  May pass details', details.eaPortalConsent ? 'Yes' : 'No'),
          '',
          'Agreed to the code of conduct, the privacy notice and the disciplinary policy.',
          '',
          // The line earns its place: without it, replying looks like it goes to the club's
          // own inbox rather than to the applicant.
          `Reply to this email to answer ${message.firstName} directly.`,
          '',
          'Southville Running Club',
        ].join('\n'),
      };
    }

    default:
      throw new Error(`unknown membership template ${message.template}`);
  }
}

export async function claimMembershipOutboxBatch(
  client: DbClient,
  key: string,
  limit = 10,
): Promise<MembershipOutboxMessage[]> {
  const { data, error } = await client.schema('membership').rpc('claim_outbox_batch', {
    p_key: key,
    p_limit: limit,
  });

  if (error !== null || data === null || typeof data !== 'object') {
    return [];
  }

  const rows = (data as { messages?: unknown }).messages;
  if (!Array.isArray(rows)) return [];

  const messages: MembershipOutboxMessage[] = [];

  for (const candidate of rows) {
    const parsed = messageShape.safeParse(candidate);

    // **A row that does not parse is skipped, not thrown on.** One malformed message must not
    // stop the batch behind it — that is the difference between one person not hearing and
    // everybody not hearing.
    if (parsed.success) messages.push(parsed.data);
  }

  return messages;
}

export async function recordMembershipSendResult(
  client: DbClient,
  key: string,
  id: string,
  outcome: {
    sent: boolean;
    providerMessageId?: string | null;
    error?: string | null;
    rateLimited?: boolean;
  },
): Promise<void> {
  // ⚠️ **The optional arguments are omitted, not passed as `undefined`.** This package sets
  // `exactOptionalPropertyTypes`, so an optional property may be *absent* but may not be
  // explicitly `undefined` — and the generated RPC types make these optional. Leaving a key
  // out lets the function's own `default null` apply, which is the same value by a route
  // TypeScript can check.
  const providerMessageId = outcome.providerMessageId ?? null;
  const error = outcome.error ?? null;

  await client.schema('membership').rpc('record_send_result', {
    p_key: key,
    p_id: id,
    p_sent: outcome.sent,
    ...(providerMessageId === null ? {} : { p_provider_message_id: providerMessageId }),
    ...(error === null ? {} : { p_error: error }),
    p_rate_limited: outcome.rateLimited ?? false,
  });
}
