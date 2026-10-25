import type { EventFormat } from '@src/shared/timing/bib';
import type { PrizeAward } from '@src/shared/timing/prize-export';
import { runnerBibs } from '@src/shared/timing/result-export';

/**
 * The prize presenter's slot-machine reveal — the reels, worked out on the server.
 *
 * Pass the Buck's presenter had it: one reel per digit of the winner's number, face down as
 * `?`, tumbling and locking left to right. This is that, rebuilt for a presenter whose state
 * lives in the address (`lib/prizes.ts`) rather than in a client component.
 *
 * ## ⚠️ What a reel spins through, and why it is digits
 *
 * **The digits 0 to 9, and nothing else.** The reel lands on the winner's race number, then
 * their name is shown. The alternatives were the names of the other finishers in the category,
 * or their bibs, and both were refused: the presenter is a projector in a public room, used
 * **before the results are published** (ADR-042), so a reel of names puts the field — everybody
 * who did *not* win, and how many of them there were — on a screen the club has not published.
 * A digit names nobody.
 *
 * ## ⚠️ Nothing here picks a winner
 *
 * The number a reel lands on is the computed winner's, from the same `PrizeAward` the screen and
 * the file both read, through the same `runnerBibs()` the prize export uses — so the number on
 * the projector is the number in the file. The strip of digits a reel passes on the way is
 * deterministic decoration: no randomness, nothing a refresh could change.
 *
 * ## ⚠️ The spin is a one-shot address, and only a script writes it
 *
 * `?spin=1` on a revealed prize says *"play the reveal"*. Plain **Reveal** links never carry it,
 * so with scripting off the winner is shown at once, exactly as before. The presenter's script
 * adds it on the way to the reveal — and not when the browser asks for less motion — and takes
 * it back out of the address as soon as the page has it, so a refresh mid-ceremony shows the
 * winner rather than spinning again. `presenter-reel.tsx` carries that half.
 */

/** The query parameter that asks a revealed prize to spin before it shows the winner. */
export const SPIN_PARAM = 'spin';

/** What a face-down reel shows, and the first thing a spinning one does. */
export const FACE_DOWN = '?';

/** The first reel lands this long after the spin starts… */
export const FIRST_STOP_MS = 1400;
/** …and each reel after it this much later, so they lock left to right. */
export const STOP_STAGGER_MS = 600;
/** Full turns of 0–9 the first reel makes before it lands; each later reel makes one more. */
export const FIRST_REEL_TURNS = 2;

/** The number the reels land on, and what to call it in words. */
export interface ReelNumber {
  /** `Bib` for a race number somebody wears; `Team` for a relay pair's team number. */
  label: 'Bib' | 'Team';
  value: string;
}

/** One reel: what it shows from top to bottom, ending on what it lands on. */
export interface Reel {
  /** The character the reel lands on. */
  target: string;
  /** Face down first, then every digit it passes, then `target` last. */
  strip: string[];
  /** When it lands, in milliseconds after the spin starts. */
  stopMs: number;
}

type Winner = NonNullable<PrizeAward['winner']>;

/**
 * The number a winner's reels land on, or null when there is none to land on yet — a team
 * imported before bibs were assigned. Null means no reels and no spin: the name is shown as it
 * always was.
 *
 * ⚠️ **The same bib the prize export prints**, by the same rule (`prize-export.ts`'
 * `winnerBibs()`): a runner award names the leg it was won on, and a solo race names its one
 * number. A relay **team** award wears two numbers, and a reel cannot land on two, so it lands on
 * the team number instead — which is what Pass the Buck's own reels did.
 */
export function reelNumberFor(winner: Winner, format: EventFormat): ReelNumber | null {
  const team = winner.team;

  if (winner.type === 'runner') {
    const bibs = runnerBibs(team, format);
    const bib = bibs[winner.leg - 1] ?? bibs[0] ?? null;
    return bib === null || bib === '' ? null : { label: 'Bib', value: bib };
  }

  if (format === 'solo') {
    const bib = runnerBibs(team, format)[0] ?? null;
    return bib === null || bib === '' ? null : { label: 'Bib', value: bib };
  }

  const number = team.team_number?.trim() ?? '';
  return number === '' ? null : { label: 'Team', value: number };
}

/**
 * The reels for a number: one per character, each counting up through whole turns of 0–9 and
 * landing on its own digit, later reels turning longer and landing later.
 *
 * A character that is not a digit — which a bib never is, but a team number is only text — gets
 * a reel that goes straight from face down to itself rather than one that counts through digits
 * to something that is not one.
 */
export function buildReels(value: string): Reel[] {
  return [...value].map((target, index) => {
    const stopMs = FIRST_STOP_MS + index * STOP_STAGGER_MS;
    if (!/^[0-9]$/u.test(target)) return { target, strip: [FACE_DOWN, target], stopMs };

    const digit = Number(target);
    const passes = (FIRST_REEL_TURNS + index) * 10;
    const strip = [FACE_DOWN];
    // Counting up and ending on the target: the last of `passes` steps is the digit itself.
    for (let step = passes - 1; step >= 0; step -= 1) {
      strip.push(String((((digit - step) % 10) + 10) % 10));
    }
    return { target, strip, stopMs };
  });
}

/** When the last reel lands — the moment the winner is shown. Zero for no reels. */
export function spinMs(reels: readonly Reel[]): number {
  return reels.reduce((latest, reel) => Math.max(latest, reel.stopMs), 0);
}

/** A presenter address with the one-shot spin added. */
export function withSpin(href: string): string {
  const [path = '', hash] = href.split('#', 2);
  const joined = `${path}${path.includes('?') ? '&' : '?'}${SPIN_PARAM}=1`;
  return hash === undefined ? joined : `${joined}#${hash}`;
}

/**
 * The address the page is at, with the one-shot spin taken back out — what the address bar should
 * say once the reveal has started, so that a refresh shows the winner instead of spinning again.
 * Path, query and fragment only, which is what `history.replaceState` wants.
 */
export function withoutSpin(href: string): string {
  const url = new URL(href, 'http://presenter.invalid');
  url.searchParams.delete(SPIN_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The one sentence assistive technology hears when the reels land — once, and never a digit at
 * a time, because the reels themselves are hidden from it.
 */
export function landingAnnouncement(
  name: string,
  number: ReelNumber | null,
  metricLabel: string,
): string {
  return [name, number === null ? '' : `${number.label} ${number.value}`, metricLabel]
    .filter((part) => part !== '')
    .join(', ');
}
