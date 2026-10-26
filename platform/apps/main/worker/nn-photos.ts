import {
  createAnonClient,
  fetchPhotosReady,
  fetchRunnerPhoto,
  fetchRunnerPhotos,
  fetchServablePhoto,
  formatLondonTime,
  isLinkToken,
  isPhotoSize,
  linkTokenHash,
  mailtoLink,
  photoDownloadName,
  photoObjectKey,
  requestPhotoLink,
  type CouldBePhoto,
  type RunnerPhoto,
  type SupabaseConfig,
} from '@src/shared';

import { html, type Html } from './html';
import { finishTimeForBib } from './nn-results';
import { nnPhotosPath, type NnPhotosRoute } from './routing';
import { faviconLink, siteBanner, siteFooter } from './site-chrome';

/**
 * A runner's race photos — their private page, one photo, and the images (brief slice 4;
 * decisions 7 and 8; ADR-068).
 *
 * ## Reached only through a private link
 *
 * `/nn/<year>/photos/p/<token>/` is emailed to the address a runner entered with (slice 5).
 * There is no search and no account: the token is the key, the Worker hashes it, and
 * `photos.runner_photos()` answers only to an active link's hash for photos that are published.
 * **Every refusal is the same friendly page**, so a link cannot be used to learn whether it
 * once worked, and a mangled one is never a 500.
 *
 * ## ⚠️ Three headers on every page here, and none of them is decoration
 *
 *   * **`Cache-Control: private, no-store`** — a page holding a token must not sit in a shared
 *     cache, where the next person to ask for the same address would be handed it.
 *   * **`Referrer-Policy: no-referrer`** — so following a link off this page does not carry the
 *     token to another site's logs. ⚠️ **It makes a browser send `Origin: null` with a form
 *     posted from this page** (CLAUDE.md), which is harmless here because there is no form —
 *     "That's me" and a takedown request are emails — and is the first thing to remember if one
 *     is ever added.
 *   * **`X-Robots-Tag: noindex`** — a private page has no business in a search engine.
 *
 * And **no analytics, ever** (brief §14): a token in the address is exactly what one collects.
 *
 * ## Built here, in the race's look
 *
 * Worker-built, like `/nn/<year>/results/`, because a page of photos is a list of varying
 * length and nothing on this site injects markup into a static page. It wears the race page's
 * look rather than the results page's club one (brief §10): `body.theme-nn`, the race title in
 * Nosifer, Inter for text and JetBrains Mono for bibs, times and photo IDs, through
 * `/nn/photos.css`. **No club navigation bar**, as `Base.astro` draws none for a race page:
 * its links are coloured for the club's white page, and on the race theme they came out bone
 * on white, 1.06:1, which axe caught on the first run. Everything a runner reads sits on `.nn-card`'s white surface, so no colour
 * here was computed against the gradient (CLAUDE.md, `NnSchedule`).
 *
 * ## The images
 *
 * `/nn/<year>/photos/img/<photo id>/<size>.jpg`, from the bucket through the `PHOTOS` binding
 * (ADR-063). Nothing is served before the photos are published or once one is taken down —
 * `photos.servable_photo()` is asked every time. Cached in the viewer's own browser for an hour
 * with an ETag, so a second view is a 304; **a photo taken down can therefore linger in a
 * browser that already had it for up to that hour** (brief §14), which is why nothing promises
 * instant removal.
 */

export interface NnPhotosEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
  PHOTOS?: R2Bucket;
  /** What `photos.request_link()` takes (ADR-069). Absent, the form still answers the same
   *  sentence and nothing is queued — the safe direction, and logged as a code. */
  PHOTOS_ENTRY_KEY?: string;
}

/**
 * Every sentence a runner reads on these pages, in one place.
 *
 * ⚠️ **For Kayleigh's sign-off, and not to be added to without it** (brief §4). The part-read
 * sentence is the brief's own draft copy, word for word; the rest is the fewest words the pages
 * need, written for review rather than as final copy.
 */
export const PHOTOS_COPY = {
  yourPhotos: 'Your photos',
  bib: 'Bib',
  finishTime: 'Finish time',
  noneOfYours:
    'We have not found you in any photos yet. If any could be you, they are below.',
  couldBeHeading: 'Could be you',
  couldBe: (bib: string) =>
    `We could only read part of the number on these, and what we read fits bib ${bib}.`,
  thatsMe: "That's me",
  thatsMeSubject: (shortId: string) => `That's me in photo ${shortId}`,
  thatsMeBody: (shortId: string, bib: string) =>
    `Photo ${shortId} is me. My bib was ${bib}.`,
  back: 'Back to your photos',
  download: 'Download this photo',
  photoId: 'Photo ID',
  spot: 'Where',
  time: 'When',
  credit: 'Photo by',
  takeDownLink: 'Ask us to take it down',
  takeDownSubject: (shortId: string) => `Please take down photo ${shortId}`,
  takeDownBody: (shortId: string) => `Please take down photo ${shortId}.`,
  notFoundTitle: 'This link is not working',
  notFound:
    'It may have been replaced by a newer link, or the photos may not be up yet. Use the newest email we sent you.',
  getNewLink: 'Get a new link',
  unavailableTitle: 'Your photos could not be loaded',
  unavailable: 'Something went wrong on our side. Try again in a few minutes.',
  // The lost-link form (slice 5). The label and the sent sentence are the brief's own draft
  // copy; the rest is the fewest words the form needs.
  raceName: (year: string) => `Nightingale Nightmare ${year}`,
  lostHeading: 'Get a new link to your photos',
  lostIntro: 'We will email a new link to the address you entered the race with.',
  lostLabel: 'The email you entered with',
  lostButton: 'Send me a new link',
  lostInvalid: 'Enter an email address, like name@example.com.',
  lostSent: (raceName: string) =>
    `If that address entered ${raceName}, a new link is on its way. It can take a few minutes, so check your junk folder too.`,
  notUpYet: "The photos aren't up yet. When they are, we'll email you a link to yours.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID = /^[A-Za-z0-9]{2,8}-[0-9]{4,}$/;

/** An hour, in a viewer's own browser — brief §10. */
const IMAGE_MAX_AGE_SECONDS = 3600;

export async function handleNnPhotos(
  request: Request,
  env: NnPhotosEnv,
  url: URL,
  route: NnPhotosRoute,
): Promise<Response> {
  if (route.kind === 'image') {
    return image(request, env, route, url);
  }

  if (route.kind === 'lost-link') {
    return lostLink(request, env, url, route);
  }

  // **One address per page**: the unslashed spelling answers with the slashed one, as
  // `trailingSlash: 'always'` does for every page in `dist/`. The token is in the address
  // already, so redirecting to it discloses nothing the request did not carry.
  if (!route.slashed) {
    return new Response(null, {
      status: 301,
      headers: {
        location: `${url.pathname}/`,
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  }

  const photosPath = nnPhotosPath(route.eventSlug);
  if (photosPath === null || !isLinkToken(route.token)) {
    return notWorking(photosPath);
  }

  const cfg: SupabaseConfig = {
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  };
  const client = createAnonClient(cfg);
  const hash = await linkTokenHash(route.token);
  const pageBase = `${photosPath}p/${route.token}/`;

  if (route.kind === 'page') {
    const answer = await fetchRunnerPhotos(client, route.eventSlug, hash);

    if (answer.status === 'none') return notWorking(photosPath);
    if (answer.status === 'unavailable') {
      // A code and a function name, never the token or its hash.
      console.error(`photos: runner page unavailable — ${answer.error}`);
      return unavailable();
    }

    const time = await finishTimeForBib(env, route.eventSlug, answer.page.bib);
    return runnerPage(answer.page, photosPath, pageBase, time);
  }

  if (!SHORT_ID.test(route.shortId)) {
    return notWorking(photosPath);
  }

  const one = await fetchRunnerPhoto(client, route.eventSlug, hash, route.shortId);

  if (one.status === 'none') return notWorking(photosPath);
  if (one.status === 'unavailable') {
    console.error(`photos: one-photo page unavailable — ${one.error}`);
    return unavailable();
  }

  return onePhotoPage(one.photo, photosPath, pageBase);
}

// =========================================================================================
// The pages
// =========================================================================================

function document(title: string, body: Html, status: number): Response {
  const markup = html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
        <title>${title} — Southville Running Club</title>
        ${faviconLink()}
        <link rel="stylesheet" href="/nn/photos.css" />
      </head>
      <body class="theme-nn">
        ${siteBanner()} ${body} ${siteFooter()}
      </body>
    </html>`;

  return new Response(markup.toString(), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function hero(title: string): Html {
  return html`<header class="nn-hero nn-photos-hero">
    <div class="nn-wrap">
      <h1>${title}</h1>
    </div>
  </header>`;
}

function imagePath(photosPath: string, photo: RunnerPhoto, size: string): string {
  return `${photosPath}img/${photo.id}/${size}.jpg`;
}

function when(photo: RunnerPhoto): string | null {
  return photo.takenAt === null ? null : formatLondonTime(photo.takenAt);
}

function caption(photo: RunnerPhoto): Html {
  const time = when(photo);
  return html`<p class="nn-photos-caption">
    <span class="nn-mono">${photo.shortId}</span> ·
    ${photo.spot}${time === null ? '' : ` · ${time}`}
  </p>`;
}

function card(
  photo: RunnerPhoto | CouldBePhoto,
  photosPath: string,
  pageBase: string,
  thatsMe: string | null,
): Html {
  return html`<li class="nn-photos-item">
    <a class="nn-photos-thumb" href="${pageBase}${photo.shortId}/">
      <img
        src="${imagePath(photosPath, photo, 'thumb')}"
        width="${String(photo.width)}"
        height="${String(photo.height)}"
        alt="Photo ${photo.shortId}, at ${photo.spot}"
        loading="lazy"
        decoding="async"
      />
    </a>
    ${caption(photo)}
    ${thatsMe === null ? null : html`<p><a href="${thatsMe}">${PHOTOS_COPY.thatsMe}</a></p>`}
  </li>`;
}

function runnerPage(
  page: {
    eventName: string;
    contact: string | null;
    bib: string;
    mine: RunnerPhoto[];
    couldBe: CouldBePhoto[];
  },
  photosPath: string,
  pageBase: string,
  time: string | null,
): Response {
  const body = html`<main id="main" class="nn-photos">
    ${hero(page.eventName)}
    <div class="nn-wrap">
      <section class="nn-card" aria-labelledby="photos-yours">
        <h2 id="photos-yours">${PHOTOS_COPY.yourPhotos}</h2>
        <dl class="nn-photos-facts">
          <div>
            <dt>${PHOTOS_COPY.bib}</dt>
            <dd class="nn-mono">${page.bib}</dd>
          </div>
          ${
            time === null
              ? null
              : html`<div>
                  <dt>${PHOTOS_COPY.finishTime}</dt>
                  <dd class="nn-mono">${time}</dd>
                </div>`
          }
        </dl>
        ${
          page.mine.length === 0
            ? html`<p>${PHOTOS_COPY.noneOfYours}</p>`
            : html`<ul class="nn-photos-grid">
                ${page.mine.map((photo) => card(photo, photosPath, pageBase, null))}
              </ul>`
        }
      </section>
      ${
        page.couldBe.length === 0
          ? null
          : html`<section class="nn-card" aria-labelledby="photos-could-be">
              <h2 id="photos-could-be">${PHOTOS_COPY.couldBeHeading}</h2>
              <p>${PHOTOS_COPY.couldBe(page.bib)}</p>
              <ul class="nn-photos-grid">
                ${page.couldBe.map((photo) =>
                  card(
                    photo,
                    photosPath,
                    pageBase,
                    page.contact === null
                      ? null
                      : mailtoLink(
                          page.contact,
                          PHOTOS_COPY.thatsMeSubject(photo.shortId),
                          PHOTOS_COPY.thatsMeBody(photo.shortId, page.bib),
                        ),
                  ),
                )}
              </ul>
            </section>`
      }
    </div>
  </main>`;

  return document(PHOTOS_COPY.yourPhotos, body, 200);
}

function onePhotoPage(
  one: {
    eventName: string;
    contact: string | null;
    bib: string;
    mine: boolean;
    photo: RunnerPhoto;
  },
  photosPath: string,
  pageBase: string,
): Response {
  const { photo } = one;
  const time = when(photo);

  const body = html`<main id="main" class="nn-photos">
    ${hero(one.eventName)}
    <div class="nn-wrap">
      <p class="nn-photos-back"><a href="${pageBase}">${PHOTOS_COPY.back}</a></p>
      <figure class="nn-card nn-photos-one">
        <img
          src="${imagePath(photosPath, photo, 'medium')}"
          width="${String(photo.width)}"
          height="${String(photo.height)}"
          alt="Photo ${photo.shortId}, at ${photo.spot}"
        />
        <figcaption>
          <dl class="nn-photos-facts">
            <div>
              <dt>${PHOTOS_COPY.photoId}</dt>
              <dd class="nn-mono">${photo.shortId}</dd>
            </div>
            <div>
              <dt>${PHOTOS_COPY.spot}</dt>
              <dd>${photo.spot}</dd>
            </div>
            ${
              time === null
                ? null
                : html`<div>
                    <dt>${PHOTOS_COPY.time}</dt>
                    <dd class="nn-mono">${time}</dd>
                  </div>`
            }
            <div>
              <dt>${PHOTOS_COPY.credit}</dt>
              <dd>${photo.photographer}</dd>
            </div>
          </dl>
          <p class="nn-photos-actions">
            <a
              class="nn-cta"
              href="${imagePath(photosPath, photo, 'full')}?download=1"
              download
              >${PHOTOS_COPY.download}</a
            >
            ${
              one.mine || one.contact === null
                ? null
                : html`<a
                    href="${mailtoLink(
                      one.contact,
                      PHOTOS_COPY.thatsMeSubject(photo.shortId),
                      PHOTOS_COPY.thatsMeBody(photo.shortId, one.bib),
                    )}"
                    >${PHOTOS_COPY.thatsMe}</a
                  >`
            }
          </p>
          ${
            one.contact === null
              ? null
              : html`<p>
                  <a
                    href="${mailtoLink(
                      one.contact,
                      PHOTOS_COPY.takeDownSubject(photo.shortId),
                      PHOTOS_COPY.takeDownBody(photo.shortId),
                    )}"
                    >${PHOTOS_COPY.takeDownLink}</a
                  >
                </p>`
          }
        </figcaption>
      </figure>
    </div>
  </main>`;

  return document(`${PHOTOS_COPY.photoId} ${photo.shortId}`, body, 200);
}

/**
 * Every refusal: no such link, a replaced one, a mangled one, photos not published, a photo the
 * link does not show. **One page for all of them**, and a 404, never a 500. It offers the
 * lost-link form, which is the way back for every one of them (slice 5).
 */
function notWorking(photosPath: string | null): Response {
  return document(
    PHOTOS_COPY.notFoundTitle,
    html`<main id="main" class="nn-photos">
      <div class="nn-wrap">
        <section class="nn-card nn-photos-notice">
          <h1 class="nn-photos-plain">${PHOTOS_COPY.notFoundTitle}</h1>
          <p>${PHOTOS_COPY.notFound}</p>
          ${
            photosPath === null
              ? null
              : html`<p><a href="${photosPath}">${PHOTOS_COPY.getNewLink}</a></p>`
          }
        </section>
      </div>
    </main>`,
    404,
  );
}

// =========================================================================================
// The lost-link form — slice 5, ADR-069
// =========================================================================================

/** An address's shape, and only its shape. The database decides whether it entered. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `/nn/<year>/photos/` — "the email you entered with", and a new link to it.
 *
 * ## ⚠️ It says the same thing whatever it is given
 *
 * A POST with a well-formed address always answers **303 to `?sent=1`**, and that page always
 * says the brief's sentence: *if* that address entered, a link is on its way. Whether it did,
 * whether it has a photo, whether it hit the three-a-day limit, and whether the call even
 * worked are all invisible, so the form cannot be used to learn who ran (brief §10). What
 * differs is only what any visitor could see anyway: an address that is not an address, and
 * photos that are not out yet.
 *
 * POST, redirect, GET, so a reload never asks twice, and no script: the form is a form. The
 * address is never in the redirect, and the page's headers are the private pages' three.
 */
async function lostLink(
  request: Request,
  env: NnPhotosEnv,
  url: URL,
  route: { eventSlug: string; slashed: boolean },
): Promise<Response> {
  if (!route.slashed) {
    // 308 for a POST so the method and the body survive the redirect, as `/nn/admin` does.
    return new Response(null, {
      status: request.method === 'POST' ? 308 : 301,
      headers: {
        location: `${url.pathname}/`,
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  }

  const photosPath = nnPhotosPath(route.eventSlug);
  if (photosPath === null) return notWorking(null);

  const raceName = PHOTOS_COPY.raceName(route.eventSlug.replace(/^nn-/, ''));
  const client = createAnonClient({
    url: env.PUBLIC_SUPABASE_URL,
    anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  });

  // Out means published **and** the links sent: before the photo-admin sends them, a new link
  // would be the first link, ahead of everybody else's.
  const ready = await fetchPhotosReady(client, route.eventSlug);

  if (request.method === 'POST') {
    if (!ready) return seeOther(photosPath);

    const email = await readEmail(request);
    if (email === null || email.length > 254 || !EMAIL.test(email)) {
      return lostLinkPage(
        raceName,
        photosPath,
        { sent: false, invalid: email ?? '' },
        422,
      );
    }

    const key = env.PHOTOS_ENTRY_KEY?.trim();
    if (key === undefined || key === '') {
      // A deployment state, not the visitor's problem: the answer is the same either way.
      console.warn('photos: lost-link form has no PHOTOS_ENTRY_KEY bound');
    } else {
      const outcome = await requestPhotoLink(client, key, route.eventSlug, email);
      // A code, never the address.
      if (outcome.status === 'unauthorised') {
        console.warn('photos.request_link refused the entry key');
      } else if (outcome.status === 'unavailable') {
        console.error(`photos: lost-link request unavailable — ${outcome.error}`);
      }
    }

    return seeOther(`${photosPath}?sent=1`);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  }

  if (!ready) return notUpYetPage(raceName);

  return lostLinkPage(
    raceName,
    photosPath,
    { sent: url.searchParams.get('sent') === '1', invalid: null },
    200,
  );
}

async function readEmail(request: Request): Promise<string | null> {
  try {
    const form = await request.formData();
    const value = form.get('email');
    return typeof value === 'string' ? value.trim() : null;
  } catch {
    return null;
  }
}

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

function lostLinkPage(
  raceName: string,
  photosPath: string,
  state: { sent: boolean; invalid: string | null },
  status: number,
): Response {
  const invalid = state.invalid !== null;

  return document(
    PHOTOS_COPY.lostHeading,
    html`<main id="main" class="nn-photos">
      ${hero(raceName)}
      <div class="nn-wrap">
        <section class="nn-card nn-photos-lost" aria-labelledby="photos-lost">
          <h2 id="photos-lost">${PHOTOS_COPY.lostHeading}</h2>
          ${
            state.sent
              ? html`<p class="nn-photos-sent" role="status">
                  ${PHOTOS_COPY.lostSent(raceName)}
                </p>`
              : null
          }
          <p>${PHOTOS_COPY.lostIntro}</p>
          <form method="post" action="${photosPath}">
            <div class="field">
              <label class="field-label" for="photos-email"
                >${PHOTOS_COPY.lostLabel}</label
              >
              ${
                invalid
                  ? html`<p class="field-error" id="photos-email-error">
                      ${PHOTOS_COPY.lostInvalid}
                    </p>`
                  : null
              }
              <input
                class="field-input"
                id="photos-email"
                name="email"
                type="email"
                autocomplete="email"
                maxlength="254"
                required
                value="${state.invalid ?? ''}"
                ${invalid ? html`aria-invalid="true" aria-describedby="photos-email-error"` : null}
              />
            </div>
            <button class="button" type="submit">${PHOTOS_COPY.lostButton}</button>
          </form>
        </section>
      </div>
    </main>`,
    status,
  );
}

function notUpYetPage(raceName: string): Response {
  return document(
    PHOTOS_COPY.lostHeading,
    html`<main id="main" class="nn-photos">
      ${hero(raceName)}
      <div class="nn-wrap">
        <section class="nn-card nn-photos-notice" aria-labelledby="photos-lost">
          <h2 id="photos-lost">${PHOTOS_COPY.lostHeading}</h2>
          <p>${PHOTOS_COPY.notUpYet}</p>
        </section>
      </div>
    </main>`,
    200,
  );
}

function unavailable(): Response {
  return document(
    PHOTOS_COPY.unavailableTitle,
    html`<main id="main" class="nn-photos">
      <div class="nn-wrap">
        <section class="nn-card nn-photos-notice">
          <h1 class="nn-photos-plain">${PHOTOS_COPY.unavailableTitle}</h1>
          <p>${PHOTOS_COPY.unavailable}</p>
        </section>
      </div>
    </main>`,
    503,
  );
}

// =========================================================================================
// The images
// =========================================================================================

function imageNotFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

async function image(
  request: Request,
  env: NnPhotosEnv,
  route: Extract<NnPhotosRoute, { kind: 'image' }>,
  url: URL,
): Promise<Response> {
  if (!UUID.test(route.photoId) || !isPhotoSize(route.size)) {
    return imageNotFound();
  }

  const servable = await fetchServablePhoto(
    createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    }),
    route.eventSlug,
    route.photoId,
  );

  if (servable.status !== 'ok') {
    if (servable.status === 'unavailable') {
      console.error(`photos: image check unavailable — ${servable.error}`);
    }
    return imageNotFound();
  }

  if (env.PHOTOS === undefined) {
    console.error('race photos bucket binding PHOTOS is missing');
    return imageNotFound();
  }

  // `onlyIf` hands R2 the request's own `If-None-Match`: when the browser already holds this
  // copy, R2 answers with the object's metadata and no body, which is a 304.
  const object = await env.PHOTOS.get(
    photoObjectKey(route.eventSlug, route.photoId, route.size),
    {
      onlyIf: request.headers,
    },
  );

  if (object === null) {
    return imageNotFound();
  }

  const headers = new Headers({
    'content-type': 'image/jpeg',
    etag: object.httpEtag,
    'cache-control': `private, max-age=${String(IMAGE_MAX_AGE_SECONDS)}`,
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
  });

  if (url.searchParams.get('download') === '1') {
    headers.set(
      'content-disposition',
      `attachment; filename="${photoDownloadName(servable.shortId)}"`,
    );
  }

  if (!('body' in object)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}
