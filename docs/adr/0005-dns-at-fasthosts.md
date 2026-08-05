# ADR-0005 — DNS stays at Fasthosts

- **Status:** Accepted
- **Date:** 2026-08-05
- **Owner:** Platform volunteer

## Context

`southvillerunningclub.co.uk` is registered with **Fasthosts**, and its DNS records
currently point at Squarespace. Launching the new site means repointing those records at
our own hosting.

Two changes are possible: moving the registration to another registrar, or leaving it
where it is and changing the records. Moving a registrar during a site migration means
two things can break at once, and a `.co.uk` transfer has its own timing and
authorisation steps.

There is also a dependency the other way: Resend requires a **verified sending domain**
for the club's transactional email, which means DNS records the club controls.

## Decision

**The domain stays registered at Fasthosts.** Only the records change, repointing from
Squarespace to our hosting when the new site is ready.

Before cutover:

- Confirm who holds the Fasthosts account credentials, and put them somewhere more than
  one person can reach ([R1](../risks.md#r1--key-person-dependency)).
- Confirm whether the domain is registered independently or bundled with Squarespace
  ([Q4](../open-questions.md)).
- Lower the TTL well in advance so a rollback propagates quickly.
- Have redirects in place from every existing Squarespace URL, verified before the
  switch ([R10](../risks.md#r10--website-launch-and-dns-cutover-delivery-risk)).
- Keep the Squarespace subscription live until the new site is proven — and in any case
  until the member fund has moved and the treasurer has confirmed it
  ([P13](../principles.md#p13--governance-gates-come-before-the-code-they-enable)).
- Cut over outside any race window.

Records are documented in this repository — what they are, what they point at, and why.
Fasthosts' console is not a place where undocumented state accumulates
([P1](../principles.md#p1--everything-is-code-nothing-is-clicked)).

## Consequences

- One change at a time. The migration risk is the records, not the registration.
- The rollback is a record change back to Squarespace, which is why the low TTL matters.
- DNS remains a manual, console-driven step. This is a knowing exception to P1,
  mitigated by documenting the records in the repository; automating it later via the
  registrar or a DNS provider's API is a possible improvement.
- The email-domain verification records for Resend slot into the same DNS work.

## Revisit if

Fasthosts' DNS management proves limiting, the club wants DNS managed by code through
the hosting provider, or the registration turns out to be bundled with Squarespace and
must move before cancellation.
