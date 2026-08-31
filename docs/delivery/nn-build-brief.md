# Nightingale Nightmare — build brief

A handoff specification for whoever builds the site, human or agent. **Stack, conventions
and constraints only** — what the page says is in [Nightingale Nightmare
first](nn-first-delivery.md), and it is deliberately not repeated here.

Written to be executable without conversation: every choice below is made rather than
offered, every prohibition is explicit, and the acceptance criteria are checkable. Where
something is genuinely undecided it is listed under [deliberately left
open](#deliberately-left-open) and **must not be invented**.

Context if needed: [platform options](../solutions/platform-options.md) for why
Cloudflare, [DNS and domain](../solutions/dns-and-domain.md) for the hostname.

---

## Amended 13 August 2026 — read this before the rest

**Five rules below have been superseded by decisions taken since this brief was written.**
They are amended in place, each with a marker saying what changed and what authorised it —
the brief is not edited to pretend it always said this. Everything not listed here still
stands exactly as written.

| Rule, as written | Now | What superseded it |
| --- | --- | --- |
| **Taking payment is a stop-and-ask** | **Payment is in scope, and is now built.** A valid entry holds a place and goes to Stripe Checkout. **Nothing confirms a payment yet** — that is the webhook, and it is deliberately not built alongside this | The treasurer has authorised in-house payment |
| **Collecting a field beyond name and email is a committee decision** | **The committee has decided.** The entry field list is settled — see [`packages/shared/src/nn-entry.ts`](../../platform/packages/shared/src/nn-entry.ts). Anything not on it is still a stop-and-ask | A committee decision |
| **The race date is unconfirmed** | **Sunday 1 November 2026, 11:00** | The club's published campaign artwork, 12 August 2026 |
| **Only two environment variables exist; a third should never be needed** | Still true of *variables*. Stripe needs a secret key and a webhook signing secret, and both are **Worker secrets** — `wrangler secret put`, never in this repository, never in `wrangler.jsonc`, never in a `vars` block | Stripe |
| **Entries are a separate application** | **Entries are built in `apps/main`** | [ADR-009](../architecture/decisions/adr-009-entries-in-apps-main.md) |

**RLS is unchanged and is not on that list.** Row-level security is still the whole of the
access control for anything a browser touches, the anon key is still the only key in client
code, and the service role key still never reaches a browser or this repository. The webhook
that records a payment needs privileged writes, and the mechanism for that is a decision of
its own — it is not a licence to put a service role key anywhere near the front end.

---

## Scope

| | |
| --- | --- |
| **Build** | A public page describing the race, a sign-up form, and **Stripe payment** |
| **Host** | **Cloudflare Workers** with static assets, at `new.southvillerunningclub.co.uk/nn` — a path rather than a subdomain, per [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md) |
| **Store** | Supabase Postgres, `eu-west-2` |
| **Do not build** | Results, accounts, admin surfaces. **Payments are in scope** — see below |

This is one page and one form. Scope creep is the main risk to the deadline, and the
second main risk is collecting personal data nobody asked for.

---

## Build it as a Worker

> **This section used to describe a pincer.** `@astrojs/cloudflare` v13 dropped Pages
> support, while Workers custom domains needed an active Cloudflare zone the club did not
> have — so v1 was boxed into Pages. **The nameservers moved on 8 August 2026 and the pincer
> is gone.** Kept here because the conclusion survived and the reasoning explains why.

> **Build the site as static Astro, and deploy it as a Worker with static assets plus one
> Worker route for the form.**

| | |
| --- | --- |
| **Static Astro still needs no adapter** | Astro pre-renders at build time; for a static-only site the Cloudflare adapter is not required at all |
| **Workers is where Cloudflare is investing** | *"If you are starting a new project, use Workers instead of Pages"* — Pages keeps working but gets no new work |
| **The output is the portable thing** | Static HTML plus one handler runs on Workers, on Pages, or on Netlify. Nothing here is a one-way door |

**What changed in practice:** `assets.directory` points at `dist/`, `main` points at the form
handler, and the custom domain is attached in the Worker — **Cloudflare creates the DNS
record and the certificate itself.** No CNAME at Fasthosts, and no
associate-the-domain-first-or-get-a-522 ordering trap.

**Do not pin `@astrojs/cloudflare` v12 to get SSR on Pages.** That was wrong when Pages was
forced and it is worse now.

**When SSR is genuinely wanted** — the main website rebuild, not this — Astro 6 with the
current `@astrojs/cloudflare` adapter on Workers is available and supported.

---

## Stack

Every line is a decision, not a suggestion. Deviating from one requires a note in the pull
request saying why.

| | Choice | Why this and not the alternative |
| --- | --- | --- |
| **Language** | TypeScript, `strict: true` | [Convergence](../foundations/requirements.md#convergence) with the timing platform |
| **Framework** | **Astro**, current stable (6.x) | Content-shaped site; ships zero JS by default; adapters for every candidate host, so the hosting decision stays cheap |
| **Render mode** | `output: 'static'` — **no adapter** | A static-only Astro site needs no Cloudflare adapter. See above |
| **Dynamic endpoint** | **A Worker route**, `main` in `wrangler.jsonc` | Full Workers runtime, survives a framework change |
| **Runtime (tooling)** | Node.js LTS (22.x), pinned in `.nvmrc` | Boring |
| **Package manager** | **npm**, lockfile committed | [Boring is a hard requirement](../foundations/requirements.md#people). pnpm is better and less universally known |
| **Styling** | Vanilla CSS with custom properties, one stylesheet | A third volunteer can read it cold. No build step, no framework vocabulary to learn, smallest payload on poor signal |
| **Data client** | `@supabase/supabase-js` | Already the club's client in the timing platform |
| **Validation** | **Zod**, schema shared between client and server | One definition; server-side validation is non-negotiable |
| **Unit tests** | **Vitest** | Astro's own default |
| **Browser tests** | **Playwright**, with `@axe-core/playwright` | Accessibility is a stated requirement, so it is tested, not asserted |
| **Lint / format** | ESLint + Prettier | Mainstream over fast |
| **CI** | GitHub Actions | Already where the club's code lives |
| **Deploy** | Cloudflare **Workers Builds** git integration, build on push to `main`, preview URL per version | No deploy credentials in CI to leak |
| **Config as code** | `wrangler.jsonc` committed if any binding is needed | [Everything defined as code](../foundations/requirements.md#everything-is-defined-as-code) |

### Rejected, so nobody re-litigates them

| | |
| --- | --- |
| **Next.js** | Runs on Cloudflare only through OpenNext. Right for the timing app, wrong for a two-page content site |
| **Tailwind** | Mainstream and defensible, but a vocabulary a third volunteer must learn for a site with about six components |
| **A CMS** | [Explicitly not what the club is asking for](../foundations/requirements.md#what-the-club-is-not-asking-for) |
| **Any client-side framework** | Nothing here needs one |

---

## Project structure

> **Superseded by [ADR-006](../architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md)
> and [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).**
> There is no `apps/nn`. Nightingale Nightmare lives inside **`apps/main`**, at `/nn` —
> one application serving every club hostname rather than one app per race. The tree below
> is corrected to that location; everything else on this page still applies.

*Per [ADR-001](../architecture/decisions/adr-001-one-monorepo.md) this lives in the
monorepo, not in its own repository — and per ADR-006/007, inside the one application that
serves every club surface.*

```
platform/apps/main/            Built, including the sign-up form
├── wrangler.jsonc              assets.directory -> dist, main -> worker/index.ts
├── src/
│   ├── content/
│   │   └── race.json           Race facts as data, not prose in markup. Every one null
│   ├── layouts/
│   │   └── Base.astro
│   └── pages/
│       ├── index.astro         The club holding page
│       ├── 404.astro
│       └── nn/
│           ├── index.astro     The race page, and the form
│           └── privacy.astro   What the club does with an entry and a sign-up
├── worker/
│   ├── index.ts                Routing, the POST route, and the health rewrite
│   ├── routing.ts              Which paths belong to whom. Pure and tested
│   └── nn-signup.ts            Validate a sign-up, record it, render the outcome
├── tests/
│   ├── unit/                   routing
│   ├── worker/                 the POST, in the real Workers runtime
│   └── e2e/                    Playwright, including with JavaScript disabled
└── README.md                   How to run it, and every manual step taken
```

*CI lives at the repository root, not per app.*

**`src/content/race.json` is load-bearing**, and it has now been tested by the thing it was
built for. Every fact that might change — date, time, distance, price, location, and since
the content pages the schedule, the prizes and the spectating points — lives in one file as
data. When the date was confirmed on 12 August 2026 it went in as **a one-line edit with no
change to any page**: the date line, the facts list and three new pages all picked it up
without a line of markup moving. That is the property, and it held.

---

## Hard rules

Violating any of these is a defect, not a judgement call.

**Data**

- **The interest form stores name, email, consent, timestamp. Nothing else.** That rule is
  unchanged and `intake.nn_interest` still has exactly four columns —
  [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully).
- ~~Adding a column is a decision for the committee, not for the build.~~ **Amended
  13 August 2026: the committee has taken that decision for entries.** An *entry* collects
  name, email, date of birth, gender, club, entry type, England Athletics number, emergency
  contact, and optional medical information under its own separate consent. The list lives in
  [`packages/shared/src/nn-entry.ts`](../../platform/packages/shared/src/nn-entry.ts).
  **Adding a field beyond it is still a committee decision, not a build decision**, and
  nothing about the interest form's four columns has moved.
- Timestamps stored **UTC**, displayed **`Europe/London`**.
- The **anon key only** in client-visible code. The service role key never reaches the
  browser and never enters the repository. Row-level security does the enforcing.

**Payments — in scope, and gated**

- **Stripe Checkout, hosted by Stripe**, with a webhook recording the result. **Card details
  never touch club systems**, which is what keeps this out of PCI scope.
- **Do not start the payment flow until the
  [governance gates](../foundations/requirements.md#legal-and-governance) are cleared** —
  data-protection advice, treasurer-controlled arrangements, a written refund policy, and a
  confirmed entry price. These are on the critical path for 22 August.
- **Store the Stripe reference, not the payment instrument.** What else is stored against a
  payment is [deferred to the schema design](phases.md#deferred-to-the-next-pull-request).
- The **sign-up path must keep working if payment is unavailable.** A failed checkout must not
  lose the entry.

**DNS** — *simplified since the nameservers moved on 8 August 2026, and again by
[ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md) on
9 August*

- **Attach `new.southvillerunningclub.co.uk` as a custom domain on the Worker.** Cloudflare
  creates the record and issues the certificate. **Do not hand-add anything.**
- **The race is a path on it, `/nn`** — not a subdomain. At the Squarespace cutover the
  hostname changes and the path does not, so the page never moves.
- **Nothing at Fasthosts.** Its DNS panel is no longer authoritative — a change there saves
  successfully and does nothing.
- **Never modify or delete an existing record.** Additive only.
- The `nn` record **is** proxied. It is one of the few that should be: Cloudflare is the
  origin. See [adding a hostname](runbooks/adding-a-hostname.md).

**Correctness and access**

- The form **works with JavaScript disabled** — a real `<form method="post">` posting to
  the endpoint, enhanced afterwards if desired.
- **Server-side validation always.** Client-side validation is a convenience, never a
  control.
- **WCAG 2.2 AA**: semantic markup, real contrast, visible focus, labelled inputs, errors
  associated with their fields, keyboard-operable throughout.
- No secrets in the repository. No personal data in logs.

**Boundaries**

- Do not touch the `src-race-timing` repository, its Supabase project's existing tables,
  or anything Squarespace serves.

---

## Conventions

From the [repository README](../../README.md), and they apply here:

- Every change by **pull request**. Both volunteers have review access.
- **Documentation ships with the change it describes.**
- Markdown wraps at roughly **90 characters**.
- Use the [glossary](../foundations/glossary.md)'s words exactly — an *event* is one
  running of one race in one year; a *race* is the recurring thing.
- Any step done by hand — account created, token issued, record added — is written into
  the project README: what, why, by whom, and how to redo it.

---

## Environment

| Name | Where it lives | Notes |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | Worker vars, and `.env` locally | Safe to expose |
| `PUBLIC_SUPABASE_ANON_KEY` | Worker vars, and `.env` locally | Safe to expose; RLS enforces access |

`.env` is gitignored. `.env.example` is committed with empty values. **No third variable
should be needed** — if the build seems to want a service role key, the row-level security
policy is wrong and that is the thing to fix.

> **Amended 13 August 2026 — Stripe, and why it does not break this rule.**
>
> Stripe needs a **secret key** and a **webhook signing secret**. Neither is a variable in
> the sense this table means: both are **Worker secrets**, set with `wrangler secret put`,
> and they never appear in this repository, in `wrangler.jsonc`, or in a `vars` block. The
> table above lists what is *committed*, and it is still two entries long.
>
> **The service role key is still not on any list.** A payment webhook needs privileged
> writes and that is a decision of its own — it is not a reason to put a service role key
> anywhere a browser or this repository can reach.

---

## Commands

```bash
npm install
npm run dev            # local, http://localhost:4321
npm run build          # static output to dist/
npm run test           # vitest
npm run test:e2e       # playwright, includes axe checks
npm run lint
```

CI runs `lint`, `test`, `build` and `test:e2e` on every pull request. All four must pass.

---

## Definition of done

Checkable, in order. Each is a thing someone can verify rather than a thing someone can
feel.

1. `npm run build` succeeds with no TypeScript errors.
2. Lint and format are clean.
3. Unit tests cover the validation schema, including rejection cases.
4. Playwright passes, **including axe with zero violations** on every page.
5. The form submits successfully **with JavaScript disabled** in the browser.
6. A submission creates exactly one row with exactly the four expected fields.
7. Duplicate submission of the same address does not create a second row, and does not
   error at the user.
8. Malformed input is rejected server-side with a message attached to the offending field.
9. The page is legible and operable at 320 px width.
10. Lighthouse accessibility ≥ 95; no render-blocking third-party requests.
11. Deployed via Workers Builds and reachable at its `workers.dev` address.
12. `new.southvillerunningclub.co.uk/nn` serves over HTTPS with a valid certificate —
    the Custom Domain that [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md)
    puts on `apps/main`, not a CNAME added by hand. See the [Cloudflare
    runbook](runbooks/cloudflare-setup.md).
13. **Club email still works** — send and receive a test message on a club address
    afterwards. A Worker custom domain cannot affect mail, and confirming it costs a
    minute.
14. Both volunteers can reach the Cloudflare project, the Supabase project and the
    repository.

---

## Stop and ask

Triggers that end the build step and require a human. An agent must not resolve these by
inference.

- Any request to **collect a field beyond what is specified**. *Amended 13 August 2026: the
  committee has settled the entry field list; anything beyond it still stops here.*
- ~~Any request to **take payment**, or to link to something that does.~~ **Amended
  13 August 2026: payment is in scope**, authorised by the treasurer. Card details still
  never touch club systems — Stripe Checkout, hosted by Stripe.
- Any DNS change **other than** the single additive CNAME.
- The **race date**, entry price, or any factual claim about the race not already
  supplied.
- Anything requiring the **Supabase service role key**.
- Any change touching the **timing platform**.
- Anything that would put a **credential in the repository**.
- Discovering that the free tier's terms differ from [what is
  recorded](../solutions/platform-options.md#validation-register).

---

## Deliberately left open

Not oversights. **Do not invent values for these** — leave a clearly marked placeholder
and flag it.

| | Status |
| --- | --- |
| ~~**Race date**~~ | **Confirmed 12 August 2026 — Sunday 1 November 2026, start 11:00.** Settled by the club's published campaign artwork. It went in as the one-line edit this row predicted, with no change to any page |
| **2026 ARC permit number** | **Not yet issued**, and now the only race fact outstanding. `race.permit` is `null` and renders as "To be confirmed". **The 2023 number is not a stand-in for it** |
| **Page copy** | **Committee's to write, and still is.** The four Nightingale Nightmare pages now carry a draft written to be edited rather than a decision taken on the committee's behalf. Six questions the draft could not answer are listed under [what the race pages still need](phases.md#what-the-race-pages-still-need-from-the-committee) |
| ~~**Entry price**~~ | **Confirmed 13 August 2026 — £15 affiliated, £17 unaffiliated, £0 for a visually impaired runner's guide.** They live in `entries.fees.price_pence` and nowhere else; no page quotes a figure from its own markup |
| **Entry open and close times** | **Not decided.** `entries.events.entries_open_at` is `null`, which `/nn/` renders as the interest form. A placeholder here would be a published claim about when a race opens |
| ~~**The minimum age**~~ | **Confirmed 13 August 2026 — 18 on race day.** It was `null` while it was only *implied* by the youngest prize category. Landing it was the one `update` this row predicted, in a migration, **with no change to the form, the schema module or any markup**. Applied in three places: the form, the browser enhancement, and `entries.create_pending_purchase()`, which is the control |
| **The entry terms** | **Not written.** The form's checkbox says so and links to nothing, because a link to a page that does not exist is worse than an admission that it does not. **They have to land before entries open** |
| ~~**Whether the LHGRC discount code returns**~~ | **Confirmed 28 August 2026 — it returns.** 10% off an **unaffiliated** entry, capped at 22, exactly as in 2023. **Amended 30 August 2026 — the allocation is 25**, raised by `20260830120000_nn_2026_lhg_twenty_five_places.sql` ([#157](https://github.com/southville-running-club/src-website/issues/157)); a larger ceiling cannot conflict with places already taken. The row carries `fee_id` now, because "10% off an unaffiliated entry" is two facts and `percent_off` was only one of them. **The code is not in this repository and never will be** — this repo is public, so a code in a migration is a published code — and is inserted by hand from [the runbook](runbooks/entries-discount-codes.md). The 10% is **£2, which is the ARC levy the club still owes**, so the club nets £16 rather than £18 on each of the 25 |
| ~~**How a free place is taken**~~ | **Settled 28 August 2026 — a free place is given, not sold at a price of nothing.** Stripe refuses a zero-total Checkout session and will not charge below £0.30, so no discount code can produce one. Somebody holding `nn.entry.create` assigns a **complimentary** place from `/admin/nn/`: a `paid` purchase at £0, audited, re-checking capacity, the minimum age and one-runner-one-place — [ADR-028](../architecture/decisions/adr-028-a-place-can-be-given.md). It is what the two Kinsi places use. **A visually impaired runner's guide no longer needs one**: the guide rides on the runner's own entry and takes one of the 250 — [ADR-022](../architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md) |
| **Whether Stripe adaptive pricing stays off** | **Turned off, and reversible in one line.** It is on by default and would present and charge a converted amount to somebody paying from abroad — a second version of a price this build keeps in one place, at a rate nobody chose. Off means everybody is charged the `entries.fees` row in sterling. The treasurer may want the other answer |
| **Age categories for non-binary runners** | **Unresolved, and the club's to resolve.** The 2023 form offered the option and there were no categories to receive it. The form records the answer and says plainly that the categories are undecided. [ADR-020](../architecture/decisions/adr-020-race-category-and-gender-are-two-questions.md) makes the gap smaller and does not close it: the three options are now labelled the **race category** and there is an optional free-text gender question beside them, so somebody who is on none of the three has somewhere to say so — but there is still no band to award them |
| **Where the rows land** | `intake.nn_interest` — settled by [ADR-002](../architecture/decisions/adr-002-schema-layout.md), migrated, and **now reachable**: the column-scoped grant, the anonymous-insert policy and the form all landed together, in the pull request that could test them |
| **The privacy notice's open decisions** | **Four until 30 August 2026, and one now.** The club asked for the committee's privacy document to be published word for word on `/nn/privacy/`, and that document answers three: it gives the data contact, and it has a section of its own on photographs — so the `photographs` key came out of `race.json` altogether — while how long an entry is kept is a settled sentence in `privacy.entryRetention`, which the rewritten page no longer reads. **Still open, and unanswered anywhere: whether an email address is kept to tell people about next year's race.** `privacy.emailRetention` is `null` and inventing it would be a legal claim nobody authorised — but it is **published on no page now**: that notice interpolates only the controller, the company number, the contact and the date, all four settled, so it renders no "To be confirmed by the club" marker at all and `nn-privacy.spec.ts` counts zero. The registered office and the one-month medical retention are settled too and still in `race.json`; **the notice no longer prints either**, and `medicalRetention` stays because `entries-retention.test.ts` ties it to `entries.events.medical_retention` |
| **Whether an unconsented submission is stored** | **Open.** Consent is currently *required to submit* — `z.literal(true)` in the schema and `required` on the checkbox. The migration's `with check` is deliberately silent on consent, so reversing this is two lines of TypeScript and **no second migration** |

---

## Why this stack is cheap to be wrong about

Worth stating, because it is the property that justified starting before the platform
decision was final.

The output is **static HTML plus one function**. If the club later chooses Netlify, the
Astro build is unchanged and the Worker route becomes a Netlify Function — a file move
and a signature change. If it chooses Workers after the nameserver move, the same code
runs with an adapter added. **The data never moves at all.**

Nothing here commits the club to anything it cannot undo in an afternoon.
