// One current medicines list. Chat facts and the family's older list never
// become "confirmed"; a correction reaches Leffy; unknown stays unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetApi } from '../scripts/gas-emulator.mjs';
import { currentMeds, medsContext, needsCheck } from '../public/js/meds-model.js';
import { factNote } from '../public/js/knowledge-bank.js';
import { patientContext } from '../api/ask.js';

const api = () => createSheetApi({ secret: 's' });
const post = (s, action, payload, opId, by = 'Kimon') => s.post({ secret: 's', action, payload, by, opId });
const read = s => s.get({ secret: 's', action: 'read' });

test('nothing recorded stays unknown, never "takes nothing"', () => {
  const m = currentMeds({});
  assert.equal(m.empty, true);
  assert.match(medsContext({}), /Do not assume he takes none/);
});

test('a correction persists with its author and reaches Leffy first', () => {
  const s = api();
  post(s, 'medication', { name: 'Medicine A (synthetic)', dose: '10 mg', frequency: 'night', status: 'current' }, 'op-1');
  post(s, 'medication', { name: 'Medicine A (synthetic)', dose: '20 mg' }, 'op-2');
  const c = read(s);
  const m = currentMeds(c);
  assert.equal(m.current.length, 1);
  assert.equal(m.current[0].dose, '20 mg');
  assert.equal(m.current[0].by, 'Kimon');
  const log = c.changelog.filter(x => x.tab === 'Medications');
  assert.deepEqual(log.map(x => [x.old, x.new]).pop(), ['10 mg', '20 mg']);
  const ctx = patientContext(c);
  assert.ok(ctx.indexOf('Medicine A (synthetic) 20 mg') < ctx.indexOf('## Profile'));
});

test('an older chat fact does not override a newer correction', () => {
  const s = api();
  const old = factNote({ fact: 'He is not taking a cholesterol tablet', topic: 'medicine' });
  s.tabs.Notes.appendRow(['2026-10-01T00:00:00.000Z', 'Sam', old.text, old.tag]);
  post(s, 'medication', { name: 'Medicine A (synthetic)', dose: '10 mg', status: 'current' }, 'op-1');
  const c = read(s);
  const m = currentMeds(c);
  assert.equal(m.current[0].name, 'Medicine A (synthetic)');
  assert.equal(m.chat[0].stale, true);
  const ctx = medsContext(c);
  assert.ok(ctx.indexOf('Medicine A (synthetic)') < ctx.indexOf('not taking a cholesterol tablet'));
  assert.match(ctx, /older than the latest list change/);
});

test('the family\'s older list shows as "not sure yet" until confirmed', () => {
  const profile = { care_plan: JSON.stringify({ habits: [], meds: [{ name: 'Medicine C (synthetic)', when: 'morning' }] }) };
  const m = currentMeds({ profile });
  assert.equal(m.current.length, 0);
  assert.equal(m.unconfirmed[0].from, 'family-list');
  assert.equal(needsCheck({ profile }), true);
});

test('a rename keeps the old name as history', () => {
  const s = api();
  post(s, 'medication', { name: 'Medcine B', dose: '100 mg', status: 'current' }, 'op-1');
  post(s, 'medication', { name: 'Medicine B (synthetic)', previousName: 'Medcine B', dose: '100 mg', status: 'current' }, 'op-2');
  const c = read(s);
  assert.equal(c.medications.length, 2);
  assert.deepEqual(currentMeds(c).current.map(x => x.name), ['Medicine B (synthetic)']);
  assert.ok(c.changelog.some(x => /superseded/.test(x.new)));
});

test('stopped and unconfirmed are separate; bad status is refused', () => {
  const s = api();
  post(s, 'medication', { name: 'Medicine A (synthetic)', status: 'stopped' }, 'op-1');
  post(s, 'medication', { name: 'Medicine D (synthetic)', status: 'unconfirmed' }, 'op-2');
  assert.equal(post(s, 'medication', { name: 'X', status: 'maybe' }, 'op-3').ok, false);
  const m = currentMeds(read(s));
  assert.deepEqual([m.current.length, m.stopped.length, m.unconfirmed.length], [0, 1, 1]);
});

test('"taken today" never changes the list, and the list never claims a dose was taken', () => {
  const s = api();
  post(s, 'medication', { name: 'Medicine A (synthetic)', status: 'current' }, 'op-1');
  post(s, 'note', { text: 'MEDS: taken', tag: 'meds-taken' }, 'op-2');
  const c = read(s);
  assert.equal(currentMeds(c).current.length, 1);
  assert.match(medsContext(c), /NOT evidence he took today's dose/);
});

test('confirming the list is right clears the check until the list changes', () => {
  const s = api();
  post(s, 'medication', { name: 'Medicine A (synthetic)', status: 'current' }, 'op-1');
  assert.equal(needsCheck(read(s)), true);
  s.tabs.Notes.appendRow([new Date(Date.now() + 86400000).toISOString(), 'Kimon', 'MEDS: list is right', 'meds-confirmed']);
  assert.equal(needsCheck(read(s)), false);
});

test('a fact learned earlier the same day as a correction is still out of date', () => {
  const s = api();
  const f = factNote({ fact: 'Not on a statin', topic: 'medicine' });
  s.tabs.Notes.appendRow([new Date(Date.now() - 60000).toISOString(), 'Sam', f.text, f.tag]);
  post(s, 'medication', { name: 'Medicine A (synthetic)', status: 'current' }, 'op-1');
  assert.equal(currentMeds(read(s)).chat[0].stale, true);
});

test("a chat-learned medicine fact reaches Leffy once, marked unconfirmed", () => {
  const s = api();
  const f = factNote({ fact: 'Takes a cholesterol tablet at night', topic: 'medicine' });
  s.tabs.Notes.appendRow([new Date().toISOString(), 'Sam', f.text, f.tag]);
  const ctx = patientContext(read(s));
  assert.equal(ctx.split('Takes a cholesterol tablet at night').length - 1, 1);
  assert.match(ctx, /Picked up in chat \(unconfirmed/);
});

test('medicine writes only accept listed names, strengths and times', async () => {
  const { checkMedWrite } = await import('../public/js/med-catalog.js');
  assert.equal(checkMedWrite({ name: 'Atorvastatin', dose: '10 mg', frequency: 'Night', status: 'unconfirmed' }), null);
  assert.equal(checkMedWrite({ name: 'Atorvastatn', dose: '10 mg' }), 'medicine not on the list');
  assert.equal(checkMedWrite({ name: 'Atorvastatin', dose: '15 mg' }), 'strength not on the list');
  assert.equal(checkMedWrite({ name: 'Atorvastatin', frequency: 'whenever' }), 'time not on the list');
  assert.equal(checkMedWrite({ name: 'Old typed name', status: 'stopped', existing: true }), null);
});

test('a listed medicine named in chat becomes "not sure yet"; vague or unlisted names do not', async () => {
  const { medsFromFacts } = await import('../api/ask.js');
  const got = medsFromFacts([
    { fact: 'Kimon takes atorvastatin 10 mg at night', topic: 'medicine' },
    { fact: 'He is on a statin', topic: 'medicine' },
    { fact: 'Takes aspirin every morning', topic: 'medicine' },
    { fact: 'Walks daily', topic: 'lifestyle' },
  ], { medications: [{ name: 'Aspirin (low dose)', status: 'current' }] });
  assert.deepEqual(got, [{ name: 'Atorvastatin', dose: '10 mg', frequency: '', status: 'unconfirmed' }]);
});
