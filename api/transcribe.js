// Speech to text: the phone records audio, this turns it into words.
// Order: OpenAI direct (gpt-4o-transcribe, then whisper-1) with a vocabulary
// hint, then the Vercel AI Gateway if no OpenAI key is set or both fail.
import { requireAuth } from '../lib/auth.js';

const GATEWAY_MODELS = ['openai/gpt-4o-transcribe', 'openai/whisper-1'];
const OPENAI_MODELS = ['gpt-4o-transcribe', 'whisper-1'];
// Words the family is likely to say; biases spelling, never invents content.
const VOCAB = 'A family member in Australia talking about their dad Kimon and his heart health: coronary artery calcium score, Agatston, plaque, cardiologist, GP, CTCA, stress echo, angiogram, ECG, statin, atorvastatin, rosuvastatin, ezetimibe, aspirin, LDL, HDL, cholesterol, triglycerides, blood pressure, palpitations, breathless, dizzy, angina, HbA1c, eGFR, Medicare, PBS, healthdirect, Melbourne.';
const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

async function openaiTranscribe(model, audio, mediaType) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mediaType }), `speech.${EXT[mediaType] || 'webm'}`);
  form.append('model', model);
  form.append('language', 'en');
  form.append('prompt', VOCAB);
  form.append('response_format', 'json');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', signal: AbortSignal.timeout(45000),
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${model} returned non-JSON (HTTP ${r.status})`); }
  if (!r.ok) throw new Error(`${model} HTTP ${r.status}: ${String(body?.error?.message || '').slice(0, 160)}`);
  return String(body.text || '').trim();
}
const MAX_B64 = 4_000_000; // about 3 MB of audio, several minutes of speech

function token(req) {
  return process.env.AI_GATEWAY_API_KEY || req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
}

async function transcribe(model, audio, mediaType, req) {
  const r = await fetch('https://ai-gateway.vercel.sh/v4/ai/transcription-model', {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: {
      authorization: `Bearer ${token(req)}`,
      'content-type': 'application/json',
      'ai-gateway-protocol-version': '0.0.1',
      'ai-transcription-model-specification-version': '4',
      'ai-model-id': model,
    },
    body: JSON.stringify({ audio, mediaType }),
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${model} returned non-JSON (HTTP ${r.status})`); }
  if (!r.ok) throw new Error(`${model} HTTP ${r.status}: ${JSON.stringify(body).slice(0, 160)}`);
  return String(body.text || '').trim();
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const { audio, mediaType } = req.body || {};
  if (typeof audio !== 'string' || audio.length < 100) return res.status(400).json({ ok: false, error: 'No audio received' });
  if (audio.length > MAX_B64) return res.status(413).json({ ok: false, error: 'Recording too long' });
  if (!process.env.OPENAI_API_KEY && !token(req)) return res.status(503).json({ ok: false, error: 'Transcription not configured' });
  // Providers want the plain type ("audio/webm"), not codec parameters.
  const type = String(mediaType || 'audio/webm').split(';')[0].trim();
  const attempts = [
    ...(process.env.OPENAI_API_KEY ? OPENAI_MODELS.map(m => ['openai', m, () => openaiTranscribe(m, audio, type)]) : []),
    ...(token(req) ? GATEWAY_MODELS.map(m => ['gateway', m, () => transcribe(m, audio, type, req)]) : []),
  ];
  let lastErr;
  for (const [via, model, run] of attempts) {
    try {
      const text = await run();
      console.log(JSON.stringify({ transcribe: model, via, type, chars: text.length }));
      return res.status(200).json({ ok: true, text, model, via });
    } catch (e) {
      lastErr = e;
      console.error(JSON.stringify({ transcribeFailed: model, via, message: String(e.message).slice(0, 200) }));
    }
  }
  return res.status(502).json({ ok: false, error: 'Could not transcribe: ' + String(lastErr?.message || '').slice(0, 120) });
}
