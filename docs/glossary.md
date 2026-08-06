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

**Decision record** — a short document capturing a decision, its context, its consequences
and its exit cost. See [decision log](decision-log.md).

**Preview deployment** — a deployed URL for a pull request, so a change can be looked at
before it is real.

**Race simulation** — the manual checklist run before timing-path changes reach
production. The things automated tests cannot cover: multiple devices, real
connectivity loss, the real race date.

**Change freeze** — the window around a race in which nothing in the shared platform
deploys.

**Expand–migrate–contract** — the migration pattern that keeps the previously deployed
version working against the new schema, so rollback stays possible.

## Domains and DNS

**Zone** — a domain as managed by a DNS provider: the full set of its records.

**Authoritative nameserver** — the server that gives the definitive answer for a domain's
records. Which provider is authoritative is set at the registrar.

**Delegation** — changing which nameservers are authoritative. Slow to take effect and slow
to reverse, because the change is cached across the internet for up to 48 hours.

**Apex** — the bare domain, `southvillerunningclub.co.uk`, with no subdomain.

**Cutover** — repointing an existing record at a new destination. Distinct from delegation:
much faster to make and to reverse, once the club controls the records.

**Additive record** — a new record for a name that did not previously exist. Cannot break
anything that already works, because nothing was resolving that name before. Deleting it
restores the previous state exactly.

**Proxied vs DNS-only** — whether a DNS provider passes traffic through its own network or
simply answers with the destination address. Some records must not be proxied, notably mail
hostnames and third-party verification records.

## External services in use today

**Full On Sport** — the current race entry provider. 5.9% + 20p plus VAT, **added on top of
the entry price and paid by entrants**, not by the club.

**Fasthosts** — the domain registrar, authoritative DNS provider, and the club's mail
provider (livemail), with forwarding-only mailboxes.

**Squarespace** — the current website platform, and the current home of the £2.50 member
fund.

**Fasthosts** — the club's DNS registrar. Records currently point at Squarespace.

**Squarespace** — the current website host and home of the member fund. Being replaced.
