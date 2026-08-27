# Working in this repository

The Southville Running Club platform. Two volunteers with day jobs maintain all of it, and
that single fact decides most of what follows.

---

## Before anything else

**Read [`docs/architecture/principles.md`](docs/architecture/principles.md).** It is short,
it is the part that is not under discussion, and it ends with the triggers that mean *stop
and ask a human*. Everything below assumes it.

Then, if you are writing code, [`platform/README.md`](platform/README.md).

---

## Stop and ask — do not resolve these by inference

These end the task. Say what you have found and wait. Guessing is worse than pausing,
because a wrong guess here is expensive in money, in law, or in a race that cannot be
re-run.

- **A factual claim about a race** that has not been supplied — date, price, distance,
  location, start time. The Nightingale Nightmare date *is* confirmed — **Sunday 1 November
  2026, start 11:00** — along with the distance, the race HQ, the schedule, the prizes and
  the spectating points; all of them live in `apps/main/src/content/race.json`. **The entry
  fees are confirmed too** — **£18 affiliated, £20 unaffiliated** since 24 August 2026, £0 for
  a visually impaired runner's guide — and they live in `entries.fees`, never in markup. **The
  £2 gap is ARC's, not the club's**: it is the Unattached Runner Levy the promoter must impose
  under Rule 21(2)(b) and remit to ARC within 30 days under 21(2)(c), so the club nets £18
  either way — decision 006. **So is the minimum age: 18 on race day**, in
  `entries.events.minimum_age`. **Still unconfirmed, and none of them may appear anywhere:**
  the 2026 ARC permit number (the 2023 number is not a substitute), the 2026 race director's
  name, and the transfer deadline. **The entry open and close times have been *proposed* — 1
  September 07:00 and 30 October 17:00 — and not ratified**, so they may not appear either, and
  in particular **they may not go into `entries.events`**: that column is not configuration
  waiting to be switched on, it is the switch, and the entries-open runbook owns the moment.
  Do not invent a fact, do not infer one from a phase document, and do not put a plausible
  placeholder in markup.
- **Collecting a field beyond what is already specified.** Adding a database column that
  holds personal data is a committee decision. The committee has settled the *entry* field
  list — it is `packages/shared/src/nn-entry.ts` — and a fifteenth field is a new decision.
- **The privacy notice's four open decisions**, in `race.json`'s `privacy` key and `null`
  there: who somebody writes to about their data, how long an entry record is kept, whether
  an email address is kept to tell people about next year's race, and what is true about
  photographs. They render "To be confirmed by the club" and `nn-privacy.spec.ts` counts
  them. **Settled, and written in:** the controller, the registered office, the company
  number, and one month for medical notes. **What the notice says is collected comes from
  the schema, not from the form** — the entry tables also hold the fee and amount, Stripe's
  references, the consents with their version, and three timestamps, and a notice that omits
  those under-lists what the club processes.
- **Taking payment and confirming it are both connected, and neither is a stop-and-ask any
  more.** A valid entry holds a place and goes to Stripe Checkout; the webhook at
  `POST /nn/stripe-webhook` is what moves a purchase to `paid`, and it is the only thing that
  may. **Three Worker secrets** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
  `ENTRIES_WEBHOOK_KEY` — never in this repository, never in `wrangler.jsonc`, never in a `vars`
  block. A real key on a machine belongs in `apps/main/.dev.vars`, which is gitignored.
  **Registering the Stripe dashboard endpoint is still a human's job**, and it is the last of
  the manual steps in `apps/main/README.md` because it needs the production URL.
- **Granting the anon role anything on a table, or adding a function it may execute.** The
  thirteen it may call are named in `packages/db/tests/entries.test.ts`, and that list is there
  to make a fourteenth a decision somebody takes in a diff rather than a side effect. **Reading
  people is settled** — the admin surface is
  [ADR-013](docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) and its
  amendment: originally a Worker secret plus a key per person, and **since #57 and #58 the
  `nn-admin` role**, checked by `identity.has_permission()` since #107 and by
  `identity.has_role()` before it. Eleven functions are granted to `authenticated` now, and
  `entries.test.ts` names them with the argument for each. **Cancelling an entry is settled and
  nothing else about editing one is.** Somebody holding `nn.entry.cancel` — which `nn-admin`
  carries and `super-admin` deliberately does not — may refund one purchase in full, which
  deletes its entrants and returns the place —
  [ADR-018](docs/architecture/decisions/adr-018-cancelling-an-entry.md). **Transfers,
  corrections, manual entries, resends and partial refunds are each still a stop-and-ask**, and
  each is a decision about changing a record somebody paid for.
- **A sixth role, or an eighth permission.** Since #107 a role is a bundle of permissions and
  code checks the permission, never a role name —
  [ADR-017](docs/architecture/decisions/adr-017-permissions-are-what-code-checks.md). The five
  roles and the seven permissions are asserted exactly in
  `packages/db/tests/identity-permissions.test.ts`, which is what replaced `identity.roles`'
  check constraint and does the same job: it makes an addition a decision somebody takes in a
  diff. Adding a role is a migration and no deploy — `/admin/people/` reads
  `identity.grantable_roles()`. **`people-admin` is the fifth and it is what the mechanism was
  built for** — one permission, `identity.person.read`, which opens `/admin/people/` to be read
  and nothing else on the surface. Reading the club's people and changing what they may do are
  two permissions, and `super-admin` holds both because granting a role means finding somebody
  in that list first.
- **Any DNS change that is not an additive record.**
- **Anything that would need the Supabase service role key.** If a build appears to want
  one, the row-level security policy is wrong and *that* is the thing to fix.
- **Any change touching the timing platform** — `src-race-timing`, or the `public` and
  `private` schemas.
- **Anything that would put a credential in the repository.**
- **Changing `[auth]` in `packages/db/supabase/config.toml`.** It ships to production on
  every merge that touches a migration, and there is **no partial apply** — a rejected value
  takes `site_url`, the redirect allowlist, `enable_signup` and the captcha secret down with it
  while `db push`, which runs first, goes on succeeding. That is issue #79, and it cost four
  red deploys. `enable_signup` is **on**, as of #49 and decision 005; **no email-template block
  may be declared at all** while the project is on the free tier's default mail provider.
- Discovering that a **free tier's terms differ** from what is recorded.

---

## The shape of the place

```
docs/         Documentation. The root is documentation; nothing builds here
platform/     The npm workspace — apps/, packages/, all tooling
dev           The one command for local work. Run it from the root
```

**`npm` at the repository root will fail.** There is no `package.json` there, deliberately.
Use `./dev`, or `cd platform` first.

```bash
./dev up      # rebuild the database, then the whole site on http://localhost:8787
              # --keep-data skips the rebuild, when the schema is already current
./dev test    # the Worker and acceptance tests, then everything stopped
./dev check   # rebuild the database, then lint, types, unit and database tests
./dev down    # stop the Workers and the database
```

**`up`, `test` and `check` all rebuild the database**, because `supabase start` applies
migrations only to a volume it creates — so on any machine that has run this before, the three
otherwise meant three different schemas. It costs tens of seconds and the local data, which is
only ever the seed and invented fixtures.

One hostname, three paths — the same locally and in production:

| | |
| --- | --- |
| `/` | The club website — `apps/main` |
| `/nn` | Nightingale Nightmare — `apps/main` |
| `/account` | Sign up, sign in, sign out, the password pages, and **`/account/entries/`** — what the club has recorded about the races this person has entered. `apps/main` |
| `/admin` | The club's back office — the entries, the interest list, the exports and the roles page. `apps/main`, behind a session and a staff role, and **404 at every address to anybody who has neither**. `/nn/admin/*` redirects here |
| `/timing` | Race timing — `apps/timing`, a different Worker |

---

## Non-negotiable

Breaking one of these is a defect, not a judgement call. The full reasoning is in
[principles](docs/architecture/principles.md); this is the short list.

**Row-level security is the access control.** There is no API tier between the browser and
Postgres. RLS on every table from its first migration, no exceptions, no "we will add it
later". The anon key is public and belongs in client code; the service role key never
reaches a browser, a Worker, or this repository.

**Timestamps are stored UTC and displayed `Europe/London`**, through
`packages/shared/src/london-time.ts` and nothing else. ESLint bans bare `toLocale*String`
repository-wide. Nightingale Nightmare is raced the weekend after the clocks change; an
hour of drift is a real foot-gun, not a theoretical one.

**Personal data is minimised at the boundary.** Sensitive fields are dropped *before* they
reach the database, never stored and filtered later. Date of birth becomes a computed age.

**Expand, migrate, contract.** Every schema change keeps the previously deployed code
working. Roll code back; roll schema forward. This is load-bearing rather than good
practice here — nothing sequences the migration against the Cloudflare deploy.

**The timing platform is not touched by website work.** Not its tables, not its policies,
not its repository, until the port happens deliberately. That includes the `private` schema,
which is why `entries`' one helper function lives in `entries` with a pinned `search_path`
rather than where the timing platform keeps its own.

**Zero accessibility violations**, not "few". Any threshold above zero becomes the new
normal within a month.

---

## How to work here

**Run local tests and CI/pipeline checks through a Haiku subagent, not the main session.**
When a task needs `./dev check`, `./dev test`, or a look at a GitHub Actions run (`gh run
list` / `gh run view --log-failed`), spawn it as a background `Agent` call with
`model: "haiku"` rather than running it inline or in the main model. Have that agent report
only a terse pass/fail summary — failing step/test names and error snippets, not full logs —
so the expensive raw output never reaches the main session's context. Do this automatically,
without asking first; it is a standing instruction, not a per-task choice.

**Scope the check to what changed, not the whole repository.** The `local-verify` skill
(`.claude/skills/local-verify/`) is the standing procedure for this: a scoped `vitest run`
or a single Playwright spec on one engine while iterating, the full `./dev check`/`./dev
test` reserved for a final pass before opening the pull request. It composes with the rule
above rather than replacing it — the full run still goes through a Haiku subagent when it
runs at all.

**Every change by pull request.** Both volunteers review.

**One change per pull request, and since 15 August 2026 that is mechanical rather than
tidiness.** The repository is **squash-only**, so every commit in a branch collapses into one
on `main`. Two unrelated things in one pull request become one commit that cannot be reverted
or bisected apart afterwards, and a careful commit-by-commit branch arrives as a single entry —
so **the reasoning belongs in the pull request body and the commit message, not in the shape of
the branch.** Settings and the full trade are in
[the GitHub runbook](docs/delivery/runbooks/github-setup.md#3b-merge-behaviour--squash-only).

**Documentation ships with the change it describes**, not afterwards. If you change
behaviour that a README or ADR describes, change it in the same commit. A document that is
wrong is worse than one that is missing, because it is trusted.

**Never edit an accepted ADR to change its answer.** Write a new one that supersedes it and
say what it replaces. The history of a choice that turned out badly is worth more than a
tidy file.

**Use [the glossary](docs/foundations/glossary.md)'s words exactly.** An *event* is one
running of one race in one year; a *race* is the recurring thing; a *team* is the unit of
entry even when it holds one runner. Getting this wrong in a schema is expensive.

**Any step done by hand is written down** — what, why, by whom, and how to redo it. That is
what makes the manual exceptions legitimate rather than merely convenient.

**Boring beats optimal.** Every unusual choice is a tax on somebody who has not been hired.
If you reach for a tool because it is better, check first whether the mainstream one is
good enough — it usually is, and a third volunteer will already know it.

**Markdown wraps at roughly 90 characters.** Tables and URLs excepted.

### Writing tests

Four layers, and each tests something the layer below cannot: unit, database against a real
Postgres, the Workers runtime via Miniflare, and Playwright with axe.

**`./dev check` runs the first two; `./dev test` runs the other two** — the Miniflare layer
needs a build, which is why it waits for `test` rather than `check`. Between them the two
commands run every layer CI does, which was not true until a green laptop sent a red pull
request.

**The negative case is usually the one that matters.** That an anonymous client *cannot*
read `club` proves more than that a member can. Assert the specific error, not merely that
something failed — a test that passes because the table does not exist yet is a test that
has stopped testing.

**Fixtures are deterministic and invented.** Fixed UUIDs, fixed timestamps, addresses at
`example.com`. No production data on a laptop, ever. Include the awkward states — consent
withheld, an apostrophe in a name, the repeated hour on the clocks-change weekend — because
those are what break rendering.

---

## Traps that have already cost time

Each of these cost an hour or more, and none is obvious from the outside.

**`opennextjs-cloudflare build` runs one of `apps/timing`'s own npm scripts.** Naming that
script `opennextjs-cloudflare build` makes it invoke itself. It recursed 205 levels and took
a laptop down. `build:next` exists solely to be what OpenNext calls, and the duplication is
the guard.

**A leading underscore on an App Router folder silently deletes the route.** `_health/` is the
conventional spelling for an endpoint that is not a page on more or less every other platform,
and in `apps/timing` it is a **private folder**: Next opts it out of routing entirely, so
`app/_health/route.ts` builds clean, deploys clean, and 404s — with nothing anywhere saying
why. The timing app's health endpoint is `app/health/route.ts` for that reason, and the comment
at the top of it says so. `apps/main` is Astro plus a Worker and has no such rule, which is
what makes the pair easy to get wrong: the same name is fine on one side of the hostname and
invisible on the other.

**So the two health endpoints are spelled differently on purpose** — `/_health` in `apps/main`
and `/timing/health` in `apps/timing` — and **the underscore on the Astro side is load-bearing
too, for the opposite reason.** `trailingSlash` is `'always'`, so a page at
`src/pages/health.astro` would serve at `/health/` while the Worker went on answering
`/health`, because it matches before the assets binding. Two live addresses one character
apart, no error and no failing test, and a runner looking for the club's advice on training
gets a database report. This is a running club; `/health/` is a page somebody will want.

**An ambient `NODE_ENV=development` breaks the Next.js build**, reporting it as
`Cannot read properties of null (reading 'useContext')` while prerendering a page nobody
wrote. Every build script pins `NODE_ENV=production`.

**Two copies of React or Next in the workspace break the build** in ways that read as
application bugs. After changing a version, `npm dedupe` and check there is one copy.

**Keep `routes` under `env.production`.** At the top level, `wrangler dev` rewrites
`request.url` to the custom domain and a plain `wrangler deploy` would put localhost config
on a live hostname.

**`TIMING_ORIGIN` must never appear in `env.production`.** Its absence is what makes
`/timing` Cloudflare's job at the edge rather than an extra proxy hop.

**Detach background servers properly** — `nohup`, redirected streams, closed stdin. A child
holding the terminal makes the parent never return.

**Prettier reformats the contents of a template tagged `html`, and it is not configurable.**
`worker/html.ts` is the auto-escaping template the admin pages are built with — the one place in
this repository that builds markup in a Worker, because a list of entries is a variable number of
rows and there is deliberately no `setInnerContent(..., { html: true })` anywhere here. Formatting
the file reflows the markup inside every `` html`…` ``: nested elements are indented onto their own
lines, and `attr='x'` becomes `attr="x"`. Harmless in a browser, and it means **a sentence written
across a line break arrives with a newline in the middle of it**, so `toContain('over its field')`
fails on markup that is perfectly correct. That is the `{' '}` trap one framework along. The tests
squash whitespace before matching; the tag keeps its name because readable markup is worth more
than exact-output assertions.

**A visually-hidden span inside a horizontally scrolling table makes the whole page scroll
sideways.** `overflow` only clips a descendant whose containing block is inside the scroller, and
`.admin-visually-hidden` is `position: absolute` — so with no positioned ancestor its containing
block was the *page*, it was laid out at the far edge of a 793px-wide table, and the document
scrolled at 320px while the table scrolled correctly and the spans stayed invisible. Nothing
looked wrong; the page just slid left under a thumb. `position: relative` on `.admin-scroll`
makes it the containing block, measured 783 → 320. The same is waiting for any absolutely
positioned thing inside any scroller.

**The three browser engines do not agree on what an attachment is, and one of them only
disagrees on Linux.** Given `content-type: text/csv` and `content-disposition: attachment`,
Chromium downloads it — the `download` event fires and `response.body()` is *unreadable*, because
the bytes went to the downloads directory. macOS WebKit downloads it too, which is why
`waitForEvent('download')` passed nine local runs in a row. **WebKit on a Linux runner renders it
in the tab**: no download event ever fires, the page navigates to the endpoint, and the CSV is
the body. Only CI saw it, exactly like the radio-focus bug, and it was the one red test in the
first pipeline run of the admin slice. **Assert an attachment on the response, not on the
download** — the status, the content type and the filename are what is specified and every
engine agrees on them; for the bytes use `page.request`, which shares the context's cookies and
hands back a readable body everywhere. Reproduced in
`mcr.microsoft.com/playwright:v1.62.1-noble`. `nn-admin.spec.ts`'s two export tests are the
shape to copy.

**A CSV's byte-order mark is invisible to `Response.text()`.** `TextDecoder` strips a leading
U+FEFF by default, so a test that decodes the body reports a mark that is on the wire as missing —
and one written the other way round would pass on a file that opens as mojibake in Excel on every
Windows machine the club owns. Assert on the bytes (`EF BB BF`), or decode with `ignoreBOM: true`.

**The Worker was not typechecked at all until Slice E**, and the reason was one line:
`worker/tsconfig.json` had named `@cloudflare/workers-types` since the skeleton and nothing ever
installed it, so `tsc -p worker` failed at the first import and no script ran it — while
`astro check`, which is what `npm run typecheck` calls, excludes `worker/` by its own tsconfig.
Nothing covered the code that takes the money. It is wired in now as `typecheck:worker`, and it
found a real defect on its first run.

**A CSS `@view-transition` breaks the sign-up form with JavaScript disabled.** Four lines,
no JavaScript, and after the form's POST/422 the `::view-transition` overlay swallows the
click on the error summary's link — silently, so the person just finds that nothing happens.
Reproduced 5/5, gone 3/3 with the rule removed, and it passes with scripting *on*, which is
what makes it easy to ship. `nn-signup.spec.ts`'s "links from the summary to the field it is
about" is the guard. Full note at the foot of `packages/shared/styles/nn-theme.css`.

**A message that appears on `focusout` can swallow the click that caused it.** The England
Athletics box is a `.field` *inside* the affiliated `.nn-fee` card, so `fieldOf` — which took
`closest(container)` and then the first `[data-entry-error]` beneath it — answered `eaNumber`
for the affiliated **radio**. Leaving that radio made the England Athletics box complain about
a number nobody had been asked for, and it did so *between the press and the release of the
click*: 67px of message, above the other two cards, pushing them 72px down out from under the
pointer, so no `click` ever reached the radio and **the entry type could not be changed at
all**. **Only CI saw it, and that is the trap** — macOS and iOS WebKit leave a radio unfocused
when it is clicked, while the GTK/WPE WebKit that `playwright install webkit` puts on a Linux
runner focuses it, so `focusout` never fires on a laptop. Chromium at 1280px survives on luck:
the shift is small enough that the release still lands on the card's own `<label>`, which
forwards the click. Reproduced on Linux WebKit in `mcr.microsoft.com/playwright:v1.62.1-noble`
and in Chromium at 320px. `nn-entry.spec.ts`'s "shows a running total once an entry type is
chosen" is the guard, and the rule is the general one: **a container's message belongs to that
container, not to a field nested inside it.**

**A conditional field that collapses moves the control that revealed it.** The same England
Athletics box, the same nesting, one layer up: it sat *inside* the affiliated card, so changing
to another entry type collapsed 277px from **above** the two cards below it. At 320px the card
somebody had just chosen went from y=271 to y=-7 — they tapped it, and the feedback for their
own tap was the page throwing them somewhere else. It is a plain `.field` under all three cards
now, where showing and hiding it moves only what is below and the cards do not move at all:
measured Δ0 in WebKit and Δ1px in Chromium — a pre-existing sub-pixel border swap — across all
48 combinations of engine, width, transition and input method. **Put a conditional field after
the group it is a condition of, rather than inside it.** The adjacency that buys is worth less
than the stability it costs, and the field's own hint can say what the nesting was saying.
`nn-entry.spec.ts`'s "keeps the entry type that was chosen in view when the fee changes" is the
guard, and it runs in all three projects.

**A navigation label is not free text, because the bar's height is what pays for a defect.** The
Nightingale Nightmare bar was unstuck by [ADR-012](docs/architecture/decisions/adr-012-one-navigation-bar.md)
over three defects and stuck again by [ADR-014](docs/architecture/decisions/adr-014-the-bar-stays-and-the-notice-is-in-it.md),
which answers defect 2 — arrow-keyed radios landing behind the bar in WebKit at 320px — with
`scroll-padding-top`: a hand-written token per breakpoint that has to clear the bar's height at
**every** width. So a longer label is a layout change rather than a copy one. Renaming "Race day"
to **"Race instructions"** added **48px** — a whole second row — at every width from 768px to
1440px and again at 560px, putting the bar over its inset, which lands every anchor and every
keyboard focus behind the header. Nothing looks wrong; the page just stops scrolling to the thing
it was asked to scroll to. The page is still *headed* "Race instructions" and the bar says **"Race
info"**, which measured identical to "Race day" at all thirteen widths — the bar has always been
allowed to be shorter than the heading, and read "Spectators" over "Watching the race" from the
day it was written. **"Spooktators" was free.** `site.spec.ts`'s nine-width sweep is the only
reason any of this was seen, and a check at 1280px and 320px would have passed every broken
version of it.

**A leak assertion that matches a bare numeric string against rendered HTML is unreliable, and it
fails towards passing.** Markup is full of arbitrary digits that belong to nobody: every inline
SVG here carries `xmlns="http://www.w3.org/2000/svg"`, and the path data under it is thousands of
coordinates. So `expect(html).not.toContain('2000')` can **never** pass on any page that renders
the club wordmark — while `not.toContain('1700')` passed for months, not because the amount was
absent but because that particular number happened not to collide. **The guard was testing
whether the current value clashed with decoration, not whether it leaked.** Two rules, and both
are needed: **strip decorative markup before matching** —
`(await page.content()).replace(/<svg[\s\S]*?<\/svg>/g, '')`, because decoration cannot hold
personal data — and **derive the expected value from the fixture rather than writing a literal**,
because a literal stops testing silently the moment the value moves. Deriving without stripping
fails loudly on the namespace; stripping without deriving goes quietly vacuous, which is the
worse of the two because the line still looks like coverage.
`nn-entry-complete.spec.ts`'s "a real session id reveals nothing about anybody either" is the
shape to copy.

**`osascript -e 'quit app "Docker"'` can return cleanly while `com.docker.backend` keeps
running**, and `open -a Docker` then reattaches to the same wedged instance rather than starting
a new one. The symptom is every `docker` command answering `500 Internal Server Error … check if
the server supports the requested API version`, which reads as a CLI/daemon version mismatch and
is not one — the backend is alive and the Linux VM behind it is dead. Two things give it away:
asking for a different API version changes the version in the message and not the 500, and
`pgrep -fl com.docker` shows backend processes older than the restart. **`pkill -f
com.docker.backend` before `open -a Docker` is what actually restarts it** — fifteen seconds,
against an hour of retrying `./dev check`. A laptop that sleeps mid-`./dev` is the reliable way
into this state, because it kills the Supabase containers under a daemon that stays up.

**A second `./dev test` on the same machine kills the first, and the symptom is a flaky suite
rather than a collision.** `stop_workers` kills by command-line pattern, machine-wide, with no
notion of which run owns what — `pkill -f "wrangler dev --port 8787"`, then a bare `pkill -f
workerd` — and `cmd_test` calls it *early*, right after the build. Those patterns are exactly
what Playwright's `webServer` block starts, so a run dispatched before the first has finished
takes the live run's servers out from under it: a handful of tests pass and the rest die on
SIGTERM, with nothing in the output naming the other run. The single `.dev/test.log` and the one
Supabase volume go the same way, so the transcript read afterwards is a mixture of both runs.
**The tell is `pgrep -fl 'dev test'` answering twice**, one of the two older than the failures
on screen. **Wait for the run that was dispatched** — this is the sharp edge of running tests
through a subagent, because a background run that looks slow is exactly what makes somebody
start another.

---

## What is not built yet

So you do not go looking for it, or assume it is missing by mistake: there is **no confirmation
email and no timing application code**.

**There is no rate limiting live anywhere, and both layers of it are now written down.**
`[auth.rate_limit]` in `packages/db/supabase/config.toml` is chosen rather than defaulted, with
a comment per value and `tests/unit/config.test.ts` asserting each — **and the trap that decides
those numbers is that "per IP address" is not the runner's address**: every GoTrue call the
account area makes is server-side, so a per-IP limit behind the Worker is a project-wide limit
and a tight number is a cap on the whole club. The per-person layer is Cloudflare's, recorded as
a reviewable artefact in `docs/reference/cloudflare-waf-rules.md` — the race forms' rule and the
four account rules in one table — and **not one of them has been created in the dashboard yet**.
The runbooks that gate them are `entries-open.md` step 0.1 and `accounts-open.md`.

**There is a staff backend at `/admin/`, and everything under it answers 404 to anybody who may
not be there.** Signed out, a plain `registered`, the wrong role, an address nobody built — all the
same ordinary not-found page, because a 403 discloses that the address exists. `/admin/nn/` reads
the entries for a running, the interest sign-ups, one medical note at a time, three CSV exports
and a printable start list; `/admin/people/` is who holds what, and where a role is granted. The
way in is an account holding `nn-admin`, `people-admin` or `super-admin`, checked per request
through `identity.my_roles()` and `identity.my_permissions()` —
[the admin runbook](docs/delivery/runbooks/entries-admin.md) has the addresses and the bootstrap.
**The sections are gated on permissions and the door is gated on roles**, and the split is
deliberate: `isStaff()` answers "is this person staff", which `nn-tester` must fail even though
it holds a permission. **`/admin/people/` has two readings and it is one page**: reading it is
`identity.person.read` and the controls on it are `identity.role.grant`, so a `people-admin` gets
the same table with no third column and a POST refused with the same 404.

**The two-key scheme is retired in the Worker, and the break-glass changed with it.** #58 moved
the surface off `/nn/admin` — every one of those addresses now redirects, 301 for a GET and 308
for a POST, because they were in a published runbook. Installing `ENTRIES_ADMIN_KEY` and a key
per volunteer opens nothing any more. **The thing to keep available is a second person holding
`nn-admin`**, which takes a minute at `/admin/people/` and no deploy. #57 left the four key-gated
database functions in place and #63 removes them; `worker/admin-session.ts` and `adminSignIn()`
are unreferenced and go with them.

**It is in the club brand, and `nn-theme.css` must never reach it.** A tool rather than a
page a runner reads, and it will serve Pass the Buck — so every colour is a `--colour-*` name and
there is not one hex value in `packages/shared/styles/nn-admin.css`, which
`packages/shared/tests/unit/admin-contrast.test.ts` asserts along with the contrast of every wash
the surface mixes. **The audit trail is deliberately not on it**: nothing may read
`entries.admin_audit`, and rendering it would need a fourteenth anon-callable function, which is a
stop-and-ask rather than a layout decision.

**A cancelled entry stays on `/admin/nn/`, with no runner on it.** `cancel_entry()` deletes the
entrants — deliberately, so the club stops holding personal data for a race somebody is not
running — and `read_entry_list()` inner-joined them, so a refunded purchase could not appear on
that page at all: the **Refunded** filter could never match a row, and a volunteer clicking it
concluded there had been no refunds. The list is purchase-driven with the entrant left joined
now, and a row with no runner reads "No runner recorded", exactly as `/account/entries/` has
always rendered the same purchase. **The counts were already right** — they read the purchase
grain — and **`holding` and the three exports keep their inner joins**, because capacity is
measured in runners and a start list has nobody to put on it. #116.

**The medical notes are deleted a month after the race, and the promise and the enforcement are
tied together by a test.** `entries.events.medical_retention` is what the five-minute cron
applies; `race.json`'s `privacy.medicalRetention` is what `/nn/privacy/` publishes;
`packages/db/tests/entries-retention.test.ts` reads both and fails unless the words are the ones
the interval generates through `packages/shared/src/medical-retention.ts`. **Changing either one
alone goes red.** That is the only thing stopping the club publishing one period and keeping
another.

**A race is the recurring thing; an event is one running of it in one year, and the routes say
so** — [ADR-011](docs/architecture/decisions/adr-011-a-race-and-its-runnings.md). Evergreen:
`/nn/` (the race, and the interest form), `/nn/course/`, `/nn/privacy/`. The 2026 running:
`/nn/2026/` (the date, the facts, the entry form), `/nn/2026/race-day/`,
`/nn/2026/spectators/`, `/nn/2026/entry/complete/`. Plus a column-scoped anonymous-insert
policy on `intake.nn_interest`.

**`/nn/` never names a year, and nothing in its markup may.** It asks
`entries.current_entry_state('nn')` — the forthcoming running of race `nn`, else the most
recent past one — and the Worker paints every link to a year page onto it. Publishing 2027 is a
row in `entries.events` plus that year's content pages, with no edit to `/nn/` and none to the
Worker. `/nn/<year>/` is the event `nn-<year>`, and `worker/routing.ts` owns that convention as
two functions that are inverses of each other.

**Entries are built here, in `apps/main`** — [ADR-009](docs/architecture/decisions/adr-009-entries-in-apps-main.md)
retired the plan to give them a repository of their own. **The two forms are on two pages**,
and the address a submission arrives at is what tells them apart — there is no hidden `form`
field any more. Each page carries two states and the Worker reveals one, decided per request
rather than by a deploy. `entries.events.entries_open_at` is `null` today, so production serves
the interest form on `/nn/` and "entries are not open yet" on `/nn/2026/`.

**A valid entry holds a place and goes to Stripe Checkout.** One transaction under a
per-event advisory lock: re-check the window, count the places gone, price it from
`entries.fees`, write a `pending` purchase with a 31-minute hold. Then a Checkout session for
exactly that amount and a 303 to it.

**Every rule is enforced in the database, and Zod is never the only place one lives.** Slice E
found `create_pending_purchase` writing `ea_number` without ever consulting
`fees.requires_ea_number` — so two PostgREST calls with the published anon key bought an
affiliated place with no England Athletics number, £2 under. Zod required it; **Zod is the
form's control, not the system's**. Slice G audited every rule by *attempting the bypass* with
an anonymous client and found eight more, the worst being that the entry terms were not
enforced at all: `p_consents = {}` was accepted and stored as `{}`. All nine are closed — a
check constraint where the rule is static, a trigger where it spans tables, and the function
for the two a person needs words about (`ea_number_required`, `consents_missing`).
`packages/db/tests/entries-rules.test.ts` re-attempts each bypass and asserts the **specific**
refusal, because a Postgres error is not a refusal: a broken function refuses everything, which
reads as every rule holding at once. **The tenth rule is "one entry per runner", and it is the
first one a person is meant to meet.** The form claimed it in prose from the day it was written
and nothing enforced it, so somebody who already had a place could pay again and take a second
one out of 250 — #115. `create_pending_purchase()` now refuses with `already_entered`, keyed on
**first name, last name and date of birth** and counting only a *live* place: `paid`, or
`pending` with a hold that has not lapsed, so an expired hold or a cancelled entry lets somebody
try again. **Not `purchaser_email`** — one card legitimately pays for a partner, and refusing
that would cost a real runner a place. The check sits inside the per-event advisory lock, and
**every database fixture that enters more than once now carries a serial on the surname**,
because a suite whose runners are all the same person cannot hold two places any more. **Which consents an event requires is
`events.required_consents`**, not a constant — the set differs between races. **Four check
constraints ship `NOT VALID`** and protect every new write; validating them against the rows
already there is [a runbook](docs/delivery/runbooks/entries-constraints.md), because a
validated `ADD CONSTRAINT` fails the migration if one existing row disagrees and nobody here
can see production's.

**`POST /nn/stripe-webhook` is the only thing that writes `paid`, and nothing else may.** The
redirect back from Stripe is not proof of payment — a tab can be closed before it fires, and the
return URL is one anybody can type. The webhook verifies Stripe's signature over the **raw
bytes** before parsing them, and the transition is idempotent by state guard under the same
per-event advisory lock the entry path takes. [ADR-010](docs/architecture/decisions/adr-010-webhook-writes-paid.md)
records the three decisions it took.

**The failure direction is inverted there, and only there.** Everything else in this repository
fails towards taking no money. By the time the webhook runs, the money has gone — so *our*
failures answer 5xx and let Stripe retry for three days, and only "this is not Stripe" gets a
400. A 200 on an outage drops a real payment.

**A payment that arrives after the hold lapsed is still `paid`.** It is never refused. If there
was no room it is `paid` with `attention = 'over_capacity'`, it consumes a place, and the
five-minute cron shouts about it until a human clears the flag —
[the runbook](docs/delivery/runbooks/entries-attention.md). There is deliberately **no fifth
status**: the capacity predicate counts `status = 'paid'`, and a new value would be invisible to
it and let an oversold place be sold twice.

**`/nn/<year>/entry/complete/` reports what the club has recorded, and only `paid` makes a
positive claim.** No state ever makes a negative one — a lapsed hold must never say "nothing was
charged", because the webhook may simply be late and somebody who believes it pays twice.

**The anon role still holds no grant on any table in `entries`.** It may call **thirteen**
functions and nothing else — the seven the entry and payment path needs, and the six the admin
surface added:

| | |
| --- | --- |
| **Public configuration** | `entry_state()`, `current_entry_state()`, `entry_completion_state()` |
| **The entry path** | `create_pending_purchase()`, `attach_checkout_session()` |
| **Housekeeping** | `expire_pending_holds()`, `delete_expired_medical_notes()` |
| **Payment** | `record_checkout_event()` — **takes a key** |
| **The admin surface** | `admin_sign_in()`, `admin_entry_list()`, `admin_interest_list()`, `admin_entrant_medical()`, `admin_export()` — **all take a key** |

**Six are granted to nobody**: `raise_attention()` writes the flag that says a purchase needs a
human, `admin_key_ok()` answers whether a string is the admin key, and `record_admin_action()`
writes the audit trail. Each would be a hole on its own — an alarm anybody could forge, an oracle
for the key, an audit trail anybody could fill — and all three are reachable only from the
definer functions that call them. **The other three are Slice G's rule enforcement** —
`assert_entrant_rules()`, `assert_medical_consent()` and `assert_purchase_consents()` — reachable
only from their triggers, and each reads a purchase, an entrant or a medical consent.

`packages/db/tests/entries.test.ts` asserts that exact set. If it fails, something granted a
privilege to a key that is published in page source. **Adding to that list is a decision, and the
test is what forces it to be made in a diff** — it has happened twice: `current_entry_state()`,
which discloses nothing `entry_state()` does not, and the admin surface's six, argued in
[ADR-013](docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md).

**`authenticated` is a second list and it went from six to eleven in #107.** It is a role
anybody who registers holds, so every function on it authorises inside itself and the grant only
says "you may ask". `create_pending_purchase()` and `attach_checkout_session()` are there because
a signed-in caller reaches PostgREST as `authenticated` rather than as `anon` — **not** because a
signed-in caller may do more. `my_entries()` is scoped to `auth.uid()` and the caller's confirmed
address; `cancellable_purchase()` and `cancel_entry()` refuse without `nn.entry.cancel`.

**Two functions in `entries` now answer differently depending on who is asking, and that is new.**
`entry_state()` hides a fee whose `requires_permission` the caller does not hold, and
`create_pending_purchase()` admits a `pre_open` event for a caller holding `nn.entry.before_open`.
Both resolve that through `auth.uid()` and **never through anything the caller passes** — a
parameter would be a free early entry for anybody who reads the page source. `entries_close_at`
and `active` are never bypassed. `packages/db/tests/entries-tester.test.ts` re-attempts every one
of those bypasses anonymously and as a signed-in person holding nothing.

**Six functions take a key, and the key is what makes an anon grant safe.** Without one, two
ordinary PostgREST calls with the published anon key would buy a free entry, because
`create_pending_purchase()` issues purchase ids on request — and the five admin reads would hand
anybody the club's entry list. `ENTRIES_WEBHOOK_KEY` and `ENTRIES_ADMIN_KEY` are **Worker
secrets**; the database holds only their SHA-256 digests, in `entries.webhook_secrets`, and both
ship null, which refuses everything.

**`delete_expired_medical_notes()` is the one anon-callable function that takes no key, and that
is deliberate.** It can only delete what `/nn/privacy/` has published a promise to delete, it
takes no arguments and returns a count — and gating it would make a legal retention obligation
stop being kept on any day the admin key was not installed.

**Somebody holding `nn-tester` can enter before entries open, and that is how the payment path
gets tested without touching `entries_open_at`.** The role carries one permission,
`nn.entry.before_open`, and it opens exactly one thing: `/nn/2026/` shows the entry form with a
notice saying why, and `create_pending_purchase()` admits a `pre_open` event. There is a £1
**Tester** fee on `nn-2026` gated by the same permission — invisible in `entry_state()` and
refused with `invalid_fee` by anybody else — so a real card can prove the club's live Stripe
account for a pound. **£1 rather than a penny because Stripe will not charge below £0.30 in
GBP** — a fee under that floor passes the free-place guard, holds a place, and only then fails
at the session call. **The Worker signs those two calls with the person's own token**, through
`createUserClient`, because the whole thing resolves through `auth.uid()`; a signed-out visitor's
path is unchanged and costs nothing extra. A tester's entry is a **real** entry: it consumes a
place, appears in `/admin/nn/`, in the exports and on the start list, and it is removed with the
cancel button rather than excluded from the thing it is testing.

**Production runs on Stripe *test* keys until entries open, and that is safe rather than
sloppy** — the only person who can reach Checkout before 1 September is somebody the club granted
`nn-tester` to. Swapping `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to live keys is the last
manual step before the window opens, and it is in the entries-open runbook.

**`/account/entries/` is what tells a runner they have a place**, and until #73 it is the only
thing that does besides Stripe's own receipt. It reads `entries.my_entries()`, which matches on
`person_id` — set when the buyer happened to be signed in — **or** on a `purchaser_email` equal to
the caller's confirmed address. **An account is not required to enter and is never created by
entering**: auto-creating one would write an unconfirmed `auth.users` row and grant it the signup
role, which is a false statement in the table whose job is to say who somebody is.

**A free place cannot be completed**, and it is the one gap somebody meets. Stripe refuses a
zero-total Checkout session, so a visually impaired runner's guide is told so plainly and
given the race address. Fixing it means deciding that an unpaid entry counts as paid, which
is a committee decision rather than a build one.

The current state, and what is deliberately deferred, is in
[the phases](docs/delivery/phases.md).
