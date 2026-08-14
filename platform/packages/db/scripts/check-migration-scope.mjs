#!/usr/bin/env node
/**
 * Fails if a migration in this repository proposes a change to the `public` or `private`
 * schemas — the ones the timing platform owns.
 *
 * ## Why this exists
 *
 * `docs/decisions/decision-log.md` and this migration set's own header comment both say
 * that migrations are "scoped `--schema club,intake`", and reason from that scoping as a
 * safety property: this repository "cannot propose dropping the timing app's tables".
 *
 * **That was true of `db:diff`, which generates a migration, and false of `db push`, which
 * applies one.** `--schema` narrows what `supabase db diff` writes when a migration is
 * authored against a local database; it has no effect on `supabase db push --linked`
 * (`deploy-db.yml`), which applies whatever SQL is committed under `supabase/migrations/`,
 * unscoped. A migration file that happened to contain `drop schema public cascade` would
 * be applied exactly like any other statement.
 *
 * With no `environment:` gate available on a private repository on the free plan (see the
 * decision log) and no branch protection, the migration files themselves are the only
 * remaining backstop — so this makes the claimed property real rather than assumed.
 *
 * ## What it does and does not catch
 *
 * It looks for **schema-qualified references** (`public.foo`, `private.foo`) and
 * **schema-targeting DDL** (`schema public`, `schema private`) in migration SQL, with line
 * comments stripped first so prose mentioning the words does not trigger it.
 *
 * It deliberately does **not** flag `... from public` / `... to public` — that is a grant
 * or revoke naming the built-in `PUBLIC` pseudo-role (everyone), not the schema, and this
 * migration set uses it correctly and often:
 *
 *   revoke all on schema club from public;
 *
 * A false positive here would train whoever hits it to stop reading the message, which
 * defeats the point of a narrow guard.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OWNED_SCHEMAS = ['public', 'private'];

// Schema-qualified reference: `public.` or `private.` immediately followed by an
// identifier character, e.g. `public.races`. Word-boundary on the left means
// `graphql_public.` is never mistaken for `public.` — `_` and `p` are both word
// characters, so no boundary exists between them.
const QUALIFIED_REF = new RegExp(`\\b(${OWNED_SCHEMAS.join('|')})\\.`, 'gi');

// DDL or grants that name the schema itself: `schema public`, `schema private`. This is
// what catches `create schema public`, `drop schema public cascade`, and
// `grant usage on schema public to ...` — none of which this repository may ever propose.
const SCHEMA_TARGET = new RegExp(`\\bschema\\s+(${OWNED_SCHEMAS.join('|')})\\b`, 'gi');

function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

/**
 * Exported so `tests/unit/migration-scope.test.ts` exercises the exact regexes this CLI
 * enforces, rather than a copy that could quietly drift from them.
 */
export function findViolations(sql) {
  const stripped = stripLineComments(sql);
  const found = new Set();

  for (const match of stripped.matchAll(QUALIFIED_REF)) found.add(match[0]);
  for (const match of stripped.matchAll(SCHEMA_TARGET)) found.add(match[0].trim());

  return [...found];
}

// Guarded so importing this module for its `findViolations` export — the test does —
// does not also run the CLI and exit the test process.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const migrationsDir = join(packageRoot, 'supabase', 'migrations');

  let files;
  try {
    files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  } catch (cause) {
    console.error(`Could not read ${migrationsDir}: ${cause.message}`);
    process.exit(1);
  }

  let failed = false;

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const violations = findViolations(sql);

    if (violations.length > 0) {
      failed = true;
      console.error(`${file} touches a schema this repository does not own:`);
      for (const v of violations) console.error(`  ${v}`);
    }
  }

  if (failed) {
    console.error(
      '\nThis repository owns club, intake and entries only. public and private belong to ' +
        'the ' +
        'timing platform and are migrated from src-race-timing — see ' +
        'docs/architecture/decisions/adr-002-schema-layout.md. If this is deliberate ' +
        '(the timing platform port, ADR-008), that is a decision for a pull request that ' +
        'says so, not a migration that reaches across the boundary quietly.',
    );
    process.exit(1);
  }

  console.log(`${files.length} migration(s) checked. None touch public or private.`);
}
