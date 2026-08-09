import { defineConfig } from 'astro/config';

// Static output, and no Cloudflare adapter.
//
// A static-only Astro site does not need `@astrojs/cloudflare` at all: Astro pre-renders
// at build time, and `dist/` is served by the Worker's static-assets binding. The dynamic
// half lives in `worker/index.ts`, which is the full Workers runtime rather than a
// framework abstraction over it.
//
// This is what makes the hosting decision cheap to be wrong about. The output is static
// HTML plus one handler; it runs on Workers, on Pages, or on Netlify with a signature
// change. Nothing here is a one-way door.
//
// See docs/delivery/nn-build-brief.md#build-it-as-a-worker
export default defineConfig({
  output: 'static',
  site: 'https://new.southvillerunningclub.co.uk',

  // Trailing slashes are load-bearing once a Worker is rewriting paths by hostname:
  // `/nn` and `/nn/` must not be two different answers. Astro is told to be strict so the
  // Worker only has one shape to reason about.
  trailingSlash: 'always',

  build: {
    format: 'directory',

    // Astro inlines small stylesheets by default. Emitting a real `/_astro/*.css` file
    // instead is worth it twice over: it is cached once across every page rather than
    // re-sent inline with each one, and it means the Worker's shared-asset path is
    // genuinely exercised rather than theoretical. See worker/routing.ts.
    inlineStylesheets: 'never',
  },
});
