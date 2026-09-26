import { createAnonClient } from '@src/shared';
import { formatPriceWords } from '@src/shared/money';

/**
 * What membership costs, read at request time and painted onto a static page.
 *
 * ## Why this exists at all
 *
 * The club raises its fees about once a year and asked for that to be a query rather than a
 * deploy. The club pages are static Astro, so a static page cannot read a price when somebody
 * loads it — the Worker has to rewrite the served HTML on its way out. That is what `/nn/`,
 * `/nn/<year>/` and `/events/<slug>/` already do, and this is the same mechanism pointed at
 * `membership.membership_state()`.
 *
 * So `update membership.membership_types set price_pence = 500 where code = 'club'` changes
 * every page on the next request, and nothing in markup restates a price.
 *
 * ## ⚠️ The shipped page is the safe state
 *
 * Every failure here paints **nothing**, which leaves the page as built: the options are
 * named, and where a price would be the page says it is confirmed on the club's own form.
 * That is the same direction every other failure on a club page takes, and the same reason
 * `/events/<slug>/` ships "details to be confirmed" rather than a date.
 *
 * ⚠️ **A page that cannot reach the database must never quote a price.** A stale or invented
 * figure on a page somebody joins from is worse than no figure, because they will believe it.
 */

/**
 * Which pages quote a membership price.
 *
 * ⚠️ **This predicate is here rather than in `routing.ts`, and that is the freeze rather than
 * a preference.** Every page that takes or handles money reads `routing.ts`, so it is one of
 * the shared Worker modules frozen until after Nightingale Nightmare on 1 November 2026.
 * Adding an export to it would be additive and harmless and would still be an edit to a file
 * the entry form resolves through, two weeks before the race. It costs nothing to keep the
 * club's own route knowledge in the club's own module, so that is where it is.
 *
 * Three addresses: the home page, which quotes the annual price in its own words; the
 * membership page, which is where somebody compares the four options; and the application
 * form, which has to state what it is about to charge.
 */
export function isMembershipPricePath(pathname: string): boolean {
  return (
    pathname === '/' || pathname === '/membership/' || pathname === '/membership/join/'
  );
}

interface MembershipEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/** One row of `membership.membership_state()`. */
export interface MembershipType {
  code: string;
  displayName: string;
  pricePence: number;
  /** The England Athletics share, where there is one. Not the club's money. */
  eaFeePence: number | null;
  summary: string | null;
  sortOrder: number;
}

export interface MembershipState {
  types: readonly MembershipType[];
  minimumAge: number;
}

export type MembershipView =
  | { show: 'prices'; state: MembershipState }
  /** The database could not be asked. The page renders exactly as it was built. */
  | { show: 'unavailable' };

/** The shape PostgREST hands back, before it is given names this codebase uses. */
interface MembershipStateRow {
  code: string;
  display_name: string;
  price_pence: number;
  ea_fee_pence: number | null;
  summary: string | null;
  sort_order: number;
  minimum_age: number;
}

export async function resolveMembershipView(env: MembershipEnv): Promise<MembershipView> {
  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  try {
    const { data, error } = await client.schema('membership').rpc('membership_state');

    // ⚠️ **An empty answer is an outage, not a club that sells nothing.** Every row could
    // only be absent if somebody had deactivated all of them, which is not a state the club
    // has a page for — and painting "no memberships available" over an unreachable database
    // would be the page inventing a fact.
    if (error !== null || !Array.isArray(data) || data.length === 0) {
      return { show: 'unavailable' };
    }

    const rows = data as MembershipStateRow[];

    return {
      show: 'prices',
      state: {
        minimumAge: rows[0]?.minimum_age ?? 0,
        types: rows.map((row) => ({
          code: row.code,
          displayName: row.display_name,
          pricePence: row.price_pence,
          eaFeePence: row.ea_fee_pence,
          summary: row.summary,
          sortOrder: row.sort_order,
        })),
      },
    };
  } catch {
    // The failure direction is towards the page as shipped, for the reason at the head of
    // this file.
    return { show: 'unavailable' };
  }
}

/**
 * Replaces an element's text, leaving its attributes and its element alone.
 *
 * ⚠️ **The field is `content` and may not be called `text`.**
 * `HTMLRewriterElementContentHandlers` declares an optional `text` *method*, so a class with a
 * `text` property is not assignable to it — and the error names the private modifier rather
 * than the collision, which reads as a visibility problem and is not one. `events.ts` spells
 * it `content` for the same reason.
 */
class TextHandler {
  constructor(private readonly content: string) {}

  element(element: Element): void {
    element.setInnerContent(this.content);
  }
}

/** Reveals an element that ships `hidden`. */
class RevealHandler {
  element(element: Element): void {
    element.removeAttribute('hidden');
  }
}

/**
 * Reveals a control **and lets it be submitted**.
 *
 * ⚠️ **`hidden` does not stop a control being validated, and this repository has already lost
 * a day to that.** A `required` input the Worker had hidden on the race entry form stayed in
 * the DOM, empty and invalid; the browser refused to submit a form holding an invalid control
 * it could not focus, logged a line to a console nobody had open, and **sent nothing** — no
 * request, no row, no error on the page, the button simply did nothing. It was found on
 * production hours before entries opened, by luck.
 *
 * `disabled` is the attribute that does both halves: skipped by constraint validation *and*
 * left out of the submission. So every control this file hides ships disabled as well, and
 * both come off together.
 */
class EnableHandler {
  element(element: Element): void {
    element.removeAttribute('hidden');
    element.removeAttribute('disabled');
  }
}

/** Hides an element outright, so it leaves the accessibility tree rather than going invisible. */
class HideHandler {
  element(element: Element): void {
    element.setAttribute('hidden', '');
  }
}

/**
 * Paint the prices onto whichever club page asked for them.
 *
 * The markup carries one `[data-membership-price="<code>"]` per option, and the Worker fills
 * each from the database. An option the page knows about but the database no longer offers is
 * **hidden entirely** rather than left showing a price nobody sells — the same reasoning that
 * makes `membership_state()` return only active rows.
 */
export function renderMembershipView(
  rewriter: HTMLRewriter,
  view: MembershipView,
): HTMLRewriter {
  if (view.show !== 'prices') {
    // Nothing painted. The page says prices are confirmed on the club's own form, which is
    // true and is what it was built saying.
    return rewriter;
  }

  const byCode = new Map(view.state.types.map((type) => [type.code, type]));

  for (const [code, type] of byCode) {
    rewriter.on(
      `[data-membership-price='${code}']`,
      new TextHandler(formatPriceWords(type.pricePence)),
    );

    // ⚠️ **The England Athletics share, which is what makes £27 explicable.** £4 of it is
    // club membership and £23 is England Athletics' own registration fee — not the club's
    // money, exactly like the £2 Unattached Runner Levy on a race entry. Without this the
    // page states a number with no account of it.
    if (type.eaFeePence !== null) {
      const clubShare = type.pricePence - type.eaFeePence;

      rewriter.on(
        `[data-membership-ea-split='${code}']`,
        new TextHandler(
          `${formatPriceWords(clubShare)} club membership plus ` +
            `${formatPriceWords(type.eaFeePence)} England Athletics registration`,
        ),
      );
      rewriter.on(`[data-membership-ea-split='${code}']`, new RevealHandler());
    }

    // ⚠️ **Two attributes for one option, and the second is the one that matters.** The
    // wrapper carries the label, the price and the summary and is what `hidden` conceals;
    // the radio inside it is what `disabled` keeps out of the submission. Hiding the wrapper
    // alone would leave a `required` radio in a group no visible control can satisfy, which
    // is the defect `EnableHandler` above is written up for.
    //
    // **An option the database no longer offers stays hidden and stays disabled**, which is
    // how a withdrawn membership type disappears from the form without a deploy.
    rewriter.on(`[data-membership-option='${code}']`, new RevealHandler());
    rewriter.on(`[data-membership-input='${code}']`, new EnableHandler());
  }

  // The group itself, which ships closed for the same reason: an application may not be
  // submitted against a price the page could not read.
  rewriter.on('[data-membership-options]', new EnableHandler());

  rewriter.on(
    '[data-membership-minimum-age]',
    new TextHandler(String(view.state.minimumAge)),
  );

  // The line the page ships showing, which says the price is confirmed on the club's own
  // form. Once real prices are painted it is no longer true, so it goes.
  rewriter.on('[data-membership-prices-unavailable]', new HideHandler());

  return rewriter;
}
