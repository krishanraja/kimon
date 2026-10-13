// Turn a SpeechRecognition result list into one clean transcript.
// Android Chrome re-sends the whole phrase so far as each new result
// ("what", "what should", "what should we ask"), so naively joining results
// repeats words. A piece that extends or repeats the previous one replaces it.
export function transcript(pieces) {
  const out = [];
  for (const raw of pieces) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    const a = prev ? prev.toLowerCase() : '', b = t.toLowerCase();
    if (prev && b.startsWith(a)) out[out.length - 1] = t;
    else if (prev && a.startsWith(b)) continue;
    else out.push(t);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
export function resultsText(e) {
  const pieces = [];
  for (let k = 0; k < e.results.length; k++) pieces.push(e.results[k][0].transcript);
  return transcript(pieces);
}
