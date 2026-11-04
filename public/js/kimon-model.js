// Kimon's own logging and the family's care plan, stored in the canon sheet:
// logs are Notes (append-only, tagged, with a JSON DATA line); the care plan
// is one Profile value. Pure functions, no DOM; unit tested.
import { triage } from './triage.js';

export const TAGS = {
  removed: 'removed',
  symptom: 'symptom-log', check: 'body-check', habit: 'habit', meds: 'meds-taken',
  talk: 'kimon-says', nudge: 'nudge', seen: 'nudge-seen',
};

export const SYMPTOMS = [
  { id: 'chest', label: 'Chest pain or pressure', short: 'Chest' },
  { id: 'breath', label: 'Short of breath', short: 'Breathless' },
  { id: 'dizzy', label: 'Dizzy or light-headed', short: 'Dizzy' },
  { id: 'racing', label: 'Heart racing or fluttering', short: 'Heart racing' },
  { id: 'tired', label: 'Very tired or weak', short: 'Tired' },
  { id: 'swelling', label: 'Swollen ankles or legs', short: 'Swelling' },
  { id: 'other', label: 'Something else', short: 'Other' },
];
export const WHEN = [['now', 'Right now'], ['today', 'Earlier today'], ['week', 'This week']];
export const SEVERITY = [['mild', 'Mild'], ['moderate', 'Moderate'], ['bad', 'Bad']];

// Weekly body check: specific, countable, with an honest "not sure".
export const BODY_CHECK = [
  { id: 'breath', q: 'Walking up stairs or a hill, did you get more out of breath than usual?', why: 'Getting puffed more easily can be the heart asking for more blood. Your doctor needs to know.', opts: [['no', 'No, same as usual', 0], ['bit', 'A bit more', 1], ['stop', 'Yes, I had to stop', 2]] },
  { id: 'chest', q: 'Did you feel any pain, pressure or tightness in your chest?', why: 'Chest feelings on effort can be angina (the heart short of blood). It is treatable when caught early.', opts: [['no', 'Not at all', 0], ['once', 'Once or twice', 1], ['more', 'Three times or more', 2]] },
  { id: 'dizzy', q: 'When you stood up quickly, did you feel dizzy?', why: 'Dizziness on standing often means blood pressure drops for a moment. It is common and easy for your GP to check.', opts: [['no', 'Not at all', 0], ['once', 'Once or twice', 1], ['more', 'Three times or more', 2]] },
  { id: 'racing', q: 'Did your heart race, pound or flutter for no reason?', why: 'An uneven heartbeat can be checked with a simple ECG (heart tracing).', opts: [['no', 'Not at all', 0], ['once', 'Once or twice', 1], ['more', 'Three times or more', 2]] },
  { id: 'walking', q: 'How far could you walk compared with a month ago?', why: 'Walking less far is one of the clearest early signs worth telling the doctor.', opts: [['same', 'About the same', 0], ['less', 'A bit less', 1], ['much', 'Much less', 2]] },
];

// Care plan defaults: evidence-based small habits (see the evidence corpus,
// "Lifestyle as treatment"). The family edits this; Kimon only sees it.
export const HABIT_IDEAS = [
  'A 20 minute walk', 'Stand up slowly, count to three', 'Olive oil instead of butter',
  'Fish for dinner', 'Two fruit and five veg', 'No added salt today', 'In bed by 10:30', 'A glass of water with each meal',
];
export const DEFAULT_PLAN = { habits: [{ text: 'A 20 minute walk', on: true }, { text: 'Stand up slowly, count to three', on: true }], meds: [], checkDay: 0 };

export function readPlan(profile = {}) {
  try {
    const p = JSON.parse(profile.care_plan || '');
    return { habits: Array.isArray(p.habits) ? p.habits : [], meds: Array.isArray(p.meds) ? p.meds : [], checkDay: Number.isInteger(p.checkDay) ? p.checkDay : 0 };
  } catch { return structuredClone(DEFAULT_PLAN); }
}

// One habit per day, rotating through the active ones so it never piles up.
export function todaysHabit(plan, day = new Date()) {
  const on = plan.habits.filter(h => h.on !== false && h.text);
  if (!on.length) return null;
  const n = Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86400000);
  return on[n % on.length].text;
}

// Melbourne calendar day for a timestamp, e.g. "2026-10-14".
export function melbDay(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
}

export function noteText(summary, data) {
  return `${summary}\nDATA: ${JSON.stringify(data)}`;
}
export function noteData(n) {
  const t = String(n.text || ''); const i = t.indexOf('\nDATA: ');
  if (i < 0) return null;
  try { return JSON.parse(t.slice(i + 7)); } catch { return null; }
}
export function noteSummary(n) { return String(n.text || '').split('\nDATA: ')[0].split('\nRID: ')[0]; }

// Urgency for a symptom log: the shared red-flag rules plus the structured fields.
export function symptomLevel(log) {
  const s = SYMPTOMS.find(x => x.id === log.symptom);
  const words = `${s ? s.label : ''} ${log.when === 'now' ? 'right now' : ''} ${log.note || ''}`;
  let level = triage(words).level;
  if (log.symptom === 'chest' && (log.when === 'now' || log.severity === 'bad')) level = 'emergency';
  else if (log.symptom === 'breath' && log.when === 'now' && log.severity === 'bad') level = 'emergency';
  else if (['chest', 'racing', 'swelling'].includes(log.symptom) && level === 'routine') level = 'urgent';
  else if (log.severity === 'bad' && level === 'routine') level = 'urgent';
  else if (level === 'routine' && log.symptom !== 'other') level = 'soon';
  return level;
}

// Body check result: any red answer to chest/breath -> urgent; anything else -> soon.
export function checkLevel(answers) {
  const score = id => (BODY_CHECK.find(q => q.id === id)?.opts.find(o => o[0] === answers[id]) || [, , 0])[2];
  if (score('chest') >= 1 || score('breath') >= 2) return 'urgent';
  if (BODY_CHECK.some(q => score(q.id) >= 1)) return 'soon';
  return 'routine';
}

const LEVEL_RANK = { routine: 0, soon: 1, urgent: 2, emergency: 3 };

// What the family monitor shows: alerts, this week's logs, habits kept.
export function monitor(canon, now = new Date()) {
  const notes = (canon.notes || []).filter(n => n.by !== 'claude-test');
  const weekAgo = now.getTime() - 7 * 86400000;
  const recent = notes.filter(n => new Date(n.tsUTC).getTime() >= weekAgo);
  const logs = recent.filter(n => n.tag === TAGS.symptom).map(n => ({ ts: n.tsUTC, ...noteData(n), summary: noteSummary(n) }));
  const checks = notes.filter(n => n.tag === TAGS.check).map(n => ({ ts: n.tsUTC, ...noteData(n), summary: noteSummary(n) }));
  const lastCheck = checks.pop() || null;
  const habitDays = new Set(recent.filter(n => n.tag === TAGS.habit && noteData(n)?.done).map(n => melbDay(n.tsUTC)));
  const medsDays = new Set(recent.filter(n => n.tag === TAGS.meds).map(n => melbDay(n.tsUTC)));
  const said = recent.filter(n => n.tag === TAGS.talk).map(n => ({ ts: n.tsUTC, text: noteSummary(n).replace(/^KIMON SAYS:\s*/i, '') }));
  const alerts = [...logs.filter(l => LEVEL_RANK[l.level] >= 2).map(l => ({ ts: l.ts, level: l.level, text: l.summary }))];
  if (lastCheck && new Date(lastCheck.ts).getTime() >= weekAgo && LEVEL_RANK[lastCheck.level] >= 2) alerts.push({ ts: lastCheck.ts, level: lastCheck.level, text: lastCheck.summary });
  const lastSeen = notes.filter(n => n.by === 'Kimon').map(n => n.tsUTC).sort().pop() || '';
  return {
    alerts: alerts.sort((a, b) => String(b.ts).localeCompare(String(a.ts))),
    logs: logs.reverse(), lastCheck, checkDue: !lastCheck || new Date(lastCheck.ts).getTime() < weekAgo,
    habitDays: habitDays.size, medsDays: medsDays.size, said: said.reverse(), lastSeen,
  };
}

// The newest nudge Kimon hasn't acknowledged yet.
export function pendingNudge(canon) {
  const notes = canon.notes || [];
  const lastSeen = notes.filter(n => n.tag === TAGS.seen).map(n => n.tsUTC).sort().pop() || '';
  const n = notes.filter(x => x.tag === TAGS.nudge && x.tsUTC > lastSeen).pop();
  return n ? { ts: n.tsUTC, from: n.by, text: noteSummary(n).replace(/^NUDGE:\s*/i, '') } : null;
}

// The North Star number: things Kimon added himself in one week, counted from
// rows the server attributed to him. Test rows and repeat sends are already
// excluded (the server refuses a repeated opId). Also returns how many
// different days he was active, so a burst on one day is visible as such.
export function weeklyKimonEntries(canon = {}, weekStart = new Date(Date.now() - 7 * 86400000)) {
  const from = new Date(weekStart).getTime(), to = from + 7 * 86400000;
  const inWeek = ts => { const t = new Date(ts).getTime(); return t >= from && t < to; };
  const items = [];
  for (const n of canon.notes || []) if (n.by === 'Kimon' && inWeek(n.tsUTC)) items.push({ kind: 'note:' + n.tag, ts: n.tsUTC });
  for (const c of canon.checkins || []) if (c.by === 'Kimon' && inWeek(c.tsUTC)) items.push({ kind: 'checkin', ts: c.tsUTC });
  for (const r of canon.testResults || []) {
    const ts = r.measuredAt || r.date;
    if (r.source === 'Kimon' && inWeek(ts)) items.push({ kind: r.result === 'retracted' ? 'reading-retracted' : 'result', ts });
  }
  for (const c of canon.changelog || []) if (c.by === 'Kimon' && c.tab === 'Medications' && inWeek(c.ts)) items.push({ kind: 'medicine', ts: c.ts });
  return { count: items.length, activeDays: new Set(items.map(i => melbDay(i.ts))).size, byKind: items.reduce((o, i) => ((o[i.kind] = (o[i.kind] || 0) + 1), o), {}) };
}

// Removing a mistaken entry: the sheet stays append-only. A "removed" note
// points at the entry's timestamp and tag; liveNotes() hides both. Only
// symptom logs and body checks can be removed this way.
export const REMOVABLE = ['symptom-log', 'body-check'];
export function removalNote(n) {
  const nid = n.nid || noteData(n)?.nid;
  return { tag: 'removed', text: noteText('REMOVED: entered by mistake', { tag: n.tag, ...(nid ? { nid } : { removes: n.tsUTC }) }) };
}
export function liveNotes(notes = []) {
  const gone = new Set();
  for (const n of notes) {
    if (n.tag !== 'removed') continue;
    const d = noteData(n);
    if (d && REMOVABLE.includes(d.tag)) gone.add(d.nid ? `id|${d.nid}` : `${d.tag}|${d.removes}`);
  }
  return notes.filter(n => {
    if (n.tag === 'removed') return false;
    if (!REMOVABLE.includes(n.tag)) return true;
    const nid = noteData(n)?.nid;
    return !gone.has(`${n.tag}|${n.tsUTC}`) && !(nid && gone.has(`id|${nid}`));
  });
}
