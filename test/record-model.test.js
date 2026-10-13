import test from 'node:test';
import assert from 'node:assert/strict';
import { plainTask, taskGroup, taskHow, historyEvents } from '../public/js/record-model.js';

const qs = [{ id: 'Q2', question: 'Does he need more tests?' }, { id: 'Q4', question: 'What medicines?' }, { id: 'Q5', question: 'What target?' }];

test('task grouping by who acts', () => {
  assert.equal(taskGroup({ whatAnswersIt: 'Ask him directly on next call' }), 'dad');
  assert.equal(taskGroup({ whatAnswersIt: 'GP blood tests', stepToClose: 'Ask GP whether done' }), 'gp');
  assert.equal(taskGroup({ whatAnswersIt: 'Cardiologist/GP decision', stepToClose: 'Ask cardiologist Q4/Q5' }), 'waiting');
  assert.equal(taskGroup({ whatAnswersIt: 'Referral triage outcome', stepToClose: 'ask GP for expected timeframe' }), 'waiting');
});
test('plain title and Q-id rewriting', () => {
  assert.equal(plainTask({ gap: 'Blood pressure readings (clinic and home)' }), 'His blood pressure');
  assert.equal(plainTask({ gap: 'Degree of narrowing - calcium score measures burden' }), 'Degree of narrowing');
  assert.equal(taskHow({ stepToClose: 'Ask cardiologist Q2; await referral' }, qs), 'Ask at cardiology "Does he need more tests?". Wait for the cardiology referral');
  assert.match(taskHow({ stepToClose: 'Ask cardiologist Q4/Q5' }, qs), /"What medicines\?"/);
});
test('history: merges duplicate concerns, hides test rows, newest first, no raw dates', () => {
  const ev = historyEvents({
    testResults: [{ date: 'Mon Feb 09 2026 00:00:00 GMT+0000 (Greenwich Mean Time)', test: 'CT coronary artery calcium score', result: 'Total 612.4 Agatston (LM 40, LAD 400)' }],
    notes: [
      { tsUTC: '2026-03-01T10:00:00Z', by: 'A', tag: 'concern', text: 'CONCERN: is he ok\nURGENCY: soon\nANSWER: Probably. See GP.' },
      { tsUTC: '2026-03-02T10:00:00Z', by: 'A', tag: 'concern', text: 'CONCERN: is he ok\nURGENCY: urgent\nANSWER: Today.' },
      { tsUTC: '2026-03-03T10:00:00Z', by: 'claude-test', tag: 'concern', text: 'CONCERN: hidden' },
    ],
  });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].kind, 'concern'); assert.equal(ev[0].count, 2); assert.equal(ev[0].urgency, 'urgent');
  assert.equal(ev[1].detail, 'score 612 (severe)');
  assert.equal(ev[1].date, '9 Feb 2026');
});
test('history: saved answer data never leaks into the timeline', () => {
  const ev = historyEvents({ notes: [{ tsUTC: '2026-03-01T10:00:00Z', by: 'A', tag: 'concern', text: 'CONCERN: is he ok\nURGENCY: soon\nANSWER: See his GP this week.\nRID: abc123\nDATA: {"answer":{}}' }] });
  assert.equal(ev[0].answer, 'See his GP this week.');
  assert.doesNotMatch(JSON.stringify(ev), /RID|DATA/);
});
