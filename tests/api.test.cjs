const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const handler = require('../api/sheets.js');
const names = ['GOOGLE_SCRIPT_URL','GOOGLE_SCRIPT_SECRET','TRACKER_PASSWORD','VERCEL'];
const originalEnvironment = Object.fromEntries(names.map(name => [name,process.env[name]]));
const originalFetch = global.fetch;
const calls = [];
function request(method, body, extraHeaders = {}) {
  const req = { method, body, headers:{host:'tracker.example','content-type':'application/json',...extraHeaders} };
  const res = { headers:{},setHeader(k,v) {this.headers[k.toLowerCase()]=v;},status(code) {this.code=code;return this;},json(data) {this.data=data;return this;} };
  return handler(req,res).then(() => res);
}
async function check(name, action) { await action(); console.log('PASS ' + name); }
async function main() {
  names.forEach(name => delete process.env[name]);
  await check('An unconfigured deployment supports local use without exposing credentials', async () => {
    const status = await request('GET'); assert.deepEqual(status.data,{configured:false,authenticated:false});
    assert.equal((await request('POST',{operation:'load'})).code,503);
  });
  Object.assign(process.env,{GOOGLE_SCRIPT_URL:'https://script.google.com/macros/s/test-deployment/exec',GOOGLE_SCRIPT_SECRET:'a-test-sync-secret-with-at-least-32-characters',TRACKER_PASSWORD:'private-test-password-123',VERCEL:'1'});
  global.fetch = async (url,options) => { calls.push({url,options}); return {ok:true,json:async () => ({ok:true,data:{months:{},spreadsheetUrl:'https://docs.google.com/spreadsheets/d/test#gid=1'}})}; };
  await check('Cloud data cannot be loaded without signing in', async () => {
    assert.equal((await request('POST',{operation:'load'})).code,401); assert.equal(calls.length,0);
    assert.equal((await request('POST',{operation:'login',payload:{password:'wrong'}})).code,401);
  });
  let cookie;
  await check('Correct login sets a signed, Secure, HttpOnly cookie', async () => {
    const login = await request('POST',{operation:'login',payload:{password:process.env.TRACKER_PASSWORD}});
    assert.equal(login.code,200); const header = login.headers['set-cookie'];
    assert.match(header,/HttpOnly/); assert.match(header,/Secure/); assert.match(header,/SameSite=Strict/);
    cookie = header.split(';')[0]; assert.doesNotMatch(cookie,/private-test-password/);
    assert.equal((await request('GET',null,{cookie})).data.authenticated,true);
  });
  await check('Forged and expired cookies cannot read the spreadsheet', async () => {
    assert.equal((await request('POST',{operation:'load'},{cookie:cookie.slice(0,-1)+'z'})).code,401);
    const expires = String(Math.floor(Date.now()/1000)-100), signed = createHmac('sha256',process.env.TRACKER_PASSWORD).update('tracker-session:'+expires).digest('hex');
    assert.equal((await request('POST',{operation:'load'},{cookie:'tracker_session='+expires+'.'+signed})).code,401);
  });
  await check('Cross-site and non-JSON writes are rejected', async () => {
    assert.equal((await request('POST',{operation:'load'},{cookie,origin:'https://foreign.example'})).code,403);
    assert.equal((await request('POST',{operation:'load'},{cookie,'content-type':'text/plain'})).code,415);
    assert.equal((await request('DELETE',null,{cookie})).code,405);
  });
  await check('Authenticated requests use the server secret without returning it to the browser', async () => {
    const load = await request('POST',{operation:'load'},{cookie,origin:'https://tracker.example'});
    assert.equal(load.code,200); assert.deepEqual(load.data.months,{});
    const forwarded = JSON.parse(calls.at(-1).options.body);
    assert.equal(forwarded.secret,process.env.GOOGLE_SCRIPT_SECRET); assert.equal(calls.at(-1).options.redirect,'follow');
    assert.doesNotMatch(JSON.stringify(load.data),/a-test-sync-secret/); assert.equal(load.headers['cache-control'],'no-store');
    const save = await request('POST',{operation:'save',payload:{key:'tracker_2026_10',month:{days:{}},changedDates:[]}},{cookie});
    assert.equal(save.code,200); assert.equal(JSON.parse(calls.at(-1).options.body).operation,'save');
  });
  await check('Malformed and oversized payloads do not reach Google', async () => {
    const before = calls.length;
    assert.equal((await request('POST','{bad json',{cookie})).code,400);
    assert.equal((await request('POST',{operation:'save',payload:{key:'wrong',changedDates:[]}},{cookie})).code,400);
    assert.equal((await request('POST',{operation:'load',payload:'x'.repeat(500001)},{cookie})).code,413);
    assert.equal(calls.length,before);
  });
  await check('Google failures are reported as failures instead of successful syncs', async () => {
    global.fetch = async () => ({ok:true,json:async () => {throw new Error('HTML response');}});
    assert.equal((await request('POST',{operation:'load'},{cookie})).code,502);
    global.fetch = async () => ({ok:true,json:async () => ({ok:false,error:'Unauthorized'})});
    assert.equal((await request('POST',{operation:'load'},{cookie})).code,502);
    global.fetch = async () => {const error = new Error('timeout');error.name='TimeoutError';throw error;};
    assert.match((await request('POST',{operation:'load'},{cookie})).data.error,/retry/);
  });
  await check('Disconnect expires the cloud session', async () => {
    const logout = await request('POST',{operation:'logout'},{cookie});
    assert.equal(logout.code,200); assert.match(logout.headers['set-cookie'],/Max-Age=0/);
  });
  console.log('All Vercel API checks passed.');
}
main().catch(error => {console.error(error);process.exitCode=1;}).finally(() => {
  global.fetch = originalFetch;
  names.forEach(name => {if (originalEnvironment[name] === undefined) delete process.env[name];else process.env[name]=originalEnvironment[name];});
});
