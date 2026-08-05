# Glossary

Domain vocabulary, so code and conversation use the same words.

## Club and races

**SRC** — Southville Running Club.

**Pass the Buck** — the club's relay race. Two runners per team, entered and paid for as
one transaction. Priced by England Athletics registration status: £8 per registered
runner, £10 per non-registered, so £16, £18 or £20 per team.

**Nightingale Nightmare** — a solo mass-start 10 km. One runner per entry, one gun, one
finish crossing each. Age-band categories (Vet 40/50/60, male and female), which require
date of birth. Sits on or near the clocks-change weekend.

**Event** — one running of one race in one year: "Pass the Buck 2026". The unit of the
permanent archive. Each event has its own roster, crossings and results, and nothing is
ever overwritten.

**Race** — the recurring thing an event is an instance of: "Pass the Buck".

**Roster** — the list of entrants for an event, including walk-ins.

**Crossing** — a timing capture recorded by a marshal: this bib, at this point, at this
time.

**Walk-in** — an entrant registered on race morning rather than in advance, issued a bib
at the registration desk.

**DNS / DNF / DQ** — Did Not Start, Did Not Finish, Disqualified. Result statuses that
are not times.

**Anomaly** — a crossing that does not make sense against the roster or the sequence —
a duplicate, a missing split, an unknown bib — surfaced for human resolution.

**Race director** — owns race-day go/no-go, change freezes, and sign-off on the
race-simulation checklist.

**QGM** — Quarterly General Meeting. Where the platform proposal and its governance
prerequisites were discussed and agreed.

## Membership

**EA** — England Athletics, the sport's national governing body. Club affiliation and
individual runner registration.

**URN** — Unique Registration Number. An England Athletics member's identifier, validated
against name and status.

**Licence-check API** — the EA service that validates a URN. Access by agreement, with a
key. Used by race entry systems to verify registration at the point of entry.

**myAthletics** — EA's portal, where the membership secretary holds the club's full
member list. Source of the fallback export if API access is slow.

**Member fund** — the £2.50 recurring payment members make in place of 50p cash at
sessions. Set up as a Squarespace donation fund in October 2024. 94 active recurring
payers, roughly £2,820 a year.

**Single-use link** — the token on our own domain that a welcome email (or its QR code)
points at. Marked consumed on first use, expires after a set period, then forwards the
member into the WhatsApp group. Enforced by us, not by WhatsApp.

## Platform and delivery

**The platform** — one codebase and one database behind three front doors: the club
website, the payments/membership surface, and the timing app.

**Timing app** — the live Next.js application that captures crossings and publishes
results. Proven in production at Pass the Buck 2026.

**Front door** — one of the three user-facing surfaces onto the shared platform.

**ADR** — Architecture Decision Record. A short document capturing a decision, its
context and its consequences. See [adr/](adr/).

**Preview deployment** — a deployed URL for a pull request, so a change can be looked at
before it is real.

**Race simulation** — the manual checklist run before timing-path changes reach
production. The things automated tests cannot cover: multiple devices, real
connectivity loss, the real race date.

**Change freeze** — the window around a race in which nothing in the shared platform
deploys.

**Expand–migrate–contract** — the migration pattern that keeps the previously deployed
version working against the new schema, so rollback stays possible.

## External services

**Supabase** — managed PostgreSQL, currently on the free tier. Pauses after roughly a
week of inactivity; no automated backups below Pro.

**Vercel** — the timing app's current host. First-party Next.js support. Free tier
prohibits commercial use.

**Cloudflare** — the leading alternative host. No commercial-use restriction on the free
tier, no bandwidth charges on any plan; runs Next.js through the OpenNext adapter.

**OpenNext** — the adapter that runs Next.js on Cloudflare. Cloudflare's officially
recommended route, and on a more durable footing since the Next.js team's stable adapter
interface — but still a translation layer.

**Stripe** — card payments. UK rates 1.5% + 20p standard UK card. Hosted payment links
need no code or hosting; hosted checkout is used for entries.

**Full On Sport** — the current race entry provider. 5.9% + 20p plus VAT, **added on top
of the entry price and paid by entrants**, not by the club.

**Resend** — transactional email, sending from a verified club domain.

**Fasthosts** — the club's DNS registrar. Records currently point at Squarespace.

**Squarespace** — the current website host and home of the member fund. Being replaced.
