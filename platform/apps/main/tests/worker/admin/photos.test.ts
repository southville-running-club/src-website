import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ADMIN_PASSWORD,
  NN_ADMIN_EMAIL,
  PHOTO_ADMIN_EMAIL,
  PHOTO_CHECKER_EMAIL,
  PHOTO_HIDDEN_ID,
  PHOTO_PART_SHORT_ID,
  PHOTO_TO_TAKE_DOWN_ID,
  PHOTO_TO_TAKE_DOWN_SHORT_ID,
  PHOTO_UNSURE_ID,
  PHOTO_UNSURE_SHORT_ID,
  PHOTOS_EVENT_NAME,
  PHOTOS_EVENT_SLUG,
  REGISTERED_EMAIL,
} from '../../admin-fixtures';

/**
 * `/admin/photos/`, in the real Workers runtime — the race photos check page (brief slice 3,
 * ADR-065 and ADR-066).
 *
 * The database tests (`packages/db/tests/photos-check.test.ts`) prove the queue, the holds,
 * the decisions and publishing. This file proves the half only the Worker can get wrong: that
 * every door answers 404 to somebody without its permission, exactly as the rest of `/admin/`
 * does; that the check page renders a photo and its choices; that a decision is a POST that
 * answers 303; and that the image route serves an unpublished copy from the bucket to a
 * checker and to nobody else.
 *
 * **The bucket is Miniflare's in-memory R2**, bound from `wrangler.jsonc`'s top-level
 * `PHOTOS`. Each test puts the bytes it needs, so nothing here depends on another test having
 * run, and nothing reaches the real bucket.
 *
 * The photos themselves come from `seedAdminFixtures()` — a fabricated running,
 * `zz-admin-photos`, never `nn-2026`.
 */

const SITE = 'https://example.com';
const OVERVIEW = '/admin/photos/';
const CHECK = '/admin/photos/check/';
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const bucket = (env as unknown as { PHOTOS: R2Bucket }).PHOTOS;

const image = (id: string, size: string) => `${CHECK}img/${id}/${size}.jpg`;
const key = (id: string, size: string) => `${PHOTOS_EVENT_SLUG}/${id}/${size}.jpg`;

/** A few bytes that start the way a JPEG does. The route serves them; nothing decodes them. */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
]);

function squash(markup: string): string {
  return markup.replace(/<wbr>/g, '').replace(/\s+/g, ' ');
}

function setCookiePairs(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const all =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];

  return all
    .filter((value) => value !== '')
    .map((value) => value.split(';')[0]!.trim())
    .filter((pair) => !pair.endsWith('='));
}

function jar(...pairs: (string | null)[]): string {
  return pairs.filter((pair): pair is string => pair !== null && pair !== '').join('; ');
}

function csrfFrom(response: Response, markup: string): { cookie: string; field: string } {
  const cookie = setCookiePairs(response).find((value) => value.startsWith('src_csrf='));
  const field = /name="csrf_token" value="([^"]+)"/.exec(markup)?.[1];
  expect(cookie, 'the page set no CSRF cookie').toBeDefined();
  expect(field, 'the page rendered no CSRF field').toBeDefined();
  return { cookie: cookie!, field: field! };
}

async function signIn(email: string): Promise<string> {
  const form = await SELF.fetch(`${SITE}/account/sign-in/`, { redirect: 'manual' });
  const { cookie, field } = csrfFrom(form, squash(await form.text()));

  const response = await SELF.fetch(`${SITE}/account/sign-in/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({
      email,
      password: ADMIN_PASSWORD,
      csrf_token: field,
      'cf-turnstile-response': DUMMY_CAPTCHA_TOKEN,
    }),
    redirect: 'manual',
  });

  expect(response.status, `signing in as ${email} was refused`).toBe(303);
  return jar(...setCookiePairs(response));
}

function get(path: string, cookie: string | null = null): Promise<Response> {
  return SELF.fetch(`${SITE}${path}`, {
    headers: cookie === null ? {} : { cookie },
    redirect: 'manual',
  });
}

function post(
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

/** Read a page and hand back its markup and a session-plus-CSRF cookie to post with. */
async function open(
  path: string,
  session: string,
): Promise<{ status: number; markup: string; cookie: string; field: string }> {
  const response = await get(path, session);
  const markup = squash(await response.text());
  const { cookie, field } = csrfFrom(response, markup);
  return { status: response.status, markup, cookie: jar(session, cookie), field };
}

let checker: string;
let photoAdmin: string;
let nnAdmin: string;
let member: string;

beforeAll(async () => {
  checker = await signIn(PHOTO_CHECKER_EMAIL);
  photoAdmin = await signIn(PHOTO_ADMIN_EMAIL);
  nnAdmin = await signIn(NN_ADMIN_EMAIL);
  member = await signIn(REGISTERED_EMAIL);
});

describe('the doors', () => {
  it('answers 404 at every photos address to somebody signed out or holding no photo role', async () => {
    for (const path of [
      OVERVIEW,
      CHECK,
      image(PHOTO_UNSURE_ID, 'medium'),
      `${OVERVIEW}take-down/${PHOTO_UNSURE_ID}/`,
    ]) {
      for (const [who, cookie] of [
        ['signed out', null],
        ['a member', member],
        ['an nn-admin', nnAdmin],
      ] as const) {
        expect((await get(path, cookie)).status, `${path} for ${who}`).toBe(404);
      }
    }
  });

  it('opens the progress figures to a photo-admin and keeps the queue and its images from them', async () => {
    expect((await get(OVERVIEW, photoAdmin)).status).toBe(200);

    for (const path of [
      CHECK,
      image(PHOTO_UNSURE_ID, 'medium'),
      `${OVERVIEW}take-down/${PHOTO_UNSURE_ID}/`,
    ]) {
      expect((await get(path, photoAdmin)).status, path).toBe(404);
    }
  });

  it('keeps the entry list from a checker, who sees photos and bibs and nothing else', async () => {
    expect((await get('/admin/nn/', checker)).status).toBe(404);
    expect((await get('/admin/people/', checker)).status).toBe(404);
  });

  it('puts Race photos in the bar and on the dashboard for both photo roles, and for nobody else', async () => {
    for (const cookie of [checker, photoAdmin]) {
      const markup = squash(await (await get('/admin/', cookie)).text());
      expect(markup).toContain('<a href="/admin/photos/">Race photos</a>');
    }

    const forNnAdmin = squash(await (await get('/admin/', nnAdmin)).text());
    expect(forNnAdmin).not.toContain('/admin/photos/');
  });
});

describe('the overview', () => {
  it('shows each running by its own name, with what is left to check', async () => {
    const { markup } = await open(OVERVIEW, photoAdmin);

    // This running's own panel. **Scoped rather than the whole page**, because other
    // fixtures' runnings share the overview — the runner pages' `nn-2094` is unpublished with
    // nothing left to check, so it rightly offers a Publish button of its own.
    const panel = /aria-labelledby="photos-zz-admin-photos"[\s\S]*?<\/section>/.exec(
      markup,
    )?.[0];
    expect(panel, 'no panel for this running').toBeDefined();

    expect(panel).toContain(PHOTOS_EVENT_NAME);
    expect(panel).toContain('Left to check');
    expect(panel).toContain('Publishing waits until every unsure photo has been checked');
    // No publish button while anything is left: the refusal is not offered as a control.
    expect(panel).not.toContain('Publish the photos');
  });

  it('refuses to publish while anything is left to check, and says how much', async () => {
    const { cookie, field } = await open(OVERVIEW, photoAdmin);
    const response = await post(
      OVERVIEW,
      { csrf_token: field, action: 'publish', event: PHOTOS_EVENT_SLUG },
      cookie,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(
      /^\/admin\/photos\/\?result=left_to_check&left=\d+$/,
    );
  });

  it('answers 404 to a checker who tries to publish, before anything is read', async () => {
    const { cookie, field } = await open(OVERVIEW, checker);
    const response = await post(
      OVERVIEW,
      { csrf_token: field, action: 'publish', event: PHOTOS_EVENT_SLUG },
      cookie,
    );

    expect(response.status).toBe(404);
  });

  it('refuses a post without the CSRF token', async () => {
    const response = await post(
      OVERVIEW,
      { action: 'publish', event: PHOTOS_EVENT_SLUG },
      photoAdmin,
    );

    expect(response.status).toBe(404);
  });
});

describe('the check page', () => {
  it('shows the earliest unsure photo with the bibs that fit as numbered buttons', async () => {
    const { status, markup } = await open(CHECK, checker);

    expect(status).toBe(200);
    expect(markup).toContain(PHOTO_UNSURE_SHORT_ID);
    expect(markup).toContain(`src="${image(PHOTO_UNSURE_ID, 'medium')}"`);
    // The credit's apostrophe is escaped, not dropped.
    expect(markup).toContain('by Ross O&#39;Neill');
    expect(markup).toMatch(/value="125"[^>]*data-key="1"/);
    expect(markup).toContain('No bib visible');
    expect(markup).toContain('Take this photo down');
  });

  it('records a decision as a POST that answers 303, offers Undo, and moves on', async () => {
    const page = await open(CHECK, checker);
    const decided = await post(
      CHECK,
      { csrf_token: page.field, photo: PHOTO_UNSURE_ID, pick: '125' },
      page.cookie,
    );

    expect(decided.status).toBe(303);
    expect(decided.headers.get('location')).toBe(
      `${CHECK}?done=confirm&last=${PHOTO_UNSURE_ID}`,
    );

    // The next photo is the part read, whose candidates come from the race's own roster.
    const after = await open(`${CHECK}?done=confirm&last=${PHOTO_UNSURE_ID}`, checker);
    expect(after.markup).toContain('Saved.');
    expect(after.markup).toContain('Undo that');
    expect(after.markup).toContain(PHOTO_PART_SHORT_ID);
    for (const bib of ['120', '125', '128']) {
      expect(after.markup).toContain(`value="${bib}"`);
    }
    expect(after.markup).toContain('Keep it part read');

    // Undo puts the first photo back, held for the same checker.
    const undone = await post(
      CHECK,
      { csrf_token: after.field, photo: PHOTO_UNSURE_ID, action: 'undo' },
      after.cookie,
    );
    expect(undone.status).toBe(303);
    expect(undone.headers.get('location')).toBe(`${CHECK}?done=undone`);
    expect((await open(CHECK, checker)).markup).toContain(PHOTO_UNSURE_SHORT_ID);
  });

  it('sends a typed bib that is not a bib back with a message, saving nothing', async () => {
    const page = await open(CHECK, checker);
    const response = await post(
      CHECK,
      { csrf_token: page.field, photo: PHOTO_UNSURE_ID, action: 'correct', typed: '12a' },
      page.cookie,
    );

    expect(response.headers.get('location')).toBe(`${CHECK}?done=invalid_bib`);
    expect((await open(CHECK, checker)).markup).toContain(PHOTO_UNSURE_SHORT_ID);
  });

  it('refuses a decision without the CSRF token', async () => {
    const response = await post(
      CHECK,
      { photo: PHOTO_UNSURE_ID, action: 'no_bib' },
      checker,
    );

    expect(response.status).toBe(404);
  });
});

describe('the image route', () => {
  it('serves an unpublished copy to a checker, privately and uncached', async () => {
    await bucket.put(key(PHOTO_UNSURE_ID, 'medium'), JPEG);

    const response = await get(image(PHOTO_UNSURE_ID, 'medium'), checker);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
  });

  it('serves nothing for a size the laptop does not make, or a photo taken down', async () => {
    await bucket.put(key(PHOTO_UNSURE_ID, 'original'), JPEG);
    await bucket.put(key(PHOTO_HIDDEN_ID, 'medium'), JPEG);

    expect((await get(image(PHOTO_UNSURE_ID, 'original'), checker)).status).toBe(404);
    expect((await get(image(PHOTO_HIDDEN_ID, 'medium'), checker)).status).toBe(404);
  });

  it('answers 404 for a copy that is not in the bucket', async () => {
    expect((await get(image(PHOTO_UNSURE_ID, 'thumb'), checker)).status).toBe(404);
  });
});

describe('taking a photo down', () => {
  it('asks a checker to confirm, naming the photo', async () => {
    const response = await get(`${OVERVIEW}take-down/${PHOTO_TO_TAKE_DOWN_ID}/`, checker);
    const markup = squash(await response.text());

    expect(response.status).toBe(200);
    expect(markup).toContain(
      `Take photo <span class="admin-mono">${PHOTO_TO_TAKE_DOWN_SHORT_ID}</span> down?`,
    );
    expect(markup).toContain('cannot be undone');
  });

  it('hides it and deletes all three copies from the bucket', async () => {
    for (const size of ['full', 'medium', 'thumb']) {
      await bucket.put(key(PHOTO_TO_TAKE_DOWN_ID, size), JPEG);
    }

    const { cookie, field } = await open(OVERVIEW, photoAdmin);
    const response = await post(
      OVERVIEW,
      {
        csrf_token: field,
        action: 'take_down',
        event: PHOTOS_EVENT_SLUG,
        short_id: PHOTO_TO_TAKE_DOWN_SHORT_ID.toLowerCase(),
      },
      cookie,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${OVERVIEW}?result=taken_down`);
    for (const size of ['full', 'medium', 'thumb']) {
      expect(await bucket.head(key(PHOTO_TO_TAKE_DOWN_ID, size)), size).toBeNull();
    }
  });

  it('says plainly when there is no such photo', async () => {
    const { cookie, field } = await open(OVERVIEW, photoAdmin);
    const response = await post(
      OVERVIEW,
      {
        csrf_token: field,
        action: 'take_down',
        event: PHOTOS_EVENT_SLUG,
        short_id: 'ZZ26-9999',
      },
      cookie,
    );

    expect(response.headers.get('location')).toBe(`${OVERVIEW}?result=no_such_photo`);
  });

  it('answers 404 to somebody without nn.photo.hide', async () => {
    const response = await post(
      OVERVIEW,
      {
        action: 'take_down',
        event: PHOTOS_EVENT_SLUG,
        short_id: PHOTO_TO_TAKE_DOWN_SHORT_ID,
      },
      nnAdmin,
    );

    expect(response.status).toBe(404);
  });
});
