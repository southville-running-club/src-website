/*
 * The service worker for `/timing` — issue #203.
 *
 * ## What it is for, which is narrower than "offline support"
 *
 * The queue already survives being offline: crossings live in IndexedDB and drain when the
 * signal comes back, and none of that needs a service worker. **What needs one is the page
 * itself.** A marshal whose phone reloads the tab — because they locked it, because the
 * browser reclaimed memory, because they pressed the wrong thing — gets the browser's offline
 * error page and no way back to the screen, with two hours of a race left to run. Their
 * crossings are safe and unreachable, which is not meaningfully better than losing them.
 *
 * So this file has one job: **serve the marshal screen and its assets from cache when the
 * network cannot.** Nothing else under `/timing` is cached, because nothing else is used
 * somewhere without signal.
 *
 * ## ⚠️ Two addresses are never cached and never intercepted
 *
 * `…/sync` is a POST, which the Cache API will not store anyway. `…/known` is a GET and would
 * be, and serving a stale one is the worst thing this file could do: the screen reconciles
 * against it, so a cached answer from ten minutes ago would retire cards whose crossings never
 * landed, and flag no duplicate for the rest of the morning. Both are passed straight through,
 * explicitly, so that stays true if the fetch rule below is ever widened.
 *
 * ## ⚠️ The old application's service worker is on a different origin, and this cannot evict it
 *
 * `bindalshah/src-race-timing` runs on Vercel under its own hostname. A registration is scoped
 * to an origin, so nothing here can reach it — a marshal who has the old app on their home
 * screen keeps the old app, indefinitely, and will go on being served it by its own service
 * worker even after the project is decommissioned. **That is a runbook problem rather than a
 * code one** and it belongs to #256 and #208: every marshal replaces their bookmark, and the
 * old origin is what has to stop answering. #203 says to rehearse the upgrade path rather than
 * assume it, and this comment is the honest half of that — the rehearsal is #207's.
 *
 * ## A cached page can outlive the permission that opened it
 *
 * A navigation served from this cache is HTML a marshal was admitted to earlier. Somebody
 * taken off a roster mid-race could therefore still see the screen on a reload with no signal.
 * That is deliberate and it is the safe direction: the cached page can *show* what is already
 * on this phone and cannot *send* anything — every sync goes to the network, the door refuses
 * it, and the screen says so. The alternative — a blank page for somebody still standing on a
 * course — loses crossings.
 *
 * **Plain JavaScript, in `public/`, deliberately.** It is served at `/timing/sw.js`, which is
 * what gives it the `/timing/` scope with no `Service-Worker-Allowed` header; it is not part
 * of the Next bundle and must not be, because a hashed filename cannot be registered by name.
 */

// ⚠️ Bump this when the caching rules below change. `activate` deletes every cache that is not
// this one, which is what stops an old rule's entries outliving it.
const CACHE = 'src-timing-v1';

/** Only ever the capture screen. Everything else under `/timing` has a network. */
const MARSHAL_PATH = '/timing/marshal/';

/** Hashed, immutable, and what the screen cannot render without. */
const STATIC_PREFIX = '/timing/_next/static/';

self.addEventListener('install', (event) => {
  // Nothing is precached: the screen's asset names are build hashes this file cannot know, and
  // a precache list that goes stale is worse than none. The first visit with a network is what
  // fills the cache, and a marshal opens the page at the race HQ before walking to their point
  // — which is the sequence the runbook already tells them.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      // Take over open tabs now rather than at the next reload. On this screen the next reload
      // may be the one that happens with no signal.
      await self.clients.claim();
    })(),
  );
});

/** Put a copy away, and never let a cache write break the response it copied. */
async function remember(request, response) {
  if (!response || !response.ok) {
    return;
  }

  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch {
    // Quota, or a browser refusing storage. The response is already on its way to the page.
  }
}

/** Network first, cache second. For the page: fresh whenever there is signal. */
async function networkThenCache(request) {
  try {
    const response = await fetch(request);
    await remember(request, response);
    return response;
  } catch (cause) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    throw cause;
  }
}

/** Cache first. For hashed assets, whose contents cannot change under their own name. */
async function cacheThenNetwork(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  await remember(request, response);
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET, only this origin. A POST is the sync, and a cross-origin request is the club's
  // own Worker answering `/account/keep-alive/` — neither is this file's business.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // ⚠️ Never the reconcile read. See the header — a stale one retires cards that never landed.
  if (url.pathname.startsWith(MARSHAL_PATH) && url.pathname.endsWith('/known')) {
    return;
  }

  if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(cacheThenNetwork(request));
    return;
  }

  if (request.mode === 'navigate' && url.pathname.startsWith(MARSHAL_PATH)) {
    event.respondWith(networkThenCache(request));
  }
});
