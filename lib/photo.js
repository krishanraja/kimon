// Reading a photo of a test result: the shared rules for turning what the
// model saw into TestResults rows, and spotting rows already in his record.
import { dateKey } from '../public/js/metrics.js';

export const MAX_IMAGE_B64 = 3_500_000; // about 2.6 MB; the phone shrinks photos first
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const RESULTS_RULES = `Reading a photo of a medical document (lab report, scan report, letter, prescription, blood pressure monitor screen):
- Copy every result exactly as printed. Never guess a number you cannot read; leave that test out and say so in "unreadable".
- One row per test or measure. "result" always includes the unit as printed, e.g. "2.1 mmol/L", "135/85 mmHg", "Total 612 Agatston (LM 40, LAD 400)".
- For a lipid panel, also add one row named "Lipid studies" whose result lists every value, e.g. "Total 6.1; LDL-C 4.0; HDL-C 1.1; Non-HDL-C 5.0; Triglycerides 2.2 mmol/L".
- "date" is the collection or report date as YYYY-MM-DD. If no date is printed, use "".
- "lab" is the lab, clinic or device name if printed. "notes" holds the printed reference range or flag (H, L), briefly.
- If the photo is not a medical result, return no results.`;

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const same = (a, b) => clip(a, 200).toLowerCase() === clip(b, 200).toLowerCase();

// Clean model rows into sheet-ready rows. Rows already in his record are
// flagged so the phone can skip them instead of saving duplicates.
export function cleanResults(rows, canon = {}, today = new Date().toISOString().slice(0, 10)) {
  const existing = canon.testResults || [];
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map(r => {
    const test = clip(r?.test, 120), result = clip(r?.result, 400);
    if (!test || !result) return null;
    const printed = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '').trim()) && dateKey(r.date) ? String(r.date).trim() : '';
    const date = printed || today;
    const notes = [clip(r.notes, 200), 'From a photo, read by AI', printed ? '' : 'date not on photo, used upload day'].filter(Boolean).join('. ');
    const duplicate = existing.some(e => dateKey(e.date) === dateKey(date) && same(e.test, test) && same(e.result, result));
    return { date, test, result, lab: clip(r.lab, 80), notes, duplicate, dateGuessed: !printed };
  }).filter(Boolean);
}

export function imageBlock(image) {
  const type = IMAGE_TYPES.includes(image?.type) ? image.type : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: type, data: String(image.data) } };
}

export function checkImage(image) {
  if (!image) return null;
  if (typeof image.data !== 'string' || image.data.length < 200) return 'No photo received';
  if (image.data.length > MAX_IMAGE_B64) return 'That photo is too large';
  return null;
}
