// Blood pressure typed in by hand: saved once, corrected without losing
// history, and feeding the same stream every reader uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetApi } from '../scripts/gas-emulator.mjs';
import { bpSeries, extract } from '../public/js/metrics.js';
import { bank, bankText } from '../public/js/knowledge-bank.js';
import { weeklyKimonEntries } from '../public/js/kimon-model.js';
import { patientContext } from '../api/ask.js';

const api = () => createSheetApi({ secret: 's' });
const post = (sheet, action, payload, opId, by = 'Kimon') => sheet.post({ secret: 's', action, payload, by, opId });
const canon = sheet => sheet.get({ secret: 's', action: 'read' });
const reading = (id, sys, dia, at = '2026-11-03T20:40:00.000Z', extra = {}) => ({ id, sys: String(sys), dia: String(dia), measuredAt: at, ...extra });

test('a reading saves with its exact time and reads back once', () => {
  const s = api();
  assert.equal(post(s, 'reading', reading('r1', 128, 82), 'op-1').ok, true);
  const c = canon(s);
  const rows = c.testResults.filter(r => r.id === 'r1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, '128/82 mmHg');
  assert.equal(rows[0].source, 'Kimon');
  assert.equal(rows[0].measuredAt, '2026-11-03T20:40:00.000Z');
  assert.equal(rows[0].date.includes('2026') || rows[0].date.includes('Nov'), true);
  const bp = bpSeries(c.testResults).readings;
  assert.deepEqual([bp[0].sys, bp[0].dia, bp[0].exactTime], [128, 82, true]);
});

test('the same opId sent three times writes one row', () => {
  const s = api();
  const first = post(s, 'reading', reading('r1', 128, 82), 'op-x');
  const again = post(s, 'reading', reading('r1', 128, 82), 'op-x');
  s.clearCache(); // after the fast cache is gone, the Ops tab still remembers
  const third = post(s, 'reading', reading('r1', 128, 82), 'op-x');
  assert.equal(first.ok && again.ok && third.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(third.duplicate, true);
  assert.equal(canon(s).testResults.filter(r => r.id === 'r1').length, 1);
  assert.equal(s.tabs.Ops.rows.length, 2); // header + one op
});

test('a rejected write is not remembered, so a fixed retry can succeed', () => {
  const s = api();
  assert.equal(post(s, 'reading', reading('r1', 'abc', 82), 'op-bad').ok, false);
  assert.equal(s.tabs.Ops.rows.length, 1);
  assert.equal(canon(s).testResults.length, 0);
});

test('unusual but plausible numbers are saved as typed, never altered', () => {
  const s = api();
  assert.equal(post(s, 'reading', reading('r1', 82, 128), 'op-1').ok, true); // swapped: still his choice
  assert.equal(canon(s).testResults[0].result, '82/128 mmHg');
  assert.equal(post(s, 'reading', reading('r2', '12.5', 80), 'op-2').ok, false); // not a whole number
});

test('a correction replaces the reading everywhere but keeps its history', () => {
  const s = api();
  post(s, 'reading', reading('r1', 181, 84), 'op-1');
  post(s, 'reading', reading('r2', 131, 84, '2026-11-03T20:40:00.000Z', { supersedes: 'r1' }), 'op-2');
  const c = canon(s);
  assert.equal(c.testResults.length, 2); // both rows stay in the sheet
  const { readings, replaced } = bpSeries(c.testResults);
  assert.equal(readings.length, 1);
  assert.deepEqual([readings[0].sys, readings[0].corrected, readings[0].was.sys], [131, true, 181]);
  assert.equal(replaced[0].sys, 181);
  assert.equal(extract(c.testResults).bp.value, 131); // the family results card
  assert.match(bankText(bank(c)), /131\/84/);
  assert.doesNotMatch(bankText(bank(c)), /181\/84/);
});

test('"not a real reading" removes it from every view, not from the sheet', () => {
  const s = api();
  post(s, 'reading', reading('r1', 128, 82), 'op-1');
  post(s, 'reading', { id: 'r2', measuredAt: '2026-11-03T20:40:00.000Z', supersedes: 'r1', retract: true }, 'op-2');
  const c = canon(s);
  assert.equal(c.testResults.length, 2);
  assert.equal(bpSeries(c.testResults).readings.length, 0);
  assert.equal(extract(c.testResults).bp, undefined);
});

test('more readings enrich every reader in step, and context stays bounded', () => {
  const s = api();
  const day = d => `2026-10-${String(d).padStart(2, '0')}T20:30:00.000Z`;
  for (let d = 1; d <= 30; d++) post(s, 'reading', reading('r' + d, 120 + (d % 7), 78 + (d % 5), day(d)), 'op-' + d);
  for (let d = 1; d <= 30; d++) post(s, 'reading', reading('r' + d, 120 + (d % 7), 78 + (d % 5), day(d)), 'op-' + d); // all retried
  const c = canon(s);
  assert.equal(c.testResults.length, 30);
  const b = bank(c, new Date('2026-10-31T00:00:00Z'));
  assert.equal(b.bp.count, 30);
  assert.equal(b.bp.recent.length, 14);
  assert.equal(b.results.some(r => r.key === 'bp'), false); // one BP line, not two
  const ctx = patientContext(c);
  assert.match(ctx, /30 readings since/);
  assert.ok(ctx.length < 20000);
});

test('the North Star counts Kimon\'s own entries and active days', () => {
  const s = api();
  post(s, 'reading', reading('r1', 128, 82, '2026-11-02T20:40:00.000Z'), 'op-1');
  post(s, 'reading', reading('r2', 126, 80, '2026-11-03T20:40:00.000Z'), 'op-2');
  post(s, 'reading', reading('r2', 126, 80, '2026-11-03T20:40:00.000Z'), 'op-2'); // retry
  post(s, 'reading', reading('r3', 140, 90, '2026-11-03T21:40:00.000Z'), 'op-3', 'Sam'); // family
  post(s, 'note', { text: 'MEDS: taken', tag: 'meds-taken' }, 'op-4');
  const w = weeklyKimonEntries(canon(s), new Date('2026-11-01T00:00:00Z'));
  assert.equal(w.byKind.result, 2);
  assert.equal(w.activeDays >= 2, true);
});
