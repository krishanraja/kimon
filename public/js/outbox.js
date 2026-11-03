// Every write from the phone goes through here. Each user action gets one
// opId, kept with the write until the server confirms it, and sent again on
// every retry, so the server can refuse to write it twice.
//
// send() result:
//   saved     the server confirmed it (or had already saved it)
//   queued    kept on this phone; will send later (offline, timeout, server down)
//   auth      login expired; kept on this phone, sends after logging back in
//   rejected  the server said the entry itself is wrong; dropped from the queue
//   unsafe    could not even keep a copy on this phone (storage blocked)
// Pure apart from the injected fetch and storage, so it is unit tested.

export function newOpId() {
  return (globalThis.crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export function createOutbox({ storage, fetchFn = globalThis.fetch, key = 'kimon.me.outbox', url = '/api/write', timeoutMs = 15000 } = {}) {
  const read = () => { try { return JSON.parse(storage.getItem(key) || '[]'); } catch { return []; } };
  const write = list => { try { storage.setItem(key, JSON.stringify(list)); return true; } catch { return false; } };
  let flushing = null;

  async function post(item) {
    let r;
    try {
      r = await fetchFn(url, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: item.action, payload: item.payload, opId: item.opId }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { return 'queued'; } // offline or timed out: we do not know, so keep it and retry with the same opId
    if (r.status === 401) return 'auth';
    if (r.ok) return 'saved';
    if (r.status >= 400 && r.status < 500) return 'rejected';
    // 502 from our API wraps a sheet error; the body says whether the entry was bad.
    const body = await r.json().catch(() => ({}));
    if (/^sheet API: (missing field|bad |unknown action)/.test(body.error || '')) return 'rejected';
    return 'queued';
  }

  return {
    pending: () => read(),
    count: () => read().length,
    // Keep first, then send: the entry survives a crash, a timeout or a lost login.
    async send(action, payload, opId = newOpId()) {
      const item = { action, payload, opId, ts: new Date().toISOString() };
      const list = read().filter(x => x.opId !== opId);
      const kept = write([...list, item]);
      const res = await post(item);
      if (res === 'saved' || res === 'rejected') write(read().filter(x => x.opId !== opId));
      return { status: res === 'queued' && !kept ? 'unsafe' : res, opId };
    },
    // Send everything waiting, oldest first. Stops at a lost login.
    flush() {
      if (flushing) return flushing;
      flushing = (async () => {
        let saved = 0, rejected = 0, auth = false;
        for (const item of read()) {
          const res = await post(item);
          if (res === 'saved' || res === 'rejected') { write(read().filter(x => x.opId !== item.opId)); res === 'saved' ? saved++ : rejected++; }
          if (res === 'auth') { auth = true; break; }
          if (res === 'queued') break; // still offline; keep the order
        }
        return { saved, rejected, auth, left: read().length };
      })().finally(() => { flushing = null; });
      return flushing;
    },
  };
}
