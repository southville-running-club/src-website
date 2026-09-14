import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, NN_RESULTS_EMAIL, REGISTERED_EMAIL } from '../../admin-fixtures';
import {
  ABSENT_PATH,
  EMPTY_EVENT_NAME,
  EMPTY_PATH,
  FINISHED_EVENT_NAME,
  FINISHED_PATH,
  LEAKED_CLUB,
  LEAKED_EMAIL_DOMAIN,
  PUBLISHED_AGES,
  PUBLISHED_EVENT_NAME,
  PUBLISHED_PATH,
  PUBLISHED_TEAMS,
  RESULTS_EVENT_NAME,
  RESULTS_PATH,
  RESULTS_TEAMS,
  WRONG_TIMES,
} from '../../timing-fixtures';

/**
 * `/nn/<year>/results/` **rendered** — a table of times, for somebody the club has allowed to
 * read them.
 *
 * ## What this covers that nothing else did
 *
 * The page shipped with coverage for its refusal only: `tests/worker/nn-results.test.ts` proves
 * the 404 to a signed-out visitor, and `site.spec.ts` runs axe over that same refusal. Both are
 * worth having and neither touches the half that shows anything. The success path was verified
 * by hand on 12 September 2026 and by nothing since, which for this page is a worse gap than
 * usual: **every assertion in the signed-out file would still pass if `handleNnResults` learned
 * to refuse everybody.** A page that 404s at every address is indistinguishable from one that
 * was deleted, and that is the property its own comments are proudest of.
 *
 * ## Why it lives in the admin run
 *
 * It needs **accounts**, and `tests/worker/admin/global-setup.ts` is the only setup that creates
 * any — `tester.test.ts`'s reason exactly, and like that file this is not a test of `/admin/`.
 * The run's setup also writes the `timing` rows, because they need `pg` and are global state.
 *
 * ## Why the refusals are re-asserted here rather than left to the signed-out file
 *
 * ⚠️ **A 404 proves the permission held only when there is something behind it to withhold.**
 * Signed out, against a database with no `timing` rows at all, the refusal is equally the answer
 * of a correct gate, a broken function and an empty table. Here a real field sits at
 * `/nn/2099/results/` — three runners, two times, a category apiece — and a plain member is
 * still refused, which is the only arrangement in which that 404 says anything. The same
 * argument applies the other way round: a holder of `nn.results.read` asking for a year with no
 * event gets the identical refusal, so the two causes stay indistinguishable.
 */

const SITE = 'https://example.com';

const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/**
 * Every cookie a response sets, as `name=value`, with the cleared ones dropped.
 *
 * **The same shape as `admin.test.ts`'s and `tester.test.ts`'s, including the `typeof` rather
 * than an `in` check** — narrowing with `'getSetCookie' in response.headers` makes the fallback
 * branch `never` under the Workers types. A sign-in sets three cookies and a single
 * `headers.get` returns whichever the runtime happens to join or pick, so a session built from
 * one of them would be refused: on sight if `src_ax` was the part dropped, or at the first
 * refresh if `src_rt` was.
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

  // A 422 here is the sign-in page re-served with a message on it, which means the fixture
  // person was not created, was not confirmed, or the captcha secret is not the dummy one.
  expect(response.status, `signing in as ${email} was refused`).toBe(303);

  return setCookiePairs(response)
    .filter((pair) => pair.startsWith('src_'))
    .join('; ');
}

async function get(path: string, cookie: string | null = null): Promise<Response> {
  return SELF.fetch(`${SITE}${path}`, {
    headers: cookie === null ? {} : { cookie },
    redirect: 'manual',
  });
}

/**
 * A page's markup with runs of whitespace collapsed.
 *
 * **Prettier reformats the contents of a template tagged `html`** — built in and not
 * configurable — so a cell written across two lines in `worker/nn-results.ts` arrives with a
 * newline in the middle of it, and `toContain('Senior Women')` then fails on markup that is
 * perfectly correct. It cost the first run of `admin.test.ts`, and the status cell here is
 * written exactly that way.
 */
function squash(markup: string): string {
  return markup.replace(/\s+/g, ' ');
}

/**
 * The rendered table's rows, as the text of their cells.
 *
 * **Parsed rather than string-matched, because the order of the rows is an assertion.**
 * `sortResults(…, 'total')` is what puts team 12 above team 7, and `toContain` on the whole
 * document cannot tell that from the reverse. Tags are stripped per cell so that the
 * `results-suspect` span inside the status cell arrives as part of the status text, which is
 * how a reader meets it.
 */
function tableRows(markup: string): string[][] {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(markup)?.[1] ?? '';

  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      decodeEntities(squash(cell[1]!.replace(/<[^>]*>/g, ' ')).trim()),
    ),
  );
}

/**
 * ⚠️ **`worker/html.ts` escapes the apostrophe, and the club's own category labels have one.**
 * `Women's Vet 60` reaches the markup as `Women&#39;s Vet 60`, so an expectation copied from
 * `awards.ts`'s wording fails on a page that is perfectly correct — the same shape of trap as
 * Prettier reflowing a tagged template, one escape along. Cells are decoded here so that every
 * assertion in this file compares the text a reader sees.
 *
 * **Only the five `escapeHtml` writes**, and only inside a cell whose tags have already been
 * stripped: decoding `&lt;` across whole markup would manufacture tags that were never there.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const POS = 0;
const BIB = 1;
const RUNNER = 2;
const CATEGORY = 3;
const TIME = 4;
const STATUS = 5;

let reader = '';
let member = '';

beforeAll(async () => {
  // Sequential rather than concurrent, so a failure says which sign-in it was.
  reader = await signIn(NN_RESULTS_EMAIL);
  member = await signIn(REGISTERED_EMAIL);
});

describe("one running's results, to somebody who may read them", () => {
  let markup = '';
  let rows: string[][] = [];

  beforeAll(async () => {
    const response = await get(RESULTS_PATH, reader);
    expect(response.status, RESULTS_PATH).toBe(200);
    markup = squash(await response.text());
    rows = tableRows(markup);
  });

  it('names the running, and says the results are not published', async () => {
    expect(markup).toContain(RESULTS_EVENT_NAME);
    // The page is visible to a handful of people and its times are provisional. Somebody
    // reading it must not come away thinking either is settled.
    expect(markup).toContain('These results are not published');
    expect(markup).toContain('provisional until the race director confirms them');
  });

  it('renders one row per team, and counts them in the caption', async () => {
    expect(rows).toHaveLength(RESULTS_TEAMS.length);
    expect(markup).toContain(`${RESULTS_TEAMS.length} entries`);
  });

  /**
   * ⚠️ **The row order is the assertion, not the row contents.** Team 12 finished ahead of team
   * 7, which is the opposite of team-number order — so this passes only if the page sorted by
   * total time. Every fixture is derived from `timing-fixtures.ts` rather than written out
   * here, for the reason this repository has already paid for twice: a literal expectation
   * stops testing silently the moment the value it was copied from moves.
   */
  it('puts every runner in finishing order, with the time it derived for them', async () => {
    const expected = [...RESULTS_TEAMS].sort((a, b) => {
      if (a.expectedPosition === null) return 1;
      if (b.expectedPosition === null) return -1;
      return a.expectedPosition - b.expectedPosition;
    });

    expected.forEach((team, index) => {
      const row = rows[index];
      const where = `row ${index + 1} (team ${team.teamNumber})`;

      expect(row, where).toBeDefined();
      expect(row![RUNNER], `${where}: runner`).toBe(`${team.firstName} ${team.lastName}`);
      expect(row![BIB], `${where}: bib`).toBe(team.expectedBib);
      expect(row![CATEGORY], `${where}: category`).toBe(team.expectedCategory);
      expect(row![TIME], `${where}: time`).toBe(team.expectedTime);
      expect(row![STATUS], `${where}: status`).toContain(team.expectedStatus);
      expect(row![POS], `${where}: position`).toBe(
        team.expectedPosition === null ? '—' : String(team.expectedPosition),
      );
    });
  });

  /**
   * ⚠️ **The rule with no symptom until the one year the start slips.** Splits are measured
   * against `coalesce(actually_started_at, start_at)`, and this fixture's start ran two minutes
   * late. A page reading the scheduled start would render times two minutes longer — plausible,
   * uniform and wrong, and nothing about the output would look off. So the wrong answers are
   * asserted absent as well as the right ones asserted present.
   */
  it('measures from the start that happened, not the one that was scheduled', async () => {
    for (const wrong of WRONG_TIMES) {
      expect(
        markup,
        `${wrong} is the time measured from the scheduled start`,
      ).not.toContain(wrong);
    }
  });

  /** The desk wrote a physical bib over one team's derived number, and that is what shows. */
  it('shows the bib the desk wrote, where it wrote one', async () => {
    const overridden = RESULTS_TEAMS.find((team) => team.bibLeg1 !== null);
    expect(overridden, 'no fixture carries a bib override').toBeDefined();

    const row = rows.find((cells) => cells[RUNNER]?.includes(overridden!.lastName));
    expect(row?.[BIB]).toBe(overridden!.bibLeg1);
    // And the number it would have derived is not what was printed instead.
    expect(row?.[BIB]).not.toBe(overridden!.teamNumber);
  });

  /**
   * A flagged crossing is marked, not hidden and not shown as a confident time. A spectator
   * whose runner vanished from the board is worse off than one told the row is being checked.
   */
  it('marks a row whose crossing nobody has resolved yet', async () => {
    const suspect = RESULTS_TEAMS.find((team) => team.openAnomaly);
    const row = rows.find((cells) => cells[RUNNER]?.includes(suspect!.lastName));

    expect(row?.[STATUS]).toContain('being checked');
    // It keeps its time and its place: the row is uncertain, not withdrawn.
    expect(row?.[TIME]).toBe(suspect!.expectedTime);
    expect(markup).toContain('results-suspect');

    // And the rows nobody flagged are not wearing it.
    const clean = rows.filter((cells) => !cells[RUNNER]?.includes(suspect!.lastName));
    for (const cells of clean) {
      expect(cells[STATUS], `${cells[RUNNER]} was marked suspect`).not.toContain(
        'being checked',
      );
    }
  });

  /**
   * ⚠️ **The minimisation assertion, at the layer a person actually reads.**
   * `packages/db/tests/timing.test.ts` proves the payload carries no address and no club;
   * this proves the page does not print one either, which is a separate failure — the runner
   * rows are joined back on by id here, and a template could read a column the payload had
   * simply stopped carrying.
   *
   * Matching these against the whole document is safe where a bare number would not be: an
   * email domain and a club name cannot be produced by SVG path data, which is the trap a
   * `not.toContain('2000')` walks into on any page carrying the club wordmark.
   */
  it('prints no runner’s email address and no runner’s club', async () => {
    expect(markup).not.toContain(LEAKED_EMAIL_DOMAIN);
    expect(markup).not.toContain(LEAKED_CLUB);
  });

  /**
   * Rendered per viewer behind a permission. A shared cache holding it would hand one
   * volunteer's page to the next person, and a crawler indexing the address would publish the
   * fact that it exists — which is the thing the 404 is protecting.
   *
   * **Asserted on the 200 rather than only on the refusal**, where the signed-out file already
   * has it: the page carrying real times is the one where getting this wrong costs something.
   */
  it('is not cached and not indexed, now that it has something on it', async () => {
    const response = await get(RESULTS_PATH, reader);

    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(squash(await response.text())).toContain('name="robots" content="noindex');
  });
});

describe('the category, which is derived and is never a column', () => {
  /**
   * ⚠️ **The defect this replaces would have rendered a dash for every runner the club
   * entered.** The page read `timing.teams.category`, and `import_from_entries()` writes
   * nothing to that column — its own header says there is nothing on a team row the import is
   * authoritative about. The fixture leaves it populated with a *differently worded* string on
   * purpose, so that a page which went back to reading it fails here rather than passing on a
   * category that happens to look right.
   */
  it('prints the derived band and not the string stored on the team', async () => {
    const cells = tableRows(squash(await (await get(RESULTS_PATH, reader)).text()))
      .flat()
      .join(' | ');

    for (const team of RESULTS_TEAMS) {
      expect(cells, `${team.lastName}: derived category`).toContain(
        team.expectedCategory,
      );
      expect(cells, `${team.lastName}: stored category`).not.toContain(team.category);
    }
  });
});

/**
 * ⚠️ **The page a stranger reads, which until #242 nothing on this site had.** Every assertion
 * above is about a preview behind a permission; these are about the published table, and the
 * one that matters most is the first: a race that has been **finished and not published** is
 * still a 404 to the internet, because finishing is not publishing — ADR-042.
 */
describe('a running that is finished and not published', () => {
  it('is still the ordinary 404 to a signed-out visitor', async () => {
    const response = await get(FINISHED_PATH);

    expect(response.status).toBe(404);

    const body = squash(await response.text());
    expect(body).toContain('There is nothing at this address.');
    expect(body).not.toContain(FINISHED_EVENT_NAME);
    // A refusal is never publicly cached, whatever state the race is in.
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('tells a holder which of the two unpublished states it is in', async () => {
    const response = await get(FINISHED_PATH, reader);
    expect(response.status).toBe(200);

    const markup = squash(await response.text());
    expect(markup).toContain(FINISHED_EVENT_NAME);
    expect(markup).toContain('These results are not published');
    // The clause `finish_event()` changes, and the only thing it changes here: the warning
    // about provisional times is true either side of it and is on both variants.
    expect(markup).toContain('The race has been called finished');
    expect(markup).toContain('provisional until the race director confirms them');
  });
});

describe('a running whose results the club has published', () => {
  let markup = '';
  let rows: string[][] = [];

  beforeAll(async () => {
    // **Signed out, deliberately.** The whole of #242 is that this page answers somebody who
    // has nothing, and a fixture holding a permission would prove the preview again.
    const response = await get(PUBLISHED_PATH);
    expect(response.status, PUBLISHED_PATH).toBe(200);
    markup = squash(await response.text());
    rows = tableRows(markup);
  });

  it('renders the table to somebody who is signed in to nothing', async () => {
    expect(markup).toContain(PUBLISHED_EVENT_NAME);
    expect(rows).toHaveLength(PUBLISHED_TEAMS.length);
  });

  /**
   * **No banner at all**, because the sentence is a claim about a record and the record now
   * says the opposite. A published page telling its readers the results are not published
   * would be stating something false about a decision the club had just taken.
   */
  it('makes no claim that the results are unpublished', async () => {
    expect(markup).not.toContain('These results are not published');
    expect(markup).not.toContain('provisional');
  });

  /**
   * ⚠️ **The three categories the column can be wrong in, and the middle one is ADR-031's.**
   * Rhodri is `non_binary` and asked to be placed with the men: a page reading `gender` alone
   * renders no category for them whatever they answered, which is a silent wrong answer rather
   * than a failure. Ozzy has no gender recorded and is in no category, which the column says
   * rather than guesses.
   */
  it('places every runner through effectiveCategory, and nobody by gender alone', async () => {
    for (const team of PUBLISHED_TEAMS) {
      const row = rows.find((cells) => cells[RUNNER]?.includes(team.lastName));
      expect(row, `${team.lastName} is not on the page`).toBeDefined();
      expect(row?.[CATEGORY], `${team.lastName}: category`).toBe(team.expectedCategory);
      expect(row?.[TIME], `${team.lastName}: time`).toBe(team.expectedTime);
    }
  });

  /**
   * ⚠️ **The disclosure #241 opened and ADR-043 closed, at the layer somebody reads.**
   * `results_for_event()` withholds `age_on_day` from every caller once a race is published, so
   * there is no age here to print and no band to derive from one — a published result carries a
   * name, a category and a time.
   *
   * **Checked against the table's own cells rather than the whole document**, and the restraint
   * is the point: these are bare numbers, and a `not.toContain('62')` over rendered markup is
   * the assertion this repository has already paid for — SVG path data is thousands of
   * arbitrary digits and such a check fails towards passing.
   */
  it('prints no exact age, and therefore no age band', async () => {
    const cells = rows.flat().join(' | ');

    for (const age of PUBLISHED_AGES) {
      expect(cells, `the exact age ${age} reached a cell`).not.toContain(age);
    }

    for (const team of PUBLISHED_TEAMS) {
      if (team.previewCategory === team.expectedCategory) continue;
      expect(cells, `${team.lastName}: the band is the preview's`).not.toContain(
        team.previewCategory,
      );
    }
  });

  /** The same minimisation the preview has, now protecting a page the internet can read. */
  it('prints no runner’s email address and no runner’s club', () => {
    expect(markup).not.toContain(LEAKED_EMAIL_DOMAIN);
    expect(markup).not.toContain(LEAKED_CLUB);
  });

  /**
   * ⚠️ **The envelope, which is the half of #242 that is not visible on the page.** C2 asks for
   * a permanent public address, and one that may not be cached or indexed is a strange thing to
   * publish — so a published race drops `no-store` and `noindex` on that branch and on no
   * other. Sixty seconds is chosen against ADR-042's *unpublish, fix, publish*: a cache already
   * holding the table serves it until it expires.
   */
  it('is cacheable and indexable, which no other answer from this page is', async () => {
    const response = await get(PUBLISHED_PATH);

    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(squash(await response.text())).not.toContain('name="robots"');
  });

  /**
   * ⚠️ **A response that sets a cookie may not be stored by a shared cache**, whatever the
   * race's state: `readSession()` rotates a refresh token when the access token is close to
   * expiry, and a shared cache holding that would hand one person's refreshed session to the
   * next. Asserted with a signed-in reader, whose page is otherwise the same bytes — which is
   * itself the property that makes the public branch safe.
   */
  it('serves a permission holder the same table, and does not cache a refreshed session', async () => {
    const response = await get(PUBLISHED_PATH, reader);
    expect(response.status).toBe(200);

    const holder = tableRows(squash(await response.text()));
    expect(holder).toEqual(rows);

    const control = response.headers.get('cache-control') ?? '';
    const cookies = setCookiePairs(response);
    expect(
      cookies.length === 0 || control.includes('no-store'),
      `a response setting ${String(cookies.length)} cookie(s) was cached as ${control}`,
    ).toBe(true);
  });
});

/**
 * **The link, and it is a claim about a record.** `/nn/` and `/nn/<year>/` offer the results
 * only once somebody has published them — a link to a 404 on the club's own front door says a
 * race's results exist and then answers "there is nothing at this address".
 *
 * ⚠️ **`nn-2026` is published in this run only**, by `seedPublishedCurrentRunning()` — which
 * since #288 publishes the row `20260914160000` put in the table rather than inserting one of
 * its own. The unpainted half is asserted in `tests/worker/nn-panel.test.ts`, which runs
 * against that same row left unpublished — the state every other run and every deployed
 * environment is in today.
 */
describe('the link to the results, on the two pages that may carry one', () => {
  const anchor = /<a[^>]*data-nn-results-link[^>]*>([^<]*)<\/a>/;

  for (const path of ['/nn/', '/nn/2026/']) {
    it(`points at this running's results from ${path}, and names no year`, async () => {
      const markup = squash(await (await get(path)).text());
      const match = anchor.exec(markup);

      expect(match, `${path} carries no results anchor at all`).not.toBeNull();
      expect(match![0], `${path}: still hidden`).not.toContain('hidden');
      expect(match![0], `${path}: href`).toContain('href="/nn/2026/results/"');

      // ⚠️ **The label, not the address.** `/nn/` never names a year and nothing in its markup
      // may — but a year in an `href` is not text, which is the distinction `site.spec.ts`'s
      // nine-width sweep rests on. The label has to stay free of one either way, because the
      // same anchor is painted on both pages from one string.
      expect(match![1]?.trim(), `${path}: label`).toBe('Results');
    });
  }
});

describe('a running with nothing captured against it', () => {
  /**
   * The state every race is in until the first runner crosses, and the one the page is most
   * likely to be opened in. **It says so rather than rendering an empty table**, which reads as
   * a page that is broken rather than a race that has not started.
   */
  it('says nothing has been captured, rather than showing an empty table', async () => {
    const response = await get(EMPTY_PATH, reader);
    expect(response.status).toBe(200);

    const markup = squash(await response.text());
    expect(markup).toContain(EMPTY_EVENT_NAME);
    expect(markup).toContain('Nothing has been captured for this race yet');
    expect(markup).not.toContain('results-table');
    // And it is still the page saying so, with its own notice on it.
    expect(markup).toContain('These results are not published');
  });
});

describe('the refusals, with a real field sitting behind them', () => {
  /**
   * ⚠️ **This is the assertion the signed-out file cannot make.** There is a rendered results
   * page at this address for the person above, and a confirmed account holding no role gets the
   * same 404 as the internet — which is what says `nn.results.read` is being asked about rather
   * than that the page is broken for everybody.
   */
  it('refuses a signed-in member the page it just served somebody else', async () => {
    const response = await get(RESULTS_PATH, member);

    expect(response.status).toBe(404);

    const body = squash(await response.text());
    expect(body).toContain('There is nothing at this address.');
    // Nothing about the race leaked into the refusal — not a name, not a time, not a runner.
    expect(body).not.toContain('results-table');
    expect(body).not.toContain(RESULTS_EVENT_NAME);
    for (const team of RESULTS_TEAMS) {
      expect(body, `${team.lastName} appeared in the refusal`).not.toContain(
        team.lastName,
      );
    }
  });

  /**
   * ⚠️ **The two causes of a refusal must stay indistinguishable.** `results_for_event()`
   * answers the same `null` for "you may not" and "no such event", and the page cannot tell
   * them apart on purpose: a different answer here would confirm to somebody probing the site
   * which years are real.
   */
  it('refuses a year it has no event for, and tells a holder no more than anybody else', async () => {
    const toHolder = await get(ABSENT_PATH, reader);
    const toMember = await get(ABSENT_PATH, member);

    expect(toHolder.status).toBe(404);
    expect(toMember.status).toBe(404);

    // **Compared at one address, which is the only comparison that means anything.** Two
    // different paths produce two different documents whatever the refusal says, because the
    // navigation is rendered against the path. Same address, one caller who holds
    // `nn.results.read` and one who does not, and the bodies must be the same bytes — so
    // holding the permission discloses nothing about which years are real.
    const holder = squash(await toHolder.text());
    expect(holder).toBe(squash(await toMember.text()));
    expect(holder).toContain('There is nothing at this address.');
    expect(holder).not.toContain('results-table');
  });

  it('still refuses a signed-out visitor, with the field in place', async () => {
    // The signed-out file asserts this against an empty database. Here there is something to
    // withhold, which is the only state in which the refusal means anything.
    const response = await get(RESULTS_PATH);

    expect(response.status).toBe(404);
    expect(squash(await response.text())).not.toContain(RESULTS_EVENT_NAME);
  });
});
