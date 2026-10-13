// Voice a concern, get an evidence-grounded answer on the spot.
// Order of operations: deterministic red-flag triage first (never depends on
// the model), then a model answer grounded in the evidence corpus and his live
// record from the sheet, then the concern is logged to the sheet.
import { requireAuth } from '../lib/auth.js';
import { readCanon, write } from '../lib/sheet.js';
import { corpus, retrieve, refsFor } from '../lib/knowledge.js';
import { complete } from '../lib/ai.js';
import { triage, maxLevel, LEVELS, CONTACTS } from '../public/js/triage.js';

const PII_KEYS = /medicare|address|street|phone|mobile|email|dob|birth|postcode|ihi|dva|insurance number/i;

function patientContext(canon) {
  if (!canon) return 'His live record could not be loaded right now. Answer from the evidence corpus and say that his record was unavailable.';
  const profile = Object.entries(canon.profile || {})
    .filter(([k]) => !PII_KEYS.test(k))
    .map(([k, v]) => `${k}: ${v}`).join('\n');
  const rows = (arr, n, fn) => (arr || []).slice(-n).map(fn).join('\n') || '(none recorded)';
  return [
    '## Profile', profile || '(none)',
    '## Conditions', rows(canon.conditions, 30, c => `- ${c.name} [${c.status}] since ${c.since}. ${c.notes}`),
    '## Medications', rows(canon.medications, 30, m => `- ${m.name} ${m.dose} ${m.frequency} [${m.status}] started ${m.started}`),
    '## Test results', rows(canon.testResults, 60, t => `- ${t.date} ${t.test}: ${t.result}${t.notes ? ' (' + t.notes + ')' : ''}`),
    '## Recent check-ins (oldest first)', rows(canon.checkins, 8, c => `- ${c.tsMelb}: chest=${c.chest} breath=${c.breath} walking=${c.walking} energy=${c.energy} tablets=${c.tablets} mood=${c.mood} -> ${c.verdict}. ${c.notes}`),
    '## Recent notes and earlier concerns (oldest first)', rows(canon.notes, 15, n => `- ${String(n.tsUTC).slice(0, 10)} [${n.tag}] ${n.text}`),
    '## Open questions for clinicians', rows((canon.questions || []).filter(q => q.status !== 'answered'), 20, q => `- ${q.id} (${q.askWhom}, p${q.priority}): ${q.question}`),
    '## Answered questions', rows((canon.questions || []).filter(q => q.status === 'answered'), 20, q => `- ${q.question} => ${q.answer}`),
    '## Knowledge gaps', rows(canon.gaps, 20, g => `- ${g.id} [${g.status}] ${g.gap}. Closed by: ${g.whatAnswersIt}`),
  ].join('\n');
}

function systemPrompt() {
  return `You are the clinical copilot inside "Beside Kimon", a private app used by the family of a 67-year-old man in Melbourne, Victoria, Australia, who has severe coronary artery calcification and is in the cardiology referral pathway. The main user is his daughter, who lives overseas and supports him remotely by phone and video. She will voice a concern (often transcribed speech, so expect informal wording) and needs a genuinely useful answer on the spot.

How to answer:
- Be specific to HIM. Use his actual numbers, symptoms, medicines and history from his record. Say which facts you used.
- Explain the likely mechanism in plain language (what is probably happening in the body and why), and how it relates to coronary calcification, or say plainly when it probably does not.
- Give concrete next actions she can take today, with who to contact and how. "Ask your doctor" alone is never an acceptable answer. When a clinician is needed, say which one, how urgently, exactly what to say or ask, and what they will likely check.
- Separate what is reassuring from what is a real danger. Name the specific signs that would raise urgency.
- Ground claims in the evidence corpus below and cite its reference numbers. Where you rely on general medical knowledge beyond the corpus, say "general clinical knowledge". Never invent studies, numbers or references.
- Australian context only: Medicare, PBS, Victorian services (000, Victorian Virtual ED at vved.org.au, NURSE-ON-CALL 1300 60 60 24, healthdirect 1800 022 222). She is overseas: she cannot dial 000 or 1300/1800 numbers from abroad.
- Do not prescribe: never tell him to start, stop or change a dose of a prescription medicine, aspirin or supplements. You may explain what the evidence says, what a doctor would typically consider, and what question to raise.
- Urgency must be honest. Use "emergency" for possible heart attack, stroke, collapse or breathlessness at rest. If symptoms are vague, choose the safer level and say what would change it.
- Calm, warm, direct. No jargon without a plain explanation. Short sentences.

Return ONLY a JSON object, no markdown fences, with exactly these keys. She reads this on a phone, one short card at a time, often stressed: be brief and concrete. Hard limits: headline at most 25 words; whatItLikelyMeans at most 70 words; every list item at most 18 words; at most 3 items per list.
{
  "urgency": "routine" | "soon" | "urgent" | "emergency",
  "headline": "The direct answer to her concern, in plain words.",
  "whatItLikelyMeans": "Likely explanation and mechanism, specific to him, including what is reassuring and what is not.",
  "doNow": ["Concrete actions for today or this week, each naming who, what and how."],
  "watchFor": ["Specific signs that would make this more urgent, and what to do then."],
  "askTheDoctor": ["Precise questions for his GP or cardiologist, ready to read aloud."],
  "evidence": [{"point": "A short factual claim behind the answer.", "ref": "corpus reference number, or 'general'"}],
  "usedFromRecord": ["Up to 4 short facts from his record you relied on."],
  "limits": "One short sentence on what cannot be known without examining him."
}

# Evidence corpus (Australian care guide, October 2026)
${corpus().body}`;
}

function extractJson(text) {
  const t = String(text || '').replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model did not return JSON');
  return JSON.parse(t.slice(start, end + 1));
}

function clean(a) {
  const arr = (x, n) => (Array.isArray(x) ? x : []).map(v => typeof v === 'string' ? v.trim() : v).filter(Boolean).slice(0, n);
  return {
    urgency: LEVELS.includes(a.urgency) ? a.urgency : 'soon',
    headline: String(a.headline || '').trim(),
    whatItLikelyMeans: String(a.whatItLikelyMeans || '').trim(),
    doNow: arr(a.doNow, 3), watchFor: arr(a.watchFor, 3), askTheDoctor: arr(a.askTheDoctor, 3),
    evidence: arr(a.evidence, 4).filter(e => e && e.point),
    usedFromRecord: arr(a.usedFromRecord, 4),
    limits: String(a.limits || '').trim(),
  };
}

function withSources(answer) {
  const { refs } = corpus();
  answer.evidence = answer.evidence.map(e => {
    const id = String(e.ref || '').replace(/[^\d]/g, '');
    const r = refs[id];
    return r ? { point: e.point, ref: id, title: r.title, url: r.url } : { point: e.point, ref: 'general' };
  });
  return answer;
}

function fallbackAnswer(concern, level, reasons) {
  const hits = level === 'routine' ? retrieve(concern, 1) : [];
  const snippet = hits.length
    ? `${hits[0].heading}: ${hits[0].text.replace(/\[\^\d+\]/g, '').replace(/\s+/g, ' ').slice(0, 260).replace(/\s\S*$/, '')}...`
    : '';
  return {
    urgency: level,
    headline: level === 'routine'
      ? 'No warning signs in what you described. The live assistant is offline, so this is the closest part of his care guide.'
      : `${CONTACTS[level].title}. ${reasons[0] || ''}.`,
    whatItLikelyMeans: (level === 'routine' ? '' : 'The live assistant is offline, so this is based on warning-sign rules only. ') + snippet,
    doNow: CONTACTS[level].lines, watchFor: [], askTheDoctor: [],
    evidence: hits.flatMap(h => refsFor(h.text).slice(0, 2)).map(r => ({ point: r.title, ref: r.id, title: r.title, url: r.url })),
    usedFromRecord: [], limits: 'Rule-based answer only; not personalised to his record.',
  };
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const concern = String((req.body && req.body.concern) || '').trim().slice(0, 2000);
  const by = String((req.body && req.body.by) || 'app').slice(0, 40);
  if (concern.length < 3) return res.status(400).json({ ok: false, error: 'Say or type the concern first' });

  const rules = triage(concern);

  let canon = null, recordError = null;
  try { canon = await readCanon({ timeoutMs: 9000 }); }
  catch (e) { recordError = e.code === 'NO_SECRET' ? 'Sheet not connected yet' : 'His record could not be loaded'; }

  let answer, source;
  try {
    const out = await complete({
      req,
      system: systemPrompt(),
      user: `# His live record (from the family's Google Sheet)\n${patientContext(canon)}\n\n# Rule-based triage already shown to her\nlevel=${rules.level}; reasons=${rules.reasons.join('; ') || 'none'}\n\n# Her concern (verbatim)\n${concern}`,
    });
    answer = withSources(clean(extractJson(out.text)));
    source = { kind: 'ai', model: out.model };
  } catch (e) {
    answer = fallbackAnswer(concern, rules.level, rules.reasons);
    console.error(JSON.stringify({ askFallback: e.code || 'ERR', message: String(e.message).slice(0, 200) }));
    source = { kind: 'rules', reason: e.code === 'NO_AI' ? 'AI not configured' : 'AI unavailable: ' + e.message.slice(0, 120) };
  }

  // The model may raise urgency but never lower it below the red-flag rules.
  answer.urgency = maxLevel(answer.urgency, rules.level);

  let saved = false;
  if (canon) {
    try {
      await write('note', {
        text: `CONCERN: ${concern}\nURGENCY: ${answer.urgency}\nANSWER: ${answer.headline}`.slice(0, 4000),
        tag: 'concern',
      }, by, { timeoutMs: 8000 });
      saved = true;
    } catch { /* answer still returned; client shows not-saved */ }
  }

  return res.status(200).json({
    ok: true, concern, triage: rules, answer, contacts: CONTACTS[answer.urgency],
    source, saved, recordLoaded: Boolean(canon), recordError,
  });
}
