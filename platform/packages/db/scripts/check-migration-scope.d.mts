/**
 * Hand-written because the script it describes is plain `.mjs` and `allowJs` is off
 * repository-wide — see `tsconfig.base.json`. This is the one export the test needs;
 * `strict: true` still checks every caller against it.
 */
export declare function findViolations(sql: string): string[];
