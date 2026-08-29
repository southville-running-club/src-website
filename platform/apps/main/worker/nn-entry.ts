import {
  attachCheckoutSession,
  createAnonClient,
  createUserClient,
  createNnPendingPurchase,
  entryRulesFrom,
  fetchCurrentEntryState,
  fetchEntryState,
  fetchMyEntries,
  formatEventDate,
  formatEventStartTime,
  formatPence,
  parseNnEntry,
  priceNnEntry,
  toIsoDate,
  NN_ENTRY_DISCOUNT_REFUSED_MESSAGE,
  NN_ENTRY_FIELDS,
  type DbClient,
  type EntryFee,
  type EntryState,
  type EntryStateResult,
  type EntryWindowState,
  type MyEntry,
  type NnEntryErrors,
  type NnEntryField,
  type PendingPurchaseReason,
  type PricedNnEntry,
} from '@src/shared';
import {
  createCheckoutSession,
  entryCompleteUrl,
  stripeConfig,
  type StripeEnv,
} from './stripe';
import {
  nnEntryCompletePath,
  nnEventSlugForYearPath,
  nnYearPathForEventSlug,
  NN_PREFIX,
  NN_RACE_SLUG,
} from './routing';

/**
 * The entry form's two halves: deciding whether to show it at all, and what to do when it
 * arrives.
 *
 * ## Two pages now, and which one is about what
 *
 *   `/nn/`        the **race**. Evergreen, names no year, and carries the interest form.
 *                 When entries are open it says so and links to the running they are open for.
 *   `/nn/2026/`   one **running**. Carries the entry form, and says entries are not open when
 *                 they are not.
 *
 * **Neither page holds a year and neither holds a slug.** The year page's own path is what
 * says which running it is — `/nn/2026/` is the event `nn-2026`, and `worker/routing.ts` owns
 * that one convention. The race page asks `entries.current_entry_state('nn')` and is told
 * which running is on, which is how it links to a year page it does not know the name of.
 *
 * ## Which form is shown, and who decides
 *
 * **The event row decides, not a deploy.** `entries.events.entries_open_at` and
 * `entries_close_at` are read on every request through `entries.entry_state()`, so entries
 * open when the committee says they do rather than when somebody is free to push a commit at
 * seven in the morning. Each page ships with both of its states in it and this module reveals
 * one, which is the same arrangement the interest form's acknowledgement already uses: one
 * copy of the page, in `dist/`, painted at serve time.
 *
 * ## The failure direction is towards taking no entries
 *
 * Every way this can go wrong — the migration not landed, the database unreachable, the
 * function returning a shape that does not parse — resolves to **the interest form**. A page
 * that cannot tell whether entries are open must not offer to take one, and that matters
 * more once there is a card payment on the end of it. `fetchEntryState` never throws and
 * never guesses `open`.
 *
 * ## What happens to a good entry now, and what still does not
 *
 * A valid entry **holds a place and goes to Stripe**. In one database transaction,
 * `entries.create_pending_purchase()` checks the window, takes a per-event lock, counts the
 * places already gone, prices the entry from `entries.fees`, and writes a `pending` purchase
 * with a thirty-one minute hold. The Worker then creates a Checkout session for exactly that
 * amount and 303s to it.
 *
 * **Nothing here moves a purchase to `paid`.** The redirect back from Stripe is not proof of
 * payment — a person can close the tab before it fires, and the return URL is one anybody
 * can type. Confirmation is the webhook's job, and building any part of it here would make
 * two things believe they knew whether somebody had paid. `/nn/entry/complete/` says what
 * the club is doing rather than what has happened.
 *
 * ## Every way this refuses, and what each one is honest about
 *
 *   `closed`     409 — the window moved between the page loading and the button being
 *                      pressed. Nothing stored, nothing charged.
 *   `invalid`    422 — the submission was refused on its contents, every value preserved.
 *   `sold-out`   409 — the last place went while this form was open. **The input is kept**:
 *                      losing a completed entry to a race somebody narrowly missed is the
 *                      worst way to find out, and they may want to ask about a waiting list.
 *   `already-entered`
 *                409 — this runner already holds a place. Understood and refused, exactly like
 *                      `sold-out`. **It answered 503 until #145**, because it was added to
 *                      `NnEntryStoppedStatus` by #115 and inherited the fallback — and it was
 *                      missing from this list, which is how that went unnoticed for a month.
 *                      Anything added to that union belongs here with its status stated.
 *   `free`       503 — the chosen place costs nothing, and a payment page cannot take a
 *                      payment of nothing. See the note on that branch.
 *   `not-taken`  503 — no Stripe secret is configured. **This is the deployed state today**
 *                      and it is Slice A's answer, unchanged: nothing stored, nothing
 *                      charged, said in those words.
 *   `failed`     503 — a place may be held and there is no session to send anybody to.
 *                      Nothing has been charged, and the hold lapses on its own.
 */

export interface NnEntryEnv extends StripeEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * What `/nn/<year>/` shows.
 *
 * `closed` covers every reason the form is not on offer — not yet, no longer, no such event,
 * and a database this Worker could not reach. To somebody looking at the page they are one
 * fact, and collapsing them here is what makes the failure direction a property of the type
 * rather than of whoever reads it next.
 */
export type NnEntryView =
  | {
      show: 'closed';
      /**
       * **The fees, even though the form is not on offer.** The price is a fact about the race
       * rather than a property of the form: `/nn/2026/` states it in its facts list months
       * before anybody can pay it, and "To be confirmed" there is wrong the moment the
       * committee has settled a number.
       *
       * It comes from `entry_state()`, which this path has already read and used to decide the
       * window — so carrying it costs no extra round trip; the previous shape simply threw it
       * away.
       *
       * **Empty when the database could not be reached**, which is what keeps the failure
       * direction right: no fees means the page falls back to "To be confirmed" and claims
       * nothing, rather than claiming a price it could not check.
       */
      fees: EntryFee[];
    }
  | {
      show: 'entry';
      state: EntryState;
      /**
       * True when this form is on offer only because the person asking holds
       * `nn.entry.before_open`. The window is `pre_open` and the public sees "entries are not
       * open yet" at the same address.
       *
       * **The page has to say so.** Somebody shown an entry form nobody else can see will
       * otherwise conclude that entries have opened — and tell people, which is the one thing
       * an unratified opening date must not have happen to it.
       */
      early: boolean;
      /**
       * True when the person asking already holds a **confirmed** place on this running.
       *
       * Always false for a signed-out visitor, who is the whole population until 1 September —
       * this is read from `entries.my_entries()`, which is scoped to `auth.uid()` and the
       * caller's confirmed address, and there is nothing to scope it to without a session.
       *
       * **A notice, not a gate.** The form stays on offer: an account holder can legitimately
       * be entering somebody else. The rule that actually stops a second entry is
       * `create_pending_purchase()`'s, and it is enforced in Postgres whatever this says.
       */
      entered: boolean;
    };

/**
 * Who is asking, as far as `entries` is concerned.
 *
 * `null` for the signed-out majority, which is everybody until 1 September. When it is not
 * null the reads go through `createUserClient` and the database can resolve `auth.uid()` —
 * which is what makes a permission-gated fee visible and a pre-open window enterable.
 */
export interface NnEntryViewer {
  accessToken: string;
}

/** The permission that opens the entry form before entries open. Named once. */
export const ENTER_BEFORE_OPEN = 'nn.entry.before_open';

/**
 * The client the `entries` reads go through, and the reason there are two.
 *
 * `entries.entry_state()` and `entries.create_pending_purchase()` both changed from
 * caller-blind to caller-aware, and both resolve the caller through `auth.uid()`. An anon
 * client has none, so a tester reading the page through one would be told the window is shut —
 * correctly, from the database's point of view, because it could not see who was asking.
 */
function entriesClientFor(env: NnEntryEnv, viewer: NnEntryViewer | null): DbClient {
  const config = {
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  };

  return viewer === null
    ? createAnonClient(config)
    : createUserClient(config, viewer.accessToken);
}

/**
 * Whether this person may enter before entries open.
 *
 * **One RPC, and only for somebody who is signed in.** `readSession` in `worker/index.ts`
 * returns null without a network call when neither cookie is present, so the signed-out
 * visitor — the whole population today — pays nothing for any of this. A signed-in one pays
 * one extra round trip on the year page, which is the price of the form being a fact about
 * them rather than about the deploy.
 *
 * **False on every failure.** A permission list that cannot be read is not a permission, and
 * the failure direction on this whole path is towards taking no entries.
 */
async function mayEnterEarly(
  env: NnEntryEnv,
  viewer: NnEntryViewer | null,
): Promise<boolean> {
  if (viewer === null) {
    return false;
  }

  try {
    const { data, error } = await createUserClient(
      { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY },
      viewer.accessToken,
    ).rpc('my_permissions');

    if (error) {
      // A code and a message, never a row — `my_permissions()` reads no personal data.
      console.error(
        `identity.my_permissions unavailable — ${error.code}: ${error.message}`,
      );
      return false;
    }

    return Array.isArray(data) && (data as unknown[]).includes(ENTER_BEFORE_OPEN);
  } catch (cause) {
    console.error(
      `identity.my_permissions threw — ${cause instanceof Error ? cause.name : 'unknown'}`,
    );
    return false;
  }
}

/**
 * Ask the database whether entries are open for the running this page is about.
 *
 * Errors are swallowed into `closed` rather than propagated. The one thing worth logging
 * is *why*, and `fetchEntryState` builds that string from a PostgREST code and message —
 * neither of which can carry personal data, because the function reads none.
 */
/**
 * Whether the person asking already holds a confirmed place on this running.
 *
 * **Costs nothing for a signed-out visitor**, which is the whole population until 1 September
 * — the same trade `mayEnterEarly()` makes, and for the same reason: an extra round trip on
 * the busiest page of the year has to be earned.
 *
 * **`paid` only.** A `pending` hold is not a place, and telling somebody mid-payment that they
 * already have one is how they abandon a checkout they were about to finish. The database rule
 * is broader — it counts a live hold too, because two simultaneous submissions must not both
 * succeed — but a *notice* may only claim what is settled.
 *
 * **Never throws, and a failure is silence.** This is a courtesy on top of a rule that is
 * enforced in Postgres regardless; a database that could not be reached must not take the
 * entry form down with it.
 */
async function hasConfirmedEntry(
  env: NnEntryEnv,
  viewer: NnEntryViewer | null,
  eventSlug: string,
): Promise<boolean> {
  if (viewer === null) {
    return false;
  }

  const result = await fetchMyEntries(
    createUserClient(
      { url: env.PUBLIC_SUPABASE_URL, anonKey: env.PUBLIC_SUPABASE_ANON_KEY },
      viewer.accessToken,
    ),
  );

  if (!result.ok) {
    // Not an error worth a page: the rule below still holds. Logged without the reason's
    // detail, which `fetchMyEntries` builds from a PostgREST code and message.
    console.warn(`entries.my_entries unavailable for the entry form — ${result.error}`);
    return false;
  }

  return result.entries.some(
    (entry: MyEntry) => entry.eventSlug === eventSlug && entry.status === 'paid',
  );
}

export async function resolveNnEntryView(
  env: NnEntryEnv,
  eventSlug: string,
  viewer: NnEntryViewer | null = null,
): Promise<NnEntryView> {
  const view = await resolveView(
    env,
    (client) => fetchEntryState(client, eventSlug),
    viewer,
  );

  if (view.show === 'entry') {
    return {
      show: 'entry',
      state: view.state,
      early: false,
      entered: await hasConfirmedEntry(env, viewer, eventSlug),
    };
  }

  // **The bypass, and it is the only place the window is second-guessed.** A `pre_open`
  // window plus the permission is a form; everything else — closed, no such event, a
  // database that could not be reached — is the same shut door it was, because
  // `resolveView` collapses all of them into `state: undefined` or a non-`pre_open` state.
  //
  // Note the ordering: the permission is asked for *only* when the state is `pre_open`. A
  // tester on an open form costs no extra round trip, and neither does one on a closed race.
  if (view.state?.state === 'pre_open' && (await mayEnterEarly(env, viewer))) {
    return {
      show: 'entry',
      state: view.state,
      early: true,
      entered: await hasConfirmedEntry(env, viewer, eventSlug),
    };
  }

  // `view.state` is undefined only when the database could not be reached — `resolveView`
  // collapses "no such event" and an unreachable database into the same shut door, and only the
  // second has nothing to report. Either way the fee row falls back to "To be confirmed".
  return { show: 'closed', fees: view.state?.fees ?? [] };
}

/**
 * What `/nn/` shows, which is a different question with a different failure.
 *
 * The race page has no form to reveal when entries are open — the form is on the year page —
 * so what it needs is **where that page is**, and whether to shout about it. That comes back
 * as a path rather than a year, because a year is a thing the page would then have to render
 * and this way it renders a link.
 *
 * `null` is the honest answer when the database cannot be reached or holds no running of this
 * race: no link is painted and the page is the interest form it has always been. That is a
 * front door with one fewer door in it, which is worse than the full page and much better
 * than a link to a year nobody confirmed.
 */
export interface NnRunning {
  /** `2026`. Off the path, so it always agrees with what the links point at. */
  year: string;
  /** `/nn/2026/` */
  yearPath: string;
  /** Which of the three window states, so a label can be honest about what it offers. */
  state: EntryWindowState;
  /** `1 November 2026` — through `packages/shared`'s one date formatter. */
  date: string;
  /** `11:00` — civil, as published, and never through a timezone formatter. */
  startTime: string;
  /** Dearest first, as `entry_state()` orders them. The panel's fee line, once open. */
  fees: EntryFee[];
  /**
   * Runnings of this race that have already happened.
   *
   * **Always empty today, and that is a missing data source rather than a missing feature.**
   * `entries.current_entry_state()` answers for one running; listing past ones needs a second
   * read of `entries.events`, which means another function in that schema — and adding one is
   * a decision this slice was told not to take. Everything downstream is built and tested;
   * filling this is one call. See `renderNnPreviousYears`.
   */
  previous: NnPastRunning[];
}

/** A running of this race that is already over. */
export interface NnPastRunning {
  year: string;
  yearPath: string;
}

export type NnRaceView = { running: null } | { running: NnRunning };

export async function resolveNnRaceView(env: NnEntryEnv): Promise<NnRaceView> {
  const view = await resolveView(env, (client) =>
    fetchCurrentEntryState(client, NN_RACE_SLUG),
  );

  if (view.state === undefined) {
    return { running: null };
  }

  const yearPath = nnYearPathForEventSlug(view.state.slug);

  if (yearPath === null) {
    // A running of this race named some other way. There is no page for it, so linking to a
    // guess would be a 404 on the front door — worse than the missing link.
    console.error(`entries: no year page for event slug ${view.state.slug}`);
    return { running: null };
  }

  // **The year comes off the path, not out of the date.** They agree today and they would
  // agree for any sane row, but two derivations of one number is one derivation too many —
  // and the path is the thing the links use, so what is rendered names what they point at.
  return {
    running: {
      year: yearPath.split('/').filter(Boolean).at(-1) ?? '',
      yearPath,
      state: view.state.state,
      date: formatEventDate(view.state.eventDate),
      startTime: formatEventStartTime(view.state.startTime),
      fees: view.state.fees,
      previous: [],
    },
  };
}

/**
 * The half both resolvers share: never throw, never guess `open`.
 *
 * The `state` rides along on the closed answer too, because `/nn/` needs to know *which*
 * running is current whether or not its entries are open — a front door that only links to
 * the year page during the entry window would be shut for eleven months of the twelve.
 */
type ResolvedView =
  | { show: 'closed'; state: EntryState | undefined }
  | { show: 'entry'; state: EntryState };

async function resolveView(
  env: NnEntryEnv,
  read: (client: DbClient) => Promise<EntryStateResult>,
  viewer: NnEntryViewer | null = null,
): Promise<ResolvedView> {
  try {
    const result = await read(entriesClientFor(env, viewer));

    if (!result.ok) {
      console.error(`entries.entry_state unavailable — ${result.error}`);
      return { show: 'closed', state: undefined };
    }

    return result.value.state === 'open'
      ? { show: 'entry', state: result.value }
      : { show: 'closed', state: result.value };
  } catch (cause) {
    console.error(
      `entries.entry_state threw — ${cause instanceof Error ? cause.name : 'unknown'}`,
    );
    return { show: 'closed', state: undefined };
  }
}

// -----------------------------------------------------------------------------------------
// What the person typed
// -----------------------------------------------------------------------------------------

/**
 * Which of the year page's two forms a request is about.
 *
 * **The hidden field, and not the entry window.** Inferring it from the window nearly works
 * and fails at the worst moment: somebody who opened the page a minute before entries opened
 * would have their name and email address read as an entry and be shown fourteen validation
 * errors about fields they were never asked for. What was submitted is a fact about the
 * submission, so it travels with it.
 *
 * **Anything unrecognised is the interest form**, deliberately: that is the form that takes no
 * money and no personal data beyond a name, so an unlabelled or stale submission lands on the
 * harmless side of the fork.
 */
export type NnFormKind = 'interest' | 'entry';

export function nnFormKind(form: FormData | null): NnFormKind {
  return form?.get('form') === 'entry' ? 'entry' : 'interest';
}

/**
 * Every value exactly as it was typed — untrimmed, unvalidated, and echoed back into the
 * form on a failure so nothing has to be entered twice.
 *
 * **This is the thing that matters most on this form.** Losing a long entry on a phone on
 * bad signal is worse here than on the interest form by roughly the ratio of the two field
 * counts, and it is the difference between one more tap and giving up.
 */
export interface NnEntrySubmission {
  text: Record<string, string>;
  feeCode: string;
  medicalConsent: boolean;
  entryTerms: boolean;
  viGuide: boolean;
}

/** The keys echoed back as `value` attributes, and the one echoed as element content. */
const TEXT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'emailConfirm',
  'dobDay',
  'dobMonth',
  'dobYear',
  'genderIdentity',
  'club',
  'discountCode',
  'emergencyName',
  'emergencyPhone',
  'guideFirstName',
  'guideLastName',
  'guideDobDay',
  'guideDobMonth',
  'guideDobYear',
  'guideEmergencyName',
  'guideEmail',
  'guideEmergencyPhone',
] as const;

const TEXTAREA_FIELDS = ['medicalNotes', 'guideMedicalNotes'] as const;

function readString(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function readSubmission(form: FormData): NnEntrySubmission {
  const text: Record<string, string> = {};

  for (const field of [...TEXT_FIELDS, ...TEXTAREA_FIELDS, 'gender'] as const) {
    text[field] = readString(form, field);
  }

  return {
    text,
    feeCode: readString(form, 'feeCode'),
    // An unticked checkbox posts nothing at all, so absence is the answer "no".
    medicalConsent: form.get('medicalConsent') !== null,
    entryTerms: form.get('entryTerms') !== null,
    viGuide: form.get('viGuide') !== null,
  };
}

/** The statuses that re-render the form with a notice above it and everything preserved. */
export type NnEntryStoppedStatus =
  'not-taken' | 'sold-out' | 'failed' | 'free' | 'already-entered';

export type NnEntryOutcome =
  | { status: 'closed' }
  | { status: 'invalid'; errors: NnEntryErrors; submitted: NnEntrySubmission }
  | { status: NnEntryStoppedStatus; submitted: NnEntrySubmission }
  // **The discount code's confirm step.** Everything the person typed is intact and nothing
  // has been held; `priced` is what the database said the entry would cost. Answered 200
  // rather than 422, because nothing is wrong — see `nnEntryConfirmResponse`.
  | { status: 'confirm'; priced: PricedNnEntry; submitted: NnEntrySubmission }
  | { status: 'redirect'; url: string };

/**
 * Turn a refusal from `create_pending_purchase()` into an outcome.
 *
 * **Shared between the preview and the real call, because they must answer identically.** The
 * preview runs the same rules a moment earlier, so a person who is told "sold out" by one and
 * "something went wrong" by the other has been told two different things about one fact.
 */
function refusalOutcome(
  reason: PendingPurchaseReason,
  submitted: NnEntrySubmission,
): NnEntryOutcome {
  if (reason === 'sold_out') {
    return { status: 'sold-out', submitted };
  }

  if (reason === 'closed' || reason === 'no_such_event') {
    return { status: 'closed' };
  }

  // **Not a defect, and one of the two refusals on this path that are somebody's ordinary
  // mistake.** `create_pending_purchase()` refuses a runner who already holds a live place on
  // this event, keyed on name and date of birth — and since the guide rides on the same
  // entry, it refuses a guide who does too. It is deliberately *not* logged as an error: the
  // form is allowed to be filled in twice, and the database saying so is the rule working
  // rather than drift between the schema module and the tables.
  if (reason === 'already_entered') {
    return { status: 'already-entered', submitted };
  }

  // **The other ordinary mistake, and it was drift until there was a field to type it in.**
  // Before the discount code had a box on the form, any `invalid_discount` meant the Worker
  // had sent a code nobody could have entered, which is a defect. Now it means somebody
  // mistyped one, or the twenty-two are gone — so it is answered beside the field rather than
  // logged as a fault and turned into "your entry could not be completed".
  if (reason === 'invalid_discount') {
    return {
      status: 'invalid',
      errors: { discountCode: NN_ENTRY_DISCOUNT_REFUSED_MESSAGE },
      submitted,
    };
  }

  // Everything else — a fee the event is not offering, an entrant the tables refused, an age
  // below the minimum — is something `parseNnEntry` should already have caught. That it did
  // not means the schema module and the database have **drifted**, which is a defect rather
  // than a bad submission, so it is logged as one and answered honestly.
  console.error(`entries.create_pending_purchase refused — ${reason}`);
  return { status: 'failed', submitted };
}

/**
 * Validate one entry, hold a place for it, and send it to Stripe.
 *
 * The window is re-checked here rather than trusted from whenever the page was served:
 * somebody opens the page at 6:59 and presses the button at 7:01 on the last day, and that
 * is an ordinary sequence rather than an attack. **The database re-checks it again** inside
 * the same transaction that holds the place, because that is the one that cannot race.
 *
 * **Nothing about a valid entry is logged, ever.** `parsed.value` holds a name, a date of
 * birth, an emergency contact and possibly medical information, and an observability tool
 * that was never assessed to hold those is exactly where it must not end up. Every
 * `console.error` below carries a code, a status or a count and nothing else.
 */
export async function processNnEntry(
  form: FormData | null,
  env: NnEntryEnv,
  url: URL,
  viewer: NnEntryViewer | null = null,
): Promise<NnEntryOutcome> {
  // **The running is the address it was posted to**, and nothing else says which one it is.
  // There is no hidden event field on the form, deliberately: a slug in a body is a slug
  // somebody can change, and while `create_pending_purchase()` would refuse a closed or
  // unknown one, an entry landing against a *different open* running is a mistake nothing
  // would catch. The path is the request, and the request cannot lie about itself.
  const eventSlug = nnEventSlugForYearPath(url.pathname);

  if (eventSlug === null) {
    // Not a year page at all. `worker/index.ts` only routes year paths here, so this is
    // unreachable by any request the Worker accepts — stated rather than assumed, because the
    // alternative is a slug of `nn-null` reaching the database.
    return { status: 'closed' };
  }

  const view = await resolveNnEntryView(env, eventSlug, viewer);

  if (view.show !== 'entry') {
    // Nothing to preserve and nothing to say about fields: the form is not on offer. That
    // is the same answer whether entries have closed, have not opened, or the database
    // could not be reached — from here they are one fact.
    return { status: 'closed' };
  }

  if (form === null) {
    // Not a form at all. There is no input to give back, so the honest answer is the same
    // one an empty submission gets.
    const empty: NnEntrySubmission = {
      text: {},
      feeCode: '',
      medicalConsent: false,
      entryTerms: false,
      viGuide: false,
    };
    const parsed = parseNnEntry({}, entryRulesFrom(view.state));
    return {
      status: 'invalid',
      errors: parsed.ok ? {} : parsed.errors,
      submitted: empty,
    };
  }

  const submitted = readSubmission(form);
  const parsed = parseNnEntry(Object.fromEntries(form), entryRulesFrom(view.state));

  if (!parsed.ok) {
    return { status: 'invalid', errors: parsed.errors, submitted };
  }

  // **A free place cannot go through a payment page, and this stops before anything is
  // written.** A visually impaired runner's guide pays nothing, which is right — and Stripe
  // refuses the session outright: *"The Checkout Session's total amount due cannot be zero in
  // `payment` mode"*, confirmed against the test API rather than assumed. So this is not
  // caution about an edge case; it is the only alternative to holding a place that can never
  // be completed.
  //
  // Completing a free entry some other way would mean deciding here that an unpaid entry
  // counts as paid, and that decision is not this slice's to take: nothing in this repository
  // moves a purchase to `paid`.
  //
  // So the honest answer is to say plainly that a free place cannot be completed here yet
  // and give somebody the race address, rather than hold a place they can never finish. The
  // price is read from the same `entry_state()` answer the form was validated against, so it
  // is the database's number and not the form's.
  const chosenFee = view.state.fees.find((fee) => fee.code === parsed.value.feeCode);
  if (chosenFee !== undefined && chosenFee.pricePence === 0) {
    return { status: 'free', submitted };
  }

  // **Checked before a place is held, deliberately.** With no Stripe secret there is nothing
  // to send anybody to, and holding a place that can never be charged for would take a
  // number out of a 250-place race for half an hour. This is Slice A's answer word for word:
  // nothing has been stored and nothing has been charged.
  const stripe = stripeConfig(env);
  if (stripe === null) {
    return { status: 'not-taken', submitted };
  }

  // **The same client the view was resolved with.** A tester whose form was revealed by
  // `my_permissions()` and whose purchase then went through an anon client would be refused
  // by `create_pending_purchase()` with `closed` — the form on screen and the control behind
  // it disagreeing about who was asking, which is the worst shape this could take.
  const client = entriesClientFor(env, viewer);

  // --- the discount code's confirm step ------------------------------------------------------
  // **Somebody who typed a code is told what it took off before they are sent to a payment
  // page, not after.** Stripe's own page shows the total, but by then the place is held, the
  // use is spent and the only way to find out that the code did nothing is to read a number
  // and work backwards from it.
  //
  // So a submission carrying a code is priced first and nothing is held. `priceNnEntry` runs
  // every rule the real call runs and returns before the first write, so a refusal here is
  // exactly the refusal the real call would have given — which is what makes it safe to show
  // a total and then charge it.
  //
  // **The second submission carries `discountConfirmed` and skips this**, which is how the
  // step terminates. It is an ordinary hidden field rather than anything signed: the worst it
  // can do is skip a confirmation screen, and the price is still the database's on both
  // passes. Nothing is trusted from it.
  //
  // **A person who typed no code never sees this.** The step exists because a discount is a
  // claim about money that the form cannot verify; the standard price is on the page already.
  // **The confirmation is tied to the code it was given for, not to the fact that a
  // confirmation happened.** A bare "yes" would survive somebody reading the total, changing
  // the code in the form below it and pressing the button again — and that second submission
  // would skip the preview and hold a place priced by a code they had never been shown. The
  // step exists precisely so that no code is charged before it has been quoted.
  //
  // **Trimmed on the way in, because the field carries what was typed.** `parseNnEntry` trims
  // the code and this hidden input echoes the raw value, so `"  LHG-2026-…  "` would compare
  // unequal to itself on every pass and the confirm step would never end — the person would
  // press the button and be shown the same total for ever.
  const confirmedFor = form.get('discountConfirmed');
  const confirmedCode = typeof confirmedFor === 'string' ? confirmedFor.trim() : '';

  if (parsed.value.discountCode !== null && confirmedCode !== parsed.value.discountCode) {
    const priced = await priceNnEntry(client, { slug: eventSlug, entry: parsed.value });

    if (priced.status === 'refused') {
      return refusalOutcome(priced.reason, submitted);
    }

    if (priced.status === 'priced') {
      return { status: 'confirm', priced: priced.priced, submitted };
    }

    // `unavailable` falls through to the ordinary one-step path. **Nothing was written** — a
    // preview that could not be taken is a question that was not asked — and the call below
    // will produce its own honest outcome rather than this becoming a second failure mode
    // that only appears when somebody has a code.
    console.error(
      `entries.create_pending_purchase preview unavailable — ${priced.error}`,
    );
  }

  const outcome = await createNnPendingPurchase(client, {
    slug: eventSlug,
    entry: parsed.value,
  });

  if (outcome.status === 'unavailable') {
    // The migration has not landed, or Postgres could not be reached. **Nothing was
    // written**, and the person is told so with their input intact.
    console.error(`entries.create_pending_purchase unavailable — ${outcome.error}`);
    return { status: 'failed', submitted };
  }

  if (outcome.status === 'refused') {
    return refusalOutcome(outcome.reason, submitted);
  }

  const { purchase } = outcome;

  // The backstop for the free case above: a hundred-per-cent discount code would zero a fee
  // that is not itself free, and it would only be visible here. A place is held by this
  // point and it lapses on its own.
  if (purchase.amountPence === 0) {
    console.error('entries.create_pending_purchase priced an entry at zero');
    return { status: 'free', submitted };
  }

  // **Both Stripe URLs are under the running this entry is for**, built from the event rather
  // than from a constant. Somebody who backs out of the payment page lands back on the form
  // they were filling in — not on the race page, where they would have to find their way to it
  // again — and somebody who pays lands on that running's own return page.
  //
  // Round-tripped through the slug rather than reused from `url.pathname`, so a POST to
  // `/nn/2026` without the trailing slash still produces the canonical `/nn/2026/`. Stripe is
  // handed these once and cannot be corrected afterwards; a redirect in the middle of a
  // payment is latency somebody pays for at the worst moment. Non-null by construction —
  // `eventSlug` came out of `nnEventSlugForYearPath` a few lines up.
  const yearPath = nnYearPathForEventSlug(eventSlug) ?? `${NN_PREFIX}/`;

  const session = await createCheckoutSession(stripe, {
    purchaseId: purchase.purchaseId,
    eventSlug,
    amountPence: purchase.amountPence,
    description: `${view.state.displayName} — ${purchase.feeLabel} entry`,
    purchaserEmail: parsed.value.email,
    successUrl: entryCompleteUrl(url.origin, nnEntryCompletePath(yearPath)),
    cancelUrl: new URL(yearPath, url.origin).toString(),
    expiresAt: purchase.holdExpiresAt,
  });

  if (!session.ok) {
    // A place is held and there is nowhere to send anybody. It lapses in thirty-one minutes
    // and the capacity count already ignores a lapsed hold, so there is nothing to undo —
    // and nothing has been charged, which is what the notice says.
    console.error(`Stripe checkout session failed — ${session.error}`);
    return { status: 'failed', submitted };
  }

  // **Best effort, and never a reason to fail a payment.** Slice C's webhook finds the
  // purchase by `client_reference_id`, which is already set; this column is for
  // reconciliation. Sending somebody back to a form because a bookkeeping write missed would
  // be the wrong trade by a wide margin.
  if (!(await attachCheckoutSession(client, purchase.purchaseId, session.sessionId))) {
    console.error('entries.attach_checkout_session did not attach a session id');
  }

  return { status: 'redirect', url: session.url };
}

// -----------------------------------------------------------------------------------------
// Painting the page
// -----------------------------------------------------------------------------------------
// Every handler below writes through `setAttribute` or `setInnerContent` in its **default
// text mode**, both of which escape. Nothing calls `setInnerContent(..., { html: true })`,
// and nothing should: a first name of `"><script>` posted through this form must come back
// as characters on the page rather than as markup, and the only reliable way to guarantee
// that is for there to be no html-mode call to audit in the first place.

/** Reveals an element that ships `hidden`, optionally taking focus. */
class RevealHandler {
  constructor(private readonly focus: boolean = false) {}

  element(element: Element): void {
    element.removeAttribute('hidden');

    // **`autofocus` is how focus moves with JavaScript disabled.** The element carries
    // `tabindex="-1"` in the markup so it can hold focus without becoming a tab stop.
    if (this.focus) {
      element.setAttribute('autofocus', '');
    }
  }
}

/** Hides an element that ships visible. */
class HideHandler {
  element(element: Element): void {
    element.setAttribute('hidden', '');
  }
}

/**
 * Puts escaped text into an element, and reveals it if it was hidden.
 *
 * **The field is `content` and it must not be called `text`.** `HTMLRewriter.on()` takes an
 * object and reads `element`, `text` and `comments` off it as handler functions, so a
 * constructor parameter property named `text` is handed to the runtime as a text-chunk
 * handler that happens to be a string — `Incorrect type for the 'text' field on
 * 'ElementContentHandlers'`, thrown at the point the handler is registered rather than
 * where the name was chosen. Cost an hour the first time; the same trap is waiting for any
 * handler class here that grows a field called `element` or `comments`.
 */
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
 * A textarea holds its value as content rather than as an attribute, so this is the one
 * field returned by `setInnerContent` — in text mode, which escapes.
 */
class TextareaHandler {
  constructor(
    private readonly value: string,
    private readonly invalid: boolean,
  ) {}

  element(element: Element): void {
    element.setInnerContent(this.value);

    if (this.invalid) {
      element.setAttribute('aria-invalid', 'true');
    }
  }
}

/** A radio or a checkbox, which is checked or not rather than valued. */
class CheckedHandler {
  constructor(
    private readonly checked: boolean,
    private readonly invalid: boolean = false,
  ) {}

  element(element: Element): void {
    if (this.checked) {
      element.setAttribute('checked', '');
    }

    if (this.invalid) {
      element.setAttribute('aria-invalid', 'true');
    }
  }
}

/**
 * The one fee radio that was chosen, whichever code it is.
 *
 * **This replaced a loop over `['affiliated', 'unaffiliated', 'vi_guide']`, and that literal
 * was a real defect rather than an untidiness.** #107 added a fourth code, `tester`, and it was
 * not in the list — so a tester whose submission came back to them re-rendered (invalid,
 * sold-out, no Stripe key, any of them) lost the entry type they had chosen, on a page that
 * says in as many words *"Nothing you typed has been lost"*.
 *
 * Reading the code off the element's own attribute means the fee list is the database's, here
 * as everywhere else on this form: `entries.fees` decides which cards exist, which are revealed
 * and what they cost, and now which one comes back checked. **A fifth fee code needs no edit to
 * this file at all**, which is the property the hardcoded version quietly did not have.
 */
class FeeCheckedHandler {
  constructor(
    private readonly chosen: string,
    private readonly invalid: boolean,
  ) {}

  element(element: Element): void {
    // `feeCode:unaffiliated` — the half after the colon is the code. Read rather than
    // matched against a list, so this cannot go stale.
    const marker = element.getAttribute('data-entry-checked') ?? '';
    const code = marker.startsWith('feeCode:') ? marker.slice('feeCode:'.length) : '';

    if (code !== '' && code === this.chosen) {
      element.setAttribute('checked', '');
    }

    if (this.invalid) {
      element.setAttribute('aria-invalid', 'true');
    }
  }
}

/** The one `<option>` that was chosen. */
class SelectedHandler {
  constructor(private readonly selected: boolean) {}

  element(element: Element): void {
    if (this.selected) {
      element.setAttribute('selected', '');
    }
  }
}

/** Copies one attribute onto an element. Escaped, like everything else here. */
class AttributeHandler {
  constructor(
    private readonly name: string,
    private readonly value: string,
  ) {}

  element(element: Element): void {
    element.setAttribute(this.name, this.value);
  }
}

/** Points the hero's primary button at whichever thing the page can actually offer. */
class CtaHandler {
  constructor(
    private readonly href: string,
    private readonly label: string,
  ) {}

  element(element: Element): void {
    element.setAttribute('href', this.href);
    element.setInnerContent(this.label);
  }
}

/**
 * Paint `/nn/` — the race page — with where this year's running is, and whether it is taking
 * entries.
 *
 * **Every link to a year page on this page is painted here and nowhere else.** That is the
 * whole reason this function exists: a `href="/nn/2026/"` written into the markup would put
 * the year back into a page whose entire point is not to have one, and it would be the line
 * somebody forgot in 2027.
 *
 * **`{ running: null }` does nothing at all**, which is the correct rendering of "the database
 * could not be reached". The interest form ships visible, so a page that cannot find out which
 * running is on is the page that was there before this slice: no year link, no claim about
 * entries, and byte-identical HTML on the common closed path and every failure path.
 */
export function renderNnRaceView(rewriter: HTMLRewriter, view: NnRaceView): HTMLRewriter {
  if (view.running === null) {
    return rewriter;
  }

  const { year, yearPath, state, date, startTime, fees, previous } = view.running;

  // **The panel is revealed in every window state, and its shape does not change between
  // them.** Somebody wants the date whether or not they can enter today, and a layout that
  // rearranged itself the morning entries opened would ask everybody to relearn the page at
  // the one moment they are trying to do something.
  rewriter
    .on('[data-nn-panel]', new RevealHandler())
    .on('[data-nn-panel-date]', new TextHandler(date))
    .on('[data-nn-panel-time]', new TextHandler(startTime))
    .on('[data-nn-panel-link="year"]', new AttributeHandler('href', yearPath))
    .on(
      '[data-nn-panel-link="race-day"]',
      new AttributeHandler('href', `${yearPath}race-day/`),
    )
    .on(
      '[data-nn-panel-link="spectators"]',
      new AttributeHandler('href', `${yearPath}spectators/`),
    );

  if (state === 'open') {
    // **The difference in prominence is the message**: the action goes from an outline to the
    // filled button, and the fee line appears under it. No badge and no banner saying "open" —
    // the button already says it, and a page that said it twice would be shouting.
    //
    // **Nothing hides an interest form here any more.** Both forms are on the running; this
    // page links to them and carries neither.
    rewriter
      .on('[data-nn-panel-shut]', new HideHandler())
      .on('[data-nn-panel-open]', new RevealHandler())
      .on('[data-nn-panel-fees]', new TextHandler(feeLine(fees)))
      .on(
        '[data-nn-panel-action]',
        new PanelActionHandler(`${yearPath}#enter`, year, true),
      );
  } else {
    rewriter.on('[data-nn-panel-action]', new PanelActionHandler(yearPath, year, false));
  }

  return renderNnPreviousYears(rewriter, previous);
}

/**
 * The fee line, and it is the database's numbers or nothing.
 *
 * `entry_state()` returns the fees the event is actually offering, dearest first. **A free
 * place is left out**: "Free" beside two prices reads as an offer anybody can take, and a
 * guide's place is not — the form says what it is at the moment somebody chooses it.
 */
export function feeLine(fees: EntryFee[]): string {
  return fees
    .filter((fee) => fee.pricePence > 0)
    .map((fee) => `${formatPence(fee.pricePence)} ${fee.label.toLowerCase()}`)
    .join(' · ');
}

/**
 * The panel's one action, in its two weights.
 *
 * **One control, not two.** A second button revealed beside a hidden one is two things to keep
 * in step and two places for a label to go stale; this is the same anchor with a different
 * class, a different destination and a different label.
 *
 * The label names the year, because this control is the one thing on the page that says which
 * running it is sending somebody to — the panel's own heading is "The next race", which is true
 * and vague, and a button should be neither vague nor a surprise.
 */
class PanelActionHandler {
  constructor(
    private readonly href: string,
    private readonly year: string,
    private readonly open: boolean,
  ) {}

  element(element: Element): void {
    element.setAttribute('href', this.href);
    element.setAttribute('class', this.open ? 'nn-cta' : 'nn-ghost');
    element.setInnerContent(this.open ? 'Enter the race' : `The ${this.year} race`);
  }
}

/**
 * The row of past runnings, and **the only reason it never appears is that nothing fills it.**
 *
 * The pills ship in the markup with empty labels and `href=""`, exactly as the three fee cards
 * do — because the alternative is assembling markup from data with
 * `setInnerContent(..., { html: true })`, and there is deliberately no such call anywhere in
 * this repository to audit. This fills as many as it was given and reveals the container only
 * if that is more than none.
 *
 * **Empty renders nothing at all** — no heading, no container, no empty list — which is what a
 * site with a single running needs. `nn-previous-years.test.ts` proves both directions against
 * a fabricated list, because proving the populated one against real data would mean seeding a
 * running that has already happened.
 */
export function renderNnPreviousYears(
  rewriter: HTMLRewriter,
  previous: NnPastRunning[],
): HTMLRewriter {
  if (previous.length === 0) {
    return rewriter;
  }

  rewriter.on('[data-nn-previous]', new RevealHandler());

  for (const [index, { year, yearPath }] of previous
    .slice(0, NN_PREVIOUS_SLOTS)
    .entries()) {
    rewriter
      .on(`[data-nn-previous-item="${index}"]`, new RevealHandler())
      .on(`[data-nn-previous-item="${index}"]`, new AttributeHandler('href', yearPath))
      .on(`[data-nn-previous-item="${index}"]`, new TextHandler(year));
  }

  return rewriter;
}

/**
 * How many past runnings the markup has room for.
 *
 * **A fixed number because the pills are markup rather than generated.** A fifth would need one
 * more `<a>` in `NnPreviousYears.astro`, which is a deploy — the same trade the three fee cards
 * make for the same reason. `nn-previous-years.test.ts` asserts the component agrees with this.
 */
export const NN_PREVIOUS_SLOTS = 4;

/**
 * The navigation bar, on every page that carries it.
 *
 * **Two links and a button, and none of them may name a year in `dist/`.** They ship hidden
 * with `href=""`; this is the only thing that fills them in, on every Nightingale Nightmare
 * page rather than only on `/nn/`, because the bar is the same bar everywhere.
 *
 * The label is the honest one for the window: an "Enter" that does not let you enter is a
 * small dishonesty on a site that is about to ask for money.
 */
export function renderNnNav(rewriter: HTMLRewriter, view: NnRaceView): HTMLRewriter {
  if (view.running === null) {
    // Two evergreen links and nothing else. Fewer doors, and never a door into a year nobody
    // confirmed — the same direction every other failure here takes.
    return rewriter;
  }

  const { yearPath, state } = view.running;
  const { long, short } = NAV_LABELS[state];

  return rewriter
    .on('[data-nn-nav-item="race-day"]', new RevealHandler())
    .on(
      '[data-nn-nav-link="race-day"]',
      new AttributeHandler('href', `${yearPath}race-day/`),
    )
    .on('[data-nn-nav-item="spectators"]', new RevealHandler())
    .on(
      '[data-nn-nav-link="spectators"]',
      new AttributeHandler('href', `${yearPath}spectators/`),
    )
    .on('[data-nn-nav-cta]', new RevealHandler())
    .on('[data-nn-nav-cta]', new AttributeHandler('href', yearPath))
    .on('[data-nn-nav-cta]', new AttributeHandler('aria-label', long))
    .on('[data-nn-nav-cta-long]', new TextHandler(long))
    .on('[data-nn-nav-cta-short]', new TextHandler(short));
}

/**
 * What the button says, per window state.
 *
 * **Each short label is a substring of its long one**, which is WCAG 2.5.3: what somebody says
 * out loud has to appear in what the machine reads, and the accessible name is the long one at
 * every width.
 *
 * `pre_open` says "Register interest" because that is exactly what the destination offers —
 * the interest form is on the year page. `closed` promises neither, because neither is on
 * offer, and the page it goes to says entries have closed.
 */
const NAV_LABELS: Record<EntryWindowState, { long: string; short: string }> = {
  open: { long: 'Enter the race', short: 'Enter' },
  pre_open: { long: 'Register interest', short: 'Interest' },
  closed: { long: 'Race details', short: 'Details' },
};

/**
 * Reveal whichever of the year page's two states applies, and fill in what only the database
 * knows.
 *
 * **The interest form ships visible and the entry form ships hidden**, which is the safe
 * default rather than an arbitrary one: a page that cannot tell whether entries are open must
 * not offer to take one, and the form that takes no money is the one to fall back to.
 *
 * **The `closed` case reveals no form — but it does now fill in the entry fee**, and that
 * distinction is what the reasoning above was always about. Revealing a form is offering to
 * take money; stating a price is not. The fee is a fact about the race, published in the facts
 * list months before anybody can pay it, and leaving it as "To be confirmed" once the committee
 * has settled a number is the page being wrong rather than being careful.
 *
 * So the old property is narrower now: **the shut page and the database-unreachable page are
 * byte-identical apart from that one cell.** An unreachable database yields no fees and the
 * cell falls back to "To be confirmed", so the direction still fails towards claiming less.
 */
export function renderNnEntryView(
  rewriter: HTMLRewriter,
  view: NnEntryView,
): HTMLRewriter {
  // **Before the early return, because the fee is not part of the form.** Both states publish
  // it, and the shut state is the one the public sees until 1 September — which is exactly the
  // window in which somebody is deciding whether the race is worth entering.
  //
  // `feeLine` drops the £0 guide's place for the reason given at its definition, so an event
  // whose only fee is free yields an empty string and the cell keeps saying "To be confirmed"
  // rather than going blank. Guarded on the line rather than on the array for that reason.
  const fees = view.show === 'entry' ? view.state.fees : view.fees;
  const fee = feeLine(fees);

  if (fee !== '') {
    rewriter.on('[data-nn-fee]', new TextHandler(fee));
  }

  if (view.show !== 'entry') {
    return rewriter;
  }

  const { state } = view;

  rewriter
    .on('[data-nn-interest]', new HideHandler())
    .on('[data-nn-entry]', new RevealHandler())
    .on('[data-nn-cta]', new CtaHandler('#enter', 'Enter the race'));

  // **Only when the form is on offer *because of who is asking*.** `early` is false the
  // moment entries genuinely open, for a tester as much as for anybody, so this notice
  // cannot outlive the situation it describes — there is no second place to remember to
  // turn it off.
  if (view.early) {
    rewriter.on('[data-nn-entry-early]', new RevealHandler());
  }

  // **Independent of `early`.** A tester with a place and a runner with a place both need
  // telling, and after 1 September only the second exists.
  if (view.entered) {
    rewriter.on('[data-nn-entry-entered]', new RevealHandler());
  }

  // The two rules the browser-side enhancement cannot read off the DOM. Neither is personal
  // data and neither is a secret — the race date is on this page already, and an empty
  // minimum age is the honest rendering of "none has been confirmed".
  rewriter
    .on(
      '[data-entry-form]',
      new AttributeHandler('data-entry-event-date', toIsoDate(state.eventDate)),
    )
    .on(
      '[data-entry-form]',
      new AttributeHandler(
        'data-entry-minimum-age',
        state.minimumAge === null ? '' : String(state.minimumAge),
      ),
    );

  // **Only the fees the event is offering.** Each card ships hidden with an empty label and
  // an empty price; a code with no matching fee row is simply never revealed, so withdrawing
  // one is a row edit rather than a deploy. The price exists in exactly one place —
  // `entries.fees.price_pence` — and this is where it reaches a page.
  for (const fee of state.fees) {
    rewriter
      .on(`[data-entry-fee="${fee.code}"]`, new RevealHandler())
      .on(
        `[data-entry-fee="${fee.code}"]`,
        new AttributeHandler('data-entry-fee-pence', String(fee.pricePence)),
      )
      .on(`[data-entry-fee-label="${fee.code}"]`, new TextHandler(fee.label))
      .on(
        `[data-entry-fee-price="${fee.code}"]`,
        new TextHandler(formatPence(fee.pricePence)),
      );
  }

  // **Nothing conditional on the fee is painted any more.** The England Athletics box was
  // revealed here, from `entries.fees.requires_ea_number`; the club stopped asking for the
  // number on 29 August 2026 and the box is off the page. The fee cards above are still
  // painted from the event row, which is the part that was never about the number.

  return rewriter;
}

/**
 * Rewrites `/nn/` to show a rejected entry: an error summary that takes focus, a message
 * against each offending field, and every box still holding what was typed.
 */
export function renderNnEntryErrors(
  rewriter: HTMLRewriter,
  outcome: Extract<NnEntryOutcome, { status: 'invalid' }>,
): HTMLRewriter {
  const { errors } = outcome;

  rewriter.on('[data-entry-summary]', new RevealHandler(true));

  restoreSubmission(rewriter, outcome.submitted, errors);

  // Walked in `NN_ENTRY_FIELDS` order so the summary reads down the page rather than in
  // whatever order the validator happened to find things.
  for (const field of NN_ENTRY_FIELDS) {
    const message = errors[field];
    if (message === undefined) {
      continue;
    }

    rewriter
      .on(`[data-entry-error="${field}"]`, new TextHandler(message, true))
      .on(`[data-entry-summary-item="${field}"]`, new RevealHandler())
      .on(`[data-entry-summary-link="${field}"]`, new TextHandler(message));
  }

  return rewriter;
}

/**
 * Which notice each stopped outcome reveals.
 *
 * **Five separate notices rather than one with five wordings**, because the difference
 * between them is exactly what somebody needs: "the race is full" and "we could not reach
 * the payment page" ask for completely different things next. Each is written out in the
 * markup so there is one copy of the page in `dist/` and no template in the Worker to drift
 * from it, and each says in words what it is — the colour carries none of the meaning.
 */
const STOPPED_NOTICES: Record<NnEntryStoppedStatus, string> = {
  'not-taken': '[data-entry-unavailable]',
  'sold-out': '[data-entry-soldout]',
  failed: '[data-entry-failed]',
  free: '[data-entry-free]',
  'already-entered': '[data-entry-already]',
};

/**
 * Rewrites the year page to say why the entry stopped, keeping everything typed.
 *
 * The preservation is not a courtesy here. **Sold out is the case where losing it hurts
 * most** — somebody has filled in fourteen fields and been told the race went while they
 * were typing, and asking them to do it again to enquire about a waiting list is how a form
 * turns a disappointment into a grievance.
 */
export function renderNnEntryStopped(
  rewriter: HTMLRewriter,
  outcome: Extract<NnEntryOutcome, { status: NnEntryStoppedStatus }>,
): HTMLRewriter {
  rewriter.on(STOPPED_NOTICES[outcome.status], new RevealHandler(true));
  restoreSubmission(rewriter, outcome.submitted, {});
  return rewriter;
}

/**
 * Rewrites the year page to say entries are not open. There is nothing to restore — see below.
 */
export function renderNnEntryClosed(rewriter: HTMLRewriter): HTMLRewriter {
  // The notice lives inside `[data-nn-entry]`, which stays hidden in this state because
  // `renderNnEntryView` never revealed it. So this reveals the section too — somebody who
  // pressed a button deserves to be told what happened rather than to be handed a page that
  // looks as though nothing did.
  return rewriter
    .on('[data-nn-interest]', new HideHandler())
    .on('[data-nn-entry]', new RevealHandler())
    .on('[data-entry-closed]', new RevealHandler(true));
}

/**
 * Puts every typed value back where it came from.
 *
 * `aria-invalid` goes on only the fields that actually have a message against them, which
 * is why the errors map is threaded through here rather than applied separately.
 */
function restoreSubmission(
  rewriter: HTMLRewriter,
  submitted: NnEntrySubmission,
  errors: NnEntryErrors,
): void {
  const invalid = (field: NnEntryField): boolean => errors[field] !== undefined;

  for (const field of TEXT_FIELDS) {
    // The three date-of-birth boxes share one message, which belongs to the group. All
    // three are marked so the outline appears on the question rather than on one third of it.
    const marked =
      field === 'dobDay' || field === 'dobMonth' || field === 'dobYear'
        ? invalid('dateOfBirth')
        : invalid(field as NnEntryField);

    rewriter.on(
      `[data-entry-value="${field}"]`,
      new ValueHandler(submitted.text[field] ?? '', marked),
    );
  }

  for (const field of TEXTAREA_FIELDS) {
    rewriter.on(
      `[data-entry-text="${field}"]`,
      new TextareaHandler(submitted.text[field] ?? '', invalid(field)),
    );
  }

  // The `<select>`: the chosen `<option>` gets `selected`, and the select itself is marked.
  //
  // **One again, not two.** The guide had a race category until ADR-022's amendment, and it
  // was removed because a guide is in no category — so asking which one they would be in was
  // collecting an answer nothing could use. Their email took its place, and an email is a text
  // input restored by the loop above.
  for (const select of ['gender'] as const) {
    const chosen = submitted.text[select] ?? '';
    for (const option of ['', 'female', 'male', 'non_binary']) {
      rewriter.on(
        `[data-entry-selected="${select}:${option}"]`,
        new SelectedHandler(option === chosen),
      );
    }
  }

  // **Every fee radio, matched by prefix rather than by a list of codes.** See
  // `FeeCheckedHandler` for what the list used to cost.
  rewriter.on(
    '[data-entry-checked^="feeCode:"]',
    new FeeCheckedHandler(submitted.feeCode, invalid('feeCode')),
  );

  rewriter
    .on(
      '[data-entry-checked="medicalConsent"]',
      new CheckedHandler(submitted.medicalConsent, invalid('medicalConsent')),
    )
    .on(
      '[data-entry-checked="entryTerms"]',
      new CheckedHandler(submitted.entryTerms, invalid('entryTerms')),
    )
    // **Restored like any other checkbox, and it has to be.** It is what reveals the guide's
    // six fields with scripting on and what decides whether they were required with scripting
    // off — a submission that came back with the box cleared would silently discard a guide
    // somebody had already entered, and the entry would go through one place short.
    .on(
      '[data-entry-checked="viGuide"]',
      new CheckedHandler(submitted.viGuide, invalid('viGuide')),
    );
}

/**
 * Rewrites the year page to ask somebody to confirm a discounted total.
 *
 * **Answered 200, not 422.** Nothing is wrong with the submission — it is valid, it has been
 * priced, and the person is being shown the number before it is charged. `renderNnEntryErrors`
 * is the 422 path and this deliberately is not it.
 *
 * Everything typed is restored underneath, so somebody who reads the total and wants to
 * change their entry type has a filled-in form to change rather than an empty one.
 */
export function renderNnEntryConfirm(
  rewriter: HTMLRewriter,
  outcome: Extract<NnEntryOutcome, { status: 'confirm' }>,
): HTMLRewriter {
  const { priced } = outcome;
  const savingPence = priced.listPricePence - priced.amountPence;

  rewriter
    .on('[data-entry-confirm]', new RevealHandler(true))
    .on('[data-entry-confirm-fee]', new TextHandler(priced.feeLabel))
    .on('[data-entry-confirm-list]', new TextHandler(formatPence(priced.listPricePence)))
    .on('[data-entry-confirm-saving]', new TextHandler(formatPence(savingPence)))
    .on('[data-entry-confirm-total]', new TextHandler(formatPence(priced.amountPence)));

  // **The hidden field that ends the step.** Written here rather than shipped in the markup,
  // so a page served without a code cannot post it — the second submission is the only one
  // that carries it, and it is the only one that skips the preview.
  // **The hidden field that ends the step, and it carries the code rather than a flag.**
  // Written here rather than shipped in the markup, so a page served without a code cannot
  // post it — and written as the code itself, so it confirms *this* code rather than merely
  // recording that some confirmation once happened. Change the code and press the button
  // again and it is priced again, which is the whole point of the step.
  //
  // Nothing is trusted from it: the price is still `entries.fees`' on both passes and the
  // code is still checked against the database on both. The worst it can do is skip a screen.
  rewriter.on(
    '[data-entry-confirmed]',
    new AttributeHandler('value', outcome.submitted.text.discountCode ?? ''),
  );

  restoreSubmission(rewriter, outcome.submitted, {});
  return rewriter;
}
