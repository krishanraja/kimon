// Loads the evidence corpus and supports reference lookup and simple
// section retrieval (used when no AI model is reachable).
import fs from 'node:fs';
import path from 'node:path';

let cache = null;

export function corpus() {
  if (cache) return cache;
  const text = fs.readFileSync(path.join(process.cwd(), 'knowledge', 'cac-evidence-corpus.md'), 'utf8');
  const refs = {};
  const refBlock = text.split(/\n## References\s*\n/)[1] || '';
  for (const m of refBlock.matchAll(/^(\d+)\.\s+\[([^\]]+)\]\((https?:[^)\s]+)\)/gm)) {
    refs[m[1]] = { title: m[2].trim(), url: m[3] };
  }
  const body = text.split(/\n## References\s*\n/)[0];
  const sections = body.split(/\n(?=#{2,3} )/).map(s => {
    const heading = (s.match(/^#{2,3} (.+)/) || [, ''])[1].trim();
    return { heading, text: s.replace(/^#{1,3} .+\n/, '').trim() };
  }).filter(s => s.heading);
  cache = { text, body, refs, sections };
  return cache;
}

const STOP = new Set('the a an and or of to in is it he his him my i me with for on at be was are this that what why how do does can should about from have has when there they them their your you not but if so as by'.split(' '));

export function retrieve(query, k = 2) {
  const terms = String(query).toLowerCase().match(/[a-z]{3,}/g)?.filter(t => !STOP.has(t)) || [];
  const scored = corpus().sections.map(s => {
    const hay = (s.heading + ' ' + s.text).toLowerCase();
    let score = 0;
    for (const t of terms) {
      const stem = t.slice(0, 6);
      if (s.heading.toLowerCase().includes(stem)) score += 3;
      score += Math.min(hay.split(stem).length - 1, 4);
    }
    return { ...s, score };
  }).sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, k);
}

export function refsFor(text) {
  const { refs } = corpus();
  const ids = [...new Set([...String(text).matchAll(/\[\^(\d+)\]/g)].map(m => m[1]))];
  return ids.map(id => ({ id, ...refs[id] })).filter(r => r.url);
}
