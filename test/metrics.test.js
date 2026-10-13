// Fixtures mirror the real sheet's formats with invented values (no PII).
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, fmtDate, parseDate, daysUntil, resultCards, situation, MEASURES } from '../public/js/metrics.js';

const rows = [
  { date: 'Wed Jan 14 2026 00:00:00 GMT+0000 (Greenwich Mean Time)', test: 'Fasting lipid studies', result: 'Total 6.2, Trig 1.9, HDL-C 1.3, LDL-C 3.6, non-HDL-C 4.9 mmol/L; Chol/HDL 4.8', lab: 'Lab A', notes: 'Lab comment: example' },
  { date: 'Wed Jan 14 2026 00:00:00 GMT+0000 (Greenwich Mean Time)', test: 'Fasting serum glucose (08:10)', result: '5.7 mmol/L (ref 4.0-6.0)', lab: 'Lab A', notes: '' },
  { date: 'Wed Jan 14 2026 00:00:00 GMT+0000 (Greenwich Mean Time)', test: 'General biochemistry', result: 'Within normal limits', lab: 'Lab A', notes: 'Na 140, K 4.1, urea 5.0, eGFR 74 (>60), creatinine 88 umol/L' },
  { date: 'Wed Jan 14 2026 00:00:00 GMT+0000 (Greenwich Mean Time)', test: 'Full blood examination', result: 'Within normal limits (Hb 150 g/L, WCC 7.0 x10^9/L, platelets 250 x10^9/L)', lab: 'Lab A', notes: '' },
  { date: 'Mon Feb 09 2026 00:00:00 GMT+0000 (Greenwich Mean Time)', test: 'CT coronary artery calcium score', result: 'Total 612.40 Agatston (LM 40.0, LAD 400.2, LCx 100.1, RCA 72.1); 50th-75th percentile age/sex', lab: 'Clinic B', notes: 'Impression: example' },
];

test('parses composite lipid panel without HDL/non-HDL/ratio collisions', () => {
  const m = extract(rows);
  assert.equal(m.ldl.value, 3.6);
  assert.equal(m.hdl.value, 1.3);
  assert.equal(m.nonhdl.value, 4.9);
  assert.equal(m.trig.value, 1.9);
  assert.equal(m.total.value, 6.2);
});
test('parses calcium score total, vessels and percentile', () => {
  const m = extract(rows);
  assert.equal(m.cac.value, 612.4);
  assert.deepEqual(m.cac.vessels, { LM: 40, LAD: 400.2, LCx: 100.1, RCA: 72.1 });
  assert.equal(m.cac.percentile, '50th to 75th');
});
test('parses glucose, eGFR from notes, Hb', () => {
  const m = extract(rows);
  assert.equal(m.glucose.value, 5.7);
  assert.equal(m.egfr.value, 74);
  assert.equal(m.hb.value, 150);
  assert.equal(m.hb.fbeNormal, true);
  assert.equal(m.bp, undefined);
});
test('calcium total is not mistaken for total cholesterol', () => {
  assert.equal(extract(rows).total.value, 6.2);
});
test('dates', () => {
  assert.equal(fmtDate('Wed Jan 14 2026 00:00:00 GMT+0000 (Greenwich Mean Time)'), '14 Jan');
  assert.equal(fmtDate('2026-10-13T07:41:31Z'), '13 Oct');
  assert.equal(fmtDate('2026-03-02', { year: true }), '2 Mar 2026');
  assert.equal(parseDate('nonsense'), null);
  assert.equal(daysUntil('2026-10-20', new Date(2026, 9, 13)), 7);
});
test('verdict bands', () => {
  assert.equal(MEASURES.cac.assess(955)[0], 'Severe');
  assert.equal(MEASURES.cac.assess(1000)[0], 'Extreme');
  assert.equal(MEASURES.cac.assess(150)[0], 'Moderate');
  assert.equal(MEASURES.ldl.assess(1.7)[0], 'On target');
  assert.equal(MEASURES.ldl.assess(4.2)[0], 'High');
  assert.equal(MEASURES.glucose.assess(5.9)[0], 'Borderline');
  assert.equal(MEASURES.egfr.assess(69)[0], 'Normal');
});
test('result cards: present measures plus BP shown as missing', () => {
  const cards = resultCards(extract(rows));
  assert.deepEqual(cards.map(c => c.key), ['cac', 'ldl', 'glucose', 'egfr', 'hb', 'bp']);
  assert.equal(cards.at(-1).missing, true);
});
test('situation line', () => {
  const s = situation({ m: extract(rows), notes: [{ tsUTC: '2026-03-01T10:00:00Z', tag: 'symptom-report' }] });
  assert.match(s, /score 612, severe/);
  assert.match(s, /LDL 3.6\) with no treatment recorded/);
  assert.match(s, /reported 1 Mar/);
});
