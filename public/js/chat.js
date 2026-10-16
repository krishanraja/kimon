// Ask Leffy: a chat with an animated heart helper. Talk, type, tap a
// suggested reply, or send a photo of a test result. Every message is
// answered from his record, the knowledge bank and the evidence corpus, and
// logged to the sheet; facts Leffy learns go into the knowledge bank.
import { triage, CONTACTS } from './triage.js';
import { createLeffy } from './leffy.js';
import { canRecord, startRecording, transcribeBlob, fmtTime } from './recorder.js';
import { pickPhoto, shrink } from './photo.js';
import { bank, bankItems, bankSize, forgetNote } from './knowledge-bank.js';
import { monitor } from './kimon-model.js';
import { fmtDate } from './metrics.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = s => esc(s).replace(/\b(vved\.org\.au)\b/g, '<a href="https://$1" target="_blank" rel="noopener">$1</a>')
  .replace(/\b(000|1300 60 60 24|1800 022 222)\b/g, m => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const LEVEL = { emergency: 'Emergency', urgent: 'Get seen today', soon: 'This week' };
const KEY = 'kimon.chat';

const ICON = {
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.6"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  compose: '<svg viewBox="0 0 24 24"><path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M5 9h3l4-4v14l-4-4H5z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
};

let ctx, el, head, chat, recording = null, asking = false;
const images = new WeakMap(); // photos kept in memory for a retry, never in storage

function load() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Array.isArray(c.msgs)) return c; } catch { /* fresh */ }
  return { id: newId(), msgs: [] };
}
function persist() {
  chat.msgs = chat.msgs.slice(-40);
  try { localStorage.setItem(KEY, JSON.stringify(chat)); }
  catch { chat.msgs.forEach(m => { delete m.thumb; }); try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch { /* full */ } }
}

const isKimon = () => ctx.role() === 'kimon';
const dad = () => isKimon() ? 'you' : 'Dad';

export function mountChat(root, context) {
  ctx = context; el = root; chat = load();
  // A reply still marked as coming from an earlier visit either gets
  // recovered (checkPending) or offers Try again; it never spins forever.
  let p = null; try { p = JSON.parse(localStorage.getItem('kimon.pendingAsk') || 'null'); } catch { /* none */ }
  chat.msgs.forEach(m => { if (m.pending && !(p && p.id === m.id && Date.now() - p.ts < 15 * 60000)) { m.pending = false; m.failed = true; } });
  el.innerHTML = `
    <header class="chat-head">
      <div class="lf-stage"><span class="lf-halo"></span><div id="lfHead"></div></div>
      <button class="chat-title" id="lfTitle" type="button" aria-label="What Leffy knows"><b>Leffy</b><span id="lfStatus" class="idle" aria-live="polite"></span></button>
      <button class="icon-btn" id="newChat" type="button" aria-label="Start a new chat">${ICON.compose}</button>
    </header>
    <div class="thread" id="thread" role="log" aria-label="Chat with Leffy"></div>
    <div class="dock">
      <div class="suggest" id="suggest" aria-label="Suggested replies"></div>
      <div id="chatFlag" class="flag" hidden></div>
      <form class="composer" id="composer" autocomplete="off">
        <button type="button" class="cbtn" id="camBtn" aria-label="Send a photo of a test result">${ICON.cam}</button>
        <div class="field">
          <label class="sr" for="msg">Message Leffy</label>
          <textarea id="msg" rows="1" maxlength="2000" placeholder="Message Leffy" enterkeyhint="send"></textarea>
          <div class="recbar" id="recbar" hidden><i class="recdot"></i><span id="recTime">0:00</span><span class="wave" id="wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><button type="button" class="rec-x" id="recCancel" aria-label="Cancel recording">${ICON.x}</button></div>
        </div>
        <button type="button" class="cbtn mic" id="micBtn" aria-label="Talk to Leffy">${ICON.mic}</button>
        <button type="submit" class="cbtn send" id="sendBtn" aria-label="Send" hidden>${ICON.send}</button>
      </form>
    </div>`;
  head = createLeffy($('#lfHead', el));
  wireComposer();
  $('#newChat', el).onclick = () => { if (asking) return; chat = { id: newId(), msgs: [] }; persist(); renderAll(); greet(true); };
  $('#lfTitle', el).onclick = bankSheet;
  renderAll();
  greet(!chat.msgs.length);
}

// The tab became visible: land on the newest message.
export function showChat() { if (el) { scrollDown(true); $('#msg', el).dispatchEvent(new Event('input')); } }

// Called when the record changes (new logs, facts, photos).
export function refreshChat() {
  if (!el) return;
  if (busy === null) status();
  if (!chat.msgs.length) renderSuggest();
}

/* ---------- rendering ---------- */
// One line under his name: what he is doing right now, or (when idle) how
// much he knows, which opens the knowledge bank.
let busy = null;
function knows() {
  const n = ctx.canon() ? bankSize(bank(ctx.canon())) : 0;
  return n ? `Knows ${n} thing${n === 1 ? '' : 's'} about ${isKimon() ? 'you' : 'Kimon'}` : 'Your heart helper';
}
function status(t) {
  busy = t || null;
  const s = $('#lfStatus', el);
  s.textContent = busy || knows();
  s.className = busy ? 'busy' : 'idle';
}

function greeting() {
  const k = isKimon();
  return k
    ? "Yia sou Kimon! I'm Leffy. I know your heart record and everything you've logged. Ask me anything, big or small."
    : "Yia sou! I'm Leffy. I know Kimon's record and everything the family has logged. What's on your mind about his heart?";
}

function greet(animate) {
  const g = $('[data-greet] .btext', el);
  if (!g) return;
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { g.textContent = greeting(); return; }
  // He says hello: the words type out while he talks.
  const words = greeting().split(' ');
  g.textContent = '';
  let i = 0;
  const tick = () => {
    if (!g.isConnected || i >= words.length) { head.done(); return; }
    g.textContent += (i ? ' ' : '') + words[i++]; head.speak();
    setTimeout(tick, 70);
  };
  setTimeout(tick, 250);
}

function avatar() { return '<div class="mini-lf" aria-hidden="true"><div></div></div>'; }
function mountMinis(scope) { scope.querySelectorAll('.mini-lf > div:empty').forEach(d => { createLeffy(d); d.classList.add('still'); }); }

function dayLine(ts, prev) {
  const d = new Date(ts), p = prev ? new Date(prev) : null;
  if (p && d - p < 3600000 && d.toDateString() === p.toDateString()) return '';
  const today = new Date().toDateString() === d.toDateString();
  return `<p class="when">${today ? 'Today' : esc(d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }))} ${esc(d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))}</p>`;
}

function list(items) { return `<ol class="blist">${items.map(t => `<li><span>${linkify(t)}</span></li>`).join('')}</ol>`; }

function leffyBody(m) {
  if (m.pending) {
    return `<div class="bubble typing"><span class="btext stream">${esc(m.text || '')}</span>${m.text ? '' : '<span class="dots"><i></i><i></i><i></i></span>'}</div>`;
  }
  if (m.failed) return `<div class="bubble failed"><span class="btext">That didn't come through. Your words are kept.</span><button class="pill" data-retry="${esc(m.id)}">Try again</button></div>`;
  const a = m.answer || { reply: m.text };
  const lvl = a.urgency;
  const c = CONTACTS[lvl];
  const hot = lvl === 'emergency' || lvl === 'urgent';
  return `<div class="bubble ${hot ? 'hot ' + lvl : ''}">
      ${LEVEL[lvl] ? `<span class="utag ${lvl}">${LEVEL[lvl]}</span>` : ''}
      <p class="btext">${linkify(a.reply || '')}</p>
      ${a.doNow?.length ? `<div class="bsec"><p class="bk">Do this</p>${list(a.doNow)}</div>` : ''}
      ${hot && c ? `<div class="bsec who"><p class="bk">${esc(c.title)}</p>${c.lines.map(l => `<p>${linkify(l)}</p>`).join('')}</div>` : ''}
    </div>
    ${a.results?.length ? resultsCard(m) : ''}
    ${m.answer ? `<div class="bmeta">
      ${a.watchFor?.length ? '<button data-more="watch">Watch for</button>' : ''}
      ${a.askTheDoctor?.length ? '<button data-more="doctor">Ask the doctor</button>' : ''}
      ${a.evidence?.length || a.limits ? '<button data-more="src">Sources</button>' : ''}
      <button data-say aria-label="Read aloud">${ICON.speaker}</button>
    </div><div class="bmore" hidden></div>` : ''}`;
}

function resultsCard(m) {
  const rows = m.answer.results;
  if (m.resultsSaved) return `<div class="rcard saved"><p>Saved ${m.resultsSaved} result${m.resultsSaved === 1 ? '' : 's'} to ${isKimon() ? 'your' : 'his'} record ✓</p></div>`;
  const fresh = rows.filter(r => !r.duplicate).length;
  return `<div class="rcard">
    <p class="bk">From the photo</p>
    ${rows.map((r, i) => `<label class="rrow ${r.duplicate ? 'dup' : ''}"><input type="checkbox" data-r="${i}" ${r.duplicate ? 'disabled' : 'checked'}><span><b>${esc(r.test)}</b> ${esc(r.result)}<small>${esc(fmtDate(r.date, { year: true }) || r.date)}${r.dateGuessed ? ' (no date on photo)' : ''}${r.lab ? ' · ' + esc(r.lab) : ''}${r.duplicate ? ' · already in the record' : ''}</small></span></label>`).join('')}
    ${fresh ? `<button class="btn primary" data-saveres>Save ${fresh} to ${isKimon() ? 'my' : 'his'} record</button>` : ''}
    <p class="meta">Check them against the paper first. The photo itself is not kept.</p>
  </div>`;
}

function msgHtml(m, prev) {
  const when = dayLine(m.ts, prev?.ts);
  if (m.role === 'note') return `${when}<p class="sys">${esc(m.text)}</p>`;
  if (m.role === 'user') {
    return `${when}<div class="cm me" data-id="${esc(m.id)}">${m.thumb ? `<img class="mphoto" src="${m.thumb}" alt="Photo sent to Leffy">` : m.photo ? '<p class="bubble">📷 Photo</p>' : ''}${m.text && !m.auto ? `<p class="bubble">${esc(m.text)}</p>` : ''}</div>`;
  }
  return `${when}<div class="cm bot" data-id="${esc(m.id)}">${avatar()}<div class="mcol">${leffyBody(m)}</div></div>`;
}

function renderAll() {
  const t = $('#thread', el);
  t.innerHTML = `<div class="cm bot" data-greet>${avatar()}<div class="mcol"><div class="bubble"><p class="btext">${esc(greeting())}</p></div></div></div>`
    + chat.msgs.map((m, i) => msgHtml(m, chat.msgs[i - 1])).join('');
  mountMinis(t);
  t.querySelectorAll('.cm.bot[data-id]').forEach(n => wireMsg(n));
  renderSuggest();
  scrollDown(true);
  refreshChat();
}

function updateMsg(m) {
  const n = $(`.cm[data-id="${m.id}"]`, el);
  if (!n) { renderAll(); return; }
  const col = n.querySelector('.mcol');
  col.innerHTML = leffyBody(m);
  wireMsg(n);
}

function appendMsg(m, quiet = false) {
  const t = $('#thread', el);
  t.insertAdjacentHTML('beforeend', msgHtml(m, chat.msgs[chat.msgs.indexOf(m) - 1]));
  mountMinis(t);
  const n = t.lastElementChild;
  if (n?.classList.contains('bot')) wireMsg(n);
  if (!quiet) scrollDown(true);
}

// Keep a reply in view while it is written: follow it down until it fills
// the screen, then hold its first line at the top so it reads from the start.
function follow(m) {
  const t = $('#thread', el), n = $(`.cm[data-id="${m.id}"]`, el);
  if (!t || !n) return;
  const top = n.getBoundingClientRect().top - t.getBoundingClientRect().top + t.scrollTop - 8;
  t.scrollTop = n.offsetHeight > t.clientHeight - 16 ? top : t.scrollHeight;
}
// After layout settles (the reply pills change the thread's height).
const followSoon = m => requestAnimationFrame(() => requestAnimationFrame(() => follow(m)));

function scrollDown(force) {
  const t = $('#thread', el);
  const near = t.scrollHeight - t.scrollTop - t.clientHeight < 160;
  if (force || near) requestAnimationFrame(() => t.scrollTo({ top: t.scrollHeight, behavior: force ? 'auto' : 'smooth' }));
}

function wireMsg(n) {
  const m = chat.msgs.find(x => x.id === n.dataset.id);
  if (!m) return;
  n.querySelector('[data-retry]')?.addEventListener('click', () => retry(m));
  n.querySelector('[data-say]')?.addEventListener('click', () => say(m.answer.reply));
  n.querySelectorAll('[data-more]').forEach(b => b.onclick = () => {
    const box = n.querySelector('.bmore'), kind = b.dataset.more, open = b.getAttribute('aria-expanded') === 'true';
    n.querySelectorAll('[data-more]').forEach(x => x.setAttribute('aria-expanded', 'false'));
    if (open) { box.hidden = true; return; }
    b.setAttribute('aria-expanded', 'true');
    box.innerHTML = moreHtml(m.answer, kind); box.hidden = false;
    box.querySelector('[data-addq]')?.addEventListener('click', ev => addQuestions(m.answer.askTheDoctor, ev.target));
    scrollDown();
  });
  const save = n.querySelector('[data-saveres]');
  if (save) save.onclick = () => saveResults(m, n);
}

function moreHtml(a, kind) {
  if (kind === 'watch') return `<p class="bk">Watch for</p>${list(a.watchFor)}`;
  if (kind === 'doctor') return `<p class="bk">Ask the doctor</p>${list(a.askTheDoctor)}<button class="pill" data-addq>Add to ${isKimon() ? 'my' : 'his'} questions</button>`;
  return `<p class="bk">Where this comes from</p>
    ${a.evidence?.length ? `<ul class="srcs">${a.evidence.map(e => `<li>${esc(e.point)}${e.url ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(String(e.title || 'source').split(/[-|:]/)[0].trim().slice(0, 48))}</a>` : ' <small>general medical knowledge</small>'}</li>`).join('')}</ul>` : ''}
    ${a.usedFromRecord?.length ? `<p class="meta">From the record: ${esc(a.usedFromRecord.join(' · '))}</p>` : ''}
    ${a.limits ? `<p class="meta">${esc(a.limits)}</p>` : ''}`;
}

/* ---------- suggestions ---------- */
function starters() {
  const canon = ctx.canon() || {};
  const out = [];
  if (!isKimon()) {
    const m = monitor(canon);
    const recent = m.logs[0];
    if (recent && Date.now() - new Date(recent.ts).getTime() < 3 * 86400000) out.push(`Dad logged: ${recent.summary.replace(/^SYMPTOM:\s*/, '').split(',')[0]}. What should we do?`);
    out.push('What does his calcium score mean?', 'What should we ask the cardiologist?', 'Is it safe for him to exercise?');
  } else {
    out.push('I felt dizzy standing up', 'What does my calcium score mean?', 'Can I still go for my walks?');
  }
  return out.slice(0, 3);
}

function renderSuggest() {
  const box = $('#suggest', el);
  if (asking || recording) { box.innerHTML = ''; return; }
  const last = [...chat.msgs].reverse().find(m => m.role !== 'note');
  let pills;
  if (!last) pills = starters();
  else if (last.role === 'leffy' && last.answer) pills = (last.answer.replies?.length ? last.answer.replies : ['Tell me more', 'What should we do next?']).slice(0, 3);
  else pills = [];
  box.innerHTML = pills.map(p => `<button type="button" class="spill" data-pill>${esc(p)}</button>`).join('')
    + (!last ? `<button type="button" class="spill photo" data-photo>${ICON.cam}<span>Read a test result</span></button>` : '');
  // One row that scrolls sideways; a soft edge shows when there is more.
  const edge = () => box.classList.toggle('more', box.scrollLeft + box.clientWidth < box.scrollWidth - 4);
  box.scrollLeft = 0; box.onscroll = edge; requestAnimationFrame(edge);
  const unsaved = last?.role === 'leffy' && last.answer?.results?.some(r => !r.duplicate) && !last.resultsSaved ? last : null;
  box.querySelectorAll('[data-pill]').forEach(b => b.onclick = () => {
    navigator.vibrate?.(8);
    // "Yes, save them" after a photo means the Save button, not a new message.
    if (unsaved && /^(yes|ok|okay|sure)\b.*\bsave|^save\b/i.test(b.textContent)) { const n = $(`.cm[data-id="${unsaved.id}"]`, el); if (n) return saveResults(unsaved, n); }
    send(b.textContent);
  });
  box.querySelector('[data-photo]')?.addEventListener('click', () => photo());
}

/* ---------- composer ---------- */
function wireComposer() {
  const ta = $('#msg', el), form = $('#composer', el);
  const sync = () => {
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 132) + 'px';
    const has = ta.value.trim().length > 0;
    $('#sendBtn', el).hidden = !has; $('#micBtn', el).hidden = has;
    flag(ta.value);
    try { localStorage.setItem('kimon.chatDraft', ta.value); } catch { /* private mode */ }
  };
  ta.value = localStorage.getItem('kimon.chatDraft') || '';
  ta.addEventListener('input', sync);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); const t = ta.value.trim(); if (t) send(t); });
  $('#micBtn', el).onclick = () => recording ? stopRec(true) : startRec();
  $('#recCancel', el).onclick = () => stopRec(false);
  $('#camBtn', el).onclick = () => photo();
  sync();
}

function flag(text, keep) {
  const f = $('#chatFlag', el);
  const { level, reasons } = triage(text);
  if (level === 'routine') { if (!keep) f.hidden = true; return level; }
  const c = CONTACTS[level];
  f.className = 'flag ' + level;
  f.innerHTML = `<b>${esc(c.title)}.</b> ${esc(reasons[0] || '')}${level === 'emergency' ? '. ' + linkify(c.lines[isKimon() ? 0 : 1]) : ''}`;
  f.hidden = false;
  return level;
}

async function startRec() {
  if (!canRecord()) {
    // Browser recogniser fallback: fills the box as you speak.
    const ta = $('#msg', el), base = ta.value ? ta.value.trim() + ' ' : '';
    const stop = ctx.listen(t => { ta.value = base + t; ta.dispatchEvent(new Event('input')); }, on => { head.set(on === true ? 'listening' : 'idle'); $('#micBtn', el).setAttribute('aria-pressed', String(on === true)); if (on === false) recording = null; });
    if (stop) recording = { stop };
    return;
  }
  let h;
  const bars = [...el.querySelectorAll('#wave i')];
  try {
    h = await startRecording({
      onLevel: v => bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(.15, Math.min(1, v * (0.6 + ((i * 37) % 7) / 10)))})`; }),
      onAutoStop: () => stopRec(true),
    });
  } catch (e) {
    ctx.toast(e?.name === 'NotAllowedError' ? 'Microphone blocked. Allow it in settings, or type.' : 'Could not start the microphone. Type instead.', 4000);
    return;
  }
  recording = h;
  navigator.vibrate?.(15);
  el.classList.add('recording');
  $('#recbar', el).hidden = false; $('#msg', el).hidden = true;
  $('#micBtn', el).innerHTML = ICON.stop; $('#micBtn', el).setAttribute('aria-label', 'Stop and write it down');
  $('#suggest', el).innerHTML = '';
  head.set('listening'); status('Listening');
  const timer = setInterval(() => { if (recording === h) $('#recTime', el).textContent = fmtTime(h.elapsed()); else clearInterval(timer); }, 250);
}

async function stopRec(keep) {
  const h = recording; recording = null;
  if (!h) return;
  if (h.stop && !h.elapsed) { h.stop(); return; } // browser recogniser
  el.classList.remove('recording');
  $('#recbar', el).hidden = true; $('#msg', el).hidden = false; $('#recTime', el).textContent = '0:00';
  const mic = $('#micBtn', el); mic.innerHTML = ICON.mic; mic.setAttribute('aria-label', 'Talk to Leffy');
  if (!keep) { h.stop(); head.set('idle'); status(); renderSuggest(); return; }
  head.set('thinking'); status('Writing down what you said');
  mic.disabled = true;
  try {
    const blob = await h.stop();
    if (h.silent()) ctx.toast("I didn't hear anything. Try again, closer to the phone.", 3500);
    else {
      const text = await transcribeBlob(blob);
      if (text) { const ta = $('#msg', el); ta.value = (ta.value ? ta.value.trim() + ' ' : '') + text; ta.dispatchEvent(new Event('input')); }
      else ctx.toast("Didn't catch that. Try again.");
    }
  } catch { ctx.toast("Couldn't turn that into words. Try again, or type.", 3500); }
  mic.disabled = false;
  head.set('idle'); status(); renderSuggest();
}

/* ---------- sending ---------- */
export function sendToChat(text) { if (text) send(text); }

async function send(text, image = null) {
  if (asking) { ctx.toast('Leffy is still answering'); return; }
  const ta = $('#msg', el);
  ta.value = ''; ta.dispatchEvent(new Event('input'));
  const user = { id: newId(), role: 'user', text, ts: Date.now(), ...(image ? { thumb: image.thumb, photo: true, auto: !image.typed } : {}) };
  chat.msgs.push(user); appendMsg(user);
  const level = flag(text, false);
  const m = { id: newId(), role: 'leffy', text: '', ts: Date.now(), pending: true, rid: newId(), ask: text };
  if (image) images.set(m, image);
  chat.msgs.push(m); appendMsg(m); persist();
  await ask(m, image, level);
}

async function ask(m, image, level) {
  asking = true; renderSuggest();
  head.set('thinking'); status(image ? 'Looking at the photo' : 'Thinking');
  try { localStorage.setItem('kimon.pendingAsk', JSON.stringify({ rid: m.rid, id: m.id, ts: Date.now() })); } catch { /* private mode */ }
  keepAwake(true);
  const thread = chat.msgs.filter(x => x !== m && (x.role === 'user' || (x.role === 'leffy' && x.answer))).slice(-13, -1)
    .map(x => ({ role: x.role, text: x.role === 'user' ? (x.photo ? '[photo] ' : '') + x.text : x.answer.reply }));
  let res = null;
  const body = { message: m.ask, thread, rid: m.rid, threadId: chat.id, by: ctx.who(), ...(image ? { image: { data: image.data, type: image.type } } : {}) };
  const onDelta = d => { m.text += d; const s = $(`.cm[data-id="${m.id}"] .stream`, el); if (s) { s.textContent = m.text; s.parentElement.querySelector('.dots')?.remove(); } else updateMsg(m); head.speak(); status('Typing'); follow(m); };
  const onLearned = ev => {
    if (!ev.facts?.length) return;
    const note = { id: newId(), role: 'note', ts: Date.now(), text: `Leffy will remember: ${ev.facts.map(f => f.fact).join(' · ')}` };
    chat.msgs.push(note); appendMsg(note, true); persist();
    ctx.reload?.();
  };
  try {
    res = await streamAsk(body, t => status(t), onDelta, onLearned);
  } catch (e) {
    if (e.status === 401) { asking = false; keepAwake(false); return; }
    if (/^HTTP 5/.test(e.message) && !m.text) { status('Trying again'); try { res = await streamAsk(body, t => status(t), onDelta, onLearned); } catch { /* recover below */ } }
    if (!res) { status('Getting your answer'); res = await recoverAnswer(m.rid); }
  }
  keepAwake(false);
  asking = false;
  try { localStorage.removeItem('kimon.pendingAsk'); } catch { /* private mode */ }
  if (res) finish(m, res);
  else {
    m.pending = false; m.failed = true; updateMsg(m); persist(); followSoon(m);
    head.set('idle'); status();
    if (level === 'emergency') ctx.toast('No connection. If this is happening now: call 000.', 6000);
    renderSuggest();
  }
}

function finish(m, res) {
  m.pending = false; m.failed = false; m.answer = res.answer; m.text = res.answer.reply; m.saved = res.saved;
  updateMsg(m); persist();
  if (head.state !== 'speaking') head.done(); else setTimeout(() => head.done(), 500);
  status(res.source?.kind === 'rules' ? 'Offline answer' : res.saved ? 'Saved to the record' : null);
  setTimeout(() => { if (!asking && !recording) status(); }, 3000);
  // The reply now carries the verdict and who to call, right where it is read.
  $('#chatFlag', el).hidden = true;
  renderSuggest();
  followSoon(m);
  if (res.saved) ctx.reload?.();
}

function retry(m) {
  if (asking) return;
  m.failed = false; m.pending = true; m.text = ''; m.rid = newId();
  updateMsg(m); scrollDown(true); ask(m, images.get(m) || null, triage(m.ask).level);
}

async function streamAsk(body, onStage, onDelta, onLearned) {
  const r = await fetch('/api/ask', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(190000),
  });
  if (r.status === 401) { ctx.showLogin(); throw Object.assign(new Error('login required'), { status: 401 }); }
  if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', answer = null;
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
      else if (ev.type === 'delta') onDelta(ev.text);
      else if (ev.type === 'answer') answer = ev;
      else if (ev.type === 'learned') onLearned(ev);
      else if (ev.type === 'error') throw new Error(ev.error);
    }
  }
  if (answer) return answer;
  throw new Error('connection closed before the answer');
}

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

// Back on the app after switching away: collect a reply that finished meanwhile.
export async function checkPending() {
  let p; try { p = JSON.parse(localStorage.getItem('kimon.pendingAsk') || 'null'); } catch { p = null; }
  if (!p || asking || Date.now() - p.ts > 15 * 60000) return;
  const m = chat.msgs.find(x => x.id === p.id);
  const res = await recoverAnswer(p.rid, 2);
  if (asking || !m) return;
  try { localStorage.removeItem('kimon.pendingAsk'); } catch { /* private mode */ }
  if (res) finish(m, res);
  else if (m.pending) { m.pending = false; m.failed = true; updateMsg(m); persist(); head.set('idle'); renderSuggest(); }
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

/* ---------- photo ---------- */
export function photoToChat() { photo(); }
async function photo() {
  if (asking) { ctx.toast('Leffy is still answering'); return; }
  const file = await pickPhoto();
  if (!file) return;
  let img;
  try { img = await shrink(file); } catch { ctx.toast("Couldn't open that photo. Try another."); return; }
  const typed = $('#msg', el).value.trim();
  img.typed = Boolean(typed);
  send(typed || `Here's a photo of ${isKimon() ? 'my' : "Dad's"} test result. What does it show?`, img);
}

async function saveResults(m, n) {
  const picks = [...n.querySelectorAll('[data-r]')].filter(c => c.checked && !c.disabled).map(c => m.answer.results[+c.dataset.r]);
  if (!picks.length) { ctx.toast('Tick the results to save'); return; }
  const btn = n.querySelector('[data-saveres]'); btn.disabled = true; btn.textContent = 'Saving';
  let ok = 0;
  for (const r of picks) {
    const out = await ctx.save('testResult', { date: r.date, test: r.test, result: r.result, lab: r.lab, notes: r.notes });
    if (out.ok) ok++;
  }
  m.resultsSaved = picks.length; persist(); updateMsg(m);
  ctx.toast(ok === picks.length ? 'Saved to the record' : 'Saved on this phone, will sync');
  ctx.reload?.();
}

async function addQuestions(qs, btn) {
  btn.disabled = true; btn.textContent = 'Adding';
  let ok = true;
  for (const q of qs) ok = (await ctx.save('question', { question: q, askWhom: 'GP or cardiologist', priority: '2' })).ok && ok;
  btn.textContent = ok ? 'Added to the record ✓' : 'Will save when online';
  ctx.reload?.();
}

/* ---------- read aloud ---------- */
function say(text) {
  if (!('speechSynthesis' in window)) { ctx.toast('Reading aloud is not available here'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'en-AU'; u.rate = .98;
  u.onstart = () => { head.speak(); status('Talking'); };
  u.onboundary = () => head.speak();
  u.onend = u.onerror = () => { head.done(); status(); };
  speechSynthesis.speak(u);
  head.speak();
}
export function stopSpeaking() { try { speechSynthesis.cancel(); } catch { /* none */ } }

/* ---------- what Leffy knows ---------- */
function bankSheet() {
  ctx.openSheet('<div class="bank"></div>', (sheet, close) => {
    const draw = () => {
      const canon = ctx.canon();
      const b = canon ? bank(canon) : null;
      const groups = b ? bankItems(b) : [];
      sheet.querySelector('.bank').innerHTML = `
        <div class="bank-top"><div class="bank-lf" aria-hidden="true"></div><div><p class="kicker">What Leffy knows</p>
        <h3 class="sheet-title">${groups.length ? `${bankSize(b)} things about ${isKimon() ? 'you' : 'Kimon'}` : 'Nothing logged yet'}</h3></div></div>
        <p class="soft">Built from every log, check-in, photo and chat since ${b?.since ? esc(fmtDate(b.since, { year: true })) : 'the start'}. It gets sharper with each one.</p>
        <div class="bank-list">${groups.map(g => `<section><p class="kicker">${esc(g.title)}${g.learned ? ' <small>learned in chats</small>' : ''}</p><ul>${g.items.map(i => `<li>${g.learned ? `<span>${esc(i)}</span><button class="forget" data-forget="${esc(i)}" data-topic="${esc(g.topic)}" aria-label="Forget this">Forget</button>` : esc(i)}</li>`).join('')}</ul></section>`).join('')}</div>
        <button class="btn primary" data-done>Done</button>`;
      createLeffy(sheet.querySelector('.bank-lf'));
      sheet.querySelector('[data-done]').onclick = close;
      sheet.querySelectorAll('[data-forget]').forEach(btn => btn.onclick = async () => {
        const n = forgetNote(btn.dataset.forget, btn.dataset.topic);
        const canon = ctx.canon();
        (canon.notes || (canon.notes = [])).push({ tsUTC: new Date().toISOString(), by: ctx.who(), ...n });
        draw(); refreshChat();
        const r = await ctx.save('note', n);
        ctx.toast(r.ok ? 'Leffy has forgotten that' : 'Saved on this phone, will sync');
      });
    };
    draw();
  });
}
