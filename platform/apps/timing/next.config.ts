import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
  // The timing platform lives at `/timing` on the club's one hostname, so every route,
  // internal link and asset URL is prefixed. Next handles that from this single setting.
  //
  // **This is the change the port has to carry.** The existing application's routes
  // (`/live/…`, `/admin/…`, `/marshal/…`) are written as root paths and stay written that
  // way — `basePath` prefixes them at build time. The one place it needs deliberate
  // attention is the **service worker**: its scope becomes `/timing/`, and anyone with the
  // app already installed holds a registration for the old scope. That is the offline
  // capture queue, so it is the part of the port to rehearse rather than assume.
  basePath: '/timing',

  // `packages/shared` ships TypeScript rather than built JavaScript, so Next has to
  // compile it. This is the workspace equivalent of an import, and it is why the club
  // gets one `Europe/London` module instead of two that drift.
  transpilePackages: ['@src/shared', '@src/db'],

  typedRoutes: true,

  /**
   * The addresses [#308](https://github.com/southville-running-club/src-website/issues/308)
   * merged away, kept alive as redirects.
   *
   * ⚠️ **These are not a courtesy, and deleting them breaks a published document.** The
   * race-night runbook addresses every one of these by URL, a volunteer has them bookmarked
   * after the 14 September rehearsal, and the whole point of the merge was that somebody found
   * the navigation tiring — sending them to a 404 for their trouble is the wrong answer to
   * that.
   *
   * **`permanent: false`.** A 308 is cached by browsers indefinitely and these addresses may
   * yet be wanted back; the merge is a navigation decision taken six weeks before a race, and
   * the reversible form is the honest one until it has been run on a start line. Revisit after
   * 1 November 2026.
   *
   * ⚠️ **Only the *pages* moved.** No `…/update` or `…/export` address appears here, because
   * none of them moved — every form still posts where it always did, carrying the permission
   * it always carried. A redirect on a POST address would also silently drop the body.
   *
   * These run **before** `middleware.ts`, so an old address never reaches the access table and
   * cannot be refused by it on the way past.
   */
  async redirects() {
    const toConsole = ['start', 'finish', 'status', 'anomalies', 'crossings'];

    return [
      // ⚠️ **`?section=` on the destination, and it is not decoration.** Only Start and Finish
      // are open by default, so a bookmark to `/status` that landed on a bare `/console` would
      // land on that section **collapsed** — which reads as the page having lost the thing the
      // address named. Naming the section opens it, so an old address still puts somebody in
      // front of what they asked for.
      ...toConsole.map((section) => ({
        source: `/events/:slug/${section}`,
        destination: `/events/:slug/console?section=${section}`,
        permanent: false,
      })),
      {
        source: '/events/:slug/prizes',
        destination: '/events/:slug/results#prizes',
        permanent: false,
      },
    ];
  },
};

// Makes Worker bindings available under `next dev`, so the fast loop sees what the real
// runtime sees rather than a Node approximation.
//
// **Guarded, and the guard is not optional.** This spawns a Miniflare/workerd instance as
// a side effect of loading the config — and `next build` loads the config again in every
// static-generation worker, so calling it unconditionally fans out into repeated workerd
// spawns and will take a laptop down. It belongs in `next dev` and nowhere else.
if (process.env.NODE_ENV === 'development') {
  void initOpenNextCloudflareForDev();
}

export default nextConfig;
