// "What's new": a one-time sheet the next time Kimon opens his app after a
// change he would notice. Each item has its own id; once he closes the sheet
// those ids are never shown again on this phone. Invisible fixes add nothing.
// Rule for every future change he would notice: add one item with a new id.
import { createLeffy } from './leffy.js';

export const WHATS_NEW = [
  { id: '2026-11-doctor', icon: 'doctor', tone: 'bp', title: 'For my doctor',
    line: 'Your numbers and the best questions to ask, on one page.', action: 'doctor' },
  { id: '2026-11-photo', icon: 'cam', tone: 'fam', title: 'Photos, explained',
    line: 'Leffy reads a photo of a result, says what it means, and saves it.', action: 'photo' },
  { id: '2026-11-email', icon: 'doc', tone: 'bp', title: 'Email your doctor\'s letters',
    line: 'Forward any doctor\'s email with a letter or result to Beside in your contacts. It appears here to check.' },
  { id: '2026-11-tablets', icon: 'pill', tone: 'tabl', title: 'Tablets, exactly',
    line: 'Today names exactly the tablets one tap ticks.' },
];

const KEY = 'kimon.me.seenNew';
let shownThisSession = false;

function seen(storage) {
  try { return new Set(JSON.parse(storage.getItem(KEY) || '[]')); } catch { return new Set(); }
}
function markSeen(storage, ids) {
  try { storage.setItem(KEY, JSON.stringify([...new Set([...seen(storage), ...ids])])); } catch { /* blocked: once per session instead */ }
}

// What to show: unseen items, and only on a phone that has used the app
// before (a first-time user needs no "what's new").
export function unseen(storage, { hasHistory = true } = {}) {
  if (shownThisSession) return [];
  const s = seen(storage);
  const items = WHATS_NEW.filter(x => !s.has(x.id));
  if (items.length && !hasHistory) { markSeen(storage, items.map(x => x.id)); return []; }
  return items;
}

// icon(id) returns the app's own SVG icon. onAction(action) runs "Show me".
export function showWhatsNew({ storage, icon, onAction, hasHistory = true }) {
  const items = unseen(storage, { hasHistory });
  if (!items.length || document.querySelector('.wn')) return false;
  shownThisSession = true;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = document.createElement('div');
  root.className = 'wn';
  root.innerHTML = `<div class="wn-scrim" data-wn-close></div>
    <section class="wn-sheet" role="dialog" aria-modal="true" aria-labelledby="wn-title">
      <button class="wn-x" data-wn-close aria-label="Close">${icon('x')}</button>
      <div class="wn-leffy" aria-hidden="true"></div>
      <span class="wn-eyebrow">What's new</span>
      <h2 id="wn-title" tabindex="-1">${items.length === 1 ? 'One new thing' : `${items.length} new things`}</h2>
      <div class="wn-cards">${items.map((x, i) => `<div class="wn-card" style="--i:${i}">
        <span class="j-ic ${esc(x.tone)}">${icon(x.icon)}</span>
        <span class="wn-tx"><b>${esc(x.title)}</b><small>${esc(x.line)}</small>${x.action ? `<button class="wn-go" data-wn-go="${esc(x.action)}">Show me</button>` : ''}</span>
      </div>`).join('')}</div>
      <button class="btn primary wn-ok" data-wn-close>Got it</button>
    </section>`;
  document.body.appendChild(root);
  const app = document.getElementById('me');
  app?.setAttribute('inert', '');
  const lf = createLeffy(root.querySelector('.wn-leffy'));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) { lf.set('happy'); setTimeout(() => lf.set('idle'), 1600); }
  requestAnimationFrame(() => root.classList.add('in'));
  root.querySelector('#wn-title').focus();

  const close = (after) => {
    markSeen(storage, items.map(x => x.id));
    document.removeEventListener('keydown', key, true);
    app?.removeAttribute('inert');
    root.classList.remove('in');
    setTimeout(() => root.remove(), reduce ? 0 : 220);
    after?.();
  };
  // Escape closes; Tab stays inside the sheet.
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button')];
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  };
  document.addEventListener('keydown', key, true);
  root.querySelectorAll('[data-wn-close]').forEach(b => b.addEventListener('click', () => close()));
  root.querySelectorAll('[data-wn-go]').forEach(b => b.addEventListener('click', () => close(() => onAction?.(b.dataset.wnGo))));
  return true;
}
