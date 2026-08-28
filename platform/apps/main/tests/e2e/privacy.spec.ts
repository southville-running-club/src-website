import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The club's site-wide privacy notice, at `/privacy/`.
 *
 * **This file is `nn-privacy.spec.ts`'s opposite number, and it counts its own markers.**
 * That separation is the point rather than a convenience: the entry notice has exactly four
 * open decisions and this one has three, and a single assertion covering both pages would
 * have to be "at least four" — which is the day the guard stops working, in both directions
 * at once. Two counts, two files, and neither is relaxed to accommodate the other.
 *
 * ## What this file is really guarding
 *
 * The same thing in the same two directions. **A value the committee has not decided must
 * render as the marker, and a value it has decided must not.** The first failure publishes
 * an invention; the second publishes a shrug where a fact belongs, and quietly withdraws a
 * claim the club has already made in public.
 *
 * ## Why nothing here imports the content files
 *
 * **A test that reads its expectation from the file the page reads asserts nothing.** Change
 * the registered office to somebody's home address and both sides move together, green. So
 * the settled facts are written out here as literals, exactly as `nn-privacy.spec.ts` and
 * `site.spec.ts` write out theirs — the second copy *is* the check. Editing `race.json` or
 * `privacy.json` is meant to fail this file; that is the reminder to confirm the new value
 * came from the committee rather than from a hurry.
 *
 * **Only the axe test is tagged `@requires-js`**, because axe works by injecting a script.
 * Everything else runs in the `no-javascript` project too — the project that matters most for
 * a legal document somebody opens on a phone before deciding whether to hand over their date
 * of birth.
 */

/** What `orTbc` renders for a `null`. Held here so a reworded marker fails loudly, once. */
const MARKER = 'To be confirmed by the club';

/**
 * How many values on this page are still undecided: the contact for data questions (which is
 * `race.json`'s, and the same open decision on both notices), how long an account is kept,
 * and whether deleting an account also deletes a race entry by the same person. **Filling one
 * in is supposed to fail this file**: the count drops to two, and updating it here is the
 * moment somebody confirms the new value came from the committee.
 */
const OPEN_DECISIONS = 3;

/** The settled facts, as they must appear. Literals, for the reason in the header. */
const SETTLED = {
  controller: 'Southville Running Club Ltd',
  registeredOffice: '1 Hengrove Farm, Hengrove Farm Lane, Bristol BS14 9DD',
  companyNumber: 'ending 7549',
  lastUpdated: '25 August 2026',
} as const;

/** The notice itself. The page's sign-off sits outside it, and is not part of the count. */
const NOTICE = '.privacy';

test.describe("the club's privacy notice", () => {
  test('is navigable by heading, in order', async ({ page }) => {
    // **Eight sections, and the numbers are load-bearing.** The notice refers to "section 1",
    // "section 3" and "section 5" in its own text, so a heading reordered without the
    // cross-references being followed is a page that misdirects somebody looking for the
    // address to write to.
    await page.goto('/privacy/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy notice');

    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();

    expect(headings).toEqual([
      '1. Who we are, and how to complain',
      '2. What this notice covers, and what it does not',
      '3. What your account holds',
      '4. What we are allowed to do with it, and why that is lawful',
      '5. Who else sees it',
      '6. How long we keep it',
      '7. Your rights',
      '8. Changes to this notice',
    ]);
  });

  // -------------------------------------------------------------------------------------
  // The three open decisions, and the settled facts
  // -------------------------------------------------------------------------------------

  test('renders every undecided value as the marker, and never as a blank', async ({
    page,
  }) => {
    // **This is the assertion that stops a placeholder quietly becoming a claim.** Three
    // undecided values, three markers. Filling one in is a one-line edit in `privacy.json`
    // or `race.json` and this count drops to two — which is the test failing *correctly*,
    // and the reminder to update it in the same commit.
    await page.goto('/privacy/');
    const body = (await page.locator(NOTICE).textContent()) ?? '';

    expect(body.split(MARKER).length - 1).toBe(OPEN_DECISIONS);
  });

  test('names the two decisions this notice added, rather than answering them', async ({
    page,
  }) => {
    // The count above would pass if the markers were three copies of the same sentence, so
    // this is what says *which* questions are open. Both are committee decisions and neither
    // has a plausible default that would be safe to print: an account retention period
    // nobody chose is a promise the club would have to keep, and a wrong answer about
    // whether deleting an account deletes a race entry is somebody's entry deleted, or
    // somebody's data kept, without them being told.
    await page.goto('/privacy/');

    // Held by `id` rather than by the words beside them: a term and its answer are two
    // elements, and whether a space survives between them is Astro's whitespace handling
    // rather than anything this page decides.
    await expect(page.locator('#how-long-an-account-is-kept')).toHaveText(MARKER);
    await expect(page.locator('#deleting-an-account-and-a-race-entry')).toHaveText(
      `If you have also entered a race: ${MARKER}`,
    );
  });

  test('leaves no term without an answer beneath it', async ({ page }) => {
    // The other half of the same guard. A value reaching the page as `''` would render an
    // empty definition rather than the marker, the count above would still be three, and the
    // page would read as though there were nothing to say about that row. `orTbc` refuses an
    // empty string for this reason; this is the assertion that it is actually wired up.
    await page.goto('/privacy/');

    const empties = await page.evaluate((selector) => {
      const terms = [...document.querySelectorAll(`${selector} dt`)];
      const values = [...document.querySelectorAll(`${selector} dd`)];
      return {
        terms: terms.length,
        values: values.length,
        blank: [...terms, ...values].filter(
          (element) => (element.textContent ?? '').trim() === '',
        ).length,
      };
    }, NOTICE);

    expect(empties.blank).toBe(0);
    // One answer per term, so no pair has lost its half.
    expect(empties.values).toBe(empties.terms);
    expect(empties.terms).toBeGreaterThan(0);
  });

  test('writes in the facts that are settled, rather than marking them open', async ({
    page,
  }) => {
    // The inverse failure, and the quieter one. These come from `race.json` rather than
    // being retyped, so that the two notices cannot disagree about who the controller is —
    // and the literals here are what prove the lift actually happened.
    await page.goto('/privacy/');
    const body = (await page.locator(NOTICE).textContent()) ?? '';

    expect(body).toContain(SETTLED.controller);
    expect(body).toContain(SETTLED.registeredOffice);
    expect(body).toContain(SETTLED.companyNumber);
    expect(body).toContain(SETTLED.lastUpdated);
  });

  test('keeps the space in front of every value it interpolates', async ({ page }) => {
    // **The trap `/nn/privacy/` met twice while it was being written.** A bare `{expression}`
    // on a line of its own has its surrounding newlines collapsed rather than kept as a
    // space, and *Prettier is what moves the expression onto its own line* — so a space typed
    // in the source does not survive the next format. `{' '}` does. Asserting the whole
    // joined string is the only way this shows up.
    await page.goto('/privacy/');
    const body = (await page.locator(NOTICE).textContent()) ?? '';

    expect(body).toContain(`Contact about your data: ${MARKER}`);
    expect(body).toContain(`Registered office: ${SETTLED.registeredOffice}`);
    expect(body).toContain(`company number ${SETTLED.companyNumber}`);
    expect(body).toContain(`Last updated: ${SETTLED.lastUpdated}`);
  });

  // -------------------------------------------------------------------------------------
  // What it says is collected
  // -------------------------------------------------------------------------------------

  test('lists what the schema holds, not only what the sign-up form asks', async ({
    page,
  }) => {
    // **The whole reason this page is written from `identity`'s columns rather than from the
    // form.** The form asks for three things; the tables also hold the timestamps, the
    // sign-in records, the role grants and the audit trail, and a notice that omits them
    // under-lists what the club processes. This is the guard against the list drifting back
    // to "what somebody types".
    await page.goto('/privacy/');
    const body = (await page.locator(NOTICE).textContent()) ?? '';

    // What you give it.
    expect(body).toMatch(/your email address/i);
    expect(body).toMatch(/your password/i);
    expect(body).toMatch(/gender, date of birth and address/i);

    // What it records without being told — `identity.people`'s timestamps, and Supabase
    // Auth's own columns.
    expect(body).toMatch(/when your account was created/i);
    expect(body).toMatch(/when you confirmed your email address/i);
    expect(body).toMatch(/how you sign in/i);
    expect(body).toMatch(/IP address/i);

    // `identity.role_grants`, `identity.audit` and `identity.reserved_grants` — three tables
    // holding personal data that nobody types into a form at all.
    expect(body).toMatch(/which roles you hold/i);
    expect(body).toMatch(/role given or taken away/i);
    expect(body).toMatch(/set a role aside for/i);
  });

  test('states a lawful basis for every purpose, and says how to complain', async ({
    page,
  }) => {
    await page.goto('/privacy/');
    const body = (await page.locator(NOTICE).textContent()) ?? '';

    // Two bases, and they genuinely differ: the account itself is the club's legitimate
    // interest, and the optional details are consent because they are optional.
    expect(body).toMatch(/legitimate interests/i);
    expect(body).toMatch(/your consent/i);

    // Lifted from the entry notice, which had it first.
    expect(body).toMatch(/Information Commissioner/i);
    await expect(
      page.locator(NOTICE).getByRole('link', { name: 'ico.org.uk' }),
    ).toHaveAttribute('href', 'https://ico.org.uk/');
  });

  test('names only the processors the club actually uses today', async ({ page }) => {
    // **The judgement this page had to make, held as a test.** The issue that asked for this
    // notice listed Resend and Google as processors; naming a company that receives nothing
    // today is a false statement about what the club does, in the over-claiming direction.
    //
    // **It fails the day either one is built**, which is the point — and Resend has now been
    // built twice over, which is why that half has reversed:
    //
    //   * **#50 routed GoTrue's own mail through Resend's SMTP in production**, so every
    //     confirmation, reset and magic link this page describes has gone through them since
    //     26 August 2026. This notice went on saying the account emails were sent by Supabase
    //     for that whole window, which was the *under*-claiming version of the same defect —
    //     and it was this assertion, written to catch the over-claiming one, that hid it.
    //   * **#73 added the entry emails.** `nn-privacy.spec.ts` covers those; they are the
    //     entry notice's business rather than this page's.
    //
    // **Google is still not built** — sign-in with Google is parked at #56 — so that half
    // stays exactly as it was, and is the reason this test keeps both directions in one place.
    await page.goto('/privacy/');
    const body = (await page.locator(NOTICE).textContent()) ?? '';

    expect(body).toMatch(/Supabase/);
    expect(body).toMatch(/Cloudflare/);
    expect(body).toMatch(/Resend/i);
    expect(body).not.toMatch(/\bGoogle\b/);
  });

  test('invents no fee, no date and no retention period nobody confirmed', async ({
    page,
  }) => {
    // Carried over from `nn-privacy.spec.ts`. A price here would mean somebody had hardcoded
    // one rather than read it from the database; a period in days or years would mean
    // somebody had answered the retention question in markup rather than at a committee
    // meeting.
    await page.goto('/privacy/');
    const body = (await page.locator(NOTICE).textContent()) ?? '';

    expect(body).not.toMatch(/£\s?\d/);
    expect(body).not.toMatch(/\b\d+\s+(days?|months?|years?)\b/i);
  });

  // -------------------------------------------------------------------------------------
  // The two notices, and the way between them
  // -------------------------------------------------------------------------------------

  test('links down to the race notice, and the race notice links up', async ({
    page,
    request,
  }) => {
    // **Both directions, because a member who enters the race is covered by both.** The split
    // is deliberate — the race notice carries the medical note, the emergency contact and the
    // retention period `entries-retention.test.ts` ties to the database — and it only works
    // if somebody who lands on either one can find the other.
    await page.goto('/privacy/');

    const down = page.locator(NOTICE).getByRole('link', {
      name: 'the Nightingale Nightmare privacy notice',
    });
    await expect(down.first()).toHaveAttribute('href', '/nn/privacy/');
    expect((await request.get('/nn/privacy/')).status()).toBe(200);

    await page.goto('/nn/privacy/');
    const up = page.getByRole('link', { name: "the club's privacy notice" });
    await expect(up.first()).toHaveAttribute('href', '/privacy/');
  });

  test('is reachable from the footer of every page, not only from the ones with a form', async ({
    page,
  }) => {
    // A notice nobody can find is not a notice. The footer is on every page of both front
    // doors, which is what makes this the club's notice rather than the account area's.
    for (const path of ['/', '/nn/', '/nn/2026/', '/timing']) {
      await page.goto(path);

      const link = page.locator('.site-footer').getByRole('link', {
        name: 'Privacy notice',
      });
      await expect(link, path).toHaveCount(1);
      await expect(link, path).toHaveAttribute('href', '/privacy/');
    }
  });

  // -------------------------------------------------------------------------------------
  // Accessibility, and 320px
  // -------------------------------------------------------------------------------------

  test('has zero axe violations @requires-js', async ({ page }) => {
    await page.goto('/privacy/');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('reads at 320px without the page scrolling sideways', async ({ page }) => {
    // **Twice, deliberately.** The 320px failure this repository has already met was
    // intermittent — an element laying out at its intrinsic width before the stylesheet
    // applied, about one run in four. A single pass is not evidence about layout at this
    // width, and a second reload costs a second.
    //
    // The notice is description lists rather than tables precisely so that this can be a
    // simple assertion: there is no element here that can exceed its container while the
    // page around it still fits. See the privacy block in base.css for that trade.
    for (let pass = 0; pass < 2; pass += 1) {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto('/privacy/');

      const measured = await page.evaluate((selector) => {
        const notice = document.querySelector(selector);
        const widest = Math.max(
          ...[...(notice?.querySelectorAll('dl, ul, p, h2, h3') ?? [])].map(
            (element) => element.scrollWidth,
          ),
        );

        return {
          noticeWidth: notice?.clientWidth ?? 0,
          widest,
          documentOverflows:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      }, NOTICE);

      expect(measured.documentOverflows, `pass ${pass}`).toBe(false);
      expect(measured.widest, `pass ${pass}`).toBeLessThanOrEqual(measured.noticeWidth);
    }
  });
});
