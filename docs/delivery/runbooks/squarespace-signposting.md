# Signposting between the two sites

Until the cutover the club has two websites, and each one has to admit the other exists.
This runbook is **the Squarespace half** — a persistent link in the site header pointing at
Nightingale Nightmare, and a `/nn` address on the old domain that forwards to it.

The other half is code and already shipped: every page of `apps/main` opens with a banner
saying the site is unfinished and linking back to `southvillerunningclub.co.uk`. See
[`apps/main`'s README](../../../platform/apps/main/README.md#the-banner).

> **There is no API for any of this.** Squarespace's public APIs are Commerce, Profiles,
> Forms and Webhooks. **Pages, navigation and URL mappings are dashboard-only**, which is
> why this is a runbook and not a script — the shape
> [ADR-005](../../architecture/decisions/adr-005-manual-with-a-reviewable-artefact.md)
> expects for work that happens once.

**Stages 1 and 2 were done on 13 August 2026** and verified end to end; see the record at
the foot of this page. What is left is stage 3, which is optional, and the open question
after it.

---

## Before you start

- You need **administrator or website-editor** access to the Squarespace site.
- Check `https://new.southvillerunningclub.co.uk/nn/` loads first. Signposting a broken
  page is worse than not signposting one.
- **Stop condition — do not invent race facts.** The button says where the page is, not
  what the race is. The date, price and distance are unconfirmed and are a
  [stop-and-ask](../../architecture/principles.md) trigger. "Nightingale Nightmare" is the
  whole of the permitted copy.

---

## Stage 1 — a button in the site header

Chosen over a navigation item because it reads as a call to action rather than as one more
page, and over the announcement bar because **the announcement bar can be dismissed and
does not come back** (see stage 3).

1. **Pages** panel → **Edit** in the top-left of the site preview.
2. Hover over the header → **Edit site header** → **Add elements** → switch **Button** on.
3. Click the button → **Edit design** → under **Content**:
   - **Text:** `Nightingale Nightmare`
   - **Link:** `https://new.southvillerunningclub.co.uk/nn/`
   - Leave "open in new tab" **off**. It is the club's own site, and a forced new tab takes
     the back button away from somebody on a phone — which is 70% of visitors.
4. **Save**, then load the live site in a private window — not the editor — and click it.

**Done when:** the button is on every page of the old site and lands on `/nn/`.

> **Trailing slash.** `/nn` works and redirects, but it costs an extra round trip. Link to
> `/nn/`.

---

## Stage 2 — `southvillerunningclub.co.uk/nn` forwards

So the club has an address that can be said out loud, printed on a flyer, or pasted into
Facebook without explaining a subdomain.

1. **Settings → Developer tools → URL mappings.**
2. Add these two lines. **Mappings are applied top to bottom**, so order matters when two
   could match; these two cannot, but keep them together anyway.

   ```
   /nn -> https://new.southvillerunningclub.co.uk/nn/ 302
   /timing -> https://new.southvillerunningclub.co.uk/timing 302
   ```

3. Save, then open both in a private window — one that has never seen either address.

> **The trailing slashes are not a typo, and they differ on purpose.** `/nn/` is canonical
> **with** the slash and `/timing` **without** it, because `apps/main` is Astro with
> `trailingSlash: 'always'` and `apps/timing` is Next.js, which defaults to the opposite.
> Point either mapping at the wrong form and it still works — via an extra redirect that
> every visitor pays for and nobody sees. Confirm with `curl -I` rather than trusting this
> paragraph to stay true; if a framework default changes, this is where it will bite.

**302 rather than 301, deliberately.** A 301 is cached hard by browsers, and undoing one
means reaching people whose browser will never ask again. Nothing here is permanent — at
the cutover the old site goes and the mapping with it. Revisit only if the club decides
this is the address forever.

**The failure that looks like nothing happening:** a URL mapping only fires when no page
already occupies that path. Both `/nn` and `/timing` were free when
[the site was inventoried](../../reference/existing-site.md) and again when these were
added — but confirm it rather than assume, and remember this if somebody later creates a
page at one of them and the redirect silently stops working.

**Done when:** both old addresses forward, in a browser that has never seen them before.

---

## Stage 3 — the announcement bar, only if the committee wants it

Louder than the header button: a full-width bar above everything, on every page.

**Settings → Announcement Bar** (on mobile: **More → Marketing → Announcement Bar**).
Enable it, write the text, and either link a word inside it or set a **Clickthrough URL**
of `https://new.southvillerunningclub.co.uk/nn/` to make the whole bar clickable.

**Know this before choosing it.** A visitor can close the bar, and **it does not come back
for them** — the only way to show it again to everyone who dismissed it is to edit the bar
and save. So it is a push, not a signpost, and it does not replace stage 1.

Whether the club wants something that loud on a site that still sells memberships is a
committee decision, not a technical one.

---

## One open question, deliberately not answered here

**A nav item for the timing app, as well as the forwarder.** The `/timing` mapping exists
so the address can be given to somebody who needs it. A menu entry is a different claim —
it says *this is ready for you* — and the timing application is unbuilt until
[the port](../../architecture/decisions/adr-008-timing-port-before-the-race.md). `/timing`
now says so itself, in as many words. Add the nav entry when it has results on it, not
before.

**Nothing about Nightingale Nightmare itself.** The nav item says the race's name and
nothing else, because the date, the price and the distance are unconfirmed and are a
[stop-and-ask](../../architecture/principles.md). When the committee confirms them, the
copy is theirs to write.

## Reversing any of it

Each stage undoes independently and immediately: switch the header **Button** element off,
delete either line from URL mappings, disable the announcement bar. Nothing here changes
DNS, and nothing here touches the live site's content or its commerce.

The 302s are what make this cheap to undo. A 301 would sit in browser caches long after
the line was deleted.

---

## Record of execution

Fill this in when you run it — [what makes the manual exceptions legitimate rather than
merely convenient](../../../CLAUDE.md).

| Stage | Done by | When | Notes |
| --- | --- | --- | --- |
| 1 — header button | Mark Chesser | 13 August 2026 | Live in the desktop nav, the mobile nav and the header button |
| 2 — `/nn` URL mapping | Mark Chesser | 13 August 2026 | 302, as specified |
| 2 — `/timing` URL mapping | Mark Chesser | 13 August 2026 | 302. Added after the `/nn` one. **No trailing slash** — see the note in stage 2 |
| 3 — announcement bar | — | — | Not done. Skipped unless the committee asks |

Verified from the command line the same day. **Two hops each, and the second is the
mapping** — the first belongs to Squarespace and is not ours to remove:

```
http://southvillerunningclub.co.uk/nn
  301 → https://www.southvillerunningclub.co.uk/nn      Squarespace's own http→https and apex→www
  302 → https://new.southvillerunningclub.co.uk/nn/     the mapping
  200                                                   the race page

https://southvillerunningclub.co.uk/timing
  301 → https://www.southvillerunningclub.co.uk/timing  the same Squarespace normalisation
  302 → https://new.southvillerunningclub.co.uk/timing  the mapping — note: no trailing slash
  200                                                   the timing app, reaching the database
```

> **That last line is a record of 13 August 2026 and is no longer how you would check it.**
> `/timing` reported its own database connection on the page back then; it is a holding page
> now, and the two round trips answer at `/timing/health` instead. The hops above are
> unchanged — only what the final `200` contains. Re-verify reachability with
> `curl -sS https://new.southvillerunningclub.co.uk/timing/health`.

**A third hop is the failure to watch for.** It means a mapping is pointing at the
non-canonical form of its target and every visitor is paying for the correction. Reproduce
the check with:

```bash
curl -sS -D - -o /dev/null -L https://southvillerunningclub.co.uk/timing
```

Both paths also work with a trailing slash — `/nn/` and `/timing/` — because Squarespace
normalises before the mapping runs, so one line each is enough. Capitals do not: `/NN`
404s, since mappings are case-sensitive. Not worth a line unless somebody reports it.

The served timing page was checked for more than a 200: `data-health` and
`data-pipeline-check` both read `ok`, so the Worker behind the redirect reaches the
database rather than merely answering.
