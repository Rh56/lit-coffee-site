/* ==========================================================================
   Rootwork — sync.

   One row holds the whole map, encrypted in this browser before it leaves.
   The server (a free Supabase project) stores ciphertext and a timestamp; it
   cannot read a single name. Two devices agree because every person carries
   an `updated` stamp and deletions leave a tombstone, so merging is a
   per-person newest-wins rather than a whole-file last-write-wins — a phone
   edited on a plane does not wipe out what the laptop did meanwhile.

   Realtime arrives over a websocket when it can, and a poll covers it when
   it cannot, so the worst case is a few seconds rather than a broken app.
   ========================================================================== */
(function () {
'use strict';

var CFG_KEY = 'rootwork.sync';
var TABLE = 'rootwork';
var app = null;                      // the bridge app.js hands us
var cfg = null;                      // {url, key, space, pass}
var cryptoKey = null;
var ws = null, wsAlive = false, wsTimer = null, wsRef = 0;
var pollTimer = null, pushTimer = null;
var status = { state: 'off', at: 0, note: '' };
var pulling = false, pushing = false, adoptRemote = false;

/* ------------------------------------------------------------- plumbing -- */

function b64(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function unb64(str) {
  var s = atob(str), b = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function enc(str) { return new TextEncoder().encode(str); }

function deriveKey(pass, space) {
  return crypto.subtle.importKey('raw', enc(pass), 'PBKDF2', false, ['deriveKey'])
    .then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc('rootwork:' + space), iterations: 200000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
}

function encrypt(obj) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, enc(JSON.stringify(obj)))
    .then(function (ct) {
      var out = new Uint8Array(iv.length + ct.byteLength);
      out.set(iv, 0); out.set(new Uint8Array(ct), iv.length);
      return b64(out);
    });
}

function decrypt(payload) {
  var raw = unb64(payload);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, cryptoKey, raw.slice(12))
    .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
}

function rest(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({
    apikey: cfg.key,
    Authorization: 'Bearer ' + cfg.key,
    'Content-Type': 'application/json'
  }, opts.headers || {});
  return fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/' + path, opts).then(function (r) {
    if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t.slice(0, 160)); });
    return r.status === 204 ? null : r.json();
  });
}

/* ---------------------------------------------------------------- merge -- */
/* Newest stamp wins per person; a tombstone beats a person older than it. */

function merge(a, b) {
  var out = {
    me: (b.meUpdated || 0) > (a.meUpdated || 0) ? b.me : a.me,
    meUpdated: Math.max(a.meUpdated || 0, b.meUpdated || 0),
    circles: (a.circles || []).slice(),
    people: [],
    tombstones: Object.assign({}, a.tombstones || {}, b.tombstones || {}),
    seq: Math.max(a.seq || 1, b.seq || 1),
    demo: false
  };
  (b.circles || []).forEach(function (c) { if (out.circles.indexOf(c) < 0) out.circles.push(c); });

  var byId = {};
  (a.people || []).forEach(function (p) { byId[p.id] = p; });
  (b.people || []).forEach(function (p) {
    var mine = byId[p.id];
    if (!mine || (p.updated || p.created || 0) > (mine.updated || mine.created || 0)) byId[p.id] = p;
  });

  Object.keys(byId).forEach(function (id) {
    var p = byId[id];
    var killed = out.tombstones[id];
    if (killed && killed >= (p.updated || p.created || 0)) return;
    out.people.push(p);
  });

  // forget tombstones older than a season; two devices will have seen them
  var cutoff = Date.now() - 90 * 86400000;
  Object.keys(out.tombstones).forEach(function (id) {
    if (out.tombstones[id] < cutoff) delete out.tombstones[id];
  });
  return out;
}

/* ----------------------------------------------------------------- wire -- */

function setStatus(s, note) {
  status.state = s; status.note = note || '';
  if (s === 'ok') status.at = Date.now();
  paintStatus();
}

function pull() {
  if (!cfg || pulling) return Promise.resolve();
  pulling = true;
  return rest(TABLE + '?id=eq.' + encodeURIComponent(cfg.space) + '&select=payload,updated_at')
    .then(function (rows) {
      if (!rows || !rows.length) { setStatus('ok', 'nothing on the server yet'); return push(true); }
      return decrypt(rows[0].payload).then(function (remote) {
        var local = app.getState();
        var next = (adoptRemote || local.demo) ? remote : merge(local, remote);
        adoptRemote = false;
        app.setState(next);
        setStatus('ok');
      }, function () {
        setStatus('bad', 'passphrase does not match this map');
      });
    })
    .catch(function (e) { setStatus(navigator.onLine ? 'bad' : 'offline', String(e.message || e)); })
    .then(function () { pulling = false; });
}

function push(force) {
  if (!cfg || pushing) return Promise.resolve();
  pushing = true;
  var local = app.getState();
  // read-modify-write: fold in whatever the other device did before overwriting
  return rest(TABLE + '?id=eq.' + encodeURIComponent(cfg.space) + '&select=payload')
    .then(function (rows) {
      if (!rows || !rows.length) return local;
      return decrypt(rows[0].payload).then(function (remote) {
        var merged = merge(local, remote);
        app.setState(merged);
        return merged;
      }, function () { return local; });
    })
    .then(function (toSend) {
      var clean = Object.assign({}, toSend); delete clean.demo;
      return encrypt(clean);
    })
    .then(function (payload) {
      return rest(TABLE, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ id: cfg.space, payload: payload, updated_at: new Date().toISOString() }])
      });
    })
    .then(function () { setStatus('ok'); })
    .catch(function (e) {
      setStatus(navigator.onLine ? 'bad' : 'offline', String(e.message || e));
      if (!force) schedulePush(15000);        // try again later, keep the edit
    })
    .then(function () { pushing = false; });
}

function schedulePush(delay) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(function () { push(); }, delay || 1400);
}

/* Realtime is a nicety; the poll below is what guarantees it works. */
function openSocket() {
  if (!cfg || !window.WebSocket) return;
  try { if (ws) ws.close(); } catch (e) { }
  var base = cfg.url.replace(/^http/, 'ws').replace(/\/+$/, '');
  ws = new WebSocket(base + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.key) + '&vsn=1.0.0');
  ws.onopen = function () {
    ws.send(JSON.stringify({
      topic: 'realtime:rootwork', event: 'phx_join', ref: String(++wsRef),
      payload: {
        config: {
          postgres_changes: [{ event: '*', schema: 'public', table: TABLE, filter: 'id=eq.' + cfg.space }]
        }
      }
    }));
    clearInterval(wsTimer);
    wsTimer = setInterval(function () {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++wsRef) }));
    }, 25000);
  };
  ws.onmessage = function (ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok') wsAlive = true;
    if (m.event === 'postgres_changes' || m.event === 'INSERT' || m.event === 'UPDATE') { wsAlive = true; pull(); }
  };
  ws.onclose = function () { wsAlive = false; clearInterval(wsTimer); };
  ws.onerror = function () { wsAlive = false; };
}

function startLoops() {
  clearInterval(pollTimer);
  pollTimer = setInterval(function () {
    if (document.hidden) return;
    if (wsAlive && Date.now() - status.at < 20000) return;   // socket is doing the work
    pull();
  }, 5000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && cfg) { pull(); if (!wsAlive) openSocket(); }
  });
  window.addEventListener('online', function () { if (cfg) { openSocket(); pull(); } });
  window.addEventListener('beforeunload', function () { if (cfg && pushTimer) push(true); });
}

/* ------------------------------------------------------------------ ui --- */

function paintStatus() {
  var el = document.getElementById('sync-pill');
  if (!el) return;
  var label, tone;
  if (!cfg) { label = 'Sync off'; tone = 'off'; }
  else if (status.state === 'ok') { label = 'Synced'; tone = 'ok'; }
  else if (status.state === 'offline') { label = 'Offline'; tone = 'warn'; }
  else if (status.state === 'bad') { label = 'Sync error'; tone = 'bad'; }
  else { label = 'Connecting'; tone = 'off'; }
  el.dataset.tone = tone;
  el.title = status.note || (cfg ? 'Connected to your sync space' : 'Not connected');
  el.innerHTML = '<span class="dot"></span>' + label;
}

function pairingCode() {
  return btoa(JSON.stringify({ u: cfg.url, k: cfg.key, s: cfg.space }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function readCode(code) {
  var s = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var o = JSON.parse(atob(s));
  if (!o.u || !o.k || !o.s) throw new Error('bad code');
  return o;
}
function randomSpace() {
  var b = crypto.getRandomValues(new Uint8Array(16)), s = '';
  for (var i = 0; i < b.length; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[b[i] % 32];
  return s;
}

function connect(next, pass) {
  return deriveKey(pass, next.space).then(function (k) {
    cfg = next; cryptoKey = k;
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ url: cfg.url, key: cfg.key, space: cfg.space, pass: pass })); } catch (e) { }
    setStatus('connecting');
    openSocket();
    startLoops();
    return pull();
  });
}

function disconnect() {
  cfg = null; cryptoKey = null; wsAlive = false;
  try { localStorage.removeItem(CFG_KEY); } catch (e) { }
  try { if (ws) ws.close(); } catch (e) { }
  clearInterval(pollTimer); clearInterval(wsTimer);
  setStatus('off');
}

function dialog() {
  var connected = !!cfg;
  var body = '<div class="io sync">' +
    (connected
      ? '<p class="lead">This device is syncing. Open the same map somewhere else by pasting the pairing code below, then typing the same passphrase.</p>' +
        '<div class="field wide"><label for="s-code">Pairing code</label>' +
        '<input id="s-code" readonly value="' + pairingCode() + '"><span class="hint">Safe to send to yourself — it does not contain your passphrase, and without that the data is unreadable.</span></div>'
      : '<p class="lead">Two short steps, once. Your contacts are encrypted in this browser before they are sent, so the database holds nothing readable — but that also means a lost passphrase is a lost map.</p>') +

    '<div class="tabs"><button class="btn" id="s-tab-new" data-on="1">First device</button>' +
    '<button class="btn" id="s-tab-join">Add a device</button></div>' +

    '<div id="s-pane-new">' +
      '<ol class="steps">' +
        '<li>Make a free project at <span class="mono">supabase.com</span> (any name, any region near you).</li>' +
        '<li>Open <b>SQL Editor</b>, paste this, press run:' +
        '<pre class="ex sql">create table if not exists public.rootwork (\n' +
        '  id text primary key,\n  payload text not null,\n' +
        '  updated_at timestamptz not null default now()\n);\n' +
        'alter table public.rootwork enable row level security;\n' +
        'create policy rootwork_rw on public.rootwork\n  for all to anon using (true) with check (true);\n' +
        'alter publication supabase_realtime add table public.rootwork;</pre>' +
        '<button class="btn" id="s-copysql" type="button" style="margin-top:6px">Copy the SQL</button></li>' +
        '<li>Open <b>Project Settings → API</b> and copy the two values below.</li>' +
      '</ol>' +
      '<div class="grid2">' +
        '<div class="field wide"><label for="s-url">Project URL</label><input id="s-url" placeholder="https://xxxxxxxx.supabase.co" value="' + (cfg ? cfg.url : '') + '"></div>' +
        '<div class="field wide"><label for="s-key">Anon public key</label><input id="s-key" placeholder="eyJhbGciOi…" value="' + (cfg ? cfg.key : '') + '"></div>' +
        '<div class="field wide"><label for="s-pass">Passphrase</label><input id="s-pass" type="password" placeholder="Something you will remember">' +
        '<span class="hint">Never sent anywhere. You will type it on each device.</span></div>' +
      '</div>' +
    '</div>' +

    '<div id="s-pane-join" hidden>' +
      '<div class="grid2">' +
        '<div class="field wide"><label for="s-join">Pairing code from your other device</label><input id="s-join" placeholder="eyJ1IjoiaHR0cHM6…"></div>' +
        '<div class="field wide"><label for="s-pass2">Passphrase</label><input id="s-pass2" type="password" placeholder="The same one you set there"></div>' +
      '</div>' +
      '<p class="lead" style="margin-top:10px">This device will take on the map from the server; anything only stored here now is replaced.</p>' +
    '</div>' +

    '<div class="status" id="s-status">&nbsp;</div></div>';

  var m = app.modal('Sync across devices', connected ? 'Connected' : 'Not connected', body,
    '<button class="btn primary" id="s-go">' + (connected ? 'Update' : 'Connect') + '</button>' +
    (connected ? '<button class="btn" id="s-off">Disconnect</button>' : '') +
    '<button class="btn" data-close>Close</button>');

  var st = m.querySelector('#s-status');
  var paneNew = m.querySelector('#s-pane-new'), paneJoin = m.querySelector('#s-pane-join');
  var tabNew = m.querySelector('#s-tab-new'), tabJoin = m.querySelector('#s-tab-join');
  var mode = 'new';
  function setTab(t) {
    mode = t;
    paneNew.hidden = t !== 'new'; paneJoin.hidden = t !== 'join';
    tabNew.style.borderColor = t === 'new' ? 'var(--accent)' : '';
    tabJoin.style.borderColor = t === 'join' ? 'var(--accent)' : '';
  }
  tabNew.onclick = function () { setTab('new'); };
  tabJoin.onclick = function () { setTab('join'); };
  setTab('new');

  if (connected) {
    m.querySelector('#s-code').addEventListener('click', function () {
      this.select();
      if (navigator.clipboard) navigator.clipboard.writeText(this.value).then(function () { app.toast('Pairing code copied'); });
    });
  }

  var copySql = m.querySelector('#s-copysql');
  if (copySql) copySql.addEventListener('click', function () {
    var sql = m.querySelector('.ex.sql').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(sql).then(function () { app.toast('SQL copied'); });
  });

  m.querySelector('#s-go').addEventListener('click', function () {
    var next, pass;
    if (mode === 'join') {
      try { var o = readCode(m.querySelector('#s-join').value); next = { url: o.u, key: o.k, space: o.s }; }
      catch (e) { st.className = 'status bad'; st.textContent = 'That pairing code could not be read.'; return; }
      pass = m.querySelector('#s-pass2').value;
      adoptRemote = true;
    } else {
      next = {
        url: m.querySelector('#s-url').value.trim(),
        key: m.querySelector('#s-key').value.trim(),
        space: (cfg && cfg.space) || randomSpace()
      };
      pass = m.querySelector('#s-pass').value;
      if (!/^https:\/\/.+/.test(next.url) || next.key.length < 20) {
        st.className = 'status bad'; st.textContent = 'Need the project URL and the anon key from Settings → API.'; return;
      }
    }
    if (!pass || pass.length < 4) { st.className = 'status bad'; st.textContent = 'Pick a passphrase of at least four characters.'; return; }
    st.className = 'status'; st.textContent = 'Connecting…';
    connect(next, pass).then(function () {
      if (status.state === 'bad') { st.className = 'status bad'; st.textContent = status.note; return; }
      app.closeModal(); app.toast('Syncing');
    }, function (e) {
      st.className = 'status bad'; st.textContent = String(e.message || e);
    });
  });

  var off = m.querySelector('#s-off');
  if (off) off.addEventListener('click', function () {
    disconnect(); app.closeModal(); app.toast('Sync turned off — the map stays on this device');
  });
}

/* ----------------------------------------------------------------- api --- */

window.RootworkSync = {
  attach: function (bridge) {
    app = bridge;
    paintStatus();
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { }
    if (saved && saved.url && saved.pass) {
      connect({ url: saved.url, key: saved.key, space: saved.space }, saved.pass)
        .catch(function () { setStatus('bad', 'could not reconnect'); });
    }
  },
  open: dialog,
  markDirty: function () { if (cfg) schedulePush(); },
  connected: function () { return !!cfg; }
};

})();
