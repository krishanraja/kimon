// Who is using the app, and how Kimon is spoken about to them. Kimon is
// "you"; someone who calls him Dad hears "your dad"; someone who calls him
// Kim hears "Kim". The family list lives in Vercel env PEOPLE (this repo is
// public), e.g. [{"name":"Kimon","aliases":["Kim"],"patient":true},
// {"name":"Sam","calls":"Dad"}]. Pure functions; browser, server and tests.

// Words for a parent or grandparent: Leffy says "your dad", "your papou".
const RELATION = /^(dad|daddy|papa|pa|pop|father|baba|babas|bampas|papou|pappou|pappous|grandad|granddad|grandpa|grandfather|nonno|opa)$/i;
export const CALL_OPTIONS = ['Dad', 'Kim', 'Kimon', 'Papou'];

const clean = (s, n = 40) => String(s ?? '').replace(/[^\p{L}\p{N} '.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = s => clean(s).toLowerCase();

export function parseRoster(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(list)) return [];
  return list.map(p => ({
    name: clean(p?.name), aliases: (Array.isArray(p?.aliases) ? p.aliases : []).map(a => clean(a)).filter(Boolean).slice(0, 6),
    calls: clean(p?.calls, 30), patient: p?.patient === true,
  })).filter(p => p.name).slice(0, 20);
}

export function matchPerson(roster, name) {
  const k = key(name);
  if (!k) return null;
  return (roster || []).find(p => key(p.name) === k || p.aliases.some(a => key(a) === k)) || null;
}

// How Kimon is named to someone who calls him `calls`.
//   him / himPoss: in their own voice, for labels and suggested replies ("Dad", "Kim's")
//   leffy / leffyPoss: in Leffy's voice ("your dad", "your dad's", "Kim's")
export function refer(calls) {
  const c = clean(calls, 30) || 'Kimon';
  const poss = w => w + (/s$/i.test(w) ? "'" : "'s");
  if (RELATION.test(c)) {
    const word = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
    return { calls: word, him: word, himPoss: poss(word), leffy: 'your ' + word.toLowerCase(), leffyPoss: 'your ' + poss(word.toLowerCase()) };
  }
  const n = c.charAt(0).toUpperCase() + c.slice(1);
  return { calls: n, him: n, himPoss: poss(n), leffy: n, leffyPoss: poss(n) };
}

// The person on this phone. role comes from the session; who and calls from
// the phone (who they said they are, what they call him if not on the list).
export function person({ role, who, calls, roster } = {}) {
  if (role === 'kimon') {
    return { id: 'kimon', name: 'Kimon', kimon: true, known: true, calls: 'Kimon', him: 'Kimon', himPoss: "Kimon's", leffy: 'you', leffyPoss: 'your' };
  }
  const match = matchPerson(roster, who);
  const name = match?.name || clean(who);
  const said = match?.calls || clean(calls, 30);
  const r = refer(said);
  return { id: name ? 'p-' + key(name).replace(/[^a-z0-9]+/g, '-') : 'family', name, kimon: false, known: Boolean(name && said), patientName: Boolean(match?.patient), ...r };
}
