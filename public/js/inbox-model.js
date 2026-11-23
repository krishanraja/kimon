// Documents Kimon forwarded by email, waiting for him to check and save.
// A pending one is a Notes row tagged inbox-pending; it is settled by a
// later note tagged inbox-done with the same id (saved or set aside).
// Pure: browser, server and tests.
import { noteData } from './kimon-model.js';

export const INBOX_TAG = 'inbox-pending';
export const INBOX_DONE = 'inbox-done';

export function pendingDocs(canon = {}) {
  const done = new Set((canon.notes || []).filter(n => n.tag === INBOX_DONE).map(n => noteData(n)?.id).filter(Boolean));
  return (canon.notes || []).filter(n => n.tag === INBOX_TAG)
    .map(n => ({ ...noteData(n), ts: n.tsUTC }))
    .filter(d => d.id && !done.has(d.id))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}
