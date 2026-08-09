import type { AnonClient } from './supabase';

/**
 * The second half of the pipeline-validation pair — `intake.ping()`, alongside
 * `intake.health()`. Where `health` proves the pipeline once, `ping` proves it again for a
 * migration added afterward: it went through CI's migration-scope guard, `supabase db
 * push` on merge, and a deploy of both applications, exactly as `health` did the first
 * time.
 *
 * @see docs/architecture/decisions/adr-002-schema-layout.md
 */

export type PingResult = { ok: true; value: string } | { ok: false; error: string };

export async function fetchPing(client: AnonClient): Promise<PingResult> {
  const { data, error } = await client.schema('intake').rpc('ping');

  if (error) {
    // Rendered rather than thrown, matching fetchHealth: this is a connectivity check, so
    // "it did not connect" is the useful answer, not a 500. Nothing here can contain
    // personal data — the function reads none.
    return { ok: false, error: error.message };
  }

  if (typeof data !== 'string') {
    return { ok: false, error: `Expected a string, got ${typeof data}` };
  }

  return { ok: true, value: data };
}
