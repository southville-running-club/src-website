/**
 * Awards — who wins what, and who is excluded from everything.
 *
 * **Copied from `bindalshah/src-race-timing`'s `lib/awards.ts`** under
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md),
 * with its assertions.
 *
 * ⚠️ **The load-bearing guarantee is the exclusion, not the ranking.** A team carrying any
 * terminal race status — DNS, DNF or DQ — is out of **every** award: the team prizes and the
 * individual leg awards alike. Without that, a disqualified team's fast leg wins Fastest
 * Female, and the error is found at the presentation in front of the club. The exclusion sits
 * at a single `finished` gate, which is what makes it checkable; the copied test file is
 * mostly about that one property.
 *
 * ## Row types
 *
 * Structural, from `rows.ts`, for the reasons that file gives — the generated Supabase types
 * these arrived reading do not exist here yet.
 *
 * ## One repeated adaptation, and why it is an assertion rather than a branch
 *
 * Every `const winner = pool[0]!` in this file sits directly beneath a `pool.length === 0`
 * check that has already returned. The index is provably safe and `noUncheckedIndexedAccess`
 * — on here, off in the repository this came from — cannot see it. The alternative,
 * `if (winner === undefined) return null`, adds an unreachable branch to prize logic, and an
 * unreachable branch in prize logic is a thing somebody later has to work out is unreachable.
 */

import { ageCategoryFor, ageCategoryLabel, type AgeCategoryCode } from '../age-category';
import { deriveCategory, type PairCategory } from './categories';
import { placementFor } from './gender';
import { buildResults, sortResults, teamRaceStatus, type Result } from './results';
import type { TimingCrossing, TimingEvent, TimingRunner, TimingTeam } from './rows';

// **`Event` is aliased deliberately.** Without it the name resolves to the DOM's `Event`,
// which is in this package's lib - so the file compiles against the wrong type and the
// error surfaces somewhere else entirely.
type Event = TimingEvent;
type Crossing = TimingCrossing;
type Team = TimingTeam;
type Runner = TimingRunner;

export type TeamWithRunners = Team & { runners: Runner[] };

export type AwardKind =
  | 'first_overall'
  | 'second_overall'
  | 'third_overall'
  | 'fastest_male_pair'
  | 'fastest_female_pair'
  | 'fastest_mixed_pair'
  | 'largest_spread'
  | 'smallest_spread'
  | 'fastest_individual_male'
  | 'fastest_individual_female'
  // **Nightingale Nightmare's own prize list** — a solo race, and `/nn/`'s published prizes:
  // three judged fancy-dress prizes, 1st to 3rd female and male, and 1st Vet 40, Vet 50 and
  // Vet 60 female and male. Named kinds rather than one parameterised kind, because every other
  // award here is a named constant and a prize list is read aloud rather than computed.
  | 'fancy_dress_1'
  | 'fancy_dress_2'
  | 'fancy_dress_3'
  | 'solo_female_1st'
  | 'solo_female_2nd'
  | 'solo_female_3rd'
  | 'solo_male_1st'
  | 'solo_male_2nd'
  | 'solo_male_3rd'
  | 'solo_female_vet40'
  | 'solo_female_vet50'
  | 'solo_female_vet60'
  | 'solo_male_vet40'
  | 'solo_male_vet50'
  | 'solo_male_vet60'
  | 'random_draw_1'
  | 'random_draw_2';

export const RANDOM_DRAW_KINDS: readonly AwardKind[] = [
  'random_draw_1',
  'random_draw_2',
] as const;

export function isRandomDraw(kind: AwardKind): boolean {
  return kind === 'random_draw_1' || kind === 'random_draw_2';
}

export type TeamWinner = {
  type: 'team';
  team: TeamWithRunners;
  /** Milliseconds — total time for fastest-pair awards, spread for spread awards. */
  metricMs: number;
  metricLabel: string;
};

export type RunnerWinner = {
  type: 'runner';
  team: TeamWithRunners;
  runner: Runner;
  leg: 1 | 2;
  /** Their leg time in milliseconds. */
  metricMs: number;
  metricLabel: string;
};

export type Award = {
  kind: AwardKind;
  /** Headline shown above the reveal. */
  title: string;
  /** One-line description shown under the headline. */
  subtitle: string;
  /** Resolved winner — or null if no team / runner qualifies (yet). */
  winner: TeamWinner | RunnerWinner | null;
  /**
   * For random-draw awards only: the eligible pool the client should
   * pick from at reveal time. Empty for deterministic awards. The pool
   * already excludes deterministic winners and operator-excluded teams;
   * the client further excludes other random-draw picks at pick time.
   */
  randomPool?: TeamWithRunners[];
  /**
   * A prize the club decides on the day rather than one a time decides — Nightingale
   * Nightmare's fancy dress. Never has a computed winner; the presenter says it is judged rather
   * than that nobody has won it.
   */
  judged?: boolean;
};

const PODIUM_AWARDS: Array<{
  kind: AwardKind;
  title: string;
  subtitle: string;
  position: 1 | 2 | 3;
}> = [
  {
    kind: 'first_overall',
    title: '1st Place Overall',
    subtitle: 'Fastest team across all categories',
    position: 1,
  },
  {
    kind: 'second_overall',
    title: '2nd Place Overall',
    subtitle: 'Second-fastest team across all categories',
    position: 2,
  },
  {
    kind: 'third_overall',
    title: '3rd Place Overall',
    subtitle: 'Third-fastest team across all categories',
    position: 3,
  },
];

const CATEGORY_AWARDS: Array<{
  kind: AwardKind;
  title: string;
  subtitle: string;
  category: PairCategory;
}> = [
  {
    kind: 'fastest_male_pair',
    title: "Top Men's Pair",
    subtitle: 'Fastest male pair',
    category: "Men's Pair",
  },
  {
    kind: 'fastest_female_pair',
    title: "Top Women's Pair",
    subtitle: 'Fastest female pair',
    category: "Women's Pair",
  },
  {
    kind: 'fastest_mixed_pair',
    title: 'Top Mixed Pair',
    subtitle: 'Fastest mixed pair',
    category: 'Mixed Pair',
  },
];

function formatHms(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Match a Result back to its team-with-runners — buildResults narrows the
 * team field to Team but the rows passed in carry runners. We rejoin via
 * a Map<team.id, TeamWithRunners> rather than casting so the type system
 * stays honest.
 */
function attach(
  result: Result,
  byId: Map<string, TeamWithRunners>,
): { result: Result; team: TeamWithRunners } | null {
  const team = byId.get(result.team.id);
  if (!team) return null;
  return { result, team };
}

/**
 * The gender the club places a result in.
 *
 * ⚠️ **This used to be a local `'M'` / `'F'` test, and its own comment named what was
 * missing**: *"When the two are joined, that answer is what should arrive here — through
 * `effectiveCategory()`, which already exists — rather than a second rule invented in this
 * file."* [ADR-039](../../../../../docs/architecture/decisions/adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md)
 * joined them, so `placementFor()` in `gender.ts` is now that one resolver and this file has
 * no gender rule of its own.
 *
 * **A `null` here means no prize, and that is the safe direction.** Guessing puts somebody in
 * the wrong band, which is discovered at the presentation.
 */
function placedGender(runner: {
  gender: string | null;
  result_placement: 'female' | 'male' | null;
}) {
  return placementFor(runner.gender, runner.result_placement);
}

/**
 * ⚠️ **A guide is on the start line and in no prize category** —
 * [ADR-022](../../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md).
 * They take one of the 250, run the course and wear a bib, so they appear everywhere a runner
 * does *except* a prize list. Excluded here rather than at the import, because the roster is
 * the truthful record of who ran.
 *
 * ⚠️ **A null `role` means "this answer does not say", never "not a guide".**
 * `results_for_event()` withholds the column once a race is published, because a guide on leg
 * 2 of a named runner's team discloses that runner's disability by inference. Prizes are
 * decided from `results_preview()`, which keeps it — so this predicate is only ever handed the
 * answer that has one. Reading a prize list off the published payload would quietly put a
 * guide in an age band, which is the defect this function exists to prevent.
 */
function isGuide(runner: { role?: string | null }): boolean {
  return runner.role === 'guide';
}

/**
 * The one runner a solo prize is about: the team's runner who is not a guide. A visually
 * impaired runner's team has their guide on it too (ADR-022), and the runner is as eligible as
 * anybody — an earlier version skipped every team with more than one runner on it, which meant
 * a visually impaired runner could never win.
 */
function soloRunner(team: TeamWithRunners): Runner | null {
  const runners = team.runners.filter((runner) => !isGuide(runner));
  return runners.length === 1 ? (runners[0] ?? null) : null;
}

const PLACE_WORDS = ['1st', '2nd', '3rd'] as const;
const VET_CODES: readonly AgeCategoryCode[] = ['vet40', 'vet50', 'vet60'];

/**
 * **Nightingale Nightmare's prize list**, in the order it is read out — the race's published
 * prizes (`/nn/`, `race.json`), confirmed by the club on 10 October 2026:
 *
 * 1. **Fancy dress, three prizes** — judged on the day, so never computed.
 * 2. **1st, 2nd and 3rd female, then male**, by finishing time.
 * 3. **1st Vet 40, Vet 50 and Vet 60, female then male** — ⚠️ **one prize each**: a runner who
 *    has already won 1st to 3rd is passed over for a veteran prize, which goes to the next
 *    fastest in that band. The club's decision, 10 October 2026.
 *
 * ⚠️ **None of Pass the Buck's prizes**: no mixed overall podium, no Senior band, no "Furthest
 * Apart" or "Closest Together", no fastest leg and no spot draw. Those are a relay's, and stay
 * on `computeAwards()`'s relay path.
 *
 * Gender is the place a runner is put in, through `placementFor()` (ADR-031); a guide wins
 * nothing (ADR-022); a team with a DNS, DNF or DQ is already out of `finished`.
 */
function computeNnAwards(
  finished: Array<{ result: Result; team: TeamWithRunners }>,
): Award[] {
  const awards: Award[] = [];

  for (const [index] of PLACE_WORDS.entries()) {
    awards.push({
      kind: `fancy_dress_${index + 1}` as AwardKind,
      title: `Best Fancy Dress (${index + 1} of 3)`,
      subtitle: 'One of three prizes for the best fancy dress',
      winner: null,
      judged: true,
    });
  }

  // Each finisher once, with the runner a prize is about and the place they are put in.
  const entries = finished.flatMap((entry) => {
    const runner = soloRunner(entry.team);
    if (runner === null || entry.result.totalMs === null) return [];
    const gender = placedGender(runner);
    if (gender === null) return [];
    return [{ entry, runner, gender, totalMs: entry.result.totalMs }];
  });

  const won = new Set<string>();
  const winnerOf = (
    entry: { result: Result; team: TeamWithRunners },
    totalMs: number,
  ) => ({
    type: 'team' as const,
    team: entry.team,
    metricMs: totalMs,
    metricLabel: formatHms(totalMs),
  });

  for (const gender of ['female', 'male'] as const) {
    const field = entries.filter((e) => e.gender === gender);
    PLACE_WORDS.forEach((place, index) => {
      const pick = field[index];
      if (pick !== undefined) won.add(pick.entry.team.id);
      awards.push({
        kind: `solo_${gender}_${place}` as AwardKind,
        title: `${place} ${gender === 'female' ? 'Female' : 'Male'}`,
        subtitle: `${index === 0 ? 'Fastest' : index === 1 ? 'Second-fastest' : 'Third-fastest'} ${gender} runner`,
        winner: pick === undefined ? null : winnerOf(pick.entry, pick.totalMs),
      });
    });
  }

  for (const gender of ['female', 'male'] as const) {
    for (const code of VET_CODES) {
      const pick = entries.find((e) => {
        if (e.gender !== gender || won.has(e.entry.team.id)) return false;
        if (e.runner.age_on_day === null) return false;
        const band = ageCategoryFor(e.runner.age_on_day, gender);
        return band.known && band.code === code;
      });
      awards.push({
        kind: `solo_${gender}_${code}` as AwardKind,
        title: `1st ${gender === 'female' ? 'Female' : 'Male'} ${ageCategoryLabel(code)}`,
        subtitle: `Fastest ${gender} ${ageCategoryLabel(code)} runner not already winning a prize`,
        winner: pick === undefined ? null : winnerOf(pick.entry, pick.totalMs),
      });
    }
  }

  return awards;
}

function findFastestPairInCategory(
  finished: Array<{ result: Result; team: TeamWithRunners }>,
  category: PairCategory,
): TeamWinner | null {
  const inCat = finished.filter((x) => deriveCategory(x.team.runners) === category);
  if (inCat.length === 0) return null;
  // `finished` arrives pre-sorted ascending by totalMs (via sortResults('total')).
  const first = inCat[0]!;
  if (first.result.totalMs === null) return null;
  return {
    type: 'team',
    team: first.team,
    metricMs: first.result.totalMs,
    metricLabel: formatHms(first.result.totalMs),
  };
}

function findSpreadExtreme(
  finished: Array<{ result: Result; team: TeamWithRunners }>,
  direction: 'largest' | 'smallest',
): TeamWinner | null {
  // Spread is only defined on relay teams with both legs captured.
  // Solo events / leg-1-only states fall out here.
  const eligible = finished
    .map((x) => {
      if (x.result.splitAMs === null || x.result.splitBMs === null) return null;
      const spread = Math.abs(x.result.splitAMs - x.result.splitBMs);
      return { ...x, spread };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (eligible.length === 0) return null;
  // Stable: ties broken by lower team_number for determinism (the result
  // array we sliced from is already team-number-tiebroken).
  eligible.sort((a, b) =>
    direction === 'largest' ? b.spread - a.spread : a.spread - b.spread,
  );
  const pick = eligible[0]!;
  return {
    type: 'team',
    team: pick.team,
    metricMs: pick.spread,
    metricLabel: formatHms(pick.spread),
  };
}

/**
 * Per-runner leg time. For relay: leg 1 runner gets splitAMs, leg 2 gets
 * splitBMs. For solo: there's one runner who effectively ran the whole
 * thing (totalMs); we still expose them under leg 1 for uniformity.
 */
type RunnerLegEntry = {
  team: TeamWithRunners;
  runner: Runner;
  leg: 1 | 2;
  legMs: number;
};

function enumerateRunnerLegs(
  finished: Array<{ result: Result; team: TeamWithRunners }>,
  isRelay: boolean,
): RunnerLegEntry[] {
  const out: RunnerLegEntry[] = [];
  for (const { result, team } of finished) {
    if (!isRelay) {
      const r = team.runners[0];
      if (r && result.totalMs !== null) {
        out.push({ team, runner: r, leg: 1, legMs: result.totalMs });
      }
      continue;
    }
    if (result.splitAMs !== null) {
      const r = team.runners.find((x) => x.leg === 1);
      if (r) out.push({ team, runner: r, leg: 1, legMs: result.splitAMs });
    }
    if (result.splitBMs !== null) {
      const r = team.runners.find((x) => x.leg === 2);
      if (r) out.push({ team, runner: r, leg: 2, legMs: result.splitBMs });
    }
  }
  return out;
}

function findFastestIndividual(
  legs: RunnerLegEntry[],
  gender: 'female' | 'male',
  excludeRunnerIds: Set<string>,
): RunnerWinner | null {
  const eligible = legs.filter(
    (l) =>
      !isGuide(l.runner) &&
      placedGender(l.runner) === gender &&
      !excludeRunnerIds.has(l.runner.id),
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => a.legMs - b.legMs);
  const pick = eligible[0]!;
  return {
    type: 'runner',
    team: pick.team,
    runner: pick.runner,
    leg: pick.leg,
    metricMs: pick.legMs,
    metricLabel: formatHms(pick.legMs),
  };
}

/**
 * Compute all ten awards from current race state. Pure function — same
 * inputs, same output. Safe to call on every realtime update.
 *
 * `excludeTeamIds` is a per-call exclusion set the operator can grow at
 * the presenter screen: "this team isn't here to claim, advance to next
 * eligible". Applied uniformly to every award; individual awards 9–10
 * additionally exclude all runners on any team that won 1–8.
 */
export function computeAwards(
  event: Pick<Event, 'actually_started_at' | 'start_at' | 'format'>,
  teams: TeamWithRunners[],
  crossings: Crossing[],
  excludeTeamIds: Set<string> = new Set(),
): Award[] {
  const isRelay = event.format === 'relay';
  const byTeamId = new Map(teams.map((t) => [t.id, t]));

  // Overall-sorted result set — finished only, with the operator's
  // excluded-team filter applied up front so every award downstream
  // honours it.
  const sortedAll = sortResults(buildResults(event, teams, crossings), 'total');
  const finished = sortedAll
    .filter(
      (r) =>
        r.status === 'finished' &&
        // Slice 12 — the single prize-eligibility gate. A team with ANY race
        // status (dns/dnf/dq) is ineligible for EVERY award: team prizes AND
        // individual leg awards (the latter enumerate `finished` only, so this
        // one filter also keeps a DNF'd team's fast leg out of Fastest
        // Male/Female). buildResults already demotes such a team out of
        // "finished"; this explicit guard keeps the invariant local and
        // refactor-proof rather than depending on that coupling.
        teamRaceStatus(r.team) === null &&
        !excludeTeamIds.has(r.team.id),
    )
    .map((r) => attach(r, byTeamId))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // ⚠️ **A solo race is Nightingale Nightmare, and gets Nightingale Nightmare's prizes** and
  // nothing else — see `computeNnAwards()`. Everything below is Pass the Buck's relay list.
  if (!isRelay) return computeNnAwards(finished);

  const awards: Award[] = [];

  // 1–3: overall podium. `finished` is pre-sorted ascending by totalMs,
  // so positions 0/1/2 are 1st/2nd/3rd respectively.
  for (const def of PODIUM_AWARDS) {
    const idx = def.position - 1;
    const pick = finished[idx];
    let winner: TeamWinner | null = null;
    if (pick && pick.result.totalMs !== null) {
      winner = {
        type: 'team',
        team: pick.team,
        metricMs: pick.result.totalMs,
        metricLabel: formatHms(pick.result.totalMs),
      };
    }
    awards.push({
      kind: def.kind,
      title: def.title,
      subtitle: def.subtitle,
      winner,
    });
  }

  // 4–6: the relay's three pair categories. A solo race never reaches here — it returned
  // Nightingale Nightmare's own list above.
  for (const def of CATEGORY_AWARDS) {
    awards.push({
      kind: def.kind,
      title: def.title,
      subtitle: def.subtitle,
      winner: findFastestPairInCategory(finished, def.category),
    });
  }

  // 7–8: spread extremes.
  awards.push({
    kind: 'largest_spread',
    title: 'Furthest Apart',
    subtitle: 'Pair with the biggest gap between leg times',
    winner: isRelay ? findSpreadExtreme(finished, 'largest') : null,
  });
  awards.push({
    kind: 'smallest_spread',
    title: 'Closest Together',
    subtitle: 'Pair with the smallest gap between leg times',
    winner: isRelay ? findSpreadExtreme(finished, 'smallest') : null,
  });

  // 9–10: fastest individuals, excluding runners on any prize-winning team
  // from 1–8. The prize announcement is explicit about this exclusion
  // ("to not have won another prize"), independent of the operator's
  // allow-overlap collision rule for the team awards.
  const excludeRunnerIds = new Set<string>();
  for (const a of awards) {
    if (a.winner?.type === 'team') {
      for (const r of a.winner.team.runners) excludeRunnerIds.add(r.id);
    }
  }
  const legs = enumerateRunnerLegs(finished, isRelay);
  awards.push({
    kind: 'fastest_individual_male',
    title: 'Fastest Male Leg',
    subtitle: 'Fastest single leg by a male runner not already winning',
    winner: findFastestIndividual(legs, 'male', excludeRunnerIds),
  });
  awards.push({
    kind: 'fastest_individual_female',
    title: 'Fastest Female Leg',
    subtitle: 'Fastest single leg by a female runner not already winning',
    winner: findFastestIndividual(legs, 'female', excludeRunnerIds),
  });

  // 11–12: random spot prizes. Pool = finished teams that haven't been
  // surfaced as a winner of any earlier deterministic award. Cross-slide
  // exclusion (11's pick must not appear in 12's pool) is the client's
  // job — see prize-giving.tsx — because randomness lives there.
  const priorWinnerTeamIds = new Set<string>();
  for (const a of awards) {
    if (a.winner) priorWinnerTeamIds.add(a.winner.team.id);
  }
  const randomPool = finished
    .map((f) => f.team)
    .filter((t) => !priorWinnerTeamIds.has(t.id));
  awards.push({
    kind: 'random_draw_1',
    title: 'Spot Prize',
    subtitle: 'Random draw from finished teams',
    winner: null,
    randomPool,
  });
  awards.push({
    kind: 'random_draw_2',
    title: 'Spot Prize',
    subtitle: 'Random draw from finished teams',
    winner: null,
    randomPool,
  });

  return awards;
}

/**
 * Just the three top-pair-per-category awards. Convenience wrapper for
 * the live leaderboard's Winners panel, which doesn't need the podium,
 * spread, or individual awards.
 */
export function computeCategoryLeaders(
  event: Pick<Event, 'actually_started_at' | 'start_at' | 'format'>,
  teams: TeamWithRunners[],
  crossings: Crossing[],
): Award[] {
  return computeAwards(event, teams, crossings).slice(3, 6);
}
