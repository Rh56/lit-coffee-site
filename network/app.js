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

var state = { me: { name: 'Me' }, people: [], circles: [], colors: {}, tombstones: {}, circleTombstones: {}, pad: [], padTombstones: {}, layout: 'orbit', settingsAt: 0, meUpdated: 0, demo: false, seq: 1 };
var DEFAULTS = function () { return { me: { name: 'Me' }, people: [], circles: [], colors: {}, tombstones: {}, circleTombstones: {}, pad: [], padTombstones: {}, layout: 'orbit', settingsAt: 0, meUpdated: 0, demo: false, seq: 1 }; };
var applyingRemote = false;
var pendingRemote = null;

/* True while the person is actually typing into something that a re-render
   would destroy. Sync waits for this to clear. */
function isEditing() {
  var el = document.activeElement;
  if (!el || el === document.body || !el.closest) return false;
  if (el.closest('#scrim')) return true;                    // a dialog is open
  var typing = /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable;
  if (!typing) return false;
  // anything typed inside a panel we rebuild wholesale: the card, the touchpoint
  // composer, an inline field editor. Checking the container rather than a list
  // of classes means a new control here is covered the day it is added.
  if (el.closest('#dossier, .logger, .cpick, .newfield, #pad')) return true;
  return !!(el.matches && el.matches('.inplace, .chipinput, .notebox'));
}

function uid() { return 'p' + (state.seq++) + Math.random().toString(36).slice(2, 6); }

function load() {
  var raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
  if (!raw) return false;
  try {
    var d = JSON.parse(raw);
    if (!d || !Array.isArray(d.people)) return false;
    state = Object.assign(DEFAULTS(), d);
    sweepIdCircles();
    if (!Array.isArray(state.pad)) state.pad = [];
    state.padTombstones = state.padTombstones || {};
    state.people.forEach(normalizePerson);
    return true;
  } catch (e) { return false; }
}

var saveTimer = null;
/* A circle that is really a person's id, left over from the URL bug: drop it,
   and leave a tombstone so the other device does not hand it back. */
function sweepIdCircles() {
  var bad = (state.circles || []).filter(looksLikeId);
  if (!bad.length) return;
  state.circleTombstones = state.circleTombstones || {};
  bad.forEach(function (name) {
    state.circleTombstones[name.toLowerCase()] = Date.now();
    if (state.colors) delete state.colors[name];
  });
  state.circles = state.circles.filter(function (c) { return !looksLikeId(c); });
  state.people.forEach(function (p) {
    if (!Array.isArray(p.circles)) return;
    var keep = p.circles.filter(function (c) { return !looksLikeId(c); });
    if (keep.length !== p.circles.length) { p.circles = keep; p.updated = Date.now(); }
  });
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    if (!applyingRemote && window.RootworkSync) window.RootworkSync.markDirty();
  }, 220);
}

function touch(p) { p.updated = Date.now(); return p; }

/* What uid() produces: p, the sequence number, then four from Math.random.
   Nothing a person would ever name a circle. */
var IDLIKE = /^p\d+[a-z0-9]{3,5}$/;

function looksLikeId(name) { return IDLIKE.test(String(name || '')); }

function forget(p) {
  state.tombstones = state.tombstones || {};
  state.tombstones[p.id] = Date.now();
  state.people = state.people.filter(function (x) { return x.id !== p.id; });
}

/* Real degrees rather than a vague undergrad/grad pair. Clicking the chip
   opens this list; the two old values are converted on the way in. */
var DEGREES = ['BS', 'BA', 'BBA', 'BFA', 'Assoc', 'MS', 'MA', 'MBA', 'MEng', 'MPH', 'MFA', 'JD', 'MD', 'PhD', 'EdD'];
var OLD_LEVEL = { undergrad: 'BS', grad: 'MS' };

/* Spoken or written degree -> the label on the chip. Most specific first, so
   "MBA" is not read as a bare "BA". */
var DEGREE_WORDS = [
  [/\bm\.?b\.?a\b|\bbusiness school\b/i, 'MBA'],
  [/\bb\.?b\.?a\b/i, 'BBA'],
  [/\bm\.?p\.?h\b|\bpublic health\b/i, 'MPH'],
  [/\bm\.?f\.?a\b/i, 'MFA'],
  [/\bb\.?f\.?a\b/i, 'BFA'],
  [/\bm\.?eng\b/i, 'MEng'],
  [/\bed\.?d\b/i, 'EdD'],
  [/\bph\.?d\b|\bdoctorate\b|\bdoctoral\b/i, 'PhD'],
  [/\bj\.?d\b|\blaw school\b/i, 'JD'],
  [/\bm\.?d\b|\bmed(?:ical)? school\b|\bresidency\b/i, 'MD'],
  [/\bm\.?s\.?c?\b|\bmasters?(?:'s)?\s+of\s+science\b/i, 'MS'],
  [/\bm\.?a\b|\bmasters?(?:'s)?\s+of\s+arts\b/i, 'MA'],
  [/\bb\.?s\.?c?\b|\bbachelors?(?:'s)?\s+of\s+science\b/i, 'BS'],
  [/\bb\.?a\b|\bbachelors?(?:'s)?\s+of\s+arts\b/i, 'BA'],
  [/\bassociates?\b/i, 'Assoc'],
  [/\bmasters?\b|\bmaster's\b/i, 'MS'],
  [/\bbachelors?\b|\bundergrad(?:uate)?\b|\bfreshman\b|\bsophomore\b/i, 'BS']
];

/* The degree named in a phrase, or '' when it only says "grad" — better blank
   than a guess at which degree it was. */
function degreeIn(hay) {
  if (!hay) return '';
  for (var i = 0; i < DEGREE_WORDS.length; i++) {
    if (DEGREE_WORDS[i][0].test(hay)) return DEGREE_WORDS[i][1];
  }
  return '';
}
function cleanDegree(v) {
  v = clean(v || '');
  if (!v) return '';
  if (OLD_LEVEL[v.toLowerCase()]) return OLD_LEVEL[v.toLowerCase()];
  var hit = DEGREES.filter(function (d) { return d.toLowerCase() === v.toLowerCase(); })[0];
  return hit || degreeIn(v) || '';
}

function schoolsOf(p) { return p.schools || []; }

/* ---- search ----
   One matcher for the map and the archive. A query is words; every word has
   to turn up somewhere in the person (name, role, company, place, email,
   circles, schools, notes, touchpoints, their own fields, who they are tied
   to), accents and case aside. The hit says where it matched, so a list can
   show the note that answered the question rather than just the name. */
function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

function queryTerms(q) { return fold(q).split(/\s+/).filter(Boolean); }

function searchFields(p) {
  return [['name', p.name], ['role', p.profession], ['company', p.company],
    ['location', p.location], ['email', p.email],
    ['circle', circlesOf(p).filter(function (c) { return c !== 'Unsorted'; }).join(', ')],
    ['school', schoolsOf(p).map(function (x) { return x.name + (x.level ? ' ' + x.level : ''); }).join(', ')]]
    .concat((p.notes || []).map(function (n) { return ['note', n.t]; }))
    .concat((p.log || []).map(function (e) { return ['touchpoint', e.text + (e.learned ? ' \u2014 ' + e.learned : '')]; }))
    .concat(Object.keys(p.custom || {}).map(function (k) { return [k, p.custom[k]]; }))
    .concat(tiesOf(p).map(function (t) { return ['connected', t.person.name]; }))
    .filter(function (f) { return f[1]; });
}

/* null when some word is nowhere; otherwise a score (the name counts most)
   and, if the name alone does not explain it, the field that does */
function searchHit(p, terms) {
  if (!terms.length) return { score: 0, where: null };
  var fields = searchFields(p).map(function (f) { return [f[0], f[1], fold(f[1])]; });
  var name = fold(p.name), score = 0, where = null;
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i];
    if (name.indexOf(t) === 0) { score += 100; continue; }
    if ((' ' + name).indexOf(' ' + t) >= 0) { score += 60; continue; }
    if (name.indexOf(t) >= 0) { score += 40; continue; }
    var f = fields.filter(function (x) { return x[0] !== 'name' && x[2].indexOf(t) >= 0; })[0];
    if (!f) return null;
    score += f[0] === 'role' || f[0] === 'company' ? 20 : 10;
    if (!where) where = { label: f[0], text: f[1] };
  }
  return { score: score, where: where };
}

function addSchool(list, name, level) {
  name = clean(name);
  if (!name) return list;
  var found = list.filter(function (s) { return s.name.toLowerCase() === name.toLowerCase(); })[0];
  level = cleanDegree(level);
  if (found) { if (level && !found.level) found.level = level; return list; }
  list.push({ name: name, level: level });
  return list;
}

function normalizePerson(p) {
  p.ties = p.ties || [];
  p.custom = p.custom || {};

  // schools became a list with a level on each
  if (!Array.isArray(p.schools)) p.schools = [];
  if (p.school) { addSchool(p.schools, p.school, ''); delete p.school; }
  // undergrad/grad from the old two-value days become a real degree
  p.schools.forEach(function (sc) { sc.level = cleanDegree(sc.level); });

  // birthday and "met via" are gone as fields; anything already recorded
  // keeps its place on the card as a line of its own
  if (p.birthday) { p.custom.birthday = p.custom.birthday || p.birthday; delete p.birthday; }
  if (p.howMet) { p.custom['met via'] = p.custom['met via'] || p.howMet; delete p.howMet; }
  p.notes = p.notes || [];
  // phone is gone as a field; a number already on file becomes a note, with
  // an id fixed per person so two devices migrating it do not make two
  if (p.phone !== undefined) {
    var num = clean(String(p.phone || ''));
    if (num && !p.notes.some(function (n) { return n.t && n.t.indexOf(num) >= 0; })) {
      p.notes.push({ id: 'n-phone-' + p.id, t: 'Phone: ' + num, at: p.created || Date.now() });
    }
    delete p.phone;
  }
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
    id: uid(), name: name || '', email: '', profession: '', company: '',
    schools: [], location: '', circles: [], custom: {},
    notes: [], log: [], created: Date.now()
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
/* The colour a name would take, without registering it. Anything that only
   needs a pigment for drawing uses this: a lookup has no business creating a
   circle, and one that did is how a person's id once turned into one. */
function hueIndex(name) {
  if (!name || name === 'Unsorted') return 0;
  if (state.colors && state.colors[name]) return state.colors[name];
  var i = state.circles.indexOf(name);
  if (i >= 0) return (i % 8) + 1;
  var h = 0;
  for (var k = 0; k < name.length; k++) h = (h * 31 + name.charCodeAt(k)) % 997;
  return (h % 8) + 1;
}

function circleIndex(name) {
  if (name === 'Unsorted') return 0;
  if (state.colors && state.colors[name]) return state.colors[name];
  var i = state.circles.indexOf(name);
  if (i < 0) {
    if (circleKilled(name)) return 6;          // deleted: draw it, do not re-register it
    if (looksLikeId(name)) return hueIndex(name);   // an id is not a circle
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

/* ------------------------------------------------------------ text bits -- */
/* What is left of the sentence parser: the two tidying helpers the card
   editors still lean on. */

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

/* --------------------------------------------------------------- layout -- */
/* A three-tier mind map: me → circles → people. Positions come from a small
   spring simulation so the thing settles into something organic, but each
   circle is nudged toward its own ray so branches don't tangle. */

var nodes = [], links = [], byId = {};

/* ------------------------------------------------------------ layouts -----
   Positions are computed, not simulated. Every node is given a target and
   eased towards it, which means no jitter, no drift, and no two dots landing
   on top of each other — spacing is decided up front by how many there are.
   Switching layout animates for free, because only the targets change. */

var LAYOUTS = [
  { id: 'web',     name: 'Web',     hint: 'Tidied organic — tight clusters, each circle keeping to its own quarter' },
  { id: 'arc',     name: 'Arc',     hint: 'Everyone on one ring, grouped by circle, connections crossing the middle' },
  { id: 'stars',   name: 'Stars',   hint: 'Led by who introduced whom, so connected people cluster' }
];

function layoutId() {
  // retired views (Orbit, Classic, Tree, Columns, Venn, Grid, Pulse) land on Web
  var id = state.layout;
  return LAYOUTS.some(function (l) { return l.id === id; }) ? id : 'web';
}
var LOOSE = { web: 1, stars: 1 };
function isLoose() { return !!LOOSE[layoutId()]; }

var R_PERSON = 6, R_HUB = 9, R_ME = 13;

function rebuild() {
  var prev = {};
  nodes.forEach(function (n) { prev[n.id] = n; });
  nodes = []; links = []; byId = {};

  var visible = state.people.filter(function (p) {
    return circlesOf(p).some(function (c) { return !hidden[c]; });
  });

  var me = mk('me', 'me', state.me.name || 'Me', null, 0);

  var circles = [];
  (state.circles || []).forEach(function (c) { if (c !== 'Unsorted' && !hidden[c]) circles.push(c); });
  visible.forEach(function (p) {
    circlesOf(p).forEach(function (c) { if (!hidden[c] && circles.indexOf(c) < 0) circles.push(c); });
  });
  circles.sort(function (a, b) { return circleIndex(a) - circleIndex(b); });

  circles.forEach(function (c) {
    var node = mk('c:' + c, 'circle', c, c, circleIndex(c));
    node.members = [];
    links.push({ a: me, b: node, trunk: true });
  });

  visible.forEach(function (p) {
    var mine = circlesOf(p).filter(function (c) { return !hidden[c]; });
    var parent = byId['c:' + mine[0]] || me;
    var n = mk(p.id, 'person', p.name, p, circleIndex(mine[0]));
    n.parent = parent;
    n.circles = mine;
    n.hues = mine.map(circleIndex);
    n.strength = p.log.length;
    if (parent.members) parent.members.push(n);
    links.push({ a: parent, b: n });
    // every other circle they belong to pulls on them too, which is what makes
    // a shared person sit between two groups instead of hiding under one
    mine.slice(1).forEach(function (c) {
      var other = byId['c:' + c];
      if (other) {
        links.push({ a: other, b: n, secondary: true });
        other.members.push(n);
      }
    });
  });

  visible.forEach(function (p) {
    var a = byId[p.id];
    if (!a) return;
    p.ties.forEach(function (t) {
      var b = byId[t.id];
      if (b) links.push({ a: a, b: b, tie: true, kind: t.kind });
    });
  });

  function mk(id, kind, label, ref, ci) {
    var old = prev[id];
    var n = {
      id: id, kind: kind, label: label, ref: ref, ci: ci,
      x: old ? old.x : 0, y: old ? old.y : 0,
      vx: 0, vy: 0, tx: 0, ty: 0,
      r: kind === 'me' ? R_ME : kind === 'circle' ? R_HUB : R_PERSON,
      angle: old ? old.angle : 0,
      fx: null, fy: null,
      born: old ? old.born : 0
    };
    nodes.push(n); byId[id] = n;
    return n;
  }

  computeLayout();

  nodes.forEach(function (n) {
    if (prev[n.id]) return;
    n.born = performance.now();
    var from = n.parent || byId['me'];
    n.x = (from ? from.x : n.tx) + (Math.random() - 0.5) * 40;
    n.y = (from ? from.y : n.ty) + (Math.random() - 0.5) * 40;
  });

  settling = true;
  heat = 1;
  if (nodes.length !== lastNodeCount) { wantFit = true; lastNodeCount = nodes.length; }
  updateHint();
}

function computeLayout() {
  var mode = layoutId();
  var me = byId['me'];
  if (!me) return;
  var hubs = nodes.filter(function (n) { return n.kind === 'circle'; });
  hubs.forEach(function (h) {
    h.members.sort(function (a, b) { return a.label.localeCompare(b.label); });
  });
  var loose = nodes.filter(function (n) { return n.kind === 'person' && n.parent === me; });

  hubs.forEach(function (h) { h.arc = null; h.field = null; });
  if (mode === 'arc') return layoutArc(me, hubs, loose);
  return seedLoose(me, hubs, loose);          // web and stars settle themselves
}

/* Web and Venn are relaxed rather than placed, so they only need a sensible
   starting ring — the forces do the rest. */
function seedLoose(me, hubs, loose) {
  me.tx = 0; me.ty = 0;
  var groups = hubs.slice();
  if (!groups.length) return;
  var R = 210 + groups.length * 14;
  groups.forEach(function (g, i) {
    var a = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
    g.angle = a;
    g.seedX = Math.cos(a) * R;
    g.seedY = Math.sin(a) * R;
    if (!g.x && !g.y) { g.x = g.seedX; g.y = g.seedY; }
    g.members.forEach(function (n, j) {
      if (n.x || n.y) return;
      var aa = a + (j / Math.max(1, g.members.length) - 0.5) * 1.1;
      n.x = g.seedX + Math.cos(aa) * 90;
      n.y = g.seedY + Math.sin(aa) * 90;
    });
  });
}

/* Venn — every circle is a disc, and the discs that share people are pushed
   into each other so the shared ones can sit in the lens between them. Placed
   outright rather than relaxed: forces pulling "gather", "separate" and "keep
   non-members out" at the same time only ever fight each other. */

/* Arc — everyone on one ring, grouped by circle, so the connections between
   people cross the middle where you can actually see them. */
function layoutArc(me, hubs, loose) {
  me.tx = 0; me.ty = 0;
  var groups = hubs.filter(function (g) { return g.members.length; });
  if (loose.length) groups.push({ synthetic: true, members: loose });
  var total = groups.reduce(function (n, g) { return n + g.members.length; }, 0);
  if (!total) return;

  var STEP = 40;                                     // world units per person
  var R = Math.max(300, (total * STEP + groups.length * 70) / (Math.PI * 2));
  var gap = (70 / R);                                // a breath between groups
  var span = (Math.PI * 2 - gap * groups.length) / total;
  var cursor = -Math.PI / 2 + gap / 2;

  groups.forEach(function (g) {
    var start = cursor;
    g.members.forEach(function (n, i) {
      var a = start + span * (i + 0.5);
      n.tx = Math.cos(a) * R;
      n.ty = Math.sin(a) * R;
      n.angle = a;
    });
    var mid = start + span * g.members.length / 2;
    if (!g.synthetic) {
      g.angle = mid;
      g.arc = { r: R, from: start, to: start + span * g.members.length };
      g.tx = Math.cos(mid) * (R + 74);
      g.ty = Math.sin(mid) * (R + 74);
    }
    cursor = start + span * g.members.length + gap;
  });
  hubs.forEach(function (g) {
    if (!g.members.length) { g.tx = 0; g.ty = R + 74; g.arc = null; }
  });
}

/* ---------------------------------------------------------------- motion --
   Two regimes. Tree and Columns ease to a computed target. Web and Venn run a
   small relaxation: springs hold the structure, a hard separation pass keeps
   anything from touching, and every circle someone belongs to pulls on them,
   so a shared person settles in between rather than hiding under one branch. */

var settling = true, heat = 1;

function tick() {
  if (!settling) return false;
  return isLoose() ? relax() : easeToTargets();
}

function easeToTargets() {
  var moving = false, ease = 0.16;
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.fx !== null && n.fx !== undefined) { n.x = n.fx; n.y = n.fy; moving = true; continue; }
    var dx = n.tx - n.x, dy = n.ty - n.y;
    if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) { n.x = n.tx; n.y = n.ty; continue; }
    n.x += dx * ease; n.y += dy * ease;
    moving = true;
  }
  if (!moving) settling = false;
  return moving;
}

/* Both relaxed views share one solver; what differs is what pulls.

   web   — tight clusters, each circle held in its own quarter of the map,
           with a hard separation pass that always wins
   stars — led by who introduced whom, so connected people gather */
function relax() {
  var mode = layoutId();
  var me = byId['me'];
  var i, j, a, b, dx, dy, d, f;

  var P = mode === 'stars'
    ? { trunk: 300, member: 150, kTrunk: 0.012, kMember: 0.016, kTie: 0.09,
        charge: 2400, damp: 0.8, sep: 58, sector: 0, decay: 0.98 }
    : { trunk: 215, member: 84, kTrunk: 0.04, kMember: 0.075, kTie: 0,
        charge: 1250, damp: 0.79, sep: 62, sector: 0.05, decay: 0.978 };

  for (i = 0; i < links.length; i++) {
    var L = links[i];
    a = L.a; b = L.b;
    var len, k;
    if (L.tie) {
      if (!P.kTie) continue;
      len = 96; k = P.kTie;
    } else {
      len = L.trunk ? P.trunk : P.member;
      k = L.trunk ? P.kTrunk : (L.secondary ? P.kMember * 0.8 : P.kMember);
    }
    dx = b.x - a.x; dy = b.y - a.y;
    d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    f = (d - len) * k * heat;
    dx = dx / d * f; dy = dy / d * f;
    b.vx -= dx; b.vy -= dy;
    a.vx += dx * 0.4; a.vy += dy * 0.4;
  }

  for (i = 0; i < nodes.length; i++) {
    a = nodes[i];
    for (j = i + 1; j < nodes.length; j++) {
      b = nodes[j];
      dx = b.x - a.x; dy = b.y - a.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > 90000 || d2 < 0.01) continue;
      d = Math.sqrt(d2);
      var q = (a.kind === 'circle' || b.kind === 'circle') ? P.charge * 1.8 : P.charge;
      f = Math.min(2.6, q / d2) * heat;
      dx = dx / d * f; dy = dy / d * f;
      a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
    }
  }

  // Web only: hold each circle on the ray it was seeded on. Branches that stay
  // in their own quarter stop the whole thing reading as a tangle.
  if (P.sector) {
    nodes.forEach(function (n) {
      if (n.kind !== 'circle' || n.seedX === undefined) return;
      n.vx += (n.seedX - n.x) * P.sector * heat;
      n.vy += (n.seedY - n.y) * P.sector * heat;
    });
  }

  for (i = 0; i < nodes.length; i++) {
    a = nodes[i];
    if (a === me) { a.x = 0; a.y = 0; a.vx = a.vy = 0; continue; }
    if (a.fx !== null && a.fx !== undefined) { a.x = a.fx; a.y = a.fy; a.vx = a.vy = 0; continue; }
    a.vx *= P.damp; a.vy *= P.damp;
    a.x += Math.max(-14, Math.min(14, a.vx));
    a.y += Math.max(-14, Math.min(14, a.vy));
  }

  if (P.sep) {
    for (var pass = 0; pass < 3; pass++) {
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          b = nodes[j];
          var min = (a.kind === 'person' && b.kind === 'person') ? P.sep : 96;
          dx = b.x - a.x; dy = b.y - a.y;
          d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          if (d >= min) continue;
          var push = (min - d) / 2;
          dx = dx / d * push; dy = dy / d * push;
          if (a !== me && (a.fx === null || a.fx === undefined)) { a.x -= dx; a.y -= dy; }
          if (b !== me && (b.fx === null || b.fx === undefined)) { b.x += dx; b.y += dy; }
        }
      }
    }
  }

  heat *= P.decay;
  if (heat < 0.03) { settling = false; heat = 0; return false; }
  return true;
}

function kick() { settling = true; heat = Math.max(heat, 0.65); needsDraw = true; }

/* ---------------------------------------------------------------- plate -- */

var canvas = document.getElementById('plate');
var ctx = canvas.getContext('2d');
var cam = { x: 0, y: 0, k: 1 };
var W = 0, H = 0, dpr = 1;
var hover = null, selected = null, dragging = null, panning = null, moved = false, dropTarget = null;
var searchTerm = '', searchHits = {};
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
  computeLayout();
  settling = true; heat = 1;
  for (var i = 0; i < 90; i++) tick();
  fitSmooth();
  needsDraw = true;
}

/* Where the camera has to sit for everything to be visible, given the rail,
   the notepad and whatever panel is open. */
function fitTarget() {
  if (!nodes.length) return null;
  var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  nodes.forEach(function (n) {
    minx = Math.min(minx, n.x); maxx = Math.max(maxx, n.x);
    miny = Math.min(miny, n.y); maxy = Math.max(maxy, n.y);
  });

  var wide = W > 880;
  var L = wide ? 244 : 34, R = (selected && wide ? 400 : 34), T = 16, B = wide ? 132 : 150;
  var availW = Math.max(120, W - L - R), availH = Math.max(120, H - T - B);
  var many = nodes.length > 70;
  var floorK = W < 620 ? 0.52 : (many ? 0.46 : 0.34);   // legible beats complete
  var listy = layoutId() !== 'orbit';

  // Names live in screen space, so the room they need depends on the zoom —
  // solve for it in a couple of passes rather than cropping every label.
  var k = floorK;
  var padL = 0, padR = 0, padY = 0;
  for (var pass = 0; pass < 3; pass++) {
    padR = (listy ? 168 : 90) / k;
    padL = (listy ? 20 : 90) / k;
    padY = (listy ? 26 : 34) / k;
    var wNeed = (maxx + padR) - (minx - padL);
    var hNeed = (maxy + padY) - (miny - padY);
    k = Math.max(floorK, Math.min(1.4, Math.min(availW / (wNeed || 1), availH / (hNeed || 1))));
  }

  var bx0 = minx - padL, bx1 = maxx + padR;
  var by0 = miny - padY, by1 = maxy + padY;
  var cx = L + availW / 2, cy = T + availH / 2;
  var x = (bx0 + bx1) / 2 - (cx - W / 2) / k;
  var y = (by0 + by1) / 2 - (cy - H / 2) / k;

  // If the floor stopped us zooming out far enough, anchor to the top left
  // rather than centring — you read from the start and pan on from there.
  if ((bx1 - bx0) * k > availW) x = bx0 + (availW / 2) / k - (cx - W / 2) / k;
  if ((by1 - by0) * k > availH) y = by0 + (availH / 2) / k - (cy - H / 2) / k;

  return { k: k, x: x, y: y };
}

function fit() {
  var t = fitTarget();
  if (!t) return;
  cam.x = t.x; cam.y = t.y; cam.k = t.k;
  draw();
}

function fitSmooth() {
  var t = fitTarget();
  if (t) glide(t.x, t.y, t.k);
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

function drawRims() {
  nodes.forEach(function (h) {
    if (h.kind !== 'circle' || !h.arc) return;
    ctx.save();
    ctx.lineWidth = 15 / cam.k;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = mix(C.hues[h.ci] || C.accent, 0.3);
    ctx.beginPath();
    ctx.arc(0, 0, h.arc.r, h.arc.from, h.arc.to);
    ctx.stroke();
    ctx.restore();
  });
}

function draw() {
  if (!W) return;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.k, cam.k);
  ctx.translate(-cam.x, -cam.y);

  var lay = layoutId();
  if (lay === 'arc') drawRims();

  var focus = hover || selected;
  var DIM = hover ? 0.24 : 0.72;   // hovering focuses hard; a card open only softens
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
    if (L.tie) {
      // Drawn from the person who made the introduction towards the person
      // you ended up meeting, with an arrowhead so the direction is readable.
      var from = L.b, to = L.a;
      var dx = to.x - from.x, dy = to.y - from.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var cx = (from.x + to.x) / 2 - dy * 0.12, cy = (from.y + to.y) / 2 + dx * 0.12;

      ctx.save();
      var starry = layoutId() === 'stars';
      ctx.setLineDash(starry ? [] : [5 / cam.k, 4 / cam.k]);
      ctx.lineWidth = (starry ? 1.7 : 1.1) / cam.k;
      ctx.strokeStyle = mix(C.ink, (starry ? 0.6 : 0.42) * dim);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(cx, cy, to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);

      var t = 0.62, mt = 1 - t;
      var px = mt * mt * from.x + 2 * mt * t * cx + t * t * to.x;
      var py = mt * mt * from.y + 2 * mt * t * cy + t * t * to.y;
      var tx = 2 * mt * (cx - from.x) + 2 * t * (to.x - cx);
      var ty = 2 * mt * (cy - from.y) + 2 * t * (to.y - cy);
      var tl = Math.sqrt(tx * tx + ty * ty) || 1;
      var ax = tx / tl, ay = ty / tl;
      var head = 7 / cam.k;
      ctx.beginPath();
      ctx.moveTo(px + ax * head, py + ay * head);
      ctx.lineTo(px - ax * head * 0.6 - ay * head * 0.55, py - ay * head * 0.6 + ax * head * 0.55);
      ctx.lineTo(px - ax * head * 0.6 + ay * head * 0.55, py - ay * head * 0.6 - ax * head * 0.55);
      ctx.closePath();
      ctx.fillStyle = mix(C.ink, 0.55 * dim);
      ctx.fill();
      ctx.restore();
      return;
    }
    var mode = layoutId();
    var trunk = L.b.kind === 'circle';
    if (!isLoose() && L.secondary) return;      // the pips beside the name say it
    var fade = dim * (trunk ? 0.55 : 1) * (L.secondary ? 0.5 : 1);
    var hue = L.secondary ? (C.hues[circleIndex(L.a.label)] || C.accent) : hueOf(L.b);

    if (isLoose()) {
      var soft = mode === 'stars' ? 0.42 : 1;
      branch(L.a, L.b, trunk ? 7 : (L.secondary ? 3 : 5), trunk ? 2.8 : 1.1, hue, fade * soft);
      return;
    }

    if (mode === 'arc') {
      if (!trunk) return;                       // the rim band carries the group
      ctx.save();
      ctx.lineWidth = 1.1 / cam.k;
      ctx.strokeStyle = mix(hue, 0.3 * fade);
      ctx.beginPath();
      ctx.moveTo(L.a.x, L.a.y);
      ctx.lineTo(L.b.x, L.b.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
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
      ctx.fillStyle = C.ground; ctx.fill();
      ctx.lineWidth = (dropTarget === n ? 2.6 : 1.8) / cam.k;
      ctx.strokeStyle = mix(col, 0.85 * dim); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = mix(col, 0.92 * dim);
      ctx.fill();
      if (dropTarget === n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 12, 0, Math.PI * 2);
        ctx.fillStyle = mix(col, 0.14); ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
        ctx.lineWidth = 1.4 / cam.k; ctx.setLineDash([4 / cam.k, 3 / cam.k]);
        ctx.strokeStyle = mix(col, 0.95); ctx.stroke(); ctx.setLineDash([]);
      }
      if (n.hit) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
        ctx.lineWidth = 2 / cam.k; ctx.strokeStyle = mix(C.accent, 0.9); ctx.stroke();
      }
      if (selected === n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
        ctx.lineWidth = 1.2 / cam.k; ctx.strokeStyle = C.ink; ctx.stroke();
      }
    }
  });

  ctx.restore();

  // Labels sit in screen space so they never distort with zoom. In Orbit they
  // hang under the dot; in the list layouts they read to the right of it, the
  // way a list wants to be read.
  ctx.save();
  ctx.textBaseline = 'top';

  var listy = false;
  var jobs = nodes.slice().sort(function (a, b) { return labelRank(a) - labelRank(b); });
  var placed = [];

  /* With a few dozen people every name fits. With three hundred it cannot, and
     printing them anyway is how a map turns to mush. Past the budget only the
     ones that earn it are named — you, the circles, whatever is focused or
     searched, and then the most recently spoken to. The rest are a dot until
     you hover or search them, and hovering names the whole cluster. */
  var budget = Math.max(28, Math.round((W * H) / 26000));
  var namedCount = 0;

  if (searchTerm) {
    nodes.forEach(function (n) {
      n.hit = n.kind === 'person' && !!(n.ref && searchHits[n.ref.id]);
    });
  } else if (nodes.length && nodes[0].hit !== undefined) {
    nodes.forEach(function (n) { n.hit = false; });
  }

  jobs.forEach(function (n) {
    if (cam.k < 0.42 && n.kind === 'person' && n !== focus && n !== selected) return;
    if (n.kind === 'person') {
      var must = n === focus || n === selected || lit[n.id] || n.hit;
      if (!must && namedCount >= budget) return;
      namedCount++;
    }
    var p = toScreen(n.x, n.y);
    if (p[0] < -200 || p[0] > W + 200 || p[1] < -60 || p[1] > H + 60) return;
    var dim = focus && !lit[n.id] ? Math.max(DIM, 0.34) : 1;
    var text = n.label, h = 14;
    var right = listy && n.kind !== 'me';

    if (n.kind === 'circle') {
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.letterSpacing = '1.6px';
      text = n.label.toUpperCase();
    } else if (n.kind === 'me') {
      ctx.font = '400 17px "Instrument Serif", Georgia, serif';
      ctx.letterSpacing = '0px';
      h = 19;
    } else {
      var lz = Math.min(1, Math.max(0.8, cam.k));
      ctx.font = (n === focus ? '500 ' : '400 ') + (12 * lz).toFixed(1) + 'px Archivo, system-ui, sans-serif';
      ctx.letterSpacing = '0.2px';
      h = Math.round(13 * lz) + 1;
    }

    var w = ctx.measureText(text).width + 8;
    var x, y;
    var radial = !listy && n.kind === 'person';
    if (radial) {
      var ang = n.angle || Math.atan2(n.y, n.x);
      var ox = Math.cos(ang), oy = Math.sin(ang);
      var off = n.r * cam.k + 9;
      x = p[0] + ox * off;
      y = p[1] + oy * off - h / 2;
      if (ox > 0.3) { ctx.textAlign = 'left'; }
      else if (ox < -0.3) { ctx.textAlign = 'right'; }
      else { ctx.textAlign = 'center'; y = p[1] + (oy >= 0 ? off : -off - h + 2); }
    } else if (right) {
      ctx.textAlign = 'left';
      x = p[0] + n.r * cam.k + 8;
      y = p[1] - h / 2 + 1;
    } else {
      ctx.textAlign = 'center';
      x = p[0];
      y = p[1] + n.r * cam.k + 7 + (n.kind === 'me' ? 2 : 0);
    }

    var align = ctx.textAlign;
    var box = align === 'left' ? [x - 3, y - 2, w, h]
      : align === 'right' ? [x - w + 3, y - 2, w, h]
      : [x - w / 2, y - 2, w, h];
    var hits = function (bx) {
      return placed.some(function (q) {
        return bx[0] < q[0] + q[2] && bx[0] + bx[2] > q[0] && bx[1] < q[1] + q[3] && bx[1] + bx[3] > q[1];
      });
    };
    // step a clashing label aside rather than hiding the person
    var nudges = [0, h + 1, -(h + 1), 2 * (h + 1), -2 * (h + 1), 3 * (h + 1), -3 * (h + 1)];
    for (var k = 0; k < nudges.length; k++) {
      box[1] = y - 2 + nudges[k];
      if (!hits(box)) break;
    }
    var finalY = box[1] + 2;
    placed.push(box.slice());

    if (Math.abs(finalY - y) > 4) {
      ctx.save();
      ctx.strokeStyle = mix(C.rule, 0.9 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] + (radial ? 0 : n.r * cam.k));
      ctx.lineTo(ctx.textAlign === 'left' ? x - 4 : ctx.textAlign === 'right' ? x + 4 : p[0], finalY + h / 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = mix(C.ground, 0.92);
    ctx.strokeText(text, x, finalY);
    ctx.restore();

    ctx.fillStyle = n.kind === 'circle' ? mix(C.muted, dim)
      : n.kind === 'me' ? C.ink
      : mix(C.ink, dim);
    ctx.fillText(text, x, finalY);

    // a dot per extra circle, so a shared person is obvious in any view
    if (n.kind === 'person' && n.hues && n.hues.length > 1) {
      var tw = ctx.measureText(text).width;
      var px = ctx.textAlign === 'left' ? x + tw + 6
        : ctx.textAlign === 'right' ? x + 6
        : x + tw / 2 + 6;
      n.hues.slice(1).forEach(function (hi, k) {
        ctx.beginPath();
        ctx.arc(px + k * 7, finalY + h / 2 - 1, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = mix(C.hues[hi] || C.accent, 0.95 * dim);
        ctx.fill();
      });
    }
  });
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'center';
  ctx.restore();

  function labelRank(n) {
    if (n === focus || n === selected) return -3;
    if (n.kind === 'me') return -2;
    if (n.kind === 'circle') return -1;
    if (n.hit) return 0;                              // a search match
    if (focus && lit[n.id]) return 0.5;               // in the focused cluster
    var t = n.ref ? lastTouch(n.ref) : 0;
    return 2 + 1 / (1 + Math.max(0, daysSince(t)) / 30);
  }
}

var wantFit = false;
var lastNodeCount = 0;

var raf = null;
function loop() {
  // the archive is its own surface, not a lid over this one: while it is up
  // the plate is not on screen, so the loop stops outright rather than
  // waking every frame to find nothing to do (see mapWakes below)
  if (document.body.classList.contains('archived')) { raf = null; return; }
  raf = requestAnimationFrame(loop);
  var moving = tick();
  var sprouting = nodes.some(function (n) { return n.born && performance.now() - n.born < 460; });
  if (moving || sprouting || needsDraw) { needsDraw = false; draw(); }

  // once the springs stop after a change, bring anything that drifted off the
  // edge back into view — one movement, not a constant chase
  if (wantFit && !moving && !isEditing()) {
    var force = wantFit === 'always';
    wantFit = false;
    if (force) fitSmooth();
    else if (offscreenCount() > 0) fit();
  }
}
var needsDraw = false;


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

function offscreenCount() {
  // the open card hides its side of the stage, so treat that as off-screen too
  var pad = 24;
  var right = W - (W > 880 && selected ? 392 : pad);
  var n = 0;
  nodes.forEach(function (a) {
    var p = toScreen(a.x, a.y);
    if (p[0] < pad || p[0] > right || p[1] < pad || p[1] > H - 120) n++;
  });
  return n;
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

/* ---- layout switcher ---- */

var LAYOUT_ICONS = {
  web:   '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>' +
         '<path d="M12 12L5.5 6.5M12 12l7-3M12 12l-2.5 7M12 12l6.5 5" opacity=".55"/>' +
         '<circle cx="5" cy="6" r="1.7" fill="currentColor" stroke="none"/>' +
         '<circle cx="19.5" cy="8.6" r="1.7" fill="currentColor" stroke="none"/>' +
         '<circle cx="9.2" cy="19.4" r="1.7" fill="currentColor" stroke="none"/>' +
         '<circle cx="18.8" cy="17.4" r="1.7" fill="currentColor" stroke="none"/>',
  arc:   '<circle cx="12" cy="12" r="7.6" opacity=".5"/>' +
         '<path d="M6.6 6.6C11 11 13 13 17.4 17.4M17.4 6.6C13 11 11 13 6.6 17.4" opacity=".8"/>' +
         '<circle cx="6.6" cy="6.6" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="17.4" cy="6.6" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="6.6" cy="17.4" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="17.4" cy="17.4" r="1.5" fill="currentColor" stroke="none"/>',
  stars: '<path d="M7 7l5 2.5L17.5 6M7 7l1.5 6M8.5 13l6 4M17.5 6l-3 11" opacity=".55"/>' +
         '<circle cx="7" cy="7" r="1.6" fill="currentColor" stroke="none"/>' +
         '<circle cx="17.5" cy="6" r="1.6" fill="currentColor" stroke="none"/>' +
         '<circle cx="8.5" cy="13" r="1.6" fill="currentColor" stroke="none"/>' +
         '<circle cx="14.5" cy="17" r="1.6" fill="currentColor" stroke="none"/>',
  tree:  '<circle cx="4.5" cy="12" r="1.9" fill="currentColor" stroke="none"/>' +
         '<path d="M6.4 12h4M10.4 12V6.5h4M10.4 12v5.5h4"/>' +
         '<circle cx="16" cy="6.5" r="1.7" fill="currentColor" stroke="none"/>' +
         '<circle cx="16" cy="17.5" r="1.7" fill="currentColor" stroke="none"/>',
  columns: '<path d="M6 5.5v13M12 5.5v13M18 5.5v13" opacity=".5"/>' +
         '<circle cx="6" cy="8" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="6" cy="13" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="12" cy="8" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none"/>' +
         '<circle cx="18" cy="8" r="1.5" fill="currentColor" stroke="none"/>'
};

function renderLayouts() {
  var here = layoutId();
  $('#layouts').innerHTML = LAYOUTS.map(function (l, i) {
    return '<button data-layout="' + l.id + '"' + (l.id === here ? ' data-on="1"' : '') +
      ' title="' + esc(l.name + ' — ' + l.hint) + ' (' + (i + 1) + ')" aria-pressed="' + (l.id === here) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      LAYOUT_ICONS[l.id] + '</svg><span>' + esc(l.name) + '</span></button>';
  }).join('');
}

function setLayout(id, quiet) {
  if (!LAYOUTS.some(function (l) { return l.id === id; })) return;
  if (state.layout === id) return;
  state.layout = id;
  state.settingsAt = Date.now();
  save();
  renderLayouts();
  computeLayout();
  settling = true; heat = 1;
  needsDraw = true;
  wantFit = 'always';            // frame the new shape once it has stopped moving
  if (!quiet) {
    var l = LAYOUTS.filter(function (x) { return x.id === id; })[0];
    toast(l.name + ' — ' + l.hint);
  }
}

document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-layout]');
  if (b) setLayout(b.dataset.layout);
});

/* ---- rails ---- */

function updateHint() { $('#hint').hidden = state.people.length > 0; }

function renderStats() {
  var logs = state.people.reduce(function (a, p) { return a + p.log.length; }, 0);
  $('#stats').innerHTML =
    '<span><b>' + state.people.length + '</b> people</span>' +
    '<span><b>' + circleList().length + '</b> circles</span>' +
    '<span><b>' + logs + '</b> touchpoints</span>' +
    '';
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


/* ---- the notepad ----
   Loose notes with nobody attached: a thought, an address, a to-do. Each one
   carries its own stamp so two devices merge them rather than overwrite, and
   a deleted one leaves a tombstone so it does not come back on the next pull. */

function padNotes() {
  return (state.pad || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
}

function addPadNote(text) {
  text = clean(text);
  if (!text) return;
  state.pad = state.pad || [];
  state.pad.unshift({ id: 'n' + (state.seq++) + Math.random().toString(36).slice(2, 6),
                      t: text, at: Date.now(), upd: Date.now() });
  save(); renderPad();
}

function dropPadNote(id) {
  state.padTombstones = state.padTombstones || {};
  state.padTombstones[id] = Date.now();
  state.pad = (state.pad || []).filter(function (n) { return n.id !== id; });
  save(); renderPad();
}

function renderPad() {
  var list = padNotes();
  var el = $('#pad-list');
  if (!el) return;
  $('#pad-count').textContent = list.length || '';
  // never rebuilt out from under a cursor: the box you type in lives outside this
  el.innerHTML = list.map(function (n) {
    return '<div class="pnote">' +
      '<button class="del" data-delpad="' + esc(n.id) + '" title="Delete note" aria-label="Delete note">&times;</button>' +
      '<span class="val" data-padnote="' + esc(n.id) + '" tabindex="0" role="button" title="Click to edit">' +
        esc(n.t) + '</span>' +
      '<span class="when">' + esc(ago(n.at)) + '</span>' +
    '</div>';
  }).join('');
}

var PAD_SHUT = 'rootwork.pad.shut';

(function wirePad() {
  var pad = $('#pad'), box = $('#pad-input');
  if (!pad || !box) return;

  var shut = false;
  try { shut = localStorage.getItem(PAD_SHUT) === '1'; } catch (e) { }
  var setShut = function (v) {
    shut = v;
    pad.setAttribute('data-shut', v ? '1' : '0');
    $('#pad-toggle').textContent = v ? '+' : '–';
    $('#pad-toggle').setAttribute('aria-expanded', v ? 'false' : 'true');
    try { localStorage.setItem(PAD_SHUT, v ? '1' : '0'); } catch (e) { }
  };
  setShut(shut);
  $('#pad-toggle').addEventListener('click', function () {
    setShut(!shut);
    if (!shut) box.focus();
  });

  var grow = function () {
    box.style.height = 'auto';
    box.style.height = Math.min(120, box.scrollHeight) + 'px';
  };
  box.addEventListener('input', grow);
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!clean(box.value)) return;
      addPadNote(box.value);
      box.value = ''; grow();
    }
    if (e.key === 'Escape') { box.value = ''; grow(); box.blur(); }
  });

  pad.addEventListener('click', function (e) {
    var d = e.target.closest('[data-delpad]');
    if (d) return dropPadNote(d.dataset.delpad);
    var v = e.target.closest('[data-padnote]');
    if (v) {
      var id = v.dataset.padnote;
      var note = (state.pad || []).filter(function (n) { return n.id === id; })[0];
      if (!note) return;
      editInPlace(v, note.t, true, function (val) {
        if (val === null) return renderPad();
        if (clean(val)) { note.t = clean(val); note.upd = Date.now(); }
        else dropPadNote(id);
        save(); renderPad();
      });
    }
  });
})();

/* While the archive is up the map is not drawn, so an edit there (or a
   sync landing) only marks the map stale; it catches up once, on return. */
var mapStale = false;
function renderMap() {
  mapStale = false;
  renderLayouts();
  rebuild(); renderStats(); renderLegend(); renderPad(); kick();
}
function renderAll() {
  if (document.body.classList.contains('archived')) mapStale = true;
  else renderMap();
  // the archive reads the same state; let it know when it moved
  document.dispatchEvent(new CustomEvent('rootwork:changed'));
  if (mapStale) return;
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

/* What is half-typed into the touchpoint composer. Kept outside the card so a
   re-render — a sync pull, a relayout — rebuilds it instead of wiping it. */
var logDraft = null;
function draftFor(id) { return (logDraft && logDraft.pid === id) ? logDraft : null; }

function openDossier(node) {
  var p = node && node.ref;
  if (!p || node.kind !== 'person') return;
  selected = node;
  var d = $('#dossier');
  var col = 'var(--h' + circleIndex(primaryCircle(p)) + ')';
  var lt = lastTouch(p);
  var dr = draftFor(p.id);
  // if the rebuild lands mid-sentence, put the cursor back where it was
  var was = document.activeElement;
  var caret = (dr && was && was.id === 'log-text') ? was.selectionStart : -1;

  function row(k, field, v, href) {
    var body = v ? esc(v) : '<span class="add">add</span>';
    var jump = (v && href)
      ? '<a class="jump" href="' + href + esc(v) + '" data-keep title="' +
        (href === 'mailto:' ? 'Send an email' : 'Call') + '" aria-label="' +
        (href === 'mailto:' ? 'Send an email' : 'Call') + '">' +
        (href === 'mailto:'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/></svg>') +
        '</a>'
      : '';
    return '<dt>' + esc(k) + '</dt>' +
      '<dd class="' + (v ? '' : 'empty') + '"><span class="val" data-field="' + esc(field) + '" tabindex="0" role="button" ' +
      'title="Click to edit">' + body + '</span>' + jump + '</dd>';
  }

  function chiprow(label, inner) {
    return '<div class="chiprow"><span class="rlabel">' + label + '</span>' +
      '<div class="chiplist">' + inner + '</div></div>';
  }

  d.innerHTML =
    '<div class="d-top">' +
      '<button class="d-close" id="d-close" aria-label="Close">&times;</button>' +
      '<div class="d-kicker"><span class="swatch" style="background:' + col + '"></span>' +
        p.log.length + ' touchpoint' + (p.log.length === 1 ? '' : 's') +
        ' · last ' + (p.log.length ? ago(lt) : 'never') +
        '</div>' +
      '<h2 class="d-name"><span class="val" data-field="name" tabindex="0" role="button" title="Click to rename">' + esc(p.name) + '</span></h2>' +
      '<div class="d-sub">' + esc([p.profession, p.company].filter(Boolean).join(' · ') || 'No role recorded') + '</div>' +
    '</div>' +

    '<div class="d-body">' +
      '<div class="d-sec"><h4>Details</h4><dl class="fields">' +
        row('Email', 'email', p.email, 'mailto:') +
        row('Profession', 'profession', p.profession) + row('Company', 'company', p.company) +
        row('Location', 'location', p.location) +
        Object.keys(p.custom || {}).map(function (k) {
          return '<dt>' + esc(k) + '</dt><dd><span class="val" data-custom="' + esc(k) + '" tabindex="0" role="button" ' +
            'title="Click to edit">' + esc(p.custom[k]) + '</span></dd>';
        }).join('') +
      '</dl>' +
      '<button class="addfield" data-newfield>+ another field</button>' +
      '</div>' +

      '<div class="d-sec"><h4>Filed under</h4>' +
        chiprow('Circles',
          circlesOf(p).map(function (c, i) {
            return '<span class="cchip' + (i === 0 ? ' primary' : '') + '" draggable="true" data-ci="' + i + '" ' +
              'style="--hue:var(--h' + circleIndex(c) + ')">' +
              (i === 0 ? '' : '<button class="up" data-up="' + i + '" title="Move ahead" aria-label="Move ' + esc(c) + ' ahead">‹</button>') +
              '<button class="lbl" data-primary="' + esc(c) + '" title="' +
                (i === 0 ? 'Their main circle — this is where they sit on the map' : 'Make this their main circle') + '">' +
                esc(c) + (i === 0 ? '<i>main</i>' : '') + '</button>' +
              '<button class="x" data-leave="' + esc(c) + '" aria-label="Remove from ' + esc(c) + '">&times;</button></span>';
          }).join('') +
          '<span class="cchip add"><button data-addcircle aria-label="Add to a circle">+ circle</button></span>') +

        chiprow('Schools',
          schoolsOf(p).map(function (sc, i) {
            return '<span class="cchip school">' +
              '<button class="lbl" data-editschool="' + i + '" title="Click to rename">' + esc(sc.name) + '</button>' +
              '<button class="lvl' + (sc.level ? '' : ' none') + '" data-level="' + i + '" title="Pick the degree">' +
                (sc.level || 'degree') + '</button>' +
              '<button class="x" data-rmschool="' + i + '" aria-label="Remove ' + esc(sc.name) + '">&times;</button></span>';
          }).join('') +
          '<input class="chipinput" data-add="school" placeholder="' + (schoolsOf(p).length ? 'another…' : 'add…') + '" aria-label="Add a school">') +

        chiprow('Via',
          tiesOf(p).map(function (t) {
            return '<span class="cchip tie">' +
              '<button class="lbl" data-goto="' + t.person.id + '" title="Open ' + esc(t.person.name) + '">' +
                '<i>' + (t.own ? 'via' : 'led to') + '</i>' + esc(t.person.name) + '</button>' +
              '<button class="x" data-untie="' + t.person.id + '" data-own="' + (t.own ? 1 : 0) + '" aria-label="Remove connection">&times;</button></span>';
          }).join('') +
          '<input class="chipinput" data-add="tie" placeholder="' + (tiesOf(p).length ? 'another…' : 'who connected you?') + '" aria-label="Add a connection">') +

      '</div>' +

      '<div class="d-sec"><h4>History</h4>' +
        '<div class="logger" id="logger"' + (dr ? '' : ' hidden') + '>' +
          '<div class="chanrow">' +
            ['talk', 'zoom', 'call', 'coffee', 'meal', 'event', 'email', 'message', 'met', 'note']
              .map(function (c, i) {
                var on = dr ? dr.chan === c : i === 0;
                return '<button class="chan' + (on ? ' on' : '') + '" data-chan="' + c + '">' + c + '</button>';
              }).join('') +
          '</div>' +
          '<textarea id="log-text" rows="2" placeholder="What happened?" aria-label="What happened">' +
            (dr ? esc(dr.text) : '') + '</textarea>' +
          '<div class="logrow">' +
            '<input type="date" id="log-date" aria-label="When" value="' + (dr ? esc(dr.date) : '') + '">' +
            '<button class="btn primary" id="log-save">Add</button>' +
            '<button class="btn" id="log-cancel">Cancel</button>' +
          '</div>' +
        '</div>' +
        '<button class="addfield" id="log-open"' + (dr ? ' hidden' : '') + '>+ log a touchpoint</button>' +
        (p.log.length ? '<div class="log">' + p.log.map(function (e) {
          return '<div class="entry">' +
            '<button class="del" data-dellog="' + e.id + '" title="Delete entry">&times;</button>' +
            '<div class="e-top"><span class="e-ch">' + esc(CHANNEL_LABEL[e.channel] || e.channel) + '</span>' +
            '<span>' + fmtDate(e.at) + '</span></div>' +
            '<p>' + esc(e.text) + '</p>' +
            (e.learned ? '<div class="learned">' + esc(e.learned) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>' : '<p class="blank">Nothing logged yet — tell the bar what happened.</p>') +
      '</div>' +

      '<div class="d-sec"><h4>Notes</h4><div class="notes-list">' +
        p.notes.map(function (n) {
          return '<div class="note"><button class="del" data-delnote="' + n.id + '">&times;</button>' +
            '<span class="val" data-note="' + n.id + '" tabindex="0" role="button" title="Click to edit">' + esc(n.t) + '</span></div>';
        }).join('') +
        '<textarea class="notebox" id="notebox" rows="1" placeholder="Anything worth remembering — ↵ to keep" aria-label="Add a note"></textarea>' +
      '</div></div>' +

      '<div class="d-actions">' +
        '<button class="btn quiet" data-del="' + p.id + '" style="margin-left:auto">Delete</button>' +
      '</div>' +
    '</div>';

  var lx = d.querySelector('#log-text');
  var ld = d.querySelector('#log-date');
  if (lx) lx.addEventListener('input', function () { if (logDraft) logDraft.text = lx.value; });
  if (ld) ld.addEventListener('change', function () { if (logDraft) logDraft.date = ld.value; });
  if (caret >= 0 && lx) {
    lx.focus();
    try { lx.setSelectionRange(caret, caret); } catch (e) { }
  }

  var nb = d.querySelector('.notebox');
  if (nb) nb.addEventListener('input', function () {
    nb.style.height = 'auto';
    nb.style.height = Math.min(160, nb.scrollHeight) + 'px';
  });

  d.classList.add('open');
  $('#stage').classList.add('panel-open');
  d.setAttribute('aria-hidden', 'false');

  // keep whoever is open in sight rather than behind their own card
  if (W > 880) {
    var sp = toScreen(node.x, node.y);
    // re-frame rather than shove: the card takes a third of the stage, so fit
    // to what is left instead of pushing this person out the other side
    if (sp[0] > (W - 380) * 0.78 || offscreenCount() > 0) fitSmooth();
  }
  needsDraw = true;
}

function closeDossier() {
  selected = null;
  logDraft = null;
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
    if (sc) degreePicker(t, sc.level, function (d) {
      sc.level = d; touch(p); save(); openDossier(selected);
    });
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
  if (t.dataset.primary) { joinCircle(p, t.dataset.primary, true); save(); renderAll(); return; }
  if (t.dataset.up !== undefined && t.hasAttribute('data-up')) {
    moveCircle(p, +t.dataset.up, +t.dataset.up - 1);
    return;
  }
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
  if (t.dataset.log || t.id === 'log-open') {
    var dt = $('#log-date');
    logDraft = {
      pid: p.id, text: $('#log-text').value, chan: 'talk',
      date: dt.value || new Date().toISOString().slice(0, 10)
    };
    $('#logger').hidden = false;
    $('#log-open').hidden = true;
    dt.value = logDraft.date;
    $('#log-text').focus();
    return;
  }
  if (t.classList.contains('chan')) {
    $('#logger').querySelectorAll('.chan').forEach(function (c) { c.classList.remove('on'); });
    t.classList.add('on');
    if (logDraft) logDraft.chan = t.dataset.chan;
    $('#log-text').focus();           // straight back to the sentence
    return;
  }
  if (t.id === 'log-cancel') { logDraft = null; openDossier(selected); return; }
  if (t.id === 'log-save') {
    var text = clean($('#log-text').value);
    if (!text) { $('#log-text').focus(); return; }
    var chan = ($('#logger').querySelector('.chan.on') || {}).dataset;
    var when = Date.parse($('#log-date').value + 'T12:00:00') || Date.now();
    var learned = '';
    var lm = /\b(?:learned|found out|turns out|told me|mentioned|she said|he said|they said)\s+(?:that\s+)?(.{4,})/i.exec(text);
    if (lm) learned = clean(lm[1].split(/\.\s+/)[0]).replace(/^(?:about|that)\s+/i, '').slice(0, 180);
    p.log.unshift({ id: uid(), at: when, channel: (chan && chan.chan) || 'note', text: text, learned: learned });
    logDraft = null;
    touch(p);
    lastSubject = p;
    save(); renderAll(); openDossier(selected);
    toast('Logged · ' + p.name);
    return;
  }
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

/* What to take out of "Wharton MBA" to leave the school name behind. */
var DEGREE_STRIP = /\s*\b(?:b\.?b\.?a|b\.?f\.?a|m\.?b\.?a|m\.?p\.?h|m\.?f\.?a|m\.?eng|ed\.?d|ph\.?d|j\.?d|m\.?d|m\.?s\.?c?|m\.?a|b\.?s\.?c?|b\.?a|associates?|masters?(?:'s)?|bachelors?(?:'s)?|undergrad(?:uate)?|grad(?:uate)?(?: school)?|law school|med(?:ical)? school|business school|public health|doctorate)\b\s*/gi;

/* Which degree they took there. */
function degreePicker(anchor, current, pick) {
  var old = document.getElementById('cpick');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'cpick';
  box.className = 'cpick degrees';
  box.innerHTML = '<div class="ptitle">Degree</div><div class="dgrid">' +
    DEGREES.map(function (d) {
      return '<button data-deg="' + d + '"' + (d === current ? ' data-on="1"' : '') + '>' + d + '</button>';
    }).join('') + '</div>' +
    '<div class="cnew"><input placeholder="Something else…" aria-label="Degree" value="' + esc(current || '') + '">' +
      '<button class="btn" data-new>Set</button></div>' +
    '<div class="mrow"><button data-clear>Leave it blank</button></div>';
  document.body.appendChild(box);

  var r = anchor.getBoundingClientRect();
  box.style.left = Math.min(window.innerWidth - box.offsetWidth - 10, r.left) + 'px';
  box.style.top = Math.min(window.innerHeight - box.offsetHeight - 10, r.bottom + 6) + 'px';

  var field = box.querySelector('input');
  var done = function (v) { box.remove(); pick(clean(v || '')); };
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.deg) return done(b.dataset.deg);
    if (b.hasAttribute('data-new')) return done(field.value);
    if (b.hasAttribute('data-clear')) return done('');
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
      confirmAction('Delete the ' + circle + ' circle',
        n ? plural(n, 'person', 'people') + ' stay on the map, just no longer filed there.' : 'Nobody is in it.',
        function () { membersOf(circle).forEach(function (x) { leaveCircle(x, circle); }); dropCircle(circle); });
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

/* The order of someone's circles is not decoration: the first one is where
   they sit on the map and which colour their dot takes. */
function moveCircle(p, from, to) {
  var list = circlesOf(p).slice();
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  p.circles = list;
  touch(p);
  save();
  renderAll();
  toast(list[0] + ' is ' + p.name + "'s main circle");
}

(function () {
  var dragFrom = null;
  var d = $('#dossier');

  d.addEventListener('dragstart', function (e) {
    var chip = e.target.closest('.cchip[data-ci]');
    if (!chip) return;
    dragFrom = +chip.dataset.ci;
    chip.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) { }
  });

  d.addEventListener('dragover', function (e) {
    var chip = e.target.closest('.cchip[data-ci]');
    if (dragFrom === null || !chip) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    d.querySelectorAll('.cchip.over').forEach(function (c) { c.classList.remove('over'); });
    chip.classList.add('over');
  });

  d.addEventListener('drop', function (e) {
    var chip = e.target.closest('.cchip[data-ci]');
    if (dragFrom === null || !chip) return;
    e.preventDefault();
    var to = +chip.dataset.ci;
    var p = selected && selected.ref;
    var from = dragFrom;
    dragFrom = null;
    if (p) moveCircle(p, from, to);
  });

  d.addEventListener('dragend', function () {
    dragFrom = null;
    d.querySelectorAll('.cchip.over, .cchip.dragging').forEach(function (c) {
      c.classList.remove('over'); c.classList.remove('dragging');
    });
  });
})();

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
    // "Wharton mba" or "Penn State undergrad" sets the level in the same breath
    var level = degreeIn(val);
    var stripped = val.replace(DEGREE_STRIP, ' ');
    addSchool(p.schools, titleCase(clean(stripped) || val), level);
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

/* Anything destructive says what it will do and how much of it, and can be
   taken back from the toast. */
function confirmAction(summary, detail, run) {
  modal(summary, 'This cannot be undone from the map alone', '<p class="blank">' + esc(detail) + '</p>',
    '<button class="btn primary" id="do-it">Do it</button><button class="btn" data-close>Cancel</button>');
  $('#do-it').addEventListener('click', function () {
    snapshot(summary);
    run();
    closeModal(); save(); renderAll();
    toast(summary, 'Undo', undo);
  });
}
$('#scrim').addEventListener('click', function (e) {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) closeModal();
});
// Escape closes any dialog, the archive's included (the map's keys stand
// aside while the archive is open, so the dialog listens for itself)
$('#scrim').addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();
  closeModal();
});

/* opts.circle starts a new person in that circle; opts.done(p) takes over
   from opening the card, for a surface (the archive) that shows them itself. */
function personForm(p, opts) {
  opts = opts || {};
  var isNew = !p;
  p = p || blankPerson('');
  if (isNew && opts.circle) p.circles = [opts.circle];

  /* An index card rather than a form: the name set large in the display
     face, the rest typed on hairlines, circles as chips you tap in the
     order that matters (the first is primary). Enter files it. */
  var line = function (k, label, ph, type, val) {
    return '<label class="pf-line"><span class="pf-lbl">' + label + '</span>' +
      '<input id="f-' + k + '" type="' + (type || 'text') + '" autocomplete="off" spellcheck="false" placeholder="' + esc(ph) + '" value="' +
      esc(val !== undefined ? val : p[k]) + '"></label>';
  };
  var chosen = (p.circles || []).filter(function (c) { return c && c !== 'Unsorted'; });
  var known = circleList().map(function (c) { return c.name; }).filter(function (c) { return c !== 'Unsorted'; });
  chosen.forEach(function (c) { if (known.indexOf(c) < 0) known.push(c); });

  var today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  var body =
    '<div class="pf">' +
      '<div class="pf-top"><span class="pf-tab">' + (isNew ? 'New entry' : 'Entry') + '</span>' +
        '<span class="pf-date">' + esc(isNew ? today : fmtDate(p.created || Date.now())) + '</span>' +
        '<button class="pf-x" data-close aria-label="Close">&times;</button></div>' +
      '<input id="f-name" class="pf-name" autocomplete="off" spellcheck="false" placeholder="Their name" value="' + esc(p.name) + '" aria-label="Name">' +
      '<div class="pf-lines">' +
        line('profession', 'Role', 'what they do') +
        line('company', 'Company', 'where') +
        line('email', 'Email', 'name@example.com', 'email') +
        line('location', 'Location', 'city') +
        line('school', 'Schools', 'Rutgers BS, Wharton MBA', 'text',
          schoolsOf(p).map(function (x) { return x.name + (x.level ? ' ' + x.level : ''); }).join(', ')) +
      '</div>' +
      '<div class="pf-sec"><span class="pf-lbl">Circles</span>' +
        '<div class="pf-chips" id="pf-chips"></div>' +
      '</div>' +
      '<div class="pf-sec"><span class="pf-lbl">Note</span>' +
        '<textarea id="f-note" rows="2" placeholder="how you met, what to remember"></textarea></div>' +
    '</div>';
  var m = modal(isNew ? 'New person' : 'Edit ' + p.name, '', body,
    '<span class="pf-key">↵ to ' + (isNew ? 'file' : 'save') + ' · esc to close</span>' +
    '<button class="pf-cancel" data-close>Cancel</button>' +
    '<button class="pf-go" id="f-save">' + (isNew ? 'File them' : 'Save') + '</button>');
  m.classList.add('pform');
  var nameBox = m.querySelector('#f-name');
  nameBox.focus();

  var chips = m.querySelector('#pf-chips');
  function paintChips() {
    chips.innerHTML = known.map(function (c) {
      var at = chosen.indexOf(c);
      return '<button type="button" class="pf-chip" data-c="' + esc(c) + '"' + (at >= 0 ? ' data-on' : '') +
        ' style="--hue:var(--h' + hueIndex(c) + ')">' +
        '<i></i>' + esc(c) + (at === 0 ? '<b>primary</b>' : '') + '</button>';
    }).join('') +
    '<input class="pf-newc" placeholder="+ new circle" aria-label="New circle" spellcheck="false">';
  }
  paintChips();
  chips.addEventListener('click', function (e) {
    var b = e.target.closest('.pf-chip');
    if (!b) return;
    var c = b.dataset.c, at = chosen.indexOf(c);
    if (at >= 0) chosen.splice(at, 1); else chosen.push(c);
    paintChips();
    var again = chips.querySelector('.pf-chip[data-c="' + (window.CSS && CSS.escape ? CSS.escape(c) : c) + '"]');
    if (again) { again.focus(); if (at < 0) again.classList.add('pop'); }
  });
  chips.addEventListener('keydown', function (e) {
    var inp = e.target.closest('.pf-newc');
    if (!inp || e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    var c = clean(inp.value);
    if (!c) return;
    var hit = known.filter(function (k) { return k.toLowerCase() === c.toLowerCase(); })[0];
    if (!hit) { known.push(c); hit = c; }
    if (chosen.indexOf(hit) < 0) chosen.push(hit);
    paintChips();
    chips.querySelector('.pf-newc').focus();
  });

  m.querySelector('#f-save').addEventListener('click', function () {
    var g = function (k) { return m.querySelector('#f-' + k).value.trim(); };
    if (!g('name')) {
      nameBox.classList.remove('want'); void nameBox.offsetWidth; nameBox.classList.add('want');
      nameBox.focus(); return;
    }
    ['name', 'email', 'profession', 'company', 'location'].forEach(function (k) { p[k] = g(k); });
    p.schools = [];
    g('school').split(',').map(clean).filter(Boolean).forEach(function (bit) {
      var level = degreeIn(bit);
      var nm = bit.replace(DEGREE_STRIP, ' ');
      addSchool(p.schools, titleCase(clean(nm) || bit), level);
    });
    // a circle typed but not yet entered still counts
    var pending = clean((m.querySelector('.pf-newc') || {}).value || '');
    if (pending && chosen.indexOf(pending) < 0) chosen.push(pending);
    p.circles = chosen.slice();
    if (g('note')) p.notes.unshift({ id: uid(), t: g('note'), at: Date.now() });
    if (isNew) state.people.push(p);
    circlesOf(p).forEach(circleIndex);
    touch(p); save(); closeModal(); renderAll();
    if (opts.done) opts.done(p);
    else if (byId[p.id]) openDossier(byId[p.id]);
    toast(isNew ? p.name + ' added' : 'Saved');
  });
  m.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.pf-newc, .pf-chip, [data-close]')) {
      e.preventDefault(); m.querySelector('#f-save').click();
    }
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
  ['email', 'Email'], ['phone', 'Phone (kept as a note)'], ['profession', 'Profession'],
  ['company', 'Company'], ['school', 'School'], ['location', 'Location'],
  ['circle', 'Circle'], ['met', 'Date you met (logs a touchpoint)'], ['link', 'Link'],
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
  ['notes', /^(notes?|comments?|details|misc|description|remarks)$/i],
  ['met', /^(connected ?on|met|met ?on|date ?met|first ?met|since)$/i],
  ['link', /^(url|link|linkedin|profile|profile ?url|website)$/i]
];

/* ---- other people's exports ----
   A phone's contacts (.vcf) and LinkedIn's Connections.csv are turned into
   the same rows a spreadsheet gives, so they go through the same review. */

/* LinkedIn's export opens with a few lines of notes before the real header. */
function stripPreamble(text) {
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < Math.min(lines.length, 12); i++) {
    if (/first name/i.test(lines[i]) && /last name/i.test(lines[i])) {
      return { text: lines.slice(i).join('\n'), linkedin: /connected on/i.test(lines[i]) || /linkedin/i.test(lines.slice(0, i).join(' ')) };
    }
  }
  return { text: text, linkedin: false };
}

function vcardRows(text) {
  // folded lines start with a space; quoted-printable values (old phones)
  // end a line in = and carry on, but only those: a photo's base64 can end
  // in = too, and must not swallow the line after it
  text = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  var joined = [], lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (/QUOTED-PRINTABLE/i.test(ln.split(':')[0])) {
      while (/=$/.test(ln) && i + 1 < lines.length) ln = ln.slice(0, -1) + lines[++i];
    }
    joined.push(ln);
  }
  text = joined.join('\n');
  var headers = ['Name', 'Email', 'Phone', 'Company', 'Title', 'Location', 'URL', 'Birthday', 'Notes'];
  var rows = [];
  text.split(/BEGIN:VCARD/i).slice(1).forEach(function (card) {
    var got = {};
    card.split('\n').forEach(function (line) {
      var c = line.indexOf(':');
      if (c < 0) return;
      var head = line.slice(0, c), val = line.slice(c + 1).trim();
      var prop = head.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      if (/QUOTED-PRINTABLE/i.test(head)) {
        try { val = decodeURIComponent(val.replace(/=([0-9A-F]{2})/gi, '%$1')); } catch (e) { }
      }
      var unesc = function (v) { return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); };
      var parts = val.split(/(?<!\\);/).map(unesc);
      if (!(prop in got)) got[prop] = parts;            // the first of each is the one kept
    });
    var name = (got.FN && got.FN.join(' ')) ||
      (got.N ? [got.N[3], got.N[1], got.N[2], got.N[0], got.N[4]].filter(Boolean).join(' ') : '');
    if (!clean(name)) return;
    var adr = got.ADR || [];
    var bday = got.BDAY ? got.BDAY[0].replace(/^--/, '') : '';
    rows.push([name, got.EMAIL ? got.EMAIL[0] : '', got.TEL ? got.TEL[0] : '',
      got.ORG ? got.ORG[0] : '', got.TITLE ? got.TITLE.join(' ') : '',
      [adr[3], adr[4]].filter(Boolean).join(', ') || adr[6] || '',
      got.URL ? got.URL.join(';') : '', bday, got.NOTE ? got.NOTE.join('; ') : '']);
  });
  return { headers: headers, rows: rows };
}

/* "15 Mar 2024", "2024-03-15", "3/15/2024": midday that day, or null. */
function parseDay(v) {
  v = clean(v);
  var m, MON = 'janfebmaraprmayjunjulaugsepoctnovdec';
  if ((m = v.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/)) && MON.indexOf(m[2].toLowerCase()) >= 0) {
    return new Date(+m[3], MON.indexOf(m[2].toLowerCase()) / 3, +m[1], 12).getTime();
  }
  if ((m = v.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)) && MON.indexOf(m[1].toLowerCase()) >= 0) {
    return new Date(+m[3], MON.indexOf(m[1].toLowerCase()) / 3, +m[2], 12).getTime();
  }
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  if ((m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    var y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[1] - 1, +m[2], 12).getTime();
  }
  return null;
}

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
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></svg>' +
      '<p><b>Drop a file here</b> or <label class="pick" for="im-file">choose one</label>' +
      '<input type="file" id="im-file" accept=".csv,.tsv,.txt,.vcf,text/csv,text/tab-separated-values,text/vcard,text/x-vcard" hidden></p>' +
      '<p class="fine">A spreadsheet (CSV or TSV), your phone\u2019s contacts (.vcf), or LinkedIn\u2019s Connections.csv. ' +
        'Nothing is uploaded: it is read here in the browser.</p>' +
    '</div>' +
    '<details id="im-paste-wrap"><summary>or paste the rows instead</summary>' +
      '<textarea id="io-in" placeholder="name,email,profession,notes"></textarea></details>' +
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

    text = text.replace(/^\uFEFF/, '');
    if (/^BEGIN:VCARD/im.test(text)) {
      var vc = vcardRows(text);
      if (!vc.rows.length) { say('bad', 'No contacts with names in that file.'); go.disabled = true; return; }
      parsed = { headers: vc.headers, rows: vc.rows, hasHeader: true, source: 'contacts' };
      parsed.mapping = guessMapping(vc.headers, vc.rows, true);
      // a phone number on everyone is clutter; it can be switched back on
      parsed.mapping[vc.headers.indexOf('Phone')] = 'skip';
      drawMapping(label || 'your contacts', vc.rows.length);
      return;
    }
    var pre = stripPreamble(text);
    var rows = splitRows(pre.text);
    if (!rows.length) { say('bad', 'Nothing readable in there.'); go.disabled = true; return; }
    var hasHeader = looksLikeHeader(rows);
    var headers = hasHeader ? rows[0].map(function (h) { return clean(h) || 'Column'; })
                            : rows[0].map(function (_, i) { return 'Column ' + (i + 1); });
    var data = hasHeader ? rows.slice(1) : rows;
    if (!data.length) { say('bad', 'Found headers but no people under them.'); go.disabled = true; return; }
    parsed = { headers: headers, rows: data, hasHeader: hasHeader, source: pre.linkedin ? 'linkedin' : '' };
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
        (parsed.source === 'linkedin' ? ' \u00b7 read as a LinkedIn export' : parsed.source === 'contacts' ? ' \u00b7 read as a contacts file' : '') +
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
    pick.value = parsed.source ? 'one' : hasCircleCol ? 'column' : hasCompany ? 'company' : hasSchool ? 'school' : 'one';
    if (!hasCircleCol) pick.querySelector('option[value="column"]').disabled = true;
    if (!hasCompany) pick.querySelector('option[value="company"]').disabled = true;
    if (!hasSchool) pick.querySelector('option[value="school"]').disabled = true;
    var syncName = function () { nameBox.hidden = pick.value !== 'one'; };
    pick.addEventListener('change', syncName); syncName();
    if (!nameBox.value) nameBox.value = parsed.source === 'linkedin' ? 'LinkedIn' : 'Contacts';

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
      var rec = { notes: [], custom: {} };
      mp.forEach(function (field, i) {
        // a note is a sentence: it keeps its full stop, unlike a name or a place
        var v = field === 'notes' ? String(r[i] || '').replace(/\s+/g, ' ').trim() : clean(r[i]);
        if (!v || field === 'skip') return;
        if (field === 'custom') rec.custom[parsed.headers[i].toLowerCase()] = v;
        else if (field === 'notes') rec.notes.push(parsed.headers[i] && !/^notes?$/i.test(parsed.headers[i])
          ? parsed.headers[i] + ': ' + v : v);
        else rec[field] = v;
      });

      var name = rec.name || clean([rec.firstName, rec.lastName].filter(Boolean).join(' '));
      if (!name) { skipped++; return; }

      var p = findPerson(name) || (rec.email ? state.people.filter(function (x) {
        return x.email && x.email.toLowerCase() === rec.email.toLowerCase();
      })[0] : null);
      if (!p) { p = blankPerson(name); state.people.push(p); added++; } else merged++;
      p.name = name;

      ['email', 'profession', 'company', 'location'].forEach(function (k) {
        if (rec[k]) p[k] = rec[k];
      });
      // there is no phone field; a number in the sheet is kept as a note
      if (rec.phone && !p.notes.some(function (n) { return n.t && n.t.indexOf(rec.phone) >= 0; })) {
        p.notes.unshift({ id: uid(), t: 'Phone: ' + rec.phone, at: Date.now() });
      }
      if (rec.school) rec.school.split(/[,;|/]/).map(clean).filter(Boolean)
        .forEach(function (nm) { addSchool(p.schools, titleCase(nm), ''); });
      Object.keys(rec.custom).forEach(function (k) { p.custom[k] = rec.custom[k]; });
      if (rec.link) p.custom[/linkedin\.com/i.test(rec.link) ? 'linkedin' : 'link'] = rec.link;
      // when you met becomes a touchpoint on that day, once
      var metAt = rec.met ? parseDay(rec.met) : null;
      if (metAt && !p.log.some(function (e) { return e.channel === 'met' && Math.abs(e.at - metAt) < 864e5; })) {
        p.log.push({ id: uid(), at: metAt, channel: 'met',
          text: parsed.source === 'linkedin' ? 'Connected on LinkedIn.' : 'Met.', learned: '' });
        p.log.sort(function (a, b) { return b.at - a.at; });
      }
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
  var cols = ['name', 'email', 'profession', 'company', 'schools', 'location', 'circles', 'lastTouch', 'touchpoints', 'notes'];
  var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var lines = [cols.join(',')];
  state.people.forEach(function (p) {
    var notes = p.notes.map(function (n) { return n.t; })
      .concat(p.log.map(function (e) { return fmtDate(e.at) + ' ' + e.channel + ': ' + e.text + (e.learned ? ' — ' + e.learned : ''); }))
      .join(' | ');
    var extra = Object.keys(p.custom || {}).map(function (k) { return k + ': ' + p.custom[k]; });
    var sch = schoolsOf(p).map(function (x) { return x.name + (x.level ? ' (' + x.level + ')' : ''); }).join(' / ');
    lines.push([p.name, p.email, p.profession, p.company, sch, p.location, circlesOf(p).join(' / '),
      p.log.length ? new Date(lastTouch(p)).toISOString().slice(0, 10) : '',
      p.log.length, extra.concat(notes ? [notes] : []).join(' | ')].map(q).join(','));
  });
  return lines.join('\n');
}

/* Hands the browser a real file. The published-artifact sandbox blocks a page
   from starting its own download, so that path asks the viewer's runtime
   instead; copying to the clipboard stays as the last resort. */
function saveFile(filename, text, mime) {
  try {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
    return true;
  } catch (e) { return false; }
}

function stamp() { return new Date().toISOString().slice(0, 10); }

function exportModal() {
  var body = '<div class="io">' +
    '<p style="margin:0 0 9px;font-size:13px;color:var(--muted);line-height:1.55">' +
    'The spreadsheet view of everything, history folded into the notes column. ' +
    'Switch to the backup if you want to move the whole map, history and all, to another browser.</p>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button class="btn" id="x-csv" data-on="1">Spreadsheet (CSV)</button>' +
      '<button class="btn" id="x-json">Backup (JSON)</button></div>' +
    '<textarea id="x-out" readonly aria-label="Exported data"></textarea></div>';
  var m = modal('Export', state.people.length + ' people', body,
    '<button class="btn primary" id="x-save">Download</button>' +
    '<button class="btn" id="x-copy">Copy instead</button>' +
    '<button class="btn" data-close>Done</button>');

  var out = m.querySelector('#x-out'), mode = 'csv';
  function filename() { return 'rootwork-' + stamp() + (mode === 'csv' ? '.csv' : '.json'); }
  function render() {
    out.value = mode === 'csv' ? toCSV() : JSON.stringify(state, null, 2);
    m.querySelector('#x-csv').style.borderColor = mode === 'csv' ? 'var(--accent)' : '';
    m.querySelector('#x-json').style.borderColor = mode === 'json' ? 'var(--accent)' : '';
    m.querySelector('#x-save').textContent = 'Download ' + (mode === 'csv' ? '.csv' : '.json');
  }
  m.querySelector('#x-csv').onclick = function () { mode = 'csv'; render(); };
  m.querySelector('#x-json').onclick = function () { mode = 'json'; render(); };

  m.querySelector('#x-save').onclick = function () {
    var name = filename();
    var mime = mode === 'csv' ? 'text/csv' : 'application/json';

    // inside a published artifact the page cannot start a download itself
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('downloads').then(function (dl) {
        if (dl) {
          dl.save({ filename: name, data: out.value })
            .then(function () { toast('Saved ' + name); }, function () { });
        } else if (saveFile(name, out.value, mime)) toast('Downloaded ' + name);
        else toast('Could not start the download — use Copy instead');
      }, function () { saveFile(name, out.value, mime); });
      return;
    }
    if (saveFile(name, out.value, mime)) toast('Downloaded ' + name);
    else toast('Could not start the download — use Copy instead');
  };

  m.querySelector('#x-copy').onclick = function () {
    out.focus();
    out.select();
    out.setSelectionRange(0, out.value.length);        // iOS needs the range set
    var done = function () { toast('Copied — ' + out.value.split('\n').length + ' lines'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(out.value).then(done, function () {
        toast(document.execCommand('copy') ? 'Copied' : 'Select the text and copy it by hand');
      });
    } else {
      toast(document.execCommand('copy') ? 'Copied' : 'Select the text and copy it by hand');
    }
  };
  render();
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


function membersOf(name) {
  return state.people.filter(function (p) { return inCircle(p, name); });
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* Returns a plan — {summary, detail, run} — or null if this is not a
   structural instruction at all. */

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

/* ---- search ---- */

var search = $('#search'), results = $('#results');
function runSearch() {
  var terms = queryTerms(search.value);
  searchHits = {};
  needsDraw = true;
  if (!terms.length) { searchTerm = ''; results.innerHTML = ''; return; }
  var hits = [];
  state.people.forEach(function (p) {
    var h = searchHit(p, terms);
    if (h) { hits.push({ p: p, h: h }); searchHits[p.id] = true; }
  });
  searchTerm = terms.join(' ');
  hits.sort(function (a, b) { return b.h.score - a.h.score || a.p.name.localeCompare(b.p.name); });
  results.innerHTML = hits.slice(0, 12).map(function (x) {
    var p = x.p, w = x.h.where;
    return '<button data-goto="' + p.id + '"><span class="swatch" style="background:var(--h' + circleIndex(primaryCircle(p)) + ')"></span>' +
      '<span class="rname">' + esc(p.name) + '</span>' +
      '<span class="rmeta">' + (w ? '<i>' + esc(w.label) + '</i> ' + snippet(w.text, terms, 34)
        : esc(p.company || p.profession || primaryCircle(p))) + '</span></button>';
  }).join('') || '<div class="empty" style="padding:8px 10px;font-size:12px;color:var(--faint)">Nobody matches that.</div>';
}

/* A short window of text around the first word that matched, with every
   matched word marked. Escaped here, so it is safe to drop into markup. */
function snippet(text, terms, room) {
  text = String(text || '');
  var folded = Array.prototype.map.call(text, function (c) { return fold(c)[0] || c; }).join('');
  var at = -1;
  terms.forEach(function (t) { var i = folded.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; });
  room = room || 60;
  var from = Math.max(0, at - Math.floor(room / 3)), to = Math.min(text.length, from + room);
  if (at < 0) { from = 0; to = Math.min(text.length, room); }
  var out = '', i = from;
  while (i < to) {
    var len = 0;
    terms.forEach(function (t) { if (folded.substr(i, t.length) === t && t.length > len) len = t.length; });
    if (len) { out += '<mark>' + esc(text.substr(i, len)) + '</mark>'; i += len; }
    else { out += esc(text[i]); i++; }
  }
  return (from > 0 ? '\u2026' : '') + out + (to < text.length ? '\u2026' : '');
}
search.addEventListener('input', runSearch);
search.addEventListener('focus', runSearch);
search.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { search.value = ''; results.innerHTML = ''; search.blur(); }
  if (e.key === 'Enter') { var b = results.querySelector('[data-goto]'); if (b) b.click(); }
});
document.addEventListener('click', function (e) {
  if (e.target.closest('#archive')) return;          // the archive answers for itself
  if (!e.target.closest('.searchwrap')) results.innerHTML = '';
  var g = e.target.closest('[data-goto]');
  if (g) { goTo(g.dataset.goto); results.innerHTML = ''; }
  var cc = e.target.closest('[data-color]');
  if (cc) { colorPicker(cc, cc.dataset.color); return; }
  var c = e.target.closest('.legend-list [data-circle]');
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
    kick();
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
    kick();
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
  // nothing stays where it was dropped: the layout takes it back
  if (dragging) { dragging.fx = dragging.fy = null; kick(); }
  dragging = null; panning = null;
  canvas.style.cursor = n ? 'pointer' : 'grab';
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
    mk({ name: 'Dana Okafor', circle: 'Work', profession: 'Data scientist', company: 'Merck', schools: [{ name: 'Rutgers', level: 'BS' }],
      email: 'dana.okafor@example.com', location: 'Rahway, NJ',
      howMet: 'met at the Rutgers alumni mixer' },
      [[4, 'zoom', 'Zoom about the forecasting pilot — she wants a two-week trial.', 'Runs the internal AI guild, 200 people'],
       [38, 'coffee', 'Coffee downtown before the panel.'],
       [96, 'met', 'Met at the Rutgers alumni mixer.']]),
    mk({ name: 'Marcus Bell', circle: 'Work', profession: 'Engineering manager', company: 'Vanta', schools: [{ name: 'Penn State', level: 'BS' }],
      email: 'marcus@example.com', location: 'Brooklyn, NY' },
      [[11, 'call', 'Called about the staff role on his team.', 'Hiring two backend engineers in Q1'],
       [60, 'event', 'Sat next to him at the Philly infra meetup.']]),
    mk({ name: 'Priya Raman', circle: 'Work', profession: 'Product designer', company: 'Figma',
      email: 'priya@example.com' },
      [[130, 'coffee', 'Coffee at Monkey + Elf. Talked through the onboarding redesign.', 'Moving to Lisbon in the spring']]),
    mk({ name: 'Tomás Ferreira', circles: ['School', 'Work'], schools: [{ name: 'Penn State', level: 'BS' }, { name: 'Villanova', level: 'JD' }], profession: 'Attorney', company: 'Reed Smith',
      email: 'tomas@example.com' },
      [[22, 'meal', 'Dinner downtown with the Penn State crowd.', 'Just made partner'],
       [210, 'call', 'Called for advice on the LLC paperwork.']]),
    mk({ name: 'Hannah Koenig', circle: 'School', schools: [{ name: 'Penn State', level: 'BS' }], profession: 'Pastry chef', company: 'Bread & Salt',
      email: 'hannah@example.com', location: 'Jersey City, NJ' },
      [[6, 'message', 'Texted about the croissant lamination class.', 'Teaching a Saturday workshop in March']]),
    mk({ name: 'Owen Reilly', circle: 'School', schools: [{ name: 'Penn State', level: 'BS' }], profession: 'High school teacher' },
      [[168, 'event', 'Ran into him at homecoming.']]),
    mk({ name: 'Ada Whitfield', circles: ['Industry', 'Neighbors'], profession: 'Roaster', company: 'Deep Roots Coffee',
      email: 'ada@example.com', location: 'Philadelphia, PA',
      howMet: 'intro through Marcus Bell' },
      [[2, 'coffee', 'Cupping session at her roastery — she walked me through the Ethiopia lots.', 'Has spare capacity on the Loring in Q2'],
       [30, 'email', 'Emailed about wholesale pricing.']]),
    mk({ name: 'Jonah Pike', circle: 'Industry', profession: 'Bakery consultant', email: 'jonah@example.com' },
      [[74, 'zoom', 'Zoom on build-out costs for the Third Street space.', 'Says hood venting is the long pole, budget 40k']]),
    mk({ name: 'Sofia Marchetti', circle: 'Industry', profession: 'Green coffee buyer', company: 'Cafe Imports',
      email: 'sofia@example.com' },
      [[300, 'event', 'Met at Coffee Fest in Baltimore.']]),
    mk({ name: 'Grace Lin', circle: 'Family', profession: 'Nurse practitioner', location: 'Lancaster, PA' },
      [[9, 'call', 'Sunday call.', 'Starting the DNP program in the fall']]),
    mk({ name: 'Robert Lin', circle: 'Family', profession: 'Retired machinist', location: 'Lancaster, PA' },
      [[9, 'meal', 'Sunday dinner.']]),
    mk({ name: 'Nadia Haddad', circle: 'Neighbors', profession: 'Architect', company: 'Spillman Farmer',
      email: 'nadia@example.com', location: 'Philadelphia, PA' },
      [[16, 'met', 'Ran into her on Broad Street — she offered to look at the floor plan.', 'Did the tenant fit-out on the riverfront cafe']]),
    mk({ name: 'Eli Brandt', circle: 'Neighbors', profession: 'Contractor' },
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

/* ---- typefaces ----
   The whole look turns on these three faces, so they are a setting rather
   than a decision baked into the stylesheet: a pairing sets the display face
   for names, the typed face for anything the archive filed, and the working
   face for the chrome. Chosen live, remembered, and the canvas re-reads its
   tokens so labels change with everything else. */

/* Pairings, not fonts: a display face with real character, a typed face for
   anything filed, and a clean body face underneath. Each carries its own
   weights, because a face that needs 500 to hold a colour band is not the
   same face that wants 400 at 68px. */
var FONTS = [
  { id: 'archive',  name: 'Archive',     note: 'didone + typewriter',
    display: 'Bodoni Moda', typed: 'Courier Prime', ui: 'Satoshi', dw: 400, db: 500, bw: 400 },
  { id: 'plate',    name: 'Plate',       note: 'where this started',
    display: 'Instrument Serif', typed: 'JetBrains Mono', ui: 'Manrope', dw: 400, db: 400, bw: 400 },
  { id: 'lora',     name: 'Lora',        note: 'bookish + clean',
    display: 'Lora', typed: 'IBM Plex Mono', ui: 'Satoshi', dw: 500, db: 600, bw: 400 },
  { id: 'garamond', name: 'Garamond',    note: 'old style, quiet',
    display: 'EB Garamond', typed: 'Courier Prime', ui: 'Manrope', dw: 500, db: 600, bw: 400 },
  { id: 'editorial',name: 'Editorial',   note: 'magazine serif',
    display: 'Playfair Display', typed: 'IBM Plex Mono', ui: 'Urbanist', dw: 400, db: 600, bw: 400 },
  { id: 'fraunces', name: 'Fraunces',    note: 'warm and odd',
    display: 'Fraunces', typed: 'Courier Prime', ui: 'Urbanist', dw: 400, db: 600, bw: 400 },
  { id: 'cormorant',name: 'Cormorant',   note: 'high fashion',
    display: 'Cormorant Garamond', typed: 'Courier Prime', ui: 'Jost', dw: 500, db: 600, bw: 400 },
  { id: 'syne',     name: 'Syne',        note: 'gallery poster',
    display: 'Syne', typed: 'Space Mono', ui: 'Satoshi', dw: 600, db: 700, bw: 400 },
  { id: 'space',    name: 'Space',       note: 'grotesk throughout',
    display: 'Space Grotesk', typed: 'Space Mono', ui: 'Manrope', dw: 500, db: 600, bw: 400 },
  { id: 'terminal', name: 'Terminal',    note: 'mono head, clean body',
    display: 'JetBrains Mono', typed: 'JetBrains Mono', ui: 'Satoshi', dw: 500, db: 600, bw: 400 },
  { id: 'baskerville', name: 'Baskerville', note: 'printed page',
    display: 'Libre Baskerville', typed: 'IBM Plex Mono', ui: 'Manrope', dw: 400, db: 700, bw: 400 },
  { id: 'swiss',    name: 'Swiss',       note: 'neutral and tight',
    display: 'Urbanist', typed: 'IBM Plex Mono', ui: 'Urbanist', dw: 600, db: 700, bw: 400 }
];

/* Satoshi is not on Google Fonts; it comes from Fontshare. */
var FONTSHARE = { Satoshi: 'satoshi' };

var FONT_KEY = 'rootwork.type';
var fontsLoaded = false;

/* Every family in one request, asked for once, the first time the picker
   opens — so each row can be previewed in its own face. */
function loadAllFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  var google = {}, share = {};
  FONTS.forEach(function (f) {
    [f.display, f.typed, f.ui].forEach(function (n) {
      if (FONTSHARE[n]) share[n] = 1; else google[n] = 1;
    });
  });
  var names = Object.keys(google);
  if (names.length) {
    var q = names.map(function (n) {
      return 'family=' + n.replace(/ /g, '+') + ':ital,wght@0,400;0,500;0,600;0,700;1,400';
    }).join('&');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + q + '&display=swap';
    document.head.appendChild(link);
  }
  var fs = Object.keys(share);
  if (fs.length) {
    var l2 = document.createElement('link');
    l2.rel = 'stylesheet';
    l2.href = 'https://api.fontshare.com/v2/css?' +
      fs.map(function (n) { return 'f[]=' + FONTSHARE[n] + '@400,500,700'; }).join('&') + '&display=swap';
    document.head.appendChild(l2);
  }
}

function fontById(id) {
  return FONTS.filter(function (f) { return f.id === id; })[0] || FONTS[0];
}

function applyFont(id, remember) {
  var f = fontById(id);
  loadAllFonts();                                   // whatever is chosen has to exist
  var r = document.documentElement.style;
  r.setProperty('--display', '"' + f.display + '", Georgia, serif');
  r.setProperty('--typed', '"' + f.typed + '", "Courier New", ui-monospace, monospace');
  r.setProperty('--ui', '"' + f.ui + '", system-ui, -apple-system, sans-serif');
  r.setProperty('--mono', '"' + f.typed + '", ui-monospace, monospace');
  r.setProperty('--wd', String(f.dw));              // big display type
  r.setProperty('--wd-b', String(f.db));            // display type that must hold its own
  r.setProperty('--wb', String(f.bw));              // body
  document.documentElement.setAttribute('data-type', f.id);
  if (remember !== false) { try { localStorage.setItem(FONT_KEY, f.id); } catch (e) { } }
  // the canvas paints its own labels, so it has to be told
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { readTokens(); needsDraw = true; });
  }
  setTimeout(function () { readTokens(); needsDraw = true; }, 60);
}

function currentFont() {
  var id = 'archive';
  try { id = localStorage.getItem(FONT_KEY) || id; } catch (e) { }
  return fontById(id).id;
}

function typePicker(anchorEl) {
  loadAllFonts();
  var old = document.getElementById('cpick');
  if (old) old.remove();
  var now = currentFont();
  var box = document.createElement('div');
  box.id = 'cpick';
  box.className = 'cpick types';
  box.innerHTML = '<div class="ptitle">Typeface</div>' +
    FONTS.map(function (f) {
      return '<button data-font="' + f.id + '"' + (f.id === now ? ' data-on="1"' : '') + '>' +
        '<span class="tname" style="font-family:\'' + f.display + '\', Georgia, serif">' + esc(f.name) + '</span>' +
        '<span class="tnote" style="font-family:\'' + f.typed + '\', monospace">' + esc(f.note) + '</span>' +
      '</button>';
    }).join('');
  document.body.appendChild(box);

  var r = anchorEl.getBoundingClientRect();
  box.style.left = Math.min(window.innerWidth - box.offsetWidth - 10, Math.max(10, r.right - box.offsetWidth)) + 'px';
  box.style.top = Math.min(window.innerHeight - box.offsetHeight - 10, r.bottom + 6) + 'px';

  var was = now;
  box.addEventListener('pointerover', function (e) {     // try it on by hovering
    var b = e.target.closest('[data-font]');
    if (b) applyFont(b.dataset.font, false);
  });
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-font]');
    if (!b) return;
    was = b.dataset.font;
    applyFont(was, true);
    box.querySelectorAll('[data-font]').forEach(function (x) {
      x.toggleAttribute('data-on', x.dataset.font === was);
    });
    toast('Type: ' + fontById(was).name);
  });
  setTimeout(function () {
    document.addEventListener('pointerdown', function off(e) {
      if (box.contains(e.target)) return;
      applyFont(was, true);                                // put back whatever was chosen
      box.remove();
      document.removeEventListener('pointerdown', off);
    });
  }, 0);
}

/* ---- wiring ---- */

$('#btn-add').addEventListener('click', function () { personForm(null); });
$('#btn-type').addEventListener('click', function (e) { typePicker(e.currentTarget); });
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
$('#btn-fit').addEventListener('click', fit);
$('#btn-tidy').addEventListener('click', function () {
  tidyMap();
  toast('Untangled');
});

document.addEventListener('keydown', function (e) {
  if (document.body.classList.contains('archived')) return;   // the archive has the keyboard
  if (e.key === 'Escape') {
    if (!$('#scrim').hidden) return closeModal();
    if (selected) return closeDossier();
  }
  var el = document.activeElement;
  var typing = /^(INPUT|TEXTAREA)$/.test(el.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault(); undo(); return;
  }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  if (e.key === 'f') fit();
  if (e.key === 't') tidyMap();
  var numbered = LAYOUTS[parseInt(e.key, 10) - 1];
  if (numbered && /^[1-9]$/.test(e.key)) setLayout(numbered.id);
  if (e.key === 'n') { e.preventDefault(); personForm(null); }
});

document.addEventListener('focusout', function () {
  setTimeout(function () {
    if (!pendingRemote || isEditing()) return;
    var next = pendingRemote;
    pendingRemote = null;
    // The held copy is older than whatever was just typed, so fold the two
    // together rather than letting the server's version win by arriving last.
    if (window.RootworkSync && window.RootworkSync.merge) {
      try { next = window.RootworkSync.merge(state, next); } catch (e) { }
    }
    window.Rootwork.setState(next);
  }, 80);
});

window.addEventListener('resize', resize);

/* ---- the surface sync.js drives ---- */

window.Rootwork = {
  getState: function () { return state; },
  busy: isEditing,
  setState: function (next) {
    // hold anything arriving from another device until the field is finished
    if (isEditing()) { pendingRemote = next; return false; }
    applyingRemote = true;
    var keepSelected = selected && selected.ref ? selected.ref.id : null;
    state = Object.assign(DEFAULTS(), next);
    sweepIdCircles();
    state.people.forEach(normalizePerson);
    state.people.forEach(function (p) { circlesOf(p).forEach(circleIndex); });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    renderAll();
    if (keepSelected && byId[keepSelected]) openDossier(byId[keepSelected]);
    syncSampleBtn();
    applyingRemote = false;
    return true;
  },
  modal: modal, closeModal: closeModal, toast: toast,
  // what the archive view needs to read the same map the canvas draws
  lib: {
    esc: esc, ago: ago, fmtDate: fmtDate,
    circleList: circleList, circleIndex: hueIndex, circlesOf: circlesOf,
    knownCircle: function (name) {
      return !!name && !looksLikeId(name) &&
        (state.circles || []).some(function (c) { return c.toLowerCase() === String(name).toLowerCase(); });
    },
    hasPerson: function (id) { return state.people.some(function (p) { return p.id === id; }); },
    primaryCircle: primaryCircle, inCircle: inCircle,
    lastTouch: lastTouch, schoolsOf: schoolsOf, tiesOf: tiesOf,
    degrees: DEGREES, addSchool: addSchool,
    queryTerms: queryTerms, searchHit: searchHit, snippet: snippet,
    newPerson: function (circle, done) { personForm(null, { circle: circle, done: done }); },
    // "Wharton mba" -> { name: 'Wharton', level: 'MBA' }, the card's own reading
    parseSchool: function (val) {
      val = clean(val || '');
      return { name: titleCase(clean(val.replace(DEGREE_STRIP, ' ')) || val), level: degreeIn(val) };
    },
    channelLabel: function (c) { return CHANNEL_LABEL[c] || c; },
    closeCard: function () { closeDossier(); },
    cardOpen: function () { return !!selected; },
    openCard: function (id) {
      var n = byId[id];
      if (!n) return;
      selected = n;
      openDossier(n);
      // only chase the camera when the map is the surface being looked at
      if (!document.body.classList.contains('archived')) glide(n.x + 90, n.y, Math.max(cam.k, 0.9));
    },
    save: function () { save(); renderAll(); }
  },
  loadSample: toggleSample,                     // exposed for tests, not the interface
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
  applyFont(currentFont(), false);
  load();

  readTokens();
  resize();
  renderLayouts();
  rebuild();
  renderStats(); renderLegend(); renderPad();

  for (var i = 0; i < 90; i++) tick();     // land on the targets before framing
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
  // the map wakes when the archive goes: catch up on anything that changed
  // while it slept, then start the loop again
  new MutationObserver(function () {
    if (document.body.classList.contains('archived') || raf) return;
    if (mapStale) renderMap();
    needsDraw = true;
    loop();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  if (window.RootworkSync) window.RootworkSync.attach(window.Rootwork);

  // installable app, when served over http(s); harmless anywhere else
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
})();

})();
