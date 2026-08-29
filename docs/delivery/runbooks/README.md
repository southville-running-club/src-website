# Runbooks

Step-by-step procedures for things that are done rarely, carry real consequences, and need
to be done the same way twice.

**These are executable, not explanatory.** The reasoning lives elsewhere and is linked from
each step. If a runbook makes you stop and think about *why*, that is a bug in the runbook.

| | | Serves |
| --- | --- | --- |
| [**GitHub setup**](github-setup.md) **①** | People, branch protection, and the **three secrets**. Start here | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Supabase setup**](supabase-setup.md) **②** | Expose `intake`, collect the keys, apply the migrations | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Cloudflare setup**](cloudflare-setup.md) **③** | The two Workers. **GitHub needs no Cloudflare credential** | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Opening entries**](entries-open.md) **④** | **The moment the club starts taking money.** One `update` with no pull request to review it, so everything that must be true first is step 0. **Every step is tagged** ⚙️ ops / 🏁 race pages / 🏛️ committee, so each volunteer can find their half | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Opening accounts**](accounts-open.md) **⑤** | **The moment the club invites real people to create real accounts.** There is no row to edit — `enable_signup` merged before the runbook existed — so the irreversible act is the *announcement*, and step 0.1 is a catch-up rather than a pre-condition. **The rate-limiting rules on the credential endpoints are that step** | [Phase 3b](../phases.md#phase-3b--member-accounts-before-entries-open) |
| [**Sign in with Google**](google-oauth.md) | The Google Cloud project, the OAuth client and the consent screen for [#56](https://github.com/southville-running-club/src-website/issues/56). **The redirect URI registered at Google is Supabase's, not the club's** — that is the standard first failure. Two switches thrown by two people at two times, and the order matters: provider first, button second | [Phase 3b](../phases.md#phase-3b--member-accounts-before-entries-open) |
| [**A request about somebody's data**](data-requests.md) | **Most of these need nobody** — since [#62](https://github.com/southville-running-club/src-website/issues/62) a person downloads or deletes their own account at `/account/data/`. This is the three shapes that page cannot answer: a request reaching into a paid race entry, one from somebody with no account, and one the club means to refuse. **One calendar month**, from the day it arrives | Any |
| [**A purchase needs a human**](entries-attention.md) | Diagnosing and clearing an `attention` flag. Somebody's money is involved in every case | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Validating the entries constraints**](entries-constraints.md) | The second half of Slice G. Four check constraints shipped `NOT VALID` because nobody could see the production rows — they protect every new write already, and this is the look at the table that lets them be validated. **Read-only until you are sure**, and step 1 is the query that says whether step 2 will succeed | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Dropping the England Athletics columns**](entries-ea-number-contract.md) | The contract half of [decision 007](../../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers). The club stopped collecting the number on 29 August 2026 and the columns were **emptied and constrained rather than dropped**, because the Worker deployed alongside the migration parses those keys as required. Once that build is live, this drops them. **Nothing breaks if it is never run** | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Issuing a discount code**](entries-discount-codes.md) | One `insert` per code, run by hand. **The code never goes in this repository** — it is public, so a code in a migration is a published one — and the entropy is the only control, because no rate limiting is live yet. Covers generating one, scoping it to a fee, watching `uses`, and withdrawing it. **Not for a 100% code**: a free place is *given* from `/admin/nn/` instead | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**The admin surface**](entries-admin.md) | Switching `/nn/admin` on, issuing a key to each volunteer, revoking one, and **what each of the three exports contains** — one of them is special category data. Until its key is installed the whole prefix 404s, which is the correct state | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Adding a hostname**](adding-a-hostname.md) | **Where DNS records go now.** Short answer: Cloudflare, and usually the service creates it for you | Any |
| [**The race's email aliases**](nn-email-aliases.md) | Two Fasthosts aliases onto `info@`, so `/nn` stops publishing a Gmail address. **Not a DNS change.** Its stop condition gates a merge, because a published address that bounces fails silently. **Stages 1–2 executed; delivery reconfirmed 28 Aug 2026. No ✅ because [stage 3](nn-email-aliases.md#stage-3--the-old-gmail-address) — forwarding the old Gmail — is unconfirmed and outstanding** | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**Squarespace signposting**](squarespace-signposting.md) ✅ | The old site's header points at `/nn`; `/nn` and `/timing` on the old domain forward. **Dashboard-only — Squarespace has no API for it.** Executed 13 Aug 2026 | [Phase 3](../phases.md#phase-3--nightingale-nightmare-live) |
| [**The nameserver move**](nameserver-move.md) ✅ | Fasthosts → Cloudflare, carrying club email. **Executed 8 Aug 2026** | [Phase 2](../phases.md#phase-2--move-the-nameservers) |

> **Retired:** *Nightingale Nightmare onto the club domain* — it described attaching
> `nn.southvillerunningclub.co.uk` directly, which
> [ADR-007](../../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md)
> ruled out before it was ever run. **The Cloudflare runbook above is now Phase 3's
> hosting procedure**; the page, form and payment flow are
> [the build brief](../nn-build-brief.md)'s.

**Stages inside a runbook are internal to it** and are not the programme's
[phases](../phases.md). A runbook is a procedure; a phase is a chunk of the programme.

---

## Automate by change frequency, not by category

The principle these runbooks assume, recorded properly in
[ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md).

| How often it happens | How it is done |
| --- | --- |
| **Every commit** — deploys, schema migrations, tests | **Automated.** Git integration and CI, per [ADR-003](../../architecture/decisions/adr-003-local-development-and-pipeline.md) |
| **Monthly-ish, high consequence** — DNS records | **Manual, but reviewed.** A runbook, and a pull request against the committed zone file |
| **Once, ever** — creating a project, a bucket, changing nameservers | **Manual, and written down** |

The club's whole infrastructure surface is [roughly thirty dashboard
actions](../../architecture/investigations/infrastructure-as-code.md#how-much-is-there-actually-to-do)
across eight months, then almost none. **The high-frequency work is already code.** What is
left does not earn a tool, and a runbook is the right instrument for it.

---

## Writing and using one

**Before running a runbook**

- Read it through **once, completely**, before doing anything. Several steps here are
  ordered for a reason that only makes sense from the far end.
- Check the **stop conditions**. Most of these have a step that says do not continue, and
  that step is there because somebody would have.
- Know what "done" looks like for each step before starting it.

**While running it**

- **One step at a time.** Do not batch two changes with two possible causes of failure.
- **Verify each step before the next**, using the check written into it. "It probably
  worked" is how a silent failure becomes a mystery a week later.
- **Write down what you actually did**, including anything you did differently. Per the
  [pragmatic exception](../../foundations/requirements.md#everything-is-defined-as-code),
  manual work is acceptable *because* it is recorded: what, why, by whom, and how to redo it.

**Afterwards**

- **Update the runbook** if reality differed from it. A runbook nobody corrects is worse
  than none, because it is trusted.
- **Commit the artefact** — the exported zone file, the record of what changed. That is the
  reviewable output, and it is what makes the manual approach legitimate rather than just
  convenient.

## When a runbook is the wrong answer

- If it runs **more than about monthly**, automate it instead.
- If it needs a **credential typed in by hand every time**, that is a hazard, not a
  procedure.
- If it cannot be **reversed**, it needs a rehearsal or a second pair of eyes rather than a
  better checklist. The [nameserver move](nameserver-move.md) is the one item here in that
  category, which is why it has an independent-verification step.
