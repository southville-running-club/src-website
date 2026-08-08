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
 * ## One thing `wrangler dev` cannot show you
 *
 * When `routes` are configured, **`wrangler dev` rewrites `request.url` to the custom
 * domain** and ignores the incoming `Host` header entirely. Every local request therefore
 * looks like `nn.southvillerunningclub.co.uk`, and no amount of `curl -H "Host: ..."`
 * changes it. That makes the dev server useless for exercising the branch below.
 *
 * The Worker tests are the honest check here: `vitest-pool-workers` runs the same runtime
 * but preserves the URL, so `tests/worker/serves.test.ts` can ask for a `workers.dev`
 * hostname and get a real answer. Verified on 8 August 2026 — worth knowing before
 * concluding from a local `curl` that the routing is broken.
 *
 * See docs/architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md
 */

/** The hostname Nightingale Nightmare is served on. */
export const NN_HOST = 'nn.southvillerunningclub.co.uk';

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
  if (hostname !== NN_HOST) {
    return {
      path: pathname,
      isNightingaleNightmare: pathname.startsWith(`${NN_PREFIX}/`),
    };
  }

  if (isSharedAsset(pathname)) {
    return { path: pathname, isNightingaleNightmare: false };
  }

  // Already addressed by its real path — `nn.<apex>/nn/privacy/` — so serve it as-is
  // rather than prefixing twice. The page carries a canonical link to the unprefixed
  // form, so the duplicate does not become two indexed URLs.
  if (pathname === NN_PREFIX || pathname.startsWith(`${NN_PREFIX}/`)) {
    return { path: pathname, isNightingaleNightmare: true };
  }

  // Everything else on this hostname is Nightingale Nightmare's, whether it exists or not.
  // `/` becomes `/nn/`; `/membership/` becomes `/nn/membership/` and 404s, which is the
  // whole point.
  const suffix = pathname === '/' ? '/' : pathname;
  return { path: `${NN_PREFIX}${suffix}`, isNightingaleNightmare: true };
}
