/* THE Hybrid System — Coach (Entity 2)
 * Local-first coach builder: authors programs → weeks → days → sessions in the
 * TrainHeroic session-editor model. Persists to localStorage; when signed in to
 * the shared Supabase project, syncs the whole library blob to coach_library.
 * CSP-safe: external classic script, event delegation, no inline handlers.
 * Depends on window.HybridEmit (emit.js) and window.COACH_SB (config.js). */
(function () {
  'use strict';

  var LS_KEY = 'hybrid-coach-v1';
  var SB = window.COACH_SB || null;
  var E = window.HybridEmit;

  var MEASURES = [
    'Reps', 'Weight (lb)', 'Weight (kg)', 'Weight (%)', 'Weight (LWP+)', 'RPE', 'Time (min:sec)',
    'Distance (miles)', 'Distance (yd)', 'Distance (ft)', 'Distance (inches)', 'Distance (meters)',
    'Height (inches)', 'Calories (cal)'
  ];
  var PH = { 'Reps': 'reps', 'Weight (lb)': 'lb', 'Weight (kg)': 'kg', 'Weight (%)': '%', 'Weight (LWP+)': 'lwp', 'RPE': 'RPE', 'Time (min:sec)': '0:00', 'Distance (miles)': 'mi', 'Distance (yd)': 'yd', 'Distance (ft)': 'ft', 'Distance (inches)': 'in', 'Distance (meters)': 'm', 'Height (inches)': 'in', 'Calories (cal)': 'cal' };
  var SECTIONS = ['Strength/Power', 'Hypertrophy', 'Accessory', 'Conditioning', 'Warm-up', 'Cool-down', 'Skill / Technique'];

  function uid() { try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {} return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ---------- data model ---------- */
  function exM(name, cols, sets, cues, swaps, pop) { return { id: uid(), name: name, cols: cols, sets: sets, cues: cues || '', swaps: swaps || 'No swaps added yet.', pop: pop || [], link: false }; }
  function dayM(title, section, list) { return { title: title, note: '', section: section, exercises: list }; }
  function emptyWeek() { return { days: [null, null, null, null, null, null, null] }; }

  function seedProgram() {
    var w1 = { days: [
      { title: 'Full Body Strength Test',
        note: 'Warm up thoroughly. Focus on clean bar speed. Leave 1-2 reps in reserve on all working sets.',
        section: 'Strength/Power',
        exercises: [
          exM('Back Squat', ['Reps', 'Weight (lb)'], [['5', '155'], ['5', '155'], ['5', '155'], ['5', '155'], ['5', '155']], '', 'No swaps added yet.', ['Place the barbell on the upper part of your back.']),
          exM('Romanian Deadlift with DB', ['Reps', 'Weight (lb)'], [['8', '60'], ['8', '60'], ['8', '60'], ['8', '60']], '', 'No swaps added yet.', ['Hinge at the hips, keep the dumbbells close to the legs.'])
        ] },
      dayM('Conditioning', 'Conditioning', [exM('Assault Bike', ['Time (min:sec)', 'Calories (cal)'], [['0:30', ''], ['0:30', ''], ['0:30', ''], ['0:30', '']], '8 rounds · 30s hard / 90s easy.')]),
      null,
      dayM('Heavy Lower', 'Strength/Power', [exM('Front Squat', ['Reps', 'Weight (lb)'], [['3', '185'], ['3', '205'], ['3', '215']]), exM('Bulgarian Split Squat', ['Reps', 'Weight (lb)'], [['10', '50'], ['10', '50']])]),
      null,
      dayM('Conditioning', 'Conditioning', [exM('Row', ['Time (min:sec)', 'Distance (meters)'], [['20:00', '']])]),
      null
    ] };
    return { id: uid(), name: 'SANDBOX – test – delete me', weeks: [w1, emptyWeek(), emptyWeek(), emptyWeek()] };
  }

  var LIB = null;

  function migrate(lib) {
    if (!lib || typeof lib !== 'object' || !Array.isArray(lib.programs) || !lib.programs.length) return { programs: [seedProgram()], sel: { p: 0, w: 0, d: 0 } };
    lib.sel = lib.sel || { p: 0, w: 0, d: 0 };
    lib.programs.forEach(function (p) { if (!Array.isArray(p.weeks) || !p.weeks.length) p.weeks = [emptyWeek()]; p.weeks.forEach(function (w) { if (!Array.isArray(w.days) || w.days.length !== 7) w.days = (w.days || []).concat([null, null, null, null, null, null, null]).slice(0, 7); }); });
    clampSel(lib);
    return lib;
  }
  function clampSel(lib) {
    lib = lib || LIB; if (!lib) return;
    var s = lib.sel; s.p = Math.max(0, Math.min(s.p, lib.programs.length - 1));
    var p = lib.programs[s.p]; s.w = Math.max(0, Math.min(s.w, p.weeks.length - 1)); s.d = Math.max(0, Math.min(s.d, 6));
  }
  function loadLocal() { try { var raw = localStorage.getItem(LS_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) {} return migrate(null); }
  function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(LIB)); } catch (e) {} }

  function prog() { return LIB.programs[LIB.sel.p]; }
  function week() { return prog().weeks[LIB.sel.w]; }
  function day() { return week().days[LIB.sel.d]; }
  function setDay(s) { week().days[LIB.sel.d] = s; }

  /* persist locally + push to cloud (debounced) */
  var pushTimer = null;
  function commit() { saveLocal(); if (cloudUser) { if (pushTimer) clearTimeout(pushTimer); pushTimer = setTimeout(pushLibrary, 900); } }

  /* ---------- labels + summary (superset A1/A2) ---------- */
  function letters(exs) {
    var out = [], groups = [];
    exs.forEach(function (e, i) { if (i === 0 || !e.link) groups.push([i]); else groups[groups.length - 1].push(i); });
    var L = 65;
    groups.forEach(function (g) { var c = String.fromCharCode(L++); g.forEach(function (idx, j) { out[idx] = g.length > 1 ? c + (j + 1) : c; }); });
    return out;
  }
  function summary(e) {
    var repsI = e.cols.indexOf('Reps'), wI = e.cols.findIndex(function (c) { return c.indexOf('Weight') === 0; });
    if (repsI < 0) { var t = e.cols.indexOf('Time (min:sec)'); return e.sets.length + ' × ' + (t >= 0 ? (e.sets[0] ? e.sets[0][t] : '') : 'set'); }
    var reps = e.sets.map(function (s) { return s[repsI]; }).join(', ');
    var loads = e.sets.map(function (s) { return wI >= 0 ? s[wI] : ''; }).filter(function (v) { return v && v !== '—'; });
    var unit = wI >= 0 ? PH[e.cols[wI]] : '';
    var lu = loads.filter(function (v, i) { return loads.indexOf(v) === i; });
    return reps + (lu.length ? ' @ ' + (lu.length === 1 ? lu[0] : loads[0]) + unit : '');
  }

  /* ---------- render: topbar + nav + preview ---------- */
  function renderTop() {
    document.getElementById('progname').textContent = prog().name;
    var pill = document.getElementById('syncpill'), lab = document.getElementById('synclabel'), av = document.getElementById('avatar');
    pill.className = 'syncpill ' + (cloudUser ? 'ok' : 'off');
    if (cloudUser) { var em = cloudUser.email || 'account'; lab.textContent = cloudBusy ? 'Syncing…' : 'Synced'; av.textContent = (em[0] || '·').toUpperCase(); }
    else { lab.textContent = 'Local only'; av.textContent = '·'; }
  }
  function playSvg() { return '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; }

  function renderNav() {
    document.getElementById('wklabel').textContent = 'Week ' + (LIB.sel.w + 1);
    document.getElementById('days').innerHTML = week().days.map(function (s, i) {
      return '<button class="day' + (i === LIB.sel.d ? ' on' : '') + (s ? ' has' : '') + '" data-act="day" data-i="' + i + '">' + (i + 1) + '</button>';
    }).join('');
    var s = day(), pv = document.getElementById('preview');
    if (!s) { pv.innerHTML = '<div class="pvday">Day ' + (LIB.sel.d + 1) + '</div><div class="microval" style="padding:8px 2px">Rest day — no session.</div>'; return; }
    var lb = letters(s.exercises), rows = '';
    s.exercises.forEach(function (e, i) { rows += '<div class="pvex"><span class="mk">' + lb[i] + '</span><div><b>' + esc(e.name) + '</b><span>' + esc(summary(e)) + '</span></div></div>'; });
    pv.innerHTML = '<div class="pvday">Day ' + (LIB.sel.d + 1) + '</div>' +
      '<div class="pvsess"><span class="std">STD</span><b>' + esc(s.title) + '</b><span class="lk"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></span></div>' + rows;
  }

  /* ---------- render: editor ---------- */
  function renderEditor() {
    var s = day(), el = document.getElementById('editor'), wd = 'Week ' + (LIB.sel.w + 1) + ' Day ' + (LIB.sel.d + 1);
    if (!s) { el.innerHTML = '<div class="ed-top"><h1>' + wd + '</h1></div><div class="exadd2"><button data-act="addsession">+ Add a session to this day</button></div>'; return; }
    var h = '<div class="ed-top"><h1>' + wd + '</h1><div class="grow"></div>' +
      '<button class="assignbtn" data-act="assign"><svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>Assign to phone</button>' +
      '<button class="eico" data-act="save" title="Save"><svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7M8 21v-6h8v6"/></svg></button>' +
      '<button class="eico del" data-act="del" title="Delete session"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></div>';
    h += '<div class="sessline"><span class="std">STD</span><b contenteditable="true" data-act="title" spellcheck="false">' + esc(s.title) + '</b></div>';
    h += '<div class="field"><span class="flab">Coach Instructions</span><span class="cc">' + s.note.length + '/10000</span>' +
      '<textarea data-act="note" placeholder="Add instructions the athlete sees for the whole session…">' + esc(s.note) + '</textarea></div>';
    h += '<div class="secthead"><span class="di"><svg viewBox="0 0 24 24"><path d="M4 9h3v6H4zM17 9h3v6h-3zM7 12h10M2 11h2v2H2zM20 11h2v2h-2z"/></svg></span>' +
      '<span class="st">' + esc(s.section) + '</span><span class="cv" data-act="secmenu">▾</span><div class="grow"></div>' +
      '<span class="trophy"><svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/></svg></span>' +
      '<span class="dots" data-act="secdots">⋯</span></div>';

    var LB = letters(s.exercises);
    s.exercises.forEach(function (e, ei) {
      var cols = e.cols, tmpl = '38px ' + cols.map(function () { return '1fr'; }).join(' ');
      h += '<div class="exc"><div class="exhdr"><span class="mk">' + LB[ei] + '</span>' +
        '<span class="namewrap" data-act="exmenu" data-e="' + ei + '"><b>' + esc(e.name) + '</b><span class="cv">▾</span></span>' +
        '<span class="setcount">' + e.sets.length + '</span>' +
        '<span class="lines" title="Sets"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span>' +
        '<span class="tr" data-act="exdel" data-e="' + ei + '" title="Remove"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span></div>' +
        '<div class="exbody"><div class="exleft">' +
        '<div class="subfield"><span class="flab">Exercise Instructions</span><span class="cc">' + e.cues.length + '/10000</span>' +
        '<textarea data-act="cue" data-e="' + ei + '" placeholder="Add cues for this session.">' + esc(e.cues) + '</textarea></div>' +
        '<div class="exmedia"><div class="vthumb"><div class="ph"></div><div class="pl"><i>' + playSvg() + '</i></div><div class="cap">' + esc(e.name) + '</div></div>' +
        '<div class="mcol"><div class="swline"><a data-act="swaps"><span>Edit Swaps</span><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a></div>' +
        '<div class="microlab">Suggested Swaps</div><div class="microval">' + esc(e.swaps) + '</div>' +
        '<div class="pop-h" data-act="pop" data-e="' + ei + '"><span class="cv">›</span>Points of Performance</div>' +
        '<ul class="pop-list" data-pop="' + ei + '" style="display:none">' + (e.pop.length ? e.pop.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') : '<li style="color:var(--faint)">None added.</li>') + '</ul>' +
        '</div></div>' +
        '</div>' +
        '<div class="exright"><div class="rxtop"><span class="rxsum" data-act="rxmenu" data-e="' + ei + '"><b>' + esc(summary(e)) + '</b><span class="cv">▾</span></span><button class="rxsave" data-act="saverx">Save Prescription</button></div>' +
        '<div class="rxtbl"><div class="rxth" style="grid-template-columns:' + tmpl + '"><div class="c static" data-act="setmenu" data-e="' + ei + '">' + e.sets.length + ' Sets</div>' +
        cols.map(function (c, ci) { return '<div class="c" data-act="colmenu" data-e="' + ei + '" data-c="' + ci + '">' + esc(c) + '<span class="cv">▾</span></div>'; }).join('') + '</div>' +
        '<div class="rxbody">' + e.sets.map(function (row, si) { return '<div class="rxr" style="grid-template-columns:' + tmpl + '"><span class="n">' + (si + 1) + '</span>' +
          cols.map(function (c, ci) { return '<input value="' + esc(row[ci] === undefined ? '' : row[ci]) + '" placeholder="' + (PH[c] || '') + '" data-act="cell" data-e="' + ei + '" data-s="' + si + '" data-c="' + ci + '">'; }).join('') + '</div>'; }).join('') + '</div></div>' +
        '<div class="rxfoot"><button data-act="addset" data-e="' + ei + '">+ Add set</button><button data-act="delset" data-e="' + ei + '">– Remove set</button></div>' +
        '</div></div></div>';
      if (ei < s.exercises.length - 1) {
        var lk = !!s.exercises[ei + 1].link;
        h += '<div class="exlink' + (lk ? ' on' : '') + '"><button class="chain" data-act="suplink" data-e="' + (ei + 1) + '" title="' + (lk ? 'Unlink superset' : 'Link into a superset') + '"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg></button></div>';
      }
    });
    h += '<div class="exadd2"><button data-act="addex">+ Add exercise</button><button data-act="addblock">+ Add section</button></div>';
    el.innerHTML = h;
  }

  function render() { renderTop(); renderNav(); renderEditor(); }

  /* ---------- white dropdown menu ---------- */
  var menu = document.getElementById('menu');
  function openMenu(anchor, items, onPick, checkVal) {
    var r = anchor.getBoundingClientRect();
    var m = document.createElement('div'); m.className = 'mmenu';
    m.innerHTML = items.map(function (it) { return it === '—SEP—' ? '<div class="sep"></div>' : '<button data-v="' + esc(it) + '"' + (it === checkVal ? ' class="on"' : '') + '>' + esc(it) + '</button>'; }).join('');
    menu.querySelectorAll('.mmenu').forEach(function (x) { x.remove(); });
    menu.appendChild(m); menu.classList.add('on');
    var top = r.bottom + 5, left = r.left, w = Math.max(190, r.width);
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + 300 > window.innerHeight) top = Math.max(8, r.top - 306);
    m.style.top = top + 'px'; m.style.left = left + 'px'; m.style.minWidth = w + 'px';
    m._pick = onPick;
  }
  function closeMenu() { menu.classList.remove('on'); menu.querySelectorAll('.mmenu').forEach(function (x) { x.remove(); }); }

  /* ---------- modal ---------- */
  var modal = document.getElementById('modal');
  function closeModal() { modal.classList.remove('on'); modal.innerHTML = ''; }
  function openAuth() {
    modal.innerHTML = '<div class="card" style="position:relative"><button class="x" data-act="mclose">×</button>' +
      (cloudUser
        ? '<h2>Signed in</h2><p class="sub">' + esc(cloudUser.email || '') + '</p><p style="color:var(--ink2);font-size:13px">Your library syncs to the cloud and to your phone account automatically.</p><div class="row"><button class="btn ghost" data-act="signout">Sign out</button></div>'
        : '<h2>Coach sign in</h2><p class="sub">Use the same account as your phone app. Your library syncs across both.</p>' +
          '<label>Email</label><input id="au-email" type="email" autocomplete="username" placeholder="you@email.com">' +
          '<label>Password</label><input id="au-pass" type="password" autocomplete="current-password" placeholder="••••••••">' +
          '<div class="err" id="au-err"></div>' +
          '<div class="row"><button class="btn primary" data-act="signin">Sign in</button><button class="btn ghost" data-act="signup">Create account</button></div>' +
          '<div class="muted">Not configured? The site still works fully offline — your library saves to this browser.</div>') +
      '</div>';
    modal.classList.add('on');
    var em = document.getElementById('au-email'); if (em) em.focus();
  }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function openAssign() {
    var s = day();
    if (!s) { modal.innerHTML = '<div class="card" style="position:relative"><button class="x" data-act="mclose">×</button><h2>Nothing to assign</h2><p class="sub">This day has no session yet — add one first.</p><div class="row"><button class="btn ghost" data-act="mclose">Close</button></div></div>'; modal.classList.add('on'); return; }
    modal.innerHTML = '<div class="card" style="position:relative"><button class="x" data-act="mclose">×</button>' +
      '<h2>Assign to phone</h2><p class="sub">Publishes <b>' + esc(s.title) + '</b> (' + s.exercises.length + ' exercise' + (s.exercises.length === 1 ? '' : 's') + ') to your Hybrid Engine calendar.</p>' +
      (cloudUser
        ? '<label>Date on the calendar</label><input id="as-date" type="date" value="' + todayISO() + '">' +
          '<div class="err" id="as-err"></div>' +
          '<div class="row"><button class="btn primary" data-act="doassign">Publish to my phone</button><button class="btn ghost" data-act="mclose">Cancel</button></div>' +
          '<div class="muted">Appears on your phone next time it syncs. Requires the coach schema to be set up in Supabase.</div>'
        : '<p style="color:var(--ink2);font-size:13px">Sign in first (same account as your phone) to publish sessions to your calendar.</p>' +
          '<div class="row"><button class="btn primary" data-act="account">Sign in</button><button class="btn ghost" data-act="mclose">Cancel</button></div>') +
      '</div>';
    modal.classList.add('on');
  }
  /* seconds from "m:ss" / "mm:ss" */
  function secondsFrom(v) { v = String(v || ''); if (v.indexOf(':') < 0) { var n = parseInt(v, 10); return isNaN(n) ? '' : String(n); } var p = v.split(':'); var m = parseInt(p[0], 10) || 0, sec = parseInt(p[1], 10) || 0; return String(m * 60 + sec); }
  /* map a coach session to a phone-shape workout via the emit contract */
  function sessionToWorkout(sess) {
    var exs = sess.exercises.map(function (e) {
      var mode = E.measureToMode(e.cols);
      var repsI = e.cols.indexOf('Reps'), timeI = e.cols.indexOf('Time (min:sec)'), rpeI = e.cols.indexOf('RPE');
      var sets = e.sets.map(function (row) {
        var target = repsI >= 0 ? row[repsI] : (timeI >= 0 ? secondsFrom(row[timeI]) : '');
        var rpe = rpeI >= 0 ? row[rpeI] : '';
        return E.newSet(target, rpe);
      });
      return E.newEx(e.name, mode, sets);
    });
    return E.newWorkout(sess.title, [E.newBlock(sess.section, exs, false)]);
  }
  function doAssign() {
    var s = day(), err = document.getElementById('as-err'), date = (document.getElementById('as-date') || {}).value || todayISO();
    if (!SB || !cloudUser) { closeModal(); openAuth(); return; }
    if (!s) { closeModal(); return; }
    var snap;
    try { snap = E.assert(sessionToWorkout(s)); }
    catch (e) { if (err) err.textContent = 'Could not convert session: ' + e.message; return; }
    if (err) err.textContent = 'Publishing…';
    var uidv = cloudUser.id;
    // idempotent self-assign for that date: clear any prior ad-hoc row on the date, then insert.
    SB.from('assignments').delete().eq('coach_id', uidv).eq('athlete_id', uidv).eq('scheduled_date', date).is('program_id', null).then(function () {
      return SB.from('assignments').insert({ coach_id: uidv, athlete_id: uidv, program_id: null, week_index: null, day_index: null, scheduled_date: date, session_snapshot: snap, status: 'assigned' });
    }).then(function (res) {
      if (res && res.error) { if (err) err.textContent = res.error.message; return; }
      closeModal(); toast('Published to your phone for ' + date);
    }).catch(function (e) { if (err) err.textContent = String(e && e.message || e); });
  }

  /* ---------- toast ---------- */
  var toastEl = document.getElementById('toast'), tt;
  function toast(t) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('on'); }, 2200); }

  /* ---------- rail (visual only for now) ---------- */
  document.getElementById('rail').addEventListener('click', function (e) {
    var b = e.target.closest('.railbtn'); if (!b) return;
    document.querySelectorAll('.railbtn').forEach(function (x) { x.classList.toggle('on', x === b); });
    if (b.dataset.nav !== 'library') toast(b.textContent.replace(/\s+/g, ' ').trim() + ' — coming in a later build');
  });

  /* ---------- clicks ---------- */
  document.addEventListener('click', function (ev) {
    var mi = ev.target.closest('.mmenu button'); if (mi) { var mm = mi.closest('.mmenu'); var fn = mm._pick; closeMenu(); if (fn) fn(mi.dataset.v); return; }
    var el = ev.target.closest('[data-act]'); if (!el) return; var a = el.dataset.act, ei = +el.dataset.e;
    if (a === 'day') { LIB.sel.d = +el.dataset.i; commit(); render(); }
    else if (a === 'suplink') { var xs = day().exercises; xs[ei].link = !xs[ei].link; commit(); render(); toast(xs[ei].link ? 'Linked into a superset' : 'Superset unlinked'); }
    else if (a === 'menuclose') { closeMenu(); }
    else if (a === 'mclose') { closeModal(); }
    else if (a === 'account') { openAuth(); }
    else if (a === 'assign') { openAssign(); }
    else if (a === 'doassign') { doAssign(); }
    else if (a === 'signin') { doAuth('signin'); }
    else if (a === 'signup') { doAuth('signup'); }
    else if (a === 'signout') { doSignOut(); }
    else if (a === 'wkmenu') {
      var wks = prog().weeks.map(function (_, i) { return 'Week ' + (i + 1); }); wks.push('—SEP—'); wks.push('+ Add week');
      openMenu(el, wks, function (v) { if (v[0] === '+') { prog().weeks.push(emptyWeek()); LIB.sel.w = prog().weeks.length - 1; } else { LIB.sel.w = parseInt(v.replace('Week ', ''), 10) - 1; } commit(); render(); }, 'Week ' + (LIB.sel.w + 1));
    }
    else if (a === 'progmenu') {
      var names = LIB.programs.map(function (p) { return p.name; }); names.push('—SEP—'); names.push('+ New program'); names.push('✎ Rename this program');
      openMenu(el, names, function (v) {
        if (v[0] === '+') { LIB.programs.push({ id: uid(), name: 'New program', weeks: [emptyWeek()] }); LIB.sel = { p: LIB.programs.length - 1, w: 0, d: 0 }; commit(); render(); toast('New program'); }
        else if (v[0] === '✎') { var nn = prompt('Program name:', prog().name); if (nn) { prog().name = nn.trim() || prog().name; commit(); render(); } }
        else { var i = LIB.programs.map(function (p) { return p.name; }).indexOf(v); if (i >= 0) { LIB.sel = { p: i, w: 0, d: 0 }; commit(); render(); } }
      }, prog().name);
    }
    else if (a === 'exmenu') { var e1 = day().exercises[ei]; openMenu(el, ['Back Squat', 'Front Squat', 'Box Squat', 'Romanian Deadlift with DB', 'Bench Press', 'Overhead Press', 'Deadlift', 'Pull-up', '—SEP—', 'Rename…'], function (v) { if (v === 'Rename…') { var nn = prompt('Exercise name:', e1.name); if (nn != null) e1.name = nn; } else { e1.name = v; } commit(); render(); toast('Set to ' + e1.name); }, e1.name); }
    else if (a === 'colmenu' || a === 'rxmenu') { var e2 = day().exercises[ei]; var ci = a === 'colmenu' ? +el.dataset.c : Math.max(0, e2.cols.length - 1); openMenu(el, MEASURES, function (v) { e2.cols[ci] = v; commit(); render(); toast('Measure set to ' + v); }, e2.cols[ci]); }
    else if (a === 'setmenu') { var e3 = day().exercises[ei]; openMenu(el, ['1 Set', '2 Sets', '3 Sets', '4 Sets', '5 Sets', '6 Sets', '8 Sets', '10 Sets'], function (v) { var n = parseInt(v, 10); while (e3.sets.length < n) e3.sets.push(e3.cols.map(function () { return ''; })); e3.sets = e3.sets.slice(0, n); commit(); render(); }, e3.sets.length + (e3.sets.length === 1 ? ' Set' : ' Sets')); }
    else if (a === 'secmenu') { openMenu(el, SECTIONS, function (v) { day().section = v; commit(); render(); }, day().section); }
    else if (a === 'addset') { var e4 = day().exercises[ei]; e4.sets.push(e4.cols.map(function () { return ''; })); commit(); render(); }
    else if (a === 'delset') { var e5 = day().exercises[ei]; if (e5.sets.length > 1) { e5.sets.pop(); commit(); render(); } }
    else if (a === 'exdel') { if (confirm('Remove this exercise from the session?')) { day().exercises.splice(ei, 1); if (!day().exercises.length) setDay(null); commit(); render(); toast('Exercise removed'); } }
    else if (a === 'del') { if (confirm('Delete this session? This cannot be undone.')) { setDay(null); commit(); render(); toast('Session deleted'); } }
    else if (a === 'save') { saveNow(); }
    else if (a === 'saverx') { commit(); toast('Prescription saved'); }
    else if (a === 'swaps') { toast('Swap editor — coming in a later build'); }
    else if (a === 'secdots' || a === 'msgs' || a === 'notif') { toast('Coming in a later build'); }
    else if (a === 'addsession') { setDay(dayM('New Session', 'Strength/Power', [exM('New Exercise', ['Reps', 'Weight (lb)'], [['', '']])])); commit(); render(); }
    else if (a === 'addex' || a === 'addblock') { if (day()) { day().exercises.push(exM('New Exercise', ['Reps', 'Weight (lb)'], [['', ''], ['', ''], ['', '']])); commit(); render(); toast('Exercise added'); } }
    else if (a === 'pop') { var ul = document.querySelector('[data-pop="' + ei + '"]'); if (ul) { var open = ul.style.display !== 'none'; ul.style.display = open ? 'none' : 'block'; el.classList.toggle('open', !open); } }
  });

  /* ---------- editable model sync (no re-render, keep focus) ---------- */
  document.addEventListener('input', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return; var a = el.dataset.act, ei = +el.dataset.e, s = day(); if (!s) return;
    if (a === 'cell') { s.exercises[ei].sets[+el.dataset.s][+el.dataset.c] = el.value; var sum = el.closest('.exright').querySelector('.rxsum b'); if (sum) sum.textContent = summary(s.exercises[ei]); commit(); }
    else if (a === 'cue') { s.exercises[ei].cues = el.value; var cc = el.parentNode.querySelector('.cc'); if (cc) cc.textContent = el.value.length + '/10000'; commit(); }
    else if (a === 'note') { s.note = el.value; var cc2 = el.parentNode.querySelector('.cc'); if (cc2) cc2.textContent = el.value.length + '/10000'; commit(); }
  });
  /* contenteditable session title */
  document.addEventListener('blur', function (ev) {
    var el = ev.target.closest && ev.target.closest('[data-act="title"]'); if (!el) return; var s = day(); if (!s) return;
    var v = el.textContent.trim(); if (v && v !== s.title) { s.title = v; commit(); renderNav(); renderTop(); } else if (!v) { el.textContent = s.title; }
  }, true);

  function saveNow() { saveLocal(); if (cloudUser) { pushLibrary(); toast('Saved · syncing to cloud'); } else { toast('Saved to this browser'); } }

  /* ---------- Supabase auth + cloud library ---------- */
  var cloudUser = null, cloudBusy = false;
  function doAuth(mode) {
    if (!SB) { toast('Cloud not configured — saved locally.'); return; }
    var email = (document.getElementById('au-email') || {}).value || '', pass = (document.getElementById('au-pass') || {}).value || '';
    var err = document.getElementById('au-err');
    if (!email.trim() || !pass) { if (err) err.textContent = 'Enter an email and password.'; return; }
    if (err) err.textContent = 'Working…';
    var p = mode === 'signup' ? SB.auth.signUp({ email: email.trim(), password: pass }) : SB.auth.signInWithPassword({ email: email.trim(), password: pass });
    p.then(function (res) {
      if (res.error) { if (err) err.textContent = res.error.message; return; }
      if (mode === 'signup' && res.data && !res.data.session) { if (err) err.textContent = 'Account created — check your email to confirm, then sign in.'; return; }
      cloudUser = res.data && res.data.user ? res.data.user : (res.data && res.data.session ? res.data.session.user : null);
      closeModal(); renderTop(); afterSignIn();
    }).catch(function (e) { if (err) err.textContent = String(e && e.message || e); });
  }
  function doSignOut() { if (SB) { try { SB.auth.signOut(); } catch (e) {} } cloudUser = null; closeModal(); renderTop(); toast('Signed out — still saved locally'); }

  function afterSignIn() {
    if (!SB || !cloudUser) return;
    cloudBusy = true; renderTop();
    SB.from('coach_library').select('library').eq('coach_id', cloudUser.id).maybeSingle().then(function (res) {
      cloudBusy = false;
      if (!res.error && res.data && res.data.library && Array.isArray(res.data.library.programs) && res.data.library.programs.length) {
        LIB = migrate(res.data.library); saveLocal(); render(); toast('Loaded your cloud library');
      } else { pushLibrary(); toast('Signed in — your library will sync'); renderTop(); }
    }).catch(function () { cloudBusy = false; renderTop(); });
  }
  function pushLibrary() {
    if (!SB || !cloudUser) return;
    cloudBusy = true; renderTop();
    SB.from('coach_library').upsert({ coach_id: cloudUser.id, library: LIB, updated_at: new Date().toISOString() }, { onConflict: 'coach_id' }).then(function (res) {
      cloudBusy = false; renderTop();
      if (res.error) toast('Cloud save failed: ' + res.error.message);
    }).catch(function (e) { cloudBusy = false; renderTop(); });
  }
  function cloudInit() {
    if (!SB) return;
    SB.auth.getSession().then(function (res) {
      cloudUser = res && res.data && res.data.session ? res.data.session.user : null;
      if (cloudUser) { renderTop(); afterSignIn(); }
    }).catch(function () {});
    SB.auth.onAuthStateChange(function (event, session) { cloudUser = session ? session.user : null; renderTop(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && cloudUser) afterSignIn(); });
  }

  /* ---------- boot ---------- */
  LIB = loadLocal();
  render();
  cloudInit();
  window.__coach = { get LIB() { return LIB; }, toast: toast }; // test hook
})();
