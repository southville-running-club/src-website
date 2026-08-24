import { describe, expect, it } from 'vitest';
import { createUserClient } from '../../src/supabase';

/**
 * `createUserClient()` guards the same two things `createAnonClient()` does — never a
 * service-role key, never missing configuration — and adds the one thing that makes it a
 * *user's* client: the access token riding as a bearer header, which is what lets
 * `auth.uid()` resolve to somebody in the database.
 */

const CONFIG = { url: 'http://127.0.0.1:54321', anonKey: 'zz-anon-key' };

describe('createUserClient', () => {
  it('refuses configuration that looks unset', () => {
    expect(() => createUserClient({ url: '', anonKey: '' }, 'zz-token')).toThrow(
      /not configured/,
    );
  });

  it('refuses a key shaped like a service role key', () => {
    expect(() =>
      createUserClient({ url: CONFIG.url, anonKey: 'sb_secret_whatever' }, 'zz-token'),
    ).toThrow(/service role/);

    expect(() =>
      createUserClient(
        { url: CONFIG.url, anonKey: 'contains-service_role-somewhere' },
        'zz-token',
      ),
    ).toThrow(/service role/);
  });

  it('builds a client carrying the access token as a bearer header', () => {
    const client = createUserClient(CONFIG, 'zz-access-token');

    // supabase-js exposes what it was built with on `.headers` — asserted here rather than
    // trusted, because a client silently missing the Authorization header would still
    // "work": PostgREST would simply treat every request as anon, and RLS would filter to
    // nothing rather than error, which reads as an empty result rather than a defect.
    const headers = (client as unknown as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer zz-access-token');
  });
});
