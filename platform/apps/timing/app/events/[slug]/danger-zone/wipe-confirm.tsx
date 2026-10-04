'use client';

import { useEffect, useState } from 'react';

/**
 * The typed confirmation and the button it unlocks — brief §6.2 #6 and §8.11.
 *
 * **"Wipe this race" stays disabled until the box holds the race's slug**, with the reason beside
 * it, so a blocked action no longer looks pressable. That is a convenience and never the guard:
 * `reset_event()` compares the phrase itself and refuses `not_confirmed`, so a POST that never
 * saw this page meets the same control.
 *
 * **Enabled until this has hydrated, and so with scripting off.** The server renders a working
 * submit button; only once this script runs does the button wait for the slug. Every spec here
 * runs a `no-javascript` project, and the server's refusal is what that project relies on (HALT
 * 2: the server check backs up Wipe without JavaScript).
 *
 * `blockedBy` is a reason the server already knows the wipe will be refused — the race's
 * results are published — and disables the button whatever is typed, with or without scripting,
 * because there is nothing to wait for.
 */
export function WipeConfirm({
  slug,
  blockedBy,
}: {
  slug: string;
  blockedBy: string | null;
}) {
  const [typed, setTyped] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  const matches = typed.trim() === slug;
  const waiting = hydrated && !matches;
  const disabled = blockedBy !== null || waiting;
  const reason =
    blockedBy ?? (waiting ? `Stays disabled until the box says ${slug}.` : null);

  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor="confirmation">
          Type <strong>{slug}</strong> to confirm
        </label>
        <p className="field-hint" id="confirmation-hint">
          Exactly as it appears above, in lower case.
        </p>
        <input
          className="field-input"
          id="confirmation"
          name="confirmation"
          type="text"
          required
          /* ⚠️ Three attributes rather than taste. A phone keyboard capitalises the first
           letter of a text field and offers to correct an unfamiliar word, and the function
           compares the phrase exactly — so without these the control would refuse a volunteer
           who typed precisely what the page asked for. */
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          aria-describedby="confirmation-hint"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>

      <p className="timing-guarded-action">
        <button
          type="submit"
          className="club-btn timing-btn-danger"
          disabled={disabled}
          aria-describedby={reason === null ? undefined : 'wipe-reason'}
        >
          Wipe this race
        </button>
        {reason === null ? null : (
          <span className="timing-guard-reason" id="wipe-reason">
            {reason}
          </span>
        )}
      </p>
    </>
  );
}
