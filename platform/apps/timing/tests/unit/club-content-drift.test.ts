import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `app/styles/club-content.css` is a copy of rules from `club.css`, and this is what keeps it one.
 *
 * ## Why there is a copy at all
 *
 * The timing app needs the club website's cards, facts band, badges and forms, and cannot import
 * `club.css`: that file also carries bare `body`, `h1`–`h4`, `p`, `a` and `main` rules, which would
 * repaint every timing page still drawn by `base.css`. Splitting `club.css` is the real fix, but it
 * edits `platform/packages/`, which also redeploys `apps/main` mid-entries. So the copy lives here
 * until after the race (HALT 1, D10), and the split's pull request deletes it and this file.
 *
 * ## What "drift" means here
 *
 * Every rule in the copy must still exist in `club.css` with **the same selector, inside the same
 * `@media` condition, with the same declarations in the same order**, and the copied rules must
 * appear in the same relative order as in `club.css`, because the cascade depends on it. Comments
 * and whitespace are ignored; nothing else is. A change to `club.css` that touches a copied rule
 * fails here until the copy is brought across, which is the point: the timing pages should never
 * quietly look different from the website they are meant to match.
 *
 * It does **not** fail when `club.css` gains a rule the copy does not have. The copy is
 * deliberately partial: only what the race-day slices use.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const copy = read('../../app/styles/club-content.css');
const original = read('../../../../packages/shared/styles/club.css');

interface Rule {
  media: string | null;
  selector: string;
  declarations: string[];
}

/**
 * Parse flat CSS with at most one level of `@media`, which is all `club.css` uses.
 *
 * A hand-rolled parser rather than a dependency: the workspace has no CSS parser of its own, and
 * one borrowed transitively from Next or Vite would break the day either stopped shipping it.
 */
function parse(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const rules: Rule[] = [];

  const walk = (block: string, media: string | null) => {
    let at = 0;
    for (;;) {
      const open = block.indexOf('{', at);
      if (open < 0) return;
      const head = block.slice(at, open).trim().replace(/\s+/gu, ' ');

      if (head.startsWith('@')) {
        let depth = 1;
        let end = open + 1;
        while (depth > 0 && end < block.length) {
          if (block[end] === '{') depth += 1;
          if (block[end] === '}') depth -= 1;
          end += 1;
        }
        walk(block.slice(open + 1, end - 1), head);
        at = end;
        continue;
      }

      const close = block.indexOf('}', open);
      rules.push({
        media,
        selector: head
          .split(',')
          .map((part) => part.trim())
          .join(', '),
        declarations: block
          .slice(open + 1, close)
          .split(';')
          .map((d) =>
            d
              .trim()
              .replace(/\s+/gu, ' ')
              .replace(/\s*:\s*/u, ': '),
          )
          .filter((d) => d !== ''),
      });
      at = close + 1;
    }
  };

  walk(text, null);
  return rules;
}

const copied = parse(copy);
const club = parse(original);
const key = (rule: Rule) => `${rule.media ?? ''} | ${rule.selector}`;

describe('the copy of club.css in the timing app', () => {
  it('holds something', () => {
    // Guards against a parser that silently finds nothing, which would pass every test below.
    expect(copied.length).toBeGreaterThan(40);
    expect(club.length).toBeGreaterThan(copied.length);
  });

  it.each(copied.map((rule) => [key(rule), rule] as const))(
    '%s matches club.css',
    (_name, rule) => {
      const matches = club.filter((c) => key(c) === key(rule));
      expect(matches, `club.css has no rule ${key(rule)}`).not.toHaveLength(0);
      expect(matches.map((m) => m.declarations)).toContainEqual(rule.declarations);
    },
  );

  it('keeps club.css’s order, so the cascade is the same', () => {
    const positions = copied.map((rule) =>
      club.findIndex(
        (c) =>
          key(c) === key(rule) &&
          JSON.stringify(c.declarations) === JSON.stringify(rule.declarations),
      ),
    );
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  /*
   * The property that makes the copy safe to load on every timing page: nothing in it can paint
   * an element that has not opted in with a class. `club.css`'s bare rules are exactly what must
   * not come across; `timing.css` restates what the components need under `:where(.timing-ui)`.
   */
  it('names a class in every selector, so nothing applies to a bare element', () => {
    const bare = copied
      .flatMap((rule) => rule.selector.split(', '))
      .filter((selector) => !/\.club-/u.test(selector));
    expect(bare).toEqual([]);
  });

  it('declares no token and imports nothing', () => {
    expect(copy).not.toMatch(/@import/u);
    expect(copied.map((rule) => rule.selector)).not.toContain(':root');
  });
});
