// The medicines Kimon can pick from: generic names and the tablet strengths
// sold in Australia, for the heart and the conditions that travel with it.
// Picking instead of typing means no misspellings and one name per medicine,
// so the list, the family app and Leffy always agree. Product facts only
// (no advice). Anything missing is added here, not typed in on a phone.
export const MED_CATALOG = [
  ['Amlodipine', ['2.5 mg', '5 mg', '10 mg']],
  ['Apixaban', ['2.5 mg', '5 mg']],
  ['Aspirin (low dose)', ['100 mg']],
  ['Atorvastatin', ['10 mg', '20 mg', '40 mg', '80 mg']],
  ['Bisoprolol', ['1.25 mg', '2.5 mg', '5 mg', '10 mg']],
  ['Candesartan', ['4 mg', '8 mg', '16 mg', '32 mg']],
  ['Clopidogrel', ['75 mg']],
  ['Ezetimibe', ['10 mg']],
  ['Frusemide (furosemide)', ['20 mg', '40 mg']],
  ['Glyceryl trinitrate spray', ['400 mcg per spray']],
  ['Irbesartan', ['75 mg', '150 mg', '300 mg']],
  ['Isosorbide mononitrate', ['30 mg', '60 mg', '120 mg']],
  ['Metformin', ['500 mg', '850 mg', '1000 mg']],
  ['Metoprolol', ['25 mg', '50 mg', '100 mg']],
  ['Pantoprazole', ['20 mg', '40 mg']],
  ['Perindopril', ['2.5 mg', '5 mg', '10 mg']],
  ['Pravastatin', ['10 mg', '20 mg', '40 mg', '80 mg']],
  ['Ramipril', ['1.25 mg', '2.5 mg', '5 mg', '10 mg']],
  ['Rivaroxaban', ['10 mg', '15 mg', '20 mg']],
  ['Rosuvastatin', ['5 mg', '10 mg', '20 mg', '40 mg']],
  ['Simvastatin', ['10 mg', '20 mg', '40 mg', '80 mg']],
  ['Spironolactone', ['25 mg', '50 mg', '100 mg']],
  ['Telmisartan', ['40 mg', '80 mg']],
];
export const MED_WHEN = ['Morning', 'Midday', 'Evening', 'Night', 'Morning and evening', 'When needed'];
export const NOT_SURE = 'Not sure';

export const strengthsOf = name => (MED_CATALOG.find(([n]) => n === name) || [, []])[1];
export const inCatalog = name => MED_CATALOG.some(([n]) => n === name);

// The one gate for medicine writes, run on the server. A new name, strength or
// time must come from the lists. An entry that already exists under an older
// spelling (existing: true) may only change status or be renamed to a listed name.
export function checkMedWrite(p = {}) {
  const name = String(p.name || '').trim();
  if (!name) return 'missing name';
  if (!inCatalog(name) && !p.existing) return 'medicine not on the list';
  if (p.dose && !(inCatalog(name) ? strengthsOf(name) : [p.dose]).includes(p.dose)) return 'strength not on the list';
  if (p.frequency && !MED_WHEN.includes(p.frequency) && !p.existing) return 'time not on the list';
  return null;
}
