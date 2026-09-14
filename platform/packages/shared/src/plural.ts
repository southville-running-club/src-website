/**
 * One or the other — the singular and the plural of a sentence, chosen in one place.
 *
 * ## Why this is shared rather than file-local
 *
 * It was file-local to `apps/main/worker/nn-admin.ts` and never exported, so `/admin/emails/`
 * — which renders the **same** `entries.email_outbox.attempts` column — re-derived the rule by
 * hand and picked a different noun with it. One outbox row read *"3 attempts"* on the queue and
 * *"Failed after 3 tries"* on the entry timeline, so a volunteer answering *"I entered and never
 * heard anything"* had two of the club's own pages disagreeing about one number. Issue
 * [#175](https://github.com/southville-running-club/src-website/issues/175).
 *
 * That is `formatPence()`'s argument and `formatEntryReference()`'s, and it is the same class of
 * defect: **a rule with two implementations has two answers**, and the second one is found by a
 * reader rather than by a test. A third surface that needs a count and a noun calls this.
 *
 * ## The shape, and why `many` is a whole string rather than a suffix
 *
 * `plural(3, 'note', 'notes')` is the ordinary case. `plural(n, 'One ask', n + ' asks')` is why
 * the third argument is a built string: the plural of an English sentence is not always the
 * singular with an `s` on it, and a helper that only appends one sends every caller that needs
 * more than that back to writing the conditional by hand — which is how this file's own subject
 * arose.
 *
 * **The noun and its verb move together** — `plural(n, 'purchase is', 'purchases are')` rather
 * than pluralising the noun and leaving the verb behind. Splitting them is how this gets
 * half-fixed by the next person, which
 * [#173](https://github.com/southville-running-club/src-website/issues/173) had already found
 * once: *"2 purchases are flagged … and only 1 are on this page"*.
 *
 * It takes the count rather than a boolean so a call site reads as the sentence it produces, and
 * it deliberately does **not** interpolate the count: several callers print the number
 * themselves, inside markup — a `<span class="admin-mono">` — that this function has no business
 * knowing about.
 *
 * **Zero takes the plural**, which is what English does: *"0 notes"*, not *"0 note"*. So does a
 * negative, which no caller can produce — `attempts` is `min(0)` in its own schema and every
 * other caller counts rows.
 */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
