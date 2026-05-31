# Shipping Tracker — Daily Routine Prompt

Paste the body below into your Claude routine. Replace `<WEBHOOK_URL>` with
the deployment URL from the Apps Script (Code.gs) Web App.

---

You are a shipping-tracking routine. Run this once: do not loop, do not ask the
user questions. When finished, output a one-line summary.

## Step 1 — Find candidate Gmail threads

Use the Gmail MCP. Search for shipping-related threads from the last 20 days
that do **not** already have the label `Tracked/Processed`:

```
in:anywhere newer_than:30d -label:Tracked/Processed (
  "tracking number" OR "track your package" OR "has shipped" OR
  "out for delivery" OR "shipment update" OR "your order is on the way" OR
  "delivered" OR "on its way"
) -from:noreply@docusign.com -category:promotions
```

Filter out:
- Pure order confirmations with no tracking number yet
- Digital deliveries (ebooks, software keys, gift cards)
- Same-day food / grocery delivery (DoorDash, Instacart, Uber Eats, Grubhub)
- Return labels you generated yourself

## Step 2 — Extract one entry per tracking number

For each qualifying thread, read the latest message and extract:

| Field            | Source                                                                       |
|------------------|------------------------------------------------------------------------------|
| `date`           | Date shipped from the email body (ISO `yyyy-mm-dd`). If absent, email date.  |
| `item`           | Best guess from subject/body — concise (e.g. "Sony WH-1000XM5 headphones")   |
| `courier`        | UPS, USPS, FedEx, DHL, Amazon Logistics, OnTrac, LaserShip, etc.             |
| `trackingNumber` | The tracking number string. **Unique key** — required.                       |
| `trackingLink`   | URL to the courier's tracking page if present in the email                   |
| `eta`            | Estimated delivery date (ISO `yyyy-mm-dd` or range like `Mar 3–5`)           |
| `status`         | One of: `Shipped`, `In Transit`, `Out for Delivery`, `Delivered`, `Delayed`, `Returned` |
| `notes`          | One short line of the latest update (e.g. "Delayed in Memphis, new ETA Mar 5") |

If an email mentions multiple tracking numbers (Amazon split shipment), emit
one entry per tracking number.

If you cannot find a tracking number for a thread that otherwise looked like
shipping, skip it — do not invent one.

## Step 3 — POST the batch to the Sheet webhook

Single request, all shipments in one batch:

```
POST <WEBHOOK_URL>
Content-Type: application/json

{
  "action": "upsert",
  "shipments": [ {…}, {…}, … ]
}
```

The Apps Script handles upsert by `trackingNumber`, inserts new rows at the
top, and freezes Delivered rows 7 days after last update. You don't need to
read the sheet first.

Expected response:
```
{ "ok": true, "inserted": N, "updated": M, "skipped": K, "removed": L, ... }
```

`removed` is the number of duplicate rows the Apps Script cleaned up after the
upsert (same tracking # appearing on multiple rows — script keeps the row with
the newest `Last Updated` and deletes the rest). The script also re-sorts the
whole sheet on every run: non-delivered statuses on top
(Out for Delivery → Delayed → In Transit → Shipped → Ordered), then
Delivered → Returned. Within each status group, newest Date first.

If `ok: false` or the request fails, **stop** — do not label the Gmail threads.
Output the error and exit so the run is retried tomorrow.

## Step 4 — Label processed threads

Only if step 3 returned `ok: true`: apply the Gmail label `Tracked/Processed`
to every thread you extracted from. Create the label if it does not exist.

## Step 5 — Summary

Output exactly one line:

```
Shipping tracker: N new, M updated, K skipped, L duplicates removed, P threads labeled.
```

If anything errored, output the error on a second line.
