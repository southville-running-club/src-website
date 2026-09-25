-- What club membership costs, and who may join — as data a volunteer can change with SQL.
--
-- =========================================================================================
-- Why this is a fourth schema rather than a row in an existing one
-- =========================================================================================
-- `entries.fees` is what a runner pays to enter one running of one race. `store.ticket_types`
-- is what a member pays for a ticket to one social. Membership is neither: it is an annual
-- subscription to the club itself, it is not tied to an occasion, and it is sold once a year
-- rather than per event.
--
-- The glossary is the deciding argument. An *event* is one running of one race in one year,
-- and both existing price tables hang off something with a date. Membership has no date to
-- hang off, so putting it in either would mean a fee row belonging to no event — a shape
-- those tables are not built for and whose absence nothing would catch.
--
-- `store` set this precedent on 5 September 2026: a new kind of thing got a new schema
-- rather than four nullable columns on a live one. See
-- [ADR-033](../../../../docs/architecture/decisions/adr-033-a-ticket-is-not-an-entry.md),
-- and [ADR-049](../../../../docs/architecture/decisions/adr-049-membership-prices-live-in-the-database.md)
-- for this one.
--
-- =========================================================================================
-- ⚠️ The whole point: a price change is a query, not a deploy
-- =========================================================================================
-- The club raises its fees roughly once a year. Held in markup or in a JSON file, that is an
-- edit, a review, a merge and a deploy — and, because the price appears on more than one
-- page, an opportunity to change it in one place and not the other.
--
-- Held here it is:
--
--     update membership.membership_types set price_pence = 500 where code = 'club';
--
-- and every page follows on the next request. That is the property the club asked for, and
-- it is the same one `entries.fees` and `store.ticket_types` already have.
--
-- ⚠️ **So nothing may restate a price anywhere else.** Not in markup, not in a content file,
-- not in an email template. `apps/main/tests/unit/club-content.test.ts` asserts that the
-- club's content files carry no membership price, because a second copy is how the property
-- above quietly stops being true.
--
-- =========================================================================================
-- What is deliberately NOT here
-- =========================================================================================
-- ⚠️ **No applications table.** A new member's form asks for a date of birth, a home address
-- and a phone number, and `CLAUDE.md` is explicit that adding a database column which holds
-- personal data is a committee decision. That decision has not been taken, so this migration
-- creates the prices and nothing that could store a person.
--
-- Nor could it honestly: neither `/privacy/` nor `/nn/privacy/` covers this collection, or
-- the sharing with England Athletics that a licence application requires. Both are committee
-- documents. The form ships pointing at the club's existing form on the old site until that
-- wording exists.
--
-- What lands here is the half that needs nobody's permission: what the club charges, and the
-- minimum age it has already settled.

-- =========================================================================================
-- The schema
-- =========================================================================================
-- `usage` but no default table privileges, exactly as `store` does. The anon role can reach
-- the functions this schema grants it and can read no table at all — which is what makes a
-- published anon key safe to put in page source.
create schema if not exists membership;

grant usage on schema membership to anon, authenticated;

alter default privileges in schema membership revoke all on tables from anon, authenticated;

-- =========================================================================================
-- What the club charges
-- =========================================================================================
-- One row per thing somebody can buy. Two today.
--
-- ⚠️ **`ea_fee_pence` is what makes £27 explicable rather than arbitrary.** Club membership
-- is £4 and the England Athletics registration fee is £23; the combined option is £27, and
-- £23 of that is not the club's money. Without this column the page has to either state a
-- number with no explanation or hard-code the arithmetic — and the arithmetic changes when
-- England Athletics move their fee, which they do independently of the club.
--
-- It is the same shape as the Unattached Runner Levy on the race entry, where the £2 gap
-- between £18 and £20 is ARC's rather than the club's and the page says so.
create table if not exists membership.membership_types (
  -- Stable, referenced by code from the form and the page. Never renamed once sold against.
  code text primary key,

  -- What a member reads. "Annual Club Membership".
  display_name text not null,

  -- The total the member pays, in pence. Pence because every price in this platform is, and
  -- because `formatPriceWords()` is the one thing allowed to turn one into words.
  price_pence integer not null,

  -- The part of `price_pence` that belongs to England Athletics rather than to the club.
  -- Null where there is none.
  ea_fee_pence integer,

  -- One line under the name, for whatever the club wants to say about this option.
  summary text,

  -- ⚠️ **An option is withdrawn by clearing this, never by deleting the row.** A deleted row
  -- takes its history with it, and somebody will have paid against it.
  active boolean not null default true,

  -- What order the options are offered in. The club decides which is the obvious choice.
  sort_order integer not null default 0,

  constraint membership_types_price_sane check (price_pence >= 0),
  constraint membership_types_ea_fee_sane check (
    ea_fee_pence is null or (ea_fee_pence >= 0 and ea_fee_pence <= price_pence)
  ),
  constraint membership_types_code_shaped check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table membership.membership_types is
  'What club membership costs. A price rise is an update here and no deploy; nothing may restate a price in markup or in a content file.';

comment on column membership.membership_types.ea_fee_pence is
  'The England Athletics share of price_pence, so the page can explain the difference rather than state a number. Not the club''s money.';

alter table membership.membership_types enable row level security;

-- =========================================================================================
-- The club's own settings
-- =========================================================================================
-- ⚠️ **One row, enforced.** A settings table with two rows is a settings table nobody can
-- read confidently, and the failure is silent — a query picks one and the other is ignored.
-- The check constraint on a fixed primary key is the cheapest way to make a second row
-- impossible rather than merely unlikely.
create table if not exists membership.settings (
  id boolean primary key default true,

  -- ⚠️ **18, and it is the same 18 the race already enforces.** `entries.events.minimum_age`
  -- holds 18 for Nightingale Nightmare. Held here as data for the reason the prices are: the
  -- club can change it with a query, and the form and the server both read the same number
  -- rather than each carrying their own constant.
  minimum_age integer not null,

  -- The England Athletics registration year runs from April. An applicant's age is quoted
  -- against a cut-off rather than against today, because a category is a fact about a season.
  ea_cutoff_month integer not null default 4,
  ea_cutoff_day integer not null default 1,

  constraint settings_single_row check (id),
  constraint settings_minimum_age_sane check (minimum_age between 0 and 120),
  constraint settings_cutoff_shaped check (
    ea_cutoff_month between 1 and 12 and ea_cutoff_day between 1 and 31
  )
);

comment on table membership.settings is
  'One row. The club''s membership rules that are numbers rather than prices — the minimum age, and the England Athletics cut-off a category is calculated against.';

alter table membership.settings enable row level security;

-- =========================================================================================
-- The rows the club has actually settled
-- =========================================================================================
-- ⚠️ **These are confirmed prices, not placeholders.** £4 club only; £27 for club plus the
-- England Athletics racing licence, of which £23 is England Athletics' registration fee.
-- Supplied by a club volunteer on 21 September 2026 with the club's own payment page as the
-- source. The old site quotes £23, £24 and £27 in different places, which is exactly why
-- `apps/main/src/content/membership.json` carried a null until now: it is the combined total
-- that is £27, and the £23 is the part of it that is not the club's.
insert into membership.membership_types
  (code, display_name, price_pence, ea_fee_pence, summary, sort_order)
values
  (
    'club',
    'Annual Club Membership',
    400,
    null,
    'Supports the club, and gets you into the members'' WhatsApp community and local discounts.',
    1
  ),
  (
    'club_ea',
    'Annual Club Membership + England Athletics Racing Licence',
    2700,
    2300,
    'Everything in membership, plus discounted entry to affiliated races and annual race insurance.',
    2
  )
on conflict (code) do nothing;

insert into membership.settings (id, minimum_age)
values (true, 18)
on conflict (id) do nothing;
