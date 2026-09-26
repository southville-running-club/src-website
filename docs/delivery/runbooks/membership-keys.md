# The membership keys

**Two Worker secrets, and the form cannot take an application until both are installed.**
`MEMBERSHIP_ENTRY_KEY` and `MEMBERSHIP_WEBHOOK_KEY` —
[ADR-050](../../architecture/decisions/adr-050-the-club-takes-an-application-and-tells-two-people.md).

Both digests ship **null**, which refuses everything. That is the safe direction rather than a
fault: until this runbook is done, `/membership/join/` validates a submission and then reports
that the club could not record it, and nothing is stored.

---

## Why there are keys at all

The platform has **no API tier**. The browser and the Worker both talk straight to Postgres, so
one key has to be public — `PUBLIC_SUPABASE_ANON_KEY`, in `apps/main/wrangler.jsonc`, **in this
public repository**, with a comment saying it is safe to expose. Row-level security is what
enforces access, not the key.

That works while the database refuses to do anything interesting with it. **It stops working
for a form whose whole job is to let a signed-out stranger cause something to happen.**
`membership.submit_application()` must be granted to `anon`, so the database cannot tell the
club's Worker from a script: same role, same public credential, same request.

⚠️ **What it protects is the club's email reputation, not the application data.** Every accepted
call sends two emails and **one goes to an address the caller chose**. Without the key, a loop
makes the club email strangers from its own verified domain, and drains Resend's 100 a day —
which is **account-wide and shared with the race**, so runners silently stop getting entry
confirmations.

⚠️ **Cloudflare cannot help.** A call straight to Supabase never touches it — different origin.
That is exactly how 249 of 250 race places went in half a second
([ADR-029](../../architecture/decisions/adr-029-holding-a-place-takes-a-key.md)), and the reason
this key is here from the start rather than four days after.

To see it for yourself, from any machine:

```bash
curl -s -X POST "https://ketipxpyjjglwpqazsft.supabase.co/rest/v1/rpc/submit_application" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Profile: membership" -H "Content-Type: application/json" \
  -d '{"p_key":"","p_application":{"membershipType":"club"}}'
```

`{"ok": false, "reason": "unauthorised"}`. That refusal is the whole point, and it writes
nothing.

---

## ⚠️ Order: the webhook key first

Either order works, but this one never leaves a message stuck. Install the **entry** key first
and the form starts taking applications that queue two emails nothing can send yet — they sit
`pending` and go out when the second key lands, which is the outbox behaving correctly and is
still a worse first hour than not doing it.

`RESEND_API_KEY` is already installed — the race emails use it — so nothing else is needed.

---

## Step 1 — mint two keys

32 random bytes each. **They go in the club password store, never in a message or an issue.**

```bash
openssl rand -base64 32
```

Run it twice. The two must be different: one key opening two doors is one rotation closing both.

---

## Step 2 — give them to the Worker

From **`platform/`**. `--config` names which of the two Workers this belongs to; without it the
command depends on where you happen to be standing. Each prompts for the value.

```bash
npx wrangler secret put MEMBERSHIP_WEBHOOK_KEY --env production --config apps/main/wrangler.jsonc
```

```bash
npx wrangler secret put MEMBERSHIP_ENTRY_KEY --env production --config apps/main/wrangler.jsonc
```

**No deploy is needed** — a secret takes effect on the next request. But the Worker must have
deployed since ADR-050 merged, or it does not read these bindings at all. Check that `main` has
deployed.

---

## Step 3 — give the database the digests

**The digest, never the key.** In the Supabase SQL editor, replacing each placeholder with the
matching key from step 1:

```sql
update membership.api_secrets
   set key_sha256 = encode(sha256(convert_to('PASTE-THE-WEBHOOK-KEY', 'UTF8')), 'hex'),
       updated_at = now()
 where name = 'webhook';

update membership.api_secrets
   set key_sha256 = encode(sha256(convert_to('PASTE-THE-ENTRY-KEY', 'UTF8')), 'hex'),
       updated_at = now()
 where name = 'entry';
```

Confirm both landed without printing either digest back:

```sql
select name, key_sha256 is not null as installed, updated_at
  from membership.api_secrets order by name;
```

Both rows must say `true`.

---

## Step 4 — verify, by applying

Fill in `/membership/join/` yourself, with your own address. **The failures look different and
mean different things:**

| What you see | What it means |
| --- | --- |
| *"Your application was not sent, and nothing has been stored"* | Either the Worker has no `MEMBERSHIP_ENTRY_KEY` bound — step 2 did not take — or its value and the database's digest **disagree**, meaning step 3 was run with a different string from step 2 |
| The confirmation page, and **no acknowledgement email** | The entry key is right and the **webhook** key is wrong. The application is stored and safe; the message is queued and will send the moment the digest is fixed |
| The confirmation page **and** two emails | Done |

The two emails are the acknowledgement to you, and the filled form to
`membership@southvillerunningclub.co.uk` — **reply to that one and it reaches the applicant**,
not the club's own inbox.

⚠️ **Delete your test application afterwards.** Nothing in the platform renders one yet, so it
is a row only SQL can reach:

```sql
delete from membership.membership_applications where email = 'your-address@example.com';
```

The outbox rows go with it — `on delete cascade`.

---

## Rotating a key later

The same two commands in the same order — new secret first, digest second. **There is a window
of seconds between them in which applications are refused**, which is the safe direction, and
the form says nothing was stored.

## What is still owed after this

⚠️ **The retention promise.** The form tells an applicant their details are kept "until the
Membership Officer has dealt with it, and for 90 days after that". Nothing marks an application
processed, so the clock never starts and applications are kept indefinitely. `/admin/membership/`
is what makes that promise real, and until it exists the sentence is literally true and
practically false.
