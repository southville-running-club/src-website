import { html, raw, type Html } from './html';

/**
 * "Still there? Keep me signed in" on every signed-in page under `/admin/` — 25 October 2026.
 *
 * ## The problem
 *
 * **Every page load here slides ADR-019's idle window, and nothing between page loads does.** A
 * volunteer reading a long entries list, or filling in the give-a-place form, for half an hour
 * without loading a page was signed out underneath it, and the next click answered with the
 * ordinary **404** — because ADR-013 makes a signed-out request to `/admin/` indistinguishable
 * from an address that does not exist. So the volunteer was not told they had been signed out;
 * they were told the page was gone, and a form they had spent twenty minutes on was lost with it.
 *
 * ## What this does — the same rules as `/timing`, written once more for a Worker page
 *
 * - **A keep-alive every five minutes while the page is being worked on**: visible, and a tap or
 *   a key in the last twenty-five minutes. `/account/keep-alive/` is this Worker's own address,
 *   so it slides the window exactly as a page load does. Opening the page is activity and
 *   already slid it, so nothing is sent on load.
 * - **"Still there?" after twenty quiet minutes**, with one button. Pressing it, or touching
 *   anything else, answers it. ADR-019's idle window is not widened: a tab nobody is near still
 *   lapses, and still answers its next click with the 404.
 *
 * The numbers are the capture screen's on `/timing`, where their argument is — the keep-alive
 * there was the first, for #244 — restated here because there is no bundler reaching a
 * Worker-rendered page, which is the reason `admin-people.ts` and `account.ts` carry their
 * scripts inline too. `tests/unit/admin-stay-signed-in.test.ts` holds them to ADR-019's thirty
 * minutes and to each other.
 *
 * ## Three things that are load-bearing
 *
 * ⚠️ **Only on pages that carry the club header**, which is how `page()` already tells a
 * signed-in page from the bare 404. The 404 a stranger gets must stay byte for byte the ordinary
 * not-found page (ADR-013): a sign-out prompt on it would say the address is a door.
 *
 * ⚠️ **The bar is fixed to the foot of the screen and takes no space**, so appearing moves
 * nothing on the page, and **a press on the bar is never counted as a tap elsewhere** — if the
 * bar vanished on `pointerdown`, the `click` after it would land on whatever it had covered,
 * which on the entries list could be a row's Cancel menu.
 *
 * ⚠️ **`[hidden]` is restated in `nn-admin.css`.** The browser's `[hidden] { display: none }`
 * loses to any class that sets a `display`, so a later style on the bar could otherwise put it
 * on screen from the moment the page loaded, on every admin page at once.
 *
 * With scripting off the bar stays hidden and nothing polls, which is the page as it was.
 */
export function staySignedIn(): Html {
  return html`<div class="admin-stay-bar" role="alert" data-stay-signed-in hidden>
      <div class="admin-stay-bar-inner">
        <p>
          <strong>Still there?</strong> Nothing has happened on this page for a while, and
          you will be signed out soon if that carries on.
        </p>
        <button type="button" class="button" data-stay-signed-in-button>
          Keep me signed in
        </button>
      </div>
    </div>
    <script data-stay-signed-in-script>
      ${raw(STAY_SIGNED_IN)};
    </script>`;
}

/** How often a page being worked on calls the keep-alive. */
export const KEEP_ALIVE_MS = 5 * 60_000;

/** How long after the last tap a page still counts as worked on — ADR-019's number. */
export const ACTIVE_WINDOW_MS = 25 * 60_000;

/** How long after the last tap the prompt appears. */
export const STAY_PROMPT_AFTER_MS = 20 * 60_000;

/** How often the page checks whether the prompt is due. */
export const STAY_CHECK_MS = 30_000;

const STAY_SIGNED_IN = `
(function () {
  var bar = document.querySelector('[data-stay-signed-in]');
  var button = document.querySelector('[data-stay-signed-in-button]');
  if (!bar || !button || !window.fetch) {
    return;
  }

  var KEEP_ALIVE_MS = ${KEEP_ALIVE_MS};
  var ACTIVE_WINDOW_MS = ${ACTIVE_WINDOW_MS};
  var STAY_PROMPT_AFTER_MS = ${STAY_PROMPT_AFTER_MS};
  var STAY_CHECK_MS = ${STAY_CHECK_MS};
  var last = Date.now();

  function keepAlive() {
    fetch('/account/keep-alive/', { credentials: 'same-origin', cache: 'no-store' }).catch(
      function () {}
    );
  }

  function working() {
    return document.visibilityState === 'visible' && Date.now() - last <= ACTIVE_WINDOW_MS;
  }

  function poll() {
    if (navigator.onLine && working()) {
      keepAlive();
    }
  }

  function check() {
    if (Date.now() - last >= STAY_PROMPT_AFTER_MS) {
      bar.hidden = false;
    }
  }

  function answer() {
    last = Date.now();
    if (!bar.hidden) {
      bar.hidden = true;
      keepAlive();
    }
  }

  document.addEventListener(
    'pointerdown',
    function (event) {
      if (event.target instanceof Element && event.target.closest('[data-stay-signed-in]')) {
        return;
      }
      answer();
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    'keydown',
    function (event) {
      if (event.target instanceof Element && event.target.closest('[data-stay-signed-in]')) {
        return;
      }
      answer();
    },
    true
  );
  button.addEventListener('click', answer);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      poll();
      check();
    }
  });

  setInterval(poll, KEEP_ALIVE_MS);
  setInterval(check, STAY_CHECK_MS);
})()`;
