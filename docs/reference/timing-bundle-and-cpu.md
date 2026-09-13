# The timing Worker's bundle size and CPU — measured, and half still owed

**Measured 13 September 2026** against `b087e42`, on macOS 15.6.1 / arm64, Node v22.23.2,
Next 16.3.0, `@opennextjs/cloudflare` 1.20.2, wrangler 4.120.0.

[ADR-037](../architecture/decisions/adr-037-timing-stays-on-next-under-opennext.md) chooses
Next.js under OpenNext and names **two numbers nobody had measured** as the thing that can
overturn it: the free Workers plan's **3 MB compressed** bundle and **10 ms CPU** per
invocation. [#199](https://github.com/southville-running-club/src-website/issues/199) exists
to take both.

**One of the two is taken. The bundle is comfortably inside — about 1.6 MiB gzipped against
3 MB, a little over half the budget, with the whole of the ported domain logic still to be
added and that logic measured at 14 KiB gzipped. The CPU half is outstanding**, because it
cannot be taken on a laptop: it needs the Worker deployed and a database behind it. The
procedure for whoever takes it is at the foot of this page.

---

## The bundle

### What was measured, and why it is this file

`opennextjs-cloudflare build` writes `.open-next/`, which is 28 MB on disk — and **none of
that is the answer**. The directory holds build intermediates, a 4.3 MB font-metrics JSON that
nothing reaches (`grep -c capsize` on the built bundle answers `0`), the static assets, and a
source map. What Cloudflare weighs is the **single
script wrangler produces** by following the module graph out of `.open-next/worker.js`, and
the only honest way to get it is to make wrangler produce it.

`wrangler deploy --dry-run --outdir=…` does exactly that and stops before uploading anything:
it bundles, prints `Total Upload`, and exits. No credentials, no network, no ports, no Docker.

```bash
cd platform
npm run build:worker --workspace apps/timing

cd apps/timing
npx wrangler deploy --dry-run --outdir=/tmp/timing-bundle
#   ✨ Read 19 files from the assets directory …/.open-next/assets
#   Total Upload: 8387.27 KiB / gzip: 1654.61 KiB

wc -c            < /tmp/timing-bundle/worker.js   # 8588567
gzip -9   -c       /tmp/timing-bundle/worker.js | wc -c   # 1677676
brotli -q 11 -c    /tmp/timing-bundle/worker.js | wc -c   #  841203
```

`--env production` was run too and reports **byte-identical** figures, which is expected — the
two environments differ only in `vars`, `routes` and the self-reference service name, none of
which is code.

### The numbers

| | Bytes | | Against the 3 MB limit |
| --- | ---: | --- | --- |
| **Raw** `worker.js` | 8,588,567 | 8.19 MiB | not what is weighed |
| **gzip, as wrangler reports it** | 1,694,320 | 1654.61 KiB · 1.62 MiB | **56%** |
| **gzip -9** | 1,677,676 | 1638.35 KiB · 1.60 MiB | **56%** |
| **brotli -q 11** | 841,203 | 821.49 KiB · 0.80 MiB | 28% |

**The gzip figure is the one to quote**, and 3 MB is read here as 3,000,000 bytes rather than
3 MiB, which is the conservative reading of the two. That leaves roughly **1.3 MB of gzipped
headroom.**

Wrangler's own number and `gzip -9` disagree by 16 KiB — 1 % — because they are different
compression levels of the same bytes, not different bytes. Either supports the same verdict.
Brotli is recorded because Cloudflare may compress better than gzip on its side; **nothing
here relies on that**, and the verdict is taken on gzip.

The **static assets are not in this figure and must not be added to it**: the 624 KiB under
`.open-next/assets` is uploaded as Workers static assets, which are weighed separately. Nor is
the 11.8 MB `worker.js.map`, which is not uploaded at all — `wrangler.jsonc` does not set
`upload_source_maps`.

### What is actually in the 8.19 MB

Almost none of it is this club's code. OpenNext pre-bundles before wrangler ever runs, and two
of its outputs are the whole of the weight:

| `.open-next` file | Bytes | What it is |
| --- | ---: | --- |
| `server-functions/default/apps/timing/handler.mjs` | 5,047,108 | Next's server runtime, React and `react-dom/server`, and the app's own routes |
| `middleware/handler.mjs` | 1,131,102 | the edge middleware — `middleware.ts` plus the Edge runtime primitives it is bundled against |

The rest is OpenNext's Cloudflare shims, three Durable Object classes, and wrangler's own
`nodejs_compat` wrappers. **The framework is the bundle**, which is worth saying plainly: the
size is near enough fixed by the ADR-037 decision itself and will barely move as the
application is written.

### ⚠️ The domain logic is not in this bundle yet, and that is the one caveat

[#199](https://github.com/southville-running-club/src-website/issues/199) asks for a build
"with the copied domain logic (`lib/bib.ts`, `results.ts`, `awards.ts`, `anomaly.ts`)". **It is
not there.** `packages/shared/src/timing/*` is reachable only by subpath export — it is
deliberately not in `@src/shared`'s barrel — and grepping the built `worker.js` for
`computeAwards`, `buildResults` and `formatAnomalyMessage` finds **zero** of each. Today the
only consumer of any of it is `apps/main/worker/nn-results.ts`, which is a different Worker
built a different way.

So the number above is a floor, and **the gap was measured rather than guessed.** All ten
modules — `anomaly`, `awards`, `bib`, `categories`, `gender`, `results`, `rows` and the three
under `registration/` — bundled together, minified, with every namespace referenced so nothing
tree-shakes away:

```bash
# entry file importing all ten, written under packages/shared/src/timing/ and deleted after
cd platform
node_modules/.bin/esbuild packages/shared/src/timing/<entry>.ts \
  --bundle --minify --format=esm --platform=browser --outfile=/tmp/domain.js
```

| | Raw | gzip -9 |
| --- | ---: | ---: |
| All ten modules, including `papaparse` | 39,573 | **14,296** |
| All ten, with `papaparse` external | 19,923 | 7,180 |

**14 KiB gzipped — under half a percent of the budget.** `papaparse` is more than half of it
and comes in through `registration/parser.ts`; it is worth knowing about, and it is not worth
avoiding. Adding every line of ported logic to the Worker takes it from 56 % of the limit to
about 57 %.

### Verdict — comfortably inside

**Comfortably inside, not marginal.** 1.62 MiB gzipped against 3 MB, with the full domain
logic costing 14 KiB of the 1.3 MB that is spare. ADR-037's bundle condition is met, and the
money decision it contemplated is not triggered by this half.

**What would change that** is a dependency, not more application code. The application's own
source is a rounding error against Next and React; a server-side library of any size is what
would move this number, and this page is the thing to re-run before adding one.

---

## ⚠️ The CPU half is outstanding

**Not measured, and deliberately not estimated.** ADR-037's point is that these two numbers
were never taken; a plausible figure written here would be worse than none, because it would
read as one that had been.

It cannot be taken on a laptop. `wrangler dev` runs workerd on the machine's own CPU, which is
not the edge's, and the 10 ms limit is billed by Cloudflare against its own hardware. **The
measurement needs a deployed Worker and a reachable database.**

### The procedure

**1. Deploy, and seed something to render.** ⚠️ `apps/timing`'s own `deploy` script names no
environment, so it targets `wrangler.jsonc`'s **top level** — no route and a localhost
database. Pass `--env production` through to wrangler, or the thing measured is not the thing
deployed. The page then needs one row in `timing.events` and a person holding
`timing.event.manage` to sign in as — `/admin/people/` grants the role, and the event comes
from `timing.create_event()`.

**2. Measure `/timing/events/<slug>/`, not `/timing/`.** The holding page is a static
prerender and tells you nothing: no database read, no dynamic render, no React server
components over real rows. `/timing/events/<slug>/` is `force-dynamic`, goes through the
middleware's permission check, makes an RPC and renders server components over the result —
which is the shape of the leaderboard, built out of the same parts. `/timing/health` is a
route handler and is not a substitute either.

**3. Record, from `observability` — which `wrangler.jsonc` already enables in both
environments:**

```bash
npx wrangler tail --env production --format=json
```

and read `cpuTime` and `wallTime` off each request event; the dashboard's Worker metrics carry
the same as CPU-time percentiles if the wrangler version in use does not emit the field.

Four figures, and all four are wanted:

| | Why |
| --- | --- |
| **Cold**, the first request after a deploy | Module instantiation lands here, and this bundle is 8.19 MB of script to parse |
| **Warm p50**, over at least 20 requests | The number the 10 ms limit is really about |
| **Warm max** across those requests | The limit is per invocation; a p50 inside it and a max over it is still a broken page |
| **A signed-out request**, refused by the middleware | The floor — middleware, one RPC, and the prerendered 404, with no page render at all |

**4. Watch the startup limit as well as the 10 ms one.** ADR-037 names the per-invocation CPU
limit; Workers enforces a separate, much larger budget on the initial script evaluation, and an
8.19 MB script is where that gets spent. If a deploy is rejected or the first request behaves
unlike every later one, this is the limit to check — it is a different failure from the one the
ADR anticipated, and this build is big enough to make it worth looking at.

**5. Do not read a slow database as a CPU problem.** The event page's middleware makes a
Supabase call and the page makes another; both are **wall** time, and the 10 ms limit is CPU
only. `cpuTime` and `wallTime` are reported separately for exactly this reason, and conflating
them would condemn a page that is fine.

**6. Re-measure when the leaderboard exists.** This is the honest limit of what the procedure
above can tell anybody today: nothing in `apps/timing` yet renders a field. `buildResults`,
`sortResults` and `computeAwards` are the work that scales with the number of runners, and a
page rendering 250 rows is a different measurement from one rendering an event's five counts.
**Today's figure is a floor and must not be recorded as the answer.** The capture path and the
leaderboard are [#202](https://github.com/southville-running-club/src-website/issues/202)'s
other half.

### What the answer means

Straight from ADR-037, and unchanged by anything on this page:

- **Inside 10 ms** — proceed, and record the numbers here beside the bundle ones.
- **Over** — it is the **paid Workers plan** (a money decision for the committee) or moving
  work off the server. **It is explicitly not a reason to change framework mid-rewrite.**

---

## Re-run this when

- **A server-side dependency is added to `apps/timing`.** The application's own code will not
  move the bundle figure; a library will.
- **Next or `@opennextjs/cloudflare` is upgraded.** The framework is the bundle, so a major
  version is a new measurement.
- **The leaderboard is built**, which is the CPU measurement this page is really waiting for.
