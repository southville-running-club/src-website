import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The order the timing app's stylesheets load in is part of how they work.
 *
 * `app/styles/timing.css` restates `club.css`'s bare heading, paragraph, link and `main` rules
 * under `:where(.timing-ui)`, which has no specificity. It ties with `base.css`'s type selectors
 * and wins **only because it loads later**; loaded earlier, every restyled page would get
 * `base.css`'s Inter headings and its 40rem `main`, and nothing else would notice. So both files
 * that draw a whole document import the four sheets in this order, and this test says so.
 */

const ORDER = [
  '@src/shared/styles/base.css',
  '@src/shared/styles/club-chrome.css',
  './styles/club-content.css',
  './styles/timing.css',
];

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe.each([['app/layout.tsx'], ['app/global-error.tsx']])('%s', (file) => {
  const source = read(`../../${file}`);

  it('imports the four stylesheets, base first and the timing layer last', () => {
    const positions = ORDER.map((sheet) => source.indexOf(`import '${sheet}';`));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
