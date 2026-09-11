/**
 * The bib contract, copied with the module it guards.
 *
 * **These assertions are the reason `bib.ts` could be copied rather than rewritten.** They
 * came across from `bindalshah/src-race-timing`'s `lib/bib.test.ts` unchanged apart from the
 * import path — which is the point: a port whose tests were also rewritten proves nothing
 * about what it ported.
 *
 * ⚠️ **They are also one half of a lockstep.** The bib a crossing resolves to is computed
 * here in TypeScript and again in Postgres, and the two must agree. These cases document the
 * TypeScript half; the database half needs its own, against a real Postgres, when the
 * `timing` schema lands. Until then this file is the only thing holding the contract, and
 * that is worth knowing rather than assuming.
 */

import { describe, it, expect } from 'vitest';
import {
  derivedBib,
  effectiveBib,
  teamEffectiveBibs,
  findBibCollision,
  findBibCollisionForBibs,
  bibClashMessage,
  validateBib,
  normalizeOverride,
  type GuardTeam,
  type BibTeam,
} from '../../src/timing/bib';

// A CSV-imported team: null overrides → resolves on derived bibs.
function csv(teamNumber: string | null): BibTeam {
  return { team_number: teamNumber, bib_leg1: null, bib_leg2: null };
}
// A walk-in team: stored (override) bibs.
function walkin(
  teamNumber: string | null,
  leg1: string | null,
  leg2: string | null,
): BibTeam {
  return { team_number: teamNumber, bib_leg1: leg1, bib_leg2: leg2 };
}

describe('derivedBib', () => {
  it('relay is leg-first: team 47 → 147 / 247', () => {
    expect(derivedBib('47', 1, 'relay')).toBe('147');
    expect(derivedBib('47', 2, 'relay')).toBe('247');
  });
  it('preserves leading zeros (opaque): team 01 → 101 / 201', () => {
    expect(derivedBib('01', 1, 'relay')).toBe('101');
    expect(derivedBib('01', 2, 'relay')).toBe('201');
  });
  it('4-digit team numbers are fine: team 100 → 1100 / 2100', () => {
    expect(derivedBib('100', 1, 'relay')).toBe('1100');
    expect(derivedBib('100', 2, 'relay')).toBe('2100');
  });
  it('solo has no leg prefix — the bib IS the team number', () => {
    expect(derivedBib('147', 1, 'solo')).toBe('147');
    expect(derivedBib('147', 2, 'solo')).toBe('147');
  });
  it('null team_number → null (team imported before bib assignment)', () => {
    expect(derivedBib(null, 1, 'relay')).toBeNull();
  });
});

describe('effectiveBib — coalesce(override, derived)', () => {
  it('CSV team (null overrides) resolves EXACTLY as before — regression', () => {
    const t = csv('22');
    expect(effectiveBib(t, 1, 'relay')).toBe('122');
    expect(effectiveBib(t, 2, 'relay')).toBe('222');
  });
  it('override wins over derived, verbatim (opaque)', () => {
    const t = walkin('47', '150', '250');
    expect(effectiveBib(t, 1, 'relay')).toBe('150');
    expect(effectiveBib(t, 2, 'relay')).toBe('250');
  });
  it('a single-leg override coexists with a derived other leg', () => {
    const t = walkin('47', '150', null);
    expect(effectiveBib(t, 1, 'relay')).toBe('150'); // override
    expect(effectiveBib(t, 2, 'relay')).toBe('247'); // derived
  });
  it('does NOT leading-zero-normalise: 0311 stays 0311', () => {
    const t = walkin('47', '0311', '0312');
    expect(effectiveBib(t, 1, 'relay')).toBe('0311');
  });
  it('empty-string override is treated as absent (falls to derived)', () => {
    const t = walkin('47', '', '  ');
    expect(effectiveBib(t, 1, 'relay')).toBe('147');
    expect(effectiveBib(t, 2, 'relay')).toBe('247');
  });
  it('solo: override in bib_leg1 wins over the team_number', () => {
    expect(effectiveBib(walkin('55', '900', null), 1, 'solo')).toBe('900');
    expect(effectiveBib(csv('55'), 1, 'solo')).toBe('55');
  });
});

describe('teamEffectiveBibs', () => {
  it('relay yields both legs', () => {
    expect(teamEffectiveBibs(csv('47'), 'relay')).toEqual([
      { leg: 1, bib: '147' },
      { leg: 2, bib: '247' },
    ]);
  });
  it('solo yields a single leg', () => {
    expect(teamEffectiveBibs(csv('47'), 'solo')).toEqual([{ leg: 1, bib: '47' }]);
  });
  it('omits legs with no resolvable bib', () => {
    expect(teamEffectiveBibs(csv(null), 'relay')).toEqual([]);
  });
});

describe('findBibCollision — hard-block guard', () => {
  const guard = (
    id: string | null,
    teamNumber: string | null,
    leg1: string | null,
    leg2: string | null,
    name: string | null = null,
  ): GuardTeam => ({ id, team_number: teamNumber, name, bib_leg1: leg1, bib_leg2: leg2 });

  it("passes when the target's bibs are unique", () => {
    const target = guard(null, '100', null, null); // walk-in, derived 1100/2100
    const others = [guard('a', '47', null, null), guard('b', '48', null, null)];
    expect(findBibCollision(target, others, 'relay')).toBeNull();
  });

  it("catches a walk-in override colliding with a CSV team's DERIVED bib", () => {
    // Walk-in team 13 handed physical bib 131 → clashes with CSV team 31's
    // derived leg-1 bib 131. The cross-scheme collision the guard must stop.
    const target = guard(null, '13', '131', '132');
    const others = [guard('t31', '31', null, null, 'The Ashtons')];
    const clash = findBibCollision(target, others, 'relay');
    expect(clash).not.toBeNull();
    expect(clash!.bib).toBe('131');
    expect(clash!.leg).toBe(1);
    expect(clash!.withTeamNumber).toBe('31');
    expect(clash!.withLeg).toBe(1);
    expect(bibClashMessage(clash!)).toContain('team 31 (The Ashtons)');
  });

  it('catches override-vs-override collision', () => {
    const target = guard(null, '60', '150', '250');
    const others = [guard('x', '47', '150', '260')];
    const clash = findBibCollision(target, others, 'relay');
    expect(clash!.bib).toBe('150');
    expect(clash!.withLeg).toBe(1);
  });

  it('enforces leg1 != leg2 within the target team', () => {
    const target = guard('z', '70', '199', '199');
    const clash = findBibCollision(target, [], 'relay');
    expect(clash!.sameTeam).toBe(true);
    expect(bibClashMessage(clash!)).toBe("Leg 1 and leg 2 can't share bib 199.");
  });

  it('does not flag a team against itself (re-saving unchanged)', () => {
    const t = guard('self', '47', '150', '250');
    // 'others' still contains the same team by id — must be skipped.
    expect(findBibCollision(t, [t], 'relay')).toBeNull();
  });

  it('solo: only leg-1 participates', () => {
    const target = guard(null, '80', '900', null);
    const others = [guard('s', '81', '900', null)];
    const clash = findBibCollision(target, others, 'solo');
    expect(clash!.bib).toBe('900');
    expect(clash!.leg).toBe(1);
  });
});

describe('findBibCollisionForBibs — single-leg (solo / 1-runner) guard', () => {
  const guard = (
    id: string | null,
    teamNumber: string | null,
    leg1: string | null,
    leg2: string | null,
    name: string | null = null,
  ): GuardTeam => ({ id, team_number: teamNumber, name, bib_leg1: leg1, bib_leg2: leg2 });

  it("catches a solo's DERIVED leg-1 bib colliding with an existing override", () => {
    // Solo team 55, leg 1 → derived "155". An earlier full walk-in stored
    // override "155". The full-add guard couldn't see team 55 (it didn't
    // exist yet); the solo add must catch it now.
    const others = [guard('w', '40', '155', '255', 'Early Birds')];
    const clash = findBibCollisionForBibs(
      { id: null, teamNumber: '55', name: null, bibs: [{ leg: 1, bib: '155' }] },
      others,
      'relay',
    );
    expect(clash).not.toBeNull();
    expect(clash!.bib).toBe('155');
    expect(clash!.withTeamNumber).toBe('40');
  });

  it("does NOT false-block on the solo's UNOCCUPIED leg", () => {
    // Solo team 55 occupies only leg 1 ("155"). Another team holds override
    // "255" (== team 55's unused leg-2 derived) — but since we only guard the
    // occupied leg, the solo add is allowed.
    const others = [guard('w', '40', '150', '255')];
    const clash = findBibCollisionForBibs(
      { id: null, teamNumber: '55', name: null, bibs: [{ leg: 1, bib: '155' }] },
      others,
      'relay',
    );
    expect(clash).toBeNull();
  });
});

describe('validateBib', () => {
  it('accepts adhoc digit bibs (walk-in pool 1–99) and longer ones', () => {
    expect(validateBib(' 50 ')).toEqual({ ok: true, value: '50' });
    expect(validateBib('1')).toEqual({ ok: true, value: '1' });
    expect(validateBib('2100')).toEqual({ ok: true, value: '2100' });
  });
  it('preserves leading zeros (opaque)', () => {
    expect(validateBib('05')).toEqual({ ok: true, value: '05' });
  });
  it('rejects empty and non-digit', () => {
    expect(validateBib('').ok).toBe(false);
    expect(validateBib('  ').ok).toBe(false);
    expect(validateBib('14a').ok).toBe(false);
  });
});

describe('normalizeOverride', () => {
  it('stores null when the typed bib equals the derived bib (stays CSV/derived)', () => {
    expect(normalizeOverride('147', '47', 1, 'relay')).toBeNull();
    expect(normalizeOverride('247', '47', 2, 'relay')).toBeNull();
  });
  it('stores null for an empty value', () => {
    expect(normalizeOverride('  ', '47', 1, 'relay')).toBeNull();
  });
  it('stores a genuinely different pool bib verbatim', () => {
    expect(normalizeOverride('150', '47', 1, 'relay')).toBe('150');
    expect(normalizeOverride('0311', '47', 1, 'relay')).toBe('0311');
  });
});

// ---------------------------------------------------------------------------
// Resolution parity: documents the contract the Postgres trigger
// (private.resolve_crossing_team_id) MUST mirror. resolveByBib here replicates
// the SQL match against effectiveBib; if the SQL and TS ever drift, these
// override-first / derived-fallback / solo cases are the tripwire.
// ---------------------------------------------------------------------------
type ResolveTeam = GuardTeam;
function resolveByBib(
  teams: ResolveTeam[],
  bib: string,
  format: 'relay' | 'solo',
): string | null {
  // Override matches win over derived (mirrors the SQL ORDER BY).
  const overrideHit = teams.find((t) => t.bib_leg1 === bib || t.bib_leg2 === bib);
  if (overrideHit) return overrideHit.id;
  const derivedHit = teams.find((t) =>
    teamEffectiveBibs(t, format).some((b) => b.bib === bib),
  );
  return derivedHit?.id ?? null;
}

describe('bib → team_id resolution parity (SQL trigger contract)', () => {
  const teams: ResolveTeam[] = [
    { id: 't22', team_number: '22', name: null, bib_leg1: null, bib_leg2: null }, // CSV
    { id: 't13', team_number: '13', name: null, bib_leg1: '150', bib_leg2: '250' }, // walk-in
  ];

  it('CSV derived bibs still resolve to their team — regression', () => {
    expect(resolveByBib(teams, '122', 'relay')).toBe('t22');
    expect(resolveByBib(teams, '222', 'relay')).toBe('t22');
  });
  it('walk-in override bibs resolve to the walk-in team', () => {
    expect(resolveByBib(teams, '150', 'relay')).toBe('t13');
    expect(resolveByBib(teams, '250', 'relay')).toBe('t13');
  });
  it("the walk-in's DERIVED bibs (113/213) resolve to nothing (overridden)", () => {
    // Walk-in team 13 is overridden to 150/250, so its derived 113/213
    // belong to no one — a crossing typed as 113 is an orphan (team_id NULL).
    expect(resolveByBib(teams, '113', 'relay')).toBeNull();
    expect(resolveByBib(teams, '213', 'relay')).toBeNull();
  });
  it('an unknown bib is an orphan (team_id NULL)', () => {
    expect(resolveByBib(teams, '999', 'relay')).toBeNull();
  });
});
