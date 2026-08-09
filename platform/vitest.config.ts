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
        },
      },
    ],
  },
});
