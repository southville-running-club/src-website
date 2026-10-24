# Runbook — race photos: the bucket, the upload, checking and publishing

Where the race photos live, the two hand steps every upload needs, and what the team does
with them on the website afterwards. **About twenty minutes the first time**; after that, a
few minutes per upload, and an evening of checking after a race.

**Who:** the bucket and the token are made by **the Cloudflare account holder**. The upload
and the SQL are run by **whoever is on the tagging laptop**, with the token the account
holder gives them. Checking is **the photo-checkers**, publishing **the photo-admins**, and
the roles are granted by somebody who may grant roles.

**Prerequisites:** [the Cloudflare runbook](cloudflare-setup.md) is done, the tagging laptop
is set up as in [`tools/photos/README.md`](../../../tools/photos/README.md), and the photos
have been tagged and every camera's clock decided.

Why it works this way is in five decisions:
[ADR-062](../../architecture/decisions/adr-062-race-photos-live-in-one-private-eu-bucket.md)
(the bucket),
[ADR-063](../../architecture/decisions/adr-063-the-laptop-uploads-with-a-token-revoked-after-each-upload.md)
(the token),
[ADR-064](../../architecture/decisions/adr-064-tags-reach-the-database-as-a-sql-file-run-by-hand.md)
(the SQL file),
[ADR-065](../../architecture/decisions/adr-065-unsure-photos-are-checked-together-on-the-website.md)
(checking together) and
[ADR-066](../../architecture/decisions/adr-066-two-narrow-roles-for-race-photos.md)
(the two roles).

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
- **Photo admin** (`nn-photo-admin`) for each person publishing: Bindal and Mark.

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

⚠️ **Until the runners' pages are built (slice 4), publishing shows nothing to anybody**: it
records that the photos are ready. The links go out with slice 5.

### 13. Take a photo down

For a runner who asks, or a photo that should not be up: on **`/admin/photos/`**, **Take a
photo down**, type its photo ID (it is under every photo, like `NN26-0412`), and press **Take
it down**. Checkers can also do it from the check page with **H**.

⚠️ **It deletes the photo's three copies from storage straight away and cannot be undone.**
If the page says the files could not be deleted, the photo is already hidden and shown to
nobody; take it down again to finish. A takedown a runner asked for is a request about their
data: answer and record it as [the data-requests runbook](data-requests.md) says, in step 3b.

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

---

## Log

Each hand step, as it is done: what, by whom, when.

| Step | Done by | When | Notes |
| --- | --- | --- | --- |
| 2. Bucket created, EU jurisdiction | Bindal | 24 October 2026, 22:09 | Dashboard, **Specify jurisdiction → European Union**, storage class Standard. The bucket's dashboard address is under `/r2/eu/` |
| 3. Public access checked off | Bindal | 24 October 2026 | The bucket's page shows **Public Access: Disabled**; nothing was switched on |
| 4. Retention rule | | | Waits on the committee |
