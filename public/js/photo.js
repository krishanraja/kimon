// Take or choose a photo, then shrink it on the phone before upload: a 12 MP
// photo becomes a sharp ~1800 px JPEG of a few hundred KB.
export function pickPhoto({ camera = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let done = false;
    const finish = f => { if (done) return; done = true; input.remove(); resolve(f || null); };
    input.onchange = () => finish(input.files && input.files[0]);
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function render(src, max, quality) {
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  return toBase64(blob);
}

// -> { data: base64 JPEG for upload, type, thumb: small data URL to show }
export async function shrink(file, { max = 1800, quality = 0.85 } = {}) {
  const src = await decode(file);
  const [full, thumb] = await Promise.all([render(src, max, quality), render(src, 360, 0.7)]);
  src.close?.();
  return { data: full.split(',')[1], type: 'image/jpeg', thumb };
}
