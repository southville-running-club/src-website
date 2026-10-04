# Claude Code brief: NN timing redesign. PTB's structure, the SRC website's design

**Owner:** Bindal · **Prepared:** 3 Oct 2026 · **Race day:** Sunday 1 November 2026 (Nightingale Nightmare)

**In one line:** Organise the NN timing pages the way Pass the Buck (PTB) did, and make moving between them work the same way. Make them look like the new SRC website. Leave NN's logic exactly as Mark built it.

**The formula:**
- **PTB's structure:** what goes on each page, and how you move between pages.
- **The SRC website's design:** how everything looks.
- **NN's logic:** what it all does. This doesn't change.

**How to use:** save this file as `docs/timing/nn-timing-redesign-brief.md`. It replaces the earlier PTB-reskin brief. Fill in §0, then tell Claude Code: *"Read docs/timing/nn-timing-redesign-brief.md. Run step 0 and Phase 1 only, then stop at HALT 1."*

## Errata and decisions at HALT 1 (3 Oct 2026)

Phase 1 checked this brief against `origin/main` at `a88416e`; the findings are in
[`redesign-inventory.md`](redesign-inventory.md#corrections-to-the-brief). Bindal answered them
the same day. The text below is patched where marked **[erratum]**; everything else is as
supplied.

**Errata**

1. **Step 0.2 is removed.** The `timing` schema is in this repository's Supabase project,
   `ketipxpyjjglwpqazsft`. `ovpvzabtjxbszsqschqy` / `src-race-timing` is the old platform and
   is never touched. This work connects to no Supabase project at all.
2. **Red lines: migrations.** No migrations are in scope. This repository ships migrations
   through `db push` from `deploy-db.yml`; `apply_migration` from an MCP is not how schema
   reaches production here.
3. **Step 0.3.** `BRANDING.md` and `design-tokens.json` are not in this repository (they are
   PTB's). The design source is `platform/packages/shared/styles/club-chrome.css` and
   `club.css`.
4. **§4.1.** The current decisions are
   [ADR-053](../architecture/decisions/adr-053-the-timing-app-wears-the-club-header.md) (#330,
   the club header, bars and focus header on timing) and
   [ADR-045](../architecture/decisions/adr-045-race-night-is-one-console.md) (one race
   console).
5. **§6.2 fix 8.** No source writes "GMT+0"; it comes from the runtime's formatting of
   `timeZoneName: 'short'`. Render the zone name explicitly: GMT or BST.
6. **§7.4 role matrix.** `timing-admin` gets Your account and Race timing. `src-admin` gets all
   three areas. Marshals (`timing-marshal`) get **no area bar**.
7. **D9.** Timing deploys separately through Cloudflare Workers Builds. D9 applies only to a
   change under `platform/packages/`, which also redeploys `apps/main`.
8. **§4.1 non-presentation list, item 7 (for Mark).** The danger zone does not check whether
   results are already published, so a published race shows an enabled wipe that can only be
   refused (`published`).
9. **Testing.** The three roles (no role, `timing-marshal`, `timing-admin`) come from the
   existing Playwright fixtures — `apps/main/tests/timing-staff-db.ts`, `timing-db.ts` and
   `timing-fixtures.ts` — not from seed users.

**Decisions**

| | Decision |
|---|---|
| #330 live early | Not recorded (the answer was left as a placeholder). Either way, **this work does not revert it** |
| D2 | Deliberate. A new ADR supersedes ADR-053 §1 with the signed-in app shell; it carries over `canOpen()` as the nav's one source, the frame table and its test, and the danger zone kept out of the bar |
| D3 | **Deferred until after the race.** One race console, restyled; ADR-045 stands; no route change. The `crossing.resolve` "Not found" defect is recorded in `CLAUDE.md` for the split |
| D8 | Last merge **Friday 23 October 2026**. Mock race **Tuesday 27 October 2026**, after the clocks change, so it runs on GMT like race day. Nothing merges after the mock race unless it fixes something the mock race found |
| D10 | **Nothing under `packages/` before the race.** Copy only the ClubBase content rules timing needs into the timing app, scoped so they cannot clash with `base.css`'s `body`, `h1`–`h4`, `p` and `a`. A test fails if a copied rule drifts from `club.css`. The content-only split is post-race work in `docs/delivery/phases.md` |
| Sign-out | A link to `/account/`. A real button comes with the account/admin shell after the race |
| Record crossings | **Not a bar tab.** Shown on the timing home's Marshalling card and on the race launchpad, only for races the person is rostered on |

**Decisions at HALT 2 (4 Oct 2026).** Direction approved; ADR-054 accepted.

| | Decision |
|---|---|
| D1 | Race-day order. Area bar for `timing-admin` and `src-admin`: **Overview · Race console · Live leaderboard · Results · Entry list · Marshals**. Record crossings stays off the bar |
| D4 | **A confirm step before "Start the race"**, client-side only, no server change. The start time is recorded when **Confirm** is pressed. Without JavaScript the form submits as it does today. Slice D, as its own commit, and exercised in the 27 October mock race. The other D4 behaviours wait until after the race |
| D5 | **Force light mode on Record crossings and the race console.** Every other page follows the phone's setting |
| D6 | The leaderboard stays staff-only for 2026 |
| Sign-out | **No sign-out link and no `#sign-out` anchor.** The header shows "Signed in as {name}" as plain text; "Your account" in the header already leads to the real Sign out. A real button comes with the account shell after the race |
| #330 | No action in this work. Whether its early merge was intended came back both ways at HALT 2; it does not affect anything here |
| Also agreed | The start caption sits above the button; "NN 2026" in the console bar; no marshal name in the capture bar; the server check backs up Wipe without JavaScript |
| Cut line | By **Friday 23 October**: Slice A (only what B and D need), B, the race launchpad, D, and the disabled states for Publish and Wipe. Everything else waits until after the race |
| Slice E, brought forward (4 Oct) | Everything on the cut line was live on 4 October, nineteen days early, so **Slice E comes forward**: the leaderboard, results, entry list, marshals roster and danger zone are restyled before the 23 October last merge, so the 27 October mock race runs on the finished screens. **Slice F stays after the race** |

Because of D3, every mention below of separate Timing log or Anomalies pages, or of a "Race
control" route, now means **sections of the one console**. The console's label is "Race
console" (§7.4 says so for this case).

---

## 0. Fill in before sending

| Item | Value |
|---|---|
| NN timing app | Next.js (App Router) on Cloudflare via OpenNext, served at `/timing` on `new.southvillerunningclub.co.uk` (§4.1). Repo path: `__________` |
| Website design source | The ClubBase stylesheet behind `/_astro/ClubBase.*.css` on the Astro site. Source path: `__________` (if this is blank, Claude Code finds it in Phase 1) |
| Local or preview URL for timing | `__________` (production is https://new.southvillerunningclub.co.uk/timing, so never test against it) |
| PTB reference code | `github.com/bindalshah/src-race-timing`, branch `main` @ `b39f1c2`. Local checkout: `__________` (add it with `/add-dir`) |
| Screenshots | Unzip `timing-reference-screens.zip` into `docs/timing/`. You get three folders, all safe to commit: `ptb-reference/` (PTB, with names masked), `nn-current/` (NN today) and `src-website/` (the look to match). |
| Last merge date before race day | `__________` (leave time after it for a full mock race) |

---

## 1. Why
- **PTB was easy to use.** The PTB timing app (8 Jul 2026) was easy to find your way around and easy to use under race-day pressure. It had:
  - one flat nav
  - a launchpad home
  - the same skeleton on every admin page
  - single-purpose race-day screens
- **NN is hard to use.** NN's timing pages have the logic NN needs, but they're hard to use on race day:
  - text-and-link pages inside heavy site chrome
  - three layers of navigation
  - the race console's actions folded away
  - a normal-sized capture button
  - destructive buttons that look like every other button
- **The new SRC website already has the look.** It uses a calm, consistent design system called ClubBase: a mint background, white cards, brand-green bands, Bricolage Grotesque headings and pill buttons. The timing pages should look like part of that website.
- **Signed-in pages should feel like an app.** Once someone is signed in, they don't need the public website's navigation. They need what their role gives them, and nothing more. This is Bindal's decision (§7.4).

## 2. Scope and red lines

**In scope (presentation only):**
- layouts and navigation, including the signed-in app shell for timing pages (§7.4)
- page templates and components
- tokens and styling
- microcopy
- empty, loading and error states
- responsive behaviour and print styles
- PWA and meta tags
- accessibility fixes

**Out of scope. Stop and ask before touching any of these:**
- **Data:** the data model, migrations, Supabase queries/RPCs/RLS and Realtime channels. **[erratum]** No migrations are in scope; this repository ships migrations through `db push` from `deploy-db.yml`.
- **Access:** auth and role checks. The nav may *hide* links by role, but it must never be what *enforces* access.
- **Race rules:** timing maths, bib parsing and validation, categories, results ordering, prize rules and export columns.
- **Capture behaviour:** offline and sync.
- **URLs:** route paths. Keep NN's; PTB's paths in this brief are only for reference. The only exception is the console split in D3.
- **Anything outside the timing section:**
  - `/nn/**`, `/events/**`, `/account/**` and the entries admin
  - Stripe, Resend and webhooks
  - the ClubBase source and any shared chrome or stylesheet that the Astro site also renders

The website-redesign work ring-fenced `/timing/**` (and `/admin/**`) until after 1 Nov. This brief deliberately makes an exception for the **timing pages only**, and only for presentation.

If adopting a PTB pattern would need new logic, **don't build it in this pass**. Examples: Undo after discard, a connection pill with sync counts, the prize-giving reveal. List each one as a proposed follow-up slice, with its effort and race-day risk (D4).

### 2.1 Working inside the main site
1. **A signed-in app shell, not the public site chrome.** Timing pages drop the public site's navigation, banner, breadcrumbs and footer. In their place they get a role-based app header and one area bar (§7.4). Tool screens keep the focus bar. This is Bindal's decision (D2).
2. **Use the website's components rather than copying them.** The timing app already imports the shared club chrome: 28 `.club-*` classes covering the header, footer, banner, nav, menu, section bar, breadcrumbs, focus bar, buttons and wrap. Find where those come from, and bring in the ClubBase content components the same way (§7.5, D10). Don't edit the shared source, because anything the Astro site also renders must not change. New timing-only components live in the timing app and use the `--club-*` tokens.
3. **The entry pages are frozen.** `/nn/**` takes payments until entries close on 30 Oct at 17:00 GMT. Nothing in this work may change what an entry page renders. The same goes for `/account/**` and the entries and payments admin.
4. **Use one palette.** Everything visible uses the website's `--club-*` tokens (§7.1). Retire the timing app's old content styles page by page as you replace them: `.button` (dark green rectangles), `.summary-list`, `.notice` and `.field`. Keep `--src-*` only where something still needs it, and don't introduce a third palette.
5. **Sign-in belongs to the main site.** Timing uses the main site's session and sign-in (`/account/sign-in/`, a frozen URL). Don't build a timing login page, and don't restyle `/account/**`. Signed-out visitors currently get a 404 on every timing route, which is deliberate, so keep it. The race-day risk this creates for marshals is listed in §4.1.
6. **Roles come from the main site.** People get the timing-marshal role in the main site; each race's roster is at `/timing/events/{race}/marshals`. Don't rebuild PTB's Staff page.
7. **Entrants come from NN entries.** They arrive through "Import from entries" on the Entry list, plus the Full On Sport CSV upload and walk-ins. Keep all three as they are.
8. **Public results.** The leaderboard is staff-only, and results only go public once someone publishes them. Find where published results appear. If that page sits outside `/timing/**`, stop and ask before touching it.
9. **Service worker and manifest.** Both are already scoped to `/timing/`. Keep it that way.
10. **Deploys are Bindal's call.** Timing is served by OpenNext, separately from the Astro pages. In Phase 1, confirm whether it also deploys separately (D9). Claude Code never deploys.
11. **Prove nothing else changed.** Before the first slice, take baseline Playwright screenshots of `/nn/2026/`, `/account/sign-in/`, one `/admin/` page and the main home page. After every slice, retake them and confirm they're unchanged.

### 2.2 The same shell for Your account and Club admin (after 1 Nov)
- **Why it matters beyond timing:** Bindal's decision covers the whole signed-in area. Today `/account/` (`/account.css`) and `/admin/` (`/admin.css`) both show the public nav plus their own bar, and both bars repeat "Race timing" (the account bar also lists "Club admin").
- **Not in this brief:** those pages are ring-fenced until after 1 Nov, and the account pages show entries during the paid entries window. So this brief builds the shell for `/timing/**` only.
- **Build it to travel:** keep the shell's markup and classes self-contained (`.app-header`, `.app-areas`, `.app-user`, `.app-footer`), built only on `--club-*` tokens, so it can move into the shared chrome when `/account/**` and `/admin/**` adopt it.
- **Record the decision:** write an ADR now, "Signed-in area uses a role-based app shell, not the public site navigation". Add the account/admin rollout to `docs/delivery/phases.md` for after the race, including removing the duplicate "Race timing" and "Club admin" links from those bars (D11).

## 3. Working method

**Step 0: pre-flight, in this order**
1. `git status` is clean. Branch off `main`: use `timing-redesign-inventory` for Phases 1–2, then one branch per build slice.
2. **[erratum]** ~~Supabase MCP step~~ removed. Connect to no Supabase project. The `timing` schema is in `ketipxpyjjglwpqazsft`; never touch `ovpvzabtjxbszsqschqy` / `src-race-timing`.
3. Read `CLAUDE.md`, the ClubBase source — **[erratum]** `platform/packages/shared/styles/club-chrome.css` and `club.css` (`BRANDING.md` and `design-tokens.json` are not in this repo) — and any ADRs that mention timing or the club website design.
4. Before touching any file, run `git log --oneline -- <file>` on it.
5. Never touch `.dev.vars` or `.claude/settings.json`.
6. Check every fact in this brief against committed code. If something here is wrong, stop and report it rather than carrying it forward.

**Throughout**
- Halt and propose at every gate in §5. Don't push anything before Bindal has reviewed the diff.
- One concern per commit. Never mix styling and logic in a commit.
- Where things go:
  - Decisions go in `docs/architecture/decisions/`. Start with an ADR: "Timing UI uses the club website design with the PTB page structure".
  - Traps go in `CLAUDE.md`.
  - Roadmap goes in `docs/delivery/phases.md`.
- **Prettier space-collapse trap:** write `{' '}` for meaningful spaces between inline expressions.
- **Structure from PTB, look from ClubBase.** NN timing is Next.js, like PTB, so PTB's React page structure can be lifted where that helps. But build the look from ClubBase classes and `--club-*` tokens, not from PTB's Tailwind classes or its colours.
- **Sessions:** run Phases 1–2 in one session. Run each build slice in a fresh session that reads this brief, the inventory and the approved mockups.
- **Test counts:** report them exactly as run. Bindal re-runs `./dev check` and `./dev test` himself.

**Every HALT report has the same shape:**
- Summary
- Files changed, split into timing-presentation files and anything else (with reasons)
- Before → after screenshots at 390×844 and 1280×800, next to the matching `src-website/` page (for the look) and `ptb-reference/` page (for the structure)
- Tests run and their results
- Open questions

## 4. Reference material
- **Live SRC website, the look to match:**
  - `/`: hero, facts band, numbered steps, cards, chips, footer
  - `/events/`: page head and the date-tile event list
  - `/membership/`: price cards, the featured card with a badge, the comparison table
  - `/account/`: the section bar
- **Live NN timing:** https://new.southvillerunningclub.co.uk/timing. This is production, so look but don't change anything.
- **Live PTB, the structure to copy:** https://src-race-timing.vercel.app. `/` and `/live/pass-the-buck-2026` are public. Ask Bindal for any other state you need to see.
- **PTB code** (see §0): the reference for page structure and behaviour. **Its visual styling isn't the target.**
- **Screenshot pack:** see Appendix B.
  - `src-website/`: w01–w06 on desktop, wm01–wm04 on phone
  - `nn-current/`: n01–n10 on desktop, nm01–nm06 on phone
  - `ptb-reference/`: 01–16 on desktop, m01–m15 on phone, with names masked

### 4.1 NN timing today (reviewed 3 Oct 2026, signed in as an admin)
Use this as the starting point for Phase 1. Verify it, then complete it.

**[erratum]** What this section describes is the result of [ADR-053](../architecture/decisions/adr-053-the-timing-app-wears-the-club-header.md) (#330) — the club header, the two section bars and the focus header — and [ADR-045](../architecture/decisions/adr-045-race-night-is-one-console.md) (one race console). Those are the current decisions; D2 supersedes ADR-053 §1, and ADR-045 stands (D3).

**How it's built (observed from the live site)**
- **App:** a Next.js app (App Router, Turbopack) running on Cloudflare through OpenNext. It's served under `/timing` with assets at `/timing/_next/…`. The rest of the site is Astro (`/`, `/nn/2026/`), and `/account/` uses `/account.css`.
- **Styling:** plain CSS, not Tailwind. The timing stylesheet contains:
  - the shared club chrome (28 `.club-*` classes)
  - the timing app's own content classes, which are what makes the pages look "unlike the website": `.button`, `.button-wide`, `.summary-list`, `.notice`, `.field`, `.race-clock`, the `.capture-*` family (`.capture-tap`, `.capture-queue`, `.capture-card-queued/-syncing/-open/-failed`, `.capture-keypad`), `.triage-*`, `.console-section` and `.log-search`

  It doesn't include the ClubBase content components: `.club-card`, `.club-phead`, `.club-facts`, `.club-meta`, `.club-table`, `.club-badge`, `.club-notice` and so on.
- **Fonts:** Bricolage Grotesque is already loaded (`/fonts/bricolage-grotesque-800-latin.woff2`). Both token sets are defined, `--club-*` (website) and `--src-*` (PTB's palette).
- **Session:** shared with the main site. Signed-out visitors get a 404 ("Not found — There is nothing at this address.") on every `/timing` route, including the marshal link.
- **Service worker and manifest:** already scoped to `/timing/`. There's no `theme-color` meta tag.
- **Page titles:** every timing page has the same `<title>`, "Race timing — Southville Running Club".

**Navigation today**
- **Heavy chrome on admin pages.** They sit inside the full club-site chrome. Top to bottom:
  - the "new website" banner
  - the site header
  - a section bar ("Race timing: Overview · Races")
  - a second section bar ("Nightingale Nightmare 2026: Overview · Live leaderboard · Results · Entry list · Marshals · Race console")
  - breadcrumbs
  - the page
  - the green site footer

  On a 390 px phone that's about 320 px of chrome before the page title. The race bar scrolls sideways, and only "Overview" is visible.
- **Focus screens.** Race console and marshal capture have a focus bar ("Southville RC · Race console" / "Recording crossings") with a "Leave…" link.
- **Console sections.** The console folds five sections away: Start, Finish, Race status, Anomalies and Timing log. `/crossings` redirects into it.
- **Danger zone.** It's only linked from the race overview, not the nav. Keep it that way.

**How pages look today**
- One centred column, about 600 px wide. Content is mostly label/value lists and text links.
- Buttons are dark-green (`#00672f`) rectangles with white text and a 4 px radius. They aren't the website's pill buttons.
- Destructive buttons ("Remove", "Wipe this race") look exactly like primary ones.
- The copy is careful and plain. Keep it. For example: "A clock reaching zero starts nothing…", "Finishing is a label, not a cut-off…", "an anomaly is a question…".

**NN route → template mapping** (templates are defined in §7.3)
| NN route | What it is today | PTB equivalent | Template | Main changes |
|---|---|---|---|---|
| `/timing` | Text overview of races and marshalling | Home | T1 | Race chooser as a date-tile list like `/events/` |
| `/timing/events` | Races list | (PTB was a single event) | T3 | Same date-tile list. It can merge with `/timing` |
| `/timing/events/nn-2026` | Facts, counts and link lists | Home launchpad | T1 | Page head → facts band → job cards → danger link |
| `…/console` (Start, Finish) | Countdown, "Start the race", "Finish this race" | Start | T2 | Full brand-green race-control screen, one state at a time |
| `…/console#anomalies` | Captures needing a human | Anomalies | T3 | Its own page (D3) |
| `…/crossings` → console | Search and list of crossings | Timing log | T3 | Its own page (D3) |
| console → Race status | Mark DNS/DNF/DQ by searching | Roster edit | T3 | Stays in race control, or moves to the start list (D3) |
| `/timing/marshal/nn-2026` | Tap-first capture, keypad, offline | Marshal | T5 | Giant capture tile, counts in the focus bar, queue cards |
| `…/leaderboard` | Staff-only leaderboard | Live | T4 | Page head, podium cards, then table or cards |
| `…/results` | Preview, downloads, Publish, prizes | Results + Prizes | T3 wide | Status row, Publish card, prize cards, table |
| `…/registration` | Import, CSV upload, walk-in, start list | Registrations + Roster | T3 | One card per job; start list as a table |
| `…/marshals` | Per-race roster | Staff | T3 | Person cards, with "Remove" as a danger-text action |
| `…/danger-zone` | Wipe race (type the slug) | Danger | T3 | Danger card, with a red pill disabled until the slug matches |
| Unknown `/timing/**` | "Not found…" inside the site chrome | Not found | T3 | Website-style 404 inside the timing shell |

**Problems spotted that aren't presentation.** Don't fix these here; they're listed for Bindal and Mark.
1. **Relay prizes in a solo race.** The prize list still carries PTB relay prizes:
   - "Furthest Apart" and "Closest Together" (both about pairs and leg times)
   - "Fastest Male/Female Leg"
   - "Fastest team" wording on the overall prizes
   - two "Spot Prize — Random draw from finished teams"
2. **Relay wording elsewhere:** "Search by bib, team number or name", the leaderboard sort `?sort=teamNumber`, and race-status copy that mentions "handover time".
3. **Dead-looking marshal link.** A signed-out marshal who follows the marshal link sees "Not found". On race day, an expired session will look like a broken link.
4. **No confirm on the start.** "Start the race" records the start on a single tap. PTB asked for confirmation first (D4).
5. **Buttons that should be blocked aren't.** "Wipe this race" can be clicked before the slug is typed, and "Publish these results" can be clicked while the race isn't finished. Whether the server rejects these wasn't tested; confirm it in Phase 1. The visual and disabled state is in scope here (§8.7, §8.11).
6. **No public live results.** There's no public live view during the race, which PTB had. Whether NN should have one is a privacy and policy call (D6).
7. **[erratum]** **The danger zone doesn't check whether results are already published.** A published race shows an enabled "Wipe this race" that the server can only refuse (`published`).

## 5. Phases and halts

### Phase 1: inventory and mapping → HALT 1
Start from §4.1. Verify it and complete it in `docs/timing/redesign-inventory.md`, covering:
1. **Every NN timing route:** path, file, roles, purpose, data read and written, client components, and current layout.
2. **NN logic that must survive:**
   - bib format and validation
   - start and finish
   - capture flow and keypad
   - categories and prizes
   - statuses
   - offline and sync
   - exports
   - time zone
3. **Website design source:**
   - where ClubBase lives
   - how the timing app gets the 28 chrome classes today
   - whether the content components can be imported the same way without changing anything the Astro site renders (D10)
4. **Mapping:** for each NN route, the template (§7.3), the website components it will use (§7.5) and the PTB page it follows (§8).
5. **Roles and nav:**
   - List the roles admins can assign (Club admin → People and roles), and what each role can reach in timing. For later, also note what it can reach in Your account and Club admin.
   - Find the permission checks the routes use, so the nav can be built from the same source.
   - Propose the nav for each role (§7.4) using NN's real routes and labels.
6. **Open questions:**
   - what a marshal-only account can see
   - where published results appear publicly
   - whether timing deploys separately
   - whether the server rejects an early wipe or publish
   - the timing app's own check and test commands (it's a Next.js app, so `./dev check` and `./dev test` may not cover it)
   - test users for each role (no role, timing marshal, admin) in local or preview. If there aren't any, propose seed users. Never use production accounts.

### Phase 2: mockups → HALT 2
Static mockups only, built with the real ClubBase classes. Use fake data, no real names and no app logic. Cover:
- the signed-in app shell for three roles (no role, timing marshal, admin) at 390 and 1280 wide
- the race launchpad
- Record crossings: empty, three captures waiting with one warning, and offline
- Race control: before, running and finished
- the live leaderboard (phone and desktop)
- the timing log
- the danger zone
- dark mode for Record crossings and Race control

Deliver Playwright screenshots next to the matching `src-website/` and `ptb-reference/` images. At this halt Bindal signs off the direction and answers §12.

### Phase 3: build slices (each one ends with a HALT for diff review)
| Slice | Contents |
|---|---|
| A: Foundations | Baseline screenshots of non-timing pages (§2.1). Then: bring the ClubBase content components into the timing app (D10); add the timing components (§7.5) on `--club-*` tokens; set up the focus ring, tabular numbers and reduced motion |
| B: Signed-in shell & nav | Role-based app header (areas and user menu), area bar and slim footer. No public nav, banner, breadcrumbs or public footer on timing pages (§7.4). Focus bar for tool screens, per-page titles and the timing 404 |
| C: Launchpads & leaderboard | Race chooser, race launchpad, live leaderboard |
| D: Race-day tools | Record crossings, race control (start/finish), and the console split if D3 is approved |
| E: Admin | Timing log, anomalies, results (with publishing and prizes), entry list and start list, marshals roster, danger zone |
| F: Polish | Print styles, PWA/meta, dark-mode check, accessibility pass, Playwright and axe coverage |

**Race-day cut line.** There are four weeks to race day, so don't try to land everything.
- **Must be merged by the last merge date (§0):**
  - Slice A, but only the parts B and D need
  - Slice B (the signed-in shell)
  - the race launchpad from Slice C
  - Slice D (Record crossings, Race control)
  - the disabled-state fixes for Publish and Wipe
- **Waits until after 1 Nov if time runs short:** the leaderboard, results, entry list, marshals and danger-zone restyles (Slice E), and Slice F.
- Anything not merged by the cut-off waits until after the race. NN's current pages keep working in the meantime.
- Don't restyle the Entry list in the days around the entries import (entries close on 30 Oct at 17:00 GMT).

## 6. What to take from PTB, and what to fix

### 6.1 Keep PTB's structure and behaviour
These are what made PTB easy. They don't depend on PTB's colours.
1. **One flat nav, always there.** Every tool is one tap away, with no dropdowns and no nesting. Here that's the role-based app header plus one area bar (§7.4).
2. **The app knows who you are.** The nav shows each role only what it needs.
3. **The race home is a launchpad, not a document.** It has a state line, a status strip, and big targets for each job in race-day order. Setup jobs come after, and the destructive link comes last.
4. **Every admin page has the same skeleton:** where you are (the app header and area bar), what the page is (the H1), what you can do here (the lede), a status row (count, freshness, action), then the content.
5. **The surface tells you the mode.** In website terms:
   - mint background and white cards for admin work
   - a full brand-green screen for the "go" moment (race control)
   - the dark focus bar for tool screens
6. **Race-day tools are single-purpose screens.** Record crossings is one giant button plus a queue. Race control is one state and one action.
7. **Copy explains consequences and next steps.** Irreversible actions say so before you click. Empty states say what happens next. Live data says how fresh it is.
8. **Safety is built in.**
   - Destructive actions look destructive and are isolated.
   - Type-to-confirm stays disabled until it matches.
   - Starting the race needs a confirm (D4).
   - Soft warnings offer "Confirm anyway".
9. **Numbers are easy to scan.** Every bib and time uses tabular figures (`.club-num`), and totals are right-aligned.
10. **It's built for phones first.** Pages are a single column with 48 px targets. Tables turn into cards on phones, and wide tables scroll inside their own container.

### 6.2 Fix these too
| # | Issue | Do this |
|---|---|---|
| 1 | Three nav layers, and on phones the race bar shows only "Overview" | An app header plus one area bar (§7.4). Scroll the active item into view, shorten the race name on phones (e.g. "NN 2026"), and add an edge fade |
| 2 | Heavy chrome: about 320 px on a phone before the title | The signed-in app shell (§7.4): no public nav, banner, breadcrumbs or footer. Tool screens use only the focus bar |
| 3 | Same `<title>` on every page | "{Page} — {Race} — Southville Running Club" |
| 4 | One destination with several names ("Live leaderboard" vs "Leaderboard"; "Race console — start this race") | One label per destination across the nav, launchpad cards, H1 and `<title>` |
| 5 | Destructive actions look primary ("Remove", "Wipe this race") | Danger-text actions and a danger pill (§7.5) |
| 6 | Blocked actions look clickable ("Publish", "Wipe") | Disabled, with the inline reason next to them |
| 7 | Small capture button | Giant capture tile (§8.4) |
| 8 | Times shown as "11:00 GMT+0" | "11:00 GMT" / "11:00 BST". **[erratum]** No source writes "GMT+0"; it is the runtime's rendering of `timeZoneName: 'short'`. Render the zone name explicitly (GMT/BST) rather than asking the runtime for it |
| 9 | Exactly one `<h1>` per page | PTB's race-control screen had none, so make the state line the H1 |
| 10 | Below 640 px the focus bar doesn't name the marshal | Keep the marshal's name visible on phones, since devices get handed around (optional) |

## 7. The design: SRC website components, arranged the PTB way

### 7.1 Tokens (the website's own, from ClubBase)
**Light (default)**
| Token | Value | Used for |
|---|---|---|
| `--club-background` | `#f1f7ef` | Page background (mint) |
| `--club-surface` | `#ffffff` | Cards, tables, inputs |
| `--club-surface-alt` | `#e6f1e3` | Alternate section bands, table headers, badges |
| `--club-text` | `#16301f` | Text; also the dark pill and focus-bar background |
| `--club-muted` | `#4a5c4e` | Secondary text, labels |
| `--club-brand` | `#209d50` | Primary pills, facts band, footer, capture tile, race-control screen |
| `--club-on-brand` | `#0d1b12` | Text on brand green (**never white on green**) |
| `--club-link` | `#236a33` | Links |
| `--club-rule` / `--club-rule-strong` | `#d3e3cf` / `#76887a` | Dividers / input borders |
| `--club-focus` | `#16301f` | Focus ring |
| `--club-danger` | `#a3231b` | Destructive text, borders, pills |
| `--club-highlight` / `--club-on-highlight` | `#ffe9a8` / `#16301f` | Notices and warnings |

**Dark** (via `prefers-color-scheme: dark`, as the website does): background `#0f1f15`, surface `#16291c`, surface-alt `#122418`, text `#eaf3e7`, muted `#a9bdad`, link `#7fd39a`, rule `#2a4232`, danger `#ff9d94`, focus `#eaf3e7`. Brand and on-brand are the same as in light.

**Other tokens:**
- radii: `--club-radius-button: 999px` (pills), `--club-radius-card: 20px` (cards); table wraps use 16px and notices 14px
- spacing: `--club-gutter: 1.25rem`, `--club-measure: 68ch`
- fonts: `--club-font-display: "Bricolage Grotesque"` (weight 800), `--club-font-body: system-ui`

**New timing-only token:** `--club-on-danger`, which is `#ffffff` in light and `#0f1f15` in dark. It's for text on a danger pill.

**Pre-checked contrast (WCAG)**
| Pair | Light | Dark |
|---|---|---|
| Text on background / surface | 13.1 / 14.2 | 15.1 / 13.5 |
| Muted on surface | 7.2 | 7.7 |
| On-brand on brand (pills, facts, capture tile, race control) | 5.1 | 5.1 |
| Danger on surface | 7.5 | 7.7 |
| On-danger on danger | 7.5 | 8.6 |
| On-highlight on highlight | 11.8 | (same colours) |
| White on brand: **don't use** | 3.5 | |

### 7.2 Type and numbers
- **Headings:** Bricolage Grotesque 800, with `letter-spacing: -0.02em` and `line-height: 1.12`. Use the website's sizes:
  - page H1 as in `.club-phead`
  - hero H1 2.15rem on phones, up to 4rem on desktop
  - h2 about 2.1rem
  - h3 1.2rem
- **Body:** `system-ui` 16px with a 1.55 line height. Ledes (`.club-lede`) are 1.15rem. Small print (`.club-small`) is 0.875rem in the muted colour.
- **Full stops:** follow the website and don't put one at the end of page titles. PTB's "Roster." style doesn't carry over.
- **Numbers:** every bib, time and count uses `.club-num` (tabular figures).
- **Big clocks and the capture label:** use Bricolage 800 if its figures turn out to be tabular when tested. Otherwise use `system-ui` 800 with tabular-nums. The digits must not jitter as the clock ticks.

### 7.3 Six page templates (PTB's structure, built with website components)
Every timing page uses one of these. If a page fits none, stop and propose.

| Template | PTB idea | Built with |
|---|---|---|
| **T1 Launchpad** | A home made of big job targets | App header and area bar → `.club-phead`, with the race name as H1 and a lede giving the state ("Not started. Starts Sunday 1 November at 11:00.") → up to two pills (`.club-btns`: the primary job as a brand pill, the next as a secondary pill) → a `.club-facts` band of race facts and counts (Starts · State · Entries · Marshals · Crossings · Anomalies) → a "Race day" `.club-g2`/`.club-g3` grid of `.club-link-card`s, in nav order, each with a Bricolage h3 title, one line of explanation and an optional `.club-badge` count → a "Before the race" set of link cards (Entry list, Marshals) → "Starting again" with the danger-text link to the danger zone |
| **T2 Race control** | The whole screen goes green for the "go" moment | Focus bar → a full-height brand-green section with on-brand text, centred. It holds: a small race line → the clock (§7.2) → the state line as H1 ("Runners to the start." / "Race in progress." / "Race finished.") → **one** action as a dark pill (text-colour background with background-colour text, at least 56 px tall, up to 28rem wide) → a caption on what it does → divider → a confirmation line with the time in `.club-num` |
| **T3 Work page** | The same skeleton everywhere | App header and area bar → `.club-phead` (H1 and lede) → status row → content in `.club-wrap` (or `.club-wrap-narrow` for forms). The status row is a bold `.club-num` count, a freshness `.club-badge`, and the action as a secondary pill on the right. Content is built from `.club-card`, `.club-meta`, `.club-table-wrap`, `.club-notice`, `.club-error-summary` and the form classes |
| **T4 Leaderboard** | Hero, podium, then the list | App header and area bar → `.club-phead` (H1 and state, with a freshness badge) → `.club-notice` when the start isn't recorded → podium/category `.club-card`s in a `.club-g3` (place in `.club-small`, name in Bricolage, time in a big `.club-num`) → sort as `.club-pills` links → `.club-table-wrap` from 62em, a `.club-card` list below that |
| **T5 Tool screen** | One giant action plus a queue | Focus bar showing the race, the marshal, "{n} waiting" and the connection pill → the giant capture tile (§7.5) → helper line in `.club-small` → the queue as a `.club-card` list on the background → the keypad when a card is open. Exactly `100dvh` with no page scroll; the queue scrolls on its own |
| **T6 Presentation** (later) | A projector-friendly prize giving | Text-colour background with background-colour text, a big Bricolage title, and brand pills. Only if the prize-giving mode is approved (D4) |

### 7.4 Navigation: a signed-in app shell, driven by role
**Decided by Bindal (3 Oct 2026):** once someone is signed in, they don't see the public website's navigation. They see navigation built from the roles an admin has given them.

**The shell (timing pages now; Your account and Club admin later, §2.2)**
- **No public chrome.** Signed-in pages have none of the public site's chrome: no public nav (Run with us · Races and events · Membership · News · About · Come for a run), no "new website" banner, no breadcrumbs and no public footer. A slim footer keeps "Privacy notice" and a "Club website" link.
- **App header.** It's in the website style: mint background, the SRC logo and pill links.
  - **Logo:** links to the public home page.
  - **Areas:** the ones the person's roles allow, as pill links (Your account · Race timing · Club admin). The current area gets `aria-current="page"` and the website's 3 px brand underline.
  - **User menu:** the signed-in name or email and "Sign out" (the main site's sign-out).
  - **On phones:** the logo, the current area's name and a "Menu" button (like `.club-menu`) listing the same areas plus Sign out. Someone with a single area sees no switcher, just the area name.
- **Area bar.** It's built with `.club-section` and sits under the header. It holds the pages of the current area, filtered by role.
  - In Race timing, `.club-section-name` is the race name (shortened on phones) and links back to the race chooser.
  - On phones the bar scrolls sideways, with the active item scrolled into view on load and an edge fade.
- **Tool screens.** Record crossings and Race control use only the focus bar (`.club-focus`) with "Leave…", with no app header and no area bar.

**Role matrix** (roles are assigned in Club admin → People and roles; confirm the real role names and rules in Phase 1)
| Role | Areas in the header | Race timing pages in the area bar |
|---|---|---|
| Signed in, no role | Your account | None. Timing stays a 404, as today |
| Timing marshal (`timing-marshal`) | Your account · Race timing | **[erratum]** None — no area bar. `/timing` lists their rostered races on a Marshalling card, each linking to Record crossings |
| Timing admin (`timing-admin`) | **[erratum]** Your account · Race timing | Overview · Race console · Live leaderboard · Results · Entry list · Marshals (race-day order, D1). Record crossings is **not** a tab (Decisions) |
| Club master (`src-admin`) | **[erratum]** Your account · Race timing · Club admin | As timing admin |

- **One source of truth:** nav visibility uses the same role and permission checks as the routes themselves, not a second hard-coded list. The server still enforces access; the nav only hides what a role can't use.
- **Today's timing order, for comparison:** Overview · Live leaderboard · Results · Entry list · Marshals · Race console.
- **Labels:** "Record crossings" replaces "Marshal" for the capture screen, so it can't be confused with "Marshals" (the roster). "Race control" is the start/finish screen; if D3 keeps the console as one page, the label stays "Race console".
- **Danger zone:** stays out of the nav, as NN does today. It's linked from the launchpad as danger text.
- **Launchpad:** the link-card titles use the same labels as the nav.
- **Signed-out visitors:** NN's 404 stays as it is (§2.1).

### 7.5 Components: PTB idea → website component
| PTB idea | Website component (ClubBase) | Notes |
|---|---|---|
| Page header (eyebrow, H1, lead) | `.club-phead` + `.club-lede` | No eyebrow, because the area bar gives the context |
| Launchpad buttons | `.club-link-card` in `.club-g2`/`.club-g3`, plus `.club-btns` pills | Cards stack full width on phones, which makes big tap targets |
| Status row / race facts | `.club-facts` band (launchpad); `.club-meta` (label/value); `.club-badge` (counts) | Facts band labels are small and bold, as on the home page |
| Dark / green / outline buttons | `.club-btn-primary` (brand), `.club-btn-secondary` (outline), a new dark pill (text-colour background) | All 48 px minimum, weight 800 |
| Cards | `.club-card` (white, 20 px radius) | No shadows, the same as the website |
| Status pills | `.club-badge`, plus the timing variant `.timing-state` (`data-state`: ok, flagged, resolved, discarded, failed) | Failed and discarded use danger; flagged uses highlight |
| Chips / sort options | `.club-pills` | |
| Tables | `.club-table-wrap` + `.club-table` | Group rows and the header row use surface-alt, as on `/membership/` |
| Record list rows | `.club-card` list; bib in a tile styled like `.club-event-when` (the date tile on `/events/`) | The bib tile replaces PTB's green team-number square |
| Warning panel | `.club-notice` (highlight) | For example "The start of this race has not been recorded…" |
| Danger card | `.club-error-summary` styling (3 px danger border, white, 14 px radius) | Danger zone, and any blocking error |
| Forms | `.club-form`, `.club-field`, `.club-label`, `.club-optional`, `.club-hint`, `.club-input`, `.club-select`, `.club-choices`, `.club-error`, `.club-form-actions` | Walk-in form, CSV upload, roster add |
| Empty state | `.club-card` with an h3 and one line | "Nothing waiting" |
| App header (new) | Built from the website header's parts (`.club-header-inner`, `.club-logo`, pill links, and `.club-menu` on phones), with role-based items | Self-contained, so it can move to Your account and Club admin later (§2.2) |
| Focus / tool bar | `.club-focus` | Already used by NN |
| Area bar | `.club-section` | Already used by NN |

**New timing components** live in the timing app and are built only on `--club-*` tokens (sketches in Appendix A):
- `.timing-capture`: the giant "Crossed now" tile.
- `.timing-clock`: the big tabular clock.
- `.timing-go`: the brand-green race-control screen.
- `.timing-bib`: the bib tile.
- `.timing-conn`: the online/offline pill.
- `.timing-key`: the keypad keys.
- `.timing-btn-danger` and `.timing-btn-dark`: the danger pill and the dark pill, used together with `.club-btn`.
- `.timing-danger-link`: danger-text actions.

### 7.6 Motion
- Use the website's restraint: no decorative animation.
- The capture tile and keypad give press feedback with `scale(.97)`.
- State changes on race control fade in.
- Respect `prefers-reduced-motion`, as ClubBase does.

### 7.7 Accessibility
- **Headings and landmarks:** exactly one `<h1>` per page. Landmarks: header; two navs (the header's areas, labelled "Areas", and the area bar, labelled with the area or race name); main; footer.
- **Focus:** use the website's ring (3 px solid `--club-focus`, 3 px offset). It inverts in dark mode, and on the green race-control screen it must still be visible. Test it there.
- **Contrast:** at least 4.5:1 for text in both themes (§7.1). Never put white text on brand green.
- **Targets:** 48 px minimum. The website's buttons already meet this.
- **Announcements:** queue counts, sync state and freshness use `aria-live="polite"`.
- **Bib entry:** NN's keypad stays. Where there's a bib text field, it uses `inputmode="numeric"`.
- **Testing:** run axe on every page, in both themes, with zero serious or critical issues.

### 7.8 Responsive
- **Breakpoints:** the website's are 30em, 44em, 48em and 62em. Test at 390×844, 768×1024 and 1280×800.
- **Layout:** the `.club-wrap` container is 1200 px wide with a 1.25rem gutter. Text measure is 68ch.
- **Grids:** `.club-g2` and `.club-g3` collapse to one column on phones, as on the website.
- **Live leaderboard:** card rows below 62em, a table from 62em.
- **Record crossings:** the capture tile is about 290 px tall on a phone and about 180 px on desktop.

### 7.9 PWA and meta
- Keep the manifest and service worker scoped to `/timing/`.
- Add `theme-color` meta tags for light and dark, matching the focus bar.
- Add `robots: noindex, nofollow` on all timing pages.
- Give every page its own title (§6.2, fix 3).

## 8. Page-by-page spec

Each entry gives:
- **Build:** the template and the website components to use
- **PTB:** the behaviour to keep from PTB
- **NN:** what to keep from NN

Screens are listed as `src-website`, `nn-current` and `ptb-reference` image codes.

### 8.1 Race chooser (`/timing`, `/timing/events`). T1/T3 · w04 · n01, n02
- **Build:** a `.club-phead` titled "Race timing", then races in the `/events/` date-tile list style: date tile, race name as a link, a meta line (time · distance · state), and a state badge (Not started / In progress / Finished / Published).
- If there's only one race, a big primary pill to its launchpad sits above the list.

### 8.2 Race launchpad (`/timing/events/nn-2026`). T1 · w01, w02 · n03, nm03 · 01, m01
- **Build:**
  - Page head: the H1 is "Nightingale Nightmare 2026", and the lede is the state line.
  - Pills by phase:
    - before the start: "Open race control" (primary) and "Entry list" (secondary)
    - during: "Record crossings" and "Timing log"
    - after: "Results" and "Live leaderboard"
  - A facts band with Starts · State · Entries · Marshals rostered · Crossings · Anomalies needing a human.
  - "Race day" link cards in nav order, then "Before the race" cards, then "Starting again" with the danger-text link "Wipe this race and start again".
- **NN:** keep every fact NN shows today (Slug and Distance can move into a small `.club-meta` under the cards).

### 8.3 Race control (`…/console`, Start and Finish). T2 · n08, nm02, nm05 · 02, m05
States, one at a time:
1. **Before:** the countdown, then "Runners to the start." as the H1, then the "Start the race" dark pill. Keep NN's captions ("A clock reaching zero starts nothing…" and "Pressing it twice does not move the clock…"). A confirm step is D4, and is recommended before race day.
2. **Running:** the elapsed clock, then "Race in progress.", then the "Finish this race" pill with NN's caption "Finishing is a label, not a cut-off…". A link to open anomalies shows a count.
3. **Finished:** "Race finished.", the finish time, and links to Results and Live leaderboard. Keep NN's undo if it exists.

Race status (DNS/DNF/DQ) and the console's other sections go per D3.

### 8.4 Record crossings (`/timing/marshal/nn-2026`). T5 · n09, nm01 · 07, 08, m02
- **Focus bar:** "Southville RC · Record crossings", the race name, "{n} waiting", the connection pill (if NN exposes online/offline), and "Leave this screen".
- **Capture tile:** a giant brand-green "Crossed now" tile with on-brand text, about 290 px tall on phones. Under it, the helper text in `.club-small`: "Press the moment a runner crosses…", "Saved for use without signal…".
- **Queue:** captures as `.club-card`s, each showing:
  - the time in `.club-num`
  - the bib tile or the keypad when the card is open
  - a state badge (queued / syncing / flagged / failed)
  - actions as pills

  Failed captures show NN's retry copy in danger text.
- **Empty:** a card titled "Nothing waiting", with NN's copy.
- **NN:** keep the keypad, the tap-first flow, the offline and sync logic and the validation exactly. Only the layout and styling change.

### 8.5 Timing log (`…/crossings`). T3 · 04, m04
- **Build:** page head with the lede "Every recorded crossing… Times are Europe/London." Status row: "{n} captures", a freshness badge and Refresh. A full-width search ("Search by bib or name"). Then crossing cards, newest first:
  - Line 1: bib tile · runner name · category or club, with the state badge on the right.
  - Line 2: time of day (`.club-num`) · date · "recorded by {marshal}".
  - Line 3: Edit (secondary pill; inline Bib and Time fields with Save/Cancel) and Discard (danger text); Restore on discarded crossings.
- **NN:** keep NN's search and edit logic. The console section becomes this page (D3).

### 8.6 Anomalies (`…/console#anomalies` → its own route if D3). T3 · 03, m09
- **Build:** a lede using NN's copy ("A capture is here because a marshal's screen flagged it… an anomaly is a question…"). Status row with "{n} open" and Refresh. A card for each capture with the reason and NN's resolve actions. An empty card: "Nothing is waiting to be resolved on this race."

### 8.7 Results (`…/results`). T3 wide · w06 · n05 · 05, m07
- **Build:**
  - A status row as a `.club-meta` or facts strip: State · Finished · Published · Open captures.
  - The preview table (`.club-table-wrap`), with NN's "preview" note as `.club-small`.
  - A "Files" card: "Results as CSV" and "Results as a spreadsheet" pills, with NN's leading-zero explanation.
  - A "Publish these results" card. While publishing is blocked, the blocking reason is a `.club-notice` and the Publish pill is disabled; once allowed, it's the primary pill with NN's "open internet" caption.
  - A "Prize giving" grid of `.club-card`s (prize, rule, winner or "Nobody has won this.") and a prize files card.
- **NN:** keep all of it. The relay prizes are a logic problem (§4.1).

### 8.8 Live leaderboard (`…/leaderboard`). T4 · n04, nm04 · 09, m03, m06
- **Build:** page head with the state and a freshness badge ("Updated 20:22:26"). A `.club-notice` when the start isn't recorded (NN's copy). Category/podium cards from NN's prize bands. Sort as `.club-pills` (Total time · Category · Bib). Then the table from 62em and cards below. An empty card: "Nothing has been captured for this race yet."
- **NN:** staff-only, as today (D6).

### 8.9 Entry list (`…/registration`). T3 · w05 · n06 · 11, 12, m11, m15
- **Build:**
  - Status pills: Entries · Runners, plus any other count NN already shows.
  - One `.club-card` per job:
    - "Import from the club's entries", with the primary pill and NN's copy
    - "Upload an entry list" (Full On Sport CSV), with the form classes and the Check/Import pills
    - "What is never taken from the file", as a `.club-small` list
    - "Add a walk-in", a form with NN's fields and hints
  - Then "On the start list" as a `.club-table-wrap` with search, a sortable header, and Print (the "Collected ✓" column is D4).
- **NN:** keep NN's import logic, fields and copy.

### 8.10 Marshals roster (`…/marshals`). T3 · n07 · 10, m10
- **Build:** a lede with NN's copy. Person cards (name, "Added {date}", and "Remove" as a danger-text action). Then an "Add somebody" form card (select plus a primary pill).
- **NN:** keep NN's role rules.

### 8.11 Danger zone (`…/danger-zone`). T3 · n10 · 14, m12
- **Build:** a lede with NN's copy. A danger card containing:
  - "What would be removed" and "What would be kept", as two `.club-meta` blocks
  - NN's explanation
  - "Type nn-2026 to confirm", with an input
  - a "Wipe this race" danger pill, disabled until the text matches

  "Back to this race" is a secondary pill.
- **NN:** confirm the server-side check (§4.1) and keep it.

### 8.12 Not found (unknown `/timing/**` routes)
- Show the timing shell with the H1 "Page not found", one line of text, and pills to the race chooser and the live leaderboard.
- Signed-out visitors keep NN's current 404 page; only its styling changes.

## 9. PTB relay concepts → NN
| PTB (two-person relay) | NN (individual 10 km) |
|---|---|
| Bib = leg digit + team number | NN's bib format and validation |
| Leg A / Leg B splits | NN's time fields |
| "On leg B", handover checks | Not applicable; use NN's statuses |
| Pair categories | NN's prize bands (Senior, Vet 40/50/60, by gender) |
| Relay prizes (Furthest Apart, Closest Together, Fastest Leg, "fastest team") | Not applicable, but still in NN's prize list today (§4.1) |
| "Team number" in search and sort | "Bib" (NN still says "team number" today) |
| CSV import from Full On Sport | NN's "Import from entries", plus the CSV upload |
| Its own login and Staff pages | The main site's sign-in and roles |

## 10. Microcopy rules
- **Voice:** NN's plain, careful copy stays. The redesign changes layout, not wording, except for the fixes listed here.
- **House style:** follow the website. Use British English and sentence case, with no full stop at the end of page titles. Buttons start with a verb ("Start the race", "Record crossings", "Results as CSV").
- **Consequences:** say what an irreversible action does before the click.
- **Empty states:** say what's going on and what happens next.
- **Times:** show freshness on live data ("Updated 20:22:26"). Write "11:00 GMT" or "11:00 BST", not "GMT+0".
- **Relay leftovers:** remove relay words ("team number", "leg", "handover") only where they're presentation. Where they come from logic or config, list them for Mark (§4.1).
- **Public copy:** public-facing wording needs Kayleigh's OK (D7).

## 11. Acceptance criteria
1. **Templates and look:** every timing page uses one of the six templates and is built from ClubBase components and `--club-*` tokens. Side by side, it matches `src-website/` for look and `ptb-reference/` for structure.
2. **Behaviour unchanged:** existing tests pass. Any test edits are selector/copy-only and listed one by one.
3. **Diff limited:** the diff only touches the timing app's presentation files. The ClubBase source and any shared chrome are untouched, or each exception is listed and approved.
4. **Signed-in shell:** no timing page shows the public site's nav, banner, breadcrumbs or footer. The app header and area bar show exactly what the role matrix (§7.4) allows; Playwright checks this for no role, a timing marshal and an admin. The active item is visible at 390 px.
5. **Accessibility:** axe finds zero serious or critical issues in light and dark. There's one `<h1>` per page, the focus ring is visible on every surface (including brand green), contrast matches §7.1, and targets are at least 48 px.
6. **Record crossings:** no page scroll at 390×844. The capture tile is about 290 px tall on phones. The keypad, the offline behaviour and sync work exactly as before.
7. **Race control:** a full brand-green screen with one action per state. NN's captions are intact.
8. **No sideways scrolling:** no page scrolls sideways at 390 px, and tables scroll inside their own container.
9. **Checks:** `./dev check` and `./dev test` pass, or the timing app's equivalents confirmed in Phase 1. Bindal re-runs them himself.
10. **Mock race:** **[erratum]** test users for the three roles come from the existing Playwright fixtures (`timing-staff-db.ts`, `timing-db.ts`, `timing-fixtures.ts`). Run on the final build, with two phones recording crossings and one laptop on admin. Start → captures, including a duplicate and a mistyped bib → fix in the timing log → finish → results → publish → unpublish.
11. **Nothing outside timing changed:** the baseline screenshots of the non-timing pages still match after every slice.

## 12. Decisions for Bindal (answer at HALT 2)
- **D1, nav order:** race-day order (default), or NN's current order?
- **D2, chrome on signed-in pages:** decided on 3 Oct. There's no public website navigation once someone is signed in, only role-based navigation (§7.4).
- **D3, race console:** split it into Race control (`/console`), Timing log (`/crossings`) and Anomalies (its own route), each one tap away (default)? Or keep one console page in the new style? Race status (DNS/DNF/DQ) stays in race control unless you prefer it on the start list.
- **D4, PTB behaviours NN may lack:** each would be its own slice after the redesign:
  - a confirm step before "Start the race" (recommended before race day)
  - Undo after discard
  - a connection pill with sync counts
  - the prize-giving presentation mode
  - a printable start list with "Collected ✓"
- **D5, dark mode on race-day screens:** follow the phone's setting, as the website does (default)? Or force light on Record crossings and Race control for outdoor readability?
- **D6, public live results:** keep the leaderboard staff-only until results are published (default), or add a public live view? This touches personal data, so Mark reviews it.
- **D7, public copy:** Kayleigh approves any public-facing wording.
- **D8, dates:** the last merge date and the mock-race date before 1 Nov.
- **D9, deploy window:** **[erratum]** timing deploys separately through Workers Builds, so this applies only to a change under `platform/packages/`, which also redeploys `apps/main`. Ship before entries close (30 Oct, 17:00 GMT), or hold until after? Holding leaves less than two days before race day.
- **D10, how ClubBase reaches timing:** import the content components from the same shared source as the chrome (default)? Or copy the needed CSS into the timing app, only if importing would change what the Astro site renders?
- **D11, the shell for Your account and Club admin:** roll it out after the race (default), or straight after entries close on 30 Oct at 17:00 GMT? (§2.2)

---

## Appendix A: timing components (sketches built on website tokens)
```css
/* Live in the timing app. Use only --club-* tokens so light and dark both work. */
.timing-capture {
  display: flex; align-items: center; justify-content: center; width: 100%;
  min-height: clamp(11rem, 36vh, 18rem); border: 0; border-radius: var(--club-radius-card);
  background: var(--club-brand); color: var(--club-on-brand);
  font: 800 clamp(2rem, 7vw, 2.75rem)/1.1 var(--club-font-display); letter-spacing: -0.02em;
  transition: transform .15s ease;
}
.timing-capture:active { transform: scale(.97); }

.timing-go {                       /* race control: the whole screen goes green */
  min-height: calc(100dvh - var(--timing-focus-bar-h, 3rem));   /* fills the screen under the focus bar */
  display: grid; place-content: center; gap: 1rem; text-align: center;
  background: var(--club-brand); color: var(--club-on-brand); padding: 2rem var(--club-gutter);
}
.timing-btn-dark { background: var(--club-text); color: var(--club-background); min-height: 56px; }   /* with .club-btn */

.timing-clock { font: 800 clamp(3rem, 12vw, 6rem)/1 var(--club-font-display);
  font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }   /* fall back to system-ui if not tabular */

.timing-bib {                      /* modelled on the /events/ date tile */
  min-width: 3.25rem; padding: .4rem .55rem; border-radius: 14px; text-align: center;
  background: var(--club-surface); border: 1px solid var(--club-rule);
  font: 800 1.25rem/1 var(--club-font-body); font-variant-numeric: tabular-nums;
}

.timing-conn { display: inline-flex; align-items: center; gap: .4rem; min-height: 32px;
  padding: 0 .75rem; border-radius: var(--club-radius-button); font-weight: 700; }
.timing-conn[data-online="true"]  { background: var(--club-brand);     color: var(--club-on-brand); }
.timing-conn[data-online="false"] { background: var(--club-highlight); color: var(--club-on-highlight); }

/* status badges: class="club-badge timing-state" data-state="…" */
.timing-state[data-state="flagged"]   { background: var(--club-highlight); color: var(--club-on-highlight); }
.timing-state[data-state="failed"],
.timing-state[data-state="discarded"] { background: var(--club-danger); color: var(--club-on-danger); }

.timing-key { min-height: 56px; border-radius: 14px; border: 2px solid var(--club-rule-strong);
  background: var(--club-surface); color: var(--club-text);
  font: 800 1.5rem/1 var(--club-font-body); font-variant-numeric: tabular-nums; }

.timing-btn-danger { background: var(--club-danger); color: var(--club-on-danger); }   /* with .club-btn */
.timing-btn-danger:disabled { opacity: .5; cursor: not-allowed; }
.timing-danger-link { background: none; border: 0; padding: 0; color: var(--club-danger);
  font-weight: 700; text-decoration: underline; }

/* Signed-in app shell: self-contained so it can later move into the shared chrome (§2.2) */
.app-header { background: var(--club-background); color: var(--club-text); border-bottom: 1px solid var(--club-rule); }
.app-header-inner { display: flex; align-items: center; gap: 1rem; min-height: 64px; }   /* inside .club-wrap */
.app-areas { display: flex; gap: .25rem; }
.app-areas a { min-height: 48px; display: inline-flex; align-items: center; padding: 0 .8rem;
  border-radius: var(--club-radius-button); font-weight: 700; color: inherit; text-decoration: none; }
.app-areas a[aria-current="page"] { box-shadow: inset 0 -3px 0 var(--club-brand); }   /* same cue as the website nav */
.app-user { margin-left: auto; display: flex; align-items: center; gap: .75rem; }    /* name + "Sign out" secondary pill */
.app-footer { padding: 1rem 0; font-size: .875rem; color: var(--club-muted); }         /* Privacy notice · Club website */

@media (prefers-reduced-motion: reduce) {
  .timing-capture { transition: none; }
  .timing-capture:active { transform: none; }
}
```

## Appendix B: screenshot index (`docs/timing/`)
**SRC website, the look to match: `src-website/`**
- desktop/: w01-home-hero-and-facts · w02-home-sections-and-cards · w03-home-photo-and-footer · w04-races-and-events · w05-membership-pricing · w06-membership-table
- mobile/ (390 px): wm01-home-hero-and-facts · wm02-home-steps · wm03-races-and-events · wm04-membership-pricing-cards

**NN today: `nn-current/`** (3 Oct 2026, before any entries were imported)
- desktop/: n01-timing-overview · n02-races-list · n03-race-overview · n04-leaderboard-staff · n05-results-and-publishing · n06-entry-list · n07-marshals-roster · n08-race-console · n09-marshal-capture · n10-danger-zone
- mobile/ (390 px): nm01-marshal-capture · nm02-race-console-top · nm03-race-overview-top · nm04-leaderboard-staff · nm05-race-console-scrolled · nm06-race-overview-scrolled

**PTB, the structure to copy: `ptb-reference/`** (names masked)
- desktop/: 01-home-launchpad-admin · 02-start-race-control-finished · 03-anomalies-empty · 04-timing-log · 05-results-admin-csv-preview · 06-prize-giving · 07-marshal-capture-empty · 08-marshal-menu-open · 09-live-results-final · 10-staff · 11-registrations-import-and-bibs · 12-registrations-walkup-and-reconcile · 13-roster · 14-danger-zone · 15-login · 16-not-found-default
- mobile/ (390 px): m01-home · m02-marshal-capture · m03-live-results-top · m04-timing-log · m05-start-race-control-finished · m06-live-results-list · m07-results-admin · m08-prize-giving · m09-anomalies · m10-staff · m11-registrations · m12-danger-zone · m13-roster · m14-home-launchpad-scrolled · m15-registrations-walkup
