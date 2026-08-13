import {
  createAnonClient,
  fetchEntryCompletionState,
  type EntryCompletionState,
} from '@src/shared';

/**
 * `/nn/entry/complete/` — saying what the club has recorded, and never more than that.
 *
 * ## The rule the whole page is built on
 *
 * **Only `paid` makes a positive claim, and no state ever makes a negative one.**
 *
 * The second half is the one that took work to see, and it is the difference between this page
 * being useful and this page costing somebody £17. Consider the sequence: a runner pays, the
 * webhook is delayed or lost, their thirty-one minute hold lapses, and they refresh. The
 * database says the hold expired. If the page then says *"nothing has been charged"* — which
 * is what the page said before this slice, and what the TODO in it instructed the next author
 * to keep saying — they will go back to `/nn/` and pay again. The club has taken £34 from
 * somebody who wanted one race, and found out from them rather than from the system.
 *
 * So a lapsed hold says what the club has **recorded**, never what the bank did, and tells
 * them plainly not to enter again.
 *
 * ## Arriving here is still not proof of payment
 *
 * Unchanged from before, and worth restating because the page now *can* say "confirmed":
 *
 *   1. the redirect fires in the person's browser, so a closed tab means it never fires while
 *      the payment may still have gone through;
 *   2. it is an ordinary URL that anybody can type, and the acceptance suite does exactly that
 *      with a session id matching nothing;
 *   3. Stripe confirms to the **webhook**, server to server, which is the only channel that
 *      cannot be forged or lost in a tab.
 *
 * What changed is that the webhook now exists, so there is a recorded fact to report. The page
 * reports **that record** and never the redirect it arrived by. A session id in the URL is not
 * authentication, and `entries.entry_completion_state()` is written accordingly: it returns one
 * word and nothing else — not the name, not the email, not the amount, not the purchase id.
 *
 * ## There is no auto-refresh, and that is a decision rather than an omission
 *
 * A `<meta http-equiv="refresh">` on the pending state is the obvious thing, and the brief
 * allowed it if it could be argued for. **It cannot.** A delayed refresh under twenty hours is
 * a WCAG 2.2.1 failure — axe flags it as `meta-refresh` under `wcag2a` — and zero violations is
 * not a threshold in this repository. It is also hostile in the specific case it would be used:
 * a page that reloads under somebody who is reading it, on a phone, having just paid.
 *
 * So the pending state carries **a plain link back to the same address** labelled as such. It
 * works with scripting disabled, it is the reader's decision rather than a timer's, and it
 * costs one tap. No polling script either — this site has no client-side state and does not
 * start here.
 *
 * ## One page, painted at serve time
 *
 * `output: 'static'`, so this is one file in `dist/`, and the state is painted onto it by
 * `HTMLRewriter` exactly as `/nn/`'s two forms are. One copy of the page, no second template
 * in the Worker to drift from it.
 */

export interface NnEntryCompleteEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * Which block the page shows.
 *
 * Four rather than five, because `lapsed` and `unknown` are the same message to the person
 * reading it: **the club has no record of a payment against this address, and that is not a
 * claim that nothing was charged.** They differ only in whether a purchase row exists, which
 * is a fact about the club's bookkeeping rather than about anybody's money — and one of the
 * ways `unknown` happens is a purchase whose session id had not been written back yet, where
 * saying "we have never heard of this" would be actively wrong.
 */
export type NnEntryCompleteView = 'confirming' | 'paid' | 'no-record' | 'refunded';

/**
 * What to show for what the database said.
 *
 * **Everything that is not a definite answer resolves to `confirming`**, which is the block
 * that claims nothing in either direction: the page that was already here. A database this
 * Worker cannot reach must not produce a confirmation, and it must not produce a denial
 * either.
 */
export function viewForState(state: EntryCompletionState): NnEntryCompleteView {
  switch (state) {
    case 'paid':
      return 'paid';
    case 'refunded':
      return 'refunded';
    case 'lapsed':
    case 'unknown':
      return 'no-record';
    case 'pending':
      return 'confirming';
  }
}

/**
 * Ask the database what it has recorded about the session in the URL.
 *
 * **Never throws and never guesses `paid`.** Every failure — no session parameter, the
 * migration not landed, the database unreachable, a shape that does not parse — is
 * `confirming`, and the one thing worth logging is why. `fetchEntryCompletionState` builds that
 * string from a PostgREST code and message, neither of which can carry personal data, because
 * the function reads none.
 */
export async function resolveNnEntryCompleteView(
  env: NnEntryCompleteEnv,
  url: URL,
): Promise<NnEntryCompleteView> {
  const session = url.searchParams.get('session')?.trim();

  // **No parameter at all is `confirming`, not `no-record`.** Somebody who typed the bare
  // address has asked nothing, and answering "we have no record of your payment" would be
  // alarming and meaningless. It is also what Stripe sends if the template ever fails to
  // substitute.
  if (!session || session === '{CHECKOUT_SESSION_ID}') {
    return 'confirming';
  }

  try {
    const client = createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    });

    const result = await fetchEntryCompletionState(client, session);

    if (!result.ok) {
      console.error(`entries.entry_completion_state unavailable — ${result.error}`);
      return 'confirming';
    }

    return viewForState(result.state);
  } catch (cause) {
    console.error(
      `entries.entry_completion_state threw — ${cause instanceof Error ? cause.name : 'unknown'}`,
    );
    return 'confirming';
  }
}

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

/**
 * Reveal the block that matches what the club has recorded.
 *
 * The `confirming` block **ships visible** and the other three ship hidden, so the `confirming`
 * case does no rewriting at all. That is the same arrangement `/nn/` uses for the interest
 * form, and for the same reason: the common path and every failure path then produce
 * byte-identical HTML, and the state that claims least is the one that needs no code to
 * happen.
 */
export function renderNnEntryComplete(
  rewriter: HTMLRewriter,
  view: NnEntryCompleteView,
): HTMLRewriter {
  if (view === 'confirming') {
    return rewriter;
  }

  return rewriter
    .on('[data-complete-confirming]', new HideHandler())
    .on(`[data-complete="${view}"]`, new RevealHandler());
}
