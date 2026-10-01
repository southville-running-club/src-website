import tokens from '@src/shared/styles/tokens.css?raw';
import base from '@src/shared/styles/base.css?raw';
import admin from '@src/shared/styles/nn-admin.css?raw';
import clubChrome from '@src/shared/styles/club-chrome.css?raw';

/**
 * `/admin.css` — on the exact pattern of `src/pages/nn/admin.css.ts`, which see for why this
 * is a build-time concatenation endpoint rather than a file in `public/`.
 *
 * **The same three files the race admin surface links**, deliberately. #58 moved that surface
 * to `/admin/nn/` and put a shell around it; the shell is the same tool in the same brand, so
 * a second stylesheet would be a second set of colours to keep in step. `nn-admin.css` carries
 * **not one hex value** — every colour is a `--colour-*` token, asserted along with the
 * contrast of every wash by `packages/shared/tests/unit/admin-contrast.test.ts` — and the
 * shell inherits that rule by inheriting the file.
 *
 * **`nn-theme.css` is not one of the three, and must never become one.** This is a tool, not
 * a page a runner reads, and it will serve Pass the Buck as well as Nightingale Nightmare.
 *
 * **`/admin.css` sits beside `/admin/` rather than beneath it**, and `isAdminPath` in
 * `worker/routing.ts` matches `/admin` exactly or `/admin/` and below — never as a prefix of a
 * longer segment. Get that wrong and the Worker answers this request itself, with a 404 or a
 * sign-in redirect, and every admin page renders unstyled. `tests/unit/routing.test.ts` pins
 * it.
 *
 * **`club-chrome.css` is the fourth and it goes last** — the club website's header and footer,
 * which sit above and below the admin masthead since ADR-052. Every rule in it is scoped to a
 * `.club-*` class and it names no `--colour-*` token, so it leaves the tables and forms here
 * exactly as `nn-admin.css` draws them. `club.css` must never be added; it restyles bare
 * elements.
 *
 * `/nn/admin.css` stays where it is. Nothing links it any more, but it costs one prerendered
 * file and removing it is the same contraction #63 is for.
 */

const IMPORT_STATEMENT = /^@import[^;]*;\s*$/m;

export function GET(): Response {
  const css = [tokens, base.replace(IMPORT_STATEMENT, ''), admin, clubChrome].join('\n');

  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
    },
  });
}
