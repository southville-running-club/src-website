import js from '@eslint/js';
import ts from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';

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
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
          message:
            'Use formatLondon() from @src/shared. A bare toLocale*String takes the ambient timezone, which is the bug — see docs/architecture/principles.md',
        },
      ],
    },
  },
  {
    // The one module allowed to do the conversion, because it is the one that pins the zone.
    files: ['packages/shared/src/london-time.ts'],
    rules: { 'no-restricted-syntax': 'off' },
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
      },
    },
    rules: { 'no-console': 'off' },
  },
];
