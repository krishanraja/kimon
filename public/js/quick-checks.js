// Quick questions: small loose ends in Kimon's record that only he can
// settle, each answered with one tap. Worked out from the sheet every time,
// so a question disappears as soon as it is answered by anyone, anywhere.
// Each answer says exactly which writes it makes; the app makes them, then
// saves a "quick-check" note so the question is never asked twice.
// Pure: no DOM, no network. Browser, server and tests.
import { noteData, noteSummary, melbDay, TAGS, tabletDays } from './kimon-model.js';
import { MED_CATALOG } from './med-catalog.js';
import { currentMeds } from './meds-model.js';
import { bpSeries, fmtDate } from './metrics.js';

export const QUICK_TAG = 'quick-check';
const DAY = 86400000;

// Brand names and short forms people say, mapped to the name on the list.
// Product names only; anything else matches on the first word of the name.
const ALIASES = {
  'Prednisolone': ['solone', 'prednisolone', 'panafcortelone'],
  'Vitamin D (colecalciferol)': ['vitamin d', 'vit d', 'colecalciferol', 'ostelin'],
  'Aspirin (low dose)': ['aspirin', 'cartia', 'astrix'],
  'Rosuvastatin': ['rosuvastatin', 'crestor'],
  'Atorvastatin': ['atorvastatin', 'lipitor'],
  'Metoprolol': ['metoprolol', 'betaloc', 'minax'],
  'Glyceryl trinitrate spray': ['glyceryl trinitrate', 'nitrolingual', 'gtn spray'],
  'Frusemide (furosemide)': ['frusemide', 'furosemide', 'lasix'],
};
const lower = s => String(s || '').toLowerCase();
const stem = n => lower(n).split(/[\s(]/)[0];
const termsFor = name => ALIASES[name] || [stem(name)];
const has = (text, term) => new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(lower(text));

// Which quick questions he has already answered (or the family has, for
// the same id). Answers live in Notes, tag quick-check, DATA {id, answer}.
export function answeredIds(canon = {}) {
  return new Set((canon.notes || []).filter(n => n.tag === QUICK_TAG).map(n => noteData(n)?.id).filter(Boolean));
}

export function quickChecks(canon = {}, now = new Date()) {
  const done = answeredIds(canon);
  const out = [];
  const meds = currentMeds(canon);
  const listed = (canon.medications || []).filter(m => m.name);

  // 1. A medicine on the list "when needed" that he described as only for a test.
  for (const m of meds.current) {
    if (m.when !== 'When needed') continue;
    const id = `med-when:${m.name}`;
    if (done.has(id)) continue;
    const base = { name: m.name, dose: m.dose, existing: true };
    out.push({
      id, kind: 'medicine', title: m.name,
      q: `When do you take ${m.name}${m.dose ? ' ' + m.dose : ''}?`,
      opts: [
        { k: 'test', label: 'Only before a test or scan', writes: [{ action: 'medication', payload: { ...base, frequency: 'Before a test or procedure', status: 'current' } }] },
        { k: 'needed', label: 'When I need it', writes: [] },
        { k: 'stopped', label: "I don't take it now", writes: [{ action: 'medication', payload: { ...base, frequency: m.when, status: 'stopped' } }] },
      ],
    });
  }

  // 2. A medicine he named in his own words that is not on the list at all.
  const said = (canon.notes || []).filter(n => n.by === 'Kimon' && ['found-out', TAGS.talk, 'fact'].includes(n.tag));
  for (const [name] of MED_CATALOG) {
    if (listed.some(m => termsFor(name).some(t => has(m.name, t)) || stem(m.name) === stem(name))) continue;
    const from = said.find(n => termsFor(name).some(t => has(noteSummary(n), t)));
    if (!from) continue;
    // Use his word for it: "Solone (prednisolone)", not a name he didn't say.
    const generic = name.replace(/ \(.*\)$/, '');
    const word = termsFor(name).find(t => has(noteSummary(from), t));
    const spoken = word && !lower(generic).startsWith(word) ? `${word[0].toUpperCase()}${word.slice(1)} (${lower(generic)})` : generic;
    const id = `mentioned:${name}`;
    if (done.has(id)) continue;
    const add = status => ({ action: 'medication', payload: { name, dose: '', frequency: '', status } });
    out.push({
      id, kind: 'medicine', title: spoken.replace(/ \(.*\)$/, ''),
      q: `You mentioned ${spoken} on ${fmtDate(melbDay(from.tsUTC))}. Do you take it now?`,
      opts: [
        { k: 'yes', label: 'Yes, add it to my list', writes: [add('current')] },
        { k: 'finished', label: "No, I've finished it", writes: [add('stopped')] },
        { k: 'unsure', label: "I'm not sure", writes: [add('unconfirmed')] },
      ],
    });
  }

  // 3. The cardiology appointment gap, still open.
  for (const g of canon.gaps || []) {
    if (g.status === 'closed' || !/cardiolog/i.test(g.gap) || !/appointment|date/i.test(g.gap)) continue;
    const id = `gap:${g.id}`;
    if (done.has(id)) continue;
    out.push({
      id, kind: 'record', title: 'Heart specialist',
      q: 'Have you seen the heart specialist (cardiologist) yet?',
      opts: [
        { k: 'seen', label: "Yes, I've seen them", writes: [{ action: 'gap', payload: { id: g.id, status: 'closed' } }] },
        { k: 'booked', label: 'Not yet, it is booked', writes: [{ action: 'gap', payload: { id: g.id, status: 'in-progress' } }] },
        { k: 'no', label: 'Not yet', writes: [] },
      ],
    });
  }

  // 4. Two doctor questions with an answer he can give in one tap.
  const changes = (canon.changelog || []).filter(c => c.tab === 'Medications' && /\.status$/.test(c.key) && c.new === 'stopped')
    .map(c => `${String(c.key).replace(/\.status$/, '')} stopped`);
  const QS = [
    { re: /medication changes/i, q: 'Did your doctors recommend any medicine changes?', opts: [
      ...(changes.length ? [{ k: 'list', label: `Only ${changes.join(', ')}`, answer: `Only ${changes.join(', ')} (Kimon, ${fmtDate(melbDay(now))})` }] : []),
      { k: 'none', label: 'No changes', answer: `No changes (Kimon, ${fmtDate(melbDay(now))})` },
      { k: 'later', label: 'Not discussed yet', answer: null },
    ] },
    { re: /how often should he be reviewed/i, q: 'How often will you see a doctor about your heart?', opts: [
      ...['Every 3 months', 'Every 6 months', 'Once a year'].map(a => ({ k: a, label: a, answer: `${a} (Kimon, ${fmtDate(melbDay(now))})` })),
      { k: 'later', label: 'Not decided yet', answer: null },
    ] },
  ];
  for (const x of QS) {
    const qn = (canon.questions || []).find(q => q.status !== 'answered' && x.re.test(q.question));
    if (!qn) continue;
    const id = `q:${qn.id}`;
    if (done.has(id)) continue;
    out.push({
      id, kind: 'record', title: 'For your family', q: x.q,
      opts: x.opts.map(o => ({ k: o.k, label: o.label, writes: o.answer ? [{ action: 'question', payload: { id: qn.id, status: 'answered', answer: o.answer } }] : [] })),
    });
  }

  // 5. Days this week he saved a reading but did not tick his tablets.
  if (meds.current.length) {
    const ticked = tabletDays(canon.notes || [], 'Kimon');
    // Days he already answered about, whatever he said, are never asked again.
    const askedDays = new Set([...done].filter(id => id.startsWith('tablets:')).flatMap(id => id.slice(8).split(',')));
    const today = melbDay(now);
    const days = [...new Set(bpSeries(canon.testResults || []).readings
      .filter(r => r.by === 'Kimon' && now.getTime() - new Date(r.at).getTime() <= 7 * DAY)
      .map(r => melbDay(r.at)))].filter(d => d !== today && !ticked.has(d) && !askedDays.has(d)).sort();
    const id = `tablets:${days.join(',')}`;
    if (days.length && !done.has(id)) {
      const names = days.map(d => new Date(`${d}T12:00:00+11:00`).toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'Australia/Melbourne' }));
      out.push({
        id, kind: 'tablets', title: 'Tablets',
        q: `Your tablets were not ticked on ${names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]}. Did you take them?`,
        opts: [
          { k: 'yes', label: days.length === 1 ? 'Yes, I took them' : 'Yes, every day', writes: [{ note: { tag: TAGS.meds, summary: 'MEDS: taken (ticked later)', data: { meds: meds.current.map(m => m.name), days, late: true } } }] },
          { k: 'some', label: 'I missed some', writes: [] },
          { k: 'unsure', label: "I'm not sure", writes: [] },
        ],
      });
    }
  }
  return out;
}

// At most one question a day, so it never feels like a form. None if he
// has already answered one today (Melbourne). Tablets come first: the days
// in question slip out of the week and out of his memory soonest.
const FIRST = { tablets: 0, medicine: 1, record: 2 };
export function todaysQuestion(canon = {}, now = new Date()) {
  const today = melbDay(now);
  if ((canon.notes || []).some(n => n.tag === QUICK_TAG && n.by === 'Kimon' && melbDay(n.tsUTC) === today)) return null;
  const list = quickChecks(canon, now);
  return list.map((c, i) => ({ c, i })).sort((a, b) => (FIRST[a.c.kind] ?? 9) - (FIRST[b.c.kind] ?? 9) || a.i - b.i)[0]?.c || null;
}

// The note that records his answer. Plain words first, for the family feed.
export function quickNote(check, opt) {
  return { tag: QUICK_TAG, summary: `QUICK CHECK: ${check.q} ${opt.label}`, data: { id: check.id, answer: opt.k } };
}
