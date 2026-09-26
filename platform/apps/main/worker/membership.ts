import { createAnonClient } from '@src/shared';
import { formatPriceWords } from '@src/shared/money';
import {
  MEMBERSHIP_FIELDS,
  parseMembershipApplication,
  type MembershipErrors,
} from '@src/shared/membership-application';

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
export function isMembershipJoinPath(pathname: string): boolean {
  return pathname === '/membership/join/';
}

/** Where somebody lands once the club has their application. */
export const MEMBERSHIP_COMPLETE_PATH = '/membership/join/complete/';

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
  /** England Athletics' own registration year, from `membership.settings`. */
  eaCutoffMonth: number;
  eaCutoffDay: number;
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
  ea_cutoff_month: number;
  ea_cutoff_day: number;
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
        // ⚠️ Read rather than written down: England Athletics sets its own registration year,
        // and a constant here would be wrong in April of whichever year it moved.
        eaCutoffMonth: rows[0]?.ea_cutoff_month ?? 4,
        eaCutoffDay: rows[0]?.ea_cutoff_day ?? 1,
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

/* -------------------------------------------------------------------------------------------
 * Taking an application
 * ------------------------------------------------------------------------------------------- */

/**
 * ⚠️ **The honeypot's name, and why it is not `email2` or `url`.**
 *
 * It has to look like something a form-filling robot wants to complete and a person never
 * sees. The control ships `hidden`, `tabindex="-1"` and `autocomplete="off"` — the last of
 * those so a password manager does not fill it on somebody's behalf and get a real applicant
 * refused, which is the failure mode that makes honeypots quietly hostile.
 */
const HONEYPOT_FIELD = 'website';

/**
 * Which wording the three policy boxes were ticked against.
 *
 * ⚠️ **A constant here and a column in the database**, which is `entry_purchases.consents_version`'s
 * arrangement exactly: changing a policy later must not silently restate what somebody already
 * agreed to. Moving it means a deploy, which is correct — the policies themselves are documents
 * in a repository, not rows.
 */
const CONSENTS_VERSION = '2026-09-25';

export interface MembershipOrderEnv extends MembershipEnv {
  MEMBERSHIP_ENTRY_KEY?: string;
}

export type MembershipOrderOutcome =
  | { status: 'accepted' }
  /** The submission was good and the club cannot record it. Nothing was stored. */
  | { status: 'unavailable' }
  | {
      status: 'invalid';
      errors: MembershipErrors;
      submitted: Record<string, string>;
    };

/** The boxes this form has, and nothing else off the request. */
function readSubmitted(form: FormData | null): Record<string, string> {
  const submitted: Record<string, string> = {};
  if (form === null) return submitted;

  for (const field of MEMBERSHIP_FIELDS) {
    const value = form.get(field);
    if (typeof value === 'string') submitted[field] = value;
  }

  return submitted;
}

/**
 * Take one application.
 *
 * ## ⚠️ The honeypot answers `accepted` and stores nothing
 *
 * Telling a robot it was caught is telling whoever wrote it what to change. The response is
 * indistinguishable from a real acceptance, and the club simply never hears about it — which
 * is the whole point, because the alternative is a mailbox full of them.
 *
 * ## The order of the checks is the decision
 *
 * Validation first, configuration second. The other way round answers "we cannot take
 * applications just now" to somebody who left a box blank, hiding a mistake they can fix
 * behind one they cannot. Nothing above the configuration check writes, so no application is
 * recorded either way.
 */
export async function processMembershipApplication(
  form: FormData | null,
  env: MembershipOrderEnv,
  today: { year: number; month: number; day: number },
): Promise<MembershipOrderOutcome> {
  const view = await resolveMembershipView(env);

  // A price the page could not read is a price nobody can be held to, so there is nothing to
  // validate an application against. The form is closed in that state anyway.
  if (view.show !== 'prices') {
    return { status: 'unavailable' };
  }

  const submitted = readSubmitted(form);

  // ⚠️ Checked before anything is parsed, so a robot never reaches the schema at all.
  const honeypot = form?.get(HONEYPOT_FIELD);
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    return { status: 'accepted' };
  }

  const parsed = parseMembershipApplication(
    submitted,
    {
      codes: view.state.types.map((type) => type.code),
      minimumAge: view.state.minimumAge,
      // ⚠️ Read from the database rather than written here: the England Athletics year's
      // cut-off moves, and a constant would be wrong in April of whichever year it moved.
      eaCutoffMonth: view.state.eaCutoffMonth,
      eaCutoffDay: view.state.eaCutoffDay,
    },
    today,
  );

  if (!parsed.ok) {
    // **What they typed goes back with the problems**, so nobody retypes an address because
    // they got a postcode wrong.
    return { status: 'invalid', errors: parsed.errors, submitted };
  }

  const entryKey = env.MEMBERSHIP_ENTRY_KEY?.trim();

  if (entryKey === undefined || entryKey === '') {
    // The runbook has not installed the key. Nothing has been stored, and the page says so
    // rather than claiming an application the club does not have.
    return { status: 'unavailable' };
  }

  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  try {
    const { data, error } = await client.schema('membership').rpc('submit_application', {
      p_key: entryKey,
      p_application: { ...parsed.value, consentsVersion: CONSENTS_VERSION },
    });

    if (error !== null) return { status: 'unavailable' };

    const answer = data as { ok?: boolean } | null;

    // ⚠️ **A refusal from the database is `unavailable`, not `invalid`.** Every rule it
    // enforces is one the schema has already checked, so reaching here means the two
    // disagree — a deployment state rather than something the applicant can fix, and telling
    // them to correct a box they filled in correctly is the worse of the two answers.
    return answer?.ok === true ? { status: 'accepted' } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/* -------------------------------------------------------------------------------------------
 * Painting a failed submission back onto the form
 * ------------------------------------------------------------------------------------------- */

/** Puts a typed value back into a text box. */
class ValueHandler {
  constructor(private readonly value: string) {}

  element(element: Element): void {
    element.setAttribute('value', this.value);
  }
}

/** Marks a radio, a checkbox or an option as the one that was chosen. */
class ChosenHandler {
  constructor(private readonly attribute: 'checked' | 'selected') {}

  element(element: Element): void {
    element.setAttribute(this.attribute, '');
  }
}

/** Fills an error slot and reveals it, and marks the control it is about. */
class ErrorHandler {
  constructor(private readonly message: string) {}

  element(element: Element): void {
    element.setInnerContent(this.message);
    element.removeAttribute('hidden');
  }
}

/** One entry in the summary at the top of the form. */
function summaryItem(field: string, message: string): string {
  return `<li><a href="#${field}">${message}</a></li>`;
}

/**
 * Re-render the form with what was typed and what was wrong.
 *
 * ⚠️ **The summary is the form's first child and takes focus**, which is what makes a failed
 * submission navigable rather than merely announced. The account forms learned this: they
 * always announced their errors with `aria-invalid` and a `role="alert"`, and what was missing
 * was the list of links to the fields.
 */
export function renderMembershipErrors(
  rewriter: HTMLRewriter,
  errors: MembershipErrors,
  submitted: Record<string, string>,
): HTMLRewriter {
  const entries = MEMBERSHIP_FIELDS.filter((field) => errors[field] !== undefined);

  for (const field of entries) {
    rewriter.on(
      `[data-membership-error='${field}']`,
      new ErrorHandler(errors[field] ?? ''),
    );
  }

  rewriter.on('[data-membership-error-summary]', new RevealHandler());
  rewriter.on(
    '[data-membership-error-list]',
    new RawHandler(
      entries.map((field) => summaryItem(field, errors[field] ?? '')).join(''),
    ),
  );

  // ⚠️ **Nothing is put back into a password or a consent box, and there are none here** —
  // but the three policy checkboxes are deliberately *not* restored either. Somebody has to
  // agree to a policy on the submission that records it, not on a previous one.
  for (const [field, value] of Object.entries(submitted)) {
    if (value === '') continue;

    if (field === 'title' || field === 'country') {
      rewriter.on(
        `select[name='${field}'] option[value='${cssValue(value)}']`,
        new ChosenHandler('selected'),
      );
      continue;
    }

    if (
      field === 'membershipType' ||
      field === 'previousAffiliation' ||
      field === 'eaPortalConsent'
    ) {
      rewriter.on(
        `input[name='${field}'][value='${cssValue(value)}']`,
        new ChosenHandler('checked'),
      );
      continue;
    }

    rewriter.on(`input[name='${field}']`, new ValueHandler(value));
  }

  return rewriter;
}

/**
 * ⚠️ **A submitted value goes into a CSS attribute selector, so it has to be escaped there.**
 *
 * `HTMLRewriter` parses these as real selectors. A value carrying `'` would close the quote
 * and make the selector either invalid — which throws and takes the whole response down — or,
 * worse, valid and matching something else. Only a handful of fields reach this, and every one
 * of them is a closed list the schema has already validated, but escaping at the boundary is
 * what stops that being load-bearing.
 */
function cssValue(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'");
}

/** Writes markup rather than text — used only for the summary list this file builds itself. */
class RawHandler {
  constructor(private readonly markup: string) {}

  element(element: Element): void {
    element.setInnerContent(this.markup, { html: true });
  }
}

/**
 * Say that the club could not record a good application.
 *
 * ⚠️ **This is the message that stops somebody thinking they have joined.** Every other
 * failure on a club page paints nothing and leaves the shipped words, which is right when the
 * shipped words are still true. They are not true here: the page they are looking at says
 * "Send my application", they pressed it, and nothing was stored. Silence would read as
 * success.
 *
 * It reuses the notice the page already carries for prices it cannot show, because that
 * element is already the one place this form says "not now, try the old site" — a second
 * banner saying the same thing in different words is how two messages start disagreeing.
 */
export function renderMembershipUnavailable(rewriter: HTMLRewriter): HTMLRewriter {
  rewriter.on('[data-membership-error-summary]', new RevealHandler());
  rewriter.on(
    '[data-membership-error-list]',
    new RawHandler(
      '<li>Your application was not sent, and nothing has been stored. ' +
        'Nothing you typed was wrong — the club could not record it just now. ' +
        'Please try again in a few minutes.</li>',
    ),
  );

  return rewriter;
}
