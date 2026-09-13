import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  clearRosterEvent,
  clearStartEvents,
  rosterEventSlug,
  seedRosterEvent,
  seedStartEvents,
  seedTimingFixtures,
  startEventSlug,
  START_FIXTURE_FINISHED_LONDON,
  START_FIXTURE_STARTED_LONDON,
  type StartFixtureState,
} from '../timing-db';
import { clearTimingStaff, seedTimingStaff } from '../timing-staff-db';
import { TIMING_ADMIN_EMAIL, TIMING_MARSHAL_EMAIL } from '../admin-fixtures';
import { RESULTS_EVENT_NAME, RESULTS_EVENT_SLUG } from '../timing-fixtures';
import { expectNoSidewaysScroll, waitForStyledLayout } from '../sideways-scroll';
import { forgetSessions, signInAs } from './sign-in';

/**
 * `/timing`'s own pages, in a real browser — #247.
 *
 * `admin.spec.ts` asserts the club side is refused here; this file is the other half, the
 * people who may come in. It is a separate spec because it is a separate application: these
 * addresses are served by the timing Worker, which Cloudflare dispatches at the edge and
 * `apps/main` never sees.
 *
 * ⚠️ **This spec seeds its own people and never the club's, and CI is what proved it has to.**
 * The first version called `seedAdminFixtures()` like `admin.spec.ts` does, and the two files
 * then raced to sign the same addresses up: `AuthApiError: User already registered`, in a
 * `beforeAll`, on whichever shard ran them together. **One spec, one set of people it owns
 * outright** — `timing-staff-db.ts` creates exactly the two timing accounts and clears exactly
 * those two, and touches nothing `admin.spec.ts` depends on.
 *
 * The races come from `timing-db.ts`, which already fabricates two runnings for
 * `/nn/<year>/results/` and which no other spec seeds.
 *
 * ⚠️ **The two people hold timing roles and nothing else**, deliberately: granting a timing
 * role to one of the club-side fixtures would silently delete `admin.spec.ts`'s "different
 * doors" assertions, which are the other half of this boundary.
 */

const EVENTS = '/timing/events/';

/**
 * ⚠️ **No trailing slash, because that is what `next/link` generates.** `apps/main` is
 * `trailingSlash: 'always'` and `apps/timing` sets nothing, so a link built here lands on the
 * slashless spelling. Both resolve — `surfaceFor()` ignores a trailing slash and Next serves
 * either — and there is a test below that pins it, because a link written by hand elsewhere
 * will reach for the club's convention rather than this one.
 */
const EVENT = `/timing/events/${RESULTS_EVENT_SLUG}`;

/**
 * The roster tests write, so they get a running of their own **per Playwright project** —
 * `timing-db.ts`'s `rosterEventSlug` carries the argument. The short of it: two projects of
 * this file can be in flight at once, and a shared roster would make each occasionally assert
 * against the other's writes.
 */
const rosterPath = (project: string): string =>
  `/timing/events/${rosterEventSlug(project)}/marshals`;

/*
 * ⚠️ **`{}` is required by Playwright and rejected by ESLint, so the rule is turned off for
 * exactly these two lines.** Playwright reads the *source* of a hook to work out which
 * fixtures to set up, and refuses a first argument that is not a destructuring pattern —
 * `First argument must use the object destructuring pattern: _fixtures`, thrown while listing
 * tests, before anything runs. So the empty pattern is the API, not a style choice, and
 * renaming it to `_fixtures` does not work. `testInfo` is the second argument and is what
 * these hooks are actually after: the **project name**, which is what gives each Playwright
 * project a roster event of its own — see `timing-db.ts`'s `rosterEventSlug`.
 */
// eslint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, testInfo) => {
  await seedTimingStaff();
  await seedTimingFixtures();
  await seedRosterEvent(rosterEventSlug(testInfo.project.name));
  // #250's five runnings, likewise one set per project — `seedStartEvents`' header carries
  // the argument, and why these are re-created rather than seeded idempotently.
  await seedStartEvents(testInfo.project.name);
  // The people were just re-created, so any jar cached by another spec names somebody who no
  // longer exists. See `forgetSessions`.
  forgetSessions();
});

/*
 * ⚠️ **`clearTimingFixtures()` is deliberately NOT called here**, and leaving it in was a real
 * failure rather than untidiness. This hook runs once **per project**, and two projects of
 * this file can be in flight at the same time — so the first to finish deleted the two
 * fabricated races out from under the one still reading them. It surfaced a long way from its
 * cause: a hub page rendered "Not found" and the test waiting on a link on it failed as a
 * ten-second timeout naming the link.
 *
 * `seedTimingFixtures()` is idempotent now and nothing here deletes those rows. They are two
 * runnings of years that will not happen, in a database `./dev up`, `./dev check` and
 * `./dev test` each rebuild from zero — and `tests/worker/admin/global-setup.ts`, which is
 * single-threaded, still clears them.
 *
 * The two below are safe because each is scoped to something this project owns outright: the
 * roster event carries the project name, and the staff accounts carry the worker slot.
 */
// eslint-disable-next-line no-empty-pattern
test.afterAll(async ({}, testInfo) => {
  await clearRosterEvent(rosterEventSlug(testInfo.project.name));
  await clearStartEvents(testInfo.project.name);
  await clearTimingStaff();
});

/**
 * ⚠️ **The assertions that would pass for the wrong reason if the table were deleted.**
 *
 * Every address under `/timing` 404s to somebody who may not open it — and an address that
 * does not exist also 404s. So a refusal test is only worth something next to a positive one
 * on the same address, which is why each of these sits beside a test proving the page renders
 * for somebody who may. `apps/timing/tests/unit/access.test.ts` covers the mapping itself.
 */
test.describe('who may open the events pages', () => {
  test('a timing-marshal is refused both, and gets the ordinary 404', async ({
    page,
  }) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    for (const path of [EVENTS, EVENT]) {
      const response = await page.goto(path);

      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
      // The same sentence a genuinely missing address gives, so the refusal discloses nothing.
      await expect(page.getByText('There is nothing at this address.')).toBeVisible();
    }
  });

  test('but reaches the landing page, which is what their permission opens', async ({
    page,
  }) => {
    // Without this the test above passes if the marshal were locked out of `/timing`
    // altogether — which is the mistake a too-eager permission table makes.
    await signInAs(page, TIMING_MARSHAL_EMAIL);

    const response = await page.goto('/timing');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race timing');
  });

  test('a signed-out visitor is refused', async ({ page }) => {
    await page.context().clearCookies();

    expect((await page.goto(EVENTS))?.status()).toBe(404);
  });
});

test.describe('the events list', () => {
  test('lists the races a timing-admin may manage', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto(EVENTS);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Races');
    await expect(page.getByRole('link', { name: RESULTS_EVENT_NAME })).toBeVisible();
  });

  test('links each race to its own page', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENTS);
    await page.getByRole('link', { name: RESULTS_EVENT_NAME }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(RESULTS_EVENT_NAME);
    expect(new URL(page.url()).pathname).toBe(EVENT);
  });

  /**
   * The club's side is `trailingSlash: 'always'` and this application sets nothing, so a link
   * written by hand elsewhere is likely to carry a slash this one's own links do not. Both
   * have to reach the page, or a correct-looking link 404s.
   */
  test('serves the same race with or without a trailing slash', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    expect((await page.goto(`${EVENT}/`))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(RESULTS_EVENT_NAME);
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENTS);

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(EVENTS);

    await expectNoSidewaysScroll(page, 'the timing events list at 320px');
  });
});

test.describe('one race', () => {
  test('shows the counts a volunteer is deciding from', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);

    await expect(
      page.getByRole('heading', { name: 'Where it has got to' }),
    ).toBeVisible();
    // `timing-db.ts`'s fixture running has a field on it, so these are not all zero — a page
    // of zeroes would render identically whether or not the counts were wired up.
    await expect(
      page
        .getByRole('definition')
        .filter({ hasText: /^[1-9]/ })
        .first(),
    ).toBeVisible();
  });

  /**
   * ⚠️ **The refusal and the missing race are the same answer, deliberately.**
   * `event_detail()` returns `null` for both, so a slug cannot be probed for existence — and
   * this page cannot tell them apart either, which is the point rather than a limitation.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto('/timing/events/zz-no-such-race/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
    await expect(page.getByText('There is nothing at this address.')).toBeVisible();
  });

  test('has no accessibility violations @requires-js', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(EVENT);

    await expectNoSidewaysScroll(page, 'one timing race at 320px');
  });
});

/**
 * The marshal roster — [#245](https://github.com/southville-running-club/src-website/issues/245),
 * under [ADR-036](../../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md).
 *
 * ⚠️ **This is the first thing in `/timing` that changes anything**, so these are the first
 * tests here that are about a write. Two properties are worth more than the rest and are
 * asserted first: **the address the form posts to is gated exactly as the page is** — a POST
 * that opens more widely than the page it came from changes a race's roster rather than merely
 * disclosing one — and **every test in this block runs in the `no-javascript` project**, which
 * is what holds the choice of a plain `<form method="post">` over a Server Action honest.
 */
test.describe('who may open the marshal roster', () => {
  test('a timing-marshal is refused the page and the form it posts to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const path = rosterPath(testInfo.project.name);

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    // ⚠️ **The half a page test cannot reach.** `timing.marshal.assign` is what both demand,
    // and a marshal holds neither — but only the POST would actually change a roster, so it
    // is asserted directly rather than inferred from the page beside it.
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'assign', person_id: '00000000-0000-4000-8000-000000000001' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });

  test('a signed-out visitor is refused both', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the *cached jars* this
    // whole file signs in from, which is a `beforeAll` concern and would make every test after
    // this one authenticate again. The sibling test above uses the same call for that reason.
    await page.context().clearCookies();
    const path = rosterPath(testInfo.project.name);

    expect((await page.goto(path))?.status()).toBe(404);

    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'assign', person_id: '00000000-0000-4000-8000-000000000001' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });
});

test.describe('the marshal roster', () => {
  test('opens to a timing-admin, and says nobody is on it yet', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto(rosterPath(testInfo.project.name));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Marshals');
    /*
     * ⚠️ **The empty roster says *why* it matters, and that sentence is load-bearing.**
     * ADR-036 checks the roster after the permission for everybody, so a `timing-admin` who
     * is going to stand at the line is not on it by holding the role — and the old
     * application's behaviour was the opposite. The first time anybody finds that out must
     * not be on a start line.
     */
    await expect(page.getByText(/Nobody is on this roster yet/)).toBeVisible();
    await expect(page.getByText(/adds themselves like anybody else/)).toBeVisible();
  });

  test("is linked from the race's own page", async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);
    await page.getByRole('link', { name: 'Marshals for this race' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Marshals');
    expect(new URL(page.url()).pathname).toBe(`${EVENT}/marshals`);
  });

  /**
   * ⚠️ **One test for the whole round trip, deliberately.** Assigning and removing are two
   * tests' worth of assertions and one test's worth of state: split in two, the second would
   * depend on the first having run — which `fullyParallel` is free to stop being true — and
   * neither would prove the pair. The round trip is also what a volunteer actually does.
   */
  test('puts somebody on the roster, and takes them off again', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(rosterPath(testInfo.project.name));

    // The picker carries an address because `identity.people.name` is null for everybody
    // until #61 — the roster deliberately does not, so the person reads as "No name recorded"
    // once they are on it. `20260912110000`'s header argues both halves.
    await page.selectOption('#person_id', { label: TIMING_MARSHAL_EMAIL });
    await page.getByRole('button', { name: 'Add to this roster' }).click();

    await expect(page.getByText('They are on the roster for this race.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No name recorded' })).toBeVisible();

    /*
     * ⚠️ **ADR-036's rule, asserted where it is actually visible.** The person just added is
     * no longer offered — the picker subtracts the roster — and the `timing-admin` doing the
     * adding **still is**, because `timing-admin` carries `timing.crossing.record` and a
     * roster is checked after the permission for everybody. The old application let a global
     * admin bypass the roster entirely; if that ever comes back, this is the line that goes
     * red.
     */
    await expect(
      page.locator('#person_id option', { hasText: TIMING_MARSHAL_EMAIL }),
    ).toHaveCount(0);
    await expect(
      page.locator('#person_id option', { hasText: TIMING_ADMIN_EMAIL }),
    ).toHaveCount(1);

    await page.getByRole('button', { name: /^Remove No name recorded/ }).click();

    /*
     * The sentence that stops somebody being put on a start line who is not on it, and the
     * one `unassign_marshal()`'s own header promises: a roster change is not a deleted
     * person, and what they recorded is untouched.
     */
    await expect(page.getByText(/off the roster for this race/)).toBeVisible();
    await expect(page.getByText(/Anything they recorded is unchanged/)).toBeVisible();
    await expect(page.getByText(/Nobody is on this roster yet/)).toBeVisible();
  });

  /**
   * ⚠️ **A refusal and a missing race are the same answer**, because `roster_for_event()`
   * returns `null` for both so a slug cannot be probed for existence.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto('/timing/events/zz-no-such-race/marshals');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
    await expect(page.getByText('There is nothing at this address.')).toBeVisible();
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(rosterPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(rosterPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing marshal roster at 320px');
  });
});

/**
 * The start screen — [#250](https://github.com/southville-running-club/src-website/issues/250),
 * under [ADR-034](../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md).
 *
 * ⚠️ **This is the screen that decides what every result in the race is measured from**, so
 * two properties are asserted before any of the rendering: **the form's address is gated
 * exactly as the page is**, and **every test in this block runs in the `no-javascript`
 * project**. The second is not a box-tick here — a start line is a phone, outdoors, on a bad
 * connection, and a control that needed a script would fail in the one place there is no
 * second try. The countdown and the elapsed clock are the *only* things on this page that need
 * JavaScript, and each renders a true sentence without it.
 */
const startPath = (project: string, state: StartFixtureState): string =>
  `/timing/events/${startEventSlug(project, state)}/start`;

test.describe('who may open the start screen', () => {
  test('a timing-marshal is refused the page and the form it posts to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const path = startPath(testInfo.project.name, 'pending');
 * `/timing/events/<slug>/registration/` — the entry list, #202, carrying #249's page half.
 *
 * ⚠️ **These tests write to the same per-project running the roster tests use**, for the
 * reason `timing-db.ts`'s `rosterEventSlug` gives: two Playwright projects of this file can be
 * in flight at once, and a shared race would make each occasionally assert against the other's
 * writes. Within one project the tests run one at a time, so sharing the race with the marshal
 * roster is safe — a roster and an entry list touch different tables.
 *
 * **Every CSV below carries its own `PurchaseOrderId` values and its own invented surnames**,
 * so no test can be made to pass or fail by another having run first. That is the same rule
 * `entries` learned when a suite whose runners were all the same person stopped being able to
 * hold two places.
 */
const registrationPath = (project: string): string =>
  `/timing/events/${rosterEventSlug(project)}/registration`;

/**
 * A Full On Sport export, as small as the parser will accept one.
 *
 * The header is the real thing's, trailing comma and all — `KNOWN_COLUMNS` carries an empty
 * string entry for exactly that. **The `DOB` column is left empty**, deliberately: the fixture
 * races are dated 2099 and an age computed against one would be a hundred and something, which
 * reads as a defect in an assertion. The date of birth is dropped at the parser either way,
 * which is the property this slice exists for.
 */
function fullOnSportCsv(
  rows: { poId: string; first: string; last: string; gender: string }[],
): Buffer {
  const header =
    'EventName,EntryType,EntryPaid,EnteredBy,RaceNumber,ep_id,EA_URN,Title,Firstname,Lastname,DOB,Gender,Email,DateEntered,OwnerMember,ClubName,TeamName,AgeOnDay,AgeCategory,PurchaseOrderId,Address1,Address2,Address3,County,City,POSTCODE,PrimaryContactTel,SecondaryContactTel,EmergencyName,EmergencyTel,MedicalInformation,version,';

  const body = rows.map(
    (row) =>
      `zz Fixture Race,Solo,Yes,web,,,,,${row.first},${row.last},,${row.gender},` +
      `${row.first.toLowerCase()}@example.com,,${row.first} ${row.last},zz Fixture AC,,,,` +
      `${row.poId},,,,,,,,,,,,1,`,
  );

  return Buffer.from([header, ...body].join('\n'), 'utf-8');
}

const csvUpload = (buffer: Buffer) => ({
  name: 'entries.csv',
  mimeType: 'text/csv',
  buffer,
});

test.describe('who may open the entry list', () => {
  test('a timing-marshal is refused the page and both addresses it posts to', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_MARSHAL_EMAIL);
    const path = registrationPath(testInfo.project.name);

    const shown = await page.goto(path);
    expect(shown?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');

    // ⚠️ **The half a page test cannot reach**, and the half that would actually start a race.
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'start' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });

  test('a signed-out visitor is refused both', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the cached jars this
    // whole file signs in from, which is a `beforeAll` concern.
    await page.context().clearCookies();
    const path = startPath(testInfo.project.name, 'pending');
    /*
     * ⚠️ **The half a page test cannot reach.** `timing.registration.import` is what all three
     * demand and a marshal holds none of it — but only the two POSTs would actually change an
     * entry list, so each is asserted directly rather than inferred from the page beside them.
     * This is also what keeps `EVENT_SECTION_ACTIONS`' "refused by omission" honest: a write
     * address is gated by the same table a page is.
     */
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'assign-bibs' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);

    const uploaded = await page.request.post(`${path}/import`, {
      multipart: {
        intent: 'import',
        file: csvUpload(
          fullOnSportCsv([
            { poId: 'ZZ-REFUSED-1', first: 'Refused', last: 'Zzquiller', gender: 'F' },
          ]),
        ),
      },
      maxRedirects: 0,
    });
    expect(uploaded.status()).toBe(404);
  });

  test('a signed-out visitor is refused all three', async ({ page }, testInfo) => {
    // `clearCookies()` and not `forgetSessions()` — the latter drops the cached jars this whole
    // file signs in from, which is a `beforeAll` concern.
    await page.context().clearCookies();
    const path = registrationPath(testInfo.project.name);

    expect((await page.goto(path))?.status()).toBe(404);

    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'start' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);
  });

  test('leaves the race unstarted after both refusals', async ({ page }, testInfo) => {
    // Without this the two tests above pass if the POST 404'd *after* writing. Read back as
    // somebody who may, on the page that would say so.
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'pending'));

    await expect(page.getByRole('heading', { name: 'Not started' })).toBeVisible();
  });
});

test.describe('a race that has not started', () => {
  test('counts down and offers the one button, with or without scripting', async ({
      form: { intent: 'assign-bibs' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(404);

    const uploaded = await page.request.post(`${path}/import`, {
      multipart: {
        intent: 'import',
        file: csvUpload(
          fullOnSportCsv([
            { poId: 'ZZ-REFUSED-2', first: 'Refused', last: 'Zzquiller', gender: 'F' },
          ]),
        ),
      },
      maxRedirects: 0,
    });
    expect(uploaded.status()).toBe(404);
  });
});

test.describe('the entry list', () => {
  test('opens to a timing-admin and says nothing has been imported yet', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);

    const response = await page.goto(startPath(testInfo.project.name, 'pending'));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start');
    await expect(page.getByRole('heading', { name: 'Not started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start the race' })).toBeVisible();

    /*
     * ⚠️ **The migration's own rule, on the page.** A clock reaching zero starts nothing;
     * `start_event()` stores `now()` and never reads `start_at`. If this sentence ever goes,
     * somebody will build a screen that fires on a timer.
     */
    await expect(page.getByText(/A clock reaching zero starts nothing/)).toBeVisible();

    // And the sentence that stops a double press being read as a failure.
    await expect(
      page.getByText(/Pressing it twice does not move the clock/),
    ).toBeVisible();
  });

  test('is keyboard-operable, so the button can be reached without a pointer', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'pending'));

    // A real `<button type="submit">` in a real form, so this is the browser's own behaviour
    // rather than anything this page had to arrange — which is the assertion.
    const button = page.getByRole('button', { name: 'Start the race' });
    await button.focus();
    await expect(button).toBeFocused();
  });

  test("is linked from the race's own page", async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const slug = startEventSlug(testInfo.project.name, 'pending');

    await page.goto(`/timing/events/${slug}`);
    await page.getByRole('link', { name: 'Start this race' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start');
    expect(new URL(page.url()).pathname).toBe(`/timing/events/${slug}/start`);
  });

  /**
   * ⚠️ **A refusal and a missing race are the same answer**, because `event_detail()` returns
    const response = await page.goto(registrationPath(testInfo.project.name));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entry list');

    /*
     * ⚠️ **Both ways in are on the page and the club's own entries come first**, because
     * ADR-039 made that the critical path and the CSV the archive one. If the order ever
     * inverts, somebody setting up Nightingale Nightmare reaches for a file that should not
     * exist — and making one would put a date of birth in it.
     */
    await expect(page.getByRole('button', { name: 'Import from entries' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import this file' })).toBeVisible();

    /*
     * The transparency note the parser's own header asks for: a volunteer can see what is and
     * is not being kept, named column by column, before they upload anything.
     */
    await expect(page.getByText(/MedicalInformation/)).toBeVisible();
    await expect(page.getByText(/Nothing about the file itself is kept/)).toBeVisible();
  });

  test("is linked from the race's own page", async ({ page }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(EVENT);
    await page.getByRole('link', { name: 'Entry list for this race' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entry list');
    expect(new URL(page.url()).pathname).toBe(`${EVENT}/registration`);
  });

  test('imports a CSV and puts the runners on the start list', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-IMPORT-1', first: 'Aloysius', last: 'Zzimport', gender: 'M' },
          { poId: 'ZZ-IMPORT-2', first: 'Bernadette', last: 'Zzimport', gender: 'F' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Import this file' }).click();

    await expect(page.getByText(/The entry list was imported/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aloysius Zzimport' })).toBeVisible();
    await expect(page.getByText('Bernadette Zzimport — Female')).toBeVisible();

    /*
     * ⚠️ **The leak assertion, and it is derived from the fixture rather than written as a
     * literal** — `nn-entry-complete.spec.ts`'s rule, learned when a guard matched a bare
     * number against markup full of SVG coordinates and could never have failed. What is
     * checked here is the **URL**: findings and outcomes cross the redirect in the query
     * string, and the parser's own messages name runners and quote their addresses. Nothing
     * off the file may appear there.
     */
    expect(page.url()).not.toContain('Zzimport');
    expect(page.url()).not.toContain('example.com');
  });

  /**
   * ⚠️ **Checking imports nothing, and that is the whole of the preview.** There is nowhere to
   * hold a parsed file between two requests — #202 leaves *whether the raw file is kept at
   * all* unanswered, so this path keeps nothing — which is why the preview is a second submit
   * of the same form rather than a stored result.
   */
  test('reads a file without importing it, and says which rows are wrong', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-CHECK-1', first: 'Cuthbert', last: 'Zzcheck', gender: 'M' },
          // No race category, which is one of the four fields every row must carry.
          { poId: 'ZZ-CHECK-2', first: 'Drusilla', last: 'Zzcheck', gender: '' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Check this file' }).click();

    await expect(page.getByText(/nothing was imported/)).toBeVisible();
    await expect(page.getByText(/Has to be fixed/)).toBeVisible();
    await expect(page.getByText(/Rows? 2/)).toBeVisible();

    // Nothing landed, so neither runner is on the start list — including the good row, because
    // the whole file is refused rather than half applied.
    await expect(page.getByRole('heading', { name: 'Cuthbert Zzcheck' })).toHaveCount(0);
    expect(page.url()).not.toContain('Zzcheck');
  });

  test('refuses to import a file with a row it cannot use', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-BLOCK-1', first: 'Eustace', last: 'Zzblock', gender: 'M' },
          { poId: '', first: 'Ffion', last: 'Zzblock', gender: 'F' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Import this file' }).click();

    await expect(page.getByText(/Nothing was imported/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Eustace Zzblock' })).toHaveCount(0);
  });

  test('says so when the file is not a CSV at all', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles('#file', {
      name: 'entries.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 not a spreadsheet', 'utf-8'),
    });
    await page.getByRole('button', { name: 'Import this file' }).click();

    await expect(page.getByText(/does not look like a CSV/)).toBeVisible();
  });

  /**
   * ⚠️ **One test for the whole round trip, deliberately** — the roster tests' rule. Assigning
   * and then pressing again are two tests' worth of assertions and one test's worth of state,
   * and split in two the second would depend on the first having run.
   *
   * It imports its own entries first, so *"there was something unnumbered to number"* is true
   * whatever else has run in this project.
   */
  test('numbers a field once, and never renumbers it', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.setInputFiles(
      '#file',
      csvUpload(
        fullOnSportCsv([
          { poId: 'ZZ-BIBS-1', first: 'Gwendolyn', last: 'Zzbibs', gender: 'F' },
          { poId: 'ZZ-BIBS-2', first: 'Horatio', last: 'Zzbibs', gender: 'M' },
        ]),
      ),
    );
    await page.getByRole('button', { name: 'Import this file' }).click();
    await expect(page.getByText(/The entry list was imported/)).toBeVisible();

    await page.getByRole('button', { name: 'Assign bibs' }).click();
    await expect(page.getByText(/Bibs were assigned/)).toBeVisible();

    /*
     * The sentence that stops somebody going looking for a problem that is not there.
     * `assign_bibs()` is idempotent **by skipping**, so a second press is meant to do nothing —
     * and "0 entries were numbered" reads as a failure.
     */
    await page.getByRole('button', { name: 'Assign bibs' }).click();
    await expect(page.getByText(/Every entry already has a number/)).toBeVisible();
  });

  /**
   * The desk path, end to end: somebody turns up, gets the next free number, and then gets
   * handed a physical bib that is not that number.
   */
  test('takes a walk-in at the desk, and the bib they were actually handed', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(registrationPath(testInfo.project.name));

    await page.fill('#firstname', 'Isambard');
    await page.fill('#lastname', 'Zzwalkin');
    await page.selectOption('#gender', 'male');
    await page.fill('#age_on_day', '41');
    await page.fill('#club_name', 'zz Fixture AC');
    await page.getByRole('button', { name: 'Add this walk-in' }).click();

    await expect(page.getByText(/That walk-in is on the start list/)).toBeVisible();
    await expect(
      page.getByText('Isambard Zzwalkin — Male, 41, zz Fixture AC'),
    ).toBeVisible();

    /*
     * ⚠️ **A bib written on beats the number the entry derives**, which is `effectiveBib()`'s
     * whole contract and the one thing ADR-034 says the rewrite may not break. `9081` is
     * invented and deliberately outside anything `assign_bibs()` hands out, so it cannot clash
     * with another test's field.
     */
    await page.getByLabel('Bib written on for Isambard Zzwalkin').fill('9081');
    await page
      .getByRole('button', { name: 'Save the bib for Isambard Zzwalkin' })
      .click();

    await expect(
      page.getByText(/That bib is recorded against the leg you chose/),
    ).toBeVisible();
    await expect(page.getByLabel('Bib written on for Isambard Zzwalkin')).toHaveValue(
      '9081',
    );
  });

  /**
   * ⚠️ **A refusal and a missing race are the same answer**, because `event_roster()` returns
   * `null` for both so a slug cannot be probed for existence.
   */
  test('gives a race that does not exist the ordinary not-found page', async ({
    page,
  }) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto('/timing/events/zz-no-such-race/start');
    await page.goto('/timing/events/zz-no-such-race/registration');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
    await expect(page.getByText('There is nothing at this address.')).toBeVisible();
  });

  test('has no accessibility violations @requires-js', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'pending'));
    await page.goto(registrationPath(testInfo.project.name));

    await waitForStyledLayout(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(violations).toEqual([]);
  });

  test('does not push the page sideways at 320px', async ({ page }, testInfo) => {
    // ⚠️ **The full-width button and a clock in `clamp(2rem, 12vw, 3rem)` are both new here**,
    // and a big number beside a long timezone name is exactly the shape that has pushed pages
    // sideways in this repository before.
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(startPath(testInfo.project.name, 'pending'));

    await expectNoSidewaysScroll(page, 'the timing start screen at 320px');
  });
});

test.describe('the gun', () => {
  /**
   * ⚠️ **One test for the whole thing, deliberately** — the roster's argument, and here it is
   * stronger: a race can only be started once, so a second test asserting the second press
   * would depend on the first having run, and `fullyParallel` is free to stop being true.
   *
   * The second press is made with `page.request.post` rather than by clicking, because there
   * **is no button to click** once the race is running — which is itself the point. That is the
   * losing device in the shape it actually arrives: a form re-posted from a page somebody's
   * browser was already holding.
   */
  test('starts the race, and a second press does not move the clock', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const path = startPath(testInfo.project.name, 'press');
    await page.goto(path);

    await page.getByRole('button', { name: 'Start the race' }).click();

    await expect(page.getByText(/The race has started/)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'The race is running' }),
    ).toBeVisible();

    const started = await page.getByText(/^It started /).textContent();
    expect(started).toBeTruthy();

    // The button is gone, which is what makes the direct POST the honest way to press again.
    await expect(page.getByRole('button', { name: 'Start the race' })).toHaveCount(0);

    const again = await page.request.post(`${path}/update`, {
      form: { intent: 'start' },
      maxRedirects: 0,
    });

    // 303, so Back and Reload both do the harmless thing — and the outcome the losing device
    // is sent back with is the truthful one rather than an error.
    expect(again.status()).toBe(303);
    expect(again.headers()['location']).toContain('outcome=already_started');

    await page.goto(path);

    // ⚠️ **The assertion the whole issue exists for.** Every runner's time is measured from
    // this moment, and the second press did not move it.
    await expect(page.getByText(/^It started /)).toHaveText(started as string);
    await expect(page.getByText(/had already started/)).toHaveCount(0);
  });
});

test.describe('a race that is running', () => {
  /**
   * ⚠️ **The clocks-change assertion, and it is the reason this fixture exists.** The start is
   * `2026-10-25T00:30:00Z`, which is **01:30 BST** in London on the morning the clocks go back
   * — 01:30 happens twice that day and this is the first pass. A page rendering the UTC value
   * would say 00:30; one guessing the offset would say GMT. The race itself is the following
   * weekend, so an hour of drift here is an hour of drift there.
   */
  test('shows the start in London time, on the morning the clocks go back', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'running'));

    await expect(
      page.getByRole('heading', { name: 'The race is running' }),
    ).toBeVisible();
    await expect(
      page.getByText(`It started ${START_FIXTURE_STARTED_LONDON}`),
    ).toBeVisible();
  });

  /**
   * The elapsed clock needs JavaScript and this suite includes a project without it, so the
   * fallback has to be a **true sentence naming the moment** rather than a placeholder. In the
   * scripted projects the clock replaces it, which is why this asserts the moment rather than
   * the wording.
   */
  test('says something true about the start whether or not the clock can tick', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'running'));

    await expect(page.getByText(START_FIXTURE_STARTED_LONDON).first()).toBeVisible();
  });

  test('refuses to clear the start once somebody has been timed', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    const path = startPath(testInfo.project.name, 'running');
    await page.goto(path);

    // No button at all, and a sentence saying why — a refusal with no reason is what gets
    // worked around by somebody in a hurry.
    await expect(page.getByRole('button', { name: 'Clear the start' })).toHaveCount(0);
    await expect(page.getByText(/already been timed in this race/)).toBeVisible();

    // ⚠️ **And the database refuses it too**, which is the half the page cannot be trusted
    // for: the page not offering a control is not the same as the control being refused.
    const posted = await page.request.post(`${path}/update`, {
      form: { intent: 'clear' },
      maxRedirects: 0,
    });
    expect(posted.status()).toBe(303);
    expect(posted.headers()['location']).toContain('outcome=crossings_exist');

    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'The race is running' }),
    ).toBeVisible();
  });

  test('clears a false start when nobody has been timed, and counts down again', async ({
    page,
  }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'clearable'));

    await page.getByRole('button', { name: 'Clear the start' }).click();

    await expect(page.getByText(/The start has been cleared/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start the race' })).toBeVisible();
  });
});

/**
 * ⚠️ **The old application's [#23](https://github.com/bindalshah/src-race-timing/issues/23),
 * and #250 puts fixing it in scope from the first version.** That screen went on showing a
 * start button and a running clock after the race had finished, and an inconsistent screen on
 * a start line is believed.
 */
test.describe('a race that has finished', () => {
  test('says so, and offers neither button', async ({ page }, testInfo) => {
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.goto(startPath(testInfo.project.name, 'finished'));

    await expect(page.getByRole('heading', { name: 'Race finished' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start the race' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear the start' })).toHaveCount(0);

    // Both instants in London time, either side of the change: 01:30 BST and 01:45 GMT, which
    // is fifteen minutes of real time and an hour apart on a naive reading.
    await expect(page.getByText(START_FIXTURE_STARTED_LONDON).first()).toBeVisible();
    await expect(page.getByText(START_FIXTURE_FINISHED_LONDON).first()).toBeVisible();
    await signInAs(page, TIMING_ADMIN_EMAIL);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(registrationPath(testInfo.project.name));

    await expectNoSidewaysScroll(page, 'the timing entry list at 320px');
  });
});
