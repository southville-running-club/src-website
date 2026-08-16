import tokens from '@src/shared/styles/tokens.css?raw';
import base from '@src/shared/styles/base.css?raw';
import admin from '@src/shared/styles/nn-admin.css?raw';

/**
 * `/nn/admin.css` — the one stylesheet the Worker links rather than a page imports.
 *
 * ## Why this is an endpoint and not a file in `public/`
 *
 * The admin pages are built in the Worker (`worker/nn-admin.ts` says why), so they cannot pick
 * up the hashed `/_astro/*.css` bundle that every Astro page gets — the Worker has no way to
 * know the hash. A copy of the palette in `public/` would give it a stable address and would be
 * **a second copy of the club's colours**, which is exactly what `tokens.css` and
 * `docs/foundations/brand.md` exist to prevent.
 *
 * So this concatenates the real files at build time. Astro prerenders it to `dist/nn/admin.css`
 * with that name and no hash, the assets binding serves it, and there is still exactly one
 * definition of every colour in this repository.
 *
 * ## The address, and the character that matters
 *
 * `/nn/admin.css` sits **beside** `/nn/admin/` rather than beneath it, and `isNnAdminPath` in
 * `worker/routing.ts` is written to match `/nn/admin` exactly or `/nn/admin/` and below — never
 * `/nn/admin` as a prefix of a longer segment. Get that wrong and the Worker answers the
 * stylesheet request itself, with a 404 or a sign-in page, and every admin page renders
 * unstyled. `tests/unit/routing.test.ts` pins it.
 *
 * ## The import that is stripped
 *
 * `base.css` opens with `@import './tokens.css'`, which is right where it is and wrong here: a
 * relative import resolves against `/nn/`, where there is no such file. The three are
 * concatenated in dependency order instead, so the statement has already been satisfied by the
 * time the rest of `base.css` is parsed — and a stray `@import` after the first rule is ignored
 * by every browser anyway, which is the failure mode that would have been silent.
 */

const IMPORT_STATEMENT = /^@import[^;]*;\s*$/m;

export function GET(): Response {
  const css = [tokens, base.replace(IMPORT_STATEMENT, ''), admin].join('\n');

  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
    },
  });
}
