import { defineConfig } from 'vitest/config';

// TZ is pinned to UTC for the same reason the timing app pins it: the suite would
// otherwise pass or fail depending on the machine's own timezone, and Nightingale
// Nightmare sits the weekend after the clocks change. See docs/architecture/principles.md.
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/tests/unit/**/*.test.ts',
            'apps/*/tests/unit/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          // Needs the local Supabase stack: `npm run db:start`.
          include: ['packages/db/tests/**/*.test.ts'],
          environment: 'node',
          /**
           * **One file at a time, because there is one database.**
           *
           * Most of what these files assert is scoped to an invented address or an invented
           * event slug, and those are safe to run concurrently. Several assertions are not
           * scopeable at all, because they are claims about the *whole* database: that
           * `identity.roles` holds exactly five rows, that `anon` may execute exactly thirteen
           * functions, and — the one that actually bit — that `delete_me()` refuses somebody
           * who is **the last** super-admin.
           *
           * That last one reads `not exists (… others.role = 'super-admin' …)` across the
           * table, so any other file holding a super-admin at the same moment makes it answer
           * `ok: true` and the test fails. `entries-admin.test.ts`'s header states the
           * workaround this replaces — *"exactly one test file may hold a super-admin, and it
           * is `identity.test.ts`"* — and `identity-permissions.test.ts` has been breaking that
           * rule since #107 without anything going red, because the two files happened to
           * finish in an order that hid it. Adding one fixture person to that file was enough
           * to change the order.
           *
           * **A rule that only holds by luck of scheduling is not a rule.** Running the files
           * sequentially costs a few seconds and makes the property real: no other file is
           * alive while `identity.test.ts` makes its claim. The `unit` project is untouched —
           * it shares no state and parallelises correctly.
           */
          fileParallelism: false,
        },
      },
    ],
  },
});
