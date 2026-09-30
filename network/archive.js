/* ==========================================================================
   Rootwork — the archive.

   The map, filed three ways. The canvas keeps running underneath; this is a
   drawer pulled out over it, not a different app, so nothing here owns data:
   every screen reads the same state the canvas draws and hands editing back
   to the card.

     Drawer      cut tabs and colour bands — a filing drawer seen from above
     Rolodex     one card at a time on a spindle, flipped front to back
     Light table sheets loose on a table, dragged around under a lamp

   Shared chrome, three renderers. Each renderer owns a root element and is
   torn down whole on a switch, so no state leaks between them.
   ========================================================================== */
(function () {
'use strict';

var R = null;                  // window.Rootwork, once app.js has run
var L = null;                  // its helpers
var root = null, scroll = null, head = null, body = null;
var DESIGNS = [
  { id: 'drawer', name: 'Drawer', hint: 'A filing drawer, seen from above' },
  { id: 'rolodex', name: 'Rolodex', hint: 'One card at a time, on a spindle' },
  { id: 'table', name: 'Light table', hint: 'Sheets loose under a lamp' },
  { id: 'index', name: 'Index', hint: 'Everyone at once, set tight' },
  { id: 'sublime', name: 'Sublime', hint: 'One name at a time, in the dark' },
  { id: 'chroma', name: 'Chroma', hint: 'Light and type, no paper at all' },
  { id: 'finder', name: 'Desktop', hint: 'Folders and files, the way a computer keeps them' }
];
var view = { design: 'drawer', circle: null, person: null };
var DESIGN_KEY = 'rootwork.archive.design';
var open = false;

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
function hueVar(circle) { return 'var(--h' + L.circleIndex(circle) + ')'; }
function peopleIn(circle) {
  return st().people.filter(function (p) { return L.inCircle(p, circle); })
    .sort(function (a, b) { return L.lastTouch(b) - L.lastTouch(a); });
}
function circles() { return L.circleList(); }
function personById(id) {
  return st().people.filter(function (p) { return p.id === id; })[0] || null;
}
function roleOf(p) {
  return [p.profession, p.company].filter(Boolean).join(' · ');
}
function seed(str) {                       // a stable number per person, for scatter
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function (n) { h = Math.imul(h ^ (h >>> 15), 2246822507); return Math.abs(h % 1000) / 1000 * (n || 1); };
}

/* ---- chrome ---- */

function build() {
  root = el('div', 'archive');
  root.id = 'archive';
  root.hidden = true;
  root.innerHTML =
    '<div class="arc-veil"></div>' +
    '<button class="arc-close" id="arc-close" aria-label="Close the archive" title="Close (Esc)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
    '</button>' +
    '<div class="arc-scroll" id="arc-scroll"><div class="arc-wrap">' +
      '<div class="arc-head" id="arc-head"></div>' +
      '<div class="arc-body" id="arc-body"></div>' +
    '</div></div>';
  document.body.appendChild(root);
  scroll = $('#arc-scroll', root);
  head = $('#arc-head', root);
  body = $('#arc-body', root);

  $('#arc-close', root).addEventListener('click', close);
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); back(); }
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
      '<b>' + circles().length + '</b> folders',
      '<b>' + s.people.reduce(function (a, p) { return a + p.log.length; }, 0) + '</b> touchpoints'
    ];
  }

  head.innerHTML =
    '<div class="crumb">' + crumbs.join('') + '</div>' +
    '<h1 class="arc-title">' + esc(titleFor()) + '</h1>' +
    '<div class="arc-sub">' + sub.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' +
    '<div class="designs" role="group" aria-label="Archive design">' +
      DESIGNS.map(function (d) {
        return '<button data-design="' + d.id + '"' + (view.design === d.id ? ' data-on="1"' : '') +
          ' title="' + esc(d.hint) + '">' + esc(d.name) + '</button>';
      }).join('') +
    '</div>';
}

/* Each renderer gets a clean element and says how to tear itself down. */
var teardown = null;
function render() {
  if (!open) return;
  if (teardown) { try { teardown(); } catch (e) { } teardown = null; }
  renderHead();
  body.innerHTML = '';
  var fn = view.design === 'rolodex' ? drawRolodex
    : view.design === 'table' ? drawTable
    : view.design === 'index' ? drawIndex
    : view.design === 'sublime' ? drawSublime
    : view.design === 'chroma' ? drawChroma
    : view.design === 'finder' ? drawFinder
    : drawDrawer;
  teardown = fn(body) || null;
}

function setDesign(id) {
  if (view.design === id) return;
  view.design = id;
  try { localStorage.setItem(DESIGN_KEY, id); } catch (e) { }
  scroll.scrollTop = 0;
  render();
}

function show(circle, person) {
  if (!window.Rootwork) return;
  R = window.Rootwork; L = R.lib;
  if (!root) build();
  view.circle = circle || null;
  view.person = person || null;
  try { view.design = localStorage.getItem(DESIGN_KEY) || view.design; } catch (e) { }
  open = true;
  root.hidden = false;
  document.body.classList.add('archived');
  render();
  requestAnimationFrame(function () { root.classList.add('in'); });
  root.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
}

function close() {
  if (!open) return;
  open = false;
  root.classList.remove('in');
  document.body.classList.remove('archived');
  var done = function () { if (!open) root.hidden = true; };
  if (reduced()) done(); else setTimeout(done, 300);
  if (teardown) { try { teardown(); } catch (e) { } teardown = null; }
}

function back() {
  if (view.person) { view.person = null; return render(); }
  if (view.circle) { view.circle = null; return render(); }
  close();
}

function openPerson(id) { view.person = id; render(); scroll.scrollTop = 0; }
function openCircle(name) { view.circle = name; view.person = null; render(); scroll.scrollTop = 0; }

/* Hand a person back to the map, where everything is editable. */
function editCard(id) {
  close();
  setTimeout(function () { L.openCard(id); }, reduced() ? 0 : 240);
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
            var extra = L.circlesOf(p).filter(function (x) { return x !== c.name; });
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
      return openPerson(p.dataset.person);
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
  var home = view.circle || L.primaryCircle(p);
  var extra = L.circlesOf(p).filter(function (x) { return x !== home; });

  var file = el('div', 'file');
  file.style.setProperty('--hue', hueVar(home));
  file.style.setProperty('--tab-x', '18px');

  var facts = [
    ['Email', p.email], ['Phone', p.phone],
    ['Profession', p.profession], ['Company', p.company],
    ['Location', p.location],
    ['Schools', L.schoolsOf(p).map(function (s) { return s.name + (s.level ? ' (' + s.level + ')' : ''); }).join(', ')],
    ['Filed under', L.circlesOf(p).join(' · ')],
    ['Tags', (p.tags || []).map(function (t) { return '#' + t; }).join(' ')]
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
      '<h4>Particulars</h4><div class="rule"></div>' +
      '<dl class="facts">' + facts.map(function (f) {
        return '<dt>' + esc(f[0]) + '</dt><dd>' + (f[1] ? esc(f[1]) : '<span class="none">—</span>') + '</dd>';
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
   Design 2 — Rolodex
   One card up front on a spindle, the rest falling away behind it. Drag,
   scroll, or arrow through them; click the card to turn it over and read the
   history on the back.
   ========================================================================== */

function drawRolodex(host) {
  var people = view.circle ? peopleIn(view.circle)
    : st().people.slice().sort(function (a, b) { return L.lastTouch(b) - L.lastTouch(a); });
  if (!people.length) return emptyState(host, view.circle ? 'This folder is empty.' : 'No cards yet.');

  var at = 0;
  if (view.person) {
    var want = people.map(function (p) { return p.id; }).indexOf(view.person);
    if (want >= 0) at = want;
  }
  var flipped = {};

  var rig = el('div', 'rolo');
  rig.innerHTML =
    '<div class="rolo-spindle" aria-hidden="true"><i></i><b></b><i></i></div>' +
    '<div class="rolo-deck" id="rolo-deck"></div>' +
    '<div class="rolo-foot">' +
      '<button class="step" data-step="-1" aria-label="Previous card">‹</button>' +
      '<div class="rolo-dial" id="rolo-dial"></div>' +
      '<button class="step" data-step="1" aria-label="Next card">›</button>' +
    '</div>' +
    '<div class="rolo-hint">drag · scroll · ← → · click the card to turn it over · type to find</div>';
  host.appendChild(rig);
  var deck = $('#rolo-deck', rig);

  var cards = people.map(function (p, i) {
    var c = el('article', 'rcard');
    c.dataset.i = i;
    c.style.setProperty('--hue', hueVar(L.primaryCircle(p)));
    var sch = L.schoolsOf(p).map(function (s) { return s.name + (s.level ? ' ' + s.level : ''); }).join(', ');
    c.innerHTML =
      '<div class="rface rfront">' +
        '<div class="rtabs">' + L.circlesOf(p).map(function (x) {
          return '<i style="background:' + hueVar(x) + '"></i>'; }).join('') + '</div>' +
        '<div class="rno">' + String(i + 1).padStart(3, '0') + ' / ' + String(people.length).padStart(3, '0') + '</div>' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="rrole">' + esc(roleOf(p) || 'no role recorded') + '</div>' +
        '<dl class="rfacts">' +
          (p.email ? '<dt>e</dt><dd>' + esc(p.email) + '</dd>' : '') +
          (p.phone ? '<dt>t</dt><dd>' + esc(p.phone) + '</dd>' : '') +
          (p.location ? '<dt>at</dt><dd>' + esc(p.location) + '</dd>' : '') +
          (sch ? '<dt>ed</dt><dd>' + esc(sch) + '</dd>' : '') +
        '</dl>' +
        '<div class="rfoot">' +
          '<span>' + esc(L.circlesOf(p).join(' · ')) + '</span>' +
          '<span>' + esc(p.log.length ? L.ago(L.lastTouch(p)) : 'no touchpoints') + '</span>' +
        '</div>' +
        '<div class="rpunch" aria-hidden="true"></div>' +
      '</div>' +
      '<div class="rface rback">' +
        '<div class="rno">' + esc(p.name) + ' — history</div>' +
        '<div class="rlog">' +
          (p.log.length ? p.log.slice(0, 7).map(function (e) {
            return '<div class="rlogrow"><span class="rk">' + esc(L.channelLabel(e.channel)) + '</span>' +
              '<span class="rt">' + esc(e.text) + '</span>' +
              '<span class="rd">' + esc(L.fmtDate(e.at)) + '</span></div>';
          }).join('') : '<div class="rlogrow"><span class="rt">Nothing logged yet.</span></div>') +
          ((p.notes || []).length ? '<div class="rnote">' + esc(p.notes[0].t) + '</div>' : '') +
        '</div>' +
        '<div class="racts">' +
          '<button class="btn" data-edit="' + p.id + '">Open the card</button>' +
          '<button class="btn" data-file="' + p.id + '">See the file</button>' +
        '</div>' +
      '</div>';
    deck.appendChild(c);
    return c;
  });

  var dial = $('#rolo-dial', rig);
  dial.innerHTML = people.map(function (p, i) {
    return '<button data-go="' + i + '" title="' + esc(p.name) + '"><i></i></button>';
  }).join('');
  var dots = Array.prototype.slice.call(dial.children);

  var n = cards.length;
  function offset(i) {                     // shortest way round the ring
    var d = (i - at) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  }
  function place(animate) {
    cards.forEach(function (c, i) {
      var d = offset(i);
      var far = Math.min(Math.abs(d), 6);
      var dir = d < 0 ? -1 : 1;
      c.style.transition = animate ? '' : 'none';
      c.style.transform =
        'translate(-50%, -50%) ' +
        'translateX(' + (d === 0 ? 0 : dir * (96 + far * 30)) + 'px) ' +
        'translateY(' + (far * 6) + 'px) ' +
        'translateZ(' + (-far * 132) + 'px) ' +
        'rotateY(' + (d === 0 ? 0 : dir * -42) + 'deg) ' +
        'rotateX(' + (far * 1.6) + 'deg)';
      c.style.opacity = Math.abs(d) > 5 ? 0 : (d === 0 ? 1 : 0.92 - far * 0.12);
      c.style.zIndex = String(100 - far);
      c.classList.toggle('now', d === 0);
      c.classList.toggle('flipped', d === 0 && !!flipped[people[i].id]);
      c.style.pointerEvents = Math.abs(d) > 5 ? 'none' : '';
    });
    dots.forEach(function (b, i) { b.toggleAttribute('data-on', i === at); });
    var here = dots[at];
    if (here && here.scrollIntoView) here.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  }

  function go(k) {
    at = ((k % n) + n) % n;                // the ring has no ends
    place(true);
  }
  place(false);
  requestAnimationFrame(function () { rig.classList.add('ready'); });

  // the deck leans a little toward the pointer — enough to feel like an object
  var lean = function (e) {
    var r = rig.getBoundingClientRect();
    var nx = (e.clientX - r.left) / r.width - .5;
    var ny = (e.clientY - r.top) / r.height - .5;
    deck.style.setProperty('--lean-y', (nx * 9).toFixed(2) + 'deg');
    deck.style.setProperty('--lean-x', (-ny * 6).toFixed(2) + 'deg');
  };
  var unlean = function () {
    deck.style.setProperty('--lean-y', '0deg');
    deck.style.setProperty('--lean-x', '0deg');
  };
  if (!reduced()) {
    rig.addEventListener('pointermove', lean);
    rig.addEventListener('pointerleave', unlean);
  }

  rig.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]');
    if (ed) return editCard(ed.dataset.edit);
    var fi = e.target.closest('[data-file]');
    if (fi) { view.design = 'drawer'; return openPerson(fi.dataset.file); }
    var g = e.target.closest('[data-go]');
    if (g) return go(+g.dataset.go);
    var s = e.target.closest('[data-step]');
    if (s) return go(at + (+s.dataset.step));
    var c = e.target.closest('.rcard');
    if (!c) return;
    var i = +c.dataset.i;
    if (i !== at) return go(i);
    var id = people[at].id;
    flipped[id] = !flipped[id];
    place(true);
  });

  // wheel and drag both spin the spindle
  var acc = 0, wheelLock = 0;
  var onWheel = function (e) {
    if (!rig.contains(e.target)) return;
    var now = Date.now();
    acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(acc) > 40 && now - wheelLock > 90) {
      go(at + (acc > 0 ? 1 : -1));
      acc = 0; wheelLock = now;
    }
    e.preventDefault();
  };
  scroll.addEventListener('wheel', onWheel, { passive: false });

  var drag = null;
  deck.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, from: at, moved: false };
    deck.setPointerCapture(e.pointerId);
  });
  deck.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    var step = Math.round(-dx / 110);
    if (step !== at - drag.from) go(drag.from + step);
  });
  var endDrag = function () { drag = null; };
  deck.addEventListener('pointerup', endDrag);
  deck.addEventListener('pointercancel', endDrag);

  // type a few letters to jump to a name
  var typed = '', typedAt = 0;
  var onKey = function (e) {
    if (!open || view.design !== 'rolodex') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); return go(at + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); return go(at - 1); }
    if (e.key === 'Home') { e.preventDefault(); return go(0); }
    if (e.key === 'End') { e.preventDefault(); return go(n - 1); }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flipped[people[at].id] = !flipped[people[at].id];
      return place(true);
    }
    if (e.key.length !== 1 || !/\S/.test(e.key)) return;
    var now = Date.now();
    typed = (now - typedAt < 900 ? typed : '') + e.key.toLowerCase();
    typedAt = now;
    for (var i = 0; i < people.length; i++) {
      if (people[i].name.toLowerCase().indexOf(typed) === 0) { go(i); break; }
    }
  };
  document.addEventListener('keydown', onKey);

  return function () {
    scroll.removeEventListener('wheel', onWheel);
    document.removeEventListener('keydown', onKey);
    rig.removeEventListener('pointermove', lean);
    rig.removeEventListener('pointerleave', unlean);
  };
}

/* ==========================================================================
   Design 3 — Light table
   Every person a sheet, scattered on a dark table. Drag them where you like,
   click one to bring it up, and a lamp follows the cursor. Ties between
   people are drawn underneath in thread.
   ========================================================================== */

var tablePos = {};              // id -> {x,y} in table coordinates, kept for the session

function drawTable(host) {
  var people = view.circle ? peopleIn(view.circle) : st().people.slice();
  if (!people.length) return emptyState(host, view.circle ? 'This folder is empty.' : 'Nothing on the table.');

  var W = Math.max(720, Math.min(1020, host.clientWidth || 980));
  var cols = W > 860 ? 4 : W > 620 ? 3 : 2;
  var cw = 214, ch = 118, gapx = (W - cols * cw) / (cols + 1);
  var rows = Math.ceil(people.length / cols);
  var H = rows * (ch + 54) + 130;

  var rig = el('div', 'table');
  rig.style.height = H + 'px';
  rig.innerHTML =
    '<div class="lamp" id="lamp" aria-hidden="true"></div>' +
    '<svg class="threads" id="threads" width="' + W + '" height="' + H + '" aria-hidden="true"></svg>';
  host.appendChild(rig);

  var top = 40;
  var sheets = people.map(function (p, i) {
    var rnd = seed(p.id);
    var col = i % cols, row = Math.floor(i / cols);
    var base = tablePos[p.id] || {
      x: gapx + col * (cw + gapx) + (rnd(64) - 32),
      y: top + row * (ch + 54) + (rnd(52) - 26)
    };
    tablePos[p.id] = base;

    var s = el('article', 'lsheet');
    s.dataset.id = p.id;
    s.style.setProperty('--hue', hueVar(L.primaryCircle(p)));
    s.style.setProperty('--rot', (rnd(9) - 4.5).toFixed(2) + 'deg');
    s.style.setProperty('--w', (200 + Math.round(rnd(34))) + 'px');
    s.style.setProperty('--d', String(i));
    s.style.left = base.x + 'px';
    s.style.top = base.y + 'px';
    s.innerHTML =
      '<div class="lclip" aria-hidden="true"></div>' +
      '<div class="lhead">' +
        '<h4>' + esc(p.name) + '</h4>' +
        '<span class="lrole">' + esc(roleOf(p) || '—') + '</span>' +
      '</div>' +
      '<div class="lmeta">' +
        '<span>' + esc(L.circlesOf(p).join(' · ')) + '</span>' +
        '<span>' + esc(p.log.length ? L.ago(L.lastTouch(p)) : 'no touchpoints') + '</span>' +
      '</div>' +
      '<div class="lmore"><div class="linner">' +
        (p.email ? '<div><b>e</b> ' + esc(p.email) + '</div>' : '') +
        (p.phone ? '<div><b>t</b> ' + esc(p.phone) + '</div>' : '') +
        (p.location ? '<div><b>at</b> ' + esc(p.location) + '</div>' : '') +
        (p.log.length ? '<div class="llast">“' + esc(p.log[0].text.slice(0, 120)) + '”</div>' : '') +
        '<div class="lacts">' +
          '<button class="btn" data-edit="' + p.id + '">Open the card</button>' +
          '<button class="btn" data-file="' + p.id + '">See the file</button>' +
        '</div>' +
      '</div></div>';
    rig.appendChild(s);
    return s;
  });

  var byId = {};
  people.forEach(function (p, i) { byId[p.id] = { p: p, el: sheets[i] }; });

  // thread between anyone who introduced anyone
  var svg = $('#threads', rig);
  function drawThreads() {
    var lines = [];
    people.forEach(function (p) {
      (p.ties || []).forEach(function (t) {
        var a = byId[p.id], b = byId[t.id];
        if (!a || !b) return;
        var pa = tablePos[p.id], pb = tablePos[t.id];
        lines.push('<path d="M' + (pa.x + cw / 2) + ' ' + (pa.y + 30) +
          ' Q' + ((pa.x + pb.x) / 2 + cw / 2) + ' ' + ((pa.y + pb.y) / 2 - 40) +
          ' ' + (pb.x + cw / 2) + ' ' + (pb.y + 30) + '" data-a="' + p.id + '" data-b="' + t.id + '"/>');
      });
    });
    svg.innerHTML = lines.join('');
  }
  drawThreads();

  // the lamp
  var lamp = $('#lamp', rig);
  var onMove = function (e) {
    var r = rig.getBoundingClientRect();
    lamp.style.setProperty('--lx', (e.clientX - r.left) + 'px');
    lamp.style.setProperty('--ly', (e.clientY - r.top) + 'px');
  };
  rig.addEventListener('pointermove', onMove);

  var zTop = 10;
  var upEl = null;
  function lift(s) {
    if (upEl && upEl !== s) upEl.classList.remove('up');
    upEl = s.classList.contains('up') ? null : s;
    s.classList.toggle('up');
    s.style.zIndex = String(++zTop);
    var id = s.dataset.id;
    svg.querySelectorAll('path').forEach(function (path) {
      path.toggleAttribute('data-lit', !!upEl && (path.dataset.a === id || path.dataset.b === id));
    });
  }

  var drag = null;
  rig.addEventListener('pointerdown', function (e) {
    var s = e.target.closest('.lsheet');
    if (!s || e.target.closest('button')) return;
    drag = {
      s: s, id: s.dataset.id, moved: false,
      dx: e.clientX - tablePos[s.dataset.id].x,
      dy: e.clientY - tablePos[s.dataset.id].y
    };
    s.style.zIndex = String(++zTop);
    s.classList.add('held');
    s.setPointerCapture(e.pointerId);
  });
  rig.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var x = e.clientX - drag.dx, y = e.clientY - drag.dy;
    if (Math.abs(x - tablePos[drag.id].x) > 3 || Math.abs(y - tablePos[drag.id].y) > 3) drag.moved = true;
    tablePos[drag.id] = { x: x, y: y };
    drag.s.style.left = x + 'px';
    drag.s.style.top = y + 'px';
    drawThreads();
  });
  var release = function () {
    if (!drag) return;
    drag.s.classList.remove('held');
    if (!drag.moved) lift(drag.s);
    drag = null;
  };
  rig.addEventListener('pointerup', release);
  rig.addEventListener('pointercancel', release);

  rig.addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]');
    if (ed) return editCard(ed.dataset.edit);
    var fi = e.target.closest('[data-file]');
    if (fi) { view.design = 'drawer'; return openPerson(fi.dataset.file); }
  });

  return function () { rig.removeEventListener('pointermove', onMove); };
}

/* ==========================================================================
   Design 4 — Index
   No pictures, no colour, no room wasted. Everyone set in one tight grid the
   way a catalogue raisonné lists works: number, name, one line of fact.
   A crosshair tracks the row you are on and the detail types itself out in
   the margin.
   ========================================================================== */

function drawIndex(host) {
  var people = (view.circle ? peopleIn(view.circle) : st().people.slice())
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (!people.length) return emptyState(host, view.circle ? 'This folder is empty.' : 'Nothing indexed yet.');

  var cols = circles();
  var rig = el('div', 'index');
  rig.innerHTML =
    '<div class="ix-legend">' +
      '<div class="ix-col"><h5>Folders</h5>' +
        cols.map(function (c) {
          return '<button class="ix-f" data-folder="' + esc(c.name) + '"' +
            (view.circle === c.name ? ' data-on="1"' : '') + '>' +
            '<i style="background:' + hueVar(c.name) + '"></i>' + esc(c.name) +
            '<span>' + String(c.n).padStart(2, '0') + '</span></button>';
        }).join('') +
        (view.circle ? '<button class="ix-f ix-all" data-folder="">All entries</button>' : '') +
      '</div>' +
      '<div class="ix-col wide"><h5>Reading</h5>' +
        '<p>Every entry this archive holds, set alphabetically. Hover a line to' +
        ' read it out; click to open the file. The number is the order it was' +
        ' filed, not its importance.</p></div>' +
      '<div class="ix-col"><h5>Count</h5>' +
        '<p class="ix-big">' + String(people.length).padStart(3, '0') + '</p></div>' +
    '</div>' +
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
    type(personById(r.dataset.person));
  });
  rig.addEventListener('pointerleave', function () { type(null); });
  rig.addEventListener('click', function (e) {
    var f = e.target.closest('[data-folder]');
    if (f) { view.circle = f.dataset.folder || null; return render(); }
    var r = e.target.closest('[data-person]');
    if (r) { view.design = 'drawer'; return openPerson(r.dataset.person); }
  });

  return function () { clearInterval(typer); };
}

/* ==========================================================================
   Design 5 — Sublime
   One person, full frame, nothing else. Scroll or arrow and the next name
   dissolves in behind a hairline rule. Built for reading, not scanning.
   ========================================================================== */

function drawSublime(host) {
  var people = (view.circle ? peopleIn(view.circle) : st().people.slice())
    .sort(function (a, b) { return L.lastTouch(b) - L.lastTouch(a); });
  if (!people.length) return emptyState(host, view.circle ? 'This folder is empty.' : 'Nothing to show.');

  var at = 0;
  if (view.person) {
    var k = people.map(function (p) { return p.id; }).indexOf(view.person);
    if (k >= 0) at = k;
  }

  var rig = el('div', 'sublime');
  rig.innerHTML =
    '<div class="sb-frame">' +
      '<div class="sb-glow" id="sb-glow"></div>' +
      '<div class="sb-stage" id="sb-stage"></div>' +
      '<div class="sb-rule"><i id="sb-bar"></i></div>' +
      '<div class="sb-nav">' +
        '<button data-step="-1" aria-label="Previous">\u2191</button>' +
        '<span id="sb-count"></span>' +
        '<button data-step="1" aria-label="Next">\u2193</button>' +
      '</div>' +
    '</div>';
  host.appendChild(rig);
  var stage = $('#sb-stage', rig);

  function paint(dir) {
    var p = people[at];
    var sch = L.schoolsOf(p).map(function (s) { return s.name + (s.level ? ' ' + s.level : ''); }).join(' \u00b7 ');
    var last = p.log[0];
    var card = el('div', 'sb-card');
    card.style.setProperty('--hue', hueVar(L.primaryCircle(p)));
    card.style.setProperty('--dir', dir < 0 ? '-1' : '1');
    card.innerHTML =
      '<div class="sb-kicker">' + esc(L.circlesOf(p).join(' \u2014 ')) + '</div>' +
      '<h2 class="sb-name">' + esc(p.name) + '</h2>' +
      '<div class="sb-role">' + esc(roleOf(p) || 'No role recorded') + '</div>' +
      (last ? '<p class="sb-line">' + esc(last.learned || last.text) + '</p>' : '') +
      '<dl class="sb-facts">' +
        (p.location ? '<div><dt>Where</dt><dd>' + esc(p.location) + '</dd></div>' : '') +
        (sch ? '<div><dt>Read at</dt><dd>' + esc(sch) + '</dd></div>' : '') +
        (p.email ? '<div><dt>Reach</dt><dd>' + esc(p.email) + '</dd></div>' : '') +
        '<div><dt>Last</dt><dd>' + esc(p.log.length ? L.fmtDate(L.lastTouch(p)) : 'never') + '</dd></div>' +
      '</dl>' +
      '<div class="sb-acts">' +
        '<button class="btn" data-edit="' + p.id + '">Open the card</button>' +
        '<button class="btn" data-file="' + p.id + '">See the file</button>' +
      '</div>';
    var old = stage.firstElementChild;
    if (old) { old.classList.add('out'); setTimeout(function () { old.remove(); }, reduced() ? 0 : 520); }
    stage.appendChild(card);
    requestAnimationFrame(function () { card.classList.add('on'); });
    $('#sb-count', rig).textContent = String(at + 1).padStart(2, '0') + ' / ' + String(people.length).padStart(2, '0');
    $('#sb-bar', rig).style.transform = 'scaleX(' + ((at + 1) / people.length) + ')';
    $('#sb-glow', rig).style.setProperty('--hue', hueVar(L.primaryCircle(p)));
  }
  paint(1);

  function go(n) {
    var next = Math.max(0, Math.min(people.length - 1, n));
    if (next === at) return;
    var dir = next > at ? 1 : -1;
    at = next;
    paint(dir);
  }

  var acc = 0, lock = 0;
  var onWheel = function (e) {
    if (!rig.contains(e.target)) return;
    e.preventDefault();
    acc += e.deltaY;
    var now = Date.now();
    if (Math.abs(acc) > 60 && now - lock > 420) { go(at + (acc > 0 ? 1 : -1)); acc = 0; lock = now; }
  };
  scroll.addEventListener('wheel', onWheel, { passive: false });

  var onKey = function (e) {
    if (!open || view.design !== 'sublime') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(at + 1); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
  };
  document.addEventListener('keydown', onKey);

  rig.addEventListener('click', function (e) {
    var s = e.target.closest('[data-step]');
    if (s) return go(at + (+s.dataset.step));
    var ed = e.target.closest('[data-edit]');
    if (ed) return editCard(ed.dataset.edit);
    var fi = e.target.closest('[data-file]');
    if (fi) { view.design = 'drawer'; return openPerson(fi.dataset.file); }
  });

  return function () {
    scroll.removeEventListener('wheel', onWheel);
    document.removeEventListener('keydown', onKey);
  };
}

/* ==========================================================================
   Design 6 — Chroma
   No paper anywhere. Each folder is a field of its own light, names set huge
   over it, and the light follows the pointer. Click a name and a pane of
   glass slides over the colour with the facts on it.
   ========================================================================== */

function drawChroma(host) {
  var groups = view.circle
    ? [{ name: view.circle, people: peopleIn(view.circle) }]
    : circles().map(function (c) { return { name: c.name, people: peopleIn(c.name) }; });
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
  function showPane(p, from) {
    var sch = L.schoolsOf(p).map(function (s) { return s.name + (s.level ? ' ' + s.level : ''); }).join(' \u00b7 ');
    pane.style.setProperty('--hue', hueVar(L.primaryCircle(p)));
    pane.innerHTML =
      '<button class="ch-x" data-close aria-label="Close">\u00d7</button>' +
      '<div class="ch-kicker">' + esc(L.circlesOf(p).join(' \u00b7 ')) + '</div>' +
      '<h3>' + esc(p.name) + '</h3>' +
      '<div class="ch-role">' + esc(roleOf(p) || 'No role recorded') + '</div>' +
      '<dl>' +
        (p.email ? '<dt>Mail</dt><dd>' + esc(p.email) + '</dd>' : '') +
        (p.phone ? '<dt>Ring</dt><dd>' + esc(p.phone) + '</dd>' : '') +
        (p.location ? '<dt>Where</dt><dd>' + esc(p.location) + '</dd>' : '') +
        (sch ? '<dt>Read at</dt><dd>' + esc(sch) + '</dd>' : '') +
        '<dt>Last</dt><dd>' + esc(p.log.length ? L.ago(L.lastTouch(p)) : 'no touchpoints') + '</dd>' +
      '</dl>' +
      (p.log[0] ? '<p class="ch-last">\u201c' + esc(p.log[0].text) + '\u201d</p>' : '') +
      '<div class="ch-acts">' +
        '<button class="btn" data-edit="' + p.id + '">Open the card</button>' +
        '<button class="btn" data-file="' + p.id + '">See the file</button>' +
      '</div>';
    var r = from.getBoundingClientRect(), rr = rig.getBoundingClientRect();
    pane.style.setProperty('--fx', (r.left - rr.left + r.width / 2) + 'px');
    pane.style.setProperty('--fy', (r.top - rr.top + r.height / 2) + 'px');
    pane.hidden = false;
    requestAnimationFrame(function () { pane.classList.add('on'); });
  }
  function hidePane() {
    pane.classList.remove('on');
    setTimeout(function () { if (!pane.classList.contains('on')) pane.hidden = true; }, reduced() ? 0 : 320);
  }

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

  return function () { rig.removeEventListener('pointermove', onMove); };
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
      ? '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8h-7L10.5 5.5h-6A1.5 1.5 0 0 0 3 7z"/></svg>'
      : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/></svg>';
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
      pane.innerHTML = cols.map(function (c) {
        return '<div class="fitem' + (sel.circle === c.name ? ' on' : '') + '" data-circle="' + esc(c.name) + '" tabindex="0">' +
          '<span class="fic" style="color:' + hueVar(c.name) + '">' + icon('folder') + '</span>' +
          '<span class="fnm">' + esc(c.name) + '</span>' +
          '<span class="fsz">' + c.n + ' item' + (c.n === 1 ? '' : 's') + '</span>' +
        '</div>';
      }).join('') + folk.map(function (x) {
        return '<div class="fitem' + (sel.person === x.id ? ' on' : '') + '" data-person="' + x.id + '" tabindex="0">' +
          '<span class="fic">' + icon('file') + '</span>' +
          '<span class="fnm">' + esc(x.name) + '</span>' +
          '<span class="fsz">' + esc(sizeOf(x)) + '</span>' +
        '</div>';
      }).join('');
    } else {
      pane.className = 'fw-cols';
      pane.innerHTML =
        '<div class="fcol" data-col="0">' + cols.map(function (c) {
          return '<button class="frow' + (sel.circle === c.name ? ' on' : '') + '" data-circle="' + esc(c.name) + '">' +
            '<span class="fic" style="color:' + hueVar(c.name) + '">' + icon('folder') + '</span>' +
            '<span class="fnm">' + esc(c.name) + '</span>' +
            '<span class="fct">' + c.n + '</span>' +
            '<span class="fch">\u203a</span>' +
          '</button>';
        }).join('') + '</div>' +
        '<div class="fcol" data-col="1">' + (folk.length ? folk.map(function (x) {
          return '<button class="frow' + (sel.person === x.id ? ' on' : '') + '" data-person="' + x.id + '">' +
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
      '<h4>' + esc(p.name) + '</h4>' +
      '<div class="fkind">' + esc(roleOf(p) || 'Entry') + '</div>' +
      '<dl>' +
        '<dt>Kind</dt><dd>Rootwork entry</dd>' +
        '<dt>Size</dt><dd>' + esc(sizeOf(p)) + '</dd>' +
        '<dt>Filed</dt><dd>' + esc(L.circlesOf(p).join(', ')) + '</dd>' +
        (p.email ? '<dt>Mail</dt><dd>' + esc(p.email) + '</dd>' : '') +
        (p.phone ? '<dt>Phone</dt><dd>' + esc(p.phone) + '</dd>' : '') +
        (p.location ? '<dt>Where</dt><dd>' + esc(p.location) + '</dd>' : '') +
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
    if (c) { sel.circle = c.dataset.circle; sel.person = null; return paint(); }
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

/* ---- wiring ---- */

document.addEventListener('rootwork:changed', function () {
  if (open && !document.querySelector('.archive .held')) render();
});

window.RootworkArchive = {
  open: show,
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
  var btn = document.getElementById('btn-archive');
  if (btn) btn.addEventListener('click', function () { show(null, null); });
  document.addEventListener('keydown', function (e) {
    if (open) return;
    var t = document.activeElement;
    if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
    if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey) show(null, null);
  });
}
})();
