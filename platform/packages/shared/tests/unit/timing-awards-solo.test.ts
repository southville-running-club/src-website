import { describe, expect, it } from 'vitest';
import { computeAwards, type TeamWithRunners } from '../../src/timing/awards';
import type { TimingCrossing, TimingRunner } from '../../src/timing/rows';

/**
 * The prize list for a **solo** race.
 *
 * ## Why this file exists
 *
 * The awards module came across from a relay. Pass the Buck is pairs; **Nightingale Nightmare
 * is solo**, and the two do not award the same prizes. The pair categories are derived from
 * two runners' genders, so on a solo race every team answers `null` and all three would render
 * as prizes with no winner — three empty rows on a results page, for categories the race does
 * not have.
 *
 * So a solo race gets the club's own eight bands instead: Senior, Vet 40, Vet 50 and Vet 60,
 * awarded to female and male runners, exactly as the prize list on `/nn/` gives them and
 * exactly as `age-category.ts` already encodes them for the entry form.
 *
 * ⚠️ **The last test in this file is the one that matters most.** The load-bearing guarantee
 * in `awards.ts` is that a team carrying any terminal status is excluded from *every* prize.
 * That guarantee was written and tested against the relay path; this asserts it holds on the
 * path added for solo, because a guarantee that only covers the race it was written for is not
 * one.
 */

const EVENT = {
  actually_started_at: null,
  start_at: '2026-11-01T11:00:00.000Z',
  format: 'solo' as const,
};
const START = Date.parse(EVENT.start_at);
const min = (m: number) => m * 60_000;
const iso = (msFromStart: number) => new Date(START + msFromStart).toISOString();

type RunnerFixture = TimingRunner & { team_id: string };

function soloTeam(
  num: string,
  gender: string,
  age: number | null,
  raceStatus: string | null = null,
): TeamWithRunners & { runners: RunnerFixture[] } {
  const id = `team-${num}`;
  return {
    id,
    team_number: num,
    bib_leg1: null,
    bib_leg2: null,
    category: null,
    dnf_at: null,
    race_status: raceStatus,
    runners: [
      {
        id: `r-${num}`,
        team_id: id,
        leg: 1,
        gender,
        // Null for everybody but a non-binary entrant who was asked — ADR-031. The tests that
        // exercise a placement set it explicitly.
        result_placement: null,
        role: 'runner',
        age_on_day: age,
        firstname: `Runner${num}`,
        lastname: 'Test',
      },
    ],
  };
}

/** A solo bib is the team number alone — no leg prefix. */
function finishAt(num: string, minutes: number): TimingCrossing {
  return {
    bib: num,
    captured_at: iso(min(minutes)),
    anomaly_flag: false,
    resolved_at: null,
    resolved_action: null,
  };
}

const winnerOf = (awards: ReturnType<typeof computeAwards>, kind: string) =>
  awards.find((a) => a.kind === kind)?.winner ?? null;

/** A visually impaired runner and their guide, on one team (ADR-022). */
function teamWithGuide(num: string, gender: string, age: number): TeamWithRunners {
  const team = soloTeam(num, gender, age);
  return {
    ...team,
    runners: [
      ...team.runners,
      {
        ...team.runners[0]!,
        id: `r-${num}-guide`,
        leg: 2,
        role: 'guide',
        gender: 'male',
      },
    ],
  };
}

describe("Nightingale Nightmare's prize list — computeAwards on a solo race", () => {
  const titles = (teams: TeamWithRunners[], crossings: TimingCrossing[] = []) =>
    computeAwards(EVENT, teams, crossings).map((a) => a.title);

  it('is exactly the race’s published prizes, in the order they are read out', () => {
    expect(titles([])).toEqual([
      'Best Fancy Dress (1 of 3)',
      'Best Fancy Dress (2 of 3)',
      'Best Fancy Dress (3 of 3)',
      '1st Female',
      '2nd Female',
      '3rd Female',
      '1st Male',
      '2nd Male',
      '3rd Male',
      '1st Female Vet 40',
      '1st Female Vet 50',
      '1st Female Vet 60',
      '1st Male Vet 40',
      '1st Male Vet 50',
      '1st Male Vet 60',
    ]);
  });

  it('carries none of Pass the Buck’s prizes', () => {
    const all = titles([]).join(' | ');
    for (const ptb of [
      'Overall',
      'Senior',
      'Pair',
      'Furthest',
      'Closest',
      'Leg',
      'Spot',
    ]) {
      expect(all).not.toContain(ptb);
    }
  });

  it('marks fancy dress as judged on the day, with no computed winner', () => {
    const fancy = computeAwards(
      EVENT,
      [soloTeam('1', 'female', 30)],
      [finishAt('1', 40)],
    ).filter((a) => a.kind.startsWith('fancy_dress_'));
    expect(fancy).toHaveLength(3);
    for (const award of fancy) {
      expect(award.judged).toBe(true);
      expect(award.winner).toBeNull();
    }
  });

  it('places 1st to 3rd female and male by finishing time', () => {
    const teams = [
      soloTeam('1', 'female', 30),
      soloTeam('2', 'female', 25),
      soloTeam('3', 'male', 35),
      soloTeam('4', 'female', 28),
      soloTeam('5', 'female', 33),
    ];
    const crossings = [
      finishAt('1', 50),
      finishAt('2', 45),
      finishAt('3', 40),
      finishAt('4', 55),
      finishAt('5', 60),
    ];
    const awards = computeAwards(EVENT, teams, crossings);

    expect(winnerOf(awards, 'solo_female_1st')?.team.id).toBe('team-2');
    expect(winnerOf(awards, 'solo_female_2nd')?.team.id).toBe('team-1');
    expect(winnerOf(awards, 'solo_female_3rd')?.team.id).toBe('team-4');
    expect(winnerOf(awards, 'solo_male_1st')?.team.id).toBe('team-3');
    expect(winnerOf(awards, 'solo_male_2nd')).toBeNull();
  });

  /**
   * ⚠️ **One prize each — the club's decision, 10 October 2026.** A runner who has won 1st to
   * 3rd is passed over for a veteran prize, which goes to the next fastest in that band.
   */
  it('passes a 1st-to-3rd winner over for a veteran prize, to the next in the band', () => {
    const teams = [
      soloTeam('1', 'female', 43), // 1st female, and the fastest Vet 40
      soloTeam('2', 'female', 30),
      soloTeam('3', 'female', 31),
      soloTeam('4', 'female', 45), // 4th female: the Vet 40 prize is hers
    ];
    const crossings = [
      finishAt('1', 40),
      finishAt('2', 41),
      finishAt('3', 42),
      finishAt('4', 50),
    ];
    const awards = computeAwards(EVENT, teams, crossings);

    expect(winnerOf(awards, 'solo_female_1st')?.team.id).toBe('team-1');
    expect(winnerOf(awards, 'solo_female_vet40')?.team.id).toBe('team-4');
  });

  it('places each veteran in the band their age on the day puts them in', () => {
    const teams = [
      soloTeam('1', 'male', 20),
      soloTeam('2', 'male', 21),
      soloTeam('3', 'male', 22),
      soloTeam('4', 'male', 49),
      soloTeam('5', 'male', 50),
      soloTeam('6', 'male', 60),
    ];
    const crossings = teams.map((t, n) => finishAt(t.team_number!, 40 + n));
    const awards = computeAwards(EVENT, teams, crossings);

    expect(winnerOf(awards, 'solo_male_vet40')?.team.id).toBe('team-4');
    expect(winnerOf(awards, 'solo_male_vet50')?.team.id).toBe('team-5');
    expect(winnerOf(awards, 'solo_male_vet60')?.team.id).toBe('team-6');
  });

  it('awards nothing to a runner with no gender it can place, and no band without an age', () => {
    const teams = [soloTeam('1', 'X', 40), soloTeam('2', 'female', null)];
    const awards = computeAwards(EVENT, teams, [finishAt('1', 40), finishAt('2', 41)]);

    // The unplaced runner wins nothing at all; the runner with no age can still place overall.
    expect(winnerOf(awards, 'solo_female_1st')?.team.id).toBe('team-2');
    expect(winnerOf(awards, 'solo_female_vet40')).toBeNull();
    expect(winnerOf(awards, 'solo_male_1st')).toBeNull();
  });

  it('places a non-binary runner where they asked to be placed (ADR-031)', () => {
    const team = soloTeam('1', 'non_binary', 30);
    team.runners[0]!.result_placement = 'male';
    const awards = computeAwards(EVENT, [team], [finishAt('1', 40)]);

    expect(winnerOf(awards, 'solo_male_1st')?.team.id).toBe('team-1');
  });

  /**
   * ⚠️ **A visually impaired runner can win.** Their guide is on the same team (ADR-022), and an
   * earlier version skipped every team with more than one runner, so they never could. The
   * guide still wins nothing.
   */
  it('lets a visually impaired runner win, and never their guide', () => {
    const awards = computeAwards(
      EVENT,
      [teamWithGuide('1', 'female', 41)],
      [finishAt('1', 40)],
    );

    expect(winnerOf(awards, 'solo_female_1st')?.team.id).toBe('team-1');
    expect(winnerOf(awards, 'solo_male_1st')).toBeNull();
  });

  it('excludes a team with a DNS, DNF or DQ from every prize', () => {
    const teams = [soloTeam('1', 'female', 41, 'dq'), soloTeam('2', 'female', 30)];
    const awards = computeAwards(EVENT, teams, [finishAt('1', 40), finishAt('2', 45)]);

    expect(winnerOf(awards, 'solo_female_1st')?.team.id).toBe('team-2');
    expect(winnerOf(awards, 'solo_female_vet40')).toBeNull();
  });
});
