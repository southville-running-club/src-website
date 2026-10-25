import tokens from '@src/shared/styles/tokens.css?raw';
import base from '@src/shared/styles/base.css?raw';
import theme from '@src/shared/styles/nn-theme.css?raw';
import photos from '@src/shared/styles/nn-photos.css?raw';

/**
 * `/nn/photos.css` — the stylesheet a runner's race photos pages link, on the exact pattern of
 * `results.css.ts` (see that file for why a Worker-built page needs a stylesheet at a fixed
 * address rather than the hashed one Astro emits).
 *
 * **The race page's look rather than the results page's club one** (brief §10): tokens, the
 * base, `nn-theme.css`, then the photo grid. The theme's fonts are self-hosted at absolute
 * paths, so they resolve from here exactly as they do for the race page.
 *
 * ⚠️ **It sits beside the photos addresses rather than beneath them**: `nnPhotosRoute()` in
 * `worker/routing.ts` matches only `/nn/<year>/photos/…`, so this falls past the Worker to the
 * assets binding where it lives.
 */
const IMPORT_STATEMENT = /^@import[^;]*;\s*$/m;

export function GET(): Response {
  const css = [tokens, base.replace(IMPORT_STATEMENT, ''), theme, photos].join('\n');

  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
    },
  });
}
