import { requireAuth, byFor } from '../lib/auth.js';
import { write, WRITE_ACTIONS } from '../lib/sheet.js';
import { checkMedWrite } from '../public/js/med-catalog.js';

export default async function handler(req, res) {
  const role = requireAuth(req, res);
  if (!role) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { action, payload, by, opId } = req.body || {};
  if (!WRITE_ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: 'unknown action' });
  if (action === 'medication') {
    const bad = checkMedWrite(payload);
    if (bad) return res.status(400).json({ ok: false, error: bad });
  }
  // Kimon can open the full dashboard, so he can do everything the family can.
  // Whatever he adds is always attributed to him.
  try {
    const { existing, ...clean } = payload || {};
    const out = await write(action, clean, byFor(role, by), { opId });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message, code: e.code || 'SHEET_ERROR' });
  }
}
