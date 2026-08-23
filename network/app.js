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

var state = { me: { name: 'Me' }, people: [], circles: [], tombstones: {}, meUpdated: 0, demo: false, seq: 1 };
var DEFAULTS = function () { return { me: { name: 'Me' }, people: [], circles: [], tombstones: {}, meUpdated: 0, demo: false, seq: 1 }; };
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

function normalizePerson(p) {
  p.tags = p.tags || [];
  p.notes = p.notes || [];
  p.log = p.log || [];
  p.circle = p.circle || 'Unsorted';
  p.created = p.created || Date.now();
  return p;
}

function blankPerson(name) {
  return normalizePerson({
    id: uid(), name: name || '', email: '', phone: '', profession: '', company: '',
    school: '', location: '', circle: 'Unsorted', tags: [], howMet: '',
    followUp: null, notes: [], log: [], created: Date.now()
  });
}

function lastTouch(p) {
  var t = p.created || 0;
  p.log.forEach(function (e) { if (e.at > t) t = e.at; });
  return t;
}
function daysSince(t) { return Math.floor((Date.now() - t) / DAY); }
function isCold(p) { return p.log.length > 0 && daysSince(lastTouch(p)) > COLD_DAYS; }
function nudgeDue(p) {
  if (p.followUp && p.followUp.date && p.followUp.date <= Date.now() + DAY) return true;
  return isCold(p);
}

function circleList() {
  var seen = {}, out = [];
  state.people.forEach(function (p) {
    var c = p.circle || 'Unsorted';
    if (!seen[c]) { seen[c] = { name: c, n: 0 }; out.push(seen[c]); }
    seen[c].n++;
  });
  out.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  return out;
}

/* Colors are assigned by first appearance and remembered, so a circle keeps
   its pigment even as the map grows. */
function circleIndex(name) {
  var i = state.circles.indexOf(name);
  if (i < 0) { state.circles.push(name); i = state.circles.length - 1; }
  return (i % 8) + 1;
}

var hidden = {};   // circle name -> true when filtered out

/* ---------------------------------------------------------------- parse -- */

var CHANNELS = [
  ['zoom', /\b(zoom|video ?call|google meet|meet call|teams call|facetime|hangout)\b/i],
  ['call', /\b(call(?:ed)?|phone|rang|spoke (?:with|to)|voicemail)\b/i],
  ['coffee', /\b(coffee|tea|drinks?|beer|breakfast)\b/i],
  ['meal', /\b(lunch|dinner|brunch|supper)\b/i],
  ['event', /\b(conference|meetup|panel|summit|wedding|party|networking|mixer|workshop|class)\b/i],
  ['email', /\b(emailed|email(?:ed)? (?:with|from|to)|sent (?:her|him|them) an email|replied)\b/i],
  ['message', /\b(texted|dm(?:ed|d)?|slack(?:ed)?|whatsapp|linkedin message|messaged)\b/i],
  ['intro', /\b(introduced|intro(?:'d| to)|connected me|referred)\b/i],
  ['met', /\b(met|ran into|bumped into|sat next to|caught up)\b/i]
];

var STOPNAMES = /^(I|We|My|The|A|An|He|She|They|Her|His|Their|Today|Yesterday|Just|Had|Met|Talked|Spoke|Zoom|Call|Coffee|Lunch|Dinner|Email|Last|This|Next|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/;

var NAME = "[A-Z][A-Za-z'’\\-]+(?:\\s+(?:van|von|de|del|della|da|di|la|le|bin|al)\\s+[A-Z][A-Za-z'’\\-]+|\\s+[A-Z][A-Za-z'’\\-]+){0,2}";

function clean(s) {
  return (s || '').replace(/\s+/g, ' ')
    .replace(/^[\s,;:—–-]+|[\s,;:.—–-]+$/g, '').trim();
}

function titleish(s) {
  s = clean(s);
  return s.replace(/^(the|a|an)\s+/i, '');
}

function relativeDate(text) {
  var now = new Date(); now.setHours(12, 0, 0, 0);
  var m;
  if (/\byesterday\b/i.test(text)) return now.getTime() - DAY;
  if (/\bthis morning|today|just now|tonight\b/i.test(text)) return now.getTime();
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
  var n = name.toLowerCase();
  var exact = state.people.filter(function (p) { return p.name.toLowerCase() === n; });
  if (exact.length) return exact[0];
  var first = state.people.filter(function (p) {
    return p.name.toLowerCase().split(' ')[0] === n.split(' ')[0];
  });
  if (first.length === 1 && name.split(' ').length === 1) return first[0];
  var starts = state.people.filter(function (p) { return p.name.toLowerCase().indexOf(n) === 0; });
  return starts.length === 1 ? starts[0] : null;
}

/* Turns a sentence into a draft: which person, which fields, what happened. */
function parse(raw) {
  var text = clean(raw);
  var out = { name: '', person: null, patch: {}, tags: [], entry: null, followUp: null };
  var work = ' ' + text + ' ';
  var m;

  // explicit "key: value" always wins
  var KEYMAP = {
    email: 'email', mail: 'email', phone: 'phone', cell: 'phone', mobile: 'phone',
    school: 'school', college: 'school', university: 'school', role: 'profession',
    title: 'profession', job: 'profession', profession: 'profession', work: 'company',
    company: 'company', employer: 'company', city: 'location', location: 'location',
    circle: 'circle', group: 'circle', met: 'howMet', via: 'howMet', name: 'name'
  };
  work = work.replace(/\b(\w+)\s*:\s*([^,;\n]+)/g, function (all, k, v) {
    var f = KEYMAP[k.toLowerCase()];
    if (!f) return all;
    out.patch[f] = clean(v);
    return ' ';
  });

  // tags
  work = work.replace(/#([\w’'-]+)/g, function (all, t) { out.tags.push(t); return ' '; });

  // contacts
  if ((m = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(work))) { out.patch.email = out.patch.email || m[0]; work = work.replace(m[0], ' '); }
  if ((m = /(\+?\d[\d\-.() ]{8,}\d)/.exec(work))) {
    var digits = m[1].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) { out.patch.phone = out.patch.phone || clean(m[1]); work = work.replace(m[1], ' '); }
  }

  // who
  var nm = /\b(?:with|w\/|to|from|met|saw|called|emailed|texted|about)\s+(NAME)/.source.replace('NAME', NAME);
  if ((m = new RegExp(nm).exec(work)) && !STOPNAMES.test(m[1].split(' ')[0])) out.name = m[1];
  if (!out.name && (m = new RegExp('^\\s*(' + NAME + ')').exec(work)) && !STOPNAMES.test(m[1].split(' ')[0])) out.name = m[1];
  if (!out.name) {
    var all = work.match(new RegExp(NAME, 'g')) || [];
    for (var i = 0; i < all.length; i++) {
      if (!STOPNAMES.test(all[i].split(' ')[0])) { out.name = all[i]; break; }
    }
  }
  if (out.patch.name) { out.name = out.patch.name; delete out.patch.name; }
  out.name = clean(out.name);
  out.person = findPerson(out.name);

  var body = out.name ? work.replace(out.name, ' ') : work;

  // school
  if (!out.patch.school) {
    if ((m = /\b(?:went to|studied at|graduated from|graduated|attended|was at|alum(?:na|nus)? of|did (?:her|his|their) (?:mba|ph\.?d|masters|undergrad|degree) at)\s+([A-Z][^,;.—\n]*)/.exec(body))) {
      out.patch.school = titleish(m[1]);
    } else if ((m = /\b([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3})\s+(?:grad|alum|alumna|alumnus|undergrad)\b/.exec(body))) {
      out.patch.school = titleish(m[1]);
    }
  }
  if (out.patch.school) body = body.replace(out.patch.school, ' ');

  // profession + company
  if (!out.patch.profession && (m = /\b(?:is|was|works)?\s*(?:a|an)\s+([a-z][\w\/&.’' -]{2,40}?)\s+(?:at|for|with)\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,2})/.exec(body))) {
    out.patch.profession = titleish(m[1]);
    out.patch.company = out.patch.company || titleish(m[2]);
  }
  if (!out.patch.profession && (m = /\b(?:is|was|she's|he's|they're|works as)\s+(?:a|an|the)\s+([a-z][\w\/&.’' -]{2,40})/.exec(body))) {
    out.patch.profession = titleish(m[1]);
  }
  if (!out.patch.company && (m = /\b(?:works? (?:at|for)|is at|joined|now at|over at|runs|founded|leads)\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,2})/.exec(body))) {
    out.patch.company = titleish(m[1]);
  }

  // where they live
  if (!out.patch.location && (m = /\b(?:lives in|based in|moved to|is in|located in|out of)\s+([A-Z][\w.'’-]*(?:[\s,]+[A-Z][\w.'’-]*){0,2})/.exec(body))) {
    out.patch.location = titleish(m[1]);
  }

  // how we met
  if (!out.patch.howMet && (m = /\b(?:introduced by|intro(?:'d| to)? (?:by|through)|met (?:at|through|via)|referred by|connected (?:by|through))\s+([^,;.\n]{2,50})/i.exec(body))) {
    out.patch.howMet = clean(m[0]);
  }

  // what I learned
  if ((m = /\b(?:learned|found out|turns out|apparently|note that|she (?:said|mentioned)|he (?:said|mentioned)|they (?:said|mentioned)|told me)\s+(?:that\s+)?(.{4,})/i.exec(work))) {
    out.learned = clean(m[1].split(/\.\s+|;\s+|\s+\|\s+/)[0]).slice(0, 180);
  }

  // channel + date
  var channel = '';
  for (var c = 0; c < CHANNELS.length; c++) { if (CHANNELS[c][1].test(text)) { channel = CHANNELS[c][0]; break; } }
  out.entry = { channel: channel || 'note', at: relativeDate(text), text: text, learned: out.learned || '' };

  // follow-up
  var fu = futureDate(text);
  if (fu) out.followUp = { date: fu, what: '' };

  // circle
  if (!out.patch.circle) {
    var known = circleList().map(function (x) { return x.name.toLowerCase(); });
    for (var t = 0; t < out.tags.length; t++) {
      if (known.indexOf(out.tags[t].toLowerCase()) >= 0) { out.patch.circle = out.tags[t]; break; }
    }
  }
  if (!out.patch.circle && !out.person) {
    if (out.patch.company) out.patch.circle = 'Work';
    else if (out.patch.school) out.patch.circle = 'School';
  }
  if (out.patch.circle) {
    out.patch.circle = out.patch.circle.charAt(0).toUpperCase() + out.patch.circle.slice(1);
  }

  Object.keys(out.patch).forEach(function (k) { if (!out.patch[k]) delete out.patch[k]; });
  return out;
}

/* Applies a confirmed draft. Returns the person it landed on. */
function commit(draft) {
  var p = draft.person;
  if (!p) { p = blankPerson(draft.name || 'Unnamed'); state.people.push(p); }
  Object.keys(draft.patch).forEach(function (k) {
    if (k === 'circle' && p.circle && p.circle !== 'Unsorted' && !draft.circleForced) return;
    p[k] = draft.patch[k];
  });
  (draft.tags || []).forEach(function (t) { if (p.tags.indexOf(t) < 0) p.tags.push(t); });
  if (draft.entry && draft.entry.text) {
    p.log.unshift({ id: uid(), at: draft.entry.at, channel: draft.entry.channel, text: draft.entry.text, learned: draft.entry.learned || '' });
  }
  if (draft.followUp) p.followUp = draft.followUp;
  circleIndex(p.circle || 'Unsorted');
  p.updated = Date.now();
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

  var visible = state.people.filter(function (p) { return !hidden[p.circle || 'Unsorted']; });

  var me = mk('me', 'me', state.me.name || 'Me', null, 0);
  me.x = 0; me.y = 0;

  var circles = [];
  visible.forEach(function (p) {
    var c = p.circle || 'Unsorted';
    if (circles.indexOf(c) < 0) circles.push(c);
  });
  circles.sort(function (a, b) { return circleIndex(a) - circleIndex(b); });

  circles.forEach(function (c, i) {
    var node = mk('c:' + c, 'circle', c, c, circleIndex(c));
    node.angle = (i / circles.length) * Math.PI * 2 - Math.PI / 2;
    if (!prev[node.id]) {
      node.x = Math.cos(node.angle) * 200;
      node.y = Math.sin(node.angle) * 200;
    }
    links.push({ a: me, b: node, len: 190, k: 0.02 });
  });

  visible.forEach(function (p) {
    var c = p.circle || 'Unsorted';
    var parent = byId['c:' + c] || me;
    var n = mk(p.id, 'person', p.name, p, circleIndex(c));
    n.parent = parent;
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
      var tx = Math.cos(a.angle) * 200, ty = Math.sin(a.angle) * 200;
      a.vx += (tx - a.x) * 0.012 * alpha;
      a.vy += (ty - a.y) * 0.012 * alpha;
    } else if (a.kind === 'person' && a.parent) { // drift outward from the trunk
      var pa = Math.atan2(a.parent.y, a.parent.x);
      a.vx += Math.cos(pa) * 0.28 * alpha;
      a.vy += Math.sin(pa) * 0.28 * alpha;
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
var hover = null, selected = null, dragging = null, panning = null, moved = false;
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

function hueOf(n) { return C.hues[n.ci] || C.accent; }

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
    if (focus.kind === 'me') nodes.forEach(function (n) { lit[n.id] = 1; });
  }

  links.forEach(function (L) {
    var dim = focus && !(lit[L.a.id] && lit[L.b.id]) ? DIM : 1;
    var trunk = L.b.kind === 'circle';
    var fade = (L.b.cold ? 0.5 : 1) * dim * (trunk ? 0.5 : 1);
    branch(L.a, L.b, trunk ? 7 : 5, trunk ? 2.8 : 1.1, hueOf(L.b), fade);
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
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = mix(C.ground, 1); ctx.fill();
      ctx.lineWidth = 1.8 / cam.k; ctx.strokeStyle = mix(col, 0.85 * dim); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = mix(col, (n.cold ? 0.14 : 0.92) * dim);
      ctx.fill();
      if (n.cold) {
        ctx.lineWidth = 1.3 / cam.k;
        ctx.strokeStyle = mix(col, 0.7 * dim); ctx.stroke();
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
    if (p[0] < -80 || p[0] > W + 80 || p[1] < -40 || p[1] > H + 40) return;
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
    var box = [p[0] - w / 2, y - 2, w, h];
    var forced = n === focus || n === selected || n.kind === 'me';
    if (!forced && placed.some(function (q) {
      return box[0] < q[0] + q[2] && box[0] + box[2] > q[0] && box[1] < q[1] + q[3] && box[1] + box[3] > q[1];
    })) return;
    placed.push(box);

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
function toast(msg) {
  var t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
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
  var list = circleList();
  $('#legend-count').textContent = list.length || '';
  $('#legend').innerHTML = list.map(function (c) {
    var col = 'var(--h' + circleIndex(c.name) + ')';
    return '<button data-circle="' + esc(c.name) + '" data-off="' + (hidden[c.name] ? 1 : 0) + '">' +
      '<span class="swatch" style="background:' + col + '"></span>' +
      '<span>' + esc(c.name) + '</span><span class="n">' + c.n + '</span></button>';
  }).join('') || '<div class="empty">No circles yet.</div>';
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

function openDossier(node) {
  var p = node && node.ref;
  if (!p || node.kind !== 'person') return;
  selected = node;
  var d = $('#dossier');
  var col = 'var(--h' + circleIndex(p.circle) + ')';
  var lt = lastTouch(p);

  function row(k, v, href) {
    if (!v) return '<dt>' + k + '</dt><dd class="empty">—</dd>';
    var val = href ? '<a href="' + href + esc(v) + '">' + esc(v) + '</a>' : esc(v);
    return '<dt>' + k + '</dt><dd>' + val + '</dd>';
  }

  d.innerHTML =
    '<div class="d-top">' +
      '<button class="d-close" id="d-close" aria-label="Close">&times;</button>' +
      '<div class="d-kicker"><span class="swatch" style="background:' + col + '"></span>' +
        esc(p.circle) + ' · ' + p.log.length + ' touchpoint' + (p.log.length === 1 ? '' : 's') +
        ' · last ' + (p.log.length ? ago(lt) : 'never') + '</div>' +
      '<h2 class="d-name">' + esc(p.name) + '</h2>' +
      '<div class="d-sub">' + esc([p.profession, p.company].filter(Boolean).join(' · ') || 'No role recorded') + '</div>' +
    '</div>' +
    '<div class="d-body">' +
      '<div class="d-sec"><h4>Card</h4><dl class="fields">' +
        row('Email', p.email, 'mailto:') + row('Phone', p.phone, 'tel:') +
        row('Profession', p.profession) + row('Company', p.company) +
        row('School', p.school) + row('Location', p.location) +
        row('Met via', p.howMet) +
        (p.followUp && p.followUp.date ? '<dt>Follow up</dt><dd>' + fmtDate(p.followUp.date) +
          (p.followUp.what ? ' — ' + esc(p.followUp.what) : '') + '</dd>' : '') +
      '</dl>' +
      (p.tags.length ? '<div class="tagrow" style="margin-top:9px">' + p.tags.map(function (t) {
        return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
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

      (p.notes.length ? '<div class="d-sec"><h4>Notes</h4><div class="notes-list">' +
        p.notes.map(function (n) {
          return '<div class="note"><button class="del" data-delnote="' + n.id + '">&times;</button>' + esc(n.t) + '</div>';
        }).join('') + '</div></div>' : '') +

      '<div class="d-actions">' +
        '<button class="btn" data-log="' + p.id + '">Log a touchpoint</button>' +
        '<button class="btn" data-edit="' + p.id + '">Edit fields</button>' +
        '<button class="btn" data-del="' + p.id + '" style="margin-left:auto">Delete</button>' +
      '</div>' +
    '</div>';

  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  needsDraw = true;
}

function closeDossier() {
  selected = null;
  var d = $('#dossier');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  needsDraw = true;
}

$('#dossier').addEventListener('click', function (e) {
  var t = e.target.closest('button');
  if (!t) return;
  var p = selected && selected.ref;
  if (t.id === 'd-close') return closeDossier();
  if (t.dataset.edit) return personForm(p);
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
    f('name', 'Name') + f('circle', 'Circle') +
    f('email', 'Email', 'email') + f('phone', 'Phone', 'tel') +
    f('profession', 'Profession') + f('company', 'Company') +
    f('school', 'School') + f('location', 'Location') +
    '<div class="field wide"><label for="f-howMet">How we met</label><input id="f-howMet" value="' + esc(p.howMet) + '"></div>' +
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
    ['name', 'email', 'phone', 'profession', 'company', 'school', 'location', 'howMet'].forEach(function (k) { p[k] = g(k); });
    p.circle = g('circle') || 'Unsorted';
    p.tags = g('tags').split(',').map(function (t) { return t.trim().replace(/^#/, ''); }).filter(Boolean);
    if (g('note')) p.notes.unshift({ id: uid(), t: g('note'), at: Date.now() });
    if (isNew) state.people.push(p);
    circleIndex(p.circle);
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

var COLMAP = [
  ['name', /^(name|full ?name|person|contact)$/i],
  ['phone', /^(phone|phone ?number|mobile|cell|tel)$/i],
  ['email', /^(e-?mail|email ?address)$/i],
  ['profession', /^(profession|role|title|job|occupation|position)$/i],
  ['company', /^(company|employer|org|organization|firm|works? at)$/i],
  ['school', /^(school|college|university|alma ?mater|education)$/i],
  ['location', /^(location|city|where|based|address)$/i],
  ['circle', /^(circle|group|category|bucket|type|relationship)$/i],
  ['tags', /^(tags|labels)$/i],
  ['howMet', /^(how ?we ?met|met|source|via|intro)$/i],
  ['notes', /^(notes?|comments?|details|misc)$/i]
];

function importModal() {
  var body = '<div class="io">' +
    '<p style="margin:0 0 9px;font-size:13px;color:var(--muted);line-height:1.55">' +
    'Paste your spreadsheet — headers in the first row, copied straight out of Sheets or Excel. ' +
    'Name, phone, email, profession and notes are recognized automatically, along with company, school, location and circle if you have them. ' +
    'A Rootwork JSON backup works here too.</p>' +
    '<textarea id="io-in" placeholder="name,phone,email,profession,notes&#10;Dana Okafor,555-0142,dana@…,Data scientist,Met at the Rutgers mixer"></textarea>' +
    '<div class="status" id="io-status" style="margin-top:8px">&nbsp;</div></div>';
  var m = modal('Import', 'Nothing leaves this browser.', body,
    '<button class="btn primary" id="io-go">Import</button>' +
    '<button class="btn" data-close>Cancel</button>' +
    '<span class="note">Existing people with the same name are updated, not duplicated.</span>');

  var ta = m.querySelector('#io-in'), st = m.querySelector('#io-status');
  function preview() {
    var v = ta.value.trim();
    if (!v) { st.className = 'status'; st.innerHTML = '&nbsp;'; return; }
    if (v[0] === '{') {
      try {
        var d = JSON.parse(v);
        st.className = 'status ok';
        st.textContent = 'Backup with ' + (d.people || []).length + ' people — importing replaces the current map.';
      } catch (e) { st.className = 'status bad'; st.textContent = 'That JSON will not parse.'; }
      return;
    }
    var rows = splitRows(v);
    if (rows.length < 2) { st.className = 'status bad'; st.textContent = 'Needs a header row and at least one person.'; return; }
    var map = mapCols(rows[0]);
    var named = map.indexOf('name') >= 0;
    st.className = 'status ' + (named ? 'ok' : 'bad');
    st.textContent = named
      ? (rows.length - 1) + ' people · reading ' + map.filter(Boolean).join(', ')
      : 'No “name” column found — rename a column to name and try again.';
  }
  function mapCols(header) {
    return header.map(function (h) {
      h = h.trim();
      for (var i = 0; i < COLMAP.length; i++) if (COLMAP[i][1].test(h)) return COLMAP[i][0];
      return '';
    });
  }
  ta.addEventListener('input', preview);

  m.querySelector('#io-go').addEventListener('click', function () {
    var v = ta.value.trim();
    if (!v) return;
    if (v[0] === '{') {
      try {
        var d = JSON.parse(v);
        if (!Array.isArray(d.people)) throw 0;
        state = Object.assign(DEFAULTS(), d);
        state.people.forEach(normalizePerson);
        save(); closeModal(); renderAll(); fit();
        toast('Restored ' + state.people.length + ' people');
      } catch (e) { st.className = 'status bad'; st.textContent = 'That backup could not be read.'; }
      return;
    }
    var rows = splitRows(v), map = mapCols(rows[0]);
    if (map.indexOf('name') < 0) return;
    var added = 0, merged = 0;
    rows.slice(1).forEach(function (r) {
      var rec = {};
      map.forEach(function (k, i) { if (k) rec[k] = (r[i] || '').trim(); });
      if (!rec.name) return;
      var p = findPerson(rec.name);
      if (!p) { p = blankPerson(rec.name); state.people.push(p); added++; } else merged++;
      ['email', 'phone', 'profession', 'company', 'school', 'location', 'howMet'].forEach(function (k) {
        if (rec[k]) p[k] = rec[k];
      });
      if (rec.circle) p.circle = rec.circle;
      if (rec.tags) p.tags = rec.tags.split(/[,;]/).map(function (t) { return t.trim().replace(/^#/, ''); }).filter(Boolean);
      if (rec.notes) p.notes.unshift({ id: uid(), t: rec.notes, at: Date.now() });
      circleIndex(p.circle); touch(p);
    });
    state.demo = false;
    save(); closeModal(); renderAll(); fit();
    toast(added + ' added' + (merged ? ', ' + merged + ' updated' : ''));
  });
}

function toCSV() {
  var cols = ['name', 'phone', 'email', 'profession', 'company', 'school', 'location', 'circle', 'tags', 'howMet', 'lastTouch', 'touchpoints', 'notes'];
  var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var lines = [cols.join(',')];
  state.people.forEach(function (p) {
    var notes = p.notes.map(function (n) { return n.t; })
      .concat(p.log.map(function (e) { return fmtDate(e.at) + ' ' + e.channel + ': ' + e.text + (e.learned ? ' — ' + e.learned : ''); }))
      .join(' | ');
    lines.push([p.name, p.phone, p.email, p.profession, p.company, p.school, p.location, p.circle,
      p.tags.join(' '), p.howMet, p.log.length ? new Date(lastTouch(p)).toISOString().slice(0, 10) : '',
      p.log.length, notes].map(q).join(','));
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
      '<p>Emails and phone numbers on sight · <em>went to / studied at / Rutgers grad</em> → school · <em>is a X at Y</em> → profession and company · <em>lives in</em> → location · <em>learned / turns out / she said</em> → the takeaway · <em>follow up in two weeks</em> → a nudge · <em>#tag</em> → tags · <em>zoom, coffee, lunch, called, texted, conference</em> → how you talked · <em>yesterday, last Tuesday, on 3/14</em> → when.</p></section>' +
    '<section><h5>When it guesses wrong</h5>' +
      '<p>Click any chip in the preview to fix it, or the × to drop it. Force a field outright with a colon:</p>' +
      '<div class="ex">school: Lehigh · circle: Family · role: Pastry chef</div></section>' +
    '<section><h5>The map</h5>' +
      '<p>You are the centre. Circles branch off you; people branch off circles. A dot grows with every touchpoint logged, and fades to an outline once ninety days pass without contact — those are the ones in “Going cold”. Drag a person to pin them where you like, double-click to let go. Scroll to zoom, drag the plate to pan.</p></section>' +
    '<section><h5>Commands</h5>' +
      '<div class="ex">/me Ben Fisher   — name the centre\n/import          — paste your spreadsheet\n/export          — copy it all back out\n/sample          — load or clear the sample map\n/help            — this</div></section>' +
    '<section><h5>On your phone</h5>' +
      '<p>Open the app’s address in Safari or Chrome and use <em>Add to Home Screen</em> — it installs with its own icon and opens fullscreen, working with no signal.</p></section>' +
    '<section><h5>Where the data lives</h5>' +
      '<p>In this browser by default — no account, no server. Turn on <em>Sync</em> in the top bar and it also goes to a database you own, encrypted here with a passphrase only you hold, so the same map opens on every device you pair. Either way, keep a JSON backup from Export if it matters.</p></section>' +
    '</div>';
  modal('How to talk to it', 'Rootwork', body, '<button class="btn primary" data-close>Got it</button>');
}

/* ---- chat + preview ---- */

var draft = null;
var FIELD_LABEL = {
  email: 'email', phone: 'phone', profession: 'role', company: 'company', school: 'school',
  location: 'lives in', circle: 'circle', howMet: 'met via', name: 'name'
};

function renderPreview() {
  var slot = $('#preview-slot');
  if (!draft) { slot.innerHTML = ''; return; }
  var chips = Object.keys(draft.patch).map(function (k) {
    return '<span class="chip' + (draft.person && draft.person[k] !== draft.patch[k] ? ' new' : '') + '">' +
      '<span class="k">' + (FIELD_LABEL[k] || k) + '</span>' +
      '<span class="v" data-editk="' + k + '" tabindex="0" role="button">' + esc(draft.patch[k]) + '</span>' +
      '<button data-dropk="' + k + '" aria-label="Drop ' + k + '">&times;</button></span>';
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
    '<div class="head"><span>' + (draft.person ? 'updating' : 'new person') + '</span>' +
      '<span class="who" data-editname tabindex="0" role="button">' + esc(draft.name || 'Unnamed') + '</span>' +
      '<span class="tag">' + (draft.person ? draft.person.log.length + ' prior touchpoints' : 'sprouting from ' + esc(draft.patch.circle || 'Unsorted')) + '</span></div>' +
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
  if (!draft) return;
  var t = e.target;
  if (t.closest('[data-confirm]')) return confirmDraft();
  if (t.closest('[data-discard]')) { draft = null; renderPreview(); return; }
  if (t.dataset.dropk) { delete draft.patch[t.dataset.dropk]; renderPreview(); return; }
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
  if (!v) { if (draft) confirmDraft(); return; }

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
    toast('Unknown command. /help lists them.');
    return;
  }

  draft = parse(v);
  chat.value = ''; autosize();
  renderPreview();
  if (!draft.name) toast('Could not find a name — click “Unnamed” to set it.');
});

chat.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatform').requestSubmit(); }
  if (e.key === 'Escape' && draft) { draft = null; renderPreview(); }
});

/* ---- search ---- */

var search = $('#search'), results = $('#results');
function runSearch() {
  var q = search.value.trim().toLowerCase();
  if (!q) { results.innerHTML = ''; return; }
  var hits = state.people.filter(function (p) {
    return [p.name, p.profession, p.company, p.school, p.location, p.circle, p.email, p.tags.join(' '),
      p.notes.map(function (n) { return n.t; }).join(' '),
      p.log.map(function (e) { return e.text + ' ' + e.learned; }).join(' ')]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }).slice(0, 12);
  results.innerHTML = hits.map(function (p) {
    return '<button data-goto="' + p.id + '"><span class="swatch" style="background:var(--h' + circleIndex(p.circle) + ')"></span>' +
      '<span class="rname">' + esc(p.name) + '</span>' +
      '<span class="rmeta">' + esc(p.company || p.profession || p.circle) + '</span></button>';
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
    moved = true; kick();
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
  if (!moved) {
    if (n && n.kind === 'person') openDossier(n);
    else if (n && n.kind === 'circle') { hover = n; needsDraw = true; }
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
    p.log = (logs || []).map(function (l) {
      return { id: uid(), at: d - l[0] * DAY, channel: l[1], text: l[2], learned: l[3] || '' };
    });
    p.created = d - 400 * DAY;
    circleIndex(p.circle);
    return p;
  };
  return [
    mk({ name: 'Dana Okafor', circle: 'Work', profession: 'Data scientist', company: 'Merck', school: 'Rutgers',
      email: 'dana.okafor@example.com', phone: '(908) 555-0142', location: 'Rahway, NJ', tags: ['ai'],
      howMet: 'met at the Rutgers alumni mixer' },
      [[4, 'zoom', 'Zoom about the forecasting pilot — she wants a two-week trial.', 'Runs the internal AI guild, 200 people'],
       [38, 'coffee', 'Coffee downtown before the panel.'],
       [96, 'met', 'Met at the Rutgers alumni mixer.']]),
    mk({ name: 'Marcus Bell', circle: 'Work', profession: 'Engineering manager', company: 'Vanta', school: 'Lehigh',
      email: 'marcus@example.com', location: 'Brooklyn, NY', tags: ['hiring'] },
      [[11, 'call', 'Called about the staff role on his team.', 'Hiring two backend engineers in Q1'],
       [60, 'event', 'Sat next to him at the Philly infra meetup.']]),
    mk({ name: 'Priya Raman', circle: 'Work', profession: 'Product designer', company: 'Figma',
      email: 'priya@example.com', tags: ['design'] },
      [[130, 'coffee', 'Coffee at Monkey + Elf. Talked through the onboarding redesign.', 'Moving to Lisbon in the spring']]),
    mk({ name: 'Tomás Ferreira', circle: 'School', school: 'Lehigh', profession: 'Attorney', company: 'Reed Smith',
      email: 'tomas@example.com', phone: '(610) 555-0119' },
      [[22, 'meal', 'Dinner at Bolete with the Lehigh crowd.', 'Just made partner'],
       [210, 'call', 'Called for advice on the LLC paperwork.']]),
    mk({ name: 'Hannah Koenig', circle: 'School', school: 'Lehigh', profession: 'Pastry chef', company: 'Bread & Salt',
      email: 'hannah@example.com', location: 'Jersey City, NJ' },
      [[6, 'message', 'Texted about the croissant lamination class.', 'Teaching a Saturday workshop in March']]),
    mk({ name: 'Owen Reilly', circle: 'School', school: 'Lehigh', profession: 'High school teacher' },
      [[168, 'event', 'Ran into him at homecoming.']]),
    mk({ name: 'Ada Whitfield', circle: 'Industry', profession: 'Roaster', company: 'Deep Roots Coffee',
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

function syncSampleBtn() {
  var b = $('#btn-sample');
  if (b) b.textContent = state.demo ? 'Clear sample' : 'Load sample';
  if (b) b.hidden = false;
}

/* ---- wiring ---- */

$('#btn-add').addEventListener('click', function () { personForm(null); });
$('#btn-import').addEventListener('click', importModal);
$('#btn-export').addEventListener('click', exportModal);
$('#btn-help').addEventListener('click', helpModal);
$('#btn-fit').addEventListener('click', fit);

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (!$('#scrim').hidden) return closeModal();
    if (draft) { draft = null; return renderPreview(); }
    if (selected) return closeDossier();
  }
  var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); chat.focus(); }
  if (e.key === 'f') fit();
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
    state.people.forEach(function (p) { circleIndex(p.circle || 'Unsorted'); });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    renderAll();
    if (keepSelected && byId[keepSelected]) openDossier(byId[keepSelected]);
    syncSampleBtn();
    applyingRemote = false;
  },
  modal: modal, closeModal: closeModal, toast: toast
};

/* ---- go ---- */

(function init() {
  var t = 'auto';
  try { t = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { }
  if (t !== 'auto') document.documentElement.setAttribute('data-theme', t);

  var had = load();
  if (!had) { state.people = sample(); state.demo = true; save(); }

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
  pill.innerHTML = '<span class="dot"></span>Sync off';
  pill.addEventListener('click', function () {
    if (window.RootworkSync) window.RootworkSync.open();
    else toast('Sync is not available in this build');
  });
  $('.tools').insertBefore(pill, $('#btn-add'));

  var hintBtn = document.createElement('button');
  hintBtn.className = 'btn';
  hintBtn.id = 'btn-sample';
  $('.tools').insertBefore(hintBtn, $('#btn-help'));
  hintBtn.addEventListener('click', toggleSample);
  syncSampleBtn();

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
