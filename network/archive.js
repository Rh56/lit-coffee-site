/* ==========================================================================
   Rootwork — the archive.

   Four ways to read the same network, each a surface of its own rather than a
   panel over the map: its own bar, its own address, its own idea of what a
   folder is. Nothing here owns data — every screen reads the state the map
   draws, and each one shows and edits the whole record itself.

     Drawer         cut tabs and colour bands — a filing drawer from above
     Index          everyone at once, set tight, no colour but the pips
     Chroma         no paper at all: each folder a field of its own light
     Desktop        folders, files, a preview pane, a status bar

   Folders are whatever you say they are — circles, companies, schools or
   towns — so the same four read differently depending on how you file.

   Shared chrome, one renderer each. A renderer owns its root element and is
   torn down whole on a switch, so no state leaks between them.
   ========================================================================== */
(function () {
'use strict';

var R = null;                  // window.Rootwork, once app.js has run
var L = null;                  // its helpers
var root = null, scroll = null, head = null, body = null;
var DESIGNS = [
  { id: 'drawer', name: 'Drawer', hint: 'A filing drawer, seen from above' },
  { id: 'index', name: 'Index', hint: 'Everyone at once, set tight' },
  { id: 'chroma', name: 'Chroma', hint: 'Light and type, no paper at all' },
  { id: 'finder', name: 'Desktop', hint: 'Folders and files, the way a computer keeps them' }
];
var view = { design: 'drawer', circle: null, person: null };
var DESIGN_KEY = 'rootwork.archive.design';
var open = false;
var settleTimer = null;
var query = '', qTimer = null;

/* Each design has its own address, so one can be opened cold — bookmarked,
   shared, pinned to a phone's home screen — without going through the map. */
/* A person is marked as one. Without that, #drawer/p34m20 read the id back
   as a folder name — which is how a person's id ended up looking like a new
   circle. */
function routeOf() {
  if (!open) return '';
  var bits = ['#' + view.design];
  if (view.circle) bits.push(encodeURIComponent(view.circle));
  if (view.person) bits.push('~' + encodeURIComponent(view.person));
  return bits.join('/');
}
function writeRoute(replace) {
  var to = routeOf() || (location.pathname + location.search);
  try {
    if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  } catch (e) { }
}
function readRoute() {
  var h = (location.hash || '').replace(/^#/, '');
  if (!h || h === 'map') return null;
  var bits = h.split('/');
  var d = DESIGNS.filter(function (x) { return x.id === bits[0]; })[0];
  if (!d) return null;
  var circle = null, person = null;
  bits.slice(1).forEach(function (bit) {
    if (!bit) return;
    if (bit.charAt(0) === '~') person = decodeURIComponent(bit.slice(1));
    else if (circle === null) circle = decodeURIComponent(bit);
  });
  // an address can be stale or hand-typed: only take what the map still has
  if (circle && L && L.knownCircle && !L.knownCircle(circle)) {
    if (!person && L.hasPerson && L.hasPerson(circle)) person = circle;
    circle = null;
  }
  if (person && L && L.hasPerson && !L.hasPerson(person)) person = null;
  return { design: d.id, circle: circle, person: person };
}

function esc(s) { return L.esc(s); }
function $(sel, within) { return (within || document).querySelector(sel); }
function el(tag, cls, html) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}
function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

/* ---- reading the map ---- */

function st() { return R.getState(); }
function hueVar(circle) { return hueOfGroup(circle); }
/* Search is words plus quick filters. Every word has to match somewhere in
   the person (the map's own matcher, so both agree); every filter on has to
   hold. */
var terms = [];
var DAY = 864e5;
var FILTERS = [
  { id: 'never', name: 'Never logged', test: function (p) { return !(p.log || []).length; } },
  { id: 'quiet', name: 'Quiet 3 months+', test: function (p) {
      return !(p.log || []).length || Date.now() - L.lastTouch(p) > 90 * DAY; } },
  { id: 'recent', name: 'Touched this month', test: function (p) {
      return (p.log || []).length && Date.now() - L.lastTouch(p) < 30 * DAY; } },
  { id: 'notes', name: 'Has notes', test: function (p) { return (p.notes || []).length > 0; } }
];
var filtersOn = {};

function searching() { return !!terms.length || Object.keys(filtersOn).length > 0; }

function matches(p) {
  for (var i = 0; i < FILTERS.length; i++) {
    if (filtersOn[FILTERS[i].id] && !FILTERS[i].test(p)) return false;
  }
  return !terms.length || !!L.searchHit(p, terms);
}

/* What a row shows while searching: the name with the matched words marked,
   and, when the name is not what matched, the line that did. */
function nameHtml(p) { return terms.length ? L.snippet(p.name, terms, 400) : esc(p.name); }
function hitLine(p) {
  if (!terms.length) return '';
  var h = L.searchHit(p, terms);
  if (!h || !h.where) return '';
  return '<span class="hit"><i>' + esc(h.where.label) + '</i> ' + L.snippet(h.where.text, terms, 54) + '</span>';
}

function peopleIn(circle) {
  return st().people.filter(function (p) { return inGroup(p, circle) && matches(p); })
    .sort(function (a, b) { return L.lastTouch(b) - L.lastTouch(a); });
}
/* ---- grouping ----
   Circles are how you filed people, but they are not the only thing a set of
   people has in common: half of them work somewhere, some went to the same
   school, some live in the same town. Any of those can be the folders. */

var GROUPS = [
  { id: 'circle', name: 'Circle', of: function (p) { return L.circlesOf(p); } },
  { id: 'company', name: 'Company', of: function (p) { return p.company ? [p.company] : []; } },
  { id: 'school', name: 'School', of: function (p) {
      return L.schoolsOf(p).map(function (s) { return s.name; }); } },
  { id: 'place', name: 'Place', of: function (p) { return p.location ? [p.location] : []; } }
];
var groupMode = 'circle';
var GROUP_KEY = 'rootwork.archive.group';

function grouper() {
  return GROUPS.filter(function (g) { return g.id === groupMode; })[0] || GROUPS[0];
}
function groupsOf(p) { return grouper().of(p).filter(Boolean); }

/* Colour: circles keep the pigment the map gave them; anything else takes a
   stable one from its own name, so Merck is the same green everywhere. */
function hueOfGroup(name) {
  if (groupMode === 'circle') return 'var(--h' + L.circleIndex(name) + ')';
  var h = 0, s = String(name).toLowerCase();
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return 'var(--h' + ((h % 8) + 1) + ')';
}

function inGroup(p, name) {
  var low = String(name).toLowerCase();
  return groupsOf(p).some(function (c) { return String(c).toLowerCase() === low; });
}

function circles() {
  var seen = {}, out = [];
  st().people.forEach(function (p) {
    if (!matches(p)) return;
    groupsOf(p).forEach(function (c) {
      var k = String(c).toLowerCase();
      if (!seen[k]) { seen[k] = { name: c, n: 0 }; out.push(seen[k]); }
      seen[k].n++;
    });
  });
  if (groupMode === 'circle' && !searching()) {
    // an empty circle is still a folder; an empty company is not a thing
    L.circleList().forEach(function (c) {
      var k = c.name.toLowerCase();
      if (!seen[k]) { seen[k] = { name: c.name, n: 0 }; out.push(seen[k]); }
    });
  }
  out.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  return out;
}

function personById(id) {
  return st().people.filter(function (p) { return p.id === id; })[0] || null;
}
function roleOf(p) {
  return [p.profession, p.company].filter(Boolean).join(' · ');
}
function homeGroup(p) { return groupsOf(p)[0] || L.primaryCircle(p); }

/* ---- editing in place ----
   Every design shows the same record, so every design can change it. A value
   marked data-field turns into an input where it sits; what is typed goes
   back to the person and the map hears about it like any other edit. */

var FIELD_LABELS = {
  name: 'Name', profession: 'Role', company: 'Company', email: 'Email',
  location: 'Location'
};

function editableAttrs(p, field) {
  return ' data-field="' + field + '" data-for="' + p.id + '" tabindex="0" role="button"' +
    ' title="Click to edit ' + esc((FIELD_LABELS[field] || field).toLowerCase()) + '"';
}

function editValue(el) {
  if (el.querySelector('input')) return;
  var p = personById(el.dataset.for);
  if (!p) return;
  var field = el.dataset.field;
  var was = p[field] || '';
  var box = document.createElement('input');
  box.className = 'arc-input';
  box.value = was;
  box.setAttribute('aria-label', FIELD_LABELS[field] || field);
  var held = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(box);
  box.focus();
  box.select();

  var done = false;
  function finish(keep) {
    if (done) return;
    done = true;
    var val = box.value.trim();
    if (!keep || val === was) { el.innerHTML = held; return; }
    p[field] = val;
    commitPerson(p);
    // a name is on every screen; anything else is patched where it shows,
    // so the surface you are working on is not rebuilt under you
    if (field === 'name') return render(true);
    // close this box first: patchField leaves alone anything still holding
    // an input, which would otherwise include the one just finished
    el.innerHTML = val ? esc(val) : '<span class="none">' + DASH + '</span>';
    patchField(p, field, val);
  }
  box.addEventListener('blur', function () { finish(true); });
  box.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

/* Save, and tell the map — but record the new fingerprint first, so the
   change coming back round does not rebuild the screen we are standing on. */
function commitPerson(p) {
  p.updated = Date.now();
  lastSig = signature();
  L.save();
  lastSig = signature();
}

function patchField(p, field, val) {
  var sel = '[data-field="' + field + '"][data-for="' + cssEsc(p.id) + '"]';
  Array.prototype.forEach.call(root.querySelectorAll(sel), function (n) {
    if (n.querySelector('input')) return;
    n.innerHTML = val ? esc(val) : '<span class="none">' + DASH + '</span>';
  });
}

function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s); }
var DASH = '\u2014';

/* ---- the three things a record is made of ----
   Filed under, notes and touchpoints are edited the same way wherever they
   appear, so they are built and handled in one place and dropped into
   whichever surface wants them. */

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function circleChips(p) {
  return '<div class="ed-chips" data-chips="circles" data-for="' + p.id + '">' + circleChipsIn(p) + '</div>';
}
function circlesBlock(p) {
  return '<div class="ed-row"><span class="ed-label">Filed under</span>' + circleChips(p) + '</div>';
}
function circleChipsIn(p) {
  return '' +
      L.circlesOf(p).map(function (c, i) {
        return '<span class="ed-chip circ' + (i === 0 ? ' main' : '') + '" data-ci="' + i + '" style="--hue:' + hueOfGroup(c) + '">' +
          '<span class="ed-lbl" data-act="primary" data-for="' + p.id + '" data-val="' + esc(c) + '" tabindex="0" role="button" title="' +
            (i === 0 ? 'Primary circle. Drag to reorder' : 'Make primary. Drag to reorder') + '">' + esc(c) + '</span>' +
          '<button data-act="uncircle" data-for="' + p.id + '" data-val="' + esc(c) + '" ' +
            'aria-label="Take out of ' + esc(c) + '">' + DASH.replace(DASH, '\u00d7') + '</button></span>';
      }).join('') +
      '<button class="ed-add" data-act="circle" data-for="' + p.id + '">+ circle</button>';
}

function notesBlock(p) {
  var notes = p.notes || [];
  return '<div class="ed-row"><span class="ed-label">Notes</span><div class="ed-list">' +
    notes.map(function (n) {
      return '<div class="ed-item"><span class="ed-text" data-act="note" data-for="' + p.id +
        '" data-id="' + esc(n.id) + '" tabindex="0" role="button">' + esc(n.t) + '</span>' +
        '<button class="ed-x" data-act="delnote" data-for="' + p.id + '" data-id="' + esc(n.id) +
        '" aria-label="Delete note">\u00d7</button></div>';
    }).join('') +
    '<button class="ed-add" data-act="addnote" data-for="' + p.id + '">+ note</button>' +
  '</div></div>';
}

function logBlock(p) {
  var log = p.log || [];
  return '<div class="ed-row"><span class="ed-label">Touchpoints</span><div class="ed-list">' +
    log.map(function (e) {
      return '<div class="ed-item"><span class="ed-when">' + esc(L.channelLabel(e.channel)) +
        ' \u00b7 ' + dateChip(p, e) + '</span>' +
        '<span class="ed-text" data-act="log" data-for="' + p.id + '" data-id="' + esc(e.id) +
        '" tabindex="0" role="button">' + esc(e.text) + '</span>' +
        '<button class="ed-x" data-act="dellog" data-for="' + p.id + '" data-id="' + esc(e.id) +
        '" aria-label="Delete touchpoint">\u00d7</button></div>';
    }).join('') +
    '<button class="ed-add" data-act="addlog" data-for="' + p.id + '">+ touchpoint</button>' +
  '</div></div>';
}

/* Schools are a list with a degree on each: the name edits where it sits, the
   degree is a pick, and "+ school" takes "Wharton MBA" in one go. */
function schoolChips(p) {
  return '<div class="ed-chips" data-chips="schools" data-for="' + p.id + '">' + schoolChipsIn(p) + '</div>';
}
function schoolsBlock(p) {
  return '<div class="ed-row"><span class="ed-label">Schools</span>' + schoolChips(p) + '</div>';
}
function schoolChipsIn(p) {
  return '' +
      L.schoolsOf(p).map(function (s, i) {
        return '<span class="ed-chip school">' +
          '<span class="ed-name" data-act="school" data-for="' + p.id + '" data-idx="' + i + '" tabindex="0" role="button"' +
            ' title="Click to rename">' + esc(s.name) + '</span>' +
          '<button class="ed-deg' + (s.level ? '' : ' none') + '" data-act="degree" data-for="' + p.id + '" data-idx="' + i + '"' +
            ' title="Degree">' + esc(s.level || '+ degree') + '</button>' +
          '<button data-act="unschool" data-for="' + p.id + '" data-idx="' + i + '" ' +
            'aria-label="Remove ' + esc(s.name) + '">×</button></span>';
      }).join('') +
      '<button class="ed-add" data-act="addschool" data-for="' + p.id + '">+ school</button>';
}

/* Circles and schools are edited in the facts themselves; what a surface has
   no room for up top comes below, and only that. */
var BLOCKS = { circles: circlesBlock, schools: schoolsBlock, notes: notesBlock, log: logBlock };

function blocksOf(p, parts) {
  return parts.split(' ').map(function (k) { return BLOCKS[k](p); }).join('');
}

/* A touchpoint's date, which opens a date picker where it sits. */
function dateChip(p, e) {
  return '<span class="ed-date" data-act="logdate" data-for="' + p.id + '" data-id="' + esc(e.id) +
    '" tabindex="0" role="button" title="Change the date">' + esc(L.fmtDate(e.at)) + '</span>';
}

function editDate(el, p, rec) {
  calendar(el, rec.at, function (day) {
    // the day changes; the time of day it was logged at stays
    var was = new Date(rec.at);
    rec.at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), was.getHours(), was.getMinutes()).getTime();
    p.log.sort(function (a, b) { return b.at - a.at; });
    commitPerson(p);
    refreshBlocks(p);
  });
}

/* A month on a card, in the archive's own type: the month set in the
   display face, the days typed. Today is ringed, the chosen day is filled,
   days that have not happened yet are not offered. Arrows walk the days,
   Page Up and Down turn the month, Enter picks, Escape puts it away. */
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function calendar(anchor, at, take) {
  var old = document.getElementById('arc-cal');
  if (old) old.remove();
  var picked = new Date(at); picked.setHours(0, 0, 0, 0);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var focus = new Date(picked);
  var shown = new Date(picked.getFullYear(), picked.getMonth(), 1);
  var box = el('div', 'arc-cal');
  box.id = 'arc-cal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Choose a date');
  document.body.appendChild(box);
  var turn = 0;

  function same(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  function paint() {
    var y = shown.getFullYear(), m = shown.getMonth();
    var start = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var cells = '';
    for (var i = 0; i < start; i++) cells += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var dt = new Date(y, m, d);
      var cls = [same(dt, picked) ? 'picked' : '', same(dt, today) ? 'today' : '', same(dt, focus) ? 'focus' : ''].join(' ');
      cells += '<button data-day="' + d + '" class="' + cls + '"' + (dt > today ? ' disabled' : '') +
        ' tabindex="' + (same(dt, focus) ? 0 : -1) + '" style="--k:' + (start + d) + '">' + d + '</button>';
    }
    var nextOff = new Date(y, m + 1, 1) > today;
    box.innerHTML =
      '<div class="cal-head">' +
        '<button data-step="-1" aria-label="Previous month">‹</button>' +
        '<div class="cal-title' + (turn ? ' turn' : '') + '" style="--turn:' + turn + '"><em>' + MONTHS[m] + '</em> <span>' + y + '</span></div>' +
        '<button data-step="1" aria-label="Next month"' + (nextOff ? ' disabled' : '') + '>›</button>' +
      '</div>' +
      '<div class="cal-week">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="cal-days' + (turn ? ' turn' : '') + '" style="--turn:' + turn + '">' + cells + '</div>' +
      '<div class="cal-foot">' +
        '<button data-quick="0">Today</button><button data-quick="1">Yesterday</button><button data-quick="7">A week ago</button>' +
      '</div>';
    turn = 0;
    var f = box.querySelector('button.focus');
    if (f) f.focus({ preventScroll: true });
  }

  function place() {
    var r = anchor.getBoundingClientRect();
    var w = box.offsetWidth, h = box.offsetHeight;
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 8);
    box.style.left = Math.max(10, Math.min(window.innerWidth - w - 10, r.left - 12)) + 'px';
    box.style.top = top + 'px';
    box.style.transformOrigin = (r.left - parseFloat(box.style.left) + 20) + 'px ' + (top > r.top ? '0' : '100%');
  }

  function month(step) {
    var n = new Date(shown.getFullYear(), shown.getMonth() + step, 1);
    if (n > today) return;
    shown = n; turn = step;
    focus = new Date(n.getFullYear(), n.getMonth(), Math.min(focus.getDate(), new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
    if (focus > today) focus = new Date(today);
    paint();
  }

  function finish(day) {
    done();
    if (day && !same(day, picked)) take(day);
  }
  function done() {
    box.classList.add('out');
    document.removeEventListener('pointerdown', off, true);
    setTimeout(function () { box.remove(); }, reduced() ? 0 : 160);
    if (anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  function off(e) { if (!box.contains(e.target) && e.target !== anchor) done(); }

  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    e.stopPropagation();
    if (b.dataset.step) return month(+b.dataset.step);
    if (b.dataset.day) return finish(new Date(shown.getFullYear(), shown.getMonth(), +b.dataset.day));
    if (b.dataset.quick !== undefined) { var q = new Date(today); q.setDate(q.getDate() - +b.dataset.quick); return finish(q); }
  });
  box.addEventListener('keydown', function (e) {
    e.stopPropagation();
    var move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (move) {
      e.preventDefault();
      var n = new Date(focus); n.setDate(n.getDate() + move);
      if (n > today) return;
      focus = n;
      if (n.getMonth() !== shown.getMonth() || n.getFullYear() !== shown.getFullYear()) {
        turn = n < shown ? -1 : 1;
        shown = new Date(n.getFullYear(), n.getMonth(), 1);
      }
      return paint();
    }
    if (e.key === 'PageUp') { e.preventDefault(); return month(-1); }
    if (e.key === 'PageDown') { e.preventDefault(); return month(1); }
    if (e.key === 'Escape') { e.preventDefault(); return done(); }
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.day) { e.preventDefault(); return finish(new Date(focus)); }
  });

  paint();
  place();
  setTimeout(function () { document.addEventListener('pointerdown', off, true); }, 0);
}

function editorBlocks(p, parts) {
  parts = parts || 'notes log';
  return '<div class="editor" data-blocks="' + p.id + '" data-parts="' + parts + '">' + blocksOf(p, parts) + '</div>';
}

/* Every place a person's record shows, redrawn in place after an edit. */
function refreshBlocks(p) {
  var id = cssEsc(p.id);
  Array.prototype.forEach.call(root.querySelectorAll('[data-blocks="' + id + '"]'), function (host) {
    host.innerHTML = blocksOf(p, host.dataset.parts);
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-chips][data-for="' + id + '"]'), function (host) {
    host.innerHTML = host.dataset.chips === 'schools' ? schoolChipsIn(p) : circleChipsIn(p);
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-sheets="' + id + '"]'), function (host) {
    host.classList.add('quiet');            // the sheets were dealt once already
    host.innerHTML = fileSheets(p, 1);
  });
}

/* A school edit changes the folders themselves when you are filing by school. */
function schoolsChanged(p) {
  commitPerson(p);
  if (groupMode === 'school') return render(true);
  refreshBlocks(p);
}

/* One line of text, edited where it sits. */
function editText(el, current, save) {
  if (el.querySelector('textarea')) return;
  var box = document.createElement('textarea');
  box.className = 'arc-input ed-area';
  box.rows = Math.min(5, Math.max(1, Math.ceil((current || '').length / 46)));
  box.value = current || '';
  var held = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(box);
  box.focus();
  box.select();
  var done = false;
  function finish(keep) {
    if (done) return;
    done = true;
    var val = box.value.trim();
    // leaving a line unchanged is not an edit: nothing saves and nothing is
    // redrawn, so a click that took the focus (onto a date, say) still lands,
    // and a touchpoint just added is not thrown away for being empty yet
    if (!keep || val === (current || '').trim()) { el.innerHTML = held; return; }
    save(val);
  }
  box.addEventListener('blur', function () { finish(true); });
  box.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

/* Everything the three blocks can do, in one place. */
function editorAction(btn) {
  var p = personById(btn.dataset.for);
  if (!p) return false;
  var act = btn.dataset.act;
  var id = btn.dataset.id;

  if (act === 'logdate') {
    var entry = (p.log || []).filter(function (e) { return e.id === id; })[0];
    if (entry) editDate(btn, p, entry);
    return true;
  }

  if (act === 'note' || act === 'log') {
    var rec = act === 'note'
      ? (p.notes || []).filter(function (n) { return n.id === id; })[0]
      : (p.log || []).filter(function (e) { return e.id === id; })[0];
    if (!rec) return true;
    editText(btn, act === 'note' ? rec.t : rec.text, function (val) {
      if (!val) {
        if (act === 'note') p.notes = p.notes.filter(function (n) { return n.id !== id; });
        else p.log = p.log.filter(function (e) { return e.id !== id; });
      } else if (act === 'note') rec.t = val;
      else rec.text = val;
      commitPerson(p);
      refreshBlocks(p);
    });
    return true;
  }

  if (act === 'addnote') {
    p.notes = p.notes || [];
    p.notes.push({ id: newId('n'), t: '' });
    commitPerson(p);
    refreshBlocks(p);
    var last = root.querySelectorAll('[data-act="note"][data-for="' + cssEsc(p.id) + '"]');
    if (last.length) last[last.length - 1].click();
    return true;
  }

  if (act === 'addlog') {
    p.log = p.log || [];
    p.log.unshift({ id: newId('e'), at: Date.now(), channel: 'note', text: '', learned: '' });
    commitPerson(p);
    refreshBlocks(p);
    var first = root.querySelector('[data-act="log"][data-for="' + cssEsc(p.id) + '"]');
    if (first) first.click();
    return true;
  }

  if (act === 'delnote') {
    p.notes = (p.notes || []).filter(function (n) { return n.id !== id; });
    commitPerson(p); refreshBlocks(p);
    return true;
  }

  if (act === 'dellog') {
    p.log = (p.log || []).filter(function (e) { return e.id !== id; });
    commitPerson(p); refreshBlocks(p);
    return true;
  }

  if (act === 'uncircle') {
    var name = btn.dataset.val;
    p.circles = L.circlesOf(p).filter(function (c) { return c !== name; });
    commitPerson(p); refreshBlocks(p);
    return true;
  }

  if (act === 'circle') {
    circleMenu(btn, p);
    return true;
  }

  // the first circle is the primary one: it colours their dot and files them
  if (act === 'primary') {
    if (chipDrag.ended) return true;           // the end of a drag is not a click
    var list = L.circlesOf(p), at = list.indexOf(btn.dataset.val);
    if (at > 0) { moveCircle(p, at, 0); }
    return true;
  }

  if (act === 'school' || act === 'degree' || act === 'unschool') {
    var idx = +btn.dataset.idx;
    var sc = L.schoolsOf(p)[idx];
    if (!sc) return true;
    if (act === 'unschool') { p.schools.splice(idx, 1); schoolsChanged(p); return true; }
    if (act === 'degree') {
      pickMenu(btn, L.degrees.concat(['']), sc.level, function (d) {
        sc.level = d; schoolsChanged(p);
      });
      return true;
    }
    editText(btn, sc.name, function (val) {
      if (!val) p.schools.splice(idx, 1);
      else {
        // "Penn State MBA" typed over a name sets the degree too
        var got = L.parseSchool(val);
        sc.name = got.name;
        if (got.level) sc.level = got.level;
      }
      schoolsChanged(p);
    });
    return true;
  }

  if (act === 'addschool') {
    schoolField(btn, p);
    return true;
  }
  return false;
}

/* "+ school" becomes a field where it sits. Enter files one and leaves the
   field open for the next; an empty Enter, Escape or clicking away closes it. */
function schoolField(btn, p) {
  var box = document.createElement('input');
  box.className = 'arc-input ed-inline';
  box.placeholder = 'Wharton MBA';
  box.setAttribute('aria-label', 'Add a school');
  btn.replaceWith(box);
  box.focus();
  var closed = false;
  function add() {
    var val = box.value.trim();
    if (!val) return false;
    var got = L.parseSchool(val);
    p.schools = p.schools || [];
    L.addSchool(p.schools, got.name, got.level);
    return true;
  }
  function close(keep) {
    if (closed) return;
    closed = true;
    if (keep) add();
    schoolsChanged(p);
  }
  box.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); return close(false); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!add()) return close(false);
    closed = true;
    schoolsChanged(p);
    // straight back into a fresh field for the next one
    var again = root.querySelector('[data-act="addschool"][data-for="' + cssEsc(p.id) + '"]');
    if (again) schoolField(again, p);
  });
  box.addEventListener('blur', function () { close(true); });
}

/* A short list to choose from, under whatever was clicked. '' reads as none. */
function pickMenu(anchor, options, current, take) {
  var old = document.getElementById('arc-pick');
  if (old) old.remove();
  var box = el('div', 'arc-pick deg');
  box.id = 'arc-pick';
  box.innerHTML = options.map(function (o) {
    return '<button data-pick="' + esc(o) + '"' + (o === (current || '') ? ' data-on="1"' : '') + '>' +
      esc(o || 'No degree') + '</button>';
  }).join('');
  document.body.appendChild(box);
  var r = anchor.getBoundingClientRect();
  box.style.left = Math.max(10, Math.min(window.innerWidth - box.offsetWidth - 10, r.left)) + 'px';
  box.style.top = Math.max(10, Math.min(window.innerHeight - box.offsetHeight - 10, r.bottom + 6)) + 'px';
  function off(e) {
    if (box.contains(e.target)) return;
    box.remove(); document.removeEventListener('pointerdown', off);
  }
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]');
    if (!b) return;
    box.remove(); document.removeEventListener('pointerdown', off);
    take(b.dataset.pick);
  });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); box.remove(); document.removeEventListener('pointerdown', off); }
  });
  var on = box.querySelector('[data-on]') || box.querySelector('button');
  if (on) on.focus();
  setTimeout(function () { document.addEventListener('pointerdown', off); }, 0);
}

function moveCircle(p, from, to) {
  var list = L.circlesOf(p).slice();
  if (from === to || from < 0 || from >= list.length) return;
  var item = list.splice(from, 1)[0];
  list.splice(Math.max(0, Math.min(list.length, to)), 0, item);
  p.circles = list;
  commitPerson(p);
  refreshBlocks(p);
}

/* Circles reorder by dragging the chip, with a mouse or a finger: pointer
   events rather than HTML drag and drop, which phones do not do. */
var chipDrag = { chip: null, ended: false };

function chipDown(e) {
  var chip = e.target.closest('[data-chips="circles"] .ed-chip[data-ci]');
  if (!chip || e.target.closest('button') || e.button > 0) return;
  chipDrag = { chip: chip, x: e.clientX, y: e.clientY, id: e.pointerId, moving: false, over: null, ended: false };
}
function chipMove(e) {
  var d = chipDrag;
  if (!d.chip || e.pointerId !== d.id) return;
  var dx = e.clientX - d.x, dy = e.clientY - d.y;
  if (!d.moving) {
    if (Math.abs(dx) + Math.abs(dy) < 6) return;
    d.moving = true;
    d.chip.classList.add('dragging');
    try { d.chip.setPointerCapture(e.pointerId); } catch (err) { }
  }
  e.preventDefault();
  d.chip.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  var over = null;
  Array.prototype.forEach.call(d.chip.parentNode.querySelectorAll('.ed-chip[data-ci]'), function (c) {
    if (c === d.chip) return;
    var r = c.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) over = c;
    c.classList.remove('over', 'before', 'after');
  });
  if (over) {
    // which side of it you are on is where it lands
    var rr = over.getBoundingClientRect();
    over.classList.add('over', e.clientX < rr.left + rr.width / 2 ? 'before' : 'after');
  }
  d.over = over;
}
function chipUp(e) {
  var d = chipDrag;
  if (!d.chip || e.pointerId !== d.id) return;
  chipDrag = { chip: null, ended: d.moving };
  if (!d.moving) return;
  setTimeout(function () { chipDrag.ended = false; }, 0);
  d.chip.classList.remove('dragging');
  d.chip.style.transform = '';
  if (!d.over || e.type === 'pointercancel') return;
  var p = personById(d.chip.parentNode.dataset.for);
  var from = +d.chip.dataset.ci, to = +d.over.dataset.ci;
  if (d.over.classList.contains('after')) to += 1;
  if (from < to) to -= 1;
  d.over.classList.remove('over', 'before', 'after');
  if (p) moveCircle(p, from, to);
}

/* The circles that exist, plus a field to name a new one. */
function circleMenu(anchor, p) {
  var old = document.getElementById('arc-pick');
  if (old) old.remove();
  var have = L.circlesOf(p);
  var box = el('div', 'arc-pick');
  box.id = 'arc-pick';
  box.innerHTML = L.circleList().filter(function (c) { return have.indexOf(c.name) < 0; })
    .map(function (c) {
      return '<button data-pick="' + esc(c.name) + '">' +
        '<i style="background:var(--h' + L.circleIndex(c.name) + ')"></i>' + esc(c.name) + '</button>';
    }).join('') +
    '<div class="arc-new"><input placeholder="New circle" aria-label="New circle"><button data-new>Add</button></div>';
  document.body.appendChild(box);
  var r = anchor.getBoundingClientRect();
  box.style.left = Math.min(window.innerWidth - box.offsetWidth - 10, r.left) + 'px';
  box.style.top = Math.min(window.innerHeight - box.offsetHeight - 10, r.bottom + 6) + 'px';
  var field = box.querySelector('input');

  function take(name) {
    box.remove();
    name = (name || '').trim();
    if (!name) return;
    p.circles = L.circlesOf(p).concat([name]).filter(function (c, i, a) { return a.indexOf(c) === i; });
    commitPerson(p);
    render(true);                 // a new circle changes the folders themselves
  }
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pick) return take(b.dataset.pick);
    if (b.hasAttribute('data-new')) return take(field.value);
  });
  field.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); take(field.value); }
    if (e.key === 'Escape') { e.preventDefault(); box.remove(); }
  });
  setTimeout(function () {
    document.addEventListener('pointerdown', function off(e) {
      if (!box.contains(e.target)) { box.remove(); document.removeEventListener('pointerdown', off); }
    });
  }, 0);
}

/* ---- chrome ---- */

function build() {
  root = el('div', 'archive');
  root.id = 'archive';
  root.hidden = true;
  root.innerHTML =
    '<div class="arc-veil"></div>' +
    '<header class="arc-bar">' +
      '<button class="arc-mark" id="arc-home" title="Everything">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M12 22V10M12 10c0-3 2.6-4.6 5.4-4.8M12 10C12 7 9.4 5.4 6.6 5.2M12 15c0-2.2 2-3.2 4-3.4"/>' +
          '<circle cx="12" cy="22" r="1.6" fill="currentColor" stroke="none"/>' +
          '<circle cx="17.8" cy="5" r="1.6"/><circle cx="6.2" cy="5" r="1.6"/></svg>' +
        '<span>Rootwork</span><em id="arc-mode">Archive</em>' +
      '</button>' +
      '<label class="arc-find">' +
        '<span class="arc-pills" id="arc-pills"></span>' +
        '<input id="arc-q" type="search" placeholder="find anyone" autocomplete="off" spellcheck="false" aria-label="Find anyone">' +
        '<kbd aria-hidden="true">/</kbd>' +
        '<div class="arc-filters" id="arc-filters" role="group" aria-label="Quick filters"></div>' +
      '</label>' +
      '<button class="arc-add" id="arc-add" title="Add someone (N)">+ Person</button>' +
      '<button class="arc-map" id="arc-close" title="Back to the map (Esc)">The map</button>' +
    '</header>' +
    '<button class="arc-notetab" id="arc-notetab" title="Notes (J)" aria-expanded="false" aria-controls="arc-slip">' +
      '<span>Notes</span><b id="arc-notecount"></b></button>' +
    '<aside class="arc-slip" id="arc-slip" aria-label="Notes" hidden>' +
      '<div class="slip-head"><i class="slip-lights" aria-hidden="true"><b></b><b></b><b></b></i>' +
        '<span>Notes</span><em id="arc-slipcount"></em>' +
        '<button class="slip-x" data-slipclose aria-label="Put the notes away">\u00d7</button></div>' +
      '<textarea class="slip-in" id="arc-slipin" rows="2" placeholder="Jot anything, \u21b5 to keep" aria-label="Write a note"></textarea>' +
      '<div class="slip-list" id="arc-sliplist"></div>' +
    '</aside>' +
    '<div class="arc-scroll" id="arc-scroll"><div class="arc-wrap">' +
      '<div class="arc-head" id="arc-head"></div>' +
      '<div class="arc-body" id="arc-body"></div>' +
    '</div></div>';
  document.body.appendChild(root);
  scroll = $('#arc-scroll', root);
  head = $('#arc-head', root);
  body = $('#arc-body', root);

  $('#arc-close', root).addEventListener('click', close);
  wireSlip();
  $('#arc-add', root).addEventListener('click', function () { addPerson(currentFolder()); });
  // any "+ add" inside a design, with the folder it belongs to
  root.addEventListener('click', function (e) {
    var a = e.target.closest('[data-addto]');
    if (!a) return;
    e.stopPropagation();
    addPerson(a.dataset.addto || null);
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!open || e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    if (document.querySelector('#scrim:not([hidden])')) return;
    e.preventDefault();
    addPerson(currentFolder());
  });
  root.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act][data-for]');
    if (a) { e.stopPropagation(); if (editorAction(a)) return; }
    var f = e.target.closest('[data-field][data-for]');
    if (f) { e.stopPropagation(); editValue(f); }
  }, true);
  root.addEventListener('pointerdown', chipDown);
  document.addEventListener('pointermove', chipMove, { passive: false });
  document.addEventListener('pointerup', chipUp);
  document.addEventListener('pointercancel', chipUp);
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target.closest && e.target.closest('[data-act][data-for], [data-field][data-for]');
    if (!t || t.querySelector('input, textarea')) return;
    e.preventDefault();
    if (t.hasAttribute('data-act')) editorAction(t); else editValue(t);
  });

  $('#arc-home', root).addEventListener('click', function () {
    view.circle = null; view.person = null; query = ''; terms = []; $('#arc-q', root).value = ''; render();
  });
  var qbox = $('#arc-q', root);
  qbox.addEventListener('input', function () {
    query = qbox.value.trim();
    terms = L.queryTerms(query);
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { render(); paintFilters(); }, 140);
  });
  var panel = $('#arc-filters', root), pills = $('#arc-pills', root);
  function paintFilters() {
    var n = st().people.filter(matches).length;
    panel.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" data-filter="' + f.id + '"' + (filtersOn[f.id] ? ' data-on' : '') + '>' + esc(f.name) + '</button>';
    }).join('') + '<span class="arc-count">' + n + ' ' + (n === 1 ? 'person' : 'people') + '</span>';
    pills.innerHTML = FILTERS.filter(function (f) { return filtersOn[f.id]; }).map(function (f) {
      return '<button type="button" data-unfilter="' + f.id + '" title="Remove this filter">' + esc(f.name) + ' \u00d7</button>';
    }).join('');
  }
  function toggleFilter(id, on) {
    if (on === undefined ? !filtersOn[id] : on) filtersOn[id] = 1; else delete filtersOn[id];
    render(); paintFilters();
  }
  // the panel keeps the focus in the box, so it stays open while you pick
  panel.addEventListener('mousedown', function (e) { e.preventDefault(); });
  panel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (b) { e.preventDefault(); toggleFilter(b.dataset.filter); }
  });
  pills.addEventListener('click', function (e) {
    var b = e.target.closest('[data-unfilter]');
    if (b) { e.preventDefault(); toggleFilter(b.dataset.unfilter, false); }
  });
  qbox.addEventListener('focus', function () { paintFilters(); root.classList.add('finding'); });
  qbox.addEventListener('blur', function () { root.classList.remove('finding'); });
  qbox.addEventListener('keydown', function (e) {
    e.stopPropagation();
    // Escape clears the words, then the filters, then leaves the box
    if (e.key === 'Escape' && qbox.value) { e.preventDefault(); qbox.value = ''; query = ''; terms = []; render(); paintFilters(); }
    else if (e.key === 'Escape' && Object.keys(filtersOn).length) { e.preventDefault(); filtersOn = {}; render(); paintFilters(); }
    else if (e.key === 'Escape') qbox.blur();
  });
  document.addEventListener('keydown', function (e) {
    if (!open || e.key !== '/' || e.metaKey || e.ctrlKey) return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    e.preventDefault();
    qbox.focus();
    qbox.select();
  });
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (L.cardOpen && L.cardOpen()) return L.closeCard();
    back();
  });
  head.addEventListener('click', function (e) {
    var d = e.target.closest('[data-design]');
    if (d) return setDesign(d.dataset.design);
    var b = e.target.closest('[data-crumb]');
    if (b) {
      if (b.dataset.crumb === 'root') { view.circle = null; view.person = null; }
      else view.person = null;
      return render();
    }
  });
}

function titleFor() {
  if (view.person && view.design !== 'index') {
    var p = personById(view.person);
    return p ? p.name : 'Missing entry';
  }
  if (view.circle) return view.circle;
  var name = (st().me && st().me.name) || 'Me';
  return name === 'Me' ? 'The Archive' : name + '’s archive';
}

/* A line of type that arrives a word at a time, each rising out of its own
   clipped box the way a title card sets. */
function words(text) {
  return String(text).split(/\s+/).map(function (w, i) {
    return '<span class="word" style="--w:' + i + '"><i>' + esc(w) + '</i></span>';
  }).join(' ');
}

var lastTitle = null;
function renderHead() {
  var s = st();
  // the index opens a person inside its own list, so its head stays the list's
  var vp = view.design === 'index' ? null : view.person;
  var crumbs = ['<button data-crumb="root">Rootwork</button>'];
  if (view.circle) {
    crumbs.push('<span class="sep">/</span>');
    crumbs.push(vp
      ? '<button data-crumb="circle">' + esc(view.circle) + '</button>'
      : '<span class="here">' + esc(view.circle) + '</span>');
  }
  if (vp) {
    var pp = personById(vp);
    crumbs.push('<span class="sep">/</span><span class="here">' + esc(pp ? pp.name : '?') + '</span>');
  }

  var sub;
  if (vp) {
    var p = personById(vp);
    sub = p ? [
      esc(roleOf(p) || 'no role recorded'),
      '<b>' + p.log.length + '</b> touchpoint' + (p.log.length === 1 ? '' : 's'),
      p.log.length ? 'last ' + esc(L.ago(L.lastTouch(p))) : 'never logged'
    ] : [];
  } else if (view.circle) {
    var list = peopleIn(view.circle);
    sub = [
      '<b>' + list.length + '</b> filed here',
      list.length ? 'last touched ' + esc(L.ago(L.lastTouch(list[0]))) : 'nothing logged'
    ];
  } else {
    sub = [
      '<b>' + s.people.length + '</b> people',
      '<b>' + circles().length + '</b> ' + grouper().name.toLowerCase() + (circles().length === 1 ? '' : 's'),
      '<b>' + s.people.reduce(function (a, p) { return a + p.log.length; }, 0) + '</b> touchpoints'
    ];
  }

  var mode = DESIGNS.filter(function (d) { return d.id === view.design; })[0];
  var label = $('#arc-mode', root);
  if (label && mode) label.textContent = mode.name;

  head.innerHTML =
    '<div class="crumb">' + (crumbs.length > 1 ? crumbs.join('') : '') + '</div>' +
    // the title sets itself only when its words change: switching designs
    // leaves "The Archive" standing still
    '<h1 class="arc-title' + (titleFor() === lastTitle ? ' still' : '') + '">' + words(titleFor()) + '</h1>' +
    '<div class="apparatus">' +
      '<div class="arc-sub">' + sub.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
      '<div class="designs" role="group" aria-label="Archive design"><i class="design-pill" aria-hidden="true"></i>' +
        DESIGNS.map(function (d) {
          return '<button data-design="' + d.id + '"' + (view.design === d.id ? ' data-on="1"' : '') +
            ' title="' + esc(d.hint) + '">' + esc(d.name) + '</button>';
        }).join('') +
      '</div>' +
    '</div>';
  placeDesignPill();
  lastTitle = titleFor();
}

/* A cheap fingerprint of everything a screen draws. Sync polls every few
   seconds and the map re-renders for its own reasons; without this the
   archive rebuilt itself — and replayed every entrance animation — on each
   of them. */
function signature() {
  var s = st();
  var t = 0;
  for (var i = 0; i < s.people.length; i++) t += (s.people[i].updated || s.people[i].created || 0) % 100000;
  return [s.people.length, t, (s.circles || []).join('|'), s.me && s.me.name,
    groupMode, terms.join(' '), Object.keys(filtersOn).sort().join(','), view.design, view.circle, view.person].join('~');
}
var lastSig = '';

/* Each renderer gets a clean element and says how to tear itself down.
   A quiet render is one nobody asked for — data caught up underneath — so it
   arrives without the animations a navigation deserves. */
var teardown = null;
function render(quiet, keepHead) {
  if (!open) return;
  if (teardown) { try { teardown(); } catch (e) { } teardown = null; }
  lastSig = signature();
  root.classList.toggle('searching', searching());
  root.dataset.design = view.design;          // the notes take each design's look
  if (!keepHead) renderHead();
  body.className = 'arc-body' + (quiet ? ' still' : '');
  body.innerHTML = '';
  var fn = view.design === 'index' ? drawIndex
    : view.design === 'chroma' ? drawChroma
    : view.design === 'finder' ? drawFinder
    : drawDrawer;
  teardown = fn(body) || null;
}

function setGroup(id) {
  if (groupMode === id) return;
  groupMode = id;
  view.circle = null; view.person = null;
  try { localStorage.setItem(GROUP_KEY, id); } catch (e) { }
  scroll.scrollTop = 0;
  render();
  writeRoute();
}

/* The pill starts where it was before the head was redrawn and glides to
   the design now on. */
var pillAt = null;
function placeDesignPill() {
  var pill = head.querySelector('.design-pill'), on = head.querySelector('.designs [data-on]');
  if (!pill || !on) return;
  var to = { x: on.offsetLeft, w: on.offsetWidth, h: on.offsetHeight };
  if (pillAt && !reduced()) {
    pill.style.transition = 'none';
    pill.style.transform = 'translateX(' + pillAt.x + 'px)';
    pill.style.width = pillAt.w + 'px';
    void pill.offsetWidth;
    pill.style.transition = '';
  }
  pill.style.transform = 'translateX(' + to.x + 'px)';
  pill.style.width = to.w + 'px';
  pill.style.height = to.h + 'px';
  pillAt = to;
}

var switching = 0;
function setDesign(id) {
  if (view.design === id) {
    // pressing the design you are already in, from inside a file or folder,
    // takes you back to the top of it
    if (!view.person && !view.circle) return;
    view.person = null; view.circle = null;
    scroll.scrollTop = 0;
    render();
    return writeRoute();
  }
  var fromDesign = view.design;
  view.design = id;
  // the drawer and the index open a person; elsewhere the name in the header
  // would be describing something not on screen
  if (id !== 'drawer' && id !== 'index') view.person = null;
  try { localStorage.setItem(DESIGN_KEY, id); } catch (e) { }
  if (reduced()) { scroll.scrollTop = 0; render(); return writeRoute(); }

  // which way you are going along the row of designs
  var ids = DESIGNS.map(function (d) { return d.id; });
  var dir = ids.indexOf(id) >= ids.indexOf(fromDesign) ? 1 : -1;
  var token = ++switching;
  body.style.setProperty('--dir', dir);
  body.classList.add('leaving');
  root.dataset.design = id;
  // the head (and its pill) moves straight away; the body follows once out
  renderHead();
  writeRoute();
  setTimeout(function () {
    if (token !== switching || !open) return;
    scroll.scrollTop = 0;
    render(false, true);                      // the head was redrawn at the click
    body.style.setProperty('--dir', dir);
    body.classList.add('arriving');
    var line = el('i', 'arc-sweep');
    line.style.setProperty('--dir', dir);
    line.style.top = body.offsetTop + 'px';
    body.parentNode.appendChild(line);
    setTimeout(function () { line.remove(); body.classList.remove('arriving'); }, 720);
  }, 190);
}

function show(circle, person, design) {
  if (!window.Rootwork) return;
  R = window.Rootwork; L = R.lib;
  if (!root) build();
  view.circle = circle || null;
  view.person = person || null;
  if (design) view.design = design;
  else { try { view.design = localStorage.getItem(DESIGN_KEY) || view.design; } catch (e) { } }
  // a design that has since been retired falls back to the drawer
  if (!DESIGNS.some(function (d) { return d.id === view.design; })) view.design = 'drawer';
  try { groupMode = localStorage.getItem(GROUP_KEY) || groupMode; } catch (e) { }
  open = true;
  lastTitle = null;                     // coming in from the map, the title sets itself once
  root.hidden = false;
  document.body.classList.add('archived');
  // once the archive has covered the map, stop painting the map at all
  clearTimeout(settleTimer);
  settleTimer = setTimeout(function () { if (open) document.body.classList.add('archive-settled'); }, 450);
  render();
  paintSlip();
  writeRoute(true);
  requestAnimationFrame(function () { root.classList.add('in'); });
  root.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
}

function close() {
  if (!open) return;
  open = false;
  root.classList.remove('in');
  clearTimeout(settleTimer);
  document.body.classList.remove('archive-settled');   // the map shows through as the archive fades
  document.body.classList.remove('archived');
  if (L && L.closeCard) L.closeCard();
  if (slipOpen) setSlip(false);
  try { history.pushState(null, '', '#map'); } catch (e) { }
  var done = function () { if (!open) root.hidden = true; };
  if (reduced()) done(); else setTimeout(done, 300);
  if (teardown) { try { teardown(); } catch (e) { } teardown = null; }
}

var indexClose = null;           // set while the index is on screen
function back() {
  if (view.person && view.design === 'index' && indexClose) return indexClose();
  if (view.person) { view.person = null; render(); return writeRoute(); }
  if (view.circle) { view.circle = null; render(); return writeRoute(); }
  close();
}

function wipe(hue) {
  if (reduced() || !hue) return;
  var w = el('div', 'arc-wipe');
  w.style.setProperty('--hue', hue);
  root.appendChild(w);
  setTimeout(function () { w.remove(); }, 660);
}

function openPerson(id, hue) {
  wipe(hue);
  view.person = id;
  render();
  writeRoute();
  scroll.scrollTop = 0;
}

/* ---- the notepad ----
   The map's loose notes (a thought, an address, a to-do), kept out of the
   way: a tab on the right edge with the count, and a slip of paper that
   slides out over the page when you want it. J opens it, Escape or a click
   elsewhere puts it back. Same notes as the map's pad, so they sync. */
var slipOpen = false;

function paintSlip(force) {
  var list = L.padNotes();
  var n = list.length;
  $('#arc-notecount', root).textContent = n || '';
  $('#arc-slipcount', root).textContent = n ? n + (n === 1 ? ' note' : ' notes') : '';
  var box = $('#arc-sliplist', root);
  if (!slipOpen || (!force && box.querySelector('textarea'))) return;   // never redrawn under a cursor
  box.innerHTML = list.length ? list.map(function (x, i) {
    return '<div class="slip-note" data-n="' + String(i + 1).padStart(2, '0') + '">' +
      '<p class="slip-t" data-padnote="' + esc(x.id) + '" tabindex="0" role="button" title="Click to edit">' + esc(x.t) + '</p>' +
      '<span class="slip-when">' + esc(L.ago(x.at)) + '</span>' +
      '<button class="slip-del" data-delpad="' + esc(x.id) + '" aria-label="Delete note">\u00d7</button>' +
    '</div>';
  }).join('') : '<p class="slip-empty">Nothing jotted yet.</p>';
}

function setSlip(on) {
  var slip = $('#arc-slip', root), tab = $('#arc-notetab', root);
  slipOpen = on;
  tab.setAttribute('aria-expanded', on ? 'true' : 'false');
  root.classList.toggle('slipped', on);
  if (on) {
    slip.hidden = false;
    paintSlip();
    void slip.offsetWidth;
    slip.classList.add('on');
    $('#arc-slipin', root).focus({ preventScroll: true });
  } else {
    slip.classList.remove('on');
    setTimeout(function () { if (!slipOpen) slip.hidden = true; }, reduced() ? 0 : 280);
  }
}

function wireSlip() {
  var slip = $('#arc-slip', root), input = $('#arc-slipin', root);
  $('#arc-notetab', root).addEventListener('click', function () { setSlip(!slipOpen); });
  var grow = function () { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.value.trim()) return;
      L.addPadNote(input.value);
      input.value = ''; grow();
      paintSlip();
      var first = slip.querySelector('.slip-note');
      if (first && !reduced()) first.classList.add('fresh');
    }
    if (e.key === 'Escape') { e.preventDefault(); if (input.value) { input.value = ''; grow(); } else setSlip(false); }
  });
  slip.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); if (!e.target.closest('textarea')) setSlip(false); }
  });
  slip.addEventListener('click', function (e) {
    if (e.target.closest('[data-slipclose]')) return setSlip(false);
    var d = e.target.closest('[data-delpad]');
    if (d) { L.dropPadNote(d.dataset.delpad); return paintSlip(); }
    var v = e.target.closest('[data-padnote]');
    if (v) {
      var note = L.padNotes().filter(function (x) { return x.id === v.dataset.padnote; })[0];
      if (note) editText(v, note.t, function (val) { L.editPadNote(note.id, val); paintSlip(true); });
    }
  });
  // a click anywhere else puts it back
  document.addEventListener('pointerdown', function (e) {
    if (!slipOpen) return;
    if (e.target.closest('#arc-slip, #arc-notetab, #arc-cal, #arc-pick, #scrim')) return;
    setSlip(false);
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!open || e.key.toLowerCase() !== 'j' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    if (document.querySelector('#scrim:not([hidden])')) return;
    e.preventDefault();
    setSlip(!slipOpen);
  });
}

/* ---- adding someone ----
   The map's own form, started in whichever folder you are in (when folders
   are circles), and the new person then opens right here rather than on the
   map behind. */
var finderSel = null;            // the desktop's open folder, while it is on screen

function currentFolder() {
  if (groupMode !== 'circle') return null;
  if (view.design === 'finder' && finderSel) return finderSel.circle;
  return view.circle || null;
}

function addPerson(circle) {
  if (groupMode !== 'circle') circle = null;
  ['arc-cal', 'arc-pick'].forEach(function (id) { var o = document.getElementById(id); if (o) o.remove(); });
  L.newPerson(circle, function (p) {
    var home = L.circlesOf(p)[0] || null;
    if (view.design === 'drawer') {
      view.circle = home;
      return openPerson(p.id, home ? hueVar(home) : null);
    }
    if (view.design === 'index' || view.design === 'finder') {
      view.circle = view.design === 'finder' ? home : view.circle;
      view.person = p.id;
      render(true);
      return writeRoute();
    }
    // chroma: draw them in, then open their pane from their own name
    render(true);
    var n = body.querySelector('.ch-name[data-person="' + cssEsc(p.id) + '"]');
    if (n) { n.scrollIntoView({ block: 'center' }); n.click(); }
  });
}

/* ==========================================================================
   Design 1 — Drawer
   Cut tabs over colour bands. Opening a folder pushes the rest down and the
   entries rise into it.
   ========================================================================== */

function drawDrawer(host) {
  if (view.person) return drawFile(host);

  var list = circles();
  if (!list.length) return emptyState(host, 'Nothing filed yet.');

  var wrap = el('div', 'stack');
  var widths = [208, 178, 232, 192];
  list.forEach(function (c, i) {
    var f = el('article', 'folder');
    f.dataset.folder = c.name;
    f.style.setProperty('--hue', hueVar(c.name));
    f.style.setProperty('--i', i);
    f.style.setProperty('--tab-x', (18 + (i % 4) * 172) + 'px');
    f.style.setProperty('--tab-w', widths[i % widths.length] + 'px');

    var folk = peopleIn(c.name);
    var last = folk.length ? L.fmtDate(L.lastTouch(folk[0])) : '—';
    f.innerHTML =
      '<button class="tab" data-open="' + esc(c.name) + '">' + esc(c.name) + '</button>' +
      '<div class="band" data-open="' + esc(c.name) + '">' +
        '<div class="filed">' +
          '<span class="no">' + String(i + 1).padStart(3, '0') + '</span>' +
          '<span class="what">' + esc(folk.length ? folk.length + ' filed here. ' +
            (folk.length > 3 ? 'Referenced often, seldom all at once.' : 'A short shelf.') : 'Empty folder, kept open.') + '</span>' +
          '<span class="when">' + esc(last) + '</span>' +
        '</div>' +
        '<div class="inside"><div><div class="entries">' +
          (folk.length ? folk.map(function (p, j) {
            var extra = groupsOf(p).filter(function (x) { return x !== c.name; });
            return '<button class="entry-row" data-person="' + p.id + '" style="--d:' + j + '">' +
              '<span class="who"><span>' + nameHtml(p) + '</span>' +
                (hitLine(p) ? '<span class="role">' + hitLine(p) + '</span>'
                  : roleOf(p) ? '<span class="role">' + esc(roleOf(p)) + '</span>' : '') +
                (extra.length ? '<span class="pips">' + extra.map(function (x) {
                  return '<i style="background:' + hueVar(x) + '"></i>'; }).join('') + '</span>' : '') +
              '</span>' +
              '<span class="stamp">' + esc(p.log.length ? L.ago(L.lastTouch(p)) : 'no touchpoints') + '</span>' +
            '</button>';
          }).join('') : '<div class="empty-note">Nobody filed here yet</div>') +
        '</div></div></div>' +
      '</div>';
    wrap.appendChild(f);
  });
  host.appendChild(wrap);

  // one folder at a time, the way a drawer works
  var openFolder = null;
  var pick = function (f) {
    if (openFolder && openFolder !== f) openFolder.classList.remove('open');
    openFolder = f.classList.contains('open') ? null : f;
    f.classList.toggle('open');
    if (openFolder) {
      // re-run the stagger on every open
      openFolder.querySelectorAll('.entry-row').forEach(function (r) {
        r.style.animation = 'none'; void r.offsetWidth; r.style.animation = '';
      });
    }
  };

  wrap.addEventListener('click', function (e) {
    var p = e.target.closest('[data-person]');
    if (p) {
      var f = p.closest('.folder');
      if (f) view.circle = f.dataset.folder;
      return openPerson(p.dataset.person, f ? hueVar(f.dataset.folder) : null);
    }
    var o = e.target.closest('[data-open]');
    if (o) pick(o.closest('.folder'));
  });

  if (view.circle) {
    var want = wrap.querySelector('.folder[data-folder="' + (window.CSS && CSS.escape ? CSS.escape(view.circle) : view.circle) + '"]');
    if (want) { openFolder = want; want.classList.add('open'); }
  }
}

/* A person's own jacket: the facts typed on a card, the history as sheets. */
function drawFile(host) {
  var p = personById(view.person);
  if (!p) return emptyState(host, 'That entry is gone.');
  var home = view.circle || homeGroup(p);
  var extra = groupsOf(p).concat(L.circlesOf(p)).filter(function (x, i, a) {
    return x !== home && a.indexOf(x) === i;
  });

  var file = el('div', 'file');
  file.style.setProperty('--hue', hueVar(home));
  file.style.setProperty('--tab-x', '18px');

  var facts = [
    ['Email', p.email, 'email'],
    ['Profession', p.profession, 'profession'], ['Company', p.company, 'company'],
    ['Location', p.location, 'location'],
    ['Schools', '', '', schoolChips(p)],
    ['Filed under', '', '', circleChips(p)]
  ];
  Object.keys(p.custom || {}).forEach(function (k) { facts.push([k, p.custom[k]]); });
  var ties = L.tiesOf(p);
  if (ties.length) {
    facts.push(['Connected', ties.map(function (t) {
      return (t.own ? 'via ' : 'introduced ') + t.person.name;
    }).join(', ')]);
  }

  var d = 0;
  var sheets = [
    '<div class="sheet card" style="--d:' + (d++) + ';--r:-.35deg">' +
      '<span class="stamped">File ' + esc(String(p.id).slice(-4).toUpperCase()) + '</span>' +
      '<h4><span class="edit"' + editableAttrs(p, 'name') + '>' + esc(p.name) + '</span></h4>' +
      '<div class="rule"></div>' +
      '<dl class="facts">' + facts.map(function (f) {
        var body = f[3] || (f[1] ? esc(f[1]) : '<span class="none">—</span>');
        return '<dt>' + esc(f[0]) + '</dt><dd>' + (f[2]
          ? '<span class="edit"' + editableAttrs(p, f[2]) + '>' + body + '</span>'
          : body) + '</dd>';
      }).join('') + '</dl>' +
    '</div>'
  ];


  file.innerHTML =
    '<div class="tab">' + esc(home) + '</div>' +
    '<div class="jacket">' +
      (extra.length ? '<div class="edge">' + extra.map(function (c) {
        return '<span style="--c:' + hueVar(c) + '">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="sheets">' + sheets.join('') +
        '<div class="sheets-live" data-sheets="' + p.id + '">' + fileSheets(p, d) + '</div>' +
      '</div>' +
      '<div class="acts">' +
        '<button class="btn" data-back>Back to the drawer</button>' +
      '</div>' +
    '</div>';
  host.appendChild(file);

  file.addEventListener('click', function (e) {
    if (e.target.closest('[data-back]')) back();
  });
}

/* The notes and touchpoints in a file, each one edited on its own sheet:
   click the words to change them, x to throw the sheet away. */
function fileSheets(p, d) {
  var out = [];
  var x = function (act, id, what) {
    return '<button class="sheet-x" data-act="' + act + '" data-for="' + p.id + '" data-id="' + esc(id) +
      '" aria-label="Delete ' + what + '">\u00d7</button>';
  };
  (p.notes || []).forEach(function (n) {
    out.push('<div class="sheet slip" style="--d:' + (d++) + '">' +
      '<p class="ed-text" data-act="note" data-for="' + p.id + '" data-id="' + esc(n.id) + '" tabindex="0" role="button"' +
        ' title="Click to edit">' + esc(n.t) + '</p>' + x('delnote', n.id, 'note') + '</div>');
  });
  if (p.log.length) {
    p.log.forEach(function (e, i) {
      out.push('<div class="sheet entry" style="--d:' + (d++) + ';--r:' + (i % 2 ? '.3' : '-.25') + 'deg">' +
        '<div class="margin">' + esc(L.channelLabel(e.channel)) + '<br>' + dateChip(p, e) + '</div>' +
        '<div><p class="ed-text" data-act="log" data-for="' + p.id + '" data-id="' + esc(e.id) + '" tabindex="0" role="button"' +
          ' title="Click to edit">' + esc(e.text) + '</p>' +
          (e.learned ? '<div class="learned">' + esc(e.learned) + '</div>' : '') +
        '</div>' + x('dellog', e.id, 'touchpoint') + '</div>');
    });
  } else {
    out.push('<div class="sheet blank" style="--d:' + (d++) + '">No touchpoints on file</div>');
  }
  out.push('<div class="sheet-adds" style="--d:' + d + '">' +
    '<button class="ed-add" data-act="addnote" data-for="' + p.id + '">+ note</button>' +
    '<button class="ed-add" data-act="addlog" data-for="' + p.id + '">+ touchpoint</button></div>');
  return out.join('');
}

function emptyState(host, text) {
  host.appendChild(el('div', 'arc-empty', esc(text) +
    '<span>Log something in the bar, or import your spreadsheet, and it lands here.</span>'));
}


/* ==========================================================================
   Design 3 — Light table
   Every person a sheet, scattered on a dark table. Drag them where you like,
   click one to bring it up, and a lamp follows the cursor. Ties between
   people are drawn underneath in thread.
   ========================================================================== */


/* ==========================================================================
   Design 4 — Index
   No pictures, no colour, no room wasted. Everyone set in one tight grid the
   way a catalogue raisonné lists works: number, name, one line of fact.
   A crosshair tracks the row you are on; a row opens into its own entry.
   ========================================================================== */

function drawIndex(host) {
  var people = (view.circle ? peopleIn(view.circle) : st().people.filter(matches))
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (!people.length) return emptyState(host, view.circle ? 'This folder is empty.' : 'Nothing indexed yet.');

  var cols = circles();
  var rig = el('div', 'index');
  rig.innerHTML =
    '<div class="ix-grid" id="ix-grid">' +
      people.map(function (p, i) {
        var sch = L.schoolsOf(p)[0];
        return '<button class="ix-row" data-person="' + p.id + '" style="--d:' + i + '">' +
          '<span class="ix-n">' + String(i + 1).padStart(3, '0') + '</span>' +
          '<span class="ix-name">' + nameHtml(p) + '</span>' +
          '<span class="ix-fact">' + (hitLine(p) || esc(roleOf(p) || (sch ? sch.name : '\u2014'))) + '</span>' +
          '<span class="ix-where">' + esc(p.location || '') + '</span>' +
          '<span class="ix-tags">' + L.circlesOf(p).map(function (c) {
            return '<i style="background:' + hueVar(c) + '"></i>'; }).join('') + '</span>' +
          '<span class="ix-when">' + esc(p.log.length ? L.ago(L.lastTouch(p)) : '\u2014') + '</span>' +
        '</button>';
      }).join('') +
    '</div>';
  host.appendChild(rig);

  var cross = el('div', 'ix-cross');
  $('#ix-grid', rig).appendChild(cross);

  rig.addEventListener('pointerover', function (e) {
    var r = e.target.closest('.ix-row');
    if (!r) return;
    rig.querySelectorAll('.ix-row[data-on]').forEach(function (x) { x.removeAttribute('data-on'); });
    r.setAttribute('data-on', '');
    cross.style.top = (r.offsetTop + r.offsetHeight - 1) + 'px';
    cross.setAttribute('data-on', '');
  });
  rig.addEventListener('pointerleave', function () { cross.removeAttribute('data-on'); });
  /* A row opens into its own entry, set the way the index sets everything:
     a catalogue number, the name, two columns of typed facts, and the record
     underneath, all editable where it sits. One entry open at a time; the
     rows below make room rather than the page changing. */
  var grid = $('#ix-grid', rig);
  var openId = null;

  function entryHtml(p, no) {
    var f = function (label, field) {
      return '<dt>' + label + '</dt><dd><span class="edit"' + editableAttrs(p, field) + '>' +
        (p[field] ? esc(p[field]) : '<span class="none">' + DASH + '</span>') + '</span></dd>';
    };
    return '<div class="ix-entry" data-entry="' + p.id + '"><div class="ix-entry-in"><div class="ix-sheet">' +
      '<div class="ix-e-head">' +
        '<span class="ix-e-no">No. ' + no + '</span>' +
        '<h3><span class="edit"' + editableAttrs(p, 'name') + '>' + esc(p.name) + '</span></h3>' +
        '<button class="ix-e-x" data-ixclose aria-label="Close the entry">\u00d7</button>' +
      '</div>' +
      '<div class="ix-e-cols">' +
        '<dl>' + f('Role', 'profession') + f('Company', 'company') + f('Email', 'email') + f('Location', 'location') + '</dl>' +
        '<dl>' +
          '<dt>Schools</dt><dd>' + schoolChips(p) + '</dd>' +
          '<dt>Filed</dt><dd>' + circleChips(p) + '</dd>' +
          '<dt>Last</dt><dd>' + esc(p.log.length ? L.fmtDate(L.lastTouch(p)) + ', ' + L.ago(L.lastTouch(p)) : 'never') + '</dd>' +
        '</dl>' +
      '</div>' +
      editorBlocks(p) +
    '</div></div></div>';
  }

  function shut(entry, now) {
    if (!entry) return;
    var row = entry.previousElementSibling;
    if (row) row.removeAttribute('data-open');
    entry.classList.remove('open');
    if (now || reduced()) return entry.remove();
    setTimeout(function () { entry.remove(); }, 380);
  }

  function openEntry(id, quiet) {
    var row = grid.querySelector('.ix-row[data-person="' + cssEsc(id) + '"]');
    var p = personById(id);
    if (!row || !p) return;
    shut(grid.querySelector('.ix-entry'), quiet);
    openId = id;
    view.person = id;
    row.setAttribute('data-open', '');
    var tmp = document.createElement('div');
    tmp.innerHTML = entryHtml(p, row.querySelector('.ix-n').textContent);
    var entry = tmp.firstElementChild;
    row.after(entry);
    if (quiet || reduced()) entry.classList.add('open', 'settled');
    else { void entry.offsetHeight; entry.classList.add('open'); }   // laid out closed, then opened
    lastSig = signature();
    if (!quiet) writeRoute();
    // keep the row and its entry in view, without jumping if they already are
    var rr = row.getBoundingClientRect(), sr = scroll.getBoundingClientRect();
    if (rr.top < sr.top + 60 || rr.top > sr.bottom - 160) {
      scroll.scrollTo({ top: scroll.scrollTop + rr.top - sr.top - 90, behavior: reduced() || quiet ? 'auto' : 'smooth' });
    }
  }

  function closeEntry() {
    shut(grid.querySelector('.ix-entry'));
    openId = null;
    view.person = null;
    lastSig = signature();
    writeRoute();
  }
  indexClose = closeEntry;

  rig.addEventListener('click', function (e) {
    if (e.target.closest('[data-ixclose]')) return closeEntry();
    var f = e.target.closest('[data-folder]');
    if (f) { view.circle = f.dataset.folder || null; return render(); }
    var r = e.target.closest('.ix-row[data-person]');
    if (r) return r.dataset.person === openId ? closeEntry() : openEntry(r.dataset.person);
  });

  // with an entry open, up and down walk to the next one
  var onKey = function (e) {
    if (!open || view.design !== 'index' || !openId) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
    var rows = Array.prototype.slice.call(grid.querySelectorAll('.ix-row'));
    var at = rows.findIndex(function (x) { return x.dataset.person === openId; });
    var next = rows[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    openEntry(next.dataset.person);
  };
  document.addEventListener('keydown', onKey);

  if (view.person) openEntry(view.person, true);

  return function () {
    document.removeEventListener('keydown', onKey);
    if (indexClose === closeEntry) indexClose = null;
  };
}


/* ==========================================================================
   Design 6 — Chroma
   No paper anywhere. Each folder is a field of its own light, names set huge
   over it, and the light follows the pointer. Click a name and a pane of
   glass slides over the colour with the facts on it.
   ========================================================================== */

function drawChroma(host) {
  // one band each: a person shows under the circle they are filed under
  // first, never twice
  var mine = function (name) {
    return peopleIn(name).filter(function (p) { return homeGroup(p) === name; });
  };
  var groups = view.circle
    ? [{ name: view.circle, people: mine(view.circle) }]
    : circles().map(function (c) { return { name: c.name, people: mine(c.name) }; })
        .filter(function (g) { return g.people.length; });
  var loose = st().people.filter(function (p) { return !L.circlesOf(p).length; });
  if (!groups.length) return emptyState(host, 'Nothing to light up yet.');

  var rig = el('div', 'chroma');
  rig.innerHTML =
    '<div class="ch-aura" id="ch-aura"></div>' +
    groups.map(function (g, gi) {
      return '<section class="ch-band" style="--hue:' + hueVar(g.name) + ';--gi:' + gi + '">' +
        '<div class="ch-wash"></div>' +
        '<header><h3>' + esc(g.name) + '</h3>' +
          '<span>' + String(g.people.length).padStart(2, '0') + ' entries</span>' +
        '</header>' +
        '<div class="ch-names">' +
          (g.people.length ? g.people.map(function (p, i) {
            return '<button class="ch-name" data-person="' + p.id + '" style="--d:' + i + '">' +
              '<span class="ch-t">' + nameHtml(p) + '</span>' +
              '<span class="ch-s">' + (hitLine(p) || esc(roleOf(p) || (p.location || ''))) + '</span>' +
            '</button>';
          }).join('') : '<span class="ch-empty">empty</span>') +
        '</div>' +
      '</section>';
    }).join('') +
    '<div class="ch-scrim" id="ch-scrim" hidden></div>' +
    '<div class="ch-pane" id="ch-pane" hidden></div>';
  host.appendChild(rig);

  // the light covers the whole window and follows the pointer anywhere in
  // the archive, so it never shows the edge of a box
  var aura = $('#ch-aura', rig);
  var onMove = function (e) {
    var r = aura.getBoundingClientRect();
    aura.style.setProperty('--ax', (e.clientX - r.left) + 'px');
    aura.style.setProperty('--ay', (e.clientY - r.top) + 'px');
  };
  root.addEventListener('pointermove', onMove);

  var pane = $('#ch-pane', rig);
  var scrim = $('#ch-scrim', rig);
  function showPane(p, from) {
    pane.style.setProperty('--hue', hueVar(homeGroup(p)));
    pane.innerHTML =
      '<button class="ch-x" data-close aria-label="Close">\u00d7</button>' +
      '<div class="ch-kicker">' + esc(L.circlesOf(p).join(' \u00b7 ')) + '</div>' +
      '<h3><span class="edit"' + editableAttrs(p, 'name') + '>' + esc(p.name) + '</span></h3>' +
      '<div class="ch-role"><span class="edit"' + editableAttrs(p, 'profession') + '>' +
        esc(p.profession || 'Add a role') + '</span></div>' +
      '<dl>' +
        '<dt>Company</dt><dd class="edit"' + editableAttrs(p, 'company') + '>' + esc(p.company || '—') + '</dd>' +
        '<dt>Email</dt><dd class="edit"' + editableAttrs(p, 'email') + '>' + esc(p.email || '—') + '</dd>' +
        '<dt>Location</dt><dd class="edit"' + editableAttrs(p, 'location') + '>' + esc(p.location || '—') + '</dd>' +
        '<dt>School</dt><dd>' + schoolChips(p) + '</dd>' +
        '<dt>Filed</dt><dd>' + circleChips(p) + '</dd>' +
        '<dt>Last</dt><dd>' + esc(p.log.length ? L.ago(L.lastTouch(p)) : 'no touchpoints') + '</dd>' +
      '</dl>' +
      editorBlocks(p);
    var r = from.getBoundingClientRect();
    var ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    pane.classList.remove('on', 'enter');
    scrim.hidden = false;
    pane.hidden = false;
    // it is dealt from the name: starts there, small and tipped back, and
    // swings up flat into the middle of the window
    aimAt(ox, oy);
    // the rows come in one after another, a fact and its value together
    var k = 0;
    Array.prototype.forEach.call(pane.querySelectorAll('.ch-kicker, .ch-role, dl > dt, dl > dd, .editor .ed-row'), function (n) {
      if (n.tagName !== 'DD') k++;
      n.style.setProperty('--k', k);
    });
    lastFrom = from;
    if (!reduced()) {
      pane.classList.add('enter');
      clearTimeout(enterTimer);
      enterTimer = setTimeout(function () { pane.classList.remove('enter'); }, 650);
    }
    void pane.offsetWidth;                   // laid out closed, then opened
    scrim.classList.add('on');
    pane.classList.add('on');
  }
  var lastFrom = null, enterTimer = null;

  function aimAt(x, y) {
    pane.style.setProperty('--fx', (x - window.innerWidth / 2).toFixed(0) + 'px');
    pane.style.setProperty('--fy', (y - window.innerHeight / 2).toFixed(0) + 'px');
  }

  function hidePane() {
    // close back into the name it came from, if that name is still on screen
    if (lastFrom && lastFrom.isConnected) {
      var r = lastFrom.getBoundingClientRect();
      aimAt(r.left + r.width / 2, r.top + r.height / 2);
    }
    pane.classList.remove('on', 'enter');
    scrim.classList.remove('on');
    setTimeout(function () {
      if (pane.classList.contains('on')) return;
      pane.hidden = true; scrim.hidden = true;
    }, reduced() ? 0 : 280);
  }

  var onKey = function (e) {
    if (e.key === 'Escape' && !pane.hidden) { e.stopPropagation(); hidePane(); }
  };
  document.addEventListener('keydown', onKey, true);

  rig.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) return hidePane();
    var n = e.target.closest('[data-person]');
    if (n) return showPane(personById(n.dataset.person), n);
    if (!e.target.closest('.ch-pane')) hidePane();
  });

  return function () {
    root.removeEventListener('pointermove', onMove);
    document.removeEventListener('keydown', onKey, true);
  };
}

/* ==========================================================================
   Design 7 — Desktop
   The same archive as a file browser: folders in the first column, entries in
   the second, and whatever is selected read out in the third. Arrow keys walk
   it, Enter opens the card, and the icon view is the same tree spilled onto a
   desktop.
   ========================================================================== */

var finderMode = 'columns';

function drawFinder(host) {
  var cols = circles();
  var sel = { circle: view.circle || (cols[0] && cols[0].name) || null, person: view.person || null };
  if (!sel.person && sel.circle) {
    var first = peopleIn(sel.circle)[0];
    if (first) sel.person = first.id;
  }

  finderSel = sel;
  var rig = el('div', 'finder');
  rig.innerHTML =
    '<div class="fw-desk" aria-hidden="true"></div>' +
    '<div class="fw">' +
      '<i class="fw-sheen" aria-hidden="true"></i>' +
      '<div class="fw-bar">' +
        '<span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="fw-path" id="fw-path"></span>' +
        '<span class="fw-modes"><i class="fw-pill" aria-hidden="true"></i>' +
          '<button data-mode="columns" title="Columns">\u2016</button>' +
          '<button data-mode="icons" title="Icons">\u25a6</button>' +
        '</span>' +
      '</div>' +
      '<div class="fw-body" id="fw-body"></div>' +
      '<div class="fw-foot" id="fw-foot"></div>' +
    '</div>';
  host.appendChild(rig);
  var pane = $('#fw-body', rig);

  function icon(kind) {
    return kind === 'folder'
      ? '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M3 18V7a1.5 1.5 0 0 1 1.5-1.5h6L12.5 8h7A1.5 1.5 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>' +
          '<path class="flap" d="M3 18.2V11.5A1.5 1.5 0 0 1 4.5 10h15a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.2z" fill="currentColor" fill-opacity=".16"/>' +
        '</svg>'
      : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/></svg>';
  }



  var lastPath = [], lastFoot = [];
  function chrome(folk, p) {
    // the path: a segment that is new slides in, the ones that stayed stay
    var path = ['Rootwork'].concat(sel.circle ? [sel.circle] : [], p ? [p.name] : []);
    $('#fw-path', rig).innerHTML = path.map(function (bit, i) {
      var fresh = lastPath[i] !== bit;
      return (i ? '<span class="sep">\u203a</span>' : '') +
        '<b class="seg' + (fresh ? ' new' : '') + '"' + (i ? ' style="--k:' + i + '"' : '') + '>' + esc(bit) + '</b>';
    }).join('');
    lastPath = path;

    // the desk behind the window takes the open folder's colour
    rig.style.setProperty('--desk', sel.circle ? hueVar(sel.circle) : 'var(--accent)');
    Array.prototype.forEach.call(rig.querySelectorAll('.fw-modes [data-mode]'), function (b) {
      b.toggleAttribute('data-on', b.dataset.mode === finderMode);
    });
    placePill();

    var foot = [
      cols.length + ' folder' + (cols.length === 1 ? '' : 's'),
      folk.length + ' item' + (folk.length === 1 ? '' : 's') + (sel.circle ? ' in ' + sel.circle : '')
    ];
    $('#fw-foot', rig).innerHTML = foot.map(function (t, i) {
      return '<span' + (lastFoot[i] !== undefined && lastFoot[i] !== t ? ' class="tick"' : '') + '>' + esc(t) + '</span>';
    }).join('') + '<span class="fw-tip">\u2191\u2193 move \u00b7 \u2192 open \u00b7 \u21b5 edit</span>';
    lastFoot = foot;
  }

  function peopleCol(folk) {
    return '<i class="fw-marker" aria-hidden="true"></i>' + (folk.length ? folk.map(function (x, xi) {
      return '<button class="frow' + (sel.person === x.id ? ' on' : '') + '" data-person="' + x.id + '" style="--r:' + xi + '">' +
        '<span class="fic">' + icon('file') + '</span>' +
        '<span class="fnm">' + nameHtml(x) + '</span>' +
      '</button>';
    }).join('') : '<div class="fempty">empty folder</div>');
  }
  function previewOf(p) { return p ? preview(p) : '<div class="fempty">no file selected</div>'; }

  function paint() {
    var folk = sel.circle ? peopleIn(sel.circle) : [];
    var p = sel.person ? personById(sel.person) : null;
    chrome(folk, p);

    if (finderMode === 'icons') {
      pane.className = 'fw-icons';
      pane.innerHTML = cols.map(function (c, ci) {
        return '<div class="fitem' + (sel.circle === c.name ? ' on' : '') + '" data-circle="' + esc(c.name) + '" tabindex="0" style="--r:' + ci + '">' +
          '<span class="fic" style="color:' + hueVar(c.name) + '">' + icon('folder') + '</span>' +
          '<span class="fnm">' + esc(c.name) + '</span>' +
          '<span class="fsz">' + c.n + ' item' + (c.n === 1 ? '' : 's') + '</span>' +
        '</div>';
      }).join('') + folk.map(function (x, xi) {
        return '<div class="fitem' + (sel.person === x.id ? ' on' : '') + '" data-person="' + x.id + '" tabindex="0" style="--r:' + (cols.length + xi) + '">' +
          '<span class="fic">' + icon('file') + '</span>' +
          '<span class="fnm">' + nameHtml(x) + '</span>' +
        '</div>';
      }).join('');
    } else {
      pane.className = 'fw-cols';
      pane.innerHTML =
        '<div class="fcol" data-col="0"><i class="fw-marker" aria-hidden="true"></i>' + cols.map(function (c, ci) {
          return '<button class="frow' + (sel.circle === c.name ? ' on' : '') + '" data-circle="' + esc(c.name) + '" style="--r:' + ci + '">' +
            '<span class="fic" style="color:' + hueVar(c.name) + '">' + icon('folder') + '</span>' +
            '<span class="fnm">' + esc(c.name) + '</span>' +
            '<span class="fct">' + c.n + '</span>' +
            '<span class="fch">\u203a</span>' +
          '</button>';
        }).join('') + '</div>' +
        '<div class="fcol" data-col="1">' + peopleCol(folk) + '</div>' +
        '<div class="fcol fprev" data-col="2">' + previewOf(p) + '</div>';
    }

    placeMarker();
  }

  /* Moving between people is not a new screen, so it is not drawn as one:
     the list stays where it is, the marker slides to the new row, and the
     preview turns over like a rolodex card in the direction you moved. */
  function roll(p, dir) {
    var col = pane.querySelector('.fcol[data-col="2"]');
    if (!col) return;
    var old = col.querySelector('.fprev-in, .fempty');
    var tmp = document.createElement('div');
    tmp.innerHTML = previewOf(p);
    var next = tmp.firstElementChild;
    if (reduced() || !old) {
      if (old) old.remove();
      next.classList.add('settled');
      col.appendChild(next);
      return;
    }
    next.style.setProperty('--dir', dir);
    next.classList.add('settled', 'roll-in');
    old.style.setProperty('--dir', dir);
    old.style.top = (old.offsetTop - col.scrollTop) + 'px';
    old.classList.add('roll-out');
    col.appendChild(next);
    col.scrollTop = 0;                        // a new card is read from its name down
    setTimeout(function () { old.remove(); }, 320);
  }

  function pickPerson(id) {
    if (finderMode !== 'columns' || !pane.querySelector('.fcol[data-col="2"]')) {
      sel.person = id; return paint();
    }
    var folk = sel.circle ? peopleIn(sel.circle) : [];
    var ids = folk.map(function (x) { return x.id; });
    var dir = sel.person && id ? (ids.indexOf(id) > ids.indexOf(sel.person) ? 1 : -1) : 0;
    if (id === sel.person) return;
    sel.person = id;
    Array.prototype.forEach.call(pane.querySelectorAll('.fcol[data-col="1"] .frow'), function (r) {
      r.classList.toggle('on', r.dataset.person === id);
    });
    placeMarker();
    chrome(folk, id ? personById(id) : null);
    roll(id ? personById(id) : null, dir);
  }

  /* A new folder redraws the people and the preview; the folders stay put. */
  function pickCircle(name) {
    var col1 = pane.querySelector('.fcol[data-col="1"]');
    if (finderMode !== 'columns' || !col1) {
      sel.circle = name; sel.person = null; return paint();
    }
    var names = cols.map(function (c) { return c.name; });
    var dir = names.indexOf(name) > names.indexOf(sel.circle) ? 1 : -1;
    sel.circle = name; sel.person = null;
    var folk = peopleIn(name);
    Array.prototype.forEach.call(pane.querySelectorAll('.fcol[data-col="0"] .frow'), function (r) {
      r.classList.toggle('on', r.dataset.circle === name);
    });
    col1.innerHTML = peopleCol(folk);
    col1.scrollTop = 0;
    if (!reduced()) {
      col1.removeAttribute('data-fresh'); void col1.offsetWidth;
      col1.setAttribute('data-fresh', '');
      setTimeout(function () { col1.removeAttribute('data-fresh'); }, 360);
    }
    placeMarker();
    chrome(folk, null);
    roll(null, dir);
  }

  /* The mode buttons share one pill that slides to whichever is on. */
  function placePill() {
    var pill = rig.querySelector('.fw-pill');
    var on = rig.querySelector('.fw-modes [data-on]');
    if (!pill || !on) return;
    pill.style.transform = 'translateX(' + (on.offsetLeft - 2) + 'px)';
    pill.style.width = on.offsetWidth + 'px';
  }

  /* Enter (or a double click) starts editing the file where it is shown,
     at its role, the first thing under the name. */
  function editHere() {
    var f = pane.querySelector('.fprev-in [data-field="profession"]');
    if (f) f.click();
  }

  /* Walking off either end of a list gives a little, rather than nothing. */
  function bump(dir) {
    if (reduced()) return;
    var col = rig.querySelector('.fcol[data-col="' + (sel.person ? 1 : 0) + '"] .fw-marker');
    if (!col || !col.animate) return;
    var base = col.style.transform;
    col.animate([
      { transform: base },
      { transform: base + ' translateY(' + (dir * 4) + 'px)' },
      { transform: base }
    ], { duration: 260, easing: 'cubic-bezier(.16,.84,.32,1)' });
  }

  /* A soft light on the window's glass follows the pointer. */
  var fw = rig.querySelector('.fw');
  var onGlass = function (e) {
    var r = fw.getBoundingClientRect();
    fw.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    fw.style.setProperty('--my', (e.clientY - r.top) + 'px');
  };
  fw.addEventListener('pointermove', onGlass);
  fw.addEventListener('pointerenter', function () { fw.setAttribute('data-lit', ''); });
  fw.addEventListener('pointerleave', function () { fw.removeAttribute('data-lit'); });

  var previewSeq = 0;
  /* The highlight is one element that moves, so picking a row reads as the
     selection travelling rather than two rows blinking. */
  function placeMarker() {
    Array.prototype.forEach.call(pane.querySelectorAll('.fcol'), function (col) {
      var marker = col.querySelector('.fw-marker');
      if (!marker) return;
      var on = col.querySelector('.frow.on');
      if (!on) { marker.style.opacity = '0'; return; }
      // layout offsets, not screen rects: the window is often mid-animation
      // (scaling in, rows sliding) and a rect would catch it part way
      marker.style.opacity = '1';
      marker.style.transform = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)';
      marker.style.width = on.offsetWidth + 'px';
      marker.style.height = on.offsetHeight + 'px';
    });
  }

  function preview(p) {
    return '<div class="fprev-in" data-seq="' + (++previewSeq) + '">' +
      '<span class="fic big">' + icon('file') + '</span>' +
      '<h4><span class="edit"' + editableAttrs(p, 'name') + '>' + esc(p.name) + '</span></h4>' +
      '<div class="fkind"><span class="edit"' + editableAttrs(p, 'profession') + '>' +
        esc(p.profession || 'Add a role') + '</span></div>' +
      '<dl>' +
        '<dt style="--i:2">Filed</dt><dd style="--i:2">' + circleChips(p) + '</dd>' +
        '<dt style="--i:3">Company</dt><dd style="--i:3" class="edit"' + editableAttrs(p, 'company') + '>' + esc(p.company || '—') + '</dd>' +
        '<dt style="--i:4">Email</dt><dd style="--i:4" class="edit"' + editableAttrs(p, 'email') + '>' + esc(p.email || '—') + '</dd>' +
        '<dt style="--i:6">Location</dt><dd style="--i:6" class="edit"' + editableAttrs(p, 'location') + '>' + esc(p.location || '—') + '</dd>' +
        '<dt style="--i:7">School</dt><dd style="--i:7">' + schoolChips(p) + '</dd>' +
      '</dl>' +
      editorBlocks(p) +
    '</div>';
  }
  paint();

  rig.addEventListener('click', function (e) {
    var m = e.target.closest('[data-mode]');
    if (m) {
      if (finderMode === m.dataset.mode) return;
      finderMode = m.dataset.mode;
      paint();
      if (!reduced()) { pane.classList.remove('swap'); void pane.offsetWidth; pane.classList.add('swap'); }
      return;
    }
    var c = e.target.closest('[data-circle]');
    if (c) {
      if (c.dataset.circle === sel.circle && finderMode === 'columns') return;
      return pickCircle(c.dataset.circle);
    }
    var pr = e.target.closest('[data-person]');
    if (pr && !e.target.closest('.fprev-in')) return pickPerson(pr.dataset.person);
  });
  rig.addEventListener('dblclick', function (e) {
    var pr = e.target.closest('[data-person]');
    if (pr && !e.target.closest('.fprev-in')) { pickPerson(pr.dataset.person); editHere(); }
  });

  var onKey = function (e) {
    if (!open || view.design !== 'finder') return;
    var folk = sel.circle ? peopleIn(sel.circle) : [];
    var inPeople = !!sel.person;
    var list = inPeople ? folk.map(function (x) { return x.id; }) : cols.map(function (x) { return x.name; });
    var cur = inPeople ? list.indexOf(sel.person) : list.indexOf(sel.circle);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var step = e.key === 'ArrowDown' ? 1 : -1;
      var next = Math.max(0, Math.min(list.length - 1, cur + step));
      if (next === cur) return bump(step);
      return inPeople ? pickPerson(list[next]) : pickCircle(list[next]);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!inPeople && folk.length) return pickPerson(folk[0].id);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (inPeople) return pickPerson(null);
      return;
    }
    if (e.key === 'Enter' && sel.person) { e.preventDefault(); editHere(); }
  };
  document.addEventListener('keydown', onKey);
  // fonts, the window's entrance and the page's width all settle after the
  // first paint; the marker and the pill follow whatever they settle to
  var settle = function () { placePill(); placeMarker(); };
  window.addEventListener('resize', settle);
  requestAnimationFrame(settle);
  fw.addEventListener('animationend', function (e) { if (e.target === fw) settle(); });
  var wrapEl = root.querySelector('.arc-wrap');
  var onWrap = function (e) { if (e.target === wrapEl) settle(); };
  if (wrapEl) wrapEl.addEventListener('transitionend', onWrap);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
  return function () {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', settle);
    if (wrapEl) wrapEl.removeEventListener('transitionend', onWrap);
  };
}





/* ---- wiring ---- */

window.addEventListener('popstate', function () {
  var r = readRoute();
  if (r) {
    if (!open) return show(r.circle, r.person, r.design);
    view.design = r.design; view.circle = r.circle; view.person = r.person;
    render();
  } else if (open) {
    close();
  }
});

document.addEventListener('rootwork:changed', function () {
  if (!open) return;
  paintSlip();                                               // a note may have synced in
  if (document.querySelector('.archive .held')) return;      // mid-drag, leave it alone
  if (signature() === lastSig) return;                       // nothing we draw has moved
  render(true);
});

window.RootworkArchive = {
  open: show,
  route: routeOf,
  /* Filing by company, school or place has no button any more — the simple
     look won — but the capability is still here for a URL or the console. */
  group: function (id) { if (id) setGroup(id); return groupMode; },
  close: close,
  isOpen: function () { return open; },
  design: function (id) { if (id) setDesign(id); return view.design; }
};

document.addEventListener('DOMContentLoaded', wire);
if (document.readyState !== 'loading') wire();
var wired = false;
function wire() {
  if (wired) return;
  wired = true;
  if (window.Rootwork) { R = window.Rootwork; L = R.lib; }
  var btn = document.getElementById('btn-archive');
  if (btn) btn.addEventListener('click', function () { show(null, null); });

  var landed = readRoute();
  if (landed) show(landed.circle, landed.person, landed.design);
  else if (location.hash !== '#map') show(null, null);       // opens here, not on the map

  document.addEventListener('keydown', function (e) {
    if (open) return;
    var t = document.activeElement;
    if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
    if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey) show(null, null);
  });
}
})();
