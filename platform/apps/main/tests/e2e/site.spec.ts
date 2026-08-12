import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The whole site, in a real browser, on one origin — exactly as the public will meet it.
 *
 * `/timing` is served by a different Worker. Locally `apps/main` forwards it; in
 * production Cloudflare's route does. Either way it is the same origin to the browser,
 * which is the property this arrangement exists to give.
 */

test.describe('the club website', () => {
  test('says a new site is coming, without promising when', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'A new Southville Running Club website',
    );

    // When the new site replaces the old one is a committee decision, and a date invented
    // here would be a factual claim nobody authorised.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/,
    );
  });

  test('links to both things that already exist', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('link', { name: /Nightingale Nightmare/ }),
    ).toHaveAttribute('href', '/nn/');
    await expect(page.getByRole('link', { name: /Race timing/ })).toHaveAttribute(
      'href',
      '/timing',
    );
  });
});

test.describe('Nightingale Nightmare, at /nn', () => {
  test('renders and shows a database timestamp fetched by the Worker', async ({
    page,
  }) => {
    await page.goto('/nn/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Nightingale Nightmare',
    );

    const health = page.locator('[data-health]');
    await expect(health).toHaveAttribute('data-health', 'ok');
    await expect(health).toHaveText(/\d{1,2} \w+ \d{4} at \d{2}:\d{2} (GMT|BST)/);
  });

  test('renders a second, independent database round trip', async ({ page }) => {
    // intake.ping() — added after health() to prove a later migration reaches this page
    // the same way the first one already did.
    await page.goto('/nn/');

    const ping = page.locator('[data-pipeline-check]');
    await expect(ping).toHaveAttribute('data-pipeline-check', 'ok');
    await expect(ping).toHaveText('pipeline-ok');
  });

  test('states the confirmed race facts', async ({ page }) => {
    // **This test used to assert the opposite**, and the change is the point of it. Until
    // the date was confirmed the page stated no race facts at all, and the test guarded
    // that. The date, the start time, the distance and the HQ are now supplied, so the
    // assertion moves to what it was always really about: the page says what is known.
    await page.goto('/nn/');
    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).toContain('Sunday 1 November 2026');
    expect(body).toContain('11:00');
    expect(body).toContain('10 km, off-road');
    expect(body).toContain('BS3 2JL');
  });

  test('invents none of the facts that are still open', async ({ page }) => {
    // The other half, and the half that still matters most. **The entry fee and the
    // opening date belong to the entries application**, which is a separate piece of work
    // — this site does not quote a figure it does not own, and the mockup's "from £15" and
    // "7am, Tue 1 September" are exactly the plausible-looking values that would get here
    // by being copied rather than by being confirmed.
    await page.goto('/nn/');
    const body = (await page.locator('body').textContent()) ?? '';

    expect(body).not.toMatch(/£\s?\d/);

    // **The 2026 ARC permit has not been issued.** A number here would be last year's, and
    // it would read as a claim that this year's race is permitted.
    const permit = page.getByRole('term').filter({ hasText: 'ARC permit' });
    await expect(permit).toHaveCount(1);
    await expect(
      page.locator('dt', { hasText: 'ARC permit' }).locator('+ dd'),
    ).toHaveText('To be confirmed');

    // Live capacity is the entries application's business too. 250 is how big the race is;
    // "238 of 250 remaining" is demo data from the mockup and must not follow it here.
    expect(body).toContain('250 places');
    expect(body).not.toMatch(/\bof 250\b|places remaining/i);
  });
});

test.describe('the Nightingale Nightmare content pages', () => {
  const NN_PAGES = [
    ['/nn/', 'Race', 'Nightingale Nightmare'],
    ['/nn/course/', 'Course', 'Course and terrain'],
    ['/nn/race-day/', 'Race day', 'Race day'],
    ['/nn/spectators/', 'Spectators', 'Watching the race'],
  ] as const;

  for (const [path, navLabel, heading] of NN_PAGES) {
    test(`${path} renders, and its nav marks it as the current page`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);

      const nav = page.getByRole('navigation', { name: 'Nightingale Nightmare' });
      await expect(nav).toBeVisible();

      // **Exactly one link is current, and it is this page's.** Two would be a copied
      // component that was never re-pointed; none would be a path that stopped matching
      // after a rename, and neither shows up as anything a person would notice.
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

      // `exact` matters here: an accessible name is matched as a substring by default, so
      // "Race" also selects "Race day" and the assertion fails on a strict-mode violation
      // rather than on anything being wrong with the page.
      await expect(
        nav.getByRole('link', { name: navLabel, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    });
  }

  test('every nav link resolves, from every page', async ({ page, request }) => {
    // A nav is the one component where a broken link is invisible from the page it is on.
    for (const [from] of NN_PAGES) {
      await page.goto(from);

      const hrefs = await page
        .getByRole('navigation', { name: 'Nightingale Nightmare' })
        .getByRole('link')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));

      expect(hrefs).toEqual(['/nn/', '/nn/course/', '/nn/race-day/', '/nn/spectators/']);

      for (const href of hrefs) {
        expect((await request.get(href)).status()).toBe(200);
      }
    }
  });

  test('the hero fog stops for anyone who asked for no motion @requires-js', async ({
    page,
  }) => {
    // **The fog stops rather than disappears**, which is the distinction worth asserting:
    // `animation: none` leaves the same wash at the same opacity, so a reader with the
    // preference set gets the same page rather than a different-looking one.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/nn/');

    const fog = await page.locator('.nn-hero').evaluate((el) => {
      const style = getComputedStyle(el, '::before');
      return { animationName: style.animationName, opacity: style.opacity };
    });

    expect(fog.animationName).toBe('none');
    expect(fog.opacity).toBe('0.3');
  });

  test('the content pages state the facts they were given, and no others', async ({
    page,
  }) => {
    await page.goto('/nn/race-day/');
    const raceDay = (await page.locator('body').textContent()) ?? '';

    // The schedule, which is the reason this page exists.
    for (const time of ['09:15', '10:15', '10:30', '10:45', '11:00']) {
      expect(raceDay).toContain(time);
    }
    expect(raceDay).toContain('BS3 2JL');

    await page.goto('/nn/spectators/');
    const spectators = (await page.locator('body').textContent()) ?? '';
    expect(spectators).toContain('BS8 3PL');
    expect(spectators).toContain('Brunel Lock Road');

    await page.goto('/nn/course/');
    const course = (await page.locator('body').textContent()) ?? '';
    expect(course).toContain('No headphones of any type');
    expect(course).toContain('Trail shoes are recommended');

    // **The 2023 lines that are false for 2026, on every one of the three.** The clocks go
    // back on 25 October and this race is 1 November, a week later; the transfer deadline
    // and the entry-opening time are the entries application's and are unconfirmed anyway.
    for (const text of [raceDay, spectators, course]) {
      expect(text).not.toMatch(/clocks change/i);
      expect(text).not.toMatch(/£\s?\d/);
      expect(text).not.toMatch(/transfer/i);
      expect(text).not.toMatch(/sells out/i);
    }
  });
});

test.describe('race timing, at /timing', () => {
  test('is reachable on the same origin as the website', async ({ page, baseURL }) => {
    // The assertion the whole path-based arrangement exists for: a second Worker,
    // answering on one hostname, with no cross-origin hop and no redirect away.
    await page.goto('/');
    const websiteOrigin = new URL(page.url()).origin;

    await page.getByRole('link', { name: /Race timing/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Race timing');
    expect(new URL(page.url()).origin).toBe(websiteOrigin);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test('is styled, so basePath is doing its job', async ({ page }) => {
    // Without `basePath: '/timing'` the app serves but its assets 404, and it arrives
    // unstyled and half-broken — the failure that looks like a CSS bug and is not.
    await page.goto('/timing');

    const background = await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('shows a database timestamp from the same project', async ({ page }) => {
    await page.goto('/timing');

    await expect(page.locator('[data-health]')).toHaveAttribute('data-health', 'ok');
  });

  test('renders the same second database round trip as the website', async ({ page }) => {
    // The same intake.ping() call, reached by a different application — proving the
    // pipeline reaches both front doors, not just the one it was first proven on.
    await page.goto('/timing');

    const ping = page.locator('[data-pipeline-check]');
    await expect(ping).toHaveAttribute('data-pipeline-check', 'ok');
    await expect(ping).toHaveText('pipeline-ok');
  });
});

test.describe('accessibility', () => {
  for (const [name, path] of [
    ['the website', '/'],
    ['Nightingale Nightmare', '/nn/'],
    ['the course page', '/nn/course/'],
    ['the race-day page', '/nn/race-day/'],
    ['the spectators page', '/nn/spectators/'],
    ['the privacy notice', '/nn/privacy/'],
    ['race timing', '/timing'],
  ] as const) {
    test(`${name} has zero axe violations @requires-js`, async ({ page }) => {
      // Zero, not "few". Any threshold above zero becomes the new normal within a month,
      // and 70% of visitors are on a phone.
      await page.goto(path);

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      expect(violations).toEqual([]);
    });

    test(`${name} is operable at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(path);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  }
});

test.describe('what does not exist', () => {
  test('404s a page that has not been built', async ({ page }) => {
    const response = await page.goto('/membership/');

    expect(response?.status()).toBe(404);
  });
});
