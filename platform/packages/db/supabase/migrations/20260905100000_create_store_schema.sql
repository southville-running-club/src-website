-- The `store` schema — tickets to the club's socials, and the occasion configuration that
-- drives them.
--
-- **A fourth schema, and the reason is the same one that gave us `entries`.** `club` is
-- membership, `intake` is what a stranger may post into, `entries` is a paid race entry. A
-- ticket to the Christmas party is none of those: it is a commercial transaction against
-- something that is not a race, held by somebody who may not be a member, and it collects
-- none of the things a race entry exists to collect.
--
-- ---------------------------------------------------------------------------------------
-- Why this is not a row in `entries.events`
-- ---------------------------------------------------------------------------------------
-- It was the obvious first answer and it is the wrong one, for a reason that is a fact
-- about the schema rather than a matter of taste. `entries.entrants` requires
-- `date_of_birth`, `gender`, `emergency_contact_name` and `emergency_contact_phone` — all
-- four `not null`, each argued for individually, each in the committee-settled field list
-- at `packages/shared/src/nn-entry.ts`. A party ticket needs none of them.
--
-- So reusing `entries` would have meant one of two things:
--
--   * **Collecting them anyway** — asking somebody buying a £12 party ticket for their date
--     of birth and their next of kin. That is a straight breach of *personal data is
--     minimised at the boundary*, and it is the kind of breach that looks like reuse.
--   * **Making those four columns nullable** — which removes, from the live race path,
--     during the entry window, the constraints that guarantee a start list has an
--     emergency contact on every row. A party ticket is not worth weakening the race for.
--
-- The glossary settles the naming on top of that. **Event** is reserved: "one running of
-- one race in one year". A Christmas party is not a running of a race, so it may not be an
-- event here however convenient the word is. The table below is `socials`, which is what a
-- running club actually calls the thing.
--
-- `/events/` is still the *path* and "Events" is still the navigation label, because that
-- is what the old Squarespace site published and Phase 5 keeps its addresses. The public
-- word and the schema word differ on purpose, exactly as the navigation bar already says
-- "Race info" over a page headed "Race instructions".
--
-- See docs/architecture/decisions/adr-033-a-ticket-is-not-an-entry.md
--
-- ---------------------------------------------------------------------------------------
-- What this migration deliberately does NOT do
-- ---------------------------------------------------------------------------------------
-- **It grants the anon role nothing on any table.** Not insert, not select. Seven functions
-- and nothing else, `packages/db/tests/store.test.ts` names them exactly, and that test is
-- there for the same reason `entries.test.ts` names its list: to make an eighth a decision
-- somebody takes in a diff rather than a side effect.
--
-- **It publishes no fact about the 2026 party.** The date, the time, the venue and the
-- price are not confirmed, and a plausible placeholder in this file would be a published
-- claim about an occasion the club is selling tickets to. Every one of them is a nullable
-- column, null means *not confirmed*, and `store.social_state()` reports that honestly to
-- the page. Confirming them is an `update` and no deploy, which is the whole point.
--
-- **It seeds no ticket type**, for the sharpest version of the same reason: a `price_pence`
-- here is a price the club is charging. There is no row, so there is nothing to sell, and
-- `sales_open_at` is null on top of that.
--
-- **It adds no permission and no admin surface.** Reading who holds a ticket wants an
-- eleventh permission, and CLAUDE.md makes that a stop-and-ask. Until it is taken, the
-- record of who is coming is the outbox and Stripe's own dashboard. See the ADR.

create schema if not exists store;

comment on schema store is
  'Tickets to the club''s socials, and the occasion configuration that drives them. Not races — those are entries. RLS on every table; anon reaches it only through the security definer functions in this file. Owned by packages/db.';

-- `usage` lets a request name an object in the schema. It grants nothing on the objects
-- themselves — every table below has RLS enabled and no grant at all, so naming one gets a
-- 42501 rather than a row.
grant usage on schema store to anon, authenticated;

-- Belt and braces against a future table arriving without its own explicit grant decision.
alter default privileges in schema store revoke all on tables from anon, authenticated;
alter default privileges in schema store revoke execute on functions from public;

-- -------------------------------------------------------------------------------------------
-- socials — one ticketed club occasion, and every value that differs between them
-- -------------------------------------------------------------------------------------------
-- The same argument `entries.events` makes: the venue, the age limit, how many tickets one
-- person may buy and when they go on sale are columns rather than constants, because the next
-- occasion the club puts on will differ in exactly these ways and should not need a build to
-- say so. There is no occasion-creation interface and there does not need to be one; a new
-- social is a reviewed `insert` in a migration.
--
-- **`social_date`, `start_time` and `end_time` are civil time, not instants**, for the reason
-- `entries.events` gives at length: "Saturday 5 December, 7:30pm" is what the poster says and
-- it does not move if somebody reads it from another timezone. The storage-UTC rule governs
-- instants, and `sales_open_at` / `sales_close_at` below are both `timestamptz`.
create table store.socials (
  id uuid primary key default gen_random_uuid(),

  -- What a URL and a test can name an occasion by, and it never changes once published.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  display_name text not null check (length(trim(display_name)) between 1 and 120),

  -- **Null means "not confirmed", and that is a real state rather than a missing value.**
  -- Every one of the next five is a fact about the 2026 party that nobody has supplied. A
  -- date here would be the club announcing a date; a venue here would be the club announcing
  -- a venue. `social_state()` returns them as nulls and the page says so in words.
  social_date date,
  start_time time,
  end_time time,
  venue text check (venue is null or length(trim(venue)) between 1 and 200),

  -- Null means no age check. The 2025 party said "Entry requirements: 18+"; whether 2026 does
  -- is not this migration's to assert. When it is set, the form asks for a declaration —
  -- there is no date of birth here to check it against, deliberately, because collecting one
  -- to sell a party ticket is the minimisation breach this schema exists to avoid.
  minimum_age int check (minimum_age between 0 and 120),

  -- Null means no limit. A pub function room has one; what it is for 2026 is not supplied.
  capacity int check (capacity > 0),

  -- **Null means "not on sale", and it is the switch.** Exactly `entries.events.
  -- entries_open_at`: `social_state()` tests it as an explicit branch before comparing
  -- anything, so a null reads as *never opens* rather than *no lower bound*. Setting it
  -- starts selling tickets unattended, so it is gated on the same things the race window was
  -- — the Stripe keys, and the entry key below being installed and verified first.
  sales_open_at timestamptz,
  sales_close_at timestamptz,

  -- One person buying for their partner is the ordinary case and a party has no
  -- one-runner-one-place rule to break, so a purchase covers several tickets. The cap is
  -- here rather than in TypeScript because it is the kind of thing that differs per occasion.
  max_tickets_per_purchase int not null default 6
    check (max_tickets_per_purchase between 1 and 20),

  -- **Where a reply to this occasion's email goes — not where it is sent from**, which is why
  -- it is not called `from_address` the way `entries.events`' equivalent is.
  --
  -- The From address has to be the Resend account's verified sending domain and is a constant
  -- in the Worker; this is the club mailbox a recipient reaches by pressing reply. That
  -- distinction is load-bearing here rather than pedantic: **the ticket confirmation asks
  -- people to reply with dietary requirements**, because they are deliberately not stored, so
  -- a reply that bounces loses the only copy of the answer.
  --
  -- Operational, never rendered to a browser, and deliberately absent from what
  -- `social_state()` returns.
  reply_to text not null check (position('@' in reply_to) > 1),

  -- **Empty is the honest default and it is what ships.** Which terms a ticket is sold under
  -- has not been decided, so the form asks for no tick boxes at all rather than for a box
  -- whose wording somebody invented. Adding one is an `update` here plus the wording.
  required_consents text[] not null default '{}'::text[],

  -- Which wording of those consents a ticket was taken under. Stored again on each purchase,
  -- so a later change cannot rewrite what somebody actually agreed to.
  consent_version text not null check (length(trim(consent_version)) between 1 and 40),

  active boolean not null default true,

  -- The high-water mark a ticket reference is issued from. See `ticket_purchases.ticket_no`.
  next_ticket_no int not null default 1 check (next_ticket_no >= 1),

  created_at timestamptz not null default pg_catalog.now(),

  -- A window that closes before it opens is a configuration mistake that would read to a
  -- visitor as an outage. Cheaper to refuse it here than to debug it in December.
  constraint socials_window_ordered check (
    sales_open_at is null
    or sales_close_at is null
    or sales_close_at > sales_open_at
  ),

  -- An occasion that ends before it starts, likewise. Both nullable, so this only bites once
  -- somebody has supplied a pair.
  constraint socials_times_ordered check (
    start_time is null or end_time is null or end_time <> start_time
  )
);

comment on table store.socials is
  'One ticketed club occasion — a party, a quiz, a trip. Not a race: the glossary reserves "event" for one running of one race in one year. A new social is an INSERT, not a deploy.';
comment on column store.socials.social_date is
  'Civil local date, as published. Null means not confirmed by the committee — never a placeholder.';
comment on column store.socials.sales_open_at is
  'Null means tickets have not gone on sale and no opening time has been decided. Never a placeholder.';
comment on column store.socials.minimum_age is
  'Null means no age check. No date of birth is collected here, so an age limit is a declaration rather than a verified fact.';

alter table store.socials enable row level security;

-- -------------------------------------------------------------------------------------------
-- ticket_types — the price, and the only place it exists
-- -------------------------------------------------------------------------------------------
-- **The price lives here and never as a Stripe Product or Price object**, for the reason
-- `entries.fees` gives: a price held in two systems is a price that will disagree with
-- itself, and the copy that is wrong will be the one in the dashboard nobody opened. It is
-- passed as `price_data` when a Checkout session is created.
--
-- Pence, as an integer. Money in a float is a defect waiting for a discount percentage.
--
-- **There are no rows.** The 2026 price is not confirmed, and a row here is a price the club
-- is charging.
create table store.ticket_types (
  id uuid primary key default gen_random_uuid(),
  social_id uuid not null references store.socials (id) on delete cascade,

  -- **A closed list, and adding to it is a migration.** A ticket code is what the form offers
  -- and what the card is charged; it should arrive in a diff somebody approved rather than as
  -- a row somebody inserted. `member` and `guest` are here because the 2025 party was open to
  -- both and the club may yet price them apart.
  code text not null check (code in ('standard', 'member', 'guest', 'concession')),

  label text not null check (length(trim(label)) between 1 and 60),
  price_pence int not null check (price_pence >= 0),

  -- An early-bird price is a second row with a window rather than an edit to this one, so
  -- what a ticket was sold at stays readable after the price moves.
  valid_from timestamptz,
  valid_to timestamptz,

  active boolean not null default true,

  unique (social_id, code),

  constraint ticket_types_window_ordered check (
    valid_from is null or valid_to is null or valid_to > valid_from
  )
);

comment on table store.ticket_types is
  'What a ticket costs, in pence. The only definition of the price — never a Stripe Price object. Deliberately empty: the 2026 price is not confirmed.';

alter table store.ticket_types enable row level security;

-- -------------------------------------------------------------------------------------------
-- ticket_purchases — one payment, covering one or more tickets
-- -------------------------------------------------------------------------------------------
-- **The purchase is the transaction and `quantity` is how many people it lets in.** There is
-- no `attendees` table and that is the decision, not an omission: names for each guest would
-- be a field beyond what is specified, held for a party, to print a door list the club has
-- always run off "the person who paid, plus how many". If a door list by name is wanted, it
-- is a committee decision and a second table — not a column added quietly here.
create table store.ticket_purchases (
  id uuid primary key default gen_random_uuid(),

  -- No cascade. An occasion with money taken against it is not something to delete by
  -- removing its parent row, and the restriction is the reminder.
  social_id uuid not null references store.socials (id),
  ticket_type_id uuid not null references store.ticket_types (id),

  status text not null check (status in ('pending', 'paid', 'expired', 'refunded')),

  -- **The reference, never the instrument.** No card number, no last four, no expiry reaches
  -- this database — Stripe Checkout is hosted by Stripe, which is what keeps the club out of
  -- PCI scope. Unique so a webhook delivered twice cannot create two purchases.
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,

  -- What was actually charged, for the whole purchase. Stored rather than recomputed, because
  -- the ticket type may legitimately change afterwards and a receipt must not.
  amount_pence int not null check (amount_pence >= 0),

  quantity int not null check (quantity between 1 and 20),

  -- The two things the club actually needs to let somebody in and to tell them about it.
  purchaser_name text not null check (length(trim(purchaser_name)) between 1 and 120),
  purchaser_email extensions.citext not null
    check (position('@' in purchaser_email::text) > 1),

  -- **Null on every row today, and that is the expand step rather than a live feature.**
  -- `create_pending_purchase()` accepts a person id and the Worker never passes one: there is
  -- no `/account/tickets/` for a ticket to appear on, so linking one to an account would be a
  -- column nothing reads. The parameter and the column exist so that building that page is a
  -- change to one function and no migration.
  --
  -- **An account is not required to buy a ticket and is never created by buying one**, which
  -- is the entry path's rule and holds here for its reason: auto-creating one would write an
  -- unconfirmed `auth.users` row and grant it the signup role — a false statement in the
  -- table whose whole job is to say who somebody is.
  person_id uuid,

  consents jsonb not null default '{}'::jsonb,
  consents_version text not null check (length(trim(consents_version)) between 1 and 40),

  -- **The readable half of the reference — ADR-030's shape, reused rather than reinvented.**
  -- Issued by the trigger below from `socials.next_ticket_no`, and nullable so that
  -- `formatEntryReference()`'s fallback to the purchase id keeps working. A counter rather
  -- than `max() + 1` because a reference already emailed to somebody may never come to mean a
  -- different ticket.
  ticket_no int check (ticket_no is null or ticket_no >= 1),

  -- How long a place is held while somebody is at the payment page. Null once paid.
  hold_expires_at timestamptz,

  -- What the webhook could not resolve on its own, for the cron to shout about. Same
  -- mechanism as `entries`, same reason: this is the only repeating channel the platform has.
  attention text check (attention is null or attention in ('over_capacity', 'amount_mismatch', 'already_refunded')),
  attention_resolved_at timestamptz,

  created_at timestamptz not null default pg_catalog.now(),
  paid_at timestamptz,
  refunded_at timestamptz,

  -- A pending purchase is the only kind that holds anything, so it is the only kind that
  -- needs an expiry. Cheaper to refuse the impossible state than to reason about it later.
  constraint ticket_purchases_hold_when_pending check (
    status <> 'pending' or hold_expires_at is not null
  )
);

comment on table store.ticket_purchases is
  'One payment for one or more tickets to one social. Holds a name, an email address and a quantity — deliberately nothing else about who is coming.';
comment on column store.ticket_purchases.quantity is
  'How many people this purchase lets in. There is no per-attendee row: names for each guest would be a field beyond what is specified.';

create index ticket_purchases_social_idx
  on store.ticket_purchases (social_id, created_at desc);

-- What the capacity count and the hold sweep both ask.
create index ticket_purchases_live_idx
  on store.ticket_purchases (social_id)
  where status in ('pending', 'paid');

alter table store.ticket_purchases enable row level security;

-- -------------------------------------------------------------------------------------------
-- api_secrets — the digests of the two keys this schema demands, never the keys
-- -------------------------------------------------------------------------------------------
-- **A leak of this table yields a SHA-256 of 32 random bytes.** Reversing it is the work the
-- hash exists to prevent; what it would give up is the digest, which is already assumed
-- public, and leave the attacker exactly where they started.
--
-- **Two rows rather than one, and it is not tidiness.** `entry` guards holding a ticket and
-- `stripe` guards confirming one, and one key opening two doors is one rotation closing
-- both. That is the lesson ADR-029 wrote down after `entries` shipped the confirming half
-- alone and left holding a place open to a loop with the published anon key.
--
-- **And they are this schema's own, not `entries`'.** Sharing `entries.webhook_secrets`
-- would mean a compromise of the party ticket path is a compromise of the race payment
-- path. `pg_catalog.sha256(bytea)` is core Postgres; no extension is added for this.
--
-- Both rows ship with a **null digest, which refuses everything**. That is the safe state:
-- until somebody installs a key, nothing can hold a ticket and nothing can mark one paid.
create table store.api_secrets (
  name text primary key check (name in ('entry', 'stripe')),
  key_sha256 text check (key_sha256 is null or key_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table store.api_secrets is
  'The digests of the keys the Worker presents, never the keys. RLS on, no policy, no grant — reachable only from the security definer functions below. If tests/store.test.ts stops refusing this table, a credential digest became readable with a key that is published in page source.';

alter table store.api_secrets enable row level security;

insert into store.api_secrets (name) values ('entry'), ('stripe')
  on conflict (name) do nothing;

-- -------------------------------------------------------------------------------------------
-- email_outbox — the obligation to tell somebody, written with the thing it is about
-- -------------------------------------------------------------------------------------------
-- ADR-021's mechanism, for tickets. The row is written in the same transaction as the
-- payment, so a committed purchase always has its message recorded; delivery is separate and
-- retryable. **Nothing can lose a message; it can only be late.**
--
-- It holds one piece of personal data, an email address. Everything else a message needs is
-- joined from the live tables at send time, so it is not a second copy of a ticket for
-- retention to chase.
create table store.email_outbox (
  id uuid primary key default gen_random_uuid(),

  purchase_id uuid not null
    references store.ticket_purchases (id) on delete cascade,

  -- **A closed list, checked.** A template name is what the Worker switches on to build a
  -- message, so an unknown one is a row that can never be sent and would sit `pending`
  -- forever. Adding a third is a migration, which is the point.
  template text not null check (template in ('ticket_confirmed', 'ticket_refunded')),

  recipient extensions.citext not null
    check (position('@' in recipient::text) > 1),

  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),

  attempts int not null default 0 check (attempts >= 0),

  provider_message_id text,

  -- **Never the provider's own error message**, for the reason `worker/stripe.ts` gives about
  -- Stripe's: a provider's error text can quote the value it rejected.
  last_error text check (last_error is null or length(last_error) <= 200),

  created_at timestamptz not null default pg_catalog.now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,

  -- **The idempotency key, and it is what stops somebody being told twice.** A Stripe webhook
  -- retry re-enters `record_checkout_event()`, finds the purchase already `paid`, and updates
  -- nothing — so the trigger never fires a second time. This is the belt to that braces.
  dedupe_key text not null unique
);

comment on table store.email_outbox is
  'One row per email the club owes somebody about a ticket. Written in the same transaction as the payment; delivery is a separate retryable job. Holds an email address and nothing else personal.';

create index store_email_outbox_pending_idx
  on store.email_outbox (created_at)
  where status = 'pending';

alter table store.email_outbox enable row level security;

-- ===========================================================================================
-- The functions — the only way anything reaches this schema
-- ===========================================================================================
-- Seven are granted to `anon` and `authenticated`; two are granted to nobody and are reachable
-- only from the definer functions and triggers that call them. `packages/db/tests/store.test.ts`
-- asserts that exact split, and asserts that every table above still refuses both roles.
--
-- Every one of them is `security definer` with a **pinned `search_path`**, which is the pattern
-- the timing platform already proves in production and the reason `entries`' helper lives in
-- `entries` rather than in `private`.

-- -------------------------------------------------------------------------------------------
-- store.key_ok() — granted to nobody
-- -------------------------------------------------------------------------------------------
-- **An oracle for the key if it were callable, so it is not callable.** Same shape as
-- `entries.admin_key_ok()`: reachable only from the definer functions below.
--
-- A null digest answers false. That is the shipped state and it refuses everything, which is
-- the safe direction — a deployment where nobody has installed a key sells no tickets rather
-- than selling them to anybody.
create or replace function store.key_ok(p_name text, p_key text)
  returns boolean
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_digest text;
begin
  if p_key is null or length(p_key) = 0 then
    return false;
  end if;

  select secret.key_sha256 into v_digest
    from store.api_secrets as secret
   where secret.name = p_name;

  if v_digest is null then
    return false;
  end if;

  return pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_key, 'UTF8')), 'hex'
  ) = v_digest;
end;
$$;

revoke all on function store.key_ok(text, text) from public, anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- store.social_state() — the one public door
-- -------------------------------------------------------------------------------------------
-- What a page needs to decide what to render, and nothing else. A select grant on
-- `store.socials` would do the same job and is the wrong shape, for the reason
-- `entries.entry_state()` gives: it would make the "anon can select nothing here" test carry
-- an exception from its first day, and an exception in an access-control test is how the next
-- one gets waved through.
--
-- **Every unconfirmed fact comes back as null**, and the page says so in words. This function
-- never invents one and never substitutes last year's.
create or replace function store.social_state(p_slug text)
  returns table (
    slug text,
    display_name text,
    social_date date,
    start_time time,
    end_time time,
    venue text,
    minimum_age int,
    sales_state text,
    sales_open_at timestamptz,
    sales_close_at timestamptz,
    max_tickets_per_purchase int,
    required_consents text[],
    consent_version text,
    capacity int,
    tickets_remaining int,
    ticket_types jsonb
  )
  language plpgsql
  stable
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_social store.socials%rowtype;
  v_state text;
  v_sold int;
  v_remaining int;
begin
  select * into v_social
    from store.socials as social
   where social.slug = p_slug
     and social.active;

  if not found then
    return;
  end if;

  -- **A null `sales_open_at` is tested as its own branch before anything is compared**, so it
  -- reads as *never opens* rather than *no lower bound*. This is the exact shape
  -- `entries.entry_state()` uses, and getting it wrong there would have put a race on sale.
  if v_social.sales_open_at is null then
    v_state := 'pre_open';
  elsif pg_catalog.now() < v_social.sales_open_at then
    v_state := 'pre_open';
  elsif v_social.sales_close_at is not null and pg_catalog.now() >= v_social.sales_close_at then
    v_state := 'closed';
  else
    v_state := 'open';
  end if;

  -- Tickets gone: everything paid for, plus everything currently held. A lapsed hold is not
  -- counted, which is what makes the cron below housekeeping rather than load-bearing.
  select coalesce(sum(purchase.quantity), 0) into v_sold
    from store.ticket_purchases as purchase
   where purchase.social_id = v_social.id
     and (
       purchase.status = 'paid'
       or (purchase.status = 'pending' and purchase.hold_expires_at > pg_catalog.now())
     );

  if v_social.capacity is null then
    v_remaining := null;
  else
    v_remaining := greatest(v_social.capacity - v_sold, 0);
  end if;

  return query
  select
    v_social.slug,
    v_social.display_name,
    v_social.social_date,
    v_social.start_time,
    v_social.end_time,
    v_social.venue,
    v_social.minimum_age,
    v_state,
    v_social.sales_open_at,
    v_social.sales_close_at,
    v_social.max_tickets_per_purchase,
    v_social.required_consents,
    v_social.consent_version,
    v_social.capacity,
    v_remaining,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'code', kind.code,
                   'label', kind.label,
                   'price_pence', kind.price_pence
                 )
                 order by kind.price_pence, kind.code
               )
          from store.ticket_types as kind
         where kind.social_id = v_social.id
           and kind.active
           and (kind.valid_from is null or kind.valid_from <= pg_catalog.now())
           and (kind.valid_to is null or kind.valid_to > pg_catalog.now())
      ),
      '[]'::jsonb
    );
end;
$$;

comment on function store.social_state(text) is
  'The public facts about one social. Unconfirmed facts come back null and the page says so — never a placeholder.';

grant execute on function store.social_state(text) to anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- store.issue_ticket_no() — the readable reference, ADR-030's shape
-- -------------------------------------------------------------------------------------------
-- **A trigger because the number must exist for every insert**, whatever wrote it, and a
-- counter rather than `max() + 1` because a reference already emailed to somebody may never
-- come to mean a different ticket. `entries` learned both of these the same way.
create or replace function store.issue_ticket_no()
  returns trigger
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
begin
  if new.ticket_no is not null then
    return new;
  end if;

  update store.socials
     set next_ticket_no = next_ticket_no + 1
   where id = new.social_id
  returning next_ticket_no - 1 into new.ticket_no;

  return new;
end;
$$;

revoke all on function store.issue_ticket_no() from public, anon, authenticated;

create trigger issue_ticket_no_before_insert
  before insert on store.ticket_purchases
  for each row
  execute function store.issue_ticket_no();

-- -------------------------------------------------------------------------------------------
-- store.enqueue_ticket_email() — the obligation, written with the transition
-- -------------------------------------------------------------------------------------------
-- **Two triggers, because a purchase can reach `paid` by two routes.** `after update` covers
-- the ordinary one — a place held, then paid for. `after insert` is there because a future
-- complimentary ticket would be inserted `paid` and skip the transition entirely, which is
-- exactly the silence #150 found in `entries`: two people were given places and told nothing,
-- and nobody chases an email they were never told to expect.
--
-- They share a dedupe key, so no ticket can be confirmed twice.
create or replace function store.enqueue_ticket_email()
  returns trigger
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_template text;
  v_was text;
begin
  if tg_op = 'INSERT' then
    v_was := null;
  else
    v_was := old.status;
  end if;

  if new.status = 'paid' and v_was is distinct from 'paid' then
    v_template := 'ticket_confirmed';
  elsif new.status = 'refunded' and v_was = 'paid' then
    -- **Only from `paid`.** Cancelling a purchase that never paid owes nobody a refund
    -- notice, because nothing was refunded. `entries` states the same rule and its tests
    -- assert the silence both ways, so it stays a decision rather than an accident.
    v_template := 'ticket_refunded';
  else
    return null;
  end if;

  insert into store.email_outbox (purchase_id, template, recipient, dedupe_key)
  values (
    new.id,
    v_template,
    new.purchaser_email,
    v_template || ':' || new.id::text
  )
  on conflict (dedupe_key) do nothing;

  return null;
end;
$$;

revoke all on function store.enqueue_ticket_email() from public, anon, authenticated;

create trigger enqueue_ticket_email_after_update
  after update on store.ticket_purchases
  for each row
  execute function store.enqueue_ticket_email();

create trigger enqueue_ticket_email_after_insert
  after insert on store.ticket_purchases
  for each row
  when (new.status = 'paid')
  execute function store.enqueue_ticket_email();

-- -------------------------------------------------------------------------------------------
-- store.create_pending_purchase() — holds the tickets, prices them, and takes a key
-- -------------------------------------------------------------------------------------------
-- One transaction under a per-social advisory lock: check the key, re-check the window, count
-- what is gone, price it from `ticket_types`, refuse a total of zero, and write a `pending`
-- purchase with a 31-minute hold. The Worker then creates a Checkout session for exactly that
-- amount.
--
-- **It takes a key, and that is ADR-029's lesson applied before it was needed rather than
-- after.** This is granted to `anon` — it has to be, a signed-out buyer reaches PostgREST as
-- `anon` — and it holds tickets *before* any money moves. Without a second factor a loop with
-- the published anon key would hold every ticket to the party for nothing, and Cloudflare's
-- rate-limiting rule would never see it because PostgREST is a different origin from the
-- Worker. `entries` shipped that hole and closed it four days later; this schema does not
-- ship it.
--
-- **`p_preview` runs every rule and returns before the first write**, so the page can show a
-- total before the person commits. Nothing is held and nothing is spent.
--
-- **A total of zero is refused.** Stripe will not create a zero-total session and will not
-- charge below £0.30 in GBP, so a free ticket that got this far would hold a place, pass
-- every check, and then fail at the session call with the place still held. Giving a ticket
-- away is `entries`' ADR-028 problem and wants the same answer — a volunteer doing it
-- deliberately — which is not built here.
create or replace function store.create_pending_purchase(
  p_key text,
  p_social_slug text,
  p_ticket_code text,
  p_purchaser_name text,
  p_purchaser_email text,
  p_quantity int,
  p_consents jsonb default '{}'::jsonb,
  p_person_id uuid default null,
  p_preview boolean default false
)
  returns table (
    ok boolean,
    reason text,
    purchase_id uuid,
    amount_pence int,
    quantity int,
    ticket_label text,
    hold_expires_at timestamptz
  )
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_social store.socials%rowtype;
  v_type store.ticket_types%rowtype;
  v_sold int;
  v_amount int;
  v_expires timestamptz;
  v_id uuid;
  v_missing text[];
  v_consent text;
begin
  if not store.key_ok('entry', p_key) then
    return query select false, 'bad_key', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  select * into v_social
    from store.socials as social
   where social.slug = p_social_slug
     and social.active;

  if not found then
    return query select false, 'no_such_social', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  -- **The lock is taken before the window is re-checked, not after.** Everything from here to
  -- the insert has to see one consistent count, or two people buying the last two tickets at
  -- the same moment both succeed.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_social.id::text, 0));

  if v_social.sales_open_at is null or pg_catalog.now() < v_social.sales_open_at then
    return query select false, 'pre_open', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  if v_social.sales_close_at is not null and pg_catalog.now() >= v_social.sales_close_at then
    return query select false, 'closed', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > v_social.max_tickets_per_purchase then
    return query select false, 'invalid_quantity', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  -- **Which consents are required is a column, not a constant**, because it differs between
  -- occasions and because the 2026 set has not been decided. An empty array asks for nothing,
  -- which is what ships.
  v_missing := array[]::text[];

  foreach v_consent in array v_social.required_consents loop
    if coalesce((p_consents ->> v_consent)::boolean, false) is not true then
      v_missing := v_missing || v_consent;
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    return query select false, 'consents_missing', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  select * into v_type
    from store.ticket_types as kind
   where kind.social_id = v_social.id
     and kind.code = p_ticket_code
     and kind.active
     and (kind.valid_from is null or kind.valid_from <= pg_catalog.now())
     and (kind.valid_to is null or kind.valid_to > pg_catalog.now());

  if not found then
    return query select false, 'invalid_ticket_type', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  select coalesce(sum(purchase.quantity), 0) into v_sold
    from store.ticket_purchases as purchase
   where purchase.social_id = v_social.id
     and (
       purchase.status = 'paid'
       or (purchase.status = 'pending' and purchase.hold_expires_at > pg_catalog.now())
     );

  if v_social.capacity is not null and v_sold + p_quantity > v_social.capacity then
    return query select false, 'sold_out', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  v_amount := v_type.price_pence * p_quantity;

  if v_amount <= 0 then
    return query select false, 'free_place', null::uuid, null::int, null::int, null::text, null::timestamptz;
    return;
  end if;

  -- **Every rule has run and nothing has been written.** This is the preview's whole point:
  -- the person sees the total the card will be charged, computed by the same code that will
  -- charge it, without a ticket being held while they think about it.
  if p_preview then
    return query select true, null::text, null::uuid, v_amount, p_quantity, v_type.label, null::timestamptz;
    return;
  end if;

  v_expires := pg_catalog.now() + interval '31 minutes';

  insert into store.ticket_purchases (
    social_id, ticket_type_id, status, amount_pence, quantity,
    purchaser_name, purchaser_email, person_id,
    consents, consents_version, hold_expires_at
  )
  values (
    v_social.id, v_type.id, 'pending', v_amount, p_quantity,
    trim(p_purchaser_name), p_purchaser_email, p_person_id,
    coalesce(p_consents, '{}'::jsonb), v_social.consent_version, v_expires
  )
  returning id into v_id;

  return query select true, null::text, v_id, v_amount, p_quantity, v_type.label, v_expires;
end;
$$;

comment on function store.create_pending_purchase(text, text, text, text, text, int, jsonb, uuid, boolean) is
  'Holds tickets and prices them, under a per-social advisory lock. Takes the entry key: this is anon-callable and holds a place before any money moves.';

grant execute on function store.create_pending_purchase(text, text, text, text, text, int, jsonb, uuid, boolean)
  to anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- store.attach_checkout_session() — the purchase learns its Stripe reference
-- -------------------------------------------------------------------------------------------
-- Deliberately keyless, and it is the one door here that is. It writes a Stripe session id
-- onto a purchase that is still `pending` and does nothing else — it cannot move money, cannot
-- change an amount, and cannot touch a purchase that has already been paid for. The worst a
-- caller with the anon key can do is attach a session id to their own held ticket.
create or replace function store.attach_checkout_session(
  p_purchase_id uuid,
  p_session_id text
)
  returns boolean
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_updated int;
begin
  update store.ticket_purchases
     set stripe_checkout_session_id = p_session_id
   where id = p_purchase_id
     and status = 'pending'
     and stripe_checkout_session_id is null;

  get diagnostics v_updated = row_count;

  return v_updated = 1;
end;
$$;

grant execute on function store.attach_checkout_session(uuid, text) to anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- store.record_checkout_event() — the only thing that writes `paid`
-- -------------------------------------------------------------------------------------------
-- ADR-010's rule, for tickets. **The redirect back from Stripe is not proof of payment** — a
-- tab can be closed before it fires and the return URL is one anybody can type — so the
-- webhook is the only writer, the transition is idempotent by state guard, and it runs under
-- the same per-social advisory lock the hold took.
--
-- **A payment that arrives after the hold lapsed is still `paid`, and is never refused.** By
-- the time this runs the money has gone; refusing it would take somebody's £12 and give them
-- nothing. If there is no room it is `paid` with `attention = 'over_capacity'`, it consumes a
-- place, and the cron shouts about it until a human clears the flag. There is deliberately
-- **no fifth status**: the capacity predicate counts `paid`, and a new value would be
-- invisible to it and let an oversold ticket be sold twice.
create or replace function store.record_checkout_event(
  p_key text,
  p_session_id text,
  -- **Defaulted, because Stripe may genuinely not send either.** A defaulted parameter is also
  -- what makes the generated TypeScript type optional rather than a required non-nullable
  -- string, which is the difference between the Worker passing `undefined` and having to lie.
  p_payment_intent text default null,
  p_amount_total int default null,
  p_event_type text default 'checkout.session.completed'
)
  returns table (ok boolean, result text)
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_purchase store.ticket_purchases%rowtype;
  v_social_capacity int;
  v_sold int;
  v_attention text;
begin
  if not store.key_ok('stripe', p_key) then
    return query select false, 'bad_key';
    return;
  end if;

  select * into v_purchase
    from store.ticket_purchases as purchase
   where purchase.stripe_checkout_session_id = p_session_id;

  if not found then
    return query select false, 'no_such_session';
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_purchase.social_id::text, 0)
  );

  -- Re-read under the lock, so two deliveries of the same event cannot both see `pending`.
  select * into v_purchase
    from store.ticket_purchases as purchase
   where purchase.id = v_purchase.id
     for update;

  if v_purchase.status = 'paid' then
    -- **Idempotent, and this is the ordinary case rather than an error.** Stripe retries for
    -- three days; a second delivery of a payment already recorded is a success.
    return query select true, 'already_paid';
    return;
  end if;

  if v_purchase.status = 'refunded' then
    update store.ticket_purchases
       set attention = 'already_refunded'
     where id = v_purchase.id
       and attention is null;

    return query select true, 'already_refunded';
    return;
  end if;

  if p_amount_total is not null and p_amount_total <> v_purchase.amount_pence then
    v_attention := 'amount_mismatch';
  end if;

  select social.capacity into v_social_capacity
    from store.socials as social
   where social.id = v_purchase.social_id;

  if v_social_capacity is not null then
    select coalesce(sum(other.quantity), 0) into v_sold
      from store.ticket_purchases as other
     where other.social_id = v_purchase.social_id
       and other.status = 'paid'
       and other.id <> v_purchase.id;

    if v_sold + v_purchase.quantity > v_social_capacity then
      v_attention := coalesce(v_attention, 'over_capacity');
    end if;
  end if;

  update store.ticket_purchases
     set status = 'paid',
         paid_at = pg_catalog.now(),
         hold_expires_at = null,
         stripe_payment_intent_id = coalesce(p_payment_intent, stripe_payment_intent_id),
         attention = coalesce(attention, v_attention)
   where id = v_purchase.id;

  return query select true, 'paid';
end;
$$;

comment on function store.record_checkout_event(text, text, text, int, text) is
  'The only writer of paid. Idempotent by state guard, under the social''s advisory lock. Never refuses a payment that has already been taken.';

grant execute on function store.record_checkout_event(text, text, text, int, text) to anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- store.expire_pending_holds() — housekeeping, and the alarm
-- -------------------------------------------------------------------------------------------
-- **If this never runs again, nobody is turned away and nothing is double-sold**: the capacity
-- count above only counts a `pending` purchase while its hold is still in the future. What
-- this does is stop an abandoned checkout reading as `pending` for ever, and — the half that
-- is not housekeeping — surface anything the webhook could not resolve on its own.
--
-- That property is the one to preserve if this is ever changed. A version that capacity
-- *depended* on would put the party at the mercy of a scheduler.
create or replace function store.expire_pending_holds()
  returns table (expired int, attention int, attention_oldest_hours int)
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_expired int;
  v_attention int;
  v_oldest int;
begin
  update store.ticket_purchases
     set status = 'expired'
   where status = 'pending'
     and hold_expires_at <= pg_catalog.now();

  get diagnostics v_expired = row_count;

  select count(*),
         coalesce(
           max(
             floor(
               extract(epoch from (pg_catalog.now() - purchase.created_at)) / 3600
             )::int
           ),
           0
         )
    into v_attention, v_oldest
    from store.ticket_purchases as purchase
   where purchase.attention is not null
     and purchase.attention_resolved_at is null;

  return query select v_expired, v_attention, v_oldest;
end;
$$;

grant execute on function store.expire_pending_holds() to anon, authenticated;

-- -------------------------------------------------------------------------------------------
-- The outbox drain — two keyed functions, exactly as `entries` does it
-- -------------------------------------------------------------------------------------------
-- **Both take the stripe key** rather than a third one. That is a deliberate difference from
-- the entry/confirm split above: those two guard *different powers* — holding a ticket and
-- recording a payment — whereas the drain is the same Worker doing the same job on the same
-- schedule as the confirmation it follows. A third key here would be a third rotation with no
-- extra door closed.
create or replace function store.claim_outbox_batch(p_key text, p_limit int default 10)
  returns table (
    id uuid,
    template text,
    recipient text,
    attempts int,
    ticket_no int,
    social_slug text,
    social_name text,
    social_date date,
    purchase_created_at timestamptz,
    purchase_id uuid,
    amount_pence int,
    quantity int,
    purchaser_name text,
    reply_to text
  )
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
begin
  if not store.key_ok('stripe', p_key) then
    return;
  end if;

  return query
  update store.email_outbox as outbox
     set attempts = outbox.attempts + 1,
         last_attempt_at = pg_catalog.now()
    from store.ticket_purchases as purchase
    join store.socials as social on social.id = purchase.social_id
   where outbox.id in (
           select candidate.id
             from store.email_outbox as candidate
            where candidate.status = 'pending'
            order by candidate.created_at
            limit greatest(coalesce(p_limit, 10), 1)
            for update skip locked
         )
     and purchase.id = outbox.purchase_id
  returning
    outbox.id,
    outbox.template,
    outbox.recipient::text,
    outbox.attempts,
    purchase.ticket_no,
    social.slug,
    social.display_name,
    social.social_date,
    purchase.created_at,
    purchase.id,
    purchase.amount_pence,
    purchase.quantity,
    purchase.purchaser_name,
    social.reply_to;
end;
$$;

grant execute on function store.claim_outbox_batch(text, int) to anon, authenticated;

create or replace function store.record_send_result(
  p_key text,
  p_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
)
  returns boolean
  language plpgsql
  security definer
  set search_path = store, pg_catalog
as $$
declare
  v_updated int;
  v_status text;
begin
  if not store.key_ok('stripe', p_key) then
    return false;
  end if;

  if p_status not in ('sent', 'pending', 'failed') then
    return false;
  end if;

  -- **Three attempts, then `failed`.** Past that a malformed address or a template bug is the
  -- likely cause and a fourth attempt fixes neither. The decision is taken here rather than in
  -- the Worker so that a Worker rolled back cannot start retrying for ever.
  v_status := p_status;

  update store.email_outbox
     set status = v_status,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         last_error = left(p_error, 200),
         sent_at = case when v_status = 'sent' then pg_catalog.now() else sent_at end
   where id = p_id;

  get diagnostics v_updated = row_count;

  update store.email_outbox
     set status = 'failed'
   where id = p_id
     and status = 'pending'
     and attempts >= 3;

  return v_updated = 1;
end;
$$;

grant execute on function store.record_send_result(text, uuid, text, text, text) to anon, authenticated;

-- ===========================================================================================
-- The 2026 Christmas party — a row with almost nothing in it, and that is the point
-- ===========================================================================================
-- **Every fact about this occasion is null**, because none of them has been supplied. The
-- attached 2025 page is not a source for 2026: last year's date, venue and price are last
-- year's, and carrying them forward would be the club announcing a party it has not agreed.
--
-- What the row does is make `/events/christmas-party-2026/` a real address that reads its
-- content from the database, so that confirming the details is one `update` and no deploy —
-- the same property `entries.events` was built for.
--
-- `sales_open_at` is null, so nothing can be sold. There is no `ticket_types` row, so there
-- is no price. Both of those are separately sufficient, and both are deliberate.
--
-- **Two of these facts were supplied later the same day** — the date and the venue, in
-- `20260905110000_store_christmas_party_2026_date_and_venue.sql`. Everything this paragraph
-- says stays true of *this* file; the point of the separate migration is that a published
-- claim about the party has its own dated, reviewable step.
insert into store.socials (
  slug, display_name, reply_to, consent_version, max_tickets_per_purchase
)
values (
  'christmas-party-2026',
  'SRC Christmas Party 2026',
  'info@southvillerunningclub.co.uk',
  'unpublished-2026-09-05',
  6
)
on conflict (slug) do nothing;
