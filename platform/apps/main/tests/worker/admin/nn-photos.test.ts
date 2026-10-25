import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  PHOTO_CREDIT,
  REPLACED_TOKEN,
  RUNNER_BIB,
  RUNNER_CONTACT,
  RUNNER_EVENT_NAME,
  RUNNER_FINISH_TIME,
  RUNNER_PHOTOS,
  RUNNER_TOKEN,
  RUNNER_YEAR,
  UNPUBLISHED_TOKEN,
  UNPUBLISHED_YEAR,
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
