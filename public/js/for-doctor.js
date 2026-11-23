// "For my doctor": what Kimon records himself, in one page his doctor can
// read, and the questions worth asking next, each worked out from his own
// record and the evidence corpus (knowledge/cac-evidence-corpus.md,
// "Questions for the cardiologist"). Facts and questions only: never a
// suggestion to start, stop or change a medicine.
// Pure: no DOM, no network. Browser, server (Leffy) and tests.
import { TAGS, noteData, melbDay, tabletDays, liveNotes, BODY_CHECK } from './kimon-model.js';
import { bpInsight, bpSeries, extract, fmtDate, parseDate } from './metrics.js';
import { currentMeds, dailyMeds, medLine } from './meds-model.js';
import { QUICK_TAG } from './quick-checks.js';

const DAY = 86400000;
// "I asked this": its own tag, so it never uses up the day's quick question.
export const ASKED_TAG = 'doctor-asked';
const iso = v => { const p = parseDate(v); return p ? `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : ''; };
const short = n => String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const answers = canon => (canon.notes || []).filter(n => n.tag === QUICK_TAG).map(n => ({ ...noteData(n), ts: n.tsUTC })).filter(a => a.id);
const lastFor = (canon, id) => answers(canon).filter(a => a.id === id).sort((a, b) => String(a.ts).localeCompare(String(b.ts))).pop() || null;

// What the appointment was for, in his words where the record says so.
function apptKind(canon) {
  const text = [...(canon.questions || []).map(q => q.answer), ...(canon.notes || []).filter(n => n.by === 'Kimon').map(n => n.text)].join(' ');
  return /angiogra/i.test(text) ? 'CT angiogram' : 'appointment';
}

// The latest appointment and where it stands.
export function appointment(canon = {}, now = new Date()) {
  const date = iso(canon.profile?.next_appointment);
  if (!date) return null;
  const today = melbDay(now);
  if (date >= today) return { date, kind: apptKind(canon), status: 'upcoming' };
  // A non-blood-pressure result dated on or after it means results are in.
  const resultIn = (canon.testResults || []).some(r => !/blood pressure/i.test(r.test) && iso(r.date) >= date);
  const a = lastFor(canon, `appt:${date}`);
  const status = resultIn ? 'results-in' : a?.answer === 'results' ? 'results-not-recorded' : a?.answer === 'waiting' ? 'waiting' : a?.answer === 'moved' ? 'moved' : 'unknown';
  return { date, kind: apptKind(canon), status };
}

export function apptLine(a) {
  if (!a) return 'No appointment date recorded.';
  const d = fmtDate(a.date, { year: true });
  return {
    upcoming: `Next: ${a.kind} on ${d}.`,
    'results-in': `${a.kind} on ${d}: results are in the record.`,
    'results-not-recorded': `${a.kind} on ${d}: results back, not in the record yet.`,
    waiting: `${a.kind} on ${d}: waiting for results.`,
    moved: `${a.kind} on ${d} was moved; new date not recorded.`,
    unknown: `${a.kind} on ${d}: result not recorded yet.`,
  }[a.status];
}

// His own numbers: blood pressure, tablets, check-ins, medicines.
export function doctorSummary(canon = {}, now = new Date()) {
  const b = bpInsight(canon, now);
  const rs = bpSeries(canon.testResults || []).readings.filter(r => r.by === 'Kimon' || !r.by);
  const out = { bp: null, sinceChange: null, tablets: null, checks: [], meds: [], appt: appointment(canon, now) };
  if (b && rs.length) {
    const all = rs.map(r => [r.sys, r.dia]);
    const avg = i => Math.round(all.reduce((a, x) => a + x[i], 0) / all.length);
    const days = new Set(rs.map(r => melbDay(r.at))).size;
    out.bp = { n: rs.length, days, from: melbDay(rs[rs.length - 1].at), sys: avg(0), dia: avg(1),
      sysLo: Math.min(...all.map(x => x[0])), sysHi: Math.max(...all.map(x => x[0])), diaLo: Math.min(...all.map(x => x[1])), diaHi: Math.max(...all.map(x => x[1])) };
    out.sinceChange = b.sinceChange;
  }
  // Tablets: days ticked since he started ticking, today left out until done.
  const ticked = tabletDays(canon.notes || [], 'Kimon');
  if (ticked.size && dailyMeds(canon).length) {
    const first = [...ticked].sort()[0], today = melbDay(now);
    let of = 0, yes = 0;
    for (let t = new Date(`${first}T12:00:00+11:00`).getTime(); melbDay(t) <= today; t += DAY) {
      const d = melbDay(t);
      if (d === today && !ticked.has(d)) continue;
      of++; if (ticked.has(d)) yes++;
    }
    out.tablets = { yes, of, from: first };
  }
  out.checks = liveNotes(canon.notes || []).filter(n => n.tag === TAGS.check && n.by === 'Kimon').map(n => {
    const a = noteData(n)?.answers || {};
    const odd = BODY_CHECK.filter(q => a[q.id] && a[q.id] !== 'no' && a[q.id] !== 'same').map(q => q.id);
    return { day: melbDay(n.tsUTC), clear: !odd.length, odd };
  }).slice(-4);
  const m = currentMeds(canon);
  out.meds = [...m.current.map(x => medLine({ ...x, name: short(x.name) })), ...m.stopped.slice(-2).map(x => `${short(x.name)} (stopped${x.updated ? ' ' + fmtDate(x.updated) : ''})`)];
  return out;
}

// Plain lines, shared by his screen, the family brief and the share text.
export function summaryLines(s) {
  const L = [];
  if (s.bp) L.push(`Blood pressure at home: ${s.bp.n} readings on ${s.bp.days} days since ${fmtDate(s.bp.from)}, average ${s.bp.sys}/${s.bp.dia} (top ${s.bp.sysLo} to ${s.bp.sysHi}, bottom ${s.bp.diaLo} to ${s.bp.diaHi}).`);
  const c = s.sinceChange;
  if (c) L.push(`Since ${short(c.name)} was ${c.what} on ${fmtDate(c.day)}: average ${c.after.sys}/${c.after.dia} over ${c.after.n} readings${c.before ? ` (before: ${c.before.sys}/${c.before.dia})` : ''}.`);
  if (s.tablets) L.push(`Daily tablets ticked on ${s.tablets.yes} of ${s.tablets.of} days since ${fmtDate(s.tablets.from)}.`);
  if (s.checks.length) L.push(`Weekly check-ins: ${s.checks.map(x => `${fmtDate(x.day)} ${x.clear ? 'no symptoms' : 'noted ' + x.odd.join(', ')}`).join('; ')}.`);
  if (s.meds.length) L.push(`Medicines: ${s.meds.join('; ')}.`);
  L.push(apptLine(s.appt));
  return L;
}

// The questions worth asking next. Each one only appears when his record
// shows the gap it closes, and disappears once he marks it asked.
export function nextQuestions(canon = {}, now = new Date()) {
  const asked = new Set((canon.notes || []).filter(n => n.tag === ASKED_TAG).map(n => noteData(n)?.id).filter(Boolean));
  const m = extract(canon.testResults || []);
  const meds = currentMeds(canon).current;
  const a = appointment(canon, now);
  const out = [];
  const vessels = m.cac?.vessels || {};
  const where = ['LM', 'LAD'].filter(k => vessels[k]).map(k => `${k === 'LM' ? 'left main' : 'LAD'} (${Math.round(vessels[k])})`);

  // 1. The angiogram result: the one test that says whether an artery is narrowed.
  if (a && a.status !== 'upcoming' && a.status !== 'results-in' && a.status !== 'moved') {
    out.push({ id: 'ctca', topic: 'Your scan',
      ask: `What did my ${a.kind} show? Is any artery narrowed, especially the left main or LAD? Were any parts unclear because of the calcium?`,
      why: `Your calcium scan showed plaque${where.length ? `, most in the ${where.join(' and ')} (calcium scores)` : ''}. It can't show narrowing; the angiogram can. Also ask: what result would mean an invasive angiogram?` });
  }
  // 2. Cholesterol: a goal, a statin, and no re-check since.
  const goal = (canon.questions || []).map(q => String(q.answer || '').match(/LDL[^:<]*[:\s]*<\s*([\d.]+)/i)).find(Boolean);
  const target = goal ? +goal[1] : null;
  const statin = meds.find(x => /statin/i.test(x.name));
  if (statin && m.ldl) {
    const started = (canon.changelog || []).filter(c => c.tab === 'Medications' && String(c.key).split('.')[0] === statin.name).map(c => String(c.ts).slice(0, 10)).sort()[0] || '';
    const before = !started || iso(m.ldl.date) < started;
    if (before || (target && m.ldl.value > target)) {
      out.push({ id: 'ldl', topic: 'Cholesterol',
        ask: `${target ? `My LDL goal is under ${target}. ` : ''}It was ${m.ldl.value} on ${fmtDate(m.ldl.date)}, before ${short(statin.name)}${statin.dose ? ' ' + statin.dose : ''}. When is it re-checked, and if it is still ${target ? `above ${target}` : 'high'}, what is the next step?`,
        why: 'Each 1 mmol/L lower LDL cuts major heart events by about a fifth. A blood test is the only way to know the tablet is doing enough; if not, doctors usually raise the dose or add ezetimibe.' });
    }
  }
  // 3. Which kind of heart care he is getting: sets the goal and the aspirin question.
  if (m.cac && m.cac.value >= 100) {
    const aspirin = meds.find(x => /aspirin/i.test(x.name));
    out.push({ id: 'category', topic: 'Your plan',
      ask: `Am I being treated for prevention, or for coronary artery disease?${aspirin ? ' And why is daily aspirin right for me?' : ''}`,
      why: `The answer sets your cholesterol goal: under 1.8 is common for one, under 1.4 for the other.${aspirin ? ' Aspirin protects some people and causes bleeding in others, so the reason should be written down.' : ''}` });
  }
  // 4. His home blood pressure since a medicine change: data only he has.
  const s = bpInsight(canon, now)?.sinceChange;
  if (s && s.after.n >= 5) {
    out.push({ id: `bp:${short(s.name)}`, topic: 'Blood pressure',
      ask: `Since ${short(s.name)} stopped on ${fmtDate(s.day)}, my home blood pressure averages ${s.after.sys}/${s.after.dia} over ${s.after.n} readings. Is that where you want it?`,
      why: `Your doctor can only judge that change from readings at home, and you have them. Show the "For my doctor" page.` });
  }
  // 5. Who looks after his heart from here.
  if ((canon.questions || []).some(q => q.status !== 'answered' && /how often should he be reviewed/i.test(q.question))) {
    out.push({ id: 'review', topic: 'Next check',
      ask: 'Who looks after my heart from here, my GP or the cardiologist? When is my next check?',
      why: 'Your record has no plan after this yet, so nothing is booked.' });
  }
  return out.filter(q => !asked.has(q.id));
}

// Everything, as one message to share or paste.
export function doctorText(canon = {}, now = new Date()) {
  const s = doctorSummary(canon, now), q = nextQuestions(canon, now);
  const L = [`From my own records (Beside), ${fmtDate(melbDay(now), { year: true })}`, '', ...summaryLines(s)];
  if (q.length) L.push('', 'My questions', ...q.map((x, i) => `${i + 1}. ${x.ask}`));
  return L.join('\n');
}
