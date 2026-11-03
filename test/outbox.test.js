import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../public/js/outbox.js';
import { createSheetApi } from '../scripts/gas-emulator.mjs';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const reply = (status, body = { ok: status < 400 }) => ({ status, ok: status < 400, json: async () => body });

// A fake server backed by the real Code.gs, so dedupe is the real dedupe.
function server() {
  const sheet = createSheetApi({ secret: 's' });
  let mode = 'up';
  const fetchFn = async (url, opts) => {
    const b = JSON.parse(opts.body);
    if (mode === 'offline') throw new TypeError('Failed to fetch');
    if (mode === 'auth') return reply(401);
    const out = sheet.post({ secret: 's', action: b.action, payload: b.payload, by: 'Kimon', opId: b.opId });
    if (mode === 'lost-reply') throw new DOMException('timed out', 'TimeoutError'); // write landed, reply lost
    return out.ok ? reply(200, out) : reply(502, { ok: false, error: 'sheet API: ' + out.error });
  };
  return { sheet, fetchFn, set: m => { mode = m; }, rows: () => sheet.get({ secret: 's', action: 'read' }).testResults };
}
const bp = id => ({ id, sys: '128', dia: '82', measuredAt: '2026-11-03T20:40:00.000Z' });

test('saved only when the server confirms', async () => {
  const s = server(); const ob = createOutbox({ storage: mem(), fetchFn: s.fetchFn });
  assert.equal((await ob.send('reading', bp('r1'))).status, 'saved');
  assert.equal(ob.count(), 0);
  assert.equal(s.rows().length, 1);
});

test('offline keeps it on the phone, then sends once', async () => {
  const s = server(); const storage = mem(); const ob = createOutbox({ storage, fetchFn: s.fetchFn });
  s.set('offline');
  assert.equal((await ob.send('reading', bp('r1'))).status, 'queued');
  assert.equal(s.rows().length, 0);
  // reopening the app: a fresh outbox over the same storage still has it
  const again = createOutbox({ storage, fetchFn: s.fetchFn });
  assert.equal(again.count(), 1);
  s.set('up');
  assert.deepEqual(await again.flush(), { saved: 1, rejected: 0, auth: false, left: 0 });
  assert.equal(s.rows().length, 1);
});

test('a timeout after the write landed does not duplicate on retry', async () => {
  const s = server(); const ob = createOutbox({ storage: mem(), fetchFn: s.fetchFn });
  s.set('lost-reply');
  assert.equal((await ob.send('reading', bp('r1'))).status, 'queued'); // honest: we do not know
  s.set('up');
  await ob.flush(); await ob.flush();
  assert.equal(s.rows().length, 1);
});

test('double taps with the same opId write once', async () => {
  const s = server(); const ob = createOutbox({ storage: mem(), fetchFn: s.fetchFn });
  await Promise.all([ob.send('reading', bp('r1'), 'op-same'), ob.send('reading', bp('r1'), 'op-same')]);
  assert.equal(s.rows().length, 1);
});

test('a lost login keeps the entry until after login', async () => {
  const s = server(); const ob = createOutbox({ storage: mem(), fetchFn: s.fetchFn });
  s.set('auth');
  assert.equal((await ob.send('reading', bp('r1'))).status, 'auth');
  assert.equal(ob.count(), 1);
  s.set('up');
  await ob.flush();
  assert.equal(s.rows().length, 1);
});

test('an entry the server rejects is dropped, not retried forever', async () => {
  const s = server(); const ob = createOutbox({ storage: mem(), fetchFn: s.fetchFn });
  assert.equal((await ob.send('reading', { id: 'r1', sys: 'x', dia: '82', measuredAt: '2026-11-03T20:40:00.000Z' })).status, 'rejected');
  assert.equal(ob.count(), 0);
});

test('blocked storage is reported, never a silent loss', async () => {
  const s = server(); s.set('offline');
  const broken = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  const ob = createOutbox({ storage: broken, fetchFn: s.fetchFn });
  assert.equal((await ob.send('reading', bp('r1'))).status, 'unsafe');
});

test('an older sheet script that does not know the action keeps the entry, then sends it', async () => {
  const storage = mem(); let updated = false; let rows = 0;
  const fetchFn = async () => updated ? (rows++, reply(200, { ok: true })) : reply(502, { ok: false, error: 'sheet API: unknown action: reading' });
  const ob = createOutbox({ storage, fetchFn });
  assert.equal((await ob.send('reading', bp('r1'))).status, 'queued');
  assert.equal(ob.count(), 1);
  updated = true;
  await ob.flush();
  assert.deepEqual([ob.count(), rows], [0, 1]);
});

test('a sheet secret problem keeps the entry instead of dropping it', async () => {
  const ob = createOutbox({ storage: mem(), fetchFn: async () => reply(502, { ok: false, error: 'sheet API: bad secret' }) });
  assert.equal((await ob.send('reading', bp('r1'))).status, 'queued');
  assert.equal(ob.count(), 1);
});
