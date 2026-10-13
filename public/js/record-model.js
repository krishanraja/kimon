// Pure data shaping for the record spokes: tasks from knowledge gaps, and the
// history timeline. No DOM; unit tested.
import { extract, MEASURES, dateKey, fmtDate } from './metrics.js';

// Plain-English titles for the sheet's standing gaps (reading age 12).
const PLAIN = {
  'degree of actual artery narrowing': 'How narrow his arteries are',
  'current medication list': 'What medicines he takes',
  'blood pressure readings': 'His blood pressure',
  'cardiology appointment date': 'When his heart specialist appointment is',
  'symptom history': 'How he has been feeling',
  'ldl target and treatment plan': 'His cholesterol goal and treatment',
  'family history detail': 'Heart problems in the family',
  'diabetes status': 'Whether he has diabetes',
};
export function plainTask(g) {
  const t = String(g.gap || '').split(/\s+-\s+|\s+\(/)[0].trim();
  return PLAIN[t.toLowerCase()] || t;
}

// Who acts on a gap: 'dad' | 'waiting' | 'gp'. Order matters: a gap the
// cardiologist decides is "waiting", even if a GP is also named.
export function taskGroup(g) {
  const t = `${g.whatAnswersIt || ''} ${g.stepToClose || ''}`;
  if (/\bhim\b|family|check-?in|on (a|next) call/i.test(t)) return 'dad';
  if (/cardiolog|referral|triage/i.test(t)) return 'waiting';
  if (/\bGP\b/.test(t)) return 'gp';
  return 'dad';
}
export const GROUPS = [
  ['dad', 'Ask Dad', 'Things only he can tell you. Add them to your next call.'],
  ['gp', 'Ask his GP', 'Quick things his GP can check or order.'],
  ['waiting', 'Waiting on', 'These get answered at cardiology. Nothing to do yet but follow up.'],
];

// "Ask cardiologist Q4/Q5" -> the actual question text.
export function taskHow(g, questions = []) {
  const byId = Object.fromEntries(questions.map(q => [q.id, q.question]));
  const step = String(g.stepToClose || '').replace(/\bQ(\d+)(?:\s*\/\s*Q?(\d+))?/g, (m, a, b) => {
    const qs = [byId['Q' + a], b && byId['Q' + b]].filter(Boolean);
    return qs.length ? `"${qs[0]}"` : m;
  });
  const plain = step
    .replace(/\bAsk cardiologist\b/gi, 'Ask at cardiology:')
    .replace(/\bawait referral(?:\/triage)?\b/gi, 'wait for the cardiology referral')
    .replace(/\bConfirm referral sent\b/gi, 'Check the referral was sent')
    .replace(/\bask GP for expected timeframe\b/gi, 'ask his GP how long the wait is')
    .replace(/\bAsk GP\b/g, 'Ask his GP')
    .replace(/\bconsider home BP monitor\b/gi, 'think about a home blood pressure monitor')
    .replace(/\bRaise on a call\b/gi, 'Ask him on a call')
    .replace(/\bStart logging check-ins\b/gi, 'Do a check-in on each call')
    .replace(/\bAdd to next check-in\b/gi, 'Ask him on your next call');
  return plain.replace(/;\s*/g, '. ').replace(/:\s*"/g, ' "').replace(/\s+/g, ' ').trim()
    .replace(/(^|[.?!]"?\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

export function taskStatus(g) {
  return g.status === 'closed' ? 'done' : g.status === 'in-progress' ? 'call' : 'open';
}

function summariseTest(row) {
  const m = extract([row]);
  const bits = [];
  if (m.cac) bits.push(`score ${Math.round(m.cac.value)} (${MEASURES.cac.assess(m.cac.value)[0].toLowerCase()})`);
  if (m.ldl) bits.push(`LDL ${m.ldl.value}`);
  if (m.total && !m.cac) bits.push(`total ${m.total.value}`);
  if (m.glucose) bits.push(`${m.glucose.value} mmol/L`);
  if (m.egfr) bits.push(`eGFR ${m.egfr.value}`);
  if (m.hb && m.hb.fbeNormal) bits.push('all normal');
  if (!bits.length && /within normal limits/i.test(row.result)) bits.push('within normal limits');
  return bits.join(' · ') || clip(row.result, 70);
}
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '').replace(/[,;:.\s]+$/, '');
}
function firstSentence(s) { return clip(String(s || '').split(/(?<=[.!?])\s/)[0], 90); }
function testTitle(t) { const s = String(t).replace(/\s*\([^)]*\)\s*$/, '').replace(/^CT /, '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

// Timeline events, newest first. Test rows by an automated tester are hidden.
export function historyEvents(canon) {
  const ev = [];
  for (const r of canon.testResults || []) {
    ev.push({ key: dateKey(r.date), ts: '', kind: /calcium|CT/i.test(r.test) ? 'scan' : 'bloods', title: testTitle(r.test), detail: summariseTest(r) });
  }
  const concerns = new Map();
  for (const n of canon.notes || []) {
    if (n.by === 'claude-test') continue;
    const k = dateKey(n.tsUTC), text = String(n.text || '');
    if (/concern/i.test(n.tag)) {
      const q = (text.match(/CONCERN:\s*([\s\S]*?)(?:\nURGENCY:|$)/) || [, text])[1].trim();
      const urgency = (text.match(/URGENCY:\s*(\w+)/) || [])[1] || '';
      const answer = (text.match(/ANSWER:\s*([\s\S]*)$/) || [])[1] || '';
      const prev = concerns.get(q);
      if (prev) { prev.count++; if (n.tsUTC > prev.ts) Object.assign(prev, { key: k, ts: n.tsUTC, urgency, answer: firstSentence(answer) }); }
      else concerns.set(q, { key: k, ts: n.tsUTC, kind: 'concern', title: 'You asked', detail: clip(q, 90), concern: q, urgency, answer: firstSentence(answer), count: 1 });
    } else if (/symptom/i.test(n.tag)) {
      ev.push({ key: k, ts: n.tsUTC, kind: 'symptom', title: 'Symptoms reported', detail: firstSentence(text) });
    } else if (/found-out/i.test(n.tag)) {
      ev.push({ key: k, ts: n.tsUTC, kind: 'found', title: 'Found out', detail: clip(text.replace(/^FOUND OUT[^:]*:\s*/i, ''), 90) });
    } else {
      ev.push({ key: k, ts: n.tsUTC, kind: 'note', title: 'Note', detail: clip(text, 90) });
    }
  }
  ev.push(...concerns.values());
  for (const c of canon.checkins || []) {
    ev.push({ key: dateKey(c.tsUTC || c.tsMelb), ts: c.tsUTC || '', kind: 'checkin', title: `Check-in: ${c.verdict}`, detail: [c.chest !== 'none' && `chest ${c.chest}`, c.breath !== 'none' && `breath ${c.breath}`, c.walking !== 'same' && `walking ${c.walking}`].filter(Boolean).join(' · ') || 'nothing changed' });
  }
  for (const q of canon.questions || []) {
    if (q.status === 'answered' && q.answer) ev.push({ key: dateKey(q.updated), ts: '', kind: 'answer', title: 'Doctor answered', detail: clip(`${q.question} ${q.answer}`, 90) });
  }
  return ev.sort((a, b) => (b.key - a.key) || String(b.ts).localeCompare(String(a.ts)))
    .map(e => ({ ...e, date: e.key ? fmtDate(String(e.key).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), { year: true }) : '' }));
}
