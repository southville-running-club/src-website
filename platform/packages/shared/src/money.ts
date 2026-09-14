/**
 * Money, formatted once and in one place.
 *
 * ## Why this is a module of its own
 *
 * It lived in `entry-state.ts` until 14 September 2026 and moved for one reason:
 * **`NnEntryForm.astro`'s running total is a browser bundle**, and it was the last of the six
 * re-implemented helpers [#175](https://github.com/southville-running-club/src-website/issues/175)
 * tracks — rebuilding the `£`, the pound-pence shape and the `'Free'` branch by hand rather
 * than calling this. Importing this out of `entry-state.ts` closed the duplication and cost
 * **5,969 bytes** on the entry form's script: that module builds Zod schemas at module scope,
 * so nothing tree-shakes them away.
 *
 * Six kilobytes is a poor trade for one call on the page that takes the money, and
 * "re-implement it, then" is the trade that issue exists to refuse. A leaf module is the third
 * answer, and it is `plural.ts`'s exactly — that file was split out of `nn-admin.ts` two days
 * earlier, for the same reason and in the same issue. Measured on a production build: **128
 * bytes** this way.
 *
 * Every existing caller imports `formatPence` from `@src/shared`, which is unchanged.
 *
 * ## Why not `toLocaleString`
 *
 * ESLint bans the timezone-taking members of that family repository-wide and the currency one
 * has the same shape of problem: it takes the ambient locale, so a Worker in one region and a
 * browser in another would render the same price two ways. The club charges pounds sterling
 * and always will; two decimal places and a `£` is the whole requirement.
 *
 * ⚠️ **The `£` belongs to this function.** A template that writes its own beside a call to it
 * renders `££18.00` — which a draft email template did — and `£Free` on a given place.
 *
 * Zero is "Free" rather than "£0.00" because that is what a VI guide's place is, and a price
 * of nothing set in the same figures as a price of something reads like a mistake. ⚠️ That is
 * right for a **price** and wrong for a **total already taken**, which is why
 * `admin-events.ts` renders a dash for zero rather than calling this.
 */
export function formatPence(pence: number): string {
  if (pence === 0) {
    return 'Free';
  }

  const pounds = Math.floor(pence / 100);
  const remainder = String(pence % 100).padStart(2, '0');

  return `£${pounds}.${remainder}`;
}
