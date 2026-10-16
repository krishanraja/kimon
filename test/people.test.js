import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoster, matchPerson, refer, person } from '../public/js/people.js';

// Invented names; the real family list lives in Vercel env PEOPLE.
const roster = parseRoster(JSON.stringify([
  { name: 'Kimon', aliases: ['Kim'], patient: true },
  { name: 'Sam', aliases: ['Sammy'], calls: 'Dad' },
  { name: 'Alex', calls: 'Kim' },
  { name: '', calls: 'Dad' },
]));

test('roster: cleaned, empty names dropped, bad JSON is an empty list', () => {
  assert.equal(roster.length, 3);
  assert.deepEqual(parseRoster('not json'), []);
  assert.deepEqual(parseRoster({ nope: 1 }), []);
  assert.equal(parseRoster([{ name: '<b>Eve</b>' }])[0].name, 'bEveb');
});
test('names and nicknames match, ignoring case and spaces', () => {
  assert.equal(matchPerson(roster, 'sammy ').name, 'Sam');
  assert.equal(matchPerson(roster, 'ALEX').name, 'Alex');
  assert.equal(matchPerson(roster, 'kim').patient, true);
  assert.equal(matchPerson(roster, 'Nobody'), null);
  assert.equal(matchPerson(roster, ''), null);
});
test('how Kimon is named: Dad becomes "your dad", a name stays a name', () => {
  assert.deepEqual(refer('Dad'), { calls: 'Dad', him: 'Dad', himPoss: "Dad's", leffy: 'your dad', leffyPoss: "your dad's" });
  assert.deepEqual(refer('kim'), { calls: 'Kim', him: 'Kim', himPoss: "Kim's", leffy: 'Kim', leffyPoss: "Kim's" });
  assert.equal(refer('Kim').leffyPoss, "Kim's");
  assert.equal(refer('papou').leffy, 'your papou');
  assert.equal(refer('').leffy, 'Kimon');
});
test('the person on this phone', () => {
  const k = person({ role: 'kimon', who: 'Sam', roster });
  assert.equal(k.leffy, 'you'); assert.equal(k.id, 'kimon');
  const s = person({ role: 'family', who: 'Sammy', roster });
  assert.equal(s.name, 'Sam'); assert.equal(s.leffy, 'your dad'); assert.equal(s.him, 'Dad'); assert.equal(s.known, true);
  const a = person({ role: 'family', who: 'alex', roster });
  assert.equal(a.leffy, 'Kim'); assert.equal(a.himPoss, "Kim's");
  const other = person({ role: 'family', who: 'Jo', roster });
  assert.equal(other.leffy, 'Kimon'); assert.equal(other.known, false);
  const chose = person({ role: 'family', who: 'Jo', calls: 'Papou', roster });
  assert.equal(chose.leffy, 'your papou'); assert.equal(chose.known, true);
  // The list wins over what a phone says, so a nickname always maps the same way.
  assert.equal(person({ role: 'family', who: 'Sam', calls: 'Kimon', roster }).leffy, 'your dad');
  assert.equal(person({ role: 'family', who: '', roster }).known, false);
});
