-- ---------------------------------------------------------------------------------------
-- The 2026 entry fees — £18 affiliated, £20 unaffiliated, £0 for a guide
-- ---------------------------------------------------------------------------------------
-- Confirmed by the race director, 24 August 2026, replacing the £15/£17 seeded with the
-- schema. Recorded as decision 006 in docs/decisions/decision-log.md, which is where a price
-- belongs: it is money, it is the committee's to ratify, and reversing it after a single
-- entry has been sold costs a refund rather than an afternoon.
--
-- **An UPDATE rather than a second row, and that is forced rather than chosen.**
-- `entries.fees` carries `valid_from`/`valid_to`, and the column comment beside them says an
-- early-bird price is "a second row with a window rather than an edit to this one". That is
-- not reachable for these two: `unique (event_id, code)` allows exactly one row per code per
-- event, and `code` is itself constrained to three literals. So a windowed second price for
-- `unaffiliated` cannot exist, and the comment describes an arrangement the table forbids.
-- Noted here rather than fixed — making it true is a schema change with its own review, and
-- it is not what this migration is for.
--
-- **Nothing that has already been sold moves.** `entry_purchases.amount_pence` is written at
-- purchase time from `fees.price_pence` and is never re-read from it, so what somebody paid
-- stays what somebody paid. There are no rows against `nn-2026` today in any case.
--
-- **Safe in either deploy order**, which is the property that matters here because nothing
-- sequences a migration against the Cloudflare deploy. A Worker that is old or new reads the
-- price through `entry_state()` and `create_pending_purchase()` at request time; neither
-- knows a number. The only visible effect is the number a runner is shown and charged.
-- ---------------------------------------------------------------------------------------

do $$
declare
  v_event_id uuid;
  v_updated int;
begin
  select id into v_event_id from entries.events where slug = 'nn-2026';

  if v_event_id is null then
    raise exception 'nn-2026 is not in entries.events — refusing to reprice nothing';
  end if;

  update entries.fees as fee
     set price_pence = priced.price_pence
    from (values ('affiliated', 1800), ('unaffiliated', 2000)) as priced (code, price_pence)
   where fee.event_id = v_event_id
     and fee.code = priced.code;

  get diagnostics v_updated = row_count;

  -- **A migration that repriced nothing must fail rather than pass quietly.** The alternative
  -- is a green deploy that leaves the old prices live, discovered by the first runner charged
  -- £15 for an £18 race — and by then the money has moved.
  if v_updated <> 2 then
    raise exception 'Expected to reprice 2 fee rows for nn-2026, repriced %', v_updated;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- What the £2 differential actually is
-- ---------------------------------------------------------------------------------------
-- **The schema said this was an England Athletics rebate. It is not, and the difference is
-- not cosmetic.** The comment beside `requires_ea_number` in the creating migration reads
-- "Affiliated entry is £2 cheaper because England Athletics rebates the levy for a registered
-- athlete", which describes money coming back to the club.
--
-- ARC's rulebook describes the opposite flow. **Rule 21(2)(b)** requires the promoter to
-- impose the Unattached Runner Levy on runners who are not members of a club affiliated to
-- ARC or UK Athletics, and **Rule 21(2)(c)** requires it to be remitted to ARC within 30 days
-- along with the full race entry list. So the £2 is never the club's: the club nets £18
-- whichever box a runner ticks, and holds £2 of ARC's money until it is sent on, with a
-- reporting obligation attached to it.
--
-- That changes what these rows *mean* rather than what they hold. It is recorded here because
-- the creating migration has already been applied and is not edited, and a `comment on` is the
-- expand-shaped way to correct a claim that is wrong in the database's own catalogue.
--
-- **It also names a live defect rather than closing one.** Rule 21(2)(b) exempts members of
-- clubs affiliated to ARC *or* UK Athletics, and this column asks only for an England
-- Athletics registration — so a member of an ARC-affiliated club is exempt from the levy and
-- has no number to type. Whether Southville is itself ARC-affiliated is being confirmed. See
-- issue #72; it is deliberately not fixed here, because the fix is a change to what the entry
-- record holds and that is a decision rather than a price.
-- ---------------------------------------------------------------------------------------

comment on column entries.fees.requires_ea_number is
  'Whether this fee requires an England Athletics number. The £2 differential is ARC''s Unattached Runner Levy under Rule 21(2)(b), collected by the promoter and remitted to ARC within 30 days with the entry list under 21(2)(c) — not club income, and not an England Athletics rebate. The number is collected and format-checked and is NOT verified. Rule 21(2)(b) also exempts members of ARC-affiliated clubs, who have no EA number: see issue #72.';

-- ---------------------------------------------------------------------------------------
-- The entry window is deliberately still null, and this migration is where somebody will
-- look for it
-- ---------------------------------------------------------------------------------------
-- Values have been proposed — **entries open 1 September 2026 at 07:00 and close 30 October
-- 2026 at 17:00, Europe/London** — and they are not written here, because
-- `entries.events.entries_open_at` is not configuration waiting to be switched on. It **is**
-- the switch: `entry_state()` resolves `pre_open` until `now()` passes it and `open`
-- afterwards, so a value in this column is a dated instruction to start selling places,
-- unattended, with no deploy and nobody present.
--
-- [The entries-open runbook](../../../../docs/delivery/runbooks/entries-open.md) exists for
-- exactly that moment, makes the window the committee's rather than the race director's, and
-- lists stop conditions that are not met today — the WAF rate-limiting rule is not live, no
-- payment has ever completed end to end, and the entry terms are not written.
--
-- So the window stays null and arrives as one `update` a human runs, which the runbook now
-- carries verbatim. `packages/db/tests/entries.test.ts` asserts both columns are null; that
-- assertion is the thing standing between a proposal and a race that starts selling itself.
-- ---------------------------------------------------------------------------------------
