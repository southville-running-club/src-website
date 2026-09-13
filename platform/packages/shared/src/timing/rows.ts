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
  id: string;
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

/**
 * One participant. Leg 1 or leg 2 of a relay pair, or the single runner of a solo entry.
 *
 * ⚠️ **`age_on_day` is here and a date of birth is not, and that is the whole design.** The
 * registration parser drops date of birth, address, phone, emergency contact and medical
 * information *at the boundary* and computes the age against the race date — so the database
 * never holds them. That is
 * [C10](../../../../../docs/foundations/requirements.md#c10--hold-personal-data-lawfully), and
 * it is the same sentence as *personal data is minimised at the boundary*.
 *
 * It is also, conveniently, exactly what `ageCategoryFor(age, category)` in
 * [`age-category.ts`](../age-category.ts) asks for — so the club's prize bands read the
 * minimised column directly rather than needing the thing that was deliberately thrown away.
 */
export type TimingRunner = {
  id: string;
  /** 1 or 2. A solo entry has leg 1 only. */
  leg: number;
  /**
   * `entries`' vocabulary — `'female'`, `'male'`, `'non_binary'` — since
   * [ADR-039](../../../../../docs/architecture/decisions/adr-039-the-roster-crosses-from-entries-to-timing-in-the-database.md).
   *
   * ⚠️ **Read it through `normaliseTimingGender()` in `gender.ts` and never by comparing
   * strings here.** Rows written before that decision spell it `'M'` / `'F'`, and Pass the
   * Buck's archive is a whole race of them; that file carries the expand-migrate-contract
   * argument for why reading still accepts both and writing does not.
   */
  gender: string;
  /**
   * [ADR-031](../../../../../docs/architecture/decisions/adr-031-a-non-binary-entrant-says-where-to-be-placed.md)'s
   * answer, carried across by `import_from_entries()`. Null for everybody else, and null for a
   * roster that arrived by CSV — which has no such question on it.
   */
  result_placement: 'female' | 'male' | null;
  /**
   * `'runner'` or `'guide'` — [ADR-022](../../../../../docs/architecture/decisions/adr-022-a-guide-rides-on-the-runners-entry.md).
   *
   * A guide runs the course and takes one of the 250, so they get a bib and appear on the
   * start line; they are in **no category and no prize**. `awards.ts` excludes them.
   */
  role: string;
  /** Computed against the race date at import, never stored as a birth date. */
  age_on_day: number | null;
  /**
   * Carried for display rather than for computation, and named here for that reason alone.
   *
   * `awards.ts` never reads these - it hands the whole runner row back, and the prize-giving
   * screen prints the name of whoever won. Leaving them out would make the winner an id, and
   * force every caller to join the name back on for the one thing an award is *for*.
   */
  firstname: string;
  lastname: string;
};
