#!/usr/bin/env bash
# Start the local Supabase stack for CI: only the services the suites use, and again if the
# registry turns us away. Run detached by `action.yml`, which waits on the status file this
# writes. Run from `platform/packages/db`.
#
# **Why it is a file and not a `run:` block.** The command runs under `nohup bash -c`, so a
# loop with its own quoting would be a quoted string inside a quoted string. A script is
# readable, and `bash -n` can check it.

set -u

LOG=/tmp/supabase-start.log
RC=/tmp/supabase-start.rc

# **The containers no suite touches, so they are never pulled.** Each one is an image fetched
# from ghcr.io on every job, and on 27 October 2026 ghcr.io refused enough of them to fail
# every database job three runs in a row (`toomanyrequests … allowed: 44000/minute`). Checked
# against the tracked source that day, not assumed:
#
#   studio        the browser UI. Nothing in CI opens it.
#   storage-api   no `.storage.from(`, no `storage/v1`, and no migration or seed names the
#   imgproxy      `storage` schema. Race photos live in R2, not Supabase Storage (ADR-062).
#   realtime      no `.channel(` and no `realtime.` or publication in any migration.
#   edge-runtime  there is no `supabase/functions` directory.
#   logflare      the analytics pair. Nothing reads logs from them.
#   vector
#
# **Kept, and why each matters**: postgres; kong, the gateway at :54321 that every client
# goes through; gotrue for auth; postgrest; postgres-meta, which `supabase gen types --local`
# uses in "Generated types are current"; and mailpit, which `account.spec.ts` reads
# confirmation emails from at :54324.
#
# ⚠️ **Adding a test that uses an excluded service fails here first**, with the service
# unreachable rather than with a rate limit. Take its name out of this list in the same
# change. `config.toml` is untouched on purpose: a laptop still starts everything, and
# `[auth]` there is a stop-and-ask.
EXCLUDE=studio,storage-api,imgproxy,realtime,edge-runtime,logflare,vector

# **Three attempts, retried only on a rate limit.** Any other failure is real and is reported
# at once. The limit is per minute, so the waits run past the window rather than retrying
# straight into it. Images an attempt did pull stay in the runner's cache, so each attempt
# pulls fewer than the one before.
#
# **Each attempt has its own log**, so a rate limit on attempt 1 cannot make a different
# failure on attempt 2 look like one. All of them are appended to the log the waiting step
# prints, so the whole history is visible.
ATTEMPT_LOG=/tmp/supabase-start.attempt.log
: > "$LOG"
rc=1

for attempt in 1 2 3; do
  echo "=== supabase start, attempt $attempt (excluding $EXCLUDE)" >> "$LOG"

  npx supabase start -x "$EXCLUDE" > "$ATTEMPT_LOG" 2>&1
  rc=$?
  cat "$ATTEMPT_LOG" >> "$LOG"

  if [ "$rc" -eq 0 ]; then
    break
  fi

  if ! grep -q 'toomanyrequests' "$ATTEMPT_LOG" || [ "$attempt" -eq 3 ]; then
    break
  fi

  # Clear whatever the failed attempt left half started, so the next one starts clean.
  npx supabase stop --no-backup >> "$LOG" 2>&1 || true
  wait_for=$((attempt * 30))
  echo "=== registry rate limit; waiting ${wait_for}s before attempt $((attempt + 1))" >> "$LOG"
  sleep "$wait_for"
done

echo "$rc" > "$RC"
