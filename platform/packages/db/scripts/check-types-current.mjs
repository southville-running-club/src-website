#!/usr/bin/env node
/**
 * Fails if `src/database.types.ts` is stale — that is, if regenerating it from the local
 * database would produce something different from what is committed.
 *
 * This gate is in from day one deliberately. It is cheap to add now and annoying to
 * retrofit, and the failure it prevents is a quiet one: types that describe a schema the
 * database no longer has, so `strict: true` cheerfully approves code that cannot work.
 *
 * Requires the local stack: `npm run db:start`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const committedPath = join(packageRoot, 'src', 'database.types.ts');

let committed;
try {
  committed = readFileSync(committedPath, 'utf8');
} catch {
  console.error(
    `Missing ${committedPath}.\nRun: npm run db:types --workspace=packages/db`,
  );
  process.exit(1);
}

let generated;
try {
  generated = execFileSync(
    'npx',
    [
      'supabase',
      'gen',
      'types',
      'typescript',
      '--local',
      '--schema',
      'club,intake,entries,identity',
    ],
    { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
} catch {
  console.error(
    'Could not generate types. Is the local stack running? Try: npm run db:start',
  );
  process.exit(1);
}

if (committed.trim() !== generated.trim()) {
  console.error(
    'database.types.ts is stale — the schema has moved on without it.\n' +
      'Run: npm run db:types --workspace=packages/db',
  );
  process.exit(1);
}

console.log('database.types.ts is current.');
