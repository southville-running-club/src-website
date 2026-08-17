import { createAnonClient, deleteExpiredMedicalNotes } from '@src/shared';

/**
 * Deleting the medical notes on time — the promise `/nn/privacy/` publishes.
 *
 * Section 4 of the published notice says, in the club's own words, that anything written in the
 * medical box is *"deleted — separately from, and sooner than, the rest of your entry"*, and
 * section 6 puts a period on it. **Nothing in this platform did that** until this module.
 *
 * ## Why it is its own file rather than part of the admin surface
 *
 * It arrived alongside `/nn/admin` and it is not an admin surface concern: nobody presses
 * anything, no key is involved, and it must keep running whether or not the admin key is
 * installed. Putting it in `nn-admin.ts` would have coupled a **legal retention obligation** to
 * a Worker secret somebody may not have set — and made "the admin surface is switched off" mean
 * "the club has stopped keeping a promise it published".
 *
 * ## Why it rides on the entry cron
 *
 * A second Cron Trigger is a second thing to configure, to get wrong, and to not notice has
 * stopped. This runs every five minutes beside the hold sweep and deletes something on a handful
 * of days a year; on every other run the query matches nothing and this logs nothing at all.
 *
 * **It is called after the hold sweep and independently of it.** `worker/index.ts` is written so
 * that a failure in either still leaves the other having run — an early `return` there once meant
 * a failed hold sweep would have taken this down with it, silently, for as long as the first call
 * kept failing.
 *
 * ## What is logged
 *
 * A count, and nothing else. These are the rows the whole retention rule is about; the only
 * things worth writing down are that a deletion happened and how much of it there was.
 */

export interface MedicalRetentionEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

export async function sweepExpiredMedicalNotes(env: MedicalRetentionEnv): Promise<void> {
  const result = await deleteExpiredMedicalNotes(
    createAnonClient({
      url: env.PUBLIC_SUPABASE_URL,
      anonKey: env.PUBLIC_SUPABASE_ANON_KEY,
    }),
  );

  if (!result.ok) {
    console.error(`entries.delete_expired_medical_notes failed — ${result.error}`);
    return;
  }

  // **Silent on the ordinary run.** This fires 288 times a day and deletes something on a
  // handful of them; a line each way would spend the free-tier observability allowance on
  // nothing. `console.warn` rather than the casual one, which the lint rule bans outright.
  if (result.deleted > 0) {
    console.warn(
      `entries.delete_expired_medical_notes deleted ${result.deleted} medical note(s) ` +
        `across ${result.events} event(s), per the published retention period`,
    );
  }
}
