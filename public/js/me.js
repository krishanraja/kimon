// Kimon's own app. Three tabs: Today (his journal page and week), Health (his
// readings over time) and Medicines (the one list, easy to correct).
// "I feel unwell" sits in the header of every screen. Each screen asks one
// thing of him: one primary button, just above the tabs.
import { canRecord, startRecording, transcribeBlob, fmtTime } from './recorder.js';
import { pickPhoto, shrink } from './photo.js';
import { fmtDate, bpSeries } from './metrics.js';
import { triage } from './triage.js';
import { SYMPTOMS, WHEN, SEVERITY, BODY_CHECK, TAGS, symptomLevel, checkLevel, noteText, melbDay, pendingNudge } from './kimon-model.js';
import { currentMeds, medLine, needsCheck, CONFIRM_TAG } from './meds-model.js';
import { createOutbox, newOpId } from './outbox.js';

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
function addNoteLocal(tag, text) {
  const n = { tsUTC: new Date().toISOString(), by: 'Kimon', tag, text, local: true };
  ((canon ||= {}).notes ||= []).push(n); store.set('canon', canon);
}
async function note(tag, summary, data) {
  const text = data ? noteText(summary, data) : summary;
  addNoteLocal(tag, text);
  return send('note', { text, tag });
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
      <div class="j-title"><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1></div>
      <button class="j-unwell" data-unwell${unwell ? ' aria-current="page"' : ''}>${ic('unwell', 's20')}I feel unwell</button></header>
    <main class="j-main">${body}${act ? `<div class="j-act j-push">${act}</div>` : ''}</main>
    <nav class="j-nav" aria-label="Sections">${t('today', 'journal', 'Today')}${t('health', 'trend', 'Health')}${t('meds', 'pill', 'Medicines')}</nav>`;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('[data-unwell]').onclick = () => unwellScreen();
  if (back) $('[data-back]').onclick = back;
}
function go(id) { ({ today: todayScreen, health: healthScreen, meds: medsScreen })[id](); }
function screen(fn) { current = fn; fn(); }
function rerender() { if (app.dataset.home === '1') current(); }
const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
const onAll = (sel, fn) => app.querySelectorAll(sel).forEach(el => el.onclick = () => fn(el));

// How many list rows of a given height fit above the action zone, given
// what else is on the screen. Lists page instead of ever scrolling.
function fits(rowH, other) {
  const h = (app.clientHeight || innerHeight) - 128 - 16 - 54 - other;
  return Math.max(1, Math.floor(h / rowH));
}

/* ---------- Today ---------- */
function readings() { return bpSeries((canon?.testResults) || []).readings; }
function tabletsDays() { return new Set((canon?.notes || []).filter(n => n.tag === TAGS.meds && n.by === 'Kimon').map(n => melbDay(n.tsUTC))); }

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
  current = todayScreen; app.dataset.home = '1';
  const s = todayState();
  const r = s.latest;
  const rStatus = r ? statusOf(r) : null;
  const bp = r
    ? `<b class="num">${r.sys} / ${r.dia}<em>mmHg</em></b>${rStatus === 'wait' ? '<small class="wait">Waiting to send</small>' : `<small>Measured ${esc(timeOf(r.at))}</small>`}`
    : s.last ? `<b class="dim">Blood pressure</b><small>Last: ${s.last.sys}/${s.last.dia}, ${esc(whenLabel(s.last.at))}</small>` : '<b class="dim">Blood pressure</b><small>No readings yet</small>';
  const bpChip = r ? (rStatus === 'wait' ? chip('wait', 'On phone', 'phoneoff') : chip('ok', 'Saved', 'check')) : chip('todo', 'To do');
  const nMeds = s.meds.current.length;
  const tb = !nMeds && s.meds.empty ? '<b class="dim">Today\'s tablets</b><small>No medicines listed yet</small>'
    : s.took ? '<b>Today\'s tablets</b><small>Ticked today</small>' : `<b>Today's tablets</b><small>${nMeds ? `${nMeds} medicine${nMeds === 1 ? '' : 's'} on your list` : 'Check your list'}</small>`;
  const tbChip = s.meds.empty ? chip('none', 'None') : s.took ? chip('ok', 'Taken', 'check') : chip('todo', 'To do');
  const fam = s.nudge
    ? `<b>From ${esc(/^(app|)$/i.test(s.nudge.from) ? 'family' : s.nudge.from)}</b><small>“${esc(s.nudge.text)}”</small>`
    : '<b>Tell the family</b><small>How you are, or just hello</small>';
  const left = [!r, !s.meds.empty && !s.took].filter(Boolean).length;
  // One status line, most important first. Fixed slot; nothing else moves.
  const head = !storageOk ? '<span class="stale">Not kept on this phone</span>'
    : s.waiting.length ? `<span class="stale">${s.waiting.length} waiting to send</span>`
      : !fresh && loadedAt ? `<span class="stale">Phone copy from ${esc(timeOf(loadedAt))}</span>`
        : `<span>${left ? `${left} thing${left === 1 ? '' : 's'} left` : 'All done today'}</span>`;

  // The one thing to do now.
  let act;
  if (s.waiting.length) act = primary(`Send ${s.waiting.length === 1 ? 'it' : 'them'} now`, 'send', 'data-flush');
  else if (!r) act = primary("Add today's reading", 'plus', 'data-add');
  else if (!s.meds.empty && !s.took) act = primary("I took today's tablets", 'check', 'data-took');
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
        <button class="j-row" data-talk><span class="j-ic fam">${ic('chat', 's20')}</span><span class="j-tx">${fam}</span>${s.nudge ? chip('time', timeOf(s.nudge.ts)) : ic('chev', 's16 chev')}</button>
      </section>
`,
    act,
  });
  on('[data-add]', () => bpEntry());
  on('[data-readings]', () => readingsScreen(() => todayScreen()));
  on('[data-meds]', () => medsScreen());
  on('[data-talk]', () => talk());
  on('[data-flush]', async () => {
    const b = $('[data-flush]'); b.disabled = true; b.lastChild.textContent = 'Sending…';
    const res = await flush(); await load(); todayScreen();
    if (res.left) toast('Still offline. It stays on this phone and sends by itself.');
  });
  on('[data-took]', async () => {
    const b = $('[data-took]'); b.disabled = true;
    const st = await note(TAGS.meds, 'MEDS: taken', { meds: s.meds.current.map(m => m.name) });
    todayScreen();
    toast(st === 'saved' ? 'Ticked. Saved.' : st === 'unsafe' ? 'Not saved. Keep the app open and try again.' : 'Ticked. Waiting to send.');
  });
}

/* ---------- blood pressure entry ---------- */
// fix: a reading being corrected (its id goes in "supersedes").
function bpEntry({ fix = null, at = null, sys = '', dia = '' } = {}) {
  app.dataset.home = '';
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
  app.dataset.home = '';
  const ok = st === 'saved';
  const count = readings().length;
  // A very high or low reading gets the same red-flag rules as everything else.
  const level = triage(`BP ${p.sys}/${p.dia}`).level;
  const msg = ok ? `Your family and Leffy can see it now. ${count} reading${count === 1 ? '' : 's'} so far.`
    : st === 'auth' ? 'Kept on this phone. Log in again and it sends by itself.'
      : st === 'unsafe' ? 'Not saved, and this phone could not keep a copy. Keep the app open and tap Try again.'
        : "Kept on this phone. It sends by itself as soon as it can. Your family can't see it yet.";
  frame({
    eyebrow: whenLabel(p.measuredAt), title: ok ? 'Saved' : 'Waiting', tabId: 'today',
    body: `${weekStrip()}<section class="j-card j-saved" role="status">
        <span class="seal ${ok ? '' : 'wait'}">${ic(ok ? 'check' : 'phoneoff')}</span>
        <div><h2>${p.supersedes ? 'Corrected' : 'Blood pressure'}</h2><div class="big">${esc(p.sys)} / ${esc(p.dia)}<em>mmHg</em></div></div>
        <p>${esc(msg)}</p></section>
        ${level === 'emergency' || level === 'urgent' ? `<button class="j-card j-row" data-flag><span class="j-ic em">${ic('alert', 's20')}</span><span class="j-tx"><b>Feeling unwell with this?</b><small>See what to do now</small></span>${ic('chev', 's16 chev')}</button>` : ''}`,
    act: st === 'unsafe' ? primary('Try again', 'send', 'data-retry') : `${link("That's wrong", 'data-fix')}${primary('Done', '', 'data-done')}`,
  });
  on('[data-done]', () => todayScreen());
  on('[data-fix]', () => { const r = readings().find(x => x.id === p.id); if (r) bpEntry({ fix: r }); else todayScreen(); });
  on('[data-retry]', async () => { const r = await flush(); savedScreen(p, r.left ? 'unsafe' : 'saved'); });
  on('[data-flag]', () => result(level));
}

/* ---------- readings and corrections ---------- */
function readingsScreen(back, page = 0) {
  app.dataset.home = '';
  const { readings: rs, replaced } = bpSeries(canon?.testResults || []);
  const per = fits(56, 44 + 24 + 8), start = page * per;
  const shown = rs.slice(start, start + per);
  const row = r => `<button class="j-row" data-r="${esc(r.id)}" ${r.id ? '' : 'disabled'}><span class="j-ic bp">${ic('gauge', 's20')}</span>
      <span class="j-tx"><b class="num">${r.sys} / ${r.dia}<em>mmHg</em></b><small>${esc(r.exactTime ? whenLabel(r.at) : fmtDate(melbDay(r.at)) + ' · from a photo')}${r.corrected ? ` · fixed from ${r.was.sys}/${r.was.dia}` : ''}</small></span>
      ${statusOf(r) === 'wait' ? chip('wait', 'On phone', 'phoneoff') : chip('ok', 'Saved', 'check')}</button>`;
  frame({
    eyebrow: rs.length ? `${rs.length} since ${fmtDate(melbDay(rs[rs.length - 1].at))}` : 'Blood pressure', title: 'Readings', tabId: 'health', back,
    body: rs.length ? `<section class="j-card j-page">${shown.map(row).join('')}</section>
        <div class="j-foot"><span>${replaced.length ? `${replaced.length} fixed reading${replaced.length === 1 ? '' : 's'} kept in history` : 'Tap one to fix it'}</span>
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
  current = healthScreen; app.dataset.home = '1';
  const rs = readings().filter(r => Date.now() - new Date(r.at).getTime() <= 30 * 86400000).reverse();
  let chart;
  if (rs.length < 2) chart = `<div class="j-empty-chart">${rs.length ? 'One reading so far. Your chart draws itself from the second one.' : 'Your chart draws itself here after your first readings.'}</div>`;
  else {
    const all = rs.flatMap(p => [p.sys, p.dia]);
    const lo = Math.floor((Math.min(...all) - 6) / 10) * 10, hi = Math.ceil((Math.max(...all) + 4) / 10) * 10;
    const W = 300, H = 100, L = 26, R = 4, T = 6, B = 16;
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
    chart = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Blood pressure, ${rs.length} readings in the last 30 days, average ${avg('sys')} over ${avg('dia')}">
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
    eyebrow: 'Your heart over time', title: 'Health', tabId: 'health',
    body: `<section class="j-card j-chart" aria-label="Blood pressure, last 30 days">
        <div class="j-chart-h"><b>Blood pressure</b><span>Last 30 days</span></div>${chart}</section>
      <section class="j-card j-page">
        <button class="j-row short" data-readings><span class="j-ic bp">${ic('list', 's20')}</span><span class="j-tx"><b>All my readings</b><small>${all.length ? `${all.length} saved · tap one to fix it` : 'None yet'}</small></span>${ic('chev', 's16 chev')}</button>
        <button class="j-row short" data-photo><span class="j-ic tabl">${ic('cam', 's20')}</span><span class="j-tx"><b>Photo of a result</b><small>Test, scan, letter or monitor</small></span>${ic('chev', 's16 chev')}</button>
        <button class="j-row short" data-check><span class="j-ic unsure">${ic('body', 's20')}</span><span class="j-tx"><b>Weekly body check</b><small>${checkDue ? 'Due · five quick questions' : 'Done this week'}</small></span>${ic('chev', 's16 chev')}</button>
        <a class="j-row short" href="/?full=1"><span class="j-ic fam">${ic('record', 's20')}</span><span class="j-tx"><b>Full record and Leffy</b><small>Results, questions, chat</small></span>${ic('chev', 's16 chev')}</a>
      </section>`,
  });
  on('[data-readings]', () => readingsScreen(() => healthScreen()));
  on('[data-photo]', () => photoResult());
  on('[data-check]', () => bodyCheck());
}

/* ---------- Medicines ---------- */
function medsScreen(page = 0) {
  current = () => medsScreen(page); app.dataset.home = '1';
  const m = currentMeds(canon || {});
  const waiting = outbox.pending().some(x => x.action === 'medication');
  const rows = [...m.unconfirmed.map(x => ({ ...x, kind: 'unsure' })), ...m.current.map(x => ({ ...x, kind: 'current' }))];
  const per = fits(72, 44 + 24 + 8 + (m.stopped.length ? 72 : 0)), start = page * per;
  const shown = rows.slice(start, start + per);
  const row = (x, i) => {
    const [cls, stc, word, icon] = { current: ['tabl', 'ok', 'Taking', 'pill'], unsure: ['unsure', 'wait', 'Not sure yet', 'q'] }[x.kind];
    const detail = [x.dose, x.when].filter(Boolean).join(' · ') || (x.from === 'family-list' ? "from the family's list" : 'no dose recorded');
    return `<button class="j-row ${x.kind === 'unsure' ? 'flag' : ''}" data-m="${start + i}"><span class="j-ic ${cls}">${ic(icon, 's20')}</span><span class="j-tx"><b>${esc(x.name)}</b><small><span class="st ${stc}">${word}</span> · ${esc(detail)}</small></span>${ic('chev', 's16 chev')}</button>`;
  };
  const stoppedRow = m.stopped.length ? `<button class="j-row stopped" data-stopped><span class="j-ic stop">${ic('stop', 's20')}</span><span class="j-tx"><b>Stopped</b><small>${esc(m.stopped.map(x => x.name).join(', '))}</small></span>${ic('chev', 's16 chev')}</button>` : '';
  const first = m.unconfirmed[0];
  const check = needsCheck(canon || {});
  const confirmedLine = m.confirmed ? `You checked it ${fmtDate(melbDay(m.confirmed.ts))}` : m.updatedAt ? `Changed ${fmtDate(m.updatedAt)}` : '';
  let act;
  if (m.empty) act = primary('Add a medicine I take', 'plus', 'data-addmed');
  else if (first) act = primary(`Check ${first.name.length > 18 ? 'this medicine' : first.name}`, 'q', 'data-first');
  else if (check) act = primary('Yes, this list is right', 'check', 'data-right');
  else act = primary('Add a medicine I take', 'plus', 'data-addmed');
  frame({
    eyebrow: waiting ? 'A change is waiting to send' : confirmedLine || 'What you take', title: 'Medicines', tabId: 'meds',
    body: m.empty ? '<section class="j-card j-chart"><div class="j-empty-chart" style="height:140px">No medicines are listed yet. Add the ones you take, as written on the box.</div></section>'
      : `<section class="j-card j-page j-meds" aria-label="Medicine list">${shown.map(row).join('')}${stoppedRow}</section>
      <div class="j-foot"><span>${rows.length > per ? `${start + 1}–${Math.min(rows.length, start + per)} of ${rows.length}` : 'Ticking tablets is on Today'}</span>
        <span>${start > 0 ? '<button data-prev>Back</button>' : ''}${start + per < rows.length ? ' <button data-next>More</button>' : (m.empty || first || check ? '' : '')}${!first && !m.empty && check ? '' : ''}</span></div>`,
    act,
  });
  onAll('[data-m]', b => medCheck(rows[+b.dataset.m]));
  on('[data-first]', () => medCheck({ ...first, kind: 'unsure' }));
  on('[data-addmed]', () => medDetails(null));
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

function medDetails(x) {
  frame({
    eyebrow: x ? 'As written on the box' : 'Add a medicine', title: x ? 'Details' : 'New medicine', tabId: 'meds', back: () => (x ? medCheck(x) : medsScreen()),
    body: `<div class="j-input"><label for="mn">Name</label><input id="mn" maxlength="80" autocomplete="off" value="${esc(x?.name || '')}" placeholder="As written on the box"></div>
      <div class="j-input"><label for="md">Dose <span style="font-weight:500">(optional)</span></label><input id="md" maxlength="40" value="${esc(x?.dose || '')}" placeholder="e.g. 10 mg"></div>
      <div class="j-input"><label for="mw">When <span style="font-weight:500">(optional)</span></label><input id="mw" maxlength="40" value="${esc(x?.when || '')}" placeholder="e.g. each morning"></div>`,
    act: primary('Next', '', 'data-next'),
  });
  on('[data-next]', () => {
    const name = $('#mn').value.trim();
    if (!name) { $('#mn').focus(); return toast('Type the name first'); }
    medConfirm(x, { name, dose: $('#md').value.trim(), when: $('#mw').value.trim(), status: 'current' });
  });
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
    const p = { name: after.name, dose: after.dose || '', frequency: after.when || '', status: after.status, ...(before && before.from !== 'family-list' && before.name !== after.name ? { previousName: before.name } : {}) };
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

/* ---------- urgent help: the existing red-flag rules ---------- */
function unwellScreen() {
  app.dataset.home = '';
  frame({
    eyebrow: 'I feel unwell', title: 'Get help', tabId: tab, unwell: true, back: () => go(tab),
    body: `<section class="j-card j-em" role="alert"><span class="j-ic">${ic('phone', 's20')}</span>
        <div><h2>Chest pain, pressure, or hard to breathe?</h2><p>Call 000 for an ambulance now. Sit down, unlock the door if you can, and don't drive.</p></div></section>
      <button class="j-card j-row" data-log><span class="j-ic unsure">${ic('q', 's20')}</span><span class="j-tx"><b>Something else</b><small>Tell us what's happening</small></span>${ic('chev', 's16 chev')}</button>`,
    act: `<a class="btn primary danger" data-primary href="tel:000">${ic('phone', 's20')}Call 000</a>`,
  });
  on('[data-log]', () => logSymptom());
}

function logSymptom() {
  const log = {};
  const step1 = () => {
    frame({
      eyebrow: 'I feel unwell', title: 'Symptoms', tabId: tab, unwell: true, back: unwellScreen,
      body: `<p class="j-q">What's happening?</p><div class="j-grid">${SYMPTOMS.map(s => `<button class="j-opt" data-s="${s.id}">${esc(s.label)}</button>`).join('')}</div>`,
    });
    onAll('[data-s]', b => { log.symptom = b.dataset.s; step2(); });
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
  const step4 = () => {
    frame({
      eyebrow: lbl(), title: 'Symptoms', tabId: tab, unwell: true, back: step3,
      body: `<div class="j-input"><label for="note">What were you doing? How long did it last? (optional)</label><textarea id="note" maxlength="1000"></textarea></div>
        <div><button class="j-mic" data-mic aria-pressed="false">${ic('mic', 's20')}<span>Speak</span></button></div>`,
      act: primary('Save', 'check', 'data-save'),
    });
    const ta = $('#note'); wireMic($('[data-mic]'), ta);
    let busy = false;
    on('[data-save]', async () => {
      if (busy) return; busy = true;
      log.note = ta.value.trim();
      log.level = symptomLevel(log);
      const w = WHEN.find(x => x[0] === log.when)[1], sev = SEVERITY.find(x => x[0] === log.severity)[1];
      // Show what to do first; the save happens alongside and never delays it.
      const saving = note(TAGS.symptom, `SYMPTOM: ${lbl()}, ${w.toLowerCase()}, ${sev.toLowerCase()}${log.note ? '. ' + log.note : ''}`, log);
      result(log.level, saving);
    });
  };
  step1();
}

// What to do next, for him in Melbourne (he can dial these numbers).
function result(level, saving = null) {
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
    eyebrow: 'I feel unwell', title: 'What to do', tabId: tab, unwell: level === 'emergency' || level === 'urgent',
    back: () => todayScreen(),
    body: `<section class="j-card j-em ${cls}" role="${level === 'emergency' || level === 'urgent' ? 'alert' : 'status'}"><span class="j-ic">${ic(level === 'emergency' || level === 'urgent' ? 'phone' : 'check', 's20')}</span><div><h2>${esc(msg[0])}</h2><p>${esc(msg[1])}</p></div></section>
      <p class="j-note" data-savemsg>${saving ? 'Saving…' : ''}</p>`,
    act,
  });
  on('[data-home]', () => todayScreen());
  if (saving) saving.then(st => { const el = $('[data-savemsg]'); if (el) el.textContent = st === 'saved' ? 'Saved. Your family can see it.' : st === 'unsafe' ? 'Not saved. Tell your family directly.' : "Kept on this phone. Your family can't see it until it sends."; });
}

/* ---------- weekly body check ---------- */
function bodyCheck() {
  const answers = {}; let i = 0;
  const step = () => {
    const q = BODY_CHECK[i];
    frame({
      eyebrow: `Body check · ${i + 1} of ${BODY_CHECK.length} · last 7 days`, title: 'Weekly check', tabId: 'health',
      back: () => (i === 0 ? healthScreen() : (i--, step())),
      body: `<p class="j-q">${esc(q.q)}</p>
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
function talk() {
  app.dataset.home = '';
  const n = canon ? pendingNudge(canon) : null;
  if (n) note(TAGS.seen, 'Seen the nudge ♥');
  frame({
    eyebrow: n ? `From ${/^(app|)$/i.test(n.from) ? 'family' : n.from}: “${n.text}”` : 'Your family sees this', title: 'Family', tabId: 'today', back: () => todayScreen(),
    body: `<div class="j-input"><label for="said">How you are, something you noticed, or just hello</label><textarea id="said" maxlength="2000"></textarea></div>
      <div><button class="j-mic" data-mic aria-pressed="false">${ic('mic', 's20')}<span>Speak</span></button></div>`,
    act: primary('Send', 'send', 'data-send'),
  });
  const ta = $('#said'); wireMic($('[data-mic]'), ta);
  let busy = false;
  on('[data-send]', async () => {
    const text = ta.value.trim(); if (!text) return toast('Say or type something first');
    if (busy) return; busy = true;
    const st = await note(TAGS.talk, `KIMON SAYS: ${text}`);
    todayScreen(); toast(st === 'saved' ? 'Sent to the family ♥' : "Kept on this phone. It sends when you're online.");
  });
}

/* ---------- photo of a result ---------- */
async function photoResult() {
  const file = await pickPhoto({ camera: true });
  if (!file) return;
  frame({ eyebrow: 'Photo of a result', title: 'Photo', tabId: 'health', back: () => healthScreen(), body: '<p class="j-note">Reading your photo. This takes a few seconds.</p>' });
  let img, out;
  try {
    img = await shrink(file);
    const r = await fetch('/api/photo', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: { data: img.data, type: img.type } }), signal: AbortSignal.timeout(70000) });
    if (r.status === 401) return toLogin();
    out = await r.json().catch(() => ({}));
    if (!r.ok || !out.ok) throw new Error(out.error || '');
  } catch (e) {
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
  const label = t => { btn.querySelector('span').textContent = t; };
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

/* ---------- boot ---------- */
(async () => {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return toLogin();
    const s = await r.json().catch(() => ({}));
    document.body.classList.toggle('preview', s.role !== 'kimon');
  } catch { if (!canon) return toLogin(); }
  if (canon) todayScreen();
  await flush(); await load();
  if (!canon) canon = { notes: [], profile: {} };
  // Refresh, but never pull him out of something he's doing.
  if (app.dataset.home === '1' || app.querySelector('.j-loading')) current();
})();

