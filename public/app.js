import { CONTACTS } from '/js/triage.js';
import { mountRecord, refreshRecord, recordHome, openSheet } from '/js/record.js';
import { extract, resultCards, situation, fmtDate, STAGES } from '/js/metrics.js';
import { plainTask } from '/js/record-model.js';
import { mountDad, refreshDad, dadHome } from '/js/dad.js';
import { resultsText } from '/js/speech.js';
import { canRecord, startRecording, transcribeBlob } from '/js/recorder.js';
import { mountChat, refreshChat, sendToChat, checkPending, stopSpeaking, photoToChat, showChat } from '/js/chat.js';

/* ---------------- tiny helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('kimon.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kimon.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const who = () => session.role === 'kimon' ? 'Kimon' : (store.get('who', '') || 'app').slice(0, 40);
const linkify = s => esc(s).replace(/\b(vved\.org\.au)\b/g, '<a href="https://$1" target="_blank" rel="noopener">$1</a>')
  .replace(/\b(000|1300 60 60 24|1800 022 222)\b/g, m => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`);

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

async function api(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const r = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const data = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  if (r.status === 401) { showLogin(); throw Object.assign(new Error('login required'), { status: 401 }); }
  if (!r.ok || data.ok === false) throw Object.assign(new Error(data.error || 'request failed'), { status: r.status, data });
  return data;
}

/* ---------------- sync state + offline write queue ---------------- */
let canon = store.get('canon', null);
let session = {};

function setSync(kind, text) {
  const s = $('#sync'); s.className = 'sync ' + kind; s.querySelector('span').textContent = text;
}

async function loadCanon() {
  if (!session.sheetConfigured) { setSync('warn', 'Sheet not connected'); return; }
  setSync('', 'Syncing');
  try {
    canon = await api('/api/canon', { timeout: 14000 });
    store.set('canon', canon);
    setSync('ok', 'Up to date');
    refreshRecord(); refreshDad(); refreshChat();
    if (!checkTouched) buildCheck();
  } catch (e) {
    if (e.status === 401) return;
    setSync(canon ? 'warn' : 'bad', canon ? 'Showing saved copy' : 'Offline');
  }
}

async function save(action, payload) {
  try {
    const out = await api('/api/write', { method: 'POST', body: { action, payload, by: who() } });
    return { ok: true, out };
  } catch (e) {
    if (e.status === 401) return { ok: false };
    const q = store.get('queue', []); q.push({ action, payload, by: who(), ts: Date.now() }); store.set('queue', q);
    setSync('warn', `${q.length} waiting to save`);
    return { ok: false, queued: true };
  }
}

async function flushQueue() {
  const q = store.get('queue', []);
  if (!q.length || !session.sheetConfigured) return;
  const left = [];
  for (const item of q) {
    try { await api('/api/write', { method: 'POST', body: item }); } catch (e) { left.push(item); }
  }
  store.set('queue', left);
  if (!left.length) toast('Saved everything that was waiting');
}
addEventListener('online', () => flushQueue().then(loadCanon));
$('#sync').addEventListener('click', () => flushQueue().then(loadCanon));

/* ---------------- login / boot ---------------- */
function showLogin() {
  $('#app').hidden = true; $('#login').hidden = false;
  $('#loginCode').hidden = false; $('#loginWho').hidden = true;
  setTimeout(() => $('#code').focus(), 50);
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#loginMsg'); msg.textContent = '';
  const btn = e.submitter || $('#loginForm .btn'); btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('#code').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { msg.textContent = j.error || 'That code is not right'; $('#code').select(); return; }
    $('#code').value = '';
    if (j.role === 'kimon') return location.replace('/me');
    if (j.askWho) return askWho();
    boot();
  } catch { msg.textContent = 'No connection. Try again.'; }
  finally { btn.disabled = false; }
});

// The passcode is shared, so the phone says who is using it.
function askWho() {
  $('#loginCode').hidden = true; $('#loginWho').hidden = false;
  $('#whoName').hidden = true; $('#whoPick').hidden = false;
  $('#nameInput').value = store.get('who', '');
}
async function setPersona(persona) {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona }) }).catch(() => null);
  if (!r || !r.ok) { toast('No connection. Try again.'); return false; }
  return true;
}
$('#loginWho').addEventListener('click', async e => {
  const b = e.target.closest('[data-who]'); if (!b) return;
  if (b.dataset.who === 'kimon') { if (await setPersona('kimon')) location.replace('/me'); return; }
  $('#whoPick').hidden = true; $('#whoName').hidden = false; setTimeout(() => $('#nameInput').focus(), 50);
});
$('#whoName').addEventListener('submit', async e => {
  e.preventDefault();
  store.set('who', $('#nameInput').value.trim());
  if (await setPersona('family')) boot();
});

async function boot() {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return showLogin();
    session = await r.json();
  } catch {
    if (!canon) return showLogin(); // never seen data on this phone; need the network once
    session = { sheetConfigured: true, role: store.get('role', 'family') };
  }
  store.set('role', session.role);
  // Kimon sees his own home first; the full dashboard is one tap from there.
  if (isKimon() && !new URLSearchParams(location.search).has('full')) return location.replace('/me');
  document.body.classList.toggle('as-kimon', isKimon());
  $('#homeBtn').hidden = !isKimon();
  $('#login').hidden = true; $('#app').hidden = false;
  buildCheck(); buildRecord(); buildDad(); buildChat();
  await flushQueue();
  loadCanon();
  checkPending();
}

/* ---------------- tabs ---------------- */
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.go === 'record' && b.hasAttribute('aria-current')) recordHome();
  if (b.dataset.go === 'dad' && b.hasAttribute('aria-current')) dadHome();
  go(b.dataset.go);
}));
function go(name) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.nav-btn').forEach(b => { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (name !== 'ask') stopSpeaking(); else showChat();
  requestAnimationFrame(fitAll);
}

/* ---------------- deck: one card at a time, never scrolls ---------------- */
const ARROW_L = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';

function deck(el, cards, { onDone, start = 0, doneIcon = CHECK } = {}) {
  let i = start, dir = 1;
  function render() {
    const c = cards[i];
    el.innerHTML = `
      <article class="card ${c.cls || ''} ${dir < 0 ? 'back-anim' : ''}" aria-roledescription="card" aria-label="${i + 1} of ${cards.length}">
        <div class="fit">${c.html}</div>
      </article>
      <div class="deck-foot">
        <button class="nav-arrow" data-prev aria-label="Previous" ${i === 0 ? 'disabled' : ''}>${ARROW_L}</button>
        <div class="dots" aria-hidden="true">${cards.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <button class="nav-arrow primary" data-next aria-label="${i === cards.length - 1 ? 'Done' : 'Next'}" ${c.lockNext ? 'disabled' : ''}>${i === cards.length - 1 ? doneIcon : ARROW_R}</button>
      </div>`;
    if (c.hideFoot) el.querySelector('.deck-foot').style.visibility = 'hidden';
    el.querySelector('[data-prev]').onclick = () => move(-1);
    el.querySelector('[data-next]').onclick = () => move(1);
    c.mount?.(el.querySelector('.card'), api_);
    fit(el.querySelector('.fit'));
  }
  function move(d) {
    if (d > 0 && i === cards.length - 1) return onDone?.();
    i = Math.max(0, Math.min(cards.length - 1, i + d)); dir = d; render();
  }
  // swipe
  let x0 = null;
  el.ontouchstart = e => { x0 = e.touches[0].clientX; };
  el.ontouchend = e => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 60 && !(dx < 0 && cards[i].lockNext)) move(dx < 0 ? 1 : -1);
  };
  const api_ = { next: () => move(1), unlock: () => { cards[i].lockNext = false; el.querySelector('[data-next]').disabled = false; }, go: k => { dir = k > i ? 1 : -1; i = k; render(); } };
  render();
  return api_;
}

// Shrink text until the card fits. No scrollbars, ever.
function fit(box) {
  if (!box || !box.isConnected || !box.clientHeight) return;
  let fs = 19; box.style.setProperty('--fs', fs + 'px');
  while (box.scrollHeight > box.clientHeight + 1 && fs > 12.5) { fs -= .5; box.style.setProperty('--fs', fs + 'px'); }
  // Still too tall at the smallest readable size: drop secondary lines, last first.
  const drops = [...box.querySelectorAll('.drop')];
  while (box.scrollHeight > box.clientHeight + 1 && drops.length) drops.pop().hidden = true;
}
function fitAll() { document.querySelectorAll('.view:not([hidden]) .fit').forEach(fit); }
addEventListener('resize', () => requestAnimationFrame(fitAll));

/* ---------------- voice: shared dictation for text boxes ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBlocked = () => toast('Microphone blocked. Allow it in browser settings, or type.', 4000);

// Records on the phone and transcribes on the server; falls back to the
// browser recogniser. Returns stop(), or null.
// onState(true) while recording, ('busy') while transcribing, (false) when done.
function listen(onText, onState) {
  if (canRecord()) {
    let handle = null, done = false;
    startRecording({ onAutoStop: () => stop() }).then(h => { handle = h; onState?.(true); navigator.vibrate?.(15); })
      .catch(e => { done = true; onState?.(false); if (e?.name === 'NotAllowedError') micBlocked(); else toast('Could not start the microphone'); });
    async function stop() {
      if (done || !handle) return; done = true;
      onState?.('busy');
      try {
        const blob = await handle.stop();
        if (handle.silent()) toast("I didn't hear anything. Try again, closer to the phone.");
        else { const text = await transcribeBlob(blob); if (text) onText(text); else toast("Didn't catch that. Try again."); }
      }
      catch { toast("Couldn't turn that into words. Try again, or type."); }
      onState?.(false);
    }
    return () => { stop(); };
  }
  if (!SR) { toast('Voice is not available in this browser. Type instead.'); return null; }
  const r = new SR(); r.lang = 'en-AU'; r.continuous = true; r.interimResults = true;
  let live = true;
  r.onresult = e => onText(resultsText(e));
  r.onerror = e => { if (e.error === 'not-allowed') micBlocked(); };
  r.onend = () => { if (live) { live = false; onState?.(false); } };
  try { r.start(); } catch { return null; }
  onState?.(true); navigator.vibrate?.(15);
  return () => { if (live) { live = false; try { r.stop(); } catch { /* stopped */ } onState?.(false); } };
}

/* ---------------- ASK LEFFY ---------------- */
const isKimon = () => session.role === 'kimon';
function openAsk(text) { go('ask'); sendToChat(text); }
function buildChat() {
  mountChat($('#chat'), { canon: () => canon, role: () => session.role, who, save, toast, listen, openSheet, showLogin, reload: () => loadCanon() });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkPending(); });

// Keep the chat composer above the keyboard: iOS does not resize the page.
if (window.visualViewport) {
  const vv = window.visualViewport, rootEl = document.documentElement;
  const onVV = () => {
    rootEl.style.setProperty('--app-h', vv.height + 'px');
    document.body.classList.toggle('kb', innerHeight - vv.height > 140);
    if (vv.offsetTop) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); onVV();
}

/* ---------------- CHECK-IN: one question per card ---------------- */
const G = 'var(--routine)', A = 'var(--urgent)', R = 'var(--emergency)';
const QS = [
  ['chest', 'Any chest pain, pressure or tightness since you last spoke?', [['none', 'None', G], ['sometimes', 'Sometimes', A], ['often', 'Often', R]]],
  ['breath', 'Has he been short of breath?', [['none', 'No', G], ['on-exertion', 'Only when active', A], ['at-rest', 'Even sitting still', R]]],
  ['walking', 'How far can he walk, compared with usual?', [['same', 'Same as usual', G], ['less', 'A bit less', A], ['much-less', 'Much less', R]]],
  ['energy', 'How is his energy?', [['normal', 'Normal', G], ['lower', 'Lower', A], ['very-low', 'Very low', R]]],
  ['tablets', 'Is he taking his tablets as prescribed?', [['yes', 'Yes', G], ['no', 'Missing some', A], ['not-applicable', 'No tablets yet', 'var(--ink-3)']]],
  ['mood', 'How is he in himself?', [['ok', 'Okay', G], ['low', 'A bit low', A], ['very-low', 'Very low', R]]],
];

let checkTouched = false;
function buildCheck() {
  checkTouched = false;
  const answers = { _gaps: {} };
  const cards = QS.map(([key, q, opts], n) => ({
    lockNext: true,
    html: `<p class="step">${n + 1} of ${QS.length}</p><h3>${esc(q)}</h3>
      <div class="choices">${opts.map(([v, label, col]) => `<button class="choice" data-v="${v}" aria-pressed="false"><span class="sw" style="background:${col}"></span>${esc(label)}</button>`).join('')}</div>`,
    mount: (card, d) => {
      card.querySelectorAll('.choice').forEach(b => {
        if (answers[key] === b.dataset.v) { b.setAttribute('aria-pressed', 'true'); d.unlock(); }
        b.onclick = () => {
          answers[key] = b.dataset.v; checkTouched = true;
          card.querySelectorAll('.choice').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          navigator.vibrate?.(10); d.unlock(); setTimeout(d.next, 260);
        };
      });
    },
  }));
  // Tasks the family queued from His record > To do.
  const queued = (canon?.gaps || []).filter(g => g.status === 'in-progress');
  queued.forEach(g => cards.push({
    html: `<p class="step">From your to-do</p><h3>Ask him: ${esc(plainTask(g))}</h3><label class="sr" for="gap-${esc(g.id)}">His answer</label><textarea id="gap-${esc(g.id)}" maxlength="1000" placeholder="What did he say? Leave blank if you didn't get to it."></textarea><div class="row"><button class="micbtn" type="button" data-mic aria-pressed="false"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>Speak</span></button></div>`,
    mount: card => {
      const t = card.querySelector('textarea'), b = card.querySelector('[data-mic]');
      t.value = answers._gaps[g.id] || ''; t.oninput = () => { answers._gaps[g.id] = t.value; };
      let stop = null;
      b.onclick = () => {
        if (stop) { stop(); return; }
        const base = t.value ? t.value.trim() + ' ' : '';
        stop = listen(x => { t.value = base + x; answers._gaps[g.id] = t.value; }, on => { b.setAttribute('aria-pressed', String(on === true)); b.disabled = on === 'busy'; b.querySelector('span').textContent = on === true ? 'Stop' : on === 'busy' ? 'Writing…' : 'Speak'; if (on === false) stop = null; });
      };
    },
  }));
  cards.push({
    html: `<p class="step">Last one</p><h3>Anything else he mentioned?</h3><label class="sr" for="checkNotes">Notes</label><textarea id="checkNotes" maxlength="1000" placeholder="Optional. e.g. dizzy getting out of bed twice"></textarea>`,
    mount: card => { const t = card.querySelector('textarea'); t.value = answers._notes || ''; t.oninput = () => { answers._notes = t.value; }; },
  });
  const d = deck($('#checkDeck'), cards, {
    onDone: async () => {
      const { _notes, _gaps, ...a } = answers;
      if (Object.keys(a).length < QS.length) { toast('A question was skipped'); return; }
      const local = (a.chest !== 'none' || a.breath === 'at-rest') ? 'Act-now' : null;
      const r = await save('checkin', { answers: a, notes: _notes || '' });
      for (const [id, text] of Object.entries(_gaps)) {
        const g = (canon?.gaps || []).find(x => x.id === id);
        if (!g || !text.trim()) continue;
        await save('note', { text: `FOUND OUT (${id} ${plainTask(g)}): ${text.trim()}`, tag: 'found-out' });
        await save('gap', { id, status: 'closed' });
      }
      const verdict = r.ok ? r.out.verdict : (local || 'Saved offline');
      showCheckResult(verdict, r);
    },
  });
  return d;
}

function showCheckResult(verdict, r) {
  const map = {
    'Stable': ['routine', 'Stable', 'Nothing has changed for the worse. Keep his routine and the next GP visit as planned.'],
    'Changed': ['soon', 'Something changed', 'Not an emergency, but worth his GP knowing this week. Use Ask to talk it through.'],
    'Act-now': ['urgent', 'Act on this today', 'Chest symptoms or breathlessness at rest need a clinician today. If it is happening right now, he calls 000.'],
  };
  const [lvl, title, body] = map[verdict] || ['soon', 'Saved on this phone', 'It will reach his record when you are back online.'];
  const c = CONTACTS[lvl];
  deck($('#checkDeck'), [{
    cls: 'level ' + lvl,
    html: `<p class="kicker">Check-in ${r.ok ? 'saved' : r.queued ? 'waiting to save' : ''}</p><h3>${esc(title)}</h3><p>${esc(body)}</p>
      <div class="who"><b>${esc(c.title)}</b>${c.lines.map(l => `<span>${linkify(l)}</span>`).join('')}</div>`,
  }], { onDone: () => { buildCheck(); go('record'); } });
  if (r.ok) loadCanon();
}

/* ---------------- RECORD ---------------- */
function buildDad() {
  mountDad($('#dad'), { canon: () => canon, save, toast, fit, listen, who, openAsk });
}

function buildRecord() {
  mountRecord($('#rec'), {
    canon: () => canon, session: () => session, save, toast, fit, listen,
    openAsk, addPhoto: () => { go('ask'); photoToChat(); },
    onTasksChanged: () => { store.set('canon', canon); if (!checkTouched) buildCheck(); },
  });
}

function briefText() {
  const c = canon || {}, p = c.profile || {};
  const m = extract(c.testResults);
  const L = ['SUMMARY FOR HIS DOCTOR (prepared by family from his reports and our notes)',
    `Prepared ${fmtDate(new Date().toISOString(), { year: true })}`, ''];
  const sit = situation({ m, medications: c.medications, notes: c.notes });
  if (sit) L.push(sit, '');
  if (p.age) L.push(`Age ${p.age}${p.sex ? ', ' + p.sex : ''}`);
  L.push(`Where things are: ${p.pathway_stage || 'Referred to cardiology (unconfirmed)'}. ${p.next_appointment ? 'Cardiology appointment ' + fmtDate(p.next_appointment, { year: true }) + '.' : 'No cardiology appointment date yet.'}`);
  const rc = resultCards(m);
  if (rc.length) {
    L.push('', 'KEY RESULTS');
    for (const r of rc) {
      if (r.missing) { L.push(`- ${r.def.label}: not measured`); continue; }
      let line = `- ${r.def.label}: ${r.value}${r.def.unit ? ' ' + r.def.unit : ''} (${r.verdict.toLowerCase()}), ${fmtDate(r.hit.date, { year: true })}`;
      if (r.key === 'cac' && r.hit.vessels) line += `. ${Object.entries(r.hit.vessels).map(([k, v]) => `${k} ${v}`).join(', ')}${r.hit.percentile ? `; ${r.hit.percentile} percentile` : ''}`;
      if (r.key === 'ldl') line += `. Total ${m.total?.value ?? '?'}, non-HDL ${m.nonhdl?.value ?? '?'}, trig ${m.trig?.value ?? '?'}, HDL ${m.hdl?.value ?? '?'}`;
      L.push(line);
    }
  }
  L.push('', 'MEDICATIONS'); (c.medications || []).length ? c.medications.forEach(x => L.push(`- ${x.name} ${x.dose} ${x.frequency} (${x.status})`)) : L.push('- none recorded');
  const notes = (c.notes || []).filter(n => n.by !== 'claude-test');
  const sym = notes.filter(n => /symptom|found-out/i.test(n.tag)).slice(-6);
  if (sym.length) { L.push('', 'WHAT HE HAS TOLD US'); sym.forEach(n => L.push(`- ${fmtDate(n.tsUTC)}: ${String(n.text).replace(/^FOUND OUT[^:]*:\s*/i, '')}`)); }
  const ci = (c.checkins || []).slice(-5);
  if (ci.length) { L.push('', 'RECENT CHECK-INS'); ci.forEach(x => L.push(`- ${fmtDate(x.tsUTC || x.tsMelb)}: ${x.verdict}. Chest ${x.chest}, breath ${x.breath}, walking ${x.walking}, energy ${x.energy}${x.notes ? '. ' + x.notes : ''}`)); }
  const open = (c.gaps || []).filter(g => g.status !== 'closed');
  if (open.length) { L.push('', 'STILL UNKNOWN'); open.forEach(g => L.push(`- ${plainTask(g)}`)); }
  const qs = c.questions || [];
  const ans = qs.filter(q => q.status === 'answered');
  if (ans.length) { L.push('', 'ANSWERS SO FAR'); ans.forEach(q => L.push(`- ${q.question} ${q.answer}`)); }
  const q = qs.filter(x => x.status !== 'answered').sort((a, b) => (+a.priority || 9) - (+b.priority || 9));
  if (q.length) { L.push('', 'OUR QUESTIONS'); q.forEach((x, n) => L.push(`${n + 1}. ${x.question}`)); }
  return L.join('\n');
}
async function shareBrief() {
  const text = briefText();
  try {
    if (navigator.share) { await navigator.share({ title: 'Summary for his doctor', text }); return; }
    await navigator.clipboard.writeText(text); toast('Brief copied. Paste it into a message.');
  } catch (e) { if (e.name !== 'AbortError') toast('Could not copy on this browser'); }
}

$('#shareBtn').addEventListener('click', shareBrief);
$('#gearBtn').addEventListener('click', () => openSheet(`
  <p class="kicker">Settings</p>
  <p class="kicker">Who is using this phone</p>
  <div class="seg" role="group" aria-label="Who is using this phone">
    <button type="button" data-persona="family" aria-pressed="${!isKimon()}">Family</button>
    <button type="button" data-persona="kimon" aria-pressed="${isKimon()}">Kimon</button>
  </div>
  ${isKimon() ? '' : `<label class="kicker" for="whoName">Your name, shown next to what you add</label>
  <input id="whoName" maxlength="40" placeholder="First name">`}
  <button class="btn" data-out>Log out on this phone</button>
  <button class="btn primary" data-close>Done</button>`, sheet => {
  const w = sheet.querySelector('#whoName');
  if (w) { w.value = store.get('who', ''); w.oninput = () => store.set('who', w.value.trim()); }
  sheet.querySelectorAll('[data-persona]').forEach(b => b.onclick = async () => {
    const p = b.dataset.persona;
    if ((p === 'kimon') === isKimon()) return;
    if (!(await setPersona(p))) return;
    store.set('role', p);
    location.replace(p === 'kimon' ? '/me' : '/');
  });
  sheet.querySelector('[data-out]').onclick = async () => { await fetch('/api/login', { method: 'DELETE' }); localStorage.clear(); location.replace('/'); };
}));

boot();
