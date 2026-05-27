# Shipping Tracker

A tiny personal tool for tracking packages you ordered online — automatically,
from your Gmail inbox into a Google Sheet you can glance at.

## What it does

Every morning, a Claude Code routine:

1. Searches your Gmail for shipping notifications from the last 20 days.
2. Extracts the item, courier, tracking number, ETA, and status.
3. Upserts each shipment (by tracking number) into a Google Sheet.
4. Labels the processed Gmail threads so it never re-reads them.

The result is one sheet that always reflects the current state of every
package coming your way — without you forwarding emails, copying tracking
numbers, or installing a third-party service that wants your inbox.

## How it works

```
   Gmail  ──►  Claude routine (daily 07:00)  ──►  Apps Script webhook  ──►  Google Sheet
                                                       │
                                                       └─ upsert by tracking #
                                                          freeze Delivered after 7 days
```

Three moving parts:

- **Google Sheet + bound Apps Script** ([apps-script/Code.gs](apps-script/Code.gs)) — the database and the webhook that writes to it.
- **Claude routine** ([routine-prompt.md](routine-prompt.md)) — the daily worker that reads Gmail and POSTs to the webhook.
- **Gmail label** (`Tracked/Processed`) — the dedup signal so emails are processed exactly once.

## Sheet columns

| Date | Item | Courier | Tracking # | Tracking Link | ETA | Status | Notes | Last Updated |
|------|------|---------|------------|---------------|-----|--------|-------|--------------|

New rows are inserted at the top. `Date` (the ship date) is set once and never
overwritten; everything else updates as new emails arrive for the same
tracking number.

## Setup

See [SETUP.md](SETUP.md) for the step-by-step walkthrough.

## Why this exists

Carrier apps want push notifications, merchant accounts want you logged in,
and aggregator services want your inbox forever. This is ~200 lines of
script that lives in your own Google account, runs once a day, and shows
you what's coming in a spreadsheet.
