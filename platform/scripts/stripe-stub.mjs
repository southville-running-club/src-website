#!/usr/bin/env node
/**
 * A fake Stripe, for the local site and the acceptance suite.
 *
 * ## Why this exists
 *
 * The entry form's whole chain — validate, hold a place, price it from the fees table,
 * create a Checkout session, redirect — cannot be exercised end to end without a Stripe
 * account, and this repository has no Stripe credentials in it and never will. So `npm run
 * preview` points `STRIPE_API_BASE` at this process, which answers one route with a canned
 * session, and everything up to the redirect is real: a real POST, a real database
 * transaction, a real row, a real 303.
 *
 * ## What it deliberately does not do
 *
 * **It is not a Stripe simulator and must not become one.** It answers
 * `POST /v1/checkout/sessions` and nothing else, and the acceptance suite asserts *where*
 * the Worker redirects rather than following it — a test that types into Stripe's hosted
 * page is a test that breaks when Stripe redesigns it. What is worth asserting about the
 * request itself is asserted against `checkoutSessionParams` in
 * `apps/main/tests/unit/stripe.test.ts`, which needs no network at all.
 *
 * ## Why it checks the Authorization header
 *
 * So that "the Worker forgot to send the key" fails here rather than passing quietly. It
 * checks the *shape* and never the value: there is no real key on either side of this.
 *
 * The port is fixed at 8789, alongside 8787 for the website and 8788 for timing. `./dev`
 * starts and stops it with the two Workers; Playwright starts its own.
 */
import { createServer } from 'node:http';
// Imported rather than taken from the global, because `eslint.config.js` declares the Node
// globals these scripts may use one by one and `Buffer` is deliberately not on that list —
// the explicit import is cheaper than widening the allowance for everything in `scripts/`.
import { Buffer } from 'node:buffer';

const PORT = Number(process.env.STRIPE_STUB_PORT ?? 8789);

/**
 * A session id shaped like Stripe's, and a URL on Stripe's own host.
 *
 * The host is what the acceptance suite asserts, so it has to be the real one — the point of
 * the assertion is that the Worker sends somebody to Stripe and not somewhere else.
 *
 * Deterministic from a counter rather than random: this repository's fixtures are
 * deterministic and invented, and a random id would make a failing assertion unreproducible.
 */
let created = 0;

function session() {
  created += 1;
  const id = `cs_test_stub${String(created).padStart(6, '0')}`;

  return {
    id,
    object: 'checkout.session',
    url: `https://checkout.stripe.com/c/pay/${id}`,
    status: 'open',
    payment_status: 'unpaid',
  };
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

const server = createServer((request, response) => {
  // Health, so a supervisor can wait for this the same way it waits for the two Workers.
  if (request.method === 'GET' && request.url === '/__stub/health') {
    return json(response, 200, { ok: true, created });
  }

  if (request.method !== 'POST' || request.url !== '/v1/checkout/sessions') {
    return json(response, 404, {
      error: { type: 'invalid_request_error', code: 'resource_missing' },
    });
  }

  const authorization = request.headers.authorization ?? '';
  if (!/^Bearer \S+/.test(authorization)) {
    return json(response, 401, {
      error: { type: 'invalid_request_error', code: 'authentication_required' },
    });
  }

  // The body is read and thrown away. **It carries an email address**, so it is never
  // logged, never echoed and never written to a file — the same rule the Worker follows.
  request.resume();
  request.on('end', () => json(response, 200, session()));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stripe stub listening on http://127.0.0.1:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
