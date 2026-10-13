import { isAuthed } from '../lib/auth.js';
import { aiProvider } from '../lib/ai.js';

export default function handler(req, res) {
  let authed = false;
  try { authed = isAuthed(req); } catch { /* SESSION_SECRET missing */ }
  if (!authed) return res.status(401).json({ ok: false, authed: false });
  return res.status(200).json({
    ok: true, authed: true,
    sheetConfigured: Boolean(process.env.SHEET_API_SECRET),
    ai: aiProvider(req) || 'none',
  });
}
