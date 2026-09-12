import { expect, type Page } from '@playwright/test';
import { ADMIN_PASSWORD } from '../admin-fixtures';

/**
 * One real sign-in per email, shared across specs.
 *
 * ## Why this is a module rather than a helper inside one spec
 *
 * It lived in `admin.spec.ts` and was private to it, which was right while that was the only
 * file that needed a signed-in browser. It stopped being right the moment a second surface
 * needed one: `/timing`'s pages are staff-only, so **every** assertion about them — including
 * the axe and 320px ones their issues ask for — needs a session.
 *
 * ⚠️ **The alternative was standing the same machinery up twice**, and that means two files
 * seeding and clearing admin fixtures against one database. `admin-db.ts`'s own header records
 * that as having bitten this suite already, and the fixture seeding is exactly where a second
 * copy would collide. One module, one cache, one set of people.
 *
 * ## Why the cache exists at all
 *
 * `admin.spec.ts` used to authenticate fresh in `beforeEach` and at nearly every call site —
 * 36 real round trips through `/account/sign-in/` for 44 tests, each a genuine GoTrue password
 * check, deliberately slow because that is what resists a credential-stuffing attempt.
 * `workers: 1` runs the whole suite through one browser and one `wrangler dev` process, so
 * that cost does not parallelise away. Two CI runs died mid-`mobile-safari` with the Worker
 * unreachable, consistent with load outrunning a resource ceiling `ci.yml` already calls tight.
 *
 * **A cookie jar is not the account; it is the proof that one exists.** Reusing a captured
 * session is not the shortcut a fabricated token would be — the sign-in still goes through the
 * real form, the real CSRF token and the real Turnstile field, once per person, and every
 * request after that still meets the same session and permission checks it always did. What
 * stops happening is proving the door works on the way to testing something else.
 *
 * The cache is module-scoped, so it is per Playwright worker. With `workers: 1` that is one
 * sign-in per email per run — **and, now that two specs share this module, one cache across
 * both of them.** See {@link forgetSessions}, which is the half that makes that safe.
 */

/**
 * `worker/csrf.ts`'s two names, **written out rather than imported from the Worker** — these
 * tests exercise the wire format, and importing the constant would make a rename invisible to
 * them. Exported because `admin.spec.ts` posts its own forms as well as signing in, and one
 * spelling in test-land is the point.
 */
export const CSRF_COOKIE = 'src_csrf';
export const CSRF_FIELD = 'csrf_token';

/**
 * Cloudflare's own published dummy response token.
 *
 * Accepted because `[auth.captcha]`'s secret locally and in CI is the matching published
 * "always passes" dummy secret — see `packages/db/supabase/config.toml` and
 * developers.cloudflare.com/turnstile/troubleshooting/testing. It authenticates nothing and
 * means nothing anywhere else.
 */
const DUMMY_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** `Cookie[]`, derived from `Page` rather than named — `playwright-core`'s own type is not
 *  re-exported from `@playwright/test`. */
type SessionCookies = Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>;

const sessionCookies = new Map<string, Promise<SessionCookies>>();

/**
 * Throw the cached jars away.
 *
 * ⚠️ **Every spec that seeds fixture people must call this, and CI is what proved it.**
 * `clearAdminFixtures()` deletes the `auth.users` rows in a spec's `afterAll`; the next spec's
 * `beforeAll` signs the same addresses up again and GoTrue mints **new ids**. A jar cached
 * before that points at a person who no longer exists — the cookie still parses, the session
 * still looks live, and every permission check behind it silently answers no.
 *
 * The symptom is not a sign-in failure. It is a **404 on a page that should have opened**,
 * somewhere else entirely, in whichever spec happened to run second: `admin.spec.ts`'s CSV
 * export came back 404 on one shard and passed on the other three, because only that shard
 * ran both specs in that order.
 *
 * This did not exist while the cache was private to one spec file, which is the cost of
 * sharing it and is cheaper than two files seeding the same people.
 */
export function forgetSessions(): void {
  sessionCookies.clear();
}

/** The real round trip, run exactly once per email — see `signInAs` below it. */
async function realSignIn(page: Page, email: string): Promise<void> {
  // The GET is what mints the double-submit token and sets its cookie; the POST has to echo
  // the same value back, which is the whole of the CSRF control.
  const form = await page.request.get('/account/sign-in/');
  expect(form.status(), 'the sign-in page must be served').toBe(200);

  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === CSRF_COOKIE,
  )?.value;

  expect(token, 'the sign-in page must mint a CSRF token').toBeTruthy();

  const signedIn = await page.request.post('/account/sign-in/', {
    form: {
      [CSRF_FIELD]: token ?? '',
      email,
      password: ADMIN_PASSWORD,
      'cf-turnstile-response': DUMMY_TURNSTILE_TOKEN,
    },
  });

  expect(signedIn.status(), `signing in as ${email} was refused`).toBe(200);
  expect(new URL(signedIn.url()).pathname, `signing in as ${email} did not land`).toBe(
    '/account/',
  );
}

/**
 * Sign somebody in — for real, the first time this email is asked for; from the cache after
 * that.
 *
 * **The cookies are the browser context's**, so everything after this is that person until the
 * next call. The jar is cleared first so switching people mid-test cannot leave half of a
 * previous session behind, cached session or fresh one alike.
 */
export async function signInAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();

  const cached = sessionCookies.get(email);

  if (cached === undefined) {
    const captured = realSignIn(page, email).then(() => page.context().cookies());
    sessionCookies.set(email, captured);
    await captured;
    return;
  }

  await page.context().addCookies(await cached);
}
