'use client';

import { useState } from 'react';

/**
 * "Start the race", asked twice — D4, decided 4 October 2026 for this race.
 *
 * The first press records nothing: it turns the button into a question, "Confirm the start",
 * with Cancel beside it. **The start is recorded when Confirm is pressed**, because that is what
 * submits the form, and `timing.start_event()` stores `now()` at that moment — nothing on this
 * screen reads the time it was first pressed.
 *
 * **Client-side only, and with no server change.** The server renders an ordinary submit
 * button, so with scripting off — or before this has hydrated — one press starts the race exactly
 * as it always did. That is the `no-javascript` project's case and it is deliberate: a confirm
 * that needed JavaScript to start a race at all would be a race-day failure on a phone with a
 * stalled script.
 *
 * Confirm takes focus when it appears, so a keyboard user lands on the question. Cancel puts the
 * button back and records nothing.
 */
export function ConfirmStart() {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        className="club-btn timing-btn-dark"
        type="submit"
        onClick={(event) => {
          event.preventDefault();
          setAsking(true);
        }}
      >
        Start the race
      </button>
    );
  }

  return (
    <div className="timing-confirm" role="group" aria-labelledby="confirm-start-question">
      <p id="confirm-start-question" className="timing-confirm-question">
        Start the race now? The moment you press Confirm is the time every runner is
        measured from.
      </p>
      {/* Focus moves to the question that just replaced the button the person pressed. */}
      <button className="club-btn timing-btn-dark" type="submit" autoFocus>
        Confirm the start
      </button>
      <button
        className="club-btn club-btn-secondary"
        type="button"
        onClick={() => setAsking(false)}
      >
        Cancel
      </button>
    </div>
  );
}
