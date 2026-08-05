# Documentation

Everything that explains why this repository is the way it is.

## Read in this order

1. **[Mission and goals](mission-and-goals.md)** — what the club is buying and what
   "done" looks like.
2. **[Foundational principles](principles.md)** — the fourteen rules everything here is
   held to. If you read one document, read this one.
3. **[Plan of attack](plan-of-attack.md)** — what happens next, in what order, and the
   five places it corrects the proposal.
4. **[Architecture](architecture.md)** — one database, several services, several front
   doors.
5. **[Delivery and environments](delivery-and-environments.md)** — the four environments
   and the pipeline that is the only way to production.
6. **[Testing strategy](testing-strategy.md)** — what runs, what blocks a merge, and the
   manual gate automation cannot replace.
7. **[Roadmap](roadmap.md)** — the five workstreams as scope. The plan of attack orders
   them.

## Reference

- **[Risk register](risks.md)** — what could go wrong, worst first.
- **[Open questions](open-questions.md)** — decisions the club still owes, with owners
  and what each one blocks.
- **[Glossary](glossary.md)** — domain vocabulary, so code and conversation match.
- **[Decision records](adr/)** — why each significant choice was made.
- **[Timing app review](reference/timing-app-review.md)** — how the live timing app is
  built, what it stores, and what a port must not break.
- **[Platform proposal v8](reference/platform-proposal-v8.md)** — the July 2026 board
  proposal, transcribed. The source of nearly everything here.

## Conventions

- **The proposal is a snapshot, not a spec.** Where it and the working documents
  disagree, the working documents win.
- **Documentation changes in the same pull request as the code it describes**
  ([P12](principles.md#p12--documentation-is-part-of-done)).
- **Decisions become ADRs.** Open questions live in
  [open-questions.md](open-questions.md) until answered, then move to an ADR or the
  relevant document and are struck through with a link.
- **Say what is unknown.** Every document here marks proposed things as proposed. A
  guess stated confidently is worse than a gap stated plainly.

## Still to be written

These arrive with the code they describe:

- **Runbook** — race-day operations for the race director, deployment, rollback, incident
  response, and credential rotation. Called for explicitly in the proposal as a
  key-person-risk mitigation.
- **Data model** — schema, ownership boundaries, retention policy.
- **Content model** — what is database-driven versus static, and who changes what.
- **Privacy notice and retention policy** — prerequisites for
  [Workstream 5](roadmap.md#workstream-5--race-entries-on-our-own-site).
