import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeHintEcho } from '../api/transcribe.js';

test('detects the hint echoed back on silence', () => {
  assert.equal(looksLikeHintEcho("Talking about Dad's heart: his calcium score, the cardiologist, statins, LDL cholesterol"), true);
  assert.equal(looksLikeHintEcho('calcium score, cardiologist, statins'), true);
});
test('real questions that use the same words pass', () => {
  assert.equal(looksLikeHintEcho('What should we ask the doctor about his calcium score?'), false);
  assert.equal(looksLikeHintEcho('He gets dizzy when he stands up and his heart races'), false);
  assert.equal(looksLikeHintEcho('Should he be on a statin?'), false);
});
