# Architecture

How the platform is put together, one dimension per document.

[Platform options](../solutions/platform-options.md) chose the vendors. These choose the
**shape of the thing built on them** — and that is a different question, with different
trade-offs, which is why it gets its own folder rather than a section.

**Everything here is TypeScript**, per
[convergence](../foundations/requirements.md#convergence) and the
[language case in platform options](../solutions/platform-options.md#language-and-framework).
That is assumed throughout rather than re-argued.

| | |
| --- | --- |
| [**Repositories**](repositories.md) | How many, what each owns, and how shared code reaches both. **Open — five candidates** |
| [**Networking**](networking.md) | Hostnames, zones, TLS, routing, and which of them exist per environment |
| [**Database**](database.md) | One project or many, schema ownership, RLS, migrations, backups |
| [**Deployment**](deployment.md) | How a commit becomes production on Cloudflare and on Supabase |
| [**Local development and testing**](local-development.md) | Running the whole platform on a laptop, and validating it **without the club domain** |

Open questions across all five are tracked in
[#1](https://github.com/southville-running-club/src-website/issues/1).

---

## What changed when this was researched

Four things in the existing documentation turned out to be wrong or out of date. They are
corrected in the deep dives and listed here because two of them move money.

### Cloudflare now says use Workers, not Pages, for new projects

> *"If you are starting a new project, use Workers instead of Pages. Pages continues to
> work, but new features and optimizations are focused on Workers."*
> — [Cloudflare's own migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

The [build brief](../delivery/nn-build-brief.md) chose Pages, correctly, because **Workers
custom domains need an active Cloudflare zone** and the club's zone is still at Fasthosts.
That reasoning holds for Nightingale Nightmare v1. But it means the club is starting on
the path Cloudflare is moving away from, and the main website build should not.

**This strengthens the case for [moving the DNS first](../delivery/dns-first.md)** — see
[deployment](deployment.md#pages-or-workers).

### The live leaderboard may not need Workers Paid at all

[Platform options](../solutions/platform-options.md#why-cloudflare-is-free-and-when-it-stops-being)
prices [C6](../foundations/requirements.md#c6--show-live-race-progress-to-spectators) by
**polling** — 300 spectators once a second for 90 minutes is 1.6 M requests, 16× the daily
free allowance, so £47/yr.

That measures the wrong architecture. With **hibernatable WebSockets on a Durable Object**:

- **SQLite-backed Durable Objects are available on the Workers Free plan**
- **Outgoing WebSocket messages are not billed at all** — the broadcast to 300 spectators
  is free
- Incoming messages bill at **20:1**, so 400 marshal crossings is 20 billable requests
- Hibernation means no duration billing while idle

A whole race night comes to roughly **300 connection requests plus 20 message requests**,
against 100,000 a day. **The polling figure was never a Cloudflare limit — it was a design
choice.**

This does not make the £47 wrong to budget; it makes it insurance rather than a
requirement. See [database](database.md#c6-and-the-200-connection-ceiling) for what it
means for keeping Supabase free too.

### Two verification items came back positive

**Cloudflare Pages supports monorepos** — root directory plus build watch paths, so one
repository can serve several projects that build independently. Was
[A1](../solutions/platform-options.md); now confirmed, and it removes an argument against
the monorepo shapes.

**The Supabase CLI scopes to named schemas** — `supabase db diff --schema club,intake`.
Was A2, the load-bearing assumption behind two repositories sharing one database; now
confirmed. See [database](database.md#migrations).

### Supabase branching is Pro-only, so preview databases are not free

A database per pull request would have been the obvious mirror of Cloudflare's preview
deployments. **It requires the Pro plan**, so the answer is a full local stack instead —
which is better anyway, and is what [local development](local-development.md) is about.

---

## What is decided, and what is not

| | Status |
| --- | --- |
| Vendors — Cloudflare, Supabase, Fasthosts, Stripe | **Decided**, [decision log](../decisions/decision-log.md) 001–004 |
| TypeScript throughout | **Decided** in substance, never written as a record |
| One Supabase project, separated by schema | **Proposed** — [database](database.md) |
| Repository shape | **Open** — [repositories](repositories.md), five candidates, criteria conflict |
| Workers or Pages for the main website | **Open**, and time-sensitive — [deployment](deployment.md) |
| Local stack and test strategy | **Proposed** — [local development](local-development.md) |

**Nothing here is a decision record.** When one of these settles it goes in the
[decision log](../decisions/decision-log.md) in the usual shape, with an exit cost and a
revisit condition.
