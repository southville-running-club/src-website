/**
 * One cookie out of a `Cookie` header.
 *
 * Written out rather than reached for from a library: the header is a semicolon-separated list
 * where only the first `=` separates name from value, and a session token is base64url, which
 * contains no `=` at all once the padding is stripped. Both halves are trimmed because a
 * browser writes `a=1; b=2` and a test is liable to write `a=1;b=2`.
 *
 * Moved here from `admin-session.ts` in #52, which is about to have a second caller —
 * `session.ts`'s two account cookies rather than `admin-session.ts`'s one.
 */
export function cookieValue(header: string | null, name: string): string | null {
  if (header === null) {
    return null;
  }

  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) {
      continue;
    }

    if (part.slice(0, at).trim() === name) {
      return part.slice(at + 1).trim();
    }
  }

  return null;
}
