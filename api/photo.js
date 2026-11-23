// Photo of a test result -> rows ready for his record, plus Leffy's quick
// read of what it means for him, in one model call. Nothing is saved here:
// the phone shows what was read, the person confirms, then the rows are
// written through /api/write. The photo itself is not stored anywhere.
import { requireAuth } from '../lib/auth.js';
import { readCanon } from '../lib/sheet.js';
import { complete } from '../lib/ai.js';
import { RESULTS_RULES, cleanResults, cleanMeaning, imageBlock, checkImage } from '../lib/photo.js';
import { retrieve } from '../lib/knowledge.js';
import { triage } from '../public/js/triage.js';
import { patientContext } from './ask.js';
import { melbDay } from '../public/js/kimon-model.js';

const SYSTEM = `You read photos of medical documents for the family of Kimon, a 67-year-old man in Melbourne with severe coronary artery calcification. Accuracy matters more than anything: these rows go into his medical record.

${RESULTS_RULES}

Return ONLY a JSON object, no markdown fences:
{
  "kind": "lab report" | "scan report" | "letter" | "prescription" | "monitor reading" | "not medical",
  "summary": "One or two short sentences at reading age 12 saying what this is and the most important thing on it.",
  "results": [{"date": "YYYY-MM-DD or empty", "test": "Test name", "result": "Value with unit", "lab": "", "notes": ""}],
  "unreadable": "Anything you could not read clearly, or empty.",
  "meaning": "Leffy's quick read for Kimon himself, talking to him as 'you': 2 or 3 short sentences at reading age 12 on what this result means for HIM, compared with his earlier results and goals in his record. Plain words; explain any medical word in brackets. Honest: say plainly if something needs his doctor soon. Never tell him to start, stop or change a medicine. Empty if not medical.",
  "urgency": "routine" | "soon" | "urgent" | "emergency",
  "askNext": "The one most useful question for his doctor about this result, in his words ('Does my ... mean ...?'), or empty."
}

Use his record and the evidence below only to explain the result; the rows must still be copied from the photo alone.`;

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const image = (req.body || {}).image;
  const bad = checkImage(image) || (!image && 'No photo received');
  if (bad) return res.status(400).json({ ok: false, error: bad });
  let canon = {};
  try { canon = await readCanon({ timeoutMs: 9000 }); } catch { /* duplicates just won't be flagged */ }
  try {
    const evidence = retrieve('coronary angiogram stenosis calcium LDL cholesterol target statin blood pressure results', 3)
      .map(x => `### ${x.heading}\n${x.text.slice(0, 1800)}`).join('\n\n');
    const context = `# His record (for explaining the result only)\n${patientContext(canon && canon.testResults ? canon : null)}\n\n# Evidence\n${evidence}`;
    const out = await complete({ req, system: SYSTEM, user: [imageBlock(image), { type: 'text', text: `${context.slice(0, 30000)}\n\nRead this photo.` }], web: false, effort: 'low', maxTokens: 4000 });
    const t = String(out.text || '');
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const results = cleanResults(j.results, canon, melbDay(new Date()));
    // Red flags never wait for the model: the rules run on what was read too.
    const rules = triage(results.map(r => `${r.test} ${r.result} ${r.notes}`).join('\n'));
    const read = cleanMeaning(j, results, rules.level);
    return res.status(200).json({ ok: true, kind: String(j.kind || ''), summary: String(j.summary || '').slice(0, 400), unreadable: String(j.unreadable || '').slice(0, 300), results, ...read, reasons: [...new Set([...read.reasons, ...(rules.level !== 'routine' ? rules.reasons : [])])] });
  } catch (e) {
    console.error(JSON.stringify({ photoFailed: e.code || 'ERR', message: String(e.message).slice(0, 200) }));
    return res.status(502).json({ ok: false, error: e.code === 'NO_AI' ? 'Photo reading is not set up' : "Couldn't read that photo. Try again in good light." });
  }
}
