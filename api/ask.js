// Chat with Leffy. Each message gets an evidence-grounded reply on the spot.
// Order of operations: deterministic red-flag triage first (never depends on
// the model), then a model reply grounded in the evidence corpus, his live
// record and the knowledge bank, streamed as it is written, then the message
// is logged to the sheet and any new facts are added to the knowledge bank.
import { requireAuth, byFor } from '../lib/auth.js';
import { readCanon, write } from '../lib/sheet.js';
import { corpus, retrieve, refsFor } from '../lib/knowledge.js';
import { complete } from '../lib/ai.js';
import { replyStream } from '../lib/reply-stream.js';
import { RESULTS_RULES, cleanResults, imageBlock, checkImage } from '../lib/photo.js';
import { triage, maxLevel, LEVELS, CONTACTS, CONTACTS_SELF } from '../public/js/triage.js';
import { bank, bankText, facts, factNote, FACT_TOPICS } from '../public/js/knowledge-bank.js';
import { melbDay } from '../public/js/kimon-model.js';
import { person } from '../public/js/people.js';
import { roster } from '../lib/people.js';

const PII_KEYS = /medicare|address|street|phone|mobile|email|dob|birth|postcode|ihi|dva|insurance number/i;

export function patientContext(canon) {
  if (!canon) return 'His live record could not be loaded right now. Answer from the evidence corpus and say that his record was unavailable.';
  const profile = Object.entries(canon.profile || {})
    .filter(([k]) => !PII_KEYS.test(k) && k !== 'care_plan')
    .map(([k, v]) => `${k}: ${v}`).join('\n');
  const rows = (arr, n, fn) => (arr || []).slice(-n).map(fn).join('\n') || '(none recorded)';
  const routine = /^(nudge-seen|habit|meds-taken|fact|concern)$/;
  return [
    '## Profile', profile || '(none)',
    '## Care plan the family set', String(canon.profile?.care_plan || '(default plan)').slice(0, 600),
    '## Conditions', rows(canon.conditions, 30, c => `- ${c.name} [${c.status}] since ${c.since}. ${c.notes}`),
    '## Medications', rows(canon.medications, 30, m => `- ${m.name} ${m.dose} ${m.frequency} [${m.status}] started ${m.started}`),
    '## Test results', rows(canon.testResults, 60, t => `- ${t.date} ${t.test}: ${t.result}${t.notes ? ' (' + t.notes + ')' : ''}`),
    '## Recent check-ins (oldest first)', rows(canon.checkins, 8, c => `- ${c.tsMelb}: chest=${c.chest} breath=${c.breath} walking=${c.walking} energy=${c.energy} tablets=${c.tablets} mood=${c.mood} -> ${c.verdict}. ${c.notes}`),
    '## Recent logs and notes (oldest first)', rows((canon.notes || []).filter(n => n.by !== 'claude-test' && !routine.test(n.tag)), 20, n => `- ${String(n.tsUTC).slice(0, 10)} [${n.tag}] by ${n.by}: ${String(n.text).replace(/\n(RID|DATA):[\s\S]*$/, '')}`),
    '## Open questions for clinicians', rows((canon.questions || []).filter(q => q.status !== 'answered'), 20, q => `- ${q.id} (${q.askWhom}, p${q.priority}): ${q.question}`),
    '## Knowledge gaps', rows(canon.gaps, 20, g => `- ${g.id} [${g.status}] ${g.gap}. Closed by: ${g.whatAnswersIt}`),
    '## Knowledge bank (distilled from every entry since records began)', bankText(bank(canon)),
  ].join('\n');
}

function systemPrompt() {
  return `You are Leffy (short for Lefteris), the heart helper inside "Beside", a private chat app used by Kimon, a 67-year-old Greek-Australian man in Melbourne, Victoria, Australia, and his family. Kimon has severe coronary artery calcification and is in the cardiology referral pathway. His daughter lives overseas and supports him remotely. Either Kimon himself or a family member is chatting with you; you are told who.

Your character: a warm, steady Greek-Australian man who talks like a cardiologist who is also an old family friend. Kind, calm, a little playful when things are fine, never flippant about danger. You may use one Greek word now and then (such as "yia sou" or "siga siga"), at most once in a conversation, and never when something is urgent.

How to reply (this is what makes you useful):
- This is a chat. Reply like a person in a chat: short, warm, direct. Answer the question first, in plain words. A yes or no question gets "Yes" or "No" first. Never dodge.
- Talk to the person you are told is chatting, by their name now and then. Refer to Kimon exactly the way the "Who is chatting" section says, every time, in the reply, the lists and the suggested replies.
- Give real advice, the way a cardiologist who is a close family friend would. Say what you would do in their place, and why.
- Be specific to HIM: use his actual numbers, symptoms, medicines and history from his record and the knowledge bank.
- Explain what is probably happening in his body and how it links to his heart arteries. Say so plainly if it probably does not.
- Name standard treatments and tests that guidelines recommend for someone like him, by name (for example a strong statin such as atorvastatin or rosuvastatin, a CTCA scan, a stress echo).
- Concrete next steps: who to contact, how, and the exact words to use. "Ask your doctor" alone is never an answer.
- If one missing detail would change your advice, end with ONE short question. Then make the first suggested replies likely answers to it.
- The one firm limit: he must not start, stop or change a prescription medicine, aspirin or supplement without his doctor.
- Urgency must be honest. Use "emergency" for a possible heart attack, stroke, collapse, or breathlessness at rest. If symptoms are vague, choose the safer level and say what would change it.
- Small talk, thanks or a simple follow-up gets a short reply with empty lists. Only fill the lists when they help.
- Australian context: Medicare, PBS, Victorian services (000, Victorian Virtual ED at vved.org.au, NURSE-ON-CALL 1300 60 60 24, healthdirect 1800 022 222). Kimon is in Melbourne and can dial them. Family members who are overseas cannot dial Australian numbers from abroad.

Sources:
- Start from the evidence corpus below, his record and the knowledge bank.
- Use web search and web fetch only when they would make the reply better (current PBS rules, costs, services, or a question the corpus does not cover). Search is limited to trusted medical sites.
- Cite the corpus by its reference number, or a web page by its exact URL. Use "general" for well-known medical knowledge. Never invent studies, numbers or links.

The knowledge bank gets better with every chat. In "learned", record durable facts about Kimon that the person stated in THEIR LATEST MESSAGE (or that a photo shows) and that are not already in the knowledge bank: a symptom and how often, a medicine he takes, an appointment, a habit, family history. Write each as a short dated statement, e.g. "Dizzy for a few seconds when standing, about twice a week (Oct 2026)". If it updates a fact already in the bank, put the old fact's exact text in "replaces". Never record your own advice or guesses. Usually zero or one fact; at most three.

${RESULTS_RULES}

Reading age 12 (strict): short sentences, mostly under 15 words, everyday words. Explain any medical word in brackets the first time, e.g. "statin (a cholesterol-lowering pill)". Warm, calm and direct.

Return ONLY a JSON object, no markdown fences, with exactly these keys, "reply" first. Hard limits: reply at most 90 words; every list item at most 22 words; at most 3 items per list.
{
  "reply": "Your chat message: the direct answer, specific to him, ending with one short question only if you need it.",
  "urgency": "routine" | "soon" | "urgent" | "emergency",
  "doNow": ["Concrete actions, each naming who, what and how. Empty for small talk."],
  "watchFor": ["Specific signs that would make this more urgent, and what to do then."],
  "askTheDoctor": ["Precise questions for his GP or cardiologist, ready to read aloud."],
  "evidence": [{"point": "A short factual claim behind the reply.", "ref": "corpus reference number, a full URL from your web search, or 'general'"}],
  "usedFromRecord": ["Up to 4 short facts from his record or the knowledge bank you relied on."],
  "replies": ["2 to 4 things this person is most likely to say next, in their own voice (using what they call Kimon), 2 to 8 words each, genuinely different from each other."],
  "learned": [{"topic": "${FACT_TOPICS.join('" | "')}", "fact": "Short dated fact.", "replaces": "exact old fact text, or empty"}],
  "results": [{"date": "YYYY-MM-DD or empty", "test": "Test name", "result": "Value with unit", "lab": "", "notes": ""}],
  "limits": "One short sentence on what cannot be known without examining him. Empty for small talk."
}
"results" stays empty unless a photo is attached.

# Evidence corpus (Australian care guide, October 2026)
${corpus().body}`;
}

function extractJson(text) {
  const t = String(text || '').replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model did not return JSON');
  return JSON.parse(t.slice(start, end + 1));
}

const str = (x, n = 2000) => String(x ?? '').trim().slice(0, n);
export function clean(a) {
  const arr = (x, n) => (Array.isArray(x) ? x : []).map(v => typeof v === 'string' ? v.trim() : v).filter(Boolean).slice(0, n);
  const reply = str(a.reply || a.headline);
  return {
    urgency: LEVELS.includes(a.urgency) ? a.urgency : 'soon',
    reply, headline: reply,
    doNow: arr(a.doNow, 3), watchFor: arr(a.watchFor, 3), askTheDoctor: arr(a.askTheDoctor, 3),
    evidence: arr(a.evidence, 4).filter(e => e && e.point),
    usedFromRecord: arr(a.usedFromRecord, 4),
    replies: arr(a.replies, 4).filter(r => typeof r === 'string').map(r => r.slice(0, 60)),
    learned: arr(a.learned, 3).filter(f => f && typeof f.fact === 'string' && f.fact.trim()).map(f => ({ topic: FACT_TOPICS.includes(f.topic) ? f.topic : 'other', fact: str(f.fact, 300), replaces: str(f.replaces, 300) })),
    results: Array.isArray(a.results) ? a.results : [],
    limits: str(a.limits, 400),
  };
}

function withSources(answer, webSources = []) {
  const { refs } = corpus();
  const seen = new Map(webSources.map(w => [w.url.replace(/\/$/, ''), w]));
  answer.evidence = answer.evidence.map(e => {
    const ref = String(e.ref || '').trim();
    if (/^https?:\/\//.test(ref)) {
      // Only keep a link the model actually retrieved; never an invented one.
      const w = seen.get(ref.replace(/\/$/, ''));
      return w ? { point: e.point, ref: 'web', title: w.title, url: w.url } : { point: e.point, ref: 'general' };
    }
    const id = ref.replace(/[^\d]/g, '');
    const r = refs[id];
    return r ? { point: e.point, ref: id, title: r.title, url: r.url } : { point: e.point, ref: 'general' };
  });
  return answer;
}

export function fallbackAnswer(message, level, reasons, self = false) {
  const C = self ? CONTACTS_SELF : CONTACTS;
  const hits = level === 'routine' ? retrieve(message, 1) : [];
  const snippet = hits.length
    ? `${hits[0].heading}: ${hits[0].text.replace(/\[\^\d+\]/g, '').replace(/\s+/g, ' ').slice(0, 260).replace(/\s\S*$/, '')}...`
    : '';
  const reply = level === 'routine'
    ? `I can't reach my full brain right now, so this is the closest part of his care guide. No warning signs in what you said. ${snippet}`.trim()
    : `${C[level].title}. ${reasons[0] || ''}. I'm offline right now, so this is from the warning-sign rules only.`;
  return {
    urgency: level, reply, headline: reply,
    doNow: C[level].lines, watchFor: [], askTheDoctor: [],
    evidence: hits.flatMap(h => refsFor(h.text).slice(0, 2)).map(r => ({ point: r.title, ref: r.id, title: r.title, url: r.url })),
    usedFromRecord: [], replies: level === 'emergency' ? ['He has called 000', 'He can\'t get to a phone'] : ['Try again', 'What should we ask his GP?'],
    learned: [], results: [], limits: 'Rule-based reply only; not personalised to his record.',
  };
}

// Who is chatting, and exactly how to refer to Kimon to them.
export function speakerContext(me) {
  if (me.kimon) return 'Kimon himself (the patient; he also goes by Kim). Talk to him directly as "you" and "your" ("your calcium score"). Never call him "your dad" or talk about him in the third person.';
  const name = me.name || 'A family member';
  const how = me.known
    ? `${name} calls him "${me.calls}". When you talk to ${name}, refer to Kimon as "${me.leffy}" (for example "${me.leffyPoss} calcium score"), and write suggested replies the way ${name} would say it ("${me.himPoss} calcium score").`
    : `Refer to Kimon as "Kimon" (for example "Kimon's calcium score"). Do not call him "your dad": you do not know how ${me.name || 'they'} are related to him.`;
  return `${name}, a family member. ${how}`;
}

function transcript(thread = [], who) {
  const turns = (Array.isArray(thread) ? thread : []).slice(-12)
    .map(t => `${t.role === 'leffy' ? 'Leffy' : who}: ${str(t.text, 700)}`).join('\n');
  return turns || '(this is the first message)';
}

// Streams newline-delimited JSON: {type:'stage'} progress, {type:'delta'}
// reply text as it is written, {type:'ping'} keep-alives, one {type:'answer'},
// then {type:'learned'}. A phone that loses the connection can fetch the saved
// answer later from /api/answer?rid=.
export default async function handler(req, res) {
  const role = requireAuth(req, res);
  if (!role) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const body = req.body || {};
  const image = body.image || null;
  const bad = checkImage(image);
  if (bad) return res.status(400).json({ ok: false, error: bad });
  const message = str(body.message ?? body.concern, 2000) || (image ? 'Here is a photo. What does it show?' : '');
  const by = byFor(role, body.by);
  const rid = String(body.rid || '').replace(/[^a-z0-9]/gi, '').slice(0, 24) || Math.random().toString(36).slice(2, 12);
  const threadId = String(body.threadId || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  const thread = Array.isArray(body.thread) ? body.thread : [];
  if (message.length < 2) return res.status(400).json({ ok: false, error: 'Say or type something first' });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let open = true;
  res.on('close', () => { open = false; });
  const send = obj => { if (open) { try { res.write(JSON.stringify(obj) + '\n'); } catch { open = false; } } };
  const ping = setInterval(() => send({ type: 'ping' }), 5000);

  try {
    // The rules floor is this message; with no model, earlier messages count too.
    const rules = triage(message);
    const threadRules = triage([...thread.filter(t => t.role !== 'leffy').map(t => t.text), message].join('\n'));
    send({ type: 'stage', text: image ? 'Looking at the photo' : 'Reading his record', rid, triage: rules });

    let canon = null, recordError = null;
    try { canon = await readCanon({ timeoutMs: 9000 }); }
    catch (e) { recordError = e.code === 'NO_SECRET' ? 'Sheet not connected yet' : 'His record could not be loaded'; }

    const me = person({ role, who: by === 'app' ? '' : by, calls: body.calls, roster: roster() });
    const who = me.kimon ? 'Kimon' : me.name || 'Family';
    const speaker = speakerContext(me);
    const text = `# Who is chatting\n${speaker}\n\n# His live record (from the family's Google Sheet)\n${patientContext(canon)}\n\n# Rule-based triage already shown\nlevel=${rules.level}; reasons=${rules.reasons.join('; ') || 'none'}\n\n# Conversation so far\n${transcript(thread, who)}\n\n# Latest message from ${who}${image ? ' (with a photo attached)' : ''}\n${message}`;

    send({ type: 'stage', text: 'Checking the heart guide' });
    let answer, source, searches = 0, pages = 0;
    const rs = replyStream();
    try {
      const out = await complete({
        req,
        system: systemPrompt(),
        user: image ? [imageBlock(image), { type: 'text', text }] : text,
        onText: d => { if (d === null) rs.reset(); else { const add = rs.push(d); if (add) send({ type: 'delta', text: add }); } },
        onProgress: p => {
          if (p.kind === 'search') send({ type: 'stage', text: `Searching trusted medical sites (${++searches})` });
          else if (p.kind === 'results') { pages += p.n; send({ type: 'stage', text: `Found ${pages} trusted pages` }); }
          else if (p.kind === 'fetch' || p.kind === 'read') send({ type: 'stage', text: 'Reading a source in full' });
          else if (p.kind === 'writing') send({ type: 'stage', text: 'Typing' });
        },
      });
      answer = withSources(clean(extractJson(out.text)), out.sources);
      source = { kind: 'ai', model: out.model, web: out.tools, searched: out.sources.length };
    } catch (e) {
      answer = fallbackAnswer(message, maxLevel(rules.level, threadRules.level), (threadRules.reasons.length ? threadRules : rules).reasons, me.kimon);
      console.error(JSON.stringify({ askFallback: e.code || 'ERR', message: String(e.message).slice(0, 200) }));
      source = { kind: 'rules', reason: e.code === 'NO_AI' ? 'AI not configured' : 'AI unavailable: ' + e.message.slice(0, 120) };
    }

    // The model may raise urgency but never lower it below the red-flag rules.
    answer.urgency = maxLevel(answer.urgency, rules.level);
    answer.results = image ? cleanResults(answer.results, canon || {}, melbDay(new Date())) : [];
    // Only facts the bank does not hold yet.
    const known = new Set(facts(canon || {}).map(f => f.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
    const learned = answer.learned.filter(f => !known.has(f.fact.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
    answer.learned = learned;
    const payload = { ok: true, rid, threadId, concern: message, triage: rules, answer, contacts: (me.kimon ? CONTACTS_SELF : CONTACTS)[answer.urgency], source, recordLoaded: Boolean(canon), recordError };

    let saved = false;
    if (canon) {
      try {
        // Full reply kept with its request id, so a dropped connection can recover it.
        await write('note', {
          text: `CONCERN: ${image ? '[photo] ' : ''}${message}\nURGENCY: ${answer.urgency}\nANSWER: ${answer.reply}\nRID: ${rid}\nDATA: ${JSON.stringify({ answer, source, threadId })}`.slice(0, 40000),
          tag: 'concern',
        }, by, { timeoutMs: 10000 });
        saved = true;
      } catch { /* reply still returned; the phone shows not-saved */ }
    }
    send({ type: 'answer', ...payload, saved });

    // Grow the knowledge bank after the reply is on screen.
    if (canon && learned.length) {
      let n = 0;
      for (const f of learned) {
        try { await write('note', factNote(f, image ? 'photo' : 'chat'), by, { timeoutMs: 10000 }); n++; } catch { /* keep going */ }
      }
      send({ type: 'learned', facts: learned, saved: n });
    }
  } catch (e) {
    console.error(JSON.stringify({ askCrash: String(e.message).slice(0, 300) }));
    send({ type: 'error', error: 'Something went wrong on the server. Please try again.' });
  } finally {
    clearInterval(ping);
    if (open) res.end();
  }
}
