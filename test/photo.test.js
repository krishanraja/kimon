import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanResults, checkImage } from '../lib/photo.js';
import { coerce } from '../scripts/gas-emulator.mjs';
import { slim } from '../api/canon.js';

test('photo rows: cleaned, dated, flagged as AI-read, duplicates spotted', () => {
  const canon = { testResults: [{ date: 'Mon Oct 12 2026 00:00:00 GMT+0100 (British Summer Time)', test: 'LDL-C', result: '2.1 mmol/L' }] };
  const rows = cleanResults([
    { date: '2026-10-12', test: 'LDL-C', result: '2.1 mmol/L', lab: 'Lab', notes: 'H' },
    { date: '12/10/2026', test: 'HDL-C', result: '1.2 mmol/L' },
    { test: '', result: '5' },
    null,
  ], canon, '2026-10-16');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].duplicate, true);
  assert.equal(rows[1].date, '2026-10-16'); assert.equal(rows[1].dateGuessed, true);
  assert.match(rows[1].notes, /From a photo, read by AI/);
  assert.match(rows[1].notes, /date not on photo/);
});
test('photo size limits', () => {
  assert.equal(checkImage(null), null);
  assert.ok(checkImage({ data: 'abc' }));
  assert.ok(checkImage({ data: 'A'.repeat(3_600_000) }));
  assert.equal(checkImage({ data: 'A'.repeat(1000) }), null);
});
test('the emulator types values the way Google Sheets does', () => {
  assert.equal(coerce('500'), 500);
  assert.equal(coerce('2.10'), 2.1);
  assert.equal(coerce('2.1 mmol/L'), '2.1 mmol/L');
  assert.equal(coerce('007'), '007');
  assert.ok(coerce('2026-10-12') instanceof Date);
  assert.equal(coerce('2026-10-12T01:00:00.000Z'), '2026-10-12T01:00:00.000Z');
});
test('phones get chat notes without the stored answer data', () => {
  const s = slim({ notes: [{ tag: 'concern', text: 'CONCERN: q\nURGENCY: soon\nANSWER: a\nRID: r1\nDATA: {"big":1}' }, { tag: 'symptom-log', text: 'SYMPTOM: x\nDATA: {"a":1}' }] });
  assert.equal(s.notes[0].text, 'CONCERN: q\nURGENCY: soon\nANSWER: a');
  assert.match(s.notes[1].text, /DATA/);
});
