import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findViolations } from '../../scripts/check-migration-scope.mjs';

/**
 * `scripts/check-migration-scope.mjs` is the backstop that makes real a claim the decision
 * log makes about migrations being "scoped `--schema club,intake`" —
 * see that script's own header for why the claim needed one, and for why the reason it
 * exists changed under ADR-035 while the guard itself stayed.
 *
 * This file has three jobs. First, prove the regex actually distinguishes the schema
 * `public` from the built-in `PUBLIC` role — that distinction is the whole reason a naive
 * `grep public` would have been the wrong tool, and it is the thing most likely to rot
 * silently if ever "simplified". Second, **pin the narrowing**: `private` was dropped from
 * the list by ADR-035 and is deliberately no longer flagged, which without a test reads
 * exactly like an oversight to the next person who greps for it. Third, run it against
 * every migration actually committed, so a violation is caught here in milliseconds rather
 * than only in CI.
 */

describe('what counts as writing into public', () => {
  it.each([
    ['drop schema public cascade;'],
    ['create table public.foo (id int);'],
    ['alter schema public owner to postgres;'],
    ['grant usage on schema public to anon;'],
  ])('flags %s', (sql) => {
    expect(findViolations(sql)).not.toEqual([]);
  });

  it.each([
    // The PUBLIC pseudo-role, not the public schema — this migration set uses this
    // exact shape correctly and often.
    ['revoke all on schema club from public;'],
    [
      'alter default privileges in schema intake revoke execute on functions from public;',
    ],
    ['revoke all on function intake.health() from public;'],
    // Prose, not SQL — stripped as a line comment before matching.
    ['-- Nothing here touches `public` or `private`.'],
    // A real schema name that merely contains "public" as a substring.
    ['select * from graphql_public.something;'],
    // This repository's own schemas — all six of them.
    ['create table intake.foo (id int);'],
    ['create table club.members (id int);'],
    ['create table entries.foo (id int);'],
    ['create table identity.foo (id int);'],
    ['create table store.foo (id int);'],
    ['create table timing.crossings (id uuid);'],
  ])('does not flag %s', (sql) => {
    expect(findViolations(sql)).toEqual([]);
  });
});

/**
 * ADR-035 narrowed this guard from two schemas to one, and a narrowing that nothing
 * asserts is indistinguishable from a regex somebody broke. These cases fail if `private`
 * is ever quietly put back without the record that removed it being revisited — and,
 * more usefully, they say in the test file itself that the absence is a decision.
 *
 * The old rule protected the timing platform's tables, which lived in `public` and
 * `private` in a different project. ADR-035 wrote the timing tables into `timing` **here**,
 * and this project creates no `private` schema at all — so a migration naming it would
 * fail on apply rather than quietly succeed. Reaching into the *old* project is still a
 * stop-and-ask in `CLAUDE.md`; it is simply not something a migration file here can do.
 */
describe('private, which ADR-035 deliberately stopped guarding', () => {
  it.each([
    ['select * from private.helper();'],
    ['grant usage on schema private to anon;'],
    ['drop schema private cascade;'],
  ])('does not flag %s', (sql) => {
    expect(findViolations(sql)).toEqual([]);
  });
});

describe('every migration actually committed', () => {
  const migrationsDir = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));

  it('is a non-empty set — otherwise this test proves nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s does not write into public', (file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    expect(findViolations(sql)).toEqual([]);
  });
});
