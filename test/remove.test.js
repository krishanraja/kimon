// An entry logged by mistake can be removed: hidden everywhere, kept in the sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetApi } from '../scripts/gas-emulator.mjs';
import { liveNotes, removalNote, monitor, noteText, weeklyKimonEntries } from '../public/js/kimon-model.js';
import { historyEvents } from '../public/js/record-model.js';
import { bank } from '../public/js/knowledge-bank.js';
import { slim } from '../api/canon.js';
import { patientContext } from '../api/ask.js';

const api = () => createSheetApi({ secret: 's' });
const post = (s, payload, by = 'Kimon') => s.post({ secret: 's', action: 'note', payload, by });
const read = s => s.get({ secret: 's', action: 'read' });
const symptom = nid => ({ tag: 'symptom-log', text: noteText('SYMPTOM: Chest pain or pressure, right now, bad', { symptom: 'chest', when: 'now', severity: 'bad', level: 'emergency', nid }) });

test('a removed symptom disappears from every reader but stays in the sheet', () => {
  const s = api();
  post(s, symptom('n1'));
  post(s, { tag: 'kimon-says', text: 'KIMON SAYS: hello' });
  const before = read(s);
  assert.equal(monitor(before).alerts.length, 1);
  post(s, removalNote(before.notes.find(n => n.tag === 'symptom-log')));
  const raw = read(s);
  assert.equal(raw.notes.length, 3); // nothing deleted from the sheet
  const c = slim(raw);
  assert.equal(c.notes.some(n => n.tag === 'symptom-log' || n.tag === 'removed'), false);
  assert.equal(c.notes.some(n => n.tag === 'kimon-says'), true);
  assert.equal(monitor(c).alerts.length, 0);
  assert.equal(monitor(c).logs.length, 0);
  assert.equal(historyEvents(c).some(e => /chest/i.test(e.detail || e.title || '')), false);
  assert.equal(bank(c).symptoms.length, 0);
  assert.doesNotMatch(patientContext(c), /Chest pain/);
  assert.equal(weeklyKimonEntries(c, new Date(Date.now() - 86400000)).byKind['note:symptom-log'], undefined);
});

test('an older entry without an id is removed by its server time', () => {
  const notes = [{ tsUTC: '2026-11-03T10:00:00.000Z', by: 'Kimon', tag: 'body-check', text: 'BODY CHECK: x' }];
  const r = { ...removalNote(notes[0]), tsUTC: '2026-11-04T10:00:00.000Z', by: 'Sam' };
  assert.equal(liveNotes([...notes, r]).length, 0);
});

test('a removal can only hide symptom logs and body checks', () => {
  const said = { tsUTC: 't1', by: 'Kimon', tag: 'kimon-says', text: 'KIMON SAYS: hi' };
  const r = { tag: 'removed', tsUTC: 't2', text: noteText('REMOVED', { tag: 'kimon-says', removes: 't1' }) };
  assert.deepEqual(liveNotes([said, r]), [said]);
});
