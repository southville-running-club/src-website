import { describe, expect, it } from 'vitest';
import type { PrizeAward } from '@src/shared/timing/prize-export';
import { buildPrizeRows } from '@src/shared/timing/prize-export';
import {
  buildReels,
  FACE_DOWN,
  FIRST_STOP_MS,
  landingAnnouncement,
  reelNumberFor,
  spinMs,
  STOP_STAGGER_MS,
  withoutSpin,
  withSpin,
} from '../../lib/prize-reel';

/**
 * The presenter's slot-machine reveal — `lib/prize-reel.ts`.
 *
 * ⚠️ **The property that matters is that a reel lands on the winner the file names**, and only
 * ever on digits on the way there: the presenter is a projector in a public room before the
 * results are published, so nothing a reel shows may be anybody else's.
 */

type Winner = NonNullable<PrizeAward['winner']>;

function team(
  overrides: Partial<{
    team_number: string | null;
    bib_leg1: string | null;
    bib_leg2: string | null;
  }> = {},
) {
  return {
    id: 'team-1',
    team_number: '007',
    bib_leg1: null,
    bib_leg2: null,
    category: null,
    race_status: null,
    dnf_at: null,
    runners: [
      {
        id: 'r-1',
        leg: 1,
        firstname: 'Grace',
        lastname: 'Hopper',
        gender: 'female',
        result_placement: null,
        role: 'runner',
        age_on_day: 52,
      },
      {
        id: 'r-2',
        leg: 2,
        firstname: 'Ada',
        lastname: 'Lovelace',
        gender: 'female',
        result_placement: null,
        role: 'runner',
        age_on_day: 36,
      },
    ],
    ...overrides,
  };
}

const teamWinner = (t = team()): Winner => ({
  type: 'team',
  team: t,
  metricMs: 2_400_000,
  metricLabel: '0:40:00',
});

const runnerWinner = (leg: 1 | 2, t = team()): Winner => ({
  type: 'runner',
  team: t,
  runner: t.runners[leg - 1]!,
  leg,
  metricMs: 1_200_000,
  metricLabel: '0:20:00',
});

describe('reelNumberFor', () => {
  it('lands a solo winner on their race number, leading zeros and all', () => {
    expect(reelNumberFor(teamWinner(), 'solo')).toEqual({ label: 'Bib', value: '007' });
  });

  it('lands on a bib the desk wrote in rather than the one the team number derives', () => {
    expect(reelNumberFor(teamWinner(team({ bib_leg1: '250' })), 'solo')).toEqual({
      label: 'Bib',
      value: '250',
    });
  });

  it('lands a relay leg award on the bib of the leg it was won on', () => {
    expect(reelNumberFor(runnerWinner(1), 'relay')).toEqual({
      label: 'Bib',
      value: '1007',
    });
    expect(reelNumberFor(runnerWinner(2), 'relay')).toEqual({
      label: 'Bib',
      value: '2007',
    });
  });

  it('lands a relay team award on the team number, since a pair wears two bibs', () => {
    expect(reelNumberFor(teamWinner(), 'relay')).toEqual({ label: 'Team', value: '007' });
  });

  it('has nothing to land on before bibs are assigned', () => {
    expect(reelNumberFor(teamWinner(team({ team_number: null })), 'solo')).toBeNull();
    expect(reelNumberFor(teamWinner(team({ team_number: null })), 'relay')).toBeNull();
    expect(
      reelNumberFor(runnerWinner(1, team({ team_number: null })), 'relay'),
    ).toBeNull();
  });

  /**
   * ⚠️ **The projector and the file may not disagree** — #205's rule for the winner, applied to
   * the number. The file prints the bib through `prize-export.ts`; the reels land on it through
   * the same `runnerBibs()`.
   */
  it('lands on the same bib the prize export prints for the same winner', () => {
    for (const [winner, format] of [
      [teamWinner(team({ bib_leg1: '042' })), 'solo'],
      [runnerWinner(2), 'relay'],
      [runnerWinner(1, team({ bib_leg1: '311' })), 'relay'],
    ] as const) {
      const award = {
        kind: 'solo_female_1st',
        title: '1st Female',
        subtitle: 'Fastest female runner',
        winner,
      } as PrizeAward;
      const [row] = buildPrizeRows([award], format);
      expect(reelNumberFor(winner, format)?.value).toBe(row?.bibs);
    }
  });
});

describe('buildReels', () => {
  it('makes one reel per character, each ending on its own digit', () => {
    const reels = buildReels('701');
    expect(reels.map((reel) => reel.target)).toEqual(['7', '0', '1']);
    expect(reels.map((reel) => reel.strip.at(-1))).toEqual(['7', '0', '1']);
  });

  it('starts every reel face down, as the card was before Reveal', () => {
    for (const reel of buildReels('8042')) expect(reel.strip[0]).toBe(FACE_DOWN);
  });

  /** The decision this module's header argues: a reel shows digits, never anybody's name. */
  it('passes nothing but digits on the way', () => {
    for (const reel of buildReels('250')) {
      expect(reel.strip.slice(1).every((cell) => /^[0-9]$/u.test(cell))).toBe(true);
    }
  });

  it('counts up one digit at a time, so the reel reads as turning rather than flickering', () => {
    const [reel] = buildReels('3');
    const digits = reel!.strip.slice(1).map(Number);
    for (let index = 1; index < digits.length; index += 1) {
      expect(digits[index]).toBe((digits[index - 1]! + 1) % 10);
    }
  });

  it('turns each reel further than the last and lands them left to right', () => {
    const reels = buildReels('999');
    expect(reels.map((reel) => reel.strip.length)).toEqual([21, 31, 41]);
    expect(reels.map((reel) => reel.stopMs)).toEqual([
      FIRST_STOP_MS,
      FIRST_STOP_MS + STOP_STAGGER_MS,
      FIRST_STOP_MS + 2 * STOP_STAGGER_MS,
    ]);
  });

  it('is the same every time, because nothing about it is random', () => {
    expect(buildReels('123')).toEqual(buildReels('123'));
  });

  it('takes a character that is not a digit straight from face down to itself', () => {
    expect(buildReels('A')).toEqual([
      { target: 'A', strip: [FACE_DOWN, 'A'], stopMs: FIRST_STOP_MS },
    ]);
  });
});

describe('spinMs', () => {
  it('is when the last reel lands, and nothing for no reels', () => {
    expect(spinMs(buildReels('701'))).toBe(FIRST_STOP_MS + 2 * STOP_STAGGER_MS);
    expect(spinMs([])).toBe(0);
  });
});

describe('withSpin and withoutSpin', () => {
  const revealed = '/timing/events/nn-2026/prizes?present=1&prize=7&reveal=1&pass=team-3';

  it('adds the one-shot spin to a reveal address and takes it back out', () => {
    const spun = withSpin(revealed);
    expect(spun).toBe(`${revealed}&spin=1`);
    expect(withoutSpin(spun)).toBe(revealed);
  });

  it('keeps every pass-over and draw when it takes the spin out', () => {
    const spun = withSpin(`${revealed}&random_draw_1=team-9`);
    const back = new URL(withoutSpin(spun), 'http://x').searchParams;
    expect(back.getAll('pass')).toEqual(['team-3']);
    expect(back.get('random_draw_1')).toBe('team-9');
    expect(back.has('spin')).toBe(false);
  });

  it('reads an absolute address, as the page’s own location is', () => {
    expect(withoutSpin(`https://example.com${revealed}&spin=1`)).toBe(revealed);
  });

  it('starts a query string when there is none, and leaves a fragment at the end', () => {
    expect(withSpin('/prizes')).toBe('/prizes?spin=1');
    expect(withSpin('/prizes?prize=2#top')).toBe('/prizes?prize=2&spin=1#top');
  });
});

describe('landingAnnouncement', () => {
  it('says the name, the number and the time, once, in one sentence', () => {
    expect(
      landingAnnouncement('Grace Hopper', { label: 'Bib', value: '701' }, '0:40:00'),
    ).toBe('Grace Hopper, Bib 701, 0:40:00');
  });

  it('leaves out what there is not — a spot prize has no time', () => {
    expect(landingAnnouncement('Grace Hopper', { label: 'Team', value: '47' }, '')).toBe(
      'Grace Hopper, Team 47',
    );
    expect(landingAnnouncement('Grace Hopper', null, '')).toBe('Grace Hopper');
  });
});
