const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new','--disable-gpu','--no-sandbox','--disable-gpu-sandbox','--no-first-run','--remote-debugging-port=9225',
  '--user-data-dir=' + path.join(os.tmpdir(),'personal-tracker-chrome-qa'),'about:blank'
], { windowsHide:true, stdio:'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
let socket;
const qaTimeout = setTimeout(() => { console.error('Browser QA timed out.'); socket?.close(); browser.kill(); process.exitCode=1; },45000);
async function main() {
  let endpoint;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { endpoint = await (await fetch('http://127.0.0.1:9225/json/new?http://127.0.0.1:8765/',{method:'PUT'})).json(); break; }
    catch { await delay(250); }
  }
  if (!endpoint?.webSocketDebuggerUrl) throw new Error('Could not launch Chrome for browser QA.');
  socket = new WebSocket(endpoint.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  let next = 1; const pending = new Map(), errors = [];
  socket.addEventListener('message',event => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  socket.addEventListener('close',() => { pending.forEach(request => request.reject(new Error('Browser connection closed.'))); pending.clear(); });
  const cdp = (method,params = {}) => new Promise((resolve,reject) => { const id = next++; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params})); });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:'http://127.0.0.1:8765/'});
  for (let i = 0; i < 40; i++) { if (await evaluate("typeof render === 'function'")) break; await delay(200); }
  await evaluate("localStorage.clear(); currentYear=2026; currentMonth=9; render()");
  assert.equal(await evaluate("document.querySelectorAll('.cal-day').length"),31);
  await evaluate("document.querySelector('[data-date=\"2026-10-04\"]').click()");
  assert.match(await evaluate("document.getElementById('entryPanel').textContent"),/Sunday is a holiday/);
  await evaluate("[...document.querySelectorAll('.status-buttons button')].find(b=>b.textContent==='Working').click()");
  await evaluate("document.getElementById('weekendCategory').value='studying'; toggleWeekendTopic(); document.getElementById('weekendEnd').value='11:00'; document.getElementById('weekendTopic').value='Python'; document.querySelector('#entryPanel form').requestSubmit()");
  await evaluate("document.getElementById('weekendCategory').value='free'; document.getElementById('weekendEnd').value='12:00'; document.querySelector('#entryPanel form').requestSubmit()");
  assert.equal(await evaluate('getMonthlyTotals().totals.studying'),60); assert.equal(await evaluate('getMonthlyTotals().totals.free'),60);
  await evaluate("selectDay('2026-10-05'); setStatus('working'); [...document.querySelectorAll('.slot-actions button')].find(b=>b.textContent==='No batch').click()");
  await evaluate("document.getElementById('slotLearningMinutes_2').value='60'; document.getElementById('slotLearningTopic_2').value='Networking'; document.querySelector('#entryPanel form').requestSubmit()");
  assert.equal(await evaluate("loadData().days['2026-10-05'].entries.filter(e=>e.category==='free').reduce((s,e)=>s+duration(e),0)"),70);
  const duplicateIds = await evaluate("[...document.querySelectorAll('[id]')].map(n=>n.id).filter((id,i,a)=>a.indexOf(id)!==i)");
  assert.deepEqual(duplicateIds,[]);
  const downloadsDirectory = fs.mkdtempSync(path.join(os.tmpdir(),'hermit-monthly-download-'));
  await cdp('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadsDirectory});
  const waitForDownload = async filename => {
    const target = path.join(downloadsDirectory,filename);
    for (let attempt = 0; attempt < 50; attempt++) { if (fs.existsSync(target) && !fs.existsSync(target + '.crdownload')) return target; await delay(100); }
    throw new Error('Monthly download did not finish: ' + filename + ' ' + JSON.stringify({files:fs.readdirSync(downloadsDirectory),ui:await evaluate("({toast:document.getElementById('toast').textContent,valid:document.getElementById('downloadForm').checkValidity(),library:XLSX.version,month:document.getElementById('downloadMonthSelect').value,year:document.getElementById('downloadYear').value})"),errors}));
  };
  await evaluate("closeEntry(); openDownloadDialog()");
  assert.equal(await evaluate("document.getElementById('downloadDialog').open"),true);
  assert.equal(await evaluate("document.getElementById('downloadMonthSelect').value"),'9');
  for (let attempt = 0; attempt < 50; attempt++) { if (await evaluate('!!window.XLSX')) break; await delay(100); }
  assert.equal(await evaluate('!!window.XLSX'),true,'Excel library did not load');
  await cdp('Network.enable');
  await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate("document.getElementById('downloadForm').requestSubmit()");
  const workbookPath = await waitForDownload('Hermits_Time_Tracker_2026-10.xlsx');
  const workbookBase64 = fs.readFileSync(workbookPath).toString('base64');
  const exported = await evaluate(`(() => {
    const workbook = XLSX.read(${JSON.stringify(workbookBase64)},{type:'base64'});
    return {names:workbook.SheetNames,daily:XLSX.utils.sheet_to_json(workbook.Sheets['Daily totals'],{header:1}),activities:XLSX.utils.sheet_to_json(workbook.Sheets.Activities,{header:1}),hoursType:workbook.Sheets['Daily totals'].F5.t};
  })()`);
  assert.deepEqual(exported.names,['Daily totals','Activities','Summary','Learning topics','Adjustments']);
  assert.equal(exported.daily.find(row => row[0] === '2026-10-04')[5],1);
  assert.equal(exported.daily.at(-2)[0],'2026-10-31'); assert.equal(exported.daily.length,33);
  assert.ok(exported.activities.some(row => row[3] === '10:00' && row[4] === '11:00' && row[7] === 60));
  assert.equal(exported.hoursType,'n');
  await evaluate("openDownloadDialog(); downloadMonth('json')");
  const monthBackupPath = await waitForDownload('Hermits_Time_Tracker_2026-10_Backup.json');
  const monthBackup = JSON.parse(fs.readFileSync(monthBackupPath,'utf8'));
  assert.deepEqual(Object.keys(monthBackup),['tracker_2026_10']);
  assert.equal(monthBackup.tracker_2026_10.days['2026-10-04'].entries.length,5);
  // Downloading a different month does not move or replace the visible calendar.
  await evaluate("openDownloadDialog(); document.getElementById('downloadMonthSelect').value='1'; document.getElementById('downloadYear').value='2024'; downloadMonth('xlsx')");
  await waitForDownload('Hermits_Time_Tracker_2024-02.xlsx');
  assert.equal(await evaluate('currentYear'),2026); assert.equal(await evaluate('currentMonth'),9);
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate("closeEntry(); window.scrollTo(0,0)");
  const desktop = path.join(os.tmpdir(),'personal-tracker-desktop.png');
  fs.writeFileSync(desktop,Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("window.scrollTo(0,0)");
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile page has horizontal overflow');
  const mobile = path.join(os.tmpdir(),'personal-tracker-mobile.png');
  fs.writeFileSync(mobile,Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  await evaluate('openDownloadDialog()');
  assert.ok(await evaluate("document.getElementById('downloadDialog').scrollWidth <= document.getElementById('downloadDialog').clientWidth"),'Monthly download dialog has horizontal overflow');
  await evaluate("document.getElementById('downloadDialog').close()");
  await evaluate("selectDay('2026-10-04')");
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile editor has horizontal overflow');
  await evaluate("switchTab('summary')"); assert.doesNotMatch(await evaluate("document.getElementById('summaryGrid').textContent"),/NaN|Infinity/);
  await evaluate("switchTab('topics')"); assert.match(await evaluate("document.getElementById('topicsContent').textContent"),/Python/);
  await evaluate("openSheetsDialog()"); assert.equal(await evaluate("document.getElementById('sheetsDialog').open"),true);
  await cdp('Page.reload'); await delay(700);
  assert.equal(await evaluate("loadData().days['2026-10-04'].entries.length"),5);
  // The actual API is tested separately. Exercise its browser transport and login UI
  // with a mocked same-origin endpoint, without writing to a real Google Sheet.
  await evaluate(`
    window.realFetchForTest = window.fetch;
    window.signedInForTest = false;
    window.remoteForTest = Object.fromEntries(allStoredMonths().map(k => [k,loadData(k)]));
    window.fetch = async (url,options = {}) => {
      if (url !== '/api/sheets') return window.realFetchForTest(url,options);
      const respond = (data,status = 200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
      if (!options.method) return respond({configured:true,authenticated:window.signedInForTest});
      const request = JSON.parse(options.body);
      if (request.operation === 'login') {
        if (request.payload.password !== 'browser-test-password') return respond({error:'Incorrect tracker password.'},401);
        window.signedInForTest = true; return respond({ok:true});
      }
      if (!window.signedInForTest) return respond({error:'Sign in to connect your Google Sheet.'},401);
      if (request.operation === 'load') return respond({months:window.remoteForTest,spreadsheetUrl:'https://docs.google.com/spreadsheets/d/test#gid=1'});
      if (request.operation === 'save') { window.remoteForTest[request.payload.key] = request.payload.month; return respond({ok:true,month:request.payload.month}); }
      if (request.operation === 'logout') { window.signedInForTest = false; return respond({ok:true}); }
    };
    initializeTransport();
  `);
  await delay(50);
  assert.match(await evaluate("document.getElementById('saveStatusText').textContent"),/sign in/);
  await evaluate("openSheetsDialog(); document.getElementById('cloudPassword').value='wrong'; signInToSheets()");
  assert.match(await evaluate("document.getElementById('cloudLoginError').textContent"),/Incorrect/);
  await evaluate("document.getElementById('cloudPassword').value='browser-test-password'; signInToSheets()");
  assert.equal(await evaluate('cloudAuthenticated && remoteReady'),true);
  await evaluate("currentYear=2026; currentMonth=9; selectedDate='2026-10-04'; mutateDay(day => day.task='Synced from Vercel'); flushSheetSync()");
  assert.equal(await evaluate('pendingMonths.size'),0);
  assert.match(await evaluate("document.getElementById('saveStatusText').textContent"),/Saved to Google Sheets/);
  await evaluate("signOutOfSheets()");
  assert.equal(await evaluate('cloudAuthenticated'),false);
  await evaluate('window.fetch = window.realFetchForTest');
  assert.deepEqual(errors,[]);
  console.log('PASS real-browser Sunday, no-batch split, actual Excel and JSON downloads, mobile layout and Vercel sign-in/sync/disconnect checks');
  console.log('Verified monthly workbook: ' + workbookPath);
  console.log('Desktop screenshot: ' + desktop); console.log('Mobile screenshot: ' + mobile);
  await cdp('Browser.close').catch(() => {}); socket.close(); clearTimeout(qaTimeout);
}
main().catch(error => { console.error(error); socket?.close(); browser.kill(); clearTimeout(qaTimeout); process.exitCode=1; });
