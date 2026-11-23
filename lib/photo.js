// Reading a photo of a test result: the shared rules for turning what the
// model saw into TestResults rows, and spotting rows already in his record.
import { dateKey } from '../public/js/metrics.js';

export const MAX_IMAGE_B64 = 3_500_000; // about 2.6 MB; the phone shrinks photos first
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PDF_TYPE = 'application/pdf';
// A PDF is sent as it is (no shrinking); Vercel takes request bodies up to 4.5 MB.
export const MAX_PDF_B64 = 4_200_000;

export const RESULTS_RULES = `Reading a photo of a medical document (lab report, scan report, letter, prescription, blood pressure monitor screen):
- Copy every result exactly as printed. Never guess a number you cannot read; leave that test out and say so in "unreadable".
- One row per test or measure. "result" always includes the unit as printed, e.g. "2.1 mmol/L", "135/85 mmHg", "Total 612 Agatston (LM 40, LAD 400)".
- For a lipid panel, also add one row named "Lipid studies" whose result lists every value, e.g. "Total 6.1; LDL-C 4.0; HDL-C 1.1; Non-HDL-C 5.0; Triglycerides 2.2 mmol/L".
- "date" is the collection or report date as YYYY-MM-DD. If no date is printed, use "".
- "lab" is the lab, clinic or device name if printed. "notes" holds the printed reference range or flag (H, L), briefly.
- A scan or heart test report written in words (CT coronary angiogram/CTCA, echo, stress test, invasive angiogram): one row per artery or finding with its exact wording, e.g. test "LAD stenosis", result "50-69% (moderate)"; a "CAD-RADS" row if a CAD-RADS category is printed; and one row named "Impression" whose result copies the report's conclusion word for word (up to 400 characters). Never paraphrase or summarise a finding in a row.
- A doctor's letter: also add one row named for the writer's specialty and "review" (e.g. test "Cardiologist review (Dr Name)", dated the letter's date) whose result gives the diagnosis and the numbered plan briefly, in the letter's own words (doses, targets, follow-up). Results quoted inside the letter or attached reports get their own rows as above.
- Never copy his address, phone, email, date of birth or Medicare number into any field.
- If the document is not medical, return no results.`;

// What Leffy says about a photo, cleaned. Urgency only ever goes up: the
// red-flag rules and the report's own findings set a floor the model cannot
// lower (the same rule as chat).
const LEVELS = ['routine', 'soon', 'urgent', 'emergency'];
const up = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);
export function findingFloor(rows = []) {
  const text = rows.map(r => `${r.test}: ${r.result}`).join('\n');
  const reasons = [];
  let level = 'routine';
  // Severe narrowing, or the left main narrowed at all: needs a cardiologist soon.
  const pct = [...text.matchAll(/(?:^|\n)([^\n:]*?):[^\n]*?(\d{2,3})\s*(?:-|to|–)?\s*(\d{2,3})?\s*%/gi)];
  for (const m of pct) {
    const hi = +(m[3] || m[2]), where = m[1];
    if (/left main|\bLM\b/i.test(where) && hi >= 50) { level = up(level, 'urgent'); reasons.push('Narrowing in the left main artery reported'); }
    else if (hi >= 70) { level = up(level, 'soon'); reasons.push('Severe narrowing (70% or more) reported'); }
  }
  if (/CAD-RADS[^\n]*?\b(4[AB]?|5)\b/i.test(text)) { level = up(level, 'soon'); reasons.push('CAD-RADS 4 or 5 reported'); }
  return { level, reasons: [...new Set(reasons)] };
}
export function cleanMeaning(j = {}, rows = [], triageLevel = 'routine') {
  const floor = findingFloor(rows);
  const asked = LEVELS.includes(j.urgency) ? j.urgency : 'routine';
  return {
    meaning: clip(j.meaning, 600),
    askNext: clip(j.askNext, 240),
    urgency: up(up(asked, floor.level), triageLevel),
    reasons: floor.reasons,
  };
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const same = (a, b) => clip(a, 200).toLowerCase() === clip(b, 200).toLowerCase();

// Clean model rows into sheet-ready rows. Rows already in his record are
// flagged so the phone can skip them instead of saving duplicates.
export function cleanResults(rows, canon = {}, today = new Date().toISOString().slice(0, 10), via = 'a photo') {
  const existing = canon.testResults || [];
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map(r => {
    let test = clip(r?.test, 120); const result = clip(r?.result, 400);
    if (!test || !result) return null;
    // A monitor screen reads "135/85 mmHg" under any label ("SYS/DIA", "Reading 1");
    // file it as blood pressure so it joins his readings.
    if (/^\d{2,3}\s*\/\s*\d{2,3}\s*mm\s*Hg\b/i.test(result) && !/blood pressure|\bBP\b/i.test(test)) test = 'Blood pressure';
    const printed = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '').trim()) && dateKey(r.date) ? String(r.date).trim() : '';
    const date = printed || today;
    const notes = [clip(r.notes, 200), `From ${via}, read by AI`, printed ? '' : 'date not printed, used the day it arrived'].filter(Boolean).join('. ');
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
  if (image.type === PDF_TYPE) return image.data.length > MAX_PDF_B64 ? 'That document is too large' : null;
  if (image.data.length > MAX_IMAGE_B64) return 'That photo is too large';
  return null;
}

// A photo becomes an image block; a PDF becomes a document block.
export function fileBlock(file) {
  if (file?.type === PDF_TYPE) return { type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data: String(file.data) } };
  return imageBlock(file);
}
