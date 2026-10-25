# Runbook — race photos: the bucket, the upload, checking, publishing and sending the links

Where the race photos live, the two hand steps every upload needs, and what the team does
with them on the website afterwards. **About twenty minutes the first time**; after that, a
few minutes per upload, and an evening of checking after a race.

**Who:** the bucket and the token are made by **the Cloudflare account holder**. The upload
and the SQL are run by **whoever is on the tagging laptop**, with the token the account
holder gives them. Checking is **the photo-checkers**, publishing and sending the links **the
photo-admins**, and the roles are granted by somebody who may grant roles. The three sending
keys are made by **the Cloudflare account holder**.

**Prerequisites:** [the Cloudflare runbook](cloudflare-setup.md) is done, the tagging laptop
is set up as in [`tools/photos/README.md`](../../../tools/photos/README.md), and the photos
have been tagged and every camera's clock decided.

Why it works this way is in seven decisions:
[ADR-062](../../architecture/decisions/adr-062-race-photos-live-in-one-private-eu-bucket.md)
(the bucket),
[ADR-063](../../architecture/decisions/adr-063-the-laptop-uploads-with-a-token-revoked-after-each-upload.md)
(the token),
[ADR-064](../../architecture/decisions/adr-064-tags-reach-the-database-as-a-sql-file-run-by-hand.md)
(the SQL file),
[ADR-065](../../architecture/decisions/adr-065-unsure-photos-are-checked-together-on-the-website.md)
(checking together) and
[ADR-066](../../architecture/decisions/adr-066-two-narrow-roles-for-race-photos.md)
(the two roles),
[ADR-068](../../architecture/decisions/adr-068-runners-reach-their-photos-through-a-private-link.md)
(the runners' private links) and
[ADR-069](../../architecture/decisions/adr-069-runners-are-emailed-their-links-a-few-a-day.md)
(emailing them).

---

## Once: the bucket

### 1. Switch R2 on

Cloudflare dashboard → **R2 Object Storage**. If it asks, accept the R2 terms for the club's
account. The free allowance is 10 GB stored with no charge for reading it out, which is why
the club stores files here at all ([decision 002](../../decisions/decision-log.md)).

### 2. Create the bucket in the EU jurisdiction

```bash
npx wrangler r2 bucket create src-race-photos --jurisdiction=eu
```

Or in the dashboard: **Create bucket**, name `src-race-photos`, and under **Location**
choose **Specify jurisdiction → European Union**.

⚠️ **The jurisdiction cannot be changed once the bucket exists.** A bucket made without it
has to be deleted and made again, and anything uploaded re-sent. Check before uploading
anything: the bucket's page shows the jurisdiction, and its S3 API address contains `.eu.`.

### 3. Leave public access off

New buckets are private. On the bucket's **Settings** page, check that **Public access**
says the `r2.dev` address is **disabled** and that **no custom domain** is attached. The
website reads the bucket through a Worker binding (slice 3), never through a public address.

### 4. The retention rule — not yet

The photos are to be deleted after a period the committee has **not decided yet** (brief
§15: removal address and retention period). Until it has, **add no lifecycle rule**, and do
not invent a date. When it is decided, it is one rule on the `nn-2026/` prefix:

```bash
npx wrangler r2 bucket lifecycle add --help
```

Read the help first: the flags have changed between wrangler versions. The rule wants the
bucket `src-race-photos`, the jurisdiction `eu`, a name such as `nn-2026-retention`, the
prefix `nn-2026/`, and the agreed date. Record it in the log at the foot of this page.

### 5. The Worker binding — in code, and it waits for step 2

The website reads the bucket through a binding called `PHOTOS` in
`platform/apps/main/wrangler.jsonc`, with `"jurisdiction": "eu"` in production. Nothing is
done by hand here. ⚠️ **The bucket must exist before the change that added the binding (the
check page, slice 3) merges**: a deploy of a Worker bound to a bucket that does not exist
fails, and while it does, no other change to the site can deploy either.

---

## Every upload

### 6. Make a token for this upload

Dashboard → **R2 Object Storage** → **Manage API tokens** → **Create API token**:

- **Permissions:** Object Read & Write.
- **Apply to specific buckets only:** `src-race-photos`, the EU one.
- **TTL**, if the form offers one: a day is plenty. Step 9 revokes it either way.

Copy the **Access Key ID** and the **Secret Access Key** straight into the laptop's
`~/nn-photos/config.toml`, with the club's **Account ID** from the R2 overview page:

```toml
[r2]
account_id = "<the 32-character Cloudflare account ID>"
bucket = "src-race-photos"
access_key_id = "<the token's Access Key ID>"
secret_access_key = "<the token's Secret Access Key>"
```

⚠️ **Never anywhere else.** Not in the repository, not in a chat, not in an email. The tool
refuses to run if its work folder is inside a repository, and it never prints the token.

### 7. Upload

On the laptop, from `tools/photos/` with the virtual environment active:

```bash
./photos upload
```

It sends each visible photo's three copies to `nn-2026/<photo id>/` in the bucket, skips
anything an earlier upload already sent, and writes the SQL for every photo sent so far to
`~/nn-photos/sql/`, in parts. If it stops on an error, fix the cause it names and run the
same command again; it carries on from where it stopped.

### 8. Load the tags

Supabase dashboard → the club's project → **SQL Editor** → **New query**. For each part in
`~/nn-photos/sql/`, paste the whole file and **Run**.

- Each part is one transaction: it either applies whole or not at all.
- **Running a part twice changes nothing**, so if you are not sure whether you ran one, run
  it again.
- It never overwrites a decision the team made on the website, or a photo taken down there.
- The editor stops a query after a minute; a part is far smaller than that.

### 9. Revoke the token

Back in **Manage API tokens**, **delete** the token you made in step 6, then remove the
`[r2]` section from `~/nn-photos/config.toml`. The next upload gets a new token. A token
that no longer exists cannot leak.

---

## After loading: check, publish, take down

### 10. Grant the roles — once

At **`/admin/people/`**, somebody who may grant roles opens each person and switches on, in
the **Nightingale Nightmare** card:

- **Photo checker** (`nn-photo-checker`) for each person checking: Bindal, Andrew, Adrian and
  Ross.
- **Photo admin** (`nn-photo-admin`) for each person publishing and sending the links: Bindal
  and Mark.

Neither role opens the entry list. Directors (`src-admin`) can already do everything here;
a super-admin cannot until they grant themselves one of these.

### 11. Check the unsure photos — together

Each checker opens **`/admin/photos/check/`** from any computer, tablet or phone. It shows
one photo at a time, held for that person for ten minutes, so nobody gets a photo somebody
else has open.

- Press the bib it is (or its number key, **1** to **9**; **Enter** for the first), or type a
  different one — several with spaces between them for a photo with several runners.
- **U** keeps a part read as "Could be you", **N** is no bib visible, **S** skips it to
  somebody else, **H** takes it down (after a confirmation).
- After each decision there is an **Undo** for it. Only the person who made a decision can undo
  it, and only while nothing about the photo has changed since.

`/admin/photos/` shows how many are left and how many are being checked right now.

### 12. Publish — when nothing is left

A photo-admin opens **`/admin/photos/`**. The **Publish the photos** button appears only once
every unsure photo has been checked; until then the page says how many are left. Publishing is
done once and records who did it.

⚠️ **Publishing shows nothing to anybody until step 17 sends the links**: the runners' pages
answer only to a private link, and nobody has one yet. Once the links have gone, the results
page also says the photos are ready.

### What a runner sees once the links go out

Each runner's email carries a private link, `/nn/<year>/photos/p/<token>/`, under the subject
**"Your Nightingale Nightmare photos are ready"**. It shows
their bib, their finish time once the results are published, their own photos, and a "Could
be you" section for photos whose number could only partly be read. **There is no search and no
account**: the link is the only way in, and a replaced link stops working
([ADR-068](../../architecture/decisions/adr-068-runners-reach-their-photos-through-a-private-link.md)).
"That's me" and "Ask us to take it down" both open an email to the race's reply address; they
change nothing, and a person answers them — the second by step 13.

**A runner who has lost the email** goes to **`/nn/<year>/photos/`** and types the address they
entered with. Whatever they type, the page says the same thing — that *if* the address entered,
a new link is on its way — so it cannot be used to find out who ran. A new link replaces the old
one, and at most three are sent a day for one runner. This is also the answer to *"my link does
not work"*: the page that says so links straight to the form.

### 13. Take a photo down

For a runner who asks, or a photo that should not be up: on **`/admin/photos/`**, **Take a
photo down**, type its photo ID (it is under every photo, like `NN26-0412`), and press **Take
it down**. Checkers can also do it from the check page with **H**.

⚠️ **It deletes the photo's three copies from storage straight away and cannot be undone.**
If the page says the files could not be deleted, the photo is already hidden and shown to
nobody; take it down again to finish. A takedown a runner asked for is a request about their
data: answer and record it as [the data-requests runbook](data-requests.md) says, in step 3b.

---

## Once: the three keys for sending the links

The account holder does these, **before** step 17, in the order given. Each key is 32 random
bytes, in the club password store and nowhere else. The pattern is
[the membership keys runbook](membership-keys.md)'s, with a third key that the database never
sees.

### 14. Mint three keys

```bash
openssl rand -base64 32
```

Run it three times. All three must be different: one key opening two doors is one rotation
closing both.

### 15. Give them to the Worker

From **`platform/`**. Each prompts for its value.

```bash
npx wrangler secret put PHOTOS_ENTRY_KEY --env production --config apps/main/wrangler.jsonc
```

```bash
npx wrangler secret put PHOTOS_WEBHOOK_KEY --env production --config apps/main/wrangler.jsonc
```

```bash
npx wrangler secret put PHOTOS_LINK_KEY --env production --config apps/main/wrangler.jsonc
```

- `PHOTOS_ENTRY_KEY` opens the lost-link form.
- `PHOTOS_WEBHOOK_KEY` opens the drain that sends the emails.
- `PHOTOS_LINK_KEY` makes each runner's link. ⚠️ **It never goes in the database**, unlike the
  other two: it is what turns an email into a working link, so it stays in the Worker.

No deploy is needed; a secret takes effect on the next request.

### 16. Give the database two digests, never the keys

Supabase dashboard → **SQL Editor**, replacing each placeholder with the matching key from step
14. **Only the entry and webhook keys.** The link key has no digest anywhere.

```sql
update photos.api_secrets
   set key_sha256 = encode(sha256(convert_to('PASTE-THE-ENTRY-KEY', 'UTF8')), 'hex'),
       updated_at = now()
 where name = 'entry';

update photos.api_secrets
   set key_sha256 = encode(sha256(convert_to('PASTE-THE-WEBHOOK-KEY', 'UTF8')), 'hex'),
       updated_at = now()
 where name = 'webhook';
```

Check both landed without printing either digest:

```sql
select name, key_sha256 is not null as installed, updated_at
  from photos.api_secrets order by name;
```

Both rows must say `true`.

---

## Sending the links

### 17. Send the links — once Mark has agreed

⚠️ **Emailing every runner is Mark's decision** (brief §15), separate from publishing. Do not
press this until he has said yes.

A photo-admin opens **`/admin/photos/`**. Under the published race, **Links to runners** shows:

| Figure | What it means |
| --- | --- |
| Runners with photos | Runners with at least one photo of their own |
| No email address | Of those, how many the club cannot email: a walk-in, a refunded entry, or a bib two people seem to share |
| Waiting to send | Queued and not gone yet |
| Sent | Gone |
| Failed | Tried three times and stopped. See the table below |
| First links sent in the last 24 hours | Against the daily limit |

Press **Send the links**. It queues one email for every runner who has photos and an email
address, and **pressing it again queues nobody twice**. A runner whose only photos are "Could be
you" is not sent one: they can still use the lost-link form.

**The emails go a few at a time**: at most 80 first links in any 24 hours, so about three days
for the whole field. That keeps the race's other emails, and every password reset, inside
Resend's daily allowance. The first batch goes straight away, and the rest follow every five
minutes until the day's allowance is spent. **To change the limit**, in the SQL editor:

```sql
update photos.event set daily_send_limit = 150 where slug = 'nn-2026';
```

`null` lifts it altogether. Only do that once the treasurer has confirmed the club pays for
Resend.

---

## When it goes wrong

| What you see | What it means |
| --- | --- |
| `R2 refused … with AccessDenied` | The token is wrong, revoked, or not scoped to this bucket in the EU jurisdiction. Make a new one (step 6) |
| `R2 refused … with NoSuchBucket` | The bucket name in `[r2]` is wrong, or the bucket was made without the EU jurisdiction (step 2) |
| `R2 could not be reached` | The laptop is offline, or the account ID is wrong. Run the same command again once it is back |
| `There is no [r2] section` | Step 6 has not been done on this laptop |
| A SQL part fails in the editor | Nothing in that part was applied. Read the error, and ask before editing the file by hand |
| `/admin/photos/` answers "Not found" | You do not hold a photo role, or you are signed in as a different account. Step 10 |
| "Somebody else checked that photo first" | Two people had it open after a hold ran out. Their decision stands; carry on |
| "That photo has changed since, so it was not undone" | A later decision or SQL file run changed it. Ask the person who decided it |
| Every photo on the check page is a broken image | The bucket binding is missing, or the photos were never uploaded. Steps 5 and 7 |
| "Its files could not be deleted from storage" | The photo is hidden. Take it down again (step 13) to finish deleting it |
| **Waiting to send** never goes down | One of the three keys is missing or wrong (steps 15 and 16), or `RESEND_API_KEY` is. The Worker's log names `photos.claim_outbox_batch` if it is the webhook key |
| **Waiting to send** goes down by about 80 a day | The daily limit doing its job. See step 17 to change it |
| **Failed** with `no_address` or `no_photos` | The runner's entry was refunded or moved, or their photos were taken down, after the links were queued. Nothing to send |
| **Failed** with `http 422` | Resend refused the address, usually a typo when they entered. Email them from the race mailbox |
| A runner says their link does not work | Send them to `/nn/<year>/photos/` for a new one. The page their link opens already links there |
| The lost-link form says the photos are not up yet | They are not published, or step 17 has not been done |

---

## Log

Each hand step, as it is done: what, by whom, when.

| Step | Done by | When | Notes |
| --- | --- | --- | --- |
| 2. Bucket created, EU jurisdiction | Bindal | 24 October 2026, 22:09 | Dashboard, **Specify jurisdiction → European Union**, storage class Standard. The bucket's dashboard address is under `/r2/eu/` |
| 3. Public access checked off | Bindal | 24 October 2026 | The bucket's page shows **Public Access: Disabled**; nothing was switched on |
| 4. Retention rule | | | Waits on the committee |
| 14–16. The three sending keys | | | |
| 17. Links sent | | | Mark's agreement first |
