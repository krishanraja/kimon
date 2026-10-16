// His record: a hub (where things are, what's next) with one-screen spokes.
// Everything the user sees is derived from the sheet canon; nothing is mocked.
import { extract, resultCards, situation, fmtDate, daysUntil, STAGES, LIPID_EXTRAS, REF_URLS } from './metrics.js';
import { plainTask, taskGroup, taskHow, taskStatus, groupsFor, historyEvents } from './record-model.js';

let ctx, root, view = 'home', resultIdx = 0, todoGroup = null, qPage = 0, hPage = 0;

export function mountRecord(el, context) { root = el; ctx = context; render(); }
const him = () => ctx.me?.().him || 'Kimon';
export function refreshRecord() { if (root) render(); }
export function recordHome() { view = 'home'; if (root) render(); }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = v => (Math.round(v * 10) / 10).toString();
const BACK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>';

function render() {
  const canon = ctx.canon();
  if (!canon) {
    root.innerHTML = `<div class="rec-empty"><p class="kicker">His record</p><h3>${ctx.session().sheetConfigured === false ? 'The family sheet is not connected yet' : 'Loading his record'}</h3></div>`;
    return;
  }
  ({ home, results: resultsView, todo: todoView, questions: questionsView, history: historyView }[view] || home)(canon);
  requestAnimationFrame(() => root.querySelectorAll('.fit').forEach(ctx.fit));
}

function go(v) { view = v; render(); }

/* ---------------- derived state ---------------- */
function stageOf(canon) {
  const p = canon.profile || {};
  const i = STAGES.indexOf(p.pathway_stage);
  return { i: i >= 0 ? i : 2, assumed: i < 0, appt: p.next_appointment || '' };
}

function nextUp(canon) {
  const gaps = (canon.gaps || []).filter(g => g.status !== 'closed');
  const st = stageOf(canon);
  if (!st.appt && st.i <= 2) {
    const g = gaps.find(x => /appointment/i.test(x.gap));
    return { title: 'Find out when his cardiology appointment is', why: `Everything else waits on this. Ask ${him()} or his GP whether the referral was sent and when he will be seen.`, gap: g };
  }
  const g = gaps[0];
  return g ? { title: plainTask(g), why: g.whatAnswersIt, gap: g } : null;
}


/* ---------------- HOME ---------------- */
function home(canon) {
  const m = extract(canon.testResults);
  const st = stageOf(canon);
  const nu = nextUp(canon);
  const gaps = canon.gaps || [];
  const openGaps = gaps.filter(g => g.status !== 'closed');
  const qs = canon.questions || [];
  const answered = qs.filter(q => q.status === 'answered').length;
  const lastEvent = [...(canon.notes || []).map(n => n.tsUTC), ...(canon.checkins || []).map(c => c.tsUTC)].sort().pop();
  const cards = resultCards(m).filter(c => !c.missing).slice(0, 2);
  const d = st.appt ? daysUntil(st.appt) : null;
  const apptLine = st.appt
    ? (d > 0 ? `Cardiology in ${d} day${d === 1 ? '' : 's'} · ${fmtDate(st.appt)}` : d === 0 ? 'Cardiology appointment today' : `Appointment was ${fmtDate(st.appt)}`)
    : 'Appointment not booked yet';

  root.innerHTML = `
    <div class="rec-home fit">
      <section class="sit">
        <p class="kicker">Where things are</p>
        <p class="sit-line">${esc(situation({ m, medications: canon.medications, notes: canon.notes }))}</p>
      </section>

      <button class="path" data-stage aria-label="Update where things are">
        <div class="stepper" aria-hidden="true">${STAGES.map((_, k) => `<i class="${k < st.i ? 'done' : k === st.i ? 'now' : ''}"></i>`).join('')}</div>
        <div class="path-row">
          <span><b>${esc(STAGES[st.i])}</b>${st.assumed ? ' <em>tap to confirm</em>' : ''}</span>
          <span class="${st.appt ? '' : 'warn-text'}">${esc(apptLine)}</span>
        </div>
      </button>

      ${nu ? `<button class="next" data-nextup>
        <p class="kicker">Next up</p>
        <p class="next-title">${esc(nu.title)}</p>
        <span class="next-cta">See how ${CHEV}</span>
      </button>` : ''}

      <div class="tiles">
        <button class="tile" data-go="results">
          <span class="tile-h">Results</span>
          <span class="tile-body">${cards.map(c => `<span class="mini"><b>${fmtNum(c.value)}</b> ${esc(c.def.short)} <i class="chip ${c.tone}">${esc(c.verdict)}</i></span>`).join('')}</span>
        </button>
        <button class="tile" data-go="todo">
          <span class="tile-h">To do</span>
          <span class="tile-big">${openGaps.length}</span>
          <span class="tile-sub">${gaps.length - openGaps.length} of ${gaps.length} found out</span>
        </button>
        <button class="tile" data-go="questions">
          <span class="tile-h">For the cardiologist</span>
          <span class="tile-big">${qs.length}</span>
          <span class="tile-sub">${answered ? `${answered} answered` : 'questions ready'}</span>
        </button>
        <button class="tile" data-go="history">
          <span class="tile-h">History</span>
          <span class="tile-big sm">${lastEvent ? esc(fmtDate(lastEvent)) : 'None'}</span>
          <span class="tile-sub">latest update</span>
        </button>
      </div>
    </div>`;
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  root.querySelector('[data-stage]').onclick = () => stageSheet(canon);
  root.querySelector('[data-nextup]')?.addEventListener('click', () => nu.gap ? taskSheet(canon, nu.gap) : go('todo'));
}

/* ---------------- stage + appointment sheet ---------------- */
function stageSheet(canon) {
  const st = stageOf(canon);
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Where things are">
      <p class="kicker">Where things are now</p>
      <div class="stage-list">${STAGES.map((s, k) => `<button class="stage-opt" data-k="${k}" aria-pressed="${k === st.i && !st.assumed}"><i></i>${esc(s)}</button>`).join('')}</div>
      <label class="kicker" for="apptDate">Cardiology appointment</label>
      <input id="apptDate" type="date" value="${esc(apptIso(st.appt))}">
      <div class="row"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary grow" data-save>Save</button></div>
    </div>`;
  document.body.appendChild(wrap);
  let pick = st.assumed ? null : st.i;
  wrap.querySelectorAll('.stage-opt').forEach(b => b.onclick = () => {
    pick = +b.dataset.k; wrap.querySelectorAll('.stage-opt').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  const close = () => wrap.remove();
  wrap.onclick = e => { if (e.target === wrap) close(); };
  wrap.querySelector('[data-cancel]').onclick = close;
  wrap.querySelector('[data-save]').onclick = async () => {
    const p = canon.profile || (canon.profile = {});
    const date = wrap.querySelector('#apptDate').value;
    const writes = [];
    if (pick !== null && STAGES[pick] !== p.pathway_stage) { p.pathway_stage = STAGES[pick]; writes.push(ctx.save('profile', { key: 'pathway_stage', value: STAGES[pick] })); }
    if (date && date !== apptIso(p.next_appointment)) { p.next_appointment = date; writes.push(ctx.save('profile', { key: 'next_appointment', value: date })); }
    close(); render();
    const res = await Promise.all(writes);
    if (res.length) ctx.toast(res.every(r => r.ok) ? 'Saved to his record' : 'Saved on this phone, will sync');
  };
}
function apptIso(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1];
  const d = fmtDate(s, { year: true }); if (!d) return '';
  const dt = new Date(d + ' 12:00'); return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
}

/* ---------------- RESULTS ---------------- */
function bar(def, value) {
  const { min, max, marks = [] } = def.scale;
  const pos = v => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  return `<div class="rbar" aria-hidden="true">
    <div class="rtrack">${(def.zones || []).map(([a, b, t]) => `<span class="z ${t}" style="left:${pos(a)}%;width:${pos(b) - pos(a)}%"></span>`).join('')}</div>
    ${value !== null ? `<span class="rmark" style="left:${pos(value)}%"></span>` : ''}
    <div class="rticks">${marks.map(v => `<span style="left:${pos(v)}%">${v}</span>`).join('')}</div>
  </div>`;
}

function extraFor(c, m) {
  if (c.key === 'cac' && c.hit.vessels && Object.keys(c.hit.vessels).length) {
    const v = c.hit.vessels, names = { LAD: 'Front artery (LAD)', LM: 'Left main', LCx: 'Side artery (LCx)', RCA: 'Right artery (RCA)' };
    const max = Math.max(...Object.values(v));
    return `<div class="vessels">${Object.entries(v).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
      `<div class="vrow ${k === 'LM' ? 'lm' : ''}"><span>${names[k] || k}</span><span class="vbar"><i style="width:${(n / max) * 100}%"></i></span><b>${Math.round(n)}</b></div>`).join('')}</div>
      ${c.hit.percentile ? `<p class="meta drop">More calcium than ${esc(c.hit.percentile.replace(/(\d+)(st|nd|rd|th)/g, '$1'))} out of every 100 men his age.</p>` : ''}`;
  }
  if (c.key === 'ldl') {
    return `<div class="lipids">${LIPID_EXTRAS.filter(([k]) => m[k]).map(([k, label, target]) => {
      const v = m[k].value, ok = target < 0 ? v >= -target : v < target;
      return `<span class="lip ${ok ? 'ok' : 'warm'}"><b>${fmtNum(v)}</b>${esc(label)}<small>${target < 0 ? 'good at ' + -target + '+' : 'target under ' + target}</small></span>`;
    }).join('')}</div>`;
  }
  return '';
}

function resultsView(canon) {
  const m = extract(canon.testResults);
  const cards = resultCards(m);
  if (!cards.length) {
    root.innerHTML = spokeHead('Results') + `<article class="card"><div class="fit"><h3>No results on file yet</h3></div></article>`;
    root.querySelector('[data-back]').onclick = () => go('home');
    return;
  }
  resultIdx = Math.min(resultIdx, cards.length - 1);
  const c = cards[resultIdx];
  const src = c.missing ? '' : `${esc(c.hit.source || 'Lab report')}, ${esc(fmtDate(c.hit.date, { year: true }))}`;
  const body = c.missing ? `
      <p class="kicker">${esc(c.def.label)}</p>
      <div class="mhead"><b class="mval none">Not measured yet</b></div>
      ${bar(c.def, null)}
      <p>${esc(c.def.missing.text)}</p>
      <p class="why">${esc(c.def.missing.how)}</p>` : `
      <p class="kicker">${esc(c.def.label)}</p>
      <div class="mhead"><b class="mval">${fmtNum(c.value)}</b><span class="munit">${esc(c.def.unit)}</span><i class="chip ${c.tone}">${esc(c.verdict)}</i></div>
      ${bar(c.def, c.value)}
      <p>${esc(c.def.meaning(c.value))}</p>
      ${extraFor(c, m)}
      <p class="why drop">${esc(c.def.why)}</p>`;
  const foot = `<div class="mfoot"><button class="pill" data-ask>Ask about this</button><button class="pill" data-photo>+ Photo</button><span class="meta">${src}${c.def.ref ? ` · <a href="${esc(REF_URLS[c.def.ref] || '#')}" target="_blank" rel="noopener">evidence</a>` : ''}</span></div>`;

  root.innerHTML = spokeHead('Results') + `
    <div class="chipnav" role="tablist">${cards.map((x, k) => `<button role="tab" aria-selected="${k === resultIdx}" data-k="${k}"><i class="dot ${x.missing ? 'none' : x.tone}"></i>${esc(x.def.short)}</button>`).join('')}</div>
    <article class="card mcard"><div class="fit">${body}</div>${foot}</article>`;
  root.querySelector('[data-back]').onclick = () => go('home');
  root.querySelectorAll('.chipnav [data-k]').forEach(b => b.onclick = () => { resultIdx = +b.dataset.k; render(); });
  root.querySelector('[data-photo]').onclick = () => ctx.addPhoto();
  root.querySelector('[data-ask]').onclick = () => ctx.openAsk(c.missing ? 'He has never had a blood pressure reading on file. How should we get one, and what would worry you?' : c.def.ask(fmtNum(c.value)));
  swipe(root.querySelector('.mcard'), d => { resultIdx = Math.max(0, Math.min(cards.length - 1, resultIdx + d)); render(); });
}

function spokeHead(title) {
  return `<header class="spoke-head"><button class="back" data-back aria-label="Back to his record">${BACK}<span>His record</span></button><h2>${esc(title)}</h2></header>`;
}

function swipe(el, onMove) {
  let x0 = null;
  el.ontouchstart = e => { x0 = e.touches[0].clientX; };
  el.ontouchend = e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) onMove(dx < 0 ? 1 : -1); };
}

/* ---------------- shared: sheet, mic, pager ---------------- */
export function openSheet(html, mount) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => { stopMic(); wrap.remove(); };
  wrap.onclick = e => { if (e.target === wrap) close(); };
  wrap.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mount?.(wrap.querySelector('.sheet'), close);
  return close;
}

let micStop = null;
function stopMic() { micStop?.(); micStop = null; }
const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
function micButton() { return `<button class="micbtn" type="button" data-mic aria-pressed="false" aria-label="Speak">${MIC}<span>Speak</span></button>`; }
// Wire a mic button to a textarea: spoken words append to what is typed.
function wireMic(btn, ta) {
  btn.onclick = () => {
    if (micStop) { stopMic(); return; }
    const base = ta.value ? ta.value.trim() + ' ' : '';
    micStop = ctx.listen(text => { ta.value = base + text; ta.dispatchEvent(new Event('input')); }, on => {
      btn.setAttribute('aria-pressed', String(on === true)); btn.disabled = on === 'busy';
      btn.querySelector('span').textContent = on === true ? 'Stop' : on === 'busy' ? 'Writing…' : 'Speak';
      if (on === false) micStop = null;
    });
  };
}

function pagerFoot(i, n) {
  if (n <= 1) return '';
  return `<div class="pager"><button class="nav-arrow" data-pg="-1" aria-label="Previous page" ${i === 0 ? 'disabled' : ''}>${BACK}</button><span>${i + 1} of ${n}</span><button class="nav-arrow" data-pg="1" aria-label="Next page" ${i === n - 1 ? 'disabled' : ''}>${CHEV}</button></div>`;
}
function wirePager(n, get, set) {
  root.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { set(Math.max(0, Math.min(n - 1, get() + +b.dataset.pg))); render(); });
  const card = root.querySelector('.card');
  if (card && n > 1) swipe(card, d => { set(Math.max(0, Math.min(n - 1, get() + d))); render(); });
}
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out.length ? out : [[]]; };

/* ---------------- TO DO ---------------- */
const STATUS_LABEL = { open: 'To do', call: 'On next call', done: 'Found out' };

function todoView(canon) {
  const gaps = canon.gaps || [];
  const done = gaps.filter(g => g.status === 'closed').length;
  const groups = groupsFor(him()).map(([id, label, blurb]) => ({ id, label, blurb, items: gaps.filter(g => taskGroup(g) === id) })).filter(g => g.items.length);
  if (!todoGroup || !groups.some(g => g.id === todoGroup)) todoGroup = (groups.find(g => g.items.some(x => x.status !== 'closed')) || groups[0] || {}).id;
  const grp = groups.find(g => g.id === todoGroup);
  const order = { call: 0, open: 1, done: 2 };
  const items = grp ? [...grp.items].sort((a, b) => order[taskStatus(a)] - order[taskStatus(b)]) : [];

  root.innerHTML = spokeHead('To do') + `
    <div class="progress"><span><b>${done} of ${gaps.length}</b> found out</span><span class="pbar"><i style="width:${gaps.length ? (done / gaps.length) * 100 : 0}%"></i></span></div>
    <div class="chipnav" role="tablist" style="grid-template-columns:repeat(${groups.length},1fr)">${groups.map(g => {
      const left = g.items.filter(x => x.status !== 'closed').length;
      return `<button role="tab" aria-selected="${g.id === todoGroup}" data-grp="${g.id}">${esc(g.label)}<b class="count">${left}</b></button>`;
    }).join('')}</div>
    <article class="card"><div class="fit">
      ${grp ? `<p class="why">${esc(grp.blurb)}</p>
      <div class="tasks">${items.map(g => {
        const st = taskStatus(g);
        return `<button class="task ${st}" data-gap="${esc(g.id)}"><span class="t-title">${esc(plainTask(g))}</span><span class="t-how drop">${esc(taskHow(g, canon.questions))}</span><i class="tstat ${st}">${STATUS_LABEL[st]}</i></button>`;
      }).join('')}</div>` : '<h3>Nothing to find out</h3>'}
    </div></article>`;
  root.querySelector('[data-back]').onclick = () => go('home');
  root.querySelectorAll('[data-grp]').forEach(b => b.onclick = () => { todoGroup = b.dataset.grp; render(); });
  root.querySelectorAll('[data-gap]').forEach(b => b.onclick = () => taskSheet(canon, gaps.find(g => g.id === b.dataset.gap)));
}

function taskSheet(canon, g) {
  if (!g) return;
  if (/appointment/i.test(g.gap) && g.status !== 'closed') return stageSheet(canon);
  const st = taskStatus(g);
  const grp = groupsFor(him()).find(x => x[0] === taskGroup(g));
  openSheet(`
    <p class="kicker">${esc(grp ? grp[1] : 'To do')}</p>
    <h3 class="sheet-title">${esc(plainTask(g))}</h3>
    <p class="soft">${esc(taskHow(g, canon.questions))}</p>
    ${g.whatAnswersIt ? `<p class="meta">What answers it: ${esc(g.whatAnswersIt)}</p>` : ''}
    <div class="found" hidden>
      <label class="kicker" for="foundText">What did you find out?</label>
      <textarea id="foundText" rows="3" maxlength="1500" placeholder="e.g. He takes nothing regularly, just paracetamol sometimes"></textarea>
      <div class="row">${micButton()}<button class="btn primary grow" data-save-found>Save to his record</button></div>
    </div>
    <div class="row actions">
      ${st === 'done' ? '<button class="btn grow" data-reopen>Mark as not known</button>' : `
      <button class="btn ${st === 'call' ? '' : 'primary'} grow" data-call>${st === 'call' ? 'Remove from next call' : 'Add to next call'}</button>
      <button class="btn grow" data-found>I found out</button>`}
    </div>
    <button class="btn ghost" data-close>Close</button>`, (sheet, close) => {
    const setStatus = async status => {
      g.status = status; close(); render();
      const r = await ctx.save('gap', { id: g.id, status });
      ctx.toast(r.ok ? (status === 'in-progress' ? 'Added to your next check-in call' : 'Saved') : 'Saved on this phone, will sync');
      ctx.onTasksChanged?.();
    };
    sheet.querySelector('[data-call]')?.addEventListener('click', () => setStatus(st === 'call' ? 'open' : 'in-progress'));
    sheet.querySelector('[data-reopen]')?.addEventListener('click', () => setStatus('open'));
    sheet.querySelector('[data-found]')?.addEventListener('click', () => {
      sheet.querySelector('.found').hidden = false; sheet.querySelector('.actions').hidden = true;
      sheet.querySelector('#foundText').focus();
    });
    const ta = sheet.querySelector('#foundText');
    wireMic(sheet.querySelector('[data-mic]'), ta);
    sheet.querySelector('[data-save-found]').onclick = async () => {
      const text = ta.value.trim();
      if (!text) { ctx.toast('Say or type what you found out'); return; }
      g.status = 'closed';
      (canon.notes || (canon.notes = [])).push({ tsUTC: new Date().toISOString(), by: 'me', tag: 'found-out', text: `FOUND OUT (${g.id}): ${text}` });
      close(); render();
      const a = await ctx.save('note', { text: `FOUND OUT (${g.id} ${plainTask(g)}): ${text}`, tag: 'found-out' });
      const b = await ctx.save('gap', { id: g.id, status: 'closed' });
      ctx.toast(a.ok && b.ok ? 'Saved to his record' : 'Saved on this phone, will sync');
      ctx.onTasksChanged?.();
    };
  });
}

/* ---------------- FOR THE CARDIOLOGIST ---------------- */
const Q_STATE = { open: 'Not asked', asked: 'Asked', answered: 'Answered' };
function sortedQs(canon) {
  const rank = { open: 0, asked: 1, answered: 2 };
  return [...(canon.questions || [])].sort((a, b) => (rank[a.status] ?? 0) - (rank[b.status] ?? 0) || (+a.priority || 9) - (+b.priority || 9) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
}

function questionsView(canon) {
  const qs = sortedQs(canon);
  const firstIds = qs.filter(q => q.status !== 'answered').slice(0, 3).map(q => q.id);
  const pages = chunk(qs, innerHeight < 700 ? 3 : 4);
  qPage = Math.min(qPage, pages.length - 1);
  const answered = qs.filter(q => q.status === 'answered').length;
  root.innerHTML = spokeHead('For the cardiologist') + `
    <div class="progress"><span><b>${answered} of ${qs.length}</b> answered</span><span class="pbar"><i style="width:${qs.length ? (answered / qs.length) * 100 : 0}%"></i></span></div>
    <article class="card"><div class="fit">
      <div class="qlist">${pages[qPage].map(q => `<button class="qitem" data-q="${esc(q.id)}">
        <span class="q-text">${firstIds.includes(q.id) ? '<b class="first">Ask first</b> ' : ''}${esc(q.question)}</span>
        <i class="qstate ${esc(q.status || 'open')}">${Q_STATE[q.status] || 'Not asked'}</i></button>`).join('') || '<p class="soft">No questions yet.</p>'}</div>
    </div>${pagerFoot(qPage, pages.length)}</article>
    <div class="row">
      <button class="btn ghost" data-addq>+ Add</button>
      <button class="btn primary grow" data-appt>Appointment mode</button>
    </div>`;
  root.querySelector('[data-back]').onclick = () => go('home');
  wirePager(pages.length, () => qPage, v => { qPage = v; });
  root.querySelectorAll('[data-q]').forEach(b => b.onclick = () => questionSheet(canon, canon.questions.find(q => q.id === b.dataset.q)));
  root.querySelector('[data-addq]').onclick = () => addQuestionSheet(canon);
  root.querySelector('[data-appt]').onclick = () => appointmentMode(canon);
}

async function saveAnswer(q, answer) {
  q.status = 'answered'; q.answer = answer; q.updated = new Date().toISOString().slice(0, 10);
  return ctx.save('question', { id: q.id, status: 'answered', answer });
}

function questionSheet(canon, q) {
  if (!q) return;
  openSheet(`
    <p class="kicker">${esc(Q_STATE[q.status] || 'Not asked')}</p>
    <h3 class="sheet-title">${esc(q.question)}</h3>
    ${q.answer ? `<p class="answer-box">${esc(q.answer)}</p>` : ''}
    <div class="found" hidden>
      <label class="kicker" for="qAnswer">What did the doctor say?</label>
      <textarea id="qAnswer" rows="3" maxlength="2000">${esc(q.answer || '')}</textarea>
      <div class="row">${micButton()}<button class="btn primary grow" data-save-ans>Save answer</button></div>
    </div>
    <div class="row actions">
      ${q.status === 'open' || !q.status ? '<button class="btn grow" data-asked>Mark asked</button>' : ''}
      <button class="btn primary grow" data-ans>${q.answer ? 'Edit answer' : 'Record the answer'}</button>
    </div>
    <div class="row"><button class="btn ghost" data-close>Close</button><button class="btn grow" data-askai>Ask about this</button></div>`, (sheet, close) => {
    sheet.querySelector('[data-asked]')?.addEventListener('click', async () => {
      q.status = 'asked'; close(); render();
      const r = await ctx.save('question', { id: q.id, status: 'asked' }); ctx.toast(r.ok ? 'Marked as asked' : 'Saved on this phone, will sync');
    });
    sheet.querySelector('[data-ans]').onclick = () => { sheet.querySelector('.found').hidden = false; sheet.querySelector('.actions').hidden = true; sheet.querySelector('#qAnswer').focus(); };
    const ta = sheet.querySelector('#qAnswer');
    wireMic(sheet.querySelector('[data-mic]'), ta);
    sheet.querySelector('[data-save-ans]').onclick = async () => {
      if (!ta.value.trim()) { ctx.toast('Say or type the answer first'); return; }
      close(); render(); const r = await saveAnswer(q, ta.value.trim()); ctx.toast(r.ok ? 'Answer saved' : 'Saved on this phone, will sync');
    };
    sheet.querySelector('[data-askai]').onclick = () => { close(); ctx.openAsk(`For the cardiologist: "${q.question}" What is the likely answer for him, and what should we listen out for?`); };
  });
}

function addQuestionSheet(canon) {
  openSheet(`
    <p class="kicker">New question for the cardiologist</p>
    <label class="sr" for="newQ">Question</label>
    <textarea id="newQ" rows="3" maxlength="500" placeholder="e.g. Can he keep playing golf?"></textarea>
    <div class="row">${micButton()}<button class="btn primary grow" data-add>Add question</button></div>
    <button class="btn ghost" data-close>Cancel</button>`, (sheet, close) => {
    const ta = sheet.querySelector('#newQ'); ta.focus();
    wireMic(sheet.querySelector('[data-mic]'), ta);
    sheet.querySelector('[data-add]').onclick = async () => {
      const text = ta.value.trim(); if (!text) return;
      const tmp = { id: 'new' + Date.now(), question: text, askWhom: 'cardiologist', priority: '2', status: 'open' };
      (canon.questions || (canon.questions = [])).push(tmp); close(); render();
      const r = await ctx.save('question', { question: text, askWhom: 'cardiologist', priority: '2' });
      if (r.ok && r.out?.id) tmp.id = r.out.id;
      ctx.toast(r.ok ? 'Question added' : 'Saved on this phone, will sync');
    };
  });
}

// Full screen, one question at a time, for use during the consult.
function appointmentMode(canon) {
  const list = sortedQs(canon).filter(q => q.status !== 'answered');
  if (!list.length) { ctx.toast('Every question has an answer'); return; }
  let i = 0, saved = 0;
  const el = document.createElement('div');
  el.className = 'appt-mode';
  document.body.appendChild(el);
  const finish = () => { stopMic(); el.remove(); render(); };
  const draw = () => {
    if (i >= list.length) {
      el.innerHTML = `<div class="appt-inner"><p class="kicker">Appointment notes</p><h2 class="appt-q">${saved} answer${saved === 1 ? '' : 's'} saved to his record</h2>
        <p class="soft">They are in For the cardiologist and in History. Use Ask to talk through anything that was unclear.</p>
        <button class="btn primary" data-done>Done</button></div>`;
      el.querySelector('[data-done]').onclick = finish; return;
    }
    const q = list[i];
    el.innerHTML = `<div class="appt-inner">
      <div class="appt-top"><span class="kicker">Question ${i + 1} of ${list.length}</span><button class="link" data-done>End</button></div>
      <h2 class="appt-q">${esc(q.question)}</h2>
      <label class="sr" for="apptAns">Answer</label>
      <textarea id="apptAns" maxlength="2000" placeholder="Tap Speak and let the doctor's answer be written down, or type notes.">${esc(q.answer || '')}</textarea>
      <div class="row">${micButton()}</div>
      <div class="row"><button class="btn ghost" data-skip>Skip</button><button class="btn primary grow" data-save>Save answer</button></div>
    </div>`;
    const ta = el.querySelector('#apptAns');
    wireMic(el.querySelector('[data-mic]'), ta);
    el.querySelector('[data-done]').onclick = finish;
    el.querySelector('[data-skip]').onclick = () => { stopMic(); i++; draw(); };
    el.querySelector('[data-save]').onclick = async () => {
      stopMic();
      const text = ta.value.trim(); if (!text) { ctx.toast('Nothing to save yet'); return; }
      saveAnswer(q, text).then(r => { if (!r.ok) ctx.toast('Saved on this phone, will sync'); });
      saved++; i++; draw();
    };
  };
  draw();
}

/* ---------------- HISTORY ---------------- */
const KIND = {
  scan: ['Scan', 'hot'], bloods: ['Bloods', 'soon'], symptom: ['Symptoms', 'warm'], concern: ['Asked', 'accent'],
  checkin: ['Check-in', 'ok'], found: ['Found out', 'ok'], answer: ['Doctor', 'accent'], note: ['Note', 'none'],
};
const URG = { emergency: ['Emergency', 'hot'], urgent: ['Today', 'hot'], soon: ['This week', 'warm'], routine: ['No red flags', 'ok'] };

function historyView(canon) {
  const ev = historyEvents(canon, { him: him() });
  const pages = chunk(ev, innerHeight < 700 ? 4 : 5);
  hPage = Math.min(hPage, pages.length - 1);
  let lastDate = '';
  root.innerHTML = spokeHead('History') + `
    <article class="card"><div class="fit">
      <div class="timeline">${pages[hPage].map(e => {
        const head = e.date !== lastDate ? `<p class="t-date">${esc(e.date || 'Undated')}</p>` : '';
        lastDate = e.date;
        const [kLabel, kTone] = KIND[e.kind] || KIND.note;
        const u = URG[e.urgency];
        return `${head}<button class="ev ${e.kind === 'concern' ? 'tap' : ''}" ${e.kind === 'concern' ? `data-concern="${esc(e.concern)}"` : 'tabindex="-1"'}>
          <i class="ev-kind ${kTone}">${kLabel}</i>
          <span class="ev-body"><b>${esc(e.title)}${e.count > 1 ? ` (${e.count}x)` : ''}</b>${u ? ` <i class="chip ${u[1]}">${u[0]}</i>` : ''}<span>${esc(e.detail)}</span>${e.answer ? `<span class="ev-ans">${esc(e.answer)}</span>` : ''}</span>
        </button>`;
      }).join('') || '<p class="soft">Nothing recorded yet.</p>'}</div>
    </div>${pagerFoot(hPage, pages.length)}</article>`;
  root.querySelector('[data-back]').onclick = () => go('home');
  wirePager(pages.length, () => hPage, v => { hPage = v; });
  root.querySelectorAll('[data-concern]').forEach(b => b.onclick = () => ctx.openAsk(b.dataset.concern));
}
