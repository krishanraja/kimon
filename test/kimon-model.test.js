import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlan, todaysHabit, symptomLevel, checkLevel, monitor, pendingNudge, noteText, TAGS, melbDay } from '../public/js/kimon-model.js';

test('care plan: defaults when missing or broken, reads saved JSON', () => {
  assert.equal(readPlan({}).habits.length, 2);
  assert.equal(readPlan({ care_plan: 'not json' }).habits.length, 2);
  const p = readPlan({ care_plan: JSON.stringify({ habits: [{ text: 'Walk', on: true }], meds: [{ name: 'Atorvastatin', when: 'evening' }], checkDay: 3 }) });
  assert.equal(p.meds[0].name, 'Atorvastatin'); assert.equal(p.checkDay, 3);
});
test('one habit a day, rotating through active ones', () => {
  const plan = { habits: [{ text: 'A', on: true }, { text: 'B', on: false }, { text: 'C', on: true }] };
  const a = todaysHabit(plan, new Date(2026, 9, 14)), b = todaysHabit(plan, new Date(2026, 9, 15));
  assert.notEqual(a, b); assert.ok(['A', 'C'].includes(a));
  assert.equal(todaysHabit({ habits: [] }), null);
});
test('symptom urgency: chest now is an emergency, dizzy is this week, swelling same day', () => {
  assert.equal(symptomLevel({ symptom: 'chest', when: 'now', severity: 'mild' }), 'emergency');
  assert.equal(symptomLevel({ symptom: 'dizzy', when: 'today', severity: 'mild' }), 'soon');
  assert.equal(symptomLevel({ symptom: 'swelling', when: 'week', severity: 'mild' }), 'urgent');
  assert.equal(symptomLevel({ symptom: 'breath', when: 'now', severity: 'bad' }), 'emergency');
  assert.equal(symptomLevel({ symptom: 'other', when: 'week', severity: 'mild', note: 'he passed out' }), 'emergency');
});
test('body check level', () => {
  assert.equal(checkLevel({ breath: 'no', chest: 'no', dizzy: 'no', racing: 'no', walking: 'same' }), 'routine');
  assert.equal(checkLevel({ breath: 'bit', chest: 'no', dizzy: 'once', racing: 'no', walking: 'same' }), 'soon');
  assert.equal(checkLevel({ breath: 'no', chest: 'once', dizzy: 'no', racing: 'no', walking: 'same' }), 'urgent');
});
test('monitor: alerts, habit days, what he said, nudges', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  const notes = [
    { tsUTC: '2026-10-12T01:00:00Z', by: 'Kimon', tag: TAGS.habit, text: noteText('HABIT: Walk done', { done: true }) },
    { tsUTC: '2026-10-13T01:00:00Z', by: 'Kimon', tag: TAGS.habit, text: noteText('HABIT: Walk done', { done: true }) },
    { tsUTC: '2026-10-13T02:00:00Z', by: 'Kimon', tag: TAGS.symptom, text: noteText('SYMPTOM: Chest pain, right now, mild', { symptom: 'chest', when: 'now', severity: 'mild', level: 'emergency' }) },
    { tsUTC: '2026-10-13T03:00:00Z', by: 'Kimon', tag: TAGS.talk, text: 'KIMON SAYS: feeling good today' },
    { tsUTC: '2026-10-01T03:00:00Z', by: 'Kimon', tag: TAGS.symptom, text: noteText('SYMPTOM: old', { symptom: 'dizzy', level: 'soon' }) },
    { tsUTC: '2026-10-13T04:00:00Z', by: 'Fam', tag: TAGS.nudge, text: 'NUDGE: Proud of you' },
  ];
  const m = monitor({ notes }, now);
  assert.equal(m.alerts.length, 1); assert.equal(m.alerts[0].level, 'emergency');
  assert.equal(m.logs.length, 1); assert.equal(m.habitDays, 2);
  assert.equal(m.said[0].text, 'feeling good today'); assert.equal(m.checkDue, true);
  assert.equal(pendingNudge({ notes }).text, 'Proud of you');
  assert.equal(pendingNudge({ notes: [...notes, { tsUTC: '2026-10-13T05:00:00Z', tag: TAGS.seen, text: 'seen' }] }), null);
});
test('Melbourne day boundary', () => {
  assert.equal(melbDay('2026-10-13T14:30:00Z'), '2026-10-14'); // 1:30am AEDT next day
});
