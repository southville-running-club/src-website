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
  children,
}: {
  slug: string;
  /** The race's own, from the database. Bibs mean different things on a relay and a solo. */
  format: EventFormat;
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
            // A 400 is a body this route would not take and a 5xx is an outage; neither is a
            // per-row answer, so every card in the batch gets the same one.
            const wording =
              response.status >= 500 ? SYNC_UNAVAILABLE : refusalWording('refused');
            outcomes = batch.map((card) => ({
              id: card.id,
              state: 'refused' as const,
              reason: wording,
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

          const wording =
            outcome.state === 'unavailable'
              ? SYNC_UNAVAILABLE
              : // ⚠️ The `!response.ok` branch above already put club wording in `reason`;
                // `refusalWording` is idempotent over its own sentences because an unknown
                // string falls through to the general one, which is what that wording is.
                refusalWording(outcome.reason);

          return [syncFailed(card, wording)];
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
    return <>{children}</>;
  }

  const queue = sortCards(cards);

  return (
    <div className="capture">
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

      <button type="button" className="button button-wide capture-tap" onClick={capture}>
        Crossed now
      </button>
      <p className="capture-hint">
        Press the moment a runner crosses. The time is recorded straight away — type the
        bib afterwards.
      </p>

      {/* ⚠️ **A fact a marshal wants before they walk away from signal**, rather than test
          scaffolding that happens to be visible. Crossings survive being offline either way —
          they are in IndexedDB — but *this page* only survives a reload once the service
          worker has it, and the difference between the two is not something anybody can be
          expected to guess at a start line. */}
      <p
        className="capture-hint"
        data-capture-offline-ready={offlineReady ? 'yes' : 'no'}
      >
        {offlineReady
          ? 'Saved for use without signal — this screen will still open if the page reloads.'
          : 'Not yet saved for use without signal. Crossings are still kept on this phone; keep this tab open.'}
      </p>

      <h2>
        {queue.length === 0
          ? 'Nothing waiting'
          : `${queue.length} ${queue.length === 1 ? 'crossing' : 'crossings'} on this phone`}
      </h2>

      {queue.length === 0 ? (
        <p>
          Every crossing recorded on this phone has been sent to the club. Crossings
          recorded while there is no signal stay here until it comes back.
        </p>
      ) : null}

      <ul className="capture-queue">
        {queue.map((card) => (
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

    return (
      <li className="capture-card capture-card-open">
        <p className="capture-time">
          <span className="capture-time-label">Crossed at</span> {captured}
        </p>

        <p className="capture-bib" aria-live="polite">
          {draft === '' ? 'No bib yet' : `Bib ${draft}`}
        </p>

        {anomaly?.flag ? (
          <p className="notice notice-bad capture-anomaly">
            {formatAnomalyMessage(anomaly.reason)}. Confirm it anyway if that is what you
            saw — somebody will check it afterwards.
          </p>
        ) : null}

        <div className="capture-keypad">
          {KEYS.map((digit) => (
            <button
              key={digit}
              type="button"
              className="button capture-key"
              onClick={() => onPress(card.id, digit)}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="button capture-key capture-key-wide"
            onClick={() => onBackspace(card.id)}
          >
            Delete a digit
          </button>
        </div>

        <div className="capture-actions">
          <button
            type="button"
            className="button"
            disabled={!validateBib(draft)}
            onClick={() => onConfirm(card)}
          >
            Confirm bib
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => onDiscard(card)}
          >
            Discard this tap
          </button>
        </div>
      </li>
    );
  }

  const capped = card.state === 'failed' && atRetryCap(card);

  return (
    <li className={`capture-card capture-card-${card.state}`}>
      <p className="capture-time">
        <span className="capture-time-label">Crossed at</span> {captured}
        {card.bib === null ? null : (
          <span className="capture-card-bib">Bib {card.bib}</span>
        )}
      </p>

      <p className="capture-state">
        {card.state === 'queued'
          ? 'Waiting to be sent.'
          : card.state === 'syncing'
            ? 'Sending…'
            : 'Not sent.'}
      </p>

      {card.anomalyFlag && card.anomalyReason !== null ? (
        <p className="capture-anomaly-note">{card.anomalyReason}</p>
      ) : null}

      {card.state === 'failed' ? (
        <>
          {/* ⚠️ The club's own wording, chosen by `lib/sync-outcomes.ts`. Nothing the database
              says is ever rendered here — see that module's header. */}
          <p
            className={capped ? 'notice notice-bad' : 'capture-state-detail'}
            role={capped ? 'alert' : undefined}
          >
            {capped ? SYNC_MANUAL_REVIEW : (card.lastError ?? SYNC_UNAVAILABLE)}
          </p>
          <button type="button" className="button" onClick={onRetry}>
            Retry now
          </button>
        </>
      ) : null}
    </li>
  );
}
