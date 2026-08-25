# Accounts completion — one PR, three issues

**Branch:** `member-accounts/55-56-62-accounts`, off `main`. PR #97 merged on 25 August 2026, so
#61 is on `main` and this is no longer a stacked branch.

**Deliberate exception, taken by the repository owner on 25 August 2026.** `CLAUDE.md` requires one
change per pull request, mechanically, because the repository is squash-only — two unrelated things
in one pull request become one commit that cannot be reverted or bisected apart. That rule is being
overridden here for speed. This file is the compensation: it records what went in, so the single
commit can at least be *read* apart afterwards.

---

## Scope, after checking what is actually built

The tracker (#65) lists five open issues. Reading the code rather than the tracker changes the
picture substantially, in the club's favour.

| Issue | Tracker says | Actually |
| --- | --- | --- |
| **#54** password reset | Open, blocking | **Already on `main`.** Landed as PR #76; #80 and #83 then fixed its fallout. The issue is open only for the one item below |
| **#55** magic link | Branch exists | Branch has **zero commits**. Genuinely unbuilt |
| **#56** Google | — | Unbuilt |
| **#62** export / delete | — | Unbuilt. Needs #61's columns, which is why this stacks on PR #97 |
| **#63** retire two keys | Open | **Out of scope, deliberately.** See below |

So the work is **#55, #56, #62**.

### The stale branch that nearly cost an afternoon

`member-accounts/54-password-reset` still exists locally, never pushed, holding the *pre-merge*
version of PR #76. Cherry-picking it — the obvious first move — produced 22 conflicts across six
files and would have **reverted `main`'s #79 fix**, because every conflict was `main` having the
newer, corrected text and the branch having the older. It was aborted. **The branch should be
deleted** so nobody repeats this.

### Why #63 is not here

Not a convention call. It is the *contract* half of expand-migrate-contract: it drops
`entries.admin_sign_in()`, `entries.admin_keys` and five key-gated functions that the currently
deployed Worker still calls. `principles.md` allows rolling code back and schema forward, and this
migration makes the deployed Worker unrollbackable. The issue itself gates it on **after race day,
1 November 2026**, and after the change freeze lifts. It is the one item here that could take the
live site down.

---

## Findings that change the acceptance criteria

### 1. #54's password-changed notification cannot ship, and must not

`main` deliberately carries `[auth.email.notification.password_changed]` **commented out entirely**.
That single line is issue **#79** — it broke `supabase config push` on every merge from 25 August
2026, and because there is **no partial apply**, it took `site_url`, the redirect allowlist,
`enable_signup` and the captcha secret down with it while `db push` went on succeeding. Four red
deploys. Disabling it was not enough (#80); it had to be commented out (#83), because the CLI
serialises the section whenever it is merely *present*, filling in an empty `subject`, which is
still a template modification the free tier's default provider refuses.

`tests/unit/config.test.ts` now fails if any email template returns, **including a disabled one**.

**Consequence:** #54's last open item — *"a password-changed notification arrives"* — is not
satisfiable and stays open. The unblocker is a custom SMTP provider, not this branch. **Nothing in
this PR may add an email-template block.**

### 2. #50 is closed, but SMTP is not actually configured

`[auth.email.smtp]` in `config.toml` is still the CLI's commented-out SendGrid sample. So production
GoTrue is on the free tier's default provider at **two emails per hour, account-wide**.

Every flow in this PR is an email — magic links (#55) above all. **The code will be correct and the
delivery will not be.** Inherited rather than caused, but it decides whether #55 works for a real
person, and it should be said plainly in the PR body rather than discovered at race HQ.

### 3. #55's anti-prefetch requirement collides with finding 1

#55 asks for GoTrue's **`token_hash` flow** so that a mail scanner following every URL in a message
does not consume a single-use token. That flow works by the email template emitting
`{{ .TokenHash }}` and linking to our own address — which means declaring
`[auth.email.template.magic_link]` in `config.toml`. **That is precisely the block finding 1
forbids**, and `config.test.ts` fails on it.

So the literal requirement is unreachable until custom SMTP exists. **The chosen answer is PKCE
rather than the default implicit flow**, which reaches the same goal by a different route and needs
no template:

- The code arrives as `?code=` on the **query string**, which the Worker can read directly — no
  fragment, so none of `resetConfirmPage`'s hidden-form-plus-inline-script gymnastics
- The exchange requires a `code_verifier` the Worker minted and put in an **`HttpOnly` cookie**, so
  a scanner that follows the link **cannot obtain a session** — it holds a code and nothing to
  redeem it with
- It is the same shape #56's OAuth return needs, so the callback really is built once

`SameSite=Lax` is what makes the verifier cookie survive the cross-site top-level navigation from a
mail client. `Strict` would drop it and the exchange would fail — the same trap #55 already flags
for the session cookie, now applying to a second cookie.

**Recorded as a deviation from the issue text**, not an oversight. The done-when item changes from
"uses `token_hash`" to "a prefetching scanner cannot obtain a session", which is the property the
issue actually wanted.

### 4. #56 needs a new `[auth]` block, which is the same loaded gun

`[auth.external.google]` is an `[auth]` change to `config.toml` — a `CLAUDE.md` stop-and-ask with
the same no-partial-apply blast radius as finding 1. It also needs a Google Cloud OAuth client under
a club-owned account, which cannot be created from here.

**Approach:** ship the code, the config block and the runbook, with the config block **commented out**
until a human has created the client and set `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. An enabled block
with no client is a dead deploy; a button with no client is a broken button. So **the button renders
only when the provider is configured**, and the last step is a human's.

---

## Success looks like

### Merge-blocking — must all be true

- [ ] `./dev check` clean — lint, types, migration scope, unit and database tests
- [ ] `./dev test` clean — Worker (Miniflare) and Playwright with axe
- [ ] `tests/unit/config.test.ts` passes, i.e. **no email-template block is present at all**
- [ ] `packages/db/tests/entries.test.ts` still asserts **thirteen** anon-executable functions.
      Nothing here may add a fourteenth
- [ ] Any new `identity` function is granted to `authenticated` only, never `anon`
- [ ] No credential in the repository; **no service role key anywhere**
- [ ] Zero axe violations on every new page, in empty, error and success states
- [ ] `python3 tools/check-doc-links.py` — `ALL LINKS OK`
- [ ] Every manual step written into `apps/main/README.md` — what, why, by whom, how to redo it
- [ ] Documentation ships in the same commit as the behaviour it describes

### #55 — magic link

- [ ] `/account/sign-in/` gains a second form: address, Turnstile, "send me a link"
- [ ] `GET /account/callback/` built **once**; #56 adds a branch to it, not a second address
- [ ] `SameSite=Lax`, with a comment at the callback saying why — `Strict` drops the cookie on the
      cross-site top-level navigation from a mail client and the person lands silently signed out
- [ ] **PKCE, not the implicit flow** — a prefetching mail scanner that follows the link cannot
      obtain a session, because the `code_verifier` is in an `HttpOnly` cookie it does not hold.
      See finding 3 for why this replaces the issue's `token_hash` wording
- [ ] `redirect_to` must resolve to a **path on this origin** — anything with a scheme or a host is
      refused, asserted by a Worker test. Otherwise it is an open redirect
- [ ] The link works **once**; a second use says so rather than failing blankly
- [ ] Requesting a link for an unknown address is **indistinguishable** from a real one, the rule
      #54 already established
- [ ] Two forms on one page need real `fieldset`/`legend` structure, not two lonely inputs
- [ ] Tagged `@requires-js`, excluded from `no-javascript`, per #53

### #56 — Google

- [ ] A third button on sign-in and sign-up — a real alternative offered beside the others, not the
      primary action, and not instead of them
- [ ] Lands on #55's `/account/callback/` — **a branch, not an address**
- [ ] Linking decided and tested **in both directions**: password-then-Google at one address gives
      **one** account, both routes working; Google-then-password **tells the person** the address
      already signs in with Google rather than silently rejecting them
- [ ] `enable_manual_linking` stays **off**
- [ ] `docs/delivery/runbooks/google-oauth.md`: creating the client, the consent screen, secret
      rotation, and that **the redirect URI registered at Google is Supabase's**
      (`https://<project>.supabase.co/auth/v1/callback`), not ours — the standard first failure
- [ ] Scope is **email and profile only**. No Drive, no Calendar, no contacts
- [ ] The config block ships **commented out**; the button renders only when configured
- [ ] The Cloud project is club-owned with both volunteers, recorded in `current-state.md`

### #62 — export and delete

- [ ] `/account/data/` exports everything held about the signed-in person as **JSON, downloaded not
      emailed** — emailing a file of somebody's personal data is a disclosure with no way back
- [ ] A database test proves the export lists **every column in `identity`**, so a column added
      later fails the test rather than quietly escaping the export
- [ ] Deletion goes through `identity.delete_me()` — `security definer`, owned by `postgres`, pinned
      `search_path`, **no arguments**, granted to `authenticated` and nothing else.
      **It does not exist yet.** #62's premise that #51 created it is wrong — #51's migration header
      (`20260824090000_create_identity_schema.sql:118-120`) defers it explicitly. A migration here
      creates it
- [ ] **The last super-admin cannot delete themselves.** `identity.revoke_role()` already refuses to
      remove the last active super-admin grant; deletion is the same hole by another door, and
      "no system is reachable by only one person" is a principle. Same `last_super_admin` reason
- [ ] **No service role key.** `createUserClient` still refuses one
- [ ] Deleting ends every session immediately
- [ ] The confirmation names **what stays, before the button**: a paid race entry, medical notes
      (already on the cron), the interest list, `identity.audit`, `entries.admin_audit`. Somebody
      who deletes believing their race entry vanished finds out at the start line
- [ ] `entries.entrants` rows **survive** deletion, asserted by test. It is not keyed on
      `identity.people` and this must not make it so
- [ ] Anon cannot execute `delete_me()`; a signed-in caller deletes only themselves
- [ ] A deleted person can register again with the same address and gets a clean account
- [ ] The delete confirmation is **not reachable by a single keystroke**
- [ ] `docs/delivery/runbooks/` gains the procedure for a request reaching beyond the account

---

## Known risk in verifying this

`./dev check` and `./dev test` **rebuild the shared Supabase**, and ~30 worktrees exist on this
machine. A second `./dev test` kills the first by `pkill` pattern, machine-wide, and the symptom is
a flaky suite rather than a collision. PR #97's own test plan already failed this way twice.

**One test run at a time, dispatched through a Haiku subagent, and waited for.** The tell that it
has gone wrong is `pgrep -fl 'dev test'` answering twice.

---

## Order of work

1. **#55** magic link + `/account/callback/` — the address #56 depends on
2. **#56** Google — a branch in the callback, an inert config block, a runbook
3. **#62** export and delete — needs #61's columns, hence the stack
4. Full `./dev check`, then `./dev test`
5. Open the PR against `main`, noting it **stacks on #97** and that #97 must land first
6. Delete the stale `member-accounts/54-password-reset` branch
