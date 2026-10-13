// Deterministic red-flag triage. Runs in the browser (instantly, offline) and
// on the server (before any AI call). The AI can raise urgency, never lower it.
// Source: Heart Foundation / healthdirect heart-attack warning signs, 2025
// Australian ACS guideline (see knowledge/cac-evidence-corpus.md, refs 1-4).

export const LEVELS = ['routine', 'soon', 'urgent', 'emergency'];

const RULES = [
  // emergency: possible heart attack, stroke, arrhythmia with collapse
  { level: 'emergency', why: 'Chest pain or pressure that is happening now or lasting',
    re: /(chest|heart).{0,40}(pain|pressure|tight|heavy|heaviness|squeez|crush|ache|burning).{0,60}(right now|still (there|going|hurt)|won.?t (go|stop)|not (going away|stopping)|\d+ ?min|minutes|at rest|while resting|lying down|in bed|woke)|(pain|pressure|tight|heavy|heaviness|squeez|crush).{0,30}(chest).{0,60}(right now|still (there|going)|\d+ ?min|minutes|at rest|lying down|woke)/i },
  { level: 'emergency', why: 'Discomfort spreading to arm, jaw, neck, shoulder or back',
    re: /(pain|ache|discomfort|pressure|heavy|tingl).{0,40}(arm|jaw|neck|shoulder|back)|(arm|jaw|neck|shoulder).{0,30}(pain|ache|heavy|tingl).{0,40}(chest|sweat|breath|sick|nause)/i },
  { level: 'emergency', why: 'Fainting, collapse or loss of consciousness',
    re: /(faint(ed)?|pass(ed)? out|collaps|black(ed)? out|lost conscious|unconscious|unresponsive|fell (down|over) and)/i },
  { level: 'emergency', why: 'Breathless at rest or struggling to breathe',
    re: /(can.?t|cannot|couldn.?t|struggling to|hard to|difficulty) (catch (his|my)? ?breath|breathe|breathing)|breathless.{0,25}(at rest|sitting|lying|resting|talking)|short of breath.{0,25}(at rest|sitting|lying|resting)|gasping|blue lips/i },
  { level: 'emergency', why: 'Possible stroke signs (face, arm, speech)',
    re: /(face|mouth).{0,20}(droop|drooping|numb|lopsided)|slurr|can.?t (speak|talk|lift)|sudden(ly)? (weak|numb|confus|blind|can.?t see)|one side.{0,20}(weak|numb)/i },
  { level: 'emergency', why: 'Chest symptoms with sweating, nausea or feeling faint',
    re: /(chest|heart).{0,80}(sweat|clammy|nause|vomit|faint|grey|gray)|(sweat|clammy|grey|gray).{0,80}(chest)/i },
  // urgent: same day clinical contact
  { level: 'urgent', why: 'Racing or irregular heartbeat lasting minutes, or with dizziness',
    re: /(racing|pounding|fluttering|irregular|skipping|palpitation).{0,60}(minutes|hour|won.?t stop|dizzy|light.?headed|faint)|heart rate.{0,20}(1[4-9]\d|2\d\d)/i },
  { level: 'urgent', why: 'Chest discomfort brought on by exertion (possible angina)',
    re: /(chest|tight|pressure|heavy).{0,60}(walk|stairs|hill|exert|exercise|garden|effort|climb)|(walk|stairs|hill|exert|exercise|climb).{0,60}(chest|tight|pressure)/i },
  { level: 'urgent', why: 'Breathlessness that is new or getting worse',
    re: /(breath|puff|winded).{0,60}(worse|worsening|new|more than|getting|increas|sudden)|(worse|worsening|more).{0,30}(breathless|short of breath|out of breath|puffed)/i },
  { level: 'urgent', why: 'Very high or very low blood pressure reading',
    re: /(1[89]\d|2\d\d)\s*\/\s*\d{2,3}|\d{2,3}\s*\/\s*(1[1-9]\d)|(bp|blood pressure).{0,20}(very (high|low)|through the roof)|\b([5-8]\d)\s*\/\s*([3-4]\d)\b/i },
  { level: 'urgent', why: 'Swelling of the legs or ankles that is new',
    re: /(ankle|leg|feet|foot).{0,30}(swell|swollen|puffy)|(swell|swollen).{0,30}(ankle|leg|feet)/i },
  { level: 'urgent', why: 'Black stools, vomiting blood or unusual bleeding',
    re: /(black|tarry) (stool|poo|bowel)|vomit(ing|ed)? blood|coughing (up )?blood|blood in (his|my)? ?(urine|stool|poo|wee)|bleeding (that )?(won.?t|wouldn.?t) stop/i },
  // soon: book a GP within days
  { level: 'soon', why: 'Dizziness or light-headedness (often blood pressure on standing)',
    re: /(dizzy|dizziness|light.?headed|woozy|head rush|unsteady)/i },
  { level: 'soon', why: 'Palpitations or awareness of heartbeat',
    re: /(palpitation|flutter|skip(ped|ping)? beat|heart (racing|pounding)|irregular)/i },
  { level: 'soon', why: 'Breathlessness on exertion',
    re: /(breathless|short of breath|out of breath|puffed|winded)/i },
  { level: 'soon', why: 'Possible medicine side effect',
    re: /(side effect|muscle (ache|pain|cramp)|statin|tablet|medication).{0,40}(pain|ache|cramp|weak|sick|stopp|missed|rash)/i },
];

export function triage(text) {
  const t = String(text || '');
  const hits = RULES.filter(r => r.re.test(t));
  let level = 'routine';
  for (const h of hits) if (LEVELS.indexOf(h.level) > LEVELS.indexOf(level)) level = h.level;
  const reasons = [...new Set(hits.filter(h => h.level === level).map(h => h.why))];
  return { level, reasons };
}

export function maxLevel(a, b) {
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}

// Who to contact, by urgency. Victoria, Australia. The carer is overseas:
// Australian 000/1300/1800 numbers cannot be dialled from outside Australia.
export const CONTACTS = {
  emergency: {
    title: 'Call 000 now',
    lines: [
      'He calls 000 himself, or anyone with him does. Ask for an ambulance. He should not drive.',
      'You are overseas, so you cannot dial 000. If you are on the phone with him, tell him to hang up and call 000 now. If he cannot, call someone in Melbourne who can.',
      'While waiting: sit or lie down, stop all activity, unlock the front door. Only chew aspirin if the 000 operator tells him to.',
    ],
  },
  urgent: {
    title: 'Get him seen today',
    lines: [
      'Victorian Virtual ED: free video doctor 24/7, no appointment. vved.org.au',
      'NURSE-ON-CALL 1300 60 60 24 (24/7, from within Victoria).',
      'Or his GP today, asking for an urgent same-day appointment. If anything escalates, call 000.',
    ],
  },
  soon: {
    title: 'Book his GP this week',
    lines: [
      'Mention it at the GP, along with his calcium score result. Bring the notes from this app.',
      'healthdirect 1800 022 222 (24/7, within Australia) if you want a nurse to talk it through sooner.',
    ],
  },
  routine: {
    title: 'No warning signs detected',
    lines: ['Keep it on the list for the next GP or cardiology visit.'],
  },
};
