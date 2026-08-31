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
  `entries.events.minimum_age`. **The 2026 ARC permit number is confirmed and published** —
  **`ARC/26/0842`**, issued 27 August 2026 — and it lives in `race.json`'s `permit`, never in
  markup. ARC require it on entry forms and advertising material, so it is quoted **three
  times**: the facts list on `/nn/2026/`, the foot of the entry form, and — since #142 —
  `/nn/2026/terms/`, where it is part of the race director's own copy. The first two are the
  two ARC ask for. It is **year-scoped like the date** and may not appear on `/nn/` or
  `/nn/privacy/`. **`site.spec.ts` asserts that only for `/nn/`**, not for `/nn/privacy/` —
  the rule is real and the guard is narrower than it reads. Note also that
  `/nn/privacy/` says the words *"ARC permit"* in prose, deliberately, so it is the *number*
  that is year-scoped rather than the phrase. The 2023 number is still not a substitute for any future year's. **Still
  unconfirmed, and it may not appear anywhere:** the 2026 race director's name. **The
  transfer deadline is confirmed** — **3pm on 16th October** — supplied by the race director
  on 28 August 2026 with the entry terms, and it lives in `race.json`'s `transferDeadline`,
  read only by `/nn/2026/terms/`. It is a *date*, not a mechanism: `transfer_entry()`
  enforces nothing about it, and no code anywhere reads it.
  **The entry window is ratified now** — agreed by the committee over
  WhatsApp on **Monday 24 August 2026**, the same day the race director proposed it —
  **opens Tuesday 1 September 2026
  07:00 BST, closes Friday 30 October 2026 17:00 GMT** — and it is published on `/nn/2026/`
  from `race.json`'s `entriesOpen`. The clocks go back between the two, so they do **not**
  share a UTC offset: 06:00Z and 17:00Z. **Ratifying the window is not opening it, and the two
  halves are in different states on purpose.** `entries_close_at` is applied and is inert on
  its own — `entry_state()` tests `entries_open_at is null` as an explicit branch before it
  compares anything, so a null open date means *never opens* rather than *no lower bound*.
  **`entries_open_at` is still null, and it is still the switch**: a date in it starts selling
  250 places unattended, and it is gated on the live Stripe keys being in, the webhook
  digest having been verified by a real signed event, and — since #178 — **`ENTRIES_ENTRY_KEY`
  being installed and verified first**, because opening the window before that is opening it
  unprotected. None has happened; the entries-open
  runbook owns that moment and carries the single `update`. So the *times* are quotable
  anywhere; the *column* is a stop-and-ask. Do not invent a fact, do not infer one from a phase
  document, and do not put a plausible placeholder in markup.
- **Collecting a field beyond what is already specified.** Adding a database column that
  holds personal data is a committee decision. The committee has settled the *entry* field
  list — it is `packages/shared/src/nn-entry.ts` — and **the fifteenth was taken on 28 August
  2026**: `gender_identity`, optional free text, in
  [ADR-020](docs/architecture/decisions/adr-020-race-category-and-gender-are-two-questions.md).
  A sixteenth is a new decision. **Race category and gender are two questions now**, and the
  split is the decision rather than a wording change: `gender` is the closed list of three the
  club awards prizes in and publishes results by — labelled **"Race category"** on the form —
  and `gender_identity` beside it is the open question, on no list, that nothing derives,
  groups, sorts or publishes by. **Widening `gender` is a decision about prize lists**, because
  every value past `female` and `male` is a category with no band to receive it; the
  non-binary gap is still open and `ageCategoryFor()` still answers
  `gender-has-no-categories`. `gender_identity` is on `/admin/nn/` and **nowhere else** — not
  the start list, not the three exports, never published — and `admin.spec.ts` asserts that
  absence against a *paid* fixture, which is the only kind an export carries. **The sixteenth
  was taken on 28 August 2026 and it is a person rather than a field**: a visually impaired
  runner may declare so and enter their **guide** on the same entry —
  [ADR-022](docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md). The
  declaration is a `vi` **consent** rather than a column, because it is data about disability
  and Article 9 puts it on the medical note's footing; the guide is a second row in
  `entries.entrants` with `role = 'guide'`, and they **take one of the 250**, which is what the
  club actually needed and is why nothing is reserved. A guide pays nothing, is in no prize
  category, is **excluded from the affiliated export** — because they pay nothing, so counting
  them would overstate how many affiliated entries were sold — and is **marked on the start
  list**. (Nobody carries an England Athletics number any more; see the entry below.) The `vi`
  declaration itself is rendered **nowhere** — no
  read returns a purchase's `consents`, so it is stored as the lawful basis for holding the
  guide's data and never as a fact on a screen; what a volunteer sees is the guide's row, which
  is the operational fact anyway. **Amended 28 August 2026**, and both halves are decisions: a
  guide is asked for their **own email address** — `entrants.email`, the seventeenth field,
  because a runner is reachable through the address that paid and a guide has no purchase of
  their own — and is **not** asked their race category, because a guide is in none. So
  `entrants.gender` is nullable behind `entrants_gender_unless_guide`, which permits that for a
  guide and for nothing else, and a runner without one is refused as loudly as ever. **The VI
  guide entry type is off the form**; the `vi_guide` fee row survives as the backstop's
  subject. **The eighteenth was taken on 30 August 2026 and it is the runner's own phone
  number** — [ADR-025](docs/architecture/decisions/adr-025-the-club-asks-a-runner-for-a-phone-number.md)
  and [decision 008](docs/decisions/decision-log.md#008--ask-a-runner-for-a-phone-number-and-make-the-race-notice-say-what-is-actually-held),
  argued in #168. It exists because `/nn/privacy/` claimed a phone number the club did not hold:
  what `entrants` held was `emergency_contact_phone`, **somebody else's** number given for one
  thing, and ringing it because the start moved by twenty minutes is not that thing. The stated
  purpose is telling a runner about a change to the race. **A guide is not asked** — they give
  their own email address and their own emergency contact already. **Required of a runner in two
  layers and in a check constraint in neither**: `parseNnEntry` refuses a blank box and
  `create_pending_purchase()` refuses a payload with `phone_required`, while
  `entrants.phone` is nullable behind `entrants_phone_shaped`, which only says what may be
  *held*. A `role = 'guide' or phone is not null` constraint is the obvious shape and it would
  refuse the transfer and the given place the **deployed** Worker is making, which is what
  expand-migrate-contract forbids — so `transfer_entry()` and `create_manual_entry()` both take
  a null. `transfer_entry()` gained an **eleventh** argument rather than a tenth, because a
  tenth `text` is already ADR-023's England Athletics form and `create or replace` cannot rename
  a parameter; its wrappers delegate with a null phone, which **clears** the previous runner's
  number rather than carrying it across. It is on `/admin/nn/entry/`, the printed start list, the
  start-list CSV and the affiliated export, and **not** on the entries table or the medical
  sheet. **A nineteenth field is a new decision.**
- **One field has come off the list, which had never happened before — the England Athletics
  number, on 29 August 2026.** The club asks for none and holds none: a runner states that they
  are affiliated and the club takes their word for it —
  [decision 007](docs/decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers)
  and [ADR-023](docs/architecture/decisions/adr-023-no-england-athletics-numbers.md). **The
  £18/£20 split and the £2 levy are untouched**; only the number stopped being asked for. Under
  ARC Rule 21(2)(b) the club has no record of *who* claimed affiliation, only that they paid the
  affiliated £18 — put to the committee and accepted — and what replaces the check is a sentence
  reserving the club's right to ask somebody to produce their number or other evidence of
  affiliation. **That sentence is required on both privacy notices and it is on one.** Decision
  007 makes it a requirement of the decision rather than a nicety, and `/nn/privacy/`'s own header
  names ADR-023 as asking for both — but it has been on `/privacy/` only since **30 August 2026**,
  when the club asked for `/nn/privacy/` to be the committee's document word for word and
  everything the club had added to it came out. **That is an open gap rather than a settled
  state**, and closing it means new wording from the committee rather than an edit here.
  **Which fee is the affiliated price is
  `entries.fees.affiliated` now**, a column that says only that; `requires_ea_number` was
  carrying both facts and is false everywhere behind `fees_ea_number_not_collected`.
  `entrants.ea_number` is null everywhere behind `entrants_ea_number_not_collected`. **Both
  columns are still there and that is the expand step** — the deployed Worker parses those keys
  as required, so dropping them mid-deploy would take `/admin/nn/` down. **The contract step is
  owed**, and it is
  [the contract runbook](docs/delivery/runbooks/entries-ea-number-contract.md). **Asking for a
  number again is a new decision**, not a revert.
- **`/nn/privacy/` was the committee's document word for word for part of one day, and the club
  maintains it now.** **Rewritten on 30 August 2026**, when the club asked for that document to be
  published verbatim; until then the page merged it with the notice it replaced. **Later the same
  day the club took edits to it itself** — #168 and
  [ADR-025](docs/architecture/decisions/adr-025-the-club-asks-a-runner-for-a-phone-number.md) —
  because the collection list claimed a **postal address** and an **expected finish time** that
  nobody is asked for, and omitted the medical box, the visually impaired declaration, gender
  identity and the guide entirely, which are four things it holds and two of which are Article 9.
  The document was contradicting itself about the health data: it names health and safety as a
  basis and medical services as a party it shares with.
  ⚠️ **What that permits is items inserted into and removed from the collection list and
  nothing else.** No sentence on that page may be rewritten, restyled, reordered or "improved",
  and no section may be added; the structure, headings and capitalisation are the committee's.
  Anything beyond insertion and deletion of list items still goes back to them and returns as new
  wording — which is why **the affiliation sentence decision 007 asks for is still not there**.
  **It renders no "To be confirmed by the club" marker at all now** — `nn-privacy.spec.ts` has
  `OPEN_DECISIONS = 0`, and it is `/privacy/`, the club's own notice, that still carries the two
  the marker is for: how long an account is kept, and whether deleting one deletes a race entry.
  **Four values are interpolated from `race.json`** — the controller, the company number, the
  contact address and the date — because `/privacy/` reads the same four and the two notices may
  never disagree about who the controller is; each renders the document's own words. **What came
  out on 30 August is load-bearing elsewhere**, so the page's own header comment records it: no
  medical-note retention period, no medical box, visually impaired declaration or guide by name,
  no named processors, no registered office, and **no schema-derived list of what the entry tables
  hold** — the fee and amount, Stripe's references, the consents with their version and the
  timestamps are all off the page. **One open decision survives and is published nowhere:**
  whether an email address is kept to tell people about next year's race, still `null` in
  `race.json`'s `emailRetention`, which nothing reads. `entryRetention` is settled prose that
  nothing reads either, the `photographs` key is gone, and `medicalRetention` is kept only for
  `entries-retention.test.ts`.
- **Taking payment and confirming it are both connected, and neither is a stop-and-ask any
  more.** A valid entry holds a place and goes to Stripe Checkout; the webhook at
  `POST /nn/stripe-webhook` is what moves a purchase to `paid`, and it is the only thing that
  may. **Four Worker secrets** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `ENTRIES_WEBHOOK_KEY` and, since #178, `ENTRIES_ENTRY_KEY` without which no place can be held
  at all — never in this repository, never in `wrangler.jsonc`, never in a `vars`
  block. A real key on a machine belongs in `apps/main/.dev.vars`, which is gitignored.
  **Registering the Stripe dashboard endpoint is still a human's job**, and it is step 5 of
  the manual steps in `apps/main/README.md` (test-mode order; the live-key swap, step 15, is
  the one that is last before entries open) because it needs the production URL.
- **Granting the anon role anything on a table, or adding a function it may execute.** The
  fifteen it may call are named, exactly, in `packages/db/tests/entries.test.ts` — **the count
  has already changed once** (it was thirteen before the outbox's two drain functions were
  added), which is the argument for reading the test rather than trusting a number in prose —
  and that list is there to make a sixteenth a decision somebody takes in a diff rather than a
  side effect. **Reading people is settled** — the admin surface is
  [ADR-013](docs/architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) and its
  amendment: originally a Worker secret plus a key per person, and **since #57 and #58 the
  `nn-admin` role**, checked by `identity.has_permission()` since #107 and by
  `identity.has_role()` before it. Sixteen functions are granted to `authenticated` now, and
  `entries.test.ts` names them with the argument for each. **Cancelling an entry is settled and
  nothing else about editing one is.** Somebody holding `nn.entry.cancel` — which `nn-admin`
  carries and `super-admin` deliberately does not — may refund one purchase in full, which
  deletes its entrants and returns the place —
  [ADR-018](docs/architecture/decisions/adr-018-cancelling-an-entry.md). **Giving a place away
  is settled too, and it came off this list on 28 August 2026** —
  [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md). Somebody holding
  `nn.entry.create` may assign a **complimentary** place from `/admin/nn/`: a `paid` purchase at
  £0 on a £0 fee, audited, under the same advisory lock, re-checking capacity, the minimum age
  and one-runner-one-place. It is the answer to the two Kinsi places and to the visually
  impaired guide's free place, both of which Stripe refuses to charge for. **Transfers beyond
  the one that exists, corrections, resends and partial refunds are each still a
  stop-and-ask**, and each is a decision about changing a record somebody paid for. **A
  partial refund is not merely undecided — `refundPayment()` cannot make one.**
  `worker/stripe.ts` sends no `amount` on the `POST /v1/refunds` call: omitting it refunds the
  full charge, and the file's own comment calls that "the only refund this platform offers — a
  partial one is a different decision." So `cancel_entry()` always refunds in full or nothing,
  and the `entry_refunded` email reflects only those two states — there is no wording anywhere
  for a partial amount, because the code path that would need it does not exist.
  **`formatPence()` (`packages/shared/src/entry-state.ts`) is the one function meant to render
  money to text**, returning the `£` and the pound-pence formatting together — including
  `'Free'` for zero — rather than a bare number a caller adds a symbol to. **One place re-derives
  it by hand instead of calling it**: `NnEntryForm.astro`'s running-total script, a client
  `<script>` in an Astro island, re-implements the same `£`/`.00`/`'Free'` shape rather than
  importing `formatPence` — behaviourally identical today, tracked as the sixth instance of this
  pattern by [#175](https://github.com/southville-running-club/src-website/issues/175), still
  open. Every *other* `£` anywhere in this repository, checked by grep, is inside a comment; the
  three CSV exports carry an amount as a raw pence integer with no symbol; no SQL renders money
  to text. A template that writes its own `£` beside a call to `formatPence()` doubles it —
  `££18.00`, and `£Free` on a given place. The presentation belongs to the one function that
  already produces it — the caller in `NnEntryForm.astro` is the one place that still does not.
- **A sixth role, or an eleventh permission.** Since #107 a role is a bundle of permissions and
  code checks the permission, never a role name —
  [ADR-017](docs/architecture/decisions/adr-017-permissions-are-what-code-checks.md). **The ninth
  and tenth arrived on 29 August 2026 and they are a borrow being paid back**: `nn.email.read`
  and `nn.email.resend`, so `/admin/emails/` stops asking `nn.entry.read` and `nn.entry.cancel`
  about email. Nobody gained or lost anything on the day — `nn-admin` carries all four — and
  what changed is that the two can be granted apart. The five
  roles and the ten permissions are asserted exactly in
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

**`./dev e2e` is the loop; `./dev test` is the gate.** One spec on one engine, seconds rather
than minutes — and it exports the three Supabase variables a scoped Playwright run needs, without
which the fixtures throw `supabaseKey is required` from a file the failing test never mentions.
`nn-entry.spec.ts` and `nn-signup.spec.ts` need `--config=playwright.config.serial.ts`; asked for
without it, Playwright reports **no tests found**, which reads as a pass.

⚠️ **A green Mac does not mean a green CI, and `./dev e2e --linux` is how you find out before
pushing.** Both volunteers are on macOS; CI is Linux, and the font metrics differ — so every
assertion about position, wrapping or overflow can be honestly green on one and red on the other.
It has now cost three separate sessions:

* the radio-focus divergence and the CSV download behaviour, both already in the traps below;
* `element is not stable` across a whole project, which took two wrong hypotheses to place;
* `keeps the entry type that was chosen in view` — **0.1px on a Mac, 214px on the runner.**

`./dev e2e --linux` runs the browsers inside `mcr.microsoft.com/playwright:v1.62.1-noble`, the
image and version CI installs, while the Workers and the database stay on the host and are
reached through `host.docker.internal`. It reproduced that 214px exactly, on a Mac, in twenty-one
seconds. **Use it before pushing anything that touches layout, a stylesheet, or an assertion
about where something is** — and when CI fails something a laptop passed, reach for it first
rather than reasoning about what the runner might be doing.

It is not a replacement for `./dev test`: it runs the browsers only, against a build and a
database the host already has. First run pulls about 2GB; after that it is seconds slower than
the native one.

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

**The race director's copy is transcribed verbatim, and `/nn/2026/terms/` is the strictest
case.** Her prose is already published on `/nn/`, on the two renamed pages and in front of the
entry form, and it keeps her spelling — "10km off road" unhyphenated, "spooktators" lower case,
an ampersand. **The entry terms and race rules go further: nothing on that page may be edited
for style at all.** The capitalisation is inconsistent, the ordinals and the 24-hour clock
disagree with the rest of the site, and one clause slips into the third person mid-sentence.
It stays. That page is the document somebody agrees to be bound by when they tick the box on
`/nn/2026/`, so a tidy-up is a silent amendment to a legal instrument rather than a copy edit —
and `entry_purchases.consents_version` records which wording a person ticked against. Spotted
problems go back to her as a batch and return as new copy with a new version line at the foot
of the page. **The committee has not ratified those terms**, which is why the line reads
"Supplied by the race director" and why two tests assert that no ratification is claimed.

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

**A component whose colours were computed against a surface it does not carry breaks silently
the first time it is moved.** `NnSchedule` was written inside `race-day.astro`'s `.nn-card`, and
every colour in it assumes white: the time is `--nn-blood` at a computed 9.01:1 *on that card*,
and the row divider is `--nn-card-muted`, picked to be an almost-invisible 1.12:1 line *on that
card*. Rendering the same markup on `/nn/2026/`'s gradient inverted both — the divider became the
loudest thing in the block, and the time became `#8f1b0f` on the radial's `#8f1b0f` centre stop.
**1:1 by identity: not hard to read, absent** — and `background-attachment: fixed` means the
block scrolls through the gradient's whole range rather than sitting at one value, so it passes
*through* identity rather than merely near it. Nothing went red, because nothing was looking:
`brand.test.ts` covers the club palette and `admin-contrast.test.ts` covers the admin washes, and
**neither reads `nn-theme.css`** — every ratio in that file's opening table is its author's word,
and one row has already gone stale. The fix is that the component carries its own surface and
gives it back via a `.nn-card` descendant rule where one already exists, so the two call sites
cannot disagree because neither is asked. **A surface variant passed by the call site is the
wrong answer**: a prop the caller has to get right is exactly how this arrived. `NnRaceSummary`'s
`.nn-arrows` is the second instance of the same pattern, still latent — `blood` markers and a
`card-muted` divider, surviving only because both its call sites happen to sit inside cards.
`nn-contrast.test.ts` now resolves both sides of each pairing out of the stylesheet, so a moved
surface recomputes rather than going quietly vacuous. **Compute the pair before writing the
colour**: two of that page's intended colours failed a 7:1 bar and were redesigned before they
shipped, and neither would have been caught by looking, because both looked fine.
**A 320px overflow check that measures straight off `toBeVisible()` is measuring a page with no
CSS on it.** `document.documentElement.scrollWidth > clientWidth` was asserted directly, once, in
eight places, and it failed about one run in three across `nn-signup.spec.ts` and
`nn-entry.spec.ts` — two files, one assertion, and a re-run of the identical build always green.
**DOMContentLoaded waits for scripts, not for `<link rel="stylesheet">`**, so on a page with no
blocking script — every page here in the `no-javascript` project, and the deferred-module case
everywhere else — `readyState` reaches `interactive` with both sheets still in flight. An outcome
block the Worker has revealed is *visible* at that moment, so `toBeVisible()` resolves; and
**reading a layout property is not gated on render-blocking**, so `page.evaluate` then forces a
synchronous layout of a bare document. Caught in the act it reads `overflow=19 client=320
ready=interactive sheets=[]`, with one offender: `a left=8 right=339.13` holding the club's
47-character address, because `a[href^='mailto:'] { overflow-wrap: anywhere }` lives in `base.css`
and `base.css` has not arrived. `left=8` is the browser's default `body { margin }`, which is the
tell — **`sheets=[]` and a left edge of 8 mean the measurement is the defect rather than the
layout.** The styled page does not overflow at any width from 300 to 320, with or without the
fonts. **This repository had already met it and paid for it twice**: `nn-privacy.spec.ts` and
`privacy.spec.ts` each carried a two-pass reload loop naming *"an element laying out at its
intrinsic width before the stylesheet applied, about one run in four"* — the right diagnosis and
a re-run for a fix. All eight go through `apps/main/tests/sideways-scroll.ts` now, which waits
for a **defined state** — every render-blocking stylesheet applied, `document.fonts.status`
settled, and the width unchanged across three samples — and never for the assertion to come
good. **The polling has to be on Playwright's side**: `page.waitForFunction` installs its loop
*in the page*, so with
`javaScriptEnabled: false` it never runs and every call times out at ten seconds, which is how the
first version of this fix failed. `page.evaluate` works there; `requestAnimationFrame` callbacks
do not. The helper names the offending element on failure, which is what turned this from three
runs and an afternoon into four minutes.

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

**Two pull requests merged out of timestamp order stop `db push` dead, and every symptom
points somewhere else.** `supabase db push` refuses to insert a migration *before* one already
applied on the remote, so a branch whose migrations are timestamped earlier than a branch that
merged first takes the whole deploy down — `Found local migration files to be inserted before
the last migration on remote database`, and **nothing is applied at all**, including the dozen
migrations that came after. It happened on 29 August 2026: #134 carried `20260828140000`,
`141000` and `142000`, while #131 and #133 — timestamped `170000` and `190000` — merged first.
Nine migrations were stranded and `deploy-db.yml` failed on every run for six hours.

**What it looks like from the site is not a broken deploy.** The Worker deployed fine, so it
calls functions the database has not got, PostgREST answers `PGRST202`, and every client here
maps a PostgREST error to *"the club's database could not be reached — try again in a moment"*.
Both halves of that are false: the database is healthy, and retrying can never help. What a
volunteer saw was **"That could not be read"** on the transfer form and **"That could not be
recorded just now"** on a runner's own cancellation, on a platform where cancelling still
worked — because `cancel_entry()` predated the break. **The tell is that only the newest
functions fail**, and the place to look is the `deploy-db` workflow rather than the code.
`missingFunctionCause()` in `packages/shared/src/admin.ts` names it now, and both pages say
"the site is ahead of its database" instead of asking somebody to wait for something that will
not arrive. **`--include-all` is what applies the stranded migrations**, and it is safe only
after checking that nothing already applied is re-created by one of them — a migration versioned
earlier but applied later silently reverts whatever a later-versioned one already changed.

⚠️ **Rebasing onto a merged migration means renumbering past it — every time, and whatever the
migration contains.** This happened again on 29 August 2026, in the pull request that added the
paragraph above. Four migrations were rebased onto a branch that had landed `20260829120000`;
three were renumbered past it and the fourth was left at `20260829100000`, on the reasoning that
it clobbered nothing — which was true, and irrelevant. **`db push` refuses on version order
alone**, it refuses the *whole push*, and every deploy after it fails identically until somebody
renumbers. There are two questions and they are not the same one:

  * *Will `db push` accept it?* — is every version later than the remote's newest. Nothing else.
  * *Will applying it revert something?* — does it re-create an object a later-versioned
    migration already changed. This is the one that needs reading the diffs.

Answering the second and skipping the first is what a clean-looking rebase invites, because the
second is the interesting question and the first feels like bookkeeping. **`ls` the migrations
directory after any rebase and check the branch's own files sort last.**

**A restated closed list is a merge conflict git cannot see.** `entries.admin_audit.action`,
`entries.fees.code` and the status checks are widened by `drop constraint if exists` followed by
`add constraint` **restating the whole list** — which is right for reviewability and is a trap
for two branches in flight at once. Both merge cleanly, both pass review, and the one applied
second silently drops whatever the first added. It happened on 28 August 2026:
`entries_complimentary_places` added `create_manual_entry` and `entries_admin_outbox` added
`resend_email`, and after both, giving a place **failed on the audit row it writes before
writing the entry** — the transaction rolled back, so nothing was half-created, but the feature
was dead and the error said nothing about why.
`20260828200000_entries_audit_actions_reunited.sql` is the third statement of that list and
exists only because of this. **Neither earlier migration is wrong and neither may be edited** —
both are applied, and editing an applied migration changes what a fresh `db reset` produces
without changing what any existing database holds. **What caught it was a test that gives a
place and asserts it exists**, not one asserting the constraint's text: a test that restated the
list would have gone stale in exactly the same way. So when you widen one of these, grep for
every other migration that names the same constraint before assuming your list is complete.

**A `case` expression inside a PL/pgSQL `if` condition does not compile, and the error names
the wrong thing.** PL/pgSQL ends an `if` condition at the **first `then` token it meets**, so
`if x <> case when y then 'a' else 'b' end then` is read as the expression `x <> case when y` —
which is incomplete, and Postgres says `syntax error at end of input` while pointing at the
`case`. Nothing in that message mentions `if`, `then`, or the fact that the condition was
truncated, and the statement reads as perfectly ordinary SQL. It cost a full apply-and-bisect
cycle in `20260828140000_entries_discounts_and_guides.sql`, where the whole 800-line migration
failed on one line in the middle of a function body. **Assign it to a variable first** —
`v_expected := case when … end;` then `if x <> v_expected then` — which is what that migration
does and says why. Parenthesising works too, because the scanner tracks paren depth, but the
variable is what a reader can see the reason for. `check_function_bodies` catches this at
`create function` time, so a migration will not deploy half-applied; what it costs is the
minutes spent believing the `case` is wrong.

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

**The account forms have that summary too since 30 August 2026, and it is a second guard on the
same trap.** They always *announced* their errors — `aria-invalid`, `aria-describedby`, a
`role="alert"` — so this was never a zero-violations breach; what was missing is the navigable
list of links. It is `errorSummary()` in `worker/account.ts`, rendered as the **first child of
each form** rather than above it, because `/account/sign-in/` has two forms with separate error
objects and a container's message belongs to that container. `account.spec.ts`'s "lists every
problem and links to the field it is about" runs **without** `@requires-js`, which is the half
that would catch a `@view-transition` here. #152.

**A message that appears on `focusout` can swallow the click that caused it.** The England
Athletics box **is off the form since 29 August 2026** and the rule it cost is not — the next
conditional field re-creates the shape exactly, which is why this stays. It was a `.field`
*inside* the affiliated `.nn-fee` card, so `fieldOf` — which took
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
chosen" is the guard — it asserts that leaving a fee radio produces no message anywhere now
that there is no box to complain — and the rule is the general one: **a container's message
belongs to that container, not to a field nested inside it.**

**A conditional field that collapses moves the control that revealed it.** The same England
Athletics box — likewise gone, likewise still the rule — the same nesting, one layer up: it sat
*inside* the affiliated card, so changing
to another entry type collapsed 277px from **above** the two cards below it. At 320px the card
somebody had just chosen went from y=271 to y=-7 — they tapped it, and the feedback for their
own tap was the page throwing them somewhere else. It is a plain `.field` under all three cards
now, where showing and hiding it moves only what is below and the cards do not move at all:
measured Δ0 in WebKit and Δ1px in Chromium — a pre-existing sub-pixel border swap — across all
48 combinations of engine, width, transition and input method. **Put a conditional field after
the group it is a condition of, rather than inside it.** The adjacency that buys is worth less
than the stability it costs, and the field's own hint can say what the nesting was saying.
`nn-entry.spec.ts`'s "keeps the entry type that was chosen in view when the fee changes" is the
guard, and it runs in all three projects. **The guide's six fields are the shape's third
outing** and are built the way this paragraph says: after the checkbox that reveals them, never
around it.

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

⚠️ **A merely *busy* machine fails `./dev test` differently, and the signature reads as a
runtime bug rather than as load.** No second run is needed — parallel work of any kind is
enough. Measured on 30 August 2026 on one unchanged tree, twice each: run alongside a
ten-agent documentation sweep, the Worker layer died with **`Worker exited unexpectedly`
twice over and a Vite server timeout after 10000ms**, reporting **4 of 6 files and 105
tests**. Run alone on the same commit, the same command reported **11 files and 348 tests**
and the ordinary `.dev.vars` failure below. **Both numbers are real and only the second one
means anything.**

The trap is that the loaded signature names the `@cloudflare/vitest-pool-workers` pool and a
Vite timeout, so it invites a hunt through `vitest.worker.*.config.ts` for a configuration
fault that is not there — while the truncated count looks like a suite that shrank rather
than one that was killed. **The tell is a file count lower than eleven**, and the fix is to
stop everything else and run it again. Sequence the work rather than overlapping it: this is
the reason a test run and a subagent fan-out must not be dispatched in the same breath, and
`./dev check` is not exempt — it rebuilds the database under whatever else is reading it.

**`./dev test` fails one Worker test on any machine that has a Stripe key, and it is the
machine rather than the branch.** `tests/worker/admin/tester.test.ts`'s "gets the tester entry
type back still chosen" asserts **503** — the branch the Worker takes when no
`STRIPE_SECRET_KEY` is bound, where the submission was good and nothing was stored and nothing
was charged. `platform/apps/main/.dev.vars` is gitignored and holds exactly that key on any
machine somebody has set one up on, so the Worker reaches Stripe Checkout instead and answers
**303**. `AssertionError: expected 303 to be 503` under `vitest.worker.admin.config.ts` is the
whole signature, and it reads as a regression in the entry path when nothing has regressed:
**CI passes because CI has no `.dev.vars`.** The cost is not one test — `cmd_test` stops at the
Worker layer, so Playwright and axe never run at all and the acceptance layer reports nothing,
which is the half somebody was waiting on. **Moving `.dev.vars` aside and running again** is the
CI environment reproduced — and ⚠️ **that step belongs to a volunteer, never to an agent.** A
session working here does not move, rename, copy or read that file. It runs `./dev test`,
reports the `303` against the `503` as a fact about the machine, and says plainly that the
acceptance layer did not run — then stops. Closing the acceptance half of a definition of done
is a hand-run by one of the two people who own the key.

**The prohibition and the remedy are not in conflict, and reading them as one cost a round trip
on 30 August 2026.** "Never touch `.dev.vars`" scopes the *actor*, not the file: the file is
movable, and the person moving it is the one who put a live key on the machine. An agent that
works around this by renaming the file has taken a decision about a credential that was never
its own to take; an agent that reports the failure and halts has done the whole of its job.
**Do not retry and do not edit the test**: the failure is deterministic, and the test is
asserting the right thing about the right branch. When a volunteer does run it, rename the file
rather than copying it, so a live key is never on disk twice, and check its digest when you put
it back.

**`git fetch` fast-forwards local `main` here, so "branch off `main`" is not stable across a
fetch.** A session can read `main`, plan against it, fetch for some unrelated reason, and then
branch from a different commit than the one it inspected — with nothing in the output saying
the base moved. **The cost is a branch silently based on a different tree than the one that was
reviewed**, and it is worst where it is hardest to see: a diff that applies cleanly to either
base, a suite that went green against the older one, and a pull request carrying a verification
that no longer means what it claims. It has happened here — a branch cut from `main`, a fetch a
few steps later, and `main` by then two commits ahead, with those two adding `entries`
migrations underneath a branch whose green run predated them. **Re-check `git rev-parse main`
immediately before `git checkout -b`, and put the base SHA in the first commit message**, so
the tree a change was verified against is recorded rather than inferred.

---

## What is not built yet

So you do not go looking for it, or assume it is missing by mistake: there is **no timing
application code**.

**The confirmation email is built — #73 and
[ADR-021](docs/architecture/decisions/adr-021-the-club-tells-people-by-outbox.md).** The club
sends four messages about an entry, and **the obligation to send one is written in the same
transaction as the thing it is about**: an `after update` trigger on `entries.entry_purchases`
writes a row into `entries.email_outbox` when a place is paid for, refunded, or transferred —
two rows for a transfer, because the person it moved *away from* has an address that exists
nowhere else once `purchaser_email` is overwritten. Delivery is separate and retryable: the
five-minute cron claims a batch, sends it through Resend's REST API, and records each outcome.
**Nothing can lose a message**; it can only be late. **The outbox holds one piece of personal
data, an email address** — everything else a message needs is joined from the live tables at
send time, so it is not a second copy of an entry for retention to chase.

**Each of the four now carries an HTML part as well as text, since 31 August 2026 —
[ADR-026](docs/architecture/decisions/adr-026-an-html-part-joins-the-outbox-emails.md)
reverses the plain-text-only decision `worker/email.ts` had carried in a comment rather than a
record.** The text part is unchanged and stays authoritative; `worker/email-skin.ts` renders
the HTML from the same `OutboxMessage` the text reads, never from the text's own output, so the
two can disagree in presentation but never in which facts they state. It is a newsprint skin —
one card, one stamp, seven colours, three font stacks — with the design fidelity enforced by
`tests/unit/email-skin.test.ts` rather than left to review by eye. **The campaign banner is a
served image, not embedded**, at `apps/main/public/nn-email-banner-1080x566.png`; the file must
be committed before its URL resolves, which is a plain git step rather than a manual one. **The
Reply-To address moved off Gmail the same day** —
`20260831090000_entries_nn_reply_to_club_domain.sql` updates `entries.events.from_address` to
`nightingalenightmare@southvillerunningclub.co.uk`, the club-domain alias whose delivery into
`info@` was proven on 28 August 2026.

**There are two triggers, because a given place skips the transition the first one watches.**
`enqueue_entry_email()` is `after update` and its confirmation branch fires on
`pending`/`expired` → `paid` — which is right for a place that is *held* and then paid for, and
never fires for one `create_manual_entry()` **inserts** already `paid`. So Kinsi's two
complimentary places and every visually impaired runner's guide were given a place and told
nothing at all, and the silence was total: nobody chases an email they were never told to
expect. `enqueue_entry_email_on_insert()` is the `after insert` half, guarded on
`new.status = 'paid'` — the 250 `pending` rows a full race inserts owe nobody anything — and it
**shares the update path's dedupe key**, so no place can be confirmed twice. A second trigger
rather than a fifth branch: all three existing branches compare `old` to `new`, and under
`after insert` there is no `old`. #150.

⚠️ **Two of the four templates quote an amount, and a given place is £0.** The confirmation said
*"we have received your payment of £0.00"* and the cancellation said *"we have refunded £0.00 to
the card you paid with"* — which names a card nobody gave, and sends somebody to check a
statement for a refund that is not coming. `worker/email.ts` branches on `amountPence === 0` for
both, and `tests/unit/email.test.ts` asserts the wording each way. Nothing else about the message
differs, because nothing else about the place does.

**A cancellation of a purchase that was never `paid` enqueues nothing, and that is written
rather than accidental.** `cancel_entry()` refuses only a purchase already `refunded`, so it
will take a `pending` or `expired` one to `refunded` — and the refund branch guards on
`old.status = 'paid'`. Right on the facts, since nothing was paid and so nothing was refunded,
and still silent; `entries-email-outbox.test.ts` asserts it both ways so the silence stays a
decision.

**Account mail has a reply line but still no `Reply-To` header, and the split is deliberate.**
GoTrue sends confirmations, magic links and password resets with no `Reply-To` field at all — it
has none — from a Resend *sending* subdomain with no MX, so a reply bounces. The **confirmation**
is the one message whose body already lives in a file, `supabase/templates/confirmation.html`
declared at `auth.email.template.confirmation`, so it now names `info@southvillerunningclub.co.uk`
in prose. **Prose and not a `mailto:`**, because that file's own rule is one call to action and no
second link. Giving the other three a reply line means declaring new `[auth.email.template.*]`
blocks, which is the class of change that failed `supabase config push` on every merge from
25 August 2026 — so it waits for the Send Email Hook, **after 1 November**. #99, and the sharpest
case (*"I didn't change my password"*) is on the far side of that line.

⚠️ **Resend's free tier is 100 emails a day, account-wide, against 250 places** — shared with
every account email the site sends. On a busy entry day the queue will exceed it and the
remainder arrives the next day. That is a **decision the club took deliberately** over roughly
$20/month, not an oversight, and it is why the outbox exists at all.
[The runbook](docs/delivery/runbooks/entries-email.md) is what a volunteer reads when somebody
says they never heard anything, and **`/admin/emails/` is where they look** — the queue, the
figures, and a re-send button on a failed message. **It is in the navigation bar and has its own
two permissions since 29 August 2026**: `nn.email.read` opens the page and `nn.email.resend`
opens the buttons, gated the way `/admin/people/` is. It was built borrowing `nn.entry.read` and
`nn.entry.cancel`, which that migration's own header called the wrong answer — the write half
worst of all, because "may refund an entry somebody paid for" is a strange thing to have to hold
in order to answer *"I never got my confirmation"*. **A message that has already
been sent cannot be re-sent** — the club cannot un-send an email, and "I never got it" is far
more often a spam folder. ⚠️ **"Sent today" on that page counts entry emails only**: account
mail shares the Resend account and is not in the outbox, so the club's real usage against the
daily cap is higher than the figure shown, and the page says so.

**One rate-limiting rule is live, and it is the whole of the Cloudflare layer.**
`[auth.rate_limit]` in `packages/db/supabase/config.toml` is chosen rather than defaulted, with
a comment per value and `tests/unit/config.test.ts` asserting each — **and the trap that decides
those numbers is that "per IP address" is not the runner's address**: every GoTrue call the
account area makes is server-side, so a per-IP limit behind the Worker is a project-wide limit
and a tight number is a cap on the whole club. The per-person layer is Cloudflare's, recorded as
a reviewable artefact in `docs/reference/cloudflare-waf-rules.md`, and since **25 August 2026**
that layer is **C1**: one combined rule over every `POST` under `/account/`, `/admin/` and
`/nn/` except `/nn/stripe-webhook`, at **3 requests per 10 seconds, Block, 10-second
mitigation**. The race forms' rule and the four account rules are still in that table as **E1**
and **A1**–**A4**, and **not one of them was ever created**, because **the free plan allows
exactly one rate-limiting rule** — but the rule count was never the binding constraint. **The
plan caps both the period and the mitigation at 10 seconds**, which is the length A1 and A3
were argued from, so what exists is a burst brake on the entry form and close to nothing
against credential stuffing. **Whether the account endpoints justify a paid plan is the first
money question this platform has raised, and it is open.** The runbooks are `accounts-open.md`,
whose step 0.1 is what created C1 and whose remaining stop condition is step 0.3 — **nobody has
watched the rule fire** — and `entries-open.md`, whose step 0.1 was reconciled to C1 on 30
August 2026: it now says plainly not to go looking for E1, since it does not exist and never
will, and that C1's `/nn/` coverage is what already meets this step.

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
the surface mixes. **The audit trail is on it now, scoped to one entry** —
[ADR-024](docs/architecture/decisions/adr-024-one-entry-in-full.md), which reverses the position
that it deliberately was not. Half the old argument expired with the two-key scheme — nothing
here is anon-callable any more, and `entries.admin_entry_detail()` is granted to `authenticated`
behind `nn.entry.read` — and the other half was that it is a decision, which this is. **It
returns only the rows that name one purchase**, so it is the history of a record rather than a
log of what each volunteer has been doing; there is still no way to read `admin_audit` as a
list, and adding one is a separate decision. The actor stays the pseudonym ADR-013 made it.

**There is a page per entry, behind every row** — `POST /admin/nn/entry/`. The list is a table
and a table can only carry what fits in a column, so the facts a volunteer needs on the phone
were the ones that did not fit: which address paid, when it settled, Stripe's references, the
emergency contact, the emails owed, every ask made, and what has been done to it. It is a
**purchase** rather than an entrant, for the reason the list is; it writes **no audit row**,
because it discloses what the list and the exports already do to the same permission; and it
returns **whether** there is a medical note and never the note, and `consent_version` and never
`consents`.

**A cancelled entry stays on `/admin/nn/`, with no runner on it.** `cancel_entry()` deletes the
entrants — deliberately, so the club stops holding personal data for a race somebody is not
running — and `read_entry_list()` inner-joined them, so a refunded purchase could not appear on
that page at all: the **Refunded** filter could never match a row, and a volunteer clicking it
concluded there had been no refunds. The list is purchase-driven with the entrant left joined
now, and a row with no runner reads "No runner recorded", exactly as `/account/entries/` has
always rendered the same purchase. **The counts were already right** — they read the purchase
grain — and **`holding` and the three exports keep their inner joins**, because capacity is
measured in runners and a start list has nobody to put on it. #116.

**The medical notes are deleted a month after the race, and the column and the JSON are tied
together by a test.** `entries.events.medical_retention` is what the five-minute cron applies;
`race.json`'s `privacy.medicalRetention` is the wording for that interval;
`packages/db/tests/entries-retention.test.ts` reads both and fails unless the words are the ones
the interval generates through `packages/shared/src/medical-retention.ts`. **Changing either one
alone goes red.** **The tie stops at the JSON since 30 August 2026, and that is a guarantee
lost.** `/nn/privacy/` published `medicalRetention` until the club asked for that page to be the
committee's document word for word, and the document names no period — so the deletion is
unchanged and **nothing published is tied to the enforced interval any more.** The key survives
for this test alone and no page reads it. What the test used to stop — the club publishing one
period and keeping another — is now unguarded rather than impossible, so publishing a period
again means asking the committee for wording *and* re-establishing that tie, never assuming it
still holds.

**A race is the recurring thing; an event is one running of it in one year, and the routes say
so** — [ADR-011](docs/architecture/decisions/adr-011-a-race-and-its-runnings.md). Evergreen:
`/nn/` (the race, and the interest form), `/nn/privacy/` — and `/nn/course/`, whose
content is on `/nn/` now and whose address 301s there. The 2026 running:
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
retired the plan to give them a repository of their own. **Both forms are on `/nn/2026/`**, and
a hidden `form` field is what tells them apart — this paragraph used to say the opposite on both
counts and was wrong on both. `/nn/` carries no form at all; a POST there falls past every
predicate to the assets binding and answers **405**. The page carries two states and the Worker
reveals one, decided per request rather than by a deploy.
`entries.events.entries_open_at` is `null` today — **still, and deliberately, with the window
ratified** — so production serves the interest form on `/nn/2026/` and the entry form stays
hidden. `entries_close_at` is set and changes none of that. **The shipped-visible half is the
safe default rather than an arbitrary one**: a page that cannot reach the database must not
offer to take money, so every failure lands on the state that asks for an email address.

**A valid entry holds a place and goes to Stripe Checkout.** One transaction under a
per-event advisory lock: **check the entry key**, re-check the window, count the places gone,
price it from `entries.fees`, refuse a total of zero, write a `pending` purchase with a
31-minute hold. Then a Checkout session for
exactly that amount and a 303 to it.

**The Left Handed Giant code exists, is minted by a migration, and is read off `/admin/nn/`.** 10%
off an unaffiliated entry, **25 places since 30 August 2026** — it was minted at 22 and raised by
`20260830120000_nn_2026_lhg_twenty_five_places.sql`, because raising a cap cannot conflict with
places already taken — `LHG-10-` plus twelve random characters. **The migration
carries the generator and never the value**, so every environment mints its own and none is in
this public repository — and `/admin/nn/`'s "Discount codes" panel is the only place it can be
read, which is how somebody finds out what to tell Left Handed Giant. The entries table carries a
**Code** column so who used it is a column you read down. See
[the runbook](docs/delivery/runbooks/entries-discount-codes.md).

**A discount code is priced before anything is held, and the code itself is never in this
repository.** `entries.discount_codes` was built in Slice A and left empty; it takes rows now,
and `fee_id` is new — *"10% off an unaffiliated entry"* is two facts and `percent_off` was only
one of them, so a code scoped to a fee is refused against any other. **This repository is
public**, so a code in a migration is a published code: rows are inserted by hand from
[the runbook](docs/delivery/runbooks/entries-discount-codes.md), twelve characters from a
32-letter alphabet, and **the entropy is the only control** because no rate limiting is live
anywhere yet. A submission carrying a code is priced by `create_pending_purchase(p_preview =>
true)`, which runs every rule and **returns before the first write** — no place held, no use
spent — and the person confirms the total before Stripe. That is a ninth argument rather than a
fourteenth anon-callable function, and it is why this is **the one migration that drops a
function**: an extra defaulted parameter creates a second overload, and PostgREST would refuse
every call naming the original eight as ambiguous. **A use is returned when the place is** —
`expire_pending_holds()` on a lapsed hold, `cancel_entry()` on a refund — because it only ever
incremented before, so 25 abandoned checkouts would have exhausted the whole allocation with
nobody entered. **A 100% code is not the way to give a free place**: Stripe refuses a zero-total
session and will not charge below £0.30, which is what [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md) is the answer to.

**Every rule is enforced in the database, and Zod is never the only place one lives.** Slice E
found `create_pending_purchase` writing `ea_number` without ever consulting
`fees.requires_ea_number` — so two PostgREST calls with the published anon key bought an
affiliated place with no England Athletics number, £2 under. Zod required it; **Zod is the
form's control, not the system's**. Slice G audited every rule by *attempting the bypass* with
an anonymous client and found eight more, the worst being that the entry terms were not
enforced at all: `p_consents = {}` was accepted and stored as `{}`. All nine are closed — a
check constraint where the rule is static, a trigger where it spans tables, and the function
where a person needs words about it (`consents_missing`). **The England Athletics rule that
started all of this no longer exists**: the club stopped asking on 29 August 2026, so what
`entries-rules.test.ts` attempts there is the opposite bypass — post a number straight at
PostgREST with the published key and assert it reaches no column.
`packages/db/tests/entries-rules.test.ts` re-attempts each bypass and asserts the **specific**
refusal, because a Postgres error is not a refusal: a broken function refuses everything, which
reads as every rule holding at once. **The tenth rule is "one entry per runner", and it is the
first one a person is meant to meet.** The form claimed it in prose from the day it was written
and nothing enforced it, so somebody who already had a place could pay again and take a second
one out of 250 — #115. `create_pending_purchase()` now refuses with `already_entered`, keyed on
**first name, last name and date of birth** and counting only a *live* place: `paid`, or
`pending` with a hold that has not lapsed, so an expired hold or a cancelled entry lets somebody
try again. **Not `purchaser_email`** — that was the original decision, and it has been
overruled; see the rule below. The check sits inside the per-event advisory lock, and
**every database fixture that enters more than once now carries a serial on the surname**,
because a suite whose runners are all the same person cannot hold two places any more.

**The eleventh rule is "one place per email address", and it reverses a written decision.**
`20260827090000`'s own header argued the address was the wrong key because *one card
legitimately pays for a partner, and refusing that would cost a real runner a place*. The club
overruled that on **30 August 2026**, and
`20260830160000_entries_one_place_per_email.sql` refuses a second live place on one address
with `email_already_entered` — on the entry path **and** in `transfer_entry()`, because
otherwise the transfer form is the way round the entry form. ⚠️ **The cost is accepted rather
than solved**: a couple on one card, a parent entering two children, and anybody entering for
somebody with no address of their own are refused at the moment they pay. **If that starts
happening the answer is to revisit the decision, not to add an exception to the function.**
**`create_manual_entry()` is deliberately exempt** — giving a place away is a volunteer
deciding one at a time, and the club's complimentary places and a visually impaired runner's
guide are exactly what a blanket address rule would refuse. **Name and date of birth stay**:
the two rules overlap and neither subsumes the other, so `already_entered` still catches the
same runner re-submitting under a different address. **The fixtures carry a serial on the
address now as well as on the surname**, for the same reason.

**A signed-in buyer's `purchaser_email` comes from their session, not from the form.** It came
straight off the form for everybody, so somebody signed in could type any address — and every
consequence lands where they cannot see it: the confirmation, the refund notice, both sides of
a transfer and Stripe's receipt all go to `purchaser_email`, and `my_entries()` matches on
`person_id` **or** that address, so a typo hands the second arm to a stranger. The entry still
appeared on their own account through `person_id`, which is what made it invisible. The Worker
reads the confirmed address with `auth.getUser()` on the POST and ignores the box. **With the
rule above, the two together mean somebody signed in holds one place and cannot enter on
anybody else's behalf** — they sign out, or the club gives the place from `/admin/nn/`. **Which consents an event requires is
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
| **The entry path** | `create_pending_purchase()` — **takes a key**, since #178 — and `attach_checkout_session()` |
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

**`authenticated` is a second list: six, then eleven in #107, then twelve, then fourteen, then
sixteen** — the last being `admin_entry_detail()`, ADR-024's. It is a role
anybody who registers holds, so every function on it authorises inside itself and the grant only
says "you may ask". `create_pending_purchase()` and `attach_checkout_session()` are there because
a signed-in caller reaches PostgREST as `authenticated` rather than as `anon` — **not** because a
signed-in caller may do more. `my_entries()` is scoped to `auth.uid()` and the caller's confirmed
address; `cancellable_purchase()` and `cancel_entry()` refuse without `nn.entry.cancel`.

**A twelfth arrived with the entry-request slice, and it is the first one a runner rather
than a volunteer calls.** `request_entry_action()` records that somebody has asked the club
to cancel or transfer one of their own paid entries, and **performs neither** — cancelling is
`cancel_entry()` behind `nn.entry.cancel`, and transferring has no implementation at all.
Ownership is re-derived from `auth.uid()` and the caller's confirmed address, **never from
the purchase id it is given**: that is printed on the confirmation page and on
`/account/entries/`, and it is not a credential. "Not yours", "not there" and "not paid" all
answer `no_such_entry`, so a reference cannot be used to learn whether it names somebody
else's entry.

**Transferring a place is built, and it means one thing: the runner changes and nothing
else does.** `transfer_entry()` replaces the entrant, re-points `purchaser_email` at the new
person and sets `person_id` **null** — the state a signed-out purchase sits in, so the entry
appears on their account the moment that address registers and confirms. **No account is
created**, for the reason the entry path gives. **No money moves**, so the place never returns
to the pool and cannot be taken by somebody else in between. It **deletes the previous
runner's medical note**: a note belongs to whoever wrote it, and carrying one across would file
a stranger's condition under a new name. And it
**re-applies the minimum age and one-runner-one-place**, so a transfer cannot be the way round
either. It reuses `nn.entry.cancel` rather than adding a permission of its own; a dedicated
`nn.entry.transfer` is the cleaner answer and is still a decision nobody has taken. **The
eighth permission exists now and it is not this one** — `nn.entry.create`, which gives a place
away rather than moving one, and which was argued as its own permission precisely because
adding a runner to a course with a hard limit is a different power from undoing an entry
somebody bought. See [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md).

**A request is not a status, and that is load-bearing.** `requested_action` is its own column
beside `attention` rather than a sixth value of `status`, because the capacity predicate
counts `status = 'paid'` — an entry somebody has asked to cancel still holds its place until
a volunteer acts, and a new status would make that place invisible to the count and sellable
twice.

**And a request is a list, not a word, since 29 August 2026.** `requested_action` held one, so a
runner who pressed *Transfer*, thought better of it and pressed *Cancel* left a record saying
only the second — and the two want opposite things, so a volunteer seeing one of them acts on
the wrong one about half the time. `entries.entry_requests` is the append-only record of every
ask; the columns stay, holding the most recent, because the **Asked about** filter and every
deployed reader use them. **Resolution is a fact about the entry rather than about one ask** —
there is no act that answers one and leaves another open — so a trigger on
`request_resolved_at` closes every open row at once, which is what lets `cancel_entry()` and
`transfer_entry()` stay exactly as they are. **An ask knows whose it is, since 30 August 2026, and that closed a disclosure.**
`transfer_entry()` re-points `purchaser_email` and nulls `person_id`; `my_entries()` matches a
purchase on exactly those two things — so the runner a place moved **to** was shown the whole
request history of the runner it came **from**, addressed to them in the second person, free
text and all. The reason box is 500 characters of anything. `entry_requests.owner_email` and
`owner_person_id` are stamped at ask time and `my_entries()` filters on them — chosen over a
`transferred_at` column because it is **the only mechanism that survives a place changing hands
twice**: a clock answers *"was this made before the transfer"*, which is a proxy, and an owner
answers *"whose was it"*, which is the question. **The three summary keys are derived from the
owned asks too, not read off the purchase columns**, and that half is not optional —
`transfer_entry()` keeps `request_reason` deliberately, and `asksFor()` falls back to those
columns, so filtering only the list rendered nothing *by luck*. **`/admin/nn/` is untouched and
still sees every ask**, because it is the record of why the place moved. #148, ADR pending.

**Nothing in the schema acts on a request**, and the admin surface deliberately offers
no transfer button until the club asked for one — see the paragraph above, which is what
that ask turned into. **The email half is built now, and it is not this** — #73 sends on what a
volunteer *does*, never on what a runner asks for. Requesting a cancellation still tells nobody
by email; the message goes when somebody acts on it.

**`/admin/nn/` filters on sets, and by default leaves out everybody who is not running** —
`fee:tester`, `status:refunded` and `status:expired`, which on a race that fills are most of the
rows and none of the work. **An explicit `?status=` overrules the default and never overrules a
`hide=` somebody chose**: without that split, pressing the **Hold expired** chip returned an
empty table, which is a filter that can never match and is exactly how the Refunded filter once
convinced a volunteer there had been no refunds. Two lines under the chips name what is missing
and link to the view including it.

**The page also counts the field by category** — the four bands, the two honest non-answers, and
guides beside them rather than inside one. Counted off the rows rather than asked of the
database, because the band a runner falls in is named by `packages/shared/src/age-category.ts`
and by nothing else.

**The medical sheet has a printable page as well as a CSV**, at `POST /admin/nn/medical-sheet/`
— the same read and the same `medical_export` audit row. The start list has had one since it was
written; the more sensitive of the two documents had only a file, and what a machine does with a
downloaded `.csv` is not the club's to control.

**A request carries the reason somebody gave**, in `entry_purchases.request_reason`: optional,
capped at 500 characters, read on `/admin/nn/` and on the asker's own `/account/entries/` and
**nowhere else** — never exported, for the reason `gender_identity` is not. `/account/entries/`
states the club's position on refunds *above* the box rather than after the button: not the first
answer, looked at case by case.

**An affiliated place transfers like any other now, and it could not before.**
`transfer_entry()` cleared the previous runner's England Athletics number unconditionally, which
`assert_entrant_rules()` refused on an affiliated entry — so **every affiliated transfer raised a
`check_violation` that reached a volunteer as *"the club's database could not be reached"***, on a
database that was perfectly healthy. Asking the new runner for a number of their own was what
closed that, as a tenth argument with the nine-argument form kept as a wrapper. The club then
stopped asking for numbers at all, so no fee requires one, the refusal is unreachable and the
argument is dead weight — **both go at the contract step**, which is the one still owing.

The rest of the filtering: Status and entry
type are multi-select, carried as repeated query parameters so a filtered view is a URL
somebody can send to the other volunteer; an empty set means every value. Exclusion is
`hide`, namespaced — `hide=fee:tester`, `hide=status:refunded` — and `hide=none` is how
"leave nothing out" is written, because absent and empty would otherwise mean opposite
things. A tester's place is still real and still counted; it is simply not what somebody
opens that page to look at.

**`/account/entries/`'s open view shows confirmed places and nothing else.** A lapsed attempt
beside a real ticket makes the page look broken, so a ticket is the only thing on that view.
Same rule as `/nn/<year>/entry/complete/`, which may not make a negative claim either, applied
to a list. Every entry carries its purchase id as a reference, because somebody emailing the
club had nothing to name one by.

⚠️ **What may never be dropped is the note that replaces them.** Hiding a lapsed hold with
nothing in its place shows an empty page to somebody whose payment succeeded while the webhook
was late — they read that as nothing having been taken, and enter again. So when there is no
confirmed place and there *is* a lapsed one, the open view carries a note that names the state,
says in full that a payment can arrive after the page that took it gave up and to get in touch
rather than entering twice, and links to where the entry is filed. **The note is the pay-twice
guard, not a signpost**: it carries that sentence itself rather than deferring it to the card,
because the card is now one click away and the default address is where doing nothing lands.

**A cancelled entry has a view of its own since 30 August 2026, and the rule above is why it
needed one.** Showing non-confirmed entries only when there are none confirmed meant a runner
who cancelled one entry and kept another had **no record of the cancellation on the club's site
at all**. `?show=cancelled` is the second view — **a URL filter rather than tabs or a second
page**, for the reason `/admin/nn/`'s filters are: it works with scripting off, and a filtered
view is a URL somebody can send while helping a runner work out what happened. An empty
Cancelled view says **"Nothing here"** and never *"you have never cancelled an entry"*, which is
a claim about a record. #148.

**A lapsed hold is filed under Cancelled, and that reverses the position this paragraph used to
state.** It sat underneath *whichever* view was open, shown only when there were no confirmed
places — which meant `?show=cancelled` with nothing cancelled said "Nothing here" and then
rendered a not-completed entry directly beneath it. Asked for and decided on 30 August 2026: a
not-completed entry goes in the Cancelled view. ⚠️ **It is not a cancellation, and the heading
can therefore be wrong about it in the expensive direction** — the webhook may be late, the
place may in fact be paid for, and a runner who believes their entry is gone enters again. Two
things pay for that and **neither may be removed without putting the other back**: the card's
own status sentence still says only what it knows (*not completed in time; if you were charged,
get in touch before entering again*), and the open view carries the note described above. The
lapsed card is rendered quiet and *after* the refunds, because a refund happened and a lapsed
hold merely failed to complete.

**Two functions in `entries` now answer differently depending on who is asking, and that is new.**
`entry_state()` hides a fee whose `requires_permission` the caller does not hold, and
`create_pending_purchase()` admits a `pre_open` event for a caller holding `nn.entry.before_open`.
Both resolve that through `auth.uid()` and **never through anything the caller passes** — a
parameter would be a free early entry for anybody who reads the page source. `entries_close_at`
and `active` are never bypassed. `packages/db/tests/entries-tester.test.ts` re-attempts every one
of those bypasses anonymously and as a signed-in person holding nothing.

**Seven functions take a key, and the key is what makes an anon grant safe.** Without one, two
ordinary PostgREST calls with the published anon key would buy a free entry, because
`create_pending_purchase()` issues purchase ids on request — and the five admin reads would hand
anybody the club's entry list. `ENTRIES_WEBHOOK_KEY` and `ENTRIES_ADMIN_KEY` are **Worker
secrets**; the database holds only their SHA-256 digests, in `entries.webhook_secrets`, and both
ship null, which refuses everything.

⚠️ **The seventh arrived on 31 August 2026 and it is `create_pending_purchase()` itself —
[ADR-029](docs/architecture/decisions/adr-029-holding-a-place-takes-a-key.md), issue #178.** That
sentence above was always about two halves and only the confirming one was ever built. Holding a
place is granted to `anon` — it must be, a signed-out runner reaches PostgREST as `anon` — and it
holds a place *before* any money moves, with a live `pending` hold counting against the 250. So a
loop with the key printed in every page's source took the whole field in **half a second, for
nothing**: measured at 249 holds in 0.5s, with the next real runner refused `sold_out`.
Cloudflare's C1 never saw it, because PostgREST is a different origin from the Worker.
`ENTRIES_ENTRY_KEY` is the third Worker secret and a **third row** in `webhook_secrets` — one key
opening two doors is one rotation closing both. **The anon grant list is unchanged at thirteen**;
what changed is how many of the thirteen demand a key, and `entries.test.ts` asserts that second
list too. **The digest ships null and refuses everything**, so the entries-open runbook's
[step 0.8](docs/delivery/runbooks/entries-open.md#08--the-entry-key-must-be-installed-and-verified)
installs it **before** `entries_open_at` is set — the other order is a window that is open and
unprotected. **A £0 total is refused in the database too** (`free_place`), which the Worker
already did and the database did not; `vi_guide` deliberately keeps its price and its place in
`entry_state()`, because gating the fee would close nothing the key does not and would retire the
Worker's own free-place backstop with it.

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

⚠️ **Nothing may be left `paid` across that swap, and this has already cost one real payment.**
Stripe's two modes are separate object graphs, so a key of one mode cannot refund a payment
intent of the other — and the cancel path is Stripe first, the record second, so a mode mismatch
answers *"Nothing was cancelled"* on a database that is perfectly healthy and leaves the place
consumed for ever. A live payment taken on 27 August 2026 is still stranded that way (#118 item
7), and the only occasion it can be cancelled at all is while the live pair is bound. **The
failure is indistinguishable on the page from a restricted key missing Refunds — Write**, which
is a second per-key fact that cannot be inferred from the other pair; the Worker log's status and
Stripe `code=` are what tell them apart. Both, and the reason a hand refund in the dashboard
makes the row permanently unreconcilable, are in
[the key-swap runbook](docs/delivery/runbooks/entries-stripe-keys.md).

**`/account/entries/` is what tells a runner they have a place**, alongside the confirmation
email #73 sends and Stripe's own receipt. It reads `entries.my_entries()`, which matches on
`person_id` — set when the buyer happened to be signed in — **or** on a `purchaser_email` equal to
the caller's confirmed address. **An account is not required to enter and is never created by
entering**: auto-creating one would write an unconfirmed `auth.users` row and grant it the signup
role, which is a false statement in the table whose job is to say who somebody is.

**A session ends on its own — thirty minutes idle, twelve hours absolute** —
[ADR-019](docs/architecture/decisions/adr-019-a-session-ends-on-its-own.md). It used to be
thirty days, which was Supabase's default rather than a decision, and one cookie jar opens
`/account/` and `/admin/` alike. **A session is three cookies now, not two**: `src_ax` carries
the absolute deadline, and a session arriving without a readable one is ended rather than given
one — so every fixture and every hand-built `Cookie` header that means "signed in" has to say
all three. **Only an authentication mints a deadline**; a refresh carries the existing one
forward, and the Worker cross-checks it against the authentication time GoTrue signs into the
access token's `amr` claim, which is the half a stolen cookie jar cannot forge. Reaching either
deadline calls Supabase's `/logout`, so an expiry revokes rather than forgets. **GoTrue does
both of these itself on a Pro plan and the club is on the free tier** — putting them in
`[auth]` anyway would be refused, and there is no partial apply.

**A free place cannot be completed through the entry form, and that gap is answered rather
than open.** Stripe refuses a zero-total Checkout session, so a discount code can never
produce a £0 entry on its own. The answer is [ADR-028](docs/architecture/decisions/adr-028-a-place-can-be-given.md),
28 August 2026: somebody holding `nn.entry.create` assigns a **complimentary** place from
`/admin/nn/` — a `paid` purchase at £0 on a £0 fee, audited, under the same advisory lock,
re-checking capacity, the minimum age and one-runner-one-place. It is what the two Kinsi
places and a visually impaired runner's guide's place both use now.

The current state, and what is deliberately deferred, is in
[the phases](docs/delivery/phases.md).
