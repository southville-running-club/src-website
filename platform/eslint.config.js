import js from '@eslint/js';
import ts from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';

/**
 * Rendering a UTC instant through the machine's own timezone. The original guard, and the
 * one that made `packages/shared/src/london-time.ts` the only module allowed to convert.
 */
const AMBIENT_TIMEZONE = {
  selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
  message:
    'Use formatLondon() from @src/shared. A bare toLocale*String takes the ambient timezone, which is the bug — see docs/architecture/principles.md',
};

/**
 * ⚠️ **The opposite error, which the rule above cannot see** —
 * [#298](https://github.com/southville-running-club/src-website/issues/298).
 *
 * `new Date().toISOString().slice(0, 10)` reads as "today" and means "today in UTC", so
 * between midnight and 01:00 London on a British Summer Time morning it names *yesterday*.
 * It is not a `toLocale*String` call, so nothing objected — and `account.ts`'s date-of-birth
 * validator told a member that today's date was in the future for one hour a day, for seven
 * months of the year, for as long as that page has existed.
 *
 * ## Why this shape and not `new Date().toISOString()`
 *
 * **The defect is an instant becoming a *civil date*, not `toISOString()` being called.**
 * There are three bare `new Date().toISOString()` calls in this repository — a crossing's
 * capture time, a board's "updated at", and a `people.updated_at` — and **all three are
 * correct**: a storage instant has no zone and wants none. Banning them would mean three
 * exceptions and would teach the next person that this rule is something to work around.
 * Truncating one to `YYYY-MM-DD` is the thing that silently picks a zone, and after #298
 * there is not one live instance of it outside a test.
 *
 * ## Why tests are exempt
 *
 * Deliberate UTC arithmetic is what a timezone test is made of. `event-format.test.ts` walks
 * a year of UTC midnights to assert the London day never shifts, and `identity.test.ts`
 * reads a Postgres `date` column back — which arrives as a `Date` at UTC midnight, so
 * truncating it is the correct read. Both would have to be allowlisted, and the rule guards
 * production code, where the defect was. `AMBIENT_TIMEZONE` still applies everywhere.
 */
const INSTANT_TRUNCATED_TO_A_DATE = {
  selector:
    "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.callee.property.name='toISOString']",
  message:
    'Truncating an ISO instant to a date picks UTC silently. Use londonCivilDate() from @src/shared — see #298 and docs/architecture/principles.md',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.open-next/**',
      '**/.wrangler/**',
      '**/.astro/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // Scratch space the Supabase CLI writes on `supabase start`. It contains the
      // vendor's own bundled source, which is not ours to lint.
      '**/supabase/.temp/**',
      // Generated. `npm run db:types` rewrites it, so edits here are silently undone.
      'packages/db/src/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...astro.configs.recommended,
  prettier,
  {
    rules: {
      // The service role key must never reach a client bundle, and no personal data goes
      // into logs. Both are principles, not preferences — see docs/architecture/principles.md
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Timezone conversion goes through packages/shared/src/london-time.ts, never through
      // an ambient toLocaleTimeString. An hour of drift is a real foot-gun and Nightingale
      // Nightmare sits the weekend after the clocks change. The timing app's own
      // lib/london-time.ts exists for exactly this reason.
      'no-restricted-syntax': ['error', AMBIENT_TIMEZONE, INSTANT_TRUNCATED_TO_A_DATE],

      // A leading underscore means "this parameter exists because the signature says so".
      //
      // The default `after-used` already tolerated `_controller` — an unused parameter before
      // a used one is not reported — so the convention was in the code and not in this file,
      // and it broke the first time a *trailing* one appeared: `scheduled(controller, env,
      // ctx)` is the runtime's shape and this Worker uses none of the third. Declaring the
      // parameter is what makes the handler's type honest, and the name is what says it is
      // unused on purpose rather than by accident.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],
    },
  },
  {
    // The one module allowed to do the conversion, because it is the one that pins the zone.
    files: ['packages/shared/src/london-time.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    /**
     * Tests may do UTC arithmetic on purpose, and several have to — see
     * `INSTANT_TRUNCATED_TO_A_DATE` above for the two that do.
     *
     * **Composed rather than restated.** `no-restricted-syntax` is all-or-nothing per config
     * entry, so narrowing it means listing the selectors that survive — and a restated closed
     * list is a merge conflict git cannot see, which this repository has already paid for in
     * three migrations. The constants are the list; this names one of them.
     */
    files: ['**/tests/**/*.{ts,tsx,js,mjs}', '**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', AMBIENT_TIMEZONE] },
  },
  {
    // Command-line scripts talk to a terminal. Printing is what they are for.
    //
    // These are plain `.mjs` rather than TypeScript, so the Node globals have to be
    // declared — `@types/node` is what supplies them everywhere else.
    files: ['**/scripts/**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        crypto: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  {
    /**
     * The `/timing` service worker — [#203](https://github.com/southville-running-club/src-website/issues/203).
     *
     * ⚠️ **It is plain JavaScript in `public/` on purpose and cannot become anything else.** A
     * service worker is registered by name, so it may not be bundled and given a build hash;
     * `apps/timing/public/sw.js` is served at `/timing/sw.js`, which is what gives it the
     * `/timing/` scope with no `Service-Worker-Allowed` header.
     *
     * So the globals have to be declared here rather than by a `tsconfig` — and `/* eslint-env
     * serviceworker *\/` is not the answer either: that syntax was removed in ESLint 9, which
     * is what the first version of this file was told, by name.
     */
    files: ['apps/timing/public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
];
