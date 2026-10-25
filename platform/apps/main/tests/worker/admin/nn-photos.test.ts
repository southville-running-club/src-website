import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  PHOTO_CREDIT,
  REPLACED_TOKEN,
  RUNNER_ADDRESS,
  RUNNER_BIB,
  RUNNER_CONTACT,
  RUNNER_EVENT_NAME,
  RUNNER_FINISH_TIME,
  RUNNER_PHOTOS,
  RUNNER_TOKEN,
  RUNNER_YEAR,
  UNPUBLISHED_TOKEN,
  UNPUBLISHED_YEAR,
  lostLinkPath,
  runnerImagePath,
  runnerObjectKey,
  runnerPagePath,
} from '../../photos-runner-fixtures';

/**
 * A runner's race photos, in the real Workers runtime (brief slice 4, ADR-068).
 *
 * The database tests (`packages/db/tests/photos-runner.test.ts`) prove what a link may read.
 * This file proves the Worker's half, which is the brief's own list for this slice: the three
 * headers on every private page, an invalid link never a 500, the image route answering 404
 * before publishing and once a photo is down, 200 and 304 in between, and a download named by
 * the photo's ID.
 *
 * **The bucket is Miniflare's in-memory R2**, and each test puts the bytes it reads. The rows
 * are `photos-runner-db.ts`'s, seeded by this run's global setup: `nn-2093`, published, and
 * `nn-2094`, not.
 *
 * Signed out throughout, because a runner is: nothing here sends a cookie.
 */

const SITE = 'https://example.com';
const bucket = (env as unknown as { PHOTOS: R2Bucket }).PHOTOS;
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
]);

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${SITE}${path}`, { headers, redirect: 'manual' });
}

async function markup(response: Response): Promise<string> {
  return (await response.text()).replace(/\s+/g, ' ');
}

/** The brief's three, on every private page whatever it says (§10). */
function expectPrivateHeaders(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
}

describe("a runner's private page", () => {
  it('shows their bib, their time, their photos and the ones that could be them', async () => {
    const response = await get(runnerPagePath());
    const page = await markup(response);

    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(page).toContain(RUNNER_EVENT_NAME);
    expect(page).toContain(`<dd class="nn-mono">${RUNNER_BIB}</dd>`);
    expect(page).toContain(`<dd class="nn-mono">${RUNNER_FINISH_TIME}</dd>`);
    expect(page).toContain(`src="${runnerImagePath(RUNNER_PHOTOS.mine.id, 'thumb')}"`);
    expect(page).toContain(RUNNER_PHOTOS.couldBe.shortId);
    expect(page).toContain(
      `We could only read part of the number on these, and what we read fits bib ${RUNNER_BIB}.`,
    );
    expect(page).toContain(`href="mailto:${RUNNER_CONTACT}?subject=`);
  });

  it('shows nobody else’s photo, and nothing taken down', async () => {
    const page = await markup(await get(runnerPagePath()));

    expect(page).not.toContain(RUNNER_PHOTOS.someoneElse.shortId);
    expect(page).not.toContain(RUNNER_PHOTOS.hidden.shortId);
  });

  it('answers the unslashed address with the slashed one', async () => {
    const response = await get(runnerPagePath().replace(/\/$/, ''));

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(runnerPagePath());
  });

  it('answers a replaced, mangled or unknown link, or unpublished photos, kindly and never with a 500', async () => {
    for (const path of [
      runnerPagePath(REPLACED_TOKEN),
      runnerPagePath('not-a-token'),
      runnerPagePath('Q'.repeat(43)),
      runnerPagePath(UNPUBLISHED_TOKEN, UNPUBLISHED_YEAR),
      runnerPagePath(RUNNER_TOKEN, UNPUBLISHED_YEAR),
    ]) {
      const response = await get(path);

      expect(response.status, path).toBe(404);
      expectPrivateHeaders(response);
      expect(await markup(response), path).toContain('This link is not working');
    }
  });

  it('offers the way to a new link on the page that says this one is not working', async () => {
    const page = await markup(await get(runnerPagePath(REPLACED_TOKEN)));

    expect(page).toContain(`<a href="${lostLinkPath()}">Get a new link</a>`);
  });
});

describe('one photo', () => {
  it('shows a runner’s own photo large, with its credit, a download and a takedown request', async () => {
    const response = await get(`${runnerPagePath()}${RUNNER_PHOTOS.mine.shortId}/`);
    const page = await markup(response);

    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(page).toContain(`src="${runnerImagePath(RUNNER_PHOTOS.mine.id, 'medium')}"`);
    expect(page).toContain(PHOTO_CREDIT.replace("'", '&#39;'));
    expect(page).toContain(
      `href="${runnerImagePath(RUNNER_PHOTOS.mine.id, 'full')}?download=1"`,
    );
    expect(page).toContain(
      `mailto:${RUNNER_CONTACT}?subject=${encodeURIComponent(`Please take down photo ${RUNNER_PHOTOS.mine.shortId}`)}`,
    );
    // Their own photo needs no "That's me" (the apostrophe is escaped in the markup).
    expect(page).not.toContain('That&#39;s me');
  });

  it('offers "That’s me" on a photo that could be them', async () => {
    const page = await markup(
      await get(`${runnerPagePath()}${RUNNER_PHOTOS.couldBe.shortId}/`),
    );

    expect(page).toContain('That&#39;s me');
  });

  it('will not open a photo that link’s page does not show', async () => {
    for (const shortId of [
      RUNNER_PHOTOS.someoneElse.shortId,
      RUNNER_PHOTOS.hidden.shortId,
      'not an id',
    ]) {
      const response = await get(`${runnerPagePath()}${encodeURIComponent(shortId)}/`);
      expect(response.status, shortId).toBe(404);
    }
  });
});

describe('the image route', () => {
  it('serves a published photo, cached an hour in the viewer’s browser, with an ETag', async () => {
    await bucket.put(runnerObjectKey(RUNNER_PHOTOS.mine.id, 'thumb'), JPEG);

    const response = await get(runnerImagePath(RUNNER_PHOTOS.mine.id, 'thumb'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
  });

  it('answers 304 when the browser already has it', async () => {
    await bucket.put(runnerObjectKey(RUNNER_PHOTOS.mine.id, 'medium'), JPEG);
    const first = await get(runnerImagePath(RUNNER_PHOTOS.mine.id, 'medium'));
    const etag = first.headers.get('etag')!;
    await first.arrayBuffer();

    const again = await get(runnerImagePath(RUNNER_PHOTOS.mine.id, 'medium'), {
      'if-none-match': etag,
    });

    expect(again.status).toBe(304);
  });

  it('names a download by the photo’s ID', async () => {
    await bucket.put(runnerObjectKey(RUNNER_PHOTOS.mine.id, 'full'), JPEG);

    const response = await get(
      `${runnerImagePath(RUNNER_PHOTOS.mine.id, 'full')}?download=1`,
    );

    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${RUNNER_PHOTOS.mine.shortId}.jpg"`,
    );
  });

  it('serves nothing before publishing, once taken down, or at another running’s address', async () => {
    await bucket.put(
      runnerObjectKey(RUNNER_PHOTOS.unpublished.id, 'thumb', `nn-${UNPUBLISHED_YEAR}`),
      JPEG,
    );
    await bucket.put(runnerObjectKey(RUNNER_PHOTOS.hidden.id, 'thumb'), JPEG);
    await bucket.put(runnerObjectKey(RUNNER_PHOTOS.mine.id, 'thumb'), JPEG);

    for (const path of [
      runnerImagePath(RUNNER_PHOTOS.unpublished.id, 'thumb', UNPUBLISHED_YEAR),
      runnerImagePath(RUNNER_PHOTOS.hidden.id, 'thumb'),
      runnerImagePath(RUNNER_PHOTOS.mine.id, 'thumb', UNPUBLISHED_YEAR),
      runnerImagePath(RUNNER_PHOTOS.mine.id, 'original'),
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });
});

describe('the results page', () => {
  it('says the photos are out once they are published and the links have gone', async () => {
    const page = await markup(await get(`/nn/${RUNNER_YEAR}/results/`));

    expect(page).toContain('Your Nightingale Nightmare photos are ready');
  });

  it('says nothing about photos for a race that has none', async () => {
    // `nn-2095` is `timing-fixtures.ts`'s published race, with no photos at all.
    const page = await markup(await get('/nn/2095/results/'));

    expect(page).not.toContain('photos are ready');
  });
});

function postForm(path: string, body: Record<string, string>): Promise<Response> {
  return SELF.fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'manual',
  });
}

/** Everything a visitor could compare between two answers: the status, where, and how. */
function shapeOf(response: Response): Record<string, string | number | null> {
  return {
    status: response.status,
    location: response.headers.get('location'),
    cache: response.headers.get('cache-control'),
    referrer: response.headers.get('referrer-policy'),
  };
}

describe('the lost-link form (slice 5)', () => {
  it('asks for the email somebody entered with, on a private page that works without script', async () => {
    const response = await get(lostLinkPath());
    const page = await markup(response);

    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(page).toContain(`action="${lostLinkPath()}"`);
    expect(page).toContain('method="post"');
    // A real label for the one field, matched loosely because Prettier reflows the template.
    expect(page).toMatch(
      /<label class="field-label" for="photos-email"\s*>\s*The email you entered with\s*<\/label\s*>/,
    );
    expect(page).toContain('type="email"');
    expect(page).not.toContain('<script');
  });

  it('answers the unslashed address with the slashed one, keeping a POST a POST', async () => {
    const get301 = await get(lostLinkPath().replace(/\/$/, ''));
    expect(get301.status).toBe(301);
    expect(get301.headers.get('location')).toBe(lostLinkPath());

    const post308 = await postForm(lostLinkPath().replace(/\/$/, ''), {
      email: RUNNER_ADDRESS,
    });
    expect(post308.status).toBe(308);
  });

  it('answers an address that entered and one that did not in exactly the same way', async () => {
    const known = await postForm(lostLinkPath(), { email: RUNNER_ADDRESS });
    const unknown = await postForm(lostLinkPath(), { email: 'never-ran@example.com' });

    expect(shapeOf(known)).toEqual(shapeOf(unknown));
    expect(shapeOf(known)).toEqual({
      status: 303,
      location: `${lostLinkPath()}?sent=1`,
      cache: 'private, no-store',
      referrer: 'no-referrer',
    });
    // The address never travels in the redirect.
    expect(known.headers.get('location')).not.toContain('@');
  });

  it('says the brief’s sentence once a request is made, whoever made it', async () => {
    const page = await markup(await get(`${lostLinkPath()}?sent=1`));

    expect(page).toContain(
      `If that address entered ${RUNNER_EVENT_NAME}, a new link is on its way. It can take a few minutes, so check your junk folder too.`,
    );
  });

  it('sends back an address that is not one, saying what to type, and records nothing', async () => {
    const response = await postForm(lostLinkPath(), { email: 'not an address' });
    const page = await markup(response);

    expect(response.status).toBe(422);
    expectPrivateHeaders(response);
    expect(page).toContain('Enter an email address, like name@example.com.');
    expect(page).toContain('aria-invalid="true"');
  });

  it('says the photos are not up yet for a running whose links have not gone out', async () => {
    const response = await get(lostLinkPath(UNPUBLISHED_YEAR));
    const page = await markup(response);

    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(page).toContain('The photos aren&#39;t up yet.');
    expect(page).not.toContain('<form');

    const posted = await postForm(lostLinkPath(UNPUBLISHED_YEAR), {
      email: RUNNER_ADDRESS,
    });
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe(lostLinkPath(UNPUBLISHED_YEAR));
  });
});
