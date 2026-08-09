import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findViolations } from '../../scripts/check-migration-scope.mjs';

/**
 * `scripts/check-migration-scope.mjs` is the backstop that makes real a claim the decision
 * log makes about migrations being "scoped `--schema club,intake`" —
 * see that script's own header for why the claim needed one.
 *
 * This file has two jobs. First, prove the regex actually distinguishes the schema
 * `public` from the built-in `PUBLIC` role — that distinction is the whole reason a naive
 * `grep public` would have been the wrong tool, and it is the thing most likely to rot
 * silently if ever "simplified". Second, run it against every migration actually
 * committed, so a violation is caught here in milliseconds rather than only in CI.
 */

describe('what counts as touching public or private', () => {
  it.each([
    ['drop schema public cascade;'],
    ['create table public.foo (id int);'],
    ['grant usage on schema private to anon;'],
    ['alter schema public owner to postgres;'],
    ['select * from private.helper();'],
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
    // This repository's own schemas.
    ['create table intake.foo (id int);'],
    ['create table club.members (id int);'],
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

  it.each(files)('%s does not touch public or private', (file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    expect(findViolations(sql)).toEqual([]);
  });
});
