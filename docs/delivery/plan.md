# The plan

Everything to do, in order, from today until Squarespace is switched off.

**For a plain summary to share with the committee, read [the overview](overview.md)
instead.** This is the working document.

**One numbered list.** The reasoning behind each choice is elsewhere and linked where it
matters — [decisions](../decisions/decision-log.md), [the DNS move](dns-first.md),
[Nightingale Nightmare](nn-first-delivery.md), [the build brief](nn-build-brief.md),
[email](../solutions/email.md).

**For the shape rather than the detail, read [the seven phases](phases.md)** — every heading
below is labelled with the phase it belongs to, and the two documents describe the same
programme at different resolutions. **Procedures live in [the runbooks](runbooks/).**

**Four dates are real.** **NN sign-ups and payment live ~22 August 2026.** **The timing app
race-ready by mid-October.** **Race day Sunday 1 November 2026, 11:00** — confirmed on
12 August. And **Squarespace renews automatically on 21 March 2027**; silence costs £204.

---

## Phase 3 · Get the club an identity

1. ~~**Ask Fasthosts two questions**~~ — **done.** Sending limits are fine and the package
   allows **five mailboxes** at no extra cost, so the
   [email decision](../decisions/decision-log.md#003--buy-mailboxes-from-fasthosts) stands
   and the "a second mailbox" question below is answered.
2. **Buy one admin mailbox** on the club domain. A role address, not a person's name.
   ✅ **Done.**
3. ~~**Send and receive a test email** on it.~~ ✅ **Done** — both directions confirmed.
4. **Set up Gmail to send as that address**, using the Fasthosts SMTP details. *Check a
   reply actually arrives from the club address, not a volunteer's.*
5. **Make sure the mailbox has a recovery route both volunteers can reach.** *A Fasthosts
   mailbox is a resource under the hosting account, not an identity — it has no recovery
   address of its own, and **the Fasthosts control panel is its only recovery path.** So:
   confirm the **Fasthosts account's** recovery address is **not** on the club domain, or a
   mail outage locks the club out of the panel that fixes mail; and make sure both
   volunteers can reach that panel, because the club mailbox is the account address for
   Cloudflare, Supabase and GitHub.*
6. **Create a club Cloudflare account** using the new address.
7. **Create a club Supabase account** using the new address.
8. **Sort out the club GitHub organisation** so it runs under that address too. *It
   currently sits under `srcdmin@gmail.com` — the typo is in the address itself.*
9. **Add the second volunteer as a full admin** on Cloudflare, Supabase and GitHub — their
   own login, not a shared one.
10. **Turn on two-factor authentication** on all three, and on **Squarespace Payments,
    where it is currently switched off.**
11. **Move the race-timing repository** into the club GitHub organisation.

> **Stop if steps 3 or 4 fail.** Everything after this assumes the club has a working
> address of its own.

## Alongside · Rescue what disappears when Squarespace is cancelled

*Free to do now. Impossible later. Can run alongside everything below.*

12. **Download every club document** from Squarespace — around 45 of them.
13. **Retrieve the seven documents** that live on Google Drive.
14. **Download all 33 newsletters and every image** on the site.
15. **Store the lot somewhere the club controls**, and write down what was retrieved.

## Phase 3 · Nightingale Nightmare — live by ~22 August

*Needs step 6. Nothing else.*

16. ~~**Confirm the race date.**~~ — **done, 12 August 2026: Sunday 1 November 2026, start
    11:00.** Settled by the club's published campaign artwork. *It landed as a one-line edit
    to `apps/main/src/content/race.json` with **no change to any page**, which is the
    property the file was built for and is worth recording as having held. **The clocks go
    back on Sunday 25 October**, so the race is the following weekend and runs in GMT.
    Timezone discipline still applies to anything spanning the change.* **The 2026 ARC
    permit number is the one race fact still outstanding** — `null`, rendering as "to be
    confirmed", and not filled with 2023's.*
17. ~~**Create `apps/nn` in this repository**~~ — **done differently: it lives at `/nn`
    inside `apps/main`**, per [ADR-006](../architecture/decisions/adr-006-apps-main-and-hostnames-as-code.md)
    and [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).
    Scaffolded per the [build brief](nn-build-brief.md). *Monorepo, per
    [ADR-001](../architecture/decisions/adr-001-one-monorepo.md) — not a separate
    repository, and not a separate application either.*
18. **Connect `apps/main` to Cloudflare Workers Builds**, deploying it to its free
    `workers.dev` address — no DNS needed yet. *Steps 17–18 and 37–39 are now one runbook:
    [Cloudflare setup](runbooks/cloudflare-setup.md).*
19. **Create the sign-up table**: **`intake.nn_interest`** — name, email, consent,
    timestamp. **Nothing else.** *Schema per
    [ADR-002](../architecture/decisions/adr-002-schema-layout.md); anonymous insert is
    confined to `intake`, which holds no membership data.*
20. ~~**Build the page, the form and the privacy notice**~~ — **done**, and since extended
    with the confirmed date and three content pages, then split between the race and one
    running of it: `/nn/` is evergreen, `/nn/2026/` carries the date and the entry form, and
    `/nn/2026/race-day/` and `/nn/2026/spectators/` sit beneath it, with a two-level
    navigation across them. **`/nn/course/` was the second evergreen page and it is gone**
    — the club supplied its copy for `/nn/` instead, and the address 301s there —
    [ADR-011](../architecture/decisions/adr-011-a-race-and-its-runnings.md). The interest
    form takes name, email and consent and nothing else; the privacy notice is at
    `/nn/privacy/`. *Every race fact,
    and every privacy specific nobody has confirmed, lives in
    `apps/main/src/content/race.json` — confirmed ones as values, unconfirmed ones as `null`
    rendering as "To be confirmed".* **The page copy is a draft pending committee approval**,
    and the rest is [what the race pages still need from the
    committee](phases.md#what-the-race-pages-still-need-from-the-committee).
21. ~~**Test it properly**~~ — **done.** With JavaScript off in a third Playwright project,
    with a duplicate submission, with bad input, at 320 pixels, and with axe at zero
    violations. *The assertion that matters is the negative one: an anonymous client can
    insert and **cannot** read, change or delete the list, asserted by error code.*
22. ~~**Decide whether 2026 entries go through the club's own site or stay with Full On
    Sport**~~ — **decided: the club's own site**, with Stripe. That is what Phase 3 builds.

## Phase 2 · Move the DNS to Cloudflare, changing nothing else ✅

> **Steps 23–35 done, 8 August 2026.** Delegation is
> `bonnie.ns.cloudflare.com` / `hans.ns.cloudflare.com`. All 18 records verified identical,
> nothing proxied, site and mail unaffected. **Step 36 outstanding** — the zone export is
> committed after the 48-hour window closes on 10 August.
>
> Reasoning in [move the DNS first](dns-first.md); the executable checklist and
> [what actually happened](runbooks/nameserver-move.md#what-actually-happened-8-august-2026)
> are in [the runbook](runbooks/nameserver-move.md). **Three steps below did not survive
> contact** and are annotated accordingly.

23. **Write down every DNS record at Fasthosts** and commit it to this repository. *This
    is the rollback reference.*
24. **Check what you wrote down matches a live lookup.** There should be 18 records.
25. ~~**Lower every record's timing to 5 minutes**~~ — **not possible. Fasthosts has no TTL
    field**, which is why the zone showed a uniform 3600. Skipped, along with the wait, and
    it cost nothing: Cloudflare's records came in at Auto/1 min, which is where the
    fast-correction property actually lives.
26. **Add the domain to Cloudflare** and let it import the records. **Do not change the
    nameservers yet.**
27. **Turn the orange cloud off.** *Nine arrived proxied; the two proxiable records the scan
    missed arrived orange when added, making eleven in total, as documented.*
28. ⚠️ **Add anything the import missed** — **the scan found 12 of 18.** It missed **all four
    DKIM CNAMEs**, the Squarespace verification CNAME, and `mcp`. *Proceeding without this
    would have kept mail flowing while silently breaking DKIM. **Count the records against
    the committed zone; do not glance at the list.***
29. **Say no if Cloudflare offers to take over your email.** It would replace the MX
    records.
30. **Check Cloudflare gives identical answers to Fasthosts**, record by record.
31. **Have the second volunteer check it too**, independently.
32. **Change the nameservers at Fasthosts to Cloudflare's.** A quiet weekday morning, with
    the rest of the day free.
33. **Immediately send and receive a test email.** *Mail first, always.*
34. **Check the website still loads** and still resolves to Squarespace's addresses — not
    a Cloudflare one. *A Cloudflare address means something is still proxied.*
35. **Wait 48 hours and change nothing in either zone.** *Both nameserver sets are live
    during this window and must agree.*
36. **Export the Cloudflare zone and commit it**, replacing the Fasthosts export as the live
    reference. **Leave the Fasthosts zone alone for a month** as the rollback. *No IaC tool
    — [ADR-005](../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md): a
    record change is a pull request against the committed file, applied by hand, then
    re-exported to confirm it matches.*

> **If anything breaks, fix it at Cloudflare** — that takes 5 minutes. Reverting the
> nameservers takes up to 48 hours and is the last resort.

## Phase 3 · Put Nightingale Nightmare on the club domain

37. **Attach `new.southvillerunningclub.co.uk` as a custom domain on the Worker**, serving
    the site at `/` and Nightingale Nightmare at `/nn` — [ADR-007](../architecture/decisions/adr-007-one-hostname-paths-not-subdomains.md).
    *Cloudflare creates the DNS record and the certificate. Nothing at Fasthosts — its panel
    is no longer authoritative. This record **is** proxied; Cloudflare is the origin.*
38. **Test the whole thing end to end** — the page loads over HTTPS and a sign-up actually
    lands in the table.
39. **Announce it.** Not before step 38 — an address that doesn't resolve is remembered as
    not existing for an hour.

## Phase 4 · The timing app on Cloudflare — race-ready by mid-October

⚠️ ***The only phase touching a system that cannot be re-run.*** **Before the race, and
Nightingale Nightmare 2026 is timed on it** —
[ADR-008](../architecture/decisions/adr-008-timing-port-before-the-race.md), which reverses
the earlier *"after the race, not before"* recorded here.

> The [risk constraint](../foundations/requirements.md#risk) is honoured by **the rehearsal
> and the fallback, not by the calendar**. The [race
> simulation](phases.md#the-gate-on-phase-4) is the sign-off, mid-October is chosen so it
> has a fortnight behind it, and **the existing Vercel deployment stays live until the
> simulation passes.** If it does not pass, the race runs on Vercel and no further decision
> is needed.

> **This phase depends on steps 23–36 having happened.** The app is Next.js using Node APIs,
> so it needs `@opennextjs/cloudflare`, which targets **Workers** — and **Workers custom
> domains require an active Cloudflare zone**. See
> [the ordering problem](phases.md#phase-2--move-the-nameservers).

40. **Port the app to Workers** with `@opennextjs/cloudflare`, and **move the repository into
    the monorepo** — into the club organisation *first*, then connect Cloudflare, or the git
    link desyncs.
41. **Add the route `new.southvillerunningclub.co.uk/timing/*`** to the timing Worker — a
    route, not a custom domain, so it needs no DNS record of its own.
42. **Update the Supabase Auth redirect addresses** and anything with the old domain written
    into it. *Magic links break silently if this is missed.*
43. **Rebuild the live leaderboard on Durable Objects**, not Supabase Realtime. *Realtime
    caps at 200 concurrent connections and Pro is £237/yr; hibernatable WebSockets on the
    free plan make this close to free. This is a rebuild, not a port.*
44. **Run a full manual race simulation** — multiple devices, real connectivity loss, the
    real race date. *No test suite replaces it, and it is the sign-off.*

> **Three things a port must not break:** the IndexedDB offline queue and its
> idempotent-upsert contract; the TypeScript/SQL lockstep on bib resolution; and the
> `Europe/London` pinning.

## Phase 5 · Stand up the new site alongside the old ⚠️ *the highest-value step in the plan*

*The old site keeps running throughout — [what the requirements always asked
for](../foundations/requirements.md#continuity). The new one grows beside it at
`new.southvillerunningclub.co.uk`, with **paths matching the old site** so every address
is proven long before anything switches.*

45. **Create the new site project** and serve it at `new.southvillerunningclub.co.uk`.
46. **Set `noindex` across the whole subdomain.** *Two copies of the same content
    otherwise split the club's search results — 314 visits a month arrive from Google.*
47. **Build the payment page first**, before anything else on the site.
48. **Take one real payment end to end** and confirm the treasurer can see it.
49. **Send every new subscriber to the new page from that day on.** ***This is the point
    of doing it early: the old list stops growing.*** *It currently adds about 45 payments
    a month, and every one is somebody who would otherwise have to be asked to move
    twice.*

## Phase 6 · Move the member fund ⚠️ *the long pole — but now a fixed number, not a growing one*

*Around 103 people must each personally re-establish their payment; the mandates die with
Squarespace Payments. **Needs step 45, not the finished website.***

50. **Get data-protection advice.** This is a gate, not a formality.
51. **Put treasurer-controlled payment arrangements in place.**
52. **Decide card or Direct Debit — before anybody is asked to move.** *Direct Debit is
    worth about £250 a year, and deciding late means asking 103 people twice.*
53. **Tell the existing payers**, with a deadline, and repeat it.
54. **Track it until everyone has moved**, keeping a list of who has and who hasn't.
55. **Accept that two payment sources are being reconciled** while this runs — money
    arriving at Squarespace and at the new page. *Time-box it rather than letting it
    drift.*

## Phase 5 · Build the rest of the new site

*On `new.`, with paths mirroring the old site. Ordered by [what people actually
read](../foundations/current-state.md#what-people-actually-read).*

56. **Build the results archive**, publishing itself from the timing data. *16.6% of
    traffic, the longest-read page on the site, and typed by hand today.*
57. **Build the main pages** — home, runner information, about the club. *61% of traffic
    between them.*
58. **Automate the newsletter mirror** from Mailchimp.
59. **Move the documents and policies** onto club-controlled storage with stable
    addresses. *Hosting, not a browsing experience — 0.9% of traffic.*
60. **Rebuild the membership pages and forms.**
61. **Re-scope the kit section before building it.** *1.1% of traffic against the largest
    build in the requirements.*
62. **Confirm every old address has a match on the new site**, including the [old paths
    still getting
    traffic](../foundations/current-state.md#legacy-urls-still-receiving-traffic).
    *Because the paths align, this can be checked for real rather than promised.*
63. **Check accessibility and phone performance.** *70% of visitors are on a phone.*

## Phase 7 · The switch

*One coordinated moment, because Squarespace 301-redirects every secondary domain to its
primary — so the old site cannot be reachable at `old.` while it is still serving `www`.*

64. **Decide where the old site lives afterwards.** Either
    **`old.southvillerunningclub.co.uk`** — which means changing Squarespace's primary
    domain — or simply its **built-in Squarespace address**, which needs no DNS and no
    change at all. *The second is free and adequate for a treasurer and a few stragglers.*
65. **In one sitting:** point the apex and `www` at the new site, and switch Squarespace's
    primary domain if using `old.`
66. **Tidy the SPF record** by dropping the now-pointless `a` mechanism.
67. **Remove `noindex`, and redirect `new.` to the apex.** *Anyone who bookmarked it is
    not stranded.*
68. **Walk every old address** and confirm nothing 404s.
69. **Leave it running** while members actually use it.

## Phase 7 · Switch Squarespace off

70. **Confirm all five are true:** the site is rebuilt and serving the apex; every URL
    resolves; the member fund has moved; every document, newsletter and image is held by
    the club; and the treasurer can reconcile.
71. **Cancel Squarespace — before 21 March 2027.**
72. **Check afterwards** that email, the website and the results archive all still work.

---

## What it costs when this is done

| | Per year |
| --- | --- |
| Today | **£735** |
| After | **£427** |
| With Direct Debit as well | **£177** |

**The money was never the point.** The larger return is the [manual
work](../foundations/problem-statement.md#3-volunteers-are-doing-work-the-system-should-do)
this removes, and volunteer time is the one measure still uncaptured.

## What gets worse if it waits

- **The member fund** grows by about 45 payments a month. Same deadline, more people to
  ask.
- **Content on Squarespace** is retrievable now and gone at cancellation.
- **Accounts reachable by one person** deteriorate purely with time.
- **The renewal is automatic.** Silence costs £204.

## Still to decide

| | By |
| --- | --- |
| ~~The race date~~ | **Settled — Sunday 1 November 2026, 11:00**, confirmed 12 August *(step 16)* |
| ~~The 2026 ARC permit number~~ | **Settled — `ARC/26/0842`**, issued 27 August 2026 |
| The Nightingale Nightmare page copy | **Committee's to approve.** What is on the site is a draft written to be edited *(step 20)* |
| ~~NN 2026 entries: own site or Full On Sport~~ | **Decided — the club's own site, with Stripe** *(step 22)* |
| Card or Direct Debit | Before anyone is asked to move *(step 52)* |
| ~~A second mailbox~~ | **Answered** — five are included at no extra cost |
| Whether the domain moves to a club-held account | No deadline. Governance, not technical |
| Committee editing | [Deferred](priorities.md#what-can-safely-be-decided-later) until it is known what they ask to change |
