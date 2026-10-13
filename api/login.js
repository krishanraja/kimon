import { checkCode, issueCookie, clearCookie } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'DELETE') { clearCookie(res); return res.status(200).json({ ok: true }); }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const code = (req.body && req.body.code) || '';
  const role = checkCode(code);
  if (!role) {
    await new Promise(r => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ ok: false, error: 'That code is not right' });
  }
  issueCookie(res, role);
  return res.status(200).json({ ok: true, role });
}
