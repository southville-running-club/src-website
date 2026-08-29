#!/usr/bin/env node
/**
 * The entry path, swept end to end — including the state production cannot be put into.
 *
 * `scripts/smoke.mjs` asks whether the deployed platform is alive. This asks something
 * different and narrower: **does the whole entry journey behave, in both states of the entry
 * window, for somebody with no account and no role?**
 *
 * That question cannot be answered in production and will not be answerable there until the
 * morning entries open, which is the worst possible moment to find out. `entries_open_at` is a
 * stop-and-ask column precisely because setting it starts selling 250 places unattended. So the
 * open state is reachable **only on a laptop**, and this script is what reaches it: it moves the
 * window, runs the sweep, and puts the window back exactly as the migration seeded it.
 *
 *   node scripts/entry-sweep.mjs              # both window states, then restore
 *   node scripts/entry-sweep.mjs --keep-open  # leave the window open afterwards, for hand testing
 *   node scripts/entry-sweep.mjs --closed     # only the closed state (what production serves)
 *
 * ## Buying a place for real, which needs one thing switching on
 *
 * The last phase buys a place with no account, confirms it the way Stripe would, and then
 * registers an account with the address that paid to prove the entry is waiting on it. That
 * needs the webhook, and **`./dev up` binds no webhook secret on purpose** — with none, the
 * endpoint answers 503 and lets Stripe retry, which is the correct state for a deployment
 * whose endpoint has not been registered yet.
 *
 * So that phase **skips loudly unless the two are bound**, rather than failing. To run it, put
 * this in the gitignored `apps/main/.dev.vars` and restart with `./dev down && ./dev up`:
 *
 *     STRIPE_WEBHOOK_SECRET=whsec_TEST_NOT_A_REAL_SIGNING_SECRET_000000
 *     ENTRIES_WEBHOOK_KEY=zz-worker-test-key-not-a-real-one
 *
 * Both are constants this repository already keeps in `apps/main/tests/webhook-fixtures.ts`
 * and neither authenticates to anything. Delete the file when you are done — a laptop left
 * with a working webhook key is a laptop where the 503 branch has stopped being tested.
 *
 * **Local only, and deliberately so.** There is no `--production` flag and there must not be
 * one: half of what follows POSTs entries, and against production that is real places out of
 * 250, real mail against a 100-a-day cap, and rows somebody has to clean up. The read-only
 * half of this file's checks belongs in `smoke.mjs` if it is ever wanted against the live site.
 *
 * Exit code 0 if everything passed. Anything else is a real failure.
 *
 * ## Why almost everything here asserts behaviour rather than markup
 *
 * `/nn/<year>/` ships **both** forms in `dist/` and the Worker reveals one by removing a
 * `hidden` attribute. So `html.includes('Entries are not open')` is true on every response
 * whichever form is showing: a check written that way passes in both states, which looks like
 * coverage and tests nothing. That cost a false positive twice while this script was being
 * written, once in each direction.
 *
 * Reading the `hidden` attribute instead is better but still wrong for the two forms, because
 * neither carries it — an **ancestor** does, and a fetch-only harness has no DOM to walk. So
 * the questions here are asked of behaviour, which has no such ambiguity: does a submission get
 * accepted, at what price, and what does the refusal say. `revealed()` survives only for the
 * notice blocks, where the marker really is on the element the Worker toggles.
 *
 * Anything needing true rendered visibility, focus order or layout needs a browser and belongs
 * in `tests/e2e/nn-entry.spec.ts` instead.
 */

import { Client } from 'pg';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const SITE = 'http://localhost:8787';

/** Where the local stack catches outgoing mail. Mailpit, despite the container's name. */
const MAIL = 'http://localhost:54324';

/**
 * The two the webhook phase needs, and the digest the database holds for the second.
 *
 * Straight out of `apps/main/tests/webhook-fixtures.ts`, which is where this repository
 * already keeps them. Neither authenticates to anything: the signing secret is a made-up
 * string and the key is checked against a SHA-256 digest this script installs and removes.
 */
const WEBHOOK_SECRET = 'whsec_TEST_NOT_A_REAL_SIGNING_SECRET_000000';
const WEBHOOK_KEY = 'zz-worker-test-key-not-a-real-one';

/** Invented, local, and never typed into anything but this laptop's own GoTrue. */
const ACCOUNT_PASSWORD = 'entry-sweep-local-fixture-password';

/** The local Docker Postgres, and nothing else. The credentials `supabase start` prints. */
const LOCAL_DB =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SLUG = 'nn-2026';
const YEAR_PATH = '/nn/2026/';

const KEEP_OPEN = process.argv.includes('--keep-open');
const CLOSED_ONLY = process.argv.includes('--closed');

let passed = 0;
const failures = [];

function ok(what) {
  passed += 1;
  console.log(`    ✓ ${what}`);
}

function bad(what, detail) {
  failures.push({ what, detail });
  console.log(`    ✗ ${what}\n        ${detail}`);
}

function check(what, condition, detail) {
  if (condition) ok(what);
  else bad(what, detail);
}

function step(title) {
  console.log(`\n==> ${title}`);
}

async function withDb(fn) {
  const db = new Client({ connectionString: LOCAL_DB });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/**
 * What the window held before this script touched it, so it can be put back **exactly**.
 *
 * Restoring a hard-coded "closed" would be wrong in a way that is easy to miss, and
 * `packages/db/scripts/set-entry-window.mjs` is wrong in exactly that way — see issue #145,
 * defect 4. Its comment says closing "restores what the migration seeded — null", which was
 * true when it was written and stopped being true on 27 August, when
 * `20260827180000_nn_2026_entries_close_at.sql` set `entries_close_at` to
 * `2026-10-30 17:00:00+00`. Production holds a **null open date and a set close date**: the
 * committee ratified the window and only the opening half is withheld.
 *
 * So this file remembers and restores rather than assuming, and closes by nulling the opening
 * half alone. It deliberately does not call the other script.
 */
let seededWindow = null;

async function rememberWindow() {
  seededWindow = await withDb(async (db) => {
    const { rows } = await db.query(
      'select entries_open_at, entries_close_at from entries.events where slug = $1',
      [SLUG],
    );
    if (rows.length === 0)
      throw new Error(`no event ${SLUG} — has the database been seeded?`);
    return rows[0];
  });
}

/**
 * Open the window, or put back whatever was there before.
 *
 * Open uses offsets from `now()` rather than fixed dates, for the reason
 * `tests/entries-window.ts` gives: a hard-coded pair starts failing on whichever morning the
 * clock passes the closing one.
 */
async function setWindow(open) {
  await withDb((db) =>
    open
      ? db.query(
          `update entries.events
              set entries_open_at = now() - interval '1 day',
                  entries_close_at = now() + interval '30 days'
            where slug = $1`,
          [SLUG],
        )
      : // **Only the opening half is withheld**, which is the shape production is in: the
        // committee ratified the window, and `entries_open_at` alone is the switch. Nulling
        // the close date as well would be a state nobody has ever deployed.
        db.query(`update entries.events set entries_open_at = null where slug = $1`, [
          SLUG,
        ]),
  );
}

/** Put back exactly what was there before this run, whatever that was. */
async function restoreWindow() {
  await withDb((db) =>
    db.query(
      `update entries.events set entries_open_at = $2, entries_close_at = $3 where slug = $1`,
      [
        SLUG,
        seededWindow?.entries_open_at ?? null,
        seededWindow?.entries_close_at ?? null,
      ],
    ),
  );
}

/** A cache-busting GET. Every request here is unique, so nothing is answered from a cache. */
async function get(path, init) {
  const join = path.includes('?') ? '&' : '?';
  return fetch(`${SITE}${path}${join}sweep=${crypto.randomUUID()}`, {
    redirect: 'manual',
    ...init,
  });
}

async function postForm(path, fields, init) {
  return fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
    ...init,
  });
}

/**
 * Is the notice carrying `marker` the one that was revealed?
 *
 * **Only sound for the `data-entry-*` notice blocks**, where the attribute the Worker toggles
 * `hidden` on is the same element the marker names — `[data-entry-closed]`,
 * `[data-entry-already]` and their siblings in `nn-entry.ts`'s status map. It walks back to the
 * enclosing tag and asks whether `hidden` is still on it.
 *
 * Do **not** reach for this to ask whether a form is showing. Neither form carries `hidden`
 * itself, so the answer is always "revealed" and always meaningless. See the note at the top.
 */
function revealed(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const tagStart = html.lastIndexOf('<', at);
  const tagEnd = html.indexOf('>', at);
  if (tagStart < 0 || tagEnd < 0) return null;
  return !/\shidden(\s|=|>)/.test(html.slice(tagStart, tagEnd + 1));
}

/** A runner who is 18 on race day, with a surname nothing else in the fixtures uses. */
function validEntry(overrides = {}) {
  const tag = crypto.randomUUID().slice(0, 8);
  return {
    form: 'entry',
    firstName: 'Sweep',
    lastName: `Runner-${tag}`,
    email: `sweep-${tag}@example.com`,
    emailConfirm: `sweep-${tag}@example.com`,
    dobDay: '12',
    dobMonth: '5',
    dobYear: '1990',
    gender: 'female',
    feeCode: 'unaffiliated',
    emergencyName: 'Ada Okonkwo',
    emergencyPhone: '07700 900123',
    entryTerms: 'on',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------

/**
 * The routes, and the two that are answers rather than accidents.
 *
 * `/admin/*` answering **404** rather than 403 is ADR-013's amendment — a 403 discloses that
 * the address exists. `/nn/admin/*` still resolving is #58: those addresses are in a published
 * runbook, and a runbook that 404s is worse than one that is out of date.
 */
async function checkRoutes() {
  step('Routes');

  for (const path of [
    '/',
    '/nn/',
    YEAR_PATH,
    '/nn/course/',
    '/nn/privacy/',
    '/privacy/',
  ]) {
    const r = await get(path);
    check(`${path} serves`, r.status === 200, `got ${r.status}`);
  }

  const account = await get('/account/');
  check(
    '/account/ redirects a signed-out visitor to sign-in',
    account.status === 303 &&
      (account.headers.get('location') ?? '').includes('/account/sign-in/'),
    `got ${account.status} -> ${account.headers.get('location')}`,
  );

  for (const path of ['/admin/', '/admin/nn/', '/admin/people/', '/admin/emails/']) {
    const r = await get(path);
    check(
      `${path} answers 404 signed out, never 403`,
      r.status === 404,
      `got ${r.status}`,
    );
  }

  const moved = await get('/nn/admin/');
  check(
    '/nn/admin/ still redirects, because it is in a published runbook',
    moved.status === 301,
    `got ${moved.status}`,
  );
}

/**
 * The two switches that are off in production, and the one that is on.
 *
 * Google sign-in renders **no button at all** rather than a disabled one — a button leading to
 * a provider GoTrue does not know about is a dead end. Its absence is the assertion.
 */
async function checkSwitches() {
  step('Feature switches');

  const signIn = await get('/account/sign-in/').then((r) => r.text());
  check(
    'no Google button is offered while GOOGLE_SIGN_IN is off',
    !signIn.includes('action="/account/google/"'),
    'a /account/google/ form was rendered',
  );
  check(
    'Turnstile is on the sign-in form',
    signIn.includes('cf-turnstile'),
    'no Turnstile widget found',
  );
}

/**
 * **The regression test for issue #145.**
 *
 * `/nn/`, `/nn/<year>/` and `/nn/<year>/entry/complete/` are painted per request by
 * HTMLRewriter, but their `ETag` comes from the static file in `dist/` and so is identical
 * whatever was painted — with `Cache-Control: public` and no `Vary`. A conditional request
 * therefore gets a 304 carrying the wrong variant, and in production Cloudflare answers
 * `cf-cache-status: HIT`.
 *
 * This currently **fails**, on purpose. It is here so that whatever fix #145 lands is
 * pinned by something, and so the failure is a line in a run rather than a thing somebody
 * has to notice.
 */
async function checkCaching() {
  step('Caching of pages the Worker paints per request (issue #145)');

  for (const path of ['/nn/', YEAR_PATH, '/nn/2026/entry/complete/']) {
    const r = await get(path);
    const cacheControl = r.headers.get('cache-control') ?? '';
    const vary = r.headers.get('vary');
    const etag = r.headers.get('etag');

    const safe =
      /no-store|private/.test(cacheControl) ||
      (vary ?? '').toLowerCase().includes('cookie');

    check(
      `${path} is not cached as though it were the same for everybody`,
      safe,
      `cache-control: ${cacheControl || '(none)'}, vary: ${vary ?? '(none)'}`,
    );

    if (etag !== null && !safe) {
      const conditional = await get(path, { headers: { 'if-none-match': etag } });
      check(
        `${path} does not answer 304 to a conditional request`,
        conditional.status !== 304,
        `answered 304 on an ETag that does not describe what was painted`,
      );
    }
  }
}

/** What production serves today: the interest form, and no way to enter. */
async function checkWindowClosed() {
  step('Entries closed — what production serves');

  // **Behaviour, not markup.** An earlier version of this asked whether the entry form's
  // element carried `hidden`. It does not — the form is hidden by an ancestor — so the check
  // reported the form revealed in both states and read as coverage while testing nothing.
  // What the window actually controls is whether a submission is accepted, so that is what is
  // asserted. Whether the right form is *visible* is a rendering question and lives in
  // `tests/e2e/nn-entry.spec.ts`, which has a browser and can answer it.
  const attempt = await postForm(YEAR_PATH, validEntry());
  check(
    'an entry posted while the window is shut is refused, not held',
    attempt.status === 409,
    `got ${attempt.status}, expected 409 — a redirect would mean a place was held`,
  );

  const html = await attempt.text();
  check(
    'and the refusal says the window is shut rather than blaming the submission',
    revealed(html, 'data-entry-closed') === true,
    'the closed notice was not the block revealed',
  );

  const interest = await postForm(YEAR_PATH, {
    form: 'signup',
    name: 'Sweep Interest',
    email: `sweep-interest-${crypto.randomUUID().slice(0, 8)}@example.com`,
    consent: 'on',
  });
  check(
    'the interest form is what works instead',
    interest.status === 303,
    `got ${interest.status}, expected a 303 back to the acknowledgement`,
  );
}

/**
 * **The state nobody can reach in production**, and the reason this script exists.
 *
 * Everything here is done with **no account and no role** — an ordinary member of the public on
 * the morning entries open. That path has never been walked against anything but fixtures.
 */
async function checkWindowOpen() {
  step('Entries open — an ordinary visitor, no account, no role');

  // **The tester fee is gated on a permission an anonymous caller cannot hold**, and
  // `entry_state()` resolves that through `auth.uid()` rather than through anything the caller
  // sends. So the test that matters is not whether the radio is drawn — it is whether posting
  // the fee code directly buys a £1 place. Somebody who reads the page source can try exactly
  // this, and it is the only version of the check an attacker would care about.
  const cheeky = await postForm(YEAR_PATH, validEntry({ feeCode: 'tester' }));
  check(
    'posting the £1 tester fee code as the public is refused',
    cheeky.status !== 303,
    `got 303 — an anonymous visitor bought a place at the tester price`,
  );

  const before = await paidAndPendingCount();

  const good = validEntry();
  const accepted = await postForm(YEAR_PATH, good);
  const location = accepted.headers.get('location') ?? '';
  check(
    'a valid entry is accepted and sent to Stripe Checkout',
    accepted.status === 303 && location.includes('checkout.stripe.com'),
    `got ${accepted.status} -> ${location || '(no location)'}`,
  );

  const row = await withDb(async (db) => {
    const { rows } = await db.query(
      `select status, amount_pence, person_id, hold_expires_at
         from entries.entry_purchases where purchaser_email = $1`,
      [good.email],
    );
    return rows[0] ?? null;
  });

  check(
    'the purchase is recorded as pending',
    row?.status === 'pending',
    `row: ${JSON.stringify(row)}`,
  );
  check(
    'it is priced from entries.fees rather than from the form',
    row?.amount_pence === 2000,
    `amount_pence was ${row?.amount_pence}, expected 2000 for an unaffiliated entry`,
  );
  check(
    'entering creates no account — person_id is null',
    row != null && row.person_id === null,
    `person_id was ${row?.person_id}`,
  );
  check('the place is held', row?.hold_expires_at != null, 'no hold was recorded');

  const after = await paidAndPendingCount();
  check(
    'exactly one place was taken',
    after === before + 1,
    `live places went from ${before} to ${after}`,
  );
}

/**
 * Every rule re-attempted the way somebody would meet it — through the form.
 *
 * `entries-rules.test.ts` already attempts these straight at PostgREST with the published anon
 * key, which is the stronger test. This is the weaker, complementary one: that the **form**
 * refuses them too, with a specific answer rather than a generic failure. A 422 that says
 * nothing is a refusal somebody cannot act on.
 */
async function checkRefusals() {
  step('Entries open — the refusals a visitor can actually meet');

  const empty = await postForm(YEAR_PATH, { form: 'entry' });
  check('an empty entry is refused', empty.status === 422, `got ${empty.status}`);

  const emptyHtml = await empty.text();
  check(
    'and the refusal names the fields rather than failing silently',
    emptyHtml.includes('data-entry-summary-link'),
    'no error summary links were rendered',
  );

  const underage = await postForm(YEAR_PATH, validEntry({ dobYear: '2010' }));
  check(
    'a runner under 18 on race day is refused',
    underage.status === 422,
    `got ${underage.status} — a redirect means a place was held for a minor`,
  );

  const noTerms = validEntry();
  delete noTerms.entryTerms;
  const untickedTerms = await postForm(YEAR_PATH, noTerms);
  check(
    'an entry without the terms ticked is refused',
    untickedTerms.status === 422,
    `got ${untickedTerms.status}`,
  );

  const mismatched = await postForm(
    YEAR_PATH,
    validEntry({ emailConfirm: 'somebody-else@example.com' }),
  );
  check(
    'a mistyped email confirmation is refused',
    mismatched.status === 422,
    `got ${mismatched.status}`,
  );

  const badCode = await postForm(
    YEAR_PATH,
    validEntry({ discountCode: 'LHG-10-NOTAREALCODE' }),
  );
  check(
    'an unknown discount code is refused',
    badCode.status === 422,
    `got ${badCode.status} — an unknown code must not silently price at full`,
  );

  // **One runner, one place** — keyed on first name, last name and date of birth, and counting
  // only a live place. Posted twice with the same identity and two different addresses, because
  // the rule is deliberately not keyed on `purchaser_email`: one card legitimately pays for a
  // partner.
  const identity = {
    firstName: 'Twice',
    lastName: `Over-${crypto.randomUUID().slice(0, 8)}`,
  };
  const first = await postForm(YEAR_PATH, validEntry(identity));
  const second = await postForm(YEAR_PATH, validEntry(identity));

  check(
    'the same runner cannot take a second place',
    first.status === 303 && second.status !== 303,
    `first ${first.status}, second ${second.status}`,
  );

  const secondHtml = await second.text();
  check(
    'and is told so, rather than shown a generic failure',
    revealed(secondHtml, 'data-entry-already') === true,
    'the already-entered notice was not the block revealed',
  );

  // **Issue #145, defect 3.** The refusal renders correctly and is answered **503**, because
  // `worker/index.ts` maps every stopped status except `sold-out` to 503 and `already-entered`
  // was added to that union by #115 without revisiting the ternary. A 503 says the club's
  // server is unavailable: it invites a retry, and on the morning entries open it turns an
  // ordinary refusal into a spike of server errors in whatever is watching. Its siblings
  // `closed` and `sold-out` are both 409, which is what this is.
  check(
    'and the refusal is not reported as a server outage',
    second.status !== 503,
    `got 503 for a business-rule refusal; expected 409 like sold-out and closed`,
  );
}

/**
 * The completion page, which may make a positive claim and may never make a negative one.
 *
 * A lapsed hold saying "nothing was charged" is the failure worth guarding: the webhook may
 * simply be late, and somebody who believes it pays twice.
 */
async function checkCompletionPage() {
  step('The completion page makes no claim it cannot support');

  const html = await get(
    '/nn/2026/entry/complete/?session_id=cs_test_not_a_real_session',
  ).then((r) => r.text());

  check(
    'it does not tell an unknown visitor that nothing was charged',
    revealed(html, 'nothing was charged') !== true,
    'a negative claim was revealed to somebody whose payment may simply be late',
  );
  check(
    'and it does not claim a payment succeeded either',
    revealed(html, 'data-entry-complete-paid') !== true,
    'a positive claim was revealed without a recorded payment',
  );
}

// ---------------------------------------------------------------------------------------
// Buying a place for real, and finding it again afterwards
// ---------------------------------------------------------------------------------------

/**
 * A cookie jar, because the second half of this phase is a genuinely signed-in session.
 *
 * Node's `fetch` has none, and the account area is three cookies rather than two —
 * `src_ax` carries the absolute deadline and a session arriving without a readable one is
 * ended rather than given one. So all three have to be carried, which is what this does.
 */
function cookieJar() {
  const jar = new Map();

  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    remember(response) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';');
        const at = pair.indexOf('=');
        if (at <= 0) continue;
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        // A deletion is a `Set-Cookie` with an empty value or a 1970 expiry. Treating it as
        // a value is how a signed-out jar keeps claiming to be signed in.
        if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}

/** The name and value of a form's CSRF field, read off the page that rendered it. */
function csrfFrom(html) {
  const name = html.match(/name="(_?csrf[a-zA-Z_]*)"/)?.[1] ?? null;
  if (name === null) return null;
  const value =
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1] ??
    html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`))?.[1] ??
    null;
  return value === null ? null : { name, value };
}

async function checkPurchaseJourney() {
  step('Buying a place with no account, then finding it after registering');

  const bound = await fetch(`${SITE}/nn/stripe-webhook`, { method: 'POST', body: '{}' });

  // 503 is "no secret bound"; 400 is "bound, and that was not a valid signature".
  if (bound.status !== 400) {
    console.log(
      '    – skipped: no webhook secret is bound, so a payment cannot be confirmed here.\n' +
        '      See the note at the top of this file to switch it on for a run.',
    );
    return;
  }

  const tag = randomUUID().slice(0, 8);
  const email = `sweep-buyer-${tag}@example.com`;

  await withDb((db) =>
    db.query(
      `update entries.webhook_secrets set key_sha256 = $1, updated_at = now()
        where name = 'stripe'`,
      [createHash('sha256').update(WEBHOOK_KEY, 'utf8').digest('hex')],
    ),
  );

  try {
    const entry = validEntry({
      firstName: 'Marguerite',
      lastName: `Buyer-${tag}`,
      email,
      emailConfirm: email,
    });

    const bought = await postForm(YEAR_PATH, entry);
    const location = bought.headers.get('location') ?? '';
    const sessionId = location.match(/cs_[A-Za-z0-9_]+/)?.[0] ?? null;

    check(
      'a place is bought with no account at all',
      bought.status === 303 && sessionId !== null,
      `got ${bought.status} -> ${location || '(no location)'}`,
    );
    if (sessionId === null) return;

    const held = await withDb(async (db) => {
      const { rows } = await db.query(
        `select id, status, person_id from entries.entry_purchases where purchaser_email = $1`,
        [email],
      );
      return rows[0] ?? null;
    });

    // **`client_reference_id` is what names the purchase**, not the session id:
    // `record_checkout_event()` parses it as a uuid and answers `not_ours` to anything else.
    // The Worker sets it when it creates the session, so a real event always carries one.
    const payload = JSON.stringify({
      id: `evt_sweep_${tag}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          client_reference_id: held?.id,
          amount_total: 2000,
          currency: 'gbp',
          payment_status: 'paid',
          payment_intent: `pi_sweep_${tag}`,
        },
      },
    });

    const at = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${at}.${payload}`)
      .digest('hex');

    const hook = await fetch(`${SITE}/nn/stripe-webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${at},v1=${signature}`,
      },
      body: payload,
    });
    check('the webhook confirms it', hook.status === 200, `got ${hook.status}`);

    const paid = await withDb(async (db) => {
      const { rows } = await db.query(
        `select status, paid_at from entries.entry_purchases where purchaser_email = $1`,
        [email],
      );
      return rows[0] ?? null;
    });
    check(
      'and only the webhook does — the purchase is paid now',
      paid?.status === 'paid' && paid?.paid_at != null,
      JSON.stringify(paid),
    );

    const forged = await fetch(`${SITE}/nn/stripe-webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${at},v1=${'0'.repeat(64)}`,
      },
      body: payload,
    });
    check('a forged signature is refused', forged.status === 400, `got ${forged.status}`);

    // **`session`, not `session_id`.** The Worker reads `searchParams.get('session')` and
    // `stripe.ts` builds the success URL as `…?session={CHECKOUT_SESSION_ID}`. Get it wrong
    // and every state resolves to `confirming`, which looks exactly like a paid entry whose
    // page never updates — a false alarm that cost half an hour when this was written.
    const completeHtml = await get(`/nn/2026/entry/complete/?session=${sessionId}`).then(
      (r) => r.text(),
    );

    check(
      'the completion page stops saying it is still confirming',
      revealed(completeHtml, 'data-complete-confirming') === false,
      'the confirming notice was still showing for a paid entry',
    );
    check(
      'and reports the payment as confirmed',
      revealed(completeHtml, 'data-complete="paid"') === true,
      'the paid block was not revealed',
    );

    // ---- and now the account, which did not exist when the place was bought --------------
    const jar = cookieJar();
    const req = async (path, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      const cookie = jar.header();
      if (cookie !== '') headers.cookie = cookie;
      const res = await fetch(`${SITE}${path}`, { redirect: 'manual', ...init, headers });
      jar.remember(res);
      return res;
    };

    const post = (fields) => ({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });

    const signUpHtml = await req('/account/sign-up/').then((r) => r.text());
    const signUpCsrf = csrfFrom(signUpHtml);

    const registered = await req(
      '/account/sign-up/',
      post({
        [signUpCsrf?.name ?? 'csrf']: signUpCsrf?.value ?? '',
        name: 'Marguerite Buyer',
        email,
        password: ACCOUNT_PASSWORD,
        // Cloudflare's own published dummy token, which the local stack's dummy secret passes.
        'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
      }),
    );
    check(
      'an account can be made with the address that paid',
      registered.status === 303,
      `got ${registered.status}`,
    );

    const inbox = await fetch(`${MAIL}/api/v1/messages?limit=40`).then((r) => r.json());
    const message = inbox.messages?.find((m) => m.To?.some((to) => to.Address === email));
    check(
      'a confirmation email reaches that address',
      message != null,
      'no message found',
    );
    if (message == null) return;

    // **Parsed rather than regexed off the raw JSON.** The body arrives escaped, so matching
    // the transport encoding yields a URL with `&amp;` where the ampersands belong — which
    // then answers 200 on the "that link did not work" page, and every later failure points
    // somewhere else entirely.
    const full = await fetch(`${MAIL}/api/v1/message/${message.ID}`).then((r) =>
      r.json(),
    );
    const link = `${full.Text ?? ''}\n${full.HTML ?? ''}`
      .match(/http:\/\/localhost:8787\/account\/confirm[^"'\s<>]*/)?.[0]
      ?.replace(/&amp;/g, '&');
    check('carrying a confirmation link', link != null, 'no link in the email');
    if (link == null) return;

    const confirmedHtml = await req(link.replace(SITE, '')).then((r) => r.text());

    // A spent or malformed link answers 200 on a page that says so, so the status proves
    // nothing here and the words are what the assertion has to read.
    check(
      'the address confirms',
      /is confirmed/i.test(confirmedHtml),
      'the confirmation page did not say the address was confirmed',
    );

    const signInHtml = await req('/account/sign-in/').then((r) => r.text());
    const signInCsrf = csrfFrom(signInHtml);
    const signedIn = await req(
      '/account/sign-in/',
      post({
        [signInCsrf?.name ?? 'csrf']: signInCsrf?.value ?? '',
        email,
        password: ACCOUNT_PASSWORD,
        'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
      }),
    );
    check('the new account signs in', signedIn.status === 303, `got ${signedIn.status}`);

    const entriesRes = await req('/account/entries/');
    const entriesHtml = await entriesRes.text();

    // **The whole point of the phase.** `my_entries()` matches `person_id` *or* a
    // `purchaser_email` equal to the caller's confirmed address, and this entry has no
    // `person_id` at all — nobody was signed in when it was bought. If this ever fails,
    // every runner who entered without an account has an entries page that denies their entry.
    check(
      'the entry bought before the account existed is waiting on it',
      entriesRes.status === 200 && entriesHtml.includes(`Buyer-${tag}`),
      `status ${entriesRes.status}, runner ${entriesHtml.includes(`Buyer-${tag}`) ? 'found' : 'absent'}`,
    );
    check(
      'and carries the reference somebody would quote in an email',
      held != null && entriesHtml.includes(held.id),
      'the purchase id is not on the page',
    );
  } finally {
    // The digest goes whatever happened, so a laptop is never left with a working webhook
    // key for a test secret against the real event row.
    await withDb((db) =>
      db.query(
        `update entries.webhook_secrets set key_sha256 = null where name = 'stripe'`,
      ),
    );
  }
}

/** How many places are actually gone — `paid`, plus `pending` whose hold has not lapsed. */
async function paidAndPendingCount() {
  return withDb(async (db) => {
    const { rows } = await db.query(
      `select count(*)::int as n
         from entries.entry_purchases p
         join entries.events e on e.id = p.event_id
        where e.slug = $1
          and (p.status = 'paid'
               or (p.status = 'pending' and p.hold_expires_at > now()))`,
      [SLUG],
    );
    return rows[0].n;
  });
}

// ---------------------------------------------------------------------------------------

async function main() {
  const reachable = await fetch(SITE, { signal: AbortSignal.timeout(3000) }).catch(
    () => null,
  );
  if (reachable === null) {
    console.error(
      '\nThe site is not answering on localhost:8787 — run ./dev up first.\n',
    );
    process.exit(2);
  }

  console.log('Sweeping the entry path on ' + SITE);

  await rememberWindow();
  await setWindow(false);
  await checkRoutes();
  await checkSwitches();
  await checkCaching();
  await checkWindowClosed();
  await checkCompletionPage();

  if (!CLOSED_ONLY) {
    await setWindow(true);
    try {
      await checkWindowOpen();
      await checkRefusals();
      await checkPurchaseJourney();
    } finally {
      // **Always put the window back**, whatever happened above. A run that throws halfway
      // and leaves entries open is a laptop that quietly disagrees with production, and the
      // next person's closed-state assertions fail for a reason nothing on screen explains.
      if (!KEEP_OPEN) await restoreWindow();
    }
  } else if (!KEEP_OPEN) {
    await restoreWindow();
  }

  if (KEEP_OPEN) {
    console.log(
      '\n--keep-open: the window is still open. Close it with --closed when you are done.',
    );
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.what}\n      ${f.detail}`);
    process.exit(1);
  }
}

await main();
