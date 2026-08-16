#!/usr/bin/env node
/**
 * Does the deployed platform actually work?
 *
 * Every other test in this repository runs against a laptop or a CI runner. This one runs
 * against **what the public gets** — the real hostname, the real certificate, the real
 * Worker, the real database. It is the only check that can catch a deploy that built
 * cleanly and serves nothing.
 *
 * It retries, because Cloudflare Workers Builds deploys on the push rather than on a green
 * CI run, so a smoke test starting immediately after a merge is racing the deploy.
 *
 *   npm run smoke                    # the live site
 *   npm run smoke -- --local         # localhost:8787, with both Workers running
 *
 * Exit code 0 if everything passed. Anything else is a real failure worth waking up for.
 */

const LOCAL = process.argv.includes('--local');

/**
 * One hostname, three paths — the same shape locally and in production, which is the whole
 * argument for paths over subdomains. At the Squarespace cutover only `SITE` changes.
 */
const SITE = LOCAL ? 'http://localhost:8787' : 'https://new.southvillerunningclub.co.uk';

/** Total time to keep retrying before calling it a failure. */
const DEADLINE_MS = LOCAL ? 30_000 : 5 * 60_000;
const RETRY_MS = LOCAL ? 1_000 : 15_000;

/**
 * The database check both applications share, read from `/health` and `/timing/health`.
 *
 * **It used to be scraped out of page HTML** — `data-health="ok"` in a status table on `/nn/`
 * and on `/timing`. Those markers are gone, because a diagnostic on the page somebody pays on
 * reads as a build in progress. Both applications now answer the same JSON from the same
 * function in `packages/shared`, so this parses one shape rather than two pages.
 *
 * Two round trips are checked, and the second is the one that proves the point.
 * `intake.health()` says the Worker can reach Supabase at all; `intake.ping()` was added
 * *after* the first deploy, so it says a **migration** went through CI's scope guard,
 * `supabase db push` on merge, and a deploy of both applications. This test has already
 * caught one live deploy failure the whole of CI missed (the wrangler route schema error).
 */
async function reportsHealthy(response) {
  // A 503 is the endpoint working correctly and saying the database is not — so the body is
  // still the interesting part, and it is read before the status is judged.
  let report;
  try {
    report = await response.json();
  } catch {
    return `expected JSON from the health endpoint, got ${response.status} and something else`;
  }

  if (report?.database?.ok !== true)
    return `the database round trip failed: ${report?.database?.error ?? 'no reason given'}`;

  if (report?.pipeline?.ok !== true)
    return `the pipeline check failed: ${report?.pipeline?.error ?? 'no reason given'}`;

  if (report.pipeline.value !== 'pipeline-ok')
    return `the pipeline check returned ${JSON.stringify(report.pipeline.value)}`;

  // Checked last, and deliberately: the two failures above say *what* broke, and this one
  // would only say that something did. It catches the endpoint disagreeing with itself.
  if (report.ok !== true) return 'both round trips passed but the report says ok: false';
  if (response.status !== 200)
    return `the report is healthy but the status was ${response.status}`;

  return null;
}

/**
 * The checks. Each is deliberately small and says what it proves, because a smoke-test
 * failure is read by somebody in a hurry.
 */
const CHECKS = [
  {
    name: 'the club website is served',
    url: `${SITE}/`,
    proves:
      'the Worker is deployed, the custom domain resolves, the certificate is valid',
    check: async (response) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      const body = await response.text();
      // The banner's own words, so this stays true as the holding page's copy changes and
      // fails loudly if the layout ever stops wrapping the root. HTML-escaped apostrophe,
      // because that is what the rendered page actually contains.
      if (!body.includes('Welcome to Southville Running Club&#39;s new website'))
        return 'the root is not the holding page';
      return null;
    },
  },
  {
    name: 'Nightingale Nightmare is served at /nn',
    url: `${SITE}/nn/`,
    proves: 'the race sign-up page is reachable at the address it will keep',
    check: async (response) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      const body = await response.text();
      if (!body.includes('Nightingale Nightmare')) return 'the page is not the race page';
      return null;
    },
  },
  {
    name: 'the website Worker reaches the database',
    url: `${SITE}/_health`,
    proves:
      'the Worker can reach Supabase with the anon key and grants, and a migration added ' +
      'after the first deploy reached production the same way',
    check: reportsHealthy,
  },
  {
    // **The counterpart to the check above, and the reason this pair is worth two entries.**
    // The diagnostics came off the race page on purpose; a page is only clean while nobody
    // puts them back, and "the smoke test still passes" is exactly the argument somebody
    // would make for re-adding one. This fails if they do.
    name: 'the race page carries no diagnostics',
    url: `${SITE}/nn/`,
    proves:
      'the page a runner pays on says nothing about databases, runtimes or workspaces',
    check: async (response) => {
      const body = await response.text();
      for (const marker of [
        'What this page proves',
        'data-health',
        'data-pipeline-check',
        'pipeline-ok',
      ]) {
        if (body.includes(marker)) return `the page still contains ${marker}`;
      }
      return null;
    },
  },
  {
    name: 'race timing is served at /timing',
    url: `${SITE}/timing`,
    proves:
      'the path route beats the custom domain, so a second Worker answers on one hostname',
    check: async (response) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      const body = await response.text();
      if (!body.includes('Race timing')) return 'the page is not the timing page';
      return null;
    },
  },
  {
    name: 'race timing reaches the same database',
    url: `${SITE}/timing/health`,
    proves:
      'both applications talk to one Supabase project, and the same migration reached the ' +
      'second one too — not just the first',
    check: reportsHealthy,
  },
  {
    name: "race timing's own assets resolve under /timing",
    url: `${SITE}/timing`,
    proves: 'basePath is set, so the app is not served unstyled and half-broken',
    check: async (response) => {
      const body = await response.text();
      const asset = /["'](\/timing\/_next\/[^"']+\.css)["']/.exec(body)?.[1];
      if (!asset) return 'the page links no stylesheet under /timing/_next/';

      const css = await fetch(`${SITE}${asset}`);
      return css.ok ? null : `the stylesheet ${asset} returned ${css.status}`;
    },
  },
  {
    name: 'nothing unbuilt is reachable',
    url: `${SITE}/membership/`,
    proves: 'the site serves only what exists, rather than a stray index',
    check: async (response) =>
      response.status === 404 ? null : `expected 404, got ${response.status}`,
  },
];

async function runCheck(spec) {
  try {
    const response = await fetch(spec.url, {
      redirect: spec.redirect ?? 'follow',
      headers: { 'user-agent': 'src-platform-smoke-test' },
    });
    return await spec.check(response);
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/**
 * Retries one check on its own clock until it passes or its deadline runs out, rather than
 * every check waiting on the slowest one before anything is reported. A deploy that only
 * breaks one path — the timing Worker, say — no longer hides behind seven passing checks
 * that keep re-running with it.
 */
async function runUntilPass(spec) {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    const failure = await runCheck(spec);
    if (!failure) return null;

    attempt += 1;
    const elapsed = Date.now() - started;
    if (elapsed > DEADLINE_MS) return failure;

    console.log(
      `..    ${spec.name} not ready after ${Math.round(elapsed / 1000)}s (attempt ${attempt}) — retrying`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

console.log(`Smoke testing ${LOCAL ? 'the local stack' : 'the live platform'}`);
console.log(`  ${SITE}\n`);

// Each check retries independently and reports the moment it settles — pass or timeout —
// so a slow check doesn't delay the report for the ones that already passed.
const results = await Promise.all(
  CHECKS.map(async (spec) => {
    const failure = await runUntilPass(spec);
    if (failure) {
      console.error(`FAIL  ${spec.name}`);
      console.error(`      ${failure}`);
      console.error(`      this proves: ${spec.proves}`);
    } else {
      console.log(`ok    ${spec.name}`);
    }
    return { spec, failure };
  }),
);

const failed = results.filter((r) => r.failure);

if (failed.length > 0) {
  console.error(`\n${failed.length} of ${CHECKS.length} checks failed.`);
  console.error('If the Workers have not been created yet, this is expected —');
  console.error('see platform/apps/main/README.md for the Cloudflare setup.');
  process.exit(1);
}

console.log(`\nAll ${CHECKS.length} checks passed.`);
