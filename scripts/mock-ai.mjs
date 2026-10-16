// A scripted stand-in for the model, for local runs and UI tests only
// (dev server with MOCK_AI=1). It returns the same JSON shapes the real
// prompts ask for and streams its text the way the real stream does.
const sleep = ms => new Promise(r => setTimeout(r, ms));

function latest(user) {
  const text = Array.isArray(user) ? user.filter(b => b.type === 'text').map(b => b.text).join('\n') : String(user);
  return { text, msg: (text.split(/\n# Latest message from [^\n]*\n/)[1] || text).trim(), image: Array.isArray(user) && user.some(b => b.type === 'image') };
}

const PHOTO_ROWS = [
  { date: '2026-10-12', test: 'Lipid studies', result: 'Total 4.1; LDL-C 2.1; HDL-C 1.2; Non-HDL-C 2.9; Triglycerides 1.4 mmol/L', lab: 'Example Pathology', notes: 'LDL target under 1.8' },
  { date: '2026-10-12', test: 'LDL-C', result: '2.1 mmol/L', lab: 'Example Pathology', notes: 'H' },
];

// The name the server told Leffy to use for Kimon ("your dad", "Kim", "you").
function term(text) {
  if (/Talk to him directly as "you"/.test(text)) return { name: 'you', poss: 'your' };
  const t = (text.match(/refer to Kimon as "([^"]+)"/i) || [, 'Kimon'])[1];
  return { name: t, poss: t + "'s" };
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function chat(msg, image, who) {
  const m = msg.toLowerCase();
  if (image) return {
    reply: 'Good news in this one. His LDL (the bad cholesterol) is 2.1, down from 4.0 in August. That is a big drop. The goal for him is under 1.8, so he is close. Shall I save these results to his record?',
    urgency: 'routine', doNow: ['Tap Save so his record has the new numbers.'], watchFor: [], askTheDoctor: ['Is 2.1 low enough, or should we aim for under 1.4?'],
    evidence: [{ point: 'Lower LDL means fewer heart attacks', ref: '34' }], usedFromRecord: ['LDL 4.0 in Aug 2026'],
    replies: ['Yes, save them', 'Is 2.1 good enough?', 'What should he eat?'], learned: [], results: PHOTO_ROWS, limits: '',
  };
  if (/chest/.test(m) && /(now|right now|minutes)/.test(m)) return {
    reply: 'This could be a heart attack. He needs to call 000 now and ask for an ambulance. Sit him down and stop everything. Do not let him drive.',
    urgency: 'emergency', doNow: ['He calls 000 now and asks for an ambulance.', 'Sit or lie down, unlock the front door.'], watchFor: [], askTheDoctor: [],
    evidence: [{ point: 'Chest pain lasting minutes needs 000', ref: '1' }], usedFromRecord: ['Severe calcium score'],
    replies: ['He has called 000', "He can't get to a phone", 'The pain has stopped'], learned: [], results: [], limits: '',
  };
  if (/dizz/.test(m)) return {
    reply: who.name === 'you'
      ? 'Dizziness when you stand up is usually your blood pressure dropping for a moment, not your heart arteries. It is common and easy to check. Your GP can measure your blood pressure lying down, then standing. How long does each dizzy spell last?'
      : 'Dizziness when he stands up is usually his blood pressure dropping for a moment, not his heart arteries. It is common and easy to check. His GP can measure his blood pressure lying down, then standing. How long does each dizzy spell last?',
    urgency: 'soon', doNow: ['Book his GP this week for a lying and standing blood pressure check.', 'Stand up slowly and count to three.'], watchFor: ['Fainting, or dizziness with chest pain: call 000.'], askTheDoctor: ['Could his blood pressure be dropping when he stands?'],
    evidence: [{ point: 'Standing dizziness is often low blood pressure on standing', ref: 'general' }], usedFromRecord: ['No blood pressure reading on file'],
    replies: ['A few seconds', 'Over a minute', 'Not sure'],
    learned: /week|day|morning|times/.test(m) ? [{ topic: 'symptom', fact: 'Dizzy when standing up, about twice a week (Oct 2026)' }] : [], results: [], limits: 'Only a blood pressure check can confirm it.',
  };
  if (/second|minute/.test(m)) return {
    reply: 'A few seconds that passes when he steadies himself fits a short blood pressure dip. That is reassuring. Keep the GP check this week, and keep him standing up slowly.',
    urgency: 'soon', doNow: ['Keep the GP blood pressure check this week.'], watchFor: ['Spells lasting longer than a minute.'], askTheDoctor: [],
    evidence: [], usedFromRecord: [], replies: ['What else could cause it?', 'Should he stop driving?', 'Thanks Leffy'],
    learned: [{ topic: 'symptom', fact: 'Dizzy spells last a few seconds and pass on their own (Oct 2026)' }], results: [], limits: '',
  };
  if (/thank/.test(m)) return { reply: 'Anytime. I am here whenever you need me. Siga siga.', urgency: 'routine', doNow: [], watchFor: [], askTheDoctor: [], evidence: [], usedFromRecord: [], replies: ['How is his cholesterol?', 'What should we ask the cardiologist?'], learned: [], results: [], limits: '' };
  return {
    reply: who.name === 'you'
      ? 'Your calcium score of 500 means there is a lot of hard plaque (fatty build-up) in your heart arteries. It does not mean they are blocked. The main job now is bringing your LDL cholesterol down and seeing the cardiologist.'
      : `${cap(who.poss)} calcium score of 500 means there is a lot of hard plaque (fatty build-up) in his heart arteries. It does not mean they are blocked. The main job now is bringing his LDL cholesterol down and seeing the cardiologist.`,
    urgency: 'routine', doNow: ['Ask his GP about a strong statin (a cholesterol-lowering pill).'], watchFor: ['Chest pain on walking: get him seen today.'], askTheDoctor: ['What LDL target do you want for him?'],
    evidence: [{ point: 'Calcium score over 400 is severe', ref: '5' }], usedFromRecord: ['Calcium score 500'],
    replies: ['Is he at risk of a heart attack?', 'What tests come next?', 'Can he still exercise?'], learned: [], results: [], limits: 'The score cannot show how narrow the arteries are.',
  };
}

export async function mockComplete({ system, user, onProgress = () => {}, onText = () => {}, web }) {
  const { msg, image, text: prompt } = latest(user);
  let out;
  if (/"kind":/.test(system)) out = { kind: 'lab report', summary: 'A cholesterol blood test from 12 October. His LDL is 2.1, much lower than before.', results: PHOTO_ROWS, unreadable: '' };
  else {
    if (web && /cost|pbs|price/i.test(msg)) { onProgress({ kind: 'search' }); await sleep(300); onProgress({ kind: 'results', n: 5 }); }
    await sleep(400);
    out = chat(msg, image, term(prompt));
  }
  const text = JSON.stringify(out);
  onText(null); onProgress({ kind: 'writing' });
  for (let i = 0; i < text.length; i += 24) { onText(text.slice(i, i + 24)); await sleep(12); }
  return { text, model: 'mock', tools: 'none', sources: [] };
}
