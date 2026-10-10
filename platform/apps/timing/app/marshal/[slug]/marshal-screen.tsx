'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatLondonClock } from '@src/shared';
import {
  checkAnomaly,
  formatAnomalyMessage,
  type EventFormat,
} from '@src/shared/timing/anomaly';
import { allCards, deleteCards, openQueue, putCard } from '../../../lib/queue-db';
import {
  atRetryCap,
  beginSync,
  confirmBib,
  newCard,
  reconcile,
  sortCards,
  syncFailed,
  syncWaiting,
  validateBib,
  type KnownCrossing,
  type QueueCard,
} from '../../../lib/queue-state';
import {
  refusalWording,
  SYNC_DOOR_REFUSED,
  SYNC_MANUAL_REVIEW,
  SYNC_UNAVAILABLE,
} from '../../../lib/sync-outcomes';

/**
 * The capture screen — issue [#203](https://github.com/southville-running-club/src-website/issues/203).
 *
 * ⚠️ **The single most important surface in this application, and the one where the rewrite
 * has least licence to improve anything.** ADR-034 makes `bindalshah/src-race-timing` the
 * specification; every behaviour below is that application's, and the places this file differs
 * are marked and argued rather than tidied.
 *
 * ## The queue model, which is the decision everything else follows from
 *
 * **A full-width button timestamps immediately and pushes a card into a queue; the bib is
 * typed afterwards.** Not bib-first. At the line the scarce resource is the moment, not the
 * marshal's attention: a runner goes past once, and a screen that asks for a number before it
 * will record a time has put a text field between a person and an event that is already over.
 *
 * **An anomaly flags and never blocks.** A duplicate bib, or a leg-2 crossing with no handover
 * recorded, marks the card and says why — and Confirm is still the button. The admin resolves
 * it afterwards, when there is time to be right.
 *
 * ## Why this is a client component when nothing else here is
 *
 * ⚠️ **There is no version of an offline queue that works with scripting off**, so the
 * `no-javascript` argument that makes every other write on this platform a plain form does not
 * reach this screen. What it does reach is the *fallback*: `page.tsx` renders a sentence on the
 * server saying the screen needs JavaScript and what to do instead, and this component renders
 * that same sentence until it has mounted. It is the real content of the page until then — not
 * a spinner, and not hidden.
 *
 * ## What lives elsewhere, and why
 *
 * The state machine is `lib/queue-state.ts`, pure and unit-tested, because the rules a race
 * depends on must be assertable without a browser. The storage is `lib/queue-db.ts`. The
 * wording for a failure is `lib/sync-outcomes.ts`, so that **nothing the database says is ever
 * rendered** — the old application put a `PostgrestError` on the card and one of them read
 * `[object Object]`, which is the defect #203 says to fix on the way past.
 */

/** The drain's period, and the retry the cap is counted in. */
const DRAIN_MS = 30_000;

/** How many crossings one request carries. The route refuses more — see its header. */
const MAX_BATCH = 20;

/** #244: the keep-alive's period, and the window that counts as *active*. */
const KEEP_ALIVE_MS = 5 * 60_000;
const ACTIVE_WINDOW_MS = 25 * 60_000;

/**
 * A client-generated UUID, which is `timing.crossings.id`.
 *
 * `crypto.randomUUID()` needs a secure context — https, or localhost, which is every place
 * this screen legitimately runs. The fallback is not defensiveness for its own sake: a marshal
 * whose browser would not give us one has to be able to capture anyway, and a v4 built from
 * `getRandomValues` is the same 122 bits. A card with no id could never be sent.
 */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What one sync answered about one card. The route's shape, narrowed. */
type SyncOutcome =
  | { id: string; state: 'ok' }
  | { id: string; state: 'refused'; reason: string }
  | { id: string; state: 'unavailable' };

export function MarshalScreen({
  slug,
  format,
  raceName,
  marshalName,
  when,
  menuLinks = [],
  children,
}: {
  slug: string;
  /** The race's own, from the database. Bibs mean different things on a relay and a solo. */
  format: EventFormat;
  /** The race's name, for the status bar. */
  raceName: string;
  /** Who is signed in, for the status bar and its menu; `null` when it could not be read. */
  marshalName: string | null;
  /** Where the race has got to — scheduled, started or finished — in one sentence. */
  when: string;
  /**
   * The race's other tabs for this person — Home and Roster for a marshal — offered in the ⋯
   * menu, because timing mode keeps the tab bar above the screen, out of view.
   */
  menuLinks?: readonly { label: string; href: string }[];
  /** What this element is until it has mounted, and with scripting off. Never a placeholder. */
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [known, setKnown] = useState<KnownCrossing[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [doorRefused, setDoorRefused] = useState(false);
  const [storageLost, setStorageLost] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  // Assumed online until the browser says otherwise — the server render has no way to know,
  // and it is replaced on mount by what `navigator.onLine` says.
  const [online, setOnline] = useState(true);

  /**
   * ⚠️ **Refs rather than state for these three, deliberately.** The drain is called from an
   * interval, from an `online` listener and from a confirm, and each needs the *current*
   * database handle and the *current* cards — a closure over state would drain whatever was
   * true when the interval was installed. `cardsRef` is written on every `setCards` so the two
   * cannot drift.
   */
  const dbRef = useRef<IDBDatabase | null>(null);
  const cardsRef = useRef<QueueCard[]>([]);
  const drainingRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

  /** One place that writes both, so the ref can never be a render behind. */
  const commit = useCallback((next: QueueCard[]) => {
    cardsRef.current = next;
    setCards(next);
  }, []);

  const persist = useCallback(async (card: QueueCard) => {
    const db = dbRef.current;
    if (db === null) {
      return;
    }

    try {
      await putCard(db, card);
    } catch {
      // The card is still in memory and still on the screen. What has been lost is surviving a
      // reload, which is exactly what the banner below says.
      setStorageLost(true);
    }
  }, []);

  /**
   * Read back what this race already has: the ids, for the reload reconcile, and the bibs and
   * times, for cross-device duplicate detection.
   *
   * Answers `null` when it could not be read — **never an empty list**, because an empty list
   * is a claim that this race has had no crossings and a reconcile against it would retire
   * cards that never landed.
   */
  const readKnown = useCallback(async (): Promise<KnownCrossing[] | null> => {
    try {
      const response = await fetch(`/timing/marshal/${encodeURIComponent(slug)}/known`, {
        // Same origin, and the cookie is the whole authorisation. The browser never holds the
        // access token — #244.
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });

      if (response.status === 404) {
        // The door, refusing. See `SYNC_DOOR_REFUSED` — this is a session or a roster, and the
        // screen cannot tell which.
        setDoorRefused(true);
        return null;
      }

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as { crossings?: unknown };
      setDoorRefused(false);
      return Array.isArray(body.crossings) ? (body.crossings as KnownCrossing[]) : [];
    } catch {
      return null;
    }
  }, [slug]);

  /**
   * Send what is queued.
   *
   * ⚠️ **`force` is the manual Retry, and it is the only thing that gets past the cap.** The
   * counter is never reset — a card that has failed ten times keeps its ten — so a marshal can
   * press Retry as often as they like without the automatic drain quietly picking the card up
   * again afterwards. `RETRY_CAP` stays the thing that turns a card nobody can send into a card
   * somebody is told about.
   */
  const drain = useCallback(
    async (force?: string) => {
      if (drainingRef.current) {
        return;
      }

      const sendable = cardsRef.current.filter(
        (card) =>
          card.bib !== null &&
          (card.state === 'queued' ||
            (card.state === 'failed' && (!atRetryCap(card) || card.id === force))),
      );

      if (sendable.length === 0) {
        return;
      }

      drainingRef.current = true;
      try {
        const batch = sendable.slice(0, MAX_BATCH);
        const inFlight = new Set(batch.map((c) => c.id));

        const marked = cardsRef.current.map((card) =>
          inFlight.has(card.id) ? beginSync(card) : card,
        );
        commit(marked);
        await Promise.all(
          marked.filter((card) => inFlight.has(card.id)).map((card) => persist(card)),
        );

        let outcomes: SyncOutcome[];
        try {
          const response = await fetch(
            `/timing/marshal/${encodeURIComponent(slug)}/sync`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                crossings: batch.map((card) => ({
                  id: card.id,
                  bib: card.bib,
                  capturedAt: card.capturedAt,
                  anomalyFlag: card.anomalyFlag,
                  anomalyReason: card.anomalyReason,
                })),
              }),
            },
          );

          if (response.status === 404) {
            // ⚠️ **The door refusing, and it is not a card failure.** `middleware.ts` rewrites a
            // refused request to an address that matches no route, so this is what a lapsed
            // session and an un-rostered marshal both look like. The cards go back to `queued`
            // — nothing about them is wrong — and the screen says so once, at the top, rather
            // than on twenty cards.
            setDoorRefused(true);
            const back = cardsRef.current.map((card) =>
              inFlight.has(card.id) ? { ...card, state: 'queued' as const } : card,
            );
            commit(back);
            await Promise.all(
              back.filter((card) => inFlight.has(card.id)).map((card) => persist(card)),
            );
            return;
          }

          setDoorRefused(false);

          if (!response.ok) {
            // ⚠️ **A 5xx stays `unavailable` and a 4xx becomes `refused`, and the difference is
            // not cosmetic.** An outage is retried on the drain and reads as "no signal"; a
            // refusal is a card somebody has to do something about. The first version of this
            // put club wording in `reason` and it was then passed through `refusalWording()` a
            // second time on the way to the card, which does not recognise its own output — so
            // an outage rendered as the generic refusal sentence.
            outcomes =
              response.status >= 500
                ? batch.map((card) => ({ id: card.id, state: 'unavailable' as const }))
                : batch.map((card) => ({
                    id: card.id,
                    state: 'refused' as const,
                    reason: 'refused',
                  }));
          } else {
            const body = (await response.json()) as { results?: SyncOutcome[] };
            outcomes = Array.isArray(body.results) ? body.results : [];
          }
        } catch {
          // No network at all. The ordinary case on a course, and the card says so.
          outcomes = batch.map((card) => ({
            id: card.id,
            state: 'unavailable' as const,
          }));
        }

        const byId = new Map(outcomes.map((o) => [o.id, o]));
        const landed: string[] = [];

        const next = cardsRef.current.flatMap((card) => {
          const outcome = byId.get(card.id);
          if (outcome === undefined) {
            return [card];
          }

          if (outcome.state === 'ok') {
            landed.push(card.id);
            return [];
          }

          // ⚠️ **The database's `reason` selects a sentence and is never itself one.** Every
          // path into this line carries a machine-readable reason, which is what
          // `lib/sync-outcomes.ts` is a table of — see its header for the `[object Object]`
          // this replaces.
          // ⚠️ **No signal is waiting, not failing.** It never counts towards `RETRY_CAP`, so a
          // long signal gap cannot stop crossings sending by themselves — `lib/queue-state.ts`.
          return [
            outcome.state === 'unavailable'
              ? syncWaiting(card, SYNC_UNAVAILABLE)
              : syncFailed(card, refusalWording(outcome.reason)),
          ];
        });

        commit(next);
        await Promise.all(
          next.filter((card) => byId.has(card.id)).map((card) => persist(card)),
        );

        if (landed.length > 0) {
          lastActivityRef.current = Date.now();
          const db = dbRef.current;
          if (db !== null) {
            try {
              await deleteCards(db, landed);
            } catch {
              setStorageLost(true);
            }
          }

          // What just landed is a duplicate for the next bib typed on this phone, and the read
          // is what brings other phones' crossings in too.
          const fresh = await readKnown();
          if (fresh !== null) {
            setKnown(fresh);
          }
        }
      } finally {
        drainingRef.current = false;
      }
    },
    [commit, persist, readKnown, slug],
  );

  /**
   * Mount: open the store, read what is persisted, reconcile it against the database, and
   * register the service worker.
   *
   * ⚠️ **The reconcile is the reason a reload is safe.** A card left `syncing` when the page
   * went away had its request sent and its answer never seen. Reading the ids back settles it
   * outright: present, and the card is retired; absent, and it goes back in the queue for an
   * idempotent retry. Guessing either way loses something — a crossing on the screen for ever,
   * or one that vanished without being recorded.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const db = await openQueue();
      if (cancelled) {
        return;
      }

      dbRef.current = db;
      if (db === null) {
        setStorageLost(true);
      }

      let persisted: QueueCard[] = [];
      if (db !== null) {
        try {
          persisted = await allCards(db, slug);
        } catch {
          setStorageLost(true);
        }
      }

      const fresh = await readKnown();
      if (cancelled) {
        return;
      }

      if (fresh === null) {
        // ⚠️ **Nothing is retired when the read failed.** A card left `syncing` is put back in
        // the queue and sent again, which is safe because the insert is idempotent; retiring
        // one on a guess is not.
        commit(
          sortCards(
            persisted.map((card) =>
              card.state === 'syncing' ? { ...card, state: 'queued' as const } : card,
            ),
          ),
        );
      } else {
        setKnown(fresh);
        const { retire, keep } = reconcile(persisted, new Set(fresh.map((c) => c.id)));
        commit(sortCards(keep));

        if (db !== null && retire.length > 0) {
          try {
            await deleteCards(db, retire);
          } catch {
            setStorageLost(true);
          }
        }
      }

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [commit, readKnown, slug]);

  /**
   * The service worker, registered from here rather than from the layout.
   *
   * ⚠️ **It exists for this screen and is registered by this screen.** `public/sw.js` caches
   * the marshal page and its assets so that a reload with no signal does not strand somebody
   * on a course; no other page under `/timing` is used anywhere without a network, and a
   * registration installed by the events hub would be a cache nobody asked for on a laptop in
   * a kitchen. A failure is silent and harmless: the queue does not need it.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await navigator.serviceWorker.register('/timing/sw.js', { scope: '/timing/' });
        const registration = await navigator.serviceWorker.ready;
        const worker = registration.active;
        if (worker === null || cancelled) {
          return;
        }

        // ⚠️ **What the page is made of, asked for by name.** A worker registered on *this*
        // load did not intercept the navigation that carried it, so nothing is cached and a
        // reload with no signal would fail exactly as it did before — and the reload that
        // matters happens on a course, not at the race HQ. The chunk names are build hashes
        // this code cannot know, so they are read back off the resource timeline rather than
        // listed.
        const assets = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.startsWith(`${location.origin}/timing/_next/static/`));

        const warmed = await new Promise<boolean>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event: MessageEvent) =>
            resolve((event.data as { ok?: boolean })?.ok === true);
          worker.postMessage(
            { type: 'warm', urls: [location.href, ...new Set(assets)] },
            [channel.port2],
          );
        });

        if (!cancelled) {
          setOfflineReady(warmed);
        }
      } catch {
        // An unsupported browser, or a context that will not allow one. The screen works; what
        // is lost is surviving a reload without signal, and the line on the page says so
        // rather than leaving a marshal to find out on a course.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /** The thirty-second drain, and an immediate one the moment the signal comes back. */
  useEffect(() => {
    if (!ready) {
      return;
    }

    const id = window.setInterval(() => {
      void drain();
    }, DRAIN_MS);
    const onOnline = () => void drain();
    window.addEventListener('online', onOnline);

    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
    };
  }, [drain, ready]);

  /**
   * The Online / Offline pill, from the browser's own two events. ⚠️ **It says whether this
   * phone has a network, not whether the club's site is reachable** — a phone on a captive
   * portal says "online" — so it is a hint, and the queue's own sync states are the truth.
   */
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  /**
   * **Timing mode — the screen fills the phone and nothing scrolls** (10 October 2026).
   *
   * The race's tab bar is still rendered, above the screen: `<main>` is exactly the viewport's
   * height, so once the page is scrolled to it the bar is out of view and the screen is the
   * whole phone. Scrolling up brings the bar back, and the same links are in the ⋯ menu. This is
   * done once, when the screen mounts; nothing re-scrolls a marshal who has scrolled up on
   * purpose.
   */
  useEffect(() => {
    if (!ready) {
      return;
    }
    document.getElementById('main')?.scrollIntoView({ block: 'start' });
  }, [ready]);

  /**
   * **Keep the screen awake while this page is open and visible.** A phone that dims and locks
   * between runners costs a marshal the moment, which is the one thing this screen exists to
   * catch. The browser drops the lock whenever the page is hidden, so it is asked for again each
   * time the page comes back. A phone that refuses, or a browser with no Wake Lock API, simply
   * behaves as before — nothing depends on it.
   */
  useEffect(() => {
    if (!ready || !('wakeLock' in navigator)) {
      return;
    }

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const take = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) {
            void sentinel.release();
          } else {
            lock = sentinel;
          }
        })
        .catch(() => {
          // Low battery, a power-saving mode, or a browser that says no: the screen dims as it
          // always did.
        });
    };

    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, [ready]);

  /**
   * **A drain the moment the phone is unlocked or the tab comes back**, as well as on the
   * thirty-second clock and the `online` event. A phone in a pocket with no signal does not
   * always fire `online` when it finds one — iOS in particular — and a marshal who unlocks it to
   * look should see the queue start moving then rather than up to thirty seconds later.
   */
  useEffect(() => {
    if (!ready) {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void drain();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [drain, ready]);

  /**
   * #244's keep-alive: `/account/keep-alive/` on the club's own Worker, which is the same
   * hostname, every five minutes **while this page is visible and somebody has done something
   * in the last twenty-five**.
   *
   * ⚠️ **Both conditions are the decision rather than caution.** ADR-019's idle window is
   * thirty minutes and a phone left face-up on a table in a marshal's pocket is idle — it
   * should lapse, exactly as it would anywhere else on this platform. What must not lapse is a
   * marshal who is working, and *working* is a tap or a crossing that landed.
   *
   * Skipped offline rather than queued: a keep-alive that arrived twenty minutes late would be
   * sliding a window that had already closed.
   */
  useEffect(() => {
    if (!ready) {
      return;
    }

    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) {
        return;
      }

      if (Date.now() - lastActivityRef.current > ACTIVE_WINDOW_MS) {
        return;
      }

      void fetch('/account/keep-alive/', {
        credentials: 'same-origin',
        cache: 'no-store',
      }).catch(() => {
        // Offline, or the club's Worker is having a moment. The session lapses on its own
        // schedule and the queue survives it either way.
      });
    }, KEEP_ALIVE_MS);

    return () => window.clearInterval(id);
  }, [ready]);

  /**
   * The tap. ⚠️ **Nothing between the press and the time**: `Date.now()` first, everything
   * else after.
   */
  const capture = useCallback(() => {
    const card = newCard(newId(), slug, new Date().toISOString());
    lastActivityRef.current = Date.now();
    commit(sortCards([...cardsRef.current, card]));
    void persist(card);
  }, [commit, persist, slug]);

  const confirm = useCallback(
    (card: QueueCard) => {
      const draft = drafts[card.id] ?? '';
      const next = confirmBib(card, draft, format, known);
      if (next === null) {
        return;
      }

      lastActivityRef.current = Date.now();
      commit(cardsRef.current.map((c) => (c.id === card.id ? next : c)));
      setDrafts((d) => {
        const { [card.id]: _dropped, ...rest } = d;
        return rest;
      });
      void persist(next).then(() => drain());
    },
    [commit, drafts, drain, format, known, persist],
  );

  /**
   * Discarding a tap — **only one that has no bib on it**.
   *
   * ⚠️ **Deliberately not offered on anything else, and the asymmetry is the point.** A tap
   * with no bib is a press nobody can attribute to a runner: two thumbs on one button, or a
   * phone in a pocket. It is not a crossing, and the alternative to discarding it is a card
   * that stays on the screen for the rest of the race with a keypad open on it. A card that
   * *has* a bib is a real time for a real runner and this screen will not delete one —
   * cancelling a crossing is an admin's act, on a different surface, behind a different
   * permission.
   */
  const discard = useCallback(
    (card: QueueCard) => {
      if (card.state !== 'awaiting-bib') {
        return;
      }

      commit(cardsRef.current.filter((c) => c.id !== card.id));
      const db = dbRef.current;
      if (db !== null) {
        void deleteCards(db, [card.id]).catch(() => setStorageLost(true));
      }
    },
    [commit],
  );

  const press = useCallback((cardId: string, digit: string) => {
    setDrafts((d) => ({ ...d, [cardId]: `${d[cardId] ?? ''}${digit}` }));
  }, []);

  const backspace = useCallback((cardId: string) => {
    setDrafts((d) => ({ ...d, [cardId]: (d[cardId] ?? '').slice(0, -1) }));
  }, []);

  if (!ready) {
    return (
      <div className="capture timing-capture-screen">
        <StatusBar raceName={raceName} marshalName={marshalName} when={when} />
        <div className="club-wrap timing-capture-body">{children}</div>
      </div>
    );
  }

  const queue = sortCards(cards);
  const count = (state: QueueCard['state']) =>
    queue.filter((c) => c.state === state).length;

  // ⚠️ **One keypad on the screen at a time: the oldest tap still waiting for its bib.** Runners
  // are typed in the order they crossed, and three keypads stacked under each other is a screen
  // that has to scroll — which is the thing timing mode removes. The others wait in order and
  // open one by one as each is confirmed; the bar's "awaiting bib" count says how many.
  const waiting = queue.filter((c) => c.state === 'awaiting-bib').reverse();
  const open = waiting[0];
  const entering = open !== undefined;
  const shown = entering ? [open] : queue;
  const offlineLine = offlineReady
    ? 'Saved for use without signal — this screen will still open if the page reloads.'
    : 'Not yet saved for use without signal. Crossings are still kept on this phone; keep this tab open.';

  return (
    <div
      className="capture timing-capture-screen"
      data-mode={entering ? 'entry' : 'ready'}
    >
      <StatusBar
        raceName={raceName}
        marshalName={marshalName}
        when={when}
        menuLinks={menuLinks}
        offlineLine={offlineLine}
        live={{
          awaiting: count('awaiting-bib'),
          syncing: count('syncing'),
          queued: count('queued'),
          failed: count('failed'),
          online,
        }}
      />

      <div className="club-wrap timing-capture-body">
        {doorRefused ? (
          <p className="notice notice-bad" role="alert">
            {SYNC_DOOR_REFUSED}
          </p>
        ) : null}

        {storageLost ? (
          <p className="notice notice-bad" role="alert">
            This phone will not let the club&rsquo;s site save anything, so the crossings
            below are held only while this page is open. Do not reload or close this tab —
            and tell whoever is running the race.
          </p>
        ) : null}

        <button type="button" className="timing-capture" onClick={capture}>
          Crossed now
        </button>

        {/* ⚠️ **A fact a marshal wants before they walk away from signal**, rather than test
          scaffolding that happens to be visible. Crossings survive being offline either way —
          they are in IndexedDB — but *this page* only survives a reload once the service
          worker has it, and the difference between the two is not something anybody can be
          expected to guess at a start line. */}
        <p
          className="club-small timing-hint"
          data-capture-offline-ready={offlineReady ? 'yes' : 'no'}
        >
          {offlineLine}
        </p>

        {/* The queue is the one part of this screen that scrolls (T5): the tile and its hints
          stay put above it, so the button is always where the thumb left it. ⚠️ **A region in
          the tab order, named by its heading**, because a box that scrolls must be reachable
          by keyboard to be scrolled at all. axe's `scrollable-region-focusable` caught it on
          an iPhone SE, where an empty queue's sentence alone overflows. */}
      </div>

      <section
        className="timing-queue-wrap"
        aria-labelledby="capture-queue-heading"
        tabIndex={0}
      >
        <div className="club-wrap">
          <h2
            id="capture-queue-heading"
            className={
              queue.length === 0
                ? 'timing-queue-empty-title'
                : entering
                  ? 'timing-visually-hidden'
                  : undefined
            }
          >
            {queue.length === 0
              ? 'Queue’s empty.'
              : entering
                ? 'Type the bib'
                : `${queue.length} ${queue.length === 1 ? 'crossing' : 'crossings'} on this phone`}
          </h2>

          {queue.length === 0 ? (
            <p className="timing-queue-empty">
              Tap the green button when a runner crosses the line. The capture lands here
              and waits for you to type its bib. Everything recorded on this phone has
              been sent to the club; anything recorded with no signal waits here until it
              comes back.
            </p>
          ) : null}

          <ul className="timing-queue">
            {shown.map((card) => (
              <CardView
                key={card.id}
                card={card}
                draft={drafts[card.id] ?? ''}
                format={format}
                known={known}
                onPress={press}
                onBackspace={backspace}
                onConfirm={confirm}
                onDiscard={discard}
                onRetry={() => void drain(card.id)}
              />
            ))}
          </ul>

          {waiting.length > 1 ? (
            <p className="timing-queue-more">
              {waiting.length - 1} more {waiting.length === 2 ? 'tap' : 'taps'} waiting
              for a bib — each opens when this one is confirmed.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/**
 * The dark bar across the top of the capture screen — Pass the Buck's, ADR-055: the race and
 * who is marshalling it, how many crossings are waiting for a bib, whether the phone has a
 * network, and a menu with the rest.
 *
 * Drawn by the server too, without `live`, so the bar is there with scripting off and before
 * the screen has mounted — naming the race and the marshal, and nothing it cannot know.
 *
 * ⚠️ **The menu is a `<details>`**, so it opens with or without scripting and needs no focus
 * management of its own. It carries no Sign out: signing out is a POST with a token only the
 * club's own site issues (HALT 2), so the honest control is a link to Your account, where the
 * button is.
 */
function StatusBar({
  raceName,
  marshalName,
  when,
  live,
  menuLinks = [],
  offlineLine,
}: {
  raceName: string;
  marshalName: string | null;
  when: string;
  menuLinks?: readonly { label: string; href: string }[];
  /** Whether the page itself survives a reload without signal; mounted screen only. */
  offlineLine?: string;
  live?: {
    awaiting: number;
    syncing: number;
    queued: number;
    failed: number;
    online: boolean;
  };
}) {
  return (
    <div className="timing-marshal-bar">
      <div className="club-wrap timing-marshal-bar-inner">
        <div className="timing-marshal-bar-text">
          {/* The heading names the race and nothing else: the marshal is who is holding the
              phone, not what the page is. */}
          <div className="timing-marshal-race">
            <h1>{raceName}</h1>
            {marshalName === null ? null : (
              <span className="timing-marshal-who">
                <span aria-hidden="true">· </span>
                {marshalName}
              </span>
            )}
          </div>
          {live === undefined ? (
            <p className="timing-marshal-count">{when}</p>
          ) : (
            <p className="timing-marshal-count" aria-live="polite">
              <span className="timing-mono">{live.awaiting}</span> awaiting bib
            </p>
          )}
        </div>

        {live === undefined ? null : (
          <p className="timing-pill" data-online={live.online ? 'yes' : 'no'}>
            <span aria-hidden="true" className="timing-pill-dot" />
            {live.online ? 'Online' : 'Offline'}
          </p>
        )}

        <details className="timing-more">
          <summary aria-label="More about this screen">
            <span aria-hidden="true">⋯</span>
          </summary>
          <div className="timing-more-panel">
            {marshalName === null ? null : (
              <p>
                Signed in as <strong>{marshalName}</strong>
              </p>
            )}
            {/* Before the screen has mounted, `when` is the bar's own second line already. */}
            {live === undefined ? null : <p className="club-small">{when}</p>}
            {live === undefined ? null : (
              <p className="club-small timing-mono">
                {live.syncing} syncing · {live.queued} queued · {live.failed} failed
              </p>
            )}
            {offlineLine === undefined ? null : (
              <p className="club-small">{offlineLine}</p>
            )}
            {menuLinks.map((link) => (
              <p key={link.href}>
                <a href={link.href}>{link.label}</a>
              </p>
            ))}
            <p>
              <a href="/account/">Your account</a>
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

/** The digits, in the order a phone keypad has them. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function CardView({
  card,
  draft,
  format,
  known,
  onPress,
  onBackspace,
  onConfirm,
  onDiscard,
  onRetry,
}: {
  card: QueueCard;
  draft: string;
  format: EventFormat;
  known: readonly KnownCrossing[];
  onPress: (cardId: string, digit: string) => void;
  onBackspace: (cardId: string) => void;
  onConfirm: (card: QueueCard) => void;
  onDiscard: (card: QueueCard) => void;
  onRetry: () => void;
}) {
  const captured = formatLondonClock(card.capturedAt);

  if (card.state === 'awaiting-bib') {
    // ⚠️ **The anomaly is previewed as the bib is typed and never used to gate Confirm.** The
    // marshal is told what the club will think of this crossing *before* they commit to it, and
    // then commits to it anyway if that is what they saw. `confirmBib()` freezes the verdict
    // at that moment, and nothing recomputes it afterwards.
    const anomaly = validateBib(draft)
      ? checkAnomaly(
          draft,
          format,
          known.map((c) => ({ bib: c.bib, captured_at: c.captured_at })),
        )
      : null;

    const ready = validateBib(draft);

    // ⚠️ **Laid out for a thumb at a finish line, 10 October 2026.** The readout is the thing the
    // marshal checks, so it is the biggest thing on the card and sits directly above the keys
    // that change it. The keys are a phone dialler's — 1 to 9, then 0 in the middle and Delete
    // bottom right — because that is the grid every phone has already taught. **Confirm repeats
    // the bib**, so the last thing read before the press is the number being sent. **Discard is
    // at the top of the card, as far from Confirm as the card allows**, because it is the one
    // destructive control here and a thumb heading for Confirm must not find it.
    //
    // The readout's text is "Bib 2145" or "No bib yet" as one string, which is what a screen
    // reader announces from the live region and what the tests read.
    return (
      <li className="timing-qcard timing-qcard-entry" data-state="open">
        <div className="timing-entry-head">
          <p className="timing-time">
            <span className="timing-time-label">Crossed at</span> {captured}
          </p>
          <button
            type="button"
            className="timing-danger-link"
            onClick={() => onDiscard(card)}
          >
            Discard this tap
          </button>
        </div>

        <div className="timing-entry-body">
          <div className="timing-entry-readout">
            <p
              className="timing-bib-readout"
              data-empty={draft === '' ? 'true' : undefined}
              aria-live="polite"
            >
              {draft === '' ? (
                'No bib yet'
              ) : (
                <>
                  <span className="timing-bib-caption">Bib</span>{' '}
                  <span className="timing-bib-digits">{draft}</span>
                </>
              )}
            </p>

            {anomaly?.flag ? (
              <p className="timing-warn">
                {/* Two lines rather than four, so the keys and Confirm stay on a short phone's
                    screen. It still says the two things: what looks wrong, and that Confirm is
                    still the button. */}
                {formatAnomalyMessage(anomaly.reason)}. Confirm if that is what you saw.
              </p>
            ) : null}
          </div>

          <div className="timing-keypad">
            {KEYS.slice(0, 9).map((digit) => (
              <button
                key={digit}
                type="button"
                className="timing-key"
                onClick={() => onPress(card.id, digit)}
              >
                {digit}
              </button>
            ))}
            <span className="timing-key-gap" aria-hidden="true" />
            <button
              type="button"
              className="timing-key"
              onClick={() => onPress(card.id, '0')}
            >
              0
            </button>
            <button
              type="button"
              className="timing-key timing-key-delete"
              aria-label="Delete a digit"
              disabled={draft === ''}
              onClick={() => onBackspace(card.id)}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
                <path d="m17 9-6 6M11 9l6 6" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            className="club-btn club-btn-primary timing-confirm"
            disabled={!ready}
            onClick={() => onConfirm(card)}
          >
            {ready ? `Confirm bib ${draft}` : 'Confirm bib'}
          </button>
        </div>
      </li>
    );
  }

  const capped = card.state === 'failed' && atRetryCap(card);

  return (
    <li className="timing-qcard" data-state={card.state}>
      <p className="timing-time">
        <span className="timing-time-label">Crossed at</span> {captured}
        {card.bib === null ? null : <span className="timing-bib">Bib {card.bib}</span>}
      </p>

      <p className="timing-state-line">
        {card.state === 'queued'
          ? 'Waiting to be sent.'
          : card.state === 'syncing'
            ? 'Sending…'
            : 'Not sent.'}
      </p>

      {card.anomalyFlag && card.anomalyReason !== null ? (
        <p className="club-small timing-anomaly-note">{card.anomalyReason}</p>
      ) : null}

      {card.state === 'failed' ? (
        <>
          {/* ⚠️ The club's own wording, chosen by `lib/sync-outcomes.ts`. Nothing the database
              says is ever rendered here — see that module's header. */}
          <p
            className={capped ? 'notice notice-bad' : 'timing-fail'}
            role={capped ? 'alert' : undefined}
          >
            {capped ? SYNC_MANUAL_REVIEW : (card.lastError ?? SYNC_UNAVAILABLE)}
          </p>
          <button type="button" className="club-btn club-btn-secondary" onClick={onRetry}>
            Retry now
          </button>
        </>
      ) : null}
    </li>
  );
}
