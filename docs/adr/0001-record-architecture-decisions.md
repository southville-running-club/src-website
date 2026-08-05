# ADR-0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-05
- **Owner:** Platform volunteer

## Context

The club's platform is built and maintained by one volunteer. The single largest risk it
carries is that this person becomes unavailable and nobody can pick the system up
([R1](../risks.md#r1--key-person-dependency)).

Decisions with long consequences are being made now — hosting, database, repository
shape, payment processing. Without a record, the reasoning lives in one person's memory
and in a proposal PDF that will go stale. The next volunteer inherits a system full of
choices they cannot distinguish from accidents, and either preserves mistakes out of
caution or undoes good decisions out of ignorance.

## Decision

Significant architectural decisions are recorded as numbered markdown files in
`docs/adr/`, following Michael Nygard's format. Each records the context, the options
weighed, the decision, and the consequences accepted.

Records are immutable once accepted. A changed decision means a new record that
supersedes the old one; the old one stays, with its status updated.

A decision is significant enough to need one if it introduces a framework, language,
hosting dependency or infrastructure primitive; changes a data model boundary; or would
be expensive to reverse.

## Consequences

- Every non-obvious choice in the codebase is traceable to a stated reason.
- Small overhead per decision, paid by whoever makes it.
- Superseded records accumulate. That is the point — the history is the value.
- Pull requests introducing new dependencies or patterns are reviewed against
  [P6](../principles.md#p6--boring-by-default) with an ADR as the artefact.

## Revisit if

Never, realistically. The cost is trivial and the alternative is undocumented
archaeology.
