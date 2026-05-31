# Shipping Tracker — Setup

Three pieces: a Google Sheet + bound Apps Script (the database), a daily
Claude routine (the worker), and a Gmail label (the dedup signal).

## 1. Create the Google Sheet

1. Go to https://sheets.new — name it whatever you like (e.g. "Shipping Tracker").
2. Rename the first tab to `Shipments`.
3. Paste this header row in row 1:

   ```
   Date    Item    Courier    Tracking #    Tracking Link    ETA    Status    Notes    Last Updated
   ```

   (The Apps Script also creates these headers automatically the first time it
   runs, but doing it now lets you see the structure.)

## 2. Add the Apps Script

1. In the sheet: **Extensions → Apps Script**.
2. Delete the boilerplate `function myFunction() {}` block.
3. Paste the entire contents of [`apps-script/Code.gs`](apps-script/Code.gs).
4. Click **Save** (disk icon). Project name: "Shipping Tracker".

## 3. Deploy the Apps Script as a Web App

1. Click **Deploy → New deployment**.
2. Gear icon next to "Select type" → **Web app**.
3. Configuration:
   - **Description**: `Shipping tracker webhook v1`
   - **Execute as**: `Me (your@gmail.com)`
   - **Who has access**: `Anyone with the link`  ← required for the routine to POST without OAuth
4. Click **Deploy**. Authorize when prompted (it needs Sheet access — that's the script writing to your sheet on your behalf).
5. **Copy the Web app URL.** It looks like:
   `https://script.google.com/macros/s/AKfycb…/exec`

> **Security note**: anyone with this URL can POST to your script. The script
> only writes to your one sheet — it can't read your other Drive files — but
> treat the URL like a password. Don't paste it in public chats.

If you ever change the script, you must **Deploy → Manage deployments → edit
→ New version** to publish the change. Re-deploying creates a fresh URL; using
"new version" on the existing deployment keeps the URL stable.

## 4. Create the Gmail label

In Gmail: **Settings → Labels → Create new label** → name it exactly
`Tracked/Processed`. (The routine will also create it on first run, but
pre-creating it lets you verify the spelling.)

## 5. Create the daily Claude routine

In Claude Code, run `/schedule` and create a routine with:

- **Schedule**: every day at 07:00 in your local timezone
- **Prompt**: paste the entire contents of [`routine-prompt.md`](routine-prompt.md),
  with `<WEBHOOK_URL>` replaced by the URL from step 3
- **MCPs needed**: Gmail (already connected)

## 6. First-run backfill

On the first execution, the routine will look at the entire last 20 days of
mail because nothing is labeled `Tracked/Processed` yet. Expect 5–30 new rows
depending on your shopping habits. Subsequent runs will be small (typically
0–3 new + a handful of status updates).

## How it stays correct

- **Dedup at the email layer**: every shipping email gets labeled
  `Tracked/Processed` after a successful sheet write. The Gmail search filter
  excludes labeled threads, so the routine never re-reads the same email.
- **Dedup at the row layer**: after every upsert, the Apps Script scans the
  sheet, groups by `Tracking #`, and keeps only the row with the newest
  `Last Updated` for each tracking number. Duplicates caused by manual edits,
  retried POSTs, or merchants resending the same tracking under a slightly
  different format get collapsed automatically.
- **Updates**: the Apps Script upserts by `Tracking #`. When a "shipped"
  email and a later "out for delivery" email both have the same tracking
  number, the second one updates the existing row instead of inserting.
- **Sort**: after every upsert the sheet is re-sorted so active shipments
  bubble to the top — `Out for Delivery → Delayed → In Transit → Shipped →
  Ordered → Delivered → Returned`. Within each status group, newest `Date`
  first.
- **Lifecycle**: rows marked `Delivered` are frozen 7 days after their last
  update, so a stale "delivered" email won't keep re-flipping a row.
- **Date stability**: the `Date` column is set once (the shipped date) and
  never changed by updates.

## When things go wrong

- **Apps Script returns `ok: false`** → routine aborts before labeling, so
  tomorrow's run retries the same threads. Open the script's **Executions**
  tab in Apps Script for stack traces.
- **Routine over-labeled a thread that wasn't really shipping** → remove the
  `Tracked/Processed` label manually; next run will re-examine and either
  pick it up correctly or skip it.
- **Duplicate row appeared** → the merchant changed the tracking number
  format between emails (rare). Delete the older row by hand.
- **No status updates after several days** → check whether the courier sends
  follow-up emails at all. Many ship+forget — there's literally no "in
  transit" email, just shipped and delivered.
