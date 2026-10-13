// Local runner: serves public/ and the api/ handlers with a Vercel-like
// req/res shim. With MOCK_SHEET=1 it also fakes the Apps Script API using
// invented, non-patient data. Usage: MOCK_SHEET=1 node scripts/dev-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');

if (process.env.MOCK_SHEET) {
  const MOCK_PORT = PORT + 1;
  process.env.SHEET_API_SECRET = 'mock';
  process.env.SHEET_API_URL = `http://127.0.0.1:${MOCK_PORT}/exec`;
  const db = {
    ok: true, meta: {}, profile: { Age: '67', Sex: 'M', Medicare: 'MUST-NOT-LEAK' },
    conditions: [{ name: 'Coronary artery calcification', status: 'active', since: '2026-09', notes: 'Example only', source: 'mock', updated: '' }],
    medications: [],
    testResults: [
      { date: '2026-09-01', test: 'CT coronary calcium score (Agatston)', result: '500', lab: '', notes: 'mock', source: 'mock' },
      { date: '2026-08-01', test: 'LDL-C', result: '4.0 mmol/L', lab: '', notes: '', source: 'mock' },
      { date: '2026-08-01', test: 'Non-HDL-C', result: '5.0 mmol/L', lab: '', notes: '', source: 'mock' },
      { date: '2026-08-01', test: 'eGFR', result: '70', lab: '', notes: '', source: 'mock' },
    ],
    checkins: [], notes: [],
    questions: [
      { id: 'Q1', question: 'Example question one for the cardiologist?', askWhom: 'cardiologist', priority: '1', status: 'open', answer: '', updated: '' },
      { id: 'Q2', question: 'Example question two?', askWhom: 'cardiologist', priority: '2', status: 'open', answer: '', updated: '' },
    ],
    gaps: [{ id: 'G1', gap: 'Example knowledge gap', whatAnswersIt: 'A test', stepToClose: 'Ask GP', status: 'open', updated: '' }],
    changelog: [],
  };
  // MOCK_CANON_FILE: render a saved canon (keep real data outside the repo).
  if (process.env.MOCK_CANON_FILE) Object.assign(db, JSON.parse(fs.readFileSync(process.env.MOCK_CANON_FILE, 'utf8')));
  globalThis.__mockDb = db;
  http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const send = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.method === 'GET') {
        if (u.searchParams.get('secret') !== 'mock') return send({ ok: false, error: 'bad secret' });
        return send({ ...db, serverTimeUTC: new Date().toISOString(), serverTimeMelb: 'now' });
      }
      const b = JSON.parse(body || '{}');
      if (b.secret !== 'mock') return send({ ok: false, error: 'bad secret' });
      const ts = new Date().toISOString();
      if (b.action === 'note') { db.notes.push({ tsUTC: ts, by: b.by, text: b.payload.text, tag: b.payload.tag || '' }); return send({ ok: true }); }
      if (b.action === 'checkin') { const a = b.payload.answers; const v = a.chest !== 'none' || a.breath === 'at-rest' ? 'Act-now' : (a.walking !== 'same' || a.energy !== 'normal') ? 'Changed' : 'Stable'; db.checkins.push({ tsMelb: ts, ...a, verdict: v, notes: b.payload.notes }); return send({ ok: true, verdict: v }); }
      if (b.action === 'profile') { db.profile[b.payload.key] = b.payload.value; return send({ ok: true }); }
      if (b.action === 'question') { if (b.payload.id) { const q = db.questions.find(x => x.id === b.payload.id); if (q && b.payload.status) q.status = b.payload.status; if (q && b.payload.answer !== undefined) q.answer = b.payload.answer; return send({ ok: true, id: b.payload.id }); } const id = 'Q' + (db.questions.length + 1); db.questions.push({ id, question: b.payload.question, priority: b.payload.priority || '3', status: 'open', answer: '' }); return send({ ok: true, id }); }
      if (b.action === 'gap') { const g = db.gaps.find(x => x.id === b.payload.id); if (g && b.payload.status) g.status = b.payload.status; return send({ ok: true }); }
      return send({ ok: true });
    });
  }).listen(MOCK_PORT);
}

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
