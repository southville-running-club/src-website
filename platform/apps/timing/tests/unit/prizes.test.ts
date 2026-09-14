import { describe, expect, it } from 'vitest';
import type { TeamWithRunners } from '@src/shared/timing/awards';
import { drawablePool, prizeChoicesFrom, resolvePrizeAwards } from '../../lib/prizes';
import type { ResultsPreview } from '../../lib/results-preview';

/**
 * The prize presenter's choices, held in the address — #205.
 *
 * ⚠️ **The whole point of this module is the bug it does not have.** #205 names it: *"the old
 * 'pass to next' exclusions were component state and a refresh lost them mid-ceremony."* So the
 * assertions here are about a set of choices surviving being written down and read back, and
 * about the screen and the file resolving the identical awards from them.
 */

const EVENT: ResultsPreview['event'] = {
  slug: 'zz-prizes',
  name: 'Prize fixture',
  format: 'solo',
  start_at: '2026-11-01T11:00:00.000Z',
  actually_started_at: null,
  finished_at: null,
  results_published_at: null,
};
const START = Date.parse(EVENT.start_at);
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

function team(number: string, firstname: string, gender: string, age: number) {
  return {
    id: `team-${number}`,
    team_number: number,
    bib_leg1: null,
    bib_leg2: null,
    category: null,
    race_status: null,
    dnf_at: null,
    name: null,
    runners: [
      {
        id: `r-${number}`,
        leg: 1,
        firstname,
        lastname: 'Test',
        gender,
        result_placement: null,
        role: 'runner',
        age_on_day: age,
      },
    ],
  };
}

/**
 * Seven finishers, and the last two are the reason there are seven.
 *
 * ⚠️ **A spot prize's pool is *"finished teams that have not won anything else"***, and on a
 * four-person field that is empty: three take the podium, the bands take the rest and the
 * fastest-leg awards take whoever is left. So a fixture small enough to read is a fixture where
 * the draw can never be made, and every assertion about one would pass vacuously.
 *
 * `team-16` and `team-17` are slow enough to win nothing, which is what leaves a pool to draw
 * from.
 */
const PAYLOAD: ResultsPreview = {
  event: EVENT,
  open_anomalies: 0,
  teams: [
    team('11', 'Ada', 'female', 34),
    team('12', 'Grace', 'male', 52),
    team('13', 'Mary', 'female', 61),
    team('14', 'Joan', 'male', 29),
    team('15', 'Alan', 'male', 30),
    team('16', 'Edsger', 'male', 31),
    team('17', 'Tony', 'male', 32),
  ],
  crossings: (
    [
      ['12', 40],
      ['11', 45],
      ['13', 50],
      ['14', 55],
      ['15', 60],
      ['16', 65],
      ['17', 70],
    ] as const
  ).map(([bib, minutes]) => ({
    bib,
    captured_at: at(minutes),
    anomaly_flag: false,
    resolved_at: null,
    resolved_action: null,
  })),
};

const winnerOf = (awards: ReturnType<typeof resolvePrizeAwards>, kind: string) =>
  awards.find((award) => award.kind === kind)?.winner ?? null;

describe('prizeChoicesFrom', () => {
  it('reads one excluded team and many, however Next hands the parameter back', () => {
    expect([...prizeChoicesFrom({ pass: 'team-12' }).passed]).toEqual(['team-12']);
    expect([...prizeChoicesFrom({ pass: ['team-12', 'team-13'] }).passed]).toEqual([
      'team-12',
      'team-13',
    ]);
  });

  it('reads the two draws and ignores everything else in the address', () => {
    const choices = prizeChoicesFrom({
      random_draw_1: 'team-13',
      random_draw_2: '',
      winner: 'team-99',
    });

    expect([...choices.draws]).toEqual([['random_draw_1', 'team-13']]);
  });

  it('is empty for an empty address, rather than throwing on one', () => {
    const choices = prizeChoicesFrom({});
    expect(choices.passed.size).toBe(0);
    expect(choices.draws.size).toBe(0);
  });
});

describe('resolvePrizeAwards', () => {
  it('gives the screen and the file the same answer from the same address', () => {
    // The property #205 asks for: the export re-reads the address rather than recomputing, so
    // two calls with the same choices are the same prize list.
    const query = { pass: ['team-12'], random_draw_1: 'team-16' };

    const onScreen = resolvePrizeAwards(PAYLOAD, prizeChoicesFrom(query));
    const inTheFile = resolvePrizeAwards(PAYLOAD, prizeChoicesFrom(query));

    expect(onScreen.map((award) => [award.kind, award.winner?.team.id ?? null])).toEqual(
      inTheFile.map((award) => [award.kind, award.winner?.team.id ?? null]),
    );
  });

  it('takes a passed team out of every award, not merely the one they won', () => {
    const clean = resolvePrizeAwards(PAYLOAD, prizeChoicesFrom({}));
    expect(winnerOf(clean, 'first_overall')?.team.id).toBe('team-12');

    const passed = resolvePrizeAwards(PAYLOAD, prizeChoicesFrom({ pass: 'team-12' }));
    expect(winnerOf(passed, 'first_overall')?.team.id).toBe('team-11');
    // ⚠️ Their band prize goes too. "They are not here" means every prize, or the same people
    // go on winning everything else.
    expect(winnerOf(passed, 'solo_male_vet50')).toBeNull();
  });

  it('fills a spot draw the presenter took, with no time beside it', () => {
    const awards = resolvePrizeAwards(
      PAYLOAD,
      prizeChoicesFrom({ random_draw_1: 'team-16' }),
    );
    const drawn = winnerOf(awards, 'random_draw_1');

    expect(drawn?.team.id).toBe('team-16');
    // No metric, because there was never one — a `00:00` beside a name is a claim about a race.
    expect(drawn?.metricLabel).toBe('');
  });

  it('ignores a drawn id that is not in the pool, rather than trusting the address', () => {
    // ⚠️ A stale or invented id means the draw has not been made. The honest answer, and the
    // one that cannot promote somebody the pool already excluded.
    for (const chosen of ['team-12', 'not-a-team']) {
      const awards = resolvePrizeAwards(
        PAYLOAD,
        prizeChoicesFrom({ random_draw_1: chosen }),
      );
      expect(winnerOf(awards, 'random_draw_1')).toBeNull();
    }
  });
});

describe('drawablePool', () => {
  it('will not offer the team the other spot prize already took', () => {
    const choices = prizeChoicesFrom({ random_draw_2: 'team-16' });
    const awards = resolvePrizeAwards(PAYLOAD, choices);
    const first = awards.find((award) => award.kind === 'random_draw_1');

    const ids = drawablePool(first!, choices).map(
      (candidate: TeamWithRunners) => candidate.id,
    );

    expect(ids).not.toContain('team-16');
    // And the other draw still has it, because it is the one that took it.
    const second = awards.find((award) => award.kind === 'random_draw_2');
    expect(drawablePool(second!, choices).map((t: TeamWithRunners) => t.id)).toContain(
      'team-16',
    );
  });
});
