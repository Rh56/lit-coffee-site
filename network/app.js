/* ==========================================================================
   Rootwork — a personal network map.
   Everything lives in the browser: no accounts, no server, no upload.
   Sections: state · parse · layout · plate (canvas) · interface
   ========================================================================== */
(function () {
'use strict';

/* ---------------------------------------------------------------- state -- */

var KEY = 'rootwork.v1';
var DAY = 86400000;
var COLD_DAYS = 90;

var state = { me: { name: 'Me' }, people: [], circles: [], colors: {}, tombstones: {}, circleTombstones: {}, coldDays: 90, settingsAt: 0, meUpdated: 0, demo: false, seq: 1 };
var DEFAULTS = function () { return { me: { name: 'Me' }, people: [], circles: [], colors: {}, tombstones: {}, circleTombstones: {}, coldDays: 90, settingsAt: 0, meUpdated: 0, demo: false, seq: 1 }; };
var applyingRemote = false;

function uid() { return 'p' + (state.seq++) + Math.random().toString(36).slice(2, 6); }

function load() {
  var raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
  if (!raw) return false;
  try {
    var d = JSON.parse(raw);
    if (!d || !Array.isArray(d.people)) return false;
    state = Object.assign(DEFAULTS(), d);
    state.people.forEach(normalizePerson);
    return true;
  } catch (e) { return false; }
}

var saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    if (!applyingRemote && window.RootworkSync) window.RootworkSync.markDirty();
  }, 220);
}

function touch(p) { p.updated = Date.now(); return p; }

function forget(p) {
  state.tombstones = state.tombstones || {};
  state.tombstones[p.id] = Date.now();
  state.people = state.people.filter(function (x) { return x.id !== p.id; });
}

var LEVELS = ['', 'undergrad', 'grad'];

function schoolsOf(p) { return p.schools || []; }

function addSchool(list, name, level) {
  name = clean(name);
  if (!name) return list;
  var found = list.filter(function (s) { return s.name.toLowerCase() === name.toLowerCase(); })[0];
  if (found) { if (level && !found.level) found.level = level; return list; }
  list.push({ name: name, level: level || '' });
  return list;
}

function normalizePerson(p) {
  p.ties = p.ties || [];
  p.tags = p.tags || [];
  p.custom = p.custom || {};

  // schools became a list with a level on each
  if (!Array.isArray(p.schools)) p.schools = [];
  if (p.school) { addSchool(p.schools, p.school, ''); delete p.school; }

  // birthday and "met via" are gone as fields; anything already recorded
  // keeps its place on the card as a line of its own
  if (p.birthday) { p.custom.birthday = p.custom.birthday || p.birthday; delete p.birthday; }
  if (p.howMet) { p.custom['met via'] = p.custom['met via'] || p.howMet; delete p.howMet; }
  p.notes = p.notes || [];
  p.log = p.log || [];
  if (!Array.isArray(p.circles)) p.circles = [];
  if (p.circle && !p.circles.length) p.circles = [p.circle];   // from the single-circle days
  p.circles = p.circles.map(function (c) { return clean(c); }).filter(Boolean)
    .filter(function (c) { return circleKilled(c) <= (p.updated || p.created || 0); });
  delete p.circle;
  p.created = p.created || Date.now();
  return p;
}

function blankPerson(name) {
  return normalizePerson({
    id: uid(), name: name || '', email: '', phone: '', profession: '', company: '',
    schools: [], location: '', circles: [], tags: [], custom: {},
    followUp: null, notes: [], log: [], created: Date.now()
  });
}

/* Who put you onto whom. Stored on the person who was introduced. */
function tie(person, otherId, kind) {
  if (!person || !otherId || person.id === otherId) return;
  if (person.ties.some(function (t) { return t.id === otherId; })) return;
  person.ties.push({ id: otherId, kind: kind || 'intro' });
  touch(person);
}
function untie(person, otherId) {
  person.ties = person.ties.filter(function (t) { return t.id !== otherId; });
  touch(person);
}
function personById(id) {
  return state.people.filter(function (p) { return p.id === id; })[0] || null;
}
/* Ties are directional in storage but mutual on the map. */
function tiesOf(p) {
  var out = p.ties.map(function (t) { return { person: personById(t.id), kind: t.kind, own: true }; });
  state.people.forEach(function (other) {
    if (other.id === p.id) return;
    other.ties.forEach(function (t) {
      if (t.id === p.id) out.push({ person: other, kind: t.kind, own: false });
    });
  });
  return out.filter(function (x) { return x.person; });
}

function lastTouch(p) {
  var t = p.created || 0;
  p.log.forEach(function (e) { if (e.at > t) t = e.at; });
  return t;
}
function daysSince(t) { return Math.floor((Date.now() - t) / DAY); }
function coldAfter() { return state.coldDays || COLD_DAYS; }
function isCold(p) { return p.log.length > 0 && daysSince(lastTouch(p)) > coldAfter(); }
function nudgeDue(p) {
  if (p.followUp && p.followUp.date && p.followUp.date <= Date.now() + DAY) return true;
  return isCold(p);
}

/* Where a person hangs. First one is their primary — it colours their dot and
   is the branch they sit closest to. */
function circlesOf(p) {
  return (p.circles && p.circles.length) ? p.circles : ['Unsorted'];
}
function primaryCircle(p) { return circlesOf(p)[0]; }
function inCircle(p, name) {
  return circlesOf(p).some(function (c) { return c.toLowerCase() === String(name).toLowerCase(); });
}

/* Adds a circle to a person. Dropping someone on a circle makes it primary;
   adding from the card leaves their primary alone. */
function reviveCircle(name) {
  if (state.circleTombstones) delete state.circleTombstones[String(name).trim().toLowerCase()];
}

function joinCircle(p, name, makePrimary) {
  name = clean(name);
  if (!name) return;
  reviveCircle(name);
  p.circles = circlesOf(p).filter(function (c) { return c.toLowerCase() !== name.toLowerCase() && c !== 'Unsorted'; });
  if (makePrimary) p.circles.unshift(name); else p.circles.push(name);
  circleIndex(name);
  touch(p);
}

function leaveCircle(p, name) {
  p.circles = circlesOf(p).filter(function (c) { return c.toLowerCase() !== String(name).toLowerCase(); });
  if (!p.circles.length) p.circles = [];
  touch(p);
}

/* Circles that exist, including ones nobody is in yet — an empty circle is
   still part of the structure. */
function circleList(includeEmpty) {
  var seen = {}, out = [];
  var add = function (c) {
    if (!seen[c]) { seen[c] = { name: c, n: 0 }; out.push(seen[c]); }
    return seen[c];
  };
  if (includeEmpty !== false) (state.circles || []).forEach(function (c) { if (c !== 'Unsorted') add(c); });
  state.people.forEach(function (p) { circlesOf(p).forEach(function (c) { add(c).n++; }); });
  out.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  return out;
}

/* Colors are assigned by first appearance and remembered, so a circle keeps
   its pigment even as the map grows. */
function circleIndex(name) {
  if (name === 'Unsorted') return 0;
  if (state.colors && state.colors[name]) return state.colors[name];
  var i = state.circles.indexOf(name);
  if (i < 0) {
    if (circleKilled(name)) return 6;          // deleted: draw it, do not re-register it
    state.circles.push(name);
    i = state.circles.length - 1;
  }
  return (i % 8) + 1;
}

// index 0 is reserved for Unsorted, which draws in the neutral ink
var PIGMENTS = [
  { i: 1, name: 'copper' }, { i: 2, name: 'verdigris' }, { i: 3, name: 'indigo' },
  { i: 4, name: 'plum' }, { i: 5, name: 'moss' }, { i: 6, name: 'steel blue' },
  { i: 7, name: 'brass' }, { i: 8, name: 'brick' }
];

var COLOR_WORDS = {
  copper: 1, orange: 1, rust: 1, amber: 1, terracotta: 1, bronze: 1,
  green: 2, verdigris: 2, emerald: 2, teal: 2, jade: 2, mint: 2,
  blue: 3, indigo: 3, navy: 3, cobalt: 3, periwinkle: 3,
  purple: 4, plum: 4, violet: 4, magenta: 4, pink: 4, mauve: 4, lilac: 4,
  olive: 5, moss: 5, lime: 5, sage: 5, 'olive green': 5,
  cyan: 6, steel: 6, 'steel blue': 6, sky: 6, aqua: 6, turquoise: 6, slate: 6,
  gold: 7, yellow: 7, brass: 7, mustard: 7, ochre: 7, honey: 7,
  red: 8, rose: 8, brick: 8, maroon: 8, crimson: 8, coral: 8
};

function setCircleColor(name, idx) {
  reviveCircle(name);
  if (!state.colors) state.colors = {};
  state.colors[name] = idx;
  state.settingsAt = Date.now();
  circleIndex(name);
}

var hidden = {};   // circle name -> true when filtered out
var lastSubject = null;  // who the last entry was about, so pronouns have a referent

/* ---------------------------------------------------------------- parse -- */

var CHANNELS = [
  ['zoom', /\b(zoom(?:ed)?|video ?call|google meet|meet call|teams call|facetime|hangout)\b/i],
  ['call', /\b(call(?:ed)?|phone|rang|voicemail)\b/i],
  ['talk', /\b(chat(?:ted|ting)?|talk(?:ed|ing)?|spoke|speaking|conversation|catch(?:ing)? up|caught up|met up|sat down|hung out|checked in)\b/i],
  ['coffee', /\b(coffee|tea|drinks?|beer|breakfast)\b/i],
  ['meal', /\b(lunch|dinner|brunch|supper)\b/i],
  ['event', /\b(conference|meetup|panel|summit|wedding|party|networking|mixer|workshop|class)\b/i],
  ['email', /\b(emailed|email(?:ed)? (?:with|from|to)|sent (?:her|him|them) an email|replied)\b/i],
  ['message', /\b(texted|dm(?:ed|d)?|slack(?:ed)?|whatsapp|linkedin message|messaged)\b/i],
  ['intro', /\b(introduced|intro(?:'d| to)|connected me|referred)\b/i],
  ['met', /\b(met|saw|ran into|bumped into|sat next to|dropped by|stopped by)\b/i]
];

var LOWER_STOP = /^(my|the|a|an|his|her|their|them|him|some|someone|everyone|about|dinner|lunch|coffee|drinks|breakfast|him|us|it|that|this|there|here|today|yesterday|tonight|again|both|new|old|guy|girl|friend|mom|dad|work)$/i;
var STOPNAMES = /^(I|We|My|The|A|An|He|She|They|Her|His|Their|Today|Yesterday|Just|Had|Got|Met|Talked|Spoke|Chatted|Saw|Zoom|Call|Coffee|Lunch|Dinner|Email|Last|This|Next|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/;

var HONORIFIC = /^(?:dr|mr|mrs|ms|mx|prof|professor|rev|fr|sr|sir|dame)\.?\s+/i;
var NAME = "(?:(?:Dr|Mr|Mrs|Ms|Mx|Prof|Rev|Fr|Sir)\\.?\\s+)?[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ'’\\-]+(?:\\s+(?:van|von|de|del|della|da|di|la|le|bin|al)\\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ'’\\-]+|\\s[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ'’\\-]+){0,2}";

function clean(s) {
  return (s || '').replace(/\s+/g, ' ')
    .replace(/^[\s,;:—–-]+|[\s,;:.—–-]+$/g, '').trim();
}

var SMALL_WORD = /^(of|the|at|in|and|for|de|la|von|van)$/i;
function titleCase(s) {
  return clean(s).split(/\s+/).map(function (w, i) {
    if (i && SMALL_WORD.test(w)) return w.toLowerCase();
    if (/[A-Z]/.test(w.slice(1))) return w;            // MIT, SpaceX, McGill stay as typed
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function titleish(s) {
  s = clean(s);
  return s.replace(/^(the|a|an|named|called)\s+/i, '');
}

function relativeDate(text) {
  var now = new Date(); now.setHours(12, 0, 0, 0);
  var m;
  if (/\byesterday\b/i.test(text)) return now.getTime() - DAY;
  if (/\bthis morning|today|just now|tonight\b/i.test(text)) return now.getTime();
  if (/\blast night\b/i.test(text)) return now.getTime() - DAY;
  if (/\bthe other day\b/i.test(text)) return now.getTime() - 3 * DAY;
  if (/\b(?:over|during)\s+the\s+weekend\b/i.test(text)) {
    var back = (now.getDay() + 1) % 7 || 7;          // the Saturday just gone
    return now.getTime() - back * DAY;
  }
  if ((m = /\b(?:like\s+|about\s+|maybe\s+|roughly\s+)?(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a couple(?: of)?|couple(?: of)?|a few|few)\s+(day|week|month|year)s?\s+ago\b/i.exec(text))) {
    var words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, 'a couple': 2, 'a couple of': 2, couple: 2, 'couple of': 2, 'a few': 3, few: 3 };
    var key = m[1].toLowerCase();
    var n = words[key] !== undefined ? words[key] : (parseInt(m[1], 10) || 1);
    var unit = m[2].toLowerCase();
    var mult = unit === 'day' ? 1 : unit === 'week' ? 7 : unit === 'month' ? 30 : 365;
    return now.getTime() - n * mult * DAY;
  }
  if (/\blast week\b/i.test(text)) return now.getTime() - 7 * DAY;
  if (/\blast month\b/i.test(text)) return now.getTime() - 30 * DAY;
  if ((m = /\blast (mon|tues|wednes|thurs|fri|satur|sun)day\b/i.exec(text))) {
    var target = ['sun', 'mon', 'tues', 'wednes', 'thurs', 'fri', 'satur'].indexOf(m[1].toLowerCase());
    var d = now.getDay(), back = (d - target + 7) % 7 || 7;
    return now.getTime() - back * DAY;
  }
  if ((m = /\bon (\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text))) {
    var yr = m[3] ? (m[3].length === 2 ? 2000 + (+m[3]) : +m[3]) : now.getFullYear();
    return new Date(yr, (+m[1]) - 1, +m[2], 12).getTime();
  }
  if ((m = /\b(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i.exec(text))) {
    var mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(m[1].toLowerCase().slice(0, 3));
    var dt = new Date(now.getFullYear(), mo, +m[2], 12);
    if (dt.getTime() - now.getTime() > 200 * DAY) dt.setFullYear(dt.getFullYear() - 1);
    return dt.getTime();
  }
  return now.getTime();
}

function futureDate(text) {
  var m = /\b(?:follow(?:ing)?[ -]?up|circle back|check in|reconnect|talk|catch up|reach out|ping)\b[^.;\n]{0,40}?\b(?:in|next)\s+(a|an|one|two|three|four|six|\d{1,2})?\s*(day|week|month|quarter)s?\b/i.exec(text)
    || /\bin\s+(a|an|one|two|three|four|six|\d{1,2})\s+(day|week|month)s?\b/i.exec(text);
  if (!m) return null;
  var words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, six: 6 };
  var n = m[1] ? (words[m[1].toLowerCase()] || parseInt(m[1], 10) || 1) : 1;
  var unit = m[2].toLowerCase();
  var mult = unit === 'day' ? 1 : unit === 'week' ? 7 : unit === 'month' ? 30 : 90;
  return Date.now() + n * mult * DAY;
}

function findPerson(name) {
  if (!name) return null;
  var n = name.toLowerCase().replace(/[’']s$/, '').trim();
  if (!n) return null;
  var exact = state.people.filter(function (p) { return p.name.toLowerCase() === n; });
  if (exact.length) return exact[0];
  var first = state.people.filter(function (p) {
    return p.name.toLowerCase().split(' ')[0] === n.split(' ')[0];
  });
  if (first.length === 1 && n.split(' ').length === 1) return first[0];
  var starts = state.people.filter(function (p) { return p.name.toLowerCase().indexOf(n) === 0; });
  return starts.length === 1 ? starts[0] : null;
}

/* Field names people actually type, and what they mean here. */
var SETTABLE = {
  email: 'email', 'e-mail': 'email', mail: 'email', phone: 'phone', number: 'phone',
  cell: 'phone', mobile: 'phone', school: 'school', college: 'school', university: 'school',
  role: 'profession', title: 'profession', job: 'profession', profession: 'profession',
  company: 'company', employer: 'company', work: 'company', workplace: 'company',
  location: 'location', city: 'location', address: 'location', circle: 'circle',
  group: 'circle', name: 'name'
};
var SET_WORDS = Object.keys(SETTABLE).join('|');
var CLEARABLE = /^(e-?mail|mail|phone|number|school|company|employer|role|title|profession|job|location|city)$/i;

/* Turns a sentence into a draft: which person, which fields, what happened.

   Order matters more than cleverness here. Anything stated outright — "her
   location is Bethlehem", "his favourite coffee is a cortado" — is taken and
   CUT OUT of the sentence first, so a proper noun sitting in a value can no
   longer be mistaken for the person's name further down. */
function parse(raw) {
  var text = clean(raw);
  var out = { name: '', person: null, patch: {}, custom: {}, clears: [], tags: [], schools: [], via: null, viaName: '', entry: null, followUp: null };
  var work = ' ' + text + ' ';
  var m;

  function endClause(v) {                    // "a.name@example.com" survives; a new sentence does not
    return clean(String(v).replace(/\.\s+\S[\s\S]*$/, '').replace(/[.,;]+$/, ''));
  }

  function take(field, value, force) {
    value = titleish(value);
    if (!value) return;
    if (!out.patch[field] || force) out.patch[field] = value;
  }

  // 1. explicit "key: value"
  var KEYMAP = Object.assign({}, SETTABLE, { tag: 'tags', note: 'note' });
  work = work.replace(/\b(\w[\w-]*)\s*:\s*([^,;\n]+)/g, function (all, k, v) {
    var f = KEYMAP[k.toLowerCase()];
    if (!f || f === 'tags' || f === 'note') return all;
    out.patch[f] = titleish(endClause(v));
    if (f === 'circle') out.circleForced = true;
    return ' ';
  });

  // 2. tags
  work = work.replace(/#([\w’'-]+)/g, function (all, t) { out.tags.push(t); return ' '; });

  // 3. "set her school to Lehigh", "his email is x@y.com", "change the company to Merck"
  var setRe = new RegExp('\\b(?:add|set|change|update|make|correct|fix)?\\s*(?:her|his|their|the|my)?\\s*\\b(' + SET_WORDS + ')\\b\\s*(?:is|are|was|as|to|=)\\s+([^;,\\n]{2,70}?)(?=\\s+and\\s+(?:her|his|their)\\b|\\.\\s|$)', 'gi');
  work = work.replace(setRe, function (all, k, v) {
    var f = SETTABLE[k.toLowerCase()];
    if (!f) return all;
    out.patch[f] = titleish(endClause(v));
    if (f === 'circle') out.circleForced = true;
    return ' ';
  });

  // 4. "remove her phone"
  work = work.replace(/\b(?:remove|clear|delete|forget|drop)\s+(?:her|his|their|the|my)?\s*\b([\w-]+)\b/gi, function (all, k) {
    if (!CLEARABLE.test(k)) return all;
    var f = SETTABLE[k.toLowerCase().replace('e-mail', 'email')];
    if (f) { out.clears.push(f); return ' '; }
    return all;
  });

  // 5. anything else stated as "her X is Y" becomes a labelled line on the card
  var customRe = /(?:^|[.;,]\s*|\s)(?:her|his|their)\s+([a-z][a-z ]{2,22}?)\s+(?:is|are|was|were)\s+([^;\n]{2,70}?)(?=\s+and\s+(?:her|his|their)\b|\.\s|;|$)/gi;
  work = work.replace(customRe, function (all, k, v) {
    var key = clean(k).toLowerCase();
    if (SETTABLE[key.replace(/\s+/g, '')] || /^(name|number)$/.test(key)) return all;
    out.custom[key] = titleish(endClause(v));
    return ' ';
  });

  // 6. contacts
  if ((m = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(work))) { take('email', m[0]); work = work.replace(m[0], ' '); }
  if ((m = /(\+?\d[\d\-.() ]{8,}\d)/.exec(work))) {
    var digits = m[1].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) { take('phone', m[1]); work = work.replace(m[1], ' '); }
  }

  // 8. who this is about
  var TRIGGER = '(?:[Ww]ith|w\\/|[Tt]o|[Ff]rom|[Mm]et|[Ss]aw|[Cc]alled|[Ee]mailed|[Tt]exted|[Aa]bout|[Ff]or)';
  var nm = new RegExp('\\b' + TRIGGER + '\\s+(' + NAME + ')');
  if ((m = nm.exec(work)) && !STOPNAMES.test(m[1].split(' ')[0])) out.name = m[1];

  // people type their friends in lower case: "talked with josh donaldson"
  if (!out.name && (m = new RegExp('\\b' + TRIGGER + "\\s+([a-zà-ÿ'’-]{2,}(?:\\s+[a-zà-ÿ'’-]{2,}){0,2})").exec(work))) {
    var bits = m[1].split(/\s+/);
    while (bits.length && LOWER_STOP.test(bits[0])) bits.shift();
    while (bits.length && LOWER_STOP.test(bits[bits.length - 1])) bits.pop();
    if (bits.length >= 2 || (bits.length === 1 && findPerson(bits[0]))) out.name = titleCase(bits.join(' '));
  }

  if (!out.name && (m = new RegExp('^\\s*(' + NAME + ')').exec(work)) && !STOPNAMES.test(m[1].split(' ')[0])) out.name = m[1];
  if (!out.name) {
    var all = work.match(new RegExp(NAME, 'g')) || [];
    for (var i = 0; i < all.length; i++) {
      // "Met Rae Kim" — drop the leading word rather than the whole match
      var parts = all[i].split(' ');
      while (parts.length && STOPNAMES.test(parts[0])) parts.shift();
      if (parts.length) { out.name = parts.join(' '); break; }
    }
  }

  if (!out.name) {
    var words = text.toLowerCase().match(/[a-zà-ÿ']{2,}/g) || [];
    for (var w = 0; w < words.length; w++) {
      var byWord = state.people.filter(function (p) { return p.name.toLowerCase() === words[w]; });
      if (byWord.length === 1) { out.name = byWord[0].name; break; }
    }
  }
  if (out.patch.name) { out.name = out.patch.name; delete out.patch.name; }
  out.name = clean(out.name).replace(/[’']s$/, '').replace(HONORIFIC, '');
  out.person = findPerson(out.name);

  /* "she went to Rutgers", typed right after logging someone — or while their
     dossier is open — is about them, not about a stranger. */
  var pronounLed = /^\s*(?:she|he|they|her|his|their|him|them)\b/i.test(text);
  if (!out.person && /\b(she|he|they|her|his|their|them|him)\b/i.test(text)) {
    var referent = (selected && selected.ref) || lastSubject;
    if (referent && !out.name) {
      out.person = referent; out.name = referent.name; out.byPronoun = true;
    }
  }

  var body = out.name ? work.split(out.name).join(' ') : work;

  // 9. schools — several, each possibly undergrad or graduate. People write
  //    them in lower case as often as not, so casing is restored on the way in.
  var GRAD = /\b(mba|ph\.?d|phd|masters?|master's|grad school|graduate school|jd|md|mfa|m\.?s\.?|m\.?a\.?|doctorate|law school|med school|business school|residency|fellowship)\b/i;
  var UNDER = /\b(undergrad(?:uate)?|bachelors?|b\.?[as]\.?|freshman|sophomore)\b/i;

  function levelNear(hay) {
    if (GRAD.test(hay)) return 'grad';
    if (UNDER.test(hay)) return 'undergrad';
    return '';
  }

  var SCHOOL_NAME = "[\\w'’.&-]+(?:\\s+[\\w'’.&-]+){0,3}";
  var seenSchool = {};
  function noteSchool(name, hay) {
    name = titleCase(clean(name).replace(/\s+(?:for|in|on|as|with|and)$/i, ''));
    if (!name || name.length < 2) return;
    if (seenSchool[name.toLowerCase()]) return;
    seenSchool[name.toLowerCase()] = 1;
    addSchool(out.schools, name, levelNear(hay));
  }

  var sre = new RegExp('\\b(?:went to|studied at|graduated from|attended|was at|alum(?:n|ni|na|nus)?\\s+of|did (?:her|his|their) (?:mba|ph\\.?d|masters?|jd|md|mfa|degree|doctorate|undergrad) at|got (?:her|his|their) (?:mba|ph\\.?d|masters?|jd|md|mfa|degree|doctorate) (?:at|from))\\s+(' + SCHOOL_NAME + ')([^.;\\n]{0,28})', 'gi');
  while ((m = sre.exec(body))) noteSchool(m[1], m[0] + ' ' + (m[2] || ''));

  var are = new RegExp('\\b(' + SCHOOL_NAME + ')\\s+(?:alumn?[ai]?|alumnus|alumna|grad(?:uate)?|undergrad)\\b', 'gi');
  while ((m = are.exec(body))) noteSchool(m[1], m[0]);

  // "her MBA at Wharton", "law school at Penn"
  var gre = new RegExp('\\b(mba|ph\\.?d|masters?|jd|md|mfa|grad school|law school|med school|business school)\\s+(?:at|from)\\s+(' + SCHOOL_NAME + ')', 'gi');
  while ((m = gre.exec(body))) noteSchool(m[2], m[0]);

  out.schools.forEach(function (sc) { body = body.split(new RegExp(sc.name, 'i')).join(' '); });

  // 10. what they do, and where.
  //     Kept deliberately tight: a loose pattern here used to swallow half the
  //     sentence ("a chat with who works at …") and file it as a profession.
  var JOBBY = /\b(with|who|that|which|and|but|chat|call|meeting|zoom|coffee|lunch|dinner|drinks|conference|about|from|had)\b/i;
  // a role may be several words, but never runs on through a preposition
  var STOPW = "(?!at\\b|for\\b|with\\b|in\\b|of\\b|from\\b|to\\b|and\\b|who\\b|that\\b)";
  var ROLE = "((?:[a-z][\\w/&.’'-]*)(?:\\s+" + STOPW + "[a-z][\\w/&.’'-]*){0,3})";

  function takeRole(v) {
    v = titleish(v).replace(/\s+(?:at|for|with|in|of|from|to|and)$/i, '');
    if (!v || v.length < 3 || JOBBY.test(v)) return false;
    take('profession', v);
    return true;
  }

  if (!out.patch.profession && (m = new RegExp('\\b(?:is|was|works|she.s|he.s|they.re)\\s+(?:as\\s+)?(?:a|an|the)\\s+' + ROLE + '\\s+(?:at|for|with)\\s+([A-Z][\\w&.\'’-]*(?:\\s+[A-Z][\\w&.\'’-]*){0,2})').exec(body))) {
    if (takeRole(m[1])) take('company', m[2]);
  }
  if (!out.patch.profession && (m = new RegExp("\\b(?:is|was|she's|he's|they's|they're|works as)\\s+(?:a|an|the)\\s+" + ROLE).exec(body))) {
    takeRole(m[1]);
  }
  if (!out.patch.profession && (m = new RegExp('\\b(?:runs|owns|manages|leads|teaches|bakes|makes)\\s+(?:a|an|the)\\s+' + ROLE).exec(body))) {
    var whole = clean(m[0]);
    if (!JOBBY.test(m[1])) take('profession', whole);
  }
  if (!out.patch.company && (m = /\b(?:works? (?:at|for)|working (?:at|for)|is (?:at|with)|joined|started at|now at|over at|founded|employed (?:at|by))\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,2})/.exec(body))) {
    take('company', m[1]);
  }
  if (!out.patch.location && (m = /\b(?:lives in|living in|based in|moved to|is in|located in|out of|home in)\s+([A-Z][\w.'’-]*(?:[\s,]+[A-Z][\w.'’-]*){0,2})/.exec(body))) {
    take('location', m[1]);
  }

  // 11. who connected us
  var VIA = null;
  var intro = new RegExp('(' + NAME + ')\\s+(?:introduced|connected|put)\\s+me\\s+(?:to|with|onto)\\s+(' + NAME + ')').exec(text);
  if (intro) {
    VIA = intro[1];
    if (!out.person && clean(intro[2])) { out.name = clean(intro[2]); out.person = findPerson(out.name); }
  }
  if (!VIA && (m = new RegExp('\\b(?:through|via|introduced by|intro(?:\'d)?\\s+by|referred by|thanks to|friend of|from)\\s+(' + NAME + ')').exec(body))) VIA = m[1];
  if (!VIA && (m = new RegExp('\\bgot\\s+(?:her|his|their)\\s+(?:info|number|email|details|contact)\\s+from\\s+(' + NAME + ')').exec(text))) VIA = m[1];
  if (VIA) {
    var viaPerson = findPerson(clean(VIA).replace(HONORIFIC, ''));
    if (viaPerson && viaPerson.name !== out.name) out.via = viaPerson;
    else if (!viaPerson) out.viaName = clean(VIA).replace(HONORIFIC, '');
  }

  // 12. the takeaway
  if ((m = /\b(?:learned|found out|turns out|apparently|note that|she (?:said|mentioned)|he (?:said|mentioned)|they (?:said|mentioned)|told me)\s+(?:that\s+)?(.{4,})/i.exec(work))) {
    out.learned = clean(m[1].split(/\.\s+|;\s+|\s+\|\s+/)[0])
      .replace(/^(?:about|that|how|why|of)\s+/i, '').slice(0, 180);
  }

  if (!out.learned && (m = /(?:^|,\s*|—\s*)(?:she|he|they)\s+((?:has|have|had|is|was|just|recently|now|wants|needs|works|runs|might|will|would|left|joined|started|moved)\b.{3,140})/i.exec(text))) {
    out.learned = clean(m[1].split(/\.\s+/)[0]).slice(0, 180);
  }

  // 13. how and when
  var channel = '';
  for (var c = 0; c < CHANNELS.length; c++) { if (CHANNELS[c][1].test(text)) { channel = CHANNELS[c][0]; break; } }
  out.entry = { channel: channel || 'note', at: relativeDate(text), text: text, learned: out.learned || '' };

  var fu = futureDate(text);
  if (fu) out.followUp = { date: fu, what: '' };

  // 14. which circle it sprouts from
  if (!out.patch.circle) {
    var known = circleList().map(function (x) { return x.name.toLowerCase(); });
    for (var t = 0; t < out.tags.length; t++) {
      if (known.indexOf(out.tags[t].toLowerCase()) >= 0) { out.patch.circle = out.tags[t]; break; }
    }
  }
  if (!out.patch.circle && !out.person) {
    if (out.patch.company) out.patch.circle = 'Work';
    else if (out.schools.length) out.patch.circle = 'School';
  }
  if (out.patch.circle) out.patch.circle = out.patch.circle.charAt(0).toUpperCase() + out.patch.circle.slice(1);

  Object.keys(out.patch).forEach(function (k) { if (!out.patch[k]) delete out.patch[k]; });

  /* A bare fact is an edit to the card, not something that happened. */
  var happened = !!channel || /\b(learned|found out|turns out|told me|mentioned|saw|ran into|introduced|reached out|heard|had a|met)\b/i.test(text);
  if (!happened && (Object.keys(out.patch).length || Object.keys(out.custom).length || out.clears.length)) out.entry = null;

  return out;
}

/* Applies a confirmed draft. Returns the person it landed on. */
function commit(draft) {
  var p = draft.person;
  if (!p) { p = blankPerson(draft.name || 'Unnamed'); state.people.push(p); }
  Object.keys(draft.patch).forEach(function (k) {
    if (k === 'circle') {
      if (p.circles && p.circles.length && !draft.circleForced) return;
      joinCircle(p, draft.patch.circle, true);
      return;
    }
    p[k] = draft.patch[k];
  });
  (draft.schools || []).forEach(function (sc) { addSchool(p.schools, sc.name, sc.level); });
  if (draft.via || draft.viaName) {
    var source = draft.via;
    if (!source && draft.viaName) {
      source = findPerson(draft.viaName);
      if (!source) { source = blankPerson(draft.viaName); state.people.push(source); }
    }
    if (source) tie(p, source.id, 'intro');
  }
  (draft.clears || []).forEach(function (k) { p[k] = ''; });
  if (draft.custom && Object.keys(draft.custom).length) {
    p.custom = p.custom || {};
    Object.keys(draft.custom).forEach(function (k) { p.custom[k] = draft.custom[k]; });
  }
  (draft.tags || []).forEach(function (t) { if (p.tags.indexOf(t) < 0) p.tags.push(t); });
  if (draft.entry && draft.entry.text) {
    p.log.unshift({ id: uid(), at: draft.entry.at, channel: draft.entry.channel, text: draft.entry.text, learned: draft.entry.learned || '' });
  }
  if (draft.followUp) p.followUp = draft.followUp;
  circlesOf(p).forEach(circleIndex);
  p.updated = Date.now();
  lastSubject = p;
  save();
  return p;
}

/* --------------------------------------------------------------- layout -- */
/* A three-tier mind map: me → circles → people. Positions come from a small
   spring simulation so the thing settles into something organic, but each
   circle is nudged toward its own ray so branches don't tangle. */

var nodes = [], links = [], byId = {};
var alpha = 0;

function rebuild() {
  var prev = {};
  nodes.forEach(function (n) { prev[n.id] = n; });
  nodes = []; links = []; byId = {};

  var visible = state.people.filter(function (p) {
    return circlesOf(p).some(function (c) { return !hidden[c]; });
  });

  var me = mk('me', 'me', state.me.name || 'Me', null, 0);
  me.x = 0; me.y = 0;

  var circles = [];
  (state.circles || []).forEach(function (c) { if (c !== 'Unsorted' && !hidden[c]) circles.push(c); });
  visible.forEach(function (p) {
    circlesOf(p).forEach(function (c) { if (!hidden[c] && circles.indexOf(c) < 0) circles.push(c); });
  });
  circles.sort(function (a, b) { return circleIndex(a) - circleIndex(b); });

  // Each circle owns a wedge sized by its population, so a School of thirty
  // gets the room it needs and a Family of two does not sprawl.
  var counts = circles.map(function (c) {
    return Math.max(1, visible.filter(function (p) { return inCircle(p, c) && !hidden[c]; }).length);
  });
  var total = counts.reduce(function (a, b) { return a + b; }, 0) || 1;
  var cursor = -Math.PI / 2;

  circles.forEach(function (c, i) {
    var share = counts[i] / total;
    var span = share * Math.PI * 2;
    var node = mk('c:' + c, 'circle', c, c, circleIndex(c));
    node.angle = cursor + span / 2;
    node.span = span;
    node.weight = counts[i];
    // busier circles stand a little further out, so their people have room
    node.ring = 175 + Math.min(150, Math.sqrt(counts[i]) * 34);
    cursor += span;
    if (!prev[node.id]) {
      node.x = Math.cos(node.angle) * node.ring;
      node.y = Math.sin(node.angle) * node.ring;
    }
    links.push({ a: me, b: node, len: node.ring, k: 0.02 });
  });

  visible.forEach(function (p) {
    var mine = circlesOf(p).filter(function (c) { return !hidden[c]; });
    var parent = byId['c:' + mine[0]] || me;
    var n = mk(p.id, 'person', p.name, p, circleIndex(mine[0]));
    n.parent = parent;
    n.circles = mine;
    n.strength = p.log.length;
    n.cold = isCold(p);
    n.r = 4.5 + Math.min(6, Math.sqrt(n.strength) * 2.4);
    if (!prev[n.id]) {
      var a = (parent.angle || 0) + (Math.random() - 0.5) * 1.1;
      n.x = parent.x + Math.cos(a) * 105;
      n.y = parent.y + Math.sin(a) * 105;
      n.born = performance.now();
    }
    links.push({ a: parent, b: n, len: 92 + Math.min(30, n.strength * 3), k: 0.035 });
    // a second or third circle pulls more gently, so the person sits between them
    mine.slice(1).forEach(function (c) {
      var other = byId['c:' + c];
      if (other) links.push({ a: other, b: n, len: 118, k: 0.016, secondary: true });
    });
  });

  visible.forEach(function (p) {
    var a = byId[p.id];
    if (!a) return;
    p.ties.forEach(function (t) {
      var b = byId[t.id];
      if (!b) return;
      links.push({ a: a, b: b, len: 96, k: 0.008, tie: true, kind: t.kind });
    });
  });

  function mk(id, kind, label, ref, ci) {
    var old = prev[id];
    var n = {
      id: id, kind: kind, label: label, ref: ref, ci: ci,
      x: old ? old.x : (Math.random() - 0.5) * 60,
      y: old ? old.y : (Math.random() - 0.5) * 60,
      vx: 0, vy: 0, r: kind === 'me' ? 13 : kind === 'circle' ? 6.5 : 6,
      angle: old ? old.angle : 0,
      fx: old ? old.fx : null, fy: old ? old.fy : null,
      born: old ? old.born : 0
    };
    nodes.push(n); byId[id] = n;
    return n;
  }

  alpha = 1;
  updateHint();
}

function tick() {
  if (alpha < 0.005) return false;
  var i, j, a, b, dx, dy, d, f;

  for (i = 0; i < links.length; i++) {
    var L = links[i]; a = L.a; b = L.b;
    dx = b.x - a.x; dy = b.y - a.y;
    d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    f = (d - L.len) * L.k * alpha;
    dx = dx / d * f; dy = dy / d * f;
    b.vx -= dx; b.vy -= dy;
    a.vx += dx * 0.35; a.vy += dy * 0.35;
  }

  for (i = 0; i < nodes.length; i++) {
    a = nodes[i];
    for (j = i + 1; j < nodes.length; j++) {
      b = nodes[j];
      dx = b.x - a.x; dy = b.y - a.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > 62500) continue;
      d = Math.sqrt(d2) || 0.01;
      var min = (a.r + b.r) * 3 + 34;
      f = (min * min / d2) * 0.22 * alpha;
      if (f > 3) f = 3;
      dx = dx / d * f; dy = dy / d * f;
      a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
    }
  }

  for (i = 0; i < nodes.length; i++) {
    a = nodes[i];
    if (a.kind === 'circle') {                    // hold its own ray
      var ring = a.ring || 200;
      var tx = Math.cos(a.angle) * ring, ty = Math.sin(a.angle) * ring;
      a.vx += (tx - a.x) * 0.012 * alpha;
      a.vy += (ty - a.y) * 0.012 * alpha;
    } else if (a.kind === 'person' && a.parent) { // drift outward from the trunk
      var pa = Math.atan2(a.parent.y, a.parent.x);
      var push = 0.28 + Math.min(0.3, (a.parent.weight || 1) * 0.012);
      a.vx += Math.cos(pa) * push * alpha;
      a.vy += Math.sin(pa) * push * alpha;
    }
    if (a.kind === 'me') { a.x = 0; a.y = 0; a.vx = a.vy = 0; continue; }
    if (a.fx !== null && a.fx !== undefined) { a.x = a.fx; a.y = a.fy; a.vx = a.vy = 0; continue; }
    a.vx *= 0.82; a.vy *= 0.82;
    a.x += a.vx; a.y += a.vy;
  }

  alpha *= 0.985;
  return true;
}

/* ---------------------------------------------------------------- plate -- */

var canvas = document.getElementById('plate');
var ctx = canvas.getContext('2d');
var cam = { x: 0, y: 0, k: 1 };
var W = 0, H = 0, dpr = 1;
var hover = null, selected = null, dragging = null, panning = null, moved = false, dropTarget = null;
var C = {};

function readTokens() {
  var s = getComputedStyle(document.documentElement);
  var g = function (n) { return s.getPropertyValue(n).trim(); };
  C = {
    ink: g('--ink'), muted: g('--muted'), faint: g('--faint'),
    rule: g('--rule'), ruleSoft: g('--rule-soft'), accent: g('--accent'),
    ground: g('--ground'), panel: g('--panel'), warn: g('--warn'),
    hues: [null, g('--h1'), g('--h2'), g('--h3'), g('--h4'), g('--h5'), g('--h6'), g('--h7'), g('--h8')]
  };
}

function hueOf(n) { return n.ci ? (C.hues[n.ci] || C.accent) : C.muted; }

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  var r = canvas.getBoundingClientRect();
  W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function toScreen(x, y) { return [(x - cam.x) * cam.k + W / 2, (y - cam.y) * cam.k + H / 2]; }
function toWorld(sx, sy) { return [(sx - W / 2) / cam.k + cam.x, (sy - H / 2) / cam.k + cam.y]; }

/* Everything dragged around gets let go, the springs run, the view re-frames.
   The way to get back to something readable after an afternoon of shoving. */
function tidyMap() {
  nodes.forEach(function (n) { n.fx = n.fy = null; });
  state.people.forEach(function (p) { delete p.pinned; });
  alpha = 1;
  for (var i = 0; i < 240; i++) tick();
  fit();
  needsDraw = true;
}

function fit() {
  if (!nodes.length) return;
  var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  nodes.forEach(function (n) {
    minx = Math.min(minx, n.x - 55); maxx = Math.max(maxx, n.x + 55);
    miny = Math.min(miny, n.y - 34); maxy = Math.max(maxy, n.y + 34);
  });
  // keep the drawing clear of the rail, the chat dock and any open dossier
  var wide = W > 880;
  var L = wide ? 244 : 34, R = (selected && wide ? 400 : 34), T = 16, B = wide ? 132 : 150;
  var availW = Math.max(120, W - L - R), availH = Math.max(120, H - T - B);
  var k = Math.min(availW / (maxx - minx || 1), availH / (maxy - miny || 1));
  cam.k = Math.max(0.25, Math.min(1.4, k));
  var cx = L + availW / 2, cy = T + availH / 2;
  cam.x = (minx + maxx) / 2 - (cx - W / 2) / cam.k;
  cam.y = (miny + maxy) / 2 - (cy - H / 2) / cam.k;
  draw();
}

var rgbCache = {};
function mix(hex, pct) {           // token hex at pct opacity, as rgba()
  var rgb = rgbCache[hex];
  if (!rgb) {
    var h = (hex || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    rgb = isNaN(v) ? [128, 128, 128] : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    rgbCache[hex] = rgb;
  }
  var a = Math.max(0, Math.min(1, pct));
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a.toFixed(3) + ')';
}

/* A branch: a tapered ribbon, wide where it leaves the parent and fine at the
   tip — the single most important line in the drawing. */
function branch(a, b, w0, w1, color, alphaMul) {
  var dx = b.x - a.x, dy = b.y - a.y;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  var nx = -dy / d, ny = dx / d;
  var bow = Math.min(28, d * 0.16) * (a.bowDir || 1);
  var cx = (a.x + b.x) / 2 + nx * bow, cy = (a.y + b.y) / 2 + ny * bow;

  var steps = 16, left = [], right = [];
  for (var i = 0; i <= steps; i++) {
    var t = i / steps, mt = 1 - t;
    var px = mt * mt * a.x + 2 * mt * t * cx + t * t * b.x;
    var py = mt * mt * a.y + 2 * mt * t * cy + t * t * b.y;
    var tx = 2 * mt * (cx - a.x) + 2 * t * (b.x - cx);
    var ty = 2 * mt * (cy - a.y) + 2 * t * (b.y - cy);
    var tl = Math.sqrt(tx * tx + ty * ty) || 1;
    var w = (w0 + (w1 - w0) * Math.pow(t, 0.65)) / 2;
    left.push([px - ty / tl * w, py + tx / tl * w]);
    right.push([px + ty / tl * w, py - tx / tl * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (var l = 1; l < left.length; l++) ctx.lineTo(left[l][0], left[l][1]);
  for (var r = right.length - 1; r >= 0; r--) ctx.lineTo(right[r][0], right[r][1]);
  ctx.closePath();
  ctx.fillStyle = mix(color, 0.5 * alphaMul);
  ctx.fill();
}

function drawPlate() {
  // rings + rim ticks: a plotting surface, not a void
  ctx.save();
  ctx.lineWidth = 1 / cam.k;
  var rings = [110, 200, 300, 410, 530];
  for (var i = 0; i < rings.length; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, rings[i], 0, Math.PI * 2);
    ctx.strokeStyle = mix(C.rule, i === 1 ? 0.85 : 0.4);
    ctx.setLineDash(i === 1 ? [] : [3 / cam.k, 6 / cam.k]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = mix(C.rule, 0.8);
  for (var a = 0; a < 72; a++) {
    var th = a / 72 * Math.PI * 2;
    var big = a % 6 === 0;
    var r0 = 530, r1 = 530 + (big ? 9 : 4);
    ctx.beginPath();
    ctx.moveTo(Math.cos(th) * r0, Math.sin(th) * r0);
    ctx.lineTo(Math.cos(th) * r1, Math.sin(th) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  if (!W) return;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.k, cam.k);
  ctx.translate(-cam.x, -cam.y);

  drawPlate();

  var focus = hover || selected;
  var DIM = hover ? 0.22 : 0.5;
  var lit = {};
  if (focus) {
    lit[focus.id] = 1;
    if (focus.parent) { lit[focus.parent.id] = 1; lit['me'] = 1; }
    if (focus.kind === 'circle') nodes.forEach(function (n) { if (n.parent === focus) lit[n.id] = 1; });
    if (focus.kind === 'person' && focus.ref) {
      tiesOf(focus.ref).forEach(function (t) { lit[t.person.id] = 1; });
    }
    if (focus.kind === 'me') nodes.forEach(function (n) { lit[n.id] = 1; });
  }

  links.forEach(function (L) {
    var dim = focus && !(lit[L.a.id] && lit[L.b.id]) ? DIM : 1;
    if (L.tie) {                                   // person to person
      ctx.save();
      ctx.setLineDash([5 / cam.k, 4 / cam.k]);
      ctx.lineWidth = 1.1 / cam.k;
      ctx.strokeStyle = mix(C.ink, 0.42 * dim);
      ctx.beginPath();
      var mx = (L.a.x + L.b.x) / 2, my = (L.a.y + L.b.y) / 2;
      var dx = L.b.x - L.a.x, dy = L.b.y - L.a.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      ctx.moveTo(L.a.x, L.a.y);
      ctx.quadraticCurveTo(mx - dy / d * d * 0.12, my + dx / d * d * 0.12, L.b.x, L.b.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    var trunk = L.b.kind === 'circle';
    var fade = (L.b.cold ? 0.5 : 1) * dim * (trunk ? 0.5 : 1) * (L.secondary ? 0.5 : 1);
    var hue = L.secondary ? (C.hues[circleIndex(L.a.label)] || C.accent) : hueOf(L.b);
    branch(L.a, L.b, trunk ? 7 : (L.secondary ? 3 : 5), trunk ? 2.8 : 1.1, hue, fade);
  });

  nodes.forEach(function (n) {
    var dim = focus && !lit[n.id] ? DIM : 1;
    var col = n.kind === 'me' ? C.accent : hueOf(n);
    var grow = n.born ? Math.min(1, (performance.now() - n.born) / 420) : 1;
    var r = n.r * (0.4 + 0.6 * grow);

    if (n.kind === 'me') {
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
      ctx.fillStyle = mix(C.accent, 0.1); ctx.fill();
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.accent; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 4.5, 0, Math.PI * 2);
      ctx.lineWidth = 1 / cam.k; ctx.strokeStyle = mix(C.accent, 0.7); ctx.stroke();
    } else if (n.kind === 'circle') {
      if (dropTarget === n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 16, 0, Math.PI * 2);
        ctx.fillStyle = mix(col, 0.14); ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 11, 0, Math.PI * 2);
        ctx.lineWidth = 1.4 / cam.k; ctx.setLineDash([4 / cam.k, 3 / cam.k]);
        ctx.strokeStyle = mix(col, 0.95); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = mix(C.ground, 1); ctx.fill();
      ctx.lineWidth = (dropTarget === n ? 2.6 : 1.8) / cam.k;
      ctx.strokeStyle = mix(col, 0.85 * dim); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = mix(col, (n.cold ? 0.14 : 0.92) * dim);
      ctx.fill();
      if (n.cold) {
        ctx.lineWidth = 1.3 / cam.k;
        ctx.strokeStyle = mix(col, 0.7 * dim); ctx.stroke();
      }
      if (dropTarget === n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 12, 0, Math.PI * 2);
        ctx.fillStyle = mix(col, 0.14); ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
        ctx.lineWidth = 1.4 / cam.k; ctx.setLineDash([4 / cam.k, 3 / cam.k]);
        ctx.strokeStyle = mix(col, 0.95); ctx.stroke(); ctx.setLineDash([]);
      }
      if (selected === n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
        ctx.lineWidth = 1.2 / cam.k; ctx.strokeStyle = C.ink; ctx.stroke();
      }
      if (n.ref && n.ref.followUp && n.ref.followUp.date <= Date.now() + DAY) {
        ctx.beginPath(); ctx.arc(n.x + r + 4, n.y - r - 2, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = C.warn; ctx.fill();
      }
    }
  });

  ctx.restore();

  // Labels sit in screen space so they never distort with zoom. They are laid
  // out most-important-first and a label that would land on one already placed
  // is dropped rather than overprinted — zoom in (or hover) to get it back.
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';

  var jobs = nodes.slice().sort(function (a, b) { return labelRank(a) - labelRank(b); });
  var placed = [];
  jobs.forEach(function (n) {
    var p = toScreen(n.x, n.y);
    if (p[0] < -140 || p[0] > W + 140 || p[1] < -60 || p[1] > H + 60) return;
    var dim = focus && !lit[n.id] ? Math.max(DIM, 0.3) : 1;
    var off = n.r * cam.k + 7;
    var text = n.label, y = p[1] + off, h = 13;

    if (n.kind === 'circle') {
      ctx.font = '500 9.5px "JetBrains Mono", monospace';
      ctx.letterSpacing = '1.6px';
      text = n.label.toUpperCase();
    } else if (n.kind === 'me') {
      ctx.font = '400 15px "Instrument Serif", Georgia, serif';
      ctx.letterSpacing = '0px';
      y += 2; h = 17;
    } else {
      ctx.font = (n === focus ? '500 ' : '400 ') + '11.5px Archivo, system-ui, sans-serif';
      ctx.letterSpacing = '0.2px';
    }

    var w = ctx.measureText(text).width + 8;
    var hits = function (bx) {
      return placed.some(function (q) {
        return bx[0] < q[0] + q[2] && bx[0] + bx[2] > q[0] && bx[1] < q[1] + q[3] && bx[1] + bx[3] > q[1];
      });
    };
    // nudge a clashing label out of the way rather than hiding the person
    var box = [p[0] - w / 2, y - 2, w, h];
    var nudges = [0, h + 1, -(h + 1), 2 * (h + 1), -2 * (h + 1), 3 * (h + 1), -3 * (h + 1)];
    for (var k = 0; k < nudges.length; k++) {
      box = [p[0] - w / 2, y - 2 + nudges[k], w, h];
      if (!hits(box)) break;
    }
    y = box[1] + 2;
    placed.push(box);

    if (Math.abs(y - (p[1] + off)) > 4) {
      ctx.save();
      ctx.strokeStyle = mix(C.rule, 0.9 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] + off - 1);
      ctx.lineTo(p[0], y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = n.kind === 'circle' ? mix(C.muted, dim)
      : n.kind === 'me' ? C.ink
      : mix(n.cold ? C.muted : C.ink, dim);
    ctx.fillText(text, p[0], y);
  });
  ctx.letterSpacing = '0px';
  ctx.restore();

  function labelRank(n) {
    if (n === focus || n === selected) return -2;
    if (n.kind === 'me') return -1;
    if (n.kind === 'circle') return 0;
    return 1 + 1 / (1 + (n.strength || 0));   // busiest people keep their names
  }
}

var raf = null;
function loop() {
  raf = requestAnimationFrame(loop);
  var moving = tick();
  var sprouting = nodes.some(function (n) { return n.born && performance.now() - n.born < 460; });
  if (moving || sprouting || needsDraw) { needsDraw = false; draw(); }
}
var needsDraw = false;
function kick() { alpha = Math.max(alpha, 0.65); needsDraw = true; }

/* Which circle is under the cursor, for a drop. Generous on purpose — the
   target is a small dot and fingers are not. */
/* A person under the cursor, for connecting two people by dragging. */
function personUnder(sx, sy, except) {
  var w = toWorld(sx, sy), best = null, bd = 1e9;
  nodes.forEach(function (n) {
    if (n.kind !== 'person' || n === except) return;
    var d = Math.sqrt((w[0] - n.x) * (w[0] - n.x) + (w[1] - n.y) * (w[1] - n.y));
    if (d < Math.max(26, 30 / cam.k) && d < bd) { bd = d; best = n; }
  });
  return best;
}

function circleUnder(sx, sy) {
  var w = toWorld(sx, sy), best = null, bd = 1e9;
  nodes.forEach(function (n) {
    if (n.kind !== 'circle') return;
    var d = Math.sqrt((w[0] - n.x) * (w[0] - n.x) + (w[1] - n.y) * (w[1] - n.y));
    if (d < Math.max(46, 54 / cam.k) && d < bd) { bd = d; best = n; }
  });
  return best;
}

function nodeAt(sx, sy) {
  var w = toWorld(sx, sy), best = null, bd = 1e9;
  for (var i = nodes.length - 1; i >= 0; i--) {
    var n = nodes[i];
    var dx = w[0] - n.x, dy = w[1] - n.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var hitR = Math.max(n.r + 9, 14 / cam.k);
    if (d < hitR && d < bd) { bd = d; best = n; }
  }
  return best;
}

/* ------------------------------------------------------------ interface -- */

var $ = function (s) { return document.querySelector(s); };
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(t) {
  var d = new Date(t), now = new Date();
  var opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
function ago(t) {
  var n = daysSince(t);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 31) return n + 'd ago';
  if (n < 365) return Math.round(n / 30) + 'mo ago';
  return (n / 365).toFixed(1) + 'y ago';
}

var toastTimer = null;
function toast(msg, actionLabel, action) {
  var t = $('#toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>';
  if (actionLabel) {
    var b = document.createElement('button');
    b.className = 'undo';
    b.textContent = actionLabel;
    b.addEventListener('click', function () { t.hidden = true; action(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, actionLabel ? 7000 : 2600);
}

/* ---- rails ---- */

function updateHint() { $('#hint').hidden = state.people.length > 0; }

function renderStats() {
  var cold = state.people.filter(nudgeDue).length;
  var logs = state.people.reduce(function (a, p) { return a + p.log.length; }, 0);
  $('#stats').innerHTML =
    '<span><b>' + state.people.length + '</b> people</span>' +
    '<span><b>' + circleList().length + '</b> circles</span>' +
    '<span><b>' + logs + '</b> touchpoints</span>' +
    (cold ? '<span class="cold"><b>' + cold + '</b> to nudge</span>' : '');
}

function renderLegend() {
  var names = Object.keys(hidden).filter(function (c) { return hidden[c]; });
  var bar = $('#hiddenbar');
  bar.hidden = !names.length;
  $('#hidden-count').textContent = names.length || '';
  $('#hiddenlist').innerHTML = names.map(function (name) {
    return '<div class="lrow"><button class="lname" data-circle="' + esc(name) + '" title="Show it again">' +
      '<span class="swatch" style="background:var(--h' + circleIndex(name) + ')"></span>' +
      '<span class="cname">' + esc(name) + '</span><span class="n">show</span></button></div>';
  }).join('');
}

function renderNudges() {
  var due = state.people.filter(nudgeDue).sort(function (a, b) { return lastTouch(a) - lastTouch(b); });
  $('#nudge-count').textContent = due.length || '';
  $('#nudges').innerHTML = due.slice(0, 12).map(function (p) {
    var why = (p.followUp && p.followUp.date <= Date.now() + DAY)
      ? 'follow-up due' : 'last touch ' + ago(lastTouch(p));
    return '<button data-goto="' + p.id + '"><span class="n1">' + esc(p.name) + '</span><br>' +
      '<span class="n2">' + esc(why) + '</span></button>';
  }).join('') || '<div class="empty">Everyone is warm. Nice.</div>';
}

function renderAll() {
  rebuild(); renderStats(); renderLegend(); renderNudges(); kick();
  if (selected && selected.kind === 'person') {
    var still = state.people.filter(function (p) { return p.id === selected.id; })[0];
    if (still) openDossier(byId[still.id] || selected); else closeDossier();
  }
}

/* ---- dossier ---- */

var CHANNEL_LABEL = {
  zoom: 'zoom', call: 'call', coffee: 'coffee', meal: 'meal', event: 'event',
  email: 'email', message: 'message', intro: 'intro', met: 'met', note: 'note'
};

/* Click a value, type over it. Used for every field on a card. */
function editInPlace(el, current, multiline, done) {
  var box = document.createElement(multiline ? 'textarea' : 'input');
  box.value = current || '';
  box.className = 'inplace';
  if (multiline) box.rows = Math.min(6, Math.max(2, Math.ceil((current || '').length / 40)));
  var parent = el.parentNode;
  parent.replaceChild(box, el);
  box.focus();
  box.select();
  var finished = false;
  var finish = function (commitIt) {
    if (finished) return;
    finished = true;
    if (commitIt) done(clean(box.value)); else done(null);
  };
  box.addEventListener('blur', function () { finish(true); });
  box.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

function openDossier(node) {
  var p = node && node.ref;
  if (!p || node.kind !== 'person') return;
  selected = node;
  var d = $('#dossier');
  var col = 'var(--h' + circleIndex(primaryCircle(p)) + ')';
  var lt = lastTouch(p);

  function row(k, field, v, href) {
    var body = v
      ? (href ? '<a href="' + href + esc(v) + '" data-keep>' + esc(v) + '</a>' : esc(v))
      : '<span class="add">add</span>';
    return '<dt>' + esc(k) + '</dt>' +
      '<dd class="' + (v ? '' : 'empty') + '"><span class="val" data-field="' + esc(field) + '" tabindex="0" role="button" ' +
      'title="Click to edit">' + body + '</span></dd>';
  }

  d.innerHTML =
    '<div class="d-top">' +
      '<button class="d-close" id="d-close" aria-label="Close">&times;</button>' +
      '<div class="d-kicker"><span class="swatch" style="background:' + col + '"></span>' +
        p.log.length + ' touchpoint' + (p.log.length === 1 ? '' : 's') +
        ' · last ' + (p.log.length ? ago(lt) : 'never') + '</div>' +
      '<h2 class="d-name"><span class="val" data-field="name" tabindex="0" role="button" title="Click to rename">' + esc(p.name) + '</span></h2>' +
      '<div class="d-sub">' + esc([p.profession, p.company].filter(Boolean).join(' · ') || 'No role recorded') + '</div>' +
    '</div>' +
    '<div class="d-body">' +
      '<div class="d-sec"><h4>Circles</h4>' +
        '<div class="circlechips">' +
          circlesOf(p).map(function (c, i) {
            return '<span class="cchip' + (i === 0 ? ' primary' : '') + '" style="--hue:var(--h' + circleIndex(c) + ')">' +
              '<button class="lbl" data-primary="' + esc(c) + '" title="' + (i === 0 ? 'Primary circle' : 'Make this their primary circle') + '">' + esc(c) + '</button>' +
              '<button class="x" data-leave="' + esc(c) + '" aria-label="Remove from ' + esc(c) + '">&times;</button></span>';
          }).join('') +
          '<span class="cchip add"><button data-addcircle aria-label="Add to a circle">+ circle</button></span>' +
        '</div>' +
      '</div>' +
      '<div class="d-sec"><h4>Connections</h4>' +
        '<div class="chiplist">' +
          tiesOf(p).map(function (t) {
            return '<span class="cchip tie">' +
              '<button class="lbl" data-goto="' + t.person.id + '" title="Open ' + esc(t.person.name) + '">' +
                '<i>' + (t.own ? 'via' : 'led to') + '</i>' + esc(t.person.name) + '</button>' +
              '<button class="x" data-untie="' + t.person.id + '" data-own="' + (t.own ? 1 : 0) + '" aria-label="Remove connection">&times;</button></span>';
          }).join('') +
          '<input class="chipinput" data-add="tie" placeholder="' + (tiesOf(p).length ? 'another…' : 'Who connected you?') + '" aria-label="Add a connection">' +
        '</div>' +
        (tiesOf(p).length ? '<p class="tiehint">via — who put you onto them · led to — who you met through them</p>' : '') +
      '</div>' +

      '<div class="d-sec"><h4>Schools</h4>' +
        '<div class="chiplist">' +
          schoolsOf(p).map(function (sc, i) {
            return '<span class="cchip school">' +
              '<button class="lbl" data-editschool="' + i + '" title="Click to rename">' + esc(sc.name) + '</button>' +
              '<button class="lvl' + (sc.level ? '' : ' none') + '" data-level="' + i + '" title="Undergrad, grad, or unspecified">' +
                (sc.level || 'level') + '</button>' +
              '<button class="x" data-rmschool="' + i + '" aria-label="Remove ' + esc(sc.name) + '">&times;</button></span>';
          }).join('') +
          '<input class="chipinput" data-add="school" placeholder="' + (schoolsOf(p).length ? 'another…' : 'Add a school…') + '" aria-label="Add a school">' +
        '</div>' +
      '</div>' +

      '<div class="d-sec"><h4>Card</h4><dl class="fields">' +
        row('Email', 'email', p.email, 'mailto:') + row('Phone', 'phone', p.phone, 'tel:') +
        row('Profession', 'profession', p.profession) + row('Company', 'company', p.company) +
        row('Location', 'location', p.location) +
        Object.keys(p.custom || {}).map(function (k) {
          return '<dt>' + esc(k) + '</dt><dd><span class="val" data-custom="' + esc(k) + '" tabindex="0" role="button" ' +
            'title="Click to edit">' + esc(p.custom[k]) + '</span></dd>';
        }).join('') +
        (p.followUp && p.followUp.date ? '<dt>Follow up</dt><dd><span class="val" data-followup tabindex="0" role="button">' +
          fmtDate(p.followUp.date) + '</span></dd>' : '') +
      '</dl>' +
      '<button class="addfield" data-newfield>+ another field</button>' +
      '</div>' +

      '<div class="d-sec"><h4>Tags</h4>' +
        '<div class="chiplist">' +
          p.tags.map(function (t, i) {
            return '<span class="cchip tag"><span class="lbl">#' + esc(t) + '</span>' +
              '<button class="x" data-rmtag="' + i + '" aria-label="Remove ' + esc(t) + '">&times;</button></span>';
          }).join('') +
          '<input class="chipinput" data-add="tag" placeholder="' + (p.tags.length ? 'another…' : 'Add a tag…') + '" aria-label="Add a tag">' +
        '</div>' +
      '</div>' +

      '<div class="d-sec"><h4>History</h4>' +
        (p.log.length ? '<div class="log">' + p.log.map(function (e) {
          return '<div class="entry">' +
            '<button class="del" data-dellog="' + e.id + '" title="Delete entry">&times;</button>' +
            '<div class="e-top"><span class="e-ch">' + esc(CHANNEL_LABEL[e.channel] || e.channel) + '</span>' +
            '<span>' + fmtDate(e.at) + '</span></div>' +
            '<p>' + esc(e.text) + '</p>' +
            (e.learned ? '<div class="learned">' + esc(e.learned) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>' : '<div class="empty" style="color:var(--faint);font-size:12.5px">Nothing logged yet.</div>') +
      '</div>' +

      '<div class="d-sec"><h4>Notes</h4><div class="notes-list">' +
        p.notes.map(function (n) {
          return '<div class="note"><button class="del" data-delnote="' + n.id + '">&times;</button>' +
            '<span class="val" data-note="' + n.id + '" tabindex="0" role="button" title="Click to edit">' + esc(n.t) + '</span></div>';
        }).join('') +
        '<textarea class="notebox" id="notebox" rows="1" placeholder="Anything worth remembering — ⌘↵ to keep" aria-label="Add a note"></textarea>' +
      '</div></div>' +

      '<div class="d-actions">' +
        '<button class="btn" data-log="' + p.id + '">Log a touchpoint</button>' +
        '<button class="btn" data-del="' + p.id + '" style="margin-left:auto">Delete</button>' +
      '</div>' +
    '</div>';

  var nb = d.querySelector('.notebox');
  if (nb) nb.addEventListener('input', function () {
    nb.style.height = 'auto';
    nb.style.height = Math.min(160, nb.scrollHeight) + 'px';
  });

  d.classList.add('open');
  $('#stage').classList.add('panel-open');
  d.setAttribute('aria-hidden', 'false');
  needsDraw = true;
}

function closeDossier() {
  selected = null;
  var d = $('#dossier');
  d.classList.remove('open');
  $('#stage').classList.remove('panel-open');
  d.setAttribute('aria-hidden', 'true');
  needsDraw = true;
}

$('#dossier').addEventListener('click', function (e) {
  var p = selected && selected.ref;
  if (!p) return;

  // editing a value in place
  var v = e.target.closest('.val');
  if (v && !e.target.closest('[data-keep]')) {
    var field = v.dataset.field, ckey = v.dataset.custom;
    if (v.hasAttribute('data-followup')) {
      return editInPlace(v, p.followUp ? new Date(p.followUp.date).toISOString().slice(0, 10) : '', false, function (val) {
        if (val === null) return openDossier(selected);
        var d = Date.parse(val);
        p.followUp = isNaN(d) ? null : { date: d, what: p.followUp ? p.followUp.what : '' };
        touch(p); save(); renderAll(); openDossier(selected);
      });
    }
    if (v.dataset.note) {
      var nid = v.dataset.note;
      var note = p.notes.filter(function (x) { return x.id === nid; })[0];
      return editInPlace(v, note ? note.t : '', true, function (val) {
        if (val === null) return openDossier(selected);
        if (val) note.t = val; else p.notes = p.notes.filter(function (x) { return x.id !== nid; });
        touch(p); save(); renderAll(); openDossier(selected);
      });
    }
    if (ckey) {
      return editInPlace(v, p.custom[ckey], false, function (val) {
        if (val === null) return openDossier(selected);
        if (val) p.custom[ckey] = val; else delete p.custom[ckey];
        touch(p); save(); renderAll(); openDossier(selected);
      });
    }
    if (field) {
      var long = field === 'howMet';
      return editInPlace(v, p[field] || '', long, function (val) {
        if (val === null) return openDossier(selected);
        if (field === 'name' && !val) return openDossier(selected);
        p[field] = val;
        touch(p); save(); renderAll(); openDossier(selected);
      });
    }
  }

  var t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'd-close') return closeDossier();

  if (t.dataset.level !== undefined && t.hasAttribute('data-level')) {
    var sc = schoolsOf(p)[+t.dataset.level];
    if (sc) { sc.level = LEVELS[(LEVELS.indexOf(sc.level) + 1) % LEVELS.length]; touch(p); save(); openDossier(selected); }
    return;
  }
  if (t.dataset.rmschool !== undefined && t.hasAttribute('data-rmschool')) {
    p.schools.splice(+t.dataset.rmschool, 1); touch(p); save(); renderAll(); return;
  }
  if (t.dataset.editschool !== undefined && t.hasAttribute('data-editschool')) {
    var idx = +t.dataset.editschool;
    return editInPlace(t, p.schools[idx].name, false, function (val) {
      if (val) p.schools[idx].name = val; else if (val === '') p.schools.splice(idx, 1);
      touch(p); save(); renderAll(); openDossier(selected);
    });
  }
  if (t.dataset.delnote) {
    p.notes = p.notes.filter(function (x) { return x.id !== t.dataset.delnote; });
    touch(p); save(); openDossier(selected); renderAll(); return;
  }
  if (t.dataset.untie) {
    var otherId = t.dataset.untie;
    if (t.dataset.own === '1') untie(p, otherId);
    else { var other = personById(otherId); if (other) untie(other, p.id); }
    save(); renderAll(); openDossier(selected); return;
  }
  if (t.dataset.rmtag !== undefined && t.hasAttribute('data-rmtag')) {
    p.tags.splice(+t.dataset.rmtag, 1); touch(p); save(); renderAll(); return;
  }
  if (t.dataset.primary) { joinCircle(p, t.dataset.primary, true); save(); renderAll(); return; }
  if (t.dataset.leave) {
    leaveCircle(p, t.dataset.leave);
    save(); renderAll(); return;
  }
  if (t.hasAttribute('data-addcircle')) return circlePicker(t, function (name) {
    joinCircle(p, name, false); save(); renderAll();
  });
  if (t.dataset.newfield !== undefined && t.hasAttribute('data-newfield')) {
    var row = document.createElement('div');
    row.className = 'newfield';
    row.innerHTML = '<input class="k" placeholder="Field name"><input class="v" placeholder="Value">';
    t.replaceWith(row);
    var kk = row.querySelector('.k'), vv = row.querySelector('.v');
    kk.focus();
    var commit = function () {
      var key = clean(kk.value).toLowerCase(), val = clean(vv.value);
      if (key && val) { p.custom[key] = val; touch(p); save(); renderAll(); }
      openDossier(selected);
    };
    [kk, vv].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); (inp === kk ? vv : { focus: commit }).focus(); if (inp === vv) commit(); }
        if (e.key === 'Escape') { e.preventDefault(); openDossier(selected); }
      });
    });
    vv.addEventListener('blur', function () { setTimeout(commit, 120); });
    return;
  }
  if (t.dataset.log) { $('#chat').value = 'Talked with ' + p.name + ' — '; $('#chat').focus(); return; }
  if (t.dataset.del) {
    if (!confirm('Delete ' + p.name + ' and their history?')) return;
    forget(p);
    save(); closeDossier(); renderAll(); toast(p.name + ' removed');
    return;
  }
  if (t.dataset.dellog) {
    p.log = p.log.filter(function (x) { return x.id !== t.dataset.dellog; });
    touch(p); save(); openDossier(selected); renderAll();
  }
  if (t.dataset.delnote) {
    p.notes = p.notes.filter(function (x) { return x.id !== t.dataset.delnote; });
    touch(p); save(); openDossier(selected); renderAll();
  }
});

/* A little popover of the circles that exist, plus a field to name a new one. */
function circlePicker(anchor, pick) {
  var old = document.getElementById('cpick');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'cpick';
  box.className = 'cpick';
  box.innerHTML = circleList().map(function (c) {
    return '<button data-pick="' + esc(c.name) + '"><span class="swatch" style="background:var(--h' + circleIndex(c.name) + ')"></span>' +
      esc(c.name) + '</button>';
  }).join('') +
    '<div class="cnew"><input placeholder="New circle…" aria-label="New circle name"><button class="btn" data-new>Add</button></div>';
  document.body.appendChild(box);

  var r = anchor.getBoundingClientRect();
  box.style.left = Math.min(window.innerWidth - box.offsetWidth - 10, r.left) + 'px';
  box.style.top = Math.min(window.innerHeight - box.offsetHeight - 10, r.bottom + 6) + 'px';

  var field = box.querySelector('input');
  field.focus();
  var done = function (name) { box.remove(); if (name) pick(clean(name)); };
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pick) return done(b.dataset.pick);
    if (b.hasAttribute('data-new')) return done(field.value);
  });
  field.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); done(field.value); }
    if (e.key === 'Escape') { e.stopPropagation(); box.remove(); }
  });
  setTimeout(function () {
    document.addEventListener('pointerdown', function off(e) {
      if (!box.contains(e.target)) { box.remove(); document.removeEventListener('pointerdown', off); }
    });
  }, 0);
}

/* Everything a circle can be: recoloured, renamed, hidden, removed.
   Anchored to the branch itself now that the rail is gone. */
function circleMenu(node) {
  var circle = node.label;
  var old = document.getElementById('cpick');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'cpick';
  box.className = 'cpick circlemenu';
  var n = membersOf(circle).length;
  box.innerHTML = '<div class="ptitle">' + esc(circle) + ' · ' + plural(n, 'person', 'people') + '</div>' +
    '<div class="pgrid">' + PIGMENTS.map(function (h) {
      return '<button data-hue="' + h.i + '" aria-label="' + h.name + '" title="' + h.name + '"' +
        (circleIndex(circle) === h.i ? ' data-on="1"' : '') +
        '><span style="background:var(--h' + h.i + ')"></span></button>';
    }).join('') + '</div>' +
    '<div class="mrow"><button data-act="rename">Rename…</button>' +
    '<button data-act="hide">Hide</button>' +
    '<button data-act="delete" class="danger">Delete circle</button></div>';
  document.body.appendChild(box);

  var p = toScreen(node.x, node.y);
  var r = canvas.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, r.left + p[0] - box.offsetWidth / 2)) + 'px';
  box.style.top = Math.max(8, Math.min(window.innerHeight - box.offsetHeight - 8, r.top + p[1] + 18)) + 'px';

  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.hue) {
      snapshot(circle + ' colour');
      setCircleColor(circle, +b.dataset.hue);
      save(); renderAll(); box.remove();
      return;
    }
    var act = b.dataset.act;
    box.remove();
    if (act === 'hide') { hidden[circle] = true; renderAll(); toast('Hid ' + circle, 'Show', function () { delete hidden[circle]; renderAll(); }); }
    if (act === 'delete') {
      pendingPlan = {
        summary: 'Delete the ' + circle + ' circle',
        detail: n ? plural(n, 'person', 'people') + ' stay on the map, just no longer filed there.' : 'Nobody is in it.',
        run: function () { membersOf(circle).forEach(function (x) { leaveCircle(x, circle); }); dropCircle(circle); }
      };
      renderPlan();
    }
    if (act === 'rename') {
      var wrap = document.createElement('div');
      wrap.className = 'cpick renamer';
      wrap.innerHTML = '<input value="' + esc(circle) + '" aria-label="New name"><button class="btn">Rename</button>';
      document.body.appendChild(wrap);
      wrap.style.left = box.style.left; wrap.style.top = box.style.top;
      var f = wrap.querySelector('input');
      f.focus(); f.select();
      var go = function () {
        var to = clean(f.value);
        wrap.remove();
        if (!to || to === circle) return;
        snapshot('Rename ' + circle);
        renameCircle(circle, to);
        save(); renderAll();
        toast(circle + ' is now ' + to, 'Undo', undo);
      };
      wrap.querySelector('button').addEventListener('click', go);
      f.addEventListener('keydown', function (e2) {
        e2.stopPropagation();
        if (e2.key === 'Enter') go();
        if (e2.key === 'Escape') wrap.remove();
      });
    }
  });
  setTimeout(function () {
    document.addEventListener('pointerdown', function off(e) {
      if (!box.contains(e.target)) { box.remove(); document.removeEventListener('pointerdown', off); }
    });
  }, 0);
}

function colorPicker(anchor, circle) {
  var old = document.getElementById('cpick');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'cpick';
  box.className = 'cpick palette';
  box.innerHTML = '<div class="ptitle">' + esc(circle) + '</div>' +
    '<div class="pgrid">' + PIGMENTS.map(function (h) {
      var taken = circleList().filter(function (c) {
        return c.name !== circle && circleIndex(c.name) === h.i;
      }).map(function (c) { return c.name; });
      return '<button data-hue="' + h.i + '" aria-label="' + h.name + '"' +
        ' title="' + h.name + (taken.length ? ' — already ' + esc(taken.join(', ')) : '') + '"' +
        (circleIndex(circle) === h.i ? ' data-on="1"' : '') + (taken.length ? ' data-taken="1"' : '') +
        '><span style="background:var(--h' + h.i + ')"></span></button>';
    }).join('') + '</div>';
  document.body.appendChild(box);
  var r = anchor.getBoundingClientRect();
  box.style.left = Math.min(window.innerWidth - box.offsetWidth - 10, r.left) + 'px';
  box.style.top = Math.max(10, Math.min(window.innerHeight - box.offsetHeight - 10, r.top - box.offsetHeight - 6)) + 'px';
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-hue]');
    if (!b) return;
    snapshot(circle + ' colour');
    setCircleColor(circle, +b.dataset.hue);
    save(); renderAll(); box.remove();
  });
  setTimeout(function () {
    document.addEventListener('pointerdown', function off(e) {
      if (!box.contains(e.target)) { box.remove(); document.removeEventListener('pointerdown', off); }
    });
  }, 0);
}

$('#dossier').addEventListener('keydown', function (e) {
  var box = e.target.closest('.notebox');
  if (box) {
    e.stopPropagation();
    var who = selected && selected.ref;
    if (e.key === 'Escape') { box.value = ''; box.blur(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      var text = clean(box.value);
      if (!text || !who) { box.blur(); return; }
      who.notes.unshift({ id: uid(), t: text, at: Date.now() });
      touch(who); save(); renderAll(); openDossier(selected);
      var again = document.getElementById('notebox');
      if (again) again.focus();
      return;
    }
    return;
  }
  var inp = e.target.closest('.chipinput');
  if (!inp) return;
  e.stopPropagation();
  var p = selected && selected.ref;
  if (!p) return;
  if (e.key === 'Escape') { inp.value = ''; inp.blur(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  var val = clean(inp.value);
  if (!val) { inp.blur(); return; }
  if (inp.dataset.add === 'tie') {
    var found = findPerson(val);
    if (!found) { found = blankPerson(titleCase(val)); state.people.push(found); }
    tie(p, found.id, 'intro');
    save(); renderAll(); openDossier(selected);
    var back = $('#dossier').querySelector('.chipinput[data-add="tie"]');
    if (back) back.focus();
    return;
  }
  if (inp.dataset.add === 'school') {
    // "Wharton mba" or "Lehigh undergrad" sets the level in the same breath
    var level = '';
    var stripped = val.replace(/\s*\b(undergrad(?:uate)?|bachelors?)\b\s*/i, function () { level = 'undergrad'; return ' '; })
      .replace(/\s*\b(grad(?:uate)?(?: school)?|mba|ph\.?d|masters?|jd|md|mfa|law school|med school)\b\s*/i, function () { level = 'grad'; return ' '; });
    addSchool(p.schools, titleCase(clean(stripped) || val), level);
  } else {
    var tag = val.replace(/^#/, '');
    if (p.tags.indexOf(tag) < 0) p.tags.push(tag);
  }
  touch(p); save(); renderAll();
  openDossier(selected);
  var again = $('#dossier').querySelector('.chipinput[data-add="' + inp.dataset.add + '"]');
  if (again) again.focus();
});

/* ---- modals ---- */

function modal(title, sub, body, footer) {
  var s = $('#scrim');
  s.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<header><h2>' + esc(title) + '</h2><p>' + esc(sub || '') + '</p>' +
    '<button class="x" data-close aria-label="Close">&times;</button></header>' +
    '<div class="mbody">' + body + '</div>' +
    (footer ? '<footer>' + footer + '</footer>' : '') + '</div>';
  s.hidden = false;
  var first = s.querySelector('input, textarea, button:not([data-close])');
  if (first) first.focus();
  return s.querySelector('.modal');
}
function closeModal() { $('#scrim').hidden = true; $('#scrim').innerHTML = ''; }
$('#scrim').addEventListener('click', function (e) {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) closeModal();
});

function personForm(p) {
  var isNew = !p;
  p = p || blankPerson('');
  var f = function (k, label, type) {
    return '<div class="field' + (type === 'area' ? ' wide' : '') + '"><label for="f-' + k + '">' + label + '</label>' +
      (type === 'area'
        ? '<textarea id="f-' + k + '">' + esc(p[k]) + '</textarea>'
        : '<input id="f-' + k + '" type="' + (type || 'text') + '" value="' + esc(p[k]) + '">') + '</div>';
  };
  var body = '<div class="grid2">' +
    f('name', 'Name') +
    '<div class="field"><label for="f-circle">Circles</label><input id="f-circle" value="' + esc(circlesOf(p).join(', ')) + '">' +
      '<span class="hint">Comma separated. The first one colours their dot.</span></div>' +
    f('email', 'Email', 'email') + f('phone', 'Phone', 'tel') +
    f('profession', 'Profession') + f('company', 'Company') +
    '<div class="field"><label for="f-school">Schools</label><input id="f-school" value="' +
      esc(schoolsOf(p).map(function (x) { return x.name + (x.level ? ' ' + x.level : ''); }).join(', ')) + '">' +
      '<span class="hint">Comma separated. Add “undergrad” or “grad” after a name.</span></div>' +
    f('location', 'Location') +
    '<div class="field wide"><label for="f-tags">Tags</label><input id="f-tags" value="' + esc(p.tags.join(', ')) + '">' +
      '<span class="hint">Comma separated.</span></div>' +
    '<div class="field wide"><label for="f-note">Add a note</label><textarea id="f-note" placeholder="Anything worth remembering"></textarea></div>' +
    '</div>';
  var m = modal(isNew ? 'New person' : 'Edit ' + p.name, isNew ? 'Only the name is required.' : '', body,
    '<button class="btn primary" id="f-save">' + (isNew ? 'Add to map' : 'Save') + '</button>' +
    '<button class="btn" data-close>Cancel</button>');

  m.querySelector('#f-save').addEventListener('click', function () {
    var g = function (k) { return m.querySelector('#f-' + k).value.trim(); };
    if (!g('name')) { m.querySelector('#f-name').focus(); return; }
    ['name', 'email', 'phone', 'profession', 'company', 'location'].forEach(function (k) { p[k] = g(k); });
    p.schools = [];
    g('school').split(',').map(clean).filter(Boolean).forEach(function (bit) {
      var level = '';
      var nm = bit.replace(/\s*\b(undergrad(?:uate)?|bachelors?)\b\s*/i, function () { level = 'undergrad'; return ' '; })
        .replace(/\s*\b(grad(?:uate)?(?: school)?|mba|ph\.?d|masters?|jd|md|mfa)\b\s*/i, function () { level = 'grad'; return ' '; });
      addSchool(p.schools, titleCase(clean(nm) || bit), level);
    });
    p.circles = g('circle').split(',').map(clean).filter(Boolean);
    p.tags = g('tags').split(',').map(function (t) { return t.trim().replace(/^#/, ''); }).filter(Boolean);
    if (g('note')) p.notes.unshift({ id: uid(), t: g('note'), at: Date.now() });
    if (isNew) state.people.push(p);
    circlesOf(p).forEach(circleIndex);
    touch(p); save(); closeModal(); renderAll();
    if (byId[p.id]) openDossier(byId[p.id]);
    toast(isNew ? p.name + ' added' : 'Saved');
  });
  m.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); m.querySelector('#f-save').click(); }
  });
}

/* ---- import / export ---- */

function splitRows(text) {
  var rows = [], row = [], cell = '', q = false, i;
  var delim = (text.split('\n')[0].split('\t').length > text.split('\n')[0].split(',').length) ? '\t' : ',';
  for (i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
}

var FIELDS = [
  ['name', 'Name'], ['firstName', 'First name'], ['lastName', 'Last name'],
  ['email', 'Email'], ['phone', 'Phone'], ['profession', 'Profession'],
  ['company', 'Company'], ['school', 'School'], ['location', 'Location'],
  ['circle', 'Circle'], ['tags', 'Tags'],
  ['notes', 'Notes'], ['custom', 'Keep as its own field'],
  ['skip', 'Ignore this column']
];

var HEADER_HINTS = [
  ['name', /^(full ?name|name|person|contact|who)$/i],
  ['firstName', /^(first|first ?name|given ?name|fname)$/i],
  ['lastName', /^(last|last ?name|surname|family ?name|lname)$/i],
  ['email', /^(e-?mail|e-?mail ?address|mail)$/i],
  ['phone', /^(phone|phone ?number|mobile|cell|tel|telephone|number)$/i],
  ['profession', /^(profession|role|title|job|job ?title|occupation|position|what ?they ?do)$/i],
  ['company', /^(company|employer|org|organi[sz]ation|firm|business|works? ?at|workplace)$/i],
  ['school', /^(school|college|university|alma ?mater|education|studied)$/i],
  ['location', /^(location|city|town|where|based|address|state|region)$/i],
  ['circle', /^(circle|group|category|bucket|type|relationship|list|segment)$/i],
  ['tags', /^(tags?|labels?|keywords)$/i],
  ['notes', /^(notes?|comments?|details|misc|description|remarks)$/i]
];

var RE_EMAIL = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;
function digitsOf(v) { return String(v).replace(/\D/g, ''); }

/* What a column looks like from the inside, for when the header lies or is
   missing entirely. */
function sniff(values) {
  var vals = values.filter(function (v) { return v && v.trim(); });
  if (!vals.length) return '';
  var hit = function (fn) { return vals.filter(fn).length / vals.length; };
  if (hit(function (v) { return RE_EMAIL.test(v.trim()); }) > 0.6) return 'email';
  if (hit(function (v) {
    var d = digitsOf(v);
    return d.length >= 7 && d.length <= 15 && /^[\d\-.() +x]{7,}$/i.test(v.trim());
  }) > 0.6) return 'phone';
  var avg = vals.reduce(function (a, v) { return a + v.length; }, 0) / vals.length;
  if (avg > 60) return 'notes';
  if (hit(function (v) { return /^[A-ZÀ-Þ][\wÀ-ÿ'’-]+(\s+[A-ZÀ-Þ][\wÀ-ÿ'’.-]+){1,2}$/.test(v.trim()); }) > 0.6) return 'name';
  return '';
}

/* Does row 0 read like labels rather than like people? */
function looksLikeHeader(rows) {
  if (rows.length < 2) return true;
  var first = rows[0], rest = rows.slice(1, 12);
  var dataish = first.filter(function (c) {
    return RE_EMAIL.test(c.trim()) || digitsOf(c).length >= 10;
  }).length;
  if (dataish) return false;
  var matched = first.filter(function (c) {
    return HEADER_HINTS.some(function (h) { return h[1].test(c.trim()); });
  }).length;
  if (matched >= 1) return true;
  // a header row is usually shorter and wordier than the rows under it
  var lenOf = function (r) { return r.join('').length; };
  var avgRest = rest.reduce(function (a, r) { return a + lenOf(r); }, 0) / (rest.length || 1);
  return lenOf(first) < avgRest * 0.75;
}

function guessMapping(headers, rows, hasHeader) {
  var used = {};
  return headers.map(function (h, i) {
    var col = rows.map(function (r) { return r[i] || ''; });
    var guess = '';
    if (hasHeader) {
      for (var j = 0; j < HEADER_HINTS.length; j++) {
        if (HEADER_HINTS[j][1].test(String(h).trim())) { guess = HEADER_HINTS[j][0]; break; }
      }
    }
    if (!guess) guess = sniff(col);
    if (!guess && col.some(function (v) { return clean(v); })) guess = 'custom';
    if (guess && guess !== 'custom' && guess !== 'notes' && used[guess]) guess = 'custom';
    if (guess) used[guess] = true;
    return guess || 'skip';
  });
}

function importModal(preloaded, filename) {
  var body = '<div class="io import">' +
    '<div class="drop" id="im-drop">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
      '<path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></svg>' +
      '<p><b>Drop your spreadsheet here</b> — or <label class="pick" for="im-file">choose a file</label>' +
      '<input type="file" id="im-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden></p>' +
      '<p class="fine">A CSV or TSV exported from Sheets, Excel or Numbers. Nothing is uploaded — it is read here in the browser.</p>' +
    '</div>' +
    '<details id="im-paste-wrap"><summary>or paste the rows instead</summary>' +
      '<textarea id="io-in" placeholder="name,phone,email,profession,notes"></textarea></details>' +
    '<div id="im-map" hidden></div>' +
    '<div class="status" id="io-status">&nbsp;</div></div>';

  var m = modal('Import your list', 'Read here, kept here.', body,
    '<button class="btn primary" id="io-go" disabled>Import</button>' +
    '<button class="btn" data-close>Cancel</button>' +
    '<span class="note" id="im-note">People you already have are updated, not duplicated.</span>');

  var st = m.querySelector('#io-status');
  var mapBox = m.querySelector('#im-map');
  var go = m.querySelector('#io-go');
  var ta = m.querySelector('#io-in');
  var parsed = null;          // {headers, rows, hasHeader, mapping}

  function say(cls, text) { st.className = 'status ' + (cls || ''); st.textContent = text; }

  function ingest(text, label) {
    text = String(text || '').trim();
    if (!text) { mapBox.hidden = true; go.disabled = true; say('', ' '); return; }

    if (text[0] === '{') {                     // a JSON backup, not a spreadsheet
      try {
        var d = JSON.parse(text);
        if (!Array.isArray(d.people)) throw 0;
        parsed = { backup: d };
        mapBox.hidden = true; go.disabled = false;
        say('ok', 'Backup with ' + d.people.length + ' people — importing replaces the current map.');
        return;
      } catch (e) { say('bad', 'That JSON will not parse.'); go.disabled = true; return; }
    }

    var rows = splitRows(text);
    if (!rows.length) { say('bad', 'Nothing readable in there.'); go.disabled = true; return; }
    var hasHeader = looksLikeHeader(rows);
    var headers = hasHeader ? rows[0].map(function (h) { return clean(h) || 'Column'; })
                            : rows[0].map(function (_, i) { return 'Column ' + (i + 1); });
    var data = hasHeader ? rows.slice(1) : rows;
    if (!data.length) { say('bad', 'Found headers but no people under them.'); go.disabled = true; return; }
    parsed = { headers: headers, rows: data, hasHeader: hasHeader };
    parsed.mapping = guessMapping(headers, data, hasHeader);
    drawMapping(label, data.length);
  }

  function drawMapping(label, count) {
    var opts = function (sel) {
      return FIELDS.map(function (f) {
        return '<option value="' + f[0] + '"' + (f[0] === sel ? ' selected' : '') + '>' + f[1] + '</option>';
      }).join('');
    };
    var rowsHtml = parsed.headers.map(function (h, i) {
      var samples = parsed.rows.slice(0, 3).map(function (r) { return clean(r[i]); }).filter(Boolean);
      return '<tr><th>' + esc(h) + '<span>' + esc(samples.join(' · ').slice(0, 54) || 'empty') + '</span></th>' +
        '<td><select data-col="' + i + '">' + opts(parsed.mapping[i]) + '</select></td></tr>';
    }).join('');

    mapBox.innerHTML =
      '<div class="maphead"><b>' + count + ' people</b> in ' + esc(label || 'your list') +
        (parsed.hasHeader ? '' : ' · no header row found, so columns were read by their contents') + '</div>' +
      '<div class="maptable"><table><tbody>' + rowsHtml + '</tbody></table></div>' +
      '<div class="field wide circlepick"><label for="im-circle">Sort them into circles by</label>' +
        '<select id="im-circle">' +
          '<option value="column">the Circle column</option>' +
          '<option value="company">their company</option>' +
          '<option value="school">their school</option>' +
          '<option value="one">one circle for everyone</option>' +
          '<option value="none">nothing — leave them unsorted</option>' +
        '</select>' +
        '<input id="im-circle-name" placeholder="Name that circle" hidden></div>';

    var pick = mapBox.querySelector('#im-circle');
    var nameBox = mapBox.querySelector('#im-circle-name');
    var hasCircleCol = parsed.mapping.indexOf('circle') >= 0;
    var hasCompany = parsed.mapping.indexOf('company') >= 0;
    var hasSchool = parsed.mapping.indexOf('school') >= 0;
    pick.value = hasCircleCol ? 'column' : hasCompany ? 'company' : hasSchool ? 'school' : 'one';
    if (!hasCircleCol) pick.querySelector('option[value="column"]').disabled = true;
    if (!hasCompany) pick.querySelector('option[value="company"]').disabled = true;
    if (!hasSchool) pick.querySelector('option[value="school"]').disabled = true;
    var syncName = function () { nameBox.hidden = pick.value !== 'one'; };
    pick.addEventListener('change', syncName); syncName();
    if (!nameBox.value) nameBox.value = 'Contacts';

    mapBox.addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-col]');
      if (sel) parsed.mapping[+sel.dataset.col] = sel.value;
      check();
    });

    mapBox.hidden = false;
    check();

    function check() {
      var mp = parsed.mapping;
      var named = mp.indexOf('name') >= 0 || (mp.indexOf('firstName') >= 0 || mp.indexOf('lastName') >= 0);
      go.disabled = !named;
      if (!named) say('bad', 'Point one column at Name (or at First name) so people can be told apart.');
      else say('ok', count + ' ready · ' + mp.filter(function (f) { return f !== 'skip'; }).length + ' columns read');
    }
  }

  function readFile(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () { ingest(r.result, file.name); };
    r.onerror = function () { say('bad', 'That file could not be read.'); };
    r.readAsText(file);
  }

  m.querySelector('#im-file').addEventListener('change', function () { readFile(this.files[0]); });
  ta.addEventListener('input', function () { ingest(ta.value, 'pasted rows'); });

  var drop = m.querySelector('#im-drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });

  go.addEventListener('click', function () {
    if (!parsed) return;

    if (parsed.backup) {
      state = Object.assign(DEFAULTS(), parsed.backup);
      state.people.forEach(normalizePerson);
      save(); closeModal(); renderAll(); fit();
      toast('Restored ' + state.people.length + ' people');
      return;
    }

    var mp = parsed.mapping;
    var strategy = mapBox.querySelector('#im-circle').value;
    var oneName = clean(mapBox.querySelector('#im-circle-name').value) || 'Contacts';
    var added = 0, merged = 0, skipped = 0;

    parsed.rows.forEach(function (r) {
      var rec = { tags: [], notes: [], custom: {} };
      mp.forEach(function (field, i) {
        var v = clean(r[i]);
        if (!v || field === 'skip') return;
        if (field === 'custom') rec.custom[parsed.headers[i].toLowerCase()] = v;
        else if (field === 'notes') rec.notes.push(parsed.headers[i] && !/^notes?$/i.test(parsed.headers[i])
          ? parsed.headers[i] + ': ' + v : v);
        else if (field === 'tags') rec.tags = v.split(/[,;|]/).map(function (t) { return clean(t).replace(/^#/, ''); }).filter(Boolean);
        else rec[field] = v;
      });

      var name = rec.name || clean([rec.firstName, rec.lastName].filter(Boolean).join(' '));
      if (!name) { skipped++; return; }

      var p = findPerson(name) || (rec.email ? state.people.filter(function (x) {
        return x.email && x.email.toLowerCase() === rec.email.toLowerCase();
      })[0] : null);
      if (!p) { p = blankPerson(name); state.people.push(p); added++; } else merged++;
      p.name = name;

      ['email', 'phone', 'profession', 'company', 'location'].forEach(function (k) {
        if (rec[k]) p[k] = rec[k];
      });
      if (rec.school) rec.school.split(/[,;|/]/).map(clean).filter(Boolean)
        .forEach(function (nm) { addSchool(p.schools, titleCase(nm), ''); });
      rec.tags.forEach(function (t) { if (p.tags.indexOf(t) < 0) p.tags.push(t); });
      Object.keys(rec.custom).forEach(function (k) { p.custom[k] = rec.custom[k]; });
      rec.notes.forEach(function (t) { p.notes.unshift({ id: uid(), t: t, at: Date.now() }); });

      var circle = clean(
        strategy === 'column' ? rec.circle :
        strategy === 'company' ? rec.company :
        strategy === 'school' ? rec.school :
        strategy === 'one' ? oneName : '');
      var settled = p.circles && p.circles.length;
      if (circle) {
        // a circle column may hold several, separated the way people do it
        circle.split(/[,;|/]/).map(clean).filter(Boolean).forEach(function (c, i) {
          if (!settled || strategy === 'column') joinCircle(p, c, i === 0 && !settled);
        });
      }
      touch(p);
    });

    state.demo = false;
    save(); closeModal(); renderAll(); fit();
    toast(added + ' added' + (merged ? ', ' + merged + ' updated' : '') + (skipped ? ', ' + skipped + ' skipped (no name)' : ''));
  });

  if (preloaded) {
    m.querySelector('#im-paste-wrap').open = false;
    ingest(preloaded, filename);
  }
}

/* Drop a spreadsheet anywhere on the map and the importer opens with it. */
(function () {
  var over = 0;
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files[0]) return;
    if (e.target.closest && e.target.closest('#im-drop')) return;   // the dialog handles its own
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    var r = new FileReader();
    r.onload = function () { importModal(r.result, f.name); };
    r.readAsText(f);
  });
  return over;
})();

function toCSV() {
  var cols = ['name', 'phone', 'email', 'profession', 'company', 'schools', 'location', 'circles', 'tags', 'lastTouch', 'touchpoints', 'notes'];
  var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var lines = [cols.join(',')];
  state.people.forEach(function (p) {
    var notes = p.notes.map(function (n) { return n.t; })
      .concat(p.log.map(function (e) { return fmtDate(e.at) + ' ' + e.channel + ': ' + e.text + (e.learned ? ' — ' + e.learned : ''); }))
      .join(' | ');
    var extra = Object.keys(p.custom || {}).map(function (k) { return k + ': ' + p.custom[k]; });
    var sch = schoolsOf(p).map(function (x) { return x.name + (x.level ? ' (' + x.level + ')' : ''); }).join(' / ');
    lines.push([p.name, p.phone, p.email, p.profession, p.company, sch, p.location, circlesOf(p).join(' / '),
      p.tags.join(' '), p.log.length ? new Date(lastTouch(p)).toISOString().slice(0, 10) : '',
      p.log.length, extra.concat(notes ? [notes] : []).join(' | ')].map(q).join(','));
  });
  return lines.join('\n');
}

function exportModal() {
  var body = '<div class="io">' +
    '<p style="margin:0 0 9px;font-size:13px;color:var(--muted);line-height:1.55">' +
    'The spreadsheet view of everything, history folded into the notes column. ' +
    'Switch to the backup if you want to move the whole map, history and all, to another browser.</p>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button class="btn" id="x-csv" data-on="1">Spreadsheet (CSV)</button>' +
      '<button class="btn" id="x-json">Backup (JSON)</button></div>' +
    '<textarea id="x-out" readonly></textarea></div>';
  var m = modal('Export', state.people.length + ' people', body,
    '<button class="btn primary" id="x-copy">Copy</button>' +
    '<button class="btn" id="x-save" hidden>Save file</button>' +
    '<button class="btn" data-close>Done</button>');

  var out = m.querySelector('#x-out'), mode = 'csv';
  function render() {
    out.value = mode === 'csv' ? toCSV() : JSON.stringify(state, null, 2);
    m.querySelector('#x-csv').style.borderColor = mode === 'csv' ? 'var(--accent)' : '';
    m.querySelector('#x-json').style.borderColor = mode === 'json' ? 'var(--accent)' : '';
  }
  m.querySelector('#x-csv').onclick = function () { mode = 'csv'; render(); };
  m.querySelector('#x-json').onclick = function () { mode = 'json'; render(); };
  m.querySelector('#x-copy').onclick = function () {
    out.select();
    var done = function () { toast('Copied'); };
    if (navigator.clipboard) navigator.clipboard.writeText(out.value).then(done, function () { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  };
  render();

  // Saving a real file only works where the viewer grants it; hide it otherwise.
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('downloads').then(function (dl) {
      if (!dl) return;
      var btn = m.querySelector('#x-save');
      btn.hidden = false;
      btn.onclick = function () {
        dl.save({
          filename: mode === 'csv' ? 'rootwork.csv' : 'rootwork-backup.json',
          data: out.value
        }).then(function () { toast('Saved'); }, function () { /* viewer declined */ });
      };
    }, function () { });
  }
}

function helpModal() {
  var body = '<div class="helpgrid">' +
    '<section><h5>Just say what happened</h5>' +
      '<p>One sentence in the bar. Rootwork pulls out the person and the fields, shows you what it caught, and you press Enter to keep it.</p>' +
      '<div class="ex">Zoom with <b>Dana Okafor</b> — she is a <b>data scientist at Merck</b>, <b>went to Rutgers</b>, <b>dana@merck.com</b>, <b>555-0142</b>. Learned <b>she runs the internal AI guild</b>. Follow up <b>in two weeks</b>. <b>#work</b></div></section>' +
    '<section><h5>What it looks for</h5>' +
      '<p>Emails and phone numbers on sight · <em>went to / studied at / Rutgers grad</em> → school · <em>is a X at Y</em>, <em>runs a X</em> → profession and company · <em>lives in</em> → location · <em>learned / turns out / she said</em> → the takeaway · <em>follow up in two weeks</em> → a nudge · <em>#tag</em> → tags · <em>zoom, coffee, lunch, called, texted, conference</em> → how you talked · <em>yesterday, last Tuesday, on 3/14</em> → when.</p></section>' +
    '<section><h5>Talk about someone already on the map</h5>' +
      '<p>Open their dossier, or just keep typing after logging them, and pronouns land where you mean:</p>' +
      '<div class="ex">her location is Bethlehem\nhis birthday is June 3\nchange her email to dana@merck.com\nremove his phone</div>' +
      '<p>Anything the standard fields do not cover becomes a line of its own — <em>her partner is Sam</em>, <em>his favourite coffee is a cortado</em> — and shows on the card under its own label. A bare fact like these edits the card without logging a touchpoint; say what happened (<em>coffee with…</em>, <em>learned…</em>) and it logs one.</p></section>' +
    '<section><h5>Your spreadsheet</h5>' +
      '<p>Import takes a CSV or TSV file — drop it anywhere on the map, or pick it in the Import dialog. It reads the columns, shows you what it thinks each one is with a sample from your own data, and lets you correct any of them. Columns it cannot name are kept as their own labelled fields rather than thrown away, and it can sort everyone into circles by company, by school, by a column of your own, or all into one.</p></section>' +
    '<section><h5>When it guesses wrong</h5>' +
      '<p>Click any chip in the preview to fix it, or the × to drop it. Force a field outright with a colon:</p>' +
      '<div class="ex">school: Lehigh · circle: Family · role: Pastry chef</div></section>' +
    '<section><h5>The map</h5>' +
      '<p>You are the centre. Circles branch off you; people branch off circles. A dot grows with every touchpoint logged, and fades to an outline once ninety days pass without contact — those are the ones in “Going cold”. Drag a person to pin them where you like, double-click to let go. Scroll to zoom, drag the plate to pan.</p></section>' +
    '<section><h5>Reshaping the map</h5>' +
      '<p>The bar takes instructions as well as notes. Anything that changes several people at once is described and counted first, and every one of them can be taken back with <kbd>⌘Z</kbd> or the Undo on the toast.</p>' +
      '<div class="ex">remove everyone but keep the categories\n' +
      'create a category called Vendors\n' +
      'add Ada to Vendors          ·  remove Ada from Work\n' +
      'rename Neighbors to Bethlehem\n' +
      'merge Industry into Vendors\n' +
      'move everyone from Work to Clients\n' +
      'empty the School circle     ·  delete the School circle\n' +
      'delete everyone in Vendors  ·  erase the whole map</div></section>' +
    '<section><h5>Look and settings</h5>' +
      '<div class="ex">make Work green             ·  turn School gold\n' +
      'hide Family                 ·  show everything\n' +
      'mark people cold after 30 days\n' +
      'switch to light mode        ·  call me Ben Greenberg\n' +
      'tidy the map</div>' +
      '<p>Colours can also be set by clicking the dot beside a circle in the list at the lower left.</p></section>' +
    '<section><h5>Circles</h5>' +
      '<p>Someone can be in as many as you like. <b>Drag a person onto a circle</b> to file them there — it becomes their main one, which is the colour their dot takes. Their card lists every circle they are in: click one to promote it, × to take them out, <em>+ circle</em> to add another.</p>' +
      '<p><b>Click a circle on the map</b> to recolour, rename, hide or delete it. The button beside <em>Add person</em> makes a new one, and an empty circle stays as a branch until you delete it — which is what makes “remove everyone but keep the categories” worth saying.</p></section>' +
    '<section><h5>Schools, tags, connections</h5>' +
      '<p>Type a school and press <kbd>↵</kbd> — it lands as a chip, and the level next to it cycles between undergrad, grad and unset when you click it. Saying “<em>swarthmore undergrad</em>” or “<em>wharton mba</em>” sets the level as you type, in the bar or in the chip.</p>' +
      '<p><b>Connections</b> record who put you onto whom. <b>Drag one person onto another</b> and they are joined by a dashed line; the toast offers to flip the direction if you had it the other way round. The bar understands it too — “<em>Marcus introduced me to Rae Kim</em>”, “<em>got her info from Ada</em>”, “<em>met Lila through Priya</em>” — and the Connections row on a card takes a name directly.</p>' +
      '<p><b>Notes</b> sit under the history on every card — write one and press <kbd>↵</kbd>. Click an existing note to edit it.</p></section>' +
    '<section><h5>When the map gets messy</h5>' +
      '<p>The <b>tidy</b> button (top right, or <kbd>T</kbd>) lets go of everyone you have dragged into place and lets the whole thing settle again. Circles claim room in proportion to how many people they hold, so a School of thirty gets the space it needs.</p></section>' +
    '<section><h5>Fixing a card</h5>' +
      '<p>Click any value on someone’s card and type over it — the name at the top too. Empty fields say <em>add</em>; click to fill them. <em>+ another field</em> at the bottom takes anything the standard ones do not cover.</p></section>' +
    '<section><h5>Commands</h5>' +
      '<div class="ex">/undo            — take back the last change\n/me Ben Fisher   — name the centre\n/import          — bring in a spreadsheet\n/export          — copy it all back out\n/sample          — load or clear the sample map\n/help            — this</div></section>' +
    '<section><h5>On your phone</h5>' +
      '<p>Open the app’s address in Safari or Chrome and use <em>Add to Home Screen</em> — it installs with its own icon and opens fullscreen, working with no signal.</p></section>' +
    '<section><h5>Where the data lives</h5>' +
      '<p>In this browser by default — no account, no server. Turn on <em>Sync</em> in the top bar and it also goes to a database you own, encrypted here with a passphrase only you hold, so the same map opens on every device you pair. Either way, keep a JSON backup from Export if it matters.</p></section>' +
    '</div>';
  modal('How to talk to it', 'Rootwork', body, '<button class="btn primary" data-close>Got it</button>');
}


/* ------------------------------------------------------- structural work --
   Commands that reshape the map rather than record something. They are
   destructive by nature, so each one is described and counted before it runs,
   and the last one can always be taken back. */

var undoSnap = null;

function snapshot(label) {
  undoSnap = { label: label, json: JSON.stringify(state) };
}

function undo() {
  if (!undoSnap) { toast('Nothing to undo'); return; }
  var snap = undoSnap;
  undoSnap = null;
  state = Object.assign(DEFAULTS(), JSON.parse(snap.json));
  state.people.forEach(normalizePerson);
  save(); closeDossier(); renderAll(); fit();
  toast('Undone · ' + snap.label);
}

var CWORD = '(?:circle|category|group|list|bucket)';

function matchCircle(name) {
  name = clean(String(name || '')).replace(/^(the|a|an)\s+/i, '')
    .replace(new RegExp('\\s+' + CWORD + 's?$', 'i'), '');
  if (!name) return '';
  var all = circleList().map(function (c) { return c.name; });
  var exact = all.filter(function (c) { return c.toLowerCase() === name.toLowerCase(); })[0];
  if (exact) return exact;
  var starts = all.filter(function (c) { return c.toLowerCase().indexOf(name.toLowerCase()) === 0; });
  return starts.length === 1 ? starts[0] : '';
}

function membersOf(name) {
  return state.people.filter(function (p) { return inCircle(p, name); });
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* Returns a plan — {summary, detail, run} — or null if this is not a
   structural instruction at all. */
function structural(text) {
  var t = ' ' + clean(text) + ' ';
  var m, c, c2;
  var wipeWord = '(?:remove|delete|clear|wipe|drop|erase|get rid of)';

  // everyone out of a named circle
  if ((m = new RegExp(wipeWord + '\\s+(?:all\\s+)?(?:everyone|everybody|all (?:the )?people|all contacts)\\s+(?:in|from|under)\\s+(?:the\\s+)?(.+?)\\s*$', 'i').exec(t))
      && (c = matchCircle(m[1]))) {
    var doomed = membersOf(c);
    return {
      summary: 'Delete ' + plural(doomed.length, 'person', 'people') + ' in ' + c,
      detail: doomed.length ? doomed.slice(0, 6).map(function (p) { return p.name; }).join(', ') +
        (doomed.length > 6 ? ' and ' + (doomed.length - 6) + ' more' : '') : 'Nobody is in it.',
      run: function () { doomed.forEach(forget); }
    };
  }

  // empty a circle but keep the people
  if ((m = /(?:empty|clear out|unfile|take everyone out of)\s+(?:the\s+)?(.+?)\s*$/i.exec(t)) && (c = matchCircle(m[1]))) {
    var mem = membersOf(c);
    return {
      summary: 'Take ' + plural(mem.length, 'person', 'people') + ' out of ' + c,
      detail: 'They stay on the map. The circle stays too, empty.',
      run: function () { mem.forEach(function (p) { leaveCircle(p, c); }); circleIndex(c); }
    };
  }

  // everyone, everywhere
  if (new RegExp(wipeWord + '\\s+(?:all\\s+)?(?:everyone|everybody|all (?:the )?people|all (?:my )?contacts)\\b', 'i').test(t)) {
    var keep = /\b(keep|keeping|but keep|leave|retain|save)\b[^.]*\b(circle|categor|group|structure|branch)/i.test(t);
    var n = state.people.length, cn = circleList().length;
    return {
      summary: 'Delete all ' + plural(n, 'person', 'people') + (keep ? ', keep the ' + plural(cn, 'circle') : ' and their circles'),
      detail: keep ? 'The circles stay as empty branches, ready to be filled again.'
                   : 'Everything goes except you.',
      run: function () {
        state.people.slice().forEach(forget);
        if (!keep) state.circles = [];
      }
    };
  }

  // the whole thing
  if (/(?:delete|remove|clear|wipe|erase)\s+(?:everything|the (?:whole|entire) map|it all)\b|\bstart over\b|\bstart from scratch\b/i.test(t)) {
    return {
      summary: 'Erase the whole map',
      detail: plural(state.people.length, 'person', 'people') + ' and ' + plural(circleList().length, 'circle') + ' — everything but you.',
      run: function () { state.people.slice().forEach(forget); state.circles = []; }
    };
  }

  // rename
  if ((m = new RegExp('rename\\s+(?:the\\s+)?(.+?)\\s+' + CWORD + '?\\s*to\\s+(.+?)\\s*$', 'i').exec(t)) && (c = matchCircle(m[1]))) {
    var to = clean(m[2]).replace(new RegExp('^' + CWORD + '\\s+', 'i'), '');
    var n2 = membersOf(c).length;
    return {
      summary: 'Rename ' + c + ' to ' + to,
      detail: plural(n2, 'person', 'people') + ' move across with it.',
      run: function () { renameCircle(c, to); }
    };
  }

  // merge
  if ((m = /(?:merge|fold|combine)\s+(?:the\s+)?(.+?)\s+(?:in)?to\s+(?:the\s+)?(.+?)\s*$/i.exec(t))
      && (c = matchCircle(m[1])) && (c2 = matchCircle(m[2]))) {
    return {
      summary: 'Merge ' + c + ' into ' + c2,
      detail: plural(membersOf(c).length, 'person', 'people') + ' from ' + c + ' join ' + c2 + '. ' + c + ' disappears.',
      run: function () {
        membersOf(c).forEach(function (p) {
          var wasPrimary = primaryCircle(p) === c;
          leaveCircle(p, c);
          joinCircle(p, c2, wasPrimary);
        });
        dropCircle(c);
      }
    };
  }

  // move everyone across
  if ((m = /move\s+(?:everyone|everybody|them all|all)\s+(?:from|in|out of)\s+(?:the\s+)?(.+?)\s+(?:in)?to\s+(?:the\s+)?(.+?)\s*$/i.exec(t))
      && (c = matchCircle(m[1]))) {
    var target = matchCircle(m[2]) || clean(m[2]).replace(new RegExp('\\s*' + CWORD + '$', 'i'), '');
    var movers = membersOf(c);
    return {
      summary: 'Move ' + plural(movers.length, 'person', 'people') + ' from ' + c + ' to ' + target,
      detail: c + ' stays, empty.',
      run: function () {
        movers.forEach(function (p) { leaveCircle(p, c); joinCircle(p, target, true); });
        circleIndex(c);
      }
    };
  }

  // delete a circle
  if ((m = new RegExp(wipeWord + '\\s+(?:the\\s+)?(.+?)\\s*(?:' + CWORD + ')\\s*$', 'i').exec(t)) && (c = matchCircle(m[1]))) {
    var held = membersOf(c).length;
    return {
      summary: 'Delete the ' + c + ' circle',
      detail: held ? plural(held, 'person', 'people') + ' stay on the map, just no longer filed there.' : 'Nobody is in it.',
      run: function () { membersOf(c).forEach(function (p) { leaveCircle(p, c); }); dropCircle(c); }
    };
  }

  // make one
  if ((m = new RegExp('(?:create|add|make|new|start)\\s+(?:a\\s+|an\\s+)?(?:new\\s+)?' + CWORD + '\\s*(?:called|named|for)?\\s*(.+?)\\s*$', 'i').exec(t))) {
    var fresh = clean(m[1]).replace(/^["“']|["”']$/g, '');
    if (fresh) return {
      summary: 'Add a circle called ' + fresh,
      detail: 'It starts empty. Drag people onto it, or say “add Dana to ' + fresh + '”.',
      run: function () { reviveCircle(fresh); circleIndex(fresh); }
    };
  }

  // colour
  if ((m = new RegExp('(?:make|colou?r|recolou?r|paint|set|turn|change)\\s+(?:the\\s+)?(.+?)\\s*(?:' + CWORD + ')?\\s*(?:colou?r\\s*)?(?:to\\s+|as\\s+)?\\b(' + Object.keys(COLOR_WORDS).join('|') + ')\\b', 'i').exec(t))) {
    var target = matchCircle(m[1]);
    var hue = COLOR_WORDS[m[2].toLowerCase()];
    if (target && hue) return {
      summary: target + ' turns ' + m[2].toLowerCase(),
      quiet: true,
      run: function () { setCircleColor(target, hue); }
    };
  }

  // how long before someone counts as cold
  if ((m = /(?:cold|nudge|stale|quiet|remind)\b[^.]*?\b(?:after|at|past|over)\s+(\d{1,3})\s*(day|week|month)s?\b/i.exec(t))
      || (m = /(?:mark|call|treat)\b[^.]*?\bcold\b[^.]*?(\d{1,3})\s*(day|week|month)s?/i.exec(t))) {
    var mult = m[2].toLowerCase() === 'week' ? 7 : m[2].toLowerCase() === 'month' ? 30 : 1;
    var days = Math.max(1, parseInt(m[1], 10) * mult);
    return {
      summary: 'Going cold after ' + days + ' days',
      quiet: true,
      run: function () { state.coldDays = days; state.settingsAt = Date.now(); }
    };
  }

  // theme
  if ((m = /\b(?:switch to|use|turn on|go|set)\s+(light|dark)\s*(?:mode|theme)?\b/i.test(t) ? /\b(light|dark)\b/i.exec(t) : null)) {
    var want = m[1].toLowerCase();
    return { summary: want.charAt(0).toUpperCase() + want.slice(1) + ' theme', quiet: true, run: function () { applyTheme(want); } };
  }

  // showing and hiding branches
  if ((m = /^\s*(?:hide|mute|collapse)\s+(?:the\s+)?(.+?)\s*$/i.exec(t)) && (c = matchCircle(m[1]))) {
    return { summary: 'Hide ' + c, quiet: true, run: function () { hidden[c] = true; } };
  }
  if (/^\s*(?:show|unhide|reveal)\s+(?:everything|all|all circles|all categories)\s*$/i.test(t)) {
    return { summary: 'Show every circle', quiet: true, run: function () { hidden = {}; } };
  }
  if ((m = /^\s*(?:show|unhide|reveal)\s+(?:the\s+)?(.+?)\s*$/i.exec(t)) && (c = matchCircle(m[1]))) {
    return { summary: 'Show ' + c, quiet: true, run: function () { delete hidden[c]; } };
  }

  // odds and ends people reach for
  if (/^\s*(?:tidy|fit|centre|center|reset the view|zoom to fit)\b/i.test(t)) {
    return { summary: 'Tidied the map', quiet: true, run: function () { tidyMap(); } };
  }
  if (/^\s*(?:call me|i am|i'm|my name is)\s+(.+?)\s*$/i.test(t)) {
    var mine = clean(/^\s*(?:call me|i am|i'm|my name is)\s+(.+?)\s*$/i.exec(t)[1]);
    return {
      summary: 'You are ' + mine, quiet: true,
      run: function () { state.me.name = mine; state.meUpdated = Date.now(); }
    };
  }

  // one person in or out
  if ((m = /(?:add|put|file|move)\s+(.+?)\s+(?:in|into|under|to)\s+(?:the\s+)?(.+?)\s*$/i.exec(t))) {
    var who = findPerson(clean(m[1]));
    var dest = matchCircle(m[2]) || clean(m[2]).replace(new RegExp('\\s*' + CWORD + '$', 'i'), '');
    if (who && dest) return {
      summary: who.name + ' joins ' + dest,
      detail: circlesOf(who).length ? 'Already in ' + circlesOf(who).join(', ') + '.' : 'Their first circle.',
      quiet: true,
      run: function () { joinCircle(who, dest, false); }
    };
  }
  if ((m = /(?:remove|take|drop|pull)\s+(.+?)\s+(?:out of|from|off)\s+(?:the\s+)?(.+?)\s*$/i.exec(t))) {
    var who2 = findPerson(clean(m[1]));
    var from = matchCircle(m[2]);
    if (who2 && from && inCircle(who2, from)) return {
      summary: who2.name + ' leaves ' + from,
      detail: 'They stay on the map.',
      quiet: true,
      run: function () { leaveCircle(who2, from); }
    };
  }

  return null;
}

function renameCircle(from, to) {
  to = clean(to);
  if (!to) return;
  state.people.forEach(function (p) {
    p.circles = circlesOf(p).map(function (c) { return c === from ? to : c; })
      .filter(function (c, i, a) { return a.indexOf(c) === i; });
    if (inCircle(p, to)) touch(p);
  });
  var i = (state.circles || []).indexOf(from);
  if (i >= 0) state.circles[i] = to; else circleIndex(to);
}

function circleKilled(name) {
  var t = (state.circleTombstones || {})[String(name).trim().toLowerCase()];
  return t || 0;
}

function dropCircle(name) {
  var low = String(name).trim().toLowerCase();
  state.circleTombstones = state.circleTombstones || {};
  state.circleTombstones[low] = Date.now();
  state.circles = (state.circles || []).filter(function (c) { return c.toLowerCase() !== low; });
  if (state.colors) {
    Object.keys(state.colors).forEach(function (k) { if (k.toLowerCase() === low) delete state.colors[k]; });
  }
  // and out of anybody still holding a differently-cased copy of it
  state.people.forEach(function (p) {
    if (circlesOf(p).some(function (c) { return c.toLowerCase() === low; })) leaveCircle(p, name);
  });
  delete hidden[name];
}

/* ---- chat + preview ---- */

var draft = null, pendingPlan = null;
var FIELD_LABEL = {
  email: 'email', phone: 'phone', profession: 'role', company: 'company', school: 'school',
  location: 'lives in', circle: 'circle', howMet: 'met via', name: 'name'
};

function renderPlan() {
  var slot = $('#preview-slot');
  if (!pendingPlan) { slot.innerHTML = ''; return; }
  slot.innerHTML = '<div class="preview danger">' +
    '<div class="head"><span>about to change the map</span>' +
      '<span class="who">' + esc(pendingPlan.summary) + '</span></div>' +
    '<p class="plandetail">' + esc(pendingPlan.detail || '') + '</p>' +
    '<div class="actions"><button class="btn primary" data-doplan>Do it</button>' +
      '<button class="btn" data-discard>Cancel</button>' +
      '<span class="hintkey"><kbd>Enter</kbd> to run · <kbd>Esc</kbd> to cancel</span></div></div>';
}

function runPlan() {
  if (!pendingPlan) return;
  var plan = pendingPlan;
  pendingPlan = null;
  snapshot(plan.summary);
  plan.run();
  save(); closeDossier(); renderPlan(); renderAll(); fit();
  toast(plan.summary, 'Undo', undo);
}

function renderPreview() {
  var slot = $('#preview-slot');
  if (!draft) { slot.innerHTML = ''; return; }
  var chips = Object.keys(draft.patch).map(function (k) {
    return '<span class="chip' + (draft.person && draft.person[k] !== draft.patch[k] ? ' new' : '') + '">' +
      '<span class="k">' + (FIELD_LABEL[k] || k) + '</span>' +
      '<span class="v" data-editk="' + k + '" tabindex="0" role="button">' + esc(draft.patch[k]) + '</span>' +
      '<button data-dropk="' + k + '" aria-label="Drop ' + k + '">&times;</button></span>';
  });
  if (draft.via || draft.viaName) {
    chips.push('<span class="chip new"><span class="k">via</span><span class="v">' +
      esc(draft.via ? draft.via.name : draft.viaName) + '</span>' +
      '<button data-dropvia aria-label="Drop the connection">&times;</button></span>');
  }
  (draft.schools || []).forEach(function (sc) {
    chips.push('<span class="chip new"><span class="k">school</span><span class="v">' +
      esc(sc.name) + (sc.level ? ' · ' + sc.level : '') + '</span>' +
      '<button data-dropschool="' + esc(sc.name) + '" aria-label="Drop ' + esc(sc.name) + '">&times;</button></span>');
  });
  Object.keys(draft.custom || {}).forEach(function (k) {
    chips.push('<span class="chip new"><span class="k">' + esc(k) + '</span>' +
      '<span class="v" data-editc="' + esc(k) + '" tabindex="0" role="button">' + esc(draft.custom[k]) + '</span>' +
      '<button data-dropc="' + esc(k) + '" aria-label="Drop ' + esc(k) + '">&times;</button></span>');
  });
  (draft.clears || []).forEach(function (k) {
    chips.push('<span class="chip clear"><span class="k">clear</span><span class="v">' + esc(k) + '</span>' +
      '<button data-dropclear="' + esc(k) + '" aria-label="Keep ' + esc(k) + '">&times;</button></span>');
  });
  if (draft.entry && draft.entry.channel) {
    chips.unshift('<span class="chip"><span class="k">' + esc(CHANNEL_LABEL[draft.entry.channel]) + '</span>' +
      '<span class="v">' + fmtDate(draft.entry.at) + '</span></span>');
  }
  if (draft.entry && draft.entry.learned) {
    chips.push('<span class="chip"><span class="k">learned</span><span class="v">' + esc(draft.entry.learned) + '</span>' +
      '<button data-droplearned aria-label="Drop takeaway">&times;</button></span>');
  }
  if (draft.followUp) {
    chips.push('<span class="chip new"><span class="k">nudge</span><span class="v">' + fmtDate(draft.followUp.date) + '</span>' +
      '<button data-dropfu aria-label="Drop follow-up">&times;</button></span>');
  }
  draft.tags.forEach(function (t) { chips.push('<span class="chip"><span class="v">#' + esc(t) + '</span></span>'); });

  slot.innerHTML = '<div class="preview">' +
    '<div class="head"><span>' + (draft.person ? (draft.byPronoun ? 'about' : 'updating') : 'new person') + '</span>' +
      '<span class="who" data-editname tabindex="0" role="button">' + esc(draft.name || 'Unnamed') + '</span>' +
      '<span class="tag">' + (draft.person
        ? (draft.entry ? draft.person.log.length + ' prior touchpoints' : 'card edit — nothing logged')
        : 'sprouting from ' + esc(draft.patch.circle || 'Unsorted')) + '</span></div>' +
    '<div class="chips">' + chips.join('') + '</div>' +
    '<div class="actions"><button class="btn primary" data-confirm>Add to map</button>' +
      '<button class="btn" data-discard>Discard</button>' +
      '<span class="hintkey"><kbd>Enter</kbd> to keep · <kbd>Esc</kbd> to drop</span></div></div>';
}

function editChip(el, current, done) {
  var input = document.createElement('input');
  input.value = current;
  input.style.cssText = 'font:inherit;background:var(--field);border:1px solid var(--accent);border-radius:2px;padding:0 4px;width:' +
    Math.max(70, Math.min(260, current.length * 8 + 20)) + 'px';
  el.replaceWith(input);
  input.focus(); input.select();
  var finish = function () { done(input.value.trim()); renderPreview(); };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.stopPropagation(); renderPreview(); }
  });
}

$('#preview-slot').addEventListener('click', function (e) {
  var t = e.target;
  if (t.closest('[data-doplan]')) return runPlan();
  if (pendingPlan && t.closest('[data-discard]')) { pendingPlan = null; renderPlan(); return; }
  if (!draft) return;
  if (t.closest('[data-confirm]')) return confirmDraft();
  if (t.closest('[data-discard]')) { draft = null; pendingPlan = null; renderPreview(); renderPlan(); return; }
  if (t.dataset.dropk) { delete draft.patch[t.dataset.dropk]; renderPreview(); return; }
  if (t.dataset.dropc) { delete draft.custom[t.dataset.dropc]; renderPreview(); return; }
  if (t.hasAttribute && t.hasAttribute('data-dropvia')) { draft.via = null; draft.viaName = ''; renderPreview(); return; }
  if (t.dataset.dropschool) {
    draft.schools = draft.schools.filter(function (x) { return x.name !== t.dataset.dropschool; });
    renderPreview(); return;
  }
  if (t.dataset.dropclear) {
    draft.clears = draft.clears.filter(function (k) { return k !== t.dataset.dropclear; });
    renderPreview(); return;
  }
  if (t.dataset.editc) {
    var ck = t.dataset.editc;
    return editChip(t, draft.custom[ck], function (v) {
      if (v) draft.custom[ck] = v; else delete draft.custom[ck];
    });
  }
  if (t.hasAttribute && t.hasAttribute('data-droplearned')) { draft.entry.learned = ''; renderPreview(); return; }
  if (t.hasAttribute && t.hasAttribute('data-dropfu')) { draft.followUp = null; renderPreview(); return; }
  if (t.dataset.editk) {
    var k = t.dataset.editk;
    return editChip(t, draft.patch[k], function (v) {
      if (v) { draft.patch[k] = v; if (k === 'circle') draft.circleForced = true; }
      else delete draft.patch[k];
    });
  }
  if (t.hasAttribute && t.hasAttribute('data-editname')) {
    return editChip(t, draft.name, function (v) {
      draft.name = v; draft.person = findPerson(v);
    });
  }
});

function confirmDraft() {
  if (!draft) return;
  if (!draft.name) { toast('Who was it? Click the name to set it.'); return; }
  var p = commit(draft);
  draft = null; renderPreview(); renderAll();
  var n = byId[p.id];
  if (n) { openDossier(n); }
  toast('Logged · ' + p.name);
}

var chat = $('#chat');
if (window.innerWidth < 880) chat.placeholder = 'Coffee with Ada yesterday — she has capacity in Q2';
function autosize() { chat.style.height = 'auto'; chat.style.height = Math.min(130, chat.scrollHeight) + 'px'; }
chat.addEventListener('input', autosize);

$('#chatform').addEventListener('submit', function (e) {
  e.preventDefault();
  var v = chat.value.trim();
  if (!v) {
    if (pendingPlan) return runPlan();
    if (draft) confirmDraft();
    return;
  }

  if (v[0] === '/') {
    var cmd = v.slice(1).split(' ')[0].toLowerCase(), rest = v.slice(cmd.length + 2).trim();
    chat.value = ''; autosize();
    if (cmd === 'help') return helpModal();
    if (cmd === 'import') return importModal();
    if (cmd === 'export') return exportModal();
    if (cmd === 'me') {
      if (rest) { state.me.name = rest; state.meUpdated = Date.now(); save(); renderAll(); toast('You are ' + rest); }
      else toast('Try: /me Ben Fisher');
      return;
    }
    if (cmd === 'sample') { toggleSample(); return; }
    if (cmd === 'undo') { undo(); return; }
    toast('Unknown command. /help lists them.');
    return;
  }

  var plan = structural(v);
  if (plan) {
    chat.value = ''; autosize();
    draft = null; renderPreview();
    if (plan.quiet) {                    // small, obvious moves just happen
      snapshot(plan.summary);
      plan.run();
      save(); renderAll();
      toast(plan.summary, 'Undo', undo);
      return;
    }
    pendingPlan = plan;
    renderPlan();
    return;
  }

  draft = parse(v);
  chat.value = ''; autosize();
  pendingPlan = null; renderPlan();
  renderPreview();
  if (!draft.name) toast('Could not find a name — click “Unnamed” to set it.');
});

chat.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatform').requestSubmit(); }
  if (e.key === 'Escape') {
    if (pendingPlan) { pendingPlan = null; renderPlan(); }
    if (draft) { draft = null; renderPreview(); }
  }
});

/* ---- search ---- */

var search = $('#search'), results = $('#results');
function runSearch() {
  var q = search.value.trim().toLowerCase();
  if (!q) { results.innerHTML = ''; return; }
  var hits = state.people.filter(function (p) {
    return [p.name, p.profession, p.company, schoolsOf(p).map(function (x) { return x.name; }).join(' '),
      p.location, circlesOf(p).join(' '), p.email, p.tags.join(' '),
      p.notes.map(function (n) { return n.t; }).join(' '),
      p.log.map(function (e) { return e.text + ' ' + e.learned; }).join(' ')]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }).slice(0, 12);
  results.innerHTML = hits.map(function (p) {
    return '<button data-goto="' + p.id + '"><span class="swatch" style="background:var(--h' + circleIndex(primaryCircle(p)) + ')"></span>' +
      '<span class="rname">' + esc(p.name) + '</span>' +
      '<span class="rmeta">' + esc(p.company || p.profession || primaryCircle(p)) + '</span></button>';
  }).join('') || '<div class="empty" style="padding:8px 10px;font-size:12px;color:var(--faint)">Nobody by that name.</div>';
}
search.addEventListener('input', runSearch);
search.addEventListener('focus', runSearch);
search.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { search.value = ''; results.innerHTML = ''; search.blur(); }
  if (e.key === 'Enter') { var b = results.querySelector('[data-goto]'); if (b) b.click(); }
});
document.addEventListener('click', function (e) {
  if (!e.target.closest('.searchwrap')) results.innerHTML = '';
  var g = e.target.closest('[data-goto]');
  if (g) { goTo(g.dataset.goto); results.innerHTML = ''; }
  var cc = e.target.closest('[data-color]');
  if (cc) { colorPicker(cc, cc.dataset.color); return; }
  var c = e.target.closest('[data-circle]');
  if (c) {
    var name = c.dataset.circle;
    if (hidden[name]) delete hidden[name]; else hidden[name] = true;
    renderAll();
  }
});

function goTo(id) {
  var n = byId[id];
  if (!n) return;
  openDossier(n);
  glide(n.x + 90, n.y, Math.max(cam.k, 0.9));
}

var glideTo = null;
function glide(x, y, k) {
  glideTo = { x: x, y: y, k: k, t0: performance.now() };
  var from = { x: cam.x, y: cam.y, k: cam.k };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { cam.x = x; cam.y = y; cam.k = k; needsDraw = true; return; }
  (function step() {
    if (!glideTo) return;
    var t = Math.min(1, (performance.now() - glideTo.t0) / 420);
    var e = 1 - Math.pow(1 - t, 3);
    cam.x = from.x + (x - from.x) * e;
    cam.y = from.y + (y - from.y) * e;
    cam.k = from.k + (k - from.k) * e;
    needsDraw = true;
    if (t < 1) requestAnimationFrame(step); else glideTo = null;
  })();
}

/* ---- pointer ---- */

canvas.addEventListener('pointermove', function (e) {
  var r = canvas.getBoundingClientRect();
  var sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (dragging) {
    var w = toWorld(sx, sy);
    dragging.fx = w[0]; dragging.fy = w[1];
    dragging.x = w[0]; dragging.y = w[1];
    moved = true;
    var t = null;
    if (dragging.kind === 'person') t = personUnder(sx, sy, dragging) || circleUnder(sx, sy);
    if (t !== dropTarget) { dropTarget = t; canvas.style.cursor = t ? 'copy' : 'grabbing'; }
    kick();
    return;
  }
  if (panning) {
    cam.x = panning.cx - (sx - panning.sx) / cam.k;
    cam.y = panning.cy - (sy - panning.sy) / cam.k;
    moved = true; needsDraw = true;
    return;
  }
  var h = nodeAt(sx, sy);
  if (h !== hover) { hover = h; needsDraw = true; canvas.style.cursor = h ? 'pointer' : 'grab'; }
});

canvas.addEventListener('pointerdown', function (e) {
  var r = canvas.getBoundingClientRect();
  var sx = e.clientX - r.left, sy = e.clientY - r.top;
  canvas.setPointerCapture(e.pointerId);
  moved = false;
  var n = nodeAt(sx, sy);
  if (n && n.kind !== 'me') { dragging = n; canvas.style.cursor = 'grabbing'; }
  else { panning = { sx: sx, sy: sy, cx: cam.x, cy: cam.y }; canvas.style.cursor = 'grabbing'; }
});

canvas.addEventListener('pointerup', function (e) {
  var r = canvas.getBoundingClientRect();
  var n = nodeAt(e.clientX - r.left, e.clientY - r.top);

  if (dragging && dragging.kind === 'person' && dropTarget && moved && dropTarget.kind === 'person') {
    var from = dragging.ref, onto = dropTarget.ref;
    dragging.fx = dragging.fy = null;
    dropTarget = null; dragging = null; panning = null;
    tie(from, onto.id, 'intro');
    save(); renderAll();
    toast(onto.name + ' put you onto ' + from.name, 'Flip', function () {
      untie(from, onto.id); tie(onto, from.id, 'intro'); save(); renderAll();
    });
    return;
  }

  if (dragging && dragging.kind === 'person' && dropTarget && moved) {
    var person = dragging.ref, target = dropTarget.label;
    var already = inCircle(person, target);
    joinCircle(person, target, true);
    dragging.fx = dragging.fy = null;
    dropTarget = null; dragging = null; panning = null;
    save(); renderAll();
    toast(person.name + (already ? ' → ' + target + ' is now their main circle'
      : ' added to ' + target + (circlesOf(person).length > 1 ? ' · also in ' + circlesOf(person).slice(1).join(', ') : '')));
    return;
  }
  dropTarget = null;

  if (!moved) {
    if (n && n.kind === 'person') openDossier(n);
    else if (n && n.kind === 'circle') { circleMenu(n); }
    else if (n && n.kind === 'me') { closeDossier(); }
    else closeDossier();
  }
  dragging = null; panning = null;
  canvas.style.cursor = n ? 'pointer' : 'grab';
});

canvas.addEventListener('dblclick', function (e) {
  var r = canvas.getBoundingClientRect();
  var n = nodeAt(e.clientX - r.left, e.clientY - r.top);
  if (n) { n.fx = n.fy = null; kick(); toast('Unpinned ' + n.label); }
});

canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  var r = canvas.getBoundingClientRect();
  var sx = e.clientX - r.left, sy = e.clientY - r.top;
  var before = toWorld(sx, sy);
  var k = cam.k * Math.pow(0.999, e.deltaY * (e.deltaMode === 1 ? 20 : 1));
  cam.k = Math.max(0.18, Math.min(3.2, k));
  var after = toWorld(sx, sy);
  cam.x += before[0] - after[0];
  cam.y += before[1] - after[1];
  needsDraw = true;
}, { passive: false });

/* ---- theme ---- */

var THEME_KEY = 'rootwork.theme';
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { }
  setTimeout(function () { readTokens(); needsDraw = true; }, 20);
}
$('#btn-theme').addEventListener('click', function () {
  var cur = document.documentElement.getAttribute('data-theme') || 'auto';
  var next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
  applyTheme(next);
  toast('Theme: ' + next);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
  readTokens(); needsDraw = true;
});

/* ---- sample map ---- */

function sample() {
  var d = Date.now();
  var mk = function (o, logs) {
    var p = blankPerson(o.name);
    Object.assign(p, o);
    normalizePerson(p);                  // turns circle: 'Work' into circles: ['Work']
    p.log = (logs || []).map(function (l) {
      return { id: uid(), at: d - l[0] * DAY, channel: l[1], text: l[2], learned: l[3] || '' };
    });
    p.created = d - 400 * DAY;
    circlesOf(p).forEach(circleIndex);
    return p;
  };
  return [
    mk({ name: 'Dana Okafor', circle: 'Work', profession: 'Data scientist', company: 'Merck', schools: [{ name: 'Rutgers', level: 'undergrad' }],
      email: 'dana.okafor@example.com', phone: '(908) 555-0142', location: 'Rahway, NJ', tags: ['ai'],
      howMet: 'met at the Rutgers alumni mixer' },
      [[4, 'zoom', 'Zoom about the forecasting pilot — she wants a two-week trial.', 'Runs the internal AI guild, 200 people'],
       [38, 'coffee', 'Coffee downtown before the panel.'],
       [96, 'met', 'Met at the Rutgers alumni mixer.']]),
    mk({ name: 'Marcus Bell', circle: 'Work', profession: 'Engineering manager', company: 'Vanta', schools: [{ name: 'Lehigh', level: 'undergrad' }],
      email: 'marcus@example.com', location: 'Brooklyn, NY', tags: ['hiring'] },
      [[11, 'call', 'Called about the staff role on his team.', 'Hiring two backend engineers in Q1'],
       [60, 'event', 'Sat next to him at the Philly infra meetup.']]),
    mk({ name: 'Priya Raman', circle: 'Work', profession: 'Product designer', company: 'Figma',
      email: 'priya@example.com', tags: ['design'] },
      [[130, 'coffee', 'Coffee at Monkey + Elf. Talked through the onboarding redesign.', 'Moving to Lisbon in the spring']]),
    mk({ name: 'Tomás Ferreira', circles: ['School', 'Work'], schools: [{ name: 'Lehigh', level: 'undergrad' }, { name: 'Villanova', level: 'grad' }], profession: 'Attorney', company: 'Reed Smith',
      email: 'tomas@example.com', phone: '(610) 555-0119' },
      [[22, 'meal', 'Dinner at Bolete with the Lehigh crowd.', 'Just made partner'],
       [210, 'call', 'Called for advice on the LLC paperwork.']]),
    mk({ name: 'Hannah Koenig', circle: 'School', schools: [{ name: 'Lehigh', level: 'undergrad' }], profession: 'Pastry chef', company: 'Bread & Salt',
      email: 'hannah@example.com', location: 'Jersey City, NJ' },
      [[6, 'message', 'Texted about the croissant lamination class.', 'Teaching a Saturday workshop in March']]),
    mk({ name: 'Owen Reilly', circle: 'School', schools: [{ name: 'Lehigh', level: 'undergrad' }], profession: 'High school teacher' },
      [[168, 'event', 'Ran into him at homecoming.']]),
    mk({ name: 'Ada Whitfield', circles: ['Industry', 'Neighbors'], profession: 'Roaster', company: 'Deep Roots Coffee',
      email: 'ada@example.com', phone: '(484) 555-0177', location: 'Bethlehem, PA',
      howMet: 'intro through Marcus Bell', tags: ['coffee'] },
      [[2, 'coffee', 'Cupping session at her roastery — she walked me through the Ethiopia lots.', 'Has spare capacity on the Loring in Q2'],
       [30, 'email', 'Emailed about wholesale pricing.']]),
    mk({ name: 'Jonah Pike', circle: 'Industry', profession: 'Bakery consultant', email: 'jonah@example.com' },
      [[74, 'zoom', 'Zoom on build-out costs for the Third Street space.', 'Says hood venting is the long pole, budget 40k']]),
    mk({ name: 'Sofia Marchetti', circle: 'Industry', profession: 'Green coffee buyer', company: 'Cafe Imports',
      email: 'sofia@example.com' },
      [[300, 'event', 'Met at Coffee Fest in Baltimore.']]),
    mk({ name: 'Grace Lin', circle: 'Family', profession: 'Nurse practitioner', location: 'Allentown, PA',
      phone: '(610) 555-0163' },
      [[9, 'call', 'Sunday call.', 'Starting the DNP program in the fall']]),
    mk({ name: 'Robert Lin', circle: 'Family', profession: 'Retired machinist', location: 'Allentown, PA' },
      [[9, 'meal', 'Sunday dinner.']]),
    mk({ name: 'Nadia Haddad', circle: 'Neighbors', profession: 'Architect', company: 'Spillman Farmer',
      email: 'nadia@example.com', location: 'Bethlehem, PA' },
      [[16, 'met', 'Ran into her on Broad Street — she offered to look at the floor plan.', 'Did the tenant fit-out on the SteelStacks cafe']]),
    mk({ name: 'Eli Brandt', circle: 'Neighbors', profession: 'Contractor', phone: '(610) 555-0188' },
      [[110, 'call', 'Called about the back patio quote.']])
  ];
}

function toggleSample() {
  if (state.demo) {
    state.people.forEach(forget);
    state.demo = false;
    save(); closeDossier(); renderAll(); fit(); toast('Sample cleared — the map is yours');
  } else {
    state.people = state.people.concat(sample());
    state.demo = true;
    save(); renderAll(); fit(); toast('Sample map loaded');
  }
  syncSampleBtn();
}

function syncSampleBtn() { /* the sample lives behind /sample now */ }

/* ---- wiring ---- */

$('#btn-add').addEventListener('click', function () { personForm(null); });
$('#btn-newcircle').addEventListener('click', function (e) {
  circlePicker(e.currentTarget.closest('button'), function (name) {
    if (!name) return;
    if (!state.circles) state.circles = [];
    if (state.circles.some(function (c) { return c.toLowerCase() === name.toLowerCase(); })) {
      toast(name + ' already exists');
    } else {
      reviveCircle(name);
      circleIndex(name);
      save(); renderAll(); fit();
      toast(name + ' added — drag people onto it');
    }
  });
});
$('#btn-import').addEventListener('click', importModal);
$('#btn-export').addEventListener('click', exportModal);
$('#btn-help').addEventListener('click', helpModal);
$('#btn-fit').addEventListener('click', fit);
$('#btn-tidy').addEventListener('click', function () {
  var pinned = nodes.filter(function (n) { return n.fx !== null && n.fx !== undefined; }).length;
  tidyMap();
  toast(pinned ? 'Untangled — ' + pinned + ' pinned ' + (pinned === 1 ? 'person' : 'people') + ' let go' : 'Untangled');
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (!$('#scrim').hidden) return closeModal();
    if (pendingPlan) { pendingPlan = null; return renderPlan(); }
    if (draft) { draft = null; return renderPreview(); }
    if (selected) return closeDossier();
  }
  var el = document.activeElement;
  var typing = /^(INPUT|TEXTAREA)$/.test(el.tagName);
  if (e.key === 'Enter' && !typing && (pendingPlan || draft)) {
    e.preventDefault();
    if (pendingPlan) runPlan(); else confirmDraft();
    return;
  }
  // an empty chat bar has nothing of its own to undo, so the map gets the key
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && (!typing || (el === chat && !chat.value))) {
    e.preventDefault(); undo(); return;
  }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); chat.focus(); }
  if (e.key === 'f') fit();
  if (e.key === 't') tidyMap();
  if (e.key === '?') helpModal();
  if (e.key === 'n') { e.preventDefault(); personForm(null); }
});

window.addEventListener('resize', resize);

/* ---- the surface sync.js drives ---- */

window.Rootwork = {
  getState: function () { return state; },
  setState: function (next) {
    applyingRemote = true;
    var keepSelected = selected && selected.ref ? selected.ref.id : null;
    state = Object.assign(DEFAULTS(), next);
    state.people.forEach(normalizePerson);
    state.people.forEach(function (p) { circlesOf(p).forEach(circleIndex); });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    renderAll();
    if (keepSelected && byId[keepSelected]) openDossier(byId[keepSelected]);
    syncSampleBtn();
    applyingRemote = false;
  },
  modal: modal, closeModal: closeModal, toast: toast,
  parse: parse,                                 // exposed for tests
  nodeScreen: function (id) {
    var n = byId[id] || nodes.filter(function (x) { return x.label === id; })[0];
    if (!n) return null;
    var p = toScreen(n.x, n.y);
    var r = canvas.getBoundingClientRect();
    return { x: r.left + p[0], y: r.top + p[1], kind: n.kind, label: n.label };
  }
};

/* ---- go ---- */

(function init() {
  var t = 'auto';
  try { t = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { }
  if (t !== 'auto') document.documentElement.setAttribute('data-theme', t);

  load();

  readTokens();
  resize();
  rebuild();
  renderStats(); renderLegend(); renderNudges();

  // let the springs settle before the first framing
  for (var i = 0; i < 260; i++) tick();
  fit();

  var pill = document.createElement('button');
  pill.className = 'pill';
  pill.id = 'sync-pill';
  pill.type = 'button';
  pill.dataset.tone = 'off';
  pill.innerHTML = '<span class="dot"></span><span class="plabel">Sync off</span>';
  pill.addEventListener('click', function () {
    if (window.RootworkSync) window.RootworkSync.open();
    else toast('Sync is not available in this build');
  });
  $('.tools').insertBefore(pill, $('#btn-add'));

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { needsDraw = true; });
  loop();

  if (window.RootworkSync) window.RootworkSync.attach(window.Rootwork);

  // installable app, when served over http(s); harmless anywhere else
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
  setTimeout(function () { chat.focus(); }, 300);
})();

})();
