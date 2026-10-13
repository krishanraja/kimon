import { requireAuth } from '../lib/auth.js';
import { write, WRITE_ACTIONS } from '../lib/sheet.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { action, payload, by } = req.body || {};
  if (!WRITE_ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: 'unknown action' });
  try {
    const out = await write(action, payload || {}, String(by || 'app').slice(0, 40));
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message, code: e.code || 'SHEET_ERROR' });
  }
}
