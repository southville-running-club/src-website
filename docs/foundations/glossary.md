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
ever overwritten. **Running** is the same concept used as a noun in prose ("the forthcoming
running of race `nn`") — the schema and the tests say `event`, the writing says `running`;
they are the same thing.

**Race** — the recurring thing an event is an instance of: "Pass the Buck".

**Team** — the unit of entry, even when it holds one runner. Pass the Buck's team is two
runners entered and paid for as one transaction; Nightingale Nightmare's team is one runner
— but both are one **purchase** with one or more **entrants** on it. Getting this wrong in a
schema is expensive, which is why [CLAUDE.md](../../CLAUDE.md) and the [root
README](../../README.md) both cite it as the example of a word this glossary fixes.

**ARC** — the Association of Running Clubs, the affiliation body Southville Running Club's
races run under. Issues the annual **permit** a race must display, and Rule 21(2)(b)/(c) is
what the £2 gap between the affiliated and unaffiliated entry fees pays to ARC — see
[decision 006](../decisions/decision-log.md#006--price-the-2026-entry-at-18-and-20-and-treat-the-2-gap-as-arcs-money).
Not to be confused with **EA** below, which the club stopped verifying membership of —
[decision 007](../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers).

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

## Race entries

The vocabulary the entries build actually runs on — added because most of it is used
constantly in [CLAUDE.md](../../CLAUDE.md) and the delivery docs without ever being defined
here.

**Purchase** — one payment, covering one or more **entrants**. The record `entries.entry_purchases`
holds; what a **team** actually is in this schema.

**Entrant** — one runner (or **guide**, below) on a purchase. Not the same as a **person** —
an entrant is a name on a race entry, and may or may not be linked to an account.

**Place** — one of the field's fixed capacity (250 for Nightingale Nightmare 2026). A
purchase **holds** a place from the moment it starts, whether or not it has been paid for
yet.

**Hold** — a place reserved against a pending purchase for 31 minutes, released automatically
if payment does not complete in time. `expired` is what a lapsed hold becomes.

**Fee** — what an entry costs, in pence, read from `entries.fees`. **Affiliated** and
**unaffiliated** are the two ordinary fees; **complimentary** and **tester** are the two
that are not sold.

**Guide** — the person who runs with a visually impaired runner, entered as a second
entrant on that runner's own purchase rather than a separate entry. Pays nothing, is in no
prize category, and is marked on the start list.

**Complimentary** — a place given rather than sold: a `paid` purchase at £0 on a £0 fee,
assigned from `/admin/nn/` by somebody holding `nn.entry.create` —
[ADR-028](../architecture/decisions/adr-028-a-place-can-be-given.md).

**Tester** — a real £1 entry, used to prove the live payment path works before entries open,
available only to somebody holding `nn.entry.before_open`.

**Attention** — the flag a purchase gets when the webhook meets something it cannot resolve
on its own (a payment over capacity, an amount mismatch) — see [the
runbook](../delivery/runbooks/entries-attention.md). Somebody has to look; nothing is guessed.

**Ask** (or **request**) — a runner's recorded wish to cancel or transfer their own paid
entry, via `request_entry_action()`. Recording an ask performs nothing by itself; a
volunteer acts on it from `/admin/nn/`.

**Outbox** — the mechanism that tells a runner what happened to their entry: a database
trigger writes the obligation to send in the same transaction as the thing it is about, and
the drain runs as soon as the message is owed, with a five-minute cron behind it as the
retry net - [ADR-032](../architecture/decisions/adr-032-an-email-is-sent-when-it-is-owed.md).
Nothing can be lost this way; it can only be
late.

**Race category** — the closed list of three values (`female`, `male`, and the ones the
club awards prizes and publishes results by) an entrant states. **Gender identity** is a
separate, optional, open-text question beside it, on no list and derived by nothing — two
questions, not one, since
[ADR-020](../architecture/decisions/adr-020-race-category-and-gender-are-two-questions.md).

**Medical note** / **medical consent** — free-text medical information an entrant may give,
held only under its own separate consent, in its own table, deleted a month after the race.
Special category data under UK GDPR Article 9.

## Membership

**EA** — England Athletics, the sport's national governing body. Club affiliation and
individual runner registration.

**URN** — Unique Registration Number. An England Athletics member's identifier. ⚠️
**Historical for race entries**: the club stopped asking for or holding a URN on race entry
forms on 29 August 2026 — [decision
007](../decisions/decision-log.md#007--stop-asking-for-and-holding-england-athletics-numbers).
Still relevant to club membership itself.

**Licence-check API** — the EA service that validates a URN. ⚠️ **Not used by race entries
since decision 007** — a runner's own word decides which entry fee they pay, not a
verification call.

**myAthletics** — EA's portal, where the membership secretary holds the club's full
member list. Still the source of the club's own membership records; no longer consulted at
the point of a race entry.

**Member fund** — the £2.50 recurring payment members make in place of 50p cash at
sessions. Set up as a Squarespace donation fund in October 2024. Running at around **103
payments a month, roughly £2,940 a year**, and growing — it took 697 payments across the
whole of 2025 and 705 in the first seven months of 2026.

**Single-use link** — the token on our own domain that a welcome email (or its QR code)
points at. Marked consumed on first use, expires after a set period, then forwards the
member into the WhatsApp group. Enforced by us, not by WhatsApp.

## Accounts

**Account** — a Supabase Auth identity: an email, a way to sign in, and a role. Created by
somebody registering themselves at `/account/sign-up/`, never seeded by hand except the one
migration that bootstraps the super-admin. Distinct from **membership** ([C12](requirements.md#c12--maintain-membership-records)) — an account is a person who can sign in; a member is
someone the club has recorded as current, which is a later, separate thing.

**Registered** — the role every account gets on sign-up, whatever else it later holds. It says
what happened — somebody registered — and grants nothing on its own.
**It used to be called `member`, and that was the wrong word**: see
[ADR-016](../architecture/decisions/adr-016-registered-is-not-a-member.md). The entry that stood
here needed a qualifier — "in the accounts sense" — every time it was used, which is how you can
tell a word is doing two jobs.

**Member** — somebody the club has recorded as current: joined, paid, not lapsed, on the EA
register. **Not a role**, and deliberately not one — see **membership**, above, and
[C12](requirements.md#c12--maintain-membership-records). Nothing in the platform answers this
question yet; the word is kept free for the thing that will.

**Role** — a **bundle of permissions**, and nothing else —
[ADR-017](../architecture/decisions/adr-017-permissions-are-what-code-checks.md). Held in the
`identity` schema. **Code never checks a role**; it checks a permission, so granting a capability
to a new role is a row rather than a search for every string literal that named the old one. The
roles today are `super-admin`, `nn-admin`, `people-admin`, `nn-tester` and `registered`; adding
one is still a migration and a decision, made in a diff that changes
`packages/db/tests/identity-permissions.test.ts`, which asserts the exact set.

**Permission** — what may actually be done, named `area.subject.verb` and the vocabulary every
authorisation check is written in: `nn.entry.read`, `identity.person.read`,
`identity.role.grant`. The format is a check constraint, because a set that drifts into
`nnEntryRead` and `entries:read` is one nobody can grep.

**Super-admin** — the role held by `admin@southvillerunningclub.co.uk`, bootstrapped by
migration. Grants and revokes every other role, and reads the list of people to do it with.
**It inherits nothing else** — a super-admin who needs the entry list grants themselves
`nn-admin`, which leaves an audit row. Not a person's name, a role.

**People-admin** — the role that reads `/admin/people/` and changes nothing on it: who has an
account, their address, and which roles they hold. Staff, so it opens `/admin/`; it opens
nothing about a race.

**Session** — the signed-in state a browser holds after authenticating with Supabase Auth,
carried as three cookies the Worker reads and ending on its own — thirty minutes idle,
twelve hours absolute — per
[ADR-019](../architecture/decisions/adr-019-a-session-ends-on-its-own.md). **Not** the
twelve-hour handle cookie
[ADR-013](../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md)'s
two-key scheme issued — that scheme is retired in the Worker since #57/#58, and the
break-glass it once provided is now a second person holding `nn-admin`, granted at
`/admin/people/` in a minute with no deploy.

## Platform and delivery

**The platform** — one codebase and one database behind three front doors: the club
website, the payments/membership surface, and the timing app.

**Timing app** — the live Next.js application that captures crossings and publishes
results. Proven in production at Pass the Buck 2026.

**Front door** — one of the three user-facing surfaces onto the shared platform.

**Decision record** — a short document capturing a decision, its context, its consequences
and its exit cost. See [decision log](../decisions/decision-log.md).

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

**Delegation** — changing which nameservers are authoritative. Slow to take effect and
slow to reverse, because the change is cached across the internet for up to 48 hours.

**Apex** — the bare domain, `southvillerunningclub.co.uk`, with no subdomain.

**Cutover** — repointing an existing record at a new destination. Distinct from
delegation: much faster to make and to reverse, once the club controls the records.

**Additive record** — a new record for a name that did not previously exist. Cannot break
anything that already works, because nothing was resolving that name before. Deleting it
restores the previous state exactly.

**Proxied vs DNS-only** — whether a DNS provider passes traffic through its own network or
simply answers with the destination address. Some records must not be proxied, notably
mail hostnames and third-party verification records.

## External services in use today

**Full On Sport** — the current race entry provider. 5.9% + 20p plus VAT, **added on top
of the entry price and paid by entrants**, not by the club.

**Fasthosts** — the domain registrar, and the club's mail provider (livemail). **Real
mailboxes since decision 003** — no longer forwarding-only. Authoritative DNS moved to
Cloudflare on 8 August 2026; Fasthosts is the registrar of record only now.

**Squarespace** — the outgoing website platform, and the current home of the £2.50 member
fund. Being replaced; renews automatically on 21 March 2027 if not cancelled first.
