import { describe, expect, it } from 'vitest';
import {
  isHealthPath,
  isNnAdminPath,
  isNnEntryCompletePath,
  isNnMastheadPath,
  isNnRacePath,
  isNnWebhookPath,
  isNnYearPath,
  isTimingPath,
  nnAdminSegments,
  nnEntryCompletePath,
  nnEventSlugForYearPath,
  nnYearPathForEventSlug,
  HEALTH_PATH,
  NN_ADMIN_PREFIX,
  NN_PREFIX,
  NN_RACE_SLUG,
  NN_WEBHOOK_PATH,
  TIMING_PREFIX,
} from '../../worker/routing';

/**
 * One hostname, three paths. The only decision this Worker makes is whether a request
 * belongs to the timing Worker instead.
 *
 * In production Cloudflare answers that at the edge, because a route carrying a path beats
 * a Custom Domain on the same hostname. This function is the local stand-in for that
 * dispatch — so it has to agree with the route pattern `new.<apex>/timing/*` exactly.
 */

describe('what belongs to the timing Worker', () => {
  it.each(['/timing', '/timing/', '/timing/live/nn-2026', '/timing/_next/static/x.css'])(
    'claims %s',
    (pathname) => {
      expect(isTimingPath(pathname)).toBe(true);
    },
  );

  it.each([
    '/',
    '/nn/',
    '/membership/',
    // The near-misses, and they matter: these are addresses a future website page could
    // legitimately want, and the route pattern must not swallow them.
    '/timings/',
    '/timing-results/',
    '/about/timing/',
  ])('leaves %s to the website', (pathname) => {
    expect(isTimingPath(pathname)).toBe(false);
  });
});

describe('the race page, which no form posts to any more', () => {
  it.each(['/nn', '/nn/'])('is recognised at %s', (pathname) => {
    // Both, deliberately. Astro insists on the trailing slash for the page, but a request for
    // the other spelling should still get the painted panel rather than an empty one.
    expect(isNnRacePath(pathname)).toBe(true);
  });

  it.each([
    '/',
    // A page, not an endpoint. A POST here should 404 exactly as it does today rather
    // than quietly become a sign-up.
    '/nn/privacy/',
    '/nn/signup/',
    // **Both forms' address.** They are on the running now — interest and entry, one shown at
    // a time — and the hidden `form` field is what tells them apart. This predicate is only
    // about which page gets the panel painted onto it.
    '/nn/2026/',
    '/nn/2026',
    // The near-misses, for the same reason `isTimingPath` has them: these are addresses a
    // future page could legitimately want, and this predicate must not swallow them.
    '/nnn/',
    '/nn-2026/',
    '/timing',
  ])('is not %s', (pathname) => {
    expect(isNnRacePath(pathname)).toBe(false);
  });

  it('never claims a path the timing Worker claims', () => {
    // Both predicates run against the same request, so an overlap would be a request two
    // handlers both believe is theirs.
    for (const pathname of ['/nn', '/nn/', '/timing', '/timing/live']) {
      expect(isNnRacePath(pathname) && isTimingPath(pathname)).toBe(false);
    }
  });
});

describe('where one running of the race lives', () => {
  // **This is the whole of the coupling between a URL and a database row**, and it is here
  // rather than anywhere else so that nothing has to know it twice. `/nn/<year>/` is the
  // event `nn-<year>`; publishing 2027 is a row plus that year's content pages and no line
  // of this Worker changes.

  it.each(['/nn/2026/', '/nn/2026', '/nn/2027/', '/nn/1999/'])(
    'claims %s',
    (pathname) => {
      expect(isNnYearPath(pathname)).toBe(true);
    },
  );

  it.each([
    '/nn/',
    '/nn',
    // The evergreen pages, and the reason the pattern is four digits rather than "anything".
    '/nn/course/',
    '/nn/privacy/',
    // Below a running rather than the running itself — these are content pages the Worker
    // does nothing to, and a POST to one must 404 rather than be read as an entry.
    '/nn/2026/race-day/',
    '/nn/2026/spectators/',
    '/nn/2026/entry/complete/',
    // Not years.
    '/nn/20261/',
    '/nn/202/',
    '/nn/twenty26/',
    '/timing',
  ])('refuses %s', (pathname) => {
    expect(isNnYearPath(pathname)).toBe(false);
  });

  it('resolves a year path to the event slug for that running', () => {
    expect(nnEventSlugForYearPath('/nn/2026/')).toBe('nn-2026');
    expect(nnEventSlugForYearPath('/nn/2026')).toBe('nn-2026');
    expect(nnEventSlugForYearPath('/nn/course/')).toBeNull();
  });

  it('round-trips a slug back to the page it belongs to', () => {
    // **Inverses, asserted as such.** Two functions each holding half of one convention is
    // exactly where a convention drifts, and the symptom would be a Stripe return URL that
    // 404s — discovered by somebody who had just paid.
    for (const year of ['2026', '2027', '2030']) {
      const path = `/nn/${year}/`;
      expect(nnYearPathForEventSlug(nnEventSlugForYearPath(path)!)).toBe(path);
    }
  });

  it('refuses to invent a page for a slug that is not a running of this race', () => {
    // The caller has to decide what to do rather than be handed a plausible path. A running
    // named some other way has no page, and linking to a guess is a 404 on the front door.
    expect(nnYearPathForEventSlug('nn-two-thousand')).toBeNull();
    expect(nnYearPathForEventSlug('ptb-2026')).toBeNull();
    expect(nnYearPathForEventSlug('nn-2026-b')).toBeNull();
  });
});

describe('where Stripe sends somebody back to', () => {
  it.each([
    '/nn/2026/entry/complete/',
    '/nn/2026/entry/complete',
    '/nn/2027/entry/complete/',
  ])('claims %s', (pathname) => {
    expect(isNnEntryCompletePath(pathname)).toBe(true);
  });

  it.each([
    // **The old address, and it is nobody's now.** It was `/nn/entry/complete/` before the
    // year layer; nothing was ever published there, and a predicate that still answered for
    // it would be a second live address for one page.
    '/nn/entry/complete/',
    '/nn/2026/entry/',
    '/nn/2026/',
    '/nn/complete/',
  ])('refuses %s', (pathname) => {
    expect(isNnEntryCompletePath(pathname)).toBe(false);
  });

  it('builds the return path from the year page it belongs to', () => {
    expect(nnEntryCompletePath('/nn/2026/')).toBe('/nn/2026/entry/complete/');
    expect(isNnEntryCompletePath(nnEntryCompletePath('/nn/2026/'))).toBe(true);
  });
});

describe('the health endpoint, and the one character that keeps it off a page', () => {
  it('answers at the underscored spelling and nowhere else', () => {
    expect(isHealthPath('/_health')).toBe(true);
    expect(HEALTH_PATH).toBe('/_health');
  });

  it('leaves /health/ to a page the club will one day want', () => {
    // **This is the trap, written down as an assertion.** `trailingSlash` is `'always'`, so an
    // Astro page at `src/pages/health.astro` serves at `/health/` — while this Worker would go
    // on answering `/health`, because it matches before the assets binding. Two live addresses
    // one character apart, nothing erroring and nothing failing CI.
    //
    // **This is a running club.** Training, injury and wellbeing are exactly what somebody
    // typing "health" is looking for, and what they would get is a database report. The
    // underscore makes the collision impossible rather than unlikely, and these four lines are
    // what stop somebody "tidying" it away.
    expect(isHealthPath('/health')).toBe(false);
    expect(isHealthPath('/health/')).toBe(false);
    expect(isHealthPath('/nn/health/')).toBe(false);
  });

  it('takes one spelling only, unlike the predicates a human types into', () => {
    // The webhook and the year paths accept a trailing slash because somebody typed those into
    // a Stripe dashboard or a form action once. **Nothing types this** — `smoke.mjs` and the
    // acceptance suite are the only callers — so `/_health/` 404s like any other address that
    // is not a page.
    expect(isHealthPath('/_health/')).toBe(false);
  });

  it('is not the spelling the timing app uses, and the difference is deliberate', () => {
    // A leading underscore makes an App Router folder *private*: `app/_health/route.ts` builds,
    // deploys and 404s with nothing saying why. So `apps/timing` answers at `/timing/health`
    // instead, and this Worker never claims it.
    expect(isHealthPath('/timing/health')).toBe(false);
    expect(isTimingPath('/timing/health')).toBe(true);
  });
});

describe('where Stripe posts a confirmed payment', () => {
  it('takes both spellings, because a human typed this one into a dashboard', () => {
    // **The cost of getting this wrong is not a 404 somebody sees.** The endpoint is configured
    // once by hand against a URL typed into Stripe's dashboard; a mistyped trailing slash there
    // would mean every payment confirmation posting into a 404, discovered only by a runner who
    // paid and heard nothing. Accepting both costs one comparison.
    expect(isNnWebhookPath('/nn/stripe-webhook')).toBe(true);
    expect(isNnWebhookPath('/nn/stripe-webhook/')).toBe(true);
    expect(NN_WEBHOOK_PATH).toBe('/nn/stripe-webhook');
  });

  it('claims nothing else, including the near-misses', () => {
    expect(isNnWebhookPath('/nn/stripe-webhook/x')).toBe(false);
    expect(isNnWebhookPath('/nn/stripe')).toBe(false);
    expect(isNnWebhookPath('/stripe-webhook')).toBe(false);
    expect(isNnWebhookPath('/nn/2026/stripe-webhook')).toBe(false);
  });

  it('lives under the race, so the cutover moves the hostname and not this', () => {
    // A return URL and a webhook address that survive a domain change is the same property
    // ADR-007 buys everywhere else here — except that this one is written down in a third
    // party's dashboard, where changing it is a manual step somebody has to remember.
    expect(NN_WEBHOOK_PATH.startsWith(NN_PREFIX)).toBe(true);
  });
});

describe('which pages get the navigation bar', () => {
  it.each([
    '/nn/',
    '/nn/course/',
    '/nn/privacy/',
    '/nn/2026/',
    '/nn/2026/race-day/',
    '/nn/2026/spectators/',
  ])('paints %s', (pathname) => {
    expect(isNnMastheadPath(pathname)).toBe(true);
  });

  it('paints a seventh page nobody has written yet', () => {
    // **Deliberately a predicate rather than a list of the six pages that exist.** A new page
    // under `/nn/` gets the bar because it renders the masthead; a list here would be the
    // second place that fact was written down, and the two would drift.
    expect(isNnMastheadPath('/nn/results/')).toBe(true);
    expect(isNnMastheadPath('/nn/2027/')).toBe(true);
  });

  it('leaves the webhook alone, because it is not a page at all', () => {
    expect(isNnMastheadPath('/nn/stripe-webhook')).toBe(false);
    expect(isNnMastheadPath('/nn/stripe-webhook/')).toBe(false);
  });

  it('leaves the return page alone, and that is a decision rather than an oversight', () => {
    // Somebody who has just paid should not be offered four ways to wander off before reading
    // what the club has recorded. The page keeps the wordmark and drops the links.
    expect(isNnMastheadPath('/nn/2026/entry/complete/')).toBe(false);
    expect(isNnMastheadPath('/nn/2026/entry/complete')).toBe(false);
  });

  it('reads the two spellings of a page as the same page', () => {
    // `trailingSlash` is `'always'`, so the bar must not depend on which one arrived.
    expect(isNnMastheadPath('/nn')).toBe(true);
    expect(isNnMastheadPath('/nn/course')).toBe(true);
  });

  it('paints nothing outside the race', () => {
    expect(isNnMastheadPath('/')).toBe(false);
    expect(isNnMastheadPath('/timing')).toBe(false);
    expect(isNnMastheadPath('/brand/')).toBe(false);
    expect(isNnMastheadPath('/_health')).toBe(false);
    // The near-misses, for the same reason every other predicate here has them.
    expect(isNnMastheadPath('/nnn/')).toBe(false);
    expect(isNnMastheadPath('/nn-2026/')).toBe(false);
  });

  it('paints the admin surface too, which is why it carries its own stylesheet', () => {
    // `/nn/admin` is under the prefix and is not one of the two exceptions, so this answers
    // true. It never reaches the painter — the Worker answers those addresses itself, before
    // the assets binding — and that is the reason `nn-theme.css` must never be on that page:
    // nothing in this predicate is what keeps the two apart.
    expect(isNnMastheadPath('/nn/admin/')).toBe(true);
  });
});

describe('the paths the club has committed to', () => {
  it('keeps them as paths rather than hostnames', () => {
    // Written down because the whole arrangement rests on it: at the Squarespace cutover
    // the hostname changes and these do not, so nothing that already works has to move.
    expect(NN_PREFIX).toBe('/nn');
    expect(TIMING_PREFIX).toBe('/timing');
  });

  it('spells the race the same way the events table does', () => {
    // `entries.events.race_slug` is `nn` for every running of this race, and the path prefix
    // is `/nn`. They agree, and this is the line that says the agreement is deliberate.
    expect(NN_RACE_SLUG).toBe('nn');
    expect(`/${NN_RACE_SLUG}`).toBe(NN_PREFIX);
  });
});

describe('the admin surface, and the one character that decides where it starts', () => {
  it('matches the prefix itself and everything beneath it', () => {
    expect(isNnAdminPath('/nn/admin')).toBe(true);
    expect(isNnAdminPath('/nn/admin/')).toBe(true);
    expect(isNnAdminPath('/nn/admin/entries/')).toBe(true);
    expect(isNnAdminPath('/nn/admin/entries/nn-2026/')).toBe(true);
  });

  it('does not match the stylesheet that sits beside it', () => {
    // **The character that matters.** `/nn/admin.css` is a real file in `dist/`, emitted by
    // `src/pages/nn/admin.css.ts` from the shared stylesheets. If this predicate treated
    // `/nn/admin` as a plain prefix, the Worker would answer the stylesheet request itself —
    // with a sign-in page or a 404 — and every admin page would render unstyled, with nothing
    // failing anywhere to say why.
    expect(isNnAdminPath('/nn/admin.css')).toBe(false);
  });

  it('does not match another page that happens to start with the same letters', () => {
    expect(isNnAdminPath('/nn/administration/')).toBe(false);
    expect(isNnAdminPath('/nn/admin-guide/')).toBe(false);
  });

  it('does not match the pages a runner reads', () => {
    expect(isNnAdminPath('/nn/')).toBe(false);
    expect(isNnAdminPath('/nn/2026/')).toBe(false);
    expect(isNnAdminPath('/nn/privacy/')).toBe(false);
    expect(isNnAdminPath('/admin/')).toBe(false);
  });

  it('reads the two spellings of the front door as the same address', () => {
    // `trailingSlash` is `'always'` for pages and somebody typing this into a bar will type
    // it either way. Both are the index, which is `[]`.
    expect(nnAdminSegments('/nn/admin')).toEqual([]);
    expect(nnAdminSegments('/nn/admin/')).toEqual([]);
  });

  it('splits what comes after the prefix', () => {
    expect(nnAdminSegments('/nn/admin/entries/')).toEqual(['entries']);
    expect(nnAdminSegments('/nn/admin/entries/nn-2026/')).toEqual(['entries', 'nn-2026']);
    expect(nnAdminSegments('/nn/admin/export/')).toEqual(['export']);
  });

  it('keeps the prefix under the race rather than at the root', () => {
    // Under `/nn` with everything else, so the Squarespace cutover moves the hostname and
    // not this — the same property ADR-007 buys for every other address here.
    expect(NN_ADMIN_PREFIX).toBe('/nn/admin');
    expect(NN_ADMIN_PREFIX.startsWith(NN_PREFIX)).toBe(true);
  });
});
