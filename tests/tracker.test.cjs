const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('const MONTHS'));
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', className: '', value: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, focus() {}, scrollIntoView() {}, showModal() {}, close() {} });
  return nodes.get(id);
}
const stored = {};
const localStorage = {
  getItem: k => stored[k] ?? null,
  setItem: (k,v) => { stored[k] = String(v); },
  removeItem: k => { delete stored[k]; }
};
const sheets = [];
const context = vm.createContext({
  console, Date, Map, Set, JSON, Math, Number, String, Object, Array,
  localStorage, navigator: { onLine: true },
  document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false }), XLSX: true },
  setTimeout: () => 1, clearTimeout() {}, confirm: () => true, prompt: () => null,
  XLSX: { utils: { book_new: () => ({}), aoa_to_sheet: data => ({ data }), book_append_sheet: (wb, sheet, name) => sheets.push({ name, sheet }) }, writeFile() {} }
});
new vm.Script(script).runInContext(context);
const run = expression => vm.runInContext(expression, context);
const plain = expression => JSON.parse(JSON.stringify(run(expression)));
function test(name, action) { action(); console.log('PASS ' + name); }
run('currentYear = 2026; currentMonth = 9; render()');

test('Empty month has zero totals and no invalid percentages', () => {
  assert.deepEqual(plain('getMonthlyTotals().totals'), { teaching: 0, studying: 0, misc: 0, break: 0, free: 0 });
  assert.doesNotMatch(node('summaryGrid').innerHTML, /NaN|Infinity/);
});
test('Sunday is a holiday by default and can become a working day', () => {
  assert.equal(run("getStatus(undefined,'2026-10-04')"), 'holiday');
  run("selectDay('2026-10-04'); setStatus('working')");
  assert.equal(run("loadData().days['2026-10-04'].entries.length"), 3);
  assert.equal(run('getMonthlyTotals().totals.break'), 60);
});
function addWeekend(start, end, category, topic = '') {
  node('weekendStart').value = start; node('weekendEnd').value = end; node('weekendCategory').value = category; node('weekendTopic').value = topic;
  run('addWeekendEntry()');
}
test('Sunday learning and free time count in all reports', () => {
  addWeekend('10:00','11:00','studying','Python'); addWeekend('11:00','12:00','free');
  assert.deepEqual(plain('getMonthlyTotals().totals'), { teaching: 0, studying: 60, misc: 30, break: 60, free: 60 });
  assert.equal(run('getMonthlyTotals().topics.Python'), 60);
  assert.match(node('topicsContent').innerHTML, /Python/);
  const row = plain("getMonthRows().find(r => r.date === '2026-10-04')");
  assert.equal(row.status, 'working'); assert.match(row.activities, /Free time/);
  assert.match(node('calGrid').innerHTML, /L 1h/);
});
test('Weekend activities reject overlaps, lunch and out-of-hours times', () => {
  const before = run("loadData().days['2026-10-04'].entries.length");
  addWeekend('10:30','11:30','teaching'); addWeekend('13:00','15:00','studying'); addWeekend('08:00','09:00','free'); addWeekend('18:00','19:00','free');
  assert.equal(run("loadData().days['2026-10-04'].entries.length"), before);
  assert.deepEqual(plain("weekendGaps(loadData().days['2026-10-04'].entries)"), [{ start:'12:00',end:'13:30' },{ start:'14:30',end:'18:00' }]);
});
test('Changing to leave excludes but retains entries, switching back avoids duplicates', () => {
  run("setStatus('leave')"); assert.equal(run('loggedMinutes(getMonthlyTotals().totals)'), 0);
  assert.doesNotMatch(node('topicsContent').innerHTML, /Python/);
  assert.equal(run("loadData().days['2026-10-04'].entries.length"), 5);
  run("setStatus('working'); setStatus('working')"); assert.equal(run("loadData().days['2026-10-04'].entries.length"), 5);
});
test('A no-batch weekday slot splits learning and free time without double counting', () => {
  run("selectDay('2026-10-05'); setStatus('working'); setSlotCategory(2,'pending_n')");
  node('slotLearningMinutes_2').value = '60'; node('slotLearningTopic_2').value = 'Networking'; run('saveSlotLearning(2)');
  const day = plain("loadData().days['2026-10-05']");
  assert.deepEqual(day.entries.filter(e => ['09:30','10:30'].includes(e.start)), [
    { start:'09:30',end:'10:30',category:'studying',topic:'Networking' },
    { start:'10:30',end:'11:30',category:'free',topic:null }
  ]);
  assert.equal(run("loggedMinutes(getDayTotals(loadData().days['2026-10-05'],'2026-10-05'))"), 300);
});
test('Editing the automatic learning slot survives a day-type round trip', () => {
  run('editSlot(6)'); node('slotLearningMinutes_6').value = '60'; node('slotLearningTopic_6').value = 'Course'; run("saveSlotLearning(6); setStatus('holiday'); setStatus('working')");
  assert.equal(run("loadData().days['2026-10-05'].entries.filter(e => e.start >= '16:30').length"), 2);
  assert.equal(run("loggedMinutes(getDayTotals(loadData().days['2026-10-05'],'2026-10-05'))"), 300);
});
test('Legacy pending slots get independent input IDs', () => {
  run("setSlotCategory(3,'pending_n'); setSlotCategory(5,'pending_n')");
  assert.match(node('entryPanel').innerHTML, /id="slotLearningMinutes_3"/);
  assert.match(node('entryPanel').innerHTML, /id="slotLearningMinutes_5"/);
});
test('Manual hours preserve total duration and free time remains separate', () => {
  const totals = plain("calcDayTotals([{ start:'10:00',end:'11:00',category:'studying' },{ start:'11:00',end:'12:00',category:'free' }],2,0.5)");
  assert.deepEqual(totals, { teaching:0,studying:0,misc:60,break:0,free:90 });
});
test('Topics and important tasks render as text', () => {
  run("mutateDay(day => { day.task = '<img src=x onerror=alert(1)>'; day.important = true; day.entries.push({start:'11:30',end:'12:30',category:'studying',topic:'<img src=x onerror=alert(1)>'}); })");
  assert.doesNotMatch(node('entryPanel').innerHTML, /<img/); assert.doesNotMatch(node('topicsContent').innerHTML, /<img/);
  assert.match(node('topicsContent').innerHTML, /&lt;img/);
});
test('Excel exports include Sunday and every numeric category in the correct column', () => {
  run('exportExcel()');
  const daily = sheets[0].sheet.data;
  const sunday = daily.find(r => r[0] === '2026-10-04');
  assert.equal(sunday.length, 11); assert.equal(sunday[2], 'working'); assert.equal(sunday[5], 1); assert.equal(sunday[8], 1); assert.equal(sunday[10], 3.5);
  assert.equal(daily.at(-1).length,11); assert.equal(typeof daily.at(-1)[8], 'number');
});
test('Backup validation rejects impossible dates and malformed entries', () => {
  assert.throws(() => run("validateBackup({tracker_2026_02:{days:{'2026-02-30':{entries:[]}}}})"));
  assert.throws(() => run("validateBackup({tracker_2026_10:{days:{'2026-10-01':{entries:[{start:'10:00',end:'09:00',category:'free'}]}}}})"));
  assert.equal(run("validateBackup({tracker_2026_10:{days:{'2026-10-01':{entries:[],status:null}}}}).length"),1);
});

// Exercise the Apps Script writer using an in-memory spreadsheet implementation.
class Range {
  constructor(sheet, row = 1, col = 1, count = 1, width = 1) { Object.assign(this,{sheet,row,col,count,width}); }
  getValues() { return Array.from({length:this.count},(_,r) => Array.from({length:this.width},(_,c) => this.sheet.rows[this.row+r-1]?.[this.col+c-1] ?? '')); }
  setValues(values) { values.forEach((row,r) => row.forEach((v,c) => { const n = this.row+r-1; this.sheet.rows[n] ||= []; this.sheet.rows[n][this.col+c-1] = v; })); return this; }
  clearContent() { return this.setValues(Array.from({length:this.count},() => Array(this.width).fill(''))); }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; } setNumberFormat() { return this; } setWrap() { return this; }
  sort() { const values = this.getValues().sort((a,b) => String(a[0]).localeCompare(String(b[0]))); return this.setValues(values); }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; this.maxColumns = 26; this.hidden = false; }
  getRange(...args) { return typeof args[0] === 'string' ? new Range(this) : new Range(this,...args); }
  getLastRow() { return this.rows.reduce((n,row,i) => row.some(v => v !== '') ? i+1 : n,0); }
  getMaxRows() { return this.maxRows; } getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(n,count) { this.maxRows += count; } insertColumnsAfter(n,count) { this.maxColumns += count; }
  setFrozenRows() {} setColumnWidth() {} isSheetHidden() { return this.hidden; } hideSheet() { this.hidden = true; }
  getName() { return this.name; }
  getSheetId() { return this.name === 'Tracker Daily' ? 1 : 2; }
}
const spreadsheet = { tabs: new Map(), getSheetByName(name) { return this.tabs.get(name); }, insertSheet(name) { const sheet = new Sheet(name); this.tabs.set(name,sheet); return sheet; }, getUrl() { return 'https://docs.google.com/spreadsheets/d/test'; } };
const properties = {};
const backend = vm.createContext({ Date, Map, Set, JSON, Math, Number, String, Object, Array,
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null }) },
  ContentService: { MimeType: {JSON:'json'},createTextOutput:text => ({text,setMimeType() {return this;} }) },
  Utilities: { DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,text) => Array.from(require('node:crypto').createHash('sha256').update(text).digest()) },
  SpreadsheetApp: { openById: () => spreadsheet, flush() {} }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
});
new vm.Script(fs.readFileSync(path.join(root,'google-sheets/Code.gs'),'utf8')).runInContext(backend);
const server = expression => vm.runInContext(expression,backend);
function push(key,month,changedDates) { backend.payload = {key,month,changedDates}; return server('saveTrackerMonth(payload)'); }
const sunday = plain("loadData().days['2026-10-04']");
test('Sheet writer creates one row per date and retry does not duplicate dates', () => {
  push('tracker_2026_10',{days:{'2026-10-04':sunday}},['2026-10-04']);
  push('tracker_2026_10',{days:{'2026-10-04':sunday}},['2026-10-04']);
  const rows = spreadsheet.tabs.get('Tracker Daily').rows;
  assert.equal(rows.length,32); const row = rows.find(r => r[0] === '2026-10-04');
  assert.equal(row[2],'working'); assert.equal(row[5],1); assert.equal(row[8],1); assert.equal(row[10],3.5);
});
test('Sheet writer merges only edited dates and preserves other months', () => {
  const day = { entries:[{start:'10:00',end:'12:00',category:'teaching',topic:null}],status:'working' };
  push('tracker_2026_10',{days:{'2026-10-05':day}},['2026-10-05']);
  push('tracker_2026_09',{days:{'2026-09-01':day}},['2026-09-01']);
  const data = server('loadTrackerData()');
  assert.equal(data.months.tracker_2026_10.days['2026-10-04'].entries.length,5);
  assert.equal(data.months.tracker_2026_10.days['2026-10-05'].entries[0].category,'teaching');
  assert.ok(data.months.tracker_2026_09.days['2026-09-01']);
});
test('Clearing a date resets its daily row and removes its raw record', () => {
  push('tracker_2026_10',{days:{}},['2026-10-04']);
  assert.equal(server("loadTrackerData().months.tracker_2026_10.days['2026-10-04']"),undefined);
  const row = spreadsheet.tabs.get('Tracker Daily').rows.find(r => r[0] === '2026-10-04');
  assert.equal(row[2],'holiday'); assert.equal(row[10],0);
});
test('Backend rejects malformed payloads and protects cells from formula injection', () => {
  assert.throws(() => push('tracker_2026_10',{days:{}},['2026-11-01']));
  assert.throws(() => push('tracker_2026_02',{days:{}},['2026-02-30']));
  assert.equal(server("safeText_('=IMPORTXML(\"x\")')"), "'=IMPORTXML(\"x\")");
});
test('Apps Script bridge requires the secret and disables the direct HTML data calls', () => {
  properties.TRACKER_SYNC_SECRET = 'a-private-test-secret-with-more-than-32-characters';
  backend.event = {postData:{contents:JSON.stringify({operation:'load',secret:'wrong'})}};
  assert.equal(JSON.parse(server('doPost(event).text')).error,'Unauthorized');
  assert.throws(() => server('loadTrackerData()'));
  assert.equal(JSON.parse(server('doGet().text')).service,'tracker-sync');
  backend.event = {postData:{contents:JSON.stringify({operation:'load',secret:properties.TRACKER_SYNC_SECRET})}};
  const result = JSON.parse(server('doPost(event).text'));
  assert.equal(result.ok,true); assert.ok(result.data.months.tracker_2026_10);
  delete properties.TRACKER_SYNC_SECRET;
});

async function checkHostedSync() {
  const key = 'tracker_2026_10', date = '2026-10-04';
  const cached = { days: { [date]: sunday } };
  const remote = { days: { [date]: { entries: [], status:'holiday' } } };
  const hostedStorage = { [key]:JSON.stringify(cached), work_tracker_pending_sync:JSON.stringify([{key,dates:[date]}]) };
  const calls = [];
  const runner = {
    withSuccessHandler(success) { return { success, withFailureHandler(failure) { return {
      loadTrackerData() { success({ months:{[key]:remote} }); },
      saveTrackerMonth(payload) { calls.push({payload,success,failure}); }
    }; } }; }
  };
  const google = { script: { run:runner } };
  const hosted = vm.createContext({ ...context,
    google, window:{ google,addEventListener() {},matchMedia:()=>({matches:false}) },
    localStorage:{ getItem:k => hostedStorage[k] ?? null,setItem:(k,v) => {hostedStorage[k]=String(v);} }
  });
  const execute = expression => vm.runInContext(expression,hosted);
  new vm.Script(script).runInContext(hosted);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length,1);
  assert.equal(execute("loadData('tracker_2026_10').days['2026-10-04'].status"),'working');
  assert.equal(execute('pendingMonths.size'),1);
  console.log('PASS Hosted reload retains queued local edits before loading remote data');
  execute("currentYear=2026; currentMonth=9; selectedDate='2026-10-04'; mutateDay(day => {day.task='newer edit';day.important=true;})");
  calls[0].success({ok:true,month:cached});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(execute("loadData().days['2026-10-04'].task"),'newer edit');
  assert.equal(execute('pendingMonths.size'),1);
  console.log('PASS An in-flight acknowledgement does not overwrite a newer edit');
  execute('flushSheetSync()');
  assert.equal(calls.length,2);
  calls[1].failure(new Error('Offline'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(execute('pendingMonths.size'),1);
  assert.ok(JSON.parse(hostedStorage.work_tracker_pending_sync).length);
  console.log('PASS A failed write keeps its persistent retry queue');
  execute('flushSheetSync()');
  calls[2].success({ok:true,month:calls[2].payload.month});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(execute('pendingMonths.size'),0);
  assert.equal(hostedStorage.work_tracker_pending_sync,'[]');
  console.log('PASS Only a successful write clears the retry queue');
  console.log('All tracker regression checks passed.');
}
checkHostedSync().catch(error => { console.error(error); process.exitCode=1; });
