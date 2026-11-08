// What Kimon's readings add up to, and that everything he adds is seen.
// Invented data only: this repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bpInsight, bpLines } from '../public/js/metrics.js';
import { monitor, weeklyKimonEntries } from '../public/js/kimon-model.js';
import { bank, bankText } from '../public/js/knowledge-bank.js';
import { checkMedWrite } from '../public/js/med-catalog.js';

const NOW = new Date('2026-11-08T02:00:00Z'); // 8 Nov, 1pm in Melbourne
const bp = (sys, dia, at) => ({ date: at.slice(0, 10), test: 'Blood pressure', result: `${sys}/${dia} mmHg`, notes: 'Typed in on the phone', source: 'Kimon', measuredAt: at, id: 'r-' + at });
const canon = () => ({
  testResults: [
    bp(130, 85, '2026-11-01T22:00:00.000Z'),
    bp(132, 86, '2026-11-02T22:00:00.000Z'),
    bp(124, 80, '2026-11-04T22:00:00.000Z'),
    bp(126, 78, '2026-11-05T22:00:00.000Z'),
    bp(122, 80, '2026-11-06T22:00:00.000Z'),
    bp(120, 76, '2026-11-07T22:00:00.000Z'),
  ],
  changelog: [
    { ts: '2026-11-04T00:00:00.000Z', tab: 'Medications', key: 'Medicine A', old: '(none)', new: 'current', by: 'Kimon' },
    { ts: '2026-11-04T00:01:00.000Z', tab: 'Medications', key: 'Candesartan.status', old: 'current', new: 'stopped', by: 'Kimon' },
    { ts: '2026-11-04T00:05:00.000Z', tab: 'Questions', key: 'Q1.status', old: 'open', new: 'answered', by: 'Kimon' },
    { ts: '2026-11-04T00:05:00.300Z', tab: 'Questions', key: 'Q1.answer', old: '', new: 'invented answer', by: 'Kimon' },
  ],
  notes: [{ tsUTC: '2026-11-04T01:00:00.000Z', by: 'Kimon', tag: 'kimon-says', text: 'KIMON SAYS: hello' }],
  checkins: [], medications: [], profile: {},
});

test('readings add up to a week average, a streak and a since-change comparison', () => {
  const b = bpInsight(canon(), NOW);
  assert.equal(b.latest.sys, 120);
  assert.equal(b.streak, 4); // 5, 6, 7, 8 Nov in Melbourne; 4 Nov's gap breaks it
  assert.equal(b.readToday, true);
  assert.equal(b.week.n, 6); // all six fall inside the last 7 days
  assert.equal(b.sinceChange.name, 'Candesartan');
  assert.equal(b.sinceChange.what, 'stopped');
  assert.deepEqual([b.sinceChange.after.n, b.sinceChange.after.sys, b.sinceChange.after.dia], [4, 123, 79]);
  assert.deepEqual([b.sinceChange.before.n, b.sinceChange.before.sys], [2, 131]);
  const lines = bpLines(b).join('\n');
  assert.match(lines, /4 days in a row/);
  assert.match(lines, /Since Candesartan was stopped on 4 Nov: 4 readings, average 123\/79 mmHg \(before: 2 readings, average 131\/86\)/);
});

test('typing the list in for the first time is not a medicine change', () => {
  const c = canon();
  c.changelog = c.changelog.filter(x => x.key !== 'Candesartan.status');
  assert.equal(bpInsight(c, NOW).sinceChange, null);
});

test('no readings, no insight, and nothing invented', () => {
  assert.equal(bpInsight({}, NOW), null);
  assert.deepEqual(bpLines(null), []);
});

test('the family sees his readings and when he was last active, not just his notes', () => {
  const m = monitor(canon(), NOW);
  assert.equal(m.bp.daysThisWeek, 6);
  // His last note was 4 Nov; his last reading was this morning.
  assert.equal(m.lastSeen, '2026-11-07T22:00:00.000Z');
});

test('Leffy gets the averages and the since-change line', () => {
  const t = bankText(bank(canon(), NOW));
  assert.match(t, /average/);
  assert.match(t, /Since Candesartan was stopped/);
});

test('the weekly count includes his record answers, once per save', () => {
  const w = weeklyKimonEntries(canon(), new Date('2026-11-01T13:00:00Z'));
  assert.equal(w.byKind['record:Questions'], 1);
  assert.equal(w.byKind.medicine, 2);
});

test('medicines he has mentioned can now be picked from the list', () => {
  assert.equal(checkMedWrite({ name: 'Vitamin D (colecalciferol)', dose: '1000 IU', frequency: 'Morning' }), null);
  assert.equal(checkMedWrite({ name: 'Prednisolone', dose: '25 mg', frequency: 'Short course' }), null);
  assert.equal(checkMedWrite({ name: 'Metoprolol', dose: '50 mg', frequency: 'Before a test or procedure' }), null);
});
