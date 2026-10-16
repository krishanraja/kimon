// Pulls the "reply" string out of a JSON answer while the model is still
// writing it, so Leffy's words appear (and he talks) as they arrive.
// push(chunk) returns the newly decoded reply text; reset() starts over when
// the model begins a new text block (for example after a web search).
export function replyStream(key = 'reply') {
  let raw = '', pos = -1, done = false, out = '';
  const opener = new RegExp(`"${key}"\\s*:\\s*"`);
  const ESC = { n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' };
  return {
    reset() { raw = ''; pos = -1; done = false; out = ''; },
    text: () => out,
    push(chunk) {
      if (done || chunk == null) return '';
      raw += chunk;
      if (pos < 0) {
        const m = opener.exec(raw);
        if (!m) return '';
        pos = m.index + m[0].length;
      }
      let add = '';
      while (pos < raw.length) {
        const c = raw[pos];
        if (c === '"') { done = true; break; }
        if (c !== '\\') { add += c; pos++; continue; }
        const e = raw[pos + 1];
        if (e === undefined) break; // wait for the rest of the escape
        if (e === 'u') {
          const hex = raw.slice(pos + 2, pos + 6);
          if (hex.length < 4) break;
          add += String.fromCharCode(parseInt(hex, 16)); pos += 6; continue;
        }
        add += ESC[e] ?? e; pos += 2;
      }
      out += add;
      return add;
    },
  };
}
