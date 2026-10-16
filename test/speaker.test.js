import test from 'node:test';
import assert from 'node:assert/strict';
import { speakerContext } from '../api/ask.js';
import { person, parseRoster } from '../public/js/people.js';

// Invented names; the real list is in Vercel env PEOPLE.
const roster = parseRoster([{ name: 'Kimon', aliases: ['Kim'], patient: true }, { name: 'Sam', aliases: ['Sammy'], calls: 'Dad' }, { name: 'Alex', calls: 'Kim' }]);
const ctx = (role, who, calls) => speakerContext(person({ role, who, calls, roster }));

test('Leffy talks to Kimon directly', () => {
  const t = ctx('kimon', 'Sam');
  assert.match(t, /Talk to him directly as "you"/);
  assert.match(t, /Never call him "your dad"/);
});
test('someone who calls him Dad hears "your dad"', () => {
  const t = ctx('family', 'Sammy');
  assert.match(t, /^Sam, a family member/);
  assert.match(t, /refer to Kimon as "your dad" \(for example "your dad's calcium score"\)/);
  assert.match(t, /"Dad's calcium score"/);
});
test('someone who calls him Kim hears "Kim"', () => {
  const t = ctx('family', 'Alex');
  assert.match(t, /refer to Kimon as "Kim" \(for example "Kim's calcium score"\)/);
  assert.doesNotMatch(t, /your dad"/);
});
test('someone not on the list never hears "your dad" by default', () => {
  const t = ctx('family', 'Jo');
  assert.match(t, /Refer to Kimon as "Kimon"/);
  assert.match(t, /Do not call him "your dad"/);
  assert.match(ctx('family', 'Jo', 'Papou'), /refer to Kimon as "your papou"/);
});
