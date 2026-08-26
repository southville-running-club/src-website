# Runbook — the club's back office: who may open it, granting a role, and what the exports contain

`/admin/` is the club's staff backend. Nightingale Nightmare is its first section — who has
entered, who asked to be told when entries open, and the three exports — and `/admin/people/`
is where somebody is given access to it.

**Prerequisites:** an account on the club's site, held by somebody who already has the
`super-admin` role. Nothing else — no Cloudflare dashboard, no `wrangler`, and **no database
credentials**, which is the whole point of #59.

**About a minute** to grant somebody a role. The one-off bootstrap is below.

---

## What replaced the two keys, and what that costs

**Until #58 this surface was opened by `ENTRIES_ADMIN_KEY` plus a key issued per volunteer**,
and [ADR-013](../../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md) is
the argument for that arrangement. It is retired. The way in is an account holding a role:

| | |
| --- | --- |
| `nn-admin` | May read Nightingale Nightmare's entries, notes and exports |
| `super-admin` | May grant and revoke every role. **Does not inherit `nn-admin`** — granting a role is not holding it |
| `registered` | Everybody with an account. Opens nothing here. **Renamed from `member`** — ADR-016, because the club needs that word for somebody who has actually joined |

**The break-glass in [#65](https://github.com/southville-running-club/src-website/issues/65)
is no longer the keys, and this is the paragraph that says so.** That tracker records
"if early September arrives and #58 has not landed, install the keys" — #58 has landed, so
installing them opens nothing: every `/nn/admin/*` address now redirects to `/admin/nn/*`, and
that surface asks for a session and a role. #57 left the four key-gated database functions in
place and [#63](https://github.com/southville-running-club/src-website/issues/63) removes them;
nothing in the Worker calls them any more.

**So the thing to keep available is a second person holding `nn-admin`**, not a key in a
password manager. Granting one takes a minute (below) and needs no deploy. If the club is ever
locked out of every super-admin account, see [If nobody can get in](#if-nobody-can-get-in).

### Everything under `/admin/` answers 404, to everybody who may not be there

Signed out, a plain member, the wrong role, an address nobody built — all the same ordinary
not-found page. **A 403 would disclose that the address exists**, which tells anybody who can
register exactly where the club's entry list lives and that it is worth attacking.

It costs one thing and it is worth knowing before it happens: **a volunteer who has been
granted `nn-admin` and mistypes the address gets the same blank as an attacker.** If somebody
says "it 404s for me", the first question is whether they are signed in, and the second is
whether they hold the role — `/admin/people/` shows both.

---

## Bootstrapping the first super-admin

**No seeded password and no manual SQL.** `admin@southvillerunningclub.co.uk` is written into
`identity.reserved_grants` by the migration that created the schema; the address becomes
super-admin by **registering at `/account/sign-up/` like anybody else** and confirming the email
at a mailbox the club already controls. The signup trigger applies the reserved grant.

- [ ] Register `admin@southvillerunningclub.co.uk` at `/account/sign-up/`
- [ ] Confirm the address from that mailbox
- [ ] Sign in, open `/admin/people/`, and check the account is listed as holding `super-admin`

That table is a general mechanism rather than a special case: it is also how the committee
pre-assigns a role to a new volunteer's address before they have registered.

---

## Granting somebody a role

- [ ] Sign in as a `super-admin` and open `/admin/people/`
- [ ] Find them by email address. **They must have registered first** — this page grants roles,
      it does not create accounts
- [ ] Press **Grant nn-admin** on their row — or whichever role you mean. **The buttons come
      from the database**, so every role the club has appears here, and the collapsed *What
      these roles allow* panel above the table says what each one carries
- [ ] Tell them to open `/admin/`. **It takes effect on their next request** — there is no
      session to end and nothing for them to do

Revoking is the same button, reading **Revoke**. It sets `revoked_at` rather than deleting the
row, so the audit trail goes on pointing at something.

**Every grant and revoke is written to `identity.audit` in the same transaction as the change**,
so one cannot happen without the other. A refused one writes nothing.

### What the page will not let you do

| | |
| --- | --- |
| **Revoke the last super-admin** | Refused by `identity.revoke_role()`, not by the page. A club with no super-admin has no service-role key to get back in with. Grant the role to somebody else first |
| **Grant a role to yourself that you do not have** | Only a `super-admin` may grant anything, and the check is in the database |
| **Edit somebody's profile, or delete an account** | Deliberately absent. A change to a record somebody controls needs its own thinking about notification and consent |

---

## What is on the Nightingale Nightmare section

**One page, and its order is the design.** `/admin/nn/` shows the running the database says is
current — it asks `entries.current_entry_state('nn')`, exactly as `/nn/` does, so **no year appears
in the route** and publishing 2027 needs no edit here.

| | |
| --- | --- |
| **Anything needing a human** | Over-capacity payments and anything else flagged. **Renders only when there is something** — no empty state and no zero badge. First on the page, because it is the only thing on it with a deadline attached to a person |
| **Where the race stands** | Places taken against capacity, the breakdown (paid, over capacity, held right now, holds expired and returned), fees taken, and the interest-list count |
| **Race morning** | The start list, to print or to download. The thing somebody actually opens under pressure |
| **Medical notes** and **the affiliation check** | Side by side. The medical panel is deliberately heavier than everything else on the page, and states the date the notes are deleted |
| **The entries** | A real table, with filters that are links |
| **The interest list** | A count and the promise. The addresses are on their own page |

The addresses, and the ones that write an audit row are `POST` for that reason — a `GET` would let
a prefetch, a scanner or a link pasted into a chat client file an export against somebody's account:

| | |
| --- | --- |
| `GET /admin/` | The dashboard, and what this account may open |
| `GET /admin/nn/` | The page, for the current running |
| `GET /admin/nn/entries/<event-slug>/` | The same page, for a named running — how a past race is looked at |
| `GET /admin/nn/interest/` | The interest sign-ups, with their addresses |
| `POST /admin/nn/medical/` | One entrant's note. **A `POST` so no entrant id reaches a URL**, and audited |
| `POST /admin/nn/start-list/` | The start list as a printable page. Audited, exactly as the CSV is — printing is taking a copy |
| `POST /admin/nn/export/` | One of the three CSVs. Audited |
| `GET`/`POST` `/admin/people/` | Who holds what, and the two acts that change it |

**Every old `/nn/admin/*` address still resolves** — `301` for a GET, `308` for a POST so the
method and the body survive. They were published in this runbook and a runbook that 404s is
worse than one that is out of date.

**Filters are links with query parameters, not a form and not a script.** Every filtered view is a
URL somebody can send to the other volunteer, and **no filter carries personal data** — the values
are enumerated words, which is asserted in both the Worker and the browser suites.

**At 320px the table restructures rather than scrolling.** Below 48rem it drops to three columns and
the five it drops reappear inside the runner cell; nothing on the surface scrolls sideways at any
width. The first pass scrolled it inside a focusable region instead, and the note at the head of
`packages/shared/styles/nn-admin.css` records why that was reversed.

---

## What the three exports contain

Each is a CSV of **paid entries only** — a pending hold is somebody halfway through a payment
page and an expired one is a place that came back, and a start list with either on it sets out
bibs for people who are not coming. **Over-capacity payments are included**: they are paid, they
consume a place, and that person is running unless somebody has refunded them.

**Taking one is recorded** — who took it, the time, which file and how many rows. Never the
contents.

| | Columns | For | Deliberately absent |
| --- | --- | --- | --- |
| **England Athletics check** | Last name, first name, club, EA number, entry type, amount paid | The £2 check against the EA register, which nobody has been able to do since 2018 | Emergency contacts, medical notes, email addresses |
| **Start list** | Last name, first name, club, category, **emergency contact name and phone** | Race day | Medical notes, email addresses, dates of birth |
| **Medical notes** | Last name, first name, club, **the note** | First aiders, on the day | Everything else, including the emergency contact |

### Why medical notes are a separate file

**A printed sheet of medical information at race HQ is genuinely useful to a first aider and is
the easiest way for special category data to end up in a car park.** Making it a separate,
deliberately-taken file means nobody prints it by accident as a column of the start list, and the
audit row says who decided to.

- Take it on the day, not the week before
- Keep it with the first aiders and nowhere else
- **Destroy it afterwards.** The database copy is deleted a month after the race automatically;
  a paper copy is not

### Why no email address appears in any of them

An organiser checking England Athletics numbers or setting out bibs does not need one, and a
column of two hundred and fifty addresses in a file that gets emailed around is the kind of thing
that is hard to take back. For the rare case where somebody must be contacted, the query in
[the attention runbook](entries-attention.md#the-query) returns the purchaser's address for the
rows that need one.

**The interest list is the exception**, and the address is its entire purpose: the club promised
those people one email when entries open.

---

## Reading a medical note on screen

It is behind a button on one entry, it is never in the list, and **reading it writes a row saying
you did** — in the same database transaction, so there is no way to read one unrecorded.

### Who has read medical data — the query to run

**Two actions, and both belong in the answer.** Somebody who downloaded the whole medical CSV is
a larger disclosure than somebody who clicked one note, so the query has to catch both:

```sql
select at, actor, action, detail
  from entries.admin_audit
 where action in ('medical_note', 'medical_export')
 order by at desc;
```

| | |
| --- | --- |
| `medical_note` | One entrant's note, on screen. `detail` carries the entrant id and whether a note was found |
| `medical_export` | **The whole file.** `detail` carries the event and the row count |

Neither ever carries the note itself.

> **An earlier version of this page asked only for `medical_note`**, which meant the export — by
> far the larger disclosure — did not appear in the answer to "who has read medical data" while a
> single click did. That is why the export has its own action value rather than being an `export`
> with a kind: a query that has to remember to look inside `detail ->> 'kind'` is a query somebody
> gets wrong, and this one did. `entries-admin.test.ts` runs the predicate above against both
> kinds of read, so the runbook and the schema cannot drift apart again.

### The `actor` column holds two kinds of value, and both are meant to be there

**Rows written before #58 carry a handle** — a slug out of `entries.admin_keys`, whose mapping to
a human lived in a table on this page. **Rows written since carry a uuid**, which is
`auth.uid()`: the account that did the reading, mapped to a person by `identity.people` behind
row-level security rather than by a table maintained by hand.

That is what a migration between identity schemes looks like, and it is strictly better than
what it replaced — but it means **the query above must not be narrowed to one shape**. To put a
name to a uuid:

```sql
select account.email
  from auth.users as account
 where account.id = '<the actor uuid>';
```

ADR-013's rule survives either way: the column is a pseudonym, never a name.
`entries-admin.test.ts` runs the medical-read query against one row of each kind and asserts
both come back.

An `(unattributed)` actor should never appear. If one does, a read happened the Worker could not
attribute — which should be impossible, since the uuid comes from a token GoTrue issued. Treat it
as worth understanding rather than as noise.

---

## The audit trail

Four things are recorded, and nothing else:

| | |
| --- | --- |
| `sign_in` | Somebody opened the door. **Written only by the retired key scheme** — signing in is `/account/`'s job now, and it is audited by Supabase Auth rather than here |
| `medical_note` | Somebody read one entrant's special category data, on screen |
| `medical_export` | Somebody took **a copy of every medical note** out of the platform |
| `export` | Somebody took a copy of the other data out |

```sql
select at, actor, action, detail
  from entries.admin_audit
 order by at desc
 limit 50;
```

A list view is **not** recorded. A row per page load would grow on every refresh and bury the two
entries that matter.

### The trail is read here, and not on the page — on purpose

The approved design for the admin surface put "what has been taken, and by whom" at the foot of the
dashboard, and **it is deliberately not built.** The reason is one line of the access model rather
than an omission:

`entries.admin_audit` has row-level security on, no policy and no grant. The anon role may execute
**thirteen** functions and **none of them reads it** — the trail is written by
`entries.record_admin_action()`, which is granted to nobody and reachable only from the definer
functions that call it. Putting the trail on the page therefore needs a fourteenth anon-callable
function, and a fourteenth is
[a stop-and-ask](../../../CLAUDE.md): *"granting the anon role anything on a table, or adding a
function it may execute."* `packages/db/tests/entries.test.ts` asserts the exact set of thirteen so
that the decision has to be taken in a diff somebody argues rather than absorbed by a layout.

It is also the one panel on that design whose absence costs least: an access log is read when
somebody asks a question about a disclosure, which is a moment that already involves a person with
database access and this runbook open. **A rendered trail would be convenient; the fourteenth grant
would be permanent.**

So this query is the interface, until somebody argues for the other thing.

**There is no retention rule on this table yet**, and that is an open question rather than an
oversight — it holds pseudonyms and entrant ids rather than names, so it is not urgent, but "how
long is an access log kept" is a question the club should answer. It belongs with the privacy
notice's other open decisions.

---

## Cancelling an entry

**The one thing on this surface that changes a record**, added by #107 and argued in
[ADR-018](../../architecture/decisions/adr-018-cancelling-an-entry.md). It needs
`nn.entry.cancel`, which **`nn-admin` carries and `super-admin` does not** — a super-admin who
has not also been granted `nn-admin` cannot see the entry list at all, which is #58's *a grant is
not an inheritance* and is deliberate.

- [ ] Find the row on `/admin/nn/` and press **Cancel** on it
- [ ] Read the confirmation page. It names the amount and whether there is a card payment behind
      it
- [ ] Press **Cancel this entry and refund it**

What happens, in this order:

1. The refund goes to Stripe first, against the stored payment intent, in full.
2. Then the club's record changes: an audit row, the entrant and any medical note deleted, the
   purchase moved to `refunded`, and the place back in the count.

**It cannot be undone.** Re-entering is a fresh purchase at whatever the price is that day.

### If it says "Refunded, but not recorded"

The money is back and the club's record still says `paid`. **Press Cancel on the same row
again.** The refund is idempotent on the purchase id, so the second attempt returns the first
refund rather than issuing another, and the record then completes. That ordering is deliberate —
the alternative leaves the club holding money for an entry it has already deleted.

### If it says "Nothing was cancelled"

Either Stripe refused the refund, or no `STRIPE_SECRET_KEY` is installed. **Nothing was
deleted and the place is still taken** in both cases. Check the payment in the Stripe dashboard.

---

## What the admin surface still cannot do

**Cancelling is the only change it makes.** There is no transfer, no correction, no manual entry
and no resend, because each of those has to agree with Stripe and with what somebody consented
to. They are deliberately left for a change that can think about them together.

Until then:

| Wanted | Where |
| --- | --- |
| Cancel and refund one entry | **Here**, above. Needs `nn-admin` |
| Refund part of an entry | Nowhere. Partial refunds are their own decision |
| Move an entry to somebody else | Nowhere yet |
| Raise the capacity by one | [The attention runbook](entries-attention.md#the-two-ways-out) |
| Clear an attention flag | [The attention runbook](entries-attention.md#the-query) |
| Correct a misspelled name | Nowhere yet. Write it down; it is the awkward-cases change's first customer |

---

## If nobody can get in

**Everything under `/admin/` answers 404 to anybody who may not be there**, so "it 404s" is the
symptom of almost everything. Work down this table in order.

| Symptom | Means | Fix |
| --- | --- | --- |
| **`/admin/` 404s and you are not signed in** | The ordinary case | Sign in at `/account/sign-in/` |
| **`/admin/` 404s and you are signed in** | The account holds no staff role | A super-admin grants one at `/admin/people/` |
| **`/admin/` opens but `/admin/nn/` 404s** | The account holds `super-admin` and not `nn-admin`. **Granting a role is not holding it** | Grant yourself `nn-admin` too |
| **A page says the database could not be reached** | Supabase is down or the migration has not landed | Check the deploy. The page deliberately does **not** say the list is empty |

### If the club is locked out of every super-admin account

There is no service-role key to get back in with, deliberately — and
`identity.revoke_role()` refuses to remove the last active super-admin grant precisely so this
cannot happen by accident. If it happens anyway, it is a SQL-editor recovery and one of the two
volunteers has to do it:

```sql
-- Who holds it now, and whether any of them is still reachable
select account.email, grant_row.granted_at, grant_row.revoked_at
  from identity.role_grants as grant_row
  join auth.users as account on account.id = grant_row.person_id
 where grant_row.role = 'super-admin'
 order by grant_row.granted_at;

-- Give it to an address that can sign in. `granted_by` is null: nobody granted it, a human
-- with database access did, and the audit trail should not claim otherwise.
insert into identity.role_grants (person_id, role, granted_by)
select account.id, 'super-admin', null
  from auth.users as account
 where account.email = '<the address>'
on conflict do nothing;
```

**Write down that you did it**, here, with the date and who — that is what makes a manual
exception legitimate rather than merely convenient. Better still, add the address to
`identity.reserved_grants` in a migration so the next bootstrap needs no SQL at all.

---

## Local development

`./dev up` gives you a working admin surface with invented data. **Register an account at
`http://localhost:8787/account/sign-up/`** — Inbucket at `http://127.0.0.1:54324` is where the
confirmation email lands — then grant yourself the roles:

```sql
insert into identity.role_grants (person_id, role)
select account.id, unnest(array['nn-admin', 'super-admin'])
  from auth.users as account
 where account.email = '<the address you registered>'
on conflict do nothing;
```

Or register as `admin@southvillerunningclub.co.uk`, which the migration reserves `super-admin`
for, and grant yourself `nn-admin` from `/admin/people/` like a real volunteer would.

| | |
| --- | --- |
| Address | `http://localhost:8787/admin/` |
| Fixtures | A fabricated running, `zz-admin-demo`, deliberately **one place over its field** so the loudest state on the page is the one you see first |

Nothing is seeded against the real `nn-2026` row, because the entry tests clear it.
