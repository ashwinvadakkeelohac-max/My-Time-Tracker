const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const COOKIE_NAME = 'tracker_session';

function equalSecret(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}
function signature(expires) { return createHmac('sha256', process.env.TRACKER_PASSWORD).update('tracker-session:' + expires).digest('hex'); }
function authenticated(req) {
  const cookie = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE_NAME + '='));
  if (!cookie || !process.env.TRACKER_PASSWORD) return false;
  const [expires, signed, extra] = cookie.slice(COOKIE_NAME.length + 1).split('.');
  if (extra || !/^\d{10}$/.test(expires || '') || !/^[a-f0-9]{64}$/.test(signed || '') || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  return equalSecret(signed, signature(expires));
}
function configured() {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(process.env.GOOGLE_SCRIPT_URL || '')
    && (process.env.GOOGLE_SCRIPT_SECRET || '').length >= 32 && (process.env.TRACKER_PASSWORD || '').length >= 12;
}
function setSessionCookie(req, res, value, maxAge) {
  const isLocal = process.env.VERCEL !== '1' && /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host || '');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isLocal ? '' : '; Secure'}`);
}
async function forwardToSheets(operation, payload) {
  const response = await fetch(process.env.GOOGLE_SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: process.env.GOOGLE_SCRIPT_SECRET, operation, payload }),
    redirect: 'follow', signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error('The Google Sheets connection could not be reached.');
  let result;
  try { result = await response.json(); } catch { throw new Error('Google returned a sign-in page. Check the Apps Script deployment access.'); }
  if (!result || result.ok !== true) throw new Error(result?.error === 'Unauthorized' ? 'Google Sheets rejected the connection. Check the sync secret in the deployment settings.' : 'Google Sheets could not save this request. Check the Apps Script execution log.');
  return result.data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'GET') return res.status(200).json({ configured: configured(), authenticated: configured() && authenticated(req) });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
  if (!configured()) return res.status(503).json({ error: 'Google Sheets has not been configured for this deployment.' });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return res.status(415).json({ error: 'Send a JSON request.' });
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Request origin is not allowed.' }); }
    catch { return res.status(403).json({ error: 'Request origin is not allowed.' }); }
  }
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid request.' });
  if (JSON.stringify(body).length > 500000) return res.status(413).json({ error: 'That request is too large.' });
  if (body.operation === 'login') {
    const password = body.payload?.password;
    if (typeof password !== 'string' || password.length > 256 || !equalSecret(password, process.env.TRACKER_PASSWORD)) return res.status(401).json({ error: 'Incorrect tracker password.' });
    const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
    setSessionCookie(req,res,expires + '.' + signature(expires),SESSION_SECONDS);
    return res.status(200).json({ ok: true });
  }
  if (!authenticated(req)) return res.status(401).json({ error: 'Sign in to connect your Google Sheet.' });
  if (body.operation === 'logout') { setSessionCookie(req,res,'',0); return res.status(200).json({ ok: true }); }
  if (!['load','save'].includes(body.operation)) return res.status(400).json({ error: 'Unknown operation.' });
  if (body.operation === 'save' && (!body.payload || !/^tracker_\d{4}_(0[1-9]|1[0-2])$/.test(body.payload.key) || !Array.isArray(body.payload.changedDates))) return res.status(400).json({ error: 'Invalid month payload.' });
  try { return res.status(200).json(await forwardToSheets(body.operation,body.payload)); }
  catch (error) { return res.status(502).json({ error: error.name === 'TimeoutError' ? 'Google Sheets took too long. Your changes will retry.' : error.message }); }
};
