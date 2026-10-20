# NN 2026 race photos: build brief for Claude Code

This brief is the source of truth for the race photos feature. It is built in five slices,
**one slice per session**. Each session starts by pasting the matching prompt from §16;
that prompt points back here.

Read the whole brief before touching anything. Where this brief and the repository
disagree, **the repository wins and you stop and tell me.** Facts marked *(verify)* came
from planning notes, not from the code, and agents have propagated stale facts into this
repo before. Check each one in pre-flight.

---

## 1. What we are building

Runners at Nightingale Nightmare 2026 (a Halloween 10 km off-road race, Sunday 1 November
2026) find their photos without searching and without an account:

1. Volunteer photographers drop their untouched originals into a shared Google Drive folder,
   one subfolder each.
2. On **one laptop**, a small Python tool reads when each photo was taken, makes three
   stripped copies, asks a vision model for the bib numbers, and checks each read against
   the race's bib list. The lead fixes each camera's clock on a local page.
3. The tool uploads **only the stripped copies** to a private Cloudflare R2 bucket, and
   writes **every read, checked or not,** to one SQL file that is run by hand in the
   Supabase editor.
4. On the website, a team of four (Bindal, Andrew, Adrian and Ross) checks the unsure reads
   together at `/admin/photos/check/`, sharing one queue from any computer or tablet.
5. A small admin page publishes the photos and emails every runner a **private link** to
   their own page. There is no public search and no runner account.
6. The runner's page shows their tagged photos, part-read photos that could be them, and
   a way to look through a spot. Images are served by the Worker from the private bucket.

Human-only references (you cannot open them; everything you need is in this brief):
the plan doc and the mockup canvas, both in the club's Claude project.

---

## 2. Decisions already made: do not re-litigate

Each of these should end up in an ADR in `docs/architecture/decisions/`, named like the
existing ones (`adr-NNN-<slug>.md`), during the slice that implements it. Use the next free
number *(verify)*; never edit an accepted ADR. Committee decisions (retention, the
privacy wording) go in `docs/decisions/decision-log.md` instead, once the committee has
made them.

1. **Bib numbers are the only link between a photo and a runner.** No face recognition or
   face detection of any kind, no matching by finish time, no clothing or colour matching.
2. **Tagging happens on one laptop**, before anything is uploaded. Raw photos never leave
   the laptop and the photographers' Drive folders.
3. **Copies are made on the laptop**: full (2,400 px long edge), medium (1,200 px) and
   thumbnail (480 px), JPEG, with all EXIF removed. Only the time taken survives, as a
   database column.
4. **Storage is one private R2 bucket**, `src-race-photos` *(proposed name)*, created in the
   EU jurisdiction, no public access, one key prefix per event (`nn-2026/`).
5. **The laptop uploads with an R2 API token limited to that one bucket** (Object Read &
   Write), kept in a local file outside the repo and revoked after each upload. The Worker
   reads and deletes through an R2 binding. No storage credential ever reaches the Worker
   or the repo.
6. **Tags reach the database as a SQL file run by hand in the Supabase editor**, the way
   entries SQL is already run. No service-role key anywhere, no import endpoint.
7. **Runners reach photos only through a private link** emailed to the address they
   entered with. No public bib search for 2026. No runner accounts.
8. **A part-read bib** (for example `12?`) is shown as "Could be you" to every runner whose
   bib fits, and is never in anyone's own set until a person confirms it. "That's me" opens
   a ready-written email; it never changes data.
9. **A small admin page** at `/admin/photos/` publishes, sends the links and takes photos
   down, from any computer. Bib reading is never done on the website.
10. **No self-tagging, no public upload, no download-all, no prints, no payments.**
11. **Unsure reads are checked together on the website** at `/admin/photos/check/`, by
    people holding a photo-checker role. Each checker gets the next photo nobody else has
    open, held for them for 10 minutes. Every decision records who made it. Publishing
    waits until nothing is left to check.
12. **Two roles, kept narrow.** Photo-checker: check tags and take a photo down (Bindal,
    Andrew, Adrian, Ross). Photo-admin: publish and send the links (Bindal, Mark).

---

## 3. Non-negotiable rules

Breaking one of these is a defect, not a judgement call.

- **Boring beats optimal.** Volunteers with day jobs maintain this. Prefer the standard
  library and what the repo already uses. Ask before adding any dependency or service.
- **RLS is the access control.** RLS on every table from its first migration. Anonymous
  callers hold **no table privilege** in the `photos` schema; they reach data only through
  security-definer functions with a locked `search_path` and execute-only grants, the
  pattern the entries schema already uses *(verify the exact pattern and copy it)*.
- **The `photos` schema holds no runner names and no email addresses.** It holds bibs,
  photo metadata, photographer credits and link hashes. A runner's first name or email is read
  at the moment it is needed, from where it already lives.
- **Private links are stored as hashes only.** The Worker hashes the token (SHA-256) and the
  database compares hashes. A token never appears in a log, a database row or an error.
- **No personal data in logs**: no tokens, emails, names or bibs paired with either.
- **Timestamps stored UTC, displayed `Europe/London`**, through one London-time module
  per language: `london-time.ts` on the website, `tools/photos/racephotos/london_time.py`
  in the laptop tool. The clocks went back on 25 October; the race is the Sunday after.
- **Progressive enhancement.** Every runner page and form works with JavaScript disabled.
  Zero axe violations. Operable at 320 px.
- **Race facts are data, not markup.** Spots, the event slug and photographer credits come
  from data, never hard-coded copy.
- **No secrets in the repo.** The R2 token and the vision model key live in a local file
  outside the repository on the tagging laptop. Check `.gitignore` covers the tool's work
  and config paths.
- **Real photos never enter the repo.** Test fixtures are synthetic images the tests
  generate themselves.

---

## 4. Stop and ask: do not resolve these by inference

Say what you found and wait.

- **Anything under `/nn/**`, `/admin/**`, `/account/**` or `/timing/**` before Monday
  2 November 2026.** Those paths are frozen until after the race.
- **Any migration during race week**, or any migration before I've confirmed which Supabase
  project the `photos` schema belongs in (§6).
- **Which vision model provider to use.** Build against a fake reader until I tell you.
- **Any Cloudflare account action**: creating the bucket, tokens, lifecycle rules,
  changing the Workers plan. Those are done by the account holder (§11).
- **Sending any email to a real runner**, in any environment.
- **Anything that would go over the daily email allowance**, or change how the outbox
  orders or caps mail for the race.
- **Exposing a schema through PostgREST, or changing `config.toml`.**
- **Copy that runners will read.** Use the draft copy in this brief and mark it for
  Kayleigh's sign-off; do not write new copy beyond it.
- **Adding a field that holds personal data**, anywhere.
- **Anything that needs a service-role key**, or would put a credential in the repo.
- **A fact about the race** this brief doesn't give you.

---

## 5. Working method

- **Step zero of every session:** read `CLAUDE.md` in full. Then `git status`, confirm a
  clean tree, and branch off an up-to-date `main`. One session per working tree.
- **Pre-flight before trusting any assumption:** `git log --oneline -- <target files>` for
  everything you will touch, and read the committed code, not this brief's description of
  it.
- **Supabase MCP:** `list_projects` is step zero and must be confirmed with me before any
  call. The MCP defaults to another project. The entries project is **not** reachable
  through the MCP; SQL for it is run by hand.
- **Migrations go through `apply_migration`, never `db push`.** Histories have diverged.
- **Never touch `.dev.vars` or `.claude/settings.json`.**
- **Halt and propose** at the end of pre-flight: what you will build, where, the answers to
  the §6 checks, and any blocking question from §15. Wait for my go.
- **One concern per commit.** No pushes before I've reviewed the diff.
- **I run `./dev check` and `./dev test` myself** before anything merges, and Andrew
  reviews each diff and runs them again independently. Report what you ran, but don't
  ask either of us to trust your counts.
- **Routing:** decisions to `docs/architecture/decisions/`, roadmap changes to
  `docs/delivery/phases.md`, traps to `CLAUDE.md`, procedures to `docs/delivery/runbooks/`
  (each one listed in that folder's `README.md` table), and the frozen pull-request body to
  `docs/delivery/pull-requests/` if that is still the practice *(verify)*. Documentation
  ships in the same pull request as the change.
- **Voice:** comments explain why and name the failure they prevent. Markdown wraps at
  about 90 characters.

---

## 6. Verify in pre-flight

This brief can't vouch for these. Report each with the file or command that proves it.

| Claim | How to check |
| --- | --- |
| Supabase migrations live in `platform/packages/db` and target one specific project | Read the package, `config.toml`, CI workflows and `CLAUDE.md` |
| Which project holds the NN 2026 bib list, the results (finish times, names) and the entry email addresses | Read the entries and timing code paths; ask me if unclear |
| How entries-project SQL and security-definer functions are written today | Read the existing entries migrations |
| How the Worker talks to each Supabase project, and with which key | Read `apps/main/worker/` |
| How the site already sends email through Resend, and the From and Reply-To in use | Read the transactional email code |
| How admin pages are gated by role, and the state of the people/roles work | Read `/admin/**` code and the `admin-people-roles-matrix` branch |
| Where NN 2026 results will be published | Search the repo; ask me if not here |
| How Python under `tools/` is laid out, run and tested in CI | Read `tools/` and the CI workflows |
| The London-time helper module and the ESLint rule banning bare `toLocale*String` | Read `packages/shared` and the ESLint config |
| How migrations deploy to production, and in what order against the Worker | Read the CI and deploy workflows |

**Already known from `docs/delivery/`** (read these; they outrank this brief):

- `runbooks/entries-admin.md`: roles are granted at `/admin/people/`, and **everything
  under `/admin/` answers 404** to anybody who may not be there. The photo roles follow
  that.
- `runbooks/entries-email.md`: email goes through an **outbox** drained by a five-minute
  cron, with a queue and daily-cap figures at `/admin/emails/`.
- `runbooks/membership-keys.md`: **Resend allows 100 emails a day, shared with the race.**
- `runbooks/data-requests.md`: how the club answers a request about somebody's data. A
  photo takedown request is a new shape for that runbook.
- `runbooks/timing-race-night.md`: results are published by the timing app, and finishing
  a race is not publishing it.
- `nn-2026-privacy-notice-DRAFT.md`, section 8 "Photographs", marked **decision 4**: where
  the photography wording goes. It is Mark's and the committee's to settle; don't write it.

**Settled in slice 1's pre-flight, 20 October 2026.** There is one platform Supabase
project, with the website and timing kept apart by schema: see "One database" in
`docs/architecture/principles.md`, and ADR-034 and ADR-035. `photos` will be its own schema
in that project, beside `entries` and `timing`. Slice 2 settles the details.
`src-race-timing` is the old timing platform and is not touched. The Worker reads entry
email addresses from `entries` only when sending links.

---

## 7. How it fits together

```
Drive folders ──copy──▶ laptop: photos tag ──▶ photos review ──▶ photos upload
                                   │            (clock fixes)        │
                             vision model                ┌──────────┴──────────┐
                           (medium copy only)       R2: src-race-photos    SQL file
                                                     nn-2026/<id>/*.jpg   (every read)
                                                           │          Supabase editor
Website (after the freeze)                                 │                   │
  /admin/photos/check/  the team checks the unsure reads ──┼───────▶ photos schema
  /admin/photos/  publish · send links · take down ────────┘
  Worker queues each runner's private link in the outbox (100 a day, shared with the race)
  /nn/2026/photos/p/<token>/  ──▶ Worker checks link hash ──▶ lists photos ──▶ images from R2
  /nn/2026/photos/            ──▶ lost-link form ──▶ fresh link to the entry address
```

---

## 8. Data model (a proposal; settle the details in slice 2)

Schema `photos`, in the project agreed in §6. RLS on every table; no table grants to anon.

| Table | Columns (indicative) | Notes |
| --- | --- | --- |
| `event` | `slug` (`nn-2026`), `published_at`, `links_sent_at` | One row per event; publishing is one flag |
| `photo` | `id` uuid, `short_id` (`NN26-0412`), `event_slug`, `photographer` (credit name), `spot`, `taken_at` UTC, `burst_id`, `check_state`, `held_by`, `held_until`, `hidden_at` | `id` is random and is the R2 key; `short_id` is for people; the hold stops two checkers getting the same photo; short_id never changes once given, but burst_id is worked out again on every upload and the SQL overwrites it |
| `photo_bib` | `photo_id`, `bib_text` (`123` or `12?`), `confidence`, `confirmed` boolean, `source` (`model` or `person`), `decided_by`, `decided_at` | Several rows per photo; part-read rows keep the `?`; `decided_by` is the checker's user id, so a decision can be undone |
| `photo_link` | `token_hash` (SHA-256 hex), `event_slug`, `bib`, `created_at`, `replaced_at` | One active link per bib per event; no email, no name |

Functions (security definer, locked `search_path`, execute granted only to the role the
Worker uses):

- **Photos for a link**: takes a token hash; returns nothing unless the link is active and
  the event is published. Returns the bib's confirmed photos, not hidden, plus part-read
  photos whose pattern fits the bib, flagged as such.
- **Photos for a spot**: same link check; returns published, unhidden photos for one spot.
  Built only if Mark agrees runners may browse spots (§15).
- **Published check for images**: whether a photo may be served at all.
- **Next photo to check**: for a signed-in photo-checker, holds and returns the next
  unsure photo nobody else holds, or whose hold has expired.
- **Record a decision**: confirm, correct, keep part-read, no bib, skip or hide; writes
  `decided_by` and releases the hold. Calling it twice with the same decision changes
  nothing.
- Writes (decisions, create or replace a link, publish, hide) are callable only through
  the admin paths, by the right role.

The tool's SQL file inserts `photo` and `photo_bib` rows for **every read, checked or not**,
with `confirmed` set only where the read was confident or checked on the laptop. It is
wrapped in a transaction and is **idempotent**: running it twice leaves the same rows, and
it never overwrites a decision already made on the website (`on conflict` on `id` and on
`photo_id, bib_text`, keeping existing `decided_by` rows).

---

## 9. The laptop tool

Python, in the repo where `tools/` conventions say *(verify)*, say `tools/photos/`. Standard
library first; Pillow for images; one HTTP client for the vision model; boto3 or the
standard library for R2's S3 API (ask before choosing). Pinned requirements, a virtual
environment, and a README a third volunteer could follow.

**Work folder and config live outside the repo**, for example `~/nn-photos/`: copies,
the manifest and a `config.toml` with the R2 token and vision key. The tool refuses to run
if its work folder is inside the git repository.

### Inputs

- One folder per photographer, copied from Drive.
- `photographers.csv`: folder name, credit name, spot. Spots are data (`Start`,
  `On the course`, `Finish` in the mockups).
- `bibs.csv`: **one column, `bib`, and nothing else.** If the file has any other column,
  refuse and say why: names and emails must not reach the laptop tool.

### `photos tag`

1. Walk the folders for `.jpg` and `.jpeg`. List anything skipped, such as RAW files.
2. Fingerprint each file (SHA-256). A file already in the manifest is skipped, so reruns
   add nothing.
3. Read `DateTimeOriginal` (and sub-seconds), plus the camera's body serial number. The
   serial is used **only** to group photos by camera for the clock fix. It is never
   uploaded or written to SQL.
4. Apply the EXIF orientation, then write the three copies with **no EXIF at all**. Keep an
   sRGB colour profile if present. Report actual file sizes; the targets are about 1 MB,
   300 KB and 50 KB.
5. Group bursts: consecutive photos from one camera within 2 seconds share a `burst_id`.
6. Send the **medium copy only** to the vision model. Ask for the digits on any race bibs,
   with `?` for a digit it can't read, and a confidence for each. Ask for nothing about
   the people. Expect strict JSON; anything that doesn't parse goes to review, never a
   crash and never a guess.
7. Check each read against `bibs.csv`. A confident, exact match is tagged. A read with `?`
   is part-read; store the pattern and the bibs that fit. A read that isn't a real bib, or
   is below the confidence threshold, goes to review. The threshold is a flag, set after
   the first real run.
8. Save progress to the manifest (SQLite in the work folder) after every photo, so an
   interrupted run carries on where it stopped.

### `photos review`

A local page served on **127.0.0.1 only**, by the standard library's HTTP server. Plain
HTML, CSS and a little JavaScript; no framework. It uses the brand's colours, with system
fonts only, and nothing on the page loads from the internet: the values are in
[`platform/packages/shared/styles/tokens.css`](../../platform/packages/shared/styles/tokens.css),
what shipped is in [`docs/foundations/brand.md`](../foundations/brand.md), and the
guidelines are in
[`docs/foundations/race-timing-brand-guidelines.md`](../foundations/race-timing-brand-guidelines.md).
Fixing the camera clocks here is required before upload. The check screen is optional, for
working offline; the team's main checking happens on the website (§10). Three screens, as
in the mockups:

1. **Start:** counts per step, a table of photographers, and the next action.
2. **Fix camera clocks:** for each camera, show its first photo (the photographer is
   briefed to photograph a phone clock) beside the time the camera recorded. A person
   types the phone's time, and every photo from that camera shifts by the difference. The
   shift is applied before converting the wall-clock time, read as `Europe/London`, to
   UTC.
3. **Check tags:** one photo at a time, large. Keys: Enter confirms the guess; a number
   key picks one of the bibs that fit; typing a number corrects it; U keeps it part-read;
   N means no bib visible; S skips; H hides. Offer to apply a confirmed bib to the rest of
   its burst. Every key has a visible, labelled button too.

### `photos upload`

1. Upload each copy to `nn-2026/<photo id>/{full,medium,thumb}.jpg` through R2's S3 API,
   using the EU-jurisdiction endpoint, with content type `image/jpeg` and a checksum R2
   verifies. Skip what the manifest says is already uploaded.
2. Write the SQL file(s) for §8, split into pieces the Supabase editor accepts *(verify the
   size)*.
3. Print what to do next: run the SQL, then revoke the token.

Never print a key. Never upload a hidden photo.

---

## 10. Website parts

All in `apps/main`, after the freeze lifts. Follow the existing patterns: a static Astro
shell, filled in by the Worker with `HTMLRewriter`; POST/Redirect/GET for forms;
`trailingSlash: 'always'` *(verify)*.

**Look and feel.** Every page follows the club's brand: the values in
[`platform/packages/shared/styles/tokens.css`](../../platform/packages/shared/styles/tokens.css),
what shipped in [`docs/foundations/brand.md`](../foundations/brand.md), and the guidelines
in
[`docs/foundations/race-timing-brand-guidelines.md`](../foundations/race-timing-brand-guidelines.md),
through the layouts and tokens the NN 2026 and admin pages already use (verify which). No new colours, fonts or components where
an existing one fits. Runner pages (email, private page, one photo, lost link, results
banner) look like the NN 2026 race page: Nosifer only for the race title, as the race page
uses it; Inter for text; JetBrains Mono with tabular figures for bibs, times and photo IDs.
The check and admin pages look like the existing admin, with no Nosifer. Not the new
club-website look (Direction A, #209D50). The design canvas "NN 2026 race photos" is the
visual reference; where it and the repo's components differ, the components win and you
tell me.

**Roles.** photo-checker and photo-admin are new rows in the role list at /admin/people/,
in the Nightingale Nightmare group, each a bundle of permissions that code checks
(ADR-017), named in the house pattern (verify). Both are staff roles, so /admin/ opens for
them and shows a Race photos card (verify how cards appear). Neither carries any nn-admin
permission: checkers see photos and bibs, never entries. super-admin holds neither, so
Bindal grants both to himself like anyone else.

| Route | What it does |
| --- | --- |
| `GET /nn/2026/photos/` | Lost-link form: "The email you entered with". Before publishing, says photos aren't up yet |
| `POST /nn/2026/photos/` | Always the same response, whether or not the address entered, so it can't be used to check who ran. If it matches, replace that runner's link and email the new one. Rate-limited (ask how) |
| `GET /nn/2026/photos/p/<token>/` | The runner's private page: first name, bib, finish time, their photos, "Could be you", look through a spot |
| `GET /nn/2026/photos/p/<token>/<short id>/` | One photo: large image, spot, time, credit, short ID, download, removal link |
| `GET /nn/2026/photos/img/<photo id>/<size>.jpg` | Image from R2. Nothing is served before the event is published or once a photo is hidden. ETag and 304; cached for an hour; `?download=1` sets a filename like `NN26-0412.jpg` |
| `/admin/photos/check/` | The shared check queue, as in the mockups: one photo at a time, large, with the bibs that fit as numbered buttons. Same keys as the laptop page, plus big tap targets for tablets and phones. Photo-checker role |
| `/admin/photos/check/img/<photo id>/<size>.jpg` | Admin-only image route: serves unpublished photos to photo-checkers and nobody else |
| `/admin/photos/` | Progress; publish (photo-admin, only once nothing is left to check); send the private links (photo-admin); take a photo down by short ID (photo-checker or photo-admin: deletes its three R2 objects in one call and sets `hidden_at`) |

**The results banner** goes on the published results page, `/nn/<year>/results/`, which
`apps/main` serves. It is in this repository and it is slice 4's.

**Private pages** send `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`
and `X-Robots-Tag: noindex`, so the token doesn't leak into shared caches, other sites'
logs or search engines. An unknown or replaced link gets a friendly page offering a new
link, never a 500.

**Sending links** is idempotent: it records which runners were sent a link and never sends
twice unless asked. It reads addresses from where entries live, at send time, and copies
none of them into the `photos` schema. **It goes through the existing outbox, never
straight to Resend.** At 100 emails a day shared with the race, about 244 runners take
about three days, unless Mark raises the Resend plan; the admin page shows how many are
queued and sent, and the lost-link email must still get through while the queue drains
(ask how the outbox prioritises). In tests, email goes to a fake sender, never Resend.

**Draft copy**, for Kayleigh to sign off:

- Email subject: "Your Nightingale Nightmare photos are ready". Body: "We found you in
  [n] photos from Sunday's race." / "This link is just for you, so there's no password.
  Forward this email to anyone you'd like to see them." / "Not keen on one of them? Reply
  with the photo ID shown under it and we'll take it down."
- Lost-link confirmation: "If that address entered Nightingale Nightmare 2026, a new link
  is on its way. It can take a few minutes, so check your junk folder too."
- Part-read section: "Could be you. We could only read part of the number on these, and
  what we read fits bib [bib]."

---

## 11. R2 setup: the account holder does this, not you

Write these into a new runbook, `docs/delivery/runbooks/race-photos.md`, in the house style
of `cloudflare-setup.md`, and add it to the runbooks `README.md` table. Do not run them.

1. Switch R2 on for the club's Cloudflare account.
2. `wrangler r2 bucket create src-race-photos --jurisdiction=eu` (the jurisdiction can't be
   changed later).
3. Leave public access off: no `r2.dev` address, no custom domain.
4. `wrangler r2 bucket lifecycle add src-race-photos --name=nn-2026-retention
   --prefix=nn-2026/ --expire-date=<retention date> --jurisdiction=eu`
5. Bind it in `apps/main/wrangler.jsonc` under `env.production`, with `"binding":
   "PHOTOS"`, `"bucket_name": "src-race-photos"`, `"jurisdiction": "eu"`, plus a local
   entry for development. **This part is yours, in slice 3.**
6. Create an R2 API token: Object Read & Write, this bucket only. It goes into the laptop
   tool's config file and is revoked after each upload.

---

## 12. Slices

### Slice 1: the laptop tool (start now; touches nothing frozen)

- **In:** `photos tag`, `photos review`, the manifest, `photos upload --dry-run` (writes the
  R2 key layout to a local folder instead of R2), the fake vision reader, tests, README,
  ADRs for decisions 1–3.
- **Out:** any migration, any web route, any Cloudflare or Supabase call, the real vision
  adapter (until I name the provider), the SQL file (it depends on slice 2's schema).
- **Done when:** a folder of synthetic photos goes through tag, review and dry-run upload;
  the copies carry no EXIF; reruns add nothing; the review page is keyboard-operable.

### Slice 2: schema and real upload (from 2 November, after race week)

- **In:** the §6 decision on the project, the `photos` migration and functions, the SQL
  file writer, real R2 upload, the R2 runbook (§11), ADRs for decisions 4–6.
- **Done when:** the SQL file applies cleanly to a local database twice with the same
  result, and anon can't touch any `photos` table.

### Slice 3: the shared check page (from 2 November)

- **In:** the photo-checker and photo-admin roles in the existing people and roles setup,
  `/admin/photos/check/` with holds and decisions, the admin-only image route, the R2
  binding, the progress view, publish and take down on `/admin/photos/`, a "photo of me"
  shape in `runbooks/data-requests.md`, ADRs for decisions 11–12.
- **Done when:** two checkers working at once never get the same photo; an expired hold
  frees its photo; every decision records who made it; publish refuses while anything is
  left to check; nobody without the role sees an unpublished photo.

### Slice 4: runner pages and images (from 2 November)

- **In:** the runners' image route, the private page, the one-photo page, look through a
  spot (if agreed), the banner on `/nn/2026/results/`, ADR for decisions 7–8.
- **Done when:** with seeded data, a valid link shows the right photos without JavaScript,
  an invalid one shows the friendly page, and no image is served before publishing.

### Slice 5: links, emails and lost links (from 2 November)

- **In:** send the private links from `/admin/photos/`, the lost-link form, both emails,
  ADR for decision 9.
- **Done when:** sending is idempotent and role-gated, goes through the outbox and keeps to
  the daily cap, the lost-link form answers the same either way, and no test sends a real
  email.

---

## 13. Tests

**Slice 1**, in whatever runner `tools/` already uses *(verify; propose pytest only if
nothing exists)*, with fixtures generated by the tests:

- A JPEG with fake GPS, a camera serial and orientation 6 comes out upright with no EXIF.
- Running `tag` twice on the same folder adds nothing.
- Clock maths: a camera left on BST shows 1 hour ahead on 1 November; one phone-clock
  correction fixes every photo from that camera, and only that camera.
- Part-read matching: `12?` against a bib list returns exactly the bibs that fit.
- Malformed model output goes to review; it never crashes the run or tags a bib.
- `bibs.csv` with an extra column is refused.
- The review server listens on 127.0.0.1 and nothing else.

**Slice 2**, database tests asserting error codes, not just failure:

- Anon can't select, insert, update or delete any `photos` table.
- A valid link on a published event returns that bib's photos and fitting part-reads; an
  unpublished event, a replaced link or an unknown hash returns nothing; hidden photos
  never appear.
- The tool's SQL file is idempotent.
- The real upload is tested against a local stand-in for R2's S3 API, never the real
  bucket. Ask before adding a dependency for it.

**Slice 3**, database and Worker tests:

- Two checkers asking for the next photo at the same moment get different photos.
- A hold past 10 minutes is released to the next checker.
- A decision records `decided_by`; repeating it changes nothing; undoing it restores the
  previous state.
- The check page and its image route answer 404 without the photo-checker role, as
  everything under `/admin/` does; publish answers 404 without photo-admin, and refuses
  while anything is left to check.
- A tag written on the website survives the laptop's SQL file being run again.

**Slices 4 and 5**, Worker tests (Miniflare, in-memory R2) and Playwright:

- The image route: 404 before publishing, 200 after, 304 on a matching ETag, the
  download filename, 404 once hidden.
- Private pages carry the three headers; an invalid token never yields a 500.
- No-JavaScript journeys for the private page, one photo and the lost-link form; zero axe
  violations; operable at 320 px.
- Admin actions answer 404 without the role; send-links run twice queues nothing new;
  takedown deletes all three objects; links are queued in the outbox, never sent directly.
- The lost-link response is identical for a known and an unknown address.

---

## 14. Traps

- **EXIF orientation:** strip EXIF without applying orientation first and portrait photos
  come out sideways.
- **EXIF time has no timezone.** It's a bare wall-clock reading. Correct the camera offset
  first, then read it as `Europe/London`, then convert to UTC.
- **The Cache API only clears one data centre.** A hidden photo can stay cached for up to
  the hour; that's accepted. Don't promise instant removal in copy.
- **Every request passes through the Worker** (`run_worker_first`) *(verify)*, so every
  image view is a Worker request. On the free Workers plan the whole site shares 100,000 a
  day. Load thumbnails lazily.
- **A token in the URL leaks** through Referer headers, shared caches and analytics unless
  the private-page headers are set. Don't add analytics to these pages.
- **`trailingSlash: 'always'`**: `/nn/2026/photos` and `/nn/2026/photos/` must not be two
  answers.
- **The Prettier space trap**: a bare `{expression}` moved onto its own line collapses a
  typed space; `{' '}` survives.
- **No face libraries, ever**, not even "just to crop runners". Cropping isn't needed.

---

## 15. Open questions, and who answers

| Question | Owner | Blocks |
| --- | --- | --- |
| Which vision model provider, and whose account pays | Treasurer, me | Slice 1's real adapter |
| Which Supabase project holds the `photos` schema. **Answered 20 October 2026:** its own schema in the one platform project, never `src-race-timing` | Me | Nothing; slice 2 settles the details |
| Where the bib list comes from, as bib numbers only | Me, Mark | First real run |
| Photography wording in the privacy notice | Mark | Publishing |
| Emailing every runner a private link | Mark | Slice 5 sending |
| No public bib search for 2026 | Mark | Slice 4 |
| Whether link holders may look through a spot | Mark | Slice 4 spot pages |
| First name on the private page | Mark | Slice 4 |
| Removal address and retention period | Mark, committee | Copy, lifecycle rule |
| Which Workers plan the club is on | Mark | Launch |
| Send the links over about three days at Resend's 100 a day, or raise the plan | Mark, treasurer | Slice 5 |
| Where NN 2026 results are published. **Answered 20 October 2026:** `/nn/<year>/results/` in `apps/main` | Me | Nothing; the banner is slice 4's |

---

## 16. Session prompts

Paste one per session, in order (slices 1 and 2 above are unchanged). Each assumes this brief is committed at
`docs/delivery/nn-photos-brief.md`.

### Slice 1

```
Slice 1 of the NN 2026 race photos feature: the laptop tagging tool.

Read docs/delivery/nn-photos-brief.md in full first, then CLAUDE.md. The brief is the
source of truth; where it and the repo disagree, stop and tell me.

Branch nn-photos-laptop-tool off a clean, up-to-date main.

Pre-flight, before any code:
1. git log --oneline for tools/ and anything else you will touch.
2. Answer the §6 rows about tools/, Python in CI and the London-time helpers, with file
   paths as evidence.
3. Confirm the next free ADR number in docs/architecture/decisions/.

Then halt and give me: what you'll build and where, the files you'll create, your test
plan, and any §15 question that blocks you. Wait for my go.

Scope is §12 slice 1 only. No migrations, no web routes, no Cloudflare or Supabase calls,
no real vision provider: build against the fake reader. One concern per commit. Halt
before pushing so I can review the diff; I'll run the checks myself.
```

### Slice 2

```
Slice 2 of the NN 2026 race photos feature: the photos schema and the real upload.

Read docs/delivery/nn-photos-brief.md in full first, then CLAUDE.md. Slice 1 is merged.

Branch nn-photos-schema off a clean, up-to-date main.

Pre-flight, before any code:
1. Supabase MCP: list_projects, show me the list, and wait for me to confirm which
   project before any other MCP call.
2. Answer every §6 row with evidence, and recommend the project for the photos schema.
3. git log --oneline for packages/db and tools/photos.

Then halt with: the migration in full, the functions, the SQL file format, and the R2
runbook from §11. Wait for my go.

apply_migration only, never db push. Do not create buckets or tokens. Halt before pushing.
```

### Slice 3

```
Slice 3 of the NN 2026 race photos feature: the shared check page.

Read docs/delivery/nn-photos-brief.md in full first, then CLAUDE.md. Slices 1 and 2 are
merged, and the race freeze on /admin/** has lifted.

Branch nn-photos-check-page off a clean, up-to-date main.

Pre-flight: read how admin pages are gated by role today and the state of the people and
roles work; git log --oneline for apps/main/worker, apps/main/src/pages/admin and
wrangler.jsonc; read the Miniflare test configs. Then halt with your plan for the two
roles, the check queue with holds and decisions, the admin-only image route, the R2
binding, publish and take down, and the tests in §13. Wait for my go.

No runner pages, no emails and no lost-link form in this slice. Zero axe violations; the
check screen must work by keyboard and by touch. Halt before pushing.
```

### Slice 4

```
Slice 4 of the NN 2026 race photos feature: runner pages and images.

Read docs/delivery/nn-photos-brief.md in full first, then CLAUDE.md. Slices 1 to 3 are
merged, and the race freeze on /nn/** has lifted.

Branch nn-photos-runner-pages off a clean, up-to-date main.

Pre-flight: git log --oneline for apps/main/worker and apps/main/src/pages/nn; read the
existing race page's static-shell-plus-HTMLRewriter pattern. Then halt with your plan for
the private page, the one-photo page, the runners' image route, the spot pages (if
agreed), the results banner and the tests in §13. Wait for my go.

No emails and no lost-link form in this slice; those are slice 5. No-JS first, zero axe
violations. Halt before pushing.
```

### Slice 5

```
Slice 5 of the NN 2026 race photos feature: private links, emails and lost links.

Read docs/delivery/nn-photos-brief.md in full first, then CLAUDE.md. Slices 1 to 4 are
merged.

Branch nn-photos-links-emails off a clean, up-to-date main.

Pre-flight: read runbooks/entries-email.md and the outbox code, how the Worker reaches the
entries project, and runbooks/membership-keys.md on the daily cap. Report the From and
Reply-To in use, and how the outbox orders and caps sends. Then halt with your plan. Wait
for my go.

No email to a real runner from any environment; tests use a fake sender. Sending is
idempotent and photo-admin only. Halt before pushing.
```

---

## 17. How to answer, every session

1. Pre-flight findings first, with evidence. Then the plan. Then halt.
2. After my go: implement in small commits, one concern each.
3. Before pushing: summarise the diff, list what you ran and what you didn't, name any
   assumption you made, and draft the pull request title and description. Halt.
