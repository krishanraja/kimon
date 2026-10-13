// Kimon's own app: one small thing a day, log a symptom any time, a weekly
// body check, and talking to the family. Everything is shared with family.
import { CONTACTS } from './triage.js';
import { canRecord, startRecording, transcribeBlob, fmtTime } from './recorder.js';
import { SYMPTOMS, WHEN, SEVERITY, BODY_CHECK, TAGS, readPlan, todaysHabit, symptomLevel, checkLevel, noteText, melbDay, pendingNudge } from './kimon-model.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#me');
const store = {
  get(k, d) { try { const v = localStorage.getItem('kimon.me.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kimon.me.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let canon = store.get('canon', null);
let toastT;
function toast(m, ms = 3200) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- data ---------- */
async function load() {
  try {
    const r = await fetch('/api/canon', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    if (r.status === 401) return location.replace('/');
    if (r.ok) { canon = await r.json(); store.set('canon', canon); }
  } catch { /* offline: use the saved copy */ }
}
// Writes never get lost: failures wait in a queue and retry next time.
async function save(action, payload) {
  const item = { action, payload };
  try {
    const r = await fetch('/api/write', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item), signal: AbortSignal.timeout(15000) });
    if (r.status === 401) { location.replace('/'); return false; }
    if (!r.ok) throw new Error();
    return true;
  } catch {
    const q = store.get('queue', []); q.push(item); store.set('queue', q); return false;
  }
}
async function flush() {
  const q = store.get('queue', []); if (!q.length) return;
  const left = [];
  for (const it of q) { try { const r = await fetch('/api/write', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(it) }); if (!r.ok) left.push(it); } catch { left.push(it); } }
  store.set('queue', left);
}
// Add a note locally straight away so the screen reflects it, then save.
function addNote(tag, summary, data) {
  const text = data ? noteText(summary, data) : summary;
  (canon.notes || (canon.notes = [])).push({ tsUTC: new Date().toISOString(), by: 'Kimon', tag, text });
  store.set('canon', canon);
  return save('note', { text, tag });
}

/* ---------- voice ---------- */
// A mic button that fills a text box with what he says.
function wireMic(btn, ta) {
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
      else { const text = await transcribeBlob(blob); if (text) { ta.value = (ta.value ? ta.value.trim() + ' ' : '') + text; ta.dispatchEvent(new Event('input')); } }
    } catch { toast("Couldn't hear that. Try again, or type."); }
    delete btn.dataset.busy; label('Speak');
  };
}
const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

/* ---------- screens ---------- */
function fit() {
  const box = root.querySelector('.fit'); if (!box) return;
  let fs = 21; box.style.setProperty('--fs', fs + 'px');
  while (box.scrollHeight > box.clientHeight + 1 && fs > 15) { fs -= .5; box.style.setProperty('--fs', fs + 'px'); }
}
function show(html, mount) { root.innerHTML = html; mount?.(); requestAnimationFrame(fit); }
addEventListener('resize', () => requestAnimationFrame(fit));
const back = '<button class="me-back" data-home>‹ Back</button>';

function today() {
  const plan = readPlan(canon?.profile);
  const habit = todaysHabit(plan);
  const day = melbDay(new Date());
  const notes = canon?.notes || [];
  const doneToday = notes.some(n => n.tag === TAGS.habit && melbDay(n.tsUTC) === day);
  const medsToday = notes.some(n => n.tag === TAGS.meds && melbDay(n.tsUTC) === day);
  const lastCheck = notes.filter(n => n.tag === TAGS.check).map(n => n.tsUTC).sort().pop();
  const checkDue = !lastCheck || Date.now() - new Date(lastCheck).getTime() > 6 * 86400000;
  const nudge = canon ? pendingNudge(canon) : null;
  const date = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Australia/Melbourne' });
  const meds = plan.meds.filter(m => m.name);

  show(`<div class="fit me-today">
    <div class="hello"><h1>Hi Kimon</h1><p>${esc(date)}</p></div>
    ${nudge ? `<section class="kc nudge"><p><span class="heart">♥</span> <b>${esc(/^(app|)$/i.test(nudge.from) ? 'Family' : nudge.from)}:</b> ${esc(nudge.text)}</p><button class="kb small" data-seen>Thanks ♥</button></section>` : ''}
    ${habit ? `<section class="kc one"><p class="kicker">Today's one thing</p><h2>${esc(habit)}</h2>
      ${doneToday ? '<p class="done-line">Done today. Nice work ✓</p>' : '<div class="kbtns"><button class="kb done" data-habit="1">Done ✓</button><button class="kb skip" data-habit="0">Not today</button></div>'}</section>` : ''}
    ${meds.length ? `<section class="kc row-card"><div><p class="kicker">Tablets</p><p class="big">${esc(meds.map(m => `${m.name}${m.when ? ' (' + m.when + ')' : ''}`).join(', '))}</p></div>
      ${medsToday ? '<span class="tick">Taken ✓</span>' : '<button class="kb go small" data-meds>Taken ✓</button>'}</section>` : ''}
    <button class="kc log-btn" data-log><span class="plus">+</span><span><b>Log a symptom</b><small>Any time something doesn't feel right</small></span></button>
    ${checkDue
      ? `<section class="kc row-card"><div><p class="kicker">Weekly body check</p><p class="big">How has your body been? 5 taps.</p></div><button class="kb go small" data-check>Start</button></section>`
      : `<section class="kc row-card"><p class="big">Body check done this week ✓</p></section>`}
    <button class="kc talk" data-talk><span class="mic">${MIC}</span><span><b>Tell the family</b><small>Tap and talk. How you're going.</small></span></button>
  </div>`, () => {
    root.querySelectorAll('[data-habit]').forEach(b => b.onclick = async () => {
      const done = b.dataset.habit === '1';
      await addNote(TAGS.habit, `HABIT: ${habit} ${done ? 'done' : 'skipped'}`, { habit, done });
      toast(done ? 'Brilliant. Your family will see that ♥' : "That's okay. Tomorrow is another day."); today();
    });
    $('[data-meds]')?.addEventListener('click', async () => { await addNote(TAGS.meds, 'MEDS: taken', { meds: meds.map(m => m.name) }); toast('Noted ✓'); today(); });
    $('[data-seen]')?.addEventListener('click', async () => { await addNote(TAGS.seen, 'Seen the nudge ♥'); today(); });
    $('[data-log]').onclick = () => logSymptom();
    $('[data-check]')?.addEventListener('click', () => bodyCheck());
    $('[data-talk]').onclick = () => talk();
  });
}

function logSymptom() {
  const log = {};
  const step1 = () => show(`<div class="fit me-step">${back}<h1>What's happening?</h1>
    <div class="tiles2">${SYMPTOMS.map(s => `<button class="tile2" data-s="${s.id}">${esc(s.label)}</button>`).join('')}</div></div>`, () => {
    $('[data-home]').onclick = today;
    root.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { log.symptom = b.dataset.s; step2(); });
  });
  const step2 = () => show(`<div class="fit me-step">${back}<p class="kicker">${esc(SYMPTOMS.find(s => s.id === log.symptom).label)}</p><h1>When?</h1>
    <div class="opts">${WHEN.map(([v, l]) => `<button class="o" data-w="${v}">${l}</button>`).join('')}</div></div>`, () => {
    $('[data-home]').onclick = step1;
    root.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { log.when = b.dataset.w; step3(); });
  });
  const step3 = () => show(`<div class="fit me-step">${back}<p class="kicker">${esc(SYMPTOMS.find(s => s.id === log.symptom).label)}</p><h1>How bad?</h1>
    <div class="opts">${SEVERITY.map(([v, l], i) => `<button class="o" data-v="${v}"><span class="sw" style="background:${['var(--routine)', 'var(--urgent)', 'var(--emergency)'][i]}"></span>${l}</button>`).join('')}</div></div>`, () => {
    $('[data-home]').onclick = step2;
    root.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { log.severity = b.dataset.v; step4(); });
  });
  const step4 = () => show(`<div class="fit me-step">${back}<h1>Anything else to add?</h1>
    <p class="soft">What were you doing? How long did it last? Optional.</p>
    <textarea id="note" maxlength="1000" placeholder="e.g. walking up the hill to the shops, lasted a minute"></textarea>
    <div class="row"><button class="micbtn" data-mic aria-pressed="false">${MIC}<span>Speak</span></button><button class="kb go" data-save>Save</button></div></div>`, () => {
    $('[data-home]').onclick = step3;
    const ta = $('#note'); wireMic($('[data-mic]'), ta);
    $('[data-save]').onclick = async () => {
      log.note = ta.value.trim();
      log.level = symptomLevel(log);
      const s = SYMPTOMS.find(x => x.id === log.symptom);
      const w = WHEN.find(x => x[0] === log.when)[1], sev = SEVERITY.find(x => x[0] === log.severity)[1];
      const ok = await addNote(TAGS.symptom, `SYMPTOM: ${s.label}, ${w.toLowerCase()}, ${sev.toLowerCase()}${log.note ? '. ' + log.note : ''}`, log);
      result(log.level, ok, 'Saved. Your family can see it.');
    };
  });
  step1();
}

// What to do next, for him in Melbourne (he can dial these numbers).
function result(level, ok, savedLine) {
  const msg = {
    emergency: ['Call 000 now', 'Ask for an ambulance. Sit or lie down and stop what you are doing. Unlock the front door. Do not drive.'],
    urgent: ['Get checked today', 'Call your GP for a same-day appointment, or the free Virtual ED video doctor. If it gets worse, call 000.'],
    soon: ['Thanks for telling us', 'Mention it to your GP this week. Your family will keep an eye on it too.'],
    routine: ['Thanks, all noted', 'Nothing worrying in that. Keep going.'],
  }[level];
  const buttons = level === 'emergency'
    ? '<a class="kb sos" href="tel:000">Call 000</a>'
    : level === 'urgent'
      ? '<a class="kb sos" href="https://www.vved.org.au" target="_blank" rel="noopener">Virtual ED</a><a class="kb go" href="tel:1300606024">Nurse on call</a>'
      : '';
  show(`<div class="fit me-step"><section class="kc level ${level}">
    <h1>${msg[0]}</h1><p>${msg[1]}</p>${buttons ? `<div class="kbtns">${buttons}</div>` : ''}
    <p class="meta">${ok ? savedLine : 'Saved on this phone. It will send when you are online.'}</p></section>
    <button class="kb go" data-home>Back to today</button></div>`, () => { $('[data-home]').onclick = today; });
}

function bodyCheck() {
  const answers = {}; let i = 0;
  const step = () => {
    const q = BODY_CHECK[i];
    show(`<div class="fit me-step">
      <div class="top"><button class="me-back" data-prev>‹ Back</button><span>Question ${i + 1} of ${BODY_CHECK.length}</span></div>
      <div class="bar">${BODY_CHECK.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
      <p class="soft">In the last 7 days…</p><h1>${esc(q.q)}</h1>
      <div class="opts">${q.opts.map(([v, l, sc]) => `<button class="o" data-a="${v}"><span class="sw" style="background:${['var(--routine)', 'var(--urgent)', 'var(--emergency)'][sc]}"></span>${esc(l)}</button>`).join('')}<button class="o unsure" data-a="unsure">Not sure</button></div>
      <div class="why drop"><b>Why we ask</b>${esc(q.why)}</div></div>`, () => {
      $('[data-prev]').onclick = () => { if (i === 0) today(); else { i--; step(); } };
      root.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
        answers[q.id] = b.dataset.a; navigator.vibrate?.(10);
        if (++i < BODY_CHECK.length) return step();
        const level = checkLevel(answers);
        const text = BODY_CHECK.map(x => `${x.id}: ${(x.opts.find(o => o[0] === answers[x.id]) || [, 'not sure'])[1].toLowerCase()}`).join('; ');
        const ok = await addNote(TAGS.check, `BODY CHECK: ${text}`, { answers, level });
        result(level, ok, 'Thank you for being straight with us. Your family can see this.');
      });
    });
  };
  step();
}

function talk() {
  show(`<div class="fit me-step">${back}<h1>Tell the family</h1>
    <p class="soft">How you're going, something you noticed, or just hello.</p>
    <textarea id="said" maxlength="2000" placeholder="Tap Speak, or type"></textarea>
    <div class="row"><button class="micbtn" data-mic aria-pressed="false">${MIC}<span>Speak</span></button><button class="kb go" data-send>Send</button></div></div>`, () => {
    $('[data-home]').onclick = today;
    const ta = $('#said'); wireMic($('[data-mic]'), ta);
    $('[data-send]').onclick = async () => {
      const text = ta.value.trim(); if (!text) { toast('Say or type something first'); return; }
      const ok = await addNote(TAGS.talk, `KIMON SAYS: ${text}`);
      toast(ok ? 'Sent to the family ♥' : 'Saved. It will send when you are online.'); today();
    };
  });
}

/* ---------- boot ---------- */
(async () => {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return location.replace('/');
  } catch { if (!canon) return location.replace('/'); }
  if (canon) today();
  await flush(); await load();
  if (!canon) canon = { notes: [], profile: {} };
  // Refresh the home screen, but never pull him out of something he's doing.
  if (root.querySelector('.me-today, .me-loading')) today();
})();
