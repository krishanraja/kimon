// Record speech on the phone and transcribe it on the server (much better
// than the browser's built-in recogniser, especially on Android).
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MAX_MS = 120000; // two minutes per recording

export function canRecord() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

// onLevel(0..1) drives a voice meter; onAutoStop fires at the time limit.
export async function startRecording({ onLevel, onAutoStop } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mimeType = TYPES.find(t => window.MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

  let raf = 0, ctx = null, peak = 0, metered = false;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.().catch(() => {});
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 5); peak = Math.max(peak, lvl);
      // Only trust the meter if the audio engine is actually running.
      if (ctx.state === 'running') metered = true;
      onLevel?.(lvl);
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* meter is optional */ }

  const t0 = Date.now();
  const limit = setTimeout(() => onAutoStop?.(), MAX_MS);
  rec.start(250);
  let stopped = null;
  const cleanup = () => { clearTimeout(limit); cancelAnimationFrame(raf); ctx?.close?.(); stream.getTracks().forEach(t => t.stop()); };
  return {
    elapsed: () => Date.now() - t0,
    // Nothing louder than room noise: probably no one spoke.
    silent: () => metered && peak < 0.04,
    stop() {
      if (stopped) return stopped;
      stopped = new Promise(resolve => {
        rec.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })); };
        try { rec.stop(); } catch { cleanup(); resolve(new Blob(chunks, { type: mimeType || 'audio/webm' })); }
      });
      return stopped;
    },
  };
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function transcribeBlob(blob) {
  if (!blob || blob.size < 800) throw new Error('too short');
  const r = await fetch('/api/transcribe', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: await toBase64(blob), mediaType: blob.type }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) throw Object.assign(new Error(body.error || 'transcription failed'), { status: r.status });
  return body.text || '';
}

export const fmtTime = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
