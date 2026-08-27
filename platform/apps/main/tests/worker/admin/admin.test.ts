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
  PAID_EA_NUMBER,
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

/** `worker/admin-people.ts`'s caption id, written out rather than imported — this file asserts
 *  markup, and an expectation read from the module that produced it asserts nothing. */
const CAPTION_ID = 'people-table-caption';

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
 */
function squash(markup: string): string {
  return markup.replace(/\s+/g, ' ');
}

async function pageText(response: Response): Promise<string> {
  return squash(await response.text());
}

/**
 * Every cookie a response sets, as `name=value`, with the cleared ones dropped.
 *
 * **All of them, which is why this is not `headers.get('set-cookie')`.** A sign-in sets two —
 * `src_at` and `src_rt` — and a single `get` returns whichever the runtime happens to join or
 * pick, so a session built from one of them would be refused the moment the access token was
 * near expiry and the refresh token was the half that had been dropped.
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
  body: Record<string, string>,
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
    // The two cookies are opaque to this Worker — `worker/session.ts` never checks a
    // signature itself, it asks Supabase Auth, which is what holds the signing key. Rubbish
    // in both must be the ordinary refusal rather than an error page.
    const response = await get(
      `${NN}entries/${ADMIN_EVENT_SLUG}/`,
      'src_at=not.a.jwt; src_rt=not-a-refresh-token',
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
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('Nwosu, Harriet');
    expect(body).toContain('Adjei, Kwame');
    expect(body).toContain(`${PAID_NON_ASCII_LAST_NAME}, Lena`);
    expect(body).toContain('Toms, Marek');
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

  it('shows the England Athletics number for an affiliated entry', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // The £2 check nobody has been able to do since 2018.
    expect(body).toContain(PAID_EA_NUMBER);
  });

  it('shows no entrant’s email address anywhere', async () => {
    // Not the entrant's and not the purchaser's. An organiser checking numbers or setting out
    // bibs does not need one. **The masthead comes off first**: it names the signed-in
    // volunteer's own address, which is the whole point of it.
    const body = withoutMasthead(
      await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin)),
    );

    expect(body).not.toContain('@example.com');
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

  it('offers exactly two ways to change anything: cancel and transfer', async () => {
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
     * **And two of the five change a record rather than one.** This assertion is the reason
     * that sentence had to be written down: adding transfer made this test fail, which is
     * exactly what it is for. A second way to alter an entry somebody paid for should cost
     * somebody a deliberate edit here, not arrive unremarked.
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
      ]),
    );

    // And nothing that takes input beyond the hidden fields those three need.
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
 * `over_capacity`, one of them affiliated with no England Athletics number), one live hold,
 * one expired hold and one refund — so each expectation below is arithmetic somebody can check
 * against `admin-db.ts` rather than a number copied out of a passing run.
 */
describe('where the race stands', () => {
  it('states the breakdown the legend claims, from the rows that were seeded', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    // Three paid: Nwosu, Sørensen (flagged) and Pemberton (no EA number).
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

  it('names the affiliated claim that gave no number', async () => {
    const body = await pageText(await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, nnAdmin));

    expect(body).toContain('without giving a number');
    expect(body).toContain('claimed the affiliated price');
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

    // The panel is a list of decisions, so it carries the last four characters of a purchase
    // id. The names are in the table below, where a list of people belongs.
    expect(body).toContain('entry …');
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
        PAID_EA_NUMBER,
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

  it('gives the England Athletics check exactly its columns', async () => {
    const { text } = await csv('ea');

    expect(text.split('\r\n')[0]).toBe(
      '﻿Last name,First name,Club,EA number,Entry type,Paid (pence)',
    );
    expect(text).toContain(PAID_EA_NUMBER);
    // No emergency contact and no note: a membership secretary is comparing numbers.
    expect(text).not.toContain('Kin ');
    expect(text).not.toContain('inhaler');
  });

  it('gives the start list its emergency contacts and no note', async () => {
    const { text } = await csv('start-list');

    expect(text.split('\r\n')[0]).toBe(
      '﻿Last name,First name,Club,Category,Emergency contact,Emergency phone',
    );
    expect(text).toContain('Kin Nwosu');
    expect(text).toContain('Vet 40');
    expect(text).not.toContain('inhaler');
  });

  it('gives the medical export the note, and nothing beyond a name and a club', async () => {
    const { text } = await csv('medical');

    expect(text.split('\r\n')[0]).toBe('﻿Last name,First name,Club,Medical note');
    expect(text).toContain('inhaler');
    expect(text).not.toContain('Kin Nwosu');
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
// #59 — people and roles
// -----------------------------------------------------------------------------------------

/** The hidden fields of one grant-or-revoke form, read off the page that offered it. */
type RoleForm = Record<string, string>;

/**
 * The person rows, and only those — the masthead, the nav and the table header are excluded.
 *
 * **A naive `markup.split('<tr>')` is not safe here, and this file found out why.** The
 * masthead renders "Signed in as {viewer.label}" — #58's own improvement over a handle — so
 * whenever the signed-in person's row is the one being looked for, their address is *also* on
 * the page before the first `<tr>` at all. `split('<tr>')`'s first element is everything up to
 * that point, it contains the address, and a filter or a `.find()` over the raw split treats
 * it as a row: no `admin-chip`, no `<form>`, and every assertion about "their own row" or "the
 * super-admin's own control" fails on a segment that is not a row at all. Splitting on
 * `<tbody>` first discards the masthead and the header row before `<tr>` is ever considered.
 */
function tableRows(markup: string): string[] {
  const body = markup.split('<tbody>')[1];
  expect(body, 'the roles page rendered no table body').toBeDefined();

  return body!.split('<tr>').slice(1);
}

/**
 * The form the roles page offers for one person and one role.
 *
 * **Read off the rendered page rather than constructed**, which is the difference between
 * testing the act and testing the endpoint: the person id, the CSRF token and whether the
 * control says Grant or Revoke all come from what a volunteer would actually click.
 */
function roleFormFor(markup: string, email: string, role: string): RoleForm {
  const row = tableRows(markup).find((chunk) => chunk.includes(email));
  expect(row, `no row for ${email} on the roles page`).toBeDefined();

  const forms = row!
    .split('<form')
    .slice(1)
    .map((chunk) => {
      const fields: RoleForm = {};
      for (const field of chunk.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
        fields[field[1]!] = field[2]!;
      }
      return fields;
    });

  const form = forms.find((fields) => fields['role'] === role);
  expect(form, `no ${role} control for ${email}`).toBeDefined();

  return form!;
}

async function peoplePage(): Promise<{ markup: string; csrfCookie: string }> {
  const response = await get(PEOPLE, superAdmin);
  expect(response.status, 'the roles page').toBe(200);

  const csrfCookie = csrfCookieFrom(response);
  return { markup: await pageText(response), csrfCookie };
}

/**
 * Grant or revoke one role, the way the page does it.
 *
 * The expected action is asserted rather than read, so a page offering "Grant" where the
 * person already holds the role fails here instead of somewhere confusing later.
 */
async function changeRole(
  action: 'grant' | 'revoke',
  email: string,
  role: string,
  options: { csrfField?: string; sendCsrfCookie?: boolean } = {},
): Promise<Response> {
  const { markup, csrfCookie } = await peoplePage();
  const form = roleFormFor(markup, email, role);

  expect(form['action'], `the control offered for ${email}/${role}`).toBe(action);

  return post(
    PEOPLE,
    {
      csrf_token: options.csrfField ?? form['csrf_token']!,
      action,
      person: form['person']!,
      role,
    },
    jar(superAdmin, options.sendCsrfCookie === false ? null : csrfCookie),
  );
}

describe('the roles page', () => {
  it('lists everybody with an account and the roles they hold', async () => {
    const { markup } = await peoplePage();

    expect(markup).toContain('People and roles');
    expect(markup).toContain(NN_ADMIN_EMAIL);
    expect(markup).toContain(REGISTERED_EMAIL);
    expect(markup).toContain(SUPER_ADMIN_EMAIL);
    expect(markup).toContain('A role takes effect on their next request');
  });

  it('marks the row belonging to whoever is reading it, and only that one', async () => {
    // A super-admin looking at a list that includes themselves is about to be one click from
    // revoking their own way in. Which row is theirs is the one thing on this page that is
    // not the same for everybody reading it.
    const { markup } = await peoplePage();
    const rows = tableRows(markup).filter((row) => row.includes('@example.com'));

    expect(rows.length).toBeGreaterThanOrEqual(3);

    for (const row of rows) {
      expect(row.includes('admin-chip'), row.slice(0, 120)).toBe(
        row.includes(SUPER_ADMIN_EMAIL),
      );
    }
  });

  it('is a roles page rather than a member list', async () => {
    // **No date of birth and no address**, which is #59's requirement and is enforced by
    // `identity.list_people()` returning neither. Three columns, and nothing from `entries`.
    const { markup } = await peoplePage();

    expect(markup).toContain('<th scope="col">Person</th>');
    expect(markup).toContain('<th scope="col">Roles</th>');
    expect(markup).toContain('<th scope="col">Change</th>');
    expect(markup).not.toContain(AWKWARD_LAST_NAME);
    expect(markup).not.toContain('Nwosu');
    expect(markup).not.toContain('date of birth');
  });

  it('names the person and the role in every control, for a screen reader', async () => {
    // Without it a screen reader meets four buttons all called "Grant" and has to infer from
    // the table which row it is standing in.
    const { markup } = await peoplePage();
    const row = tableRows(markup).find((chunk) => chunk.includes(REGISTERED_EMAIL))!;

    // **The accessible name of each button, whole.** The visible half is two words and the
    // half that names the person is a visually hidden span, so the assertion is on the
    // button's text content with its tags taken out rather than on the markup between them —
    // Prettier decides where that markup breaks, and this must not.
    const names = [...row.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
      squash(match[1]!.replace(/<[^>]*>/g, '')).trim(),
    );

    expect(names).toContain(`Grant nn-admin for ${REGISTERED_EMAIL}`);
    expect(names).toContain(`Grant super-admin for ${REGISTERED_EMAIL}`);
    // Two controls, two distinct names — never four buttons all called "Grant".
    expect(new Set(names).size).toBe(names.length);
  });

  it('offers one deliberate act per role per person, never a multi-select', async () => {
    const { markup } = await peoplePage();

    expect(markup).not.toContain('type="checkbox"');
    expect(markup.toLowerCase()).not.toContain('<select');
    expect(markup).not.toContain('Save');
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
  async function readOnlyPage(): Promise<Response> {
    const response = await get(PEOPLE, peopleAdmin);
    expect(response.status, 'the roles page, as a people-admin').toBe(200);
    return response;
  }

  it('shows the same people and the same roles', async () => {
    const markup = await pageText(await readOnlyPage());

    expect(markup).toContain('People and roles');
    expect(markup).toContain(NN_ADMIN_EMAIL);
    expect(markup).toContain(REGISTERED_EMAIL);
    expect(markup).toContain(SUPER_ADMIN_EMAIL);
  });

  it('offers no control at all, and says so rather than leaving a gap', async () => {
    const markup = await pageText(await readOnlyPage());

    // The column is gone, not disabled — a disabled button is a thing somebody keeps trying.
    expect(markup).not.toContain('<th scope="col">Change</th>');
    expect(markup).not.toContain('admin-inline-form');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('csrf_token');
    expect(markup).not.toContain('A role takes effect on their next request');

    // And the page says which of its two readings this is, in words.
    expect(markup).toContain('You can see who holds what, and not change it');
  });

  it('still explains what each role means, because the column is otherwise slugs', async () => {
    // `identity.grantable_roles()` answers a reader for exactly this: the legend is the only
    // thing on the page that resolves `nn-tester`, and it discloses what a word means rather
    // than who holds it.
    const markup = await pageText(await readOnlyPage());

    expect(markup).toContain('What these roles allow');
    expect(markup).toContain('nn.entry.before_open');
  });

  it('leaves the scrolling table reachable by keyboard with no buttons in it', async () => {
    /**
     * **The defect this page had for exactly one commit, and only mobile-safari reported it.**
     * `.admin-scroll` scrolls sideways at narrow widths, and axe's
     * `scrollable-region-focusable` is satisfied either by the region being focusable or by it
     * containing something focusable. Every previous version of this table contained a Grant
     * button on every row, so it passed by accident. Take the controls away and there is
     * nothing focusable inside it at all — somebody navigating by keyboard at 375px cannot
     * scroll it, and the Roles column is unreachable to them.
     *
     * Chromium was quiet because the table does not overflow at desktop width, and a region
     * that does not scroll is not a scrollable region. Asserted here as markup as well as in
     * `admin.spec.ts`'s axe pass, because the axe pass runs on one engine at one width and
     * this is the property, not the symptom.
     */
    const markup = await pageText(await readOnlyPage());

    expect(markup).toContain('class="admin-scroll" tabindex="0" role="region"');
    expect(markup).toContain(`aria-labelledby="${CAPTION_ID}"`);
    expect(markup).toContain(`id="${CAPTION_ID}"`);
  });

  it('sets no CSRF cookie, because there is no form to bind one to', async () => {
    // Minting one anyway would set a cookie on every read this role makes for the rest of the
    // season, with no POST that could ever spend it. Asserted through `setCookiePairs` rather
    // than `csrfCookieFrom`, which exists to fail when the cookie is *missing*.
    const pairs = setCookiePairs(await readOnlyPage());

    expect(pairs.some((pair) => pair.startsWith('src_csrf='))).toBe(false);
  });

  it('refuses a hand-crafted grant with a 404, and changes nothing', async () => {
    // **A page with no forms on it is not a gate.** The viewer can still write this request by
    // hand, so the act is refused in `handlePeopleSection` before the form is read — and
    // `identity.grant_role()` refuses them again underneath, which is the enforcement.
    const { markup, csrfCookie } = await peoplePage();
    const form = roleFormFor(markup, PEOPLE_ADMIN_EMAIL, 'nn-admin');

    const forged = await post(
      PEOPLE,
      {
        csrf_token: form['csrf_token']!,
        action: 'grant',
        person: form['person']!,
        role: 'nn-admin',
      },
      jar(peopleAdmin, csrfCookie),
    );

    expect(forged.status).toBe(404);

    // They did not give themselves the entry list.
    expect((await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, peopleAdmin)).status).toBe(
      404,
    );
  });

  it('refuses a hand-crafted revoke the same way', async () => {
    const { markup, csrfCookie } = await peoplePage();
    const form = roleFormFor(markup, NN_ADMIN_EMAIL, 'nn-admin');

    const forged = await post(
      PEOPLE,
      {
        csrf_token: form['csrf_token']!,
        action: 'revoke',
        person: form['person']!,
        role: 'nn-admin',
      },
      jar(peopleAdmin, csrfCookie),
    );

    expect(forged.status).toBe(404);

    // And the nn-admin still holds it.
    expect((await get(NN, nnAdmin)).status).toBe(200);
  });
});

describe('granting and revoking a role', () => {
  it('refuses a grant with no CSRF token, and changes nothing', async () => {
    // **The CSRF check comes first**, before the form is read for anything else: a request
    // that failed it is not a request from this page and nothing in it should be acted on. The
    // answer is the prefix's ordinary 404, so a forged POST learns nothing from it either.
    const forged = await changeRole('grant', REGISTERED_EMAIL, 'nn-admin', {
      csrfField: 'not-the-token-this-page-minted',
    });

    expect(forged.status).toBe(404);

    // And the member is still a member.
    expect((await get(NN, member)).status).toBe(404);
  });

  it('refuses a grant when the cookie half of the pair is missing', async () => {
    const forged = await changeRole('grant', REGISTERED_EMAIL, 'nn-admin', {
      sendCsrfCookie: false,
    });

    expect(forged.status).toBe(404);
    expect((await get(NN, member)).status).toBe(404);
  });

  it('grants nn-admin, and it takes effect on the very next request', async () => {
    // **No session to end and nothing for the person to do.** `identity.my_roles()` is asked
    // per request rather than baked into the token, which is the whole reason this page can
    // be useful at nine on race morning.
    expect((await get(NN, member)).status).toBe(404);

    const granted = await changeRole('grant', REGISTERED_EMAIL, 'nn-admin');

    // 303 rather than the list re-rendered, so a reload does not repeat the act.
    expect(granted.status).toBe(303);
    expect(granted.headers.get('location')).toBe(PEOPLE);

    const opened = await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, member);
    expect(opened.status).toBe(200);
    expect(await pageText(opened)).toContain('Nwosu, Harriet');
  });

  it('shows the new role on the page, and offers to take it away again', async () => {
    const { markup } = await peoplePage();
    const row = tableRows(markup).find((chunk) => chunk.includes(REGISTERED_EMAIL))!;

    expect(row).toContain('nn-admin, registered');
    expect(roleFormFor(markup, REGISTERED_EMAIL, 'nn-admin')['action']).toBe('revoke');
  });

  it('revokes it again, and that also takes effect on the next request', async () => {
    const revoked = await changeRole('revoke', REGISTERED_EMAIL, 'nn-admin');

    expect(revoked.status).toBe(303);

    const closed = await get(`${NN}entries/${ADMIN_EVENT_SLUG}/`, member);
    expect(closed.status).toBe(404);
    expect(await pageText(closed)).not.toContain('Nwosu, Harriet');
  });

  it('refuses to revoke the last super-admin, in words somebody can act on', async () => {
    /**
     * **A club with no super-admin has no way back in** — there is no service-role key in
     * this repository, on any laptop, or in any Worker. The refusal is the database's, in
     * `identity.revoke_role()`, and this asserts that the page turns it into a sentence
     * rather than a shrug.
     *
     * **Last in the file deliberately.** If this ever stops being refused, the fixture
     * super-admin loses the role mid-run, and everything after it would fail for a reason
     * that had nothing to do with what it was testing.
     */
    const refused = await changeRole('revoke', SUPER_ADMIN_EMAIL, 'super-admin');

    // The list, re-rendered with the refusal on it — not a redirect, because nothing changed.
    expect(refused.status).toBe(200);

    const body = await pageText(refused);
    expect(body).toContain('That is the last super-admin');
    expect(body).toContain('Grant the role to somebody else first');
    expect(body).toContain('role="alert"');

    // And they still hold it.
    expect((await get(PEOPLE, superAdmin)).status).toBe(200);
  });
});
