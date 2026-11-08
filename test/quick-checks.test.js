// Quick questions: each loose end becomes one question with one-tap
// answers, each answer makes the right writes, and nothing is asked twice.
// Invented data only: this repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quickChecks, quickNote, QUICK_TAG } from '../public/js/quick-checks.js';
import { noteText, monitor, tabletDays } from '../public/js/kimon-model.js';
import { adherence } from '../public/js/knowledge-bank.js';
import { checkMedWrite } from '../public/js/med-catalog.js';
import { createSheetApi } from '../scripts/gas-emulator.mjs';

const NOW = new Date('2026-11-08T02:00:00Z'); // Sunday 8 Nov, Melbourne
const bp = at => ({ date: at.slice(0, 10), test: 'Blood pressure', result: '120/80 mmHg', notes: 'Typed in on the phone', source: 'Kimon', measuredAt: at, id: 'r-' + at });
const canon = () => ({
  medications: [
    { name: 'Medicine Q', dose: '', frequency: 'Night', status: 'current' },
    { name: 'Metoprolol', dose: '50 mg', frequency: 'When needed', status: 'current' },
    { name: 'Candesartan', dose: '', frequency: 'Night', status: 'stopped' },
  ],
  changelog: [{ ts: '2026-11-04T00:01:00Z', tab: 'Medications', key: 'Candesartan.status', old: 'current', new: 'stopped', by: 'Kimon' }],
  notes: [
    { tsUTC: '2026-11-03T23:35:00Z', by: 'Kimon', tag: 'found-out', text: 'FOUND OUT (G2 What medicines he takes): I take Metoprolol before the scan, Vitamin D capsules and a short Solone course.' },
    { tsUTC: '2026-11-04T00:04:00Z', by: 'Kimon', tag: 'meds-taken', text: noteText('MEDS: taken', { meds: ['Medicine Q'] }) },
  ],
  gaps: [{ id: 'G4', gap: 'Cardiology appointment date', status: 'open' }, { id: 'G1', gap: 'Something else', status: 'open' }],
  questions: [
    { id: 'Q4', question: 'What medication changes are you recommending, and why?', status: 'open' },
    { id: 'Q7', question: 'How often should he be reviewed, and by whom (GP vs cardiologist)?', status: 'open' },
    { id: 'Q1', question: 'Something already answered', status: 'answered', answer: 'x' },
  ],
  testResults: ['2026-11-03T23:00:00Z', '2026-11-04T22:00:00Z', '2026-11-05T22:00:00Z', '2026-11-06T22:00:00Z', '2026-11-07T22:00:00Z'].map(bp),
  profile: {},
});

test('each loose end in the record becomes one quick question', () => {
  const ids = quickChecks(canon(), NOW).map(c => c.id);
  assert.deepEqual(ids, [
    'med-when:Metoprolol',
    'mentioned:Prednisolone', // "Solone" is a brand of it
    'mentioned:Vitamin D (colecalciferol)',
    'gap:G4', 'q:Q4', 'q:Q7',
    'tablets:2026-11-05,2026-11-06,2026-11-07', // 4 Nov ticked, today not asked
  ]);
});

test('every question has two to four one-tap answers in plain words', () => {
  for (const c of quickChecks(canon(), NOW)) {
    assert.ok(c.opts.length >= 2 && c.opts.length <= 4, c.id);
    for (const o of c.opts) assert.ok(o.label.length <= 40, o.label);
    assert.ok(!/—/.test(c.q));
  }
});

test('the medicine answers pass the server gate', () => {
  for (const c of quickChecks(canon(), NOW)) for (const o of c.opts) for (const w of o.writes) {
    if (w.action === 'medication') assert.equal(checkMedWrite(w.payload), null, `${c.id} ${o.k}`);
  }
});

test('the medicine-changes answer offers the change on his list', () => {
  const q4 = quickChecks(canon(), NOW).find(c => c.id === 'q:Q4');
  assert.equal(q4.opts[0].label, 'Only Candesartan stopped');
  assert.equal(q4.opts[0].writes[0].payload.status, 'answered');
  assert.equal(q4.opts.find(o => o.k === 'later').writes.length, 0);
});

test('answering one removes it, and nothing is asked twice', () => {
  const c = canon();
  const first = quickChecks(c, NOW)[0];
  const n = quickNote(first, first.opts[1]);
  c.notes.push({ tsUTC: NOW.toISOString(), by: 'Kimon', tag: n.tag, text: noteText(n.summary, n.data) });
  assert.equal(n.tag, QUICK_TAG);
  assert.ok(!quickChecks(c, NOW).some(x => x.id === first.id));
  // A question settled elsewhere (the family answered it) is not asked either.
  c.questions[0].status = 'answered';
  assert.ok(!quickChecks(c, NOW).some(x => x.id === 'q:Q4'));
});

test('"Yes, every day" for missed tablet ticks counts on those days for the family and Leffy', () => {
  const c = canon();
  const t = quickChecks(c, NOW).find(x => x.kind === 'tablets');
  const w = t.opts[0].writes[0].note;
  c.notes.push({ tsUTC: NOW.toISOString(), by: 'Kimon', tag: w.tag, text: noteText(w.summary, w.data) });
  assert.deepEqual([...tabletDays(c.notes, 'Kimon')].sort(), ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(monitor(c, NOW).medsDays, 4);
  assert.equal(adherence(c, NOW).meds7, 4);
  assert.ok(!quickChecks(c, NOW).some(x => x.kind === 'tablets'));
});

test('one-tap answers write through the real sheet script', () => {
  const s = createSheetApi({ secret: 's', seed: { gaps: [{ id: 'G4', gap: 'Cardiology appointment date', whatAnswersIt: '', stepToClose: '', status: 'open', updated: '' }], questions: [{ id: 'Q7', question: 'How often should he be reviewed?', askWhom: 'cardiologist', priority: '3', status: 'open', answer: '', updated: '' }], medications: [{ name: 'Metoprolol', dose: '50 mg', frequency: 'When needed', started: '', status: 'current', source: 'app', updated: '' }] } });
  const post = (action, payload, opId) => s.post({ secret: 's', action, payload, by: 'Kimon', opId });
  assert.equal(post('gap', { id: 'G4', status: 'closed' }, 'o1').ok, true);
  assert.equal(post('question', { id: 'Q7', status: 'answered', answer: 'Every 6 months (Kimon, 8 Nov)' }, 'o2').ok, true);
  assert.equal(post('medication', { name: 'Metoprolol', dose: '50 mg', frequency: 'Before a test or procedure', status: 'current' }, 'o3').ok, true);
  const c = s.get({ secret: 's', action: 'read' });
  assert.equal(c.gaps[0].status, 'closed');
  assert.equal(c.questions[0].answer, 'Every 6 months (Kimon, 8 Nov)');
  assert.equal(c.medications[0].frequency, 'Before a test or procedure');
  assert.ok(c.changelog.some(x => x.key === 'Metoprolol.frequency' && x.by === 'Kimon'));
});
