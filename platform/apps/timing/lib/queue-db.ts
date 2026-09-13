/**
 * Where the queue lives between one page load and the next: IndexedDB, on the marshal's phone.
 *
 * Issue [#203](https://github.com/southville-running-club/src-website/issues/203). The rules
 * are next door in `queue-state.ts`, which is pure and therefore tested; this file is the
 * storage and nothing else, deliberately thin, because everything in it needs a browser.
 *
 * ## Why IndexedDB rather than `localStorage`
 *
 * `localStorage` is synchronous and string-only, so every write blocks the main thread while
 * the whole queue is re-serialised — on the one screen where a tap must be instant. It is also
 * the storage a browser is most willing to evict. IndexedDB is what the old application used
 * and the reason survives.
 *
 * ⚠️ **The queue is keyed to the origin, not to the session** — which is the property
 * [#244](https://github.com/southville-running-club/src-website/issues/244) depends on. A
 * marshal offline for more than thirty minutes comes back signed out; the cards are still
 * here, they sign in again, and the drain empties them. Nothing in this file reads a cookie.
 *
 * ## ⚠️ Every function answers rather than throwing, and that is not defensiveness
 *
 * IndexedDB is **absent or refused** in more real situations than it is fashionable to admit:
 * a browser set to block site data, a private window in some engines, a phone out of quota.
 * On this screen the answer to that cannot be a crash — a marshal whose storage is unavailable
 * still has to be able to record crossings for the next two hours. So `openQueue()` answers
 * `null`, the screen keeps its queue in memory, and it **says so on the page**: what is lost
 * is surviving a reload, and the marshal is the only one who can decide not to reload.
 */

import type { QueueCard } from './queue-state';

const DB_NAME = 'src-timing-queue';
const DB_VERSION = 1;
const STORE = 'cards';

/** Cards are per-race, and one phone can be rostered on two. */
const EVENT_INDEX = 'eventSlug';

function promise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * The database, or `null` when this browser will not give us one.
 *
 * ⚠️ **`onblocked` is not handled, and it cannot happen here.** It fires when another tab
 * holds an older version open across an upgrade, and there has only ever been version 1. The
 * day that changes, this is where the second tab has to be dealt with.
 */
export async function openQueue(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }

  try {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex(EVENT_INDEX, 'eventSlug', { unique: false });
      }
    };

    return await promise(request);
  } catch {
    // A browser that refuses storage outright. The caller keeps the queue in memory and tells
    // the marshal that a reload will lose it.
    return null;
  }
}

/** Everything recorded for one race, in no particular order — `sortCards` decides that. */
export async function allCards(db: IDBDatabase, eventSlug: string): Promise<QueueCard[]> {
  const store = db.transaction(STORE, 'readonly').objectStore(STORE);
  const rows = await promise(store.index(EVENT_INDEX).getAll(eventSlug));
  return rows as QueueCard[];
}

/**
 * Write one card, replacing whatever was there.
 *
 * ⚠️ **Awaited by every caller, and the tap is the reason.** The moment a card exists in this
 * store is the moment the crossing has survived the page being closed; a screen that rendered
 * the card and wrote it later would have a window — short, and on a phone in a pocket — where
 * the marshal has seen a tap that no longer exists.
 */
export async function putCard(db: IDBDatabase, card: QueueCard): Promise<void> {
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  await promise(store.put(card));
}

/** Retire cards the database has: they landed, and the queue is done with them. */
export async function deleteCards(
  db: IDBDatabase,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  await Promise.all(ids.map((id) => promise(store.delete(id))));
}
