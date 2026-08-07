# The plan

Step by step, from today to Squarespace switched off.

**This is the operational document.** The reasoning behind each choice lives elsewhere and
is linked where it matters — [decisions](../decisions/decision-log.md), [the DNS
move](dns-first.md), [Nightingale Nightmare](nn-first-delivery.md), [the build
brief](nn-build-brief.md), [email](../solutions/email.md).

**Steps are numbered continuously and grouped into stages.** Stages A–C can run in
parallel once A1–A6 are done. Nothing after that reorders safely.

---

## The two real dates

| | |
| --- | --- |
| **Nightingale Nightmare** | 25 October or **1 November 2026** — unconfirmed, and 25 October is clocks-change morning |
| **Squarespace renews** | **21 March 2027, automatically.** Silence costs £204 |

## The critical path is not technical

**Around 103 people must each personally re-establish a payment**, the mandates cannot be
transferred, and because the processor is Squarespace Payments they cannot outlive the
platform. It is growing by roughly 45 payments a month against a fixed date.

**Stage F is the one that can run out of road.** Everything else has slack.

---

## Stage A — Identity, before anything can be owned

*The club cannot own an account without an address of its own. Nothing else starts here.*

| # | Do | Verify |
| --- | --- | --- |
| **A1** | **Ask Fasthosts two questions**: what are the mailbox sending limits, and what does a third and fourth mailbox cost? | Answers in writing. **If sending is capped below ~20/day, [reopen the email decision](../decisions/decision-log.md#003--buy-mailboxes-from-fasthosts)** |
| **A2** | **Buy one admin mailbox** — a role address, not a person's | It exists |
| **A3** | **Send and receive a test message** on it | Both directions work |
| **A4** | **Configure Gmail *Send mail as*** using the Fasthosts SMTP credentials | A reply **leaves from the club address**, and passes SPF |
| **A5** | **Set the mailbox's own recovery address** to something club-controlled, not a personal Gmail | Not a volunteer's personal account |
| **A6** | **Create the club Cloudflare account** under the new address | Login works |
| **A7** | **Create the Supabase account** under it; **regularise the GitHub organisation**, which today sits under `srcdmin@gmail.com` | Both club-owned |
| **A8** | **Add the second volunteer as a full admin** on Cloudflare, Supabase and GitHub — in their own right, not a shared login | Each can log in independently |
| **A9** | **Turn on two-factor authentication** on all four, including **Squarespace Payments, where it is currently off** | Enrolled on each |
| **A10** | **Move the timing repository into the club organisation** | It no longer sits in a personal account |

> **Stop here if A3 or A4 fails.** Everything downstream assumes the club has a working
> address of its own.

## Stage B — Rescue what cannot be recovered later

*Free now. Impossible after cancellation. Do it early and do not treat it as tidying.*

| # | Do | Verify |
| --- | --- | --- |
| **B1** | **Download all ~45 club documents** from Squarespace's CDN | Count matches the [inventory](../reference/existing-site.md) |
| **B2** | **Retrieve the 7 documents held on Google Drive** | Outside club control today |
| **B3** | **Download all 33 newsletters** and every image on the site | Nothing left only on the CDN |
| **B4** | **Store them where the club controls them** and record what was retrieved | A second person can find them |

## Stage C — Nightingale Nightmare

*Needs A6 to deploy. Nothing else. Runs alongside Stage D — but not in the same week.*

| # | Do | Verify |
| --- | --- | --- |
| **C1** | **Repository in the club organisation**, Astro scaffold per the [build brief](nn-build-brief.md) — static output, no adapter | CI green |
| **C2** | **Deploy to `<project>.pages.dev`** | Real HTTPS, no DNS involved |
| **C3** | **Supabase table**: name, email, consent, timestamp. **Nothing else** | Row-level security on, anon key only |
| **C4** | **Page, form and privacy notice.** Hold the race date in `race.json`; publish it only once committed | Reads correctly *without* a date |
| **C5** | **Test properly**: JavaScript disabled, duplicate submission, malformed input, axe clean, 320 px wide | Every [acceptance criterion](nn-build-brief.md#definition-of-done) |
| **C6** | **Decide NN 2026 entries — club-built or Full On Sport** | **By end of August.** Paid entries want to open in early September |

## Stage D — Move the DNS, change nothing

*Needs A1–A9 complete, especially the mailbox verified — Fasthosts must finish configuring
its own mail records before the zone is captured. Full analysis: [move the DNS
first](dns-first.md).*

| # | Do | Verify |
| --- | --- | --- |
| **D1** | **Capture the zone** from Fasthosts and **commit it to this repository** | 18 records. It is the rollback reference |
| **D2** | **Diff the capture against a live query** of `ns1.livedns.co.uk` | They agree. Anything missing is found now, not later |
| **D3** | **Lower every TTL at Fasthosts to 300s.** Wait **one hour** — current TTLs are 3600 | `dig` shows 300 |
| **D4** | **Add the zone to Cloudflare** and let it scan. **Do not change the nameservers yet** | Zone shows "pending" |
| **D5** | **Turn 11 records grey.** The 4 apex `A`, `mail`, `mailserver`, `smtp`, `webmail`, `mcp`, `www`, and the Squarespace verification CNAME | **Zero orange clouds in the zone** |
| **D6** | **Add anything the scan missed**, by hand, against D1 | All 18 present |
| **D7** | **Decline Email Routing** if Cloudflare offers it | MX records untouched |
| **D8** | **Diff Cloudflare's nameservers against Fasthosts'**, record by record | **Byte-identical answers** |
| **D9** | **Second volunteer checks the diff** | Independently confirmed |
| **D10** | **Change the nameservers at Fasthosts** to Cloudflare's. Quiet weekday morning, day free | One action |
| **D11** | **Immediately: send and receive on a club address** | **Mail first, always** |
| **D12** | **Confirm the apex still returns Squarespace's four addresses** — not a Cloudflare address | A Cloudflare address means something is proxied |
| **D13** | **Confirm the site loads**, on mobile data as well as broadband | Unchanged for members |
| **D14** | **Wait 48 hours. Change nothing in either zone** | Both nameserver sets are live and must agree |
| **D15** | **Raise TTLs. Commit the zone as code** (Terraform or OpenTofu). **Leave the Fasthosts zone intact for a month** | The next change is a pull request |

> **If something breaks: repair forward at Cloudflare** — effective in 300 seconds.
> Reverting the nameservers takes **up to 48 hours**, and is the last resort.

## Stage E — Nightingale Nightmare live

| # | Do | Verify |
| --- | --- | --- |
| **E1** | **Add `nn`** — a record inside Cloudflare if D is done, otherwise [one additive CNAME at Fasthosts](../solutions/dns-and-domain.md#move-1--add-a-record-no-risk) | Associate the domain in the Cloudflare dashboard **first**, or you get a 522 |
| **E2** | **Confirm HTTPS and the form end to end** | A row lands; both volunteers can see it |
| **E3** | **Announce.** Not before E2 — a name that does not resolve is cached as non-existent for an hour | |

## Stage F — Payments and the member fund ⚠️ *the critical path*

*Starts as early as governance allows. Runs for months. **Does not need the website.***

| # | Do | Verify |
| --- | --- | --- |
| **F1** | **Obtain data-protection advice** | A gate, not a formality |
| **F2** | **Put treasurer-controlled payment arrangements in place** | The club, not an individual |
| **F3** | **Decide card or Direct Debit — before anyone is asked to move** | Direct Debit is worth **~£250/yr**. Getting this wrong means asking 103 people twice |
| **F4** | **Set up the processor** and hosted payment pages — **no website required** | A payment can be taken |
| **F5** | **Communicate to the ~103 payers**, with a deadline | Sent, and repeated |
| **F6** | **Track migration to completion** | A list of who has and has not moved |
| **F7** | **Confirm the treasurer can reconcile** all four money flows | Before Stage I |

> **F3 before F5.** Everything else in this stage is communications.

## Stage G — Rebuild the website

*Ordered by [what people actually
read](../foundations/current-state.md#what-people-actually-read).*

| # | Do | Why in this order |
| --- | --- | --- |
| **G1** | **Results archive, published from the timing data** | **16.6% of traffic, 6:08 dwell — the most-read page on the site, and typed by hand today** |
| **G2** | Home, runner information, about the club | 61% of traffic between them. Mostly markdown in the repository |
| **G3** | Newsletter mirror from Mailchimp — scheduled job | Removes the process the club is already failing to keep up with |
| **G4** | Membership pages and forms | |
| **G5** | Documents and policies onto club-controlled storage | **Stable URLs, not a product.** 0.9% of traffic |
| **G6** | **Kit — re-scope before building** | 1.1% of traffic against the largest build in the requirements |
| **G7** | **Redirects for every existing URL**, including the [legacy paths still taking traffic](../foundations/current-state.md#legacy-urls-still-receiving-traffic) | A condition of cutover |
| **G8** | Accessibility and performance pass — WCAG 2.2 AA, 70% of visitors are on a phone | |

## Stage H — Cut the apex over

| # | Do | Verify |
| --- | --- | --- |
| **H1** | **Repoint the apex and `www`** at the new site — a record change **inside Cloudflare** | Seconds to make, seconds to reverse |
| **H2** | **Drop the now-pointless `a` mechanism** from the SPF record | It authorises whatever the apex points at |
| **H3** | **Walk every URL** from the sitemap and the legacy list | Nothing 404s |
| **H4** | **Leave it running** while members use it | Before anything is cancelled |

## Stage I — Switch Squarespace off

**Before 21 March 2027.** All five must be true:

- [ ] The website is rebuilt, proven, and serving the apex *(H)*
- [ ] Every URL still resolves *(G7, H3)*
- [ ] The member fund has fully moved — or the old fund page is
  [redirected](priorities.md#the-escape-hatch) *(F)*
- [ ] Every document, newsletter and image is held by the club *(B)*
- [ ] The treasurer can reconcile on the new arrangement *(F7)*

Then cancel, and confirm afterwards that mail, the site and the results archive all still
work.

---

## What it costs when this is done

| | Per year |
| --- | --- |
| Today | **£735** |
| After | **£427** |
| With Direct Debit | **£177** |

**The money was never the point.** The larger return is the [manual
chain](../foundations/problem-statement.md#3-volunteers-are-doing-work-the-system-should-do),
and the one measure still uncaptured is volunteer time.

## What gets worse if this waits

| | |
| --- | --- |
| **The member fund** | Grows ~45 payments a month. More people to ask, same deadline |
| **Content on Squarespace's CDN** | Retrievable now, gone at cancellation |
| **Accounts reachable by one person** | Deteriorates purely with time |
| **The renewal** | Automatic. Silence costs £204 |

## Still to decide, and by when

| | By |
| --- | --- |
| **The Nightingale Nightmare date** | Now — it blocks race planning |
| **NN 2026 entries: club-built or Full On Sport** | End of August *(C6)* |
| **Card or Direct Debit** | Before anyone is asked to move *(F3)* |
| **A second mailbox** | After A1 answers what it costs |
| **Whether the domain moves to a club-held account** | No deadline. Governance, not technical |
| **Committee editing** | [Deferred](priorities.md#what-can-safely-be-decided-later) until it is known what they ask to change |
