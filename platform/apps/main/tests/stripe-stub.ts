import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/**
 * Starting and stopping the fake Stripe, for the Vitest runs that need one.
 *
 * `platform/scripts/stripe-stub.mjs` is the same process Playwright and `./dev` start. It
 * has to be a real process rather than a mocked `fetch`, because these tests run **inside
 * `workerd`** and the thing under test is the Worker's own outbound request — a mock in the
 * test's isolate would be testing the mock.
 *
 * ## It reuses whatever is already listening
 *
 * `./dev up` leaves a stub on the same port. Spawning a second one would fail to bind and
 * then be waited on forever, so this checks first and only starts one if nothing answers —
 * the same arrangement as Playwright's `reuseExistingServer`, and for the same reason.
 *
 * `pg` cannot run inside `workerd` and neither can `child_process`; both of these are called
 * from Vitest's `globalSetup`, which runs in the ordinary Node process before the pool
 * starts.
 */

const STUB_ORIGIN = 'http://127.0.0.1:8789';
const HEALTH = `${STUB_ORIGIN}/__stub/health`;

async function isListening(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Null when something was already listening, so `stopStripeStub` knows to leave it alone. */
export async function startStripeStub(): Promise<ChildProcess | null> {
  if (await isListening()) {
    return null;
  }

  const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'stripe-stub.mjs');
  const child = spawn(process.execPath, [script], { stdio: 'ignore' });

  // Fifty attempts at 100ms is five seconds, which is generous for a Node process that does
  // nothing but listen. Failing loudly beats a suite that hangs on a server nobody started.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isListening()) {
      return child;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  child.kill();
  throw new Error(`The Stripe stub did not come up on ${STUB_ORIGIN}`);
}

export async function stopStripeStub(child: ChildProcess | null): Promise<void> {
  if (child === null || child.killed) {
    return;
  }

  child.kill();
}
