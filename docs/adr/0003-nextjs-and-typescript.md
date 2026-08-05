# ADR-0003 — Next.js and TypeScript

- **Status:** Accepted
- **Date:** 2026-08-05
- **Owner:** Platform volunteer

## Context

The timing app — the part of the platform already proven in production — is a Next.js
application written in TypeScript. The website is intended to be another front door onto
the same platform, ideally sharing types, data-access code and conventions.

The alternative would be choosing a different stack for the website: a static site
generator, or another framework better suited to a mostly-content site.

## Decision

The website is built with **Next.js and TypeScript**, matching the timing app.

TypeScript runs in strict mode. Type errors block the pipeline.

## Consequences

- One stack to learn, one set of conventions, one dependency tree to keep current —
  directly serving [P6](../principles.md#p6--boring-by-default) and mitigating
  [R1](../risks.md#r1--key-person-dependency).
- Database types and shared domain logic can be shared rather than reimplemented, so
  the website's idea of a "result" cannot drift from the timing app's.
- Ties the hosting decision to Next.js support, which is precisely the tension in
  [ADR-0002](0002-hosting-platform.md). Accepted knowingly.
- Heavier than a static site generator for a mostly-content site. Mitigated by rendering
  statically wherever possible ([P11](../principles.md#p11--built-for-a-phone-in-a-field-on-bad-signal)).
- Strict typing costs a little friction and buys a class of bug never reaching a race
  morning.

## Revisit if

The website turns out to share nothing meaningful with the timing app, or Next.js's
hosting constraints become the deciding cost in ADR-0002.
