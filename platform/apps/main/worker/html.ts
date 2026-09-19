/**
 * HTML built in the Worker, with escaping that cannot be forgotten.
 *
 * ## Why there is markup in a Worker at all
 *
 * Every page on this site is static Astro painted by `HTMLRewriter`, and **that arrangement
 * cannot render this one.** A list of entries is a variable number of rows; painting needs a
 * fixed slot per row, which is why `NnPreviousYears.astro` ships exactly four `<a>` elements
 * and why the three fee cards are markup rather than a loop. Two hundred and fifty rows is not
 * a slot count.
 *
 * The alternative inside the existing arrangement is `setInnerContent(..., { html: true })`,
 * and **there is deliberately no such call anywhere in this repository** — `nn-entry.ts` says
 * so in as many words, so that a first name of `"><script>` has no path onto a page. Adding the
 * first one, on the page that renders other people's names, would be the worst possible place
 * to start.
 *
 * So the admin pages are built here instead, and the escaping problem is solved once: **there
 * is no way to interpolate a value into this template without it being escaped**, because
 * interpolation goes through `html` and `html` escapes everything that is not already an
 * `Html`. There is no `unsafe` helper and no string concatenation at any call site to audit.
 *
 * `raw()` exists for composing one fragment into another and is the single thing a reviewer has
 * to look at. It takes an `Html`-producing call's output, never a string from a database.
 *
 * ## Not on the pages a runner sees
 *
 * This is for `/nn/admin` and nothing else. The public pages keep the arrangement they have,
 * for the reason they have it: one copy of the page in `dist/`, no template in the Worker that
 * can drift from it.
 *
 * ## The trap: **Prettier reformats the contents of a template tagged `html`**
 *
 * It is a built-in behaviour and it is not configurable by tag name. Formatting this file, or
 * `nn-admin.ts`, reflows the markup inside every `html`…`` — it indents nested elements onto
 * their own lines, and it normalises `attr='x'` to `attr="x"`.
 *
 * Neither changes what a browser renders, and the readability is worth having. What it does
 * change is **what a test may assert on**:
 *
 *   * An exact-output assertion breaks the moment Prettier decides to indent. Compare
 *     whitespace-insensitively, or assert on a fragment short enough to stay on one line.
 *   * A phrase written across a line break in the source arrives with a newline in the middle
 *     of it, so `toContain('over its field')` fails on markup that looks correct. This is the
 *     same shape as the `{' '}` trap in the Astro pages, one framework along, and it cost the
 *     first admin test run.
 *   * A single-quoted attribute cannot be tested through this template at all, because Prettier
 *     rewrites it before the test ever runs. `escapeHtml` is where that belongs.
 *
 * Renaming the tag would switch the formatting off. It is deliberately not renamed: readable
 * markup in the one place this repository builds any is worth more than exact-output tests, and
 * `tests/unit/admin-html.test.ts` says so where somebody meeting this will read it.
 */

/** A string that is already safe to place in markup. Only this module can make one. */
export class Html {
  constructor(private readonly markup: string) {}

  toString(): string {
    return this.markup;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * The five characters, and the apostrophe is not optional.
 *
 * `&`, `<` and `>` cover element content; `"` covers a double-quoted attribute. `'` is there
 * because a single-quoted attribute is a thing somebody writes eventually, and an escaper that
 * is only correct for the quoting style in use today is one that breaks silently the first time
 * somebody uses the other.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/**
 * Mark a string as safe.
 *
 * **The one call in this module a reviewer has to check.** It is for composing fragments this
 * module produced — a row into a table, a table into a page — and never for a value that came
 * out of a database, a form or a URL. Everything else goes through the template below and is
 * escaped whether the author remembered to or not.
 */
export function raw(markup: string): Html {
  return new Html(markup);
}

/**
 * The template. Everything interpolated is escaped unless it is already an `Html`.
 *
 *   `Html`               inserted as it is — a fragment this module built.
 *   an array             each element by the same rules, joined with nothing.
 *   `null` / `undefined` nothing at all, so an absent club renders as an empty cell rather
 *                        than as the word "null".
 *   `false`              nothing, so `condition && html`...`` reads the way it looks.
 *   anything else        `String(value)`, escaped.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let markup = strings[0] ?? '';

  for (const [index, value] of values.entries()) {
    markup += render(value) + (strings[index + 1] ?? '');
  }

  return new Html(markup);
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) {
    return '';
  }

  if (value instanceof Html) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(render).join('');
  }

  return escapeHtml(String(value));
}

/**
 * An email address with break opportunities where an address may break.
 *
 * ## The defect
 *
 * `overflow-wrap: anywhere` was on every long value on `/admin/people/`, addresses and **names
 * alike**, and at a narrow column it cut inside words: the signed-in volunteer rendered as
 * `Binda` / `l Shah`, and `admin@southvillerunningclub.co.uk` broke as `…co` / `.uk`. The first
 * is a page about people mangling a person's name; the second is an address a volunteer is
 * about to read down a phone, split at a point that is not a seam.
 *
 * Taking the property off fixes the name and strands the address: it is one unbreakable token
 * long enough to push a 320px page sideways on its own, which is the failure that put the rule
 * there in the first place.
 *
 * ## So the break opportunities are markup rather than a property
 *
 * `<wbr>` after the `@` and after each `.` — the seams a reader already parses an address at.
 * The browser uses them only when the line will not fit, so a wide column still shows the whole
 * address on one line, and a narrow one breaks it where a person would.
 *
 * **`<wbr>` is a zero-width opportunity, not a hyphen and not a character**, so the address is
 * unchanged for copy-and-paste in every browser this club's volunteers use, and a screen reader
 * announces it as one address. Anything with visible output — a `&shy;`, a zero-width space —
 * would put a character inside a credential-shaped string, which is the one thing an address
 * on an admin page must not do.
 *
 * ## Why this is a legitimate `raw()`
 *
 * **The value is escaped first and the only unescaped thing inserted is a constant.** `<wbr>` is
 * this function's own literal; every character of the address goes through `escapeHtml` before
 * it is anywhere near it. An address containing `<script>` comes out as text, which
 * `tests/unit/admin-html.test.ts` asserts directly rather than by inspection.
 */
export function breakableEmail(address: string): Html {
  return raw(escapeHtml(address).replace(/([@.])/g, '$1<wbr>'));
}

/**
 * How somebody is labelled, with break opportunities only where the label allows them.
 *
 * ⚠️ **The name slots on `/admin/people/` hold addresses, and that is why this exists.**
 * `displayName()` falls back to the email when a person has no name recorded — and its own
 * header notes that *no fixture in this repository has a name at all*, so the fallback is the
 * common case rather than the edge one. Taking `overflow-wrap: anywhere` off the name to stop
 * it cutting `Bindal Shah` in half would therefore strand a 33-character address in a 320px
 * column with nowhere to break.
 *
 * So the label is asked what it is. An address gets `<wbr>` at its seams, exactly as
 * `breakableEmail` gives it; a name is returned whole and breaks only if `overflow-wrap:
 * break-word` has to, which for a real name is almost never. **`@` is the test** because a name
 * cannot contain one and every address must.
 */
export function breakableLabel(label: string): Html {
  return label.includes('@') ? breakableEmail(label) : raw(escapeHtml(label));
}
