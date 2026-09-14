# The timing app — the boundary, before anything else

**This app is being written here, and the platform it replaces is not.** Both halves matter,
and getting them the wrong way round costs in opposite directions.

- **Ordinary work, needing no permission this file does not already give:** `apps/timing`
  itself, the `timing` schema's tables and functions, and the ported logic in
  `packages/shared/src/timing/`. Under
  [ADR-034](../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
  the platform is **rewritten in this repository** rather than moved, and
  [ADR-035](../../../docs/architecture/decisions/adr-035-the-timing-schema-joins-this-project.md)
  puts the new tables in a `timing` schema — **not `public`, and there is no `private` schema
  here.**

- ⚠️ **Stop and ask:** any change touching the **old** timing platform — the
  `bindalshah/src-race-timing` repository, or the `public` and `private` schemas it owns. It
  is still running on Vercel until [#208](https://github.com/southville-running-club/src-website/issues/208)
  decommissions it, reading from a Supabase project this repository does not manage. Reading
  the old code as a specification is what ADR-034 asks for; reaching into its repository or
  its schemas is not. Say what you have found and wait.

**⚠️ This boundary was the other way round until ADR-034.** Every change to the timing platform
used to be a stop-and-ask, and a session working from a stale note will refuse work that is now
ordinary. If this file and the root [`CLAUDE.md`](../../../CLAUDE.md) ever disagree, the root
wins — read its **How the timing app behaves** section before changing anything here, along
with [ADR-036](../../../docs/architecture/decisions/adr-036-timing-staff-are-identity-permissions.md),
which is why a page here checks a *permission* and never a role name, and why the marshal
roster is a scope checked after it.

@AGENTS.md
