import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * The routing rules again, but through the real runtime and the real build output.
 *
 * `tests/unit/routing.test.ts` proves the function returns the right path. This proves
 * the Worker, the static-assets binding and `run_worker_first` actually combine to serve
 * it — which is the part that would still be broken if `run_worker_first` were left off,
 * with the unit tests entirely green.
 */

const NN = 'https://nn.southvillerunningclub.co.uk';

describe('nn.southvillerunningclub.co.uk', () => {
  it('serves the Nightingale Nightmare page at the root', async () => {
    const response = await SELF.fetch(`${NN}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    await expect(response.text()).resolves.toContain('Nightingale Nightmare');
  });

  it('404s anything that is not the race', async () => {
    // The leak test. From Phase 5 the club website is in this same build, and none of it
    // may be reachable here.
    for (const path of ['/membership/', '/results/', '/about/']) {
      const response = await SELF.fetch(`${NN}${path}`);
      expect(response.status, `${path} should not be served`).toBe(404);
    }
  });

  it('does not serve the build root index', async () => {
    // `/` maps to `/nn/`, so the platform index page must be unreachable here even
    // though it exists in `dist/`.
    const response = await SELF.fetch(`${NN}/`);
    await expect(response.text()).resolves.not.toContain('Platform skeleton');
  });

  it('serves the stylesheet, so the page is not unstyled', async () => {
    const page = await (await SELF.fetch(`${NN}/`)).text();
    const href = /href="(\/_astro\/[^"]+\.css)"/.exec(page)?.[1];

    expect(href, 'the page should link a built stylesheet').toBeTruthy();

    const css = await SELF.fetch(`${NN}${href}`);
    expect(css.status).toBe(200);
  });
});

describe('other hostnames', () => {
  it('serve the build root untouched', async () => {
    const response = await SELF.fetch('https://src-main.workers.dev/');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('Platform skeleton');
  });
});

describe('the health placeholder', () => {
  it('is rewritten by the Worker rather than left as the built-in text', async () => {
    // Proves the HTMLRewriter ran. Whether it reached the database is a separate matter —
    // the local stack may not be up in every environment — so this asserts the handler
    // replaced the content, not what it replaced it with.
    const page = await (await SELF.fetch(`${NN}/`)).text();

    expect(page).not.toContain('Not fetched — the Worker did not run.');
    expect(page).toMatch(/data-health="(ok|error)"/);
  });
});
