import type { AnonClient } from './supabase';
import { formatLondon } from './london-time';

/**
 * The skeleton's one database call, and the reason it exists.
 *
 * `intake.health()` returns `now()`. Rendering it on a page proves, in a single hop, that
 * the migration applied, the `intake` schema is exposed through PostgREST, the anon key
 * is right, the grant is right, the client is wired, and the Worker can reach the
 * network. Nothing else in the skeleton proves any of that, and every one of them is a
 * thing that fails silently until something depends on it.
 *
 * It is deliberately *not* a table. Where rows land is
 * [ADR-002](docs/architecture/decisions/adr-002-schema-layout.md)'s decision, and none of
 * it is needed to prove a pipeline.
 *
 * @see docs/architecture/decisions/adr-002-schema-layout.md
 */

export type HealthResult =
  { ok: true; at: Date; formatted: string } | { ok: false; error: string };

export async function fetchHealth(client: AnonClient): Promise<HealthResult> {
  const { data, error } = await client.schema('intake').rpc('health');

  if (error) {
    // The message is surfaced on the page on purpose: this page's whole job is to say
    // whether the connection works, so a failure is the useful answer, not an outage.
    // Nothing here can contain personal data — there is none in the database.
    return { ok: false, error: error.message };
  }

  if (typeof data !== 'string') {
    return { ok: false, error: `Expected a timestamp, got ${typeof data}` };
  }

  const at = new Date(data);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, error: `Not a valid timestamp: ${data}` };
  }

  return { ok: true, at, formatted: formatLondon(at) };
}
