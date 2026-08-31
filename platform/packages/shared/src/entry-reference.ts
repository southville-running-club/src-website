import { formatLondonCompactDate, type Instant } from './london-time';

/**
 * The one place an entry reference is rendered to text.
 *
 * ## Why there is one function rather than a template per page
 *
 * A reference is quoted back at the club — in an email, on the phone, in a message — so every
 * surface that prints one has to print the same characters. That is `formatPence()`'s argument
 * exactly, and this repository has already paid for getting it wrong once: a running total that
 * builds its own `£` beside a call to the function that produces one.
 *
 * Four surfaces print a reference today: `/account/entries/`, the four outbox emails,
 * `/admin/nn/entry/`, and the attention queue on `/admin/nn/`. **None of them may write its own
 * separator, padding or prefix.**
 *
 * ## The shape
 *
 * `NN2026-0042-01092026` — the event, the entry number, and the London day the entry was made.
 *
 * **The number alone identifies the entry**, which is what makes the other two halves safe to
 * include: somebody who garbles the date over the phone has still named a unique row. The event
 * is there because the club will run more than one race and a bare number would be ambiguous
 * across them; the date is there because it is the first thing a volunteer wants to know about
 * an entry they are being asked about, and it costs nothing to carry.
 *
 * It replaces the purchase id — `11111111-2222-3333-4444-555555555555` — which was correct,
 * unique, and 36 characters of hexadecimal to read down a phone. `worker/account.ts` named the
 * problem when it chose the id and said the fix was a new column; `entries.entry_purchases.
 * entry_no` is that column.
 *
 * ## What it is not
 *
 * **Not a credential, and not a secret.** It identifies a row and authorises nothing —
 * `request_entry_action()` re-derives ownership from the session and never from the reference it
 * is handed, and `entry_completion_state()` returns one word to anybody holding a session id for
 * the same reason. That was true of the purchase id and is no less true of something shorter.
 *
 * **Not a position in the field.** An abandoned checkout keeps its number, so the numbers on
 * paid entries have gaps. Nothing anywhere presents it as "entry 42 of 250".
 */
export interface EntryReference {
  /** `nn-2026`. The event, not the race — a reference belongs to one running. */
  eventSlug: string;
  /** The per-event number, or `null` for a purchase written before the column existed. */
  entryNo: number | null;
  /** When the purchase row was written. Rendered as the London day. */
  createdAt: Instant;
  /** The fallback, and the thing the reference used to be. */
  purchaseId: string;
}

/**
 * How many digits the number is padded to.
 *
 * **Four, for a race with 250 places.** Wide enough that every entry this club will take has the
 * same shape — a reference that is sometimes eight characters and sometimes ten is harder to
 * read down a column than one that is always the same width — and it does not truncate above
 * 9,999: a five-figure number simply renders as five figures.
 */
const DIGITS = 4;

/**
 * `nn-2026` → `NN2026`.
 *
 * Everything that is not a letter or a digit comes out, so the slug's own separator does not
 * become a fourth field in a reference that already has three. Derived rather than mapped,
 * because publishing 2027 is meant to be a row in `entries.events` and no code change at all.
 */
function prefix(eventSlug: string): string {
  return eventSlug.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * The reference, or the purchase id when there is no number to build one from.
 *
 * **The fallback is the whole of the expand step.** `entry_no` is nullable and every read treats
 * it as optional, so a Worker running against a database that predates the column — or one row
 * a backfill somehow missed — prints exactly what it printed before today rather than a
 * reference with a hole in it. A reference is a thing somebody quotes: half of one is worse than
 * the long one it replaced.
 */
export function formatEntryReference(reference: EntryReference): string {
  if (reference.entryNo === null) {
    return reference.purchaseId;
  }

  const number = String(reference.entryNo).padStart(DIGITS, '0');

  return `${prefix(reference.eventSlug)}-${number}-${formatLondonCompactDate(reference.createdAt)}`;
}
