// Access-code login with a signed, HttpOnly session cookie.
// One family passcode (ACCESS_CODE, Vercel env only: this repo is public, so
// no code ever has a default here). After the code, the phone says who is
// using it: Kimon lands on his own home screen, everyone else on the family
// app. An optional KIMON_CODE logs straight in as Kimon.
import crypto from 'node:crypto';

const COOKIE = 'kimon_session';
const MAX_AGE = 60 * 60 * 24 * 365; // one year: stay logged in
export const ROLES = ['family', 'kimon'];

const envCode = name => String(process.env[name] || '').trim().toLowerCase() || null;
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET not configured');
  return s;
}
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(data) { return b64url(crypto.createHmac('sha256', secret()).update(data).digest()); }
// Ties a session to the code that opened it: changing a code logs out every
// phone that used it. via 'a' = family passcode, 'k' = Kimon's own code.
function codeTag(via) {
  const code = via === 'k' ? envCode('KIMON_CODE') : envCode('ACCESS_CODE');
  return code ? sign((via === 'k' ? 'code:kimon:' : 'code:') + code).slice(0, 12) : null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function configured() { return Boolean(envCode('ACCESS_CODE')); }

// Which code was entered: 'a' (family passcode), 'k' (Kimon's code), or null.
// Case-insensitive, so a capital letter added by the keyboard still works.
export function checkCode(input) {
  const c = String(input || '').trim().toLowerCase();
  const a = envCode('ACCESS_CODE'), k = envCode('KIMON_CODE');
  if (!c) return null;
  if (a && safeEqual(c, a)) return 'a';
  if (k && safeEqual(c, k)) return 'k';
  return null;
}

export function issueCookie(res, role = 'family', via = 'a') {
  const now = Math.floor(Date.now() / 1000);
  const r = ROLES.includes(role) ? role : 'family';
  const payload = b64url(JSON.stringify({ iat: now, exp: now + MAX_AGE, r, v: via, c: codeTag(via) }));
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

// The verified session, or null: { role: 'family' | 'kimon', via: 'a' | 'k' }.
export function session(req) {
  try {
    const token = readCookie(req);
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const via = p.v === 'k' ? 'k' : 'a';
    const tag = codeTag(via);
    if (!tag || p.c !== tag || !(p.exp > Date.now() / 1000)) return null;
    return { role: p.r === 'kimon' ? 'kimon' : 'family', via };
  } catch { return null; }
}

// Returns 'family' | 'kimon' for a valid session, otherwise false.
export function isAuthed(req) { return session(req)?.role || false; }

// Returns the role if the request may proceed; otherwise has already responded.
export function requireAuth(req, res) {
  const role = isAuthed(req);
  if (role) return role;
  res.status(401).json({ ok: false, error: 'login required' });
  return false;
}

// Who a write is attributed to. Kimon's entries are always "Kimon".
export function byFor(role, by) {
  return role === 'kimon' ? 'Kimon' : String(by || 'app').slice(0, 40);
}
