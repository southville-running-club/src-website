import {
  createUserClient,
  fetchNextPhoto,
  fetchPhotoProgress,
  formatLondon,
  isPartRead,
  isPhotoSize,
  parseTypedBibs,
  photoForAdminImage,
  photoObjectKey,
  PHOTO_SIZES,
  plural,
  publishPhotos,
  recordPhotoDecision,
  takeDownPhoto,
  undoPhotoDecision,
  type DecisionAction,
  type PhotoEventProgress,
  type PhotoToCheck,
  type SupabaseConfig,
} from '@src/shared';

import { html, raw, type Html } from './html';
import { can, masthead, notFound, page, type AdminViewer } from './admin-shell';
import { CSRF_COOKIE, CSRF_FIELD, csrfCookie, csrfOk, mintCsrfToken } from './csrf';
import { cookieValue } from './cookies';

/**
 * `/admin/photos/` — the race photos, once the laptop has uploaded them (brief slice 3).
 *
 * ## Three pages and an image route
 *
 *   * **`/admin/photos/`** — how it is going: per running, how many photos, how many are left
 *     to check, whether they are published. The photo-admin publishes from here, and anybody
 *     holding `nn.photo.hide` takes a photo down by its short ID.
 *   * **`/admin/photos/check/`** — the shared check queue (ADR-065): one photo at a time,
 *     large, with the bibs that fit as numbered buttons, held for this checker for ten minutes.
 *     The same keys as the laptop's own check screen, and buttons big enough for a thumb.
 *   * **`/admin/photos/take-down/<photo id>/`** — the confirmation a takedown from the check
 *     page goes through, because it deletes the photo from storage and cannot be undone.
 *   * **`/admin/photos/check/img/<photo id>/<size>.jpg`** — an unpublished photo, served to a
 *     checker and nobody else. The runners' own image route, which serves only published
 *     photos, is slice 4's.
 *
 * ## Who may do what
 *
 * `admin.ts` opens the section on `nn.photo.read`, which both photo roles hold. **Each door
 * inside asks its own permission before it reads anything** — `nn.photo.check` for the queue
 * and the images, `nn.photo.publish` for publishing, `nn.photo.hide` for a takedown — and
 * answers the same 404 as everything else under `/admin/` when it is missing (ADR-066). The
 * database asks the same permission again, which is the enforcement; this is the door being
 * shut in the right order.
 *
 * ## Every form is POST, redirect, GET
 *
 * A decision is a POST that answers 303 back to the check page, so a reload never repeats it.
 * What happened travels as a short code in the query string — `?done=confirm` — and never as
 * anything about a person. A photo's id may travel there, for the Undo button: it names a
 * photo, not a runner.
 *
 * ## No personal data
 *
 * `photos` holds no runner's name or address (brief §3), so nothing here can render one. The
 * one name on these pages is a photographer's credit, which they gave to be shown. Logs carry
 * a function name and an error code, never a bib.
 */

export interface PhotosEnv {
  /** The race photos bucket (ADR-062). Optional because its absence is a state this page
   *  answers rather than one that takes the Worker down. */
  PHOTOS?: R2Bucket;
}

const HERE = '/admin/photos/';
const CHECK = '/admin/photos/check/';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID = /^[A-Za-z0-9]{2,8}-[0-9]{4,}$/;
const EVENT_SLUG = /^[a-z0-9-]{1,64}$/;

export async function handlePhotosSection(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  env: PhotosEnv,
  segments: string[],
  url: URL,
  secure: boolean,
): Promise<Response> {
  const [first, second, third, fourth, ...rest] = segments;

  if (first === undefined) {
    if (request.method === 'GET') return overviewPage(viewer, cfg, url, secure);
    if (request.method === 'POST') return handleOverviewPost(request, viewer, cfg, env);
    return notFound();
  }

  if (first === 'check') {
    // **Gated here, before anything is read**: a photo-admin reaches this file through
    // `nn.photo.read` and holds no `nn.photo.check`, and must get the same 404 as a stranger.
    if (!can(viewer, 'nn.photo.check')) return notFound();

    if (second === undefined) {
      if (request.method === 'GET') return checkPage(viewer, cfg, url, secure);
      if (request.method === 'POST') return handleDecision(request, viewer, cfg);
      return notFound();
    }

    if (
      second === 'img' &&
      third !== undefined &&
      fourth !== undefined &&
      rest.length === 0 &&
      request.method === 'GET'
    ) {
      return adminImage(viewer, cfg, env, third, fourth);
    }

    return notFound();
  }

  if (
    first === 'take-down' &&
    second !== undefined &&
    third === undefined &&
    request.method === 'GET'
  ) {
    // The confirmation reads the photo's short ID through the checker's read, so it needs
    // both: it is the check page's way to a takedown, and a photo-admin uses the form on the
    // overview, which asks for a short ID instead.
    if (!can(viewer, 'nn.photo.hide') || !can(viewer, 'nn.photo.check'))
      return notFound();
    return takeDownConfirmPage(viewer, cfg, second, secure);
  }

  return notFound();
}

// =========================================================================================
// The overview
// =========================================================================================

/** What a publish or a takedown came to, in the volunteer's words. Keyed by the code the
 *  redirect carries, so nothing about a person is ever in the address bar. */
const RESULTS: Record<string, { tone: 'notice' | 'error'; words: string }> = {
  published: {
    tone: 'notice',
    words: 'The photos are published. Runners can see them once their links go out.',
  },
  already_published: { tone: 'notice', words: 'Those photos were already published.' },
  left_to_check: {
    tone: 'error',
    words: 'Nothing was published, because some photos are still waiting to be checked.',
  },
  no_photos: {
    tone: 'error',
    words: 'Nothing was published: there are no photos to show yet.',
  },
  no_such_event: {
    tone: 'error',
    words: 'That race has no photos here, so nothing changed.',
  },
  taken_down: {
    tone: 'notice',
    words:
      'That photo is taken down. It is hidden and its files are deleted from storage.',
  },
  delete_failed: {
    tone: 'error',
    words:
      'That photo is hidden and will not be shown, but its files could not be deleted from storage. Take it down again to finish.',
  },
  no_such_photo: {
    tone: 'error',
    words: 'There is no photo with that ID in this race, so nothing was taken down.',
  },
  invalid_short_id: {
    tone: 'error',
    words:
      'That is not a photo ID. It looks like NN26-0412, and it is under every photo.',
  },
  unavailable: {
    tone: 'error',
    words: 'That could not be done just now. Try again in a moment.',
  },
};

async function overviewPage(
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  url: URL,
  secure: boolean,
): Promise<Response> {
  const client = createUserClient(cfg, viewer.accessToken);
  const progress = await fetchPhotoProgress(client);

  if (progress.status === 'unauthorised') return notFound();

  if (progress.status === 'unavailable') {
    console.error(`photos.progress unavailable — ${progress.error}`);
    return page(
      'Race photos',
      html`${masthead(viewer)}
        <main class="admin-page" id="main">
          <h1>Race photos</h1>
          <p class="admin-error" role="alert">
            The photos could not be read. Try again in a moment.
          </p>
        </main>`,
    );
  }

  const acts = can(viewer, 'nn.photo.publish') || can(viewer, 'nn.photo.hide');
  const token = acts ? mintCsrfToken() : null;
  const result = RESULTS[url.searchParams.get('result') ?? ''] ?? null;
  const left = Number.parseInt(url.searchParams.get('left') ?? '', 10);

  const body = html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Race photos</h1>
      <p>
        The photos the laptop uploaded, and how many are still waiting for somebody to
        check the bib numbers on them.
      </p>
      ${
        result === null
          ? null
          : result.tone === 'error'
            ? html`<p class="admin-error" role="alert">
                ${result.words}
                ${Number.isFinite(left) && left > 0 ? html` ${plural(left, '1 is', `${String(left)} are`)} left.` : null}
              </p>`
            : html`<p class="admin-banner admin-banner-boxed" role="status">
                ${result.words}
              </p>`
      }
      ${
        progress.events.length === 0
          ? html`<p>
              No photos yet. They arrive when the laptop's upload and its SQL file have
              both been run — see the race photos runbook.
            </p>`
          : progress.events.map((event) => eventPanel(viewer, event, token))
      }
      ${can(viewer, 'nn.photo.hide') && token !== null ? takeDownPanel(progress.events, token) : null}
    </main>`;

  return page('Race photos', body, {
    cookies: token === null ? [] : [csrfCookie(token, secure)],
  });
}

function eventPanel(
  viewer: AdminViewer,
  event: PhotoEventProgress,
  token: string | null,
): Html {
  const name = event.name ?? event.slug;
  const headingId = `photos-${event.slug}`;

  return html`<section
    class="admin-panel admin-photos-event"
    aria-labelledby="${headingId}"
  >
    <div class="admin-panel-head">
      <h2 id="${headingId}">${name}</h2>
      <p class="admin-panel-note">
        ${
          event.publishedAt === null
            ? 'Not published yet'
            : html`Published ${formatLondon(event.publishedAt)}`
        }
      </p>
    </div>
    <div class="admin-panel-body">
      <div class="admin-figs">
        ${figure('Photos', event.photos)} ${figure('Left to check', event.leftToCheck)}
        ${figure('Being checked now', event.heldNow)}
        ${figure('Checked on this site', event.checkedHere)}
        ${figure('Could be you only', event.partRead)}
        ${figure('Taken down', event.hidden)}
      </div>
      ${
        can(viewer, 'nn.photo.check') && event.leftToCheck > 0
          ? html`<p class="admin-actions">
              <a class="admin-button admin-button-link" href="${CHECK}">Check photos</a>
            </p>`
          : null
      }
      ${can(viewer, 'nn.photo.publish') && token !== null ? publishBlock(event, token) : null}
    </div>
  </section>`;
}

function figure(label: string, value: number): Html {
  return html`<div class="admin-fig">
    <p class="admin-fig-label">${label}</p>
    <p class="admin-fig-value"><span class="admin-mono">${String(value)}</span></p>
  </div>`;
}

/**
 * Publishing, said plainly when it cannot happen yet.
 *
 * **No button while anything is left to check**, rather than a button the database refuses:
 * decision 11 is that publishing waits, and a control that always fails teaches a volunteer
 * the page cannot be trusted. The refusal is still enforced in `photos.publish()`.
 */
function publishBlock(event: PhotoEventProgress, token: string): Html {
  if (event.publishedAt !== null) return html``;

  if (event.leftToCheck > 0) {
    return html`<p>
      Publishing waits until every unsure photo has been checked —
      ${plural(event.leftToCheck, '1 is', `${String(event.leftToCheck)} are`)} left.
    </p>`;
  }

  if (event.photos === 0) {
    return html`<p>There is nothing to publish yet.</p>`;
  }

  return html`<form method="post" action="${HERE}" class="admin-actions">
    <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
    <input type="hidden" name="action" value="publish" />
    <input type="hidden" name="event" value="${event.slug}" />
    <button type="submit" class="admin-button">Publish the photos</button>
  </form>`;
}

function takeDownPanel(events: PhotoEventProgress[], token: string): Html {
  return html`<section class="admin-panel" aria-labelledby="photos-take-down">
    <div class="admin-panel-head">
      <h2 id="photos-take-down">Take a photo down</h2>
      <p class="admin-panel-note">
        For a runner who asks, or a photo that should not be up
      </p>
    </div>
    <div class="admin-panel-body">
      <p>
        <strong
          >This deletes the photo from storage straight away and cannot be undone.</strong
        >
        A runner who replies to their email quotes the photo ID shown under it.
      </p>
      <form method="post" action="${HERE}" class="admin-photos-take-down">
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
        <input type="hidden" name="action" value="take_down" />
        ${
          events.length === 1
            ? html`<input type="hidden" name="event" value="${events[0]!.slug}" />`
            : html`<div class="admin-field">
                <label for="take-down-event">Race</label>
                <select id="take-down-event" name="event">
                  ${events.map(
                    (event) =>
                      html`<option value="${event.slug}">
                        ${event.name ?? event.slug}
                      </option>`,
                  )}
                </select>
              </div>`
        }
        <div class="admin-field">
          <label for="take-down-id">Photo ID</label>
          <input
            id="take-down-id"
            name="short_id"
            autocomplete="off"
            spellcheck="false"
            required
            aria-describedby="take-down-id-hint"
          />
          <p class="admin-hint" id="take-down-id-hint">Like NN26-0412.</p>
        </div>
        <button type="submit" class="admin-button admin-button-grave">
          Take it down
        </button>
      </form>
    </div>
  </section>`;
}

async function handleOverviewPost(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  env: PhotosEnv,
): Promise<Response> {
  const form = await readForm(request);

  if (
    form === null ||
    !csrfOk(
      cookieValue(request.headers.get('cookie'), CSRF_COOKIE),
      asText(form, CSRF_FIELD),
    )
  ) {
    return notFound();
  }

  const action = asText(form, 'action');
  const event = asText(form, 'event') ?? '';

  if (!EVENT_SLUG.test(event)) return notFound();

  const client = createUserClient(cfg, viewer.accessToken);

  if (action === 'publish') {
    if (!can(viewer, 'nn.photo.publish')) return notFound();

    const outcome = await publishPhotos(client, event);

    switch (outcome.status) {
      case 'ok':
        return seeOther(
          `${HERE}?result=${outcome.already ? 'already_published' : 'published'}`,
        );
      case 'left-to-check':
        return seeOther(`${HERE}?result=left_to_check&left=${String(outcome.left)}`);
      case 'no-photos':
        return seeOther(`${HERE}?result=no_photos`);
      case 'no-such-event':
        return seeOther(`${HERE}?result=no_such_event`);
      case 'unauthorised':
        return notFound();
      case 'unavailable':
        console.error(`photos.publish unavailable — ${outcome.error}`);
        return seeOther(`${HERE}?result=unavailable`);
    }
  }

  if (action === 'take_down') {
    if (!can(viewer, 'nn.photo.hide')) return notFound();

    // The check page's confirmation sends the checker back to the queue afterwards.
    const back = asText(form, 'back') === 'check' ? CHECK : HERE;
    const key = back === CHECK ? 'done' : 'result';
    const shortId = (asText(form, 'short_id') ?? '').trim();

    if (!SHORT_ID.test(shortId)) return seeOther(`${back}?${key}=invalid_short_id`);

    const outcome = await takeDownPhoto(client, event, shortId);

    if (outcome.status === 'unauthorised') return notFound();
    if (outcome.status === 'no-such-photo')
      return seeOther(`${back}?${key}=no_such_photo`);
    if (outcome.status === 'unavailable') {
      console.error(`photos.take_down unavailable — ${outcome.error}`);
      return seeOther(`${back}?${key}=unavailable`);
    }

    const deleted = await deleteCopies(env, outcome.eventSlug, outcome.id);
    return seeOther(`${back}?${key}=${deleted ? 'taken_down' : 'delete_failed'}`);
  }

  return notFound();
}

/**
 * Delete a photo's three copies from the bucket, in one call.
 *
 * **The database is told first and the bucket second**, so a failure here leaves a photo that
 * is hidden — never shown, never served (slice 4 checks `hidden_at`) — with its files still in
 * storage, which is the safe half to be left with. `photos.take_down()` answers the id again
 * for a photo already hidden, so doing it again finishes the job. R2 treats deleting a key
 * that is not there as success, which is what makes the retry harmless.
 */
async function deleteCopies(
  env: PhotosEnv,
  eventSlug: string,
  photoId: string,
): Promise<boolean> {
  if (env.PHOTOS === undefined) {
    console.error('race photos bucket binding PHOTOS is missing');
    return false;
  }

  try {
    await env.PHOTOS.delete(
      PHOTO_SIZES.map((size) => photoObjectKey(eventSlug, photoId, size)),
    );
    return true;
  } catch (cause) {
    console.error(
      `race photos delete failed — ${cause instanceof Error ? cause.name : 'error'}`,
    );
    return false;
  }
}

// =========================================================================================
// The check page
// =========================================================================================

/** What the last decision came to. Keyed by the code the redirect carries. */
const DONE: Record<
  string,
  { tone: 'notice' | 'error'; words: string; undoable: boolean }
> = {
  confirm: { tone: 'notice', words: 'Saved.', undoable: true },
  correct: { tone: 'notice', words: 'Saved with the bib you typed.', undoable: true },
  keep_part: {
    tone: 'notice',
    words: 'Kept as a part read: it shows as “Could be you” to every runner it fits.',
    undoable: true,
  },
  no_bib: { tone: 'notice', words: 'Saved as no bib visible.', undoable: true },
  skip: {
    tone: 'notice',
    words: 'Skipped. It goes back in the queue for somebody else.',
    undoable: false,
  },
  unchanged: {
    tone: 'notice',
    words: 'That was already saved, so nothing changed.',
    undoable: false,
  },
  undone: {
    tone: 'notice',
    words: 'Undone. The photo is back as it was, and it is yours to check again.',
    undoable: false,
  },
  taken_down: {
    tone: 'notice',
    words:
      'That photo is taken down. It is hidden and its files are deleted from storage.',
    undoable: false,
  },
  already_decided: {
    tone: 'error',
    words:
      'Somebody else checked that photo first, so their decision stands and yours was not saved.',
    undoable: false,
  },
  not_waiting: {
    tone: 'error',
    words: 'That photo is not waiting to be checked any more, so nothing changed.',
    undoable: false,
  },
  no_such_photo: {
    tone: 'error',
    words:
      'That photo is not here any more — it may have been taken down — so nothing changed.',
    undoable: false,
  },
  nothing_part_read: {
    tone: 'error',
    words: 'That photo has no part read to keep, so nothing changed.',
    undoable: false,
  },
  bib_required: { tone: 'error', words: 'Type a bib number first.', undoable: false },
  invalid_bib: {
    tone: 'error',
    words:
      'That is not a bib number. Type digits only, as on the vest — several with spaces between them.',
    undoable: false,
  },
  invalid_short_id: { tone: 'error', words: 'That is not a photo ID.', undoable: false },
  delete_failed: {
    tone: 'error',
    words:
      'That photo is hidden and will not be shown, but its files could not be deleted from storage. Take it down again from Race photos to finish.',
    undoable: false,
  },
  nothing_to_undo: {
    tone: 'error',
    words: 'There is nothing to undo on that photo.',
    undoable: false,
  },
  not_yours: {
    tone: 'error',
    words: 'Somebody else made that decision, so only they can undo it.',
    undoable: false,
  },
  changed_since: {
    tone: 'error',
    words: 'That photo has changed since, so it was not undone.',
    undoable: false,
  },
  unavailable: {
    tone: 'error',
    words: 'That could not be saved just now. Try again in a moment.',
    undoable: false,
  },
};

async function checkPage(
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  url: URL,
  secure: boolean,
): Promise<Response> {
  const client = createUserClient(cfg, viewer.accessToken);
  const next = await fetchNextPhoto(client);

  if (next.status === 'unauthorised') return notFound();

  if (next.status === 'unavailable') {
    console.error(`photos.next_photo unavailable — ${next.error}`);
    return page(
      'Check photos',
      html`${masthead(viewer)}
        <main class="admin-page" id="main">
          <h1>Check photos</h1>
          <p class="admin-error" role="alert">
            The next photo could not be read. Try again in a moment.
          </p>
        </main>`,
    );
  }

  const token = mintCsrfToken();
  const done = DONE[url.searchParams.get('done') ?? ''] ?? null;
  const last = url.searchParams.get('last');
  const undo = done?.undoable === true && last !== null && UUID.test(last) ? last : null;

  const body = html`${masthead(viewer)}
    <main class="admin-page admin-photo-check" id="main">
      <h1>Check photos</h1>
      ${
        done === null
          ? null
          : html`<div
              class="${done.tone === 'error' ? 'admin-error' : 'admin-banner admin-banner-boxed'}"
              role="${done.tone === 'error' ? 'alert' : 'status'}"
            >
              <p>${done.words}</p>
              ${undo === null ? null : undoForm(undo, token)}
            </div>`
      }
      ${next.photo === null ? nothingLeft() : photoForm(viewer, next.photo, token)}
    </main>
    ${next.photo === null ? null : keyboard()}`;

  return page('Check photos', body, { cookies: [csrfCookie(token, secure)] });
}

function nothingLeft(): Html {
  return html`<p>
      <strong>Nothing is waiting to be checked.</strong> Every unsure photo has been
      decided, or somebody else has the last ones open.
    </p>
    <p><a href="${HERE}">Back to Race photos</a></p>`;
}

function undoForm(photoId: string, token: string): Html {
  return html`<form method="post" action="${CHECK}" class="admin-photo-undo">
    <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
    <input type="hidden" name="photo" value="${photoId}" />
    <button
      type="submit"
      name="action"
      value="undo"
      class="admin-button admin-button-quiet"
    >
      Undo that
    </button>
  </form>`;
}

/** How sure the laptop was, as a person reads it. */
function readWords(confidence: number | null): string {
  if (confidence === null) return '';
  return `${String(Math.round(confidence * 100))}% sure`;
}

/**
 * One photo, and every way to settle it, in one form.
 *
 * **Every control is a submit button**, so the page works with scripting off and by touch;
 * the keys are an enhancement that presses the same buttons. A bib chosen from the buttons is
 * `pick`, and the box takes one or more typed bibs for a photo with several runners in it or a
 * number the laptop read wrong.
 */
function photoForm(viewer: AdminViewer, photo: PhotoToCheck, token: string): Html {
  const unsure = photo.reads.filter((read) => !read.confirmed);
  const sure = photo.reads.filter((read) => read.confirmed);
  const hasPart = unsure.some((read) => isPartRead(read.bibText));
  const image = (size: string) => `${CHECK}img/${photo.id}/${size}.jpg`;
  const describedBy = 'photo-check-reads';

  return html`<section
    class="admin-photo-check-layout"
    aria-label="Photo ${photo.shortId}"
  >
    <figure class="admin-photo-figure">
      <a href="${image('full')}" class="admin-photo-link">
        <img
          src="${image('medium')}"
          width="${String(photo.width)}"
          height="${String(photo.height)}"
          alt="Photo ${photo.shortId}, taken at ${photo.spot} by ${photo.photographer}"
          class="admin-photo-image"
        />
      </a>
      <figcaption>
        <span class="admin-mono">${photo.shortId}</span> · ${photo.spot} ·
        ${photo.takenAt === null ? 'no time recorded' : formatLondon(photo.takenAt)} ·
        ${photo.photographer}.
        <a href="${image('full')}">Open the full-size photo</a>
      </figcaption>
    </figure>

    <form method="post" action="${CHECK}" class="admin-photo-decide">
      <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
      <input type="hidden" name="photo" value="${photo.id}" />

      <div id="${describedBy}" class="admin-photo-reads">
        <p>
          <strong>What the laptop read:</strong>
          ${
            unsure.length === 0
              ? 'nothing it was unsure of.'
              : unsure.map(
                  (read, index) =>
                    html`${index === 0 ? '' : ', '}<span class="admin-mono"
                        >${read.bibText}</span
                      >
                      ${
                        isPartRead(read.bibText)
                          ? '(part read)'
                          : read.confidence === null
                            ? ''
                            : `(${readWords(read.confidence)})`
                      }`,
                )
          }
        </p>
        ${
          sure.length === 0
            ? null
            : html`<p>
                <strong>Already tagged:</strong>
                ${sure.map(
                  (read, index) =>
                    html`${index === 0 ? '' : ', '}<span class="admin-mono"
                        >${read.bibText}</span
                      >`,
                )}
              </p>`
        }
        <p class="admin-hint">Held for you for ten minutes.</p>
      </div>

      <fieldset class="admin-photo-choices" aria-describedby="${describedBy}">
        <legend>Which bib is it?</legend>
        ${
          photo.candidates.length === 0
            ? html`<p class="admin-hint">
                No bib on the race's list fits what was read. Type the number below.
              </p>`
            : html`<div class="admin-photo-picks">
                ${photo.candidates.map((bib, index) => {
                  const key = index < 9 ? String(index + 1) : null;
                  return html`<button
                    type="submit"
                    name="pick"
                    value="${bib}"
                    class="admin-button admin-photo-pick"
                    ${key === null ? '' : raw(` data-key="${key}"`)}
                    ${index === 0 ? raw(' data-enter') : ''}
                  >
                    It is <span class="admin-mono">${bib}</span>
                    ${key === null ? null : html`<kbd>${key}</kbd>`}
                  </button>`;
                })}
              </div>`
        }
        <div class="admin-field admin-photo-typed">
          <label for="photo-typed">A different bib</label>
          <input
            id="photo-typed"
            name="typed"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            data-correction
            aria-describedby="photo-typed-hint"
          />
          <p class="admin-hint" id="photo-typed-hint">
            Digits only, as on the vest. More than one runner? Put a space between them.
          </p>
          <button
            type="submit"
            name="action"
            value="correct"
            class="admin-button admin-button-quiet"
          >
            Save the bib I typed
          </button>
        </div>
      </fieldset>

      <div class="admin-photo-others">
        ${
          hasPart
            ? html`<button
                type="submit"
                name="action"
                value="keep_part"
                class="admin-button admin-button-quiet"
                data-key="U"
              >
                Keep it part read <kbd>U</kbd>
              </button>`
            : null
        }
        <button
          type="submit"
          name="action"
          value="no_bib"
          class="admin-button admin-button-quiet"
          data-key="N"
        >
          ${sure.length === 0 ? 'No bib visible' : 'No other bib visible'} <kbd>N</kbd>
        </button>
        <button
          type="submit"
          name="action"
          value="skip"
          class="admin-button admin-button-quiet"
          data-key="S"
        >
          Skip <kbd>S</kbd>
        </button>
        ${
          can(viewer, 'nn.photo.hide')
            ? html`<a
                href="${HERE}take-down/${photo.id}/"
                class="admin-button admin-button-grave admin-button-link"
                data-key="H"
              >
                Take this photo down <kbd>H</kbd>
              </a>`
            : null
        }
      </div>
    </form>
  </section>`;
}

/**
 * The keys, as on the laptop's check screen (`tools/photos/racephotos/review/static/review.js`,
 * which this follows line for line): a control marked `data-key="N"` is pressed by that key,
 * Enter presses the first bib, and a digit with no button of its own goes into the box.
 * Nothing happens while somebody is typing, or while a button or link has focus and they press
 * Enter or Space, because the browser is already doing the right thing then.
 *
 * Inline, like the people page's, because nothing bundles a page the Worker builds.
 */
function keyboard(): Html {
  return html`<script>
    ${raw(KEYBOARD)};
  </script>`;
}

const KEYBOARD = `
(function () {
  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

    var target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (
      (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      return;
    }

    var control =
      event.key === 'Enter'
        ? document.querySelector('[data-enter]')
        : document.querySelector(
            '[data-key="' + CSS.escape(event.key.length === 1 ? event.key.toUpperCase() : event.key) + '"]'
          );

    if (control instanceof HTMLButtonElement || control instanceof HTMLAnchorElement) {
      event.preventDefault();
      control.click();
      return;
    }

    var box = document.querySelector('[data-correction]');
    if (/^[0-9]$/.test(event.key) && box instanceof HTMLInputElement) {
      event.preventDefault();
      box.focus();
      box.value += event.key;
    }
  });
})()`;

async function handleDecision(
  request: Request,
  viewer: AdminViewer,
  cfg: SupabaseConfig,
): Promise<Response> {
  const form = await readForm(request);

  if (
    form === null ||
    !csrfOk(
      cookieValue(request.headers.get('cookie'), CSRF_COOKIE),
      asText(form, CSRF_FIELD),
    )
  ) {
    return notFound();
  }

  const photo = asText(form, 'photo');
  if (photo === null || !UUID.test(photo)) return notFound();

  const client = createUserClient(cfg, viewer.accessToken);
  const action = asText(form, 'action');

  if (action === 'undo') {
    const outcome = await undoPhotoDecision(client, photo);

    if (outcome.status === 'unauthorised') return notFound();
    if (outcome.status === 'unavailable') {
      console.error(`photos.undo_decision unavailable — ${outcome.error}`);
      return seeOther(`${CHECK}?done=unavailable`);
    }
    return seeOther(
      `${CHECK}?done=${outcome.status === 'ok' ? 'undone' : outcome.reason}`,
    );
  }

  // A bib chosen from the buttons wins over anything else in the form: it is the button that
  // was pressed, and the browser sends only the pressed button's own name and value.
  const pick = asText(form, 'pick');
  let decision: DecisionAction;
  let bibs: string[] | null = null;

  if (pick !== null) {
    decision = 'confirm';
    bibs = [pick];
  } else if (action === 'correct') {
    const typed = parseTypedBibs(asText(form, 'typed') ?? '');
    if (typed === null) return seeOther(`${CHECK}?done=invalid_bib`);
    if (typed.length === 0) return seeOther(`${CHECK}?done=bib_required`);
    decision = 'correct';
    bibs = typed;
  } else if (action === 'keep_part' || action === 'no_bib' || action === 'skip') {
    decision = action;
  } else {
    return notFound();
  }

  const outcome = await recordPhotoDecision(client, photo, decision, bibs);

  switch (outcome.status) {
    case 'ok':
      // The photo's id rides along only for a decision that can be undone; a skip settles
      // nothing, so there is nothing for an Undo button to put back.
      if (outcome.unchanged) return seeOther(`${CHECK}?done=unchanged`);
      if (outcome.action === 'skip') return seeOther(`${CHECK}?done=skip`);
      return seeOther(`${CHECK}?done=${outcome.action}&last=${photo}`);
    case 'refused':
      return seeOther(`${CHECK}?done=${outcome.reason}`);
    case 'unauthorised':
      return notFound();
    case 'unavailable':
      console.error(`photos.decide unavailable — ${outcome.error}`);
      return seeOther(`${CHECK}?done=unavailable`);
  }
}

// =========================================================================================
// The takedown confirmation, from the check page
// =========================================================================================

async function takeDownConfirmPage(
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  photoId: string,
  secure: boolean,
): Promise<Response> {
  if (!UUID.test(photoId)) return notFound();

  const client = createUserClient(cfg, viewer.accessToken);
  const found = await photoForAdminImage(client, photoId);

  if (found.status === 'unauthorised' || found.status === 'missing') return notFound();
  if (found.status === 'unavailable') {
    console.error(`photos.photo_for_admin_image unavailable — ${found.error}`);
    return seeOther(`${CHECK}?done=unavailable`);
  }

  const token = mintCsrfToken();
  const body = html`${masthead(viewer)}
    <main class="admin-page" id="main">
      <h1>Take photo <span class="admin-mono">${found.shortId}</span> down?</h1>
      <p>
        <strong>This deletes it from storage straight away and cannot be undone.</strong>
        Nobody will see it again, on this page or on a runner's.
      </p>
      <img
        src="${CHECK}img/${photoId}/thumb.jpg"
        alt="Photo ${found.shortId}"
        class="admin-photo-thumb"
      />
      <form method="post" action="${HERE}" class="admin-actions">
        <input type="hidden" name="${raw(CSRF_FIELD)}" value="${token}" />
        <input type="hidden" name="action" value="take_down" />
        <input type="hidden" name="event" value="${found.eventSlug}" />
        <input type="hidden" name="short_id" value="${found.shortId}" />
        <input type="hidden" name="back" value="check" />
        <button type="submit" class="admin-button admin-button-grave">
          Yes, take it down
        </button>
        <a href="${CHECK}" class="admin-button admin-button-quiet admin-button-link">
          No, back to checking
        </a>
      </form>
    </main>`;

  return page(`Take ${found.shortId} down?`, body, {
    cookies: [csrfCookie(token, secure)],
  });
}

// =========================================================================================
// An unpublished image, for a checker
// =========================================================================================

/**
 * One copy of one photo, from the bucket, to somebody holding `nn.photo.check`.
 *
 * **`private, no-store`**, like every page under `/admin/`: an unpublished photo must not sit
 * in a shared cache or a browser's, where somebody without the role could find it. Nothing for
 * a photo taken down, whoever asks — `photo_for_admin_image()` refuses it, and its files are
 * gone anyway.
 */
async function adminImage(
  viewer: AdminViewer,
  cfg: SupabaseConfig,
  env: PhotosEnv,
  photoId: string,
  file: string,
): Promise<Response> {
  const match = /^(.+)\.jpg$/.exec(file);
  const size = match?.[1] ?? '';

  if (!UUID.test(photoId) || !isPhotoSize(size)) return notFound();

  const client = createUserClient(cfg, viewer.accessToken);
  const found = await photoForAdminImage(client, photoId);

  if (found.status !== 'ok') {
    if (found.status === 'unavailable') {
      console.error(`photos.photo_for_admin_image unavailable — ${found.error}`);
    }
    return notFound();
  }

  if (env.PHOTOS === undefined) {
    console.error('race photos bucket binding PHOTOS is missing');
    return notFound();
  }

  const object = await env.PHOTOS.get(photoObjectKey(found.eventSlug, photoId, size));
  if (object === null) return notFound();

  return new Response(object.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      etag: object.httpEtag,
    },
  });
}

// =========================================================================================
// Small helpers
// =========================================================================================

/** 303 rather than rendering here, so a reload does not repeat the act. */
function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function asText(form: FormData, field: string): string | null {
  const value = form.get(field);
  return typeof value === 'string' ? value : null;
}
