/* ==========================================================================
   Rootwork — the archive.

   Five ways to read the same network, each a surface of its own rather than a
   panel over the map: its own bar, its own address, its own idea of what a
   folder is. Nothing here owns data — every screen reads the state the map
   draws, and editing happens on the card, which comes to whichever surface
   you are looking at.

     Drawer         cut tabs and colour bands — a filing drawer from above
     Index          everyone at once, set tight, no colour but the pips
     Chroma         no paper at all: each folder a field of its own light
     Desktop        folders, files, a preview pane, a status bar
     Constellation  everyone on a sphere you can spin

   Folders are whatever you say they are — circles, companies, schools or
   towns — so the same six read differently depending on how you file.

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
  { id: 'finder', name: 'Desktop', hint: 'Folders and files, the way a computer keeps them' },
  { id: 'orbit', name: 'Constellation', hint: 'Everyone on a sphere you can spin' }
];
var view = { design: 'drawer', circle: null, person: null };
var WIDE = { finder: 1, orbit: 1, chroma: 1 };
var DESIGN_KEY = 'rootwork.archive.design';
var open = false;
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
function matches(p) {
  if (!query) return true;
  return [p.name, p.profession, p.company, p.location, p.email,
    L.circlesOf(p).join(' '),
    L.schoolsOf(p).map(function (s) { return s.name; }).join(' '),
    (p.log || []).map(function (e) { return e.text; }).join(' ')]
    .join(' ').toLowerCase().indexOf(query) >= 0;
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
  if (groupMode === 'circle' && !query) {
    // an empty circle is still a folder; an empty company is not a thing
    L.circleList().forEach(function (c) {
      var k = c.name.toLowerCase();
      if (!seen[k]) { seen[k] = { name: c.name, n: 0 }; out.push(seen[k]); }
    });
  }
  out.sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  return out;
}

/* Whoever the current filing has nothing to say about. */
function ungrouped() {
  return st().people.filter(function (p) { return !groupsOf(p).length && matches(p); });
}
function personById(id) {
  return st().people.filter(function (p) { return p.id === id; })[0] || null;
}
function roleOf(p) {
  return [p.profession, p.company].filter(Boolean).join(' · ');
}
function homeGroup(p) { return groupsOf(p)[0] || L.primaryCircle(p); }
function seed(str) {                       // a stable number per person, for scatter
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function (n) { h = Math.imul(h ^ (h >>> 15), 2246822507); return Math.abs(h % 1000) / 1000 * (n || 1); };
}

/* ---- editing in place ----
   Every design shows the same record, so every design can change it. A value
   marked data-field turns into an input where it sits; what is typed goes
   back to the person and the map hears about it like any other edit. */

var FIELD_LABELS = {
  name: 'Name', profession: 'Role', company: 'Company', email: 'Email',
  phone: 'Phone', location: 'Where'
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
    p.updated = Date.now();
    L.save();                                  // writes, re-renders the map
    render(true);                              // and this surface, without the fanfare
  }
  box.addEventListener('blur', function () { finish(true); });
  box.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
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
      '<div class="arc-find">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
        '<input id="arc-q" type="search" placeholder="Find anyone" autocomplete="off" aria-label="Find anyone">' +
      '</div>' +
      '<button class="arc-map" id="arc-close" title="Back to the map (Esc)">The map</button>' +
    '</header>' +
    '<div class="arc-scroll" id="arc-scroll"><div class="arc-wrap">' +
      '<div class="arc-head" id="arc-head"></div>' +
      '<div class="arc-body" id="arc-body"></div>' +
    '</div></div>';
  document.body.appendChild(root);
  scroll = $('#arc-scroll', root);
  head = $('#arc-head', root);
  body = $('#arc-body', root);

  $('#arc-close', root).addEventListener('click', close);
  root.addEventListener('click', function (e) {
    var f = e.target.closest('[data-field][data-for]');
    if (f) { e.stopPropagation(); editValue(f); }
  }, true);
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var f = e.target.closest && e.target.closest('[data-field][data-for]');
    if (f && !f.querySelector('input')) { e.preventDefault(); editValue(f); }
  });

  $('#arc-home', root).addEventListener('click', function () {
    view.circle = null; view.person = null; query = ''; $('#arc-q', root).value = ''; render();
  });
  var qbox = $('#arc-q', root);
  qbox.addEventListener('input', function () {
    query = qbox.value.trim().toLowerCase();
    clearTimeout(qTimer);
    qTimer = setTimeout(render, 140);
  });
  qbox.addEventListener('keydown', function (e) { e.stopPropagation(); });
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
  if (view.person) {
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

function renderHead() {
  var s = st();
  var crumbs = ['<button data-crumb="root">Rootwork</button>'];
  if (view.circle) {
    crumbs.push('<span class="sep">/</span>');
    crumbs.push(view.person
      ? '<button data-crumb="circle">' + esc(view.circle) + '</button>'
      : '<span class="here">' + esc(view.circle) + '</span>');
  }
  if (view.person) {
    var pp = personById(view.person);
    crumbs.push('<span class="sep">/</span><span class="here">' + esc(pp ? pp.name : '?') + '</span>');
  }

  var sub;
  if (view.person) {
    var p = personById(view.person);
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
    '<div class="crumb">' + crumbs.join('') + '</div>' +
    '<h1 class="arc-title">' + words(titleFor()) + '</h1>' +
    '<div class="apparatus">' +
      '<div class="arc-sub">' + sub.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
      '<div class="designs" role="group" aria-label="Archive design">' +
        DESIGNS.map(function (d) {
          return '<button data-design="' + d.id + '"' + (view.design === d.id ? ' data-on="1"' : '') +
            ' title="' + esc(d.hint) + '">' + esc(d.name) + '</button>';
        }).join('') +
      '</div>' +
    '</div>';
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
    groupMode, query, view.design, view.circle, view.person].join('~');
}
var lastSig = '';

/* Each renderer gets a clean element and says how to tear itself down.
   A quiet render is one nobody asked for — data caught up underneath — so it
   arrives without the animations a navigation deserves. */
var teardown = null;
function render(quiet) {
  if (!open) return;
  if (teardown) { try { teardown(); } catch (e) { } teardown = null; }
  lastSig = signature();
  // a workspace wants the whole window; a document wants a column
  var wrap = root.querySelector('.arc-wrap');
  if (wrap) wrap.classList.toggle('wide', WIDE[view.design] && !view.person);
  renderHead();
  body.className = 'arc-body' + (quiet ? ' still' : '');
  body.innerHTML = '';
  var fn = view.design === 'index' ? drawIndex
    : view.design === 'chroma' ? drawChroma
    : view.design === 'finder' ? drawFinder
    : view.design === 'orbit' ? drawOrbit
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

function setDesign(id) {
  if (view.design === id) return;
  view.design = id;
  // only the drawer opens a person on their own page; everywhere else the
  // name in the header would be describing something not on screen
  view.person = null;
  try { localStorage.setItem(DESIGN_KEY, id); } catch (e) { }
  scroll.scrollTop = 0;
  render();
  writeRoute();
}

function show(circle, person, design) {
  if (!window.Rootwork) return;
  R = window.Rootwork; L = R.lib;
  if (!root) build();
  view.circle = circle || null;
  view.person = person || null;
  if (design) view.design = design;
  else { try { view.design = localStorage.getItem(DESIGN_KEY) || view.design; } catch (e) { } }
  try { groupMode = localStorage.getItem(GROUP_KEY) || groupMode; } catch (e) { }
  open = true;
  root.hidden = false;
  document.body.classList.add('archived');
  render();
  writeRoute(true);
  requestAnimationFrame(function () { root.classList.add('in'); });
  root.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
}

function close() {
  if (!open) return;
  open = false;
  root.classList.remove('in');
  document.body.classList.remove('archived');
  if (L && L.closeCard) L.closeCard();
  releaseCard();
  try { history.pushState(null, '', '#map'); } catch (e) { }
  var done = function () { if (!open) root.hidden = true; };
  if (reduced()) done(); else setTimeout(done, 300);
  if (teardown) { try { teardown(); } catch (e) { } teardown = null; }
}

function back() {
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
function openCircle(name) { view.circle = name; view.person = null; render(); writeRoute(); scroll.scrollTop = 0; }

/* The card is the one place anything is edited, so it comes to whichever
   surface you are on rather than sending you back to the map.

   A fixed element makes its own stacking context, so the card cannot simply
   be raised above this one — it is moved into it while the archive is the
   surface in front, and handed back when the archive closes. Moving the node
   keeps its handlers and its contents; only its parent changes. */
var cardHome = null;

function holdCard() {
  var d = document.getElementById('dossier');
  if (!d || d.parentNode === root) return;
  cardHome = d.parentNode;
  root.appendChild(d);
}

function releaseCard() {
  var d = document.getElementById('dossier');
  if (d && cardHome && d.parentNode === root) cardHome.appendChild(d);
  cardHome = null;
}

function editCard(id) {
  holdCard();
  L.openCard(id);
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
              '<span class="who"><span>' + esc(p.name) + '</span>' +
                (roleOf(p) ? '<span class="role">' + esc(roleOf(p)) + '</span>' : '') +
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
    ['Email', p.email, 'email'], ['Phone', p.phone, 'phone'],
    ['Profession', p.profession, 'profession'], ['Company', p.company, 'company'],
    ['Location', p.location, 'location'],
    ['Schools', L.schoolsOf(p).map(function (s) { return s.name + (s.level ? ' (' + s.level + ')' : ''); }).join(', ')],
    ['Filed under', L.circlesOf(p).join(' · ')]
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
        var body = f[1] ? esc(f[1]) : '<span class="none">—</span>';
        return '<dt>' + esc(f[0]) + '</dt><dd>' + (f[2]
          ? '<span class="edit"' + editableAttrs(p, f[2]) + '>' + body + '</span>'
          : body) + '</dd>';
      }).join('') + '</dl>' +
    '</div>'
  ];

  (p.notes || []).forEach(function (n) {
    sheets.push('<div class="sheet slip" style="--d:' + (d++) + '"><p>' + esc(n.t) + '</p></div>');
  });

  if (p.log.length) {
    p.log.forEach(function (e, i) {
      sheets.push('<div class="sheet entry" style="--d:' + (d++) + ';--r:' + (i % 2 ? '.3' : '-.25') + 'deg">' +
        '<div class="margin">' + esc(L.channelLabel(e.channel)) + '<br>' + esc(L.fmtDate(e.at)) + '</div>' +
        '<div><p>' + esc(e.text) + '</p>' +
          (e.learned ? '<div class="learned">' + esc(e.learned) + '</div>' : '') +
        '</div></div>');
    });
  } else {
    sheets.push('<div class="sheet blank" style="--d:' + (d++) + '">No touchpoints on file</div>');
  }

  file.innerHTML =
    '<div class="tab">' + esc(home) + '</div>' +
    '<div class="jacket">' +
      (extra.length ? '<div class="edge">' + extra.map(function (c) {
        return '<span style="--c:' + hueVar(c) + '">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="sheets">' + sheets.join('') + '</div>' +
      '<div class="acts">' +
        '<button class="btn" data-edit="' + p.id + '">Open the card</button>' +
        '<button class="btn" data-back>Back to the drawer</button>' +
      '</div>' +
    '</div>';
  host.appendChild(file);

  file.addEventListener('click', function (e) {
    var b = e.target.closest('[data-edit]');
    if (b) return editCard(b.dataset.edit);
    if (e.target.closest('[data-back]')) back();
  });
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
   A crosshair tracks the row you are on and the detail types itself out in
   the margin.
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
          '<span class="ix-name">' + esc(p.name) + '</span>' +
          '<span class="ix-fact">' + esc(roleOf(p) || (sch ? sch.name : '\u2014')) + '</span>' +
          '<span class="ix-where">' + esc(p.location || '') + '</span>' +
          '<span class="ix-tags">' + L.circlesOf(p).map(function (c) {
            return '<i style="background:' + hueVar(c) + '"></i>'; }).join('') + '</span>' +
          '<span class="ix-when">' + esc(p.log.length ? L.ago(L.lastTouch(p)) : '\u2014') + '</span>' +
        '</button>';
      }).join('') +
    '</div>' +
    '<div class="ix-read" id="ix-read" aria-hidden="true"></div>';
  host.appendChild(rig);

  var cross = el('div', 'ix-cross');
  $('#ix-grid', rig).appendChild(cross);

  var read = $('#ix-read', rig);
  var typer = null;
  function type(p) {
    clearInterval(typer);
    if (!p) { read.textContent = ''; read.removeAttribute('data-on'); return; }
    var bits = [p.name, roleOf(p), p.location, L.circlesOf(p).join(' / '),
      p.log.length ? 'last touched ' + L.ago(L.lastTouch(p)) : 'no touchpoints'];
    var line = bits.filter(Boolean).join('  \u00b7  ');
    read.setAttribute('data-on', '');
    if (reduced()) { read.textContent = line; return; }
    var i = 0;
    read.textContent = '';
    typer = setInterval(function () {
      read.textContent = line.slice(0, ++i);
      if (i >= line.length) clearInterval(typer);
    }, 11);
  }

  rig.addEventListener('pointerover', function (e) {
    var r = e.target.closest('.ix-row');
    if (!r) return;
    rig.querySelectorAll('.ix-row[data-on]').forEach(function (x) { x.removeAttribute('data-on'); });
    r.setAttribute('data-on', '');
    cross.style.top = (r.offsetTop + r.offsetHeight - 1) + 'px';
    cross.setAttribute('data-on', '');
    type(personById(r.dataset.person));
  });
  rig.addEventListener('pointerleave', function () { type(null); cross.removeAttribute('data-on'); });
  rig.addEventListener('click', function (e) {
    var f = e.target.closest('[data-folder]');
    if (f) { view.circle = f.dataset.folder || null; return render(); }
    var r = e.target.closest('[data-person]');
    if (r) { view.design = 'drawer'; return openPerson(r.dataset.person); }
  });

  return function () { clearInterval(typer); };
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
          '<span>' + String(g.people.length).padStart(2, '0') + ' entries</span></header>' +
        '<div class="ch-names">' +
          (g.people.length ? g.people.map(function (p, i) {
            return '<button class="ch-name" data-person="' + p.id + '" style="--d:' + i + '">' +
              '<span class="ch-t">' + esc(p.name) + '</span>' +
              '<span class="ch-s">' + esc(roleOf(p) || (p.location || '')) + '</span>' +
            '</button>';
          }).join('') : '<span class="ch-empty">empty</span>') +
        '</div>' +
      '</section>';
    }).join('') +
    '<div class="ch-scrim" id="ch-scrim" hidden></div>' +
    '<div class="ch-pane" id="ch-pane" hidden></div>';
  host.appendChild(rig);

  var aura = $('#ch-aura', rig);
  var onMove = function (e) {
    var r = rig.getBoundingClientRect();
    aura.style.setProperty('--ax', (e.clientX - r.left) + 'px');
    aura.style.setProperty('--ay', (e.clientY - r.top) + 'px');
  };
  rig.addEventListener('pointermove', onMove);

  var pane = $('#ch-pane', rig);
  var scrim = $('#ch-scrim', rig);
  function showPane(p, from) {
    var sch = L.schoolsOf(p).map(function (s) { return s.name + (s.level ? ' ' + s.level : ''); }).join(' \u00b7 ');
    pane.style.setProperty('--hue', hueVar(homeGroup(p)));
    pane.innerHTML =
      '<button class="ch-x" data-close aria-label="Close">\u00d7</button>' +
      '<div class="ch-kicker">' + esc(L.circlesOf(p).join(' \u00b7 ')) + '</div>' +
      '<h3><span class="edit"' + editableAttrs(p, 'name') + '>' + esc(p.name) + '</span></h3>' +
      '<div class="ch-role"><span class="edit"' + editableAttrs(p, 'profession') + '>' +
        esc(p.profession || 'Add a role') + '</span></div>' +
      '<dl>' +
        '<dt>Company</dt><dd class="edit"' + editableAttrs(p, 'company') + '>' + esc(p.company || '—') + '</dd>' +
        '<dt>Mail</dt><dd class="edit"' + editableAttrs(p, 'email') + '>' + esc(p.email || '—') + '</dd>' +
        '<dt>Ring</dt><dd class="edit"' + editableAttrs(p, 'phone') + '>' + esc(p.phone || '—') + '</dd>' +
        '<dt>Where</dt><dd class="edit"' + editableAttrs(p, 'location') + '>' + esc(p.location || '—') + '</dd>' +
        (sch ? '<dt>Read at</dt><dd>' + esc(sch) + '</dd>' : '') +
        '<dt>Last</dt><dd>' + esc(p.log.length ? L.ago(L.lastTouch(p)) : 'no touchpoints') + '</dd>' +
      '</dl>' +
      (p.log[0] ? '<p class="ch-last">\u201c' + esc(p.log[0].text) + '\u201d</p>' : '') +
      '<div class="ch-acts">' +
        '<button class="btn" data-edit="' + p.id + '">Open the card</button>' +
        '<button class="btn" data-file="' + p.id + '">See the file</button>' +
      '</div>';
    // it opens from the name you clicked, wherever that is on screen, and
    // sits in the middle of the window rather than the middle of the page
    var r = from.getBoundingClientRect();
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    pane.style.setProperty('--fx', ((r.left + r.width / 2) - cx).toFixed(0) + 'px');
    pane.style.setProperty('--fy', ((r.top + r.height / 2) - cy).toFixed(0) + 'px');
    scrim.hidden = false;
    pane.hidden = false;
    requestAnimationFrame(function () {
      scrim.classList.add('on');
      pane.classList.add('on');
    });
  }
  function hidePane() {
    pane.classList.remove('on');
    scrim.classList.remove('on');
    setTimeout(function () {
      if (pane.classList.contains('on')) return;
      pane.hidden = true; scrim.hidden = true;
    }, reduced() ? 0 : 340);
  }

  var onKey = function (e) {
    if (e.key === 'Escape' && !pane.hidden) { e.stopPropagation(); hidePane(); }
  };
  document.addEventListener('keydown', onKey, true);

  rig.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) return hidePane();
    var ed = e.target.closest('[data-edit]');
    if (ed) return editCard(ed.dataset.edit);
    var fi = e.target.closest('[data-file]');
    if (fi) { view.design = 'drawer'; return openPerson(fi.dataset.file); }
    var n = e.target.closest('[data-person]');
    if (n) return showPane(personById(n.dataset.person), n);
    if (!e.target.closest('.ch-pane')) hidePane();
  });

  return function () {
    rig.removeEventListener('pointermove', onMove);
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

  var rig = el('div', 'finder');
  rig.innerHTML =
    '<div class="fw">' +
      '<div class="fw-bar">' +
        '<span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="fw-path" id="fw-path"></span>' +
        '<span class="fw-modes">' +
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
      ? '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8h-7L10.5 5.5h-6A1.5 1.5 0 0 0 3 7z"/></svg>'
      : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/></svg>';
  }

  function sizeOf(p) {                      // something file-like to sort and show
    var bytes = 180 + (p.log || []).reduce(function (a, e) { return a + e.text.length; }, 0)
      + (p.notes || []).reduce(function (a, n) { return a + n.t.length; }, 0);
    return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
  }

  function paint() {
    var folk = sel.circle ? peopleIn(sel.circle) : [];
    var p = sel.person ? personById(sel.person) : null;

    $('#fw-path', rig).innerHTML =
      '<b>Rootwork</b>' + (sel.circle ? ' <span>\u203a</span> ' + esc(sel.circle) : '') +
      (p ? ' <span>\u203a</span> ' + esc(p.name) + '.card' : '');

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
          '<span class="fnm">' + esc(x.name) + '</span>' +
          '<span class="fsz">' + esc(sizeOf(x)) + '</span>' +
        '</div>';
      }).join('');
    } else {
      pane.className = 'fw-cols';
      pane.innerHTML =
        '<div class="fcol" data-col="0">' + cols.map(function (c, ci) {
          return '<button class="frow' + (sel.circle === c.name ? ' on' : '') + '" data-circle="' + esc(c.name) + '" style="--r:' + ci + '">' +
            '<span class="fic" style="color:' + hueVar(c.name) + '">' + icon('folder') + '</span>' +
            '<span class="fnm">' + esc(c.name) + '</span>' +
            '<span class="fct">' + c.n + '</span>' +
            '<span class="fch">\u203a</span>' +
          '</button>';
        }).join('') + '</div>' +
        '<div class="fcol" data-col="1">' + (folk.length ? folk.map(function (x, xi) {
          return '<button class="frow' + (sel.person === x.id ? ' on' : '') + '" data-person="' + x.id + '" style="--r:' + xi + '">' +
            '<span class="fic">' + icon('file') + '</span>' +
            '<span class="fnm">' + esc(x.name) + '</span>' +
            '<span class="fct">' + esc(sizeOf(x)) + '</span>' +
          '</button>';
        }).join('') : '<div class="fempty">empty folder</div>') + '</div>' +
        '<div class="fcol fprev" data-col="2">' + (p ? preview(p) : '<div class="fempty">no file selected</div>') + '</div>';
    }

    $('#fw-foot', rig).innerHTML =
      '<span>' + cols.length + ' folder' + (cols.length === 1 ? '' : 's') + '</span>' +
      '<span>' + folk.length + ' item' + (folk.length === 1 ? '' : 's') + (sel.circle ? ' in ' + esc(sel.circle) : '') + '</span>' +
      '<span class="fw-tip">\u2191\u2193 move \u00b7 \u2192 open \u00b7 \u21b5 edit</span>';
  }

  function preview(p) {
    var sch = L.schoolsOf(p).map(function (s) { return s.name + (s.level ? ' ' + s.level : ''); }).join(', ');
    return '<div class="fprev-in">' +
      '<span class="fic big">' + icon('file') + '</span>' +
      '<h4><span class="edit"' + editableAttrs(p, 'name') + '>' + esc(p.name) + '</span></h4>' +
      '<div class="fkind"><span class="edit"' + editableAttrs(p, 'profession') + '>' +
        esc(p.profession || 'Add a role') + '</span></div>' +
      '<dl>' +
        '<dt>Kind</dt><dd>Rootwork entry</dd>' +
        '<dt>Size</dt><dd>' + esc(sizeOf(p)) + '</dd>' +
        '<dt>Filed</dt><dd>' + esc(L.circlesOf(p).join(', ')) + '</dd>' +
        '<dt>Company</dt><dd class="edit"' + editableAttrs(p, 'company') + '>' + esc(p.company || '—') + '</dd>' +
        '<dt>Mail</dt><dd class="edit"' + editableAttrs(p, 'email') + '>' + esc(p.email || '—') + '</dd>' +
        '<dt>Phone</dt><dd class="edit"' + editableAttrs(p, 'phone') + '>' + esc(p.phone || '—') + '</dd>' +
        '<dt>Where</dt><dd class="edit"' + editableAttrs(p, 'location') + '>' + esc(p.location || '—') + '</dd>' +
        (sch ? '<dt>School</dt><dd>' + esc(sch) + '</dd>' : '') +
        '<dt>Opened</dt><dd>' + esc(p.log.length ? L.fmtDate(L.lastTouch(p)) : 'never') + '</dd>' +
        '<dt>Entries</dt><dd>' + p.log.length + '</dd>' +
      '</dl>' +
      (p.log[0] ? '<p class="flast">' + esc(p.log[0].text) + '</p>' : '') +
      '<div class="facts">' +
        '<button class="btn" data-edit="' + p.id + '">Open the card</button>' +
        '<button class="btn" data-file="' + p.id + '">See the file</button>' +
      '</div>' +
    '</div>';
  }
  paint();

  rig.addEventListener('click', function (e) {
    var m = e.target.closest('[data-mode]');
    if (m) { finderMode = m.dataset.mode; return paint(); }
    var ed = e.target.closest('[data-edit]');
    if (ed) return editCard(ed.dataset.edit);
    var fi = e.target.closest('[data-file]');
    if (fi) { view.design = 'drawer'; return openPerson(fi.dataset.file); }
    var c = e.target.closest('[data-circle]');
    if (c) {
      sel.circle = c.dataset.circle; sel.person = null;
      paint();
      var col = rig.querySelector('.fcol[data-col="1"]');
      if (col && !reduced()) {
        col.setAttribute('data-fresh', '');
        setTimeout(function () { col.removeAttribute('data-fresh'); }, 360);
      }
      return;
    }
    var pr = e.target.closest('[data-person]');
    if (pr) { sel.person = pr.dataset.person; return paint(); }
  });
  rig.addEventListener('dblclick', function (e) {
    var pr = e.target.closest('[data-person]');
    if (pr) editCard(pr.dataset.person);
  });

  var onKey = function (e) {
    if (!open || view.design !== 'finder') return;
    var folk = sel.circle ? peopleIn(sel.circle) : [];
    var inPeople = !!sel.person;
    var list = inPeople ? folk.map(function (x) { return x.id; }) : cols.map(function (x) { return x.name; });
    var cur = inPeople ? list.indexOf(sel.person) : list.indexOf(sel.circle);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var next = Math.max(0, Math.min(list.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      if (inPeople) sel.person = list[next]; else { sel.circle = list[next]; sel.person = null; }
      return paint();
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!inPeople && folk.length) { sel.person = folk[0].id; return paint(); }
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (inPeople) { sel.person = null; return paint(); }
      return;
    }
    if (e.key === 'Enter' && sel.person) { e.preventDefault(); editCard(sel.person); }
  };
  document.addEventListener('keydown', onKey);
  return function () { document.removeEventListener('keydown', onKey); };
}


/* ==========================================================================
   Design 9 — Constellation
   Everyone as a lit sphere in real depth. Each group gets its own direction
   out from the centre, labelled at the end of its axis, and its people sit
   around that heading — so the shape of the thing is the shape of your
   network. Drag to spin, scroll to come closer.
   ========================================================================== */

function drawOrbit(host) {
  var groups = circles().filter(function (g) { return peopleIn(g.name).length; });
  var everyone = st().people.filter(matches);
  if (!everyone.length) return emptyState(host, 'Nothing to plot yet.');

  var rig = el('div', 'orbit');
  rig.innerHTML =
    '<div class="or-stage" id="or-stage">' +
      '<svg class="or-rays" id="or-rays" aria-hidden="true"></svg>' +
      '<div class="or-field" id="or-field"></div>' +
    '</div>' +
    '<div class="or-read" id="or-read" aria-live="polite"></div>' +
    '<div class="or-hint">drag to spin \u00b7 scroll to come closer \u00b7 click a point</div>';
  host.appendChild(rig);

  var stage = $('#or-stage', rig);
  var field = $('#or-field', rig);
  var rays = $('#or-rays', rig);

  /* Each group gets its own heading out from the centre, spread evenly over
     the sphere by the golden angle; its people sit around that heading. The
     projection is done here rather than in CSS 3D, so depth sorting, fading
     and hit areas are all under control and nothing foreshortens. */
  var dirs = {};
  var n = Math.max(1, groups.length);
  groups.forEach(function (g, i) {
    var y = 1 - (i + 0.5) / n * 2;
    var r = Math.sqrt(Math.max(0, 1 - y * y));
    var th = Math.PI * (3 - Math.sqrt(5)) * i;
    dirs[g.name] = { x: Math.cos(th) * r, y: y, z: Math.sin(th) * r };
  });

  var R = 240;
  var items = [];
  groups.forEach(function (g) {
    var d = dirs[g.name];
    items.push({
      kind: 'axis', label: g.name, hue: hueVar(g.name),
      x: d.x * R * 1.2, y: d.y * R * 1.2, z: d.z * R * 1.2
    });
  });
  everyone.forEach(function (p) {
    var home = groupsOf(p)[0];
    var d = dirs[home] || { x: 0, y: 0, z: 0 };
    var rnd = seed(p.id);
    var vx = d.x + (rnd(1) - .5) * .7, vy = d.y + (rnd(1) - .5) * .7, vz = d.z + (rnd(1) - .5) * .7;
    var len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    var reach = home ? (0.55 + rnd(1) * 0.45) : 0.3;
    items.push({
      kind: 'point', ref: p, label: p.name,
      hue: home ? hueOfGroup(home) : 'var(--faint)',
      size: 14 + Math.min(20, (p.log ? p.log.length : 0) * 3),
      x: vx / len * R * reach, y: vy / len * R * reach, z: vz / len * R * reach
    });
  });
  items.push({ kind: 'core', label: (st().me && st().me.name) || 'Me', x: 0, y: 0, z: 0, size: 26 });

  field.innerHTML = items.map(function (it, i) {
    if (it.kind === 'axis') {
      return '<button class="or-axis" data-i="' + i + '" data-axis="' + esc(it.label) + '"' +
        ' style="--hue:' + it.hue + '">' + esc(it.label) + '</button>';
    }
    if (it.kind === 'core') {
      return '<div class="or-core" data-i="' + i + '"><i></i><span>' + esc(it.label) + '</span></div>';
    }
    return '<button class="or-pt" data-i="' + i + '" data-person="' + it.ref.id + '"' +
      ' style="--hue:' + it.hue + '; --s:' + it.size + 'px; --d:' + i + '">' +
      '<i></i><span class="or-name">' + esc(it.label) + '</span></button>';
  }).join('');

  var els = Array.prototype.slice.call(field.children);

  var rot = { x: -0.2, y: 0.3 };
  var dist = 900, spin = 0.0016, idle = true;

  function project() {
    var w = stage.clientWidth, h = stage.clientHeight;
    var cx = w / 2, cy = h / 2;
    var sx = Math.sin(rot.x), cxr = Math.cos(rot.x);
    var sy = Math.sin(rot.y), cyr = Math.cos(rot.y);
    var order = [];
    items.forEach(function (it, i) {
      // turn about Y, then about X
      var x1 = it.x * cyr + it.z * sy;
      var z1 = -it.x * sy + it.z * cyr;
      var y1 = it.y * cxr - z1 * sx;
      var z2 = it.y * sx + z1 * cxr;
      var k = dist / (dist - z2);
      order.push({ i: i, z: z2, x: cx + x1 * k, y: cy + y1 * k, k: k });
    });
    // a ray out to each heading, and two rings about the centre, so the shape
    // of the field reads even where there is nothing lit
    var core = order[order.length - 1];
    var lines = [];
    items.forEach(function (it, i) {
      if (it.kind !== 'axis') return;
      var o = order[i];
      lines.push('<line x1="' + core.x.toFixed(1) + '" y1="' + core.y.toFixed(1) +
        '" x2="' + o.x.toFixed(1) + '" y2="' + o.y.toFixed(1) + '" style="stroke:' + it.hue +
        '" opacity="' + (0.1 + Math.max(0, (o.z + R) / (R * 2)) * 0.3).toFixed(2) + '"/>');
    });
    [0.34, 0.62].forEach(function (f) {
      lines.push('<ellipse cx="' + core.x.toFixed(1) + '" cy="' + core.y.toFixed(1) +
        '" rx="' + (R * f * core.k).toFixed(1) + '" ry="' + (R * f * core.k * Math.abs(Math.sin(rot.x))).toFixed(1) +
        '" class="ring"/>');
    });
    rays.setAttribute('width', w); rays.setAttribute('height', h);
    rays.innerHTML = lines.join('');

    var back = order.slice().sort(function (a, b) { return a.z - b.z; });
    back.forEach(function (o, rank) {
      var e = els[o.i];
      if (!e) return;
      e.style.transform = 'translate3d(' + o.x.toFixed(1) + 'px,' + o.y.toFixed(1) + 'px,0) ' +
        'translate(-50%,-50%) scale(' + o.k.toFixed(3) + ')';
      e.style.zIndex = String(rank + 1);
      // the far side of the sphere sits back into the dark
      var far = (o.z + R) / (R * 2);
      e.style.opacity = (0.34 + far * 0.66).toFixed(3);
    });
  }

  var raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (idle && !reduced()) rot.y += spin;
    project();
  }
  project();
  if (!reduced()) frame();

  var drag = null;
  stage.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, rx: rot.x, ry: rot.y, moved: false };
    idle = false;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('held');
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
    rot.y = drag.ry + (e.clientX - drag.x) * 0.006;
    rot.x = Math.max(-1.2, Math.min(1.2, drag.rx + (e.clientY - drag.y) * 0.006));
    if (reduced()) project();
  });
  var release = function () {
    if (!drag) return;
    drag = null;
    stage.classList.remove('held');
    setTimeout(function () { idle = true; }, 2200);
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  var onWheel = function (e) {
    if (!rig.contains(e.target)) return;
    e.preventDefault();
    dist = Math.max(430, Math.min(1800, dist + e.deltaY));
    project();
  };
  scroll.addEventListener('wheel', onWheel, { passive: false });

  var read = $('#or-read', rig);
  rig.addEventListener('pointerover', function (e) {
    var b = e.target.closest('.or-pt');
    if (!b) return;
    var p = personById(b.dataset.person);
    if (!p) return;
    read.innerHTML = '<b>' + esc(p.name) + '</b>' +
      (roleOf(p) ? '<span>' + esc(roleOf(p)) + '</span>' : '') +
      '<span>' + esc(groupsOf(p).join(' \u00b7 ') || 'unfiled') + '</span>' +
      '<span>' + esc(p.log.length ? L.ago(L.lastTouch(p)) : 'no touchpoints') + '</span>';
    read.setAttribute('data-on', '');
  });
  rig.addEventListener('pointerout', function (e) {
    if (e.target.closest('.or-pt')) read.removeAttribute('data-on');
  });
  rig.addEventListener('click', function (e) {
    var a = e.target.closest('[data-axis]');
    if (a) { view.circle = a.dataset.axis; return render(); }
    var b = e.target.closest('[data-person]');
    if (b) return editCard(b.dataset.person);
  });

  var onResize = function () { project(); };
  window.addEventListener('resize', onResize);

  return function () {
    cancelAnimationFrame(raf);
    scroll.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
  };
}

function meName() { return (st().me && st().me.name) || 'Me'; }

function lastEdited() {
  var t = 0;
  st().people.forEach(function (p) { t = Math.max(t, p.updated || p.created || 0); });
  return t ? L.fmtDate(t) : 'never';
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
