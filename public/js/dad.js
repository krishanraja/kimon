// The family's view of Kimon: monitor what he logs, nudge him, and set his
// care plan (habits, tablets). Reads and writes the same sheet he uses.
import { monitor, readPlan, HABIT_IDEAS, TAGS, melbDay } from './kimon-model.js';
import { fmtDate } from './metrics.js';
import { openSheet } from './record.js';

let ctx, root, view = 'home';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL = { emergency: ['Emergency', 'hot'], urgent: ['Today', 'hot'], soon: ['This week', 'warm'], routine: ['Fine', 'ok'] };
const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

export function mountDad(el, context) { root = el; ctx = context; render(); }
export function refreshDad() { if (root) render(); }
export function dadHome() { view = 'home'; if (root) render(); }

function render() {
  const canon = ctx.canon();
  if (!canon) { root.innerHTML = '<div class="rec-empty"><h3>Loading</h3></div>'; return; }
  (view === 'plan' ? planView : home)(canon);
  requestAnimationFrame(() => root.querySelectorAll('.fit').forEach(ctx.fit));
}

function ago(ts) {
  if (!ts) return 'not yet';
  const d = melbDay(ts), t = melbDay(new Date()), y = melbDay(Date.now() - 86400000);
  return d === t ? 'today' : d === y ? 'yesterday' : fmtDate(d);
}

function home(canon) {
  const m = monitor(canon);
  const plan = readPlan(canon.profile);
  const hasMeds = plan.meds.some(x => x.name);
  // Latest few things, newest first: symptoms, what he said, the body check.
  const feed = [
    ...m.logs.map(l => ({ ts: l.ts, kind: 'Symptom', tone: (LEVEL[l.level] || LEVEL.soon)[1], text: l.summary.replace(/^SYMPTOM:\s*/, ''), chip: LEVEL[l.level] })),
    ...m.said.map(s => ({ ts: s.ts, kind: 'He said', tone: 'accent', text: s.text })),
    ...(m.lastCheck ? [{ ts: m.lastCheck.ts, kind: 'Body check', tone: (LEVEL[m.lastCheck.level] || LEVEL.routine)[1], text: m.lastCheck.summary.replace(/^BODY CHECK:\s*/, ''), chip: LEVEL[m.lastCheck.level] }] : []),
  ].sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 3);

  root.innerHTML = `<div class="fit dad-home">
    <div class="dad-top"><h2>Dad this week</h2><a class="link" href="/me">See his app ↗</a></div>
    ${m.alerts.length ? `<section class="dad-alert ${LEVEL[m.alerts[0].level][1]}"><p class="kicker">Needs attention · ${esc(ago(m.alerts[0].ts))}</p><p>${esc(m.alerts[0].text.replace(/^(SYMPTOM|BODY CHECK):\s*/, ''))}</p>
      <button class="pill" data-ask>Ask what to do</button></section>` : ''}
    <div class="dad-stats">
      <div class="stat"><b>${m.habitDays}<small>/7</small></b><span>days he did his one thing</span></div>
      ${hasMeds ? `<div class="stat"><b>${m.medsDays}<small>/7</small></b><span>days tablets taken</span></div>` : ''}
      <div class="stat ${m.checkDue ? 'warm' : ''}"><b>${m.lastCheck ? esc(ago(m.lastCheck.ts)) : 'None'}</b><span>${m.checkDue ? 'body check due' : 'last body check'}</span></div>
    </div>
    <section class="card dad-feed"><p class="kicker">Lately · last seen ${esc(ago(m.lastSeen))}</p>
      ${feed.length ? feed.map(f => `<div class="ev"><i class="ev-kind ${f.tone}">${f.kind}</i><span class="ev-body"><b>${esc(ago(f.ts))}</b>${f.chip ? ` <i class="chip ${f.chip[1]}">${f.chip[0]}</i>` : ''}<span>${esc(f.text)}</span></span></div>`).join('')
        : '<p class="soft">Nothing yet. Once Dad starts using his app, his logs show up here.</p>'}
    </section>
    <div class="row dad-actions"><button class="btn" data-plan>Care plan</button><button class="btn primary grow" data-nudge>Send a nudge</button></div>
  </div>`;
  root.querySelector('[data-plan]').onclick = () => { view = 'plan'; render(); };
  root.querySelector('[data-nudge]').onclick = () => nudgeSheet(canon);
  root.querySelector('[data-ask]')?.addEventListener('click', () => ctx.openAsk(`Dad logged this: "${m.alerts[0].text.replace(/^(SYMPTOM|BODY CHECK):\s*/, '')}". What should we do?`));
}

const NUDGES = ['Proud of you ♥', 'Time for your walk?', 'Did you take your tablets?', 'Can you do your body check?', 'How are you feeling today?'];
function nudgeSheet(canon) {
  openSheet(`<p class="kicker">Nudge Dad</p>
    <div class="nudge-picks">${NUDGES.map(n => `<button class="pill" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <label class="sr" for="nudgeText">Your message</label>
    <textarea id="nudgeText" rows="2" maxlength="300" placeholder="Or write your own"></textarea>
    <div class="row"><button class="micbtn" data-mic aria-pressed="false">${MIC}<span>Speak</span></button><button class="btn primary grow" data-send>Send</button></div>
    <p class="meta">It shows at the top of his Today screen.</p>`, (sheet, close) => {
    const ta = sheet.querySelector('#nudgeText');
    sheet.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { ta.value = b.dataset.n; });
    const mic = sheet.querySelector('[data-mic]');
    let stop = null;
    mic.onclick = () => {
      if (stop) { stop(); return; }
      const base = ta.value ? ta.value.trim() + ' ' : '';
      stop = ctx.listen(t => { ta.value = base + t; }, on => { mic.setAttribute('aria-pressed', String(on === true)); mic.disabled = on === 'busy'; mic.querySelector('span').textContent = on === true ? 'Stop' : on === 'busy' ? 'Writing…' : 'Speak'; if (on === false) stop = null; });
    };
    sheet.querySelector('[data-send]').onclick = async () => {
      const text = ta.value.trim(); if (!text) return;
      (canon.notes || (canon.notes = [])).push({ tsUTC: new Date().toISOString(), by: ctx.who(), tag: TAGS.nudge, text: `NUDGE: ${text}` });
      close();
      const r = await ctx.save('note', { text: `NUDGE: ${text}`, tag: TAGS.nudge });
      ctx.toast(r.ok ? 'Sent. Dad sees it on his Today screen.' : 'Saved on this phone, will send');
    };
  });
}

/* ---------- care plan ---------- */
function planView(canon) {
  const plan = readPlan(canon.profile);
  const draw = () => {
    root.innerHTML = `<header class="spoke-head"><button class="back" data-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Monitor</span></button><h2>Care plan</h2></header>
    <article class="card"><div class="fit plan">
      <p class="kicker">Habits · he sees one a day</p>
      <div class="plan-list">${plan.habits.map((h, i) => `<div class="plan-row"><button class="toggle ${h.on !== false ? 'on' : ''}" data-tog="${i}" aria-pressed="${h.on !== false}" aria-label="Turn ${esc(h.text)} ${h.on !== false ? 'off' : 'on'}"><i></i></button><span>${esc(h.text)}</span><button class="x" data-rm="${i}" aria-label="Remove">×</button></div>`).join('') || '<p class="soft">No habits yet.</p>'}</div>
      <button class="pill" data-addh>+ Add a habit</button>
      <p class="kicker">Tablets · he ticks them daily</p>
      <div class="plan-list">${plan.meds.map((m, i) => `<div class="plan-row"><span><b>${esc(m.name)}</b>${m.when ? ` · ${esc(m.when)}` : ''}</span><button class="x" data-rmm="${i}" aria-label="Remove">×</button></div>`).join('') || '<p class="soft">None yet. Add one once his doctor prescribes it.</p>'}</div>
      <button class="pill" data-addm>+ Add a tablet</button>
    </div></article>
    <button class="btn primary" data-save>Save care plan</button>`;
    root.querySelector('[data-back]').onclick = () => { view = 'home'; render(); };
    root.querySelectorAll('[data-tog]').forEach(b => b.onclick = () => { const h = plan.habits[+b.dataset.tog]; h.on = h.on === false; draw(); });
    root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { plan.habits.splice(+b.dataset.rm, 1); draw(); });
    root.querySelectorAll('[data-rmm]').forEach(b => b.onclick = () => { plan.meds.splice(+b.dataset.rmm, 1); draw(); });
    root.querySelector('[data-addh]').onclick = () => openSheet(`<p class="kicker">Add a habit</p>
      <div class="nudge-picks">${HABIT_IDEAS.filter(x => !plan.habits.some(h => h.text === x)).map(x => `<button class="pill" data-h="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <input id="habitText" maxlength="60" placeholder="Or write your own, short and specific">
      <button class="btn primary" data-ok>Add</button>`, (sheet, close) => {
      const inp = sheet.querySelector('#habitText');
      sheet.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { inp.value = b.dataset.h; });
      sheet.querySelector('[data-ok]').onclick = () => { const t = inp.value.trim(); if (t) { plan.habits.push({ text: t, on: true }); close(); draw(); } };
    });
    root.querySelector('[data-addm]').onclick = () => openSheet(`<p class="kicker">Add a tablet</p>
      <input id="medName" maxlength="40" placeholder="Name, e.g. Atorvastatin 40 mg">
      <div class="nudge-picks">${['morning', 'evening', 'with dinner'].map(w => `<button class="pill" data-w="${w}">${w}</button>`).join('')}</div>
      <button class="btn primary" data-ok>Add</button>`, (sheet, close) => {
      let when = '';
      sheet.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { when = b.dataset.w; sheet.querySelectorAll('[data-w]').forEach(x => x.classList.toggle('on', x === b)); });
      sheet.querySelector('[data-ok]').onclick = () => { const n = sheet.querySelector('#medName').value.trim(); if (n) { plan.meds.push({ name: n, when }); close(); draw(); } };
    });
    root.querySelector('[data-save]').onclick = async () => {
      const value = JSON.stringify(plan);
      (canon.profile || (canon.profile = {})).care_plan = value;
      view = 'home'; render();
      const r = await ctx.save('profile', { key: 'care_plan', value });
      ctx.toast(r.ok ? 'Care plan saved. Dad sees it from today.' : 'Saved on this phone, will sync');
    };
    requestAnimationFrame(() => root.querySelectorAll('.fit').forEach(ctx.fit));
  };
  draw();
}
