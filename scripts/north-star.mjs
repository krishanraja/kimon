// The North Star number: times this week Kimon added something himself,
// counted from rows the server attributed to him, plus distinct active days.
// Prints counts only, never the entries themselves.
// Usage: SHEET_API_SECRET=... node scripts/north-star.mjs [weekStart YYYY-MM-DD]
//        (or MOCK: start scripts/dev-server.mjs with MOCK_SHEET=1 and set SHEET_API_URL)
import { readCanon } from '../lib/sheet.js';
import { weeklyKimonEntries, liveNotes } from '../public/js/kimon-model.js';

const arg = process.argv[2];
// Weeks start on Monday, Melbourne time, to match the North Star ladder.
function mondayMelbourne(d = new Date()) {
  const melb = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }));
  const back = (melb.getDay() + 6) % 7;
  const day = new Date(melb.getFullYear(), melb.getMonth(), melb.getDate() - back);
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00+11:00`); // AEDT in the ladder months (Oct to Apr)
}
const start = arg ? new Date(`${arg}T00:00:00+11:00`) : mondayMelbourne();
const canon = await readCanon();
canon.notes = liveNotes(canon.notes || []); // entries removed as mistakes don't count
const w = weeklyKimonEntries(canon, start);
console.log(JSON.stringify({ weekStart: start.toISOString(), count: w.count, activeDays: w.activeDays, byKind: w.byKind, measuredAt: new Date().toISOString() }));
