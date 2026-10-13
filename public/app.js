import { triage, CONTACTS } from '/js/triage.js';

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
    buildRecord();
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
}

/* ---------------- tabs ---------------- */
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
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
  while (box.scrollHeight > box.clientHeight + 1 && fs > 13) { fs -= .5; box.style.setProperty('--fs', fs + 'px'); }
}
function fitAll() { document.querySelectorAll('.view:not([hidden]) .fit').forEach(fit); }
addEventListener('resize', () => requestAnimationFrame(fitAll));

/* ---------------- ASK ---------------- */
const askParts = ['askIdle', 'askReview', 'askThinking', 'ideasSheet', 'answerDeck'];
function askShow(id) { askParts.forEach(p => { $('#' + p).hidden = p !== id; }); }

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, finalText = '';

function startListening() {
  if (!SR) { toast('Voice is not available in this browser. Type instead.'); return openReview(''); }
  finalText = '';
  rec = new SR(); rec.lang = 'en-AU'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => {
    let interim = '';
    for (let k = e.resultIndex; k < e.results.length; k++) {
      const t = e.results[k][0].transcript;
      if (e.results[k].isFinal) finalText += t + ' '; else interim += t;
    }
    $('#live').textContent = (finalText + interim).trim();
  };
  rec.onerror = e => { if (e.error === 'not-allowed') toast('Microphone blocked. Allow it in browser settings, or type.'); stopListening(true); };
  rec.onend = () => { if (listening) stopListening(true); };
  try { rec.start(); } catch { return; }
  listening = true;
  $('#orb').classList.add('on'); $('#orb').setAttribute('aria-pressed', 'true'); $('#orb').setAttribute('aria-label', 'Stop and review');
  $('#askEyebrow').textContent = 'Listening. Tap when done';
  $('#live').textContent = '';
  navigator.vibrate?.(15);
}
function stopListening(toReview) {
  if (!listening) return;
  listening = false; try { rec?.stop(); } catch { /* already stopped */ }
  $('#orb').classList.remove('on'); $('#orb').setAttribute('aria-pressed', 'false'); $('#orb').setAttribute('aria-label', 'Start speaking');
  $('#askEyebrow').textContent = 'Tap and talk';
  const said = $('#live').textContent.trim();
  if (toReview && said) openReview(said);
}
$('#orb').addEventListener('click', () => listening ? stopListening(true) : startListening());

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

const THINK = ['Reading his record', 'Checking the evidence', 'Weighing what matters', 'Writing it plainly'];
$('#askBtn').addEventListener('click', async () => {
  const concern = $('#concern').value.trim();
  if (concern.length < 3) { toast('Say or type the worry first'); return; }
  askShow('askThinking');
  const lvl = updateFlag('#thinkFlag');
  let k = 0; $('#thinkLine').textContent = THINK[0];
  const timer = setInterval(() => { k = (k + 1) % THINK.length; $('#thinkLine').textContent = THINK[k]; }, 2600);
  try {
    const res = await api('/api/ask', { method: 'POST', body: { concern, by: who() }, timeout: 65000 });
    store.set('draft', '');
    showAnswer(res);
    if (res.saved) loadCanon();
  } catch (e) {
    if (e.status === 401) return;
    toast(lvl === 'emergency' ? 'No connection. If this is happening now: call 000.' : 'Could not reach the server. Your words are kept, try again.', 5000);
    openReview(concern);
  } finally { clearInterval(timer); }
});

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
      <p class="meta">${res.source.kind === 'ai' ? 'Answered from his record and the Australian evidence guide.' : 'Rule-based answer (' + esc(res.source.reason) + ').'}
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

function buildCheck() {
  const answers = {};
  const cards = QS.map(([key, q, opts], n) => ({
    lockNext: true,
    html: `<p class="step">${n + 1} of ${QS.length}</p><h3>${esc(q)}</h3>
      <div class="choices">${opts.map(([v, label, col]) => `<button class="choice" data-v="${v}" aria-pressed="false"><span class="sw" style="background:${col}"></span>${esc(label)}</button>`).join('')}</div>`,
    mount: (card, d) => {
      card.querySelectorAll('.choice').forEach(b => {
        if (answers[key] === b.dataset.v) { b.setAttribute('aria-pressed', 'true'); d.unlock(); }
        b.onclick = () => {
          answers[key] = b.dataset.v;
          card.querySelectorAll('.choice').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          navigator.vibrate?.(10); d.unlock(); setTimeout(d.next, 260);
        };
      });
    },
  }));
  cards.push({
    html: `<p class="step">Last one</p><h3>Anything else he mentioned?</h3><label class="sr" for="checkNotes">Notes</label><textarea id="checkNotes" maxlength="1000" placeholder="Optional. e.g. dizzy getting out of bed twice"></textarea>`,
    mount: card => { const t = card.querySelector('textarea'); t.value = answers._notes || ''; t.oninput = () => { answers._notes = t.value; }; },
  });
  const d = deck($('#checkDeck'), cards, {
    onDone: async () => {
      const { _notes, ...a } = answers;
      if (Object.keys(a).length < QS.length) { toast('A question was skipped'); return; }
      const local = (a.chest !== 'none' || a.breath === 'at-rest') ? 'Act-now' : null;
      const r = await save('checkin', { answers: a, notes: _notes || '' });
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
const STAT_PICK = [
  [/calcium|agatston|\bcac\b/i, 'Calcium score', 'hot'],
  [/^(?!.*non).*\bldl\b/i, 'LDL cholesterol', 'hot'],
  [/non.?hdl/i, 'Non-HDL', 'warm'],
  [/total.*chol|chol.*total|^cholesterol/i, 'Total cholesterol', 'warm'],
  [/glucose|hba1c/i, 'Glucose', ''],
  [/egfr|gfr/i, 'Kidney (eGFR)', ''],
  [/trig/i, 'Triglycerides', ''],
  [/blood pressure|\bbp\b/i, 'Blood pressure', ''],
];

function statVal(r) {
  const m = String(r).trim().match(/^([<>]?\s*[\d.,/]+)\s*(.*)$/);
  return m ? `${esc(m[1])}<small>${esc(short(m[2], 10))}</small>` : esc(short(r, 12));
}
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; }

function buildRecord() {
  const el = $('#recordDeck');
  if (!canon) {
    deck(el, [{ html: `<p class="kicker">His record</p><h3>${session.sheetConfigured === false ? 'The family sheet is not connected yet' : 'Loading his record'}</h3><p class="soft">${session.sheetConfigured === false ? 'Once it is connected, his numbers, questions and history appear here.' : 'One moment.'}</p>` }]);
    return;
  }
  const tests = canon.testResults || [];
  const stats = [];
  for (const [re, label, cls] of STAT_PICK) {
    const hit = [...tests].reverse().find(t => re.test(t.test));
    if (hit && !stats.some(s => s.hit === hit)) stats.push({ hit, label, cls });
    if (stats.length === 6) break;
  }
  const cards = [];
  cards.push({
    html: `<p class="kicker">The numbers that matter</p>
      ${stats.length ? `<div class="stats">${stats.map(s => `<div class="stat ${s.cls}"><b>${statVal(s.hit.result)}</b><span>${esc(s.label)} · ${esc(s.hit.date)}</span></div>`).join('')}</div>` : '<p class="soft">No test results in the sheet yet.</p>'}
      <p class="meta">From the family sheet, synced ${esc(canon.serverTimeMelb || '')} Melbourne time.</p>`,
  });

  const last = (canon.checkins || []).slice(-1)[0];
  const concerns = (canon.notes || []).filter(n => /concern|symptom/i.test(n.tag)).slice(-3).reverse();
  cards.push({
    html: `<p class="kicker">Lately</p>
      <h3>${last ? `Last check-in: ${esc(last.verdict)}` : 'No check-ins yet'}</h3>
      ${last ? `<p class="meta">${esc(last.tsMelb)} · chest ${esc(last.chest)} · breath ${esc(last.breath)} · walking ${esc(last.walking)}</p>` : ''}
      ${concerns.length ? list(concerns.map(n => short(String(n.text).replace(/^CONCERN:\s*/i, '').split('\n')[0], 110))) : '<p class="soft">Concerns you raise in Ask are kept here.</p>'}`,
  });

  const openQs = (canon.questions || []).filter(q => q.status !== 'answered');
  chunk(openQs, 4).forEach((group, gi, all) => cards.push({
    html: `<p class="kicker">For the cardiologist ${all.length > 1 ? `(${gi + 1}/${all.length})` : ''}</p>
      <div style="display:grid;gap:.7em">${group.map(q => `<div class="qrow"><span>${esc(short(q.question, 140))}</span><button class="tick ${q.status === 'asked' ? 'done' : ''}" data-q="${esc(q.id)}" aria-label="Mark asked">${q.status === 'asked' ? 'Asked' : 'Ask'}</button></div>`).join('')}</div>`,
    mount: card => card.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => {
      const next = b.classList.contains('done') ? 'open' : 'asked';
      b.classList.toggle('done'); b.textContent = next === 'asked' ? 'Asked' : 'Ask';
      const q = canon.questions.find(x => x.id === b.dataset.q); if (q) q.status = next;
      await save('question', { id: b.dataset.q, status: next });
    }),
  }));

  const gaps = (canon.gaps || []).filter(g => g.status !== 'closed');
  chunk(gaps, 4).forEach((group, gi, all) => cards.push({
    html: `<p class="kicker">Still unknown ${all.length > 1 ? `(${gi + 1}/${all.length})` : ''}</p>${list(group.map(g => short(g.gap, 120) + (g.stepToClose ? ` → ${short(g.stepToClose, 70)}` : '')))}`,
  }));

  cards.push({
    html: `<p class="kicker">Share and settings</p>
      <h3>Brief for his doctor</h3>
      <p class="soft">One tap copies a clear summary: results, symptoms, check-ins and open questions. Paste it into a message or email.</p>
      <div class="card-actions"><button class="pill" data-brief>Copy the brief</button></div>
      <label class="meta" for="who">Your name, shown next to what you add</label>
      <input id="who" maxlength="40" placeholder="First name" style="min-height:48px;border-radius:14px;border:1.5px solid var(--line);background:var(--bg);padding:0 14px">
      <div class="card-actions" style="margin-top:auto"><button class="pill" data-out>Log out on this phone</button></div>`,
    mount: card => {
      const w = card.querySelector('#who'); w.value = store.get('who', ''); w.oninput = () => store.set('who', w.value.trim());
      card.querySelector('[data-brief]').onclick = shareBrief;
      card.querySelector('[data-out]').onclick = async () => { await fetch('/api/login', { method: 'DELETE' }); localStorage.clear(); location.reload(); };
    },
  });
  deck(el, cards);
}

function briefText() {
  const c = canon || {};
  const L = [];
  L.push('PATIENT SUMMARY (prepared by family, from his records and notes)');
  L.push('Generated ' + new Date().toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' }) + ' Melbourne time', '');
  const p = c.profile || {};
  ['Age', 'age', 'Sex', 'GP', 'gp'].forEach(k => p[k] && L.push(`${k}: ${p[k]}`));
  if ((c.conditions || []).length) { L.push('', 'CONDITIONS'); c.conditions.forEach(x => L.push(`- ${x.name} (${x.status})${x.notes ? ': ' + x.notes : ''}`)); }
  L.push('', 'MEDICATIONS'); (c.medications || []).length ? c.medications.forEach(m => L.push(`- ${m.name} ${m.dose} ${m.frequency} (${m.status})`)) : L.push('- none recorded');
  if ((c.testResults || []).length) { L.push('', 'RESULTS'); c.testResults.forEach(t => L.push(`- ${t.date} ${t.test}: ${t.result}`)); }
  const sym = (c.notes || []).filter(n => /concern|symptom/i.test(n.tag)).slice(-6);
  if (sym.length) { L.push('', 'SYMPTOMS AND CONCERNS REPORTED'); sym.forEach(n => L.push(`- ${String(n.tsUTC).slice(0, 10)}: ${String(n.text).replace(/\n?(URGENCY|ANSWER):.*$/gs, '').replace(/^CONCERN:\s*/i, '')}`)); }
  const ci = (c.checkins || []).slice(-5);
  if (ci.length) { L.push('', 'RECENT CHECK-INS'); ci.forEach(x => L.push(`- ${x.tsMelb}: chest ${x.chest}, breath ${x.breath}, walking ${x.walking}, energy ${x.energy}, tablets ${x.tablets}, mood ${x.mood} => ${x.verdict}${x.notes ? '. ' + x.notes : ''}`)); }
  const q = (c.questions || []).filter(x => x.status !== 'answered');
  if (q.length) { L.push('', 'QUESTIONS WE WOULD LIKE ANSWERED'); q.forEach((x, n) => L.push(`${n + 1}. ${x.question}`)); }
  return L.join('\n');
}
async function shareBrief() {
  const text = briefText();
  try {
    if (navigator.share) { await navigator.share({ title: 'Summary for his doctor', text }); return; }
    await navigator.clipboard.writeText(text); toast('Brief copied. Paste it into a message.');
  } catch (e) { if (e.name !== 'AbortError') toast('Could not copy on this browser'); }
}

boot();
