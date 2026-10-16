// Leffy, the chat's Greek-Australian heart helper: an SVG character with
// separate parts so he can blink, listen, think and talk. States are CSS
// classes on the wrapper: idle | listening | thinking | speaking | happy.
let uid = 0;

export function leffySvg() {
  const id = 'lf' + (++uid);
  return `<svg viewBox="0 0 120 120" role="img" aria-label="Leffy" focusable="false">
  <defs>
    <clipPath id="${id}c"><circle cx="60" cy="60" r="60"/></clipPath>
    <radialGradient id="${id}g" cx="50%" cy="30%" r="80%"><stop offset="0" class="lf-bg1"/><stop offset="1" class="lf-bg2"/></radialGradient>
  </defs>
  <g clip-path="url(#${id}c)">
    <rect width="120" height="120" fill="url(#${id}g)"/>
    <g class="lf-body">
      <path d="M12 124C14 103 33 93 60 93s46 10 48 31z" fill="#1f3b63"/>
      <path d="M48 93.5 60 106l12-12.5-5.5-1.5L60 98.5 53.5 92z" fill="#f3efe6"/>
      <path d="M45.5 95.5c-2 9.5 2.5 16.5 10 18M74.5 95.5c2 9.5-2.5 16.5-10 18" stroke="#cfd5dd" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <circle cx="60" cy="114.5" r="4.6" fill="#dfe4ea" stroke="#9aa4b0" stroke-width="1.3"/>
      <path d="M88 107.5c-4-2.9-5.4-4.7-5.4-6.5 0-1.6 1.3-2.8 2.8-2.8 1.1 0 2 .6 2.6 1.5.6-.9 1.5-1.5 2.6-1.5 1.5 0 2.8 1.2 2.8 2.8 0 1.8-1.4 3.6-5.4 6.5z" fill="#e0453a"/>
    </g>
    <g class="lf-head">
      <rect x="51" y="80" width="18" height="16" rx="6" fill="#cf8f62"/>
      <path d="M31 58c-2.5-9-1-18 4-23h50c5 5 6.5 14 4 23-1.5-3.5-3.5-6-5.5-7H36.5c-2 1-4 3.5-5.5 7z" fill="#bdb7b0"/>
      <path d="M33 52.5c1.6-2 3.4-2.6 5-2.4M87 52.5c-1.6-2-3.4-2.6-5-2.4" stroke="#a29c95" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <ellipse cx="33.5" cy="62" rx="4.6" ry="7" fill="#d9996c"/>
      <ellipse cx="86.5" cy="62" rx="4.6" ry="7" fill="#d9996c"/>
      <ellipse cx="60" cy="60" rx="26" ry="28" fill="#e6ad80"/>
      <circle cx="44" cy="69" r="5.5" fill="#ec8b74" opacity=".3"/><circle cx="76" cy="69" r="5.5" fill="#ec8b74" opacity=".3"/>
      <g class="lf-brows" stroke="#6e6863" stroke-width="3.8" stroke-linecap="round" fill="none">
        <path class="lf-brow-l" d="M41 48.5c4-3.5 10-3.5 13.5-1.5"/>
        <path class="lf-brow-r" d="M65.5 47c3.5-2 9.5-2 13.5 1.5"/>
      </g>
      <g class="lf-pupils">
        <g class="lf-eye"><ellipse cx="47.5" cy="56.5" rx="3.1" ry="3.7" fill="#2a2320"/><circle cx="48.6" cy="55.3" r="1" fill="#fff"/></g>
        <g class="lf-eye"><ellipse cx="72.5" cy="56.5" rx="3.1" ry="3.7" fill="#2a2320"/><circle cx="73.6" cy="55.3" r="1" fill="#fff"/></g>
      </g>
      <path d="M39.5 56l-3.2-1.6M39.5 58.6l-3.2 1.2M80.5 56l3.2-1.6M80.5 58.6l3.2 1.2" stroke="#c78a5f" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M58.3 52.5c-.6 4.2-1.6 7.6-3 10.2-1.4 2.6-.4 5.6 2.6 6.2 1.4.3 3 .3 4.2 0 3-.6 4-3.6 2.6-6.2-1.4-2.6-2.4-6-3-10.2z" fill="#d79464"/>
      <path d="M57.4 67.2c.8.5 1.7.7 2.6.7s1.8-.2 2.6-.7" stroke="#bd7c50" stroke-width="1" fill="none" stroke-linecap="round"/>
      <g class="lf-mouth">
        <path class="lf-smile" d="M54 79.4c3 2.6 9 2.6 12 0" stroke="#7a3a33" stroke-width="1.7" fill="none" stroke-linecap="round"/>
        <g class="lf-open"><path d="M53.5 78.5c1.5 6 11.5 6 13 0-3.5 1.1-9.5 1.1-13 0z" fill="#6e2723"/><ellipse cx="60" cy="82.2" rx="3.6" ry="1.4" fill="#d16a5c"/></g>
      </g>
      <path class="lf-stache" d="M60 70.5c-4.5-3.7-13-3.9-18.8.9-2 1.8-.9 5 2 4.2 4.8-1.6 9.4.2 13.2 0 1.8-.1 3-1 3.6-2 .6 1 1.8 1.9 3.6 2 3.8.2 8.4-1.6 13.2 0 2.9.8 4-2.4 2-4.2-5.8-4.8-14.3-4.6-18.8-.9z" fill="#807a74"/>
      <path d="M47 70.5c3-1 6-.6 8.5.6M73 70.5c-3-1-6-.6-8.5.6" stroke="#a39d96" stroke-width="1" fill="none" stroke-linecap="round"/>
      <g class="lf-cap">
        <path d="M29 38c-1-11 13-18 31-18s32 7 31 18c-.2 1.6-2.4 2.4-5.5 2H34.5c-3.1.4-5.3-.4-5.5-2z" fill="#1f3b63"/>
        <path d="M33 26.5c8-4 46-4 54 0" stroke="#2b4d7c" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M32 38.6c16-2.6 40-2.6 56 0" stroke="#0b1424" stroke-width="2.2" stroke-dasharray="2.2 1.4" fill="none" stroke-linecap="round"/>
        <path d="M37 40c9 3.6 37 3.6 46 0-3.6 3.8-13 6-23 6s-19.4-2.2-23-6z" fill="#0f1b2d"/>
      </g>
    </g>
  </g>
</svg>`;
}

// One Leffy on screen. set(state) changes what he is doing; speak() keeps his
// mouth moving while words arrive, then settles back.
export function createLeffy(el) {
  el.classList.add('leffy');
  el.innerHTML = leffySvg();
  let state = 'idle', quiet = 0, happyT = 0;
  const apply = s => { el.classList.remove('idle', 'listening', 'thinking', 'speaking', 'happy'); el.classList.add(s); };
  apply('idle');
  return {
    get state() { return state; },
    set(s) { clearTimeout(quiet); clearTimeout(happyT); state = s; apply(s); },
    // Call on each chunk of text: he talks, and stops 700 ms after the last one.
    speak() {
      clearTimeout(quiet);
      if (state !== 'speaking') { state = 'speaking'; apply('speaking'); }
      quiet = setTimeout(() => this.done(), 700);
    },
    done() { clearTimeout(quiet); state = 'happy'; apply('happy'); happyT = setTimeout(() => { state = 'idle'; apply('idle'); }, 1400); },
  };
}
