const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sheets = require('../api/sheets.js');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 8765;
http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/sheets') {
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(value)); };
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 600000) { res.status(413).json({error:'Request too large.'}); return; } }
      req.body = body || undefined;
      await sheets(req,res);
    } catch { if (!res.writableEnded) res.status(500).json({error:'Could not process that request.'}); }
    return;
  }
  if (!['/','/index.html'].includes(url.pathname)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  fs.createReadStream(path.join(root,'index.html')).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Tracker preview: http://127.0.0.1:${port}`));
