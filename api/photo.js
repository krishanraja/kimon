// Photo of a test result -> rows ready for his record, plus Leffy's quick
// read of what it means for him, in one model call. Nothing is saved here:
// the phone shows what was read, the person confirms, then the rows are
// written through /api/write. The photo itself is not stored anywhere.
import { requireAuth } from '../lib/auth.js';
import { readCanon } from '../lib/sheet.js';
import { checkImage } from '../lib/photo.js';
import { readDocument } from '../lib/read-document.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const image = (req.body || {}).image;
  const bad = checkImage(image) || (!image && 'No photo received');
  if (bad) return res.status(400).json({ ok: false, error: bad });
  let canon = {};
  try { canon = await readCanon({ timeoutMs: 9000 }); } catch { /* duplicates just won't be flagged */ }
  try {
    const read = await readDocument({ req, file: image, canon, via: 'a photo' });
    return res.status(200).json({ ok: true, ...read });
  } catch (e) {
    console.error(JSON.stringify({ photoFailed: e.code || 'ERR', message: String(e.message).slice(0, 200) }));
    return res.status(502).json({ ok: false, error: e.code === 'NO_AI' ? 'Photo reading is not set up' : "Couldn't read that photo. Try again in good light." });
  }
}
