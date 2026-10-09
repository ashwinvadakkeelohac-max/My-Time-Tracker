// Bound to the user's spreadsheet. Deploy together with an HTML file named Index.
// This uses Google account authentication; no API key or public write endpoint is needed.
const TRACKER_CONFIG = Object.freeze({
  spreadsheetId: '1wXUkmMr08thE6H77S1SPtjCx-aSrrgXTXSMdbyGA6jk',
  dailySheet: 'Tracker Daily',
  dataSheet: 'Tracker Data'
});
const DAILY_HEADERS = ['Date', 'Day', 'Day type', 'Activities', 'Batch hours', 'Learning hours', 'Misc hours', 'Break hours', 'Free hours', 'Work hours', 'Logged hours', 'Important task', 'Updated'];
const DATA_HEADERS = ['Date', 'Day record JSON', 'Updated'];
const TRACKER_CATEGORIES = { teaching: 'Batch / teaching', studying: 'Learning', misc: 'Miscellaneous', break: 'Break', free: 'Free time', pending_n: 'No batch · choose an activity' };

function doGet() {
  // In Vercel bridge mode, do not expose the Apps Script HTML interface.
  if (PropertiesService.getScriptProperties().getProperty('TRACKER_SYNC_SECRET')) return jsonResponse_({ ok: true, service: 'tracker-sync' });
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle("Hermit's Time Tracker")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// Vercel sends the secret server-to-server; it never reaches the public HTML.
function doPost(event) {
  try {
    const contents = event && event.postData && event.postData.contents;
    if (typeof contents !== 'string' || contents.length > 510000) throw new Error('Invalid request.');
    const request = JSON.parse(contents);
    const expected = PropertiesService.getScriptProperties().getProperty('TRACKER_SYNC_SECRET');
    if (!expected || expected.length < 32 || !request || typeof request.secret !== 'string' || !secretMatches_(request.secret,expected)) return jsonResponse_({ ok: false, error: 'Unauthorized' });
    if (request.operation === 'load') return jsonResponse_({ ok: true, data: loadTrackerData_() });
    if (request.operation === 'save') return jsonResponse_({ ok: true, data: saveTrackerMonth_(request.payload) });
    throw new Error('Unknown operation.');
  } catch (error) { return jsonResponse_({ ok: false, error: error.message || 'Sync failed.' }); }
}
function jsonResponse_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function secretMatches_(candidate, expected) {
  if (candidate.length > 256) return false;
  const a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,candidate), b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
function assertPrivateHosting_() {
  if (PropertiesService.getScriptProperties().getProperty('TRACKER_SYNC_SECRET')) throw new Error('Use the authenticated Vercel connection.');
}

// Run once in the Apps Script editor to authorize and create the two tracker tabs.
function setupTracker() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheets = getTrackerSheets_();
    return { spreadsheetUrl: trackerUrl_(sheets), dailyTab: sheets.daily.getName() };
  } finally { lock.releaseLock(); }
}

function loadTrackerData() {
  assertPrivateHosting_();
  return loadTrackerData_();
}
function loadTrackerData_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheets = getTrackerSheets_(), months = {};
    readDayRecords_(sheets.data).forEach((day, date) => {
      const key = 'tracker_' + date.slice(0,4) + '_' + date.slice(5,7);
      if (!months[key]) months[key] = { days: {} };
      months[key].days[date] = day;
    });
    return { months, spreadsheetUrl: trackerUrl_(sheets) };
  } finally { lock.releaseLock(); }
}

// Merge only edited dates, then update one visible row per date for the month.
// A lock and date lookup keep retries idempotent and prevent duplicate rows.
function saveTrackerMonth(payload) {
  assertPrivateHosting_();
  return saveTrackerMonth_(payload);
}
function saveTrackerMonth_(payload) {
  validateMonth_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheets = getTrackerSheets_(), records = readDayRecords_(sheets.data), now = new Date().toISOString();
    payload.changedDates.forEach(date => {
      if (Object.prototype.hasOwnProperty.call(payload.month.days, date)) records.set(date, payload.month.days[date]);
      else records.delete(date);
    });
    // Keep every existing month's raw records. The hidden tab lets the tracker reopen
    // with exact topics, tasks, split activities and legacy manual hour adjustments.
    const rawRows = Array.from(records).sort((a,b) => a[0].localeCompare(b[0])).map(([date,day]) => [date, JSON.stringify(day), now]);
    replaceDataRows_(sheets.data, rawRows, DATA_HEADERS.length);
    const year = Number(payload.key.slice(8,12)), month = Number(payload.key.slice(13,15));
    const daysInMonth = new Date(Date.UTC(year,month,0)).getUTCDate();
    const dailyRows = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      dailyRows.push(makeDailyRow_(date, records.get(date), now));
    }
    upsertDailyRows_(sheets.daily, dailyRows);
    SpreadsheetApp.flush();
    const mergedMonth = { days: {} }, prefix = year + '-' + String(month).padStart(2,'0') + '-';
    records.forEach((day,date) => { if (date.startsWith(prefix)) mergedMonth.days[date] = day; });
    return { ok: true, month: mergedMonth, datesUpdated: payload.changedDates.length, rows: dailyRows.length, savedAt: now };
  } finally { lock.releaseLock(); }
}

function getTrackerSheets_() {
  const spreadsheet = SpreadsheetApp.openById(TRACKER_CONFIG.spreadsheetId);
  const daily = ensureSheet_(spreadsheet, TRACKER_CONFIG.dailySheet, DAILY_HEADERS);
  const data = ensureSheet_(spreadsheet, TRACKER_CONFIG.dataSheet, DATA_HEADERS);
  if (!data.isSheetHidden()) data.hideSheet();
  return { spreadsheet, daily, data };
}
function trackerUrl_(sheets) { return sheets.spreadsheet.getUrl() + '#gid=' + sheets.daily.getSheetId(); }

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#202832').setFontColor('#edf2f7');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@');
    if (name === TRACKER_CONFIG.dailySheet) {
      sheet.setColumnWidth(1,110); sheet.setColumnWidth(2,65); sheet.setColumnWidth(3,105); sheet.setColumnWidth(4,400);
      sheet.getRange('D:D').setWrap(true); sheet.getRange('E:K').setNumberFormat('0.00');
      sheet.setColumnWidth(12,200); sheet.setColumnWidth(13,190);
    }
  } else {
    const actual = sheet.getRange(1,1,1,headers.length).getValues()[0];
    if (actual.some((value,i) => value !== headers[i])) throw new Error('The existing "' + name + '" tab has a different layout. Rename it or change TRACKER_CONFIG to use a new tab.');
  }
  return sheet;
}

function readDayRecords_(sheet) {
  const records = new Map();
  if (sheet.getLastRow() <= 1) return records;
  sheet.getRange(2,1,sheet.getLastRow() - 1,DATA_HEADERS.length).getValues().forEach(row => {
    if (!row[0]) return;
    const date = String(row[0]);
    if (!isValidDate_(date)) throw new Error('Invalid date in Tracker Data. Restore the hidden data tab from a backup.');
    let day;
    try { day = JSON.parse(row[1]); } catch (error) { throw new Error('Unreadable tracker data for ' + date + '.'); }
    validateDay_(date,day);
    if (records.has(date)) throw new Error('Duplicate tracker data for ' + date + '. Remove the duplicate raw row before syncing.');
    records.set(date,day);
  });
  return records;
}

function replaceDataRows_(sheet, rows, columns) {
  const oldCount = Math.max(0,sheet.getLastRow() - 1);
  if (rows.length + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length + 1 - sheet.getMaxRows());
  if (rows.length) sheet.getRange(2,1,rows.length,columns).setValues(rows);
  if (oldCount > rows.length) sheet.getRange(rows.length + 2,1,oldCount - rows.length,columns).clearContent();
}

function upsertDailyRows_(sheet, rows) {
  const existing = new Map();
  if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow() - 1,1).getValues().forEach((r,i) => {
    if (!r[0]) return;
    const date = String(r[0]);
    if (existing.has(date)) throw new Error('Duplicate date in Tracker Daily: ' + date + '. Remove the duplicate before syncing.');
    existing.set(date,i + 2);
  });
  const append = [];
  rows.forEach(row => {
    const existingRow = existing.get(row[0]);
    if (existingRow) sheet.getRange(existingRow,1,1,DAILY_HEADERS.length).setValues([row]);
    else append.push(row);
  });
  if (append.length) {
    const start = sheet.getLastRow() + 1, required = start + append.length - 1;
    if (required > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),required - sheet.getMaxRows());
    sheet.getRange(start,1,append.length,DAILY_HEADERS.length).setValues(append);
  }
  if (sheet.getLastRow() > 1) sheet.getRange(2,1,sheet.getLastRow() - 1,DAILY_HEADERS.length).sort({ column: 1, ascending: true });
}

function makeDailyRow_(date, day, now) {
  const [year,month,d] = date.split('-').map(Number), dow = new Date(Date.UTC(year,month - 1,d)).getUTCDay();
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow];
  const status = day && day.status || (day && day.entries && day.entries.length ? 'working' : dow === 0 ? 'holiday' : 'Not logged');
  const totals = { teaching: 0, studying: 0, misc: 0, break: 0, free: 0 };
  let activities = '';
  if (status === 'working' && day) {
    const entries = day.entries || [];
    entries.forEach(e => { if (Object.prototype.hasOwnProperty.call(totals,e.category)) totals[e.category] += minutes_(e.end) - minutes_(e.start); });
    const manualMisc = Math.min(Math.max(0,Number(day.manualMisc) || 0) * 60,totals.studying);
    totals.misc += manualMisc; totals.studying -= manualMisc;
    totals.free += Math.max(0,Number(day.manualFree) || 0) * 60;
    activities = entries.slice().sort((a,b) => minutes_(a.start) - minutes_(b.start)).map(e => e.start + '–' + e.end + ' ' + TRACKER_CATEGORIES[e.category] + (e.topic ? ': ' + e.topic : '')).join('\n');
  }
  const work = totals.teaching + totals.studying + totals.misc, logged = work + totals.break + totals.free;
  return [date,dayName,status,safeText_(activities),totals.teaching / 60,totals.studying / 60,totals.misc / 60,totals.break / 60,totals.free / 60,work / 60,logged / 60,safeText_(day && day.important ? day.task || 'Important' : ''),now];
}

function minutes_(time) { const parts = time.split(':').map(Number); return parts[0] * 60 + parts[1]; }
function isValidTime_(time) { return typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time); }
function isValidDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y,m,d] = date.split('-').map(Number), value = new Date(Date.UTC(y,m - 1,d));
  return value.getUTCFullYear() === y && value.getUTCMonth() === m - 1 && value.getUTCDate() === d;
}
function safeText_(text) { text = String(text || ''); return /^[=+\-@]/.test(text) ? "'" + text : text; }
function validateDay_(date, day) {
  if (!isValidDate_(date) || !day || typeof day !== 'object' || Array.isArray(day) || !Array.isArray(day.entries)) throw new Error('Invalid day: ' + date);
  if (day.status != null && !['working','holiday','leave'].includes(day.status)) throw new Error('Invalid day type.');
  ['manualMisc','manualFree'].forEach(field => { if (day[field] != null && (!Number.isFinite(Number(day[field])) || Number(day[field]) < 0 || Number(day[field]) > 24)) throw new Error('Invalid manual hours.'); });
  if (day.task != null && (typeof day.task !== 'string' || day.task.length > 1000)) throw new Error('Invalid task.');
  if (day.entries.length > 500) throw new Error('Too many entries in a day.');
  day.entries.forEach(e => {
    if (!e || !isValidTime_(e.start) || !isValidTime_(e.end) || minutes_(e.start) >= minutes_(e.end) || !Object.prototype.hasOwnProperty.call(TRACKER_CATEGORIES,e.category)) throw new Error('Invalid activity for ' + date);
    if (e.topic != null && (typeof e.topic !== 'string' || e.topic.length > 1000)) throw new Error('Invalid learning topic.');
  });
  if (JSON.stringify(day).length > 45000) throw new Error('Too much data for one day. Shorten activity notes.');
}
function validateMonth_(payload) {
  if (!payload || !/^tracker_\d{4}_(0[1-9]|1[0-2])$/.test(payload.key) || !payload.month || !payload.month.days || typeof payload.month.days !== 'object' || Array.isArray(payload.month.days) || !Array.isArray(payload.changedDates)) throw new Error('Invalid month payload.');
  const prefix = payload.key.slice(8,12) + '-' + payload.key.slice(13,15) + '-';
  if (payload.changedDates.length > 31) throw new Error('Too many changed dates.');
  Object.keys(payload.month.days).forEach(date => {
    if (!date.startsWith(prefix)) throw new Error('Day does not belong to this month.');
    validateDay_(date,payload.month.days[date]);
  });
  payload.changedDates.forEach(date => { if (typeof date !== 'string' || !date.startsWith(prefix) || !isValidDate_(date)) throw new Error('Invalid changed date.'); });
}
