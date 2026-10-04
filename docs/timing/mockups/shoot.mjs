// Phase 2: screenshot the mockups and measure what HALT 2 needs to know.
//
//   NM=<a platform/node_modules with playwright and @axe-core/playwright> node docs/timing/mockups/shoot.mjs
//
// Serves the worktree root over HTTP, so the mockups load the real club-chrome.css and club.css,
// and answers /fonts/* from apps/main/public/fonts — the path club-chrome.css's @font-face asks
// for. Writes PNGs to docs/timing/mockups/screens/ and a JSON report beside them.

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const FONTS = join(ROOT, 'platform/apps/main/public/fonts');
const OUT = join(HERE, 'screens');
const require = createRequire(join(process.env.NM, 'x.js'));
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.startsWith('/fonts/') ? join(FONTS, path.slice(7)) : join(ROOT, path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}/docs/timing/mockups/`;

const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const SHOTS = [
  // [page, fullPage?, schemes, hash]
  ['shell-none-account', true, ['light']],
  ['shell-marshal-timing-home', true, ['light']],
  ['shell-admin-timing-home', true, ['light']],
  ['launchpad', true, ['light']],
  ['capture-empty', false, ['light']],
  ['capture-queue', false, ['light', 'dark']],
  ['capture-offline', false, ['light']],
  ['console-before', false, ['light']],
  ['console-running', false, ['light', 'dark']],
  ['console-finished', false, ['light']],
  ['console-running', false, ['light'], 'crossings', 'timing-log'],
  ['leaderboard', true, ['light', 'dark']],
  ['danger-zone', true, ['light']],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const report = { pages: {}, clock: null };

for (const [name, fullPage, schemes, hash, alias] of SHOTS) {
  for (const scheme of schemes) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      const context = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(origin + `${name}.html${hash ? `#${hash}` : ''}`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      if (hash) await page.evaluate((h) => document.getElementById(h).scrollIntoView(), hash);
      const label = `${alias ?? name}-${size}${scheme === 'dark' ? '-dark' : ''}`;
      await page.screenshot({ path: join(OUT, `${label}.png`), fullPage });

      const m = await page.evaluate(() => {
        const d = document.documentElement;
        const tile = document.querySelector('.timing-capture');
        const go = document.querySelector('.timing-go');
        const bricolage = [...document.fonts].some(
          (f) => f.family.includes('Bricolage') && f.status === 'loaded',
        );
        return {
          sideways: d.scrollWidth > d.clientWidth,
          pageScrolls: d.scrollHeight > d.clientHeight,
          h1: document.querySelectorAll('h1').length,
          tileHeight: tile ? Math.round(tile.getBoundingClientRect().height) : null,
          goHeight: go ? Math.round(go.getBoundingClientRect().height) : null,
          titleTop: Math.round(document.querySelector('h1')?.getBoundingClientRect().top ?? -1),
          bricolage,
          focusBar: Math.round(document.querySelector('.club-focus')?.getBoundingClientRect().height ?? 0) || null,
          actionBottom: Math.round(document.querySelector('.timing-go .club-btn')?.getBoundingClientRect().bottom ?? 0) || null,
        };
      });
      const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      m.axe = axe.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}`);
      report.pages[label] = m;
      await context.close();
    }
  }
}

// Does Bricolage's subset carry tabular figures? Compare widths of 1s and 0s in the clock face.
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin + 'console-running.html');
  await page.evaluate(() => document.fonts.ready);
  report.clock = await page.evaluate(() => {
    const el = document.querySelector('.timing-clock');
    const widths = {};
    for (const s of ['11:11:11', '00:00:00', '88:88:88']) {
      el.textContent = s;
      widths[s] = el.getBoundingClientRect().width;
    }
    el.style.fontVariantNumeric = 'normal';
    el.textContent = '11:11:11';
    widths['11:11:11 proportional'] = el.getBoundingClientRect().width;
    return widths;
  });
  await context.close();
}

await browser.close();
server.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
