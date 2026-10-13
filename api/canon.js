import { requireAuth } from '../lib/auth.js';
import { readCanon } from '../lib/sheet.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    const canon = await readCanon();
    return res.status(200).json(canon);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message, code: e.code || 'SHEET_ERROR' });
  }
}
