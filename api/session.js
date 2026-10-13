import { isAuthed } from '../lib/auth.js';
import { aiProvider } from '../lib/ai.js';

export default function handler(req, res) {
  let role = false;
  try { role = isAuthed(req); } catch { /* SESSION_SECRET missing */ }
  if (!role) return res.status(401).json({ ok: false, authed: false });
  return res.status(200).json({
    ok: true, authed: true, role,
    sheetConfigured: Boolean(process.env.SHEET_API_SECRET),
    ai: aiProvider(req) || 'none',
  });
}
