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

1. **Ask Fasthosts two questions** — what are the mailbox sending limits, and what does a
   third or fourth mailbox cost. *If sending is capped below about 20 a day, the
   [email decision](../decisions/decision-log.md#003--buy-mailboxes-from-fasthosts) needs
   reopening before anything is bought.*
2. **Buy one admin mailbox** on the club domain. A role address, not a person's name.
3. **Send and receive a test email** on it.
4. **Set up Gmail to send as that address**, using the Fasthosts SMTP details. *Check a
   reply actually arrives from the club address, not a volunteer's.*
5. **Point that mailbox's own password-recovery address** at something the club controls,
   not a personal Gmail.
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

16. **Confirm the race date.** *1 November avoids the clocks change; 25 October is the
    morning they go back.*
17. **Create the NN repository** in the club organisation and scaffold it per the
    [build brief](nn-build-brief.md).
18. **Deploy it to its free `pages.dev` address** — no DNS needed.
19. **Create the sign-up table** in Supabase: name, email, consent, timestamp. **Nothing
    else.**
20. **Build the page, the form and the privacy notice.** Keep the race date in one file so
    changing it is a one-line edit.
21. **Test it properly** — with JavaScript off, with a duplicate submission, with bad
    input, on a 320-pixel screen.
22. **Decide by the end of August** whether 2026 entries go through the club's own site or
    stay with Full On Sport. *Paid entries want to open in early September.*

## Move the DNS to Cloudflare, changing nothing else

*Needs steps 1–10 done, and the mailbox working, so Fasthosts has finished setting up its
own mail records before the zone is copied. Detail in [move the DNS first](dns-first.md).*

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

## Move the member fund ⚠️ *the long pole — start as early as governance allows*

*Around 103 people must each personally re-establish their payment, and the mandates die
with Squarespace Payments. **This does not need the new website.***

40. **Get data-protection advice.** This is a gate, not a formality.
41. **Put treasurer-controlled payment arrangements in place.**
42. **Decide card or Direct Debit — before anybody is asked to move.** *Direct Debit is
    worth about £250 a year, and deciding late means asking 103 people twice.*
43. **Set up the payment pages.** Hosted pages need no website at all.
44. **Tell the payers**, with a deadline, and repeat it.
45. **Track it until everyone has moved**, keeping a list of who has and who hasn't.
46. **Confirm the treasurer can reconcile** all four money flows on the new arrangement.

## Rebuild the website

*Ordered by [what people actually
read](../foundations/current-state.md#what-people-actually-read).*

47. **Build the results archive first**, publishing itself from the timing data. *16.6% of
    traffic, the longest-read page on the site, and typed by hand today.*
48. **Build the main pages** — home, runner information, about the club. *61% of traffic
    between them.*
49. **Automate the newsletter mirror** from Mailchimp.
50. **Move the documents and policies** onto club-controlled storage with stable
    addresses. *Hosting, not a browsing experience — 0.9% of traffic.*
51. **Rebuild the membership pages and forms.**
52. **Re-scope the kit section before building it.** *1.1% of traffic against the largest
    build in the requirements.*
53. **Set up redirects for every existing address**, including the [old paths still
    getting traffic](../foundations/current-state.md#legacy-urls-still-receiving-traffic).
54. **Check accessibility and phone performance.** *70% of visitors are on a phone.*

## Switch the apex over

55. **Point the apex and `www` at the new site.** *A record change inside Cloudflare —
    seconds to do, seconds to undo.*
56. **Tidy the SPF record** by dropping the now-pointless `a` mechanism.
57. **Walk every old address** and confirm nothing 404s.
58. **Leave it running** while members actually use it.

## Switch Squarespace off

59. **Confirm all five are true:** the site is rebuilt and serving the apex; every URL
    resolves; the member fund has moved; every document, newsletter and image is held by
    the club; and the treasurer can reconcile.
60. **Cancel Squarespace — before 21 March 2027.**
61. **Check afterwards** that email, the website and the results archive all still work.

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
| The race date | Now — it blocks race planning *(step 16)* |
| NN 2026 entries: own site or Full On Sport | End of August *(step 22)* |
| Card or Direct Debit | Before anyone is asked to move *(step 42)* |
| A second mailbox | Once step 1 says what it costs |
| Whether the domain moves to a club-held account | No deadline. Governance, not technical |
| Committee editing | [Deferred](priorities.md#what-can-safely-be-decided-later) until it is known what they ask to change |
