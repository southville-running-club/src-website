/**
 * Generated types for the schemas this repository owns.
 *
 * `database.types.ts` is generated, not written — `npm run db:types` regenerates it from
 * the local database, and CI fails if what is committed no longer matches. Editing it by
 * hand will be silently undone.
 *
 * ⚠️ **This said "only `club` and `intake` are generated", and that stopped being true.** Six
 * schemas are — `club`, `intake`, `entries`, `identity`, `store` and `timing` — as
 * `db:types`'s own `--schema` flag says. The old sentence also claimed `public` and `private`
 * "belong to the timing platform and are typed in `src-race-timing`"; under
 * [ADR-035](../../../../docs/architecture/decisions/adr-035-the-timing-schema-joins-this-project.md)
 * the timing tables are written **here**, in `timing`, and this project creates no `private`
 * schema at all.
 */
export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from './database.types';

export { Constants } from './database.types';
