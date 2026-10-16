// End-to-end simulation of a family using Beside, against the real
// apps-script/Code.gs (run in the emulator) and the real API handlers.
// Invented data only. Usage: node scripts/simulate.mjs
//
// 1. Seeds a month of earlier history, written the way the app writes it.
// 2. Drives the HTTP API as Kimon's phone and as the family's phone, with the
//    same payloads the screens send.
// 3. Reads the raw sheet tabs back and checks every row, cell by cell.
// 4. Checks the knowledge bank and Leffy's context grew from all of it,
//    including entries older than the last 20 notes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { TAGS, noteText, symptomLevel, checkLevel, monitor, BODY_CHECK, noteData } from '../public/js/kimon-model.js';
import { bank, bankText, bankSize, factNote } from '../public/js/knowledge-bank.js';
import { historyEvents } from '../public/js/record-model.js';
import { patientContext } from '../api/ask.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 3100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`, SHEET = `http://127.0.0.1:${PORT + 1}`;
const DAY = 86400000, now = Date.now();
const ago = d => new Date(now - d * DAY).toISOString();

/* ---------- 1. a month of earlier history ---------- */
const seedNotes = [];
const note = (d, by, tag, text) => seedNotes.push({ tsUTC: ago(d), by, tag, text });
for (let d = 30; d >= 1; d--) {
  if (d % 4) note(d, 'Kimon', TAGS.habit, noteText(`HABIT: A 20 minute walk ${d % 7 ? 'done' : 'skipped'}`, { habit: 'A 20 minute walk', done: Boolean(d % 7) }));
  if (d % 3 === 0) note(d, 'Kimon', TAGS.meds, noteText('MEDS: taken', { meds: ['Atorvastatin 40 mg'] }));
}
note(29, 'Kimon', TAGS.talk, 'KIMON SAYS: Walked to the bakery and back, felt fine');
note(26, 'Kimon', TAGS.symptom, noteText('SYMPTOM: Dizzy or light-headed, earlier today, mild. Getting out of bed', { symptom: 'dizzy', when: 'today', severity: 'mild', note: 'Getting out of bed', level: 'soon' }));
note(20, 'Sam', 'found-out', 'FOUND OUT (G1 Example knowledge gap): His brother had a stent at 70');
note(19, 'Kimon', TAGS.symptom, noteText('SYMPTOM: Dizzy or light-headed, this week, mild', { symptom: 'dizzy', when: 'week', severity: 'mild', note: '', level: 'soon' }));
const oldAnswers = { breath: 'bit', chest: 'no', dizzy: 'once', racing: 'no', walking: 'same' };
note(14, 'Kimon', TAGS.check, noteText('BODY CHECK: breath: a bit more; chest: not at all; dizzy: once or twice; racing: not at all; walking: about the same', { answers: oldAnswers, level: checkLevel(oldAnswers) }));
note(12, 'Sam', TAGS.nudge, 'NUDGE: Proud of you');
note(10, 'Kimon', TAGS.talk, 'KIMON SAYS: Garden is looking good, a bit puffed carrying the soil');
note(9, 'Sam', 'fact', factNote({ topic: 'family', fact: 'His brother had a stent at 70 (Sep 2026)' }).text);
const seed = {
  meta: { schema: 'v1' },
  profile: { Age: '67', Sex: 'M', Medicare: 'MUST-NOT-LEAK' },
  conditions: [{ name: 'Coronary artery calcification', status: 'active', since: '2026-09', notes: 'Example only', source: 'mock', updated: '' }],
  testResults: [
    { date: '2026-09-01', test: 'CT coronary calcium score (Agatston)', result: 'Total 500 Agatston', lab: '', notes: 'mock', source: 'mock' },
    { date: '2026-08-01', test: 'Lipid studies', result: 'LDL-C 4.0 mmol/L; Non-HDL-C 5.0 mmol/L', lab: '', notes: '', source: 'mock' },
  ],
  questions: [{ id: 'Q1', question: 'Example question one for the cardiologist?', askWhom: 'cardiologist', priority: '1', status: 'open', answer: '', updated: '' }],
  gaps: [{ id: 'G1', gap: 'Example knowledge gap', whatAnswersIt: 'Ask him on a call', stepToClose: 'Raise on a call', status: 'open', updated: '' }],
  notes: seedNotes,
};
const seedFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'beside-sim-')), 'seed.json');
fs.writeFileSync(seedFile, JSON.stringify(seed));

/* ---------- 2. the app ---------- */
const server = spawn(process.execPath, [path.join(root, 'scripts', 'dev-server.mjs')], {
  env: { ...process.env, MOCK_SHEET: '1', MOCK_AI: '1', MOCK_CANON_FILE: seedFile, PORT: String(PORT), ACCESS_CODE: 'Sim-Code-1!', TZ: 'Europe/London' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes('http://')) res(); }); server.on('exit', c => rej(new Error('server exited ' + c))); });

const results = [];
const check = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

async function phone(code, persona) {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const j = await r.json();
  let cookie = r.headers.get('set-cookie').split(';')[0];
  if (persona) {
    const p = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ persona }) });
    cookie = p.headers.get('set-cookie').split(';')[0];
  }
  const call = async (p, body) => {
    const res = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    if (p === '/api/ask') return (await res.text()).trim().split('\n').map(l => JSON.parse(l));
    return { status: res.status, ...(await res.json()) };
  };
  return { login: j, call, write: (action, payload, by) => call('/api/write', { action, payload, by }) };
}

const wrong = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'kimon' }) });
const fam = await phone('sim-code-1!', 'family');
const kim = await phone('SIM-CODE-1!', 'kimon');
check('old public code "kimon" is refused', () => assert.equal(wrong.status, 401));
check('passcode works regardless of capital letters', () => { assert.equal(fam.login.ok, true); assert.equal(kim.login.ok, true); assert.equal(fam.login.askWho, true); });
const fs1 = await fam.call('/api/session'), ks1 = await kim.call('/api/session');
check('family phone is family, Kimon phone is Kimon', () => { assert.equal(fs1.role, 'family'); assert.equal(ks1.role, 'kimon'); });

const tabsBefore = await (await fetch(SHEET + '/__tabs')).json();
const canonBefore = await kim.call('/api/canon');
const bankBefore = bank(canonBefore);

// Kimon's phone, the way /me sends it
const sent = []; // [tab, row-as-expected]
const kNote = async (tag, summary, data) => {
  const text = data ? noteText(summary, data) : summary;
  sent.push(['Notes', 'Kimon', tag, text]);
  return kim.write('note', { text, tag });
};
const outs = [];
outs.push(await kNote(TAGS.habit, 'HABIT: A 20 minute walk done', { habit: 'A 20 minute walk', done: true }));
outs.push(await kNote(TAGS.meds, 'MEDS: taken', { meds: ['Atorvastatin 40 mg'] }));
const log = { symptom: 'dizzy', when: 'today', severity: 'moderate', note: 'Standing up from the couch, lasted a few seconds' };
log.level = symptomLevel(log);
outs.push(await kNote(TAGS.symptom, `SYMPTOM: Dizzy or light-headed, earlier today, moderate. ${log.note}`, log));
const answers = { breath: 'no', chest: 'no', dizzy: 'more', racing: 'no', walking: 'same' };
const checkText = BODY_CHECK.map(x => `${x.id}: ${(x.opts.find(o => o[0] === answers[x.id]) || [, 'not sure'])[1].toLowerCase()}`).join('; ');
outs.push(await kNote(TAGS.check, `BODY CHECK: ${checkText}`, { answers, level: checkLevel(answers) }));
outs.push(await kNote(TAGS.talk, 'KIMON SAYS: Feeling good, walked to the shops and back'));
outs.push(await kNote(TAGS.seen, 'Seen the nudge ♥'));
// Kimon says he is someone else: still attributed to him
const spoof = await kim.write('note', { text: 'KIMON SAYS: testing the name', tag: TAGS.talk }, 'Mum');
sent.push(['Notes', 'Kimon', TAGS.talk, 'KIMON SAYS: testing the name']);
// Kimon photographs a result and saves what was read
const photo = await kim.call('/api/photo', { image: { type: 'image/jpeg', data: 'A'.repeat(400) } });
for (const r of photo.results.filter(x => !x.duplicate)) {
  outs.push(await kim.write('testResult', { date: r.date, test: r.test, result: r.result, lab: r.lab, notes: r.notes }));
  sent.push(['TestResults', r.date, r.test, r.result, r.lab, r.notes, 'Kimon']);
}

// The family's phone, the way the family app sends it
const fNote = async (tag, text) => { sent.push(['Notes', 'Sam', tag, text]); return fam.write('note', { text, tag }, 'Sam'); };
outs.push(await fNote(TAGS.nudge, 'NUDGE: Did you take your tablets?'));
const ci = { chest: 'none', breath: 'on-exertion', walking: 'same', energy: 'lower', tablets: 'yes', mood: 'ok' };
const ciOut = await fam.write('checkin', { answers: ci, notes: 'Dizzy twice this week' }, 'Sam');
const plan = { habits: [{ text: 'A 20 minute walk', on: true }, { text: 'Stand up slowly, count to three', on: true }], meds: [{ name: 'Atorvastatin 40 mg', when: 'evening' }], checkDay: 0 };
outs.push(await fam.write('profile', { key: 'care_plan', value: JSON.stringify(plan) }, 'Sam'));
const qAdd = await fam.write('question', { question: 'Should he have a lying and standing blood pressure check?', askWhom: 'GP', priority: '2' }, 'Sam');
outs.push(qAdd, await fam.write('question', { id: 'Q1', status: 'answered', answer: 'Cardiology will decide after a CTCA scan' }, 'Sam'));
outs.push(await fNote('found-out', 'FOUND OUT (G1 Example knowledge gap): He takes no tablets apart from the statin'));
outs.push(await fam.write('gap', { id: 'G1', status: 'closed' }, 'Sam'));
// A conversation with Leffy that teaches him something
const t1 = await fam.call('/api/ask', { message: 'He gets dizzy when he stands up, about twice a week', thread: [], by: 'Sam', threadId: 'simthread1', rid: 'simrid1' });
const a1 = t1.find(e => e.type === 'answer');
const t2 = await fam.call('/api/ask', { message: 'A few seconds', thread: [{ role: 'user', text: 'He gets dizzy when he stands up, about twice a week' }, { role: 'leffy', text: a1.answer.reply }], by: 'Sam', threadId: 'simthread1', rid: 'simrid2' });
const t3 = await kim.call('/api/ask', { message: 'Is my calcium score bad?', thread: [], threadId: 'simthread2', rid: 'simrid3' });

/* ---------- 3. read the sheet back ---------- */
const tabs = await (await fetch(SHEET + '/__tabs')).json();
const canon = await fam.call('/api/canon');
const newRows = name => tabs[name].slice(tabsBefore[name].length);

check('every write succeeded', () => { for (const o of [...outs, spoof, ciOut]) assert.equal(o.ok, true, JSON.stringify(o)); });
check('Notes: each new row matches what the phone sent, cell by cell', () => {
  const rows = newRows('Notes').filter(r => !['concern', 'fact'].includes(r[3]));
  const want = sent.filter(s => s[0] === 'Notes');
  assert.equal(rows.length, want.length);
  rows.forEach((r, i) => {
    const [, by, tag, text] = want[i];
    assert.match(String(r[0]), /^\d{4}-\d{2}-\d{2}T/); // server timestamp, ISO
    assert.deepEqual([r[1], r[2], r[3]], [by, text, tag]);
  });
});
check('Notes: structured DATA survives the sheet exactly', () => {
  const sym = canon.notes.filter(n => n.tag === TAGS.symptom).pop();
  assert.deepEqual(noteData(sym), log);
  const bc = canon.notes.filter(n => n.tag === TAGS.check).pop();
  assert.deepEqual(noteData(bc).answers, answers);
});
check('Kimon cannot be logged as someone else', () => {
  const r = newRows('Notes').find(x => x[2] === 'KIMON SAYS: testing the name');
  assert.equal(r[1], 'Kimon');
});
check('CheckIns: columns in schema order, verdict computed by the sheet', () => {
  const [r] = newRows('CheckIns');
  assert.deepEqual(r.slice(2), ['Sam', 'none', 'on-exertion', 'same', 'lower', 'yes', 'ok', 'Changed', 'Dizzy twice this week']);
  assert.equal(ciOut.verdict, 'Changed');
});
check('TestResults: photo rows saved with units intact and attributed to Kimon', () => {
  const rows = newRows('TestResults');
  const want = sent.filter(s => s[0] === 'TestResults');
  assert.equal(rows.length, want.length);
  assert.ok(rows.length >= 2);
  rows.forEach((r, i) => {
    assert.ok(r[0] instanceof Date || /GMT/.test(String(r[0])) || typeof r[0] === 'string'); // Sheets turns the date into a date cell
    assert.deepEqual(r.slice(1).map(String), want[i].slice(2).map(String));
  });
  assert.match(String(rows.find(r => r[1] === 'LDL-C')[2]), /mmol\/L$/);
});
const again = await kim.call('/api/photo', { image: { type: 'image/jpeg', data: 'B'.repeat(400) } });
check('Re-reading the same result does not duplicate it', () => assert.ok(again.results.every(r => r.duplicate)));
check('Profile: care plan JSON round-trips exactly', () => assert.deepEqual(JSON.parse(canon.profile.care_plan), plan));
check('Questions: new question gets the next id; answer recorded', () => {
  assert.equal(qAdd.id, 'Q2');
  const q1 = canon.questions.find(q => q.id === 'Q1');
  assert.equal(q1.status, 'answered'); assert.equal(q1.answer, 'Cardiology will decide after a CTCA scan');
});
check('Changelog: every record edit is audited with who did it', () => {
  const ch = newRows('Changelog').map(r => [r[1], r[2], r[5]]);
  for (const k of [['Profile', 'care_plan', 'Sam'], ['Questions', 'Q2', 'Sam'], ['Questions', 'Q1.status', 'Sam'], ['Questions', 'Q1.answer', 'Sam'], ['KnowledgeGaps', 'G1.status', 'Sam']]) {
    assert.ok(ch.some(c => c.join('|') === k.join('|')), 'missing ' + k.join('.'));
  }
});
check('Chat: each message logged once with its reply; phones get the slim copy', () => {
  const concerns = newRows('Notes').filter(r => r[3] === 'concern');
  assert.equal(concerns.length, 3);
  assert.ok(concerns.every(r => /\nRID: simrid\d\nDATA: \{/.test(r[2])));
  assert.equal(concerns[2][1], 'Kimon');
  assert.ok(canon.notes.filter(n => n.tag === 'concern').every(n => !/DATA:/.test(n.text)));
});
check('Chat: Leffy streamed his reply and suggested next replies', () => {
  assert.ok(t1.some(e => e.type === 'delta'));
  assert.equal(t1.filter(e => e.type === 'delta').map(e => e.text).join(''), a1.answer.reply);
  assert.ok(a1.answer.replies.length >= 2);
});
check('Chat: new facts went into the knowledge bank as their own rows', () => {
  const facts = newRows('Notes').filter(r => r[3] === 'fact');
  assert.equal(facts.length, 2);
  assert.ok(t1.some(e => e.type === 'learned') && t2.some(e => e.type === 'learned'));
  assert.ok(!t3.some(e => e.type === 'learned'));
});
const rec = await fam.call('/api/answer?rid=simrid2');
check('Recovered reply matches the streamed one', () => assert.equal(rec.answer.reply, t2.find(e => e.type === 'answer').answer.reply));

/* ---------- 4. the knowledge bank grew ---------- */
const b = bank(canon), m = monitor(canon), hist = historyEvents(canon), ctx = patientContext(canon);
check('Monitor: what Kimon did this week is counted', () => {
  assert.ok(m.habitDays >= 1); assert.ok(m.medsDays >= 1);
  assert.equal(m.said[0].text, 'testing the name');
  assert.equal(m.lastCheck.level, checkLevel(answers));
});
check('Bank: dizziness timeline counts every report, old and new', () => {
  const dz = b.symptoms.find(s => s.id === 'dizzy');
  // two old logs + old body check + today's log + today's body check
  assert.equal(dz.count, 5);
  assert.deepEqual(dz.from.sort(), ['check', 'log']);
});
check('Bank: LDL trend across reports (4.0 then 2.1)', () => {
  const ldl = b.results.find(r => r.key === 'ldl');
  assert.deepEqual(ldl.values.map(v => v.value), [4, 2.1]);
  assert.equal(ldl.trend, 'down');
});
check('Bank: learned facts kept, newest first, old seed fact still there', () => {
  const t = b.facts.map(f => f.text);
  assert.ok(t.includes('Dizzy when standing up, about twice a week (Oct 2026)'));
  assert.ok(t.includes('Dizzy spells last a few seconds and pass on their own (Oct 2026)'));
  assert.ok(t.includes('His brother had a stent at 70 (Sep 2026)'));
});
check('Bank: adherence from a month of taps', () => { assert.ok(b.adherence.habit28 >= 15); assert.ok(b.adherence.meds28 >= 8); });
check('Bank: nothing is forgotten when notes pile up (oldest entry still known)', () => {
  const recent20 = canon.notes.slice(-20).map(n => n.text).join('\n');
  assert.ok(!recent20.includes('Walked to the bakery'), 'test setup: the oldest note should be outside the last 20');
  assert.match(bankText(b, 20000), /Walked to the bakery/);
});
check("Leffy's context: includes the bank, never the Medicare number", () => {
  assert.match(ctx, /## Knowledge bank/);
  assert.match(ctx, /Dizzy spells last a few seconds/);
  assert.doesNotMatch(ctx, /MUST-NOT-LEAK/);
});
check('History: photo results, symptoms, what he said, found out all appear', () => {
  const kinds = new Set(hist.map(e => e.kind));
  for (const k of ['symptom', 'note', 'found', 'checkin', 'concern', 'bloods']) assert.ok(kinds.has(k), 'missing ' + k);
});
const grew = { before: bankSize(bankBefore), after: bankSize(b), ctxBefore: bankText(bankBefore).length, ctxAfter: bankText(b).length };
check('Bank grew from this session', () => assert.ok(grew.after > grew.before));

server.kill();
const pass = results.filter(r => r[0] === 'PASS').length;
for (const r of results) console.log(`${r[0]}  ${r[1]}${r[2] ? '  -> ' + r[2] : ''}`);
console.log(`\nRows written this session: ${Object.keys(tabs).map(k => `${k} +${tabs[k].length - tabsBefore[k].length}`).filter(s => !s.endsWith('+0')).join(', ')}`);
console.log(`Knowledge bank: ${grew.before} -> ${grew.after} things known; Leffy's bank context ${grew.ctxBefore} -> ${grew.ctxAfter} chars`);
console.log(`${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
