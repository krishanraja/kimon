// Server-side proxy to the Apps Script API bound to the canon Google Sheet.
// The secret never reaches the browser.
const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbx2St8EsY9-VzrOldutPJnP-1lrxW7erN14cYzjhD91Yg0lgSGiyVgagFVdSVsLecXvtA/exec';

export const WRITE_ACTIONS = ['checkin', 'note', 'testResult', 'question', 'gap', 'profile', 'condition', 'medication'];

function cfg() {
  const url = process.env.SHEET_API_URL || DEFAULT_URL;
  const secret = process.env.SHEET_API_SECRET;
  if (!secret) {
    const e = new Error('SHEET_API_SECRET is not set in Vercel');
    e.code = 'NO_SECRET';
    throw e;
  }
  return { url, secret };
}

async function parse(r) {
  const text = await r.text();
  // Trust the body, not the status: Apps Script errors can come back as HTML.
  try { return JSON.parse(text); }
  catch { throw new Error(`sheet API returned non-JSON (HTTP ${r.status}): ${text.slice(0, 120)}`); }
}

export async function readCanon({ timeoutMs = 12000 } = {}) {
  const { url, secret } = cfg();
  const r = await fetch(`${url}?action=read&secret=${encodeURIComponent(secret)}`,
    { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  const body = await parse(r);
  if (!body.ok) throw new Error('sheet API: ' + (body.error || 'unknown error'));
  return body;
}

export async function write(action, payload, by = 'app', { timeoutMs = 15000 } = {}) {
  if (!WRITE_ACTIONS.includes(action)) throw new Error('action not allowed: ' + action);
  const { url, secret } = cfg();
  // text/plain avoids a CORS preflight; Apps Script answers POST with a 302
  // that fetch follows as GET to the echo URL, which carries the result.
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, action, by, payload }),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await parse(r);
  if (!body.ok) throw new Error('sheet API: ' + (body.error || 'unknown error'));
  return body;
}
