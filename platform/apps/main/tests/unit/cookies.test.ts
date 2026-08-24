import { describe, expect, it } from 'vitest';
import { cookieValue } from '../../worker/cookies';

/**
 * Moved out of `admin-session.test.ts` in #52, alongside the function it tests — the same
 * parser now has a second caller in `session.ts`.
 */

describe('cookieValue', () => {
  it('finds one cookie among several, however the header is spaced', () => {
    expect(cookieValue('a=1; nn_admin=xyz; b=2', 'nn_admin')).toBe('xyz');
    expect(cookieValue('a=1;nn_admin=xyz;b=2', 'nn_admin')).toBe('xyz');
  });

  it('does not match a cookie whose name merely ends with the one asked for', () => {
    expect(cookieValue('not_nn_admin=xyz', 'nn_admin')).toBeNull();
  });

  it('keeps a value containing an equals sign', () => {
    // Only the first `=` separates name from value. Base64url has no padding so this should
    // never arise, and a parser that got it wrong would fail in a way nobody could read.
    expect(cookieValue('nn_admin=a=b=c', 'nn_admin')).toBe('a=b=c');
  });

  it('returns null for a null header', () => {
    expect(cookieValue(null, 'nn_admin')).toBeNull();
  });
});
