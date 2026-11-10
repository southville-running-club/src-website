# ADR-070: A full race says so in place of the entry form

**Status:** Accepted on 27 October 2026, as a **race-week change freeze exception** taken by a
maintainer (Bindal), three days before entries close. Built on a branch inside the freeze and
held there for that decision. The exception covers this change alone.
**Date:** 27 October 2026

## Context

Nightingale Nightmare 2026 sold its 250th place on or before 27 October 2026, three days before
entries close at 17:00 on Friday 30 October. Production answered
`GET /nn/2026/places-remaining/` with `{"capacity":250,"remaining":0}`.

The entry window has three states in the database — `pre_open`, `open`, `closed` — and
"full" is not one of them. While the window was open, `/nn/2026/` therefore went on serving:

- the whole entry form, about twenty fields;
- a filled **Enter the race** button in the bar on every campaign page, and two more on the
  year page;
- on `/nn/`, the filled button and the fee line;
- a counter, painted by the enhancement script, reading **"0 places left"**.

Somebody filling the form in found out at the end, from the sold-out notice, which says
_"The last place went while this form was open"_. That sentence was written for the race filling
up between page load and submission. For everybody who arrived after the race was already full,
it was false.

Nobody was charged or oversold. `create_pending_purchase()` refuses with `sold_out` inside the
per-event lock whatever the page shows. The cost was people's time, and a false sentence.

## Decision

1. **"Full" is a fourth reason the form is not on offer**: `window: 'full'` on the
   `show: 'closed'` view, alongside `pre_open`, `ended` and `unknown`. It is not a new `show`
   value, for the reason `NnEntryView`'s own header gives: every `view.show !== 'entry'` branch
   keeps meaning "the form is not on offer".
2. **It is decided per request from `entries.places_remaining()`**, the same count
   `create_pending_purchase()` takes a place against: paid, plus pending holds that have not
   lapsed. No new database function, no migration and no flag. A hold that lapses after 31
   minutes, or an entry a volunteer cancels, makes a place again. The next page load then gets
   the form back, and nobody has to switch anything.
3. **Only a clean answer of zero is "full".** If the count cannot be read, the form stays up.
   Wrongly saying "full" turns away a runner who could have entered. Wrongly showing the form
   costs somebody their typing, and the database refuses the entry anyway.
4. **The GET page asks; the POST re-render does not.** `checkNnEntryCapacity()` wraps
   `resolveNnEntryView()` on the GET path only. When a submission loses the last place, the
   page still re-renders the form, with everything typed in it, under the sold-out notice. So
   that notice's _"while this form was open"_ is true again.
5. **What a full race renders:**
   - **The year page**: a "The race is full" notice in place of both forms. Every `[data-nn-cta]`
     is hidden, and so is the "Entries open" date. The facts list still states the price.
   - **The sticky entry card on the year page**: where its button was, _"The race is full.
     Every place has been taken."_ and a link, "How to hear if one comes back", to the notice.
     The card follows the reader down the page, so without this it held a price and nothing
     else beside every paragraph, which reads as an offer. It still states the price, as the
     facts list does.
   - **`/nn/`**: the panel swaps its fee line for "Every place has been taken — the race is
     full", and uses the outlined "The 2026 race" action that every non-open state uses.
   - **The bar on every campaign page**: the closed state's **Race details / Details** label,
     because the page it leads to offers no form, as a closed one does.
6. **The full notice reuses the sold-out notice's email sentence word for word**:
   _"If you would like to be told about a place if one comes back, email …"_. The club already
   offers that address for exactly this. Two wordings of one offer would read as two offers.
7. **The masthead's answer is reused on the year page** when both are about the same running,
   so the bar and the page read one count, not two, and cannot disagree.
8. **The phone's sticky entry bar ignores hidden calls to action.** It appears when no inline
   `[data-nn-cta]` is on screen. A hidden element never intersects, so in the full state, and
   already in the ended state, it would rise holding a price and no button. It counts only CTAs
   the Worker left visible now. This fixes the ended state too, which goes live at the close
   whether this merges or not.

## Consequences

- **One extra read on every campaign page view while entries are open**:
  `places_remaining()` is a small count with no personal data, and it is asked only while the
  window is open. On the year page the masthead's answer is reused, so that page makes no
  second read.
- **The places-remaining endpoint and its enhancement script are unchanged.** The counter is
  inside the form, so a full race no longer shows "0 places left". The endpoint stays as it is
  for an open race.
- **A full race and an ended race look alike on purpose**, except for the sentence. Full says a
  place can come back; ended does not, because once the window has closed none can.
- **The tester path is unaffected in substance.** A tester on a `pre_open` window is asked the
  same question. A full field is full for a tester too, because `create_pending_purchase()`
  counts their place like anybody else's.
- **Whether a place that comes back goes back on sale online is now a visible behaviour**, not
  an accident of the page. It always was the behaviour: a lapsed hold or a cancellation has
  always returned the place to the pool. If the club would rather offer returned places to
  whoever emailed, that is a decision about the pool, not about this page.

## Alternatives considered

- **Close the window early by setting `entries_close_at`.** No deploy, but the close time is a
  published fact, so changing it is a stop-and-ask. The facts list would still say "Entries
  close Friday 30 October 2026, 17:00" beside "Entries have closed", because that line comes
  from `race.json`. And a place that came back could not be taken.
- **Return `remaining` from `entry_state()`.** One read instead of two, but it needs a
  migration, and migrations are frozen in race week.
- **A new `show: 'full'` value.** Rejected for the reason in decision 1: every consumer of
  `show` would have to learn it, on the path that takes money.
- **Change the sold-out notice's wording instead.** It would make the sentence true and leave
  everything else: the form, the button and twenty fields of typing.
