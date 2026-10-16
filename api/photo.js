// Photo of a test result -> rows ready for his record. Nothing is saved here:
// the phone shows what was read, the person confirms, then the rows are
// written through /api/write. The photo itself is not stored anywhere.
import { requireAuth } from '../lib/auth.js';
import { readCanon } from '../lib/sheet.js';
import { complete } from '../lib/ai.js';
import { RESULTS_RULES, cleanResults, imageBlock, checkImage } from '../lib/photo.js';
import { melbDay } from '../public/js/kimon-model.js';

const SYSTEM = `You read photos of medical documents for the family of Kimon, a 67-year-old man in Melbourne with severe coronary artery calcification. Accuracy matters more than anything: these rows go into his medical record.

${RESULTS_RULES}

Return ONLY a JSON object, no markdown fences:
{
  "kind": "lab report" | "scan report" | "letter" | "prescription" | "monitor reading" | "not medical",
  "summary": "One or two short sentences at reading age 12 saying what this is and the most important thing on it.",
  "results": [{"date": "YYYY-MM-DD or empty", "test": "Test name", "result": "Value with unit", "lab": "", "notes": ""}],
  "unreadable": "Anything you could not read clearly, or empty."
}`;

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const image = (req.body || {}).image;
  const bad = checkImage(image) || (!image && 'No photo received');
  if (bad) return res.status(400).json({ ok: false, error: bad });
  let canon = {};
  try { canon = await readCanon({ timeoutMs: 9000 }); } catch { /* duplicates just won't be flagged */ }
  try {
    const out = await complete({ req, system: SYSTEM, user: [imageBlock(image), { type: 'text', text: 'Read this photo.' }], web: false, effort: 'low', maxTokens: 4000 });
    const t = String(out.text || '');
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const results = cleanResults(j.results, canon, melbDay(new Date()));
    return res.status(200).json({ ok: true, kind: String(j.kind || ''), summary: String(j.summary || '').slice(0, 400), unreadable: String(j.unreadable || '').slice(0, 300), results });
  } catch (e) {
    console.error(JSON.stringify({ photoFailed: e.code || 'ERR', message: String(e.message).slice(0, 200) }));
    return res.status(502).json({ ok: false, error: e.code === 'NO_AI' ? 'Photo reading is not set up' : "Couldn't read that photo. Try again in good light." });
  }
}
