import { requireAuth } from '../lib/auth.js';
import { readCanon } from '../lib/sheet.js';

// Saved chat replies carry their full answer data for recovery (/api/answer).
// Phones only need the summary lines, so the payload stays small as the
// history grows.
export function slim(canon) {
  return { ...canon, notes: (canon.notes || []).map(n => n.tag === 'concern' ? { ...n, text: String(n.text).split('\nRID: ')[0] } : n) };
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    const canon = await readCanon();
    return res.status(200).json(slim(canon));
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message, code: e.code || 'SHEET_ERROR' });
  }
}
