import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EVENT_NAME,
  ADMIN_EVENT_SLUG,
  ADMIN_HANDLE,
  ADMIN_PERSON_KEY,
  AWKWARD_CLUB,
  AWKWARD_FIRST_NAME,
  AWKWARD_LAST_NAME,
  CLEAN_EVENT_SLUG,
  CLEAN_PAID_LAST_NAME,
  MEDICAL_NOTE,
  OVER_ENTRANT_ID,
  PAID_EA_NUMBER,
  PAID_ENTRANT_ID,
  PAID_NON_ASCII_LAST_NAME,
  REVOKED_PERSON_KEY,
} from '../../admin-fixtures';

/**
 * `/nn/admin`, in the real Workers runtime.
 *
 * **The refusals are the point of this file.** This is the first surface in the platform that
 * returns real people, and the whole of what stands between it and the internet is a Worker
 * secret and a signed cookie. Every assertion under "the door" below is a way in that must not
 * exist, and **each one fails if the check it covers is removed** — which is what the brief asked
 * for and what a comment saying "we check the credential" cannot give.
 *
 * `ENTRIES_ADMIN_KEY` is bound only in this run's config. The other four runs therefore prove
 * the other half for free: with no key bound the surface declines, the request falls through to
 * the assets binding, and the address 404s exactly as one nobody published does. That is the
 * deployed state, and `nn-admin-unconfigured.test.ts` asserts it explicitly rather than leaving
 * it to be inferred.
 */

const ADMIN = '/nn/admin/';

/** Sign in the way a browser does, and hand back the cookie it was given. */
async function signIn(key = ADMIN_PERSON_KEY): Promise<string> {
  const response = await SELF.fetch(`https://example.com${ADMIN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key }),
    redirect: 'manual',
  });

  const cookie = response.headers.get('set-cookie');
  expect(cookie, 'sign-in returned no cookie').not.toBeNull();

  return cookie!.split(';')[0]!;
}

async function get(path: string, cookie: string | null = null): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: cookie === null ? {} : { cookie },
    redirect: 'manual',
  });
}

async function post(
  path: string,
  body: Record<string, string>,
  cookie: string | null = null,
): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
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
 * A page's markup with runs of whitespace collapsed.
 *
 * **Prettier reformats the contents of a template tagged `html`** — it is built in and not
 * configurable — so a sentence written across two lines in `worker/nn-admin.ts` arrives with a
 * newline in the middle of it. `toContain('over its field')` then fails on markup that is
 * perfectly correct. This is the same shape as the `{' '}` trap in the Astro pages, one
 * framework along, and it cost the first run of this file.
 *
 * The CSV assertions deliberately do **not** go through this: a byte-order mark and a CRLF are
 * exactly what is being asserted there.
 */
async function pageText(response: Response): Promise<string> {
  return (await response.text()).replace(/\s+/g, ' ');
}

let session = '';

beforeAll(async () => {
  session = await signIn();
});

// -----------------------------------------------------------------------------------------
// The door
// -----------------------------------------------------------------------------------------

describe('what an unauthenticated request gets, at every address', () => {
  const addresses = [
    ADMIN,
    `${ADMIN}entries/`,
    `${ADMIN}entries/${ADMIN_EVENT_SLUG}/`,
    `${ADMIN}interest/`,
  ];

  for (const address of addresses) {
    it(`refuses ${address} with no cookie`, async () => {
      const response = await get(address);

      expect(response.status).toBe(401);

      const body = await pageText(response);
      expect(body).toContain('Your admin key');
      // Nothing about what is behind the door reaches the page.
      expect(body).not.toContain(ADMIN_EVENT_NAME);
      expect(body).not.toContain(AWKWARD_LAST_NAME);
    });
  }

  it('refuses the two POST actions with no cookie', async () => {
    // **These are the two that read special category data and take a copy out.** A `POST` with
    // no session must not reach either, and must not tell the caller whether the id it named
    // exists.
    const medical = await post(`${ADMIN}medical/`, { entrantId: PAID_ENTRANT_ID });
    const exported = await post(`${ADMIN}export/`, {
      event: ADMIN_EVENT_SLUG,
      kind: 'medical',
    });

    expect(medical.status).toBe(401);
    expect(exported.status).toBe(401);
    expect(await pageText(medical)).not.toContain(MEDICAL_NOTE);
    expect(await pageText(exported)).not.toContain(MEDICAL_NOTE);
  });

  it('refuses a forged cookie', async () => {
    // The payload format is trivial and is meant to be; the signature is what stops it being
    // useful. A handle and a far-future expiry with rubbish on the end must not get in.
    const response = await get(
      `${ADMIN}entries/${ADMIN_EVENT_SLUG}/`,
      `nn_admin=${ADMIN_HANDLE}.99999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    );

    expect(response.status).toBe(401);
    expect(await pageText(response)).not.toContain(AWKWARD_LAST_NAME);
  });

  it('refuses a wrong person key, and says nothing about why', async () => {
    const response = await post(ADMIN, { key: 'not-a-key-anybody-has' });

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await pageText(response)).toContain('That key was not recognised');
  });

  it('refuses a revoked person key with the identical answer', async () => {
    // **Revoking one volunteer must shut one door and not both**, and must not announce which
    // kind of refusal it was: "revoked" and "never existed" tell somebody who is guessing more
    // than they tell somebody who fumbled a paste.
    const revoked = await post(ADMIN, { key: REVOKED_PERSON_KEY });
    const unknown = await post(ADMIN, { key: 'not-a-key-anybody-has' });

    expect(revoked.status).toBe(401);
    expect(revoked.headers.get('set-cookie')).toBeNull();
    expect(await revoked.text()).toBe(await unknown.text());
  });

  it('refuses an empty submission without mentioning the database', async () => {
    const response = await post(ADMIN, {});

    expect(response.status).toBe(401);
    expect(await pageText(response)).toContain('Enter your admin key');
  });

  it('answers identically for an event that exists and one that never did', async () => {
    // **The non-disclosure assertion.** Byte for byte, so a wrong credential cannot be used to
    // find out which events are here.
    const real = await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`);
    const invented = await get(`${ADMIN}entries/zz-no-such-event-at-all/`);

    expect(real.status).toBe(invented.status);
    expect(await real.text()).toBe(await invented.text());
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, Strict and scoped to the admin path', async () => {
    const response = await post(ADMIN, { key: ADMIN_PERSON_KEY });
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/nn/admin');
  });

  it('is Secure over HTTPS', async () => {
    const response = await post(ADMIN, { key: ADMIN_PERSON_KEY });

    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('never contains the key that was presented', async () => {
    const response = await post(ADMIN, { key: ADMIN_PERSON_KEY });

    expect(response.headers.get('set-cookie')).not.toContain(ADMIN_PERSON_KEY);
    expect(await pageText(response)).not.toContain(ADMIN_PERSON_KEY);
  });

  it('signs out, and the cleared cookie matches the path it was set on', async () => {
    const response = await post(ADMIN, { action: 'sign-out' }, session);
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Path=/nn/admin');
    expect(await pageText(response)).toContain('Signed out');
  });
});

// -----------------------------------------------------------------------------------------
// Every response, whatever it is
// -----------------------------------------------------------------------------------------

describe('what every admin response carries', () => {
  it('is noindex, twice, and never cached', async () => {
    for (const address of [ADMIN, `${ADMIN}entries/${ADMIN_EVENT_SLUG}/`]) {
      const response = await get(address, session);

      // The header is what a crawler that never renders the page obeys; the meta element is
      // what survives somebody saving it. Neither depends on a site-wide setting.
      expect(response.headers.get('x-robots-tag'), address).toBe('noindex, nofollow');
      expect(response.headers.get('cache-control'), address).toBe('no-store');
      expect(await pageText(response)).toContain(
        'name="robots" content="noindex, nofollow"',
      );
    }
  });

  it('answers 404 for an address under the prefix that is not one of the seven', async () => {
    const response = await get(`${ADMIN}accounts/`, session);

    expect(response.status).toBe(404);
    // Still `noindex`: falling through to the assets binding would have lost the header.
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('leaves the stylesheet beside it to the assets binding', async () => {
    // **The one character that matters.** `/nn/admin.css` is a real file in `dist/`. If the
    // route predicate treated `/nn/admin` as a plain prefix, the Worker would answer this with
    // a sign-in page and every admin page would render unstyled, silently.
    const response = await get('/nn/admin.css');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
    expect(await response.text()).toContain('--colour-accent');
  });
});

// -----------------------------------------------------------------------------------------
// The entries list
// -----------------------------------------------------------------------------------------

describe('the entries list', () => {
  it('shows every status, one row per entrant', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain('Nwosu, Harriet');
    expect(body).toContain('Adjei, Kwame');
    expect(body).toContain(`${PAID_NON_ASCII_LAST_NAME}, Lena`);
    expect(body).toContain('Toms, Marek');
  });

  it('escapes a name and a club that would otherwise be markup', async () => {
    // **The seed's awkward entrant, and the assertion that stands in for an architecture.**
    // Every other page here is painted by `HTMLRewriter` in its escaping text mode; these pages
    // are built in the Worker, so the escaping is `worker/html.ts`'s and this is what proves it
    // on a real response.
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain(
      `${AWKWARD_LAST_NAME.replace("'", '&#39;')}, ${AWKWARD_FIRST_NAME}`,
    );
    expect(body).toContain('Bristol &amp; West AC, &quot;the Bees&quot;');
    expect(body).not.toContain(AWKWARD_CLUB);
  });

  it('makes an over-capacity payment impossible to miss, in words', async () => {
    // **Not a colour.** The words are what survive a printout, a monochrome screen and a
    // colour-blind reader, and this is the one row on the page that must reach somebody.
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain('Needs a human');
    expect(body).toContain('Over capacity');
    expect(body).toContain('arrived after its place had gone');
  });

  it('counts places against capacity by the capacity predicate', async () => {
    // Three paid and one live hold against a capacity of two: four of two. An expired hold and a
    // refund are not counted, which is what `create_pending_purchase()` counts and therefore
    // what the page must say.
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain('4');
    expect(body).toContain('of 2');
  });

  it('derives the category and shows no date of birth', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    // Born 6 December 1986, race 6 December 2026. A birthday **on** race day counts.
    expect(body).toContain('Vet 40');
    expect(body).toContain('Vet 60');
    expect(body).not.toContain('1986-12-06');
    expect(body).not.toContain('06/12/1986');
  });

  it('shows the England Athletics number for an affiliated entry', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    // The £2 check nobody has been able to do since 2018.
    expect(body).toContain(PAID_EA_NUMBER);
  });

  it('shows no email address anywhere', async () => {
    // Not the entrant's and not the purchaser's. An organiser checking numbers or setting out
    // bibs does not need one.
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).not.toContain('@example.com');
  });

  it('says a note exists and never what it says', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain('Show note');
    expect(body).not.toContain('inhaler');
    expect(body).not.toContain('ibuprofen');
  });

  it('filters by status without putting anything personal in the query string', async () => {
    const response = await get(
      `${ADMIN}entries/${ADMIN_EVENT_SLUG}/?status=paid&sort=name`,
      session,
    );
    const body = await pageText(response);

    expect(body).toContain('Nwosu, Harriet');
    expect(body).not.toContain('Adjei, Kwame');
    expect(body).not.toContain('Toms, Marek');
  });

  it('ignores a filter it does not recognise rather than failing', async () => {
    // A query string is somebody else's input. An unknown sort is `name` and an unknown status
    // is `all` — never an error page, and never a value reaching SQL.
    const response = await get(
      `${ADMIN}entries/${ADMIN_EVENT_SLUG}/?status=%27%3B+drop&sort=../../etc`,
      session,
    );

    expect(response.status).toBe(200);
    expect(await pageText(response)).toContain('Nwosu, Harriet');
  });

  it('offers no way to change anything', async () => {
    /**
     * **Slice E does not edit, and the page is built so that is visible rather than hidden.**
     *
     * Asserted on **where every form goes** rather than on the absence of words like "Refund".
     * The word is on the page legitimately — `Refunded` is one of the five statuses a purchase can
     * be in, and a chip saying so is a fact rather than a control — so a substring test both
     * failed on correct markup and would have passed on a button labelled "Change this entry".
     *
     * The action list is the real invariant: four endpoints, all of which read. If this fails,
     * somebody has added a route that writes to an entry without the thinking that needs.
     */
    const body = await (
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session)
    ).text();

    const actions = new Set(
      [...body.matchAll(/<form[^>]*action="([^"]*)"/g)].map((match) => match[1] ?? ''),
    );

    expect(actions).toEqual(
      new Set([
        // Signing out, which changes a session and nothing else.
        '/nn/admin/',
        // One medical note, audited.
        '/nn/admin/medical/',
        // The three CSVs, audited.
        '/nn/admin/export/',
        // The printable start list, audited.
        '/nn/admin/start-list/',
      ]),
    );

    // And nothing that takes input beyond the hidden fields those four need.
    expect(body).not.toContain('type="checkbox"');
    expect(body).not.toContain('type="text"');
    expect(body.toLowerCase()).not.toContain('<textarea');
    expect(body.toLowerCase()).not.toContain('<select');
  });
});

// -----------------------------------------------------------------------------------------
// The page, in the order the design puts it
// -----------------------------------------------------------------------------------------

/**
 * The dashboard is one page now, and this is the half of it that is not the table.
 *
 * **Every figure is asserted against the seeded rows rather than against a snapshot.** The
 * fixtures are six purchases on the oversold event — three paid (one of them flagged
 * `over_capacity`, one of them affiliated with no England Athletics number), one live hold, one
 * expired hold and one refund — so each expectation below is arithmetic somebody can check against
 * `admin-db.ts` rather than a number that was copied out of a passing run.
 */
describe('where the race stands', () => {
  it('states the breakdown the legend claims, from the rows that were seeded', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    // Three paid: Nwosu, Sørensen (flagged) and Pemberton (no EA number).
    expect(body).toContain('>3</span> paid');
    // One of those three is over capacity.
    expect(body).toContain('>1</span> over capacity');
    // One live hold — Inés O'Rourke.
    expect(body).toContain('>1</span> held right now');
    // One expired hold — Kwame Adjei. A place that came back. **Singular**, because there is one
    // of it: the legend agrees with its own count rather than reading "1 holds".
    expect(body).toContain('>1</span> hold expired and returned');
    // And one refund.
    expect(body).toContain('>1</span> refunded');
  });

  it('adds the fees the way the paid rows add up, and says whose figure is authoritative', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    // Three paid affiliated entries at £15. Not £45 plus the £17 hold, which is not money.
    expect(body).toContain('£45.00');
    expect(body).toContain('Not net of card fees');
  });

  it('states a medical deletion date computed from the enforced retention', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    // The fixture races on 6 December 2026 and `medical_retention` is one month. **This date is
    // `event_date + medical_retention` out of the database**, not a reading of `race.json`'s
    // published sentence — that one is `entries-retention.test.ts`'s to police.
    expect(body).toContain('6 January 2027');
    expect(body).toContain('one month after the race');
  });

  it('names the affiliated claim that gave no number', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    // Reachable, and not by a legacy row — `create_pending_purchase()` does not check it. See
    // `admin-fixtures.ts`.
    expect(body).toContain('without giving a number');
    expect(body).toContain('claimed the affiliated price');
  });

  it('says the closing time is undecided rather than inventing one', async () => {
    // **The one number on the approved design that could not be built.** The 2026 entry open and
    // close times are not confirmed, and a plausible date on this bar is one a volunteer repeats
    // to a runner who then arranges a weekend around it.
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain('not decided yet');
  });
});

/**
 * The attention panel, in both directions.
 *
 * **Both halves are the requirement.** That it appears when something is flagged is the obvious
 * test; that it *stays away* when nothing is, is the one that keeps it worth reading. A panel that
 * is always on the page — with a zero in it, or an "all clear" — is a panel somebody learns to
 * scroll past, and this is the only thing on this surface with a deadline attached to a person.
 *
 * The absence is proved on a **second fabricated event** rather than by filtering the first: the
 * flag is a column on a purchase, so there is no view of the oversold event in which it is not
 * set.
 */
describe('the panel for anything needing a human', () => {
  it('renders when a purchase is flagged, first on the page and in words', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain('Needs a human');
    expect(body).toContain('arrived after its place had gone');
    // Ahead of the figures, because it is the only thing here with a person waiting on it.
    expect(body.indexOf('Needs a human')).toBeLessThan(
      body.indexOf('Where the race stands'),
    );
  });

  it('does not render at all when nothing is flagged', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${CLEAN_EVENT_SLUG}/`, session),
    );

    // The quiet event: two entries against ten places, nothing flagged.
    expect(body).toContain(CLEAN_PAID_LAST_NAME);
    expect(body).not.toContain('Needs a human');
    // **And no empty state and no zero badge.** Neither an "all clear" nor a nought.
    expect(body).not.toContain('0 need a human');
    expect(body).not.toContain('Nothing needs a human');
  });

  it('names an entry by reference rather than by name, in the queue itself', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    // The panel is a list of decisions, so it carries the last four characters of a purchase id.
    // The names are in the table below, where a list of people belongs.
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
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session),
    );

    expect(body).toContain('?status=paid');
    expect(body).toContain('?status=attention');
    // The first pass used a GET form with three selects and an Apply button.
    expect(body).not.toContain('Apply');
    expect(body.toLowerCase()).not.toContain('<select');
    expect(body.toLowerCase()).not.toContain('<script');
  });

  it('marks the current one with aria-current rather than with a colour alone', async () => {
    const body = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/?status=paid`, session),
    );

    expect(body).toContain('aria-current="true"');
  });

  it('returns what each one claims', async () => {
    const paid = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/?status=paid`, session),
    );
    expect(paid).toContain('Nwosu, Harriet');
    expect(paid).not.toContain('Adjei, Kwame');

    const attention = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/?status=attention`, session),
    );
    // Only the flagged row, which is the non-ASCII surname on the over-capacity purchase.
    expect(attention).toContain(PAID_NON_ASCII_LAST_NAME);
    expect(attention).not.toContain('Nwosu, Harriet');

    const expired = await pageText(
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/?status=expired`, session),
    );
    expect(expired).toContain('Adjei, Kwame');
    expect(expired).not.toContain('Nwosu, Harriet');
  });

  it('puts no personal data in any filter link it renders', async () => {
    // **Read off the page rather than off one URL somebody navigated to.** Every `href` the page
    // offers is checked, so a filter added later that carried a name would fail here.
    const body = await (
      await get(`${ADMIN}entries/${ADMIN_EVENT_SLUG}/`, session)
    ).text();

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
 * **A POST, because rendering it writes an audit row.** Printing a sheet of names and emergency
 * contacts is taking a copy out of the platform, exactly as the CSV is, so it goes through
 * `entries.admin_export()` and is recorded the same way. A GET would let a prefetch, a scanner or
 * a link pasted into a chat client file an export against somebody's handle.
 */
describe('the printable start list', () => {
  it('renders paid entries with their emergency contacts, and no medical note', async () => {
    const body = await pageText(
      await post(`${ADMIN}start-list/`, { event: ADMIN_EVENT_SLUG }, session),
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
    const response = await get(`${ADMIN}start-list/`, session);

    expect(response.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------------------
// The interest list
// -----------------------------------------------------------------------------------------

describe('the interest list', () => {
  it('shows the sign-ups with their addresses, and says who may not be written to', async () => {
    const body = await pageText(await get(`${ADMIN}interest/`, session));

    // The seed's sign-ups. The address is the point of this list — the club promised these
    // people one email — and a withheld consent is shown rather than filtered out.
    expect(body).toContain('alice@example.com');
    expect(body).toContain('No — do not write');
  });

  it('escapes an apostrophe and leaves a non-ASCII name alone', async () => {
    const body = await pageText(await get(`${ADMIN}interest/`, session));

    expect(body).toContain('Dara O&#39;Sullivan');
    expect(body).toContain('Émile Boisvert');
  });
});

// -----------------------------------------------------------------------------------------
// One medical note
// -----------------------------------------------------------------------------------------

describe('reading one medical note', () => {
  it('needs a POST, so no entrant id ever reaches a URL', async () => {
    // A GET would put the id in the address bar, in browser history and in a `Referer`. The
    // route does not exist as a GET at all.
    const response = await get(`${ADMIN}medical/`, session);

    expect(response.status).toBe(404);
  });

  it('shows the note for an entrant that has one', async () => {
    const response = await post(
      `${ADMIN}medical/`,
      { entrantId: PAID_ENTRANT_ID },
      session,
    );

    expect(response.status).toBe(200);
    expect(await pageText(response)).toContain('inhaler');
  });

  it('says plainly when there is no note, rather than looking broken', async () => {
    const response = await post(
      `${ADMIN}medical/`,
      { entrantId: OVER_ENTRANT_ID },
      session,
    );

    expect(response.status).toBe(200);
    expect(await pageText(response)).toContain('no note against this entry');
  });

  it('answers the same for an unknown id and for one that is not an id', async () => {
    const unknown = await post(
      `${ADMIN}medical/`,
      { entrantId: '00000000-0000-4000-8000-000000000000' },
      session,
    );
    const nonsense = await post(`${ADMIN}medical/`, { entrantId: 'nonsense' }, session);

    expect(unknown.status).toBe(404);
    expect(nonsense.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------------------
// The exports
// -----------------------------------------------------------------------------------------

describe('the exports', () => {
  /**
   * A CSV response, as **bytes and as text**, and the two are not interchangeable here.
   *
   * **`Response.text()` silently removes the byte-order mark.** The mark really is on the wire \u2014
   * `csvDocument` puts it there and Excel needs it to read `S\u00F8rensen` as anything but mojibake \u2014
   * but `text()` decodes UTF-8 with `TextDecoder`, whose default is to strip a leading U+FEFF.
   * So a test that asserts on the decoded string sees a file with no mark and reports a bug that
   * is not there; one that asserts the mark is *absent* would pass on a file that would open
   * wrong on every Windows machine the club owns.
   *
   * The bytes are therefore what the mark is asserted on, and the text is what everything else
   * is asserted on. This cost the first run of this file.
   */
  async function csv(kind: string): Promise<{ bytes: Uint8Array; text: string }> {
    const response = await post(
      `${ADMIN}export/`,
      { event: ADMIN_EVENT_SLUG, kind },
      session,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain(
      `filename="${ADMIN_EVENT_SLUG}-${kind}.csv"`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await response.arrayBuffer());

    // Decoded with the mark kept, so `text` is the whole file rather than the file minus three
    // bytes \u2014 and so `split('\r\n')[0]` is the header row as written.
    const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false }).decode(
      bytes,
    );

    return { bytes, text };
  }

  /** `EF BB BF` \u2014 the UTF-8 encoding of U+FEFF, which is what is actually sent. */
  const UTF8_BOM = [0xef, 0xbb, 0xbf];

  it('gives the England Athletics check exactly its columns', async () => {
    const { text } = await csv('ea');

    expect(text.split('\r\n')[0]).toBe(
      '\uFEFFLast name,First name,Club,EA number,Entry type,Paid (pence)',
    );
    expect(text).toContain(PAID_EA_NUMBER);
    // No emergency contact and no note: a membership secretary is comparing numbers.
    expect(text).not.toContain('Kin ');
    expect(text).not.toContain('inhaler');
  });

  it('gives the start list its emergency contacts and no note', async () => {
    const { text } = await csv('start-list');

    expect(text.split('\r\n')[0]).toBe(
      '\uFEFFLast name,First name,Club,Category,Emergency contact,Emergency phone',
    );
    expect(text).toContain('Kin Nwosu');
    expect(text).toContain('Vet 40');
    expect(text).not.toContain('inhaler');
  });

  it('gives the medical export the note, and nothing beyond a name and a club', async () => {
    const { text } = await csv('medical');

    expect(text.split('\r\n')[0]).toBe('\uFEFFLast name,First name,Club,Medical note');
    expect(text).toContain('inhaler');
    expect(text).not.toContain('Kin Nwosu');
  });

  it('really sends the byte-order mark, asserted on the bytes', async () => {
    // **On the bytes, because `Response.text()` removes it.** See the note on `csv` above: a
    // decoded assertion here would report a mark that is present as missing, and an assertion
    // written the other way round would pass on a file that opens as mojibake on every Windows
    // machine the club owns.
    const { bytes, text } = await csv('start-list');

    expect([...bytes.slice(0, 3)]).toEqual(UTF8_BOM);
    expect(text).toContain('\r\n');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('escapes a club containing a comma and a quote, on a row that is in the file', async () => {
    // **The case that matters, on a paid entrant.** An earlier version of this put the awkward
    // club on the pending one — which is in no export at all, so the assertion passed by never
    // having the row to check. The whole line is asserted rather than a fragment: a comma that
    // escaped quoting would shift every column after it, and only the whole row shows that.
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
    // Without the mark, Excel opens `Sørensen` as mojibake and somebody retypes the start list
    // by hand. The mark is asserted above; this is the name surviving next to it.
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
      `${ADMIN}export/`,
      { event: ADMIN_EVENT_SLUG, kind: 'everything' },
      session,
    );

    expect(response.status).toBe(404);
  });
});
