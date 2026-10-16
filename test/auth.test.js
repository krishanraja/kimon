import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'x'.repeat(40);
const auth = await import('../lib/auth.js');
const cookieFrom = res => ({ headers: { cookie: res.h['Set-Cookie'].split(';')[0] } });
const fakeRes = () => ({ h: {}, setHeader(k, v) { this.h[k] = v; } });

test('no passcode in the environment means nobody gets in', () => {
  delete process.env.ACCESS_CODE; delete process.env.KIMON_CODE;
  assert.equal(auth.configured(), false);
  assert.equal(auth.checkCode('kimon'), null);
  assert.equal(auth.checkCode('heart'), null);
  assert.equal(auth.checkCode(''), null);
});
test('the passcode works with any capitalisation; the old public codes do not', () => {
  process.env.ACCESS_CODE = 'Test-Code-9!';
  assert.equal(auth.checkCode('Test-Code-9!'), 'a');
  assert.equal(auth.checkCode(' test-code-9! '), 'a');
  assert.equal(auth.checkCode('kimon'), null);
  assert.equal(auth.checkCode('heart'), null);
  assert.equal(auth.checkCode('Test-Code-9'), null);
});
test('persona rides in the session; changing the passcode logs everyone out', () => {
  process.env.ACCESS_CODE = 'Test-Code-9!';
  const r = fakeRes(); auth.issueCookie(r, 'kimon', 'a');
  assert.deepEqual(auth.session(cookieFrom(r)), { role: 'kimon', via: 'a' });
  const f = fakeRes(); auth.issueCookie(f, 'family', 'a');
  assert.equal(auth.isAuthed(cookieFrom(f)), 'family');
  process.env.ACCESS_CODE = 'Something-else';
  assert.equal(auth.session(cookieFrom(r)), null);
  process.env.ACCESS_CODE = 'Test-Code-9!';
});
test('a tampered session is rejected', () => {
  const r = fakeRes(); auth.issueCookie(r, 'family', 'a');
  const [payload, sig] = r.h['Set-Cookie'].split(';')[0].split('=')[1].split('.');
  const p = JSON.parse(Buffer.from(payload, 'base64url'));
  const forged = Buffer.from(JSON.stringify({ ...p, r: 'kimon' })).toString('base64url');
  assert.equal(auth.session({ headers: { cookie: `kimon_session=${forged}.${sig}` } }), null);
});
test('optional Kimon code opens straight as Kimon', () => {
  process.env.KIMON_CODE = 'yiasou';
  assert.equal(auth.checkCode('YIASOU'), 'k');
  const r = fakeRes(); auth.issueCookie(r, 'kimon', 'k');
  assert.equal(auth.isAuthed(cookieFrom(r)), 'kimon');
  delete process.env.KIMON_CODE;
  assert.equal(auth.isAuthed(cookieFrom(r)), false);
});
test('Kimon is always the author of what he adds', () => {
  assert.equal(auth.byFor('kimon', 'Mum'), 'Kimon');
  assert.equal(auth.byFor('family', 'Sam'), 'Sam');
  assert.equal(auth.byFor('family', ''), 'app');
});
