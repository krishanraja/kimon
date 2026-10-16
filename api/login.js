import { checkCode, issueCookie, clearCookie, session, configured, ROLES } from '../lib/auth.js';

// POST {code, persona?}  log in; persona 'kimon' opens his home screen.
// POST {persona}         an already logged-in phone switches who is using it.
// DELETE                 log out.
export default async function handler(req, res) {
  if (req.method === 'DELETE') { clearCookie(res); return res.status(200).json({ ok: true }); }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { code, persona } = req.body || {};
  const want = ROLES.includes(persona) ? persona : null;

  if (!code && want) {
    const s = session(req);
    if (!s) return res.status(401).json({ ok: false, error: 'login required' });
    issueCookie(res, want, s.via);
    return res.status(200).json({ ok: true, role: want });
  }

  if (!configured()) return res.status(503).json({ ok: false, error: 'The passcode is not set up yet' });
  const via = checkCode(code);
  if (!via) {
    await new Promise(r => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ ok: false, error: 'That code is not right' });
  }
  const role = via === 'k' ? 'kimon' : (want || 'family');
  issueCookie(res, role, via);
  // The family passcode is shared, so the phone is asked who is using it.
  return res.status(200).json({ ok: true, role, askWho: via === 'a' && !want });
}
