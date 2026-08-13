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
  fees are confirmed too** — £15 affiliated, £17 unaffiliated, £0 for a visually impaired
  runner's guide — and they live in `entries.fees`, never in markup. **Still unconfirmed, and
  none of them may appear anywhere:** the 2026 ARC permit number (the 2023 number is not a
  substitute), the 2026 race director's name, the entry open and close times, the transfer
  deadline, and the minimum age. Do not invent a fact, do not infer one from a phase
  document, and do not put a plausible placeholder in markup.
- **Collecting a field beyond what is already specified.** Adding a database column that
  holds personal data is a committee decision. The committee has settled the *entry* field
  list — it is `packages/shared/src/nn-entry.ts` — and a fifteenth field is a new decision.
- **Taking payment is no longer a stop-and-ask**, but **connecting one is**: the treasurer
  has authorised in-house payment, and Slice A's submit handler deliberately validates and
  stops. Stripe's secret key and webhook signing secret are **Worker secrets**, never in this
  repository.
- **Any DNS change that is not an additive record.**
- **Anything that would need the Supabase service role key.** If a build appears to want
  one, the row-level security policy is wrong and *that* is the thing to fix.
- **Any change touching the timing platform** — `src-race-timing`, or the `public` and
  `private` schemas.
- **Anything that would put a credential in the repository.**
- **Changing `[auth]` in `packages/db/supabase/config.toml`.** It ships to production on
  every merge that touches a migration, and `enable_signup` is off because member-facing
  authentication is not yet a decided requirement.
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
./dev up      # the whole site on http://localhost:8787, browser opened
./dev test    # 45 acceptance tests, then everything stopped
./dev check   # lint, types, unit and database tests
./dev down    # stop the Workers and the database
```

One hostname, three paths — the same locally and in production:

| | |
| --- | --- |
| `/` | The club website — `apps/main` |
| `/nn` | Nightingale Nightmare — `apps/main` |
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

**Every change by pull request.** Both volunteers review.

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

**A CSS `@view-transition` breaks the sign-up form with JavaScript disabled.** Four lines,
no JavaScript, and after the form's POST/422 the `::view-transition` overlay swallows the
click on the error summary's link — silently, so the person just finds that nothing happens.
Reproduced 5/5, gone 3/3 with the rule removed, and it passes with scripting *on*, which is
what makes it easy to ship. `nn-signup.spec.ts`'s "links from the summary to the field it is
about" is the guard. Full note at the foot of `packages/shared/styles/nn-theme.css`.

---

## What is not built yet

So you do not go looking for it, or assume it is missing by mistake: there is **no Stripe
and no timing application code**.

Nightingale Nightmare has a sign-up form at `/nn/`, a privacy notice at `/nn/privacy/`,
three content pages at `/nn/course/`, `/nn/race-day/` and `/nn/spectators/`, and a
column-scoped anonymous-insert policy on `intake.nn_interest`.

**Entries are built here, in `apps/main`** — [ADR-009](docs/architecture/decisions/adr-009-entries-in-apps-main.md)
retired the plan to give them a repository of their own. `/nn/` carries **two forms**: the
entry form when `entries.events` says entries are open, and the interest form otherwise,
decided per request rather than by a deploy. `entries.events.entries_open_at` is `null`
today, so what production serves is the interest form.

**The entry form validates and stops.** There is no payment, no capacity enforcement and no
row written — a valid entry gets an honest 503 saying nothing was stored and nothing was
charged, because a confirmation for an entry that does not exist would be the worst thing
this page could do. **The anon role holds no grant on any table in `entries`**; the one
thing it may call is `entries.entry_state()`.

The current state, and what is deliberately deferred, is in
[the phases](docs/delivery/phases.md).
