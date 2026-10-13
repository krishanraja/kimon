import { triage, CONTACTS } from '/js/triage.js';
import { mountRecord, refreshRecord, recordHome, openSheet } from '/js/record.js';
import { extract, resultCards, situation, fmtDate, STAGES } from '/js/metrics.js';
import { plainTask } from '/js/record-model.js';
import { resultsText } from '/js/speech.js';
import { canRecord, startRecording, transcribeBlob, fmtTime } from '/js/recorder.js';

/* ---------------- tiny helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('kimon.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kimon.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const who = () => (store.get('who', '') || 'app').slice(0, 40);
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
    refreshRecord();
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
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; setTimeout(() => $('#code').focus(), 50); }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#loginMsg'); msg.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('#code').value }) });
    if (!r.ok) { msg.textContent = 'That code is not right'; $('#code').select(); return; }
    $('#code').value = '';
    boot();
  } catch { msg.textContent = 'No connection. Try again.'; }
});

async function boot() {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return showLogin();
    session = await r.json();
  } catch {
    if (!canon) return showLogin(); // never seen data on this phone; need the network once
    session = { sheetConfigured: true };
  }
  $('#login').hidden = true; $('#app').hidden = false;
  buildCheck(); buildRecord();
  await flushQueue();
  loadCanon();
  checkPendingAsk();
}

/* ---------------- tabs ---------------- */
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.go === 'record' && b.hasAttribute('aria-current')) recordHome();
  go(b.dataset.go);
}));
function go(name) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.nav-btn').forEach(b => b.toggleAttribute('aria-current', b.dataset.go === name));
  if (name !== 'ask') stopListening();
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

/* ---------------- ASK ---------------- */
const askParts = ['askIdle', 'askReview', 'askThinking', 'ideasSheet', 'answerDeck'];
function askShow(id) { askParts.forEach(p => { $('#' + p).hidden = p !== id; }); }

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, orbRec = null, orbTimer = 0;
const micBlocked = () => toast('Microphone blocked. Allow it in browser settings, or type.', 4000);

// Shared dictation for any text box. Records on the phone and transcribes on
// the server; falls back to the browser recogniser. Returns stop(), or null.
// onState(true) while recording, ('busy') while transcribing, (false) when done.
function listen(onText, onState) {
  if (listening) stopListening(false);
  if (canRecord()) {
    let handle = null, done = false;
    startRecording({ onAutoStop: () => stop() }).then(h => { handle = h; onState?.(true); navigator.vibrate?.(15); })
      .catch(e => { done = true; onState?.(false); if (e?.name === 'NotAllowedError') micBlocked(); else toast('Could not start the microphone'); });
    async function stop() {
      if (done || !handle) return; done = true;
      onState?.('busy');
      try { const text = await transcribeBlob(await handle.stop()); if (text) onText(text); else toast("Didn't catch that. Try again."); }
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

function orbState(state) {
  const orb = $('#orb');
  orb.classList.toggle('on', state === 'rec');
  orb.classList.toggle('busy', state === 'busy');
  orb.setAttribute('aria-pressed', String(state === 'rec'));
  orb.setAttribute('aria-label', state === 'rec' ? 'Stop and review' : 'Start speaking');
  $('#askEyebrow').textContent = state === 'rec' ? 'Listening. Tap when done' : state === 'busy' ? 'Writing down what you said' : 'Tap and talk';
  if (state !== 'rec') orb.style.removeProperty('--lvl');
}

async function startListening() {
  if (!canRecord()) return startBrowserListening();
  try {
    orbRec = await startRecording({ onLevel: v => $('#orb').style.setProperty('--lvl', v.toFixed(2)), onAutoStop: () => stopListening(true) });
  } catch (e) {
    if (e?.name === 'NotAllowedError') micBlocked(); else toast('Could not start the microphone. Type instead.');
    return openReview('');
  }
  listening = true; orbState('rec'); navigator.vibrate?.(15);
  $('#live').textContent = '0:00';
  orbTimer = setInterval(() => { if (orbRec) $('#live').textContent = fmtTime(orbRec.elapsed()); }, 250);
}

async function stopListening(toReview) {
  if (!listening) return;
  listening = false;
  if (rec) { try { rec.stop(); } catch { /* stopped */ } rec = null; }
  if (!orbRec) { // browser recogniser path
    orbState('idle');
    const said = $('#live').textContent.trim();
    if (toReview && said) openReview(said);
    return;
  }
  clearInterval(orbTimer);
  const h = orbRec; orbRec = null;
  orbState('busy'); $('#live').textContent = '';
  try {
    const text = await transcribeBlob(await h.stop());
    orbState('idle');
    if (!toReview) return;
    if (text) openReview(text); else { toast("Didn't catch that. Try again, a little closer to the phone."); }
  } catch {
    orbState('idle');
    if (toReview) { toast("Couldn't turn that into words. Try again, or type.", 4000); openReview(''); }
  }
}

// Fallback for browsers without recording support.
function startBrowserListening() {
  if (!SR) { toast('Voice is not available in this browser. Type instead.'); return openReview(''); }
  rec = new SR(); rec.lang = 'en-AU'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => { $('#live').textContent = resultsText(e); };
  rec.onerror = e => { if (e.error === 'not-allowed') micBlocked(); stopListening(true); };
  rec.onend = () => { if (listening) stopListening(true); };
  try { rec.start(); } catch { return; }
  listening = true; orbState('rec'); $('#live').textContent = '';
  navigator.vibrate?.(15);
}
$('#orb').addEventListener('click', () => {
  if ($('#orb').classList.contains('busy')) return;
  listening ? stopListening(true) : startListening();
});

function openReview(text) {
  askShow('askReview');
  const ta = $('#concern'); ta.value = text || store.get('draft', ''); updateFlag();
  if (!text) setTimeout(() => ta.focus(), 50);
}
function flagHtml(level, reasons) {
  if (level === 'routine') return '';
  const c = CONTACTS[level];
  return `<b>${esc(c.title)}.</b> ${esc(reasons[0] || '')}${level === 'emergency' ? '. ' + linkify(c.lines[1]) : ''}`;
}
function updateFlag(target = '#flag') {
  const { level, reasons } = triage($('#concern').value);
  const f = $(target); f.className = 'flag ' + level; f.innerHTML = flagHtml(level, reasons); f.hidden = level === 'routine';
  return level;
}
$('#concern').addEventListener('input', () => { store.set('draft', $('#concern').value); updateFlag(); });
$('#typeInstead').addEventListener('click', () => openReview(''));
$('#ideas').addEventListener('click', () => askShow('ideasSheet'));
$('#ideasClose').addEventListener('click', () => askShow('askIdle'));
document.querySelectorAll('.idea').forEach(b => b.addEventListener('click', () => openReview(b.textContent)));
$('#redo').addEventListener('click', () => { store.set('draft', ''); $('#live').textContent = ''; askShow('askIdle'); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Keep the screen on while an answer is being prepared (a sleeping phone can
// drop the connection). Best effort: not every browser supports it.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

// Read the server's progress stream until the answer arrives.
async function streamAsk(concern, rid, onStage) {
  const r = await fetch('/api/ask', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ concern, by: who(), rid }), signal: AbortSignal.timeout(190000),
  });
  if (r.status === 401) { showLogin(); throw Object.assign(new Error('login required'), { status: 401 }); }
  if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'stage') onStage(ev.text);
      else if (ev.type === 'answer') return ev;
      else if (ev.type === 'error') throw new Error(ev.error);
    }
  }
  throw new Error('connection closed before the answer');
}

// The server saves every answer with its id; fetch it if the stream was lost.
async function recoverAnswer(rid, tries = 8) {
  for (let i = 0; i < tries; i++) {
    await sleep(i === 0 ? 2000 : 8000);
    try {
      const r = await fetch('/api/answer?rid=' + encodeURIComponent(rid), { credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
    } catch { /* keep trying */ }
  }
  return null;
}

let asking = false;
async function runAsk(concern) {
  asking = true;
  const rid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set('pendingAsk', { rid, concern, ts: Date.now() });
  askShow('askThinking');
  const lvl = updateFlag('#thinkFlag');
  const line = t => { $('#thinkLine').textContent = t; };
  line('Sending your question');
  keepAwake(true);
  let res = null;
  try {
    res = await streamAsk(concern, rid, line);
  } catch (e) {
    if (e.status === 401) { asking = false; keepAwake(false); return; }
    // A server error before anything was saved: try once more straight away.
    if (/^HTTP 5/.test(e.message)) {
      line('Trying again');
      try { res = await streamAsk(concern, rid, line); } catch { /* fall through to recovery */ }
    }
    if (!res) { line('The connection dropped. Getting your answer'); res = await recoverAnswer(rid); }
  }
  keepAwake(false);
  asking = false;
  if (res) {
    store.set('pendingAsk', null); store.set('draft', '');
    showAnswer(res);
    if (res.saved) loadCanon();
  } else {
    toast(lvl === 'emergency' ? 'No connection. If this is happening now: call 000.' : "The answer didn't arrive. Your words are kept. Tap Get the answer to try again.", 6000);
    openReview(concern);
  }
}
$('#askBtn').addEventListener('click', () => {
  const concern = $('#concern').value.trim();
  if (concern.length < 3) { toast('Say or type the worry first'); return; }
  runAsk(concern);
});

// Back on the app after switching away: collect an answer that finished meanwhile.
async function checkPendingAsk() {
  const p = store.get('pendingAsk', null);
  if (!p || asking || Date.now() - p.ts > 15 * 60000) return;
  const res = await recoverAnswer(p.rid, 2);
  if (res && !asking) {
    store.set('pendingAsk', null);
    go('ask'); showAnswer(res); toast('Here is the answer to your last question');
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkPendingAsk(); });


const LEVEL_NAME = { emergency: 'Emergency', urgent: 'Today', soon: 'This week', routine: 'No red flags' };

function list(items) {
  return `<ul>${items.map((t, n) => `<li><span class="n">${n + 1}</span><span>${linkify(t)}</span></li>`).join('')}</ul>`;
}

function showAnswer(res) {
  const a = res.answer, lvl = a.urgency, c = res.contacts;
  const speakText = [a.headline, a.whatItLikelyMeans].join(' ');
  const cards = [{
    cls: 'level ' + lvl,
    html: `<p class="kicker">${LEVEL_NAME[lvl]}</p>
      <h3>${esc(a.headline)}</h3>
      <div class="who"><b>${esc(c.title)}</b>${c.lines.map(l => `<span>${linkify(l)}</span>`).join('')}</div>
      <div class="card-actions"><button class="pill" data-say>Read it to me</button></div>`,
    mount: card => { card.querySelector('[data-say]').onclick = () => say(speakText); },
  }];
  if (a.whatItLikelyMeans) cards.push({ html: `<p class="kicker">What's likely going on</p><p>${esc(a.whatItLikelyMeans)}</p>${a.usedFromRecord.length ? `<p class="meta">Based on: ${esc(a.usedFromRecord.join(' · '))}</p>` : ''}` });
  if (a.doNow.length) cards.push({ html: `<p class="kicker">Do this</p>${list(a.doNow)}` });
  if (a.watchFor.length) cards.push({ html: `<p class="kicker">Watch for</p>${list(a.watchFor)}` });
  if (a.askTheDoctor.length) cards.push({
    html: `<p class="kicker">Ask his doctor</p>${list(a.askTheDoctor)}<div class="card-actions"><button class="pill" data-addq>Add these to his questions</button></div>`,
    mount: card => {
      card.querySelector('[data-addq]').onclick = async ev => {
        ev.target.disabled = true; ev.target.textContent = 'Adding';
        let ok = true;
        for (const q of a.askTheDoctor) ok = (await save('question', { question: q, askWhom: 'GP or cardiologist', priority: '2' })).ok && ok;
        ev.target.textContent = ok ? 'Added to his record' : 'Will save when online';
        loadCanon();
      };
    },
  });
  cards.push({
    html: `<p class="kicker">Where this comes from</p>
      ${a.evidence.length ? `<ul>${a.evidence.map(e => `<li><span class="n">✓</span><span>${esc(e.point)}${e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(shortSrc(e.title))}</a>` : ' <small>general clinical knowledge</small>'}</span></li>`).join('')}</ul>` : ''}
      ${a.limits ? `<p class="meta">${esc(a.limits)}</p>` : ''}
      <p class="meta">${res.source.kind === 'ai' ? `Answered from his record, the Australian heart guide${res.source.searched ? ` and ${res.source.searched} trusted web pages` : ''}.` : 'Rule-based answer (' + esc(res.source.reason) + ').'}
      ${res.saved ? ' Saved to his record.' : res.recordError ? ' ' + esc(res.recordError) + '.' : ' Not saved.'}</p>`,
  });
  askShow('answerDeck');
  deck($('#answerDeck'), cards, { onDone: () => { window.speechSynthesis?.cancel(); $('#live').textContent = ''; askShow('askIdle'); } });
}
function shortSrc(t) { return String(t || 'source').split(/[-|:]/)[0].trim().slice(0, 48); }
function say(text) {
  if (!('speechSynthesis' in window)) return toast('Reading aloud is not available here');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en-AU'; u.rate = .98;
  speechSynthesis.speak(u);
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
  }], { onDone: () => { buildCheck(); go('ask'); } });
  if (r.ok) loadCanon();
}

/* ---------------- RECORD ---------------- */
function buildRecord() {
  mountRecord($('#rec'), {
    canon: () => canon, session: () => session, save, toast, fit, listen,
    openAsk: text => { go('ask'); openReview(text); },
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
  <label class="kicker" for="whoName">Your name, shown next to what you add</label>
  <input id="whoName" maxlength="40" placeholder="First name">
  <button class="btn" data-out>Log out on this phone</button>
  <button class="btn primary" data-close>Done</button>`, sheet => {
  const w = sheet.querySelector('#whoName'); w.value = store.get('who', ''); w.oninput = () => store.set('who', w.value.trim());
  sheet.querySelector('[data-out]').onclick = async () => { await fetch('/api/login', { method: 'DELETE' }); localStorage.clear(); location.reload(); };
}));

boot();
