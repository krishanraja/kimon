// "For my doctor", the daily-tablets rule and the after-appointment question.
// Invented data only: this repo is public.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyMeds } from '../public/js/meds-model.js';
import { bpInsight } from '../public/js/metrics.js';
import { quickChecks, todaysQuestion, quickNote } from '../public/js/quick-checks.js';
import { doctorSummary, summaryLines, nextQuestions, doctorText, appointment } from '../public/js/for-doctor.js';
import { noteText } from '../public/js/kimon-model.js';

const NOW = new Date('2026-11-23T02:00:00Z'); // 23 Nov, 1pm in Melbourne
const bp = (sys, dia, at) => ({ date: at.slice(0, 10), test: 'Blood pressure', result: `${sys}/${dia} mmHg`, notes: 'Typed in on the phone', source: 'Kimon', measuredAt: at, id: 'r-' + at });
const note = (tag, summary, data, ts) => ({ tsUTC: ts, by: 'Kimon', tag, text: noteText(summary, data) });
const days = (from, n, f) => Array.from({ length: n }, (_, i) => f(new Date(new Date(from).getTime() + i * 86400000).toISOString(), i));

function canon() {
  return {
    profile: { next_appointment: '2026-11-10', full_name: 'Invented Person', medicare: '0000 00000 0', address: '1 Nowhere St', phone: '0400 000 000', dob: '1900-01-01' },
    testResults: [
      { date: '2026-08-20', test: 'Fasting lipid studies', result: 'Total 6.9, LDL-C 4.2, HDL-C 1.4', lab: 'Lab', source: 'referral_scan' },
      { date: '2026-09-10', test: 'CT coronary artery calcium score', result: 'Total 800 Agatston (LM 100, LAD 500, LCx 120, RCA 80)', lab: 'Clinic', source: 'referral_scan' },
      bp(134, 86, '2026-11-01T22:00:00.000Z'), bp(132, 84, '2026-11-02T22:00:00.000Z'),
      ...days('2026-11-04T22:00:00.000Z', 18, (at, i) => bp(118 + (i % 5), 76 + (i % 4), at)),
    ],
    medications: [
      { name: 'Atorvastatin', dose: '20 mg', frequency: 'Night', status: 'current' },
      { name: 'Aspirin (low dose)', dose: '100 mg', frequency: 'Morning', status: 'current' },
      { name: 'Fish oil', dose: '', frequency: '', status: 'current' },
      { name: 'Medicine T', dose: '50 mg', frequency: 'Before a test or procedure', status: 'current' },
      { name: 'Medicine B', dose: '32 mg', frequency: 'Night', status: 'stopped' },
    ],
    changelog: [
      { ts: '2026-11-03T23:00:00.000Z', tab: 'Medications', key: 'Atorvastatin', old: '(none)', new: 'current', by: 'Kimon' },
      { ts: '2026-11-03T23:10:00.000Z', tab: 'Medications', key: 'Medicine B.status', old: 'current', new: 'stopped', by: 'Kimon' },
      { ts: '2026-11-16T10:00:00.000Z', tab: 'Medications', key: 'Medicine T.status', old: 'stopped', new: 'current', by: 'Kimon' },
    ],
    questions: [
      { id: 'Q5', question: 'What cholesterol target should we aim for, and when is it rechecked?', status: 'answered', answer: 'LDL-C:<1.8 mmol/L' },
      { id: 'Q7', question: 'How often should he be reviewed, and by whom (GP vs cardiologist)?', status: 'open', answer: '' },
      { id: 'Q9', question: 'What is the single most important thing?', status: 'answered', answer: 'Non invasive angiography on 10/11' },
    ],
    gaps: [{ id: 'G4', gap: 'Cardiology appointment date', status: 'in-progress' }],
    notes: [
      ...days('2026-11-04T22:01:00.000Z', 18, at => note('meds-taken', 'MEDS: taken', { meds: ['Atorvastatin'] }, at)),
      note('body-check', 'BODY CHECK', { answers: { breath: 'no', chest: 'no', dizzy: 'no', racing: 'no', walking: 'same' } }, '2026-11-21T22:00:00.000Z'),
    ],
    checkins: [],
  };
}

test('only medicines taken every day are ticked as daily tablets', () => {
  const names = dailyMeds(canon()).map(m => m.name);
  assert.deepEqual(names, ['Atorvastatin', 'Aspirin (low dose)', 'Fish oil']);
  assert.ok(!names.includes('Medicine T'));
});

test('a medicine taken only before a test is not the change blood pressure is compared across', () => {
  const s = bpInsight(canon(), NOW).sinceChange;
  assert.equal(s.name, 'Medicine B');
  assert.equal(s.what, 'stopped');
});

test('a passed appointment raises one question first, and "still waiting" asks again a week later', () => {
  const c = canon();
  const q = todaysQuestion(c, NOW);
  assert.equal(q.id, 'appt:2026-11-10');
  assert.match(q.q, /10 Nov/);
  const yes = q.opts.find(o => o.k === 'results');
  assert.equal(yes.then, 'photo');
  assert.deepEqual(yes.writes, [{ action: 'gap', payload: { id: 'G4', status: 'closed' } }]);
  assert.deepEqual(q.opts.find(o => o.k === 'moved').writes, []); // the sheet refuses an empty date

  const n = quickNote(q, q.opts.find(o => o.k === 'waiting'));
  c.notes.push(note(n.tag, n.summary, n.data, '2026-11-22T22:00:00.000Z'));
  assert.ok(!quickChecks(c, NOW).some(x => x.id === q.id), 'not asked again the next day');
  const later = quickChecks(c, new Date('2026-11-30T02:00:00Z')).find(x => x.id === q.id);
  assert.match(later.q, /come back yet/);
});

test('an upcoming appointment asks nothing', () => {
  const c = canon(); c.profile.next_appointment = '2026-12-01';
  assert.ok(!quickChecks(c, NOW).some(x => x.id.startsWith('appt:')));
  assert.equal(appointment(c, NOW).status, 'upcoming');
});

test('his own numbers add up, facts only, with no personal details', () => {
  const s = doctorSummary(canon(), NOW);
  assert.equal(s.bp.n, 20);
  assert.equal(s.tablets.of, 18); // 5 to 22 Nov; today not ticked yet, so not counted
  assert.equal(s.tablets.yes, 18);
  assert.equal(s.checks.length, 1);
  assert.equal(s.checks[0].clear, true);
  const text = doctorText(canon(), NOW);
  for (const pii of ['Invented Person', '0000 00000 0', 'Nowhere', '0400 000 000', '1900']) assert.ok(!text.includes(pii), pii);
  assert.match(text, /Since Medicine B was stopped on 4 Nov/);
  assert.match(text, /CT angiogram on 10 Nov 2026: result not recorded yet/);
  assert.ok(summaryLines(s).every(l => !/Medicine T/.test(l) || /Before a test/.test(l)));
});

test('the next questions come from gaps in his record, and go once asked', () => {
  const c = canon();
  const ids = nextQuestions(c, NOW).map(q => q.id);
  assert.deepEqual(ids, ['ctca', 'ldl', 'category', 'bp:Medicine B', 'review']);
  const ldl = nextQuestions(c, NOW).find(q => q.id === 'ldl');
  assert.match(ldl.ask, /under 1\.8/);
  assert.match(ldl.ask, /4\.2/);
  assert.match(nextQuestions(c, NOW)[0].why, /left main \(100\) and LAD \(500\)/);
  // Never advice to change a medicine on his own.
  for (const q of nextQuestions(c, NOW)) assert.ok(!/\b(stop|start|take)\s+(your|the)\b/i.test(q.ask + q.why), q.id);

  c.notes.push(note('doctor-asked', 'ASKED', { id: 'ldl' }, '2026-11-23T01:00:00.000Z'));
  assert.ok(!nextQuestions(c, NOW).some(q => q.id === 'ldl'));
  // A result on or after the appointment closes the scan question.
  c.testResults.push({ date: '2026-11-10', test: 'CT coronary angiogram', result: 'Invented finding', source: 'Kimon' });
  assert.ok(!nextQuestions(c, NOW).some(q => q.id === 'ctca'));
  // A re-check after the statin closes the cholesterol question when on goal.
  c.notes = c.notes.filter(n => n.tag !== 'doctor-asked');
  c.testResults.push({ date: '2026-12-01', test: 'LDL-C', result: '1.6 mmol/L', source: 'Kimon' });
  assert.ok(!nextQuestions(c, new Date('2026-12-02T02:00:00Z')).some(q => q.id === 'ldl'));
});

test('what\'s new: shown once per item, and never on a brand-new phone', async () => {
  const { unseen, WHATS_NEW } = await import('../public/js/whats-new.js');
  const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
  const fresh = mem();
  assert.deepEqual(unseen(fresh, { hasHistory: false }), []);
  assert.deepEqual(unseen(fresh, { hasHistory: true }), [], 'marked seen on the new phone, so never shown later');
  const his = mem();
  assert.equal(unseen(his).length, WHATS_NEW.length);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(unseen(broken).length, WHATS_NEW.length, 'blocked storage still works, once per session');
});

test('a scan report: findings set an urgency floor the model cannot lower', async () => {
  const { findingFloor, cleanMeaning, RESULTS_RULES } = await import('../lib/photo.js');
  assert.match(RESULTS_RULES, /Impression/);
  assert.match(RESULTS_RULES, /CAD-RADS/);
  const moderate = [{ test: 'LAD stenosis', result: '50-69% (moderate)' }, { test: 'Left main stenosis', result: '<25% (minimal)' }];
  assert.equal(findingFloor(moderate).level, 'routine');
  assert.equal(findingFloor([{ test: 'LAD stenosis', result: '70-99% (severe)' }]).level, 'soon');
  assert.equal(findingFloor([{ test: 'Left main stenosis', result: '50-69%' }]).level, 'urgent');
  assert.equal(findingFloor([{ test: 'CAD-RADS', result: 'CAD-RADS 4A' }]).level, 'soon');
  // The model says routine; the findings say soon: soon wins. The model can raise, never lower.
  assert.equal(cleanMeaning({ urgency: 'routine', meaning: 'x' }, [{ test: 'LAD stenosis', result: '70-99%' }]).urgency, 'soon');
  assert.equal(cleanMeaning({ urgency: 'urgent', meaning: 'x' }, moderate).urgency, 'urgent');
  assert.equal(cleanMeaning({ urgency: 'routine' }, moderate, 'urgent').urgency, 'urgent', 'red-flag rules set a floor too');
  assert.equal(cleanMeaning({ urgency: 'nonsense' }, moderate).urgency, 'routine');
});

test('a scan result after the appointment closes the scan question; Leffy\'s suggested question appears', () => {
  const c = canon();
  c.testResults.push({ date: '2026-11-10', test: 'LAD stenosis', result: '50-69% (moderate)', source: 'Kimon', notes: 'From a photo, read by AI' });
  c.notes.push(note('result-read', 'Photo of a result: A CT angiogram report.', { summary: 'A CT angiogram report.', meaning: 'Moderate narrowing.', askNext: 'Do I need a test of blood flow?', urgency: 'soon' }, '2026-11-22T22:00:00.000Z'));
  assert.equal(appointment(c, NOW).status, 'results-in');
  const ids = nextQuestions(c, NOW).map(q => q.id);
  assert.ok(!ids.includes('ctca'));
  const r = nextQuestions(c, NOW).find(q => q.id.startsWith('result:'));
  assert.equal(r.ask, 'Do I need a test of blood flow?');
  assert.match(r.why, /Moderate narrowing/);
});

test('the medicines line keeps a stopped daily medicine and leaves out test-only and short courses', () => {
  const c = canon();
  c.medications.find(m => m.name === 'Medicine T').status = 'stopped';
  c.medications.push({ name: 'Medicine C', dose: '', frequency: '', status: 'stopped' });
  const line = summaryLines(doctorSummary(c, NOW)).find(l => l.startsWith('Medicines:'));
  assert.match(line, /Medicine B \(stopped/);
  assert.ok(!/Medicine T/.test(line));
  assert.ok(!/Medicine C/.test(line));
});

test('his review question covers the family\'s open review question', () => {
  const q = nextQuestions(canon(), NOW).find(x => x.id === 'review');
  assert.deepEqual(q.covers, ['Q7']);
});

test('a cardiologist review in his record retires the questions it answers', () => {
  const c = canon();
  c.testResults.push({ date: '2026-11-17', test: 'Cardiologist review (invented)', result: 'Non-obstructive coronary artery disease. Plan: statin up; continue current BP management.', lab: 'Example Cardiology', source: 'Kimon' });
  c.notes.push(note('result-read', 'Letter', { summary: 's', meaning: 'm', askNext: 'When is my next cholesterol test?' }, '2026-11-22T22:00:00.000Z'));
  const ids = nextQuestions(c, NOW).map(q => q.id);
  assert.ok(!ids.includes('category'));
  assert.ok(ids.includes('aspirin'));
  assert.match(nextQuestions(c, NOW).find(q => q.id === 'aspirin').ask, /non-obstructive coronary artery disease/);
  assert.ok(!ids.some(i => i.startsWith('bp:')), 'BP answered by the review');
  assert.ok(!ids.some(i => i.startsWith('result:')), 'cholesterol asked once');
  assert.ok(ids.includes('ldl'));
});
