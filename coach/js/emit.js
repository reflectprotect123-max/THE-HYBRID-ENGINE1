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
  // set fields the phone logger owns — the coach app must never write them
  var FORBIDDEN_SET_KEYS = ['aVal', 'aVal2', 'felt', 'done', 'note'];
  var LB_TO_KG = 0.45359237;

  function uid() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function s(v) { return v == null ? '' : String(v); }

  function newSet(target, rpe) { return { t: s(target), rpe: s(rpe) }; }

  function newEx(name, mode, sets) {
    if (MODES.indexOf(mode) < 0) mode = 'reps_kg';
    return {
      id: uid(), name: s(name), mode: mode, tempo: '', rest: 90,
      sets: (sets && sets.length) ? sets : [newSet(), newSet(), newSet()]
    };
  }

  function newBlock(heading, exercises, superset) {
    return {
      id: uid(), heading: s(heading) || 'Block', minutes: '', format: '',
      superset: !!superset, exercises: (exercises && exercises.length) ? exercises : [newEx()]
    };
  }

  function newCondBlock(heading, condFmt, targetZone, minutes) {
    if (COND_FORMATS.indexOf(condFmt) < 0) condFmt = 'intervals';
    if (ZONES.indexOf(targetZone) < 0) targetZone = 'mod';
    return { id: uid(), kind: 'conditioning', heading: s(heading) || 'Conditioning', condFmt: condFmt, targetZone: targetZone, minutes: s(minutes) };
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
    MODES: MODES, COND_FORMATS: COND_FORMATS, ZONES: ZONES,
    FORBIDDEN_SET_KEYS: FORBIDDEN_SET_KEYS, LB_TO_KG: LB_TO_KG,
    uid: uid,
    newSet: newSet, newEx: newEx, newBlock: newBlock, newCondBlock: newCondBlock, newWorkout: newWorkout,
    measureToMode: measureToMode, lbToKg: lbToKg, assert: assert
  };
})();
