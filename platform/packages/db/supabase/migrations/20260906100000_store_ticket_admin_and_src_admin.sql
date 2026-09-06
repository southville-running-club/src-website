-- Who bought a ticket, and the role that may look.
--
-- Two decisions in one migration, both of which CLAUDE.md makes a stop-and-ask and both of
-- which were taken by the club on 6 September 2026: **an eleventh permission** and **a sixth
-- role**.
--
-- =========================================================================================
-- The gap this closes
-- =========================================================================================
-- `store` has sold nothing yet and there has never been a way to read what it would sell.
-- ADR-033 said so in as many words — *"no admin surface … who is coming is the runbook's
-- queries and Stripe's dashboard"* — and named it the biggest gap and the first thing to
-- build next. This is that.
--
-- =========================================================================================
-- `src-admin` is a master role, and that is a departure worth naming
-- =========================================================================================
-- **The existing design deliberately has no wildcard.** `identity-permissions.test.ts` says
-- it plainly: *"`super-admin` holds two permissions and both are about this club's people. A
-- super-admin who needs the entry list still grants themselves `nn-admin`, and that still
-- writes a row in `identity.audit`."* Every capability on this platform has been a separate
-- grant to a separate role since ADR-017.
--
-- The club asked for a master role for its **directors**, and this is it. What that buys is
-- that a director does not have to grant themselves four roles to do their job; what it
-- costs is that the four capabilities stop being separately grantable to the people who hold
-- it. That is a governance decision rather than a technical one, and it is recorded here
-- rather than inferred from a `role_permissions` table nobody reads.
--
-- ⚠️ **`src-admin` therefore holds `nn.entry.read_medical`.** That reads runners' declared
-- medical conditions — Article 9 special-category data under UK GDPR, and the most sensitive
-- thing this platform holds. It is not a *new* disclosure: `nn-admin` has carried it since
-- the admin surface was built, and every read is written to `entries.admin_audit`. What is
-- new is the **set of people** who get it by default, which is now "every director" rather
-- than "whoever was granted the race role". **Removing it is one row deleted from the insert
-- below**, and nothing else in this migration depends on it.
--
-- =========================================================================================
-- Explicit rows, and NOT a wildcard in has_permission()
-- =========================================================================================
-- "Access to everything" could have been one branch in `identity.has_permission()` —
-- `if identity.has_role('src-admin') then return true`. **It is deliberately not**, and this
-- is the load-bearing part of the whole change.
--
-- A wildcard grants the **next** permission too. The twelfth permission somebody adds for
-- some unrelated feature would reach every director the moment it was created, without
-- anybody deciding that it should — which is exactly the class of silent escalation this
-- schema's "a decision somebody takes in a diff" mechanism exists to prevent.
--
-- Eleven explicit rows mean `packages/db/tests/identity-permissions.test.ts` fails the day a
-- twelfth permission is added, until somebody writes down whether directors get it. **A
-- master role that has to be re-confirmed on every extension is the only kind worth having**,
-- and the cost — one row per permission, forever — is the point rather than the price.

-- -----------------------------------------------------------------------------------------
-- The eleventh permission
-- -----------------------------------------------------------------------------------------
-- **Read, and there is deliberately no write counterpart.** Nothing in `store` cancels or
-- refunds a ticket — ADR-033 records that as not built — so a `store.ticket.cancel` would be
-- a permission guarding a door that does not exist. It arrives with the function that needs
-- it, which is the order `entries` granted its own in.
insert into identity.permissions (slug, description) values
  ('store.ticket.read',
   'Read who has bought a ticket to a club social: their name, email address and how many tickets.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------------------
-- The sixth role
-- -----------------------------------------------------------------------------------------
-- **The description is what `/admin/people/`'s legend renders**, from this row, and it is the
-- only place a volunteer granting this can see what they are handing over. So it says what
-- the role actually carries rather than what its name suggests — the same reason
-- `people-admin`'s description had to spell out that it changes nothing.
insert into identity.roles (slug, description) values
  ('src-admin',
   'Everything on the club website: race entries, refunds, exports, medical notes, the email queue, ticket sales, and granting roles. For club directors.')
on conflict (slug) do nothing;

-- **Every permission, one row each.** See the header on why this is not a wildcard. The list
-- is deliberately exhaustive rather than derived from `identity.permissions`: a `select` here
-- would re-introduce the wildcard by the back door, granting whatever exists at apply time
-- and, on a later `db reset`, whatever exists then.
insert into identity.role_permissions (role, permission) values
  ('src-admin', 'identity.person.read'),
  ('src-admin', 'identity.role.grant'),
  ('src-admin', 'nn.email.read'),
  ('src-admin', 'nn.email.resend'),
  ('src-admin', 'nn.entry.before_open'),
  ('src-admin', 'nn.entry.cancel'),
  ('src-admin', 'nn.entry.create'),
  ('src-admin', 'nn.entry.export'),
  ('src-admin', 'nn.entry.read'),
  -- ⚠️ Article 9 health data. See the header; deleting this one row is the whole of the
  -- change if the club would rather directors did not hold it by default.
  ('src-admin', 'nn.entry.read_medical'),
  ('src-admin', 'store.ticket.read')
on conflict (role, permission) do nothing;

-- -----------------------------------------------------------------------------------------
-- store.admin_ticket_list() — who is coming
-- -----------------------------------------------------------------------------------------
-- **Granted to `authenticated`, and it authorises inside itself.** That is the shape every
-- read on the admin surface takes: the grant says "you may ask", and
-- `identity.has_permission()` answers. `anon` gets nothing — this schema's anon list stays at
-- the seven functions `packages/db/tests/store.test.ts` names.
--
-- **It returns exactly what the club collects and nothing more**: a name, an email address, a
-- quantity, what was paid and when. There is no medical note, no date of birth and no
-- attendee list here because `store` holds none — which is ADR-033's whole argument, and is
-- why this function needed no thought about what to leave out.
--
-- **`pending` and `expired` rows are included and labelled**, rather than filtered to `paid`.
-- A volunteer asking "did Alex get a ticket" needs to see an abandoned checkout to answer it;
-- `/admin/nn/` learned that the hard way when a refunded entry could not appear on the page
-- at all and a volunteer concluded there had been no refunds.
create or replace function store.admin_ticket_list(p_social_slug text default null)
  returns table (
    ticket_no int,
    social_slug text,
    social_name text,
    purchaser_name text,
    purchaser_email text,
    quantity int,
    amount_pence int,
    status text,
    attention text,
    created_at timestamptz,
    paid_at timestamptz,
    purchase_id uuid
  )
  language plpgsql
  stable
  security definer
  set search_path = store, pg_catalog
as $$
begin
  if not identity.has_permission('store.ticket.read') then
    -- **Nothing, rather than an error.** The caller is a page that answers 404 to anybody who
    -- may not be there, and a distinguishable refusal here would tell them the door exists.
    return;
  end if;

  return query
  select
    purchase.ticket_no,
    social.slug,
    social.display_name,
    purchase.purchaser_name,
    purchase.purchaser_email::text,
    purchase.quantity,
    purchase.amount_pence,
    purchase.status,
    purchase.attention,
    purchase.created_at,
    purchase.paid_at,
    purchase.id
  from store.ticket_purchases as purchase
  join store.socials as social on social.id = purchase.social_id
  where p_social_slug is null or social.slug = p_social_slug
  order by purchase.created_at desc;
end;
$$;

comment on function store.admin_ticket_list(text) is
  'Who has bought a ticket, behind store.ticket.read. Returns a name, an email address and a quantity — everything this schema holds about a buyer and nothing it does not.';

revoke all on function store.admin_ticket_list(text) from public, anon;
grant execute on function store.admin_ticket_list(text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- What this migration deliberately does NOT add
-- -----------------------------------------------------------------------------------------
-- **No audit table for `store`.** `entries.admin_audit` exists because that surface discloses
-- a medical note and exports a start list; ADR-024 decided that reading the entry *list*
-- writes no audit row either, "because it discloses what the list and the exports already do
-- to the same permission". A ticket list is a name, an address and a number, held by one
-- permission, with no export and no second surface — so there is nothing here that an audit
-- row would record which the grant does not already say.
--
-- **No CSV export.** `nn.entry.export` is its own permission precisely because a file leaves
-- the building. If the club wants a door list as a file, that is a twelfth permission and a
-- decision, not an addition to this one.
