import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EVENT_NAME,
  ADMIN_EVENT_SLUG,
  ADMIN_HANDLE,
  ADMIN_PASSWORD,
  AWKWARD_CLUB,
  AWKWARD_FIRST_NAME,
  AWKWARD_LAST_NAME,
  CLEAN_EVENT_SLUG,
  CLEAN_PAID_LAST_NAME,
  MEDICAL_NOTE,
  REGISTERED_EMAIL,
  NN_ADMIN_EMAIL,
  OVER_ENTRANT_ID,
  PEOPLE_ADMIN_EMAIL,
  NEVER_STORED_EA_NUMBER,
  PAID_ENTRANT_ID,
  PAID_NON_ASCII_LAST_NAME,
  SUPER_ADMIN_EMAIL,
} from '../../admin-fixtures';

/**
 * `/admin/`, in the real Workers runtime — the club's back office, its Nightingale Nightmare
 * section, and #59's roles page.
 *
 * ## What #58 changed, and what this file therefore had to become
 *
 * This was `nn-admin.test.ts`, and most of what it asserted about **content** is unchanged and
 * kept: the figures, the escaping, the filters, the medical panel, the start list, the three
 * CSVs and the byte-order mark. It is renamed because the surface it covers is no longer one
 * race — `/admin/nn/` is a section of a back office rather than the whole of one.
 *
 * **The way in is what moved.** There is no `ENTRIES_ADMIN_KEY`, no `nn_admin` cookie and no
 * key sign-in form anywhere in the Worker. Somebody signs in at `/account/`, the session
 * cookies are the ordinary `src_at`/`src_rt` pair, and every request under `/admin/` asks
 * `identity.my_roles()` again — which is what makes a role granted at `/admin/people/` take
 * effect on the next request rather than at the next sign-in.
 *
 * ## Every refusal is a 404, and asserting that is the point of the door section
 *
 * Signed out, a plain `registered`, the wrong staff role, an address under the prefix nobody
 * built: **all of them 404, and the bodies are byte-identical.** A 403 would disclose that the
 * address exists, which tells anybody who can register exactly where the club's entry list
 * lives and that it is worth attacking. This is the same answer the whole prefix gave when no
 * admin key was installed, and it is asserted here as a decision rather than left to be
 * inferred from a status code somebody could "fix" to a 403 without anything going red.
 *
 * **Granting a role is not inheriting one**, which is why there are three people and not two:
 * a `super-admin` who does not hold `nn-admin` is refused at `/admin/nn/` exactly as a
 * stranger is, and the `nn-admin` is refused at `/admin/people/`.
 */

const SITE = 'https://example.com';

const ADMIN = '/admin/';
const NN = '/admin/nn/';
const PEOPLE = '/admin/people/';

/**
 * Cloudflare's own published dummy response token, which `[auth.captcha]`'s matching dummy
 * secret always accepts locally and in CI. See
 * developers.cloudflare.com/turnstile/troubleshooting/testing, and the note in
 * `wrangler.jsonc` on the site key it is paired with.
 */
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/**
 * The audit bridge `tests/worker/admin/global-setup.ts` puts up for the length of this run.
 *
 * **Nothing may read `entries.admin_audit` through the API** — no policy, no grant, and none
 * of the thirteen functions the anon role may execute touches it — so a test in `workerd` has
 * no route to the row a medical read has just written, and `pg` does not run here either. The
 * port is written out in both files rather than shared, because a module either of them could
 * import would have to exist in both runtimes. See the note there.
 */
const AUDIT_BRIDGE = 'http://127.0.0.1:54399/';

// -----------------------------------------------------------------------------------------
// Getting in, and getting the answer back out
// -----------------------------------------------------------------------------------------

/**
 * A page's markup with runs of whitespace collapsed.
 *
 * **Prettier reformats the contents of a template tagged `html`** — it is built in and not
 * configurable — so a sentence written across two lines in `worker/nn-admin.ts` arrives with a
 * newline in the middle of it. `toContain('over its field')` then fails on markup that is
 * perfectly correct. This is the same shape as the `{' '}` trap in the Astro pages, one
 * framework along, and it cost the first run of this file.
 *
 * It is also what makes the attribute matching below safe: Prettier puts every attribute of a
 * multi-attribute element on its own line, so `name="person" value="…"` is only adjacent once
 * the whitespace is squashed.
 *
 * The CSV assertions deliberately do **not** go through this: a byte-order mark and a CRLF are
 * exactly what is being asserted there.
 *
 * ## `<wbr>` goes the same way, and for the same reason
 *
 * ⚠️ **An address is rendered with break opportunities in it** — `<wbr>` after the `@` and each
 * `.`, from `breakableEmail()` in `worker/html.ts` — so the markup for one reads
 * `zz-admin-worker-nn@<wbr>example.<wbr>com` and `toContain('zz-admin-worker-nn@example.com')`
 * fails on a page that is perfectly correct. **That is this function's existing trap with a
 * different character in the middle of the string**: a zero-width break opportunity is a
 * formatting instruction to the line-breaker, exactly as a newline Prettier inserted is, and an
 * assertion about what the page *says* has no business seeing either.
 *
 * It is also what the rendered page does. `<wbr>` contributes no text, so `textContent` is
 * unchanged and the Playwright assertions that find people by their address never saw this at
 * all — which is why 25 of these failed while the acceptance layer stayed green, and why the
 * fix belongs here rather than in the markup.
 *
 * **Stripped rather than matched loosely.** A regex tolerant of an optional `<wbr>` at every
 * punctuation mark would be unreadable and would still miss the next element of this kind; the
 * assertions stay written as the plain address somebody can read.
 */
function squash(markup: string): string {
  return markup.replace(/<wbr>/g, '').replace(/\s+/g, ' ');
}

async function pageText(response: Response): Promise<string> {
  return squash(await response.text());
}

/**
 * Every cookie a response sets, as `name=value`, with the cleared ones dropped.
 *
 * **All of them, which is why this is not `headers.get('set-cookie')`.** A sign-in sets three —
 * `src_at`, `src_rt` and, since ADR-019, `src_ax` — and a single `get` returns whichever the
 * runtime happens to join or pick, so a session built from one of them would be refused: on
 * sight if the deadline was the part dropped, or the moment the access token neared expiry if
 * the refresh token was.
 */
function setCookiePairs(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const all =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];

  return (
    all
      .filter((value) => value !== '')
      .map((value) => value.split(';')[0]!.trim())
      // `name=` with nothing after it is a cookie being cleared, not one being set.
      .filter((pair) => !pair.endsWith('='))
  );
}

function jar(...pairs: (string | null)[]): string {
  return pairs.filter((pair): pair is string => pair !== null && pair !== '').join('; ');
}

function csrfCookieFrom(response: Response): string {
  const pair = setCookiePairs(response).find((value) => value.startsWith('src_csrf='));
  expect(pair, 'the page set no CSRF cookie').toBeDefined();
  return pair!;
}

function csrfFieldFrom(markup: string): string {
  const token = /name="csrf_token" value="([^"]+)"/.exec(markup)?.[1];
  expect(token, 'the page rendered no CSRF field').toBeDefined();
  return token!;
}

/**
 * Sign in the way a browser does, and hand back the cookie header it would then send.
 *
 * The whole path is real: the CSRF cookie and the hidden field come off `/account/sign-in/`'s
 * own markup, the Turnstile field carries the published dummy token, and what comes back is
 * whatever `worker/session.ts` decided to set. Nothing here fabricates a token, which is the
 * point — a session this test built by hand would prove that the admin surface trusts a
 * cookie, not that anybody can get one.
 */
async function signIn(email: string): Promise<string> {
  const form = await SELF.fetch(`${SITE}/account/sign-in/`, { redirect: 'manual' });
  expect(form.status, `the sign-in page for ${email}`).toBe(200);

  const csrfCookie = csrfCookieFrom(form);
  const csrfToken = csrfFieldFrom(await pageText(form));

  const response = await SELF.fetch(`${SITE}/account/sign-in/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: csrfCookie,
    },
    body: new URLSearchParams({
      email,
      password: ADMIN_PASSWORD,
      csrf_token: csrfToken,
      'cf-turnstile-response': DUMMY_CAPTCHA_TOKEN,
    }),
    redirect: 'manual',
  });

  // A 422 here is the sign-in page re-served with a message on it, which means the fixture
  // person was not created, was not confirmed, or the captcha secret is not the dummy one.
  expect(response.status, `signing in as ${email} was refused`).toBe(303);

  const cookies = setCookiePairs(response);
  expect(
    cookies.some((pair) => pair.startsWith('src_at=')),
    'no access cookie',
  ).toBe(true);
  expect(
    cookies.some((pair) => pair.startsWith('src_rt=')),
    'no refresh cookie',
  ).toBe(true);
  expect(
    cookies.some((pair) => pair.startsWith('src_ax=')),
    'no absolute-deadline cookie',
  ).toBe(true);

  return jar(...cookies);
}

async function get(path: string, cookie: string | null = null): Promise<Response> {
  return SELF.fetch(`${SITE}${path}`, {
    headers: cookie === null ? {} : { cookie },
    redirect: 'manual',
  });
}

async function post(
  path: string,
  // **Pairs as well as an object**, because `/admin/people/` submits repeated fields: one
  // `expected` and one `role` per switch. An object cannot express that and `URLSearchParams`
  // accepts both, so the widening is free.
  body: Record<string, string> | [string, string][],
  cookie: string | null = null,
): Promise<Response> {
  return SELF.fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === null ? {} : { cookie }),
    },
    body: new URLSearchParams(body),
    redirect: 'manual',
  });
}

/**
 * The page with the masthead cut off.
 *
 * **The masthead names the signed-in person, by email address**, which is a change from
 * `/nn/admin`'s handle and is what stops a volunteer granting a role from the wrong one of two
 * accounts. It also means a bare `not.toContain('@example.com')` over the whole document can
 * never pass again — the same shape as the trap `CLAUDE.md` records about matching a bare
 * numeric string against markup full of SVG coordinates. What the leak assertions are actually
 * about is the *entrants'* addresses, so the frame comes off first.
 */
function withoutMasthead(markup: string): string {
  return markup.replace(/<header class="admin-mast">[\s\S]*?<\/header>/, '');
}

interface AuditRow {
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  email: string | null;
}

async function medicalReadAudit(): Promise<AuditRow[]> {
  const response = await fetch(AUDIT_BRIDGE);
  expect(response.status, 'the audit bridge did not answer').toBe(200);
  return (await response.json()) as AuditRow[];
}

let nnAdmin = '';
let member = '';
let superAdmin = '';
let peopleAdmin = '';

beforeAll(async () => {
  // Sequential rather than concurrent: four sign-ins is four rows in GoTrue's rate-limit
  // bucket either way, and a failure in one should say which one.
  nnAdmin = await signIn(NN_ADMIN_EMAIL);
  member = await signIn(REGISTERED_EMAIL);
  superAdmin = await signIn(SUPER_ADMIN_EMAIL);
  peopleAdmin = await signIn(PEOPLE_ADMIN_EMAIL);
});

// -----------------------------------------------------------------------------------------
// Where the surface used to be
// -----------------------------------------------------------------------------------------

/**
 * `/nn/admin/*`, which is now nothing but redirects.
 *
 * **Every one of the seven addresses is in a published runbook**, and a runbook that 404s is
 * worse than one that is out of date — somebody is reading it at nine on race morning. They
 * redirect before any credential is looked at, so the answer is the same for a stranger as for
 * a volunteer: a redirect discloses only that a documented address moved.
 *
 * The table below has eight rows for those seven, because `/nn/admin` and `/nn/admin/` are one
 * address in two spellings and somebody typing it into a bar will type it either way.
 *
 * **301 for a GET and 308 for anything else.** A 301 *permits* a client to turn a POST into a
 * GET, and three of these carry a body — an entrant id, an export kind, an event slug. A 308
 * preserves both, which is why the two statuses are asserted separately rather than "a
 * redirect".
 */
describe('the addresses the admin surface used to live at', () => {
  const moved: [string, string][] = [
    ['/nn/admin', '/admin/nn'],
    ['/nn/admin/', '/admin/nn/'],
    ['/nn/admin/entries/', '/admin/nn/entries/'],
    [`/nn/admin/entries/${ADMIN_EVENT_SLUG}/`, `/admin/nn/entries/${ADMIN_EVENT_SLUG}/`],
    ['/nn/admin/interest/', '/admin/nn/interest/'],
    ['/nn/admin/medical/', '/admin/nn/medical/'],
    ['/nn/admin/start-list/', '/admin/nn/start-list/'],
    ['/nn/admin/export/', '/admin/nn/export/'],
  ];

  for (const [from, to] of moved) {
    it(`sends a GET of ${from} to ${to}, permanently`, async () => {
      const response = await get(from, nnAdmin);

      expect(response.status, from).toBe(301);
      expect(response.headers.get('location'), from).toBe(to);
      expect(response.headers.get('cache-control'), from).toBe('no-store');
      expect(response.headers.get('x-robots-tag'), from).toBe('noindex, nofollow');
    });

    it(`sends a POST of ${from} to ${to} without letting it become a GET`, async () => {
      const response = await post(from, { event: ADMIN_EVENT_SLUG }, nnAdmin);

      // 308 rather than 301: the method and the body have to survive, and 301 does not
      // promise that.
      expect(response.status, from).toBe(308);
      expect(response.headers.get('location'), from).toBe(to);
    });
  }

  it('treats a HEAD as the GET it is, rather than as an other method', async () => {
    // A HEAD is a GET without the body, so it takes the 301 the GET takes. Getting this
    // wrong is invisible until a link checker or a monitor reports the whole runbook broken.
    const response = await SELF.fetch(`${SITE}/nn/admin/`, {
      method: 'HEAD',
      redirect: 'manual',
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/admin/nn/');
  });

  it('redirects a stranger identically, because it has not looked at anybody yet', async () => {
    const signedOut = await get('/nn/admin/interest/');

    expect(signedOut.status).toBe(301);
    expect(signedOut.headers.get('location')).toBe('/admin/nn/interest/');
  });

  it('keeps the query string, which is where the filters live', async () => {
    const response = await get(
      `/nn/admin/entries/${ADMIN_EVENT_SLUG}/?status=paid&sort=entered`,
      nnAdmin,
    );

    expect(response.headers.get('location')).toBe(
      `/admin/nn/entries/${ADMIN_EVENT_SLUG}/?status=paid&sort=entered`,
    );
  });

  it('carries a POST body through to the address it was sent on to', async () => {
    // **The other half of the 308.** The status says a client must not rewrite the method or
    // drop the body; this says the destination answers what arrives. Sent by hand rather than
    // by following the redirect, because whether a runtime replays a body on a 308 is the
    // runtime's business and not the thing being asserted.
    const redirected = await post(
      '/nn/admin/export/',
      { event: ADMIN_EVENT_SLUG, kind: 'ea' },
      nnAdmin,
    );
    expect(redirected.status).toBe(308);

    const followed = await post(
      redirected.headers.get('location')!,
      { event: ADMIN_EVENT_SLUG, kind: 'ea' },
      nnAdmin,
    );

    expect(followed.status).toBe(200);
    expect(followed.headers.get('content-type')).toContain('text/csv');
  });

  it('leaves the stylesheet beside it alone, which is one character away', async () => {
    // `/nn/admin.css` is a real file in `dist/`, emitted by `src/pages/nn/admin.css.ts`. If
    // the predicate treated `/nn/admin` as a plain prefix this would redirect to
    // `/admin/nn.css`, every admin page would render unstyled, and nothing would say why.
    const response = await get('/nn/admin.css');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
  });
});

// -----------------------------------------------------------------------------------------
// The door
// -----------------------------------------------------------------------------------------

/**
 * Who may be here at all.
 *
 * **Each assertion below is a way in that must not exist, and each fails if the check it
 * covers is removed** — which is what a comment saying "we check the role" cannot give.
 */
describe('the door', () => {
  const addresses = [
    ADMIN,
    NN,
    `${NN}entries/`,
    `${NN}entries/${ADMIN_EVENT_SLUG}/`,
    `${NN}interest/`,
    PEOPLE,
  ];

  for (const address of addresses) {
    it(`answers ${address} with a 404 to somebody signed out`, async () => {
      const response = await get(address);

      expect(response.status, address).toBe(404);

      const body = await pageText(response);
      // Nothing about what is behind the door reaches the page, and there is no form
      // suggesting there is a door here at all.
      expect(body, address).toContain('There is nothing at this address');
      expect(body, address).not.toContain(ADMIN_EVENT_NAME);
      expect(body, address).not.toContain(AWKWARD_LAST_NAME);
      expect(body.toLowerCase(), address).not.toContain('sign in');
      expect(body.toLowerCase(), address).not.toContain('admin key');
    });

    it(`answers ${address} with a 404 to somebody who only holds member`, async () => {
      // **Everybody with an account holds `registered`.** Holding it means being signed in and
      // nothing else, so this is the answer the overwhelming majority of signed-in people get
      // and it must be the same answer a stranger gets.
      const response = await get(address, member);

      expect(response.status, address).toBe(404);
      expect(await pageText(response), address).not.toContain(AWKWARD_LAST_NAME);
    });
  }

  it('refuses the two POST actions that read special category data, signed out', async () => {
    const medical = await post(`${NN}medical/`, { entrantId: PAID_ENTRANT_ID });
    const exported = await post(`${NN}export/`, {
      event: ADMIN_EVENT_SLUG,
      kind: 'medical',
    });

    expect(medical.status).toBe(404);
    expect(exported.status).toBe(404);
    expect(await pageText(medical)).not.toContain(MEDICAL_NOTE);
    expect(await pageText(exported)).not.toContain(MEDICAL_NOTE);
  });

  it('refuses the same two to a plain registered account', async () => {
    const medical = await post(`${NN}medical/`, { entrantId: PAID_ENTRANT_ID }, member);
    const exported = await post(
      `${NN}export/`,
      { event: ADMIN_EVENT_SLUG, kind: 'medical' },
      member,
    );

    expect(medical.status).toBe(404);
    expect(exported.status).toBe(404);
    expect(await pageText(medical)).not.toContain(MEDICAL_NOTE);
    expect(await pageText(exported)).not.toContain(MEDICAL_NOTE);
  });

  it('refuses a session cookie that is not a session', async () => {
    // The token cookies are opaque to this Worker — `worker/session.ts` never checks a
    // signature itself, it asks Supabase Auth, which is what holds the signing key. Rubbish
    // in both must be the ordinary refusal rather than an error page.
    //
    // **The deadline is live on purpose.** An expired or missing `src_ax` is refused before
    // Supabase is asked anything, so leaving it off would make this test pass without ever
    // reaching the code it is about.
    const response = await get(
      `${NN}entries/${ADMIN_EVENT_SLUG}/`,
      `src_at=not.a.jwt; src_rt=not-a-refresh-token; src_ax=${Math.floor(Date.now() / 1000) + 3600}`,
    );

    expect(response.status).toBe(404);
    expect(await pageText(response)).not.toContain(AWKWARD_LAST_NAME);
  });

  it('refuses a super-admin at the race section, because a grant is not an inheritance', async () => {
    // **The fixture super-admin deliberately does not hold `nn-admin`.** Being the person who
    // hands roles out is not being the person who may read two hundred entrants' emergency
    // contacts, and if it were, `/admin/people/` would be a way to give yourself the entry
    // list without leaving a grant behind.
    const response = await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, superAdmin);

    expect(response.status).toBe(404);
    expect(await pageText(response)).not.toContain(AWKWARD_LAST_NAME);
  });

  it('refuses a nn-admin at the roles page, the other way round', async () => {
    const response = await get(PEOPLE, nnAdmin);

    expect(response.status).toBe(404);
    expect(await pageText(response)).not.toContain(SUPER_ADMIN_EMAIL);
  });

  it('refuses a people-admin at the race section, and at every address under it', async () => {
    // **The third corner of "a grant is not an inheritance".** `people-admin` reads the club's
    // whole address book, which is the largest disclosure on this surface after the entry
    // list — and it is emphatically not the entry list. Reading who has an account and reading
    // two hundred entrants' emergency contacts are different decisions, and holding one must
    // never be a way to reach the other.
    for (const address of [NN, `${NN}entries/${ADMIN_EVENT_SLUG}/`]) {
      const response = await get(address, peopleAdmin);

      expect(response.status, address).toBe(404);
      expect(await pageText(response), address).not.toContain(AWKWARD_LAST_NAME);
    }
  });

  it('refuses a people-admin the two POST actions that read special category data', async () => {
    const medical = await post(
      `${NN}medical/`,
      { entrantId: PAID_ENTRANT_ID },
      peopleAdmin,
    );
    const exported = await post(
      `${NN}export/`,
      { event: ADMIN_EVENT_SLUG, kind: 'medical' },
      peopleAdmin,
    );

    expect(medical.status).toBe(404);
    expect(exported.status).toBe(404);
    expect(await pageText(medical)).not.toContain(MEDICAL_NOTE);
    expect(await pageText(exported)).not.toContain(MEDICAL_NOTE);
  });

  it('answers 404 for an address under the prefix that nobody built', async () => {
    const response = await get('/admin/nowhere/', nnAdmin);

    expect(response.status).toBe(404);
    // Still `noindex`: falling through to the assets binding would have lost the header.
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('refuses assigning a place to anybody who does not hold nn.entry.create', async () => {
    // **The route is the control and the button is the courtesy.** `super-admin` cannot even
    // read this section, so it stands in here for "signed in, staff, and without this
    // permission" — the shape a future read-only role would take. A 403 would disclose that
    // the address exists, so it is the same 404 as everything else.
    //
    // Asserted on the POST rather than on the absence of a button, because a button is markup
    // and this is the thing that gives away places.
    const response = await post(`${NN}assign/`, { event: ADMIN_EVENT_SLUG }, superAdmin);

    expect(response.status).toBe(404);

    // And nothing was written on the way to refusing.
    const listing = await (
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin)
    ).text();
    expect(listing).not.toContain('Complimentary');
  });

  it('gives every refusal the same body, byte for byte', async () => {
    // **The non-disclosure assertion, and the reason all of this is a 404.** A stranger, a
    // member, the wrong staff role, an event that never existed and an address nobody built
    // are one answer. Anything that told them apart would let somebody with an account map
    // the club's back office by probing it.
    const bodies = await Promise.all(
      [
        await get(NN),
        await get(NN, member),
        await get(NN, superAdmin),
        await get(`${NN}entries/zz-no-such-event-at-all/`, nnAdmin),
        await get('/admin/nowhere/', nnAdmin),
      ].map((response) => response.text()),
    );

    for (const body of bodies) {
      expect(body).toBe(bodies[0]);
    }
  });

  it('lets the shell stylesheet through, which is not under the prefix', async () => {
    // `/admin.css` is a real file in `dist/`, emitted by `src/pages/admin.css.ts`. The
    // predicate matches `/admin` exactly or `/admin/` and below, never `/admin` as a prefix
    // of a longer segment — so this reaches the assets binding, and a 404 here would mean the
    // boundary had moved and every admin page had silently lost its styling.
    const response = await get('/admin.css');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
    expect(await response.text()).toContain('--colour-');
  });
});

// -----------------------------------------------------------------------------------------
// The shell
// -----------------------------------------------------------------------------------------

/**
 * The navigation, painted from `identity.my_roles()`.
 *
 * **Three role sets, because two would not show the difference.** A link to a page that 404s
 * is worse than no link: it tells somebody the page exists and refuses them, which is the
 * exact disclosure the 404 rule exists to avoid.
 */
describe('the navigation', () => {
  it('offers a nn-admin the race section and not the roles page', async () => {
    const body = await pageText(await get(ADMIN, nnAdmin));

    expect(body).toContain('href="/admin/nn/"');
    expect(body).not.toContain('href="/admin/people/"');
  });

  it('offers a super-admin the roles page and not the race section', async () => {
    const body = await pageText(await get(ADMIN, superAdmin));

    expect(body).toContain('href="/admin/people/"');
    expect(body).not.toContain('href="/admin/nn/"');
  });

  it('offers a people-admin the roles page and not the race section', async () => {
    // Painted from `identity.my_permissions()`, so the link and the door behind it cannot
    // disagree — and `/admin/people/`'s section names `identity.person.read` rather than
    // `identity.role.grant` for exactly this person: naming the grant would hide the page from
    // the only role that exists to look at it.
    const body = await pageText(await get(ADMIN, peopleAdmin));

    expect(body).toContain('href="/admin/people/"');
    expect(body).not.toContain('href="/admin/nn/"');
  });

  it('offers a plain registered account nothing, because there is no page to offer it on', async () => {
    const response = await get(ADMIN, member);
    const body = await pageText(response);

    expect(response.status).toBe(404);
    expect(body).not.toContain('href="/admin/nn/"');
    expect(body).not.toContain('href="/admin/people/"');
    expect(body).not.toContain('admin-nav');
  });

  it('always offers the way out, so the backend is not somewhere you get stranded', async () => {
    for (const [who, cookie] of [
      ['nn-admin', nnAdmin],
      ['super-admin', superAdmin],
      ['people-admin', peopleAdmin],
    ] as const) {
      const body = await pageText(await get(ADMIN, cookie));

      // Asserted as two facts rather than as one adjacency: Prettier decides where the
      // markup in an `html` template breaks, and a label that wrapped onto its own line
      // would fail a single `toContain` on markup that is perfectly correct.
      expect(body, who).toContain('class="admin-mast-out" href="/account/"');
      expect(body, who).toContain('My account');
    }
  });

  it('says which account somebody is signed in as', async () => {
    // **The email address rather than a role**, and that is the change from `/nn/admin`'s
    // handle: it is what stops a volunteer granting a role from the wrong one of two
    // accounts. The audit trail still records `auth.uid()`, which is asserted further down.
    const body = await pageText(await get(ADMIN, nnAdmin));

    expect(body).toContain('Signed in as');
    expect(body).toContain(NN_ADMIN_EMAIL);
  });

  it('is on every page of the surface, not only the dashboard', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('admin-nav');
    expect(body).toContain('href="/admin/nn/"');
  });
});

describe('what every admin response carries', () => {
  it('is noindex, twice, and never cached', async () => {
    for (const address of [ADMIN, NN, `${NN}entries/${ADMIN_EVENT_SLUG}/`, PEOPLE]) {
      const cookie = address === PEOPLE ? superAdmin : nnAdmin;
      const response = await get(address, cookie);

      expect(response.status, address).toBe(200);
      // The header is what a crawler that never renders the page obeys; the meta element is
      // what survives somebody saving it. Neither depends on a site-wide setting.
      expect(response.headers.get('x-robots-tag'), address).toBe('noindex, nofollow');
      expect(response.headers.get('cache-control'), address).toBe('no-store');
      expect(await pageText(response), address).toContain(
        'name="robots" content="noindex, nofollow"',
      );
    }
  });

  it('is drawn in the club brand and never in the campaign theme', async () => {
    // `nn-theme.css` must never reach this surface: it is a tool rather than a page a runner
    // reads, and it will serve Pass the Buck, which has nothing to do with Halloween.
    const body = await pageText(await get(ADMIN, nnAdmin));

    expect(body).toContain('href="/admin.css"');
    expect(body).not.toContain('nn-theme');
  });
});

describe('the dashboard', () => {
  it('names what a nn-admin may open and nothing they may not', async () => {
    const response = await get(ADMIN, nnAdmin);
    const body = await pageText(response);

    expect(response.status).toBe(200);
    expect(body).toContain('Club admin');
    expect(body).toContain('the entries, the interest list, the medical notes and the');
    expect(body).not.toContain('who may open what');
  });

  it('names what a super-admin may open and nothing they may not', async () => {
    const body = await pageText(await get(ADMIN, superAdmin));

    expect(body).toContain('who may open what');
    expect(body).not.toContain('the interest list, the medical notes');
  });

  it('tells a people-admin the roles page is a read, before they follow the link', async () => {
    // **Said here rather than discovered there.** Somebody who follows this link expecting to
    // grant a role and meets a table with no buttons reads it as a page that has failed to
    // load, and somebody who thinks that goes looking for a second way to do it.
    const body = await pageText(await get(ADMIN, peopleAdmin));

    expect(body).toContain('who may open what — to read');
    expect(body).not.toContain('the interest list, the medical notes');
  });

  it('states no figure, because a number here would be the first one to go stale', async () => {
    const body = withoutMasthead(await pageText(await get(ADMIN, nnAdmin)));

    // The race's figures are on `/admin/nn/`, computed by the database in the same query that
    // lists the entries, which is what stops two panels disagreeing.
    expect(body).not.toContain('Places taken');
    expect(body).not.toContain('paid');
  });
});

// -----------------------------------------------------------------------------------------
// The Nightingale Nightmare section
// -----------------------------------------------------------------------------------------

describe('the race section, reached at its own address', () => {
  it('answers /admin/nn/ with the current running rather than a year in the route', async () => {
    // No year here, for the reason `/nn/` has none: which running is current is a row, and
    // publishing 2027 must not be an edit to this Worker.
    const response = await get(NN, nnAdmin);

    expect(response.status).toBe(200);

    const body = await pageText(response);
    expect(body).toContain('Nightingale Nightmare 2026');
    expect(body).toContain('Where the race stands');
  });
});

describe('the entries list', () => {
  it('shows every status, one row per entrant', async () => {
    // **`hide=none`, because the default view is not every status any more.** Test entries,
    // refunded entries and lapsed holds are left out unless asked for — on a race that fills
    // those are most of the rows and none of the work. This assertion is about *rendering* a
    // row of each kind, so it asks for the view that has them all; the default has its own
    // test below.
    const body = await pageText(
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/?hide=none`, nnAdmin),
    );

    expect(body).toContain('Nwosu, Harriet');
    expect(body).toContain('Adjei, Kwame');
    expect(body).toContain(`${PAID_NON_ASCII_LAST_NAME}, Lena`);
    expect(body).toContain('Toms, Marek');
  });

  it('leaves out everybody who is not running, unless asked', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // The lapsed hold is gone, the paid runner is not.
    expect(body).toContain('Nwosu, Harriet');
    expect(body).not.toContain('Adjei, Kwame');

    // **And the page says so.** Hiding rows without saying which is the half that would turn
    // a sensible default into a way of losing entries.
    expect(body).toContain('Refunded entries and lapsed holds are not shown.');
    expect(body).toContain('Test entries are not shown.');
  });

  it('lets an explicit status beat the default, so no chip is a dead end', async () => {
    // ⚠️ **#116 in a new place, and the reason `hideIsDefault` exists.** "Hidden beats
    // included" is right for a hide somebody *chose*; applied to the default it made the
    // **Hold expired** chip return an empty table and "0 of 6 shown" — a filter that can never
    // match, which is exactly how the Refunded filter convinced a volunteer there had been no
    // refunds.
    const body = await pageText(
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/?status=expired`, nnAdmin),
    );

    expect(body).toContain('Adjei, Kwame');

    // **And a hide somebody asked for still wins.** The default yields to a chip; a choice
    // does not.
    const chosen = await pageText(
      await get(
        `${NN}entries/${ADMIN_EVENT_SLUG}/?status=expired&hide=status:expired`,
        nnAdmin,
      ),
    );

    expect(chosen).not.toContain('Adjei, Kwame');
  });

  it('escapes a name and a club that would otherwise be markup', async () => {
    // **The seed's awkward entrant, and the assertion that stands in for an architecture.**
    // Every other page here is painted by `HTMLRewriter` in its escaping text mode; these
    // pages are built in the Worker, so the escaping is `worker/html.ts`'s and this is what
    // proves it on a real response.
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain(
      `${AWKWARD_LAST_NAME.replace("'", '&#39;')}, ${AWKWARD_FIRST_NAME}`,
    );
    expect(body).toContain('Bristol &amp; West AC, &quot;the Bees&quot;');
    expect(body).not.toContain(AWKWARD_CLUB);
  });

  it('makes an over-capacity payment impossible to miss, in words', async () => {
    // **Not a colour.** The words are what survive a printout, a monochrome screen and a
    // colour-blind reader, and this is the one row on the page that must reach somebody.
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('Needs a human');
    expect(body).toContain('Over capacity');
    expect(body).toContain('arrived after its place had gone');
  });

  it('counts places against capacity by the capacity predicate', async () => {
    // Three paid and one live hold against a capacity of two: four of two. An expired hold
    // and a refund are not counted, which is what `create_pending_purchase()` counts and
    // therefore what the page must say. Asserted as the whole figure rather than as a bare
    // `4`, which any inline SVG on the page would satisfy on its own.
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('>4</span> <span class="admin-fig-of">of 2</span>');
  });

  it('derives the category and shows no date of birth', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // Born 6 December 1986, race 6 December 2026. A birthday **on** race day counts.
    expect(body).toContain('Vet 40');
    expect(body).toContain('Vet 60');
    expect(body).not.toContain('1986-12-06');
    expect(body).not.toContain('06/12/1986');
  });

  it('shows no England Athletics number, and no column that would hold one', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // **Both halves, because either alone passes on a broken page.** Asserting the header is
    // gone would pass on a page still printing numbers in the stacked phone summary; asserting
    // no number appears would pass on a page keeping an empty column for somebody to fill in.
    // The number itself is one nothing can store — `entrants_ea_number_not_collected` — so it
    // is a value that must be absent rather than one the fixture happens not to have seeded.
    expect(body).not.toContain('EA number');
    expect(body).not.toContain(NEVER_STORED_EA_NUMBER);
  });

  it('shows the address to reach each row at, which it deliberately did not until #183', async () => {
    // **This asserted the opposite until 31 August 2026, and the reversal is the change.** The
    // old claim was that an organiser checking numbers or setting out bibs does not need an
    // address, which was true of the *start list* and not of this page: two runners with the
    // same name could only be told apart by opening the entry, and a volunteer ringing one of
    // them had to go looking for the number.
    //
    // **No new column is collected and no new audience sees one.** The address is already on
    // `/admin/nn/entry/` and in two of the three exports, behind the same `nn.entry.read`
    // permission. See the migration's header, and issue #183.
    //
    // **The masthead comes off first**: it names the signed-in volunteer's own address, which
    // is the whole point of it, and would satisfy any assertion about an address being present.
    const body = withoutMasthead(
      await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin)),
    );

    // The column, and the value in it. Both, because the header alone passes on a page with an
    // empty column and the value alone passes on a page printing addresses with no label.
    expect(body).toContain('Email');
    expect(body).toContain('harriet@example.com');
  });

  it('says a note exists and never what it says', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('Show note');
    expect(body).not.toContain('inhaler');
    expect(body).not.toContain('ibuprofen');
  });

  it('filters by status without putting anything personal in the query string', async () => {
    const body = await pageText(
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/?status=paid&sort=name`, nnAdmin),
    );

    expect(body).toContain('Nwosu, Harriet');
    expect(body).not.toContain('Adjei, Kwame');
    expect(body).not.toContain('Toms, Marek');
  });

  it('ignores a filter it does not recognise rather than failing', async () => {
    // A query string is somebody else's input. An unknown sort is `name` and an unknown
    // status is `all` — never an error page, and never a value reaching SQL.
    const response = await get(
      `${NN}entries/${ADMIN_EVENT_SLUG}/?status=%27%3B+drop&sort=../../etc`,
      nnAdmin,
    );

    expect(response.status).toBe(200);
    expect(await pageText(response)).toContain('Nwosu, Harriet');
  });

  it('offers exactly three ways to write anything: cancel, transfer and assign', async () => {
    /**
     * **Nothing on this surface writes to an entry, and the page is built so that is visible
     * rather than hidden.**
     *
     * Asserted on **where every form goes** rather than on the absence of words like
     * "Refund". The word is on the page legitimately — `Refunded` is one of the five statuses
     * a purchase can be in, and a chip saying so is a fact rather than a control — so a
     * substring test both failed on correct markup and would have passed on a button labelled
     * "Change this entry".
     *
     * **Three endpoints now rather than four**: the sign-out form has gone with the key
     * scheme, and the way out of the surface is the masthead's plain link to `/account/`.
     *
     * **And three of the seven write rather than one.** This assertion is the reason that
     * sentence had to be written down: adding transfer made this test fail, adding assign made
     * it fail again, and adding the detail page made it fail a third time — which is exactly
     * what it is for. A new way to alter, or to create, an entry should cost somebody a
     * deliberate edit here rather than arrive unremarked.
     *
     * **The count of *writes* is unchanged at three, and that is the point of keeping the
     * title.** Four of these seven endpoints only read; a `POST` is not a write, and the reason
     * four reads are POSTs at all is that no personal data may travel in a URL or a query
     * string. Somebody adding an eighth has to decide which half it belongs in and say so here.
     */
    const body = await (await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin)).text();

    const actions = new Set(
      [...body.matchAll(/<form[^>]*action="([^"]*)"/g)].map((match) => match[1] ?? ''),
    );

    expect(actions).toEqual(
      new Set([
        // One medical note, audited.
        '/admin/nn/medical/',
        // The three CSVs, audited.
        '/admin/nn/export/',
        // The printable start list, audited.
        '/admin/nn/start-list/',
        // **The printable medical sheet, audited as `medical_export`** — the same row the CSV
        // writes, because it is the same disclosure in a different wrapper. It takes a copy
        // out; it changes nothing, which is why it sits with the three above rather than with
        // the two below.
        '/admin/nn/medical-sheet/',
        // **The fourth, and the first endpoint on this surface that changes a record.**
        // #107 and ADR-018. The three above take a copy of something out; this one refunds a
        // payment and deletes an entrant, which is why it posts to a confirmation page rather
        // than doing it — the POST that arrives here changes nothing on its own.
        '/admin/nn/cancel/',
        // **The fifth, and the second that changes a record.** Same two-step shape as cancel
        // — the POST that arrives here renders the form and mints the token the real one has
        // to echo — but it takes no money and gives none back: the runner changes and the
        // place stays exactly where it is.
        '/admin/nn/transfer/',
        // **The sixth, and the only one that *creates* rather than alters.** It gives somebody
        // a place at no charge — ADR-028 — and it is the only endpoint here behind a
        // permission of its own, `nn.entry.create`, rather than behind `nn.entry.cancel`.
        //
        // **It appears here because this viewer holds `nn-admin`**, which is the only role
        // carrying `nn.entry.create`. Anybody else meets the same 404 the whole section gives
        // them — asserted just below — and the button is rendered behind `can()` as well, so
        // a future read-only role would meet no control rather than one that 404s.
        '/admin/nn/assign/',
        // **The seventh, and it reads.** ADR-023's page for one entry, reached from a Details
        // button on every row — the payment, the people, every ask, the emails owed and the
        // audit rows that name it.
        //
        // **A `POST` for the reason `/admin/nn/medical/` is one**, and it belongs in the top
        // half of this list rather than the bottom: no personal data goes in a URL or a query
        // string, ever, so the purchase id travels in the body. It changes nothing, mints no
        // CSRF token and writes no audit row — unlike the four reads above it, which each take
        // a copy of something out of the platform and are audited for it.
        //
        // It is offered on **every** row including a refunded one, because reading is the safe
        // act and a cancelled entry is exactly the row somebody most often needs the history
        // of. It needs only `nn.entry.read`, which is what opens this whole section.
        '/admin/nn/entry/',
      ]),
    );

    // And nothing that takes input beyond the hidden fields those seven need.
    expect(body).not.toContain('type="checkbox"');
    expect(body).not.toContain('type="text"');
    expect(body.toLowerCase()).not.toContain('<textarea');
    expect(body.toLowerCase()).not.toContain('<select');
  });
});

/**
 * The dashboard is one page, and this is the half of it that is not the table.
 *
 * **Every figure is asserted against the seeded rows rather than against a snapshot.** The
 * fixtures are six purchases on the oversold event — three paid (one of them flagged
 * `over_capacity`), one live hold, one expired hold and one refund — so each expectation below
 * is arithmetic somebody can check against `admin-db.ts` rather than a number copied out of a
 * passing run.
 */
describe('where the race stands', () => {
  it('states the breakdown the legend claims, from the rows that were seeded', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // Three paid: Nwosu, Sørensen (flagged) and Pemberton.
    expect(body).toContain('>3</span> paid');
    // One of those three is over capacity.
    expect(body).toContain('>1</span> over capacity');
    // One live hold — Inés O'Rourke.
    expect(body).toContain('>1</span> held right now');
    // One expired hold — Kwame Adjei. A place that came back. **Singular**, because there is
    // one of it: the legend agrees with its own count rather than reading "1 holds".
    expect(body).toContain('>1</span> hold expired and returned');
    // And one refund.
    expect(body).toContain('>1</span> refunded');
  });

  it('adds the fees the way the paid rows add up, and says whose figure is authoritative', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // Three paid affiliated entries at £15. Not £45 plus the £17 hold, which is not money.
    expect(body).toContain('£45.00');
    expect(body).toContain('Not net of card fees');
  });

  it('states a medical deletion date computed from the enforced retention', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // The fixture races on 6 December 2026 and `medical_retention` is one month. **This date
    // is `event_date + medical_retention` out of the database**, not a reading of
    // `race.json`'s published sentence — that one is `entries-retention.test.ts`'s to police.
    expect(body).toContain('6 January 2027');
    expect(body).toContain('one month after the race');
  });

  it('counts the affiliated entries and claims nothing about checking them', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // **The panel used to warn about affiliated entries with no number.** Every affiliated
    // entry is one of those since 29 August 2026, and correctly so — the club takes a runner's
    // word for it. The count survives because it is how many entries owe no Unattached Runner
    // Levy under ARC Rule 21(2)(b), which a treasurer has to be able to produce.
    expect(body).toContain('Affiliated entries');
    expect(body).toContain('paid entries took');
    expect(body).not.toContain('without giving a number');
  });

  it('says the closing time is undecided rather than inventing one', async () => {
    // **The one number on the approved design that could not be built.** The 2026 entry open
    // and close times are not confirmed, and a plausible date on this bar is one a volunteer
    // repeats to a runner who then arranges a weekend around it.
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('not decided yet');
  });
});

/**
 * The attention panel, in both directions.
 *
 * **Both halves are the requirement.** That it appears when something is flagged is the
 * obvious test; that it *stays away* when nothing is, is the one that keeps it worth reading.
 * A panel that is always on the page — with a zero in it, or an "all clear" — is a panel
 * somebody learns to scroll past, and this is the only thing on this surface with a deadline
 * attached to a person.
 */
describe('the panel for anything needing a human', () => {
  it('renders when a purchase is flagged, first on the page and in words', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('Needs a human');
    expect(body).toContain('arrived after its place had gone');
    // Ahead of the figures, because it is the only thing here with a person waiting on it.
    expect(body.indexOf('Needs a human')).toBeLessThan(
      body.indexOf('Where the race stands'),
    );
  });

  it('does not render at all when nothing is flagged', async () => {
    const body = await pageText(await get(`${NN}entries/${CLEAN_EVENT_SLUG}/`, nnAdmin));

    // The quiet event: two entries against ten places, nothing flagged.
    expect(body).toContain(CLEAN_PAID_LAST_NAME);
    expect(body).not.toContain('Needs a human');
    // **And no empty state and no zero badge.** Neither an "all clear" nor a nought.
    expect(body).not.toContain('0 need a human');
    expect(body).not.toContain('Nothing needs a human');
  });

  it('names an entry by reference rather than by name, in the queue itself', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // The panel is a list of decisions rather than of people, so it names an entry and the
    // names are in the table below.
    //
    // **It printed `entry …5555` until 31 August 2026** — the tail of a purchase id, with a
    // footnote under the panel explaining that the names were below, because a 36-character
    // hexadecimal reference could not be shown whole. ADR-030's reference can, and printing it
    // whole is what lets a volunteer match this queue against the email a runner is quoting.
    //
    // Matched on the shape rather than on a literal: the fixture's event slug and creation date
    // are the fixture's business, and a literal here would stop testing the moment either moved.
    expect(body).toMatch(/entry [A-Z0-9]+-\d{4,}-\d{8}/);
  });
});

/**
 * The filters, which are links.
 *
 * Not a form and not a `<select>`: the page works with scripting off, a filtered view is a URL
 * somebody can send to the other volunteer, and the back button behaves.
 */
describe('the filters', () => {
  it('are anchors carrying a query parameter, with no form and no script', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('?status=paid');
    expect(body).toContain('?status=attention');
    // The first pass used a GET form with three selects and an Apply button.
    expect(body).not.toContain('Apply');
    expect(body.toLowerCase()).not.toContain('<select');
    expect(body.toLowerCase()).not.toContain('<script');
  });

  it('marks the current one with aria-current rather than with a colour alone', async () => {
    const body = await pageText(
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/?status=paid`, nnAdmin),
    );

    expect(body).toContain('aria-current="true"');
  });

  it('returns what each one claims', async () => {
    const paid = await pageText(
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/?status=paid`, nnAdmin),
    );
    expect(paid).toContain('Nwosu, Harriet');
    expect(paid).not.toContain('Adjei, Kwame');

    const attention = await pageText(
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/?status=attention`, nnAdmin),
    );
    // Only the flagged row, which is the non-ASCII surname on the over-capacity purchase.
    expect(attention).toContain(PAID_NON_ASCII_LAST_NAME);
    expect(attention).not.toContain('Nwosu, Harriet');

    const expired = await pageText(
      await get(`${NN}entries/${ADMIN_EVENT_SLUG}/?status=expired`, nnAdmin),
    );
    expect(expired).toContain('Adjei, Kwame');
    expect(expired).not.toContain('Nwosu, Harriet');
  });

  it('puts no personal data in any link it renders', async () => {
    // **Read off the page rather than off one URL somebody navigated to.** Every `href` the
    // page offers is checked, so a filter added later that carried a name would fail here.
    const body = await (await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin)).text();

    const hrefs = [...body.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(hrefs.length).toBeGreaterThan(4);

    for (const href of hrefs) {
      for (const personal of [
        AWKWARD_LAST_NAME,
        AWKWARD_FIRST_NAME,
        'Nwosu',
        'Adjei',
        PAID_NON_ASCII_LAST_NAME,
        'example.com',
      ]) {
        expect(href, `${personal} must not appear in ${href}`).not.toContain(personal);
      }
    }
  });
});

/**
 * The start list as a page, which is the thing somebody actually uses under pressure.
 *
 * **A POST, because rendering it writes an audit row.** Printing a sheet of names and
 * emergency contacts is taking a copy out of the platform, exactly as the CSV is, so it goes
 * through `entries.export()` and is recorded the same way. A GET would let a prefetch, a
 * scanner or a link pasted into a chat client file an export against somebody's account.
 */
describe('the printable start list', () => {
  it('renders paid entries with their emergency contacts, and no medical note', async () => {
    const body = await pageText(
      await post(`${NN}start-list/`, { event: ADMIN_EVENT_SLUG }, nnAdmin),
    );

    expect(body).toContain('Start list');
    expect(body).toContain('Nwosu, Harriet');
    expect(body).toContain('Kin Nwosu');
    // Paid only: a lapsed hold is not a runner and a bib set out for one is a bib wasted.
    expect(body).not.toContain('Adjei, Kwame');
    // The notes are their own sheet, taken on purpose.
    expect(body).not.toContain('inhaler');
  });

  it('is not reachable by a GET, because it writes an audit row', async () => {
    const response = await get(`${NN}start-list/`, nnAdmin);

    expect(response.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------------------
// The interest list
// -----------------------------------------------------------------------------------------

describe('the interest list', () => {
  it('shows the sign-ups with their addresses, and says who may not be written to', async () => {
    const body = await pageText(await get(`${NN}interest/`, nnAdmin));

    // The seed's sign-ups. The address is the point of this list — the club promised these
    // people one email — and a withheld consent is shown rather than filtered out.
    expect(body).toContain('alice@example.com');
    expect(body).toContain('No — do not write');
  });

  it('escapes an apostrophe and leaves a non-ASCII name alone', async () => {
    const body = await pageText(await get(`${NN}interest/`, nnAdmin));

    expect(body).toContain('Dara O&#39;Sullivan');
    expect(body).toContain('Émile Boisvert');
  });
});

// -----------------------------------------------------------------------------------------
// One medical note, and the row that records who read it
// -----------------------------------------------------------------------------------------

describe('reading one medical note', () => {
  it('needs a POST, so no entrant id ever reaches a URL', async () => {
    // A GET would put the id in the address bar, in browser history and in a `Referer`. The
    // route does not exist as a GET at all.
    const response = await get(`${NN}medical/`, nnAdmin);

    expect(response.status).toBe(404);
  });

  it('shows the note for an entrant that has one', async () => {
    const response = await post(`${NN}medical/`, { entrantId: PAID_ENTRANT_ID }, nnAdmin);

    expect(response.status).toBe(200);
    expect(await pageText(response)).toContain('inhaler');
  });

  it('says plainly when there is no note, rather than looking broken', async () => {
    const response = await post(`${NN}medical/`, { entrantId: OVER_ENTRANT_ID }, nnAdmin);

    expect(response.status).toBe(200);
    expect(await pageText(response)).toContain('no note against this entry');
  });

  it('answers the same for an unknown id and for one that is not an id', async () => {
    const unknown = await post(
      `${NN}medical/`,
      { entrantId: '00000000-0000-4000-8000-000000000000' },
      nnAdmin,
    );
    const nonsense = await post(`${NN}medical/`, { entrantId: 'nonsense' }, nnAdmin);

    expect(unknown.status).toBe(404);
    expect(nonsense.status).toBe(404);
  });

  it('writes exactly one audit row, naming the caller’s uuid rather than a handle', async () => {
    /**
     * **The thing #58 could most easily have broken silently.** The audit trail is what
     * answers "who read this person's medical data", and the actor column changed identity
     * scheme underneath it: a handle out of `entries.admin_keys` became `auth.uid()`. A
     * surface that went on working while writing the wrong actor — or none — would look
     * perfect and be useless at exactly the moment somebody asked.
     *
     * The uuid is never asserted as a literal. It is resolved by **joining the recorded
     * string against `auth.users`** in the bridge's own query, so this passes only if the
     * string in the table really is the account that was signed in.
     */
    const before = await medicalReadAudit();

    const response = await post(`${NN}medical/`, { entrantId: PAID_ENTRANT_ID }, nnAdmin);
    expect(response.status).toBe(200);

    const after = await medicalReadAudit();
    expect(after.length).toBe(before.length + 1);

    const written = after[after.length - 1]!;
    expect(written.action).toBe('medical_note');
    expect(written.email).toBe(NN_ADMIN_EMAIL);
    expect(written.actor).not.toBe(ADMIN_HANDLE);
    expect(written.actor).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(written.detail).toMatchObject({ entrant_id: PAID_ENTRANT_ID, had_note: true });
  });

  it('is still found by the runbook’s question after the change of identity scheme', async () => {
    // **`action in ('medical_note', 'medical_export')` is the whole of the access-review
    // query**, and it has to keep returning the rows written before #58 as well as the ones
    // written after. `admin-db.ts` seeds one handle-era row as history, because the surface
    // can no longer produce one.
    await post(`${NN}medical/`, { entrantId: PAID_ENTRANT_ID }, nnAdmin);

    const rows = await medicalReadAudit();

    expect(rows.some((row) => row.actor === ADMIN_HANDLE && row.email === null)).toBe(
      true,
    );
    expect(rows.some((row) => row.email === NN_ADMIN_EMAIL)).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------
// The exports
// -----------------------------------------------------------------------------------------

describe('the exports', () => {
  /**
   * A CSV response, as **bytes and as text**, and the two are not interchangeable here.
   *
   * **`Response.text()` silently removes the byte-order mark.** The mark really is on the wire
   * — `csvDocument` puts it there and Excel needs it to read `Sørensen` as anything but
   * mojibake — but `text()` decodes UTF-8 with `TextDecoder`, whose default is to strip a
   * leading U+FEFF. So a test that asserts on the decoded string sees a file with no mark and
   * reports a bug that is not there; one that asserts the mark is *absent* would pass on a
   * file that would open wrong on every Windows machine the club owns.
   */
  async function csv(kind: string): Promise<{ bytes: Uint8Array; text: string }> {
    const response = await post(
      `${NN}export/`,
      { event: ADMIN_EVENT_SLUG, kind },
      nnAdmin,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain(
      `filename="${ADMIN_EVENT_SLUG}-${kind}.csv"`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await response.arrayBuffer());

    // Decoded with the mark kept, so `text` is the whole file rather than the file minus
    // three bytes — and so `split('\r\n')[0]` is the header row as written.
    const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false }).decode(
      bytes,
    );

    return { bytes, text };
  }

  /** `EF BB BF` — the UTF-8 encoding of U+FEFF, which is what is actually sent. */
  const UTF8_BOM = [0xef, 0xbb, 0xbf];

  it('gives the affiliated list exactly its columns, and no number column', async () => {
    const { text } = await csv('ea');

    // **The file kept its job and lost its subject.** It evidenced the £2 check against the
    // club's myAthletics access; nobody is asked for a number now, so what it answers is how
    // many entries took the affiliated price — the count ARC Rule 21(2)(b)'s Unattached Runner
    // Levy is assessed against, and the only document that says so.
    expect(text.split('\r\n')[0]).toBe(
      '﻿Last name,First name,Club,Phone,Entry type,Paid (pence)',
    );
    expect(text).not.toContain('EA number');
    expect(text).not.toContain(NEVER_STORED_EA_NUMBER);
    // The affiliated entries are on it, which is the half an empty file would also pass.
    expect(text).toContain('Nwosu');
    // **No emergency contact and no note.** The runner's own number *is* on it since ADR-025 —
    // the club asked for it on every export, and a treasurer reconciling ARC's levy against a
    // name they cannot place needs a way to ask. What stays off is the number belonging to
    // somebody else and the Article 9 note: this is a count of entries, not a race-day
    // document.
    expect(text).not.toContain('Kin ');
    expect(text).not.toContain('inhaler');
  });

  it('gives the start list its emergency contacts and no note', async () => {
    const { text } = await csv('start-list');

    // **"Runner phone" beside "Emergency phone", and the two words are the whole point.**
    // This file is opened in a spreadsheet by somebody who did not build it, and two columns
    // of numbers where one of them is a next of kin is a mistake worth a word. ADR-025.
    expect(text.split('\r\n')[0]).toBe(
      '﻿Last name,First name,Club,Category,Runner phone,Emergency contact,Emergency phone',
    );
    expect(text).toContain('Kin Nwosu');
    expect(text).toContain('Vet 40');
    expect(text).not.toContain('inhaler');
  });

  it('really sends the byte-order mark, asserted on the bytes', async () => {
    const { bytes, text } = await csv('start-list');

    expect([...bytes.slice(0, 3)]).toEqual(UTF8_BOM);
    expect(text).toContain('\r\n');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('escapes a club containing a comma and a quote, on a row that is in the file', async () => {
    // **The case that matters, on a paid entrant.** An earlier version of this put the
    // awkward club on the pending one — which is in no export at all, so the assertion passed
    // by never having the row to check. The whole line is asserted rather than a fragment: a
    // comma that escaped quoting would shift every column after it.
    const { text } = await csv('start-list');
    const row = text
      .split('\r\n')
      .find((line) => line.startsWith(PAID_NON_ASCII_LAST_NAME));

    expect(row).toBe(
      [
        PAID_NON_ASCII_LAST_NAME,
        'Lena',
        '"Bristol & West AC, ""the Bees"""',
        'Vet 60',
        // **The runner's own number, and it is the column before the contact's** —
        // ADR-025. Asserting the whole line rather than a fragment is what makes a new
        // column show up here as a failure rather than as a silent shift of everything
        // after the club.
        '0117 496 0100',
        `Kin ${PAID_NON_ASCII_LAST_NAME}`,
        '0117 496 0000',
      ].join(','),
    );
  });

  it('keeps a non-ASCII surname intact behind the byte-order mark', async () => {
    const { text } = await csv('start-list');

    expect(text).toContain(PAID_NON_ASCII_LAST_NAME);
  });

  it('carries only paid entries', async () => {
    // A pending hold is somebody halfway through a payment page and an expired one is a place
    // that came back. Neither is a runner.
    const { text } = await csv('start-list');

    expect(text).toContain('Nwosu');
    expect(text).not.toContain('Adjei');
    expect(text).not.toContain('Toms');
    expect(text).not.toContain(AWKWARD_LAST_NAME);
    expect(text).not.toContain(AWKWARD_FIRST_NAME);
  });

  it('refuses a kind nobody has argued for', async () => {
    const response = await post(
      `${NN}export/`,
      { event: ADMIN_EVENT_SLUG, kind: 'everything' },
      nnAdmin,
    );

    expect(response.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------------------
// 59 — people and roles, rebuilt by ADR-046
// -----------------------------------------------------------------------------------------
// ⚠️ **This whole block was written against the table with a button per role per person**, and
// every assertion in it was about that shape: three column headers, a `<form>` per control,
// "Grant nn-admin for …" as an accessible name, and — the one that says it out loud — a test
// called *"offers one deliberate act per role per person, never a multi-select"* asserting the
// page contained no checkbox and no Save. ADR-046 reverses that, so the assertions reverse
// with it.
//
// **One of them found a real regression rather than needing a rewrite**: the old table marked
// which row belonged to the person reading it, and the first draft of the rebuild dropped that.
// Somebody looking at a list containing themselves is one click from taking away their own way
// in, so it is back, and the test below is why.

/** The person id the list links to, read off the row rather than constructed. */
function personIdFor(markup: string, email: string): string {
  for (const chunk of markup.split('<a ').slice(1)) {
    if (!chunk.includes(email)) continue;
    const match = /[?&]person=([0-9a-f-]{36})/.exec(chunk);
    if (match) return match[1]!;
  }

  expect.fail(`no row on the roles page linking to ${email}`);
}

/**
 * The save form, and only it.
 *
 * The page carries a search form and — for a super-admin looking at somebody — a confirmation
 * form too, both of which have fields with the same names. `data-role-form` is the marker the
 * enhancement binds to, and it does the same job here.
 */
function roleForm(markup: string): string {
  const form = markup.split('data-role-form')[1]?.split('</form>')[0];
  expect(form, 'the roles page rendered no save form').toBeDefined();
  return form!;
}

/** Every role whose switch is rendered checked, which is what the person currently holds. */
function checkedRoles(markup: string): string[] {
  return [...roleForm(markup).split('<input').slice(1)]
    .filter((chunk) => chunk.includes('checked'))
    .map((chunk) => /value="([^"]*)"/.exec(chunk)?.[1] ?? '')
    .filter((value) => value !== '');
}

async function peoplePage(
  person: string | null = null,
  who: string = superAdmin,
): Promise<{ markup: string; csrfCookie: string }> {
  const path = person === null ? PEOPLE : `${PEOPLE}?person=${person}`;
  const response = await get(path, who);
  expect(response.status, `the roles page${person === null ? '' : ', one person'}`).toBe(
    200,
  );

  const csrfCookie = csrfCookieFrom(response);
  return { markup: await pageText(response), csrfCookie };
}

/**
 * Save a whole set of roles for one person, the way the page does it.
 *
 * **The expected set is read off the rendered page rather than constructed**, which is the
 * difference between testing the act and testing the endpoint: it is what a volunteer's browser
 * would actually send, and it is what `identity.set_roles()` compares against to detect that
 * somebody else got there first.
 */
async function saveRoles(
  email: string,
  wanted: string[],
  options: {
    csrfField?: string;
    sendCsrfCookie?: boolean;
    expected?: string[];
    as?: string;
  } = {},
): Promise<Response> {
  const who = options.as ?? superAdmin;
  const list = await peoplePage(null, who);
  const person = personIdFor(list.markup, email);
  const page = await peoplePage(person, who);
  const form = roleForm(page.markup);

  const csrf = /name="csrf_token" value="([^"]*)"/.exec(form)?.[1] ?? '';
  const expected =
    options.expected ??
    [...form.matchAll(/name="expected" value="([^"]*)"/g)].map((match) => match[1]!);

  const body: [string, string][] = [
    ['csrf_token', options.csrfField ?? csrf],
    ['action', 'save'],
    ['person', person],
    ...expected.map((role): [string, string] => ['expected', role]),
    ...wanted.map((role): [string, string] => ['role', role]),
  ];

  return post(
    PEOPLE,
    body,
    jar(who, options.sendCsrfCookie === false ? null : page.csrfCookie),
  );
}

describe('the roles page', () => {
  it('lists everybody with an account and the roles they hold', async () => {
    const { markup } = await peoplePage();

    expect(markup).toContain('People and roles');
    expect(markup).toContain(NN_ADMIN_EMAIL);
    expect(markup).toContain(REGISTERED_EMAIL);
    expect(markup).toContain(SUPER_ADMIN_EMAIL);
    expect(markup).toContain('A change applies on that person’s next request');
  });

  it('counts the club from the rows rather than stating a figure', async () => {
    // A hard-coded number on a page about access is a claim somebody acts on. Three figures,
    // each a count of real rows.
    const { markup } = await peoplePage();

    expect(markup).toContain('people');
    expect(markup).toContain('with admin roles');
    expect(markup).toContain('super admins');
  });

  it('marks the row belonging to whoever is reading it, and only that one', async () => {
    // **A super-admin looking at a list that includes themselves is one click from taking away
    // their own way in.** Which row is theirs is the one thing on this page that is not the
    // same for everybody reading it. The rebuild lost this and this assertion is what caught
    // it — worth keeping exactly as it was.
    const { markup } = await peoplePage();
    const rows = markup
      .split('<a ')
      .slice(1)
      .filter((row) => row.includes('@example.com') && row.includes('person='));

    expect(rows.length).toBeGreaterThanOrEqual(3);

    for (const row of rows) {
      expect(row.includes('admin-chip-you'), row.slice(0, 160)).toBe(
        row.includes(SUPER_ADMIN_EMAIL),
      );
    }
  });

  it('is a roles page rather than a member list', async () => {
    // **No date of birth and no address**, which is 59's requirement and is enforced by
    // `identity.list_people()` returning neither. The assertion is about what the page offers
    // rather than about the values, because the fixtures have neither recorded — asserting
    // one is absent would pass whatever the page did.
    const { markup } = await peoplePage(
      personIdFor((await peoplePage()).markup, REGISTERED_EMAIL),
    );

    expect(markup).toContain('role="switch"');
    expect(markup).not.toContain(AWKWARD_LAST_NAME);
    expect(markup).not.toContain('Nwosu');
    expect(markup).not.toContain('date of birth');
    expect(markup).not.toContain('emergency');
  });

  it('draws a switch for every grantable role and for neither reserved one', async () => {
    const { markup } = await peoplePage(
      personIdFor((await peoplePage()).markup, REGISTERED_EMAIL),
    );
    const form = roleForm(markup);

    expect(form).toContain('value="nn-admin"');
    expect(form).toContain('value="timing-marshal"');

    // **`registered` is held by everybody and grants nothing; `super-admin` is never in the
    // batch.** `identity.set_roles()` refuses a payload naming either, so this is the visible
    // half of a rule the database keeps.
    expect(form).not.toContain('value="registered"');
    expect(form).not.toContain('value="super-admin"');
  });

  it('carries the description the database holds, not one written here', async () => {
    const { markup } = await peoplePage(
      personIdFor((await peoplePage()).markup, REGISTERED_EMAIL),
    );

    expect(markup).toContain('May read Nightingale Nightmare entries.');
  });

  it('saves the whole set at once, which reverses what this page used to do', async () => {
    // ⚠️ **This assertion is the other way round on purpose.** It read *"offers one deliberate
    // act per role per person, never a multi-select"* and asserted the page contained no
    // checkbox and no Save, which is exactly the decision ADR-046 supersedes. The half of that
    // argument which survives is the audit trail, and it survives in `identity.set_roles()`
    // writing one row per role changed rather than in the shape of this form.
    const { markup } = await peoplePage(
      personIdFor((await peoplePage()).markup, REGISTERED_EMAIL),
    );

    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Save changes');

    // One form around the lot, not one per control.
    expect(roleForm(markup).split('<form').length).toBe(1);
  });

  it('sends the set it rendered as the expected state, so a lost race is detectable', async () => {
    const list = await peoplePage();
    const { markup } = await peoplePage(personIdFor(list.markup, NN_ADMIN_EMAIL));
    const form = roleForm(markup);

    expect(form).toContain('name="expected" value="nn-admin"');
  });

  it('offers super admin its own act, and never a switch', async () => {
    const list = await peoplePage();
    const { markup } = await peoplePage(personIdFor(list.markup, REGISTERED_EMAIL));

    expect(markup).toContain('Make super admin');
    expect(markup).toContain('confirm=super');
  });

  it('will not offer to remove the last super admin, and says why in visible text', async () => {
    // **A disabled control with a tooltip is unreachable by keyboard, invisible on a touch
    // screen and unread by most screen readers.** The control is not rendered at all and the
    // panel says so in words.
    const list = await peoplePage();
    const { markup } = await peoplePage(personIdFor(list.markup, SUPER_ADMIN_EMAIL));

    expect(markup).toContain('Cannot be removed');
    expect(markup).not.toContain('Remove super admin…');
  });
});

/**
 * The same page read by somebody who may not change it.
 *
 * **`identity.person.read` opens the page and `identity.role.grant` opens the controls on
 * it**, which is the whole of `people-admin`. The assertions worth having are the negative
 * ones: a role that reads the club's entire address book must not be one control away from
 * handing itself the entry list.
 */
describe('the roles page, read by a people-admin', () => {
  async function readOnly(person: string | null = null): Promise<string> {
    const path = person === null ? PEOPLE : `${PEOPLE}?person=${person}`;
    const response = await get(path, peopleAdmin);
    expect(response.status, 'the roles page, as a people-admin').toBe(200);
    return pageText(response);
  }

  it('shows the same people and the same roles', async () => {
    const markup = await readOnly();

    expect(markup).toContain('People and roles');
    expect(markup).toContain(NN_ADMIN_EMAIL);
    expect(markup).toContain(REGISTERED_EMAIL);
    expect(markup).toContain(SUPER_ADMIN_EMAIL);
  });

  it('offers no control at all, and says so rather than leaving a gap', async () => {
    const list = await readOnly();
    const markup = await readOnly(personIdFor(list, NN_ADMIN_EMAIL));

    // The controls are gone, not disabled — a disabled control is a thing somebody keeps
    // trying, and it would still name a person and a role.
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain('method="post"');
    expect(markup).not.toContain('csrf_token');
    expect(markup).not.toContain('Save changes');
    expect(markup).not.toContain('Make super admin');

    // And the page says which of its two readings this is, in words.
    expect(markup).toContain('You can see who holds what, and not change it');
  });

  /**
   * ⚠️ **The search box stays, and that is deliberate** — searching is reading, which is what
   * this role exists to do. The assertion this replaces was `not.toContain('<button')`, which
   * was true of a page that had no search box rather than a rule about this role.
   */
  it('keeps the search box, because searching is reading', async () => {
    const markup = await readOnly();

    expect(markup).toContain('Search people');
    expect(markup).toContain('method="get"');
  });

  it('still explains what each role means, because a slug is not an explanation', async () => {
    const list = await readOnly();
    const markup = await readOnly(personIdFor(list, NN_ADMIN_EMAIL));

    expect(markup).toContain('nn-admin');
    expect(markup).toContain('May read Nightingale Nightmare entries.');
  });

  it('sets no CSRF cookie, because there is no form to bind one to', async () => {
    const response = await get(PEOPLE, peopleAdmin);
    const pairs = setCookiePairs(response);

    expect(pairs.some((pair) => pair.startsWith('src_csrf='))).toBe(false);
  });

  it('refuses a hand-crafted save with a 404, and changes nothing', async () => {
    // **A page with no forms on it is not a gate.** The viewer can still write this request by
    // hand, so the act is refused in `handlePeopleSection` before the form is read — and the
    // database refuses them again underneath, which is the enforcement.
    const admin = await peoplePage();
    const person = personIdFor(admin.markup, PEOPLE_ADMIN_EMAIL);
    const csrf = /name="csrf_token" value="([^"]*)"/.exec(
      roleForm((await peoplePage(personIdFor(admin.markup, REGISTERED_EMAIL))).markup),
    )?.[1];

    const forged = await post(
      PEOPLE,
      [
        ['csrf_token', csrf ?? ''],
        ['action', 'save'],
        ['person', person],
        ['role', 'nn-admin'],
      ],
      jar(peopleAdmin, admin.csrfCookie),
    );

    expect(forged.status).toBe(404);

    // They did not give themselves the entry list.
    expect((await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, peopleAdmin)).status).toBe(
      404,
    );
  });

  it('refuses a hand-crafted super-admin confirmation the same way', async () => {
    const admin = await peoplePage();
    const person = personIdFor(admin.markup, PEOPLE_ADMIN_EMAIL);

    const forged = await post(
      PEOPLE,
      [
        ['csrf_token', 'whatever-this-page-would-have-minted'],
        ['action', 'super'],
        ['person', person],
        ['intent', 'grant'],
        ['typed', PEOPLE_ADMIN_EMAIL],
      ],
      jar(peopleAdmin, admin.csrfCookie),
    );

    expect(forged.status).toBe(404);
  });
});

describe('saving a set of roles', () => {
  it('refuses a save with no CSRF token, and changes nothing', async () => {
    // **The CSRF check comes first**, before the form is read for anything else: a request
    // that failed it is not a request from this page and nothing in it should be acted on. The
    // answer is the prefix's ordinary 404, so a forged POST learns nothing from it either.
    const forged = await saveRoles(REGISTERED_EMAIL, ['nn-admin'], {
      csrfField: 'not-the-token-this-page-minted',
    });

    expect(forged.status).toBe(404);
    expect((await get(NN, member)).status).toBe(404);
  });

  it('refuses a save when the cookie half of the pair is missing', async () => {
    const forged = await saveRoles(REGISTERED_EMAIL, ['nn-admin'], {
      sendCsrfCookie: false,
    });

    expect(forged.status).toBe(404);
    expect((await get(NN, member)).status).toBe(404);
  });

  /**
   * ⚠️ **Two volunteers on this page at once is the normal case rather than the edge one**, so
   * the loser of the race is told rather than silently overwritten. 409 because the request was
   * understood and refused, never a 500 — and the page comes back carrying what they actually
   * hold now.
   */
  it('refuses a save whose expected state has moved on, and says so', async () => {
    const stale = await saveRoles(REGISTERED_EMAIL, ['nn-admin'], {
      expected: ['timing-marshal'],
    });

    expect(stale.status).toBe(409);

    const body = await pageText(stale);
    expect(body).toContain('Somebody else changed this person’s roles');
    expect(body).toContain('role="alert"');

    // And nothing was written.
    expect((await get(NN, member)).status).toBe(404);
  });

  it('refuses a batch naming a role this club does not have, and writes none of it', async () => {
    const refused = await saveRoles(REGISTERED_EMAIL, ['nn-admin', 'chief-wizard']);

    // 422 rather than 409: the request was malformed rather than beaten to it.
    expect(refused.status).toBe(422);
    expect(await pageText(refused)).toContain('not a role this club has');

    // **Neither role landed**, which is the atomicity claim stated as a test.
    expect((await get(NN, member)).status).toBe(404);
  });

  it('saves, and it takes effect on the very next request', async () => {
    // **No session to end and nothing for the person to do.** `identity.my_roles()` is asked
    // per request rather than baked into the token, which is the whole reason this page can
    // be useful at nine on race morning.
    expect((await get(NN, member)).status).toBe(404);

    const saved = await saveRoles(REGISTERED_EMAIL, ['nn-admin']);

    // 303 rather than the page re-rendered, so a reload does not repeat the act, and back to
    // the person who was being changed rather than to the top of the list.
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toContain('person=');
    expect(saved.headers.get('location')).toContain('saved=1');

    const opened = await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, member);
    expect(opened.status).toBe(200);
    expect(await pageText(opened)).toContain('Nwosu, Harriet');
  });

  it('shows the new role as a switch that is on, and says the save landed', async () => {
    const list = await peoplePage();
    const person = personIdFor(list.markup, REGISTERED_EMAIL);
    const response = await get(`${PEOPLE}?person=${person}&saved=1`, superAdmin);
    const markup = await pageText(response);

    expect(checkedRoles(markup)).toContain('nn-admin');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Saved.');
  });

  it('takes several roles in one save, and each is audited on its own', async () => {
    // **One row per role changed**, which is the half of the superseded decision that survives
    // — an accidental revoke is as visible afterwards as it ever was.
    const saved = await saveRoles(REGISTERED_EMAIL, ['nn-admin', 'nn-results']);
    expect(saved.status).toBe(303);

    const list = await peoplePage();
    const { markup } = await peoplePage(personIdFor(list.markup, REGISTERED_EMAIL));

    expect(checkedRoles(markup)).toEqual(
      expect.arrayContaining(['nn-admin', 'nn-results']),
    );
  });

  it('revokes by leaving the switch off, and that also takes effect next request', async () => {
    const revoked = await saveRoles(REGISTERED_EMAIL, []);

    expect(revoked.status).toBe(303);

    const closed = await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, member);
    expect(closed.status).toBe(404);
    expect(await pageText(closed)).not.toContain('Nwosu, Harriet');
  });

  /**
   * ⚠️ **Super admin is not in the batch, so this is the only way to ask for it** — and the
   * batch refusing it is what means `revoke_role()`'s last-holder guard needs no second copy.
   */
  it('refuses a batch that names super admin at all', async () => {
    const refused = await saveRoles(REGISTERED_EMAIL, ['super-admin']);

    expect(refused.status).toBe(422);
    expect(await pageText(refused)).toContain('Super admin has its own button');
  });

  it('refuses the wrong typed name on the super-admin confirmation, and changes nothing', async () => {
    const list = await peoplePage();
    const person = personIdFor(list.markup, REGISTERED_EMAIL);
    const page = await peoplePage(person);

    const csrf = /name="csrf_token" value="([^"]*)"/.exec(roleForm(page.markup))?.[1];

    const refused = await post(
      PEOPLE,
      [
        ['csrf_token', csrf ?? ''],
        ['action', 'super'],
        ['person', person],
        ['intent', 'grant'],
        ['typed', 'not the right name'],
      ],
      jar(superAdmin, page.csrfCookie),
    );

    expect(refused.status).toBe(422);

    const body = await pageText(refused);
    expect(body).toContain('did not match');
    expect(body).toContain('role="alert"');

    // ⚠️ **Back to the confirmation rather than to the pane behind it.** A POST carries no
    // query string, so an earlier draft re-rendered the person's switches and attached this
    // message to a screen nobody was looking at — the typed-name box is the whole of the
    // screen it belongs to.
    expect(body).toContain('to confirm');
  });

  it('refuses to revoke the last super-admin, in words somebody can act on', async () => {
    /**
     * **A club with no super-admin has no way back in** — there is no service-role key in
     * this repository, on any laptop, or in any Worker. The refusal is the database's, in
     * `identity.revoke_role()`, and the page does not even offer the control — so this posts
     * it by hand, which is the assertion that the page is not the guard.
     *
     * **Last in the file deliberately.** If this ever stops being refused, the fixture
     * super-admin loses the role mid-run, and everything after it would fail for a reason
     * that had nothing to do with what it was testing.
     */
    const list = await peoplePage();
    const person = personIdFor(list.markup, SUPER_ADMIN_EMAIL);
    const page = await peoplePage(personIdFor(list.markup, REGISTERED_EMAIL));
    const csrf = /name="csrf_token" value="([^"]*)"/.exec(roleForm(page.markup))?.[1];

    const refused = await post(
      PEOPLE,
      [
        ['csrf_token', csrf ?? ''],
        ['action', 'super'],
        ['person', person],
        ['intent', 'revoke'],
        ['typed', SUPER_ADMIN_EMAIL],
      ],
      jar(superAdmin, page.csrfCookie),
    );

    expect(refused.status).toBe(422);

    const body = await pageText(refused);
    expect(body).toContain('That is the last super-admin');
    expect(body).toContain('Grant the role to somebody else first');
    expect(body).toContain('role="alert"');

    // And they still hold it.
    expect((await get(PEOPLE, superAdmin)).status).toBe(200);
  });
});
