// Access-code login with a signed, HttpOnly session cookie.
// ACCESS_CODE (default "kimon") and SESSION_SECRET live in Vercel env only.
import crypto from 'node:crypto';

const COOKIE = 'kimon_session';
const MAX_AGE = 60 * 60 * 24 * 365; // one year: stay logged in

function accessCode() { return (process.env.ACCESS_CODE || 'kimon').trim().toLowerCase(); }
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET not configured');
  return s;
}
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(data) { return b64url(crypto.createHmac('sha256', secret()).update(data).digest()); }
// Rotating ACCESS_CODE invalidates every existing session.
function codeTag() { return sign('code:' + accessCode()).slice(0, 12); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkCode(input) {
  return safeEqual(String(input || '').trim().toLowerCase(), accessCode());
}

export function issueCookie(res) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iat: now, exp: now + MAX_AGE, c: codeTag() }));
  const token = payload + '.' + sign(payload);
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
}

export function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

export function isAuthed(req) {
  try {
    const token = readCookie(req);
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return p.exp > Date.now() / 1000 && p.c === codeTag();
  } catch { return false; }
}

// Returns true if the request may proceed; otherwise has already responded.
export function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  res.status(401).json({ ok: false, error: 'login required' });
  return false;
}
