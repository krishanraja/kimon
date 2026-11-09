// Kimon's own app. Three tabs: Today (his journal page and week), Health (his
// readings over time) and Medicines (the one list, easy to correct).
// Each screen asks one
// thing of him: one primary button, just above the tabs.
import { canRecord, startRecording, transcribeBlob, fmtTime } from './recorder.js';
import { pickPhoto, shrink } from './photo.js';
import { fmtDate, bpSeries, bpInsight, daysUntil } from './metrics.js';
import { triage } from './triage.js';
import { removalNote, liveNotes, REMOVABLE } from './kimon-model.js';
import { SYMPTOMS, WHEN, SEVERITY, BODY_CHECK, TAGS, symptomLevel, checkLevel, noteText, melbDay, pendingNudge, tabletDays } from './kimon-model.js';
import { currentMeds, medLine, needsCheck, CONFIRM_TAG, MED_CHECK_TAG } from './meds-model.js';
import { createOutbox, newOpId } from './outbox.js';
import { todaysQuestion, quickNote } from './quick-checks.js';
import { MED_CATALOG, MED_WHEN, NOT_SURE, strengthsOf, inCatalog } from './med-catalog.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#me');
const TZ = 'Australia/Melbourne';

/* ---------- storage ---------- */
let storageOk = true;
const ls = (() => { try { localStorage.setItem('kimon.me.t', '1'); return localStorage; } catch { storageOk = false; const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; } })();
const store = {
  get(k, d) { try { const v = ls.getItem('kimon.me.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { ls.setItem('kimon.me.' + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};
const outbox = createOutbox({ storage: ls });
let canon = store.get('canon', null);
let loadedAt = store.get('loadedAt', '');
let fresh = false; // true once the server answered this session
// 'fresh' = loaded from the server now; 'copy' = an older copy on this phone;
// 'none' = nothing loaded. Never show an empty record as if it were the truth.
const recordState = () => (fresh ? 'fresh' : loadedAt ? 'copy' : 'none');
// Old queue items (before opIds): move them into the outbox once.
for (const it of store.get('queue', [])) outbox.pending().some(x => x.payload === it.payload) || ls.setItem('kimon.me.outbox', JSON.stringify([...outbox.pending(), { ...it, opId: newOpId(), ts: new Date().toISOString() }]));
store.set('queue', []);

/* ---------- data ---------- */
async function load() {
  try {
    const r = await fetch('/api/canon', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    if (r.status === 401) return toLogin();
    if (r.ok) {
      const server = await r.json();
      // Keep anything still waiting on this phone visible until the server has it.
      const waiting = outbox.pending();
      const ids = new Set((server.testResults || []).map(x => x.id).filter(Boolean));
      for (const w of waiting) {
        if (w.action === 'reading' && !ids.has(w.payload.id)) (server.testResults ||= []).push(localReading(w.payload));
        if (w.action === 'note') (server.notes ||= []).push({ tsUTC: w.ts, by: 'Kimon', tag: w.payload.tag, text: w.payload.text, local: true });
      }
      canon = server; fresh = true; loadedAt = new Date().toISOString();
      store.set('canon', canon); store.set('loadedAt', loadedAt);
    }
  } catch { /* offline: keep the copy on this phone */ }
}
function toLogin() { location.replace('/'); }
// The single way anything is saved. Returns 'saved' | 'queued' | 'auth' | 'rejected' | 'unsafe'.
async function send(action, payload, opId) {
  const r = await outbox.send(action, payload, opId);
  if (r.status === 'auth') setTimeout(toLogin, 1800);
  return r.status;
}
async function flush() {
  const r = await outbox.flush();
  if (r.auth) toLogin();
  return r;
}
addEventListener('online', async () => { await flush(); await load(); rerender(); });
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && outbox.count()) { await flush(); rerender(); } });

function localReading(p) {
  return { date: melbDay(p.measuredAt), test: 'Blood pressure', result: p.retract ? 'retracted' : `${p.sys}/${p.dia} mmHg`, lab: '', notes: p.supersedes ? 'Corrected' : 'Typed in on the phone', source: 'Kimon', measuredAt: p.measuredAt, id: p.id, supersedes: p.supersedes || '', local: true };
}
let lastNote = null; // the entry just saved, so a mistake can be removed straight away
function addNoteLocal(tag, text) {
  const n = { tsUTC: new Date().toISOString(), by: 'Kimon', tag, text, local: true };
  ((canon ||= {}).notes ||= []).push(n); store.set('canon', canon);
  lastNote = n;
}
async function note(tag, summary, data) {
  // Symptom logs and body checks carry an id, so a mistake can be removed later.
  const d = data && REMOVABLE.includes(tag) ? { ...data, nid: newOpId() } : data;
  const text = d ? noteText(summary, d) : summary;
  addNoteLocal(tag, text);
  return send('note', { text, tag });
}
// Remove an entry saved by mistake: a "removed" marker; the sheet keeps both.
async function removeNote(n) {
  const r = removalNote(n);
  canon.notes = liveNotes([...(canon.notes || []), { ...r, tsUTC: new Date().toISOString(), by: 'Kimon' }]);
  store.set('canon', canon);
  return send('note', r);
}
// Status of a reading by id: saved on the server, or still on this phone.
const waitingIds = () => new Set(outbox.pending().filter(x => x.action === 'reading').map(x => x.payload.id));
const statusOf = r => (waitingIds().has(r.id) ? 'wait' : 'ok');

/* ---------- formatting ---------- */
const timeOf = ts => new Date(ts).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).replace(' ', ' ').toLowerCase();
const dayName = ts => new Date(ts).toLocaleDateString('en-AU', { weekday: 'short', timeZone: TZ });
const today = () => melbDay(new Date());
function whenLabel(ts) {
  const d = melbDay(ts), t = today();
  const y = melbDay(new Date(Date.now() - 86400000));
  return d === t ? `Today ${timeOf(ts)}` : d === y ? `Yesterday ${timeOf(ts)}` : `${dayName(ts)} ${fmtDate(d)}, ${timeOf(ts)}`;
}

/* ---------- icons: 24px stroke, like the family app's tabs ---------- */
const P = {
  journal: '<path d="M6 3.5h11a2 2 0 0 1 2 2v15H7.5A2.5 2.5 0 0 1 5 18V4.5a1 1 0 0 1 1-1z"/><path d="M5 18a2.5 2.5 0 0 1 2.5-2.5H19"/><path d="M9 7.5h6M9 11h4"/>',
  trend: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  pill: '<path d="M10.6 20.1a4.9 4.9 0 0 1-6.9-6.9l9.5-9.5a4.9 4.9 0 0 1 6.9 6.9z"/><path d="M8.4 8.4l7.2 7.2"/>',
  unwell: '<path d="M12 20s-7-4.3-7-9.4C5 7.9 7 6 9.3 6c1.1 0 2.1.5 2.7 1.3C12.6 6.5 13.6 6 14.7 6 17 6 19 7.9 19 10.6 19 15.7 12 20 12 20z"/><path d="M12 9.5v5M9.5 12h5"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l3.6-4.2"/><circle cx="12" cy="16" r="1.2"/><path d="M4 19.5h16"/>',
  chat: '<path d="M20 12.5a7.5 7.5 0 0 1-11.1 6.6L4 20l1-4.4A7.5 7.5 0 1 1 20 12.5z"/><path d="M9 11.5h.01M12.5 11.5h.01M16 11.5h.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/><path d="M5 20h14"/>',
  chev: '<path d="M9 5l7 7-7 7"/>', back: '<path d="M15 5l-7 7 7 7"/>',
  del: '<path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6z"/><path d="M12 10l4 4M16 10l-4 4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  stop: '<path d="M10.6 20.1a4.9 4.9 0 0 1-6.9-6.9l9.5-9.5a4.9 4.9 0 0 1 6.9 6.9z"/><path d="M3 3l18 18"/>',
  q: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.5a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.4"/><path d="M12 16.8h.01"/>',
  cam: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  record: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  body: '<circle cx="12" cy="5" r="2"/><path d="M12 7v7M8 10h8M9.5 21l2.5-7 2.5 7"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  phoneoff: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  leffy: '<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6zM18 13l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9z"/>',
};
const ic = (id, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[id] || ''}</svg>`;
const chip = (kind, text, icon) => `<span class="j-chip ${kind}">${icon ? ic(icon, 's16') : ''}${esc(text)}</span>`;
const primary = (label, icon, attrs = '', cls = 'primary') => `<button class="btn ${cls}" data-primary ${attrs}>${icon ? ic(icon, 's20') : ''}${esc(label)}</button>`;
const link = (label, attrs) => `<button class="j-esc" ${attrs}>${esc(label)}</button>`;

/* ---------- the frame ---------- */
let tab = 'today';
let current = () => todayScreen();
function frame({ eyebrow = '', title, back = null, body, act = '', tabId = tab, unwell = false }) {
  tab = tabId;
  const t = (id, icon, label) => `<button class="j-tab" data-tab="${id}"${tab === id && !unwell ? ' aria-current="page"' : ''}>${ic(icon)}<span>${label}</span></button>`;
  app.innerHTML = `<header class="j-top">${back ? `<button class="j-backbtn" data-back aria-label="Back">${ic('back')}</button>` : ''}
      <div class="j-title">${eyebrow && !back ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h1>${esc(title)}</h1></div>
</header>
    <main class="j-main">${body}${act ? `<div class="j-act j-push">${act}</div>` : ''}</main>
    <nav class="j-nav" aria-label="Sections">${t('today', 'journal', 'Today')}${t('health', 'trend', 'Health')}${t('meds', 'pill', 'Medicines')}${t('leffy', 'leffy', 'Ask Leffy')}</nav>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
  if (back) $('[data-back]').onclick = back;
}
function go(id) {
  // Leffy's chat lives in the main app; it opens with these same four tabs.
  if (id === 'leffy') return location.assign('/?full=1&leffy=1');
  ({ today: todayScreen, health: healthScreen, meds: medsScreen })[id]();
}
function screen(fn) { current = fn; fn(); }
function rerender() { if (app.dataset.tabroot === '1') current(); }
const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
const onAll = (sel, fn) => app.querySelectorAll(sel).forEach(el => el.onclick = () => fn(el));

// How many list rows of a given height fit above the action zone, given
// what else is on the screen. Lists page instead of ever scrolling.
// A size variable in real pixels (they are calc() expressions in the CSS).
function px(v) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;height:var(${v})`;
  app.appendChild(probe); const h = probe.getBoundingClientRect().height; probe.remove();
  return h;
}
function fits(rowVar, other) {
  const rowH = px(rowVar), gap = px('--gap');
  const h = (app.clientHeight || innerHeight) - 128 - 16 - 54 - other - gap * 2;
  return Math.max(1, Math.floor(h / rowH));
}

/* ---------- Today ---------- */
function readings() { return bpSeries((canon?.testResults) || []).readings; }
function tabletsDays() { return tabletDays(canon?.notes || [], 'Kimon'); }

function weekStrip() {
  const rs = readings(), tabs = tabletsDays(), hasMeds = !currentMeds(canon || {}).empty;
  const waiting = waitingIds();
  let out = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000), key = melbDay(d), isToday = i === 0;
    const r = rs.find(x => melbDay(x.at) === key);
    const wait = r && waiting.has(r.id);
    const took = tabs.has(key);
    const pm = !hasMeds ? 'off' : took ? 'yes' : isToday ? 'no' : 'no';
    const label = `${d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })}: ${r ? `blood pressure ${r.sys} over ${r.dia}${wait ? ', waiting to send' : ''}` : 'no reading'}${hasMeds ? `; tablets ${took ? 'ticked' : 'not ticked'}` : ''}`;
    out += `<div class="j-day${isToday ? ' today' : ''}" role="img" aria-label="${esc(label)}">
      <span class="dl">${d.toLocaleDateString('en-AU', { weekday: 'narrow', timeZone: TZ })}</span><span class="dn">${d.toLocaleDateString('en-AU', { day: 'numeric', timeZone: TZ })}</span>
      <span class="v ${r ? (wait ? 'wait' : '') : 'none'}">${r ? r.sys : '·'}</span><span class="pm ${pm}"></span></div>`;
  }
  return `<section class="j-card j-week" aria-label="This week: top number of each day's reading, and tablets ticked">${out}</section>`;
}

function todayState() {
  const rs = readings(), t = today();
  const todays = rs.filter(r => melbDay(r.at) === t);
  const latest = todays[0] || null;
  const waiting = outbox.pending();
  const meds = currentMeds(canon || {});
  const took = tabletsDays().has(t);
  return { latest, last: rs[0] || null, waiting, meds, took, nudge: canon ? pendingNudge(canon) : null };
}

function todayScreen() {
  current = todayScreen; app.dataset.tabroot = '1';
  const s = todayState();
  const rec = recordState();
  const r = s.latest;
  const rStatus = r ? statusOf(r) : null;
  const bp = r
    ? `<b class="num">${r.sys} / ${r.dia}<em>mmHg</em></b>${rStatus === 'wait' ? '<small class="wait">Waiting to send</small>' : `<small>Measured ${esc(timeOf(r.at))}</small>`}`
    : s.last ? `<b class="dim">Blood pressure</b><small>Last: ${s.last.sys}/${s.last.dia}, ${esc(whenLabel(s.last.at))}</small>` : `<b class="dim">Blood pressure</b><small>${rec === 'none' ? 'Past readings not loaded' : 'No readings yet'}</small>`;
  const bpChip = r ? (rStatus === 'wait' ? chip('wait', 'On phone', 'phoneoff') : chip('ok', 'Saved', 'check')) : chip('todo', 'To do');
  const nMeds = s.meds.current.length;
  const tb = rec === 'none' ? '<b class="dim">Today\'s tablets</b><small>Medicines not loaded</small>'
    : !nMeds && s.meds.empty ? '<b class="dim">Today\'s tablets</b><small>No medicines listed yet</small>'
    : s.took ? '<b>Today\'s tablets</b><small>Ticked today</small>' : `<b>Today's tablets</b><small>${nMeds ? `${nMeds} medicine${nMeds === 1 ? '' : 's'} on your list` : 'Check your list'}</small>`;
  const tbChip = rec === 'none' ? chip('none', 'Not loaded') : s.meds.empty ? chip('none', 'None') : s.took ? chip('ok', 'Taken', 'check') : chip('todo', 'To do');
  // What he sent today stays visible with its real status; a newer family
  // message takes the row first.
  const sentToday = (canon?.notes || []).filter(x => x.tag === TAGS.talk && x.by === 'Kimon' && melbDay(x.tsUTC) === today()).pop();
  const sentWaiting = sentToday && outbox.pending().some(x => x.action === 'note' && x.payload.text === sentToday.text);
  const fam = s.nudge
    ? `<b>From ${esc(/^(app|)$/i.test(s.nudge.from) ? 'family' : s.nudge.from)}</b><small>“${esc(s.nudge.text)}”</small>`
    : sentToday ? `<b>You sent</b><small>“${esc(String(sentToday.text).replace(/^KIMON SAYS:\s*/, ''))}”</small>`
      : '<b>Tell the family</b><small>How you are, or just hello</small>';
  const famChip = s.nudge ? chip('time', timeOf(s.nudge.ts)) : sentToday ? (sentWaiting ? chip('wait', 'On phone', 'phoneoff') : chip('ok', 'Sent', 'check')) : ic('chev', 's16 chev');
  const left = [!r, !s.meds.empty && !s.took].filter(Boolean).length;
  // One status line, most important first. Fixed slot; nothing else moves.
  const head = !storageOk ? '<span class="stale">Not kept on this phone</span>'
    : rec === 'none' ? '<span class="stale">Your record did not load</span>'
    : s.waiting.length ? `<span class="stale">${s.waiting.length} waiting to send</span>`
      : rec === 'copy' ? `<span class="stale">Phone copy from ${esc(timeOf(loadedAt))}</span>`
        : `<span>${left ? `${left} thing${left === 1 ? '' : 's'} left` : 'All done today'}</span>`;

  // The one thing to do now.
  let act;
  if (s.waiting.length) act = primary(`Send ${s.waiting.length === 1 ? 'it' : 'them'} now`, 'send', 'data-flush');
  else if (!r) act = primary("Add today's reading", 'plus', 'data-add');
  else if (!s.meds.empty && !s.took) act = primary("I took today's tablets", 'check', 'data-took');
  // Today's things done: a few one-tap questions, if any, and not skipped today.
  else if (quickDue()) act = primary('One quick question', 'q', 'data-quick');
  else act = primary('Add another reading', 'plus', 'data-add');

  const d = new Date();
  frame({
    eyebrow: d.toLocaleDateString('en-AU', { weekday: 'long', timeZone: TZ }),
    title: d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: TZ }),
    tabId: 'today',
    body: `${weekStrip()}
      <section class="j-card j-page" aria-label="Today">
        <div class="j-page-h"><b>Today</b>${head}</div>
        <button class="j-row" data-readings><span class="j-ic bp">${ic('gauge', 's20')}</span><span class="j-tx">${bp}</span>${bpChip}</button>
        <button class="j-row" data-meds><span class="j-ic tabl">${ic('pill', 's20')}</span><span class="j-tx">${tb}</span>${tbChip}</button>
        <button class="j-row" data-talk><span class="j-ic fam">${ic('chat', 's20')}</span><span class="j-tx">${fam}</span>${famChip}</button>
      </section>
`,
    act,
  });
  on('[data-add]', () => bpEntry());
  on('[data-quick]', () => quickFlow());
  on('[data-readings]', () => readingsScreen(() => todayScreen()));
  const tick = async b => {
    if (b) b.disabled = true;
    const st = await note(TAGS.meds, 'MEDS: taken', { meds: s.meds.current.map(m => m.name) });
    todayScreen();
    toast(st === 'saved' ? 'Ticked. Saved.' : st === 'unsafe' ? 'Not saved. Keep the app open and try again.' : 'Ticked. Waiting to send.');
  };
  // While today's tablets are still to do, the row ticks them, the same as
  // the button. Once ticked, it opens the list.
  on('[data-meds]', () => (rec !== 'none' && s.meds.current.length && !s.took ? tick($('[data-meds]')) : medsScreen()));
  on('[data-talk]', () => talk());
  on('[data-flush]', async () => {
    const b = $('[data-flush]'); b.disabled = true; b.lastChild.textContent = 'Sending…';
    const res = await flush(); await load(); todayScreen();
    if (res.left) toast('Still offline. It stays on this phone and sends by itself.');
  });
  on('[data-took]', () => tick($('[data-took]')));
}

/* ---------- blood pressure entry ---------- */
// fix: a reading being corrected (its id goes in "supersedes").
function bpEntry({ fix = null, at = null, sys = '', dia = '' } = {}) {
  app.dataset.tabroot = '';
  const opId = newOpId();
  const v = { sys: fix ? String(fix.sys) : sys, dia: fix ? String(fix.dia) : dia };
  let field = v.sys ? 'dia' : 'sys';
  let when = at || (fix ? fix.at : null); // null = now
  const draw = () => {
    frame({
      eyebrow: fix ? 'Fix a reading' : 'Blood pressure', title: fix ? 'Fix it' : 'Reading', tabId: 'today',
      back: () => todayScreen(),
      body: `<div class="j-fields">
          <button class="j-field ${field === 'sys' ? 'on' : ''}" data-f="sys" aria-label="Top number, ${v.sys || 'empty'}"><span>Top number (mmHg)</span><b>${esc(v.sys)}</b></button>
          <button class="j-field ${field === 'dia' ? 'on' : ''}" data-f="dia" aria-label="Bottom number, ${v.dia || 'empty'}"><span>Bottom number (mmHg)</span><b>${esc(v.dia)}</b></button>
        </div>
        <div class="j-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => `<button class="j-key" data-k="${k}">${k}</button>`).join('')}<span></span><button class="j-key" data-k="0">0</button><button class="j-key fn" data-k="del" aria-label="Delete">${ic('del')}</button></div>`,
      act: `${link(when ? timeOf(when) : 'Now', 'data-when aria-label="Measured at, change"')}${primary(fix ? 'Save correction' : 'Save reading', 'check', 'data-save')}`,
    });
    onAll('[data-f]', b => { field = b.dataset.f; draw(); });
    onAll('[data-k]', b => {
      const k = b.dataset.k;
      if (k === 'del') v[field] = v[field].slice(0, -1);
      else if (v[field].length < 3) { v[field] += k; if (field === 'sys' && v.sys.length === 3) field = 'dia'; }
      draw();
    });
    on('[data-when]', () => pickTime(when, t => { when = t; draw(); }));
    on('[data-save]', () => check());
  };
  // Typed with a hardware keyboard: digits, backspace, tab, enter.
  const keys = e => {
    if (!app.contains($('.j-keys'))) return removeEventListener('keydown', keys);
    if (/^\d$/.test(e.key)) $(`[data-k="${e.key}"]`)?.click();
    else if (e.key === 'Backspace') $('[data-k="del"]')?.click();
    else if (e.key === 'Enter' && !e.target.closest('button')) $('[data-save]')?.click();
  };
  addEventListener('keydown', keys);
  const check = () => {
    const s = v.sys, d = v.dia;
    if (!s || !d) { field = !s ? 'sys' : 'dia'; draw(); return toast(`Type the ${!s ? 'top' : 'bottom'} number`); }
    const a = +s, b = +d;
    // Entry checks only: likely typing slips, not a judgement about his health.
    const swapped = a <= b, odd = a < 50 || a > 300 || b < 20 || b > 200;
    if (swapped || odd) return confirmOdd(a, b, swapped);
    save(a, b);
  };
  const confirmOdd = (a, b, swapped) => {
    frame({
      eyebrow: 'Blood pressure', title: 'Check', tabId: 'today', back: draw,
      body: `<div class="j-fields"><div class="j-field bad"><span>Top number</span><b>${a}</b></div><div class="j-field bad"><span>Bottom number</span><b>${b}</b></div></div>
        <p class="j-note warn">${swapped ? 'The top number is usually the bigger one. They may be the wrong way round.' : 'These numbers look unusual for a home monitor. Check the screen and your typing.'}</p>`,
      act: swapped ? `${link('Save as typed', 'data-asis')}${primary('Swap and save', 'check', 'data-swap')}` : `${link('Save as typed', 'data-asis')}${primary('Fix the numbers', '', 'data-fixnums')}`,
    });
    on('[data-swap]', () => save(b, a));
    on('[data-asis]', () => save(a, b));
    on('[data-fixnums]', () => { field = 'sys'; draw(); });
  };
  let busy = false;
  const save = async (a, b) => {
    if (busy) return; busy = true;
    const p = { id: fix ? 'r-' + opId : 'r-' + opId, sys: String(a), dia: String(b), measuredAt: new Date(when || Date.now()).toISOString(), ...(fix ? { supersedes: fix.id } : {}) };
    ((canon ||= {}).testResults ||= []).push(localReading(p)); store.set('canon', canon);
    const st = await send('reading', p, opId);
    if (st === 'rejected') { canon.testResults = canon.testResults.filter(x => x.id !== p.id); store.set('canon', canon); busy = false; draw(); return toast("That didn't save. Check the numbers and try again."); }
    savedScreen(p, st);
  };
  draw();
}

function pickTime(at, done) {
  const d = new Date(at || Date.now());
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  frame({
    eyebrow: 'When was it taken?', title: 'Time', tabId: 'today', back: () => done(at),
    body: `<div class="j-input j-when"><label for="when">Date and time</label><input id="when" type="datetime-local" value="${local}" max="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></div>
      <p class="j-note">Leave it as now unless you measured earlier.</p>`,
    act: `${link('Now', 'data-now')}${primary('Use this time', 'clock', 'data-use')}`,
  });
  on('[data-now]', () => done(null));
  on('[data-use]', () => { const v = $('#when').value; const t = v ? new Date(v) : null; done(t && !isNaN(t) && t <= new Date() ? t.toISOString() : null); });
}

function savedScreen(p, st) {
  app.dataset.tabroot = '';
  const ok = st === 'saved';
  const b = bpInsight(canon || {});
  const appt = canon?.profile?.next_appointment, inDays = appt ? daysUntil(appt) : null;
  const sofar = !b ? '' : b.streak >= 2 ? `${b.streak} days in a row. ` : `${b.count} reading${b.count === 1 ? '' : 's'} so far. `;
  const avg = b?.week && b.week.n >= 3 ? `Your 7-day average is ${b.week.sys}/${b.week.dia}. ` : '';
  const next = inDays !== null && inDays >= 0 && inDays <= 14 ? (inDays === 0 ? 'Your appointment is today.' : `Your appointment is in ${inDays} day${inDays === 1 ? '' : 's'}.`) : '';
  // A very high or low reading gets the same red-flag rules as everything else.
  const level = triage(`BP ${p.sys}/${p.dia}`).level;
  const msg = ok ? `Saved for your family and Leffy. ${sofar}${avg}${next}`.trim()
    : st === 'auth' ? 'Kept on this phone. Log in again and it sends by itself.'
      : st === 'unsafe' ? 'Not saved, and this phone could not keep a copy. Keep the app open and tap Try again.'
        : "Kept on this phone. It sends by itself as soon as it can. Your family can't see it yet.";
  frame({
    eyebrow: whenLabel(p.measuredAt), title: ok ? 'Saved' : 'Waiting', tabId: 'today',
    body: `${weekStrip()}<section class="j-card j-saved" role="status">
        <span class="seal ${ok ? '' : 'wait'}">${ic(ok ? 'check' : 'phoneoff')}</span>
        <div><h2>${p.supersedes ? 'Corrected' : 'Blood pressure'}</h2><div class="big">${esc(p.sys)} / ${esc(p.dia)}<em>mmHg</em></div></div>
        <p>${esc(msg)}</p></section>
        ${level === 'emergency' || level === 'urgent' ? `<button class="j-card j-row" data-flag><span class="j-ic em">${ic('alert', 's20')}</span><span class="j-tx"><b>About this reading</b><small>See what to do</small></span>${ic('chev', 's16 chev')}</button>` : ''}`,
    act: st === 'unsafe' ? primary('Try again', 'send', 'data-retry') : `${link("That's wrong", 'data-fix')}${primary('Done', '', 'data-done')}`,
  });
  on('[data-done]', () => todayScreen());
  on('[data-fix]', () => { const r = readings().find(x => x.id === p.id); if (r) bpEntry({ fix: r }); else todayScreen(); });
  on('[data-retry]', async () => { const r = await flush(); savedScreen(p, r.left ? 'unsafe' : 'saved'); });
  on('[data-flag]', () => result(level));
}

/* ---------- readings and corrections ---------- */
function readingsScreen(back, page = 0) {
  app.dataset.tabroot = '';
  const { readings: rs, replaced } = bpSeries(canon?.testResults || []);
  const per = fits('--row', 44 + 8), start = page * per;
  const shown = rs.slice(start, start + per);
  const row = r => `<button class="j-row" data-r="${esc(r.id)}" ${r.id ? '' : 'disabled'}><span class="j-ic bp">${ic('gauge', 's20')}</span>
      <span class="j-tx"><b class="num">${r.sys} / ${r.dia}<em>mmHg</em></b><small>${esc(r.exactTime ? whenLabel(r.at) : fmtDate(melbDay(r.at)) + ' · from a photo')}${r.corrected ? ` · fixed from ${r.was.sys}/${r.was.dia}` : ''}</small></span>
      ${statusOf(r) === 'wait' ? chip('wait', 'On phone', 'phoneoff') : chip('ok', 'Saved', 'check')}</button>`;
  frame({
    eyebrow: rs.length ? `${rs.length} since ${fmtDate(melbDay(rs[rs.length - 1].at))}` : 'Blood pressure', title: 'Readings', tabId: 'health', back,
    body: rs.length ? `<section class="j-card j-page">${shown.map(row).join('')}</section>
        <div class="j-foot"><span>${rs.length} since ${fmtDate(melbDay(rs[rs.length - 1].at))} · tap one to fix it</span>
        ${rs.length > per ? `<span>${start > 0 ? '<button data-prev>Newer</button>' : ''}${start + per < rs.length ? ' <button data-next>Older</button>' : ''}</span>` : ''}</div>`
      : '<div class="j-card j-chart"><div class="j-empty-chart">Your readings show here after the first one.</div></div>',
    act: primary('Add a reading', 'plus', 'data-add'),
  });
  on('[data-add]', () => bpEntry());
  on('[data-prev]', () => readingsScreen(back, page - 1));
  on('[data-next]', () => readingsScreen(back, page + 1));
  onAll('[data-r]', b => { const r = rs.find(x => x.id === b.dataset.r); if (r) readingDetail(r, () => readingsScreen(back, page)); });
}

function readingDetail(r, back) {
  frame({
    eyebrow: whenLabel(r.at), title: `${r.sys} / ${r.dia}`, tabId: 'health', back,
    body: `<section class="j-card j-page">
        <div class="j-row"><span class="j-ic bp">${ic('gauge', 's20')}</span><span class="j-tx"><b class="num">${r.sys} / ${r.dia}<em>mmHg</em></b><small>${esc(whenLabel(r.at))}</small></span>${statusOf(r) === 'wait' ? chip('wait', 'On phone', 'phoneoff') : chip('ok', 'Saved', 'check')}</div>
      </section>
      <p class="j-note">Fixing it keeps the first entry in your history, marked as replaced.</p>`,
    act: `${link('Not a real reading', 'data-retract')}${primary('Fix this reading', '', 'data-fix')}`,
  });
  on('[data-fix]', () => bpEntry({ fix: r }));
  on('[data-retract]', () => {
    frame({
      eyebrow: 'Remove this reading?', title: 'Remove', tabId: 'health', back: () => readingDetail(r, back),
      body: `<section class="j-card j-change"><span class="lbl">${r.sys} / ${r.dia} mmHg</span><div class="by">${ic('user', 's16')}It leaves your charts. The sheet keeps a record that you removed it.</div></section>`,
      act: primary('Yes, remove it', '', 'data-yes'),
    });
    on('[data-yes]', async () => {
      const opId = newOpId();
      const p = { id: 'r-' + opId, measuredAt: new Date(r.at).toISOString(), supersedes: r.id, retract: true };
      canon.testResults.push(localReading(p)); store.set('canon', canon);
      const st = await send('reading', p, opId);
      toast(st === 'saved' ? 'Removed. Saved.' : 'Removed. Waiting to send.');
      back();
    });
  });
}

/* ---------- Health ---------- */
function healthScreen() {
  current = healthScreen; app.dataset.tabroot = '1';
  const rs = readings().filter(r => Date.now() - new Date(r.at).getTime() <= 30 * 86400000).reverse();
  let chart;
  if (recordState() === 'none') chart = '<div class="j-empty-chart">Your readings could not load right now. Anything you add is kept on this phone.</div>';
  else if (rs.length < 2) chart = `<div class="j-empty-chart">${rs.length ? 'One reading so far. Your chart draws itself from the second one.' : 'Your chart draws itself here after your first readings.'}</div>`;
  else {
    const all = rs.flatMap(p => [p.sys, p.dia]);
    const lo = Math.floor((Math.min(...all) - 6) / 10) * 10, hi = Math.ceil((Math.max(...all) + 4) / 10) * 10;
    // Drawn at the card's real size so text and lines never stretch.
    const W = Math.max(240, Math.round((app.clientWidth || 360) - 60)), H = Math.max(80, Math.round(px('--chart') - 72)), L = 26, R = 4, T = 6, B = 16;
    const t0 = new Date(rs[0].at).getTime(), t1 = new Date(rs[rs.length - 1].at).getTime() || t0 + 1;
    const x = r => L + ((new Date(r.at).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let grid = '';
    const step = hi - lo > 60 ? 40 : 20;
    for (let v = lo; v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="0" y="${y(v) + 4}">${v}</text>`;
    const avg = k => Math.round(rs.reduce((a, p) => a + p[k], 0) / rs.length);
    const line = k => rs.map((p, j) => `${j ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p[k]).toFixed(1)}`).join('');
    const last = rs[rs.length - 1];
    const dots = (k, c) => rs.map(p => `<circle cx="${x(p).toFixed(1)}" cy="${y(p[k]).toFixed(1)}" r="${p === last ? 4.5 : 2.6}" fill="${p === last ? c : 'var(--card)'}" stroke="${statusOf(p) === 'wait' ? 'var(--j-wait)' : c}" stroke-width="2"/>`).join('');
    const xl = [rs[0], last].map((p, i) => `<text x="${x(p)}" y="${H - 1}" text-anchor="${i ? 'end' : 'start'}">${i && melbDay(p.at) === today() ? 'Today' : fmtDate(melbDay(p.at))}</text>`).join('');
    chart = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Blood pressure, ${rs.length} readings in the last 30 days, average ${avg('sys')} over ${avg('dia')}">
      ${grid}
      <line x1="${L}" x2="${W - R}" y1="${y(avg('sys'))}" y2="${y(avg('sys'))}" stroke="var(--ink-3)" stroke-dasharray="4 4" stroke-width="1.2"/>
      <line x1="${L}" x2="${W - R}" y1="${y(avg('dia'))}" y2="${y(avg('dia'))}" stroke="var(--ink-3)" stroke-dasharray="4 4" stroke-width="1.2"/>
      <path d="${line('sys')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
      <path d="${line('dia')}" fill="none" stroke="var(--j-dia)" stroke-width="2" stroke-linejoin="round"/>
      ${dots('sys', 'var(--accent)')}${dots('dia', 'var(--j-dia)')}${xl}</svg>
      <div class="j-legend"><span><i style="background:var(--accent)"></i>Top</span><span><i style="background:var(--j-dia)"></i>Bottom</span><span><i class="avg"></i>Your average ${avg('sys')}/${avg('dia')}</span></div>`;
  }
  const lastCheck = (canon?.notes || []).filter(n => n.tag === TAGS.check).map(n => n.tsUTC).sort().pop();
  const checkDue = !lastCheck || Date.now() - new Date(lastCheck).getTime() > 6 * 86400000;
  const all = readings();
  frame({
    eyebrow: recordState() === 'none' ? 'Not loaded' : recordState() === 'copy' ? `Copy from ${timeOf(loadedAt)}` : '', title: 'Health', tabId: 'health',
    body: `<section class="j-card j-chart" aria-label="Blood pressure, last 30 days">
        <div class="j-chart-h"><b>Blood pressure</b><span>Last 30 days</span></div>${chart}</section>
      <section class="j-card j-page">
        <button class="j-row short" data-readings><span class="j-ic bp">${ic('list', 's20')}</span><span class="j-tx"><b>All my readings</b><small>${all.length ? `${all.length} saved · tap one to fix it` : 'None yet'}</small></span>${ic('chev', 's16 chev')}</button>
        <button class="j-row short" data-photo><span class="j-ic tabl">${ic('cam', 's20')}</span><span class="j-tx"><b>Photo of a result</b><small>Test, scan, letter or monitor</small></span>${ic('chev', 's16 chev')}</button>
        <button class="j-row short" data-feel><span class="j-ic unsure">${ic('body', 's20')}</span><span class="j-tx"><b>How I'm feeling</b><small>${checkDue ? 'Check-in due · or note a symptom' : 'Check-in or a symptom'}</small></span>${ic('chev', 's16 chev')}</button>
        <a class="j-row short" href="/?full=1"><span class="j-ic fam">${ic('record', 's20')}</span><span class="j-tx"><b>Full record and Leffy</b><small>Results, questions, chat</small></span>${ic('chev', 's16 chev')}</a>
      </section>`,
  });
  on('[data-readings]', () => readingsScreen(() => healthScreen()));
  on('[data-photo]', () => photoResult());
  on('[data-feel]', () => feelingScreen());
}

/* ---------- Medicines ---------- */
function medsScreen(page = 0) {
  current = () => medsScreen(page); app.dataset.tabroot = '1';
  const m = currentMeds(canon || {});
  const waiting = outbox.pending().some(x => x.action === 'medication');
  const rows = [...m.unconfirmed.map(x => ({ ...x, kind: 'unsure' })), ...m.current.map(x => ({ ...x, kind: 'current' }))];
  const per = fits('--mrow', 44 + 8 + (m.stopped.length ? px('--mrow') : 0)), start = page * per;
  const shown = rows.slice(start, start + per);
  const row = (x, i) => {
    const [cls, stc, word, icon] = { current: ['tabl', 'ok', 'Taking', 'pill'], unsure: ['unsure', 'wait', 'Not sure yet', 'q'] }[x.kind];
    const detail = [x.dose, x.when].filter(Boolean).join(' · ') || '';
    return `<button class="j-row ${x.kind === 'unsure' ? 'flag' : ''}" data-m="${start + i}"><span class="j-ic ${cls}">${ic(icon, 's20')}</span><span class="j-tx"><b>${esc(x.name)}</b><small><span class="st ${stc}">${word}</span>${detail ? ' · ' + esc(detail) : ''}</small></span>${ic('chev', 's16 chev')}</button>`;
  };
  const stoppedRow = m.stopped.length ? `<button class="j-row stopped" data-stopped><span class="j-ic stop">${ic('stop', 's20')}</span><span class="j-tx"><b>Stopped</b><small>${esc(m.stopped.map(x => x.name).join(', '))}</small></span>${ic('chev', 's16 chev')}</button>` : '';
  const first = m.unconfirmed[0];
  const listEmpty = m.empty;
  const check = needsCheck(canon || {});
  const confirmedLine = m.confirmed ? `Checked ${fmtDate(melbDay(m.confirmed.ts))}` : m.updatedAt ? `Changed ${fmtDate(m.updatedAt)}` : '';
  let act;
  if (recordState() === 'none') act = primary('Try again', 'send', 'data-reload');
  else if (m.empty) act = primary('Add a medicine I take', 'plus', 'data-addmed');
  else if (first) act = primary(`Check ${first.name.length > 18 ? 'this medicine' : first.name}`, 'q', 'data-first');
  else if (check) act = primary('Yes, this list is right', 'check', 'data-right');
  else act = primary('Add a medicine I take', 'plus', 'data-addmed');
  frame({
    eyebrow: waiting ? 'Waiting to send' : confirmedLine || 'What you take', title: 'Medicines', tabId: 'meds',
    body: recordState() === 'none' ? '<section class="j-card j-chart"><div class="j-empty-chart">Your medicines could not load right now. Try again in a moment.</div></section>'
      : listEmpty ? '<section class="j-card j-chart"><div class="j-empty-chart">No medicines are listed yet. Add the ones you take, as written on the box.</div></section>'
      : `<section class="j-card j-page j-meds" aria-label="Medicine list">${shown.map(row).join('')}${stoppedRow}</section>
      <div class="j-foot"><span>${rows.length > per ? `${start + 1}–${Math.min(rows.length, start + per)} of ${rows.length}` : 'Ticking tablets is on Today'}</span>
        <span>${start > 0 ? '<button data-prev>Back</button>' : ''}${start + per < rows.length ? ' <button data-next>More</button>' : (m.empty || first || check ? '' : '')}${!first && !m.empty && check ? '' : ''}</span></div>`,
    act,
  });
  onAll('[data-m]', b => medCheck(rows[+b.dataset.m]));
  on('[data-first]', () => medCheck({ ...first, kind: 'unsure' }));
  on('[data-addmed]', () => medDetails(null));
  on('[data-reload]', async () => { await load(); medsScreen(); });
  on('[data-prev]', () => medsScreen(page - 1));
  on('[data-next]', () => medsScreen(page + 1));
  on('[data-stopped]', () => stoppedScreen());
  on('[data-right]', async () => {
    const st = await note(CONFIRM_TAG, 'MEDS: list is right', { meds: m.current.map(x => x.name) });
    medsScreen(page); toast(st === 'saved' ? 'Thanks. Saved.' : 'Thanks. Waiting to send.');
  });
}

function stoppedScreen() {
  const m = currentMeds(canon || {});
  frame({
    eyebrow: 'Kept in your history', title: 'Stopped', tabId: 'meds', back: () => medsScreen(),
    body: `<section class="j-card j-page j-meds">${m.stopped.slice(0, 4).map((x, i) => `<button class="j-row stopped" data-s="${i}"><span class="j-ic stop">${ic('stop', 's20')}</span><span class="j-tx"><b>${esc(x.name)}</b><small>${esc([x.dose, x.updated ? 'stopped ' + fmtDate(x.updated) : ''].filter(Boolean).join(' · '))}</small></span>${ic('chev', 's16 chev')}</button>`).join('')}</section>
      <p class="j-note">Tap one if you have started taking it again.</p>`,
  });
  onAll('[data-s]', b => medCheck({ ...m.stopped[+b.dataset.s], kind: 'stopped' }));
}

// One decision: what is true now?
function medCheck(x) {
  const detail = [x.dose, x.when].filter(Boolean).join(' · ');
  const opts = x.kind === 'stopped'
    ? [['restart', "I'm taking it again"], ['keep', 'Still stopped']]
    : [['yes', x.kind === 'unsure' ? 'Yes, I take this' : 'Yes, as listed'], ['edit', 'Yes, but the name or dose is different'], ['stop', 'No, I stopped it'], ['unsure', "I'm not sure"]];
  let pick = null;
  const draw = () => {
    frame({
      eyebrow: 'Is this right?', title: 'Check', tabId: 'meds', back: () => medsScreen(),
      body: `<section class="j-card j-head"><span class="j-ic ${x.kind === 'unsure' ? 'unsure' : x.kind === 'stopped' ? 'stop' : 'tabl'}">${ic(x.kind === 'unsure' ? 'q' : 'pill')}</span>
          <span class="j-tx"><b>${esc(x.name)}</b><small>${esc(detail || 'no dose recorded')}</small></span></section>
        <div class="j-opts" role="radiogroup" aria-label="What is true now?">${opts.map(([k, l]) => `<button class="j-opt" role="radio" aria-checked="${pick === k}" data-o="${k}"><span class="j-dot"></span>${esc(l)}</button>`).join('')}</div>`,
      act: primary('Next', '', `data-next ${pick ? '' : 'disabled'}`),
    });
    onAll('[data-o]', b => { pick = b.dataset.o; draw(); });
    on('[data-next]', () => {
      if (!pick) return;
      if (pick === 'keep') return medsScreen();
      if (pick === 'edit') return medDetails(x);
      const status = { yes: 'current', restart: 'current', stop: 'stopped', unsure: 'unconfirmed' }[pick];
      medConfirm(x, { name: x.name, dose: x.dose, when: x.when, status });
    });
  };
  draw();
}

// Pick, never type: name, strength and time all come from fixed lists, so
// there is one spelling of each medicine everywhere.
function medDetails(x) {
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const listed = x && x.name && !inCatalog(x.name) ? x.name : null; // an older entry typed before the list existed
  let name = x?.name || '';
  const draw = () => {
    const doses = strengthsOf(name);
    frame({
      eyebrow: x ? 'From the box' : 'New medicine', title: x ? 'Details' : 'Add', tabId: 'meds', back: () => (x ? medCheck(x) : medsScreen()),
      body: `<div class="j-input"><label for="mn">Medicine</label><select id="mn">${opt('', 'Choose a medicine', !name)}${listed ? opt(listed, listed, name === listed) : ''}${MED_CATALOG.map(([n]) => opt(n, n, n === name)).join('')}</select></div>
        <div class="j-pair"><div class="j-input"><label for="md">Strength</label><select id="md" ${name ? '' : 'disabled'}>${opt('', NOT_SURE, !doses.includes(x?.dose))}${doses.map(d => opt(d, d, d === x?.dose)).join('')}</select></div>
        <div class="j-input"><label for="mw">When</label><select id="mw">${opt('', NOT_SURE, !MED_WHEN.includes(x?.when))}${MED_WHEN.map(w => opt(w, w, w === x?.when)).join('')}</select></div></div>`,
      act: primary('Next', '', `data-next ${name ? '' : 'disabled'}`),
    });
    $('#mn').onchange = e => { name = e.target.value; draw(); };
    on('[data-next]', () => {
      if (!name) return;
      medConfirm(x, { name, dose: $('#md').value, when: $('#mw').value, status: 'current' });
    });
  };
  draw();
}

const STATUS_WORD = { current: 'Taking', stopped: 'Stopped', unconfirmed: 'Not sure yet' };
function medConfirm(before, after) {
  const was = before ? `${STATUS_WORD[before.status] || 'Not sure yet'}${[before.dose, before.when].filter(Boolean).length ? ' · ' + [before.dose, before.when].filter(Boolean).join(' · ') : ''}` : 'Not on your list';
  const same = !before || before.name === after.name;
  const now = `${STATUS_WORD[after.status]}${[after.dose, after.when].filter(Boolean).length ? ' · ' + [after.dose, after.when].filter(Boolean).join(' · ') : ''}`;
  frame({
    eyebrow: 'Check a medicine', title: 'Confirm', tabId: 'meds', back: () => (before ? medCheck(before) : medDetails(null)),
    // Same name before and after: show it once, in full, and only the change below it.
    body: `<section class="j-card j-change" aria-label="The change"><span class="lbl">Save this change?</span>
        ${same ? `<b class="j-medname">${esc(after.name)}</b>` : ''}
        <div class="j-step"><span class="node was">${ic('clock', 's16')}</span><span><span class="tag">Before</span>${same ? '' : `<b>${esc(before?.name || '')}</b>`}<small>${esc(was)}</small></span></div>
        <div class="j-step"><span class="node now">${ic('check', 's16')}</span><span><span class="tag">After</span>${same ? '' : `<b>${esc(after.name)}</b>`}<small>${esc(now)}</small></span></div>
        <span class="by">${ic('user', 's16')}Changed by you · old version kept</span>
      </section>
      <p class="j-note">Updates the list your family and Leffy see. Not your prescription.</p>`,
    act: primary('Save this change', 'check', 'data-save'),
  });
  let busy = false;
  on('[data-save]', async () => {
    if (busy) return; busy = true;
    // Nothing changed: record that he checked it, rather than an update the
    // sheet would ignore and nobody could see.
    if (before && before.name === after.name && (before.status || 'current') === after.status && (before.dose || '') === (after.dose || '') && (before.when || '') === (after.when || '')) {
      const st = await note(MED_CHECK_TAG, `MED: still ${after.status === 'stopped' ? 'stopped' : 'taking'} ${after.name}`, { name: after.name, status: after.status });
      medsScreen();
      return toast(st === 'saved' ? `Thanks. Noted, no change to ${after.name}.` : 'Noted here. Waiting to send.');
    }
    const p = { name: after.name, dose: after.dose || '', frequency: after.when || '', status: after.status, ...(before && before.from !== 'family-list' && before.name !== after.name ? { previousName: before.name } : {}), ...(before && before.name === after.name ? { existing: true } : {}) };
    // Show it straight away; the server's copy replaces this on the next load.
    const list = ((canon ||= {}).medications ||= []);
    if (p.previousName) { const o = list.find(r => r.name === p.previousName); if (o) o.status = 'superseded'; }
    const row = list.find(r => r.name === p.name);
    if (row) Object.assign(row, { dose: p.dose, frequency: p.frequency, status: p.status, updated: today() });
    else list.push({ name: p.name, dose: p.dose, frequency: p.frequency, status: p.status, source: 'app', updated: today() });
    store.set('canon', canon);
    const st = await send('medication', p);
    if (st === 'rejected') return toast("That didn't save. Try again.");
    medsScreen();
    toast(st === 'saved' ? 'Saved. Your family and Leffy see the new list.' : 'Changed here. Waiting to send.');
  });
}

/* ---------- quick questions: one tap each ---------- */
// Loose ends in his record only he can settle (quick-checks.js). One per
// screen; a tap saves it and moves on. "Skip for now" hides them until tomorrow.
function quickDue() {
  if (recordState() === 'none' || store.get('quickSkip', '') === today()) return null;
  return todaysQuestion(canon || {});
}
function applyLocal(action, p) {
  canon ||= {};
  if (action === 'medication') {
    const list = (canon.medications ||= []);
    const row = list.find(r => r.name === p.name);
    if (row) Object.assign(row, { frequency: p.frequency, status: p.status, updated: today() });
    else list.push({ name: p.name, dose: p.dose || '', frequency: p.frequency || '', status: p.status, source: 'app', updated: today() });
  }
  if (action === 'gap') { const g = (canon.gaps || []).find(x => x.id === p.id); if (g) g.status = p.status; }
  if (action === 'question') { const q = (canon.questions || []).find(x => x.id === p.id); if (q) Object.assign(q, { status: p.status, answer: p.answer }); }
  store.set('canon', canon);
}
// One question a day. Answering it, or skipping, returns to Today.
function quickFlow() {
  app.dataset.tabroot = '';
  const c = quickDue();
  if (!c) return todayScreen();
  frame({
    eyebrow: "Today's quick question", title: c.title, tabId: 'today',
    body: `<p class="j-q">${esc(c.q)}</p><div class="j-opts">${c.opts.map(o => `<button class="j-opt" data-o="${esc(o.k)}"><span class="j-dot"></span>${esc(o.label)}</button>`).join('')}</div>`,
    act: link('Skip for now', 'data-skip'),
  });
  on('[data-skip]', () => { store.set('quickSkip', today()); todayScreen(); });
  let busy = false;
  onAll('[data-o]', async b => {
    if (busy) return; busy = true;
    b.setAttribute('aria-checked', 'true');
    const o = c.opts.find(x => x.k === b.dataset.o);
    for (const w of o.writes) {
      if (w.note) { await note(w.note.tag, w.note.summary, w.note.data); continue; }
      applyLocal(w.action, w.payload);
      const st = await send(w.action, w.payload);
      if (st === 'rejected') { busy = false; return toast("That didn't save. Try again."); }
    }
    const n = quickNote(c, o);
    const st = await note(n.tag, n.summary, n.data);
    todayScreen();
    toast(st === 'saved' ? 'Thanks. Your family and Leffy can see it.' : 'Thanks. Waiting to send.');
  });
}

/* ---------- urgent help: the existing red-flag rules ---------- */
// A calm way in: the weekly check-in, or noting a symptom. Both use the
// existing red-flag rules; nothing here says he is unwell.
function feelingScreen() {
  app.dataset.tabroot = '';
  const lastCheck = (canon?.notes || []).filter(n => n.tag === TAGS.check).map(n => n.tsUTC).sort().pop();
  const due = !lastCheck || Date.now() - new Date(lastCheck).getTime() > 6 * 86400000;
  frame({
    title: 'Feeling', tabId: 'health', back: () => healthScreen(),
    body: `<section class="j-card j-page">
        <button class="j-row" data-check><span class="j-ic unsure">${ic('body', 's20')}</span><span class="j-tx"><b>Weekly check-in</b><small>${due ? 'Due · five quick questions' : 'Done this week'}</small></span>${ic('chev', 's16 chev')}</button>
        <button class="j-row" data-log><span class="j-ic bp">${ic('q', 's20')}</span><span class="j-tx"><b>Note a symptom</b><small>Anything you noticed</small></span>${ic('chev', 's16 chev')}</button>
      </section>`,
  });
  on('[data-check]', () => bodyCheck());
  on('[data-log]', () => logSymptom());
}

function logSymptom() {
  const log = {};
  const step1 = () => {
    frame({
      eyebrow: '', title: 'Symptoms', tabId: 'health', back: feelingScreen,
      body: `<p class="j-q">What's happening?</p><div class="j-grid">${SYMPTOMS.map(s => `<button class="j-opt${s.id === 'other' ? ' wide' : ''}" data-s="${s.id}">${esc(s.label)}</button>`).join('')}<button class="j-opt wide fine" data-fine>I'm feeling fine</button></div>`,
    });
    onAll('[data-s]', b => { log.symptom = b.dataset.s; step2(); });
    // Nothing is saved: he just looked, or he feels fine.
    on('[data-fine]', () => healthScreen());
  };
  const lbl = () => SYMPTOMS.find(s => s.id === log.symptom).label;
  const pickStep = (title, list, key, next, backTo) => {
    frame({
      eyebrow: lbl(), title: 'Symptoms', tabId: tab, unwell: true, back: backTo,
      body: `<p class="j-q">${esc(title)}</p><div class="j-opts">${list.map(([v, l]) => `<button class="j-opt" data-v="${v}"><span class="j-dot"></span>${esc(l)}</button>`).join('')}</div>`,
    });
    onAll('[data-v]', b => { log[key] = b.dataset.v; next(); });
  };
  const step2 = () => pickStep('When did it start?', WHEN, 'when', step3, step1);
  const step3 = () => pickStep('How bad is it?', SEVERITY, 'severity', step4, step2);
  // One tap per question: what he was doing and how long it lasted. Speaking
  // stays as an option, never required. No typing.
  const DOING = ['Resting', 'Walking', 'Stairs or a hill', 'After eating', 'Just got up'];
  const LASTED = ['Seconds', 'A few minutes', 'Over 15 minutes', 'Still going'];
  const step4 = () => {
    const pick = { doing: '', lasted: '' }, said = { text: '' };
    const save = () => {
      log.note = [pick.doing, pick.lasted && `lasted ${pick.lasted.toLowerCase()}`, said.text.trim()].filter(Boolean).join('; ');
      log.level = symptomLevel(log);
      const w = WHEN.find(x => x[0] === log.when)[1], sev = SEVERITY.find(x => x[0] === log.severity)[1];
      // Show what to do first; the save happens alongside and never delays it.
      const saving = note(TAGS.symptom, `SYMPTOM: ${lbl()}, ${w.toLowerCase()}, ${sev.toLowerCase()}${log.note ? '. ' + log.note : ''}`, log);
      result(log.level, saving);
    };
    const chips = (key, list) => `<div class="j-chips">${list.map(c => `<button class="j-chipbtn" aria-pressed="${pick[key] === c}" data-k="${key}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
    const draw = () => {
      frame({
        eyebrow: lbl(), title: 'Symptoms', tabId: tab, unwell: true, back: step3,
        body: `<p class="j-sec">What were you doing?</p>${chips('doing', DOING)}
          <p class="j-sec">How long did it last?</p>${chips('lasted', LASTED)}
          ${said.text ? `<section class="j-card j-msg mine"><b>You said</b><span>${esc(said.text)}</span></section>` : ''}`,
        act: `<button class="j-esc" data-mic aria-pressed="false">${ic('mic', 's20')}<span>Speak</span></button>${primary(pick.doing || pick.lasted || said.text ? 'Save' : 'Skip and save', 'check', 'data-save')}`,
      });
      app.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { const k = b.dataset.k; pick[k] = pick[k] === b.dataset.v ? '' : b.dataset.v; draw(); });
      let busy = false;
      on('[data-save]', () => { if (busy) return; busy = true; save(); });
      wireMic($('[data-mic]'), { get value() { return said.text; }, set value(v) { said.text = v; draw(); } });
    };
    draw();
  };
  step1();
}

// What to do next, for him in Melbourne (he can dial these numbers).
function result(level, saving = null) {
  const entry = saving && lastNote && REMOVABLE.includes(lastNote.tag) ? lastNote : null;
  const msg = {
    emergency: ['Call 000 now', 'Ask for an ambulance. Sit or lie down and stop what you are doing. Unlock the front door. Do not drive.'],
    urgent: ['Get checked today', 'Call your GP for a same-day appointment, or the free Virtual ED video doctor. If it gets worse, call 000.'],
    soon: ['Thanks for telling us', 'Mention it to your GP this week. Your family will keep an eye on it too.'],
    routine: ['Thanks, all noted', 'Nothing worrying in that. Keep going.'],
  }[level];
  const cls = level === 'emergency' ? '' : level === 'urgent' ? 'urgent' : 'calm';
  const act = level === 'emergency' ? `<a class="btn primary danger" data-primary href="tel:000">${ic('phone', 's20')}Call 000</a>`
    : level === 'urgent' ? `<a class="j-esc" href="https://www.vved.org.au" target="_blank" rel="noopener">Virtual ED</a><a class="btn primary" data-primary href="tel:1300606024">${ic('phone', 's20')}Nurse on call</a>`
      : primary('Back to today', '', 'data-home');
  frame({
    eyebrow: '', title: 'Next', tabId: tab, unwell: level === 'emergency' || level === 'urgent',
    back: () => todayScreen(),
    body: `<section class="j-card j-em ${cls}" role="${level === 'emergency' || level === 'urgent' ? 'alert' : 'status'}"><span class="j-ic">${ic(level === 'emergency' || level === 'urgent' ? 'phone' : 'check', 's20')}</span><div><h2>${esc(msg[0])}</h2><p>${esc(msg[1])}</p></div></section>
      <p class="j-note" data-savemsg>${saving ? 'Saving…' : ''}</p>
      ${saving && entry ? '<button class="j-esc" data-undo style="align-self:flex-start">Saved by mistake? Remove it</button>' : ''}`,
    act,
  });
  on('[data-home]', () => todayScreen());
  on('[data-undo]', () => {
    frame({
      title: 'Remove', tabId: tab, back: () => result(level, saving),
      body: '<section class="j-card j-change"><span class="lbl">Remove this entry?</span><div class="by">It was saved by mistake. Your family and Leffy won\'t see it.</div></section>',
      act: primary('Yes, remove it', '', 'data-yes'),
    });
    let busy = false;
    on('[data-yes]', async () => {
      if (busy) return; busy = true;
      const st = await removeNote(entry);
      todayScreen(); toast(st === 'saved' ? 'Removed.' : 'Removed. Waiting to send.');
    });
  });
  if (saving) saving.then(st => { const el = $('[data-savemsg]'); if (el) el.textContent = st === 'saved' ? 'Saved. Your family can see it.' : st === 'unsafe' ? 'Not saved. Tell your family directly.' : "Kept on this phone. Your family can't see it until it sends."; });
}

/* ---------- weekly body check ---------- */
function bodyCheck() {
  const answers = {}; let i = 0;
  const step = () => {
    const q = BODY_CHECK[i];
    frame({
      eyebrow: `Question ${i + 1} of ${BODY_CHECK.length}`, title: 'Check-in', tabId: 'health',
      back: () => (i === 0 ? feelingScreen() : (i--, step())),
      body: `<p class="j-note">Question ${i + 1} of ${BODY_CHECK.length} · last 7 days</p><p class="j-q">${esc(q.q)}</p>
        <div class="j-opts">${q.opts.map(([v, l]) => `<button class="j-opt" data-a="${v}"><span class="j-dot"></span>${esc(l)}</button>`).join('')}<button class="j-opt" data-a="unsure"><span class="j-dot"></span>Not sure</button></div>`,
    });
    onAll('[data-a]', async b => {
      answers[q.id] = b.dataset.a; navigator.vibrate?.(10);
      if (++i < BODY_CHECK.length) return step();
      const level = checkLevel(answers);
      const text = BODY_CHECK.map(x => `${x.id}: ${(x.opts.find(o => o[0] === answers[x.id]) || [, 'not sure'])[1].toLowerCase()}`).join('; ');
      result(level, note(TAGS.check, `BODY CHECK: ${text}`, { answers, level }));
    });
  };
  step();
}

/* ---------- tell the family ---------- */
// One tap sends a ready message; or speak and send what he said. No typing.
const TALK_CHIPS = ['All good today', 'Went for my walk', 'A bit tired today', 'Call me when you can', 'Thinking of you', 'Saw the doctor today'];
function talk() {
  app.dataset.tabroot = '';
  const n = canon ? pendingNudge(canon) : null;
  if (n) note(TAGS.seen, 'Seen the nudge ♥');
  const from = n ? (/^(app|)$/i.test(n.from) ? 'Family' : n.from) : '';
  const said = { text: '' };
  // One tap: back to Today at once; the send finishes in the background.
  const sendIt = (text, btn) => {
    btn?.setAttribute('aria-pressed', 'true');
    const sending = note(TAGS.talk, `KIMON SAYS: ${text}`);
    todayScreen(); toast('Sending…', 20000);
    sending.then(st => { toast(st === 'saved' ? 'Sent to the family ♥' : "Kept on this phone. It sends by itself."); rerender(); });
  };
  const draw = () => {
    frame({
      eyebrow: n ? `Message from ${from}` : 'Send to your family', title: 'Family', tabId: 'today', back: () => todayScreen(),
      body: `${n ? `<section class="j-card j-msg"><b>${esc(from)}</b><span>${esc(n.text)}</span></section>` : ''}
        ${said.text ? `<section class="j-card j-msg mine"><b>You said</b><span>${esc(said.text)}</span></section>`
          : `<div class="j-grid">${TALK_CHIPS.map((c, i) => `<button class="j-opt" data-c="${i}">${esc(c)}</button>`).join('')}</div>`}`,
      act: said.text ? `${link('Say it again', 'data-again')}${primary('Send', 'send', 'data-send')}`
        : `<button class="btn primary" data-primary data-mic aria-pressed="false">${ic('mic', 's20')}<span>Speak a message</span></button>`,
    });
    let busy = false;
    onAll('[data-c]', b => { if (busy) return; busy = true; sendIt(TALK_CHIPS[+b.dataset.c], b); });
    on('[data-send]', () => { if (busy) return; busy = true; sendIt(said.text); });
    on('[data-again]', () => { said.text = ''; draw(); });
    wireMic($('[data-mic]'), { get value() { return said.text; }, set value(v) { said.text = v; draw(); } });
  };
  draw();
}

/* ---------- photo of a result ---------- */
async function photoResult() {
  const file = await pickPhoto({ camera: true });
  if (!file) return;
  let img, out, tick = 0;
  // The photo he took, and a calm, honest progress line while it is read.
  const STEPS = ['Reading the page', 'Finding the results', 'Checking your record'];
  const reading = () => frame({
    eyebrow: 'Photo of a result', title: 'Reading', tabId: 'health', back: () => { clearInterval(tick); healthScreen(); },
    body: `<section class="j-card j-reading">${img?.thumb ? `<img src="${img.thumb}" alt="Your photo">` : '<div class="j-reading-ph"></div>'}<div class="j-scan" aria-hidden="true"></div></section>
      <div class="j-steps" role="status">${STEPS.map((t, i) => `<div class="j-step-line" data-st="${i}"><span class="j-tick"></span>${t}</div>`).join('')}</div>`,
  });
  const mark = n => app.querySelectorAll('[data-st]').forEach(el => { const i = +el.dataset.st; el.classList.toggle('done', i < n); el.classList.toggle('now', i === n); });
  try {
    img = await shrink(file);
    reading(); let n = 0; mark(0);
    tick = setInterval(() => { if (n < STEPS.length - 1) mark(++n); }, 2600);
    const r = await fetch('/api/photo', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: { data: img.data, type: img.type } }), signal: AbortSignal.timeout(70000) });
    if (r.status === 401) return toLogin();
    out = await r.json().catch(() => ({}));
    if (!r.ok || !out.ok) throw new Error(out.error || '');
    clearInterval(tick);
  } catch (e) {
    clearInterval(tick);
    frame({ eyebrow: 'Photo of a result', title: 'Photo', tabId: 'health', back: () => healthScreen(), body: `<p class="j-note">Couldn't read that. ${esc(e.message || 'Try again in good light, with the whole page in the photo.')}</p>`, act: primary('Take it again', 'cam', 'data-again') });
    return on('[data-again]', photoResult);
  }
  const rows = out.results || [];
  const fresh = rows.map((x, i) => ({ ...x, i })).filter(x => !x.duplicate);
  let page = 0; const per = 4;
  const picked = new Set(fresh.map(x => x.i));
  const draw = () => {
    const shown = rows.slice(page * per, page * per + per);
    frame({
      eyebrow: out.summary || 'Photo of a result', title: !rows.length ? 'No results' : fresh.length ? 'Check' : 'Saved', tabId: 'health', back: () => healthScreen(),
      body: rows.length ? `<section class="j-card">${shown.map(x => { const k = rows.indexOf(x); return `<label class="j-check ${x.duplicate ? 'dup' : ''}"><input type="checkbox" data-r="${k}" ${x.duplicate ? 'disabled' : picked.has(k) ? 'checked' : ''}><span><b>${esc(x.test)}: ${esc(x.result)}</b><small>${esc(fmtDate(x.date, { year: true }) || x.date)}${x.duplicate ? ' · already saved' : x.dateGuessed ? ' · no date on the paper' : ''}</small></span></label>`; }).join('')}</section>
        <div class="j-foot"><span>${out.unreadable ? `Couldn't read: ${esc(out.unreadable)}` : 'Untick anything that is wrong'}</span><span>${page > 0 ? '<button data-prev>Back</button>' : ''}${(page + 1) * per < rows.length ? ' <button data-next>More</button>' : ''}</span></div>`
        : '<p class="j-note">Nothing on that photo looked like a test result.</p>',
      act: fresh.length ? primary(`Save ${picked.size} to my record`, 'check', `data-save ${picked.size ? '' : 'disabled'}`) : primary('Take another photo', 'cam', 'data-again'),
    });
    app.querySelectorAll('[data-r]').forEach(c => c.onchange = () => { c.checked ? picked.add(+c.dataset.r) : picked.delete(+c.dataset.r); draw(); });
    on('[data-prev]', () => { page--; draw(); });
    on('[data-next]', () => { page++; draw(); });
    on('[data-again]', photoResult);
    let busy = false;
    on('[data-save]', async () => {
      if (busy) return; busy = true;
      const picks = [...picked].map(k => rows[k]);
      const sts = [];
      for (const x of picks) {
        ((canon ||= {}).testResults ||= []).push({ date: x.date, test: x.test, result: x.result, lab: x.lab, notes: x.notes, source: 'Kimon', local: true });
        sts.push(await send('testResult', { date: x.date, test: x.test, result: x.result, lab: x.lab, notes: x.notes }));
      }
      store.set('canon', canon);
      const allSaved = sts.every(s => s === 'saved');
      healthScreen();
      toast(allSaved ? `Saved ${picks.length} result${picks.length === 1 ? '' : 's'}. Your family can see ${picks.length === 1 ? 'it' : 'them'}.` : "Kept on this phone. They send when you're online.");
    });
  };
  draw();
}

/* ---------- voice ---------- */
function wireMic(btn, ta) {
  if (!btn) return;
  if (!canRecord()) { btn.hidden = true; return; }
  let h = null, timer = 0;
  const label = t => { const sp = btn.querySelector('b span') || btn.querySelector('span'); if (sp) sp.textContent = t; };
  btn.onclick = async () => {
    if (btn.dataset.busy) return;
    if (!h) {
      try { h = await startRecording({ onAutoStop: () => btn.click() }); } catch { toast('The microphone is blocked. Type instead.'); return; }
      btn.setAttribute('aria-pressed', 'true');
      timer = setInterval(() => label('Stop ' + fmtTime(h.elapsed())), 250);
      return;
    }
    clearInterval(timer); btn.setAttribute('aria-pressed', 'false'); btn.dataset.busy = '1'; label('Writing it down…');
    const rec = h; h = null;
    try {
      const blob = await rec.stop();
      if (rec.silent()) toast("I didn't hear anything. Try again, closer to the phone.");
      else { const text = await transcribeBlob(blob); if (text) { ta.value = (ta.value ? ta.value.trim() + ' ' : '') + text; } }
    } catch { toast("Couldn't hear that. Try again, or type."); }
    delete btn.dataset.busy; label('Speak');
  };
}

/* ---------- toast ---------- */
let toastT;
function toast(m, ms = 3200) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- keyboard ---------- */
// The phone keyboard must never cover the action. Size the app to the part of
// the screen the keyboard leaves free (iOS does not resize the page itself).
if (window.visualViewport) {
  const vv = window.visualViewport, rootEl = document.documentElement;
  // Android resizes the page with the keyboard, iOS does not: compare with the
  // tallest the screen has been in this orientation, not just innerHeight.
  let tall = innerHeight, wide = innerWidth;
  const onVV = () => {
    if (innerWidth !== wide) { wide = innerWidth; tall = vv.height; }
    tall = Math.max(tall, innerHeight, vv.height);
    rootEl.style.setProperty('--app-h', vv.height + 'px');
    document.body.classList.toggle('kb', tall - vv.height > 140);
    // iOS leaves the page tall and lays the keyboard over it: lift the action by that much.
    rootEl.style.setProperty('--kb-gap', Math.max(0, innerHeight - vv.height - vv.offsetTop) + 'px');
    if (vv.offsetTop) window.scrollTo(0, 0);
    const f = document.activeElement;
    if (f && /INPUT|TEXTAREA/.test(f.tagName)) requestAnimationFrame(() => f.scrollIntoView({ block: 'nearest' }));
  };
  vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); onVV();
}

/* ---------- boot ---------- */
(async () => {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return toLogin();
    const s = await r.json().catch(() => ({}));
    document.body.classList.toggle('preview', s.role !== 'kimon');
  } catch { if (!canon) return toLogin(); }
  const start = new URLSearchParams(location.search).get('tab');
  const first = { health: healthScreen, meds: medsScreen }[start] || todayScreen;
  if (start) history.replaceState(null, '', '/me');
  if (canon) first();
  await flush(); await load();
  if (!canon) canon = { notes: [], profile: {} };
  // Refresh, but never pull him out of something he's doing.
  if (app.dataset.tabroot === '1' || app.querySelector('.j-loading')) current();
})();

