# Walkthrough — the manual steps still between here and member accounts

**Everything on this page is a thing a person does in somebody else's dashboard.** No
application code, no migration — only the four small pull requests that record what was done.
It exists because [`accounts-open.md`](docs/delivery/runbooks/accounts-open.md) is the *gate*,
the list of what must be true before the club announces accounts, and three of its boxes cannot
be ticked by anybody who has not first sat in Resend, Google Cloud and Cloudflare for an
evening. This is that evening.

> ## Where this actually got to — 25 August 2026
>
> **This page was written before any of it was attempted. Some of it is now history rather
> than instruction**, and this box is the difference so nobody follows a step that is done.
>
> | Step | State |
> | --- | --- |
> | **1 — Resend SMTP** | **1.1–1.7 done, and 1.7 landed differently from how this page describes it** — the base block stays `enabled = false` and `[remotes.production]` turns it on for production alone, because CI and laptops hold a placeholder key and GoTrue really dials out. **Still unverified where it counts: no confirmation email has reached a real inbox**, and no local check can prove the override applied. Read the `deploy-db` run, then send one |
> | **2 — Google OAuth** | **Parked, deliberately.** No Cloud project exists. It gates nothing — see [below](#step-2--the-google-cloud-oauth-client) |
> | **3 — the WAF rules** | **`C1` is live**, and it is the *only* rule the free plan can express. **Step 3.1's answer was worse than this page assumed** — 10 seconds is the ceiling on both the period and the mitigation, which guts A1's and A3's reasoning. [The rules file](docs/reference/cloudflare-waf-rules.md#what-the-free-plan-actually-allows--measured-25-august-2026) is the record. **Nobody has watched it fire** |
> | **4 — the rest** | Untouched. 4.1 and 4.2 are both still stop conditions |
>
> **Two things this page got wrong**, corrected in place below: `/account/callback/` **is**
> built (in this pull request), and the free plan's binding constraint was never the rule
> count.

**Read [the one rule that governs half of it](#the-one-rule-that-governs-half-of-this-page)
before you start.** It is the reason step 1 is step 1, and it is the reason a plausible tidy-up
in `config.toml` has already cost this repository four red deploys.

| | |
| --- | --- |
| **Prerequisites** | Cloudflare dashboard, GitHub repository admin, the club's Supabase project, a club-owned Google account, `admin@southvillerunningclub.co.uk`, and a personal Gmail to receive test mail |
| **Effort** | **About three hours**, of which maybe forty minutes is typing and the rest is waiting for DNS and reading a mail header |
| **What it unblocks** | [#50](https://github.com/southville-running-club/src-website/issues/50), [#56](https://github.com/southville-running-club/src-website/issues/56), the dashboard half of [#19](https://github.com/southville-running-club/src-website/issues/19) and [#64](https://github.com/southville-running-club/src-website/issues/64), and — as a consequence rather than directly — [#54](https://github.com/southville-running-club/src-website/issues/54) |
| **What it does not do** | Announce accounts. That is [step 4 of the accounts-open runbook](docs/delivery/runbooks/accounts-open.md#step-4--tell-people) and it stays there |

---

## Who does which part

Same tags as [opening entries](docs/delivery/runbooks/entries-open.md#who-does-which-part) and
[opening accounts](docs/delivery/runbooks/accounts-open.md#who-does-which-part), same reason:
nobody should have to read the whole page to find their half.

| Tag | Means | Today |
| --- | --- | --- |
| **⚙️ Ops** | Resend, Google Cloud, Cloudflare, GitHub secrets, Supabase | Mark |
| **🏁 Race pages** | What a member reads, and the walk-through from outside | Bindal |
| **🏛️ Committee** | Not a build decision at all. Somebody has to chase it | Both, to ask |
| **👥 Both** | Do it together, in the same room or the same call | — |

**Almost all of this page is ⚙️ Ops and can be done alone.** The two exceptions are marked, and
they are the two that produce evidence rather than configuration:
[watching a rule fire](#33--watch-a-rule-fire) and
[proving the captcha secret substituted](#41--prove-the-captcha-secret-is-not-an-empty-string).

---

## The one rule that governs half of this page

> **Any edit to `[auth]` in [`config.toml`](platform/packages/db/supabase/config.toml) ships to
> production on the next merge that touches a migration — and there is no partial apply.**

`config.toml` is on [`deploy-db.yml`](.github/workflows/deploy-db.yml)'s path filter. The
workflow runs `supabase db push` and *then* `supabase config push --yes`, and that second
command sends **the whole file**. One rejected value takes `site_url`, the redirect allowlist,
`enable_signup` and the captcha secret down with it — while `db push`, which ran first, goes on
succeeding. So the run reads as half-done rather than broken.

That is [#79](https://github.com/southville-running-club/src-website/issues/79), and it cost
**four red deploys** between 25 August 2026 and the day the offending block was commented out.

**The specific value that did it, and the shape of the trap:**

- **No email-template block may be declared at all** while the project is on the free tier's
  default mail provider. The management API answers `400 Email template modification is not
  available for free tier projects using the default email provider`.
- **`enabled = false` is not enough.** The CLI serialises the section whenever it is *present*
  in the file, filling in a `subject` it was not given — so `config push` kept sending
  `subject = ""`, and an empty subject is still a template modification. **Commented out is the
  known-good state**, not merely a tidy one.
- `packages/db/tests/unit/config.test.ts` asserts both halves and goes red before a deploy does
  — see [what step 1 flips](#what-step-1-unlocks-and-the-test-that-flips-with-it).

**And here is the part that makes step 1 first rather than third: that constraint lifts the
moment a custom SMTP provider is configured.** The API's own error names two escapes — upgrade
the plan, or configure custom SMTP — and only the second is the club's plan. So:

```
Step 1 (Resend SMTP)  →  the template restriction lifts
                      →  [auth.email.notification.password_changed] becomes pushable
                      →  #54's last unmet box can finally be ticked
```

[#54](https://github.com/southville-running-club/src-website/issues/54) is open **for that one
box and nothing else.** Its own closing comment says the three pages were built and merged, and
that it stays open until #50 lands Resend rather than being closed on a promise. **Nothing else
on this page unblocks it.** Doing steps 2 and 3 first is not wrong; it just leaves #54 exactly
where it is.

---

## The true state today, which is not what the tracker says

**Checked against the repository on 25 August 2026.** Several of these differ from what a reader
would assume from the issue list, and each difference is worth knowing before you start.

| | What is actually true | Where that is recorded |
| --- | --- | --- |
| **Resend account** | **Already exists** under a club address, and `send.southvillerunningclub.co.uk` **is verified** — done 25 Aug 2026 via Resend's own Cloudflare auto-configure | [the design doc](docs/solutions/resend-programmatic-email.md) |
| **`RESEND_API_KEY`** | **Set as a Worker secret** on `apps/main`, scoped to Sending access only | [manual step 12](platform/apps/main/README.md#manual-steps) |
| **The Resend DNS records** | **Not captured** in [`current-state.md`](docs/foundations/current-state.md#dns-and-email). Its zone table is still the 6 August 18-record capture, with no `send.` bounce subdomain and no Resend DKIM. **That is drift** in exactly the sense [ADR-005](docs/architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) means it |  — |
| **`[auth.email.smtp]`** | **Still the CLI's commented-out SendGrid sample**, lines 414–422. Production GoTrue is on the free tier's default sender at **two emails per hour, account-wide** | `config.toml` |
| **A previous SMTP attempt** | **Tried and reverted the same day**, on port **465**. Read [the post-mortem](#before-you-touch-configtoml-read-the-attempt-that-failed) before repeating it | [the design doc](docs/solutions/resend-programmatic-email.md) |
| **#50's state** | `gh issue view 50` says **OPEN**, not closed. The brief for this walkthrough said closed; it is the tracker that is wrong, not the code | GitHub |
| **The WAF rules** | **None of the five exists in the dashboard.** Every row of [the rules file](docs/reference/cloudflare-waf-rules.md#the-rules) says *Not created*, and [manual step 11](platform/apps/main/README.md#manual-steps) says *pending* | the rules file |
| **#19 and #64** | **Both CLOSED as completed**, 15 Aug and 25 Aug 2026. They were closed on the *written-down* half — the runbook, the reviewable artefact, and `[auth.rate_limit]`'s chosen values. **The dashboard half was never done.** Per ADR-005 the status column is the record, and it says nothing is live | GitHub, and the rules file |
| **`[auth.external.google]`** | **Does not exist in `config.toml` at all** — not enabled, not commented out. `google` appears only inside the CLI's own list-of-providers comment | `config.toml` |
| **`/account/callback/`** | **Does not exist.** No route in `worker/`, no page. [#55](https://github.com/southville-running-club/src-website/issues/55) is unbuilt, and #56 is blocked on it | `platform/apps/main/worker/` |
| **`docs/delivery/runbooks/google-oauth.md`** | **Does not exist**, and #56's *done when* list requires it | — |
| **The site-wide privacy notice** | **Published** — `src/pages/privacy.astro` exists and [#60](https://github.com/southville-running-club/src-website/issues/60) is closed. **The accounts-open runbook's stop-condition table still lists it as blocking**, and is stale there | — |

> **Two of those deserve saying out loud.** A closed issue is not evidence a dashboard rule
> exists, and a verified sending domain is not evidence GoTrue can use it. Neither gap is
> visible from the issue list — which is precisely the failure ADR-005's status column was
> written to catch.

---

## Stop conditions

Do not continue past a line that is true. Each ends the sitting; say what you found and wait.

| | Why it stops the run |
| --- | --- |
| **Resend's free tier no longer allows team members, or its sending cap has changed** | A free tier's terms differing from what is recorded is its own [stop-and-ask](docs/architecture/principles.md#stop-and-ask). The design doc already flags team membership as unverified |
| **The SPF record would exceed ten DNS lookups** | It becomes permanently invalid, and under `p=none` **it fails silently**. Fix the record before adding anything — [1.4](#14--the-spf-ten-lookup-limit) |
| **Cloudflare's free plan allows fewer rate-limiting rules than you need** | Same stop-and-ask. [The combined expression](docs/reference/cloudflare-waf-rules.md#what-the-free-plan-actually-allows--measured-25-august-2026) exists, and **read what it costs before creating it** |
| **The Google OAuth client would live under a personal Google account** | [No system is reachable by only one person](docs/architecture/principles.md#no-system-is-reachable-by-only-one-person). Four already are; a fifth is a decision, not a shortcut |
| **A `config.toml` edit is about to merge without a green `config.test.ts`** | That is [#79](https://github.com/southville-running-club/src-website/issues/79) happening again, and the test exists to make it a red pipeline instead of a red deploy |
| **You are tempted to add `[auth.email.notification.password_changed]` alongside `[auth.email.smtp]`** | One change per pull request, and the repository is **squash-only** — two unrelated things become one commit that cannot be reverted apart. See [1.8](#18--what-not-to-put-in-the-same-pull-request) |

---

## The order, and what actually depends on what

**Only one dependency on this page is real.** Everything else is ordered by the cost of being
wrong.

| | Depends on | Why |
| --- | --- | --- |
| **1. Resend SMTP** | Nothing | And it must be first, because it is the only thing that lifts the template restriction and therefore the only thing that moves #54 |
| **2. Google OAuth client** | Nothing on this page | The client and its secret can be created today and sit harmlessly unused. **It will not sign anybody in until [#55](https://github.com/southville-running-club/src-website/issues/55) builds `/account/callback/`** — [2.6](#26--what-this-does-not-switch-on) |
| **3. The WAF rules** | Nothing | But **A3 protects the endpoint step 1 makes expensive.** Before Resend, `/account/reset/` could mailbomb an address at two an hour; after it, sixty. Doing 3 before 1 is defensible; doing 1 and never doing 3 is not |
| **4. The rest of the gate** | 1 and 3 | Except [4.1](#41--prove-the-captcha-secret-is-not-an-empty-string) and [4.2](#42--register-the-clubs-admin-address), which are independent of both and can be done any time |

**If you only have an hour: do step 1.** It is the one with a consequence beyond itself.

---

# Step 1 — Resend SMTP for GoTrue

> **⚙️ Ops.** [#50](https://github.com/southville-running-club/src-website/issues/50).
> About ninety minutes, most of it waiting for DNS and reading one mail header.

**What.** Point Supabase's GoTrue mailer at Resend's **SMTP relay**, so that confirmations,
resets and — later — magic links leave the building at all.

**Why.** Supabase's built-in sender is capped at **two emails an hour for the whole project**,
whatever `[auth.rate_limit] email_sent = 60` says. Every account flow is an email, and **the
failure is silent**: the third person to sign up in an hour never receives anything and sees no
error. `email_sent = 60` was chosen for the day this step lands, not for today — `config.toml`'s
own comment says so.

> ### GoTrue needs SMTP, not the REST API
>
> **This is the one thing the design document did not anticipate**, and the thing most likely to
> send you down the wrong path. [The Resend design
> doc](docs/solutions/resend-programmatic-email.md) is written for a **Worker** calling Resend's
> HTTPS API with `RESEND_API_KEY`. **GoTrue cannot do that.** `[auth.email.smtp]` speaks SMTP
> and nothing else.
>
> | | |
> | --- | --- |
> | Host | `smtp.resend.com` |
> | Port | **`587`** — STARTTLS. The attempt that failed used 465; see [the post-mortem](#before-you-touch-configtoml-read-the-attempt-that-failed) |
> | User | `resend` — the literal string, not an address |
> | Password | **the Resend API key**, the same opaque string the REST API takes |
>
> Same account, same verified subdomain, same DNS, same key. It means the key lands in **two**
> places: a Worker secret (already done, for a send path not yet built) and now a **GitHub
> repository secret** for `config.toml`'s `env(...)` substitution.

---

## 1.1 — the Resend account, and who can reach it

**Most of this is already done — check it rather than redo it.** The account exists as of
25 August 2026.

- [ ] The account is under **`admin@southvillerunningclub.co.uk`**, not a personal Gmail. That
      is the exact complaint [email.md](docs/solutions/email.md) raises about the current
      forwarding arrangement
- [ ] **Both volunteers are team members inside Resend.** If the free tier does not allow team
      members, **stop** — that is a free-tier terms question, and the fallback is a shared
      credential stored the way any other shared club credential is, which is a decision rather
      than a default
- [ ] Two-factor is on, or there is a written reason it is not

**Verify:** sign out and have the *other* volunteer sign in. That is the whole test, and it is
the one nobody runs.

**Undo:** removing a team member is immediate and reversible. Deleting the account is not — it
takes the verified domain with it and leaves the DNS records as orphans.

---

## 1.2 — the sending subdomain

**Already verified.** `send.southvillerunningclub.co.uk`, per the design doc.

- [ ] Resend's dashboard shows the domain **Verified**, not *Pending*. A domain can fall back to
      pending if a record underneath it is edited
- [ ] It is `send.`, **not `mail.`** — `mail` is the MX target for the Fasthosts mailboxes, and
      putting application sending on it is exactly what the dedicated subdomain exists to avoid
- [ ] It is not the bare domain either, so a bad run of application mail can never touch the
      domain's core SPF/DKIM/DMARC posture

**Redo:** delete the domain in Resend and add it again. It regenerates the records; the old ones
in Cloudflare become inert rather than harmful.

---

## 1.3 — the DNS records, in Cloudflare, DNS-only

**The nameservers moved to Cloudflare on 8 August 2026**
([runbook](docs/delivery/runbooks/nameserver-move.md), executed). So these records are added in
**Cloudflare's DNS dashboard**, not at Fasthosts — Fasthosts is still the mail *server* the MX
points at, and has not been where records are edited since that date.

**Additive only.** This is [Move 1](docs/solutions/dns-and-domain.md) in the DNS document — no
risk, reversible by deleting the records.

- [ ] **Every new record is grey-clouded / DNS-only, never proxied.** Cloudflare proxies HTTP
      and HTTPS only; a proxied DKIM CNAME or SPF TXT simply does not behave as the record it is
      supposed to be
- [ ] The DKIM CNAMEs are scoped to the `send.` subdomain — e.g.
      `resend._domainkey.send.southvillerunningclub.co.uk` — and are **isolated from the
      mailboxes' four `livemail1-4._domainkey` records**, which are untouched
- [ ] The `send.send.` bounce subdomain exists, matching what Resend's auto-configure created
- [ ] **The SPF record was EXTENDED, not replaced** — see [1.4](#14--the-spf-ten-lookup-limit)
- [ ] **DMARC needs no change.** The existing `_dmarc` TXT is `v=DMARC1; p=none;` with **no
      `sp=` override**, so it already covers subdomains

**Verify from a terminal, not from the dashboard.** The dashboard tells you what you typed; a
resolver tells you what the world sees.

```bash
dig +short TXT southvillerunningclub.co.uk @1.1.1.1
```

```bash
dig +short CNAME resend._domainkey.send.southvillerunningclub.co.uk @1.1.1.1
```

**Undo:** delete the added records. Mail routing is unaffected — nothing here is on the inbound
path, and the MX, the four livemail DKIM CNAMEs and `mail`'s A record are untouched throughout.

---

## 1.4 — the SPF ten-lookup limit

**This is the one mistake on the DNS half that fails silently, and silence is what makes it
expensive.**

The zone's record today is:

```
v=spf1 mx a include:_spf.livemail.co.uk ~all
```

`mx`, `a` and **each** `include:` consumes a DNS lookup, and `include:` counts recursively.
**Exceeding ten makes the record permanently invalid** — and under `p=none` nothing tells you.
Mail simply starts failing authentication somewhere nobody is looking.

- [ ] Count the lookups **after** adding Resend's `include:`, not before
- [ ] **Drop the `a` mechanism.** [email.md](docs/solutions/email.md) already flags that it does
      nothing useful here — the apex A records are Squarespace's, which never sends club mail —
      and removing it frees a lookup. **This is the one non-additive DNS edit on the page**, so
      make it deliberately and read the result back
- [ ] The target shape is roughly
      `v=spf1 mx include:_spf.livemail.co.uk include:<Resend's value> ~all`, with Resend
      publishing its exact `include:` at verification time
- [ ] Check the total with an SPF validator, or by walking the `include:` chain by hand

**Verify:** send the test mail in [1.9](#19--verify-it-for-real) and read
`Authentication-Results` in the raw header. `spf=pass` is the answer; **`spf=permerror` is the
ten-lookup failure by name.**

**Undo:** SPF is one TXT record. Put the old string back. Propagation is one TTL — 3600 seconds,
uniform across this zone.

---

## 1.5 — the API key

**Already done as a Worker secret. This step is about scope, not about creating a second key
by accident.**

- [ ] The key is scoped to **Sending access only**, never full account access. A full-access key
      can also read logs, manage domains and remove team members — so a leak of the right key is
      "somebody can send mail as the club", and a leak of the wrong one is "somebody can
      reconfigure the account"
- [ ] **Decide whether GoTrue gets its own key or shares `RESEND_API_KEY`.** A second key costs
      nothing and means rotating the Worker's send path later does not silently stop every
      confirmation email. **Recommended: a second key, named for GoTrue in Resend's dashboard**,
      so the audit trail says which system sent what

**Undo:** revoke the key in Resend. Mail stops immediately — nothing is lost, and nothing is
sent.

---

## 1.6 — `SUPABASE_AUTH_SMTP_PASSWORD` as a GitHub repository secret

**A GitHub Actions repository secret, not a Worker secret**, and the distinction is the one
[manual steps 9 and 10](platform/apps/main/README.md#manual-steps) already draw: `env(...)`
substitution in `config.toml` is read wherever `supabase config push` runs, which is
`deploy-db.yml`, not the Worker.

**It must exist BEFORE the block is uncommented, not after.** The Supabase CLI validates every
`env(...)` substitution at startup, and an unset one **breaks `supabase start` outright** rather
than shipping SMTP silently off. That is confirmed rather than theoretical — it is exactly what
happened to `[auth.captcha]` while #49 was being built.

- [ ] Repository → **Settings → Secrets and variables → Actions → New repository secret**
- [ ] Name: **`SUPABASE_AUTH_SMTP_PASSWORD`**
- [ ] Value: the Resend API key from [1.5](#15--the-api-key)
- [ ] **Do not paste it into a terminal that keeps history**, and do not put it in a
      `.dev.vars` on a shared machine

**Verify:** the secret appears in the list with no value shown. That is all GitHub will tell you
— the same masking problem [4.1](#41--prove-the-captcha-secret-is-not-an-empty-string) exists to
work around, and the same conclusion applies here: **a green `deploy-db` run proves the file was
accepted, not that the value is a real key.** The proof is [1.9](#19--verify-it-for-real).

**Rotate:** generate a new key in Resend, update the repository secret, re-run `deploy-db.yml`
by hand (`workflow_dispatch`), **then** revoke the old key. In that order — revoking first opens
a window where no mail sends at all.

---

## 1.7 — the `config.toml` edit

> **This is the only part of step 1 that is a pull request rather than a dashboard click, and it
> is the part that can take production down.** Re-read [the one
> rule](#the-one-rule-that-governs-half-of-this-page).

> ### ✅ Done, 26 August 2026 — but read what changed about *how*
>
> **The block is `enabled = false`, and that is not a retreat.** The experiment this section
> called for was run and it answered the open question: GoTrue really does dial out, and the
> port was never the whole story. So the block is turned on for **production only**, through
> `[remotes.production]`. The paragraphs below are kept as the record of how that was reached.

The block replacing `config.toml`'s commented-out SendGrid sample, and the override at the foot
of the same file:

```toml
[auth.email.smtp]
enabled = false                                        # CI and laptops: no real key, keep Inbucket
host = "smtp.resend.com"
port = 587
user = "resend"
pass = "env(SUPABASE_AUTH_SMTP_PASSWORD)"
admin_email = "noreply@send.southvillerunningclub.co.uk"
sender_name = "Southville Running Club"

# …at the foot of the file
[remotes.production]
project_id = "ketipxpyjjglwpqazsft"

[remotes.production.auth.email.smtp]
enabled = true                                         # production only, and only via config push
```

**Two things about that shape, both learned the hard way:**

- **`admin_email` is `noreply@`, not `accounts@`.** GoTrue has no `reply_to` field, so the
  `From` is where a reply goes — a sending subdomain with no MX, where it bounces. `accounts@`
  reads as a monitored mailbox and is not one; `noreply@` promises nothing it cannot keep. A
  working Reply button is [#99](https://github.com/southville-running-club/src-website/issues/99).
- **The override is one key long, and `config.test.ts` asserts that.** Everything else about
  production is stated once, in the base block, where the rest of that file's assertions can
  see it.

**Three things travel with it, and the pull request is wrong without them:**

1. **`deploy-db.yml`'s `env:` block** needs `SUPABASE_AUTH_SMTP_PASSWORD: ${{ secrets.… }}`.
   Without it the substitution resolves to empty and the CLI validates it as absent.
2. **`deploy-db.yml`'s "Check the secrets exist" step** lists four secrets by name and fails
   fast when one is missing. A fifth belongs on that list, or the confusing failure that step
   was written to prevent comes back wearing a different hat.
3. **`ci.yml` and `./dev`** need a value too, the way both already supply Cloudflare's published
   Turnstile testing secret for `SUPABASE_AUTH_CAPTCHA_SECRET`. **What value is the open
   question** — see immediately below.

### Before you touch `config.toml`, read the attempt that failed

**This was tried on 25 August 2026 and reverted the same day** — the pull request was closed
rather than merged, and `git revert` was used so the attempt survives in history (`0a862a4` and
`9ae4916`, reverted by `e1273ef` and `46881af`).

**What broke:** three database test files that call `auth.signUp()` — `entries-admin.test.ts`,
`identity-sessions.test.ts` and `identity.test.ts` — failed in CI, reproducibly across two runs,
with `AuthRetryableFetchError … status: 500`. The assumption that `[local_smtp]` intercepts
every outgoing mail regardless of what `[auth.email.smtp]` says **did not hold** in GitHub
Actions.

**What that attempt used and this page does not: port 465**, implicit TLS. A number of CI
providers block 465 by default to fight spam, and Resend supports 587 with STARTTLS as well.
**That is the untested first thing to try**, and it is why the block above says 587.

> **✅ Answered, 26 August 2026. It was not the port.** #98 shipped the block on **587 with
> STARTTLS** and it failed in exactly the same way — every `signUp()` in `identity.test.ts`,
> `identity-sessions.test.ts` and `entries-admin.test.ts` answering
> `AuthRetryableFetchError: Error sending confirmation email`, three suites and 116 tests, in
> run [32899420661](https://github.com/southville-running-club/src-website/actions/runs/32899420661).
>
> **So the assumption that `[local_smtp]` intercepts everything is simply false, on any port.**
> GoTrue dials whatever `[auth.email.smtp]` names, and CI and laptops hold a *placeholder*
> password. That is not a bug to fix — it is the reason the base block stays `enabled = false`
> and the production override exists.

**What is left unknown, and it is a smaller thing than this section assumed:** nobody has
captured **GoTrue's own container log** for a failing `signUp()`. `@supabase/auth-js` flattens
every server-side mail failure to a bare 500 with no SMTP-level detail, and neither `./dev` nor
`ci.yml` captures the auth container's logs. It would still be the fastest way to diagnose the
*next* mail problem, so it is worth doing one day — but it is no longer blocking anything.

### What step 1 unlocks, and the test that flips with it

`packages/db/tests/unit/config.test.ts` holds two assertions **written to invert on this exact
change**:

| Test | Expected | What happened at #50 | And at #101 |
| --- | --- | --- | --- |
| *is still on the default email provider…* | **Goes red.** Change it in the same commit | **Stayed green.** `customSmtp()` read the *base* block, which stays `false` | **Flipped** — it reads the override too now, and asserts `true` |
| *declares no email template block at all…* | **Stops forbidding templates on its own** | **Stayed live**, for the same reason | **Replaced.** It was a short-circuit that could not fail once a provider existed; it is an exact list now |

**The flip happened one pull request later than this page predicted, and the reason is worth
keeping.** `customSmtp()` used to ask a question about *this machine* — does the base block
dial out? — when #79's restriction is a fact about *the project the API is judging*. Those came
apart the moment #50 put the answer in `[remotes.production]`, and #101 is where the test caught
up with the distinction.

**The second row matters more than the first.** The old guard read
`customSmtp() ? [] : templateModifications()`, so the instant a custom provider existed it
compared `[]` to `[]` and could not fail — a line that still looks like coverage while testing
nothing, which this repository treats as worse than no test at all. It is an exact list of the
templates that have been argued for, so a new one is a decision in a diff.

✅ **The open question is closed, and #101's deploy is what closed it.** `config push` sends
`smtp_enabled` and the template fields in the **same request**, and nobody had established
whether the API judges that request against the config arriving or the config already there.
**It accepted them together** — run
[32957004799](https://github.com/southville-running-club/src-website/actions/runs/32957004799),
26 August 2026 — and a real confirmation then arrived at an Outlook mailbox carrying the club's
own hostname, all three authentication checks passing.

So **#79's restriction really is lifted by a custom SMTP provider**, which was the only half of
the API's own error message this club could act on. Templates are ordinary changes now.

⚠️ **One thing that looks like this failing and is not.** That deploy's first attempt went red at
step 7, `supabase migration list`, with `FATAL: (EAUTHQUERY) auth_query secret check timed out` —
a transient Supabase pooler error, *before* `db push` or `config push` ran. A red `deploy-db` on a
change touching `[auth]` looks exactly like #79 and need not be it. **Read which step failed**,
and re-run before reverting anything.

⚠️ **And [#54](https://github.com/southville-running-club/src-website/issues/54) is not
unlocked by this, which is the correction this page most needs.** #99's spike measured that
`password_changed_notification` is generated only when
`mailer.notifications.password_changed.enabled` is true — default `false` — which is set from
`[auth.email.notification.password_changed]`, the very section #79 got a 400 for. The mailer
decides *who delivers*; that flag decides *whether there is anything to deliver*. So the
password-changed notification is still gated on `config.toml`, and the Send Email Hook does not
rescue it either.

---

## 1.8 — what not to put in the same pull request

**The repository is squash-only**, so every commit in a branch collapses into one on `main`. Two
unrelated things in one pull request become one commit that cannot be reverted or bisected apart
— and this is precisely the change where you will want to revert exactly half of it.

- [ ] **Pull request A**: `[auth.email.smtp]`, the two `deploy-db.yml` edits, the CI/dev value,
      and the `config.test.ts` line that flips. One change: *turn on custom SMTP*.
- [ ] **Pull request B**, only after A is merged **and a real email has arrived**:
      `[auth.email.notification.password_changed]`, and closing #54.

Merging both at once means a failed template push takes SMTP down with it, and the revert takes
both back out. That is #79 with extra steps.

---

## 1.9 — verify it, for real

**A green deploy is not evidence.** The only proof is a message in a real inbox.

> **🏁 Race pages** or **⚙️ Ops** — either, but from a browser with no session on it.

- [ ] Register at `/account/sign-up/` on production **with a personal Gmail address**, not a
      club one. Gmail is where deliverability problems show up, which is the point
- [ ] The confirmation email **arrives**, and arrives in the inbox rather than in spam
- [ ] Open the raw source — Gmail's **Show original** — and confirm, in
      `Authentication-Results`:
      - [ ] `spf=pass`
      - [ ] `dkim=pass`
      - [ ] `dmarc=pass`
- [ ] The `From` name reads **Southville Running Club**, not a project id or a bare address
- [ ] **Reply to it, and confirm the reply lands in `info@southvillerunningclub.co.uk`**
- [ ] Send a **second and a third inside the same hour** and confirm both arrive. That is what
      proves the built-in two-an-hour cap is gone; one message proves nothing
- [ ] Request a password reset at `/account/reset/` and confirm that mail arrives too

**Undo, in full:** re-comment `[auth.email.smtp]` in a pull request. GoTrue falls straight back
to the built-in sender at two an hour — degraded, not broken. Everything else (the account, the
domain, the DNS, the key) can stay exactly where it is; none of it does any harm unused.

---

## 1.10 — record it

**Manual work is legitimate *because* it is recorded** — the [pragmatic
exception](docs/foundations/requirements.md). Four files, and they can share one pull request
because they are one change being written down.

| What to record | Where |
| --- | --- |
| **The Resend DNS records** — every one, with type, host, value and purpose, joining the existing zone table | [`docs/foundations/current-state.md`](docs/foundations/current-state.md#dns-and-email). **This is the drift found above**, and it is outstanding whether or not you do the SMTP half |
| The record count, which that table still states as *18 records, captured 6 August 2026* | the same table — it is no longer 18 |
| **That GoTrue uses SMTP rather than the REST API**, and that the status line no longer says backlogged | [`docs/solutions/resend-programmatic-email.md`](docs/solutions/resend-programmatic-email.md) |
| **A new manual-steps row** — what, why, by whom, how to redo — for `SUPABASE_AUTH_SMTP_PASSWORD`, beside the existing steps 9, 10 and 12 | [`platform/apps/main/README.md`](platform/apps/main/README.md#manual-steps) |
| Which Resend key GoTrue holds, and that it is scoped to sending only | the same table |
| **Resend as a named processor**, if the privacy notice is to say so | ⚠️ `nn-privacy.spec.ts` **actively asserts the word "Resend" does not appear** on the notice, because naming a processor the club does not use would be a false claim about a data flow. **The day the notice names it, that test changes in the same commit** |

- [ ] Tick step 0.2 in
      [accounts-open](docs/delivery/runbooks/accounts-open.md#02--email-actually-leaves-the-building)
- [ ] Close [#50](https://github.com/southville-running-club/src-website/issues/50)

---

# Step 2 — the Google Cloud OAuth client

> ## ⏸️ Parked, 25 August 2026 — not started, and gating nothing
>
> **No Google Cloud project exists**, and creating one needs a phone number the club does not
> have available. **That costs nothing on the critical path**, which is the point worth
> recording: Google sign-in is the only step on this page that is a prerequisite for nothing.
> [Opening accounts](docs/delivery/runbooks/accounts-open.md#stop-conditions) has no Google
> stop condition, and its step 0.5 box is conditional — *"if Google sign-in is on"* — and it
> is not.
>
> **The code is built and ships inert.** `[auth.external.google] enabled = false`,
> `GOOGLE_SIGN_IN: "off"` in both `vars` blocks, and `POST /account/google/` renders nothing.
> The magic link and `/account/data/` do not depend on any of it.
>
> ⚠️ **So this pull request says *Closes #56* and #56's first box — *sign in with Google
> works, end to end* — is not met.** The build half is done; the human half is not started.
> **Reopen #56, or close it and raise a smaller one for the switches**, rather than letting a
> closed issue imply a working button.
>
> **The steps below are still correct** for whenever it is picked up — and by then
> [`google-oauth.md`](docs/delivery/runbooks/google-oauth.md), which this pull request adds, is
> the better source. Two notes from the parking conversation that belong with it:
>
> - **A member who signs up through Google has no password.** Turning the button off later
>   strands them unless password reset can set one for an OAuth-created account. **Test that
>   before the button ever goes live** — it decides whether "Google broke" is an inconvenience
>   or a lockout.
> - **Sole ownership here is reversible**, unlike DNS or Supabase. Adding a second Owner is an
>   IAM change; swapping to a different client later is two strings, and GoTrue links on
>   verified email so members should be unaffected. Worth knowing when the account question
>   comes back.

> **⚙️ Ops.** [#56](https://github.com/southville-running-club/src-website/issues/56).
> About forty minutes.

**What.** An OAuth 2.0 client, under a club-owned Google account, whose secret becomes a GitHub
repository secret so that `[auth.external.google]` can be turned on later.

**Why.** The club's existing addresses already forward to Gmail, its documents are on Google
Drive, and most members will have a Google account open in the tab next door. "Sign in with
Google" removes a password from the equation for the people most likely to use the site once a
year and forget they ever had one.

> ### Read this before you start, so the forty minutes is not wasted
>
> **This step does not switch Google sign-in on**, and it cannot. See
> [2.6](#26--what-this-does-not-switch-on). What it does is remove Google Cloud from the
> critical path, so that when #55 and #56 are built the only thing left is a config block.

---

## 2.1 — a club-owned Google account, not a personal one

**This is the governance half, and it is the half that is hardest to undo later.**

[No system is reachable by only one
person](docs/architecture/principles.md#no-system-is-reachable-by-only-one-person).
[`current-state.md`](docs/foundations/current-state.md#accounts-and-access) records that **four
systems already are** — Fasthosts, Supabase, Vercel and the England Athletics portal — and that
the two volunteers cannot cover for one another. An OAuth client owned by a volunteer's personal
Google account would be a fifth, and the kind nobody would think to list.

- [ ] The Google Cloud project is created under an account the **club** controls
- [ ] **Both volunteers are Owners** on the Cloud project, not Editors and not Viewers. An
      Editor cannot add a second owner, which reproduces the problem one layer down
- [ ] **Stop** if the only path available is a personal Google account. That is a decision for
      both volunteers, not a shortcut for one

**Verify:** the other volunteer opens the Cloud console, finds the project, and can see the
OAuth client. If they cannot, this step is not done.

**Undo:** transferring project ownership is possible but fiddly. Deleting the project takes the
client and its secret with it — recoverable within Google's 30-day window, and after that not.

---

## 2.2 — the consent screen

- [ ] The **application name is the club's name** — *Southville Running Club* — and **not a
      project id**. This is the string a member reads on the "…wants access to your Google
      Account" page, and a project id there reads as a phishing attempt
- [ ] The support email is a **club address**, not a personal one
- [ ] User type is **External**, since members are not in a Google Workspace the club owns
- [ ] The privacy policy link points at `https://new.southvillerunningclub.co.uk/privacy/`,
      which exists as of [#60](https://github.com/southville-running-club/src-website/issues/60)
- [ ] **Publishing status:** while it is in *Testing*, only listed test users can sign in and
      consent expires after seven days. It has to be **In production** before a member uses it —
      but leaving it in Testing until #55 and #56 are built is the safer order

**Verify:** open the consent screen preview Google offers and read it as a member would.

---

## 2.3 — the scopes, and only these

- [ ] **`.../auth/userinfo.email` and `.../auth/userinfo.profile`, plus `openid`. Nothing else.**
- [ ] **No Drive, no Calendar, no Contacts.** Not "in case we need it later" — a scope that is
      requested is a scope the club is asking a member to grant, and a request for Drive access
      from a running club is a reason to close the tab
- [ ] Neither of these is a sensitive or restricted scope, which is what keeps the club out of
      Google's verification process entirely. **Adding one changes that**, and it would be a
      stop-and-ask rather than a checkbox

---

## 2.4 — the redirect URI, which is the standard first failure

> ### **The redirect URI you register at Google is SUPABASE's, not the club's.**
>
> ```
> https://ketipxpyjjglwpqazsft.supabase.co/auth/v1/callback
> ```
>
> **Not** `https://new.southvillerunningclub.co.uk/account/callback/`.

**Why it is the other way round from what everybody expects.** Google redirects the browser back
to whoever *initiated* the OAuth exchange, and that is GoTrue, not the club's Worker. GoTrue
takes the code, exchanges it for tokens, creates or links the account, **and only then** redirects
onward to `/account/callback/` on the club's hostname. The club's own address never appears in
Google's configuration at all.

**Getting it backwards is the standard first failure**, and it fails in a way that reads as
something else: Google answers `Error 400: redirect_uri_mismatch`, which looks like a typo in
the URL rather than a misunderstanding of which system is talking to which.

- [ ] **Authorised redirect URI** at Google:
      `https://ketipxpyjjglwpqazsft.supabase.co/auth/v1/callback` — exactly, with no trailing
      slash and no path variation
- [ ] The project ref is `ketipxpyjjglwpqazsft`, which is public: it is
      `PUBLIC_SUPABASE_URL` in `wrangler.jsonc` and is published in page source by design.
      **Confirm it against the Supabase dashboard anyway** rather than trusting this page
- [ ] **Authorised JavaScript origins** need nothing. The club's pages never call Google
      directly
- [ ] **The club's own path needs no allowlist entry either.** `config.toml`'s
      `additional_redirect_urls` already carries `https://new.southvillerunningclub.co.uk/**`,
      and its own comment says so: `/account/callback/` is a path under that wildcard. **That is
      the second-most-common wrong turn** — adding an exact entry means touching `[auth]`, which
      means [the one rule](#the-one-rule-that-governs-half-of-this-page), for no gain

**Verify — and this can be done today, before anything is built.** Paste an authorization URL
into a browser with the client id in it. **A correct client answers with Google's own consent
screen; a wrong redirect URI answers `redirect_uri_mismatch` before any consent screen at all.**
That distinction is the entire test, and it needs nothing on the club's side to exist yet.

**Undo:** editing the redirect URI list is immediate and free. Changes can take a few minutes to
propagate through Google's edge.

---

## 2.5 — the client secret, and rotating it

- [ ] **`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`** as a GitHub Actions repository secret, same
      place and same mechanism as [1.6](#16--supabase_auth_smtp_password-as-a-github-repository-secret).
      This is [manual step 10](platform/apps/main/README.md#manual-steps), currently *pending*
- [ ] **The client ID is not a secret** and goes in `config.toml` in clear, as `client_id`. Only
      the secret takes `env(...)`
- [ ] **Set it before `[auth.external.google]` is uncommented, not after.** Same startup-
      validation trap as every other `env(...)` substitution in that file
- [ ] Google shows the secret **once**. Put it in the GitHub secret immediately, and if it is
      lost, generate a new one rather than hunting for the old

**Rotating it**, which the club will need at some point and should rehearse the shape of:

1. Google Cloud console → the OAuth client → **Add secret**. Google supports two live secrets on
   one client, which is what makes a zero-downtime rotation possible.
2. Update the GitHub repository secret to the new value.
3. Re-run `deploy-db.yml` by hand (`workflow_dispatch`) so `config push` carries the new value.
4. **Confirm a real Google sign-in still works.**
5. **Then** delete the old secret at Google.

**Doing 5 before 4 breaks Google sign-in for everybody**, and the symptom — `invalid_client` —
appears only at the moment somebody tries to sign in, not in any deploy log.

---

## 2.6 — what this does not switch on

**`/account/callback/` does not exist.** There is no route for it in
`platform/apps/main/worker/` and no page for it in `src/pages/`.
[#55](https://github.com/southville-running-club/src-website/issues/55) — the magic link — is
what builds that address, and #56 is explicitly *blocked on #55* because both land on it.

So after this step:

| | |
| --- | --- |
| **What exists** | A club-owned Cloud project, a configured consent screen, an OAuth client, and a GitHub secret holding its client secret |
| **What does not** | `[auth.external.google]` in `config.toml`, the third button on the two account pages, and the address the redirect lands on |
| **What a member sees** | **Nothing has changed.** There is no third button, and nothing to click |
| **What it is worth** | Google Cloud is off the critical path. When #55 and #56 are built, the remaining work is a config block and a button, not an evening in somebody else's console |

**And one thing worth deciding now rather than discovering later**, because #56 names it as the
question that actually matters: somebody registers with a password, then later signs in with
Google using the same address. **GoTrue links them automatically** when the provider asserts a
verified email matching an existing account, and `enable_manual_linking` stays off. That is the
right default and the boring one — but it must be **tested in both directions** when #56 lands,
because the failure mode is a second empty account with the same address and a person who cannot
find their own entry.

---

## 2.7 — record it

| What to record | Where |
| --- | --- |
| **The Cloud project, and that both volunteers are owners** | [`current-state.md`](docs/foundations/current-state.md#accounts-and-access)'s access list. It is the file that counts how many systems are reachable by one person, and a new one belongs on it either way |
| The client ID, the redirect URI as registered, and which club account owns the project | the same list |
| **Manual step 10 moves from *pending* to done**, with the date and who did it | [`platform/apps/main/README.md`](platform/apps/main/README.md#manual-steps) |
| **`docs/delivery/runbooks/google-oauth.md`** — creating the client, the consent screen, **which redirect URI goes where**, and how to rotate the secret | It does not exist, and #56's *done when* requires it. **Steps 2.1–2.5 above are its first draft**; lifting them into a runbook is the deliverable |

- [ ] Tick the *`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` exists* box in
      [accounts-open step 0.5](docs/delivery/runbooks/accounts-open.md#05--the-platform-is-wired-up)
- [ ] **Leave [#56](https://github.com/southville-running-club/src-website/issues/56) open.** Its
      first *done when* box is *sign in with Google works, end to end*, and it does not

---

# Step 3 — the Cloudflare rate-limiting rules

> **⚙️ Ops** for creating them, **👥 Both** for proving one fires.
> [#19](https://github.com/southville-running-club/src-website/issues/19) and
> [#64](https://github.com/southville-running-club/src-website/issues/64). About an hour,
> including the mitigation period you have to wait out.

**What.** Five rate-limiting rules in the Cloudflare dashboard: **A1** sign in, **A2** sign up,
**A3** password reset, **A4** the admin surfaces, and **E1** the race forms.

**Why.** **This platform has no rate limit of any kind today.** `/account/sign-in/` checks a
credential, `/account/reset/` sends an email to an address the caller names, and
`POST /nn/2026/` holds a place in a 250-runner field for 31 minutes. **Turnstile is not a rate
limiter** — it raises the cost of a request, it does not cap them, and it does nothing at all
about a real person trying two hundred passwords.

**And this is the only layer that sees the runner's real address.** Every Supabase call the
Worker makes is server-side, so `[auth.rate_limit]`'s per-IP numbers count against a Cloudflare
egress address shared by the whole club. The two layers answer different questions and neither
substitutes for the other.

> ### Both issues are closed. Neither rule exists.
>
> #19 was closed 15 August and #64 on 25 August, both as *completed* — on the written-down half:
> the runbooks, the reviewable artefact, and `[auth.rate_limit]`'s deliberately chosen values.
> **Every status cell in [the rules
> file](docs/reference/cloudflare-waf-rules.md#the-rules) still says *Not created*,** and per
> [ADR-005](docs/architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) that file
> is the record, not the issue tracker.

---

## 3.1 — check what the plan actually allows, before creating anything

**Do this first.** The club is on Cloudflare's free plan, and its rate-limiting allowance is
smaller than five rules. **How much smaller changes, and finding that a free tier's terms differ
from what is recorded is its own [stop-and-ask](docs/architecture/principles.md#stop-and-ask).**

- [ ] How many rate-limiting rules the plan allows
- [ ] Which **periods** are offered — the rules file specifies 60s and 600s
- [ ] Which **mitigation durations** are offered — the file specifies 60s, 600s and 3600s.
      **Take the longest the plan offers and write down which**, rather than leaving the table
      describing a rule that does not exist
- [ ] Whether the block page can be customised on this plan. "Not on the free plan" is an
      acceptable answer; not having asked is not

**If exactly one rule is available**, [the combined
expression](docs/reference/cloudflare-waf-rules.md#what-the-free-plan-actually-allows--measured-25-august-2026) is written
out in the rules file — **and read what it costs before creating it.** One rule takes one
threshold, and it has to be the loosest of the five (20, E1's), because a combined rule set to
A2's three would block the entry form on the morning it matters most. **A3's mailbomb window
collapses from ten minutes to one**, which is the one that hurts. If that is the answer, the
honest next question is whether the account endpoints are worth a paid plan — the first thing on
this platform that would be.

---

## 3.2 — create them

Cloudflare dashboard → the zone → **Security → WAF → Rate limiting rules**.

**Work from [the committed copy](docs/reference/cloudflare-waf-rules.md#the-rules), not from
this page and not from memory.** That file holds the expression, threshold, period, action and
mitigation for each rule. This page holds only the order and the traps.

**The order, and it is not arbitrary:**

1. **A1** — sign in. The rule protecting the thing an attacker wants.
2. **A3** — password reset. The only endpoint whose cost lands on somebody who has never
   visited the site. **Step 1 makes this one more urgent, not less** — before Resend the built-in
   cap held it to two mails an hour by accident; after Resend the ceiling is sixty a minute and
   the WAF rule is the only thing in the way.
3. **A2**, then **A4**.
4. **E1** last, and only because it belongs to a different issue — not because it matters less.

- [ ] **Paste each expression rather than building it in the visual editor.** The rule builder's
      *Edit expression* box takes the text as written, and **a hand-built rule with one clause
      dropped looks identical to a correct one**
- [ ] **`POST /nn/stripe-webhook` is excluded from E1, deliberately.** Stripe's delivery volume
      is not a person's, and a block there stops a payment being *recorded* rather than stopping
      one being taken
- [ ] `http.host eq "new.southvillerunningclub.co.uk"` is in every expression on purpose — the
      zone also serves the Squarespace site at the apex, and none of these paths exists there.
      **It has an expiry date**: every row changes at the Squarespace cutover
      ([ADR-007](docs/architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md))
- [ ] **Then read each rule back from the dashboard and diff it against the file.** That is the
      drift detection, it is the same discipline ADR-005 applies to DNS, and it costs a minute

**Undo:** each rule has a disable toggle, which takes effect at the edge in seconds. Deleting is
also immediate. **Nothing about a rate-limiting rule is hard to reverse** — which is exactly why
there is no excuse for not having created them.

---

## 3.3 — watch a rule fire

> **👥 Both.** This is [accounts-open step
> 0.3](docs/delivery/runbooks/accounts-open.md#03--somebody-has-actually-tried-it) in full, and
> it is a **stop condition** for announcing accounts.

**A rule that has never fired is a belief, not a control.** This is the step that turns the
dashboard into evidence, and it is the whole reason this section exists rather than ending at
3.2.

**Against A1, from an address that is not the club's office.** A block applies to the address it
counted, so whoever runs this is the one who gets blocked — do it from a phone on mobile data if
the other volunteer needs the site working meanwhile.

The requests must be **real POSTs to the real path**, with a wrong password and a nonsense
Turnstile token. They will all fail authentication, which is the point: **the rule counts
requests, not failures**, and a burst that never reaches the endpoint proves nothing.

- [ ] Fire **more than A1's threshold inside its period** — a dozen requests in a few seconds is
      plenty against 5 per 60 seconds
- [ ] **Record the status code and the body of the first blocked response.** It will be
      Cloudflare's own `403` HTML page and not the club's; **that is an acceptable answer, and it
      is only acceptable because somebody looked and wrote it down**
- [ ] **Try the site normally from the same address** and confirm the whole hostname is not
      blocked — only what the expression matches should be
- [ ] **Wait out the mitigation period** and confirm sign-in works again **with nobody going
      into the dashboard to release it**
- [ ] **Sign in successfully from a different address while the block is in force**, which is
      what proves the rule counts per address and not globally

> **Do not test A3 by bursting it at a real address.** Every request that gets through sends mail
> to whoever owns it — and after step 1 that mail actually arrives. Use an address the club
> controls, and stop the moment the block lands.

---

## 3.4 — record it

| What to record | Where |
| --- | --- |
| **The status column, per rule** — created or not, and if the plan forced the combined shape, **which shape was actually created** | [`docs/reference/cloudflare-waf-rules.md`](docs/reference/cloudflare-waf-rules.md#the-rules), **in a pull request**. A rule this file does not know about is drift, exactly as a DNS record the zone file does not know about is drift |
| **What the plan actually allowed** — rule count, periods, mitigation durations, and whether the block page is customisable | that file's *what actually happened* section |
| **What a blocked person saw** — status code and page text | the same section, and [accounts-open's](docs/delivery/runbooks/accounts-open.md#what-actually-happened) |
| **Manual step 11 moves from *pending* to done** — what, why, by whom, how to redo | [`platform/apps/main/README.md`](platform/apps/main/README.md#manual-steps) |

- [ ] Tick steps 0.1 and 0.3 in
      [accounts-open](docs/delivery/runbooks/accounts-open.md#step-0--the-things-that-must-be-true-first)
      and step 0.1 in
      [entries-open](docs/delivery/runbooks/entries-open.md#01--the-waf-rate-limiting-rule-must-be-live)
- [ ] **#19 and #64 are already closed**, so there is nothing to close. **Add a comment to each
      saying the dashboard half is now done and on what date** — a closed issue whose real work
      happened ten days later is worth being honest about, and the next person reading the
      history will otherwise draw the wrong conclusion twice

---

# Step 4 — the rest of what gates announcing accounts

**Found by walking [accounts-open's stop
conditions](docs/delivery/runbooks/accounts-open.md#stop-conditions) and [the manual-steps
table](platform/apps/main/README.md#manual-steps) against what is actually in the repository.**
Each of these is genuinely manual and none of them is covered by steps 1–3.

---

## 4.1 — prove the captcha secret is not an empty string

> **⚙️ Ops**, and it is quicker with a second pair of eyes.
> [Accounts-open 0.4](docs/delivery/runbooks/accounts-open.md#04--the-captcha-secret-substituted-to-something-non-empty).

**The secret is installed** — manual step 9, done 24 August 2026. **What has never been proven
is that it substituted to a real value.**

`SUPABASE_AUTH_CAPTCHA_SECRET` is masked as `***` in every Actions log, so a successful
`supabase config push` proves only that `config.toml` was accepted. `[auth.captcha]` pushes with
`enabled = true` whether the value behind `env(...)` resolved to the club's secret or to an empty
string — **and an empty secret does not fail loudly, nor the same way twice.** Depending on what
GoTrue does with a blank `secret`, it can fail **open** (nobody is challenged and Turnstile is
silently off) or **closed** (nobody can register at all). Either is a real outage, and the log
says `enabled = true` in both.

- [ ] **Register against production with no Turnstile token reaching the request** — disable
      JavaScript so the widget never runs, or submit before it loads. **Confirm the attempt is
      refused**, and record what the page said
- [ ] **Register against production with a real Turnstile pass.** Confirm it succeeds
- [ ] If either goes the other way, **stop and fix the GitHub repository secret**. A re-run of
      `deploy-db.yml` is not evidence on its own
- [ ] Write both outcomes into accounts-open's *what actually happened*

**This is the same class of proof [1.9](#19--verify-it-for-real) demands of the SMTP password,
and for exactly the same reason.** Both secrets are masked; both fail silently; both are proven
only from outside.

---

## 4.2 — register the club's admin address

> **⚙️ Ops.** [Manual step 6](platform/apps/main/README.md#manual-steps), currently *pending*.

**This is what switches the back office on**, and it needs no secret, no SQL and no deploy —
which is the point of [#59](https://github.com/southville-running-club/src-website/issues/59).
`admin@southvillerunningclub.co.uk` is written into `identity.reserved_grants` by the migration
and becomes `super-admin` by registering like anybody else.

**Accounts-open makes it a stop condition**, and the reason is sharp: **announcing before it is
done means the first person to claim the address is whoever asks for it.**

- [ ] **It needs [step 1](#step-1--resend-smtp-for-gotrue) first**, or rather it needs a
      confirmation email to arrive at the Fasthosts mailbox — which two-an-hour makes a coin
      toss rather than a procedure
- [ ] Register at `/account/sign-up/`, confirm from that mailbox
- [ ] Grant the other volunteer **`nn-admin`** at `/admin/people/` —
      [the admin runbook](docs/delivery/runbooks/entries-admin.md) has the bootstrap
- [ ] **A second person holding `nn-admin` is the break-glass**, and it takes a minute and no
      deploy. Installing the retired `ENTRIES_ADMIN_KEY` opens nothing any more

**Verify:** the other volunteer reaches `/admin/nn/` and sees the entries list. Anybody without
a role sees an ordinary 404 at every address under `/admin/`, which is correct — a 403 would
disclose that the address exists.

---

## 4.3 — read the last `deploy-db.yml` run, rather than assuming it

> **⚙️ Ops.** [Accounts-open 0.5](docs/delivery/runbooks/accounts-open.md#05--the-platform-is-wired-up).

**`[auth]` in production is whatever the most recent merge that touched `config.toml` pushed** —
not what the file on `main` says today, if a later merge has not touched it since.

- [ ] Open the most recent `deploy-db.yml` run and read it. **Both steps green**, not just
      *Apply migrations* — that is the exact shape #79 wore
- [ ] `site_url` and the redirect allowlist are the club hostname, and a magic link built from
      them lands somewhere that exists
- [ ] `npm run smoke` passes against production

---

## 4.4 — the governance prerequisites

> **🏛️ Committee.** Not a build decision at all; somebody has to chase them.

| | State today |
| --- | --- |
| **A site-wide privacy notice** | **Done.** `src/pages/privacy.astro` exists and #60 is closed. **[Accounts-open's stop-condition table still lists this as blocking](docs/delivery/runbooks/accounts-open.md#stop-conditions) and is stale** — correct it in the same pull request that records step 3 |
| **Somebody can delete their account and take their data with them** | **Open** — [#62](https://github.com/southville-running-club/src-website/issues/62). Or a **written** answer for how a request is handled by hand until it exists. A written answer is enough; an intention is not |
| **Who holds `super-admin`** | A decision the committee takes, **not a side effect of who registered first** |
| **A backup has been restored, not merely configured** | [#23 item 2](https://github.com/southville-running-club/src-website/issues/23), which is entries-open's rather than this page's — but the rows accounts create are personal data too |

---

## 4.5 — the last check, and it catches threshold mistakes nothing else does

> **🏁 Race pages.** [Accounts-open step
> 3](docs/delivery/runbooks/accounts-open.md#step-3--walk-the-three-flows-from-outside).

From a browser that has never seen the site, **on a phone, not a laptop with a session on it**.

- [ ] Sign up, receive the confirmation, follow it, land signed in
- [ ] Sign out, then sign in again
- [ ] Forget the password, request a reset, follow the link, set a new one, confirm the old one
      no longer works
- [ ] The reset acknowledgement is **identical for an address with no account** — it must not
      disclose who is registered
- [ ] With JavaScript off, the account pages **say plainly that they need it**, rather than
      showing a button that does nothing
- [ ] **Nothing above tripped a rate-limiting rule. If an ordinary walkthrough trips one, the
      threshold is wrong** — fix it before the announcement, not after

**That last box is the reason this step comes after step 3 rather than before it**, and it is
the only thing that tests the five thresholds against a real person rather than against an
argument in a markdown file.

---

# What is deliberately not on this page

So nobody goes looking for it, or assumes it was forgotten.

| | Why not |
| --- | --- |
| **Stripe's four manual steps** (2–5 in the README) | They gate **entries** opening, not accounts. [Entries-open](docs/delivery/runbooks/entries-open.md) owns them, and step 5 must be last because Stripe posts into a 404 otherwise |
| **Validating the four `NOT VALID` constraints** (step 8) | Independent of everything here, and nothing is broken until it is done. [Its own runbook](docs/delivery/runbooks/entries-constraints.md) |
| **The entries-open row edit** | A different irreversible moment with a different runbook, and its window times are still **proposed, not ratified** |
| **Turning `[auth.external.google]` on**, and the third button | Code, and blocked on [#55](https://github.com/southville-running-club/src-website/issues/55). Step 2 is the manual half only |
| **The password-changed notification block** | Code, and it is [pull request B](#18--what-not-to-put-in-the-same-pull-request) — deliberately not in the same commit as SMTP |
| **Any change to `[auth]` beyond the two blocks named here** | [The one rule](#the-one-rule-that-governs-half-of-this-page). It is production config the moment it merges |

---

# Undo, in one table

**Nothing on this page is hard to reverse, and that is worth knowing before starting rather than
after.** The irreversible moment is the announcement, and it is not on this page.

| Step | How to undo | Cost of undoing |
| --- | --- | --- |
| Resend DNS records | Delete them in Cloudflare | None. Nothing inbound depends on them |
| **The SPF edit** | Put the old string back | One TTL — 3600s. **The only non-additive DNS change here** |
| `SUPABASE_AUTH_SMTP_PASSWORD` | Delete the repository secret | **Breaks `deploy-db.yml`** while `[auth.email.smtp]` still references it. Revert that first |
| `[auth.email.smtp]` | Re-comment it, in a pull request | GoTrue falls back to two an hour. Degraded, not broken |
| The Resend API key | Revoke it in Resend | Mail stops immediately |
| The Google OAuth client | Delete it; or delete the whole Cloud project | Nothing depends on it yet |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | Delete the repository secret | Safe **only while `[auth.external.google]` is absent from `config.toml`**, which it is |
| A WAF rule | Disable or delete it | Seconds, at the edge. No deploy |
| **A rule that is blocking legitimate people** | **Raise the threshold and record the new number** in the rules file — do not delete the rule | The rules file already predicts E1 as the number most likely to need raising, because a mobile carrier puts hundreds of subscribers behind one address |
| `admin@` being registered | There is no undo, and there does not need to be | It is an account like any other |

---

# Where each value gets recorded

**One table, because "write it down afterwards" is the step most likely to be skipped**, and
because a manual step is legitimate [only *because* it is
recorded](docs/foundations/requirements.md).

| Value | File |
| --- | --- |
| Every Resend DNS record — type, host, value, purpose | [`docs/foundations/current-state.md`](docs/foundations/current-state.md#dns-and-email), in the zone table, **and update the record count** |
| The Google Cloud project, its owners, the client ID, the registered redirect URI | [`docs/foundations/current-state.md`](docs/foundations/current-state.md#accounts-and-access), in the access list |
| Which WAF rules exist, and in which shape | [`docs/reference/cloudflare-waf-rules.md`](docs/reference/cloudflare-waf-rules.md#the-rules), status column, **in a pull request** |
| What the Cloudflare plan actually allowed, and what a blocked person saw | the same file's *what actually happened* |
| Every secret: what, why, by whom, how to redo | [`platform/apps/main/README.md`](platform/apps/main/README.md#manual-steps) |
| That GoTrue uses SMTP, not the REST API | [`docs/solutions/resend-programmatic-email.md`](docs/solutions/resend-programmatic-email.md) |
| Creating the OAuth client, and rotating its secret | **`docs/delivery/runbooks/google-oauth.md`** — to be written; [step 2](#step-2--the-google-cloud-oauth-client) is its first draft |
| What was done on the day, and what differed from this page | [accounts-open's *what actually happened*](docs/delivery/runbooks/accounts-open.md#what-actually-happened), **and this page's section below** |

**Four small pull requests, one per step plus the corrections.** One change each, because the
repository is squash-only and a combined commit cannot be reverted apart.

---

# What actually happened

**Nothing yet.** Filled in the first time this page is worked through: the date, who did which
part, what each dashboard actually offered, which of the assumptions above turned out to be
wrong, and **what differed from this page** — because a document that is wrong is worse than one
that is missing, since it is trusted.

Three things in particular are worth capturing, because nobody has an answer today:

- **Whether port 587 fixes the CI failure that port 465 caused**, and what GoTrue's own container
  log actually said.
- **How many rate-limiting rules the free plan allows**, and whether the block page can be
  customised on it.
- **Whether Resend's free tier still allows team members**, which the design doc has flagged as
  unverified since the day it was written.
