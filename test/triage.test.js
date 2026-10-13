import test from 'node:test';
import assert from 'node:assert/strict';
import { triage } from '../public/js/triage.js';

const cases = [
  ['He has chest pain right now and it has been 15 minutes', 'emergency'],
  ['crushing pressure in his chest and he is sweating', 'emergency'],
  ['he passed out in the kitchen', 'emergency'],
  ['he cannot catch his breath sitting on the couch', 'emergency'],
  ['his face is drooping and his speech is slurred', 'emergency'],
  ['pain going down his left arm', 'emergency'],
  ['his chest gets tight when he walks up the hill, goes away when he rests', 'urgent'],
  ['his breathlessness is getting worse this week', 'urgent'],
  ['his blood pressure was 185/100 this morning', 'urgent'],
  ['his ankles are swollen', 'urgent'],
  ['heart racing for 20 minutes and he felt dizzy', 'urgent'],
  ['he gets dizzy for a few seconds when he stands up', 'soon'],
  ['he gets a bit puffed on the stairs sometimes', 'soon'],
  ['what does his calcium score mean', 'routine'],
  ['should he eat more fish', 'routine'],
];
for (const [text, want] of cases) {
  test(`${want}: ${text}`, () => assert.equal(triage(text).level, want));
}

test('chest pain at rest is an emergency', () => assert.equal(triage('chest pressure while resting on the couch').level, 'emergency'));
test('chest pain woke him up', () => assert.equal(triage('chest pain woke him up last night').level, 'emergency'));
