import test from 'node:test';
import assert from 'node:assert/strict';
import { bank, bankItems, bankSize, bankText, facts, factNote, series, symptomTimeline } from '../public/js/knowledge-bank.js';
import { TAGS, noteText } from '../public/js/kimon-model.js';

const now = new Date('2026-10-16T10:00:00Z');
const n = (ts, tag, text, by = 'Kimon') => ({ tsUTC: ts, by, tag, text });

test('facts: newest wording wins, duplicates collapse, replaced facts retire', () => {
  const notes = [
    n('2026-10-01T00:00:00Z', 'fact', factNote({ topic: 'symptom', fact: 'Dizzy twice a week' }).text, 'Sam'),
    n('2026-10-02T00:00:00Z', 'fact', factNote({ topic: 'symptom', fact: 'dizzy twice a week.' }).text, 'Sam'),
    n('2026-10-03T00:00:00Z', 'fact', factNote({ topic: 'medicine', fact: 'Takes atorvastatin 20 mg' }).text, 'Sam'),
    n('2026-10-04T00:00:00Z', 'fact', factNote({ topic: 'medicine', fact: 'Takes atorvastatin 40 mg', replaces: 'Takes atorvastatin 20 mg' }).text, 'Sam'),
    n('2026-10-05T00:00:00Z', 'fact', 'FACT: hidden', 'claude-test'),
  ];
  const f = facts({ notes });
  assert.deepEqual(f.map(x => x.text), ['Takes atorvastatin 40 mg', 'dizzy twice a week.']);
  assert.equal(f[0].topic, 'medicine');
});
test('factNote: unknown topics fall back to other, text is clipped', () => {
  const { tag, text } = factNote({ topic: 'nonsense', fact: 'x'.repeat(400) });
  assert.equal(tag, 'fact');
  assert.match(text, /"topic":"other"/);
  assert.equal(text.split('\n')[0].length, 'FACT: '.length + 300);
});
test('series: every value per measure over time, across report formats', () => {
  const s = series([
    { date: 'Sat Aug 01 2026 00:00:00 GMT+0100 (British Summer Time)', test: 'Lipid studies', result: 'LDL-C 4.0 mmol/L' },
    { date: '2026-10-12', test: 'LDL-C', result: '2.1 mmol/L' },
    { date: 'not a date', test: 'LDL-C', result: '9' },
  ]);
  assert.deepEqual(s.ldl.map(v => v.value), [4, 2.1]);
});
test('symptom timeline: logs and body checks, with a trend', () => {
  const notes = [
    n('2026-08-20T00:00:00Z', TAGS.symptom, noteText('SYMPTOM: x', { symptom: 'dizzy', severity: 'mild' })),
    n('2026-10-10T00:00:00Z', TAGS.symptom, noteText('SYMPTOM: x', { symptom: 'dizzy', severity: 'bad' })),
    n('2026-10-12T00:00:00Z', TAGS.check, noteText('BODY CHECK: x', { answers: { dizzy: 'more', chest: 'no', breath: 'no', racing: 'no', walking: 'less' } })),
  ];
  const t = symptomTimeline({ notes }, now);
  const dz = t.find(s => s.id === 'dizzy');
  assert.equal(dz.count, 3); assert.equal(dz.worst, 2); assert.equal(dz.trend, 'more often');
  assert.equal(t.find(s => s.id === 'walking').label, 'Walking less far');
});
test('bank: empty record is safe and says so', () => {
  const b = bank({}, now);
  assert.equal(bankSize(b), 0);
  assert.equal(bankText(b), '(nothing logged yet)');
});
test('bank text stays within budget and keeps the most important groups first', () => {
  const notes = Array.from({ length: 300 }, (_, i) => n(new Date(now - i * 3600000).toISOString(), TAGS.talk, `KIMON SAYS: message number ${i} with some words`));
  notes.push(n('2026-10-01T00:00:00Z', 'fact', factNote({ topic: 'family', fact: 'Brother had a stent' }).text, 'Sam'));
  const text = bankText(bank({ notes }, now), 1200);
  assert.ok(text.length <= 1250);
  assert.match(text, /Brother had a stent/);
});
test('bank items read in plain English', () => {
  const b = bank({ testResults: [{ date: '2026-08-01', test: 'LDL-C', result: '4.0' }, { date: '2026-10-12', test: 'LDL-C', result: '2.1 mmol/L' }] }, now);
  const g = bankItems(b).find(x => x.title === 'Results over time');
  assert.match(g.items[0], /LDL cholesterol: 4 → 2\.1 mmol\/L \(down\), latest 12 Oct 2026/);
});
test('forget: a removed fact disappears until it is learned again', async () => {
  const { forgetNote } = await import('../public/js/knowledge-bank.js');
  const notes = [
    n('2026-10-01T00:00:00Z', 'fact', factNote({ topic: 'medicine', fact: 'Takes aspirin daily' }).text, 'Sam'),
    n('2026-10-02T00:00:00Z', 'fact', forgetNote('Takes aspirin daily', 'medicine').text, 'Sam'),
  ];
  assert.deepEqual(facts({ notes }), []);
  notes.push(n('2026-10-03T00:00:00Z', 'fact', factNote({ topic: 'medicine', fact: 'Takes aspirin daily' }).text, 'Sam'));
  assert.equal(facts({ notes }).length, 1);
});
