import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_PASSWORD,
  REGISTERED_EMAIL,
  NN_ADMIN_EMAIL,
  NN_TESTER_EMAIL,
} from '../../admin-fixtures';

/**
 * `nn-tester` seen from the outside — through the real Worker, over the real routes, with a
 * real session.
 *
 * ## Why this lives in the admin run rather than the default one
 *
 * It needs **accounts**, and `tests/worker/admin/global-setup.ts` is the only setup that
 * creates any. The default worker run asserts things that are only true of a database with no
 * fixture people in it, which is the same reason the admin suite has its own config.
 *
 * ## What this proves that `packages/db/tests/entries-tester.test.ts` cannot
 *
 * That file proves the database refuses the right people. **This proves the Worker asks it the
 * right question** — which is a separate failure, and the more likely one: the Worker reached
 * `entry_state()` through an anonymous client for its whole life before #107, and a client
 * built from the anon key alone resolves `auth.uid()` to null. A tester served through one
 * would be told entries are shut, correctly and uselessly.
 *
 * ## `/nn/2026/` is `pre_open` in the seed and nothing here changes that
 *
 * `entries.events.entries_open_at` is null for `nn-2026`, which is production's real state.
 * These tests read the real front door in that state rather than fabricating a window, because
 * the state being tested *is* the shut one.
 */

const SITE = 'https://example.com';
const YEAR_PAGE = `${SITE}/nn/2026/`;

const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/**
 * Every cookie a response sets, as `name=value`, with the cleared ones dropped.
 *
 * **The same shape as `admin.test.ts`'s, including the `typeof` rather than an `in` check.**
 * Narrowing with `'getSetCookie' in response.headers` makes the fallback branch `never` under
 * the Workers types — which is honest about workerd and useless as a fallback, and fails
 * typecheck rather than compiling to something that quietly cannot run anywhere else.
 */
function setCookiePairs(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const all =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];

  return all
    .map((line) => line.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair !== '' && !pair.endsWith('='));
}

function csrfCookieFrom(response: Response): string {
  const pair = setCookiePairs(response).find((entry) => entry.startsWith('src_csrf='));
  expect(pair, 'the page set no CSRF cookie').toBeDefined();
  return pair as string;
}

function csrfFieldFrom(markup: string): string {
  const match = markup.match(/name="csrf_token"\s+value="([^"]+)"/);
  expect(match, 'no CSRF field on the page').not.toBeNull();
  return match?.[1] ?? '';
}

/** The same real sign-in `admin.test.ts` uses — nothing here fabricates a token. */
async function signIn(email: string): Promise<string> {
  const form = await SELF.fetch(`${SITE}/account/sign-in/`, { redirect: 'manual' });
  expect(form.status, `the sign-in page for ${email}`).toBe(200);

  const response = await SELF.fetch(`${SITE}/account/sign-in/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: csrfCookieFrom(form),
    },
    body: new URLSearchParams({
      email,
      password: ADMIN_PASSWORD,
      csrf_token: csrfFieldFrom(await form.text()),
      'cf-turnstile-response': DUMMY_CAPTCHA_TOKEN,
    }),
    redirect: 'manual',
  });

  expect(response.status, `signing in as ${email} was refused`).toBe(303);

  return setCookiePairs(response)
    .filter((pair) => pair.startsWith('src_'))
    .join('; ');
}

async function yearPage(cookie: string | null = null): Promise<string> {
  const response = await SELF.fetch(YEAR_PAGE, {
    headers: cookie === null ? {} : { cookie },
    redirect: 'manual',
  });

  expect(response.status).toBe(200);
  return response.text();
}

/**
 * Whether the entry form is on offer, read off the served markup.
 *
 * **`hidden` is what decides, not the presence of the element.** Both states ship in the page
 * and the Worker reveals one — the arrangement the whole route is built on — so a test that
 * asked whether the form existed would pass in every state there is.
 */
function entryFormRevealed(markup: string): boolean {
  const match = markup.match(/<div data-nn-entry([^>]*)>/);
  expect(match, 'the year page has no entry block at all').not.toBeNull();
  return !(match?.[1] ?? '').includes('hidden');
}

function earlyNoticeRevealed(markup: string): boolean {
  const match = markup.match(/<p[^>]*data-nn-entry-early([^>]*)>/);
  expect(match, 'the year page has no early notice at all').not.toBeNull();
  return !(match?.[1] ?? '').includes('hidden');
}

describe('the year page before entries open', () => {
  it('does not offer the entry form to a signed-out visitor', async () => {
    // The deployed state, and the whole population until 1 September. If this ever fails,
    // entries have opened by accident.
    const markup = await yearPage();

    expect(entryFormRevealed(markup)).toBe(false);
    expect(earlyNoticeRevealed(markup)).toBe(false);
  });

  it('does not offer it to somebody who merely has an account', async () => {
    // **The test that matters most at this layer.** Registering is not the qualification;
    // anybody may register.
    const markup = await yearPage(await signIn(REGISTERED_EMAIL));

    expect(entryFormRevealed(markup)).toBe(false);
    expect(earlyNoticeRevealed(markup)).toBe(false);
  });

  it('does not offer it to an nn-admin either, because reading is not entering', async () => {
    // `nn-admin` is the most privileged role that touches this race and it carries no
    // `nn.entry.before_open`. A permission model that leaked capabilities between roles would
    // show up here first.
    const markup = await yearPage(await signIn(NN_ADMIN_EMAIL));

    expect(entryFormRevealed(markup)).toBe(false);
  });

  it('offers it to a tester, with the notice saying why', async () => {
    const markup = await yearPage(await signIn(NN_TESTER_EMAIL));

    expect(entryFormRevealed(markup)).toBe(true);
    expect(earlyNoticeRevealed(markup)).toBe(true);

    // **The words matter as much as the reveal.** Somebody shown a form nobody else can see
    // will otherwise conclude entries have opened, and tell people.
    expect(markup).toContain('Entries are not open to the public yet');
  });

  it('disables the email boxes it hides, so the form can actually be submitted', async () => {
    // ⚠️ **The defect this exists for made the entry form unsubmittable for every signed-in
    // runner, and produced no error anywhere the club could see.**
    //
    // A signed-in person's address comes from their session, so the Worker hides the two
    // `[data-nn-entry-typed-email]` fields and shows a fixed line instead. But `hidden` does
    // not stop a control being validated: both inputs are `required`, both were empty, and
    // the browser refuses to submit a form holding an invalid control it cannot focus —
    // logging `An invalid form control with name='email' is not focusable` to a console
    // nobody has open.
    //
    // **Nothing reached the Worker**: no request in `wrangler tail`, no row in
    // `entry_purchases`, no log line. The button simply did nothing. Found on production on
    // 31 August 2026 while rehearsing a tester payment, hours before entries were due to open.
    //
    // **Asserted on the attribute rather than on a submission**, because that is the whole of
    // the fix and it is what no test was looking at: this layer had assertions for which
    // fields are *revealed* and none for whether the hidden ones still block the form.
    const markup = await yearPage(await signIn(NN_TESTER_EMAIL));

    const typedEmailInputs = [
      // **`data-entry-value` rather than `name`, because `/nn/2026/` carries two forms.**
      // The interest form has a `name="email"` input of its own, so matching on the name
      // finds three inputs and the assertion fails on markup that is perfectly correct.
      ...markup.matchAll(/<input[^>]*data-entry-value="(email|emailConfirm)"[^>]*>/g),
    ];

    expect(typedEmailInputs, 'neither email input is in the markup at all').toHaveLength(
      2,
    );

    for (const [tag, name] of typedEmailInputs) {
      expect(
        tag,
        `${name} is hidden but still validated, which blocks the whole form`,
      ).toMatch(/\sdisabled/);
    }

    // The other half of the pair: the address the entry will actually use is on the page.
    expect(markup).toMatch(/data-nn-entry-fixed-email(?![^>]*hidden)/);
  });

  it('leaves the email boxes usable for somebody who is not signed in', async () => {
    // **The negative case, and it is what stops the fix above becoming its own defect.**
    // Disabling those inputs unconditionally would drop the address from every signed-out
    // entry — the form's only way of asking for one — and `parseNnEntry` would refuse the
    // submission for a box the person did fill in.
    //
    // Read off `/nn/2026/` while signed out. The entry form is not revealed there today, but
    // the inputs are in the markup either way and the attribute is what is under test.
    const markup = await yearPage();

    const typedEmailInputs = [
      // **`data-entry-value` rather than `name`, because `/nn/2026/` carries two forms.**
      // The interest form has a `name="email"` input of its own, so matching on the name
      // finds three inputs and the assertion fails on markup that is perfectly correct.
      ...markup.matchAll(/<input[^>]*data-entry-value="(email|emailConfirm)"[^>]*>/g),
    ];

    expect(typedEmailInputs).toHaveLength(2);

    for (const [tag, name] of typedEmailInputs) {
      expect(tag, `${name} was disabled for a signed-out visitor`).not.toMatch(
        /\sdisabled/,
      );
    }
  });

  it('shows a tester the £1 fee and shows nobody else any fee at all', async () => {
    const tester = await yearPage(await signIn(NN_TESTER_EMAIL));

    // The gated fee is revealed by code, exactly as the other three are, so the assertion is
    // about the attribute rather than about the label text.
    expect(tester).toMatch(/<div class="nn-fee" data-entry-fee="tester"(?![^>]*hidden)/);

    // And a signed-out visitor sees no fee revealed at all, because the form is not on offer.
    const anonymous = await yearPage();
    expect(anonymous).toMatch(/data-entry-fee="tester"[^>]*hidden/);
  });

  it('leaves the race page alone — the front door still says entries are shut', async () => {
    // **`/nn/` has no entry form to reveal at all**, which is why this asserts absence rather
    // than calling `entryFormRevealed`. The race page is evergreen: both forms live on the
    // year page, and this one is prose, facts and links. `resolveNnRaceView` reads the
    // database anonymously on purpose, and this is the test that says so — a tester must not
    // turn the club's front door into an advert for a window that is shut for everybody else.
    const response = await SELF.fetch(`${SITE}/nn/`, {
      headers: { cookie: await signIn(NN_TESTER_EMAIL) },
      redirect: 'manual',
    });

    expect(response.status).toBe(200);

    const markup = await response.text();

    expect(markup).not.toContain('data-nn-entry');
    expect(markup).not.toContain('data-nn-entry-early');

    // **And no form of any kind**, which is what `/nn/` is now: the interest form moved to the
    // year page with the entry form, so the race page is prose and links. Asserted because a
    // tester-only form appearing on the evergreen page is precisely the accident this route
    // split exists to make impossible.
    expect(markup).not.toContain('<form');
  });
});

describe('a tester whose submission comes back to them', () => {
  /**
   * **The gap the three hardcoded fee codes left, and the one a screenshot found.**
   *
   * `renderNnEntryStopped` used to restore the chosen radio by looping over
   * `['affiliated', 'unaffiliated', 'vi_guide']`. `tester` was not in it, so a tester who
   * submitted and got the page back — no Stripe key configured, which is the deployed state —
   * lost their entry type, on a page that says *"Nothing you typed has been lost"*.
   *
   * `nn-entry-open.test.ts` covers this echo already and could not have caught it: that suite
   * submits anonymously, so the only fee codes it can choose are the three that were in the
   * list. **The bug needed a signed-in caller to be visible at all**, which is why the test
   * lives here.
   */
  it('gets the tester entry type back still chosen', async () => {
    const cookie = await signIn(NN_TESTER_EMAIL);

    const response = await SELF.fetch(YEAR_PAGE, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: new URLSearchParams({
        form: 'entry',
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'worker-tester@example.com',
        emailConfirm: 'worker-tester@example.com',
        dobDay: '9',
        dobMonth: '12',
        dobYear: '1986',
        gender: 'female',
        feeCode: 'tester',
        emergencyName: 'Margaret Hamilton',
        phone: '0117 496 0100',
        emergencyPhone: '0117 496 0000',
        entryTerms: 'on',
      }),
      redirect: 'manual',
    });

    // 503 — the submission was good and there is no Stripe secret in this run, so nothing was
    // stored and nothing was charged. That is the branch the screenshot showed.
    expect(response.status).toBe(503);

    const markup = await response.text();

    // **The assertion the old loop failed.** Not merely that the card is present — it always
    // is — but that this particular radio comes back `checked`.
    expect(markup).toMatch(/data-entry-checked="feeCode:tester"[^>]*checked/);

    // And the rest of it is still there, which is what the page claims.
    expect(markup).toContain('data-entry-value="firstName" value="Grace"');
  });

  it('does not check a fee the person did not choose', async () => {
    // The other half. Without it, a handler that checked every radio would pass the test
    // above and produce a form with four entry types selected at once.
    const cookie = await signIn(NN_TESTER_EMAIL);

    const response = await SELF.fetch(YEAR_PAGE, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: new URLSearchParams({
        form: 'entry',
        // **A blank name is the refusal lever here, and it used to be a mismatched
        // confirmation box.** That stopped working for a signed-in person on 30 August 2026:
        // their entry uses the address on their account, so the Worker fills both email keys
        // in from the session before validating and the two can no longer disagree. The
        // submission simply became valid and went on to Stripe — which, with no key bound,
        // is a 503 rather than the 422 this test needs a body from.
        firstName: '   ',
        lastName: 'Hopper',
        email: 'worker-tester@example.com',
        emailConfirm: 'worker-tester@example.com',
        dobDay: '9',
        dobMonth: '12',
        dobYear: '1986',
        gender: 'female',
        feeCode: 'unaffiliated',
        emergencyName: 'Margaret Hamilton',
        phone: '0117 496 0100',
        emergencyPhone: '0117 496 0000',
        entryTerms: 'on',
      }),
      redirect: 'manual',
    });

    // 422 — refused on the blank first name, which is the least intrusive refusal still
    // available to a signed-in submission and leaves every other field alone, including the
    // fee radio this test is actually about.
    expect(response.status).toBe(422);

    const markup = await response.text();

    expect(markup).toMatch(/data-entry-checked="feeCode:unaffiliated"[^>]*checked/);
    expect(markup).not.toMatch(/data-entry-checked="feeCode:tester"[^>]*checked/);
  });
});

describe('what a tester still may not reach', () => {
  it('gets the ordinary 404 at /admin/, because a permission is not a staff role', async () => {
    // `isStaff()` deliberately still asks about roles. Written as "holds any permission" it
    // would let this person into the club's entry list.
    const response = await SELF.fetch(`${SITE}/admin/`, {
      headers: { cookie: await signIn(NN_TESTER_EMAIL) },
      redirect: 'manual',
    });

    expect(response.status).toBe(404);
  });

  it('gets the same 404 at the race section', async () => {
    const response = await SELF.fetch(`${SITE}/admin/nn/`, {
      headers: { cookie: await signIn(NN_TESTER_EMAIL) },
      redirect: 'manual',
    });

    expect(response.status).toBe(404);
  });
});

describe('a signed-in person can see their own entries', () => {
  it('answers /account/entries/ with a page rather than a redirect', async () => {
    const response = await SELF.fetch(`${SITE}/account/entries/`, {
      headers: { cookie: await signIn(REGISTERED_EMAIL) },
      redirect: 'manual',
    });

    expect(response.status).toBe(200);

    const markup = await response.text();

    // This fixture person has entered nothing, so the empty state is the correct answer — and
    // its wording is the part worth asserting. "You have no entries" would be a claim this
    // page is not in a position to make: they may have entered with another address.
    expect(markup).toContain('Nothing is showing here yet');
  });

  it('sends a signed-out visitor to sign in rather than showing an empty list', async () => {
    const response = await SELF.fetch(`${SITE}/account/entries/`, {
      redirect: 'manual',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/account/sign-in/');
  });
});
