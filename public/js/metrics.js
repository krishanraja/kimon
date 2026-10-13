// Turns the sheet's free-text test results into structured measures with
// plain-language meaning. Pure: no DOM, no network. Runs in browser and tests.
// Thresholds come only from the lab report reference ranges and the evidence
// corpus (knowledge/cac-evidence-corpus.md); `ref` is the corpus reference id.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Accepts "Wed Aug 26 2026 00:00:00 GMT+0100 (British Summer Time)", ISO
// timestamps, "2026-08-26" and "2026-10-13 08:39". Returns {y,m,d} or null.
// The calendar date as written is kept; no timezone shifting.
export function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  m = t.match(/\b([A-Z][a-z]{2}) (\d{1,2}) (\d{4})\b/);
  if (m && m[1].toLowerCase() in MONTHS) return { y: +m[3], m: MONTHS[m[1].toLowerCase()], d: +m[2] };
  m = t.match(/\b(\d{1,2}) ([A-Z][a-z]{2})[a-z]* (\d{4})\b/);
  if (m && m[2].toLowerCase() in MONTHS) return { y: +m[3], m: MONTHS[m[2].toLowerCase()], d: +m[1] };
  return null;
}
export function dateKey(s) { const p = parseDate(s); return p ? p.y * 10000 + (p.m + 1) * 100 + p.d : 0; }
export function fmtDate(s, { year = false } = {}) {
  const p = parseDate(s);
  if (!p) return '';
  return `${p.d} ${MON[p.m]}${year ? ' ' + p.y : ''}`;
}
export function daysUntil(s, now = new Date()) {
  const p = parseDate(s);
  if (!p) return null;
  const a = Date.UTC(p.y, p.m, p.d), b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

const num = v => (v === undefined || v === null ? null : parseFloat(String(v).replace(',', '.')));

// Normalise tokens that would otherwise collide (non-HDL vs HDL vs Chol/HDL).
function norm(text) {
  return String(text || '')
    .replace(/non[-\s]?HDL(?:-C)?/gi, ' NONHDL ')
    .replace(/chol(?:esterol)?\s*\/\s*HDL(?:\s*ratio)?/gi, ' CHOLRATIO ')
    .replace(/\bLDL-C\b/gi, ' LDL ')
    .replace(/\bHDL-C\b/gi, ' HDL ');
}
const grab = (text, re) => { const m = text.match(re); return m ? num(m[1]) : null; };

// Latest value per measure across all rows. Each value keeps its row date.
export function extract(testResults = []) {
  const rows = [...testResults].sort((a, b) => dateKey(a.date) - dateKey(b.date));
  const out = {};
  const put = (key, value, row, extra = {}) => {
    if (value === null || Number.isNaN(value)) return;
    out[key] = { value, date: row.date, source: row.lab || '', ...extra };
  };
  for (const row of rows) {
    const raw = `${row.test} | ${row.result} | ${row.notes || ''}`;
    const t = norm(raw);
    if (/calcium|agatston|\bCAC\b/i.test(row.test)) {
      const total = grab(t, /Total\s*(?:score)?\s*[:=]?\s*([\d.]+)/i) ?? grab(t, /([\d.]+)\s*Agatston/i);
      const vessels = {};
      for (const [k, re] of [['LM', /\bLM\s*[:=]?\s*([\d.]+)/], ['LAD', /\bLAD\s*[:=]?\s*([\d.]+)/], ['LCx', /\bLCx\s*[:=]?\s*([\d.]+)/i], ['RCA', /\bRCA\s*[:=]?\s*([\d.]+)/]]) {
        const v = grab(t, re); if (v !== null) vessels[k] = v;
      }
      const pct = raw.match(/(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:percentile|centile)/i)
        || raw.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:percentile|centile)/i);
      put('cac', total, row, { vessels, percentile: pct ? (pct[2] ? `${pct[1]}th to ${pct[2]}th` : `${pct[1]}th`) : '' });
      continue;
    }
    if (/lipid|chol|LDL/i.test(row.test) || /\bLDL\b/i.test(t)) {
      put('ldl', grab(t, /\bLDL\s*[:=]?\s*([\d.]+)/), row);
      put('nonhdl', grab(t, /NONHDL\s*[:=]?\s*([\d.]+)/), row);
      put('hdl', grab(t, /\bHDL\s*[:=]?\s*([\d.]+)/), row);
      put('trig', grab(t, /\bTrig\w*\s*[:=]?\s*([\d.]+)/i), row);
      put('total', grab(t, /\bTotal(?:\s*chol\w*)?\s*[:=]?\s*([\d.]+)/i), row);
    }
    if (/glucose/i.test(row.test)) put('glucose', grab(t, /([\d.]+)\s*mmol/i), row, { fasting: /fasting/i.test(raw) });
    put('hba1c', grab(t, /HbA1c\s*[:=]?\s*([\d.]+)/i), row);
    put('egfr', grab(t, /eGFR[^\d]{0,12}(\d{1,3})/i), row);
    put('creatinine', grab(t, /creatinine\s*[:=]?\s*([\d.]+)/i), row);
    put('hb', grab(t, /\bHb\s*[:=]?\s*([\d.]+)/), row, { fbeNormal: /within normal limits/i.test(raw) && /blood exam|FBE|full blood/i.test(raw) });
    const bp = raw.match(/(?:blood pressure|\bBP\b)[^\d]{0,15}(\d{2,3})\s*\/\s*(\d{2,3})/i);
    if (bp) put('bp', num(bp[1]), row, { dia: num(bp[2]) });
  }
  return out;
}

// tone: hot | warm | ok | none  (drives colour; never decoration)
export const MEASURES = {
  cac: {
    zones: [[0, 100, 'ok'], [100, 400, 'warm'], [400, 1200, 'hot']],
    label: 'Calcium score', short: 'Calcium', unit: '', ref: '5',
    scale: { min: 0, max: 1200, marks: [100, 400, 1000] },
    assess: v => v >= 1000 ? ['Extreme', 'hot'] : v >= 400 ? ['Severe', 'hot'] : v >= 100 ? ['Moderate', 'warm'] : v > 0 ? ['Mild', 'warm'] : ['None found', 'ok'],
    meaning: v => `Hard, chalky fat (called plaque) has built up in the walls of his heart arteries. Over 400 is severe. ${v >= 1000 ? 'His is over 1,000, the top band.' : v >= 800 ? 'His is close to 1,000.' : 'His is in the severe band.'}`,
    why: 'The score shows how much plaque there is. It does not show how narrow the arteries are. His symptoms and more tests will decide what happens next.',
    ask: v => `His calcium score is ${v}. What does that actually mean for him, and what should happen next?`,
  },
  ldl: {
    zones: [[0, 2.0, 'ok'], [2.0, 4.0, 'warm'], [4.0, 6, 'hot']],
    label: 'LDL cholesterol', short: 'LDL', unit: 'mmol/L', ref: '34',
    target: 2.0, scale: { min: 0, max: 6, marks: [2.0, 4.0] },
    assess: v => v <= 1.8 ? ['On target', 'ok'] : v <= 2.0 ? ['Near target', 'warm'] : v >= 4.0 ? ['High', 'hot'] : ['Above target', 'warm'],
    meaning: v => `LDL is the "bad" cholesterol that builds plaque. His lab wants it under 2.0. His is ${v}, about ${(v / 2).toFixed(1).replace(/\.0$/, '')} times too high.`,
    why: 'Medicine can bring this number down a lot. Every 1.0 it drops cuts the risk of a heart attack by about one fifth. His doctor will set his goal.',
    ask: v => `His LDL is ${v} and nothing is recorded as treating it yet. What target should he aim for and how is it usually reached?`,
  },
  glucose: {
    zones: [[3, 4, 'warm'], [4, 5.5, 'ok'], [5.5, 7, 'warm'], [7, 8, 'hot']],
    label: 'Fasting blood sugar', short: 'Sugar', unit: 'mmol/L', ref: '',
    scale: { min: 3, max: 8, marks: [5.5, 7.0] },
    assess: v => v >= 7.0 ? ['High', 'hot'] : v >= 5.5 ? ['Borderline', 'warm'] : v >= 4.0 ? ['Normal', 'ok'] : ['Low', 'warm'],
    meaning: v => v >= 5.5 && v < 7 ? `This is his blood sugar before eating. ${v} is still normal, but close to the top. The lab says one more sugar test would be wise.` : `His blood sugar before eating was ${v}.`,
    why: 'Diabetes makes heart problems more likely. A test called HbA1c shows his average sugar over 3 months. He has not had one yet.',
    ask: v => `His fasting sugar was ${v}. Should he have a HbA1c or glucose tolerance test?`,
  },
  egfr: {
    zones: [[0, 45, 'hot'], [45, 60, 'warm'], [60, 120, 'ok']],
    label: 'Kidney function (eGFR)', short: 'Kidney', unit: '', ref: '',
    scale: { min: 0, max: 120, marks: [60] },
    assess: v => v >= 60 ? ['Normal', 'ok'] : v >= 45 ? ['Mildly reduced', 'warm'] : ['Reduced', 'hot'],
    meaning: v => `This shows how well his kidneys clean his blood. Over 60 is normal. His is ${v}.`,
    why: 'His kidneys work well. So more tests and medicines are safe for him, like scans that use dye.',
    ask: v => `His eGFR is ${v}. Does that affect which heart tests or medicines suit him?`,
  },
  hb: {
    zones: [[100, 130, 'warm'], [130, 180, 'ok'], [180, 200, 'warm']],
    label: 'Blood count', short: 'Blood', unit: 'g/L', ref: '',
    scale: { min: 100, max: 200, marks: [130, 180] },
    assess: v => v >= 130 && v <= 180 ? ['Normal', 'ok'] : ['Outside range', 'warm'],
    meaning: v => `This counts the red cells that carry oxygen. His is ${v}, which is normal (130 to 180). His other blood cells were normal too.`,
    why: 'Low blood counts can make you dizzy and out of breath. His is normal, so that is not likely to be the cause.',
    ask: () => 'His blood count is normal. What else could explain breathlessness and dizziness?',
  },
  bp: {
    zones: [[90, 140, 'ok'], [140, 160, 'warm'], [160, 180, 'hot']],
    label: 'Blood pressure', short: 'BP', unit: 'mmHg', ref: '37',
    scale: { min: 90, max: 180, marks: [120, 140] },
    assess: v => v >= 160 ? ['High', 'hot'] : v >= 140 ? ['Raised', 'warm'] : ['In range', 'ok'],
    meaning: v => `Top number ${v}.`,
    why: 'High blood pressure makes heart problems more likely. Low pressure when he stands up can make him dizzy.',
    ask: v => `His blood pressure is ${v}. Is that okay for him?`,
    missing: {
      text: 'There is no reading yet. Blood pressure is one of the biggest causes of heart problems. Low pressure when he stands up can also make him dizzy.',
      how: 'Ask his GP to check it, or buy a home monitor from a chemist (about $60 to $100).',
    },
  },
};
MEASURES.hba1c = {
  label: 'HbA1c (3-month sugar)', short: 'HbA1c', unit: '%', ref: '30',
  assess: v => v >= 6.5 ? ['Diabetes range', 'hot'] : v >= 5.7 ? ['Borderline', 'warm'] : ['Normal', 'ok'],
  meaning: v => `HbA1c ${v}%.`, why: '', ask: v => `His HbA1c is ${v}%. What does that mean for his heart risk?`,
};

// Lipid panel extras shown under LDL. Targets from the lab report.
export const LIPID_EXTRAS = [
  ['total', 'Total', 4.0], ['nonhdl', 'Non-HDL', 2.5], ['trig', 'Triglycerides', 2.0], ['hdl', 'HDL (good)', -1.0],
];

// Ordered result cards. Missing measures appear only where their absence matters.
export function resultCards(m) {
  const order = ['cac', 'ldl', 'glucose', 'egfr', 'hb', 'bp'];
  return order.map(key => {
    const def = MEASURES[key], hit = m[key];
    if (!hit) return def.missing ? { key, def, missing: true } : null;
    const [verdict, tone] = def.assess(hit.value);
    return { key, def, hit, value: hit.value, verdict, tone };
  }).filter(Boolean);
}

export function situation({ m, medications = [], notes = [] }) {
  const parts = [];
  if (m.cac) parts.push(`Heavy calcium build-up in his heart arteries (score ${Math.round(m.cac.value)}, ${MEASURES.cac.assess(m.cac.value)[0].toLowerCase()}).`);
  if (m.ldl && m.ldl.value > 2) parts.push(`Cholesterol high (LDL ${m.ldl.value})${medications.length ? '' : ' with no treatment recorded'}.`);
  const sym = [...notes].filter(n => /symptom/i.test(n.tag)).sort((a, b) => dateKey(a.tsUTC) - dateKey(b.tsUTC)).pop();
  if (sym) parts.push(`Symptoms reported ${fmtDate(sym.tsUTC)}.`);
  return parts.join(' ');
}

export const STAGES = ['Scan done', 'GP review', 'Referred to cardiology', 'Seen by cardiologist', 'Further tests', 'Treatment plan'];

// Corpus references cited by result cards (knowledge/cac-evidence-corpus.md).
export const REF_URLS = {
  5: 'https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/first-do-no-harm/gp-resources/coronary-artery-calcium-scoring',
  34: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7868100/',
  37: 'https://australianprescriber.tg.org.au/articles/assessing-communicating-and-managing-cardiovascular-disease-risk-a-practical-summary-of-the-2023-guideline.html',
};
