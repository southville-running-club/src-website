# The existing site — inventory

A categorised record of everything on `southvillerunningclub.co.uk` as it stood on
**6 August 2026**, crawled from the live site.

This is the migration's source of truth. It answers three questions the rebuild depends on:
what content exists, what URLs must keep resolving, and what the site quietly depends on
that would break if Squarespace were switched off.

**The old site stays live until the club is happy with the replacement.** Nothing here
implies a cutover date.

Reproduce with [`tools/crawl-existing-site.py`](../../tools/crawl-existing-site.py).

---

## At a glance

| | |
| --- | --- |
| URLs in the sitemap | **59** |
| Newsletters | **34** (October 2023 – July 2026) |
| Content and functional pages | 25 |
| Linked documents (PDF) | **29**, of which 27 sit on the club-documents page |
| Image references | **139** |
| Distinct external hosts linked | 340 links across ~60 hosts |

---

## Categories

### Core information — 6 pages

| Path | Words | Notes |
| --- | --- | --- |
| `/home` | 330 | Session times, venue, 50p fee |
| `/about-us` | 636 | Q&A format; founded 2007, hi-viz rule, mailing list, kit |
| `/groups` | 686 | Training groups **plus a pace guide table** (pace → 5K/half/marathon) |
| `/new-runners-2` | 788 | On-the-night procedure, group leaders, running etiquette |
| `/frequently-asked-questions-1` | 535 | |
| `/running-terminology` | 581 | Glossary of running terms |

### Membership — 5 pages

| Path | Words | Notes |
| --- | --- | --- |
| `/membership-information` | 928 | £4 SRC membership, EA registration, **member discount directory** (~12 businesses) |
| `/new-members` | 230 | **Form** |
| `/renew-membership` | 241 | Redirects members to the England Athletics portal |
| `/cancel-membership` | 241 | **Form** |
| `/payment-page` | 387 | The £2.50 subscription — explicitly *not* membership |

### Races and events — 4 pages

| Path | Words | Notes |
| --- | --- | --- |
| `/pass-the-buck` | 397 | Format, pricing, **nine prize categories**, 100-team cap, 1h20 cut-off |
| `/pass-the-buck-results-2026` | 974 | Hand-typed results; 13 images; links to Facebook for photos |
| `/pass-the-buck-results-2025` | 860 | Hand-typed results |
| `/store/p/src-summer-party-2026` | 398 | £6 ticket |

**Nightingale Nightmare has no page.**

### Commerce — 3 pages

`/store`, `/store/tickets`, and the party product. Squarespace commerce with cart,
checkout and customer accounts.

`/kit` (629 words, 7 images) is **not** in the store — it is a page describing the
catalogue, with ordering through an external link and **stock tracked by hand in a table**.

### Governance — 4 pages, 29 documents

| Path | Words |
| --- | --- |
| `/club-documents` | 455 — links **27 documents** |
| `/privacy-policy` | 1,159 |
| `/code-of-conduct` | 724 |
| `/disciplinary-policy` | 798 |

Documents include the constitution, inclusion policy, health and safety policy and risk
assessment, welfare and safeguarding policies, codes of conduct, a payment proposal, a Pass
the Buck feedback summary, and **AGM/QGM minutes running back to August 2015**.

> **The document archive is split across two providers.** Most are PDFs on Squarespace's
> CDN; **seven are on Google Drive or Google Docs**, including a spreadsheet. Any migration
> has to collect from both, and the Google-hosted ones are outside club control in a
> different way — they depend on whoever's Drive they live in.

### Community — 2 pages

`/whatsapp-community` (406 words — the join form and a 12-point code of conduct) and
`/src-committee` (267 words, 12 images — officers and volunteers).

### Newsletters — 34

`/news-letters` index plus 33 individual posts, October 2023 to July 2026. Authored in
**Mailchimp** and mirrored here by hand.

Two irregularities worth carrying into the migration: **July 2024 is missing**, and
`june-2024-1` appears to be a duplicate of `june-2024`. Paths are inconsistent —
`src-newsletter-jan-2024` breaks the `southville-rc-newsletter-<month>-<year>` pattern used
everywhere else.

---

## What the site depends on

The part that matters most for a migration, because none of it is visible on the page.

| Host | Links | What it is | What happens when Squarespace goes |
| --- | --- | --- | --- |
| `static1.squarespace.com` | 212 | Uploaded files and images | **Breaks** |
| `images.squarespace-cdn.com` | 118 | Page images | **Breaks** |
| `assets.squarespace.com` | 118 | Platform assets | Irrelevant after rebuild |
| `southvillerunningclub.us5.list-manage.com` | 45 | **Mailchimp** | Survives — Mailchimp is separate |
| `emea01.safelinks.protection.outlook.com` | 101 | Outlook-rewritten links pasted into newsletters | Already rotting |
| `drive.google.com` / `docs.google.com` | 21 | Club documents and a spreadsheet | Survives, but outside club control |
| Facebook, Instagram, Twitter, TikTok | ~250 | Social profiles, and **race photographs** | Survives |
| `p.typekit.net`, `use.typekit.net` | 118 | Fonts | Replaced in rebuild |

### Three things this surfaces

**Every image on the site is hosted on Squarespace's CDN.** All 139 of them. Cancel the
subscription and every photograph, logo and diagram on the club's website returns a 404.
**Downloading and re-hosting the entire image library is a required migration task** that
appears in no plan so far, and it must happen while the subscription is still live.

**The same is true of the 27 PDFs**, including minutes going back a decade. They are files
on Squarespace's CDN, not documents the club holds anywhere else.

**Race photographs are on Facebook**, not the site — the 2026 results page just links there.
Any future photo capability starts from nothing.

---

## URL map

Every path that must keep resolving, or be deliberately retired with a redirect.

```
/home                                   /pass-the-buck
/about-us                               /pass-the-buck-results-2025
/groups                                 /pass-the-buck-results-2026
/new-runners-2                          /store
/frequently-asked-questions-1           /store/tickets
/running-terminology                    /store/p/src-summer-party-2026
/kit                                    /club-documents
/membership-information                 /privacy-policy
/new-members                            /code-of-conduct
/renew-membership                       /disciplinary-policy
/cancel-membership                      /whatsapp-community
/payment-page                           /src-committee
/news-letters                           /news-letters/<34 posts>
```

Note `/home` — the site's front page is served at a path as well as at `/`, and the bare
domain 301s to `www`. Both behaviours need preserving.

---

## Content that is not a page

Things that live inside pages and will need somewhere structured to go:

- **The member discount directory** — ~12 local businesses with negotiated rates, on
  `/membership-information`. Changes as deals come and go.
- **The pace guide** — a table mapping pace bands to 5K, half and marathon times, on
  `/groups`.
- **The kit catalogue** — seven items with descriptions, sizes, prices, a buy-back policy,
  and a live stock table, on `/kit`.
- **The WhatsApp code of conduct** — 12 numbered rules, on `/whatsapp-community`.
- **Committee and volunteer listings** — 12 people with roles and photographs.
- **Prize structures** — nine categories for Pass the Buck, on `/pass-the-buck`.

---

## Migration checklist this produces

- [ ] Download all **139 images** and re-host them
- [ ] Download all **27 Squarespace-hosted PDFs**
- [ ] Retrieve the **7 Google-hosted documents** and establish who owns that Drive
- [ ] Capture all **34 newsletters** — or wire the site to Mailchimp's archive so it
      maintains itself
- [ ] Build a redirect for every path above
- [ ] Decide what happens to the missing **July 2024** newsletter and the **duplicate
      June 2024** post
- [ ] Export **customer accounts, orders and payment records** from Squarespace commerce
- [ ] Confirm whether any **form submissions** are stored in Squarespace and need exporting
