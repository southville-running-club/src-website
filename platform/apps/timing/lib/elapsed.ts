/**
 * A length of time, rendered — the countdown to a start and the clock since one, #250.
 *
 * ## ⚠️ Why this is not in `london-time.ts`, and is not a timezone question at all
 *
 * A **duration** has no timezone. Two instants are subtracted as UTC milliseconds, and the
 * answer is the same number in every zone on earth — including across the clocks change, which
 * is exactly when this platform is used. `Date.parse` of an ISO string with an offset is UTC
 * arithmetic and nothing else, so there is no ambient-zone foot-gun here to route through
 * `packages/shared/src/london-time.ts`.
 *
 * **Every *instant* on the start screen still goes through that module and nothing else.** The
 * moment the gun went, the scheduled start, the finish — those are times of day, they are
 * rendered `Europe/London`, and the race is run the weekend after the clocks go back. This
 * file renders the gap between two of them, which is a different thing, and it deliberately
 * contains no `Intl`, no `toLocale*String` and no zone name at all.
 *
 * ## Always hours, even when there are none
 *
 * `00:04:12` rather than `04:12`. The clock ticks once a second next to text, and a string that
 * gains a field as it crosses an hour changes width mid-race — `base.css`'s `.race-clock` uses
 * `tabular-nums` for the same reason. A fixed shape is also what somebody reading it at arm's
 * length in the cold can parse without re-reading.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `00:04:12`, or `3d 01:00:00` once there are whole days in it.
 *
 * A negative input is clamped to zero rather than rendered with a sign: the caller decides
 * which direction it is counting and says so in words beside the clock, because `-00:04:12` is
 * ambiguous about whether the start is coming or gone.
 */
export function formatDuration(milliseconds: number): string {
  const total = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;

  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const seconds = Math.floor((total % MINUTE) / SECOND);

  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return days === 0 ? clock : `${days}d ${clock}`;
}
