import { createAnonClient, parseNnSignup, type NnSignupErrors } from '@src/shared';

/**
 * The sign-up form's POST half.
 *
 * ## Why this is a Worker route and not a framework endpoint
 *
 * Astro is `output: 'static'`, so `dist/` is HTML and nothing in it can accept a POST. The
 * static-assets binding will not serve one either — which is *why* `run_worker_first` is
 * set: this handler has to see the request before the binding gets a chance to refuse it.
 *
 * ## Why the response is a rewritten static page
 *
 * The same technique the health timestamp already uses. There is one copy of the page, in
 * `dist/`, and both the success acknowledgement and the field-level errors are painted onto
 * it by `HTMLRewriter` while it is served. No template is duplicated in the Worker, so the
 * form cannot drift from the page it lives on.
 *
 * **All of it works with JavaScript disabled**, which is the primary path rather than a
 * fallback: a real `<form method="post">`, a real 303, and errors rendered server-side.
 *
 * ## The three outcomes
 *
 *   `accepted`    — 303 to `/nn/?signup=ok`. POST/Redirect/GET, so a refresh does not
 *                   re-post. **A duplicate address is also `accepted`** — see below.
 *   `invalid`     — 422, the page re-rendered with messages attached to their fields and
 *                   **everything the person typed still in the boxes.** Losing that on a
 *                   phone on bad signal is the failure that actually matters here.
 *   `unavailable` — 503, the same page, the same preserved input, and an honest "we could
 *                   not save this". See the deploy-ordering note at the bottom.
 */

/** Only the two variables that already exist. A third should never be needed here. */
export interface NnSignupEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * What the person typed, exactly as they typed it — untrimmed, unvalidated, and echoed back
 * into the form on a failure so nothing has to be entered twice.
 */
export interface NnSignupSubmission {
  name: string;
  email: string;
  consent: boolean;
}

export type NnSignupOutcome =
  | { status: 'accepted' }
  | { status: 'invalid'; errors: NnSignupErrors; submitted: NnSignupSubmission }
  | { status: 'unavailable'; submitted: NnSignupSubmission };

/** Where a successful submission is sent. The trailing slash is Astro's canonical form. */
export const NN_SIGNUP_SUCCESS_PATH = '/nn/?signup=ok';

/** What `/nn/` is asked for in its query string to render the acknowledgement. */
export const NN_SIGNUP_SUCCESS_QUERY = 'signup';
const NN_SIGNUP_SUCCESS_VALUE = 'ok';

export function isNnSignupSuccess(url: URL): boolean {
  return url.searchParams.get(NN_SIGNUP_SUCCESS_QUERY) === NN_SIGNUP_SUCCESS_VALUE;
}

/**
 * Validate one submission and, if it is good, record it.
 *
 * Never throws: every failure it can meet is one of the three outcomes, because a form is
 * one of the few places where "the database is down" has a sensible answer that is not a
 * 500.
 */
export async function processNnSignup(
  form: FormData | null,
  env: NnSignupEnv,
): Promise<NnSignupOutcome> {
  // **The body is read once, by the caller.** `/nn/` now carries two forms and the router
  // has to look at the `form` field to know which one arrived, so parsing here as well
  // would mean reading the same request twice. `null` is what the caller passes when the
  // body was not a form at all — a JSON body, or nothing. There is no input to preserve and
  // nothing to say about individual fields, so it is rejected the same way an empty
  // submission is. That is a bot or a mistake, not somebody filling the form in.
  if (form === null) {
    return {
      status: 'invalid',
      errors: emptySubmissionErrors(),
      submitted: { name: '', email: '', consent: false },
    };
  }

  const submitted: NnSignupSubmission = {
    name: readString(form, 'name'),
    email: readString(form, 'email'),
    // An unticked checkbox posts nothing at all, so absence is the answer "no".
    consent: form.get('consent') !== null,
  };

  const parsed = parseNnSignup(Object.fromEntries(form));

  if (!parsed.ok) {
    return { status: 'invalid', errors: parsed.errors, submitted };
  }

  try {
    const client = createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    });

    // **No `.select()` chained on purpose.** `anon` holds an insert grant and nothing else,
    // so asking for the row back would fail with `42501` and turn every successful sign-up
    // into an error. The row is not needed: nothing here reads it, and not being able to
    // read it is the point.
    // `parsed.value.consent` rather than a literal `true`, even though the schema currently
    // guarantees it is `true`. If the committee reverses that decision, `z.literal(true)`
    // becomes `z.boolean()` and a hard-coded `true` here would quietly record consent that
    // was never given — the one bug in this file that would be a data-protection incident
    // rather than an outage.
    const { error } = await client.schema('intake').from('nn_interest').insert({
      name: parsed.value.name,
      email: parsed.value.email,
      consent: parsed.value.consent,
    });

    if (!error) {
      return { status: 'accepted' };
    }

    // **A duplicate reads as success.** `23505` from the unique index on `lower(email)`
    // means this address is already on the list — the person did the right thing twice, and
    // the outcome they wanted is already true. Saying "you are already signed up" would
    // disclose membership of the list to anyone who can type an address into a form, which
    // is a disclosure the club has no business making.
    if (error.code === '23505') {
      return { status: 'accepted' };
    }

    // **The code only. Never the message.** Postgres puts the offending row into the detail
    // of some constraint violations, so logging `error.message` is how a name and an email
    // address end up in an observability tool that was never assessed to hold them.
    console.error(`intake.nn_interest insert failed — ${error.code}`);
    return { status: 'unavailable', submitted };
  } catch (cause) {
    // A network failure, or `createAnonClient` refusing a key that looks like a service
    // role key. Neither can carry personal data, but neither is worth a 500 either.
    console.error(
      `intake.nn_interest insert threw — ${cause instanceof Error ? cause.name : 'unknown'}`,
    );
    return { status: 'unavailable', submitted };
  }
}

function readString(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

function emptySubmissionErrors(): NnSignupErrors {
  const parsed = parseNnSignup({});
  return parsed.ok ? {} : parsed.errors;
}

// -----------------------------------------------------------------------------------------
// Painting the outcome onto the page
// -----------------------------------------------------------------------------------------
// Every handler below writes through `setAttribute` or `setInnerContent` in its **default
// text mode**, both of which escape. Nothing calls `setInnerContent(..., { html: true })`,
// and nothing should: a name of `"><script>` posted through this form must come back as
// characters on the page rather than as markup, and the only reliable way to guarantee that
// is for there to be no html-mode call to audit in the first place.

/** Reveals an element that ships `hidden`, and puts focus on it. */
class RevealHandler {
  constructor(private readonly focus: boolean) {}

  element(element: Element): void {
    element.removeAttribute('hidden');

    // **`autofocus` is how focus moves with JavaScript disabled.** The element carries
    // `tabindex="-1"` in the markup so it can hold focus without becoming a tab stop, and
    // the browser does the rest on load. Somebody who has just had a submission rejected
    // lands on the reason for it rather than at the top of a page that looks unchanged.
    if (this.focus) {
      element.setAttribute('autofocus', '');
    }
  }
}

/** Puts a message into an element and reveals it. Text mode, so the message is escaped. */
class MessageHandler {
  constructor(private readonly message: string) {}

  element(element: Element): void {
    element.setInnerContent(this.message);
    element.removeAttribute('hidden');
  }
}

/** Puts one message into the error summary's list. */
class SummaryLinkHandler {
  constructor(private readonly message: string) {}

  element(element: Element): void {
    element.setInnerContent(this.message);
  }
}

/**
 * Returns a person's own input to the box they typed it into, and marks the box invalid.
 *
 * `setAttribute` escapes, which is the whole defence: `"><script>alert(1)</script>` is a
 * perfectly legal thing to be called as far as this form is concerned, and it has to come
 * back as a value rather than as a tag.
 */
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

/** The consent box, which is checked or not rather than valued. */
class CheckedHandler {
  constructor(
    private readonly checked: boolean,
    private readonly invalid: boolean,
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
 * Rewrites `/nn/` to show a rejected submission: an error summary that takes focus, a
 * message against each offending field, and every box still holding what was typed.
 */
export function renderNnSignupErrors(
  rewriter: HTMLRewriter,
  outcome: Extract<NnSignupOutcome, { status: 'invalid' }>,
): HTMLRewriter {
  const { errors, submitted } = outcome;

  rewriter
    .on('[data-signup-summary]', new RevealHandler(true))
    .on('[data-signup-value="name"]', new ValueHandler(submitted.name, !!errors.name))
    .on('[data-signup-value="email"]', new ValueHandler(submitted.email, !!errors.email))
    .on(
      '[data-signup-value="consent"]',
      new CheckedHandler(submitted.consent, !!errors.consent),
    );

  for (const field of ['name', 'email', 'consent'] as const) {
    const message = errors[field];
    if (message === undefined) {
      continue;
    }

    rewriter
      .on(`[data-signup-error="${field}"]`, new MessageHandler(message))
      .on(`[data-signup-summary-item="${field}"]`, new RevealHandler(false))
      .on(`[data-signup-summary-link="${field}"]`, new SummaryLinkHandler(message));
  }

  return rewriter;
}

/**
 * Rewrites `/nn/` to say the submission could not be saved, keeping the input so it can be
 * sent again with one press rather than typed again.
 */
export function renderNnSignupUnavailable(
  rewriter: HTMLRewriter,
  outcome: Extract<NnSignupOutcome, { status: 'unavailable' }>,
): HTMLRewriter {
  const { submitted } = outcome;

  return rewriter
    .on('[data-signup-unavailable]', new RevealHandler(true))
    .on('[data-signup-value="name"]', new ValueHandler(submitted.name, false))
    .on('[data-signup-value="email"]', new ValueHandler(submitted.email, false))
    .on('[data-signup-value="consent"]', new CheckedHandler(submitted.consent, false));
}

/** Rewrites `/nn/?signup=ok` to acknowledge a sign-up that landed. */
export function renderNnSignupAcknowledgement(rewriter: HTMLRewriter): HTMLRewriter {
  return rewriter.on('[data-signup-ack]', new RevealHandler(true));
}
