# Runbook — opening accounts

**This is the moment the club invites real people to create real accounts.** Unlike opening
entries there is no single statement to run: the switch that allows an account —
`enable_signup` in [`config.toml`](../../../platform/packages/db/supabase/config.toml) —
**merged before this page existed**, and `deploy-db.yml` pushed it to production on the next
merge that touched the file. So the irreversible act here is the *announcement*: the moment
the club tells its members the accounts exist, which is the moment an endpoint that checks a
credential starts being found by people who are not members.

**That inversion is the reason to read [step 0](#step-0--the-things-that-must-be-true-first)
rather than skim it.** For entries, step 0 gates a row edit that has not happened yet. Here,
some of it is a catch-up on something already live — and the catch-up is
[0.1](#01--the-rate-limiting-rules-must-be-live), which is the item this file was written for.

**Prerequisites:** the Cloudflare dashboard, the club's Supabase project, GitHub repository
admin (for the two Actions secrets), and something that can send a burst of HTTP requests.
Both volunteers.

**About two hours**, most of it in step 0, plus whatever step 0 still needs from other people.

---

## Who does which part

Same tags as [opening entries](entries-open.md#who-does-which-part), same reason: nobody
should have to read the whole page to find their half.

| Tag | Means | Today |
| --- | --- | --- |
| **⚙️ Ops** | Cloudflare, GitHub, Supabase, secrets | Mark |
| **🏁 Race pages** | What a member reads, and how they are told | Bindal |
| **🏛️ Committee** | Not a build decision at all. Somebody has to chase it | Both, to ask |
| **👥 Both** | Do it together, in the same room or the same call | — |

---

## Stop conditions

Do not announce accounts if any of these is true.

| | Why it stops the run |
| --- | --- |
| **The rate-limiting rules are not live** | [Step 0.1](#01--the-rate-limiting-rules-must-be-live). Sign-in is a credential check and reset is an email to an address the caller names. Nothing else in this repository is either of those |
| **Nobody has watched a rule block anything** | [Step 0.3](#03--somebody-has-actually-tried-it). A rule that exists and does not fire is worse than no rule, because it is believed |
| **Outbound email is still Supabase's built-in sender** | [Step 0.2](#02--email-actually-leaves-the-building). Two an hour, project-wide. Every flow on this page is an email, and the failure is silent — the person simply never receives it |
| **There is no site-wide privacy notice** | [#60](https://github.com/southville-running-club/src-website/issues/60). An account is a standing record of a named person and the club has not told anybody it keeps one. This is a legal precondition, not a nicety |
| **`admin@southvillerunningclub.co.uk` has not registered** | The super-admin is bootstrapped by registering like anybody else ([#51](https://github.com/southville-running-club/src-website/issues/51)). Announcing before that means the first person to claim the address is whoever asks for it |

---

## Step 0 — the things that must be true first

### 0.1 — the rate-limiting rules must be live

> **⚙️ Ops**

**[#64](https://github.com/southville-running-club/src-website/issues/64). Do this one first
and do not skip it**, exactly as
[entries-open step 0.1](entries-open.md#01--the-waf-rate-limiting-rule-must-be-live) says
about its own rule. The two are siblings and **their rules live in one place**:
[the committed copy of the Cloudflare rules](../../reference/cloudflare-waf-rules.md).

**Which is which:** **E1** is the race forms and belongs to entries opening —
[#19](https://github.com/southville-running-club/src-website/issues/19). **A1**–**A4** are
sign-in, sign-up, password reset and the admin surfaces, and they belong to this page. They
are recorded together because they are the same kind of object in the same dashboard, and
because the free plan may only allow one of them.

**This repository has never had a rate limit of any kind**, and accounts add two classes of
exposure it has never carried: an endpoint that checks a credential, and an endpoint that
causes an email to be sent to an address the caller chooses. **Turnstile is not a rate
limiter** — it raises the cost of a request; it does not cap them, and it does nothing at all
about a real person trying two hundred passwords.

- [ ] **Check what the plan actually allows** before creating anything — how many
      rate-limiting rules, which periods, which mitigation durations. It changes, and a free
      tier's terms differing from what is recorded is its own
      [stop-and-ask](../../architecture/principles.md#stop-and-ask)
- [ ] Create **A1** (sign in), **A2** (sign up), **A3** (password reset) and **A4** (the
      admin surfaces) exactly as
      [the table](../../reference/cloudflare-waf-rules.md#the-rules) records them
- [ ] If the plan allows only one rule, use
      [the combined expression](../../reference/cloudflare-waf-rules.md#if-the-plan-allows-only-one-rule)
      — and **read what it costs first**, because one rule takes one threshold and it has to
      be the loosest one
- [ ] **Update the status column** in that file, in a pull request, with what was actually
      created. A rule the file does not know about is drift, in exactly the way a DNS record
      the zone file does not know about is drift
- [ ] Create **E1** too, while the dashboard is open — it is
      [#19](https://github.com/southville-running-club/src-website/issues/19)'s and it is
      still not created

### 0.2 — email actually leaves the building

> **⚙️ Ops**

**[#50](https://github.com/southville-running-club/src-website/issues/50).** Supabase's
built-in sender is capped at **two emails an hour for the whole project**, whatever
`[auth.rate_limit] email_sent` says. Every flow on this page is an email — confirm your
address, reset your password, your password was changed — and **the failure is silent**: the
third person to sign up in an hour never receives anything and sees no error.

- [ ] Resend is wired up as `[auth.email.smtp]`, and its DNS records are in the committed
      zone file
- [ ] **A confirmation email has arrived at a real address outside the club's own domain** —
      a personal Gmail is the test that matters, because that is where deliverability
      problems show up
- [ ] `email_sent = 60` in `config.toml` is still the number the club wants once it is the
      real ceiling rather than a shadowed one. It is one email a minute, project-wide

### 0.3 — somebody has actually tried it

> **👥 Both**

**A rule that has never fired is a belief, not a control.** This is the step that turns the
dashboard into evidence, and it is [step 2](#step-2--prove-a-rule-fires) in full.

- [ ] A scripted burst has been run against **A1**, and it was blocked
- [ ] **What the blocked person actually saw is written down** at the foot of this file — the
      status code, and what the page said. It will be Cloudflare's own page and not the
      club's; that is an acceptable answer, and it is only acceptable *because* somebody
      looked and recorded it
- [ ] Whether that page can be customised on this plan has an answer, even if the answer is
      "not on the free plan"
- [ ] The block cleared on its own after the mitigation period, and **nobody had to go into
      the dashboard to release it**

### 0.4 — the platform is wired up

> **⚙️ Ops**

- [ ] Both GitHub Actions secrets from
      [the manual steps](../../../platform/apps/main/README.md#manual-steps) exist —
      `SUPABASE_AUTH_CAPTCHA_SECRET` (step 9) and, if Google sign-in is on,
      `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (step 10)
- [ ] **The last `deploy-db.yml` run was read, not assumed.** `config.toml` is on that
      workflow's path filter, so the `[auth]` block in production is whatever the most recent
      merge that touched the file pushed
- [ ] `site_url` and the redirect allowlist are the club hostname, and a magic link built
      from them lands somewhere that exists
- [ ] `npm run smoke` passes against production

### 0.5 — the governance prerequisites

> **🏛️ Committee**

- [ ] **A site-wide privacy notice is published** —
      [#60](https://github.com/southville-running-club/src-website/issues/60). What is
      collected, why, how long it is kept, and who to write to
- [ ] **Somebody can delete their account and take their data with them** —
      [#62](https://github.com/southville-running-club/src-website/issues/62), or a written
      answer for how a request is handled by hand until it exists
- [ ] **Who holds `super-admin`** is a decision the committee has taken, not a side effect of
      who registered first

---

## Step 1 — create the rules

> **⚙️ Ops**

Cloudflare dashboard → the zone → **Security** → **WAF** → **Rate limiting rules**.

**Work from [the committed copy](../../reference/cloudflare-waf-rules.md), not from memory
and not from this page.** That file holds the expression, the threshold, the period, the
action and the mitigation duration for every rule; this one holds only the order to do them
in.

1. **A1 first** — sign in. It is the rule protecting the thing an attacker wants.
2. **A3 next** — password reset. It is the only endpoint whose cost lands on somebody who has
   never visited the site.
3. **A2**, then **A4**.
4. **E1** last, and only because it belongs to a different issue — not because it matters
   less.

**Paste the expression rather than building it in the visual editor.** The rule builder's
"Edit expression" box takes the text as written, and a hand-built rule with one clause
dropped looks identical to a correct one.

**Then re-read each rule back from the dashboard and diff it against the file**, the same way
[ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md) has the
zone file re-exported after a DNS change. That is the drift detection, and it costs a minute.

---

## Step 2 — prove a rule fires

> **👥 Both**

**Against A1, from an address that is not the club's office.** A block applies to the
address it counted, so whoever runs this is the one who gets blocked — do it from a phone on
mobile data if the other volunteer needs the site working meanwhile.

The requests must be **real POSTs to the real path** with a wrong password and a nonsense
Turnstile token. They will all fail authentication, which is the point: the rule counts
requests, not failures, and a burst that never reaches the endpoint proves nothing.

- [ ] Fire **more than A1's threshold** inside its period — a dozen requests in a few seconds
      is plenty against 5 per 60 seconds
- [ ] **Record the status code and the body** of the first blocked response. Cloudflare
      answers a block with `403` and its own HTML page
- [ ] **Try the site normally from the same address** and confirm the whole hostname is not
      blocked — only what the expression matches should be
- [ ] **Wait out the mitigation period** and confirm sign-in works again with no intervention
- [ ] **Sign in successfully from a different address while the block is in force**, which is
      what proves the rule is counted per address and not globally
- [ ] Write all of it into [what actually happened](#what-actually-happened)

> **Do not test A3 by bursting it at a real address.** Every request that gets through sends
> mail to whoever owns it. Use an address the club controls, and stop as soon as the block
> lands.

---

## Step 3 — walk the three flows from outside

> **🏁 Race pages**

From a browser that has never seen the site, on a phone, not from a laptop with a session
already on it.

- [ ] **Sign up** with a real address, receive the confirmation, follow it, land signed in
- [ ] **Sign out**, then **sign in** again
- [ ] **Forget the password**, request a reset, follow the link, set a new one, and confirm
      the old one no longer works
- [ ] Confirm the reset acknowledgement is **the same for an address with no account** — it
      must not disclose who is registered
- [ ] **With JavaScript off**, the account pages say plainly that they need it, rather than
      showing a button that does nothing —
      [ADR-015](../../architecture/decisions/adr-015-member-accounts-on-supabase-auth.md)'s
      named exception to
      [progressive enhancement](../../architecture/principles.md#progressive-enhancement-not-javascript-dependence)
- [ ] Nothing above tripped a rate-limiting rule. **If an ordinary walkthrough trips one, the
      threshold is wrong** — fix it before the announcement, not after

---

## Step 4 — tell people

> **👥 Both**

This is the irreversible half. Everything above can be repeated; an announcement cannot be
unsent.

- [ ] Both volunteers agree the boxes above are ticked, out loud
- [ ] The announcement says what an account is *for* — the club has not had one before, and
      "create an account" with no reason attached reads as a data grab
- [ ] It links to the privacy notice
- [ ] It says who to contact when it goes wrong, and that person knows they are it

---

## Step 5 — write down what happened

> **👥 Both**

Per the [pragmatic exception](../../foundations/requirements.md#everything-is-defined-as-code),
manual work is legitimate *because* it is recorded.

- [ ] Fill in [what actually happened](#what-actually-happened) below
- [ ] **Update the status column** in
      [the Cloudflare rules file](../../reference/cloudflare-waf-rules.md) in a pull request
- [ ] Record the rules in
      [`apps/main/README.md`](../../../platform/apps/main/README.md#manual-steps)'s
      manual-steps table — what, why, by whom, how to redo it
- [ ] Close [#64](https://github.com/southville-running-club/src-website/issues/64) and, if
      **E1** was created in the same sitting,
      [#19](https://github.com/southville-running-club/src-website/issues/19)
- [ ] **Correct this runbook** where reality differed from it

---

## Closing accounts again

There is no row to reverse, and that is the part worth knowing before it is needed.

**Turning signups off is a pull request**: `enable_signup = false` in `config.toml`, in both
`[auth]` and `[auth.email]`. `config.toml` is on `deploy-db.yml`'s path filter, so it reaches
production on merge to `main` without needing a migration alongside it. **It stops new
accounts; it does not sign anybody out** — existing sessions keep working and existing
accounts keep signing in.

**Faster, and it is the one to reach for while something is actively going wrong:** disable
the offending rule's *endpoint* at Cloudflare with a WAF custom rule that blocks the path
outright. It takes effect at the edge in seconds, needs no deploy, and leaves the rest of the
site up. Write down that it was done and take it off again deliberately, rather than letting a
temporary block become the configuration.

---

## What actually happened

**Nothing yet.** This section is filled in the first time this runbook is run: the date, who
ran it, which rules were created, what the plan actually allowed, what a blocked person saw,
and anything done differently from the page above.
