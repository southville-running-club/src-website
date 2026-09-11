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

describe('computeAwards on a solo race', () => {
  it("offers the club's eight age bands and none of the pair categories", () => {
    const awards = computeAwards(EVENT, [soloTeam('1', 'F', 34)], [finishAt('1', 40)]);
    const kinds = awards.map((a) => a.kind);

    for (const band of [
      'solo_female_senior',
      'solo_female_vet40',
      'solo_female_vet50',
      'solo_female_vet60',
      'solo_male_senior',
      'solo_male_vet40',
      'solo_male_vet50',
      'solo_male_vet60',
    ]) {
      expect(kinds, band).toContain(band);
    }

    // The three that would have rendered as empty rows for a race with no pairs in it.
    expect(kinds).not.toContain('fastest_male_pair');
    expect(kinds).not.toContain('fastest_female_pair');
    expect(kinds).not.toContain('fastest_mixed_pair');
  });

  it('places each runner in the band their age on the day puts them in', () => {
    const awards = computeAwards(
      EVENT,
      [
        soloTeam('1', 'F', 34), // Senior
        soloTeam('2', 'F', 44), // Vet 40
        soloTeam('3', 'M', 55), // Vet 50
        soloTeam('4', 'M', 61), // Vet 60
      ],
      [finishAt('1', 40), finishAt('2', 41), finishAt('3', 42), finishAt('4', 43)],
    );

    expect(winnerOf(awards, 'solo_female_senior')?.team.id).toBe('team-1');
    expect(winnerOf(awards, 'solo_female_vet40')?.team.id).toBe('team-2');
    expect(winnerOf(awards, 'solo_male_vet50')?.team.id).toBe('team-3');
    expect(winnerOf(awards, 'solo_male_vet60')?.team.id).toBe('team-4');

    // A band nobody is in has no winner, rather than borrowing one from the band above.
    expect(winnerOf(awards, 'solo_male_senior')).toBeNull();
  });

  it('gives the band to the fastest in it, not the fastest overall', () => {
    const awards = computeAwards(
      EVENT,
      [soloTeam('1', 'F', 34), soloTeam('2', 'F', 52), soloTeam('3', 'F', 54)],
      // Team 1 is fastest overall; team 3 beats team 2 within Vet 50.
      [finishAt('1', 38), finishAt('2', 50), finishAt('3', 45)],
    );

    expect(winnerOf(awards, 'solo_female_senior')?.team.id).toBe('team-1');
    expect(winnerOf(awards, 'solo_female_vet50')?.team.id).toBe('team-3');
  });

  /**
   * Both of these are "the club does not know", and the answer to not knowing is no prize
   * rather than a guess. Putting somebody in the wrong band is found out at the presentation.
   */
  it('awards nothing to a runner with no age, or a gender it does not recognise', () => {
    const awards = computeAwards(
      EVENT,
      [soloTeam('1', 'F', null), soloTeam('2', 'X', 34)],
      [finishAt('1', 40), finishAt('2', 41)],
    );

    for (const kind of ['solo_female_senior', 'solo_male_senior']) {
      expect(winnerOf(awards, kind), kind).toBeNull();
    }
  });

  it('reads the gender the CSV happened to give it', () => {
    const awards = computeAwards(
      EVENT,
      [soloTeam('1', ' f ', 34), soloTeam('2', 'm', 34)],
      [finishAt('1', 40), finishAt('2', 41)],
    );

    expect(winnerOf(awards, 'solo_female_senior')?.team.id).toBe('team-1');
    expect(winnerOf(awards, 'solo_male_senior')?.team.id).toBe('team-2');
  });

  /**
   * ⚠️ The exclusion guarantee, on the path added for solo.
   *
   * Team 1 is the fastest Senior woman on the clock and is disqualified. If the band award
   * were computed without the `finished` gate she would win it, and the error would be read
   * out in front of the club.
   */
  it('excludes a team with a terminal status from its age band, not just from the podium', () => {
    const awards = computeAwards(
      EVENT,
      [soloTeam('1', 'F', 34, 'dq'), soloTeam('2', 'F', 34)],
      [finishAt('1', 35), finishAt('2', 40)],
    );

    expect(winnerOf(awards, 'solo_female_senior')?.team.id).toBe('team-2');
    expect(winnerOf(awards, 'first_overall')?.team.id).toBe('team-2');
  });
});
