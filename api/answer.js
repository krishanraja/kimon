// Recover a reply the phone missed (connection dropped mid-wait).
import { requireAuth } from '../lib/auth.js';
import { readCanon } from '../lib/sheet.js';
import { CONTACTS } from '../public/js/triage.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const q = req.query?.rid ?? new URL(req.url, 'http://x').searchParams.get('rid');
  const rid = String(q || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  if (!rid) return res.status(400).json({ ok: false, error: 'missing rid' });
  try {
    const canon = await readCanon({ timeoutMs: 12000 });
    const note = (canon.notes || []).filter(n => String(n.text).includes(`\nRID: ${rid}\n`)).pop();
    if (!note) return res.status(404).json({ ok: false, pending: true });
    const text = String(note.text);
    const data = JSON.parse(text.slice(text.indexOf('\nDATA: ') + 7));
    const concern = (text.match(/^CONCERN:\s*([\s\S]*?)\nURGENCY:/) || [, ''])[1];
    const answer = { replies: [], learned: [], results: [], ...data.answer };
    answer.reply ||= answer.headline || '';
    return res.status(200).json({ ok: true, rid, threadId: data.threadId || '', concern, answer, source: data.source, contacts: CONTACTS[answer.urgency], saved: true, recovered: true, triage: { level: answer.urgency, reasons: [] } });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e.message).slice(0, 160) });
  }
}
