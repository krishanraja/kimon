// Access-code login with a signed, HttpOnly session cookie.
// Two roles: family (ACCESS_CODE, default "kimon") and Kimon himself
// (KIMON_CODE, default "heart"). SESSION_SECRET lives in Vercel env only.
import crypto from 'node:crypto';

const COOKIE = 'kimon_session';
const MAX_AGE = 60 * 60 * 24 * 365; // one year: stay logged in

function accessCode() { return (process.env.ACCESS_CODE || 'kimon').trim().toLowerCase(); }
function kimonCode() { return (process.env.KIMON_CODE || 'heart').trim().toLowerCase(); }
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET not configured');
  return s;
}
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(data) { return b64url(crypto.createHmac('sha256', secret()).update(data).digest()); }
// Rotating ACCESS_CODE invalidates every existing session.
// Family tag unchanged from before roles existed, so existing logins stay valid.
function codeTag(role = 'family') { return sign(role === 'kimon' ? 'code:kimon:' + kimonCode() : 'code:' + accessCode()).slice(0, 12); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Returns the role the code unlocks, or null.
export function checkCode(input) {
  const c = String(input || '').trim().toLowerCase();
  if (safeEqual(c, accessCode())) return 'family';
  if (safeEqual(c, kimonCode())) return 'kimon';
  return null;
}

export function issueCookie(res, role = 'family') {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iat: now, exp: now + MAX_AGE, r: role, c: codeTag(role) }));
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

// Returns 'family' | 'kimon' for a valid session, otherwise false.
export function isAuthed(req) {
  try {
    const token = readCookie(req);
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const role = p.r === 'kimon' ? 'kimon' : 'family';
    return p.exp > Date.now() / 1000 && p.c === codeTag(role) ? role : false;
  } catch { return false; }
}

// Returns the role if the request may proceed; otherwise has already responded.
export function requireAuth(req, res) {
  const role = isAuthed(req);
  if (role) return role;
  res.status(401).json({ ok: false, error: 'login required' });
  return false;
}
