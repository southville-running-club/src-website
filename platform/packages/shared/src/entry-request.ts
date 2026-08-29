import { z } from 'zod';

/**
 * One thing somebody has asked the club to do about their own entry.
 *
 * ## Why this is a list rather than a column
 *
 * `entry_purchases.requested_action` holds **one** word, and a second ask overwrote the first.
 * So somebody who pressed *Transfer*, thought better of it and pressed *Cancel* left a record
 * saying only that they wanted to cancel — and, read the other way round, a volunteer looking
 * at *"transfer asked for"* had no way to know a cancellation had been asked for first. Both
 * are the same defect: **the club was holding one ask and the runner had made two.**
 *
 * That matters more than it sounds. The two asks want opposite things — a refund and no
 * refund — so a volunteer acting on the wrong one either takes a place off somebody who wanted
 * to hand it to a friend, or hands on a place somebody wanted their money back for.
 *
 * `entries.entry_requests` is the append-only record of every ask. The column stays, holding
 * the most recent one, because the **Asked about** filter and every deployed reader use it —
 * expand, migrate, contract.
 *
 * ## Resolution is a fact about the entry, not about one ask
 *
 * A volunteer who cancels or transfers an entry has dealt with *everything* outstanding on it;
 * there is no act that answers one ask and leaves another open. So `resolved_at` is set on
 * every open row at once, by a trigger watching `entry_purchases.request_resolved_at` — which
 * is what lets `cancel_entry()` and `transfer_entry()` stay exactly as they are.
 */
export const ENTRY_REQUEST_ACTIONS = ['cancel', 'transfer'] as const;

export type EntryRequestAction = (typeof ENTRY_REQUEST_ACTIONS)[number];

export interface EntryRequest {
  action: EntryRequestAction;
  /** Their own words, or null because the box was left empty. Never exported, ever. */
  reason: string | null;
  requestedAt: string;
  /** When a volunteer dealt with the entry this was about. Null while it is outstanding. */
  resolvedAt: string | null;
}

/**
 * `.catch` on both nullable fields, for the reason every optional field in this repository has
 * one: nothing sequences a migration against the Cloudflare deploy, so a reader that meets a
 * shape it does not recognise must render the row rather than refuse the page.
 */
export const entryRequestShape = z.object({
  action: z.enum(ENTRY_REQUEST_ACTIONS),
  reason: z.string().nullable().catch(null),
  requested_at: z.string(),
  resolved_at: z.string().nullable().catch(null),
});

export function readEntryRequest(row: z.infer<typeof entryRequestShape>): EntryRequest {
  return {
    action: row.action,
    reason: row.reason,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
  };
}

/**
 * What an ask is called on screen.
 *
 * **The word the runner pressed, not the word the database stores.** "Transfer" on its own
 * reads as something the club did; every one of these is something somebody asked for and
 * nothing has happened yet.
 */
export function entryRequestWords(action: EntryRequestAction): string {
  return action === 'cancel' ? 'cancellation asked for' : 'transfer asked for';
}
