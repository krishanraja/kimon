import test from 'node:test';
import assert from 'node:assert/strict';
import { replyStream } from '../lib/reply-stream.js';

test('reply text streams out of partial JSON, escapes included', () => {
  const full = JSON.stringify({ reply: 'Yes. He said "fine" \\ ok\nnext line ✓ 😀', urgency: 'soon' });
  for (const size of [1, 2, 3, 7, 50]) {
    const rs = replyStream();
    let out = '';
    for (let i = 0; i < full.length; i += size) out += rs.push(full.slice(i, i + size));
    assert.equal(out, 'Yes. He said "fine" \\ ok\nnext line ✓ 😀', `chunk ${size}`);
  }
});
test('unicode escapes split across chunks', () => {
  const rs = replyStream();
  const parts = ['{"reply":"caf', '\\u00', 'e9 ok"}'];
  assert.equal(parts.map(p => rs.push(p)).join(''), 'café ok');
});
test('nothing before the reply key; reset starts a new block', () => {
  const rs = replyStream();
  assert.equal(rs.push('Let me search first.'), '');
  rs.reset();
  assert.equal(rs.push('{"urgency":"soon","reply":"Hi'), 'Hi');
  assert.equal(rs.push(' there","x":1}'), ' there');
  assert.equal(rs.push('more'), '');
});
