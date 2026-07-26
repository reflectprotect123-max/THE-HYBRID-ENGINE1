/* THE Hybrid System — emit contract (Entity 2 → Entity 1)
 * -------------------------------------------------------------------------
 * The ONE boundary between the coach website and the athlete phone app.
 * It builds phone-shape workouts and pins the phone's enums + field names so
 * a future rename on the phone fails the contract test loudly instead of
 * silently shipping broken sessions to athletes.
 *
 * Classic script (CSP-safe: no eval, no modules). Exposes window.HybridEmit.
 * Mirrors the phone builders in app.js:
 *   newSet  -> {t,rpe}                       (t = target, rpe = target RPE)
 *   newEx   -> {id,name,mode,tempo,rest,sets}
 *   newBlock-> {id,heading,minutes,format,superset,exercises}
 *   newCond -> {id,kind:'conditioning',heading,condFmt,targetZone,minutes}
 * The phone LOGGER — never the coach — writes the actual-result set fields
 * (aVal, aVal2, felt, done, note). emit MUST never write those; assert()
 * throws if it sees one, so a target can never masquerade as a logged result.
 */
(function () {
  'use strict';

  var MODES = ['reps_kg', 'amrap', 'seconds', 'reps_seconds', 'reps', 'completion'];
  var COND_FORMATS = ['steady', 'intervals', 'tempo', 'custom', 'free'];
  var ZONES = ['low', 'mod', 'high'];
  // effort names, and the zone each one holds — the phone derives one from the
  // other, so emitting both keeps a legacy reader working either way
  var EFFORTS = { easy: 'low', medium: 'mod', hard: 'high' };
  // set fields the phone logger owns — the coach app must never write them
  var FORBIDDEN_SET_KEYS = ['aVal', 'aVal2', 'felt', 'done', 'note'];
  var LB_TO_KG = 0.45359237;

  function uid() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function s(v) { return v == null ? '' : String(v); }

  function newSet(target, rpe) { return { t: s(target), rpe: s(rpe) }; }

  /* rest, tempo and cue used to be hardcoded here, which meant a coach could
     author them and the athlete would never receive them. They are arguments
     now. `cue` is also where a prescribed LOAD lives: the phone's set model is
     {t,rpe} with no target-weight field, so a coach naming a number writes it
     into the cue and the athlete reads it on the card. */
  function newEx(name, mode, sets, opts) {
    if (MODES.indexOf(mode) < 0) mode = 'reps_kg';
    opts = opts || {};
    var rest = parseInt(opts.rest, 10);
    if (!isFinite(rest) || rest < 0) rest = 90;
    var ex = {
      id: uid(), name: s(name), mode: mode, tempo: s(opts.tempo), rest: Math.min(rest, 3600),
      sets: (sets && sets.length) ? sets : [newSet(), newSet(), newSet()]
    };
    if (s(opts.cue)) ex.cue = s(opts.cue);
    return ex;
  }

  function newBlock(heading, exercises, superset, opts) {
    opts = opts || {};
    return {
      id: uid(), heading: s(heading) || 'Block', minutes: s(opts.minutes), format: s(opts.format),
      superset: !!superset, exercises: (exercises && exercises.length) ? exercises : [newEx()]
    };
  }

  /* Takes an effort (easy/medium/hard) and emits BOTH it and the zone it holds,
     matching the phone's own newCondBlock. Passing a bare zone still works. */
  function newCondBlock(heading, condFmt, effortOrZone, minutes) {
    if (COND_FORMATS.indexOf(condFmt) < 0) condFmt = 'intervals';
    var effort = null, zone = null, k = String(effortOrZone || '').toLowerCase();
    if (EFFORTS[k]) { effort = k; zone = EFFORTS[k]; }
    else if (ZONES.indexOf(k) >= 0) { zone = k; for (var e in EFFORTS) if (EFFORTS[e] === k) effort = e; }
    else { effort = 'medium'; zone = 'mod'; }
    return { id: uid(), kind: 'conditioning', heading: s(heading) || 'Conditioning',
      condFmt: condFmt, effort: effort, targetZone: zone, minutes: s(minutes) };
  }

  function newWorkout(name, blocks, extra) {
    var w = { id: uid(), name: s(name) || 'Session', blocks: blocks || [], updatedAt: Date.now() };
    if (extra && typeof extra === 'object') for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) w[k] = extra[k];
    return w;
  }

  /* Map a coach column set (measure labels) to the phone's per-exercise mode.
   * The phone has 6 modes; the coach editor has ~19 measure column types.
   * Weight present -> reps_kg (weight is the target load); Time -> seconds;
   * Reps only -> reps; nothing quantifiable -> completion. Unsupported coach
   * measures (distance, %, calories, height, LWP+) fall back to the nearest
   * phone mode and are preserved on the snapshot for a future phone update. */
  function measureToMode(cols) {
    cols = cols || [];
    var has = function (pfx) { return cols.some(function (c) { return String(c).indexOf(pfx) === 0; }); };
    if (has('Weight')) return 'reps_kg';
    if (has('Time')) return 'seconds';
    if (cols.indexOf('Reps') >= 0) return 'reps';
    return 'completion';
  }

  function lbToKg(lb) { var n = parseFloat(lb); return isFinite(n) ? Math.round(n * LB_TO_KG * 10) / 10 : ''; }

  /* Validate a phone-shape workout before it is stored/assigned. Throws on any
   * out-of-whitelist enum or any set carrying a logger-owned actual field. */
  function assert(w) {
    if (!w || typeof w !== 'object') throw new Error('emit: workout must be an object');
    if (!Array.isArray(w.blocks)) throw new Error('emit: workout.blocks must be an array');
    w.blocks.forEach(function (b, bi) {
      if (!b || typeof b !== 'object') throw new Error('emit: block ' + bi + ' is not an object');
      if (b.kind === 'conditioning') {
        if (COND_FORMATS.indexOf(b.condFmt) < 0) throw new Error('emit: block ' + bi + ' bad condFmt "' + b.condFmt + '"');
        if (ZONES.indexOf(b.targetZone) < 0) throw new Error('emit: block ' + bi + ' bad targetZone "' + b.targetZone + '"');
        if (b.effort != null && !EFFORTS[b.effort]) throw new Error('emit: block ' + bi + ' bad effort "' + b.effort + '"');
        return;
      }
      (b.exercises || []).forEach(function (e, ei) {
        if (MODES.indexOf(e.mode) < 0) throw new Error('emit: ' + bi + '/' + ei + ' bad mode "' + e.mode + '"');
        (e.sets || []).forEach(function (st, si) {
          if (!st || typeof st !== 'object') throw new Error('emit: set ' + bi + '/' + ei + '/' + si + ' is not an object');
          FORBIDDEN_SET_KEYS.forEach(function (k) {
            if (Object.prototype.hasOwnProperty.call(st, k)) throw new Error('emit: set ' + bi + '/' + ei + '/' + si + ' carries logger field "' + k + '"');
          });
        });
      });
    });
    return w;
  }

  window.HybridEmit = {
    MODES: MODES, COND_FORMATS: COND_FORMATS, ZONES: ZONES, EFFORTS: EFFORTS,
    FORBIDDEN_SET_KEYS: FORBIDDEN_SET_KEYS, LB_TO_KG: LB_TO_KG,
    uid: uid,
    newSet: newSet, newEx: newEx, newBlock: newBlock, newCondBlock: newCondBlock, newWorkout: newWorkout,
    measureToMode: measureToMode, lbToKg: lbToKg, assert: assert
  };
})();
