// His medicines: one current list, read from the Medications tab.
// The family's older care-plan list and anything Leffy picked up in chat are
// never treated as confirmed: they show up as "not sure yet" until someone
// confirms them in the list. Pure functions; browser, server and tests.
import { readPlan } from './kimon-model.js';
import { facts } from './knowledge-bank.js';
import { parseDate } from './metrics.js';

export const MED_STATUS = { current: 'current', stopped: 'stopped', unconfirmed: 'unconfirmed', removed: 'removed', superseded: 'superseded' };
export const CONFIRM_TAG = 'meds-confirmed';
// One medicine checked and found unchanged. It never stands in for "took today's dose".
export const MED_CHECK_TAG = 'med-checked';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// First word of a medicine name, e.g. "Medicine A 10 mg" -> "medicine".
// Good enough to tell whether two names are about the same drug.
const stem = s => norm(s).split(' ').filter(w => !/^\d/.test(w) && !['mg', 'mcg', 'tablet', 'tablets', 'daily', 'low', 'dose'].includes(w)).slice(0, 2).join(' ');
// Sheets hands dates back as "Tue Nov 03 2026 ..." or ISO; compare as YYYY-MM-DD.
const dayOf = ts => { const p = parseDate(ts); return p ? `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : ''; };

// Latest Changelog entry for a medicine name: who changed it and when.
function lastChange(canon, name) {
  const k = norm(name);
  return (canon.changelog || []).filter(c => c.tab === 'Medications' && norm(String(c.key).split('.')[0]) === k)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts))).pop() || null;
}

export function currentMeds(canon = {}) {
  const rows = (canon.medications || []).filter(m => m.name && m.status !== MED_STATUS.superseded && m.status !== MED_STATUS.removed);
  const item = (m, from = 'list') => {
    const ch = from === 'list' ? lastChange(canon, m.name) : null;
    return { name: m.name, dose: m.dose || '', when: m.frequency || m.when || '', status: m.status || 'current', from, updated: dayOf(m.updated), by: ch?.by || '' };
  };
  const listed = rows.map(m => item(m));
  const known = new Set((canon.medications || []).map(m => stem(m.name)));

  // The family's care plan list, only where the main list says nothing.
  const legacy = readPlan(canon.profile).meds.filter(m => m.name && !known.has(stem(m.name)))
    .map(m => ({ ...item({ name: m.name, when: m.when, status: 'unconfirmed' }, 'family-list') }));

  const lastUpdate = [...(canon.medications || []).map(m => dayOf(m.updated)), ...(canon.changelog || []).filter(c => c.tab === 'Medications').map(c => dayOf(c.ts))]
    .filter(Boolean).sort().pop() || '';
  const confirmed = (canon.notes || []).filter(n => n.tag === CONFIRM_TAG && n.by !== 'claude-test').map(n => ({ ts: n.tsUTC, by: n.by })).sort((a, b) => String(a.ts).localeCompare(String(b.ts))).pop() || null;

  // Medicine facts Leffy picked up in chat. They never change the list.
  // A fact is "stale" when the list was updated after it was learned, and
  // "conflict" when it names a medicine the list does not have as current.
  const currentStems = new Set(listed.filter(m => m.status === 'current').map(m => stem(m.name)));
  // Exact time of the latest list change where the change log has it, so a
  // fact learned earlier the same day still counts as older.
  const lastChangeTs = (canon.changelog || []).filter(c => c.tab === 'Medications').map(c => String(c.ts)).sort().pop() || '';
  const chat = facts(canon).filter(f => f.topic === 'medicine').map(f => {
    const stale = lastChangeTs ? String(f.ts) < lastChangeTs : !!lastUpdate && dayOf(f.ts) < lastUpdate;
    const mentionsCurrent = [...currentStems].some(s => s && norm(f.text).includes(s));
    return { text: f.text, ts: f.ts, by: f.by, stale, unconfirmed: true, mentionsCurrent };
  });

  return {
    current: listed.filter(m => m.status === 'current'),
    unconfirmed: [...listed.filter(m => m.status === 'unconfirmed'), ...legacy],
    stopped: listed.filter(m => m.status === 'stopped'),
    updatedAt: lastUpdate,
    confirmed,
    chat,
    empty: !listed.length && !legacy.length,
  };
}

// The block Leffy reads first. Its rules are what stop an old chat fact from
// overriding a newer correction, and stop "not on the list" being read as
// "he doesn't take it".
export function medsContext(canon) {
  const m = currentMeds(canon);
  const line = x => `- ${x.name}${x.dose ? ' ' + x.dose : ''}${x.when ? ', ' + x.when : ''}${x.updated ? ` (updated ${x.updated}${x.by ? ' by ' + x.by : ''})` : ''}`;
  const L = ['## Medicines: the confirmed list (this is the truth; it wins over anything else)'];
  if (m.empty) L.push('No medicines are recorded. Do not assume he takes none: say they are not recorded yet and ask.');
  L.push(m.current.length ? m.current.map(line).join('\n') : '(no confirmed current medicines)');
  if (m.confirmed) L.push(`Kimon last confirmed this list is right on ${dayOf(m.confirmed.ts)}.`);
  else if (m.updatedAt) L.push(`List last changed ${m.updatedAt}.`);
  if (m.unconfirmed.length) L.push('### Not confirmed yet (may or may not be taking)', m.unconfirmed.map(x => `${line(x)}${x.from === 'family-list' ? ' [from the family\'s older list]' : ''}`).join('\n'));
  if (m.stopped.length) L.push('### Stopped', m.stopped.map(line).join('\n'));
  if (m.chat.length) {
    L.push('### Picked up in chat (unconfirmed; the list above wins)');
    m.chat.slice(0, 10).forEach(f => L.push(`- ${dayOf(f.ts)}: ${f.text}${f.stale ? ' [older than the latest list change: treat as out of date]' : ''}`));
  }
  L.push('Rules: a medicine missing from the list is NOT evidence he does not take it; say it is not recorded and ask. Being on the list is NOT evidence he took today\'s dose; the tablets log says that. Never suggest starting, stopping or changing a medicine.');
  return L.join('\n');
}

// A medicine row as Kimon sees it, e.g. "Medicine A (synthetic) · 10 mg · night".
export function medLine(m) { return [m.name, m.dose, m.when].filter(Boolean).join(' · '); }

// Has Kimon said the list is right since it last changed?
export function needsCheck(canon) {
  const m = currentMeds(canon);
  if (m.unconfirmed.length) return true;
  return !m.confirmed || (m.updatedAt && dayOf(m.confirmed.ts) < m.updatedAt);
}

