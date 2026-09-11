/**
 * The row shapes the timing logic reads, declared structurally.
 *
 * ## Why these are not the generated types
 *
 * The modules copied under
 * [ADR-034](../../../../../docs/architecture/decisions/adr-034-the-timing-platform-is-rewritten-on-cloudflare.md)
 * arrived reading `Tables<"events">`, `Tables<"teams">` and `Tables<"crossings">` from
 * `src-race-timing`'s generated Supabase types. **There is nothing to generate from here
 * yet** — [ADR-035](../../../../../docs/architecture/decisions/adr-035-the-timing-schema-joins-this-project.md)
 * writes the `timing` schema rather than moving it, so the tables land later in this
 * programme than the logic that reads them.
 *
 * So the shapes are declared here instead, naming only the columns the logic actually reads.
 * `bib.ts` already did this for `BibTeam`, before there was a second consumer to justify a
 * shared file.
 *
 * ## And they stay after the schema lands
 *
 * This is not scaffolding to be deleted. A pure function that names the six columns it reads
 * is testable without a database and says what it depends on; one taking a whole generated row
 * says only *"something from the teams table"*, and a column rename somewhere else then looks
 * like it might matter here.
 *
 * ⚠️ **What the schema owes these is assignability, and that is worth asserting when it
 * exists** — a type-level test that a generated `timing.crossings` row satisfies
 * `TimingCrossing`. Until then these are a statement of intent, and a column named differently
 * in the migration would compile fine and fail at runtime.
 *
 * Every one is a `Pick`-shaped minimum rather than a closed shape: a caller passing a fuller
 * row is accepted, which is what lets a page join a runner's name onto a team and still hand
 * it to `buildResults`.
 */

/** What the split derivation needs to know about a running. */
export type TimingEvent = {
  /** `'relay' | 'solo'` — carried since the timing app's first migration. */
  format: 'relay' | 'solo';
  /** The scheduled start. */
  start_at: string;
  /** Set when the countdown screen broadcasts T-0; beats `start_at` when present. */
  actually_started_at: string | null;
};

/** The unit of entry — a relay pair or a single solo runner. */
export type TimingTeam = {
  team_number: string | null;
  bib_leg1: string | null;
  bib_leg2: string | null;
  category: string | null;
  /** `'dns' | 'dnf' | 'dq'`, or null for a team with no terminal label. */
  race_status: string | null;
  /** Frozen legacy column, honoured only as a fallback when `race_status` is null. */
  dnf_at: string | null;
};

/** One crossing of the line. */
export type TimingCrossing = {
  /** Nullable: the queue captures the time first and the bib second. */
  bib: string | null;
  captured_at: string;
  anomaly_flag: boolean | null;
  resolved_at: string | null;
  resolved_action: string | null;
};
