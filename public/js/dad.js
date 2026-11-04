// The family's view of Kimon: monitor what he logs, nudge him, and set his
// care plan (habits, tablets). Reads and writes the same sheet he uses.
import { monitor, readPlan, HABIT_IDEAS, TAGS, melbDay, removalNote, liveNotes } from './kimon-model.js';
import { fmtDate } from './metrics.js';
import { openSheet } from './record.js';
import { currentMeds, medLine } from './meds-model.js';
import { MED_CATALOG, MED_WHEN, strengthsOf } from './med-catalog.js';

let ctx, root, view = 'home';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL = { emergency: ['Emergency', 'hot'], urgent: ['Today', 'hot'], soon: ['This week', 'warm'], routine: ['Fine', 'ok'] };
const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

export function mountDad(el, context) { root = el; ctx = context; render(); }
// What this person calls him: "Dad", "Kim", "Kimon".
const him = () => ctx.me?.().him || 'Kimon';
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
  const hasMeds = !currentMeds(canon).empty;
  // Latest few things, newest first: symptoms, what he said, the body check.
  const feed = [
    ...m.logs.map(l => ({ ts: l.ts, tag: TAGS.symptom, nid: l.nid, kind: 'Symptom', tone: (LEVEL[l.level] || LEVEL.soon)[1], text: l.summary.replace(/^SYMPTOM:\s*/, ''), chip: LEVEL[l.level] })),
    ...m.said.map(s => ({ ts: s.ts, kind: 'He said', tone: 'accent', text: s.text })),
    ...(m.lastCheck ? [{ ts: m.lastCheck.ts, tag: TAGS.check, nid: m.lastCheck.nid, kind: 'Body check', tone: (LEVEL[m.lastCheck.level] || LEVEL.routine)[1], text: m.lastCheck.summary.replace(/^BODY CHECK:\s*/, ''), chip: LEVEL[m.lastCheck.level] }] : []),
  ].sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 3);

  root.innerHTML = `<div class="fit dad-home">
    <div class="dad-top"><h2>${esc(him())} this week</h2><a class="link" href="/me">See his app ↗</a></div>
    ${m.alerts.length ? `<section class="dad-alert ${LEVEL[m.alerts[0].level][1]}"><p class="kicker">Needs attention · ${esc(ago(m.alerts[0].ts))}</p><p>${esc(m.alerts[0].text.replace(/^(SYMPTOM|BODY CHECK):\s*/, ''))}</p>
      <button class="pill" data-ask>Ask what to do</button></section>` : ''}
    <div class="dad-stats">
      <div class="stat"><b>${m.habitDays}<small>/7</small></b><span>days he did his one thing</span></div>
      ${hasMeds ? `<div class="stat"><b>${m.medsDays}<small>/7</small></b><span>days tablets taken</span></div>` : ''}
      <div class="stat ${m.checkDue ? 'warm' : ''}"><b>${m.lastCheck ? esc(ago(m.lastCheck.ts)) : 'Not yet'}</b><span>${m.checkDue ? 'body check due' : 'last body check'}</span></div>
    </div>
    <section class="card dad-feed${feed.length ? '' : ' empty'}"><p class="kicker">${m.lastSeen ? `Lately · last seen ${esc(ago(m.lastSeen))}` : 'Lately'}</p>
      ${feed.length ? feed.map(f => `<div class="ev"><i class="ev-kind ${f.tone}">${f.kind}</i><span class="ev-body"><b>${esc(ago(f.ts))}</b>${f.chip ? ` <i class="chip ${f.chip[1]}">${f.chip[0]}</i>` : ''}<span>${esc(f.text)}</span></span>${f.tag ? `<button class="x" data-rm-ev="${feed.indexOf(f)}" aria-label="Remove this entry">×</button>` : ''}</div>`).join('')
        : `<h3>Nothing from ${esc(him())} yet</h3><p class="soft">Once he starts using his app, what he logs and says shows up here.</p>`}
    </section>
    <div class="row dad-actions"><button class="btn" data-plan>Care plan</button><button class="btn primary grow" data-nudge>Send a nudge</button></div>
  </div>`;
  root.querySelector('[data-plan]').onclick = () => { view = 'plan'; render(); };
  // An entry logged by mistake: a "removed" marker hides it everywhere; the sheet keeps both.
  root.querySelectorAll('[data-rm-ev]').forEach(btn => btn.onclick = async () => {
    const f = feed[+btn.dataset.rmEv];
    if (!confirm(`Remove this ${f.kind.toLowerCase()}? Only if it was logged by mistake. It stays in the sheet's history.`)) return;
    const r = removalNote({ tsUTC: f.ts, tag: f.tag, nid: f.nid });
    canon.notes = liveNotes([...(canon.notes || []), { ...r, tsUTC: new Date().toISOString(), by: ctx.who() }]);
    render();
    const res = await ctx.save('note', r);
    ctx.toast(res.ok ? 'Removed' : 'Removed here. It will save when you are online.');
  });
  root.querySelector('[data-nudge]').onclick = () => nudgeSheet(canon);
  root.querySelector('[data-ask]')?.addEventListener('click', () => ctx.openAsk(`${him()} logged this: "${m.alerts[0].text.replace(/^(SYMPTOM|BODY CHECK):\s*/, '')}". What should we do?`));
}

const NUDGES = ['Proud of you ♥', 'Time for your walk?', 'Did you take your tablets?', 'Can you do your body check?', 'How are you feeling today?'];
function nudgeSheet(canon) {
  // One tap sends a ready nudge; or speak one. No typing.
  openSheet(`<p class="kicker">Nudge ${esc(him())}</p>
    <div class="nudge-picks">${NUDGES.map(n => `<button class="pill" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <p class="said" hidden></p>
    <div class="row"><button class="micbtn" data-mic aria-pressed="false">${MIC}<span>Speak</span></button><button class="btn primary grow" data-send hidden>Send</button></div>
    <p class="meta">Tap one to send it. It shows at the top of his Today screen.</p>`, (sheet, close) => {
    let said = '', sent = false;
    const send = async text => {
      if (sent || !text) return; sent = true;
      (canon.notes || (canon.notes = [])).push({ tsUTC: new Date().toISOString(), by: ctx.who(), tag: TAGS.nudge, text: `NUDGE: ${text}` });
      close();
      const r = await ctx.save('note', { text: `NUDGE: ${text}`, tag: TAGS.nudge });
      ctx.toast(r.ok ? `Sent. ${him()} sees it on his Today screen.` : 'Saved on this phone, will send');
    };
    sheet.querySelectorAll('[data-n]').forEach(b => b.onclick = () => send(b.dataset.n));
    const mic = sheet.querySelector('[data-mic]'), out = sheet.querySelector('.said'), go = sheet.querySelector('[data-send]');
    let stop = null;
    mic.onclick = () => {
      if (stop) { stop(); return; }
      stop = ctx.listen(t => { said = t.trim(); out.textContent = `“${said}”`; out.hidden = !said; go.hidden = !said; }, on => { mic.setAttribute('aria-pressed', String(on === true)); mic.disabled = on === 'busy'; mic.querySelector('span').textContent = on === true ? 'Stop' : on === 'busy' ? 'Writing…' : 'Speak'; if (on === false) stop = null; });
    };
    go.onclick = () => send(said);
  });
}

/* ---------- care plan ---------- */
function planView(canon) {
  const plan = readPlan(canon.profile);
  const draw = () => {
    const meds = currentMeds(canon);
    root.innerHTML = `<header class="spoke-head"><button class="back" data-back aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Monitor</span></button><h2>Care plan</h2></header>
    <article class="card"><div class="fit plan">
      <p class="kicker">Habits · he sees one a day</p>
      <div class="plan-list">${plan.habits.map((h, i) => `<div class="plan-row"><button class="toggle ${h.on !== false ? 'on' : ''}" data-tog="${i}" aria-pressed="${h.on !== false}" aria-label="Turn ${esc(h.text)} ${h.on !== false ? 'off' : 'on'}"><i></i></button><span>${esc(h.text)}</span><button class="x" data-rm="${i}" aria-label="Remove">×</button></div>`).join('') || '<p class="soft">No habits yet.</p>'}</div>
      <button class="pill" data-addh>+ Add a habit</button>
      <p class="kicker">Medicines · the same list ${esc(him())} sees and corrects</p>
      <div class="plan-list">${meds.current.map(m => `<div class="plan-row"><span><b>${esc(medLine(m))}</b></span><button class="x" data-stop="${esc(m.name)}" aria-label="Mark ${esc(m.name)} as stopped">×</button></div>`).join('')}${meds.unconfirmed.map(m => `<div class="plan-row"><span><b>${esc(medLine(m))}</b> · not confirmed</span></div>`).join('') || (meds.current.length ? '' : '<p class="soft">None recorded yet. Add one once his doctor prescribes it.</p>')}</div>
      <button class="pill" data-addm>+ Add a medicine</button>
    </div></article>
    <button class="btn primary" data-save>Save care plan</button>`;
    root.querySelector('[data-back]').onclick = () => { view = 'home'; render(); };
    root.querySelectorAll('[data-tog]').forEach(b => b.onclick = () => { const h = plan.habits[+b.dataset.tog]; h.on = h.on === false; draw(); });
    root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { plan.habits.splice(+b.dataset.rm, 1); draw(); });
    // Medicines save straight to the shared list (with a change log), not the care plan.
    const saveMed = async (p, done) => {
      const row = (canon.medications || (canon.medications = [])).find(m => m.name === p.name);
      if (row) Object.assign(row, { dose: p.dose ?? row.dose, frequency: p.frequency ?? row.frequency, status: p.status ?? row.status });
      else canon.medications.push({ name: p.name, dose: p.dose || '', frequency: p.frequency || '', status: p.status || 'current' });
      draw();
      const r = await ctx.save('medication', p);
      ctx.toast(r.ok ? done : 'Kept on this phone. It will save when you are online.');
    };
    root.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => {
      if (confirm(`Mark ${b.dataset.stop} as stopped? It stays in his history.`)) saveMed({ name: b.dataset.stop, status: 'stopped', existing: true }, 'Marked as stopped');
    });
    root.querySelector('[data-addh]').onclick = () => openSheet(`<p class="kicker">Add a habit</p>
      <div class="nudge-picks">${HABIT_IDEAS.filter(x => !plan.habits.some(h => h.text === x)).map(x => `<button class="pill" data-h="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <input id="habitText" maxlength="60" placeholder="Or write your own, short and specific">
      <button class="btn primary" data-ok>Add</button>`, (sheet, close) => {
      const inp = sheet.querySelector('#habitText');
      sheet.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { inp.value = b.dataset.h; });
      sheet.querySelector('[data-ok]').onclick = () => { const t = inp.value.trim(); if (t) { plan.habits.push({ text: t, on: true }); close(); draw(); } };
    });
    // Family adds what they know; by default he confirms it himself on his phone,
    // so the list only says "taking" once he has said so.
    root.querySelector('[data-addm]').onclick = () => openSheet(`<p class="kicker">Add a medicine</p>
      <select id="medName" class="msel"><option value="">Choose a medicine</option>${MED_CATALOG.map(([n]) => `<option>${esc(n)}</option>`).join('')}</select>
      <select id="medDose" class="msel" disabled><option value="">Strength: not sure</option></select>
      <select id="medWhen" class="msel"><option value="">When: not sure</option>${MED_WHEN.map(w => `<option>${esc(w)}</option>`).join('')}</select>
      <div class="nudge-picks"><button class="pill on" data-st="unconfirmed">Ask ${esc(him())} to confirm</button><button class="pill" data-st="current">I know he takes it</button></div>
      <button class="btn primary" data-ok disabled>Add</button>`, (sheet, close) => {
      let status = 'unconfirmed';
      const nameSel = sheet.querySelector('#medName'), doseSel = sheet.querySelector('#medDose'), ok = sheet.querySelector('[data-ok]');
      nameSel.onchange = () => {
        doseSel.innerHTML = '<option value="">Strength: not sure</option>' + strengthsOf(nameSel.value).map(d => `<option>${esc(d)}</option>`).join('');
        doseSel.disabled = !nameSel.value; ok.disabled = !nameSel.value;
      };
      sheet.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { status = b.dataset.st; sheet.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b)); });
      ok.onclick = () => {
        const n = nameSel.value; if (!n) return;
        close();
        saveMed({ name: n, dose: doseSel.value, frequency: sheet.querySelector('#medWhen').value, status }, status === 'unconfirmed' ? `Added. ${him()} will be asked to confirm it.` : 'Added to his medicines');
      };
    });
    root.querySelector('[data-save]').onclick = async () => {
      const value = JSON.stringify(plan);
      (canon.profile || (canon.profile = {})).care_plan = value;
      view = 'home'; render();
      const r = await ctx.save('profile', { key: 'care_plan', value });
      ctx.toast(r.ok ? `Care plan saved. ${him()} sees it from today.` : 'Saved on this phone, will sync');
    };
    requestAnimationFrame(() => root.querySelectorAll('.fit').forEach(ctx.fit));
  };
  draw();
}
