# The timing app — architecture review

A read of [`src-race-timing`](https://github.com/bindalshah/src-race-timing) as it stood
on 5 August 2026 (last push 11 July 2026, four days after Pass the Buck).

Written because the website reads this application's data, the club intends to port it to
Cloudflare, and Nightingale Nightmare is expected to run on it. Everything below is
observed in the repository, not inferred from the proposal.

> **Read-only relationship.** Nothing here is an invitation for website work to change
> this application. See the race-day risk constraint in [requirements](../foundations/requirements.md#risk).

---

## Purpose

Live race timing for Pass the Buck, a two-person relay at Ashton Court, Bristol, with
roughly 100 teams. Raced 8 July 2026, 19:00 BST.

The physical constraint the whole design answers to: **one line does triple duty** — it
is the start, the handover, and the finish. Marshals stand at that line with their own
phones, in a crush, on whatever signal Ashton Court gives them. The app's job is to lose
no crossing.

## Stack

| | |
| --- | --- |
| Framework | Next.js **16.2.4**, App Router, Turbopack, TypeScript |
| UI | Tailwind v4, `@theme` driven from `design-tokens.json` |
| Data | Supabase — Postgres, Realtime, Auth (project `ovpvzabtjxbszsqschqy`, `eu-west-2`) |
| Hosting | Vercel, deploys on push to `main` |
| Offline | PWA, service worker at `/sw.js`, IndexedDB via `idb` |
| Tests | Vitest, pinned `TZ=UTC` |

Dependencies are notably few: `@supabase/ssr`, `@supabase/supabase-js`, `idb`,
`papaparse`, `next`, `react`. No date library, no state library, no UI kit. This is
the one-volunteer constraint in [requirements](../foundations/requirements.md#people) already being practised.

## Routes

**Public** — `/` (a server-side dispatcher rendering one of three views by session and
role), `/live/[event-slug]` (the leaderboard), `/login` (magic link),
`/auth/callback`, `/forbidden`.

**Gated** — `/admin/[event-slug]/{start,crossings,anomalies,results,spot-prize,danger-zone}`,
`/admin/registrations`, `/admin/staff`, `/marshal/[event-slug]`, `/roster`.

**Dev-only, 404 in production** — `/styleguide`, `/screenshot-fixtures/*`.

`next.config.ts` carries bare-slug redirects (`/pass-the-buck-2026` → `/live/…`) built on
a `RESERVED_TOP_SEGMENTS` list, with carefully-reasoned regex to stop the catch-all
swallowing asset requests and multi-segment admin paths. Worth reading before touching
routing anywhere in the platform.

## The data model

Six tables, all in `public`, plus helper functions in a `private` schema.

```
events ──┬── teams ──┬── runners        (one row per participant, leg 1 or 2)
         │           └── crossings      (via team_id, trigger-resolved from bib)
         ├── marshals                   (per-event roster, joins auth.users)
         └── crossings

staff_assignments   (GLOBAL role authority — separate from marshals)
admin_actions       (audit log)
```

### `events`

`slug`, `name`, **`format` — `'relay'` or `'solo'`**, `start_at`,
`actually_started_at`, `distance_m`, `course_notes`, `finished_at`.

`actually_started_at` is set when the countdown screen broadcasts T-0, and splits compute
against `coalesce(actually_started_at, start_at)` so a delayed start doesn't inflate
everyone's time. A small detail that reveals the standard the app is built to.

### `teams`

Despite the name, a "team" is **the unit of entry** — a relay pair or a single solo
runner. `team_number` (nullable until bibs are assigned), `category`,
`purchase_order_id` (the stable Full On Sport identifier, used as the import idempotency
anchor), `entry_type`, `bib_leg1` / `bib_leg2` overrides, `race_status`, and a frozen
legacy `dnf_at`.

### `runners`

One row per participant: `team_id`, `leg` (1 or 2), name, `gender`, `email`,
`club_name`, `age_on_day`.

**Note the PII boundary, which is deliberate and documented in the migration itself:**
date of birth, address, phone, emergency contact and medical information are dropped *at
the parser boundary* and never reach the database. `age_on_day` is computed from the
CSV's DOB against the event's race date — and the CSV's own `AgeOnDay` column is ignored
in favour of computing it. The raw CSV in Supabase storage is the audit trail; the table
holds operational data only.

This is [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully) already
implemented, and it is the pattern any new entry surface should inherit.

### `crossings`

`event_id`, `marshal_id`, `bib` (nullable — the queue captures time first, bib second),
`captured_at` (timestamptz, millisecond precision in practice), `source` (`tap` |
`manual`), `anomaly_flag`, `anomaly_reason`, `resolved_at`, `resolved_action`,
`team_id`.

`team_id` is populated by a Postgres trigger resolving the bib, so bib→team resolution
exists in both TypeScript (`lib/bib.ts`) and SQL (`private.resolve_crossing_team_id()`).
The repository is explicit that these two **must stay in lockstep**.

Three indexes, each with a stated reason: `(event_id, bib)` covers the leaderboard's
double join, `(event_id, captured_at desc)` covers the marshal feed, and a *partial*
index on open anomalies keeps the admin query cheap regardless of crossing volume.

### Bib encoding

A bib is an **opaque string**, exact equality only — never `parseInt`, never leading-zero
normalisation (`"0311" ≠ "311"`). Two schemes coexist:

- **Derived** — relay: `${leg}${team_number}`, so team 47 is `147` and `247`, and team
  100 is `1100` and `2100`, which still parses. Solo: the `team_number` alone.
- **Override** — `teams.bib_leg1` / `bib_leg2`, for walk-ins issued a physical bib at the
  desk, or any correction made on the roster page.

`effectiveBib(team, leg, format) = coalesce(override, derived)`.

### Auth and roles — two layers

- **`staff_assignments(user_id, role)`** is the **global authority**. `role` is `'admin'`
  or `'marshal'`. `proxy.ts` reads it on every gated request.
- **`marshals(event_id, user_id, …)`** is the **per-event roster** — whether someone who
  holds the marshal role globally may act on *this* event.

Onboarding is require-sign-in-first: a new staff member signs in, lands on a no-role
panel, emails an admin, and the admin assigns from `/admin/staff`. The alternatives
(an invitations table, service-role pre-create) were considered and rejected — the
reasoning is in `DECISIONS.md`.

### Row-level security

Enabled on every table from the first migration. Public `select` on `events`, `teams`,
`crossings` — that is what makes a public leaderboard possible without an API layer.
`marshals` is readable by authenticated users only. Writes require a matching
`staff_assignments` or `marshals` row.

Helper functions live in a `private` schema with pinned `search_path`, and one migration
exists specifically to fix RLS recursion — a hazard worth knowing about before writing
policies against these tables.

Anonymous reads under public-read RLS are exactly the mechanism the website will use for
the results archive.

## How a race night actually flows

1. **Import.** Admin uploads the Full On Sport CSV at `/admin/registrations`. The parser
   drops the sensitive columns, computes `age_on_day`, pairs runners into teams, and
   writes `teams` + `runners`. Re-importing the same file is a no-op, anchored on
   `purchase_order_id`.
2. **Bibs.** An assign-bibs action allocates `team_number`; the desk can override per leg
   for walk-ins.
3. **Start.** `/admin/[event-slug]/start` runs a countdown on a projected laptop screen
   and broadcasts T-0 into `events.actually_started_at`, so every device agrees on the
   start.
4. **Capture.** Marshals open `/marshal/[event-slug]`. The screen is a **queue model**,
   not bib-first entry: a full-width "Crossed now" button timestamps immediately and
   pushes a card into a queue; the bib is assigned afterwards on a numeric keypad. This
   is the right call — at the line, the scarce resource is the moment, not the marshal's
   attention.
5. **Offline.** Every capture lands in IndexedDB first. The row's state machine is
   `awaiting-bib → queued → syncing → removed`, with a distinct `failed` state so an
   offline tap never looks like an error and a real error never looks routine. Commits
   reuse a client-generated UUID as `crossings.id`, so retries are idempotent under
   `upsert(onConflict: 'id')`.
6. **Anomalies.** Duplicate bib, or a leg-2 crossing before that team's leg-1, flags the
   card orange with an inline message — **and never blocks**. The marshal resolves and
   confirms anyway. Admins clear flags at `/admin/[event-slug]/anomalies`.
7. **Leaderboard.** `/live/[event-slug]` subscribes to Supabase Realtime channels and
   updates within about a second. Splits are derived, not stored: A = handover − start,
   B = finish − handover, total = finish − start. A row carrying an unresolved anomaly is
   *marked as suspect* rather than shown as a confidently-wrong time.
8. **Status and results.** DNS / DNF / DQ are whole-team terminal labels that replace the
   time and sort last. Results and a prize summary export; `events.finished_at` flips the
   surfaces to a finished state.

## What is strong

- **Failure is designed for, not handled.** The offline queue, the idempotent retry, the
  never-block anomaly model and the two-bucket queue/failed split all come from taking
  the finish-line crush seriously.
- **Timezone discipline.** `lib/london-time.ts` exists solely to pin `Europe/London` on
  every conversion through one tested path, because the rest of the app leans on ambient
  `toLocaleTimeString` and the suite only passes because `TZ=UTC` is pinned. The module's
  own comment names this as the one-hour-drift foot-gun. **This matters enormously for
  Nightingale Nightmare**, which sits on the clocks-change weekend.
- **`DECISIONS.md` is 2,542 lines of append-only reasoning** with a consistent
  Status/Context/Decision/Rationale/Consequences/Revisit-if structure. It is the most
  valuable artefact in the repository and the strongest existing mitigation of
  [current state](../foundations/current-state.md#accounts-and-access).
- **Migrations document their own deployment ordering.** The registration migration spells
  out the deploy-then-migrate sequence needed to avoid a `42703` window in production —
  expand-migrate-contract reasoning applied by hand.
- **PII minimisation at the parser boundary**, before data reaches storage.

## What the website and the port need to know

**It is more multi-event-ready than the proposal suggests.** `events.format` has carried
`'relay' | 'solo'` since the first migration; `effectiveBib` resolves solo bibs; the
results export branches on format. Solo is modelled, not hypothetical.

**But "configuration rather than new software" is optimistic for Nightingale Nightmare.**
Three real gaps:

- The leaderboard's derivation is relay-shaped (`handoverAt`, `splitAMs`, `splitBMs`). A
  solo mass-start needs a single-crossing finish path through the display.
- `lib/categories.ts` derives **pair** categories from two runners' genders. Age bands
  (Vet 40/50/60, male and female) do not exist and are new work — though `age_on_day` is
  already on `runners`, so the data is there.
- Two pieces of single-event hardcoding are logged as open: `LOCATION_LABEL =
  "Ashton Court"` on the home hero, and race-day copy that assumes an evening start
  ("Tonight, HH:MM"). Both were explicitly deferred until a second event lands. That is
  now.

**Cloudflare portability looks good, with two things to watch.** The only Node built-in
import in application code is `randomInt` from `node:crypto`, covered by `nodejs_compat`.
`proxy.ts` is standard edge middleware (not Node middleware, which OpenNext does not
support). Realtime and Auth are browser-to-Supabase and indifferent to the host. The
risks are the Workers **bundle size ceiling** — 3 MB compressed on free, 10 MB on paid —
and the **10 ms CPU limit** on the free plan against server-rendered pages. See
[options](../solutions/options.md#c1c2--serving-pages-and-results).

**Three things must not be broken by any port:** the IndexedDB offline queue and its
idempotent-upsert contract; the TypeScript/SQL lockstep on bib resolution; and the
`Europe/London` pinning.

## Governance findings

**The repository sits in a personal GitHub account** (`bindalshah/src-race-timing`), not
the club's `admin-src` organisation. The proposal states that "code and documentation live
in the club's reach on GitHub" as a mitigation for key-person dependency. For this
repository that is not yet true. Transferring it to the club organisation is a small
action with a large effect on
[current state](../foundations/current-state.md#accounts-and-access), and it should happen before the port, not
after.

**The Supabase project is likewise the platform's single most valuable asset.** Confirm
who holds the account, whether more than one person can reach it, and where the free
tier's absence of automated backups leaves the permanent archive
([options](../solutions/options.md#c2--storing-the-archive)).

## Open items carried in the app's own logs

From `DECISIONS.md` "Open follow-ups" and `docs/ROADMAP.md`, the ones that bear on the
platform rather than on the app alone:

- **True two-marshal end-to-end verification** is still partial — the full path was
  blocked by the free-tier OTP rate limit and verified with two sessions of the same
  user instead. This belongs in the race-simulation checklist before any migration.
- **Multi-event hardcoding** (location, start-time copy), as above.
- **Marshal failed-card copy** currently surfaces a verbatim Postgres error.
- **Slice 6 Resend runbook** (custom sender domain, DNS) is deferred and overlaps the
  website's own domain work — worth doing once, together.
