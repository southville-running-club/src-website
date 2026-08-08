# The plan

Everything to do, in order, from today until Squarespace is switched off.

**For a plain summary to share with the committee, read [the nine-step
overview](overview.md) instead.** This is the working document.

**One numbered list.** The reasoning behind each choice is elsewhere and linked where it
matters — [decisions](../decisions/decision-log.md), [the DNS move](dns-first.md),
[Nightingale Nightmare](nn-first-delivery.md), [the build brief](nn-build-brief.md),
[email](../solutions/email.md).

**Two dates are real.** The Nightingale Nightmare race, 25 October or 1 November 2026 —
still unconfirmed. And **Squarespace renews automatically on 21 March 2027**; silence
costs £204.

---

## Get the club an identity

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

## Rescue what disappears when Squarespace is cancelled

*Free to do now. Impossible later. Can run alongside everything below.*

12. **Download every club document** from Squarespace — around 45 of them.
13. **Retrieve the seven documents** that live on Google Drive.
14. **Download all 33 newsletters and every image** on the site.
15. **Store the lot somewhere the club controls**, and write down what was retrieved.

## Get Nightingale Nightmare started

*Needs step 6. Nothing else.*

16. **Confirm the race date.** **Halloween weekend — 31 October or 1 November 2026.** *Not
    yet exact, and it does not need to be: the page is built to read correctly without a
    date, and every race fact lives in one file. **The clocks go back on Sunday 25
    October**, so a Halloween-weekend race is safely the following weekend, in GMT — the
    hazard the earlier "25 October or 1 November" wording was warning about is gone.
    Timezone discipline still applies to anything spanning the change.*
17. **Create `apps/nn` in this repository** and scaffold it per the
    [build brief](nn-build-brief.md). *Monorepo, per
    [ADR-001](../architecture/decisions/adr-001-one-monorepo.md) — not a separate
    repository.*
18. **Deploy it to its free `pages.dev` address** — no DNS needed. *Steps 17–18 and 37–39
    are a runbook: [Nightingale Nightmare onto the club
    domain](runbooks/nn-to-club-domain.md).*
19. **Create the sign-up table**: **`intake.nn_interest`** — name, email, consent,
    timestamp. **Nothing else.** *Schema per
    [ADR-002](../architecture/decisions/adr-002-schema-layout.md); anonymous insert is
    confined to `intake`, which holds no membership data.*
20. **Build the page, the form and the privacy notice.** Keep the race date in one file so
    changing it is a one-line edit.
21. **Test it properly** — with JavaScript off, with a duplicate submission, with bad
    input, on a 320-pixel screen.
22. **Decide by the end of August** whether 2026 entries go through the club's own site or
    stay with Full On Sport. *Paid entries want to open in early September.*

## Move the DNS to Cloudflare, changing nothing else

*Needs steps 1–10 done, and the mailbox working, so Fasthosts has finished setting up its
own mail records before the zone is copied. Reasoning in [move the DNS
first](dns-first.md); **steps 23–36 are written out as an executable checklist in [the
nameserver-move runbook](runbooks/nameserver-move.md)**, which folds in the
import-with-proxying-off shortcut for step 27.*

23. **Write down every DNS record at Fasthosts** and commit it to this repository. *This
    is the rollback reference.*
24. **Check what you wrote down matches a live lookup.** There should be 18 records.
25. **Lower every record's timing to 5 minutes** at Fasthosts, then **wait an hour.**
26. **Add the domain to Cloudflare** and let it import the records. **Do not change the
    nameservers yet.**
27. **Turn the orange cloud off on eleven records** — the four apex ones, `mail`,
    `mailserver`, `smtp`, `webmail`, `mcp`, `www`, and the Squarespace verification
    record. *Cloudflare turns the proxy on by default. Nothing should be orange.*
28. **Add anything the import missed**, by hand.
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
36. **Put the DNS records into code** in the repository. **Leave the Fasthosts zone alone
    for a month** as the rollback.

> **If anything breaks, fix it at Cloudflare** — that takes 5 minutes. Reverting the
> nameservers takes up to 48 hours and is the last resort.

## Put Nightingale Nightmare on the club domain

37. **Add the `nn` record.** *Associate the domain in the Cloudflare dashboard first, then
    add the record — the other way round gives a 522 error.*
38. **Test the whole thing end to end** — the page loads over HTTPS and a sign-up actually
    lands in the table.
39. **Announce it.** Not before step 38 — an address that doesn't resolve is remembered as
    not existing for an hour.

## Put the timing app behind the club domain

*Additive and low risk — but it touches a race-critical system. **Do this in August, or
after the race in November. Not in the weeks between.***

40. **Add `timing.southvillerunningclub.co.uk`** as a custom domain in Vercel, and the
    matching record in DNS. *The timing app stays on Vercel — only its address changes.*
41. **Update the Supabase Auth redirect addresses** and anything with the old domain
    written into it. *Magic links break silently if this is missed.*
42. **Test a marshal sign-in and an offline capture** on the new address before relying on
    it.

## Stand up the new site alongside the old ⚠️ *the highest-value step in the plan*

*The old site keeps running throughout — [what the requirements always asked
for](../foundations/requirements.md#continuity). The new one grows beside it at
`new.southvillerunningclub.co.uk`, with **paths matching the old site** so every address
is proven long before anything switches.*

43. **Create the new site project** and serve it at `new.southvillerunningclub.co.uk`.
44. **Set `noindex` across the whole subdomain.** *Two copies of the same content
    otherwise split the club's search results — 314 visits a month arrive from Google.*
45. **Build the payment page first**, before anything else on the site.
46. **Take one real payment end to end** and confirm the treasurer can see it.
47. **Send every new subscriber to the new page from that day on.** ***This is the point
    of doing it early: the old list stops growing.*** *It currently adds about 45 payments
    a month, and every one is somebody who would otherwise have to be asked to move
    twice.*

## Move the member fund ⚠️ *the long pole — but now a fixed number, not a growing one*

*Around 103 people must each personally re-establish their payment; the mandates die with
Squarespace Payments. **Needs step 45, not the finished website.***

48. **Get data-protection advice.** This is a gate, not a formality.
49. **Put treasurer-controlled payment arrangements in place.**
50. **Decide card or Direct Debit — before anybody is asked to move.** *Direct Debit is
    worth about £250 a year, and deciding late means asking 103 people twice.*
51. **Tell the existing payers**, with a deadline, and repeat it.
52. **Track it until everyone has moved**, keeping a list of who has and who hasn't.
53. **Accept that two payment sources are being reconciled** while this runs — money
    arriving at Squarespace and at the new page. *Time-box it rather than letting it
    drift.*

## Build the rest of the new site

*On `new.`, with paths mirroring the old site. Ordered by [what people actually
read](../foundations/current-state.md#what-people-actually-read).*

54. **Build the results archive**, publishing itself from the timing data. *16.6% of
    traffic, the longest-read page on the site, and typed by hand today.*
55. **Build the main pages** — home, runner information, about the club. *61% of traffic
    between them.*
56. **Automate the newsletter mirror** from Mailchimp.
57. **Move the documents and policies** onto club-controlled storage with stable
    addresses. *Hosting, not a browsing experience — 0.9% of traffic.*
58. **Rebuild the membership pages and forms.**
59. **Re-scope the kit section before building it.** *1.1% of traffic against the largest
    build in the requirements.*
60. **Confirm every old address has a match on the new site**, including the [old paths
    still getting
    traffic](../foundations/current-state.md#legacy-urls-still-receiving-traffic).
    *Because the paths align, this can be checked for real rather than promised.*
61. **Check accessibility and phone performance.** *70% of visitors are on a phone.*

## The switch

*One coordinated moment, because Squarespace 301-redirects every secondary domain to its
primary — so the old site cannot be reachable at `old.` while it is still serving `www`.*

62. **Decide where the old site lives afterwards.** Either
    **`old.southvillerunningclub.co.uk`** — which means changing Squarespace's primary
    domain — or simply its **built-in Squarespace address**, which needs no DNS and no
    change at all. *The second is free and adequate for a treasurer and a few stragglers.*
63. **In one sitting:** point the apex and `www` at the new site, and switch Squarespace's
    primary domain if using `old.`
64. **Tidy the SPF record** by dropping the now-pointless `a` mechanism.
65. **Remove `noindex`, and redirect `new.` to the apex.** *Anyone who bookmarked it is
    not stranded.*
66. **Walk every old address** and confirm nothing 404s.
67. **Leave it running** while members actually use it.

## Switch Squarespace off

68. **Confirm all five are true:** the site is rebuilt and serving the apex; every URL
    resolves; the member fund has moved; every document, newsletter and image is held by
    the club; and the treasurer can reconcile.
69. **Cancel Squarespace — before 21 March 2027.**
70. **Check afterwards** that email, the website and the results archive all still work.

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
| ~~The race date~~ | **Halloween weekend.** Exact day still to fix, and nothing waits on it *(step 16)* |
| NN 2026 entries: own site or Full On Sport | End of August *(step 22)* |
| Card or Direct Debit | Before anyone is asked to move *(step 42)* |
| ~~A second mailbox~~ | **Answered** — five are included at no extra cost |
| Whether the domain moves to a club-held account | No deadline. Governance, not technical |
| Committee editing | [Deferred](priorities.md#what-can-safely-be-decided-later) until it is known what they ask to change |
