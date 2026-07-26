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

  /* ---------- data model ----------
     Mirrors the phone, deliberately: a session is blocks, a block is exercises,
     an exercise carries sets of {t,rpe}. sessionToWorkout is then almost an
     identity function instead of a lossy translation. Conditioning is its own
     block kind, as it is on the phone. */
  function exM(name, sets, opts) {
    opts = opts || {};
    return { id: uid(), name: name || '', sets: sets && sets.length ? sets : [setM('', '')],
      rest: opts.rest == null ? 90 : opts.rest, cue: opts.cue || '' };
  }
  function setM(t, rpe) { return { t: t == null ? '' : String(t), rpe: rpe == null ? '' : String(rpe) }; }
  function blockM(h, ex, ss, mins) { return { h: h || 'Main', mins: mins || '', ss: !!ss, ex: ex || [] }; }
  function condM(h, fmt, eff) { return { kind: 'cond', h: h || 'Finisher', fmt: fmt || 'intervals', eff: eff || 'medium' }; }
  function dayM(title, blocks) { return { title: title || 'Session', note: '', blocks: blocks || [] }; }
  function emptyWeek() { return { days: [null, null, null, null, null, null, null] }; }

  /* A target beginning with W is a warm-up — the same convention the phone
     reads (isWarmup in app.js). It rides in `t` because a planned set's shape
     is contractual: exactly {t,rpe}. */
  function isWarm(st) { return /^\s*w/i.test(st && st.t || ''); }

  var COND_FORMATS = [['steady', 'Steady'], ['intervals', 'Intervals'], ['tempo', 'Tempo'], ['free', 'Free run']];
  var EFFORTS = [['easy', 'Easy', 'RPE 3-4'], ['medium', 'Medium', 'RPE 5-7'], ['hard', 'Hard', 'RPE 8-9.5']];
  var LIBRARY = ['Back Squat', 'Front Squat', 'Romanian Deadlift', 'Conventional Deadlift', 'Barbell Hip Thrust',
    'DB Bench Press', 'Barbell Bench Press', 'Incline DB Press', 'Chest-Supported Row', 'Barbell Row',
    'Weighted Pull-up', 'Overhead Press', 'Walking Lunge', 'Bulgarian Split Squat', 'Farmer Carry', 'Plank'];

  function seedProgram() {
    var w1 = { days: [
      { title: 'Lower + Engine', note: 'Belt optional. Honest bar speed on all five.', blocks: [
        blockM('Main', [
          exM('Back Squat', [setM('W10', ''), setM('W5', ''), setM('5', '7'), setM('5', '8'), setM('5', '8')], { rest: 180 }),
          exM('Romanian Deadlift', [setM('8-10', '7.5'), setM('8-10', '7.5'), setM('8-10', '7.5')], { rest: 120 })
        ], false, '18 min'),
        blockM('Accessory', [
          exM('DB Bench Press', [setM('12', '8'), setM('10', '8'), setM('8', '8')], { rest: 0 }),
          exM('Chest-Supported Row', [setM('10-12', '8'), setM('10-12', '8'), setM('10-12', '8')], { rest: 90 })
        ], true, '10 min'),
        condM('Finisher', 'intervals', 'medium')
      ] },
      null, null,
      dayM('Heavy Lower', [blockM('Main', [
        exM('Front Squat', [setM('3', '8'), setM('3', '8.5'), setM('3', '9')], { rest: 180 })
      ], false, '20 min')]),
      null,
      dayM('Engine', [condM('Conditioning', 'steady', 'easy')]),
      null
    ] };
    return { id: uid(), name: 'Sample Program', weeks: [w1, emptyWeek(), emptyWeek(), emptyWeek()] };
  }

  var LIB = null;

  /* ---------- migration from the old column/matrix model ----------
     The previous editor stored an exercise as {cols:[measure], sets:[[cell]]}
     with a `link` flag for supersets. Convert without losing anything the coach
     already typed: consecutive link runs become one superset block, Reps/Time
     becomes the per-set target, RPE becomes the per-set RPE, and any prescribed
     WEIGHT column — which had nowhere to go in the phone's {t,rpe} set — is
     folded into the exercise cue rather than dropped on the floor. */
  var OLD_PH = { 'Weight (lb)': 'lb', 'Weight (kg)': 'kg', 'Weight (%)': '%', 'Weight (LWP+)': 'LWP+' };
  function secondsFrom(v) {
    v = String(v || '');
    if (v.indexOf(':') < 0) { var n = parseInt(v, 10); return isNaN(n) ? '' : String(n); }
    var q = v.split(':'); return String((parseInt(q[0], 10) || 0) * 60 + (parseInt(q[1], 10) || 0));
  }
  function migrateExercise(e) {
    var cols = Array.isArray(e.cols) ? e.cols : [];
    var rows = Array.isArray(e.sets) ? e.sets : [];
    var repsI = cols.indexOf('Reps'), timeI = cols.indexOf('Time (min:sec)'), rpeI = cols.indexOf('RPE');
    var wI = -1;
    cols.forEach(function (c, i) { if (wI < 0 && String(c).indexOf('Weight') === 0) wI = i; });
    var sets = rows.map(function (row) {
      row = Array.isArray(row) ? row : [];
      var t = repsI >= 0 ? row[repsI] : (timeI >= 0 ? secondsFrom(row[timeI]) : '');
      return setM(t, rpeI >= 0 ? row[rpeI] : '');
    });
    if (!sets.length) sets = [setM('', '')];
    // keep the prescribed loads as words, since they have no field of their own
    var cue = typeof e.cues === 'string' ? e.cues : '';
    if (wI >= 0) {
      var loads = rows.map(function (r) { return Array.isArray(r) ? r[wI] : ''; }).filter(function (v) { return v && v !== '—'; });
      if (loads.length) {
        var uniqL = loads.filter(function (v, i) { return loads.indexOf(v) === i; });
        var unit = OLD_PH[cols[wI]] || '';
        cue = (cue ? cue + '\n' : '') + 'Prescribed load: ' + (uniqL.length === 1 ? uniqL[0] : loads.join(' / ')) + unit;
      }
    }
    return exM(e.name || '', sets, { cue: cue });
  }
  function migrateSession(s) {
    if (!s || typeof s !== 'object') return null;
    if (Array.isArray(s.blocks)) return s;                 // already migrated
    if (!Array.isArray(s.exercises)) return null;
    var blocks = [], run = [];
    var head = typeof s.section === 'string' ? s.section : 'Main';
    var flush = function () { if (run.length) { blocks.push(blockM(head, run.map(migrateExercise), run.length > 1, '')); run = []; } };
    s.exercises.forEach(function (e, i) { if (i > 0 && !e.link) flush(); run.push(e); });
    flush();
    if (!blocks.length) return null;
    return { title: typeof s.title === 'string' ? s.title : 'Session', note: typeof s.note === 'string' ? s.note : '', blocks: blocks };
  }

  // Coerce one session into a safe shape; anything unusable becomes a rest day.
  function sanitizeSession(sess) {
    sess = migrateSession(sess);
    if (!sess) return null;
    sess.title = typeof sess.title === 'string' ? sess.title : 'Session';
    sess.note = typeof sess.note === 'string' ? sess.note : '';
    sess.blocks = (Array.isArray(sess.blocks) ? sess.blocks : []).map(function (b) {
      b = (b && typeof b === 'object') ? b : {};
      if (b.kind === 'cond') {
        b.h = typeof b.h === 'string' ? b.h : 'Finisher';
        if (!COND_FORMATS.some(function (f) { return f[0] === b.fmt; })) b.fmt = 'intervals';
        if (!EFFORTS.some(function (f) { return f[0] === b.eff; })) b.eff = 'medium';
        return b;
      }
      b.h = typeof b.h === 'string' ? b.h : 'Main';
      b.mins = typeof b.mins === 'string' ? b.mins : '';
      b.ss = !!b.ss;
      b.ex = (Array.isArray(b.ex) ? b.ex : []).filter(function (e) { return e && typeof e === 'object'; }).map(function (e) {
        if (!e.id) e.id = uid();
        e.name = typeof e.name === 'string' ? e.name : '';
        e.cue = typeof e.cue === 'string' ? e.cue : '';
        var r = parseInt(e.rest, 10); e.rest = (isFinite(r) && r >= 0) ? Math.min(r, 3600) : 90;
        e.sets = (Array.isArray(e.sets) ? e.sets : []).map(function (st) {
          st = (st && typeof st === 'object') ? st : {};
          return setM(st.t, st.rpe);
        });
        if (!e.sets.length) e.sets = [setM('', '')];
        return e;
      });
      return b;
    }).filter(function (b) { return b.kind === 'cond' || b.ex.length; });
    return sess.blocks.length ? sess : null;
  }
  function migrate(lib) {
    if (!lib || typeof lib !== 'object' || !Array.isArray(lib.programs) || !lib.programs.length) return { programs: [seedProgram()], sel: { p: 0, w: 0, d: 0 } };
    lib.sel = (lib.sel && typeof lib.sel === 'object') ? lib.sel : { p: 0, w: 0, d: 0 };
    lib.programs = lib.programs.filter(function (p) { return p && typeof p === 'object'; });
    if (!lib.programs.length) return { programs: [seedProgram()], sel: { p: 0, w: 0, d: 0 } };
    lib.programs.forEach(function (p) {
      p.name = typeof p.name === 'string' ? p.name : 'Program';
      if (!Array.isArray(p.weeks) || !p.weeks.length) p.weeks = [emptyWeek()];
      p.weeks = p.weeks.map(function (w) {
        if (!w || typeof w !== 'object' || !Array.isArray(w.days)) w = { days: [] };
        w.days = w.days.concat([null, null, null, null, null, null, null]).slice(0, 7).map(sanitizeSession);
        return w;
      });
    });
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

  /* persist locally + push to cloud (debounced). _dirty tracks un-pushed local
     edits so a background re-fetch can never clobber work you haven't saved up. */
  var pushTimer = null, _dirty = false;
  function commit() { _dirty = true; saveLocal(); if (cloudUser) { if (pushTimer) clearTimeout(pushTimer); pushTimer = setTimeout(pushLibrary, 900); } }

  /* ---------- labels + summary ----------
     Letters run A, B, C across the whole session; a superset pair shares one as
     A1/A2. summary() mirrors the phone's rxLine exactly, so what the coach
     reads here is what the athlete reads on their card. */
  function letters(sess) {
    var map = {}, n = 0;
    (sess.blocks || []).forEach(function (b, bi) {
      if (b.kind === 'cond') return;
      if (b.ss) { var L = String.fromCharCode(65 + n++); b.ex.forEach(function (e, ei) { map[bi + '-' + ei] = L + (ei + 1); }); }
      else b.ex.forEach(function (e, ei) { map[bi + '-' + ei] = String.fromCharCode(65 + n++); });
    });
    return map;
  }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function fmtRest(sec) { return sec ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : 'none'; }
  function summary(e) {
    var vals = e.sets.map(function (st) { return st.t || '—'; }), u = uniq(vals);
    var rx = e.sets.length + ' × ' + (u.length === 1 ? u[0] : vals.join('/'));
    var rpes = e.sets.map(function (st) { return st.rpe == null ? '' : String(st.rpe).trim(); }).filter(Boolean);
    if (rpes.length) { var ur = uniq(rpes); rx += ' · RPE ' + (ur.length === 1 ? ur[0] : rpes[0] + '→' + rpes[rpes.length - 1]); }
    return rx + (e.rest ? ' · rest ' + fmtRest(e.rest) : '');
  }
  function effLabel(k) { var f = EFFORTS.filter(function (x) { return x[0] === k; })[0]; return f ? f[1] : 'Medium'; }
  function effBand(k) { var f = EFFORTS.filter(function (x) { return x[0] === k; })[0]; return f ? f[2] : 'RPE 5-7'; }
  function fmtLabel(k) { var f = COND_FORMATS.filter(function (x) { return x[0] === k; })[0]; return f ? f[1] : 'Intervals'; }
  function condSummary(b) { return effLabel(b.eff) + ' · ' + effBand(b.eff) + ' · runs by heart rate'; }

  /* ---------- render: topbar ---------- */
  function renderTop() {
    document.getElementById('progname').textContent = prog().name;
    document.getElementById('wklabel').textContent = 'Week ' + (LIB.sel.w + 1);
    document.getElementById('days').innerHTML = week().days.map(function (s, i) {
      return '<button class="day' + (i === LIB.sel.d ? ' on' : '') + (s ? ' has' : '') + '" data-act="day" data-i="' + i + '">' + (i + 1) + '</button>';
    }).join('');
    var pill = document.getElementById('syncpill'), lab = document.getElementById('synclabel'), av = document.getElementById('avatar');
    pill.className = 'syncpill ' + (cloudUser ? 'ok' : 'off');
    if (cloudUser) { var em = cloudUser.email || 'account'; lab.textContent = cloudBusy ? 'Syncing…' : 'Synced'; av.textContent = (em[0] || '·').toUpperCase(); }
    else { lab.textContent = 'Local only'; av.textContent = '·'; }
  }
  function renderNav() { /* the week strip lives in the top bar now */ }

  /* ---------- render: the session ----------
     One column of the phone's own cards. A card opens in place — on a laptop
     there is room to keep the session visible, unlike the phone's full-screen
     stage — and only one is open at a time. */
  var OPEN = { b: -1, e: -1 }, PICK = null;

  function chainSvg() { return '<svg viewBox="0 0 24 24"><path d="M9 12h6M8 8.5 5.5 11a3.5 3.5 0 0 0 5 5L13 13.5M16 15.5l2.5-2.5a3.5 3.5 0 0 0-5-5L11 10.5"/></svg>'; }
  function seam(bi, ei, cross, on) {
    return '<div class="planseam"><button class="' + (on ? 'on' : '') + '" data-act="link" data-b="' + bi + '" data-e="' + ei + '" data-x="' + (cross ? 1 : 0) + '" ' +
      'title="' + (on ? 'split them apart' : 'chain into a superset') + '" aria-label="' + (on ? 'split the superset here' : 'chain into a superset') + '">' + chainSvg() + '</button></div>';
  }

  function exCard(e, bi, ei, LTR) {
    var open = OPEN.b === bi && OPEN.e === ei, ltr = LTR[bi + '-' + ei] || '?';
    if (!open) {
      return '<section class="lgx"><button class="lgcrow" data-act="open" data-b="' + bi + '" data-e="' + ei + '">' +
        '<span class="lgltr">' + ltr + '</span><span class="lgcn"><b>' + esc(e.name || 'Exercise') + '</b><span>' + esc(summary(e)) + '</span></span>' +
        '<span class="lgcar">›</span></button></section>';
    }
    var rows = e.sets.map(function (st, si) {
      var w = isWarm(st);
      return '<div class="setrow' + (w ? ' warm' : '') + '">' +
        '<span class="setn">' + (w ? 'Warm' : 'Set ' + (si + 1)) + '</span>' +
        '<input class="sett" value="' + esc(st.t) + '" data-act="st" data-b="' + bi + '" data-e="' + ei + '" data-s="' + si + '" placeholder="reps" aria-label="target for set ' + (si + 1) + '">' +
        '<input class="setr" value="' + esc(st.rpe) + '" data-act="sr" data-b="' + bi + '" data-e="' + ei + '" data-s="' + si + '" placeholder="' + (w ? '—' : 'RPE') + '" aria-label="target RPE for set ' + (si + 1) + '">' +
        (e.sets.length > 1 ? '<button class="setx" data-act="delset" data-b="' + bi + '" data-e="' + ei + '" data-s="' + si + '" aria-label="remove set ' + (si + 1) + '">✕</button>' : '<span class="setx ghost"></span>') +
      '</div>';
    }).join('');
    return '<section class="lgx open"><div class="lgcrow">' +
      '<span class="lgltr">' + ltr + '</span>' +
      '<span class="lgcn"><button class="namebtn" data-act="pick" data-b="' + bi + '" data-e="' + ei + '">' + esc(e.name || 'Exercise') + '<span class="pen">✎</span></button>' +
        '<span>' + esc(summary(e)) + '</span></span>' +
      '<button class="lgcar" data-act="open" data-b="' + bi + '" data-e="' + ei + '" aria-label="collapse">▴</button></div>' +
      '<div class="lg-body">' +
        '<div class="f" style="align-items:flex-start"><label style="padding-top:11px">Sets &amp; reps</label><div class="setlist">' + rows +
          '<button class="addset" data-act="addset" data-b="' + bi + '" data-e="' + ei + '">＋ Add set</button>' +
          '<p class="setshint">Type what the athlete should hit — <b>8</b>, <b>8-12</b>, <b>max</b>. Start with <b>W</b> for a warm-up (<b>W</b> or <b>W10</b>). A different number per set makes a ladder.</p>' +
        '</div></div>' +
        '<div class="f"><label>Rest</label><div class="step">' +
          '<button data-act="rest" data-b="' + bi + '" data-e="' + ei + '" data-d="-15">−</button>' +
          '<span class="val">' + fmtRest(e.rest) + '</span>' +
          '<button data-act="rest" data-b="' + bi + '" data-e="' + ei + '" data-d="15">+</button></div></div>' +
        '<div class="cuefield"><label>Note for the athlete</label>' +
          '<textarea data-act="cue" data-b="' + bi + '" data-e="' + ei + '" placeholder="Cues, or a prescribed load — the athlete reads this on the card.">' + esc(e.cue) + '</textarea></div>' +
        '<div class="cardctl">' +
          '<button class="ctlbtn" data-act="move" data-b="' + bi + '" data-e="' + ei + '" data-d="-1" aria-label="move up">↑</button>' +
          '<button class="ctlbtn" data-act="move" data-b="' + bi + '" data-e="' + ei + '" data-d="1" aria-label="move down">↓</button>' +
          '<button class="ctlbtn del" data-act="exdel" data-b="' + bi + '" data-e="' + ei + '" aria-label="remove">✕</button></div>' +
      '</div></section>';
  }

  function condCard(b, bi) {
    var open = OPEN.b === bi;
    if (!open) {
      return '<section class="lgx cond"><button class="lgcrow" data-act="open" data-b="' + bi + '" data-e="0">' +
        '<span class="lgltr">♥</span><span class="lgcn"><b>' + esc(fmtLabel(b.fmt)) + '</b><span>' + esc(condSummary(b)) + '</span></span>' +
        '<span class="lgcar">›</span></button></section>';
    }
    return '<section class="lgx cond open"><div class="lgcrow">' +
      '<span class="lgltr">♥</span><span class="lgcn"><b>' + esc(fmtLabel(b.fmt)) + '</b><span>' + esc(condSummary(b)) + '</span></span>' +
      '<button class="lgcar" data-act="open" data-b="' + bi + '" data-e="0" aria-label="collapse">▴</button></div><div class="lg-body">' +
      '<div class="f" style="align-items:flex-start"><label style="padding-top:9px">Format</label><div class="chips">' +
        COND_FORMATS.map(function (f) { return '<button class="chip' + (f[0] === b.fmt ? ' on' : '') + '" data-act="cfmt" data-b="' + bi + '" data-v="' + f[0] + '">' + f[1] + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="f" style="align-items:flex-start"><label style="padding-top:9px">Effort</label><div class="chips">' +
        EFFORTS.map(function (f) { return '<button class="chip e-' + f[0] + (f[0] === b.eff ? ' on' : '') + '" data-act="ceff" data-b="' + bi + '" data-v="' + f[0] + '">' + f[1] + '<i>' + f[2] + '</i></button>'; }).join('') +
      '</div></div>' +
      '<div class="cardctl"><button class="ctlbtn del" data-act="blockdel" data-b="' + bi + '" aria-label="remove">✕</button></div>' +
      '</div></section>';
  }

  function renderEditor() {
    var s = day(), el = document.getElementById('editor');
    var kick = 'Week ' + (LIB.sel.w + 1) + ' · Day ' + (LIB.sel.d + 1) + ' · saves as you go';
    if (!s) {
      el.innerHTML = '<div class="edcol"><div class="kicker">' + kick + '</div><h1 class="ttl">Rest day</h1>' +
        '<div class="addrow"><button class="addbtn" data-act="addsession">＋ Add a session to this day</button></div></div>';
      return;
    }
    var LTR = letters(s), out = '';
    s.blocks.forEach(function (b, bi) {
      out += '<div class="sec"><input class="sech" value="' + esc(b.h) + '" data-act="head" data-b="' + bi + '" spellcheck="false" aria-label="block name">' +
        (b.kind === 'cond'
          ? '<span class="secm ro">heart rate</span>'   // the engine sets the duration, not the coach
          : '<input class="secm" value="' + esc(b.mins || '') + '" data-act="mins" data-b="' + bi + '" placeholder="mins" aria-label="block duration">') + '</div>';
      if (b.kind === 'cond') { out += condCard(b, bi); return; }
      var rows = b.ex.map(function (e, ei) {
        return exCard(e, bi, ei, LTR) + (ei < b.ex.length - 1 ? seam(bi, ei, false, !!b.ss) : '');
      }).join('');
      out += b.ss ? '<div class="superwrap">' + rows + '</div>' : rows;
      var nb = s.blocks[bi + 1];
      if (nb && nb.kind !== 'cond' && b.kind !== 'cond') out += seam(bi, b.ex.length - 1, true, false);
    });
    el.innerHTML = '<div class="edcol">' +
      '<div class="kicker">' + kick + '</div>' +
      '<input class="ttl" value="' + esc(s.title) + '" data-act="title" spellcheck="false" aria-label="session name">' +
      '<div class="coachnote"><label>Coach instructions · travels with the session</label>' +
        '<textarea data-act="note" placeholder="Anything the athlete should read before starting…">' + esc(s.note) + '</textarea></div>' +
      out +
      '<div class="addrow">' +
        '<button class="addbtn" data-act="addex">＋ Exercise</button>' +
        '<button class="addbtn" data-act="addblock">＋ Block</button>' +
        '<button class="addbtn" data-act="addcond">♥ Conditioning</button>' +
      '</div></div>';
  }

  /* ---------- movement picker ---------- */
  function openPick(bi, ei) {
    PICK = { b: bi, e: ei };
    modal.innerHTML = '<div class="card sheet" style="position:relative"><button class="x" data-act="mclose">×</button>' +
      '<h2>Choose a movement</h2><p class="sub">Search the library, or type any name.</p>' +
      '<input id="pick-q" placeholder="Search or type a name" autocomplete="off">' +
      '<div class="opts" id="pick-opts"></div></div>';
    modal.classList.add('on');
    fillPick('');
    var q = document.getElementById('pick-q'); if (q) q.focus();
  }
  function fillPick(q) {
    q = String(q || '').trim().toLowerCase();
    var list = LIBRARY.filter(function (n) { return !q || n.toLowerCase().indexOf(q) >= 0; });
    var html = list.map(function (n) { return '<button class="opt" data-act="pickone" data-v="' + esc(n) + '">' + esc(n) + '</button>'; }).join('');
    if (q && !list.some(function (n) { return n.toLowerCase() === q; })) {
      html = '<button class="opt" data-act="pickone" data-v="' + esc(q) + '">Use “' + esc(q) + '”<small>not in the library — add it anyway</small></button>' + html;
    }
    document.getElementById('pick-opts').innerHTML = html || '';
  }

  /* ---------- athletes (coach-side review) ----------
     Reads each linked athlete's athlete_feed — the digest their app publishes.
     Read-only by construction: RLS grants SELECT only, and only while the link
     is active, so an athlete disconnecting removes this view's data instantly. */
  var VIEW = 'library', ATHLETES = [], FEEDS = {}, ATH_SEL = null, ATH_BUSY = false;

  function loadAthletes() {
    if (!SB || !cloudUser) { ATHLETES = []; renderAthletes(); return; }
    ATH_BUSY = true; renderAthletes();
    SB.from('coach_athletes').select('id,athlete_id,label,status,invite_token,created_at')
      .eq('coach_id', cloudUser.id).order('created_at', { ascending: true })
      .then(function (res) {
        ATH_BUSY = false;
        ATHLETES = (res && !res.error && res.data) ? res.data : [];
        renderAthletes();
        ATHLETES.filter(function (a) { return a.status === 'active' && a.athlete_id; })
          .forEach(function (a) { loadFeed(a.athlete_id); });
      }).catch(function () { ATH_BUSY = false; renderAthletes(); });
  }
  function loadFeed(aid) {
    SB.from('athlete_feed').select('payload,updated_at').eq('athlete_id', aid).maybeSingle()
      .then(function (res) {
        if (res && !res.error && res.data) FEEDS[aid] = res.data;
        renderAthletes();
      }).catch(function () {});
  }
  function inviteAthlete() {
    if (!SB || !cloudUser) { openAuth(); return; }
    var label = prompt('Name for this athlete (only you see it):', '');
    if (label === null) return;
    var token = (function () { try { return crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(); } catch (e) { return String(Date.now()).slice(-10); } })();
    SB.from('coach_athletes').insert({ coach_id: cloudUser.id, athlete_id: null, status: 'pending', invite_token: token, label: (label || '').trim() || null })
      .then(function (res) {
        if (res && res.error) { toast('Could not create invite: ' + res.error.message); return; }
        loadAthletes(); toast('Invite created — share the code');
      }).catch(function (e) { toast(String(e && e.message || e)); });
  }
  function revokeAthlete(id) {
    if (!confirm('Remove this athlete? They stop appearing here and you lose access to their training.')) return;
    SB.from('coach_athletes').delete().eq('id', id).then(function () { loadAthletes(); toast('Removed'); }).catch(function () {});
  }
  function fmtK(v) { v = Math.round(v); return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(v); }
  function since(d) { if (!d) return ''; var n = Math.round((Date.now() - new Date(d).getTime()) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + 'd ago'; }

  function athleteDetailHTML(a) {
    var f = FEEDS[a.athlete_id], p = f && f.payload;
    if (!p) return '<div class="microval">No training published yet — it appears once they log a session and sync.</div>';
    var ss = (p.sessions || []).slice().reverse(), cond = (p.conditioning || []).slice().reverse(), wh = (p.whoop || []).slice().reverse();
    var wk = Date.now() - 7 * 864e5;
    var wkSess = ss.filter(function (x) { return new Date(x.date).getTime() >= wk; });
    var vol = wkSess.reduce(function (n, x) { return n + (x.volumeKg || 0); }, 0);
    var condMin = cond.filter(function (x) { return new Date(x.date).getTime() >= wk; }).reduce(function (n, x) { return n + Math.round((x.dur || 0) / 60); }, 0);
    var lastW = wh[0];
    var h = '<div class="ath-stats">' +
      '<div class="ath-stat"><b>' + wkSess.length + '</b><span>sessions · 7d</span></div>' +
      '<div class="ath-stat"><b>' + fmtK(vol) + '</b><span>kg volume · 7d</span></div>' +
      '<div class="ath-stat"><b>' + condMin + '</b><span>cond. min · 7d</span></div>' +
      '<div class="ath-stat"><b>' + (lastW && lastW.recovery != null ? lastW.recovery + '%' : '—') + '</b><span>last recovery</span></div>' +
      '</div>';
    h += '<div class="microlab" style="margin-top:18px">Recent sessions</div>';
    h += ss.length ? ss.slice(0, 12).map(function (x) {
      return '<div class="ath-row"><div><b>' + esc(x.name) + '</b><span>' + esc(x.date) + ' · ' + since(x.date) +
        (x.exercises && x.exercises.length ? ' · ' + esc(x.exercises.slice(0, 3).join(', ')) : '') + '</span></div>' +
        '<span class="ath-num">' + (x.volumeKg ? fmtK(x.volumeKg) + 'kg' : (x.setsDone + '/' + x.setsTotal)) + '</span></div>';
    }).join('') : '<div class="microval">Nothing logged yet.</div>';
    if (cond.length) {
      h += '<div class="microlab" style="margin-top:18px">Conditioning &amp; runs</div>';
      h += cond.slice(0, 10).map(function (x) {
        var z = x.zsec || {}; var tot = (z.low || 0) + (z.mod || 0) + (z.high || 0);
        return '<div class="ath-row"><div><b>' + esc(x.fmt || 'Session') + '</b><span>' + esc(x.date) + ' · ' + Math.round((x.dur || 0) / 60) + ' min' +
          (x.avg ? ' · avg ' + x.avg + ' bpm' : '') + (tot ? ' · ' + Math.round(tot / 60) + ' min in zone' : '') + '</span></div>' +
          '<span class="ath-num">' + (x.max ? x.max + ' max' : '') + '</span></div>';
      }).join('');
    }
    if (wh.length) {
      h += '<div class="microlab" style="margin-top:18px">WHOOP · last 14 days</div><div class="ath-wh">';
      h += wh.slice(0, 14).reverse().map(function (x) {
        var r = x.recovery == null ? null : x.recovery;
        var col = r == null ? 'var(--line2)' : r >= 67 ? 'var(--ok)' : r >= 34 ? 'var(--warn)' : 'var(--danger)';
        return '<div class="ath-whd" title="' + esc(x.date) + (r != null ? ' · ' + r + '%' : '') + '"><i style="height:' + (r == null ? 6 : Math.max(6, r)) + '%;background:' + col + '"></i></div>';
      }).join('');
      h += '</div>';
    }
    h += '<div class="microval" style="margin-top:14px;color:var(--faint)">Updated ' + since(f.updated_at) + ' · read-only</div>';
    return h;
  }

  function renderAthletes() {
    var el = document.getElementById('editor');
    if (VIEW !== 'athletes') return;
    var h = '<div class="ed-top"><h1>Athletes</h1><div class="grow"></div>' +
      '<button class="assignbtn" data-act="invite"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Invite athlete</button></div>';
    if (!cloudUser) { el.innerHTML = h + '<div class="c-field" style="margin-top:20px"><p>Sign in to manage athletes.</p></div>'; return; }
    if (ATH_BUSY && !ATHLETES.length) { el.innerHTML = h + '<div class="microval" style="margin-top:20px">Loading…</div>'; return; }
    if (!ATHLETES.length) {
      el.innerHTML = h + '<div class="c-field" style="margin-top:20px"><p>No athletes yet. Create an invite and send them the code — they paste it into <b>Settings → Coach</b> in their app.</p></div>';
      return;
    }
    var sel = ATH_SEL || (ATHLETES.find(function (a) { return a.status === 'active'; }) || ATHLETES[0]).id;
    ATH_SEL = sel;
    h += '<div class="ath-wrap">';
    h += '<div class="ath-list">' + ATHLETES.map(function (a) {
      var on = a.id === sel, pend = a.status !== 'active';
      return '<button class="ath-card' + (on ? ' on' : '') + '" data-act="athsel" data-id="' + esc(a.id) + '">' +
        '<b>' + esc(a.label || 'Athlete') + '</b>' +
        '<span>' + (pend ? 'Invite pending' : 'Connected') + '</span>' +
        (pend ? '<code class="ath-code">' + esc(a.invite_token) + '</code>' : '') + '</button>';
    }).join('') + '</div>';
    var a = ATHLETES.find(function (x) { return x.id === sel; });
    h += '<div class="ath-detail">';
    if (a && a.status !== 'active') {
      h += '<h2 style="font-size:18px;font-weight:800">' + esc(a.label || 'Athlete') + '</h2>' +
        '<div class="microval" style="margin-top:10px">Send them this code — they paste it into <b>Settings → Coach</b> in their app:</div>' +
        '<div class="ath-bigcode">' + esc(a.invite_token) + '</div>' +
        '<div class="microval">The code works once. Their training appears here after they connect and sync.</div>';
    } else if (a) {
      h += '<h2 style="font-size:18px;font-weight:800">' + esc(a.label || 'Athlete') + '</h2>' + athleteDetailHTML(a);
    }
    if (a) h += '<button class="rxsave" style="margin-top:20px" data-act="athdel" data-id="' + esc(a.id) + '">Remove athlete</button>';
    h += '</div></div>';
    el.innerHTML = h;
  }

  function render() { renderTop(); if (VIEW === 'athletes') { renderAthletes(); } else { renderNav(); renderEditor(); } }

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
  function countEx(s) {
    var n = 0, c = 0;
    (s.blocks || []).forEach(function (b) { if (b.kind === 'cond') c++; else n += b.ex.length; });
    return n + ' exercise' + (n === 1 ? '' : 's') + (c ? ' · ' + c + ' conditioning' : '');
  }
  function openAssign() {
    var s = day();
    if (!s) { modal.innerHTML = '<div class="card" style="position:relative"><button class="x" data-act="mclose">×</button><h2>Nothing to assign</h2><p class="sub">This day has no session yet — add one first.</p><div class="row"><button class="btn ghost" data-act="mclose">Close</button></div></div>'; modal.classList.add('on'); return; }
    modal.innerHTML = '<div class="card" style="position:relative"><button class="x" data-act="mclose">×</button>' +
      '<h2>Assign to phone</h2><p class="sub">Publishes <b>' + esc(s.title) + '</b> (' + countEx(s) + ') to your Hybrid Engine calendar.</p>' +
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
  /* Map a coach session to a phone-shape workout. The models now agree, so this
     is close to an identity — and crucially it no longer drops anything: rest,
     the cue, block headings/minutes, superset grouping and conditioning
     (format + effort) all travel. Prescribed load has no field in the phone's
     {t,rpe} set model, so it lives in the cue, which the athlete reads on the
     card. */
  function toPhoneEx(e) {
    // seconds mode when every target is plainly a duration; otherwise reps+kg
    var allSecs = e.sets.length && e.sets.every(function (st) { return /^\s*\d+\s*$/.test(st.t) && parseInt(st.t, 10) > 30; });
    var anyMax = e.sets.some(function (st) { return /^\s*max\s*$/i.test(st.t); });
    var mode = anyMax ? 'amrap' : (allSecs ? 'seconds' : 'reps_kg');
    var sets = e.sets.map(function (st) { return E.newSet(st.t, st.rpe); });
    return E.newEx(e.name, mode, sets, { rest: e.rest, cue: e.cue });
  }
  function sessionToWorkout(sess) {
    var blocks = (sess.blocks || []).map(function (b) {
      if (b.kind === 'cond') return E.newCondBlock(b.h, b.fmt, b.eff, '');
      return E.newBlock(b.h, b.ex.map(toPhoneEx), b.ss, { minutes: b.mins, format: b.ss ? 'Superset' : '' });
    }).filter(Boolean);
    if (!blocks.length) blocks.push(E.newBlock('Main', [E.newEx('', 'reps', [E.newSet()])], false));
    // the session-level coach note rides along on the workout
    return E.newWorkout(sess.title, blocks, sess.note ? { note: sess.note } : null);
  }
  var _assigning = false;
  function doAssign() {
    var s = day(), err = document.getElementById('as-err'), date = (document.getElementById('as-date') || {}).value || todayISO();
    if (!SB || !cloudUser) { closeModal(); openAuth(); return; }
    if (!s || _assigning) return;
    var snap;
    try { snap = E.assert(sessionToWorkout(s)); }
    catch (e) { if (err) err.textContent = 'Could not convert session: ' + e.message; return; }
    _assigning = true; if (err) err.textContent = 'Publishing…';
    var uidv = cloudUser.id;
    // idempotent self-assign for that date: clear any prior ad-hoc row on the date, then insert.
    SB.from('assignments').delete().eq('coach_id', uidv).eq('athlete_id', uidv).eq('scheduled_date', date).is('program_id', null).then(function () {
      return SB.from('assignments').insert({ coach_id: uidv, athlete_id: uidv, program_id: null, week_index: null, day_index: null, scheduled_date: date, session_snapshot: snap, status: 'assigned' });
    }).then(function (res) {
      _assigning = false;
      if (res && res.error) { if (err) err.textContent = res.error.message; return; }
      closeModal(); toast('Published to your phone for ' + date);
    }).catch(function (e) { _assigning = false; if (err) err.textContent = String(e && e.message || e); });
  }

  /* ---------- toast ---------- */
  var toastEl = document.getElementById('toast'), tt;
  function toast(t) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('on'); }, 2200); }

  /* ---------- rail (visual only for now) ---------- */
  /* Library / Athletes live as two words in the top bar rather than an icon
     rail — Athletes is real functionality (reviewing the feeds athletes
     publish), so it keeps a way in even though the rail is gone. */
  document.getElementById('views').addEventListener('click', function (e) {
    var b = e.target.closest('.viewbtn'); if (!b) return;
    VIEW = b.dataset.view;
    document.querySelectorAll('.viewbtn').forEach(function (x) { x.classList.toggle('on', x === b); });
    render();
    if (VIEW === 'athletes') loadAthletes();
  });

  /* ---------- clicks ---------- */
  function B(el) { return day().blocks[+el.dataset.b]; }
  document.addEventListener('click', function (ev) {
    var mi = ev.target.closest('.mmenu button'); if (mi) { var mm = mi.closest('.mmenu'); var fn = mm._pick; closeMenu(); if (fn) fn(mi.dataset.v); return; }
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, bi = +el.dataset.b, ei = +el.dataset.e, si = +el.dataset.s, s = day();
    if (a === 'invite') { inviteAthlete(); return; }
    if (a === 'athsel') { ATH_SEL = el.dataset.id; renderAthletes(); return; }
    if (a === 'athdel') { revokeAthlete(el.dataset.id); return; }
    if (a === 'menuclose') { closeMenu(); return; }
    if (a === 'mclose') { closeModal(); return; }
    if (a === 'account') { openAuth(); return; }
    if (a === 'assign') { openAssign(); return; }
    if (a === 'doassign') { doAssign(); return; }
    if (a === 'signin') { doAuth('signin'); return; }
    if (a === 'signup') { doAuth('signup'); return; }
    if (a === 'signout') { doSignOut(); return; }
    if (a === 'save') { saveNow(); return; }
    if (a === 'day') { LIB.sel.d = +el.dataset.i; OPEN = { b: -1, e: -1 }; commit(); render(); return; }
    if (a === 'wkmenu') {
      var wks = prog().weeks.map(function (_, i) { return 'Week ' + (i + 1); }); wks.push('—SEP—'); wks.push('+ Add week');
      openMenu(el, wks, function (v) { if (v[0] === '+') { prog().weeks.push(emptyWeek()); LIB.sel.w = prog().weeks.length - 1; } else { LIB.sel.w = parseInt(v.replace('Week ', ''), 10) - 1; } OPEN = { b: -1, e: -1 }; commit(); render(); }, 'Week ' + (LIB.sel.w + 1));
      return;
    }
    if (a === 'progmenu') {
      var names = LIB.programs.map(function (p) { return p.name; }); names.push('—SEP—'); names.push('+ New program'); names.push('✎ Rename this program');
      openMenu(el, names, function (v) {
        if (v[0] === '+') { LIB.programs.push({ id: uid(), name: 'New program', weeks: [emptyWeek()] }); LIB.sel = { p: LIB.programs.length - 1, w: 0, d: 0 }; commit(); render(); toast('New program'); }
        else if (v[0] === '✎') { var nn = prompt('Program name:', prog().name); if (nn) { prog().name = nn.trim() || prog().name; commit(); render(); } }
        else { var i = LIB.programs.map(function (p) { return p.name; }).indexOf(v); if (i >= 0) { LIB.sel = { p: i, w: 0, d: 0 }; commit(); render(); } }
      }, prog().name);
      return;
    }
    if (a === 'addsession') { setDay(dayM('New Session', [blockM('Main', [exM('New Exercise', [setM('8', '8'), setM('8', '8'), setM('8', '8')])], false, '')])); OPEN = { b: 0, e: 0 }; commit(); render(); return; }
    if (!s) return;

    if (a === 'open') { if (OPEN.b === bi && OPEN.e === ei) OPEN = { b: -1, e: -1 }; else OPEN = { b: bi, e: ei }; render(); return; }
    if (a === 'pick') { openPick(bi, ei); return; }
    if (a === 'pickone') { if (PICK) { s.blocks[PICK.b].ex[PICK.e].name = el.dataset.v; commit(); } closeModal(); render(); return; }
    if (a === 'addset') { var ex1 = B(el).ex[ei], last = ex1.sets[ex1.sets.length - 1] || setM('', ''); ex1.sets.push(setM(last.t, last.rpe)); commit(); render(); focusSet(bi, ei, ex1.sets.length - 1); return; }
    if (a === 'delset') { var ex2 = B(el).ex[ei]; if (ex2.sets.length > 1) ex2.sets.splice(si, 1); commit(); render(); return; }
    if (a === 'rest') { var ex3 = B(el).ex[ei]; ex3.rest = Math.max(0, Math.min(3600, (+ex3.rest || 0) + (+el.dataset.d))); commit(); render(); return; }
    if (a === 'move') {
      var b4 = B(el), d = +el.dataset.d, ni = ei + d;
      if (ni < 0 || ni >= b4.ex.length) return;
      var tmp = b4.ex[ei]; b4.ex[ei] = b4.ex[ni]; b4.ex[ni] = tmp;
      OPEN = { b: bi, e: ni }; commit(); render(); return;
    }
    if (a === 'exdel') {
      if (!confirm('Remove this exercise from the session?')) return;
      var b5 = B(el); b5.ex.splice(ei, 1);
      if (!b5.ex.length) s.blocks.splice(bi, 1);
      if (!s.blocks.length) setDay(null);
      OPEN = { b: -1, e: -1 }; commit(); render(); toast('Exercise removed'); return;
    }
    if (a === 'blockdel') {
      if (!confirm('Remove this block from the session?')) return;
      s.blocks.splice(bi, 1); if (!s.blocks.length) setDay(null);
      OPEN = { b: -1, e: -1 }; commit(); render(); return;
    }
    /* the phone's planLink rules, so the coach cannot author a shape the logger
       runs differently: across a boundary merges, unlit chains, lit splits */
    if (a === 'link') {
      var b6 = s.blocks[bi], cross = +el.dataset.x;
      if (cross) {
        var nb = s.blocks[bi + 1]; if (!nb || nb.kind === 'cond' || b6.kind === 'cond') return;
        b6.ex = b6.ex.concat(nb.ex || []); b6.ss = true; s.blocks.splice(bi + 1, 1);
      } else if (!b6.ss) { b6.ss = b6.ex.length > 1; }
      else {
        var rest = b6.ex.splice(ei + 1);
        b6.ss = b6.ex.length > 1;
        s.blocks.splice(bi + 1, 0, blockM(b6.h, rest, rest.length > 1, b6.mins));
      }
      OPEN = { b: -1, e: -1 }; commit(); render(); return;
    }
    if (a === 'cfmt') { s.blocks[bi].fmt = el.dataset.v; commit(); render(); return; }
    if (a === 'ceff') { s.blocks[bi].eff = el.dataset.v; commit(); render(); return; }
    if (a === 'addex') {
      var tgt = s.blocks.filter(function (b) { return b.kind !== 'cond'; }).pop();
      if (!tgt) { s.blocks.unshift(blockM('Main', [], false, '')); tgt = s.blocks[0]; }
      tgt.ex.push(exM('New Exercise', [setM('8', '8'), setM('8', '8'), setM('8', '8')]));
      var tb = s.blocks.indexOf(tgt);
      OPEN = { b: tb, e: tgt.ex.length - 1 }; commit(); render(); openPick(tb, tgt.ex.length - 1); return;
    }
    if (a === 'addblock') {
      s.blocks.push(blockM('New block', [exM('New Exercise', [setM('8', '8'), setM('8', '8'), setM('8', '8')])], false, ''));
      OPEN = { b: s.blocks.length - 1, e: 0 }; commit(); render(); return;
    }
    if (a === 'addcond') { s.blocks.push(condM('Finisher', 'intervals', 'medium')); OPEN = { b: s.blocks.length - 1, e: 0 }; commit(); render(); return; }
    if (a === 'del') { if (confirm('Delete this session? This cannot be undone.')) { setDay(null); OPEN = { b: -1, e: -1 }; commit(); render(); toast('Session deleted'); } return; }
  });

  function focusSet(bi, ei, si) {
    var el = document.querySelector('[data-act="st"][data-b="' + bi + '"][data-e="' + ei + '"][data-s="' + si + '"]');
    if (el) { el.focus(); el.select(); }
  }

  /* ---------- typing: mutate the model, never re-render ----------
     Re-rendering on a keystroke — or on blur — destroys the field being typed
     into, so the caret jumps and characters land on a detached node. Only the
     summary line is repainted, in place. */
  function paintSummary(el) {
    var card = el.closest('.lgx.open'); if (!card) return;
    var b = day().blocks[+el.dataset.b]; if (!b || b.kind === 'cond') return;
    var e = b.ex[+el.dataset.e]; if (!e) return;
    var out = card.querySelector('.lgcn > span'); if (out) out.textContent = summary(e);
  }
  document.addEventListener('input', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, s = day();
    if (a === 'pickq' || el.id === 'pick-q') { fillPick(el.value); return; }
    if (!s) return;
    var bi = +el.dataset.b, ei = +el.dataset.e, si = +el.dataset.s;
    if (a === 'title') { s.title = el.value; commit(); return; }
    if (a === 'note') { s.note = el.value; commit(); return; }
    if (a === 'head') { s.blocks[bi].h = el.value; commit(); return; }
    if (a === 'mins') { s.blocks[bi].mins = el.value; commit(); return; }
    if (a === 'cue') { s.blocks[bi].ex[ei].cue = el.value; commit(); return; }
    if (a === 'st') {
      var st = s.blocks[bi].ex[ei].sets[si], wasWarm = isWarm(st);
      st.t = el.value; paintSummary(el); commit();
      // crossing the warm-up line is the one edit that retags the row itself
      if (isWarm(st) !== wasWarm) {
        var row = el.closest('.setrow');
        if (row) {
          row.classList.toggle('warm', isWarm(st));
          var n = row.querySelector('.setn'); if (n) n.textContent = isWarm(st) ? 'Warm' : 'Set ' + (si + 1);
          var r = row.querySelector('.setr'); if (r) r.placeholder = isWarm(st) ? '—' : 'RPE';
        }
      }
      return;
    }
    if (a === 'sr') { s.blocks[bi].ex[ei].sets[si].rpe = el.value; paintSummary(el); commit(); return; }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeMenu(); closeModal(); return; }
    if (ev.key === 'Enter' && ev.target.classList && /sett|setr|sech|secm|ttl/.test(ev.target.className)) ev.target.blur();
  });

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
      var hasRemote = !res.error && res.data && res.data.library && Array.isArray(res.data.library.programs) && res.data.library.programs.length;
      if (hasRemote && !_dirty) {
        // safe to adopt: no un-pushed local edits to lose
        LIB = migrate(res.data.library); saveLocal(); render(); toast('Loaded your cloud library');
      } else {
        // either no cloud copy yet, or we have un-pushed local edits — push local up
        pushLibrary(); if (!hasRemote) toast('Signed in — your library will sync'); renderTop();
      }
    }).catch(function () { cloudBusy = false; renderTop(); });
  }
  function pushLibrary() {
    if (!SB || !cloudUser) return;
    cloudBusy = true; renderTop();
    SB.from('coach_library').upsert({ coach_id: cloudUser.id, library: LIB, updated_at: new Date().toISOString() }, { onConflict: 'coach_id' }).then(function (res) {
      cloudBusy = false; renderTop();
      if (res.error) toast('Cloud save failed: ' + res.error.message); else _dirty = false;
    }).catch(function (e) { cloudBusy = false; renderTop(); });
  }
  function cloudInit() {
    if (!SB) return;
    SB.auth.getSession().then(function (res) {
      cloudUser = res && res.data && res.data.session ? res.data.session.user : null;
      if (cloudUser) { renderTop(); afterSignIn(); }
    }).catch(function () {});
    SB.auth.onAuthStateChange(function (event, session) { cloudUser = session ? session.user : null; renderTop(); });
    // On refocus, flush any un-pushed edits — but never re-adopt remote here (that
    // would risk clobbering local edits mid-session). Cloud pull happens on load / sign-in.
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && cloudUser && _dirty) pushLibrary(); });
  }

  /* ---------- boot ---------- */
  LIB = loadLocal();
  render();
  cloudInit();
  // test hook: the snapshot builder is what checks/ drives to prove that what a
  // coach authors actually reaches the phone
  window.__coach = { get LIB() { return LIB; }, toast: toast, day: day, snapshot: function () { return E.assert(sessionToWorkout(day())); } };
})();
