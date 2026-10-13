import test from 'node:test';
import assert from 'node:assert/strict';
import { transcript } from '../public/js/speech.js';

test('Android cumulative results do not repeat words', () => {
  assert.equal(transcript(['what', 'what should', 'what should we', 'what should we ask', 'what should we ask the doctor']), 'what should we ask the doctor');
});
test('desktop separate segments join', () => {
  assert.equal(transcript(['he gets dizzy', 'when he stands up']), 'he gets dizzy when he stands up');
});
test('mixed: new sentence after a cumulative run', () => {
  assert.equal(transcript(['is he', 'is he okay', 'and should he walk', 'and should he walk more']), 'is he okay and should he walk more');
});
test('a shorter repeat of the previous piece is dropped', () => {
  assert.equal(transcript(['what should we ask', 'what should']), 'what should we ask');
});
