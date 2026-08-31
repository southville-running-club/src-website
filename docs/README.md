# Documentation index

**If this index and [`CLAUDE.md`](../CLAUDE.md) at the repository root disagree, CLAUDE.md
wins.** CLAUDE.md is the more frequently updated of the two and is what an agent working
here is told to trust first.

This directory mixes two kinds of document, and telling them apart matters: **live**
documents describe the platform as it stands and are meant to be kept current; **historical**
documents are point-in-time records — a proposal, a plan, a pull-request body, an
investigation that led to a decision — kept for the reasoning they carry rather than updated
as the world moves. A historical document that looks live is the single biggest hazard in
this tree; most now carry a banner saying which they are, but treat any undated,
present-tense claim with suspicion regardless.

## Where to start

| For | Read |
| --- | --- |
| **Current state of the build** | [`CLAUDE.md`](../CLAUDE.md) (repo root), then [`delivery/phases.md`](delivery/phases.md) |
| **Why a technical choice was made** | [`architecture/decisions/`](architecture/decisions/) — the ADR index |
| **Why a committee-level choice was made** | [`decisions/decision-log.md`](decisions/decision-log.md) |
| **What a word means** | [`foundations/glossary.md`](foundations/glossary.md) |
| **How to do a manual, rarely-done procedure** | [`delivery/runbooks/`](delivery/runbooks/) |
| **The rules that govern how this repo is worked in** | [`architecture/principles.md`](architecture/principles.md) |

## `architecture/` — live, with historical working underneath

`principles.md` is live and is the mandated first read for anyone writing code.
`decisions/` is a live index over ADRs, which are individually frozen once accepted (never
edited to change their answer — a new one supersedes instead). `investigations/` holds the
working that produced a decision — each is historical, banner-marked with which ADR settled
it; only `investigations/email-addressing.md` is meant to stay live.

## `decisions/` — live

`decision-log.md`, the committee-level record. Append-only in spirit: a record is amended
with a dated note rather than rewritten.

## `delivery/` — mixed, and this is where most of the historical documents live

`phases.md` and `runbooks/` are live and are kept current. `plan.md` and `overview.md` are
working documents, refreshed rather than frozen. Everything else in this directory —
`priorities.md`, `dns-first.md`, `nn-first-delivery.md`, `nn-build-brief.md`, the
`nn-2026-privacy-notice-DRAFT.md`, and `pull-requests/` — is historical, each written before
or during a specific piece of work and banner-marked as superseded where the world has since
moved past it.

## `design/` — a live index over frozen mockups

`design/README.md` explains what each mockup was for and, critically, which of its numbers
turned out to be real facts and which are still demo data — read that before copying
anything out of a `.html` mockup file.

## `foundations/` — the "before" picture, mostly historical

`glossary.md` is live and normative — the words here are the words the rest of the
documentation and the schema are expected to use. `current-state.md`, `target-state.md`,
`problem-statement.md` and `requirements.md` are the case originally made for building this
platform at all, each now banner-marked as a baseline rather than a current description.
`brand.md` and the race-timing brand guidelines are live for what shipped;
`race-timing-brand-guidelines.md` is an *imported* document from another repository and is
not this repository's source of truth for its own tokens — `tokens.css` is.

## `reference/` — historical, and clearly marked

Point-in-time records of things read from elsewhere: the board proposal, the existing
Squarespace site as crawled, the timing app as reviewed, the WAF rules considered (only one
of which — `C1` — is actually live; the file says so plainly).

## `solutions/` — historical vendor and design analysis

Each names candidates and reasoning as of when it was written; several are now banner-marked
superseded because the committee has since chosen. `dns-and-domain.md` and
`cloudflare-vs-netlify.md` carry the house pattern for this — a dated banner explaining what
changed and pointing at what to read instead.
