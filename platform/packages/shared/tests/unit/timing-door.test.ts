import { describe, expect, it } from 'vitest';
import { holdsAnyTimingPermission } from '../../src/timing/door';

/**
 * The rule `/timing/`'s door and `/account/`'s link both ask.
 *
 * The permission lists are the real ones from `identity-permissions.test.ts`, so a role that
 * gains or loses a timing permission is caught there and this stays about the predicate.
 */
describe('holdsAnyTimingPermission', () => {
  it('opens the door to a timing-marshal, who holds one permission', () => {
    expect(holdsAnyTimingPermission(['timing.crossing.record'])).toBe(true);
  });

  it('opens the door to a timing-admin', () => {
    expect(
      holdsAnyTimingPermission([
        'timing.crossing.record',
        'timing.crossing.resolve',
        'timing.event.manage',
        'timing.marshal.assign',
        'timing.registration.import',
        'timing.result.publish',
      ]),
    ).toBe(true);
  });

  it('keeps it shut to a nn-admin, who holds nothing under timing', () => {
    expect(
      holdsAnyTimingPermission([
        'nn.email.read',
        'nn.email.resend',
        'nn.entry.cancel',
        'nn.entry.create',
        'nn.entry.export',
        'nn.entry.read',
      ]),
    ).toBe(false);
  });

  it('keeps it shut to somebody holding nothing at all', () => {
    expect(holdsAnyTimingPermission([])).toBe(false);
  });

  it('reads the namespace, not a substring', () => {
    // `nn.results.read` is about timing's output and is not a timing permission — the reason
    // the prefix carries its dot and is tested from the start of the slug.
    expect(holdsAnyTimingPermission(['nn.results.read'])).toBe(false);
    expect(holdsAnyTimingPermission(['timingx.event.manage'])).toBe(false);
    expect(holdsAnyTimingPermission(['nn.timing.read'])).toBe(false);
  });
});
