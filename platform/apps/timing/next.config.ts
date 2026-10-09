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
   * The addresses that moved, kept alive as redirects.
   *
   * [ADR-055](../../../docs/architecture/decisions/adr-055-race-timing-follows-pass-the-bucks-navigation.md)
   * gave Start, Anomalies, Timing log, Roster and Prizes pages of their own again, after
   * [#308](https://github.com/southville-running-club/src-website/issues/308) had merged them
   * into the race console and the results page. So it is the **console** that is the old
   * address now, along with `finish` and `status`, whose blocks live on Start and Roster.
   *
   * ⚠️ **These are not a courtesy.** A volunteer may have the console bookmarked from a
   * rehearsal, and the runbook named it until ADR-055. A `?section=` link — which every form
   * used to come back to — goes to the page that section became, rather than to Start.
   *
   * **`permanent: false`.** A 308 is cached by browsers indefinitely; the reversible form is the
   * honest one until the new arrangement has been run on a start line.
   *
   * ⚠️ **Only the *pages* moved.** No `…/update` or `…/export` address appears here, because
   * none of them moved — every form still posts where it always did, carrying the permission
   * it always carried. A redirect on a POST address would also silently drop the body.
   *
   * These run **before** `middleware.ts`, so an old address never reaches the access table and
   * cannot be refused by it on the way past. **Order matters**: the first match wins, so the
   * `?section=` rules come before the console's catch-all.
   */
  async redirects() {
    const sections: [string, string][] = [
      ['start', '/start'],
      ['finish', '/start#finish'],
      ['status', '/roster'],
      ['anomalies', '/anomalies'],
      ['crossings', '/crossings'],
    ];

    return [
      ...sections.map(([section, to]) => ({
        source: '/events/:slug/console',
        has: [{ type: 'query' as const, key: 'section', value: section }],
        destination: `/events/:slug${to}`,
        permanent: false,
      })),
      {
        source: '/events/:slug/console',
        destination: '/events/:slug/start',
        permanent: false,
      },
      {
        source: '/events/:slug/finish',
        destination: '/events/:slug/start#finish',
        permanent: false,
      },
      {
        source: '/events/:slug/status',
        destination: '/events/:slug/roster',
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
