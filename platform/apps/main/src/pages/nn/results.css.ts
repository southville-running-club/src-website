import tokens from '@src/shared/styles/tokens.css?raw';
import base from '@src/shared/styles/base.css?raw';
import results from '@src/shared/styles/nn-results.css?raw';

/**
 * `/nn/results.css` — on the exact pattern of `src/pages/nn/admin.css.ts` and
 * `src/pages/account.css.ts`. See the first of those for why this is a build-time
 * concatenation endpoint rather than a file in `public/`.
 *
 * **It sits beside the year pages rather than beneath one**, because the stylesheet is the
 * race's rather than one running's — `/nn/2026/results/` and `/nn/2027/results/` link the same
 * file. `isNnResultsPath` in `worker/routing.ts` matches only a four-digit year followed by
 * `results`, so this address falls past the Worker to the assets binding, which is the trap
 * `/nn/admin.css` and `/account.css` both document: get the predicate wrong and the Worker
 * answers this request itself and every results page renders unstyled.
 *
 * `nn-theme.css` is deliberately not concatenated here — see `nn-results.css`'s own header for
 * why a staff tool is in the club brand rather than the campaign's.
 */

const IMPORT_STATEMENT = /^@import[^;]*;\s*$/m;

export function GET(): Response {
  const css = [tokens, base.replace(IMPORT_STATEMENT, ''), results].join('\n');

  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
    },
  });
}
