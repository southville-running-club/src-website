import { describe, expect, it } from 'vitest';
import { csrfCookie, csrfOk, mintCsrfToken } from '../../worker/csrf';

describe('csrfOk', () => {
  it('accepts a cookie and field that match', () => {
    const token = mintCsrfToken();
    expect(csrfOk(token, token)).toBe(true);
  });

  it('refuses a missing cookie', () => {
    expect(csrfOk(null, mintCsrfToken())).toBe(false);
  });

  it('refuses a missing field — the form was not submitted with one', () => {
    expect(csrfOk(mintCsrfToken(), null)).toBe(false);
  });

  it('refuses two empty strings', () => {
    // Distinct from "missing" in how a form library might report it, and must fail the
    // same way — an empty token proves nothing.
    expect(csrfOk('', '')).toBe(false);
  });

  it("refuses a token from a different browser — cookie and field don't match", () => {
    expect(csrfOk(mintCsrfToken(), mintCsrfToken())).toBe(false);
  });

  it('refuses tokens that merely share a length', () => {
    const token = mintCsrfToken();
    const flipped = token[0] === 'A' ? `B${token.slice(1)}` : `A${token.slice(1)}`;
    expect(csrfOk(token, flipped)).toBe(false);
  });
});

describe('mintCsrfToken', () => {
  it('never mints the same token twice', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => mintCsrfToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('csrfCookie, Secure over http and over https', () => {
  it('is present only when the request arrived over https', () => {
    expect(csrfCookie('zz-token', true)).toContain('Secure');
    expect(csrfCookie('zz-token', false)).not.toContain('Secure');
  });

  it('is SameSite=Lax and scoped to the whole site, and not HttpOnly', () => {
    const cookie = csrfCookie('zz-token', true);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    // Not HttpOnly: the page has to read this cookie to put it in the hidden field.
    expect(cookie).not.toContain('HttpOnly');
  });
});
