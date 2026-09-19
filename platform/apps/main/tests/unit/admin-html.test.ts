import { describe, expect, it } from 'vitest';
import { breakableEmail, breakableLabel, escapeHtml, html, raw } from '../../worker/html';

/**
 * The escaping the admin pages are built on.
 *
 * **This is the test that stands in for a rule the rest of the site gets from its
 * architecture.** Every public page is static Astro painted by `HTMLRewriter` in its escaping
 * text mode, and there is deliberately no `setInnerContent(..., { html: true })` anywhere in
 * this repository — so a first name of `"><script>` has no path onto a page and there is nothing
 * to audit. The admin pages cannot work that way (a list of entries is a variable number of
 * rows), so the guarantee has to be made here instead, and these assertions are what make it.
 */

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes the ampersand first, so an escape is not double-escaped', () => {
    // `&lt;` must not come out as `&amp;lt;`. A single pass with one regex is what guarantees
    // it; two sequential replacements would not.
    expect(escapeHtml('<a>')).toBe('&lt;a&gt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('the html template', () => {
  it('escapes an interpolated value', () => {
    const attack = '"><script>alert(1)</script>';

    expect(html`<td>${attack}</td>`.toString()).toBe(
      '<td>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</td>',
    );
  });

  it('escapes a value going into a double-quoted attribute', () => {
    // A club name of `" onmouseover="…` is the attribute-breakout case.
    expect(html`<input value="${'" onmouseover="x'}" />`.toString()).toBe(
      '<input value="&quot; onmouseover=&quot;x" />',
    );

    // **The single-quoted case is asserted on `escapeHtml` above and cannot be asserted here**,
    // because Prettier rewrites `value='…'` to `value="…"` inside a template tagged `html`
    // before this file is ever run. The apostrophe still has to be escaped — see the note at
    // the top of `worker/html.ts`.
    expect(escapeHtml("' onmouseover='x")).toBe('&#39; onmouseover=&#39;x');
  });

  it('escapes an entrant’s real name without mangling it', () => {
    // The seed's awkward entrant. An apostrophe is escaped and a non-ASCII letter is not
    // touched — mangling `Inés` would be its own kind of failure.
    expect(html`<th>${"Inés O'Rourke"}</th>`.toString()).toBe(
      '<th>Inés O&#39;Rourke</th>',
    );
  });

  /**
   * Whitespace between tags, collapsed.
   *
   * **Prettier reformats the contents of a template tagged `html`** — it is built in and not
   * configurable — so a nested element is indented onto its own line the moment this file is
   * formatted. That is harmless in a browser and it is why the tag keeps its conventional name,
   * but it means the two composition tests below cannot assert on exact output.
   */
  const squashed = (markup: string): string => markup.replace(/\s+/g, ' ').trim();

  it('inserts a nested fragment as markup rather than as text', () => {
    const row = html`<td>${'a & b'}</td>`;

    expect(
      squashed(
        html`<tr>
          ${row}
        </tr>`.toString(),
      ),
    ).toBe('<tr> <td>a &amp; b</td> </tr>');
  });

  it('joins an array, escaping each element', () => {
    const cells = ['a & b', 'c < d'].map((value) => html`<td>${value}</td>`);

    expect(
      squashed(
        html`<tr>
          ${cells}
        </tr>`.toString(),
      ),
    ).toBe('<tr> <td>a &amp; b</td><td>c &lt; d</td> </tr>');
  });

  it('renders nothing for null, undefined and false', () => {
    // `false` so that `condition && html`...`` reads the way it looks, and the two absences so
    // an entrant with no club renders an empty cell rather than the word "null".
    expect(html`<td>${null}</td>`.toString()).toBe('<td></td>');
    expect(html`<td>${undefined}</td>`.toString()).toBe('<td></td>');
    expect(html`<td>${false}</td>`.toString()).toBe('<td></td>');
  });

  it('renders zero rather than treating it as absent', () => {
    // A count of nought is a fact worth rendering, and `0` is falsy — the classic bug.
    expect(html`<td>${0}</td>`.toString()).toBe('<td>0</td>');
  });

  it('only lets raw() through, and raw() is the one thing to audit', () => {
    expect(html`<td>${raw('<b>bold</b>')}</td>`.toString()).toBe('<td><b>bold</b></td>');

    // A plain string that happens to contain markup is still escaped, whatever it came from.
    expect(html`<td>${'<b>bold</b>'}</td>`.toString()).toBe(
      '<td>&lt;b&gt;bold&lt;/b&gt;</td>',
    );
  });

  it('escapes an object that is not an Html, rather than trusting toString', () => {
    // A value arriving from a parsed database answer is `unknown` as far as this is concerned.
    const hostile = { toString: () => '<script>' };

    expect(html`<td>${hostile}</td>`.toString()).toBe('<td>&lt;script&gt;</td>');
  });
});

describe('break opportunities in a long value', () => {
  /**
   * ⚠️ **These two are the only places in this module that call `raw()` on a value that came
   * from a database**, so they are the only places the escaping could be got wrong. Everything
   * else `raw()` touches is markup this module built itself.
   *
   * The property is the same for both: **escape first, then insert a constant.** Asserted
   * directly rather than by reading the implementation, because `raw()` is what the file's own
   * header calls *"the one call a reviewer has to check"*.
   */
  it('breaks an address after the at-sign and each dot, and nowhere else', () => {
    expect(breakableEmail('someone@example.co.uk').toString()).toBe(
      'someone@<wbr>example.<wbr>co.<wbr>uk',
    );
  });

  it('adds nothing to an address that has no punctuation to break at', () => {
    // Not a real address, and the function is not a validator — it is asked to insert break
    // opportunities and there are none to insert.
    expect(breakableEmail('nobody').toString()).toBe('nobody');
  });

  it('escapes the address before it inserts anything', () => {
    // The whole of the `raw()` audit: markup in, text out, with the breaks still added at the
    // punctuation of the escaped string.
    expect(breakableEmail('<script>@evil.example').toString()).toBe(
      '&lt;script&gt;@<wbr>evil.<wbr>example',
    );
  });

  it('leaves a person’s name whole', () => {
    // ⚠️ The defect this pair exists for: `overflow-wrap: anywhere` rendered `Bindal Shah` as
    // `Binda` / `l Shah`. A name gets no break opportunities at all — it breaks at its spaces
    // like any other text, and `break-word` is the only backstop it has.
    expect(breakableLabel('Bindal Shah').toString()).toBe('Bindal Shah');
  });

  it('treats a label that is an address as an address', () => {
    // `displayName()` falls back to the email when somebody has no name recorded, and its own
    // header notes that no fixture in this repository has one — so this is the common case on
    // `/admin/people/` rather than the edge one.
    expect(breakableLabel('someone@example.com').toString()).toBe(
      'someone@<wbr>example.<wbr>com',
    );
  });

  it('escapes a name that contains markup', () => {
    expect(breakableLabel('<b>Ada</b>').toString()).toBe('&lt;b&gt;Ada&lt;/b&gt;');
  });

  it('is inserted by the template without being escaped again', () => {
    // The end-to-end property: an `Html` goes through `html` untouched, so the `<wbr>` survives
    // and the address around it is still escaped exactly once.
    expect(html`<p>${breakableEmail("o'neill@example.com")}</p>`.toString()).toBe(
      '<p>o&#39;neill@<wbr>example.<wbr>com</p>',
    );
  });
});
