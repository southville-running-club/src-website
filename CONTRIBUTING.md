# Contributing

This repository is maintained by club volunteers. The conventions below exist to keep it
maintainable by someone who did not write it — that is the whole point
([R1](docs/risks.md#r1--key-person-dependency)).

Read [the principles](docs/principles.md) first. They are the standard everything here is
held to.

## Before you start

- **Is there an open question blocking it?** Check
  [open questions](docs/open-questions.md). Building past a blocked decision usually
  means building it twice.
- **Does it need a decision record?** Anything introducing a framework, language, hosting
  dependency or infrastructure primitive, changing a data model boundary, or expensive to
  reverse, needs an [ADR](docs/adr/) — [P6](docs/principles.md#p6--boring-by-default).
- **Is there a change freeze?** Nothing in the shared platform deploys from 72 hours
  before a race until results are signed off
  ([P7](docs/principles.md#p7--race-day-is-safety-critical-the-website-is-not)).
- **Does it touch payments or personal data?** Check the governance gates in
  [P13](docs/principles.md#p13--governance-gates-come-before-the-code-they-enable). They
  are hard gates agreed at the QGM, not sequencing preferences.

## Workflow

1. Branch from `main`: `type/short-description` — e.g. `feat/results-archive`,
   `docs/testing-strategy`, `fix/timezone-clocks-change`.
2. Commit in the conventional style: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
   `chore:`, `ci:`. The subject line says what changed and why, not which files moved.
3. Open a pull request. Fill in the template honestly, including what you did **not**
   test.
4. The full suite runs and must pass. There is no skip.
5. Get a review. Squash merge.
6. The pipeline deploys. Nobody deploys by hand
   ([P4](docs/principles.md#p4--deployment-is-a-pipeline-never-a-person)).

`main` is protected and always deployable. This applies to administrators too.

## Definition of done

A change is done when all of these are true:

- [ ] It does what the issue or pull request says it does.
- [ ] Tests cover it, including at least one awkward case, and they run against the
      containerised database where a database is involved.
- [ ] Accessibility holds: semantic HTML, keyboard navigable, contrast sufficient,
      WCAG 2.2 AA ([P11](docs/principles.md#p11--built-for-a-phone-in-a-field-on-bad-signal)).
- [ ] It works on a phone on a slow connection.
- [ ] No personal data in logs, URLs, analytics or error reports
      ([P8](docs/principles.md#p8--personal-data-is-a-liability-not-an-asset)).
- [ ] No secrets in the repository
      ([P9](docs/principles.md#p9--secrets-never-enter-the-repository)).
- [ ] Migrations are expand–migrate–contract and the previous release still runs against
      the new schema ([P10](docs/principles.md#p10--every-change-is-reversible)).
- [ ] Documentation updated in the same pull request
      ([P12](docs/principles.md#p12--documentation-is-part-of-done)).
- [ ] An ADR exists if the change warranted one.
- [ ] For timing-path changes: the race-simulation checklist is completed, recorded in
      the pull request, and signed off by the race director.

## Local development

Not yet available — the scaffold is blocked on
[ADR-0002](docs/adr/0002-hosting-platform.md) and
[ADR-0006](docs/adr/0006-repository-shape.md).

The target, once it exists
([ADR-0009](docs/adr/0009-containerised-environments.md)):

```bash
git clone <repo> && cd src-website
cp .env.example .env.local
docker compose up
```

Clone to working site with a populated results archive, in under ten minutes, on a
machine with Docker and a Node toolchain and nothing else. If it takes longer, that is a
bug in the setup — please raise it.

## Reviewing

Review for the principles, not for style — formatting is the linter's job.

The questions worth asking:

- Could this write to a timing table? Could it affect race day?
- Does it collect personal data it does not need?
- Is there a simpler version, or a version that deletes something instead?
- Would the next volunteer understand why this exists in six months?
- What happens when the external service it depends on is down?
- Does it still work at a full race field's data volume?

## Writing documentation

Plain English. Short sentences. State what is unknown as unknown, and mark proposed
things as proposed — a confident guess is worse than an honest gap.

Cross-link rather than repeat: a fact stated in two places will be wrong in one of them
within a year.
