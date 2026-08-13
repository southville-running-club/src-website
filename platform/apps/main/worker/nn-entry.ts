import {
  createAnonClient,
  entryRulesFrom,
  fetchEntryState,
  formatPence,
  parseNnEntry,
  toIsoDate,
  NN_ENTRY_FIELDS,
  type EntryState,
  type NnEntryErrors,
  type NnEntryField,
} from '@src/shared';

/**
 * The entry form's two halves: deciding whether to show it at all, and what to do when it
 * arrives.
 *
 * ## Which form `/nn/` shows, and who decides
 *
 * **The event row decides, not a deploy.** `entries.events.entries_open_at` and
 * `entries_close_at` are read on every request through `entries.entry_state()`, so entries
 * open when the committee says they do rather than when somebody is free to push a commit at
 * seven in the morning. The page ships with both forms in it and this module reveals one,
 * which is the same arrangement the interest form's acknowledgement already uses: one copy
 * of the page, in `dist/`, painted at serve time.
 *
 * ## The failure direction is towards taking no entries
 *
 * Every way this can go wrong — the migration not landed, the database unreachable, the
 * function returning a shape that does not parse — resolves to **the interest form**. A page
 * that cannot tell whether entries are open must not offer to take one, and that matters
 * more once there is a card payment on the end of it. `fetchEntryState` never throws and
 * never guesses `open`.
 *
 * ## What Slice A does with a good entry
 *
 * Nothing, and it says so. The submit handler validates and stops: no row is written, no
 * Checkout session is created, no acknowledgement is shown. **A confirmation for an entry
 * that does not exist is the one failure here worth more than all the others put together**,
 * so a valid submission gets an honest "this is not finished" with every value preserved.
 */

export interface NnEntryEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/** The event this page is about. One page, one race, and the slug is the join between them. */
export const NN_EVENT_SLUG = 'nn-2026';

/** Which of the page's two forms a request is about. */
export type NnFormKind = 'interest' | 'entry';

/**
 * Read the hidden `form` field.
 *
 * **Anything unrecognised is the interest form**, deliberately: that is the form that takes
 * no money and no personal data beyond a name, so an unlabelled or stale submission lands on
 * the harmless side of the fork.
 */
export function nnFormKind(form: FormData | null): NnFormKind {
  return form?.get('form') === 'entry' ? 'entry' : 'interest';
}

export type NnEntryView = { show: 'interest' } | { show: 'entry'; state: EntryState };

/**
 * Ask the database which form to show.
 *
 * Errors are swallowed into `interest` rather than propagated. The one thing worth logging
 * is *why*, and `fetchEntryState` builds that string from a PostgREST code and message —
 * neither of which can carry personal data, because the function reads none.
 */
export async function resolveNnEntryView(env: NnEntryEnv): Promise<NnEntryView> {
  try {
    const client = createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    });

    const result = await fetchEntryState(client, NN_EVENT_SLUG);

    if (!result.ok) {
      console.error(`entries.entry_state unavailable — ${result.error}`);
      return { show: 'interest' };
    }

    return result.value.state === 'open'
      ? { show: 'entry', state: result.value }
      : { show: 'interest' };
  } catch (cause) {
    console.error(
      `entries.entry_state threw — ${cause instanceof Error ? cause.name : 'unknown'}`,
    );
    return { show: 'interest' };
  }
}

// -----------------------------------------------------------------------------------------
// What the person typed
// -----------------------------------------------------------------------------------------

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
  'club',
  'eaNumber',
  'emergencyName',
  'emergencyPhone',
] as const;

const TEXTAREA_FIELDS = ['medicalNotes'] as const;

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
  };
}

export type NnEntryOutcome =
  | { status: 'closed' }
  | { status: 'invalid'; errors: NnEntryErrors; submitted: NnEntrySubmission }
  | { status: 'not-taken'; submitted: NnEntrySubmission };

/**
 * Validate one entry, and stop.
 *
 * The window is re-checked here rather than trusted from whenever the page was served:
 * somebody opens the page at 6:59 and presses the button at 7:01 on the last day, and that
 * is an ordinary sequence rather than an attack.
 */
export async function processNnEntry(
  form: FormData | null,
  env: NnEntryEnv,
): Promise<NnEntryOutcome> {
  const view = await resolveNnEntryView(env);

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

  // **The stub, and the whole of it.** `parsed.value` is a complete, valid entry and it goes
  // no further: no insert, no Stripe session, no email. Slice B is what connects the rest,
  // and until it does the person is told plainly that their entry is not finished rather
  // than being thanked for one that does not exist.
  //
  // Nothing about `parsed.value` is logged. It holds a name, a date of birth, an emergency
  // contact and possibly medical information, and an observability tool that was never
  // assessed to hold those is exactly where it must not end up.
  return { status: 'not-taken', submitted };
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

/** Points the hero's primary button at whichever form is on the page. */
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
 * Reveal whichever of the page's two forms applies, and fill in what only the database
 * knows.
 *
 * The interest form ships visible, so the `interest` case does nothing at all: no rewriting
 * is the correct rendering of "entries are not open", which means the common path and the
 * database-unreachable path produce byte-identical HTML.
 */
export function renderNnEntryView(
  rewriter: HTMLRewriter,
  view: NnEntryView,
): HTMLRewriter {
  if (view.show !== 'entry') {
    return rewriter;
  }

  const { state } = view;

  rewriter
    .on('[data-nn-interest]', new HideHandler())
    .on('[data-nn-entry]', new RevealHandler())
    .on('[data-nn-cta]', new CtaHandler('#enter', 'Enter the race'));

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

/** Rewrites `/nn/` to say the entry could not be completed, keeping everything typed. */
export function renderNnEntryNotTaken(
  rewriter: HTMLRewriter,
  outcome: Extract<NnEntryOutcome, { status: 'not-taken' }>,
): HTMLRewriter {
  rewriter.on('[data-entry-unavailable]', new RevealHandler(true));
  restoreSubmission(rewriter, outcome.submitted, {});
  return rewriter;
}

/** Rewrites `/nn/` to say entries are not open. There is nothing to restore — see below. */
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
  const gender = submitted.text.gender ?? '';
  for (const option of ['', 'female', 'male', 'non_binary']) {
    rewriter.on(
      `[data-entry-selected="gender:${option}"]`,
      new SelectedHandler(option === gender),
    );
  }

  for (const code of ['affiliated', 'unaffiliated', 'vi_guide']) {
    rewriter.on(
      `[data-entry-checked="feeCode:${code}"]`,
      new CheckedHandler(code === submitted.feeCode, invalid('feeCode')),
    );
  }

  rewriter
    .on(
      '[data-entry-checked="medicalConsent"]',
      new CheckedHandler(submitted.medicalConsent, invalid('medicalConsent')),
    )
    .on(
      '[data-entry-checked="entryTerms"]',
      new CheckedHandler(submitted.entryTerms, invalid('entryTerms')),
    );
}
