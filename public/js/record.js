// His record: a hub (where things are, what's next) with one-screen spokes.
// Everything the user sees is derived from the sheet canon; nothing is mocked.
import { extract, resultCards, situation, fmtDate, daysUntil, STAGES, LIPID_EXTRAS, REF_URLS } from './metrics.js';

let ctx, root, view = 'home', resultIdx = 0;

export function mountRecord(el, context) { root = el; ctx = context; render(); }
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
  ({ home, results: resultsView }[view] || placeholder)(canon);
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
    return { title: 'Find out when his cardiology appointment is', why: 'Everything else waits on this. Ask Dad or his GP whether the referral was sent and when he will be seen.', gap: g };
  }
  const g = gaps[0];
  return g ? { title: plainTask(g), why: g.whatAnswersIt, gap: g } : null;
}

export function plainTask(g) {
  return String(g.gap).split(/\s+-\s+|\s+\(/)[0].trim();
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
  root.querySelector('[data-nextup]')?.addEventListener('click', () => go('todo'));
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
  const foot = `<div class="mfoot"><button class="pill" data-ask>Ask about this</button><span class="meta">${src}${c.def.ref ? ` · <a href="${esc(REF_URLS[c.def.ref] || '#')}" target="_blank" rel="noopener">evidence</a>` : ''}</span></div>`;

  root.innerHTML = spokeHead('Results') + `
    <div class="chipnav" role="tablist">${cards.map((x, k) => `<button role="tab" aria-selected="${k === resultIdx}" data-k="${k}"><i class="dot ${x.missing ? 'none' : x.tone}"></i>${esc(x.def.short)}</button>`).join('')}</div>
    <article class="card mcard"><div class="fit">${body}</div>${foot}</article>`;
  root.querySelector('[data-back]').onclick = () => go('home');
  root.querySelectorAll('.chipnav [data-k]').forEach(b => b.onclick = () => { resultIdx = +b.dataset.k; render(); });
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

function placeholder() {
  root.innerHTML = spokeHead({ todo: 'To do', questions: 'For the cardiologist', history: 'History' }[view] || '') +
    `<article class="card"><div class="fit"><p class="kicker">Next build step</p><h3>Built after you approve Home and Results.</h3></div></article>`;
  root.querySelector('[data-back]').onclick = () => go('home');
}
