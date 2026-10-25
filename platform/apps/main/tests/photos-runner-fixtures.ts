/**
 * A runner's race photos fixture — the names, ids and addresses (brief slice 4).
 *
 * **Constants only, and no `pg`**, so the Worker tests can import them inside `workerd`, which
 * cannot load a database driver; `photos-runner-db.ts` writes the rows. The same split as
 * `admin-fixtures.ts` and `admin-db.ts`.
 *
 * A running of its own, `nn-2093`, with published results and published photos, and `nn-2094`,
 * whose photos are not published. Years that will not happen, for `timing-fixtures.ts`'s reason:
 * the address is what names the running. Invented throughout.
 */

export const RUNNER_YEAR = '2093';
export const RUNNER_EVENT_SLUG = `nn-${RUNNER_YEAR}`;
export const RUNNER_EVENT_NAME = 'Nightingale Nightmare 2093';
export const RUNNER_EVENT_ID = '0d0d0d0d-0000-4000-8000-000000000001';
export const RUNNER_CONTACT = 'race-photos-fixture@example.com';

export const UNPUBLISHED_YEAR = '2094';
export const UNPUBLISHED_EVENT_SLUG = `nn-${UNPUBLISHED_YEAR}`;
export const UNPUBLISHED_EVENT_ID = '0d0d0d0d-0000-4000-8000-000000000002';

/** The runner whose link these pages open: bib 125, finishing in 44:10.00. */
export const RUNNER_BIB = '125';
export const RUNNER_FINISH_TIME = '44:10.00';

/** A token is 43 URL-safe characters (`packages/shared/src/photos-runner.ts`). */
export const RUNNER_TOKEN = 'Fx0photosRunnerFixtureToken_one-AAAAAAAAAAA';
export const REPLACED_TOKEN = 'Fx0photosRunnerFixtureToken_old-BBBBBBBBBBB';
export const UNPUBLISHED_TOKEN = 'Fx0photosRunnerFixtureToken_unp-CCCCCCCCCCC';

export const PHOTO_CREDIT = "Ross O'Neill";

export const RUNNER_PHOTOS = {
  mine: { id: '0d0d0d0d-0000-4000-8000-000000000101', shortId: 'RP93-0001' },
  couldBe: { id: '0d0d0d0d-0000-4000-8000-000000000102', shortId: 'RP93-0002' },
  someoneElse: { id: '0d0d0d0d-0000-4000-8000-000000000103', shortId: 'RP93-0003' },
  hidden: { id: '0d0d0d0d-0000-4000-8000-000000000104', shortId: 'RP93-0004' },
  unpublished: { id: '0d0d0d0d-0000-4000-8000-000000000105', shortId: 'RP94-0001' },
} as const;

export function runnerPagePath(token: string = RUNNER_TOKEN, year = RUNNER_YEAR): string {
  return `/nn/${year}/photos/p/${token}/`;
}

export function runnerImagePath(
  photoId: string,
  size: string,
  year = RUNNER_YEAR,
): string {
  return `/nn/${year}/photos/img/${photoId}/${size}.jpg`;
}

/** Where the Worker looks for a copy in the bucket: `nn-2093/<id>/thumb.jpg`. */
export function runnerObjectKey(
  photoId: string,
  size: string,
  eventSlug = RUNNER_EVENT_SLUG,
): string {
  return `${eventSlug}/${photoId}/${size}.jpg`;
}
