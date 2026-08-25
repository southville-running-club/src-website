# Runbook — sign in with Google

**Most members already have a Google account open in the tab next door**, and
[#56](https://github.com/southville-running-club/src-website/issues/56) is about removing a
password from the equation for the people most likely to use the site once a year and forget
they ever had one. This page is the manual half of it: the Google Cloud project, the OAuth
client, the consent screen, which redirect URI goes where, the two switches that turn it on,
and how to take it all off again.

**The build is already done.** `/account/callback/` handles the OAuth return, `/account/google/`
starts it, and the third button is written. Nothing here is a code change — every step below is
a dashboard, a repository secret, or a one-line edit to a configuration file that ships on
merge.

**Prerequisites:** a **club-owned** Google account (see the stop conditions), GitHub repository
admin for the one Actions secret, and whatever it takes to deploy the Worker. Both volunteers,
because half of it is about neither of them being the only person who can reach it.

**About an hour**, plus a wait on Google's consent-screen verification if the club ever needs a
scope beyond the two below — it does not, and that is deliberate.

---

## Who does which part

Same tags as [opening accounts](accounts-open.md#who-does-which-part), same reason: nobody
should have to read the whole page to find their half.

| Tag | Means | Today |
| --- | --- | --- |
| **⚙️ Ops** | Google Cloud, GitHub, Supabase, Cloudflare, secrets | Mark |
| **🏁 Race pages** | What a member sees and is told when it goes wrong | Bindal |
| **🏛️ Committee** | Not a build decision. Somebody has to own the Google account | Both, to ask |
| **👥 Both** | Do it together, in the same room or the same call | — |

---

## Stop conditions

Do not start if any of these is true.

| | Why it stops the run |
| --- | --- |
| **There is no club-owned Google account** | [Step 0.1](#01--a-club-owned-google-account-exists). An OAuth client owned by a volunteer's personal Google account is [a system reachable by only one person](../../architecture/principles.md#no-system-is-reachable-by-only-one-person). The club already has four of those and cannot cover for either volunteer |
| **Only one volunteer would be an owner of the Cloud project** | [Step 1](#step-1--create-the-cloud-project). Same principle. Two owners, from the first minute, not "we will add the other one later" |
| **`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` is not set in GitHub** | [Step 4](#step-4--the-github-repository-secret). The Supabase CLI validates every `env(...)` substitution at startup, and an unset one breaks `supabase start` outright. Set it **before** the block is uncommented, never after — step 10 of [the manual steps](../../../platform/apps/main/README.md#manual-steps) says the same thing |
| **Nobody is going to read the `deploy-db.yml` log** | [Step 5](#step-5--uncomment-authexternalgoogle). `[auth]` has **no partial apply** ([#79](https://github.com/southville-running-club/src-website/issues/79)). One rejected value silently takes `site_url`, the redirect allowlist, `enable_signup` and the captcha secret down with it while `db push` goes on succeeding. Four red deploys have already been spent on this |
| **The linking behaviour has not been decided** | [Step 8](#step-8--account-linking-both-directions). #56's whole point is that this is *decided* rather than discovered. One of its two cases is **still unresolved against how the sign-up form is deliberately built** — see the flagged question in that step |
| **Password accounts do not work today** | Every step here rides on `/account/sign-in/` and `/account/callback/` already being sound. Fix that first; a Google button on a broken account area just makes the failure harder to read |

---

## The gotcha, before anything else

**The redirect URI you register at Google is Supabase's, not the club's.**

| Goes in the Google OAuth client's **Authorised redirect URIs** | `https://ketipxpyjjglwpqazsft.supabase.co/auth/v1/callback` |
| --- | --- |
| Does **not** go there, ever | `https://new.southvillerunningclub.co.uk/account/callback/` |

The chain is: the club's Worker sends the browser to Google → **Google returns to GoTrue** at
the Supabase address → **GoTrue redirects onward** to `/account/callback/` with a PKCE `code`
on the query string, which is the address the Worker asked for as `redirectTo`. The club's own
callback is never spoken to by Google and never needs to be known by Google.

**Getting this backwards is the standard first failure**, and it is worth knowing what it looks
like: Google refuses at its own screen with `redirect_uri_mismatch` before the person ever
reaches the club's site, so there is nothing in the Worker's logs and nothing in Supabase's.
The error names the URI that was *sent* — which will be the Supabase one — and the fix is
always at Google, never in this repository.

`/account/callback/` needs no allowlist entry of its own either: `additional_redirect_urls` in
[`config.toml`](../../../platform/packages/db/supabase/config.toml) already carries
`https://new.southvillerunningclub.co.uk/**`, and the wildcard covers it. The comment above
that line says so.

---

## Step 0 — the things that must be true first

### 0.1 — a club-owned Google account exists

> **🏛️ Committee**

**What:** an account the club owns, not one a volunteer owns. **Why:**
[no system is reachable by only one person](../../architecture/principles.md#no-system-is-reachable-by-only-one-person)
— and an OAuth client under somebody's personal Google account is the worst version of that,
because nobody would think to put it on a list. **Who:** both volunteers, to agree; whoever
holds the club's mail to create it.

- [ ] There is a Google account under a club address. **Which address is not recorded anywhere
      in this repository** — `srcdmin@gmail.com` is the shared GitHub account and
      `admin@southvillerunningclub.co.uk` is the super-admin address; **confirm with the
      committee which one owns this, or that a third is created for it, before proceeding.**
      Do not guess
- [ ] Its password and recovery method are in a place **both** volunteers can reach
- [ ] Whoever is not creating it can sign in to it, demonstrated, before step 1

**Verify:** the other volunteer signs in to it unaided. **Undo:** none needed; nothing has been
created yet.

### 0.2 — the account area works without it

> **⚙️ Ops**

- [ ] Sign up, sign in, sign out and password reset all work in production today
- [ ] The last `deploy-db.yml` run was **read**, and `[auth]` in production is what
      `config.toml` says. This matters more here than usual, for the reason in
      [step 5](#step-5--uncomment-authexternalgoogle)

---

## Step 1 — create the Cloud project

> **👥 Both**

**What:** a Google Cloud project owned by the club account. **Why:** the OAuth client lives
inside a project, and the project is the thing that has owners.

1. Sign in to the **club-owned** Google account from step 0.1 and open the Google Cloud
   Console.
2. Create a project. Give it a name a stranger would recognise — the club's name and what it
   is for. **The project *id* is generated and ugly; that is fine, because nobody sees it if
   [step 3](#step-3--the-consent-screen) is done properly.**
3. **Add the other volunteer as an Owner** — IAM → Grant access → role **Owner**. Do this now,
   in the same sitting, not "later".

**Verify:** the other volunteer opens the project in their own browser, signed in as
themselves, and can see IAM. **Undo:** delete the project. Google holds a deleted project
recoverable for a short window and then removes it.

**Record the project** in [`current-state.md`'s access list](../../foundations/current-state.md#accounts-and-access)
— [step 10](#step-10--write-down-what-happened) — because a system that is not on that list is
one nobody knows to check.

---

## Step 2 — create the OAuth client

> **⚙️ Ops**

**What:** a **Web application** OAuth 2.0 client. **Why:** it is the client id and secret pair
GoTrue presents to Google.

1. APIs & Services → **Credentials** → Create credentials → **OAuth client ID**.
2. Application type: **Web application**.
3. **Authorised redirect URIs** — add exactly one:
   `https://ketipxpyjjglwpqazsft.supabase.co/auth/v1/callback`.
   Re-read [the gotcha](#the-gotcha-before-anything-else) if there is any temptation to add the
   club's own address here.
4. **Authorised JavaScript origins** — leave empty. Nothing in this flow runs in a browser
   against Google's endpoints; the exchange is server-side.
5. Copy the **client id** and the **client secret**. The secret is shown once — put it straight
   into a password manager both volunteers can reach, and then into
   [step 4](#step-4--the-github-repository-secret).

**Verify:** the credential is listed, and the redirect URI reads back **character for
character**, including the trailing `/callback` with no slash after it. **Undo/redo:** delete
the client and make another; a new client means a new id *and* a new secret, so
[step 4](#step-4--the-github-repository-secret) and
[step 5](#step-5--uncomment-authexternalgoogle) both have to be redone.

> **The client id is not a secret and belongs in the file.** It goes in `config.toml` in
> plain text, exactly as `TURNSTILE_SITE_KEY` sits in `wrangler.jsonc`. Only the secret is
> handled as one.

---

## Step 3 — the consent screen

> **🏁 Race pages** and **⚙️ Ops**, together

**What:** the screen a member reads before they agree. **Why:** it is club-facing copy that
happens to live in a Google dashboard, and a screen saying "continue to
`nightingale-4471-a2`" is one people are right to be suspicious of.

- [ ] **App name is the club's name**, written the way the club writes it — not the project id
      and not an abbreviation
- [ ] **User support email** is a club address, not a personal one. **Which address is not
      settled in this repository — confirm it before entering one**
- [ ] The logo, if one is uploaded, is the club's
- [ ] The application home page, privacy policy and terms links point at the club's own site.
      **The site-wide privacy notice is [#60](https://github.com/southville-running-club/src-website/issues/60)
      and does not exist yet** — `/nn/privacy/` is the race's, not the site's. If Google
      requires a privacy URL before the site-wide notice is published, **stop and ask**: what
      goes there is a committee answer, not a build one
- [ ] Publishing status is **In production**, not Testing. A client left in Testing only admits
      addresses on a test-user list, and it fails for everybody else with a message that reads
      like an outage

**Verify:** at [step 7](#step-7--verify-end-to-end) somebody who has never used the site reads
the screen and can say whose it is. **Undo:** the consent screen is editable at any time; it
carries no secret and changing it needs no deploy.

---

### Scopes — email and profile, and nothing else

**What:** `email` and `profile`. **Why:** they are all the club needs — an address to identify
the account and a name to greet somebody by — and
[personal data is minimised at the boundary](../../architecture/principles.md).

`worker/account.ts`'s `handleGoogleStart` asks for exactly `email profile`, and the comment
above it says why. Anything wider has to be requested there *and* consented to at Google, so
the two halves disagree loudly rather than silently if somebody widens one.

- [ ] **No Drive. No Calendar. No contacts.** The club's documents are on Drive and that is
      precisely why this matters: a sign-in button is not a reason to hold a key to them
- [ ] Nothing on the scope list is marked sensitive or restricted. If one is, the club has
      asked for too much — the verification queue it triggers is the symptom, not the problem

**Verify:** the consent screen at [step 7](#step-7--verify-end-to-end) asks for a name and an
email address and nothing else.

---

## Step 4 — the GitHub repository secret

> **⚙️ Ops**

**What:** `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, as a **GitHub Actions repository secret**.
**Why:** `config.toml` reads it through `env(...)`, and that substitution happens wherever
`supabase config push` runs — which is `deploy-db.yml`, in Actions. It is **not** a Worker
secret and `wrangler secret put` is the wrong command for it.

**This is step 10 of [the manual steps](../../../platform/apps/main/README.md#manual-steps)**,
and the same trap applies as to the captcha secret in step 9: the CLI validates the
substitution at startup, so uncommenting the block while the secret is unset breaks
`supabase start` rather than shipping Google sign-in quietly off.

1. Repository → Settings → Secrets and variables → **Actions** → New repository secret.
2. Name `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, value the client secret from
   [step 2](#step-2--create-the-oauth-client).
3. **Do this before [step 5](#step-5--uncomment-authexternalgoogle) is merged**, not after.

**Verify:** it is listed under Actions secrets. That is all the verification GitHub offers —
**the value is masked in every log**, so a green deploy proves the file parsed, not that the
secret is right. The proof is [step 7](#step-7--verify-end-to-end), the same way the captcha
secret's proof is a real registration
([accounts-open 0.4](accounts-open.md#04--the-captcha-secret-substituted-to-something-non-empty)).

**Undo/redo:** overwrite the secret with the same name; there is no rotation window on the
GitHub side, but see [step 9](#step-9--rotating-the-secret) for what the *provider* side costs.

---

## Step 5 — uncomment `[auth.external.google]`

> **⚙️ Ops**, reviewed by **👥 Both**

**What:** a pull request against
[`platform/packages/db/supabase/config.toml`](../../../platform/packages/db/supabase/config.toml)
turning the provider on. **Why:** it is what makes GoTrue know Google exists.

```toml
[auth.external.google]
enabled = true
client_id = "<the client id from step 2>"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
```

`enable_manual_linking` stays `false`, where it already is — [step 8](#step-8--account-linking-both-directions)
is why.

> ### ⚠️ There is no partial apply, and that is the expensive part
>
> **This is [#79](https://github.com/southville-running-club/src-website/issues/79), and it has
> already cost four red deploys.** `supabase config push` applies `[auth]` as **one object**.
> If Google rejects one value — a malformed client id, a secret that substituted to an empty
> string — the whole push fails, and **it takes `site_url`, the redirect allowlist,
> `enable_signup` and the captcha secret down with it.** Meanwhile `db push`, which runs
> *first* in the same workflow, goes on succeeding.
>
> **So the deploy looks half-done rather than broken.** The migration landed, the badge is
> whatever the last step made it, and the symptom that reaches a person is that magic links
> point at the wrong host or nobody can register — with a green migration sitting above it
> saying everything is fine.
>
> **Read the `deploy-db.yml` log. All of it, to the end, on this merge.** Not the badge, not
> the summary. This is the one step on this page where "it probably worked" is how a silent
> outage starts.

1. Open the pull request. **One change** — this file and the documentation that describes it,
   nothing else; the repository is squash-only and two things in one commit cannot be reverted
   apart.
2. Confirm [step 4](#step-4--the-github-repository-secret) is done. If it is not, **do not
   merge** — `./dev up` will fail for everyone as well.
3. Merge, and **watch the run**. `config.toml` is on `deploy-db.yml`'s path filter, so it ships
   on this merge.

**Verify:**

- [ ] The `supabase config push` step is green, **read in the log rather than inferred from
      the badge**
- [ ] `site_url` and the redirect allowlist in the Supabase dashboard are still the club
      hostname — this is the blast radius, so look at it directly
- [ ] `enable_signup` is still on, and a registration with a real captcha still succeeds
- [ ] Google is listed as an enabled provider in the dashboard's auth settings

**Undo:** revert the pull request. `config.toml` ships on merge, so the revert un-ships it the
same way — and re-read the log on the way back too, for exactly the same reason.

---

## Step 6 — switch the button on

> **⚙️ Ops**

**What:** `"GOOGLE_SIGN_IN": "on"` in **both** `vars` blocks of
[`platform/apps/main/wrangler.jsonc`](../../../platform/apps/main/wrangler.jsonc) that need it,
then a Worker deploy. **Why:** the button is deliberately hidden until this is set.

**The order matters, and the reason is written into the code.** `worker/account.ts`'s `Env`
comment says it: the provider and the button are switched on **by two different people at two
different times** — `[auth.external.google]` ships on the next merge touching a migration,
while this is a Cloudflare deploy. **A button leading to a provider GoTrue does not know about
is a dead end somebody has to debug**, from a browser, with nothing useful in any log.

**So: provider first ([step 5](#step-5--uncomment-authexternalgoogle)), button second.** The
var is optional and absent means off, which is why a new environment is safe by default rather
than broken. And `handleGoogleStart` refuses with a plain message when it is not `'on'`, so
the failure mode of doing this in the wrong order is at least a sentence rather than a
redirect into nowhere.

1. Set `GOOGLE_SIGN_IN` to `"on"` in `env.production.vars`. **`vars` are not inherited from the
   top level** — Cloudflare's own rule — so the production block needs its own copy.
2. Merge; Workers Builds deploys it.
3. Leave the local top-level value alone unless a laptop has a working local provider.

**Verify:** open `/account/sign-in/` and `/account/sign-up/` signed out; the third button is
there on both. **Undo:** set it back to off (or remove the line) and deploy — that hides the
button in one deploy, with no Google or Supabase change, which makes it **the fastest way to
withdraw the feature** while something is wrong.

---

## Step 7 — verify end to end

> **👥 Both**, with **🏁 Race pages** reading the screens

From a browser with no session — a private window, or a phone that has never seen the site.

- [ ] `/account/sign-in/` shows the Google button **beside** the password form, not instead of
      it. It is a real alternative, not the primary action
- [ ] Pressing it reaches Google's consent screen, and that screen **names the club** and asks
      for an email address and a name — nothing else
- [ ] Agreeing lands back on the club's site, **signed in**, at whatever `next` was
- [ ] Refusing at Google's screen comes back to something sensible rather than a raw error
- [ ] The same from `/account/sign-up/`
- [ ] Sign out, then sign in with Google again — the second time is faster and still lands
      signed in
- [ ] **Keyboard only**: the button is reachable by tab, activates on Enter or Space, and is
      announced as what it is
- [ ] `npm run test:acceptance` is green, axe included — **zero violations, not few**

**If it fails at Google's own screen** with `redirect_uri_mismatch`, it is
[the gotcha](#the-gotcha-before-anything-else) and the fix is at Google.
**If it fails after returning to the club's site**, it is GoTrue or the callback, and the
Supabase auth logs are the place to look.

---

## Step 8 — account linking, both directions

> **👥 Both**

**What:** proving what happens when one person arrives by both routes. **Why:** #56 is explicit
that this is **decided rather than discovered** — the failure mode is a second, empty account
at the same address and a member who cannot find their own entry.

**The decision:** GoTrue links a Google sign-in to an existing account automatically when the
provider asserts a **verified** email matching one. That is the right default and the boring
one. **`enable_manual_linking` stays `false`** — the club has no screen for managing linked
identities and no volunteer to staff one.

**Direction A — password account first, then Google at the same address.**

- [ ] Register with a password at a test address, confirm it, sign out
- [ ] Sign in with Google at the **same** address
- [ ] **One account, not two.** `/admin/people/` lists the address once
- [ ] **Both routes still work**: sign out, sign in with the password, sign out, sign in with
      Google

**Direction B — Google first, then somebody tries to register with a password there.**

- [ ] Sign in with Google at a fresh test address, sign out
- [ ] Go to `/account/sign-up/` and try to register with a password at that address
- [ ] #56 says they must be **told the address already signs in with Google, rather than
      silently rejected** — a person who is told nothing tries again, then stops using the site

> **⚠️ Flagged, and not resolvable by inference.** Direction B's requirement **conflicts with
> how the sign-up form is deliberately built.** `worker/account.ts` documents that signing up
> with an address that already has an account discloses nothing, because GoTrue answers success
> either way — and `/account/reset/` was built the same way on purpose, as one acknowledgement
> whatever the address turns out to be. Telling somebody "this address signs in with Google" is
> **an account-enumeration oracle**: anybody could test addresses one at a time and learn which
> belong to members.
>
> **Both cannot be true at once, and choosing between them is not this runbook's to make.**
> Record what production actually does in [what actually happened](#what-actually-happened),
> and **take the trade to the committee** with #56 open in front of you. A plausible middle —
> saying it only in the confirmation email, which reaches the address holder and nobody else —
> is a design decision, not something to slip in here.

---

## Step 9 — rotating the secret

> **⚙️ Ops**

**Do it when** somebody who had it leaves, when it may have been pasted somewhere it should not
have been, or on whatever schedule the committee sets. **A secret that was ever exposed is
rotated, not deleted.**

Google lets a client hold more than one secret, and **that is what removes the outage window** —
add the new one before removing the old.

1. Cloud Console → Credentials → the OAuth client → **add a new client secret**.
2. Update `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in GitHub Actions secrets to the new value.
3. **Make `deploy-db.yml` run.** It is on a path filter, so a merge touching `config.toml` or a
   migration is what pushes the value — or dispatch the workflow by hand if that is available.
   **Until it runs, GoTrue is still presenting the old secret**, so this is the step that
   actually changes anything.
4. **Verify sign-in end to end** ([step 7](#step-7--verify-end-to-end)) before touching the old
   secret.
5. Only then, disable and delete the old secret at Google.

**If it goes wrong:** Google sign-in stops working and password sign-in is unaffected, so the
club is degraded rather than down. The fast withdrawal is
[step 6](#step-6--switch-the-button-on)'s var, which needs no Google access at all.

---

## Taking it all off again

In the order that costs least, so reach for the first one that is enough.

| | |
| --- | --- |
| **Hide the button** | `GOOGLE_SIGN_IN` back to off in `wrangler.jsonc` and deploy the Worker. One deploy, no Google and no Supabase. Existing accounts that were created through Google **still exist and can still sign in through GoTrue** — they simply have no button. If they have no password, they have no way in, so treat this as a pause and not a removal |
| **Turn the provider off** | Revert [step 5](#step-5--uncomment-authexternalgoogle)'s pull request. Ships on merge — and **read the deploy log**, because the no-partial-apply blast radius is the same going backwards as forwards |
| **Retire the OAuth client** | Delete the credential at Google. Do this **after** the two above, never before: deleting it while the provider is enabled leaves GoTrue presenting a secret for a client that no longer exists, which fails at Google's screen with nothing on the club's side to read |
| **Delete the Cloud project** | Only if the club is done with it entirely. Take it off the access list in the same pull request |

**Anybody who only ever signed in with Google needs a route back in before the button goes**,
and password reset is it — GoTrue sends a link to the address the Google identity asserted.
**Confirm that works before withdrawing**, rather than after somebody is locked out.

---

## Step 10 — write down what happened

> **👥 Both**

Per the [pragmatic exception](../../foundations/requirements.md#everything-is-defined-as-code),
manual work is legitimate *because* it is recorded.

- [ ] **The Cloud project goes into
      [`current-state.md`'s access list](../../foundations/current-state.md#accounts-and-access)**
      — what it is, and that **both** volunteers are owners. That table is where "four systems
      are reachable by exactly one person each" is counted; a fifth that nobody wrote down is
      worse than one that was
- [ ] **Mark step 10 of [the manual steps](../../../platform/apps/main/README.md#manual-steps)
      done**, with the date and who did it, in the same format as steps 9 and 12. Add a row for
      the Cloud project and the OAuth client if one is not already there — what, why, by whom,
      how to redo
- [ ] Fill in [what actually happened](#what-actually-happened) below
- [ ] Add a row for this runbook to
      [the runbooks index](README.md) if it is not there yet
- [ ] Close [#56](https://github.com/southville-running-club/src-website/issues/56), or leave it
      open on [step 8](#step-8--account-linking-both-directions)'s flagged question with what was
      found written into it
- [ ] **Correct this runbook** where reality differed from it. A runbook nobody corrects is
      worse than none, because it is trusted

---

## What actually happened

**Nothing yet.** This section is filled in the first time this runbook is run: the date, who
ran it, which Google account owns the project, what the consent screen ended up saying, what
production actually did in **both** linking directions — including the flagged one — and
anything done differently from the page above.
