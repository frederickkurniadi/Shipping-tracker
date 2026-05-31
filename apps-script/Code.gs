/**
 * Shipping Tracker — Google Apps Script
 *
 * Deploy:  Extensions → Apps Script → paste this file → Deploy → New deployment
 *          Type: Web app · Execute as: Me · Who has access: Anyone with the link
 *
 * Routine sends:
 *   POST { "action": "upsert", "shipments": [ ... ] }
 *
 * Apps Script handles upsert by tracking number, inserts new rows at top,
 * and freezes "Delivered" rows 7 days after last update.
 */

const SHEET_NAME = 'Shipments';
const HEADERS = [
  'Date',           // A — date shipped (from email body, ISO yyyy-mm-dd)
  'Item',           // B — best guess from subject/body
  'Courier',        // C — UPS, USPS, FedEx, DHL, Amazon, etc.
  'Tracking #',     // D — unique key
  'Tracking Link',  // E — clickable URL
  'ETA',            // F — estimated delivery date
  'Status',         // G — Shipped | In Transit | Out for Delivery | Delivered | Delayed | Returned
  'Notes',          // H — latest update text
  'Last Updated',   // I — auto-managed timestamp
];
const FREEZE_DAYS_AFTER_DELIVERED = 7;

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = getSheet_();

    if (payload.action === 'upsert') {
      const upsertResult = upsertShipments_(sheet, payload.shipments || []);
      // After every upsert: dedupe by tracking # then re-sort the whole sheet.
      const cleanupResult = sortAndDedupe_(sheet);
      return json_({ ok: true, ...upsertResult, ...cleanupResult });
    }
    if (payload.action === 'list') {
      return json_({ ok: true, shipments: listShipments_(sheet) });
    }
    return json_({ ok: false, error: 'unknown action: ' + payload.action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, shipments: listShipments_(getSheet_()) });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#f0f0f0');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 280); // Item
    sheet.setColumnWidth(5, 220); // Tracking Link
    sheet.setColumnWidth(8, 320); // Notes
  }
  return sheet;
}

function listShipments_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values.map((row, i) => ({
    rowIndex: i + 2,
    date: row[0],
    item: row[1],
    courier: row[2],
    trackingNumber: String(row[3] || '').trim(),
    trackingLink: row[4],
    eta: row[5],
    status: row[6],
    notes: row[7],
    lastUpdated: row[8],
  }));
}

function upsertShipments_(sheet, shipments) {
  const existing = listShipments_(sheet);
  const byTracking = {};
  existing.forEach(s => {
    if (s.trackingNumber) byTracking[s.trackingNumber] = s;
  });

  const now = new Date();
  const freezeBefore = new Date(now.getTime() - FREEZE_DAYS_AFTER_DELIVERED * 86400000);

  const inserted = [];
  const updated = [];
  const skipped = [];
  const newRows = [];

  shipments.forEach(s => {
    const tracking = String(s.trackingNumber || '').trim();
    if (!tracking) {
      skipped.push({ reason: 'no tracking number', item: s.item });
      return;
    }

    const cur = byTracking[tracking];
    if (cur) {
      const lastUpdated = cur.lastUpdated ? new Date(cur.lastUpdated) : null;
      if (cur.status === 'Delivered' && lastUpdated && lastUpdated < freezeBefore) {
        skipped.push({ reason: 'frozen (delivered > 7 days)', tracking });
        return;
      }

      const r = cur.rowIndex;
      sheet.getRange(r, 2).setValue(s.item || cur.item);
      sheet.getRange(r, 3).setValue(s.courier || cur.courier);
      sheet.getRange(r, 5).setValue(s.trackingLink || cur.trackingLink);
      sheet.getRange(r, 6).setValue(s.eta || cur.eta);
      sheet.getRange(r, 7).setValue(s.status || cur.status);
      sheet.getRange(r, 8).setValue(s.notes || cur.notes);
      sheet.getRange(r, 9).setValue(now);
      updated.push({ tracking, rowIndex: r });
    } else {
      newRows.push([
        s.date || '',
        s.item || '',
        s.courier || '',
        tracking,
        s.trackingLink || '',
        s.eta || '',
        s.status || 'Shipped',
        s.notes || '',
        now,
      ]);
      inserted.push({ tracking });
    }
  });

  // Latest at top — insert new rows directly under the header.
  if (newRows.length > 0) {
    sheet.insertRowsAfter(1, newRows.length);
    sheet.getRange(2, 1, newRows.length, HEADERS.length).setValues(newRows);
  }

  return {
    inserted: inserted.length,
    updated: updated.length,
    skipped: skipped.length,
    skippedDetail: skipped,
  };
}

/**
 * Dedupe by Tracking # (keep the row with the newest Last Updated), then sort:
 *   non-delivered statuses first, then by Date descending within each status group.
 * Rows without a Tracking # are preserved (manual rows) and sorted alongside the rest.
 */
function sortAndDedupe_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return { removed: 0 }; // 0 or 1 data row — nothing to do.

  const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

  // 1. Dedupe by tracking number — keep the row with the latest Last Updated.
  const byTracking = {};
  const noTracking = [];
  rows.forEach(r => {
    const tracking = String(r[3] || '').trim();
    if (!tracking) {
      noTracking.push(r);
      return;
    }
    const ts = r[8] instanceof Date ? r[8].getTime() : (r[8] ? new Date(r[8]).getTime() : 0);
    if (!byTracking[tracking] || ts > byTracking[tracking].ts) {
      byTracking[tracking] = { row: r, ts };
    }
  });

  const cleaned = Object.values(byTracking).map(o => o.row).concat(noTracking);
  const removed = rows.length - cleaned.length;

  // 2. Sort: non-delivered first, then by Date desc within each group.
  //    Lower number = higher in the sheet.
  const STATUS_ORDER = {
    'Out for Delivery': 0,
    'Delayed':          1,
    'In Transit':       2,
    'Shipped':          3,
    'Ordered':          4,
    'Delivered':        5,
    'Returned':         6,
  };
  const statusRank = s => (s in STATUS_ORDER ? STATUS_ORDER[s] : 99);
  const dateMs = v => {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    const d = new Date(v);
    return isNaN(d) ? 0 : d.getTime();
  };

  cleaned.sort((a, b) => {
    const sa = statusRank(a[6]);
    const sb = statusRank(b[6]);
    if (sa !== sb) return sa - sb;
    return dateMs(b[0]) - dateMs(a[0]); // newest first within the same status
  });

  // 3. Rewrite the data range in place. Clear the old extent so freed rows blank out.
  sheet.getRange(2, 1, rows.length, HEADERS.length).clearContent();
  if (cleaned.length > 0) {
    sheet.getRange(2, 1, cleaned.length, HEADERS.length).setValues(cleaned);
  }

  return { removed };
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
