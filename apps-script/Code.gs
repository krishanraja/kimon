/**
 * Beside Kimon - data-layer API.
 * Bound to the canon Google Sheet. Deploy as Web App: Execute as Me,
 * Who has access: Anyone. The APP_SECRET below gates every call.
 *
 * NOTE for the web app client: POST with Content-Type: text/plain
 * (avoids CORS preflight, which Apps Script cannot answer).
 * GET ?secret=..&action=read|ping works without preflight.
 */

var APP_SECRET = '__APP_SECRET__'; // replaced at deploy time
var TZ = 'Australia/Melbourne';

var OVERWRITE_TABS = ['Profile', 'Conditions', 'Medications', 'Questions', 'KnowledgeGaps'];
var APPEND_TABS = ['TestResults', 'CheckIns', 'Notes', 'Changelog', 'Ops'];

// Columns added after launch. Existing rows read '' for them; ensureCols()
// writes the header cells the first time a new column is used.
var TEST_COLS = ['Date', 'Test', 'Result', 'Lab', 'Notes', 'Source', 'MeasuredAt', 'Id', 'Supersedes'];
var OPS_COLS = ['OpId', 'TsUTC', 'Action', 'By'];
var MED_STATUSES = ['current', 'stopped', 'unconfirmed', 'removed', 'superseded'];

/* ---------- plumbing ---------- */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowUTC() { return new Date().toISOString(); }
function nowMelb() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }

function sh(name) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!s) throw new Error('missing tab: ' + name);
  return s;
}

// Create a tab or fill in missing header cells. Never moves or clears data.
function ensureCols(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name) || ss.insertSheet(name);
  for (var i = 0; i < headers.length; i++) {
    if (String(s.getRange(1, i + 1).getValue()) === '') s.getRange(1, i + 1).setValue(headers[i]);
  }
  return s;
}

function getRows(name) {
  var s = sh(name);
  if (s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues();
}

// 0-based column index -> 1-based row number of first match, or -1
function findRow(name, colIdx, val) {
  var r = getRows(name);
  for (var i = 0; i < r.length; i++) {
    if (String(r[i][colIdx]).trim() === String(val).trim()) return i + 2;
  }
  return -1;
}

function logChange(tab, key, oldV, newV, by, source) {
  sh('Changelog').appendRow([nowUTC(), tab, String(key), String(oldV), String(newV), by || 'app', source || 'app']);
}

function err(msg) { return json({ ok: false, error: msg }); }

function need(obj, fields) {
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '') {
      return 'missing field: ' + f;
    }
  }
  return null;
}

function inEnum(v, allowed) { return allowed.indexOf(v) !== -1; }

/* ---------- read: whole canon ---------- */

function readCanon() {
  function kv(name) {
    var o = {};
    getRows(name).forEach(function (r) { o[String(r[0])] = String(r[1]); });
    return o;
  }
  function arr(name, keys) {
    return getRows(name).map(function (r) {
      var o = {};
      keys.forEach(function (k, i) { o[k] = r[i] === undefined ? '' : String(r[i]); });
      return o;
    });
  }
  var changelog = arr('Changelog', ['ts','tab','key','old','new','by','source']);
  return {
    ok: true,
    meta: kv('Meta'),
    profile: kv('Profile'),
    conditions: arr('Conditions', ['name','status','since','notes','source','updated']),
    medications: arr('Medications', ['name','dose','frequency','started','status','source','updated']),
    testResults: arr('TestResults', ['date','test','result','lab','notes','source','measuredAt','id','supersedes']),
    checkins: arr('CheckIns', ['tsUTC','tsMelb','by','chest','breath','walking','energy','tablets','mood','verdict','notes']),
    questions: arr('Questions', ['id','question','askWhom','priority','status','answer','updated']),
    gaps: arr('KnowledgeGaps', ['id','gap','whatAnswersIt','stepToClose','status','updated']),
    notes: arr('Notes', ['tsUTC','by','text','tag']),
    changelog: changelog.slice(-100), // last 100 only; full history lives in the sheet
    serverTimeUTC: nowUTC(),
    serverTimeMelb: nowMelb()
  };
}

/* ---------- check-in verdict ---------- */

function computeVerdict(a, prev) {
  // a: {chest, breath, walking, energy, tablets, mood}
  if (a.chest !== 'none' || a.breath === 'at-rest') return 'Act-now';
  var changed = (a.walking !== 'same') || (a.energy !== 'normal') ||
                (a.mood === 'very-low') || (a.tablets === 'no');
  if (prev) {
    // deterioration vs last check-in also counts as changed
    var worse = { 'less': 1, 'much-less': 2, 'lower': 1, 'very-low': 2, 'low': 1 };
    if ((worse[a.walking] || 0) > (worse[prev.walking] || 0)) changed = true;
    if ((worse[a.energy] || 0) > (worse[prev.energy] || 0)) changed = true;
  }
  return changed ? 'Changed' : 'Stable';
}

/* ---------- actions ---------- */

var ACTIONS = {
  checkin: function (p, by) {
    var a = p.answers || {};
    var bad = need(a, ['chest','breath','walking','energy','tablets','mood']);
    if (bad) return err(bad);
    var enums = {
      chest: ['none','sometimes','often'],
      breath: ['none','on-exertion','at-rest'],
      walking: ['same','less','much-less'],
      energy: ['normal','lower','very-low'],
      tablets: ['yes','no','not-applicable'],
      mood: ['ok','low','very-low']
    };
    for (var k in enums) {
      if (!inEnum(a[k], enums[k])) return err('invalid value for ' + k + ': ' + a[k]);
    }
    var prevRows = getRows('CheckIns');
    var prev = prevRows.length ? {
      walking: String(prevRows[prevRows.length-1][5]),
      energy: String(prevRows[prevRows.length-1][6])
    } : null;
    var verdict = computeVerdict(a, prev);
    var tsU = nowUTC(), tsM = nowMelb();
    sh('CheckIns').appendRow([tsU, tsM, by, a.chest, a.breath, a.walking, a.energy, a.tablets, a.mood, verdict, p.notes || '']);
    return json({ ok: true, verdict: verdict, timestampUTC: tsU, timestampMelb: tsM });
  },

  note: function (p, by) {
    var bad = need(p, ['text']);
    if (bad) return err(bad);
    var tsU = nowUTC();
    sh('Notes').appendRow([tsU, by, p.text, p.tag || '']);
    return json({ ok: true, timestampUTC: tsU });
  },

  testResult: function (p, by) {
    var bad = need(p, ['date','test','result']);
    if (bad) return err(bad);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return err('date must be YYYY-MM-DD');
    sh('TestResults').appendRow([p.date, p.test, p.result, p.lab || '', p.notes || '', by]);
    return json({ ok: true });
  },

  question: function (p, by) {
    var s = sh('Questions');
    if (p.id) {
      var r = findRow('Questions', 0, p.id);
      if (r < 0) return err('unknown question id: ' + p.id);
      if (p.status) {
        if (!inEnum(p.status, ['open','asked','answered'])) return err('invalid status');
        var oldS = s.getRange(r, 5).getValue();
        s.getRange(r, 5).setValue(p.status);
        s.getRange(r, 7).setValue(nowUTC().slice(0,10));
        logChange('Questions', p.id + '.status', oldS, p.status, by, 'app');
      }
      if (p.answer !== undefined) {
        var oldA = s.getRange(r, 6).getValue();
        s.getRange(r, 6).setValue(p.answer);
        s.getRange(r, 7).setValue(nowUTC().slice(0,10));
        logChange('Questions', p.id + '.answer', oldA, p.answer, by, 'app');
      }
      return json({ ok: true, id: p.id });
    }
    var bad = need(p, ['question']);
    if (bad) return err(bad);
    var ids = getRows('Questions').map(function (x) { return String(x[0]); });
    var n = 1;
    ids.forEach(function (id) { var m = /^Q(\d+)$/.exec(id); if (m) n = Math.max(n, parseInt(m[1],10) + 1); });
    var id = 'Q' + n;
    s.appendRow([id, p.question, p.askWhom || 'cardiologist', String(p.priority || '3'), 'open', '', nowUTC().slice(0,10)]);
    logChange('Questions', id, '(none)', p.question, by, 'app');
    return json({ ok: true, id: id });
  },

  gap: function (p, by) {
    var s = sh('KnowledgeGaps');
    if (p.id) {
      var r = findRow('KnowledgeGaps', 0, p.id);
      if (r < 0) return err('unknown gap id: ' + p.id);
      if (p.status) {
        if (!inEnum(p.status, ['open','in-progress','closed'])) return err('invalid status');
        var oldS = s.getRange(r, 5).getValue();
        s.getRange(r, 5).setValue(p.status);
        s.getRange(r, 6).setValue(nowUTC().slice(0,10));
        logChange('KnowledgeGaps', p.id + '.status', oldS, p.status, by, 'app');
      }
      return json({ ok: true, id: p.id });
    }
    var bad = need(p, ['gap']);
    if (bad) return err(bad);
    var ids = getRows('KnowledgeGaps').map(function (x) { return String(x[0]); });
    var n = 1;
    ids.forEach(function (id) { var m = /^G(\d+)$/.exec(id); if (m) n = Math.max(n, parseInt(m[1],10) + 1); });
    var id = 'G' + n;
    s.appendRow([id, p.gap, p.whatAnswersIt || '', p.stepToClose || '', 'open', nowUTC().slice(0,10)]);
    logChange('KnowledgeGaps', id, '(none)', p.gap, by, 'app');
    return json({ ok: true, id: id });
  },

  profile: function (p, by) {
    var bad = need(p, ['key','value']);
    if (bad) return err(bad);
    var s = sh('Profile');
    var r = findRow('Profile', 0, p.key);
    var today = nowUTC().slice(0,10);
    if (r < 0) {
      s.appendRow([p.key, p.value, 'app', today, 'no']);
      logChange('Profile', p.key, '(none)', p.value, by, 'app');
    } else {
      var oldV = s.getRange(r, 2).getValue();
      s.getRange(r, 2).setValue(p.value);
      s.getRange(r, 3).setValue('app');
      s.getRange(r, 4).setValue(today);
      s.getRange(r, 5).setValue('no');
      logChange('Profile', p.key, oldV, p.value, by, 'app');
    }
    return json({ ok: true });
  },

  condition: function (p, by) {
    var bad = need(p, ['name']);
    if (bad) return err(bad);
    var s = sh('Conditions');
    var r = findRow('Conditions', 0, p.name);
    var today = nowUTC().slice(0,10);
    if (r < 0) {
      s.appendRow([p.name, p.status || 'active', p.since || today, p.notes || '', 'app', today]);
      logChange('Conditions', p.name, '(none)', p.status || 'active', by, 'app');
    } else {
      ['status','notes'].forEach(function (f, i) {
        if (p[f] !== undefined) {
          var col = f === 'status' ? 2 : 4;
          var oldV = s.getRange(r, col).getValue();
          s.getRange(r, col).setValue(p[f]);
          logChange('Conditions', p.name + '.' + f, oldV, p[f], by, 'app');
        }
      });
      s.getRange(r, 6).setValue(today);
    }
    return json({ ok: true });
  },

  // One blood pressure reading typed in by hand. Corrections and "not a real
  // reading" append a new row that names the row it replaces, so the history
  // keeps both.
  reading: function (p, by) {
    var bad = need(p, ['id', 'measuredAt']);
    if (bad) return err(bad);
    var at = new Date(p.measuredAt);
    if (isNaN(at.getTime())) return err('bad measuredAt');
    var retract = p.retract === true;
    var sys = parseInt(p.sys, 10), dia = parseInt(p.dia, 10);
    if (!retract && (String(sys) !== String(p.sys).trim() || String(dia) !== String(p.dia).trim() || sys < 1 || dia < 1 || sys > 400 || dia > 400)) {
      return err('bad numbers');
    }
    var s = ensureCols('TestResults', TEST_COLS);
    var day = Utilities.formatDate(at, TZ, 'yyyy-MM-dd');
    var note = retract ? 'Not a real reading' : p.supersedes ? 'Corrected' : 'Typed in on the phone';
    s.appendRow([day, 'Blood pressure', retract ? 'retracted' : sys + '/' + dia + ' mmHg', '', note, by, at.toISOString(), String(p.id), String(p.supersedes || '')]);
    return json({ ok: true, id: String(p.id) });
  },

  medication: function (p, by) {
    var bad = need(p, ['name']);
    if (bad) return err(bad);
    if (p.status !== undefined && !inEnum(p.status, MED_STATUSES)) return err('bad status');
    var s = sh('Medications');
    var today = nowUTC().slice(0,10);
    // A rename: the old name is kept as "superseded" so its history stays.
    if (p.previousName && String(p.previousName).trim() !== String(p.name).trim()) {
      var old = findRow('Medications', 0, p.previousName);
      if (old > 0) {
        var was = s.getRange(old, 5).getValue();
        s.getRange(old, 5).setValue('superseded');
        s.getRange(old, 7).setValue(today);
        logChange('Medications', p.previousName + '.status', was, 'superseded (now ' + p.name + ')', by, 'app');
      }
    }
    var r = findRow('Medications', 0, p.name);
    if (r < 0) {
      s.appendRow([p.name, p.dose || '', p.frequency || '', p.started || '', p.status || 'current', 'app', today]);
      logChange('Medications', p.name, '(none)', p.status || 'current', by, 'app');
    } else {
      var fields = { dose: 2, frequency: 3, started: 4, status: 5 };
      for (var f in fields) {
        if (p[f] !== undefined) {
          var oldV = s.getRange(r, fields[f]).getValue();
          if (String(oldV) === String(p[f])) continue;
          s.getRange(r, fields[f]).setValue(p[f]);
          logChange('Medications', p.name + '.' + f, oldV, p[f], by, 'app');
        }
      }
      s.getRange(r, 7).setValue(today);
    }
    return json({ ok: true });
  }
};

/* ---------- once-only writes ---------- */

// The phone sends a stable opId with every write and repeats it on retry.
// A repeat returns the first answer's "ok" without writing twice.
function seenOp(opId) {
  var cache = CacheService.getScriptCache();
  if (cache.get('op:' + opId)) return true;
  var rows = getRows('Ops');
  for (var i = rows.length - 1; i >= 0 && i >= rows.length - 5000; i--) {
    if (String(rows[i][0]) === opId) return true;
  }
  return false;
}
function rememberOp(opId, action, by) {
  ensureCols('Ops', OPS_COLS).appendRow([opId, nowUTC(), action, by || 'app']);
  CacheService.getScriptCache().put('op:' + opId, '1', 21600);
}

/* ---------- entry points ---------- */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.secret !== APP_SECRET) return err('bad secret');
    if (p.action === 'ping') return json({ ok: true, time: nowUTC() });
    if (p.action === 'read') return json(readCanon());
    return err('unknown action');
  } catch (ex) {
    return err('server error: ' + ex.message);
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.secret !== APP_SECRET) return err('bad secret');
    var fn = ACTIONS[body.action];
    if (!fn) return err('unknown action: ' + body.action);
    var opId = String(body.opId || '').slice(0, 80);
    if (!opId) return fn(body.payload || {}, body.by || 'app');
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      ensureCols('Ops', OPS_COLS);
      if (seenOp(opId)) return json({ ok: true, duplicate: true });
      var out = fn(body.payload || {}, body.by || 'app');
      var res = {};
      try { res = JSON.parse(out.getContent()); } catch (x) {}
      if (res.ok) rememberOp(opId, body.action, body.by);
      return out;
    } finally {
      lock.releaseLock();
    }
  } catch (ex) {
    return err('server error: ' + ex.message);
  }
}
