# Runbook — race night on the timing app

**How one running of one race is timed, from the change freeze to the morning after.** It is
the only end-to-end description of the job, and it is written against the application that
exists rather than the one the old repository documents:
`/timing/events/nn-2026/start/` rather than `/admin/pass-the-buck-2026/start`, a publish
button rather than a CSV, and two apps rather than one.

**Prerequisites:** accounts and roles already granted and rostered —
[getting into `/timing`](timing-access.md) is that procedure and it is **not** repeated here.
A laptop for race control, a charged phone per marshal, and paper. **No database credentials,
no Cloudflare dashboard, no `wrangler`.**

**About an hour of preparation in the week before**, then the race itself, then twenty minutes
afterwards. Publishing is five minutes and cannot be rushed into.

---

## Who does which part

Every step below carries a tag. Nobody should have to read the whole page to find their half,
and on the day the person holding the phone is not the person holding the laptop.

| Tag | Means | Holds |
| --- | --- | --- |
| **🎛️ Race control** | At a laptop, on `/timing/events/<slug>/` | `timing-admin` |
| **📱 Marshal** | On a phone, on `/timing/marshal/<slug>/` | `timing-marshal`, **and a row on this race's roster** |
| **🏛️ Race director** | Not a platform role at all. The decisions no screen can take | — |

**Read your own tags before the day and the whole page on the day.** Race control and the race
director are frequently the same person, and the tags are what stop that becoming a reason to
skip the separation the application enforces.

---

## Read this first: two rules, and neither is obvious from the screen

**1. Finishing a race is not publishing it, and finishing closes nothing.** *Finish this race*
writes a label the race director sets and can unset. It gates no capture, no correction and no
status — the last runner crosses after somebody has called the race over, every year. The
finish screen says so under its own button: *"Finishing is a **label, not a cut-off**."*
**A volunteer who reads "finished" as "closed" and puts their phone away has caused the one
misunderstanding that screen can cause**, so say it out loud on the morning rather than
trusting the sentence.

Publishing is a second act, by a second permission, on a second screen —
[ADR-042](../../architecture/decisions/adr-042-publishing-a-result-is-an-act-somebody-takes.md).
It is refused while the race is not finished and refused while anything is still on the triage
list.

**2. The marshal screen is the one surface on this platform that needs JavaScript**, because an
offline queue in IndexedDB has nothing to degrade to. Its no-script fallback is a sentence,
server-rendered, telling a marshal to *"write each runner's bib and the time they crossed down
on paper"*. **That is the paper backup, and it is the real one** — a phone that cannot run the
screen is not a phone to spend race morning fixing.

---

## Stop conditions

Do not go past [the week before](#phase-1--the-week-before) with any of these true. Each one is
a way to lose a race that cannot be re-run.

| | Why it stops the run |
| --- | --- |
| **Fewer than two people hold `timing-admin`** | [No system is reachable by only one person](../../architecture/principles.md#no-system-is-reachable-by-only-one-person). The break-glass is a second human, and granting a role on race morning needs somebody holding `identity.role.grant` who is awake |
| **A marshal has not opened the capture screen once, online, on the phone they will use** | [Step 1.4](#14--every-marshal-opens-the-screen-once-on-the-phone-they-will-use-). The service worker is what makes the screen survive a reload with no signal, and it is installed by that first visit and by nothing else |
| **The rehearsal's crossings are still on the race** | [Step 1.6](#16--wipe-the-rehearsal-). A rehearsal left in place is a field of invented times that publishes exactly as easily as a real one |
| **It is after the change freeze and something still needs a deploy** | The freeze is **from about 25 October** — [race day](../phases.md#-race-day--sunday-1-november-2026). Nothing on this page needs a deploy; if something does, it is not this runbook's step |

---

## ⏰ The clocks, and why this race is the one that gets it wrong

**The clocks go back on Sunday 25 October 2026 and Nightingale Nightmare is the following
Sunday, 1 November, starting 11:00.** The whole day therefore runs in **GMT**, one week after
the whole country was in BST.

Nothing on the platform needs help with that: every time is stored UTC and rendered
`Europe/London` through one module, and the ESLint ban on a bare `toLocale*String` covers
`apps/timing` too. **What needs help is the phones.** A marshal's device is where a wrong clock
becomes a wrong time, and the application deliberately keeps a capture exactly as it arrives —
the timing log marks one recorded before the gun with *"Recorded before this race started.
Usually a phone with the wrong clock — the time is kept exactly as it was captured."*

**So step 1.4 says to check automatic time on every phone, and it is not a formality.**

---

## Phase 1 — the week before

### 1.1 — the race exists, and its slug is right 🎛️

⚠️ **This was a stop condition until 14 September 2026 and it is a check now.** The
`timing.events` row for this running arrives by migration —
`20260914160000_timing_nn_2026_event.sql`,
[#288](https://github.com/southville-running-club/src-website/issues/288) — so it is already
there, with its name, its format, its start time and the advertised 10 km on it. **There is
still no create-race screen**, which is why the row came in a reviewed commit:
`/timing/events/` lists races and does not make one, and `timing.create_event()` is behind
`timing.event.manage` and is called by nothing. **A form is owed to Pass the Buck 2026
([#206](https://github.com/southville-running-club/src-website/issues/206)), not to this
race.**

- [ ] Open **`/timing/events/`**. The race is in the list, with its scheduled start
- [ ] Its slug is **`nn-2026`**, exactly. `/nn/2026/results/` resolves to `nn-<year>` and
      nothing else, so a race set up under any other slug publishes to an address the club
      does not serve
- [ ] Open the race and check **Scheduled start** reads **1 November 2026 at 11:00 GMT**
- [ ] The same date and time is what `/nn/2026/` publishes from `race.json`. **The two are
      separate copies of one fact and nothing holds them together** — read both
- [ ] **Distance** reads **10000 m** — the advertised 10 km, and the only place the timing app
      says a distance at all

**Anything on that list reading wrongly is fixable here and needs no deploy**: somebody holding
`timing.event.manage` corrects the name, the start time, the distance and the course notes from
the race's own page, and the migration deliberately never overwrites a correction.

⚠️ **If the row is missing altogether, stop — that is a pull request and therefore a deploy**,
which is the reason this used to be the first stop condition. `import_from_entries()` answers
`no_such_event` without it and every screen below addresses the race by slug, so nothing in
Phase 1 can be done at all.

### 1.2 — who holds what 🎛️

- [ ] At **`/admin/people/`**, check **at least two** named people hold `timing-admin`
- [ ] Every marshal holds `timing-marshal`
- [ ] Somebody who is **not** running the race holds `nn-results` — that is the preview
      before publication, and it is deliberately not carried by `timing-admin`

**`/admin/people/` is on the club's site and needs a staff role.** Neither timing role is
staff, so a timing admin who cannot open it is not broken —
[the access runbook](timing-access.md#who-to-ask) says who to ask.

### 1.3 — the roster 🎛️

- [ ] Open **`/timing/events/nn-2026/marshals/`**
- [ ] Every marshal who will hold a phone is on it, chosen under **Add somebody** and added
      with **Add to this roster**
- [ ] ⚠️ **An admin who is going to stand at the line adds themselves like anybody else.**
      Holding `timing-admin` puts nobody on a roster

**If somebody is not in the picker, they do not hold `timing-marshal` yet** — the page refuses
anybody else outright, saying *"That person cannot record a crossing, so they were not
added."* Grant the role first; the picker is not where a marshal is made.

### 1.4 — every marshal opens the screen once, on the phone they will use 📱

**Theirs to do, online, on the actual phone.** Not the club's spare, not a borrowed tablet.

- [ ] Sign in at **`/account/sign-in/`** on the club's site
- [ ] Open **`/timing/marshal/nn-2026/`** and wait for the line reading **"Saved for use
      without signal — this screen will still open if the page reloads."** Until it says
      that, the screen has not been cached and a reload with no signal strands them
- [ ] Press **Crossed now** once, type a bib on the keypad, press **Confirm bib**, and watch
      the card disappear
- [ ] Check the phone is set to **automatic date and time**
- [ ] Leave the tab open

⚠️ **A 404 here is the roster, not the app.** A marshal holding the role and left off *this*
race's roster gets the site's ordinary not-found page, byte for byte what a missing address
returns — [the access runbook](timing-access.md#-a-granted-marshal-who-is-not-on-the-roster-gets-a-404-and-that-is-not-a-bug)
is the diagnosis, and the fix is step 1.3 and takes fifteen seconds.

⚠️ **Anybody who timed Pass the Buck on the old platform holds a service worker for the old
scope.** The new one is `/timing/`. That is a rehearsal item rather than a checkbox — it is on
[the simulation](https://github.com/southville-running-club/src-website/issues/207).

### 1.5 — the entry list and the bibs 🎛️

- [ ] Open **`/timing/events/nn-2026/registration/`**
- [ ] Press **Import from entries**. For a race entered through the club's own form there is
      no file and no date of birth ever leaves the entry system
- [ ] Check **Entries** and **Runners** against what `/admin/nn/` says is sold
- [ ] Press **Assign bibs**. *"Numbering carries on from the highest number already given out,
      skips anybody who has one, and never renumbers a field"*
- [ ] Re-run the import after any late transfer, cancellation or given place. It never touches
      a number somebody is already wearing

⚠️ **A visually impaired runner and their guide are one entry, and the guide is leg 2.** The
guide is on the start line, wears a bib, and is **in no category and in no prize** —
[ADR-022](../../architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md). The
status page shows *(guide)* beside their name so a volunteer can see it; **nothing published
says which runner is a guide**, because "leg 2 is a guide" says "leg 1 is visually impaired"
about a named person, and that is Article 9 data. Do not put it on a sheet that leaves the
building.

**If the import answers *"This race has no entries in the club's own entry system"***, the
slug does not match a row in `entries.events`. Go back to step 1.1.

### 1.6 — wipe the rehearsal 🎛️

**The last thing before the freeze**, and it is the step that makes a rehearsal safe to have
run at all.

- [ ] Open **`/timing/events/nn-2026/danger-zone/`**
- [ ] Read **What would be removed** and **What would be kept**. Those counts are read from
      the database — they are the blast radius, not a description of one
- [ ] Type the race's slug exactly as the page shows it, in lower case, and press **Wipe this
      race**
- [ ] Check the race's own page afterwards: **Crossings recorded** is 0, **Actually started**
      and **Finished** are both cleared

**What survives is the race, its name, its start time, its marshals and the record of what has
been done to it.** The entry list goes with the crossings, so **step 1.5 is re-run after this,
not before it**.

⚠️ **A published race cannot be wiped**, and the refusal says so: *"This race cannot be wiped,
because its results are published. A published result is the club's permanent record."* That
is the rule arriving on time rather than a fault.

---

## Phase 2 — race morning

### 2.1 — the desk 🎛️

- [ ] On `/timing/events/nn-2026/registration/`, add each walk-in under **Add a walk-in**
- [ ] Press **Assign bibs** again afterwards. It numbers only the new entries
- [ ] A bib written on a physical number that disagrees with the derived one is an
      **override** on that entry's leg, and an override always beats what the number derives

### 2.2 — the phones 📱

- [ ] Each marshal opens **`/timing/marshal/nn-2026/`** while there is still signal
- [ ] Each one confirms the **"Saved for use without signal"** line, again — a phone that was
      cleared since the week before has lost the cache
- [ ] Each one has **paper and a pen**, and knows that is what the fallback sentence means

⚠️ **A session lapses at thirty minutes idle and twelve hours absolute, and the timing app
reads a session but never refreshes one.** The capture screen keeps its own alive by calling
the club's site every five minutes **while the tab is visible and somebody has done something
in the last twenty-five** — a phone face-down in a pocket lapses on purpose. **A marshal
standing at a junction with nothing to do for forty minutes is exactly the case that lapses**,
and the recovery is to sign in again at `/account/sign-in/`. **Nothing captured is lost**: the
queue is on the phone, keyed to the origin rather than to the session, and it drains once they
are let back in.

### 2.3 — the start 🎛️ 🏛️

- [ ] Open **`/timing/events/nn-2026/start/`** on the laptop. It shows a countdown
- [ ] ⚠️ **A clock reaching zero starts nothing.** Pressing **Start the race** is what records
      the moment, and every time in the race is measured from it
- [ ] Press it on the gun
- [ ] The screen answers *"The race has started. Every time in it is measured from the moment
      below, and pressing again will not move it."*

**Two people pressing it is fine and is expected.** The losing press is answered *"This race
had already started, so nothing was changed"* and is shown **the winning time**, so both
devices agree.

**A false start** is **Clear the start**, on the same screen — and it is offered **only while
nobody has been timed yet**. Once one crossing exists the page refuses, because every recorded
time is measured from the start and clearing it would silently re-time all of them.

---

## Phase 3 — during the race

### 3.1 — what a marshal does 📱

**Press first, type second.** The full-width **Crossed now** button records the time the
instant it is pressed; the bib is typed on the keypad afterwards and **Confirm bib** queues it.
At the line the scarce thing is the moment, not the marshal's attention.

**An anomaly flags and never blocks.** If the bib looks wrong — a duplicate, a number nobody
is wearing — the screen says so *before* the marshal commits, and then lets them commit
anyway: *"Confirm it anyway if that is what you saw — somebody will check it afterwards."*
Somebody at a laptop resolves it later. **A marshal never stops to argue with a flag.**

### 3.2 — what the cards mean 📱

**This is the paragraph to read out on the morning.** Four things a card can say, and only the
last one is anybody's problem.

| The card says | It means | Do |
| --- | --- | --- |
| **"Waiting to be sent."** | **Nothing.** It is on the phone and the queue drains itself every thirty seconds and whenever signal returns. On a course with no signal every card reads this and every one of them is safe | Nothing. Keep capturing |
| **"Sending…"** | It is in flight right now | Nothing |
| **"Not sent."** | It did not land this time. Underneath it is the club's own wording for why — usually *"This crossing could not be sent just now — usually no signal. It is saved on this phone and will be sent again automatically."* | Nothing, unless the sentence below it says otherwise |
| **"Not sent."** with ⚠️ **"This crossing has failed too many times to keep trying on its own."** | **Something.** Ten failures. The message says *"Write the bib and the time down, tell whoever is running the race, and press **Retry** if you want to try again"* | **Write it on the paper**, tell race control, press **Retry now** if there is signal |

**Two messages name a fixable cause and are worth recognising:**

- *"You are not on this race's marshal list, so this crossing was not accepted. Ask whoever set
  the race up to add you, then retry — the time is still here."* — step 1.3, fifteen seconds.
- *"This phone is no longer being let in — either you have been signed out, or you have been
  taken off this race's marshal list."* — the two are deliberately indistinguishable at the
  door. Sign in again first; if that does not help, check the roster. **Every crossing on the
  screen survives either way.**

⚠️ **"This phone will not let the club's site save anything"** is the one message that changes
what a marshal does with the phone: the crossings are held only while the page is open. **Do
not reload or close the tab**, tell race control, and hand the phone to somebody who can watch
it — or go to paper.

### 3.3 — handing a phone over 📱

The queue belongs to the **phone**, not to the person. A marshal going off shift hands over the
phone with its tab open, or drains it first on signal and then hands over nothing. **A phone
taken away with cards still on it is the only way a crossing is genuinely lost**, and it is not
something the application can notice.

### 3.4 — what race control watches 🎛️

- [ ] **`/timing/events/nn-2026/anomalies/`** — the triage list. It is a **union of two
      populations**: a capture a marshal's screen flagged, and an **orphan** whose bib matched
      no team. *"Nothing here is wrong by itself — an anomaly is a question."*
- [ ] **`/timing/events/nn-2026/crossings/`** — every capture, searchable by bib or team number
- [ ] The race's own page carries **Crossings recorded** and **Anomalies needing a human**

**Resolving one is three buttons**: **Mark valid**, **Save corrected bib**, **Discard**. A
discard is reversible — it is *"still on the timing log below if it needs restoring"*, and
**Restore this capture** is on the log. A corrected bib that still matches nothing stays an
orphan and the page says so.

⚠️ **Two people on the triage list at once is the normal case, and the loser is told.** *"Somebody
else resolved this one first, so nothing was changed. Their decision stands."* Nothing is
silently overwritten; nothing needs coordinating beyond reading the message.

---

## Phase 4 — after the last runner

**In this order.** Publication is refused until the first two are done, which is the application
making that much of the order rather than this page; 4.3 is not a gate and is here because a
status changes what the table says and the table is about to be read.

### 4.1 — finish the race 🏛️

- [ ] **`/timing/events/nn-2026/finish/`** → **Finish this race**
- [ ] ⚠️ **Tell the marshals it is a label.** Captures still land, and a late one still
      belongs. **It can be undone** — *"This race is not finished after all"* is on the same
      screen

### 4.2 — clear the triage list 🎛️

- [ ] **`/timing/events/nn-2026/anomalies/`** until it reads **"Nothing is waiting to be
      resolved on this race."**
- [ ] Every orphan too, not only the flagged ones. **Publication counts both**

### 4.3 — DNS, DNF and DQ 🏛️

- [ ] **`/timing/events/nn-2026/status/`**, searching by bib, team number or name
- [ ] **Did not start**, **Did not finish**, **Disqualify** — and **Lift** for any of them
- [ ] ⚠️ **A status is a label on top of the crossings and never a change to one.** A runner
      who did not finish **keeps** the handover time a marshal recorded; they simply have no
      finishing time. Both the setting *and* the lifting are recorded

### 4.4 — read the preview 🎛️

- [ ] **`/timing/events/nn-2026/results/`**. **State** reads *Finished, not published*, and
      **Open captures** reads 0
- [ ] **`/timing/events/nn-2026/prizes/`** is the same results read a second way, in the order
      they are read out. **Not here — pass to the next** takes that team out of **every** prize
      below; a spot prize is **Draw <name>**; **Start again** puts every pass-over back. ⚠️
      **Every choice made on that screen lives in the address bar**, so it survives a refresh
      mid-ceremony and does **not** survive navigating away and coming back
- [ ] Somebody holding **`nn-results`** opens **`/nn/2026/results/`** on the club's site and
      reads the same table. It says *"These results are not published… this page is visible
      only to people the club has given permission to read them"*

**The preview is the only moment the data is checked by somebody who is not the person who
captured it**, which is the whole reason it and publication are two permissions.

### 4.5 — publish 🏛️

- [ ] **`/timing/events/nn-2026/results/`** → **Publish these results**
- [ ] ⚠️ *"Publishing puts this table on the **open internet**, readable by anybody signed in
      or not."* This is the irreversible-feeling step, and it is in fact reversible — see
      [phase 5](#phase-5--a-correction-after-publication)
- [ ] The page answers *"These results are published. Anybody can read them now, signed in or
      not, at the race's results page."*

**Then check it signed out.** Not in the same browser — a private window, or a phone.

- [ ] **`/nn/2026/results/`** opens with no session at all
- [ ] The preview sentence is gone
- [ ] **`/nn/` and `/nn/2026/` now carry a Results link.** Both ship it hidden and publication
      is the only thing that reveals it, because a link to a 404 is a claim about a record

**Two refusals, and both are the rule rather than a fault:**

| The page says | Do |
| --- | --- |
| *"This race has not been marked finished, so its results cannot be published yet. Finishing and publishing are two separate decisions."* | [4.1](#41--finish-the-race-) |
| *"These results were not published, because captures on this race are still to be resolved."* | [4.2](#42--clear-the-triage-list-) — the count on the page is the live one |

**A published page carries no exact age**, only a name, a category and a time. That is
withheld by publication rather than by permission, so every reader gets the same answer —
[ADR-043](../../architecture/decisions/adr-043-a-published-result-carries-a-name-a-category-and-a-time.md).

---

## Phase 5 — a correction after publication

⚠️ **It is unpublish, fix, publish, and the public address answers 404 in between. Do it in
one sitting, at a laptop, with the correction already known.**

1. **`/timing/events/nn-2026/results/`** → **Unpublish these results**. The page answers *"The
   public results page has gone back to not found, which is the honest state for a table being
   corrected."*
2. Make the correction — the timing log for a bib, the status page for a DNF, the entry list
   for a name.
3. **Publish these results** again, and check `/nn/2026/results/` signed out a second time.

**Between 1 and 3 the club is publishing nothing**, and somebody who had the link gets a
not-found page. That is deliberate — the alternative is serving a table somebody is editing —
and it is why this is one sitting rather than a job for the evening.

**Unpublishing is what the danger zone asks for too.** A published race refuses to be wiped
outright, and nothing about that changes until somebody with `timing.result.publish` takes the
results down first.

---

## Phase 6 — the next morning

### 6.1 — the files 🎛️

- [ ] **`/timing/events/nn-2026/results/`** → **Results as a spreadsheet**, or **Results as
      CSV**. ⚠️ *"A spreadsheet keeps a bib of `0311` as `0311`; a CSV opened in Excel becomes
      `311`"* — use the spreadsheet if the numbers matter
- [ ] **`/timing/events/nn-2026/prizes/`** exports the same way, **carrying every pass-over
      made on the screen**, so the file cannot disagree with what was read out

Both are behind `timing.result.publish`, which is the same permission that put the table on the
internet — [`lib/access.ts`](../../../platform/apps/timing/lib/access.ts) carries the argument
for why that is not a nineteenth permission.

### 6.2 — what ARC actually wants 🎛️

**ARC's figure is an entries question, not a timing one.** Under Rule 21(2)(b) what the club
owes a levy on is how many entries took the **unaffiliated** price — so the file is
**Download the affiliated list** on **`/admin/nn/`**, behind `nn.entry.export`, and it needs
`nn-admin` rather than a timing role.
[The admin runbook](entries-admin.md) is where that lives, including what each export does and
does not carry.

### 6.3 — the prize list 🏛️

**Whoever read the prizes out has it, and there is no second copy on the platform** unless
somebody exported one in [6.1](#61--the-files-). The prize screen re-derives its awards from the
crossings every time it is opened, and every pass-over and spot draw is carried in the **address**
rather than stored — so the list read out yesterday exists only in that tab's URL and in whatever
file somebody downloaded. **Export the prize file before leaving the field** if the list has to
survive.

### 6.4 — write down what actually happened

Per [the runbooks README](README.md#writing-and-using-one): **update this page if reality
differed from it.** A race is timed once a year, so the next person to read this has forgotten
everything and the only correction that will ever be made is the one made now.

---

## When somebody says it is not working

The first row that matches is the answer. Every ❌ under `/timing` is **the same ordinary
404** — [the access runbook's table](timing-access.md#what-each-role-can-and-cannot-open) is
what tells a missing role from a missing roster row.

| What is reported | Almost always |
| --- | --- |
| "The marshal page says Not found" | Not on **this race's** roster — step 1.3. The role alone is not enough |
| "It signed me out" | Thirty minutes idle. Sign in at `/account/sign-in/`; the queue survives |
| "My cards are not going" | Nothing, if they read **"Waiting to be sent."** Something only at the retry cap |
| "The screen is blank / says to use paper" | JavaScript is off on that phone. Use the paper; do not spend race morning on it |
| "The publish button refused me" | Not finished, or the triage list is not empty. The page says which |
| "The results page 404s for the public" | Not published, or published and then unpublished for a correction — [phase 5](#phase-5--a-correction-after-publication) |
| "The times are all an hour out" | A phone's clock, not the platform's. The timing log marks a capture recorded before the gun |
| "Every page says the database could not be reached" | An outage, and **never a refusal** — every screen here words the two differently on purpose. Nothing was changed by anything that said this |

---

## What this runbook deliberately does not carry

**Getting in.** Signing up, being granted a role and being put on a roster are
[the access runbook](timing-access.md)'s, and duplicating them here is how the two drift apart.

**The old application's ten screenshots.** `kayleigh-race-night.md` in `src-race-timing`
pictures a different application on a different origin, with admin-created passwords and a
results page that ends at a CSV. Copying them would document controls that do not exist here.

**Pictures at all, for now — and the script that makes them is committed and works.** It was
run for the first time on 14 September 2026: seven tests green, **nineteen PNGs written**, from
`01-every-race.png` to `19-published-to-the-public.png`, about 2.3MB in all. **They are not
committed**, for the reason in the paragraph below rather than because anything went wrong, and
`docs/delivery/runbooks/images/timing-race-night/` is where they land when anybody re-runs it.

⚠️ **Run it through `./dev e2e` from the repository root, not `npx playwright test`** — a scoped
Playwright run needs the three Supabase variables `./dev` exports, and without them the fixtures
throw `supabaseKey is required` from a file the failing test never mentions:

```sh
./dev e2e --config=playwright.config.screenshots.ts
```

[`timing-race-night.screens.ts`](../../../platform/apps/main/tests/e2e/timing-race-night.screens.ts)
drives the real application under Playwright against the suite's own fabricated races and writes
a PNG per screen;
[`playwright.config.screenshots.ts`](../../../platform/playwright.config.screenshots.ts) is what
runs it, and it is deliberately outside the ordinary suite so a screenshot run can never be part
of a gate.
**Every screenshot in it therefore comes from fixtures and never from production** — which is
the rule that matters, because these screens carry named runners, and a picture of a real start
list is a disclosure that cannot be taken back.

**This page names every control in bold instead, and that is now a choice rather than a wait.**
A label quoted from the code goes stale loudly, in a diff, when the label changes; a picture goes
stale silently, which is exactly what went wrong with the ten screenshots this runbook replaces.
So the images stay out of the repository until somebody wants them, and the script is there to
produce them on demand. **If they do get added, they are an addition to the prose and never a
replacement for it** — and whoever adds them should expect to re-run the script on every change
to a screen, because nothing checks a picture.

**Anything about the leaderboard.** It is staff-only in 2026 and the public sees nothing about
a running race —
[ADR-038](../../architecture/decisions/adr-038-the-leaderboard-is-staff-only-in-2026.md).
