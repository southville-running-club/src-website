import tokens from '@src/shared/styles/tokens.css?raw';
import base from '@src/shared/styles/base.css?raw';
import account from '@src/shared/styles/account.css?raw';

/**
 * `/account.css` — on the exact pattern of `src/pages/nn/admin.css.ts`. See that file for
 * why this is a build-time concatenation endpoint rather than a file in `public/`.
 *
 * **`/account.css` sits beside `/account/` rather than beneath it**, and `isAccountPath` in
 * `worker/routing.ts` matches `/account` exactly or `/account/` and below — never as a
 * prefix of a longer segment. Get that wrong and the Worker answers this request itself,
 * with a 404 or a sign-in page, and every account page renders unstyled.
 * `tests/unit/routing.test.ts` pins it.
 *
 * `nn-theme.css` is deliberately not one of the three concatenated here — this is not a
 * race page.
 */

const IMPORT_STATEMENT = /^@import[^;]*;\s*$/m;

export function GET(): Response {
  const css = [tokens, base.replace(IMPORT_STATEMENT, ''), account].join('\n');

  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
    },
  });
}
