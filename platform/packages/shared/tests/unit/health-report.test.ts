import { describe, expect, it } from 'vitest';
import {
  buildHealthReport,
  healthReportFromFailure,
  healthResponse,
} from '../../src/health-report';
import { ok, pgError, rpcClient } from './support/rpc-client';

/**
 * The health report, which is **the contract `scripts/smoke.mjs` reads**.
 *
 * Both applications answer this same shape from this same function — `/_health` in `apps/main`
 * and `/timing/health` in `apps/timing` — and the smoke test parses one shape rather than
 * scraping two pages. That makes this module a published interface between the repository and
 * the only check that runs against the deployed platform, and the assertions below are the
 * ones `reportsHealthy` in that script depends on:
 *
 *   `database.ok`, `pipeline.ok`, `pipeline.value`, the top-level `ok`, and the **status code**.
 *
 * Change any of those five and the smoke test starts reporting a healthy platform as broken,
 * or — much worse — a broken one as healthy. It runs daily and on every push to main, and
 * nobody would be watching when it happened.
 *
 * The round trips themselves are proven against a real Postgres in `packages/db/tests/` and
 * end to end by the smoke test. Nothing here asserts that Supabase works.
 */

/** Race morning, with the fractional seconds Postgres renders — so it round-trips exactly. */
const AT = '2026-11-01T11:00:00.000Z';

describe('the status code, which is half the contract', () => {
  it('answers 200 only when both round trips succeeded', () => {
    const response = healthResponse({
      ok: true,
      database: { ok: true, at: AT, formatted: '1 November 2026 at 11:00 GMT' },
      pipeline: { ok: true, value: 'pipeline-ok' },
    });

    expect(response.status).toBe(200);
  });

  it('answers 503 when the report says it is not ok', () => {
    // **The assertion this file exists for.** A monitor that only reads status codes has to
    // get the same answer as one that parses the body — a health endpoint answering 200 while
    // saying `"ok": false` is precisely the shape that lets an outage sit behind a green tick
    // for a week. Cloudflare's own dashboard is one such monitor.
    const response = healthResponse({
      ok: false,
      database: { ok: false, error: 'connection refused' },
      pipeline: { ok: false, error: 'connection refused' },
    });

    expect(response.status).toBe(503);
  });

  it('serves the failure as a readable body rather than an empty error', async () => {
    // A 503 is the endpoint working correctly and saying the database is not, so the body is
    // still the interesting part — `smoke.mjs` reads it *before* it judges the status, and
    // would report "expected JSON, got something else" if this were empty.
    const response = healthResponse(
      healthReportFromFailure(new Error('bad SUPABASE_URL')),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      database: { ok: false, error: 'bad SUPABASE_URL' },
    });
  });

  it('is never cached, and never indexed', () => {
    // A cached answer to "can you reach the database" is not an answer. `noindex` because this
    // is an endpoint rather than a page and has no business in a search result — and because
    // `/_health` is spelled the way it is precisely to stay off the pages a runner finds.
    const response = healthResponse({
      ok: true,
      database: { ok: true, at: AT, formatted: '1 November 2026 at 11:00 GMT' },
      pipeline: { ok: true, value: 'pipeline-ok' },
    });

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

describe('a client that could not be built at all', () => {
  it('renders the reason rather than throwing it', () => {
    // A missing or malformed Supabase URL throws before any request is made. This endpoint's
    // whole job is to say whether the connection works, so "it does not, and here is why" is
    // the useful answer and a 500 with a stack trace is not.
    expect(healthReportFromFailure(new Error('Invalid URL'))).toEqual({
      ok: false,
      database: { ok: false, error: 'Invalid URL' },
      pipeline: { ok: false, error: 'Invalid URL' },
    });
  });

  it('survives something thrown that is not an Error', () => {
    expect(healthReportFromFailure('nope')).toMatchObject({
      ok: false,
      database: { ok: false, error: 'nope' },
    });
  });
});

describe('building the report', () => {
  /** Answers `health()` and `ping()` the way a working database does. */
  const healthy = rpcClient((call) =>
    call.fn === 'health' ? ok(AT) : ok('pipeline-ok'),
  ).client;

  it('reports both round trips, and the pipeline value the smoke test checks', async () => {
    const report = await buildHealthReport(healthy);

    expect(report.ok).toBe(true);
    expect(report.database).toMatchObject({ ok: true, at: AT });
    // **`pipeline-ok` is asserted as a literal on purpose.** `intake.ping()` was added *after*
    // the first deploy, so this value arriving is what proves a migration went through CI's
    // scope guard, `supabase db push` on merge, and a deploy of both applications. The smoke
    // test compares against this exact string.
    expect(report.pipeline).toEqual({ ok: true, value: 'pipeline-ok' });
  });

  it('formats the instant for London while storing it as UTC', async () => {
    // The storage-and-display rule, kept in the payload so a smoke test reading the wrong hour
    // on the clocks-change weekend can say so. This suite pins TZ=UTC, which is exactly why the
    // formatted half must not come from the ambient zone.
    const report = await buildHealthReport(healthy);

    expect(report.database).toMatchObject({ ok: true });
    if (!report.database.ok) return;
    expect(report.database.at).toBe(new Date(AT).toISOString());
    expect(report.database.formatted).toMatch(/1 November 2026 .*(GMT|BST)/);
  });

  it('is not ok when only the first round trip worked', async () => {
    // The second is the one that proves the point — it says a migration reached production,
    // not merely that Supabase is up. A report that called this healthy would hide exactly the
    // failure this pair was built to catch.
    const client = rpcClient((call) =>
      call.fn === 'health' ? ok(AT) : pgError('PGRST202', 'Could not find the function'),
    ).client;

    const report = await buildHealthReport(client);

    expect(report.ok).toBe(false);
    expect(report.database).toMatchObject({ ok: true });
    expect(report.pipeline).toEqual({ ok: false, error: 'Could not find the function' });
    expect(healthResponse(report).status).toBe(503);
  });

  it('is not ok when only the second worked', async () => {
    const client = rpcClient((call) =>
      call.fn === 'health' ? pgError(null, 'connection refused') : ok('pipeline-ok'),
    ).client;

    const report = await buildHealthReport(client);

    expect(report.ok).toBe(false);
    expect(report.database).toEqual({ ok: false, error: 'connection refused' });
    expect(healthResponse(report).status).toBe(503);
  });

  it('reports a timestamp that is not one, rather than rendering Invalid Date', async () => {
    const client = rpcClient((call) =>
      call.fn === 'health' ? ok('not a timestamp') : ok('pipeline-ok'),
    ).client;

    const report = await buildHealthReport(client);

    expect(report.ok).toBe(false);
    expect(report.database).toEqual({
      ok: false,
      error: 'Not a valid timestamp: not a timestamp',
    });
  });

  it('reports an answer of the wrong type from either function', async () => {
    const client = rpcClient((call) => (call.fn === 'health' ? ok(42) : ok(null))).client;

    const report = await buildHealthReport(client);

    expect(report.database).toEqual({
      ok: false,
      error: 'Expected a timestamp, got number',
    });
    expect(report.pipeline).toEqual({
      ok: false,
      error: 'Expected a string, got object',
    });
  });

  it('asks the intake schema, which is the one holding nothing personal', async () => {
    // Neither function reads a row — `health()` returns `now()` and `ping()` a constant — and
    // that is what makes it safe to serve this without a credential. Asking a different schema
    // would be the change that quietly stopped being true.
    const { client, calls } = rpcClient((call) =>
      call.fn === 'health' ? ok(AT) : ok('pipeline-ok'),
    );

    await buildHealthReport(client);

    expect(calls.map((call) => `${call.schema}.${call.fn}`)).toEqual([
      'intake.health',
      'intake.ping',
    ]);
  });
});
