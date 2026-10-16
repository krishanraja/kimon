// Local runner: serves public/ and the api/ handlers with a Vercel-like
// req/res shim. MOCK_SHEET=1 runs the real Apps Script against an in-memory
// sheet with invented, non-patient data; MOCK_AI=1 scripts the model.
// Usage: MOCK_SHEET=1 MOCK_AI=1 node scripts/dev-server.mjs  (passcode "local")
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');

// Local passcode only. Production reads ACCESS_CODE from Vercel env.
process.env.ACCESS_CODE ||= 'local';
// Invented family list; production reads PEOPLE from Vercel env.
process.env.PEOPLE ||= JSON.stringify([{ name: 'Kimon', aliases: ['Kim'], patient: true }, { name: 'Sam', aliases: ['Sammy'], calls: 'Dad' }, { name: 'Alex', calls: 'Kim' }]);

if (process.env.MOCK_SHEET) {
  // The real apps-script/Code.gs, run against an in-memory sheet. Invented,
  // non-patient seed data. Sheets shows dates in the sheet's own time zone.
  process.env.TZ ||= 'Europe/London';
  const MOCK_PORT = PORT + 1;
  process.env.SHEET_API_SECRET = 'mock';
  process.env.SHEET_API_URL = `http://127.0.0.1:${MOCK_PORT}/exec`;
  const { createSheetApi } = await import('./gas-emulator.mjs');
  const seed = {
    meta: { schema: 'v1' },
    profile: { Age: '67', Sex: 'M', Medicare: 'MUST-NOT-LEAK' },
    conditions: [{ name: 'Coronary artery calcification', status: 'active', since: '2026-09', notes: 'Example only', source: 'mock', updated: '' }],
    testResults: [
      { date: '2026-09-01', test: 'CT coronary calcium score (Agatston)', result: 'Total 500 Agatston', lab: '', notes: 'mock', source: 'mock' },
      { date: '2026-08-01', test: 'Lipid studies', result: 'LDL-C 4.0 mmol/L; Non-HDL-C 5.0 mmol/L', lab: '', notes: '', source: 'mock' },
      { date: '2026-08-01', test: 'eGFR', result: 'eGFR 70', lab: '', notes: '', source: 'mock' },
    ],
    questions: [
      { id: 'Q1', question: 'Example question one for the cardiologist?', askWhom: 'cardiologist', priority: '1', status: 'open', answer: '', updated: '' },
      { id: 'Q2', question: 'Example question two?', askWhom: 'cardiologist', priority: '2', status: 'open', answer: '', updated: '' },
    ],
    gaps: [{ id: 'G1', gap: 'Example knowledge gap', whatAnswersIt: 'A test', stepToClose: 'Ask GP', status: 'open', updated: '' }],
  };
  // MOCK_CANON_FILE: render a saved canon (keep real data outside the repo).
  const fileSeed = process.env.MOCK_CANON_FILE ? JSON.parse(fs.readFileSync(process.env.MOCK_CANON_FILE, 'utf8')) : null;
  const sheet = createSheetApi({ secret: 'mock', seed: fileSeed || seed });
  globalThis.__sheet = sheet;
  http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/__tabs') return res.end(JSON.stringify(Object.fromEntries(Object.entries(sheet.tabs).map(([k, t]) => [k, t.rows]))));
      if (req.method === 'GET') return res.end(JSON.stringify(sheet.get(Object.fromEntries(u.searchParams))));
      return res.end(JSON.stringify(sheet.post(JSON.parse(body || '{}'))));
    });
  }).listen(MOCK_PORT);
}

// MOCK_AI=1: a scripted stand-in for the model, for local runs and UI tests.
if (process.env.MOCK_AI) globalThis.__mockComplete = (await import('./mock-ai.mjs')).mockComplete;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    const file = path.join(root, 'api', u.pathname.slice(5).replace(/[^a-z]/gi, '') + '.js');
    if (!fs.existsSync(file)) return res.status(404).json({ ok: false });
    try { (await import(file)).default(req, res); } catch (e) { console.error(e); res.status(500).json({ ok: false, error: e.message }); }
    return;
  }
  let p = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!path.extname(p) && fs.existsSync(p + '.html')) p += '.html'; // Vercel cleanUrls
  if (!p.startsWith(path.join(root, 'public')) || !fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
