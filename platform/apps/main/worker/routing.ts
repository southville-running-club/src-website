/**
 * Which asset a request should be served, given its hostname.
 *
 * Pure, and separated from the Worker itself so it can be tested without a runtime.
 *
 * ## Why any of this exists
 *
 * A Cloudflare Worker is **not** one app per hostname — it can carry many custom domains.
 * That is what lets `apps/main` serve `nn.southvillerunningclub.co.uk` today and gain
 * `new.`, the apex and `www` later without a repository move, a project move, or a URL
 * breaking.
 *
 * The content lives at `/nn/` in the build from day one, so `<apex>/nn/` already works the
 * moment the apex lands. All this module does is make `nn.<apex>/` an alias for it.
 *
 * ## The part that is load-bearing
 *
 * From Phase 5 onwards this build also contains the club website, unfinished and
 * `noindex`. Those pages must not be reachable on the race domain. Prefixing every path
 * with `/nn` is what guarantees that: `nn.<apex>/membership/` resolves to
 * `/nn/membership/`, which does not exist, so it 404s. There is no path through this
 * function that serves a non-`/nn/` page on the `nn.` hostname — except the shared build
 * assets below, which cannot be pages.
 *
 * ## Locally it is the same rule, on `nn.localhost`
 *
 * Any hostname whose first label is `nn` is Nightingale Nightmare's, so
 * `http://nn.localhost:8787/` behaves exactly as the live subdomain does and the local
 * shape matches the public one. Browsers resolve `*.localhost` to 127.0.0.1 without an
 * `/etc/hosts` entry.
 *
 * **This only works because `routes` live under `env.production`.** While they were at the
 * top level, `wrangler dev` rewrote `request.url` to the custom domain and ignored the
 * incoming `Host` header entirely — every local request looked like the live hostname, and
 * no `curl -H "Host: ..."` could change it. Moving them fixed it. Worth knowing if routes
 * ever migrate back up.
 *
 * See docs/architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md
 */

/** The hostname Nightingale Nightmare is served on in production. */
export const NN_HOST = 'nn.southvillerunningclub.co.uk';

/**
 * True for the live hostname and for its local equivalent, `nn.localhost`.
 *
 * Matching on the first label rather than the full string is what lets one rule serve
 * both, so the local shape is the public shape rather than an approximation of it. The
 * club owns one domain and there is no other `nn.` host to collide with.
 */
export function isNightingaleNightmareHost(hostname: string): boolean {
  return hostname === NN_HOST || hostname.startsWith('nn.');
}

/** Where Nightingale Nightmare's pages live in the build output. */
export const NN_PREFIX = '/nn';

/**
 * Build output shared by every hostname, which Astro emits at the root and which can
 * never be a page. These are served unprefixed so that stylesheets and fonts still
 * resolve on the `nn.` hostname.
 *
 * Keep this list tight. Anything added here is reachable on every hostname, which is
 * exactly what the prefixing exists to prevent for pages.
 */
const SHARED_ASSET_PREFIXES = ['/_astro/'];
const SHARED_ROOT_FILES = ['/favicon.ico', '/favicon.svg', '/robots.txt'];

export interface Route {
  /** The path to request from the static-assets binding. */
  path: string;
  /** True when this request is for Nightingale Nightmare's own content. */
  isNightingaleNightmare: boolean;
  /**
   * Set when the request should be answered with a permanent redirect instead of a body.
   *
   * Used for exactly one case: `/nn/...` on the race hostname. `/nn/` is where the pages
   * live *in the build*, not an address the public should ever see, so asking for it
   * lands you on the canonical one.
   */
  redirectTo?: string;
}

function isSharedAsset(path: string): boolean {
  return (
    SHARED_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    SHARED_ROOT_FILES.includes(path)
  );
}

/**
 * Resolve a hostname and path to the asset that should answer it.
 *
 * Hostnames other than `nn.` — `localhost`, `*.workers.dev` previews, and the apex when
 * it lands — pass through untouched. That is deliberate: the preview URL should show the
 * whole build, because reviewing it is the point.
 */
export function resolveRoute(hostname: string, pathname: string): Route {
  if (!isNightingaleNightmareHost(hostname)) {
    return {
      path: pathname,
      isNightingaleNightmare: pathname.startsWith(`${NN_PREFIX}/`),
    };
  }

  if (isSharedAsset(pathname)) {
    return { path: pathname, isNightingaleNightmare: false };
  }

  // `/nn/...` asked for explicitly on this hostname — redirect to the canonical address
  // rather than serve it.
  //
  // **There is one public URL for this race, and it is `nn.<apex>/`.** `/nn/` is where the
  // pages sit in the build so that the apex can serve them one day; it is not an address
  // to publish, and serving both would put the same page at two URLs. Until the club is
  // off Squarespace the apex is not Cloudflare's at all, so `<apex>/nn/` resolves to
  // nothing anywhere.
  if (pathname === NN_PREFIX || pathname.startsWith(`${NN_PREFIX}/`)) {
    const stripped = pathname.slice(NN_PREFIX.length) || '/';
    return { path: stripped, isNightingaleNightmare: true, redirectTo: stripped };
  }

  // Everything else on this hostname is Nightingale Nightmare's, whether it exists or not.
  // `/` becomes `/nn/`; `/membership/` becomes `/nn/membership/` and 404s, which is the
  // whole point.
  const suffix = pathname === '/' ? '/' : pathname;
  return { path: `${NN_PREFIX}${suffix}`, isNightingaleNightmare: true };
}
