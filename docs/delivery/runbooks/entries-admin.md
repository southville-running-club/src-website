# Runbook — the admin surface: switching it on, issuing keys, and what the exports contain

`/nn/admin` is where the club can see who has entered, who asked to be told when entries open,
and where the three exports are. **It does not exist until somebody installs a key**, and today
nobody has.

**Prerequisites:** the club's Supabase project (SQL editor), and — for step 1 only — the
Cloudflare dashboard or `wrangler` on a machine that can reach the club's account.

**About twenty minutes** for the whole of step 1 and 2, once. A minute to revoke somebody.

---

## What it is, in one paragraph

Two credentials open it, and [ADR-013](../../architecture/decisions/adr-013-the-admin-surface-and-who-may-read-it.md)
is the argument for both. **`ENTRIES_ADMIN_KEY` is a Worker secret** and is what authorises the
Worker to read entries at all; **a per-person key** is what says which volunteer is looking. The
database holds only SHA-256 digests of each. Until the first is installed the whole surface
answers 404 like an address nobody published — which is the correct state, not a broken one.

---

## What is on it

**One page, and its order is the design.** `/nn/admin/` shows the running the database says is
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

Seven addresses, and the ones that write an audit row are `POST` for that reason — a `GET` would let
a prefetch, a scanner or a link pasted into a chat client file an export against somebody's handle:

| | |
| --- | --- |
| `GET /nn/admin/` | The page, for the current running |
| `GET /nn/admin/entries/<event-slug>/` | The same page, for a named running — how a past race is looked at |
| `GET /nn/admin/interest/` | The interest sign-ups, with their addresses |
| `POST /nn/admin/medical/` | One entrant's note. **A `POST` so no entrant id reaches a URL**, and audited |
| `POST /nn/admin/start-list/` | The start list as a printable page. Audited, exactly as the CSV is — printing is taking a copy |
| `POST /nn/admin/export/` | One of the three CSVs. Audited |
| `POST /nn/admin/` | Signing in, and signing out |

**Filters are links with query parameters, not a form and not a script.** Every filtered view is a
URL somebody can send to the other volunteer, and **no filter carries personal data** — the values
are enumerated words, which is asserted in both the Worker and the browser suites.

**At 320px the table restructures rather than scrolling.** Below 48rem it drops to three columns and
the five it drops reappear inside the runner cell; nothing on the surface scrolls sideways at any
width. The first pass scrolled it inside a focusable region instead, and the note at the head of
`packages/shared/styles/nn-admin.css` records why that was reversed.

---

## Step 0 — before switching it on

- [ ] **Read what the exports contain**, in [the section below](#what-the-three-exports-contain).
      One of them is special category data.
- [ ] **Decide the handles.** They are role names, never people's names — see
      [the mapping](#the-handles-and-who-holds-them). The handle goes into the audit trail, and
      a first name there would be personal data in a table kept precisely so it can be read
      later.
- [ ] **The WAF rate-limiting rule on `POST /nn/admin`** is rule **A4** in
      [the committed copy of the Cloudflare rules](../../reference/cloudflare-waf-rules.md),
      alongside the one
      [entries-open step 0.1](entries-open.md#01--the-waf-rate-limiting-rule-must-be-live)
      requires on the race forms. It covers `/admin/` as well, because
      [#58](https://github.com/southville-running-club/src-website/issues/58)'s shell and this
      surface overlap in time and a rule covering one of them has a gap for as long as both
      exist. Sign-in is a database round trip per attempt; the keys themselves are 32 random
      bytes and are not guessable, so this is about free-tier compute rather than about anybody
      getting in.

---

## Step 1 — install the Worker's key

> **⚙️ Ops**

**Generate it. Do not invent it, and do not reuse another secret.**

```bash
openssl rand -base64 32
```

Put it on the Worker:

```bash
cd platform/apps/main
npx wrangler secret put ENTRIES_ADMIN_KEY --env production
# paste the value
```

Then put its **digest** — never the key — into the database, in the Supabase SQL editor:

```sql
update entries.webhook_secrets
   set key_sha256 = encode(sha256(convert_to('<the key you just pasted>', 'utf8')), 'hex'),
       updated_at = now()
 where name = 'admin'
returning name, left(key_sha256, 12) || '…' as digest, updated_at;
```

**Check the returned row.** One row, `name = 'admin'`, and a digest that is not null.

> **The key is in your clipboard and in your shell history at this point.** Clear the history
> line, and do not paste it into a chat client. Everything after this step uses the digest.

Visit `https://new.southvillerunningclub.co.uk/nn/admin/`. You should get a sign-in form. Before
this step it was a 404, and if it still is, the secret has not bound — check the Cloudflare
dashboard's variables and secrets panel for the production environment.

---

## Step 2 — issue a key to each volunteer

> **⚙️ Ops**, with the person present or on a call

One key each. **Generate it in front of them, give it to them, and never keep a copy** — the
database holds the digest, so a lost key is replaced rather than looked up.

```bash
openssl rand -base64 32
```

```sql
insert into entries.admin_keys (name, key_sha256)
values ('membership-secretary',
        encode(sha256(convert_to('<their key>', 'utf8')), 'hex'))
returning name, issued_at;
```

- [ ] They have put it in a password manager, not in a note on a phone
- [ ] Their handle is added to [the table below](#the-handles-and-who-holds-them), in a pull
      request
- [ ] They have signed in once, so you know it works

### Replacing a key somebody has lost

Same statement, with an update. It is not a recovery — the old key is gone and unknowable.

```sql
update entries.admin_keys
   set key_sha256 = encode(sha256(convert_to('<the new key>', 'utf8')), 'hex'),
       revoked_at = null,
       issued_at = now()
 where name = 'membership-secretary'
returning name, issued_at;
```

### Revoking one person

**One statement, no deploy, and it does not affect anybody else.**

```sql
update entries.admin_keys set revoked_at = now() where name = 'membership-secretary'
returning name, revoked_at;
```

Any session they already have **remains valid for up to twelve hours**, because the cookie is
signed rather than looked up. If that matters — a lost laptop rather than somebody standing
down — rotate the Worker's key as well, which invalidates every session immediately:

```bash
npx wrangler secret put ENTRIES_ADMIN_KEY --env production
```

…and re-run the `update` in step 1 with the new value. **Everybody signs in again**; nobody's
own key changes.

---

## The handles, and who holds them

**This table is the only place the mapping exists**, deliberately: `entries.admin_keys.name` is
constrained to a slug and lands in every audit row, so a person's name is never in the database.

| Handle | Who | Issued | Notes |
| --- | --- | --- | --- |
| *(none yet)* | | | The surface has not been switched on |

---

## What the three exports contain

Each is a CSV of **paid entries only** — a pending hold is somebody halfway through a payment
page and an expired one is a place that came back, and a start list with either on it sets out
bibs for people who are not coming. **Over-capacity payments are included**: they are paid, they
consume a place, and that person is running unless somebody has refunded them.

**Taking one is recorded** — the handle, the time, which file and how many rows. Never the
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

An `(unattributed)` actor should never appear. If one does, a read happened that the Worker could
not put a handle to — which should be impossible, since the handle comes from a cookie it signed
itself. Treat it as worth understanding rather than as noise.

---

## The audit trail

Four things are recorded, and nothing else:

| | |
| --- | --- |
| `sign_in` | Somebody opened the door |
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
oversight — it holds handles and entrant ids rather than names, so it is not urgent, but "how
long is an access log kept" is a question the club should answer. It belongs with the privacy
notice's four other open decisions.

---

## What the admin surface cannot do

**Nothing on it changes a record.** There is no editing, no refund, no transfer, no manual entry
and no resend, because each of those has to agree with Stripe and with what somebody consented
to. They are deliberately left for a change that can think about them together.

Until then:

| Wanted | Where |
| --- | --- |
| Refund somebody | Stripe dashboard, then the `update` in [the attention runbook](entries-attention.md#over_capacity--somebody-paid-and-the-race-was-full) |
| Raise the capacity by one | [The attention runbook](entries-attention.md#the-two-ways-out) |
| Clear an attention flag | [The attention runbook](entries-attention.md#the-query) |
| Correct a misspelled name | Nowhere yet. Write it down; it is the awkward-cases change's first customer |

---

## If nobody can get in

| Symptom | Means | Fix |
| --- | --- | --- |
| **`/nn/admin/` 404s** | `ENTRIES_ADMIN_KEY` is not bound on the Worker | Step 1. This is also the correct state before step 1 |
| **Every key is "not recognised", for everybody** | The Worker's key and the digest disagree — usually a half-finished rotation | Re-run step 1's `update` with the key that is actually on the Worker |
| **One person's key is not recognised** | Theirs is revoked, or mistyped | Check `select name, revoked_at, last_used_at from entries.admin_keys` |
| **A page says the database could not be reached** | Supabase is down or the migration has not landed | Check the deploy. The page deliberately does **not** say the list is empty |

**`last_used_at` is the only signal a key is in use.** A key that has never been used is either a
spare or a mistake, and both are worth knowing about:

```sql
select name, issued_at, last_used_at, revoked_at from entries.admin_keys order by name;
```

---

## Local development

`./dev up` gives you a working admin surface with invented data, and both keys are in
`packages/db/supabase/seed.sql` in plain sight — that file never runs against production.

| | |
| --- | --- |
| Address | `http://localhost:8787/nn/admin/` |
| Your key | `local-development-only-person-key` |
| Fixtures | A fabricated running, `zz-admin-demo`, deliberately **one place over its field** so the loudest state on the page is the one you see first |

Nothing is seeded against the real `nn-2026` row, because the entry tests clear it.
