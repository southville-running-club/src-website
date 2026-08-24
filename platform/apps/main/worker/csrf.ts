/**
 * A double-submit CSRF token, needed from #52 onward because the session cookie is
 * `SameSite=Lax` rather than `Strict` — see `session.ts`'s file header and ADR-015.
 *
 * ## Why double-submit, and not something bound to the session
 *
 * The token lives in its own cookie and is echoed in a hidden form field; a `POST` is
 * accepted only when the two match. It carries no relationship to the access or refresh
 * token on purpose — [ADR-013](../../../docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md)
 * named the failure mode a session-bound token has when it declined one entirely: *"a token
 * expires mid-form and somebody loses what they typed."* A double-submit token survives a
 * token refresh mid-form for the same reason it survives anything else about the session
 * changing underneath it — it is not asking the session anything.
 *
 * ## Why this defeats a cross-site attacker
 *
 * `SameSite=Lax` still withholds every cookie from a cross-site `POST` — the gap `Lax`
 * opens over `Strict` is only a top-level navigation, and nothing here is one. So a form on
 * another origin cannot read this cookie to put its value in the hidden field: the browser
 * never sends the CSRF cookie with the forged request in the first place, and the field is
 * left blank or guessed, which fails the comparison below.
 */

/** The cookie's name. Not `HttpOnly` — the page has to read it to put it in the form. */
export const CSRF_COOKIE = 'src_csrf';

/** The hidden field name every state-changing form must carry. */
export const CSRF_FIELD = 'csrf_token';

/**
 * Compare two tokens without leaking where they diverge — the same shape
 * `admin-session.ts`'s `equalConstantTime` uses, and not shared with it: each is a small,
 * self-contained helper next to the one comparison it protects, not a dependency between
 * two otherwise-unrelated session mechanisms.
 */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A fresh token. 256 bits, the same budget `admin-session.ts` gives its HMAC. */
export function mintCsrfToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

export function csrfCookie(token: string, secure: boolean): string {
  return [
    `${CSRF_COOKIE}=${token}`,
    'Path=/',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/**
 * Whether a submitted form may proceed: the cookie is present, the field is present, and
 * they match exactly. **Any absence is a refusal** — a form from a browser with cookies
 * cleared mid-visit is indistinguishable from a forged one, and both are refused the same
 * way a missing session is: by asking again rather than by explaining why.
 */
export function csrfOk(cookieToken: string | null, fieldToken: string | null): boolean {
  if (cookieToken === null || fieldToken === null) {
    return false;
  }

  if (cookieToken === '' || fieldToken === '') {
    return false;
  }

  return equalConstantTime(cookieToken, fieldToken);
}
