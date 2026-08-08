/**
 * Generated types for the schemas this repository owns.
 *
 * `database.types.ts` is generated, not written — `npm run db:types` regenerates it from
 * the local database, and CI fails if what is committed no longer matches. Editing it by
 * hand will be silently undone.
 *
 * Only `club` and `intake` are generated. `public` and `private` belong to the timing
 * platform and are typed in `src-race-timing`, so nothing here can drift from them.
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
