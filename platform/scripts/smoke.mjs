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

/** The database check both applications share. */
function reachesDatabase(body) {
  if (body.includes('data-health="error"')) {
    const [, message] = /data-health="error"[^>]*>([^<]*)/.exec(body) ?? [];
    return `the page reports a database error: ${message?.trim() ?? 'unknown'}`;
  }
  if (!body.includes('data-health="ok"')) return 'the health element was never filled in';
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
      if (!body.includes('A new Southville Running Club'))
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
    name: 'Nightingale Nightmare reaches the database',
    url: `${SITE}/nn/`,
    proves: 'the Worker can reach Supabase, and the anon key and grants are right',
    check: async (response) => reachesDatabase(await response.text()),
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
    url: `${SITE}/timing`,
    proves: 'both applications are talking to one Supabase project',
    check: async (response) => reachesDatabase(await response.text()),
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

const started = Date.now();
const failures = new Map(CHECKS.map((spec) => [spec.name, 'not yet run']));

console.log(`Smoke testing ${LOCAL ? 'the local stack' : 'the live platform'}`);
console.log(`  ${SITE}\n`);

// Retry the whole set until it is clean or the deadline passes. Retrying everything rather
// than only the failures keeps the final report a true snapshot of one moment.
for (;;) {
  for (const spec of CHECKS) {
    const failure = await runCheck(spec);
    if (failure) failures.set(spec.name, failure);
    else failures.delete(spec.name);
  }

  if (failures.size === 0) break;

  const elapsed = Date.now() - started;
  if (elapsed > DEADLINE_MS) break;

  console.log(
    `${failures.size} of ${CHECKS.length} not ready after ${Math.round(elapsed / 1000)}s — retrying`,
  );
  await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
}

for (const spec of CHECKS) {
  const failure = failures.get(spec.name);
  if (failure) {
    console.error(`FAIL  ${spec.name}`);
    console.error(`      ${failure}`);
    console.error(`      this proves: ${spec.proves}`);
  } else {
    console.log(`ok    ${spec.name}`);
  }
}

if (failures.size > 0) {
  console.error(`\n${failures.size} of ${CHECKS.length} checks failed.`);
  console.error('If the Workers have not been created yet, this is expected —');
  console.error('see platform/apps/main/README.md for the Cloudflare setup.');
  process.exit(1);
}

console.log(`\nAll ${CHECKS.length} checks passed.`);
