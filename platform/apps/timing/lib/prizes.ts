import {
  computeAwards,
  isRandomDraw,
  type Award,
  type TeamWithRunners,
} from '@src/shared/timing/awards';
import type { PrizeAward } from '@src/shared/timing/prize-export';
import type { ResultsPreview } from './results-preview';

/**
 * The prize list, resolved once from what the URL says — #205.
 *
 * ## ⚠️ The bug this exists to not have again
 *
 * #205 names it: *"the old 'pass to next' exclusions were component state and a refresh lost
 * them mid-ceremony. Hold them in the URL or in a row."* A prize giving is twenty minutes in a
 * loud room with somebody's phone; a screen that forgets which four teams have gone home the
 * moment it reloads means starting again with a microphone in your hand.
 *
 * **The URL, not a row**, and the choice is deliberate. A row would be a fifth table and a write
 * permission for a decision that is neither a fact about the race nor something the club needs
 * next year — "they went home" is true for one evening. A URL is shareable between two people
 * running the ceremony from two phones, survives a reload, and is undone with the back button,
 * which is the control somebody actually reaches for when they pass the wrong team.
 *
 * ## ⚠️ The spot draws are in the URL for a second reason, and it is not convenience
 *
 * The old application picked randomly on the client. Here the winner has to be the same on the
 * screen and in the file, because #205's rule is that *"the prize export consumes the
 * presenter's resolved `Award[]`, so the published table cannot disagree with what was
 * announced"* — and there is no client to ask. So a draw is **offered** as a link whose target
 * already names the team, and taking it writes the choice into the address. Pressing it again
 * on a fresh render offers a different one; the export carries whatever was taken.
 *
 * ⚠️ **And a spot prize has no time, so its `metricLabel` is empty on purpose.** A zero would
 * render as `00:00` beside a name, which is a claim about a race.
 */

/** What the presenter has been told, carried in the address rather than in memory. */
export interface PrizeChoices {
  /** Teams who are not here to claim — excluded from **every** award, which `awards.ts` does. */
  passed: Set<string>;
  /** The two spot prizes' chosen teams, by award kind, once somebody has drawn them. */
  draws: Map<string, string>;
}

/** One query-string value, however Next hands it back. */
function values(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * What the query string asks for.
 *
 * ⚠️ **Nothing read here is ever rendered**, which is `results-outcomes.ts`' standing rule one
 * page along. Every value is used only to *match* against a team id that came from the database
 * — an id nobody recognises simply matches nothing — so a string somebody types into the address
 * bar can exclude nobody and name nobody.
 */
export function prizeChoicesFrom(
  query: Record<string, string | string[] | undefined>,
): PrizeChoices {
  const draws = new Map<string, string>();
  for (const kind of ['random_draw_1', 'random_draw_2'] as const) {
    const chosen = values(query[kind])[0];
    if (chosen !== undefined && chosen !== '') draws.set(kind, chosen);
  }

  return { passed: new Set(values(query.pass).filter((id) => id !== '')), draws };
}

/**
 * The awards, with the presenter's exclusions applied and any draw already taken filled in.
 *
 * ⚠️ **`computeAwards()` is called once and its answer is what both the screen and the file
 * read.** Calling it again in the export route with the same arguments would give the same
 * answer today and is exactly the shape #205 warns about; the route reads the same URL and calls
 * *this*, so there is one resolution rather than two that agree.
 */
export function resolvePrizeAwards(
  payload: ResultsPreview,
  choices: PrizeChoices,
): PrizeAward[] {
  const awards = computeAwards(
    payload.event,
    payload.teams,
    payload.crossings,
    choices.passed,
  );

  return awards.map((award) => fillDraw(award, choices));
}

function fillDraw(award: Award, choices: PrizeChoices): PrizeAward {
  if (!isRandomDraw(award.kind) || award.winner !== null) return award;

  const chosenId = choices.draws.get(award.kind);
  if (chosenId === undefined) return award;

  // ⚠️ **Matched against the pool rather than trusted.** The pool already excludes every
  // deterministic winner and every passed team, so an id that is not in it is either stale — the
  // team has since been passed, or has been marked DNF — or invented. Either way the honest
  // answer is that the draw has not been made.
  const team = award.randomPool?.find((candidate) => candidate.id === chosenId);
  if (team === undefined) return award;

  return {
    ...award,
    // No time, because there was never one. See this module's header.
    winner: { type: 'team', team, metricMs: 0, metricLabel: '' },
  };
}

/**
 * The pool a draw may still be taken from: `awards.ts`' own pool, minus whoever the **other**
 * draw already took.
 *
 * That cross-exclusion was the client's job in the old application and is this function's here —
 * one spot prize may not be won twice by the same team, and neither draw knows about the other.
 */
export function drawablePool(
  award: PrizeAward,
  choices: PrizeChoices,
): TeamWithRunners[] {
  const takenElsewhere = new Set(
    [...choices.draws.entries()]
      .filter(([kind]) => kind !== award.kind)
      .map(([, id]) => id),
  );

  return (award.randomPool ?? []).filter((team) => !takenElsewhere.has(team.id));
}
