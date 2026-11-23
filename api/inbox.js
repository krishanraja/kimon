// Documents Kimon forwards by email arrive here from the n8n automation,
// which only passes mail from his own address that passes Gmail's sender
// checks. Each document is read (lib/read-document.js) and held as
// "waiting for Kimon": a Notes row tagged inbox-pending. Nothing goes into
// his results until he checks it and taps Save in his app. The document
// itself is not stored. Locked with INBOX_SECRET; off when it is not set.
import crypto from 'node:crypto';
import { readCanon, write } from '../lib/sheet.js';
import { checkImage, IMAGE_TYPES, PDF_TYPE } from '../lib/photo.js';
import { readDocument } from '../lib/read-document.js';
import { INBOX_TAG } from '../public/js/inbox-model.js';

const MAX_FILES = 4;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function keyOk(given, expected) {
  if (!expected || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const secret = process.env.INBOX_SECRET;
  if (!secret) return res.status(503).json({ ok: false, error: 'inbox is off' });
  if (!keyOk(req.headers['x-beside-key'], secret)) return res.status(401).json({ ok: false, error: 'not allowed' });

  const body = req.body || {};
  const messageId = clip(body.messageId, 200);
  const files = (Array.isArray(body.files) ? body.files : []).filter(f => f && (IMAGE_TYPES.includes(f.type) || f.type === PDF_TYPE)).slice(0, MAX_FILES);
  if (!messageId || !files.length) return res.status(400).json({ ok: false, error: 'no message id or no PDF/photo' });

  let canon = {};
  try { canon = await readCanon({ timeoutMs: 9000 }); } catch { /* duplicates just won't be flagged */ }
  // One stable id per email, so a re-sent email is never filed twice.
  const mid = crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 16);
  const out = [];
  for (const [i, f] of files.entries()) {
    const bad = checkImage(f);
    if (bad) { out.push({ name: clip(f.name, 80), ok: false, error: bad }); continue; }
    try {
      const read = await readDocument({ req, file: { data: f.data, type: f.type }, canon, via: 'an email' });
      const id = `${mid}-${i}`;
      const data = { id, subject: clip(body.subject, 160), receivedAt: clip(body.receivedAt, 40), name: clip(f.name, 80), ...read };
      const text = `DOCUMENT FROM EMAIL: ${data.subject || data.name || 'a document'}. ${read.summary}\nDATA: ${JSON.stringify(data)}`.slice(0, 45000);
      await write('note', { text, tag: INBOX_TAG }, 'inbox', { opId: `inbox-${id}` });
      out.push({ name: data.name, ok: true, id, rows: read.results.length, urgency: read.urgency });
    } catch (e) {
      console.error(JSON.stringify({ inboxFailed: e.code || 'ERR', message: String(e.message).slice(0, 200) }));
      out.push({ name: clip(f.name, 80), ok: false, error: 'could not read it' });
    }
  }
  return res.status(out.some(x => x.ok) ? 200 : 502).json({ ok: out.some(x => x.ok), files: out });
}
