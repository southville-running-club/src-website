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

## Scope

| | |
| --- | --- |
| **Build** | A public page describing the race, and a form capturing name and email |
| **Host** | Cloudflare Pages, custom subdomain `nn.southvillerunningclub.co.uk` |
| **Store** | Supabase Postgres, `eu-west-2` |
| **Do not build** | Payments, entry forms, results, accounts, admin surfaces |

This is one page and one form. Scope creep is the main risk to the deadline, and the
second main risk is collecting personal data nobody asked for.

---

## The adapter constraint — read this before choosing anything

**`@astrojs/cloudflare` v13 (March 2026) dropped Cloudflare Pages support** in favour of
Workers, and v14 requires Astro 6. The last adapter version supporting Pages was v12.

Cloudflare Workers, meanwhile, **cannot serve a hostname whose nameservers are not managed
by Cloudflare** — and the club's zone is at Fasthosts until the apex cutover before April.

That is a genuine pincer, and it has a clean way out:

> **Build the site as static Astro with no adapter at all, and write the form endpoint
> as a plain Cloudflare Pages Function.**

| | |
| --- | --- |
| **Static Astro** needs no adapter, so the Pages-support question never arises | No version pinning, no deprecated toolchain |
| **Pages Functions** are Cloudflare's own convention — a `functions/` directory, framework-agnostic | Full Workers runtime for the dynamic part |
| **Pages serves a subdomain from third-party DNS** | One CNAME at Fasthosts, nothing existing touched |

For a page and a form this costs nothing — there is no server-rendered content in v1. When
the nameservers move to Cloudflare before April, the site can adopt Astro 6 with the
`@astrojs/cloudflare` adapter on Workers for the full website build, and this project
migrates with it.

**Do not pin adapter v12 to get SSR on Pages.** It starts new work on a superseded
toolchain to buy something v1 does not need.

---

## Stack

Every line is a decision, not a suggestion. Deviating from one requires a note in the pull
request saying why.

| | Choice | Why this and not the alternative |
| --- | --- | --- |
| **Language** | TypeScript, `strict: true` | [Convergence](../foundations/requirements.md#convergence) with the timing platform |
| **Framework** | **Astro**, current stable (6.x) | Content-shaped site; ships zero JS by default; adapters for every candidate host, so the hosting decision stays cheap |
| **Render mode** | `output: 'static'` — **no adapter** | Sidesteps the Pages/Workers adapter split entirely. See above |
| **Dynamic endpoint** | **Cloudflare Pages Function** in `functions/` | Framework-agnostic, full Workers runtime, survives a framework change |
| **Runtime (tooling)** | Node.js LTS (22.x), pinned in `.nvmrc` | Boring |
| **Package manager** | **npm**, lockfile committed | [Boring is a hard requirement](../foundations/requirements.md#people). pnpm is better and less universally known |
| **Styling** | Vanilla CSS with custom properties, one stylesheet | A third volunteer can read it cold. No build step, no framework vocabulary to learn, smallest payload on poor signal |
| **Data client** | `@supabase/supabase-js` | Already the club's client in the timing platform |
| **Validation** | **Zod**, schema shared between client and server | One definition; server-side validation is non-negotiable |
| **Unit tests** | **Vitest** | Astro's own default |
| **Browser tests** | **Playwright**, with `@axe-core/playwright` | Accessibility is a stated requirement, so it is tested, not asserted |
| **Lint / format** | ESLint + Prettier | Mainstream over fast |
| **CI** | GitHub Actions | Already where the club's code lives |
| **Deploy** | Cloudflare Pages git integration, build on push to `main`, preview per pull request | No deploy credentials in CI to leak |
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

```
nn-src/
├── .github/workflows/ci.yml
├── .nvmrc
├── functions/
│   └── api/
│       └── signup.ts          Pages Function — POST handler
├── src/
│   ├── content/
│   │   └── race.json          Race facts as data, not prose in markup
│   ├── layouts/
│   ├── pages/
│   │   ├── index.astro
│   │   └── privacy.astro
│   └── styles/
├── tests/
│   ├── unit/
│   └── e2e/
├── astro.config.mjs
├── tsconfig.json
└── README.md                  How to run it, and every manual step taken
```

**`src/content/race.json` is load-bearing.** The race date is unconfirmed, so every fact
that might change — date, time, distance, price, location — lives in one file as data.
Changing the date must be a one-line edit, not a search through markup.

---

## Hard rules

Violating any of these is a defect, not a judgement call.

**Data**

- Store **name, email, consent, timestamp**. Nothing else. Not date of birth, not phone,
  not emergency contact, not England Athletics number — see
  [C10](../foundations/requirements.md#c10--hold-personal-data-lawfully).
- Adding a column is a decision for the committee, not for the build.
- Timestamps stored **UTC**, displayed **`Europe/London`**.
- The **anon key only** in client-visible code. The service role key never reaches the
  browser and never enters the repository. Row-level security does the enforcing.

**Payments**

- **No payment code of any kind.** No Stripe dependency, no price in a checkout, no
  "coming soon" button that takes a card. The [governance
  gates](../foundations/requirements.md#legal-and-governance) are not satisfied, and
  free-tier commercial-use terms turn on this.

**DNS**

- **One CNAME**, `nn` → `<project>.pages.dev`, added at Fasthosts.
- **Associate the custom domain in the Cloudflare dashboard first**, then add the CNAME.
  Reversing the order produces a 522.
- **Never modify or delete an existing record.** Additive only.

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
| `PUBLIC_SUPABASE_URL` | Pages project env vars, and `.env` locally | Safe to expose |
| `PUBLIC_SUPABASE_ANON_KEY` | Pages project env vars, and `.env` locally | Safe to expose; RLS enforces access |

`.env` is gitignored. `.env.example` is committed with empty values. **No third variable
should be needed** — if the build seems to want a service role key, the row-level security
policy is wrong and that is the thing to fix.

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
11. Deployed to `<project>.pages.dev` and reachable.
12. Custom domain associated in the dashboard, CNAME added,
    `nn.southvillerunningclub.co.uk` serves over HTTPS with a valid certificate.
13. **Club email still works** — send and receive a test message on a club address
    afterwards. The CNAME cannot affect mail, and confirming it costs a minute.
14. Both volunteers can reach the Cloudflare project, the Supabase project and the
    repository.

---

## Stop and ask

Triggers that end the build step and require a human. An agent must not resolve these by
inference.

- Any request to **collect a field beyond name and email**.
- Any request to **take payment**, or to link to something that does.
- Any DNS change **other than** the single additive CNAME.
- The **race date**, entry price, or any factual claim about the race not already
  supplied.
- Anything requiring the **Supabase service role key**.
- Any change touching the **timing platform**.
- Anything that would put a **credential in the repository**.
- Discovering that the free tier's terms differ from [what is
  recorded](../solutions/platform-options.md#verify-before-deciding).

---

## Deliberately left open

Not oversights. **Do not invent values for these** — leave a clearly marked placeholder
and flag it.

| | Status |
| --- | --- |
| **Race date** | Unconfirmed — 25 October or 1 November 2026. Build so the page reads correctly *without* a date |
| **Page copy** | Committee's to write |
| **Entry price** | Assumed £8–£10, unconfirmed, and not needed for v1 |
| **Where the rows land** | New schema in the existing Supabase project, or a second project. Needs deciding before the form persists anything |
| **Cloudflare or Netlify long-term** | Does not affect this build. Both serve a subdomain by CNAME and both run this output unchanged |

---

## Why this stack is cheap to be wrong about

Worth stating, because it is the property that justified starting before the platform
decision was final.

The output is **static HTML plus one function**. If the club later chooses Netlify, the
Astro build is unchanged and the Pages Function becomes a Netlify Function — a file move
and a signature change. If it chooses Workers after the nameserver move, the same code
runs with an adapter added. **The data never moves at all.**

Nothing here commits the club to anything it cannot undo in an afternoon.
