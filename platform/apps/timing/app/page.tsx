import { createAnonClient, fetchHealth } from '@src/shared';

// Rendered on every request, never cached.
//
// The whole point of this page is to report the state of a live connection, and a cached
// answer to "can you reach the database" is not an answer. The real timing app has the
// same property for a different reason: a leaderboard that serves a cached crossing is
// worse than one that is slow.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const health = await readHealth();

  return (
    <>
      <h1>Race timing</h1>

      <p className="lede">
        There is nothing here yet. The timing platform still runs from its existing
        deployment; this page exists to prove the path it will move onto — a Cloudflare
        Worker on the club&rsquo;s own domain, reading the club&rsquo;s own database.
      </p>

      <h2>What this page proves</h2>

      <p>
        Next.js is running under <code>@opennextjs/cloudflare</code> in the Workers
        runtime, and reached Postgres while serving this request. The timestamp is
        rendered server-side, so it is here with JavaScript disabled.
      </p>

      <dl className="status">
        <dt>Database time, Europe/London</dt>
        <dd>
          {health.ok ? (
            // The machine-readable value is UTC and the visible text is Europe/London,
            // which is the storage-and-display rule expressed in one element.
            <time data-health="ok" dateTime={health.at.toISOString()}>
              {health.formatted}
            </time>
          ) : (
            <span data-health="error">Could not reach the database — {health.error}</span>
          )}
        </dd>

        <dt>Served by</dt>
        <dd>Cloudflare Workers, via @opennextjs/cloudflare</dd>

        <dt>Application</dt>
        <dd>apps/timing</dd>
      </dl>

      <footer>
        <p>
          Southville Running Club. The live leaderboard and marshal screens are not part
          of this deployment yet.
        </p>
      </footer>
    </>
  );
}

async function readHealth() {
  // A failure is rendered rather than thrown: this page's job is to report whether the
  // connection works, so "it does not" is the useful answer, not a 500.
  try {
    const client = createAnonClient({
      url: process.env.PUBLIC_SUPABASE_URL ?? '',
      anonKey: process.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
    });
    return await fetchHealth(client);
  } catch (cause) {
    return {
      ok: false as const,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
