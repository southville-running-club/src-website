# NN timing redesign — Phase 1 inventory

**Prepared:** 3 October 2026 · **Against:** `origin/main` at `a88416e` (#330) · **Brief:**
[`nn-timing-redesign-brief.md`](nn-timing-redesign-brief.md)

> **Answered at HALT 1, 3 October 2026.** Bindal's decisions and the errata they produced are at
> the top of [the brief](nn-timing-redesign-brief.md#errata-and-decisions-at-halt-1-3-oct-2026).
> In short: D2 confirmed (ADR-054, proposed), D3 deferred, D10 a scoped copy with no
> `packages/` change before the race, sign-out a link, Record crossings not a tab, last merge
> 23 October, mock race 27 October. This file is left as the record of what was found.

Read-only. Nothing in `platform/` was changed, no database was touched, and nothing was pushed.
Paths are relative to `platform/` unless they start with `docs/`.

---

## Corrections to the brief

Brief step 0.6 says to stop and report anything in the brief that the code contradicts. These
are the ones that matter, most important first.

### C1. ⚠️ The brief reverses an accepted ADR that landed yesterday

[ADR-053](../architecture/decisions/adr-053-the-timing-app-wears-the-club-header.md) (#330,
merged 2 October 2026 21:19) put **the club's public header and footer** on every timing page.
It also added the two section bars, the breadcrumbs, and the focus header on the console and the
marshal screen. Brief §4.1 is a description of that ADR's result, and brief D2/§7.4 (a
signed-in app shell with **no** public nav or footer) is the opposite of its decision §1.

- **This file's rule applies:** an accepted ADR is never edited. D2 needs a **new ADR that
  supersedes ADR-053 §1**. That is in line with the ADR the brief already asks for in §2.2, but
  it has to say what it replaces.
- **What carries over from ADR-053:**
  - the frame table (`lib/chrome.ts`, plus `tests/unit/chrome.test.ts`, which fails any page that
    is not in the table)
  - "tabs are filtered, never locked" through `canOpen()`
  - the danger zone kept out of the bar
  - the prerendered not-found page that reads nothing

  The brief's §7.4 already agrees with all four. **Only the chrome around them changes.**

### C2. ⚠️ ADR-053 is marked "to merge after 1 November" and it is merged

Its status line and the #330 title both say *"merge after 1 November"*. It is on `main` and,
going by the brief's 3 October screenshots (`nn-current/`), it is live: `apps/timing` deploys
through Cloudflare Workers Builds on every change under `apps/timing/**` or `packages/**`.

- **I can't tell from the repository whether that early merge was intended.** If it was not,
  that decision comes before this redesign.
- **If it was intended,** the brief's ring-fence wording ("the website-redesign work ring-fenced
  `/timing/**` until after 1 Nov") is already history, and ADR-053's status line is stale.

### C3. ⚠️ The Supabase project in step 0.2 is the old platform

`ovpvzabtjxbszsqschqy` / `src-race-timing` is the **old** timing platform, the Vercel one.
CLAUDE.md's stop-and-ask list says that platform is not to be touched.

- The `timing` schema this app reads lives in **this** repository's project, `ketipxpyjjglwpqazsft`
  (`packages/db/supabase/config.toml`, `[remotes]`). ADR-035 placed it there.
- **I did not run `list_projects` or connect to either project.** Phase 1 needed no database.
- §2's *"a separate approved slice using `apply_migration`, never `db push`"* also contradicts
  how this repository ships schema: `deploy-db.yml` runs `supabase db push` on merge. A migration
  here is a migration file in a pull request. Applying one from the MCP would make production
  differ from the repository.

### C4. Local `main` was four commits behind

The working checkout at `src-website/` is on `0d5ad61` and has someone's uncommitted
`/admin/nn/` email-column work in it (`CLAUDE.md`, `nn-admin.ts`, `nn-admin.css`, two tests). So
step 0.1 ("`git status` is clean") failed there.

- I left those changes untouched.
- I cut `timing-redesign-inventory` in a separate worktree
  (`../src-website-timing-inventory`) and fast-forwarded it to `origin/main` at `a88416e`.
- The four missing commits were #327, #328, #329 and #330. They contain everything the brief
  describes.
- **Other worktrees are live on related branches:** `timing-nav-links`, `club-header-timing`
  and `timing-landing-page`. I didn't look into them. Check whether any of them is unmerged work
  that this redesign would collide with.

### C5. Smaller corrections

| Brief says | Code says |
|---|---|
| Read `BRANDING.md`, `design-tokens.json` (step 0.3) | Neither exists in this repo. Those files are in the PTB repository. Here, `packages/shared/design-tokens.json` mirrors the **`--src-*`** timing palette in `tokens.css`, not `--club-*`. Brand docs are `docs/foundations/brand.md` and `docs/foundations/race-timing-brand-guidelines.md`. |
| Times show as "11:00 GMT+0" (§6.2 #8) | No source writes `GMT+0`. Every page formats through `formatLondon()` in `packages/shared/src/london-time.ts` (`en-GB`, `Europe/London`, `timeZoneName: 'short'`), and `london-time.test.ts` pins "… 09:00 GMT" **under Node**. If production shows `GMT+0`, the likely cause is the Workers runtime's ICU data, not the code. That would make it a runtime-specific defect the unit layer can't see. **Unverified.** It needs a look at the deployed page or a Miniflare assertion. |
| Bricolage is "already loaded" on timing | **True only on `origin/main`.** `club-chrome.css` declares the `@font-face`, and timing imports that file since #330. |
| "28 `.club-*` classes" | Correct for `origin/main`: `packages/shared/styles/club-chrome.css` defines exactly 28. |
| `.club-section`, `.club-focus` exist | They exist in `club-chrome.css` (since #329/#330), not in `club.css`. |
| D3 "split the console" | This reverses [ADR-045](../architecture/decisions/adr-045-race-night-is-one-console.md) (14 Sep, "race night is one console", #308), which folded those twelve addresses into six. A split needs a superseding ADR. The redirects in `next.config.ts` already point `…/crossings` and `…/anomalies` **into** the console, so they would have to reverse direction. |
| The danger zone and publish buttons are clickable when they should be blocked (§4.1 #5) | Confirmed, and the **server refuses both** (see §6). |

---

## 1. Routes

### 1.1 How a request is decided

- **`middleware.ts`** sends every address through `surfaceFor()` in `lib/access.ts`.
  - An address with no row is refused.
  - A request with no session is refused.
  - Otherwise it calls `identity.my_permissions()`. A row listing several permissions admits a
    caller holding **any one** of them.
  - Roster-scoped rows also call `timing.marshal_event()`.
- **A refusal** is rewritten to `/__refused`, which gives the prerendered 404 (ADR-044).
- **`canOpen(permissions, path)`** in `lib/access.ts` is the one function both the door and the
  bars use. **The new nav must use it too.** That is the "one source of truth" in brief §7.4, and
  it already exists.
- **`lib/chrome.ts`** maps every page to a frame (`timing` / `race` / `focus` / `club`) and
  holds `TIMING_TABS`, `RACE_TABS` and `openableTabs()`. `tests/unit/chrome.test.ts` enforces
  the mapping.
- **Not gated:** `/timing/health`, `sw.js`, `manifest.webmanifest` and `_next/static`.

### 1.2 Pages

The permission strings are exact. "Frame" is the ADR-053 frame each page uses today.

| URL | File | Permission | Frame | Reads | Writes (POST → route handler, 303) | Client |
|---|---|---|---|---|---|---|
| `/timing` | `app/page.tsx` | any `timing.*` | timing | `my_marshal_events`, and the permissions (#328: lists where this person may go) | — | — |
| `/timing/events` | `app/events/page.tsx` | `timing.event.manage` | timing | `list_events` | — | — |
| `/timing/events/[slug]` | `app/events/[slug]/page.tsx` | `timing.event.manage` | race | `event_detail` | — (links to every section, plus the danger zone at the foot) | — |
| `…/console` | `console/page.tsx` + `sections/{start,finish,status,anomalies,crossings,race-clock}.tsx` | `timing.event.manage` **or** `timing.crossing.resolve` | focus | `event_detail` always. `team_status_list` (`status_q`) if holding manage. `open_anomalies` and `crossing_log` (`log_q`) if holding resolve | `start/update` (`start`/`clear`), `finish/update` (`finish`/`reopen`), `status/update`, `anomalies/update`, `crossings/update` | `race-clock.tsx` |
| `…/registration` | `registration/page.tsx` | `timing.registration.import` | race | `event_roster` | `registration/update` (`import-from-entries`, `assign-bibs`, `override-bib`, `walk-in`), `registration/import` (multipart, `check`/`import`) | — |
| `…/marshals` | `marshals/page.tsx` | `timing.marshal.assign` | race | `roster_for_event`, `assignable_marshals` | `marshals/update` (`assign`/`remove`) | — |
| `…/leaderboard` | `leaderboard/page.tsx`, `live-board.tsx` | `timing.event.manage` **or** `timing.crossing.resolve` | race | `leaderboard`. Then `leaderboard/snapshot` (GET JSON) and the `leaderboard/live` WebSocket (`worker-entry.js`, never seen by middleware) | — | `live-board.tsx` |
| `…/results` (+ `#prizes`) | `results/page.tsx`, `prizes-section.tsx` | `timing.result.publish` | race | `results_preview`. Prize choices come from the query string (`lib/prizes.ts`) | `results/update` (`publish`/`unpublish`), `results/export` (`csv`/`xlsx`), `prizes/export` | — |
| `…/danger-zone` | `danger-zone/page.tsx` | `timing.event.manage` | race | `event_detail` | `danger-zone/update` (`confirmation`) | — |
| `/timing/marshal/[slug]` | `marshal/[slug]/page.tsx`, `marshal-screen.tsx` | `timing.crossing.record` + roster | focus | `marshal_event`. Then `known` (GET) and `sync` (POST JSON → `record_crossing`) | — | `marshal-screen.tsx` |
| not found | `not-found.tsx`, `not-found-body.tsx` | — | club | none (prerendered) | — | — |
| error | `global-error.tsx` | — | own html | — | — | yes |

**Redirects** (`next.config.ts`, all temporary, "revisit after 1 November"):

- `start`, `finish`, `status`, `anomalies` and `crossings` → `console?section=…`
- `prizes` → `results#prizes`

**The console** is five native `<details class="console-section">`, each headed by an `<h2>`:
Start, Finish, Race status, Anomalies, Timing log.

- Start, Finish and Race status are drawn for `event.manage`. Anomalies and Timing log are drawn
  for `crossing.resolve`.
- With no `?section=`, Start and Finish are open. Otherwise only the named section is open.
- `StartSection` has four `<h3>` states: Not started, A false start, The race is running, Race
  finished.

### 1.3 Meta, manifest and service worker

- **Metadata:** one export, in `app/layout.tsx`. **Every page has the same `<title>`**.
- **`robots`:** `{ index: false, follow: false }` is already set, which covers brief §7.9 there.
- **`themeColor`:** `'#00c85a'` (the `--src-green`) is set *inside* `metadata`. Next 16 wants it
  in a `viewport` export, and it is the old palette.
- **`public/manifest.webmanifest`:** scope and `start_url` are `/timing/`. `theme_color` is
  `#00c85a`. There is one SVG icon (the PNG pair is still owed).
- **`public/sw.js`:** cache `src-timing-v1`, scope `/timing/`.
  - `_next/static` is cache-first.
  - Navigations under `/timing/marshal/` are network-first with a cache fallback.
  - It never touches `sync` or `known`.
  - Only `marshal-screen.tsx` registers it.
  - ⚠️ **A restyle changes hashed asset names.** A marshal phone holding an old cached shell
    will pick the new one up on its next online load. That is fine, but it is a reason to land
    the marshal restyle well before the mock race rather than near it.

### 1.4 Defects found in passing (not presentation, not fixed)

1. **The console refuses a caller who holds only `timing.crossing.resolve`.** The door admits them
   (`access.test.ts` asserts this). But the page always calls `event_detail()`, which requires
   `timing.event.manage` (`20260914140000_timing_results_preview.sql`). So it renders "Not
   found" before drawing the Anomalies and Timing log sections it exists to show. **No current
   role holds `crossing.resolve` without `event.manage`**: only `timing-admin` and `src-admin`
   hold it, and both hold both. So the bug is latent, but it is real. It is relevant to D3: a
   split-out Anomalies page would hit the same read.
2. **`leaderboard/page.tsx`** still links to `…/anomalies` and `…/crossings`, so it relies on
   the redirects. Every other page links to `console#…`.
3. **`prizes/export`'s failure redirect** goes to `…/prizes?outcome=`, so it lands on the
   results page's generic outcome handling.
4. **`prizes-section.tsx`** exports `dynamic = 'force-dynamic'`, which does nothing in a
   non-route file.

---

## 2. Logic that must survive

Not one line of any of these changes in a presentation slice. Each is covered by tests that
already exist (§7).

| Area | Where | What it does |
|---|---|---|
| **Bibs** | `packages/shared/src/timing/bib.ts`, `anomaly.ts` (`parseBib`), `registration/bib-assignment.ts`; `apps/timing/lib/queue-state.ts` `validateBib` | Bibs are opaque strings ("0311" ≠ "311"). Relay bibs are leg-first, solo bibs are the team number. A DB trigger mirrors the rules. The marshal keypad's check is digits-only and deliberately looser. |
| **Start and finish** | `start/update`, `finish/update` route handlers; `start_event`, `clear_start`, `finish_event`, `reopen_event`; `lib/start-outcomes.ts`, `lib/elapsed.ts` | Idempotent by `where` (the losing press gets the winning time). A clock reaching zero starts nothing. Keep the hidden `intent` field names. |
| **Capture** | `marshal-screen.tsx`, `lib/queue-state.ts`, `lib/queue-db.ts` | Tap first, bib after. States are `awaiting-bib · queued · syncing · failed`. `RETRY_CAP = 10`, never reset. 30-second drain, plus on `online` and on confirm. The anomaly verdict is frozen at confirm. Reconcile on reload is by id. |
| **Offline and sync** | `public/sw.js`, `marshal/[slug]/sync`, `…/known`, `lib/sync-outcomes.ts` | The database's wording is never shown on a card. |
| **Categories and prizes** | `packages/shared/src/timing/awards.ts`, `categories.ts`, `gender.ts`, `result-category.ts`, `src/age-category.ts`; `lib/prizes.ts` | Twelve awards. DNS/DNF/DQ are excluded through one gate. Pass-overs and draws live in the URL. |
| **Statuses** | `results.ts` (`RaceStatus`), `status/update` | A label on top of crossings. DNS suppresses every time; DNF/DQ keep leg A. |
| **Exports** | `src/csv.ts`, `timing/result-export.ts`, `prize-export.ts`, `xlsx.ts` (`inlineStr`), `lib/exports.ts` | The prize file re-reads the URL's choices and never recomputes. |
| **Time zone** | `packages/shared/src/london-time.ts` (`formatLondon`, `formatLondonClock`) | The only formatter. ESLint bans bare `toLocale*String`. |
| **Access** | `middleware.ts`, `lib/access.ts`, `lib/chrome.ts` | The nav may read these. It may never be what enforces access. |

### 2.1 Relay leftovers

**Logic or config: for Mark, not this redesign.**

- **`awards.ts`** defines these on **every** race, solo included:
  - "Furthest Apart" (495) and "Closest Together" (501), each with a null winner on a solo race
  - "Fastest Male Leg" and "Fastest Female Leg" (519, 525)
  - two "Spot Prize" draws (543, 550)
  - the "Fastest …" subtitles

  These titles also flow into the prize export. Removing them on a solo race is a **prize-rule
  change**.
- **The sort key `teamNumber`** is in `results.ts`, `leaderboard.ts` and `live-board.tsx`.
- **The relay-only `splitA`/`splitB` columns** are configured in `leaderboard/page.tsx`.
- **`anomaly.ts`** says "no handover recorded for team …" (line 194).

**Presentation copy: in scope (§10).**

- `console/sections/status.tsx:97`: "keeps any handover time…"
- `console/sections/status.tsx:109`: "Search by bib, team number or name"
- `console/sections/crossings.tsx:132, 160`: "bib or team number"
- `results/page.tsx:89`: "On leg 2" / "On course", already chosen by format
- `leaderboard/page.tsx:135`

⚠️ **Several of these strings are probably asserted in `timing.spec.ts`.** Changing them makes
copy-only test edits, which brief §11.2 says must be listed one by one.

---

## 3. Website design source

**ClubBase is two files now, not one:**

| File | Lines | What | Loaded by |
|---|---|---|---|
| `packages/shared/styles/club-chrome.css` | 833 | The face (`@font-face` Bricolage 800), `:root` tokens, skip link, header, Menu, footer, banner, section bar, crumbs, **focus header**, `.club-btn*`, `.club-wrap`. Every rule is class-scoped. | `ClubBase.astro` (before `club.css`), `/account.css`, `/admin.css`, and **timing** (`app/layout.tsx:10`, `global-error.tsx:9`) |
| `packages/shared/styles/club.css` | 1751 | Reset, **bare-element rules** (`body`, `h1`–`h4`, `p` max-width, `a`, `main`, `main ul`, `:focus-visible`), and every content component: `.club-card`, `.club-phead`, `.club-lede`, `.club-facts`, `.club-meta`, `.club-table(-wrap)`, `.club-badge`, `.club-notice`, `.club-link-card`, `.club-g2/g3`, `.club-btns`, `.club-pills`, `.club-event-when`, `.club-error-summary`, the form classes, `.club-num`, `.club-small`, `.club-wrap-narrow` | `ClubBase.astro` only |

**How timing gets the 28 chrome classes:** a direct `import '@src/shared/styles/club-chrome.css'`
in the root layout. **This is the precedent for D10.** #329 split the chrome out of `club.css`
because `club.css`'s bare-element rules would have repainted `/account` and `/admin`.

**D10: can timing import the content components the same way?** Not as things stand.

- `club.css` can't be imported whole. Its `body`, `h1`–`h4`, `p { max-width }`, `a` and `main`
  rules collide with `base.css`'s, which timing still loads for `.button`, `.capture-*` and the
  rest. Load order would then decide every heading, link and the width of `main`.
- The clean route repeats #329: **split `club.css` into `club-content.css` (class-scoped
  components only) and the reset/bare rules.** That is an edit to a stylesheet the Astro site
  loads, so it is exactly what brief §2.1.2 forbids without approval.
- **Proof it would be a no-op on the club pages:** the same proof #329 gave. Load order is
  preserved (chrome, then content, then bare rules, in today's cascade order), plus pixel
  baselines of `/`, `/events/` and `/membership/` before and after. `club-contrast.test.ts`
  already reads `club.css`; it would need to read the new file too.
- **The alternative, copying the CSS into `apps/timing`,** gives two definitions of every card
  and badge, which drift. The duplicated header markup ADR-053 already accepts is the warning.

**Recommendation: split (the D10 default), as its own pull request before Slice A, with the
baseline screenshots in that pull request.**

**Tokens:**

- All twelve light values in brief §7.1 match `club-chrome.css` exactly, as do the dark ones.
- `--club-radius-button`, `--club-radius-card`, `--club-gutter`, `--club-measure` and
  `--club-wrap` exist under those names.
- `--club-brand`, `--club-on-brand` and `--club-highlight` are **not** redefined in dark mode,
  as the brief says.
- `--club-on-danger` would be new.

**`--src-*`:**

- Defined in `packages/shared/styles/tokens.css`, mirrored in `design-tokens.json`, and asserted
  by `brand.test.ts`.
- Timing reaches it through `base.css` (32 uses) and `nn-results.css` (11), which **`apps/main`'s
  `/nn/<year>/results/` also loads**. So retiring `--src-*` from timing must not touch
  `nn-results.css`; timing would stop importing it instead.

**Contrast tests:** none of them reads anything timing-specific. A new `timing.css` (or whatever
the timing-only components become) needs its own pairings test, on the pattern of
`admin-contrast.test.ts`. CLAUDE.md's `NnSchedule` trap is the reason: colours computed for one
surface, then used on another.

---

## 4. Mapping: route → template → components → PTB page

| NN route | Template | Website components | PTB reference |
|---|---|---|---|
| `/timing` | T1 / T3 | `.club-phead`, `.club-event-when` list, `.club-badge`, `.club-btn-primary` | 01 (home), m01 |
| `/timing/events` | T3 (merge into `/timing`?) | as above | — |
| `/timing/events/[slug]` | T1 | `.club-phead`, `.club-btns`, `.club-facts`, `.club-g3` of `.club-link-card`, `.club-meta`, `.timing-danger-link` | 01, m01, m14 |
| `…/console` (Start/Finish) | T2 | `.club-focus`, `.timing-go`, `.timing-clock`, `.timing-btn-dark` | 02, m05 |
| `…/console` (Race status) | T3 inside the console, or the start list (D3) | `.club-form`, `.club-table` | 13 (roster) |
| `…/console#anomalies` | T3 | `.club-card`, `.timing-state`, `.timing-bib` | 03, m09 |
| `…/console#crossings` | T3 | `.club-card` list, `.timing-bib`, `.club-input`, `.timing-danger-link` | 04, m04 |
| `/timing/marshal/[slug]` | T5 | `.club-focus`, `.timing-capture`, `.timing-key`, `.timing-conn`*, `.timing-state` | 07, 08, m02 |
| `…/leaderboard` | T4 | `.club-phead`, `.club-notice`, `.club-g3` cards, `.club-pills`, `.club-table-wrap` | 09, m03, m06 |
| `…/results` | T3 wide | `.club-meta`, `.club-table-wrap`, `.club-card`, `.club-notice`, disabled `.club-btn-primary` | 05, 06, m07, m08 |
| `…/registration` | T3 | `.club-card` per job, the form classes, `.club-table-wrap` | 11, 12, m11, m15 |
| `…/marshals` | T3 | `.club-card` per person, `.timing-danger-link`, `.club-form` | 13, m13 (not 10, staff) |
| `…/danger-zone` | T3 | `.club-error-summary` styling, `.club-meta` ×2, `.timing-btn-danger` | 14, m12 |
| not found | T3 (in the shell, or ClubFrame) | `.club-phead`, `.club-btns` | 16 |

\* `.timing-conn`: the marshal screen already tracks online/offline for its drain. Showing it is
presentation. A **count** of pending syncs in the focus bar may need a new derived value. Treat
that as D4 unless it reads straight off existing state.

---

## 5. Roles and navigation

### 5.1 What the database says

`packages/db/tests/identity-permissions.test.ts` asserts **9 roles and 18 permissions**.
CLAUDE.md still says six roles and eleven permissions, which is stale; its own advice is to read
the test.

| Role | Timing permissions | Reaches in timing | Your account | Club admin |
|---|---|---|---|---|
| `registered` | — | nothing (404 everywhere) | yes | no |
| `timing-marshal` | `timing.crossing.record` | `/timing` (lists their rostered races) and `/timing/marshal/<rostered slug>` | yes, plus a "Race timing" tab | no |
| `timing-admin` | all six `timing.*` | everything | yes, plus "Race timing" | **no**: not in `STAFF_ROLES` |
| `nn-results` | — (`nn.results.read`) | nothing in `/timing` | yes | no |
| `nn-admin`, `people-admin`, `super-admin` | — | nothing | yes, plus "Club admin" | yes |
| `nn-tester` | — | nothing | yes | no |
| `src-admin` | all 18 | everything | yes, plus both tabs | yes |

**The brief's "Admin" row is two different people.**

- A `timing-admin` sees **Your account · Race timing** and no Club admin.
- Only `src-admin` (or somebody holding `timing-admin` plus a staff role) sees all three areas.

The three-area header has to come from the same predicates `/account/` already uses:
`holdsAnyTimingPermission()` for Race timing and `isStaff()` for Club admin (`worker/account.ts`
`staffAreas()` since ADR-057). Otherwise the account home and the timing header would disagree about who
sees what.

### 5.2 Proposed area bar (D1 default: race-day order)

| Label | Address | Shown when `canOpen()` admits |
|---|---|---|
| Overview | `/events/[slug]` | `timing.event.manage` |
| Race control | `/events/[slug]/console` | manage **or** resolve |
| Record crossings | `/marshal/[slug]` | `crossing.record` + roster |
| Timing log | `console#crossings` (or `/crossings` if D3 splits) | resolve |
| Anomalies | `console#anomalies` (or its own route) | resolve |
| Live leaderboard | `/events/[slug]/leaderboard` | manage **or** resolve |
| Results | `/events/[slug]/results` | `result.publish` |
| Entry list | `/events/[slug]/registration` | `registration.import` |
| Marshals | `/events/[slug]/marshals` | `marshal.assign` |

**Notes on the proposal:**

- **"Record crossings" in the bar for an admin** links to a roster-scoped address. `canOpen()`
  does **not** check the roster; only the door does, through `marshal_event()`. So an admin who
  isn't rostered would be shown a tab that 404s, which breaks ADR-053's "never a link to a 404".
  **Choose one:**
  - leave it out of the bar for anyone not rostered, which costs one roster read per race page
  - show it only on `/timing`, where `my_marshal_events()` already lists rostered races
- **A marshal's view:** the brief's matrix gives a marshal "Record crossings · Live leaderboard
  (if allowed)". The leaderboard is **not** allowed for `timing.crossing.record` alone. So a
  marshal's area is `/timing` (their races) plus the capture screen, and they have **no area
  bar**. That is what `/timing` already does since #328.
- **If D3 keeps one console,** Timing log and Anomalies are fragments of Race control. The
  "Record crossings" vs "Marshals" naming fix in brief §7.4 stands either way.

### 5.3 Sign-out

- Sign-out is `POST /account/sign-out/` with a CSRF field (`worker/account.ts`
  `handleSignOut()`). It always redirects to `/account/sign-in/`.
- **The timing app has no sign-out control and no CSRF token for that form.** A "Sign out" in
  the timing header needs one of these:
  - a link to `/account/`, where the button is
  - a token the timing Worker can mint that `apps/main` will accept

  The second touches the main Worker's CSRF scheme, which is out of scope. **Recommend the link**
  ("Your account" → its Sign out) for this pass.

---

## 6. Open questions answered

| Question | Answer |
|---|---|
| What a marshal-only account sees | `/timing`, listing their rostered races (#328), and `/timing/marshal/<slug>` for those races. Everything else is 404. Signed out, or with a lapsed session, the marshal link is a 404 (brief §4.1 #3, confirmed: the door refuses before anything can redirect to sign-in). |
| Where published results appear | `/nn/<year>/results/` in **`apps/main`** (`worker/nn-results.ts`, styles `src/pages/nn/results.css.ts`, which loads `nn-results.css`). **Outside `/timing/**`.** Per brief §2.1.8: stop and ask before touching it. This pass shouldn't need to. |
| Does timing deploy separately? | **Yes.** Cloudflare Workers Builds, Worker `src-timing-production`, watching `platform/apps/timing/**`, `platform/packages/**` and `platform/package-lock.json`. No GitHub workflow deploys either app. ⚠️ **A change under `packages/` also rebuilds and redeploys `apps/main`**, the site taking entry money. So a `club.css` split (D10) is a deploy of the entry Worker. The CSS isn't the risk; the timing of that deploy is. D9 applies to that pull request even though timing itself deploys separately. |
| Does the server reject an early wipe or publish? | **Yes, both.** `reset_event()` refuses `not_confirmed` unless the trimmed confirmation equals the slug, and refuses `published` first (`20260914110000`). `publish_results()` refuses `not_finished` and `open_anomalies` (with the count) (`20260914100000`). **Both pages render the button enabled anyway.** The danger zone doesn't even check `results_published_at`, so a published race shows an enabled wipe that can only fail. Disabling is presentation. The danger zone's "disabled until it matches" needs a few lines of client script; with scripting off it should stay enabled and let the server refuse, because every spec here runs a `no-javascript` project. |
| The timing app's check and test commands | `./dev check` covers it: lint, typecheck (`tsc` for both the app and its Worker), and `npm test`, which includes `apps/timing/tests/unit/**` (15 files) and `packages/shared/tests/unit/timing-*` (17). `./dev test` covers it: `apps/main/tests/e2e/timing.spec.ts` (147 `test(` calls, three projects including `no-javascript`). `timing-race-night.screens.ts` is **not** in `./dev test`; it runs with `./dev e2e --config=playwright.config.screenshots.ts`. There is no Miniflare layer for timing. |
| Test users per role | None in `seed.sql`. The Playwright fixtures create them at run time: `apps/main/tests/timing-staff-db.ts` `seedTimingStaff()` (timing-admin, timing-marshal, one pair per worker), `timing-db.ts` (per-scenario races) and `timing-fixtures.ts`. For Phase 2/3 screenshots, **reuse those fixtures** rather than adding seed users. They already cover no role, marshal and admin, and they never touch production. |

---

## 7. Tests that will feel a presentation change

- **`apps/timing/tests/unit/chrome.test.ts`**: every page's frame. It changes by design in
  Slice B.
- **`apps/main/tests/e2e/timing.spec.ts`**: 147 `test(` calls. They find things by role and text, so
  renamed labels ("Race console" → "Race control", "Marshal" → "Record crossings") and the copy
  fixes in §2.1 will move selectors.
- **`club-chrome.spec.ts`**: compares timing's header with the Astro one in a browser (ADR-053).
  If D2 removes the club header from timing, this spec's timing half goes, and that removal has to
  be argued in the PR.
- **`site.spec.ts`'s nine-width sweep and `sideways-scroll.ts`**: the helpers to use for
  "no sideways scroll at 390".
- **`apps/main/tests/axe.ts`**: the one axe rule list. New timing axe calls import it
  (CLAUDE.md, "Zero accessibility violations").

---

## 8. What HALT 1 needs from Bindal

1. **C2:** was #330 / ADR-053 meant to be live before the race? (It is.)
2. **C1:** confirm D2 is a deliberate reversal of ADR-053 §1, a week after it was accepted, so
   the new ADR can say so.
3. **C3:** confirm no work goes near `ovpvzabtjxbszsqschqy`, and that any migration (none
   expected) ships as a migration file through `db push`, as everything else does.
4. **D10:** approve splitting `club.css` into a content file, as its own PR that redeploys
   `apps/main` during the entries window, or choose copy-in.
5. **Sign-out:** a link to `/account/` (recommended), or a real button (out of scope).
6. **Record crossings in the area bar:** roster-checked tab, or `/timing` only.
7. **§0's blanks:** the last merge date and the mock-race date (D8). Nothing else in §0 blocks
   Phase 2.
8. **The latent console defect (§1.4 #1):** for Mark. It matters if D3 splits Anomalies out.
