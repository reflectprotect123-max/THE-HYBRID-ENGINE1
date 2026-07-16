/*
 * Focused Logger / Builder UI
 *
 * This is a presentation layer over the existing local-first data model.
 * Builder mutations stay on `draft`; Logger mutations stay on the active
 * session returned by `current()`. The existing persistence and timer
 * functions remain the source of truth.
 */
(function () {
  'use strict';

  const F_MODALITIES = ['Run', 'Walk', 'Bike', 'Rower', 'Ski erg'];
  const F_REST = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
  const F_TRACKING_MODES = ['reps-kilos', 'reps-percent', 'seconds', 'reps-seconds', 'reps-only', 'completion'];
  const F_STYLE_ID = 'focused-ui-style';
  let focusedBuilderIndex = 0;
  let focusedBuilderAdvanced = {};

  const F_STYLE = `
    :root { --focus-gold: #d6aa6e; --focus-gold-soft: #b68a50; --focus-line: #363432; --focus-panel: #151515; --focus-panel-2: #1c1c1c; }
    body.focused-flow { background: #101010; }
    body.focused-flow .app > .top { display: none; }
    body.focused-flow #appScreen { max-width: 760px; padding: 0 0 34px; }
    body.focused-flow #appScreen.focused-app { min-height: 100dvh; }
    body.focused-flow #bottomNav { display: none; }
    .focus-shell { min-height: calc(100dvh - 34px); color: var(--text); }
    .focus-head { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 22px 18px 18px; background: #151515; border-bottom: 1px solid #292929; }
    .focus-back, .focus-icon { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid var(--focus-line); border-radius: 12px; background: transparent; color: var(--text); font-size: 28px; line-height: 1; }
    .focus-back:active, .focus-icon:active, .focus-action:active, .focus-nav button:active { transform: translateY(1px); }
    .focus-head-copy { min-width: 0; }
    .focus-kicker { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; }
    .focus-workout-name { display: block; width: 100%; margin-top: 3px; overflow: hidden; color: var(--text); font-size: 22px; font-weight: 900; letter-spacing: -.045em; text-overflow: ellipsis; white-space: nowrap; }
    .focus-name-input { width: 100%; padding: 0 0 6px; border: 0; border-bottom: 2px solid #c8c4bc; border-radius: 0; background: transparent; color: var(--text); font-size: 22px; font-weight: 900; letter-spacing: -.045em; }
    .focus-name-input:focus { border-color: var(--focus-gold); box-shadow: none; }
    .focus-rule { width: min(100%, 310px); height: 2px; margin-top: 5px; background: #c8c4bc; }
    .focus-action { min-width: 76px; padding: 10px 12px; border: 1px solid var(--focus-line); border-radius: 10px; background: transparent; color: var(--focus-gold); font-size: 14px; font-weight: 850; }
    .focus-action.primary { border-color: var(--focus-gold); background: var(--focus-gold); color: #17130e; }
    .focus-clock { display: inline-flex; align-items: center; gap: 6px; min-width: 76px; padding: 10px 11px; border: 1px solid var(--focus-line); border-radius: 10px; background: #191919; color: var(--text); font-variant-numeric: tabular-nums; font-size: 14px; font-weight: 850; }
    .focus-clock.on { border-color: var(--focus-gold); color: var(--focus-gold); }
    .focus-progress { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #292929; background: #121212; }
    .focus-progress-count { flex: 0 0 auto; color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .focus-dots { display: flex; min-width: 0; flex: 1; gap: 5px; }
    .focus-dot { flex: 1; height: 4px; border: 0; border-radius: 99px; background: #393735; }
    .focus-dot.active { background: var(--focus-gold); }
    .focus-dot.done { background: #897052; }
    .focus-body { padding: 24px 18px 0; }
    .focus-section-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
    .focus-section-label { display: inline-block; padding-bottom: 9px; border-bottom: 2px solid #c8c4bc; color: #e5e0d8; font-size: 14px; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; }
    .focus-section-label.cond { border-color: var(--focus-gold); color: var(--focus-gold); }
    .focus-link { padding: 4px 0; border: 0; background: transparent; color: var(--focus-gold); font-size: 14px; font-weight: 850; }
    .focus-title-row { display: grid; grid-template-columns: 54px minmax(0, 1fr) auto; gap: 12px; align-items: center; margin-bottom: 18px; }
    .focus-marker { display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid #4a4743; border-radius: 50%; color: var(--text); font-size: 17px; font-weight: 900; }
    .focus-item-kicker { margin-bottom: 2px; color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .focus-item-title { margin: 0; color: var(--text); font-size: clamp(24px, 6vw, 34px); font-weight: 900; letter-spacing: -.055em; line-height: 1.04; }
    .focus-item-sub { margin-top: 5px; color: var(--focus-gold); font-size: 14px; font-weight: 800; }
    .focus-quiet { padding: 8px 10px; border: 1px solid var(--focus-line); border-radius: 9px; background: transparent; color: var(--focus-gold); font-size: 12px; font-weight: 800; }
    .focus-card { margin-top: 14px; padding: 17px; border: 1px solid var(--focus-line); border-radius: 16px; background: var(--focus-panel); }
    .focus-card.soft { background: var(--focus-panel-2); }
    .focus-card-title { margin-bottom: 12px; color: #e9e4dc; font-size: 15px; font-weight: 850; }
    .focus-card-title small { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; font-weight: 500; }
    .focus-plan { display: flex; flex-wrap: wrap; gap: 8px; }
    .focus-plan-chip { padding: 8px 10px; border: 1px solid #48433c; border-radius: 9px; background: #191817; color: var(--focus-gold); font-size: 12px; font-weight: 800; }
    .focus-helper { margin: 14px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .focus-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .focus-field { min-width: 0; }
    .focus-field.full { grid-column: 1 / -1; }
    .focus-field label { display: block; margin-bottom: 6px; color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .focus-field label span { color: var(--dim); font-size: 9px; font-weight: 500; letter-spacing: 0; text-transform: none; }
    .focus-field select, .focus-field input, .focus-field textarea { width: 100%; }
    .focus-field select, .focus-field input { min-height: 44px; }
    .focus-field textarea { min-height: 108px; }
    .focus-field .focus-custom-input { margin-top: 8px; }
    .focus-static-value { min-height: 44px; display: flex; align-items: center; padding: 0 12px; border: 1px solid var(--focus-line); border-radius: 10px; background: #181817; color: var(--focus-gold); font-weight: 800; }
    .focus-switch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 5px; border: 1px solid var(--focus-line); border-radius: 12px; background: #101010; }
    .focus-switch button { min-height: 42px; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 850; }
    .focus-switch button.active { background: var(--focus-gold); color: #19140f; }
    .focus-history { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
    .focus-history-cell { min-width: 0; padding: 11px 12px; border-radius: 11px; background: #292929; }
    .focus-history-cell b { display: block; color: #e5e0d8; font-size: 10px; letter-spacing: .08em; }
    .focus-history-cell span { display: block; margin-top: 4px; overflow: hidden; color: var(--muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .focus-note { margin-top: 14px; padding: 11px 12px; border-left: 2px solid var(--focus-gold); background: #1b1917; color: #ddd4c6; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
    .focus-log { padding: 4px 0 0; }
    .focus-log-head, .focus-log-row { display: grid; grid-template-columns: var(--focus-log-cols, 38px minmax(0, 1fr) 52px); gap: 8px; align-items: center; }
    .focus-log-head { padding: 0 0 7px; color: var(--muted); font-size: 10px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .focus-log-head span:nth-child(3) { color: var(--focus-gold); }
    .focus-log-head span:last-child { color: #63d58c; }
    .focus-log-row { padding: 10px 0; border-top: 1px solid #2b2a28; }
    .focus-log-row.done { opacity: .78; }
    .focus-set-index { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #4c4945; border-radius: 50%; color: var(--focus-gold); font-size: 13px; font-weight: 900; }
    .focus-log-row.done .focus-set-index { border-color: var(--focus-gold); background: var(--focus-gold); color: #17130e; }
    .focus-target { padding-bottom: 9px; color: var(--muted); font-size: 12px; font-weight: 750; }
    .focus-target small { display: block; margin-top: 3px; color: var(--dim); font-size: 9px; font-weight: 600; }
    .focus-log-row input { min-height: 42px; padding: 8px; }
    .focus-log-static { min-height: 42px; display: grid; place-items: center; border: 1px solid #2f2e2c; border-radius: 9px; color: var(--muted); font-size: 12px; font-weight: 800; }
    .focus-log-btn { min-height: 42px; padding: 8px 5px; border: 1px solid var(--focus-line); border-radius: 9px; background: transparent; color: var(--focus-gold); font-size: 11px; font-weight: 850; }
    .focus-log-btn.primary { border-color: var(--focus-gold); background: var(--focus-gold); color: #17130e; }
    .focus-log-btn.focus-log-complete { justify-self: center; width: 42px; min-height: 42px; padding: 0; border: 2px solid #63d58c; border-radius: 50%; color: #17130e; background: transparent; font-size: 22px; line-height: 1; }
    .focus-log-btn.focus-log-complete.done { border-color: #63d58c; background: #63d58c; }
    .focus-instruction-card { margin-top: 14px; }
    .focus-instruction-copy { margin-top: 10px; padding: 12px 13px; border-left: 2px solid var(--focus-gold); background: #1b1917; color: #ddd4c6; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
    .focus-superset-card { border-color: #5d4a2f; }
    .focus-superset-list { display: grid; gap: 7px; margin-top: 12px; }
    .focus-superset-item { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid #393632; border-radius: 9px; background: #171615; }
    .focus-superset-item.active { border-color: var(--focus-gold); }
    .focus-superset-item b { color: var(--focus-gold); font-size: 11px; }
    .focus-superset-item span { overflow: hidden; color: var(--text); font-size: 13px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
    .focus-row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 13px; }
    .focus-row-actions button { flex: 1; min-width: 120px; }
    .focus-row-actions .danger { color: var(--bad); }
    .focus-complete { width: 100%; margin-top: 14px; min-height: 48px; }
    .focus-nav { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; margin-top: 20px; padding-top: 14px; border-top: 1px solid #2b2a28; }
    .focus-nav button { min-height: 46px; }
    .focus-nav button:last-child { justify-self: end; min-width: 92px; }
    .focus-abandon { width: 100%; margin-top: 10px; color: var(--muted); }
    .focus-empty { padding: 24px 0; color: var(--muted); text-align: center; }
    .focus-empty b { display: block; margin-bottom: 5px; color: var(--text); }
    .focus-map-list { display: grid; gap: 8px; margin-top: 12px; }
    .focus-map-item { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px; border: 1px solid var(--focus-line); border-radius: 11px; background: #161616; }
    .focus-map-item.active { border-color: var(--focus-gold); }
    .focus-map-item button { padding: 0; border: 0; background: transparent; text-align: left; }
    .focus-map-number { color: var(--muted); font-size: 11px; font-weight: 850; }
    .focus-map-name { overflow: hidden; color: var(--text); font-size: 13px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
    .focus-map-meta { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .focus-map-actions { display: flex; gap: 4px; }
    .focus-map-actions button { width: 28px; height: 28px; border: 1px solid var(--focus-line); border-radius: 7px; color: var(--muted); text-align: center; }
    .focus-map-actions button.danger { color: var(--bad); }
    .focus-map-plus { display: grid; place-items: center; justify-self: center; width: 30px; height: 30px; margin: -2px auto; border: 1px solid var(--focus-gold-soft); border-radius: 50%; background: #1b1814; color: var(--focus-gold); font-size: 18px; font-weight: 900; line-height: 1; }
    .focus-map-plus:disabled { border-color: var(--focus-line); background: transparent; color: var(--dim); opacity: .55; }
    .focus-add { width: 100%; margin-top: 14px; }
    .focus-interval { text-align: center; }
    .focus-interval .focus-bigtime { margin: 8px 0 4px; color: var(--text); font-size: clamp(46px, 14vw, 72px); font-weight: 950; letter-spacing: -.08em; font-variant-numeric: tabular-nums; }
    .focus-interval .focus-phase { color: var(--focus-gold); font-size: 11px; font-weight: 850; letter-spacing: .15em; text-transform: uppercase; }
    .focus-interval .focus-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .focus-interval .focus-actions button { min-width: 88px; }
    .focus-footer-spacer { height: 8px; }
    .focused-flow .restcorner { top: 16px; right: 12px; min-width: 116px; border-color: var(--focus-gold); background: #171717f5; }
    .focused-flow .restcorner b { color: var(--focus-gold); }
    .focused-flow .restcorner button { color: var(--muted); }
    .focus-runner-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: #151515; border-bottom: 1px solid #292929; }
    .focus-runner-back { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; background: transparent; color: var(--text); font-size: 24px; line-height: 1; }
    .focus-runner-count { flex: 1; padding: 0; border: 0; background: transparent; color: var(--muted); font-size: 12px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; text-align: center; }
    .focus-runner-timer { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 1px solid var(--focus-line); border-radius: 50%; background: transparent; color: var(--focus-gold); font-size: 17px; line-height: 1; }
    .focus-runner-name { color: var(--text); font-size: clamp(24px, 7vw, 32px); font-weight: 950; letter-spacing: -.03em; text-transform: uppercase; }
    .focus-runner-sub { margin-top: 6px; color: var(--muted); font-size: 13px; font-weight: 750; }
    .focus-rx { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--focus-line); border-radius: 14px; background: var(--focus-panel); }
    .focus-rx-main { color: var(--focus-gold); font-size: 20px; font-weight: 900; }
    .focus-rx-note { margin-top: 4px; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .focus-set-table { margin-top: 18px; }
    .focus-set-table-head, .focus-set-table-row { display: grid; grid-template-columns: var(--focus-set-cols, 44px 1fr 1fr); gap: 8px; align-items: center; }
    .focus-set-table-head { padding: 0 0 8px; color: var(--muted); font-size: 10px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .focus-set-table-row { padding: 8px 0; border-top: 1px solid #2b2a28; }
    .focus-set-table-row.done { background: linear-gradient(90deg, rgba(214,170,110,.08), transparent); }
    .focus-set-table-num { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid #4c4945; border-radius: 50%; background: transparent; color: var(--focus-gold); font-size: 13px; font-weight: 900; }
    .focus-set-table-row.done .focus-set-table-num { border-color: var(--focus-gold); background: var(--focus-gold); color: #17130e; }
    .focus-set-table-row input { min-height: 40px; padding: 8px; text-align: center; }
    .focus-set-stepper { display: flex; margin-top: 20px; border: 1px solid var(--focus-line); border-radius: 14px; overflow: hidden; }
    .focus-set-stepper button { flex: 1; min-height: 50px; padding: 0; border: 0; border-left: 1px solid var(--focus-line); background: transparent; color: var(--focus-gold); font-size: 22px; font-weight: 900; line-height: 1; }
    .focus-set-stepper button:first-child { border-left: 0; }
    .focus-set-stepper button:disabled { color: var(--dim); opacity: .4; }
    .focus-set-stepper-label { flex: 1.6 1 0; display: grid; place-items: center; border-left: 1px solid var(--focus-line); color: var(--muted); font-size: 12px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
    @media (max-width: 520px) {
      .focus-head { padding: 16px 14px 15px; }
      .focus-body { padding: 21px 14px 0; }
      .focus-progress { padding: 10px 14px; }
      .focus-log-head, .focus-log-row { grid-template-columns: var(--focus-log-cols, 34px minmax(0, 1fr) 48px); gap: 5px; }
      .focus-log-row input { padding: 7px 5px; font-size: 13px; }
      .focus-log-btn { padding: 7px 3px; font-size: 10px; }
      .focus-title-row { grid-template-columns: 46px minmax(0, 1fr) auto; gap: 9px; }
      .focus-marker { width: 44px; height: 44px; }
      .focus-item-title { font-size: 25px; }
      .focus-quiet { padding: 7px 7px; }
    }
    @media (max-width: 370px) {
      .focus-log-head, .focus-log-row { grid-template-columns: var(--focus-log-cols, 30px minmax(0, 1fr) 44px); gap: 4px; }
      .focus-log-row input { font-size: 12px; }
      .focus-log-btn { font-size: 9px; }
      .focus-item-title { font-size: 22px; }
    }
  `;

  function fState() {
    return typeof S === 'undefined' ? window.S : S;
  }

  function fDraft() {
    return typeof draft === 'undefined' ? window.draft : draft;
  }

  function fEsc(value) {
    return typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function fJs(value) {
    return typeof jsq === 'function' ? jsq(value) : JSON.stringify(String(value ?? ''));
  }

  function fNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function fTrackingLabel(mode) {
    return {
      'reps-kilos': 'Reps + Kilos',
      'reps-percent': 'Reps + %1RM',
      seconds: 'Seconds',
      'reps-seconds': 'Reps + Seconds',
      'reps-only': 'Reps only',
      completion: 'For completion',
    }[mode] || 'Reps + Kilos';
  }

  function fBuilderTrackingMode(exercise) {
    const explicit = String(exercise?.trackingMode || '').trim();
    if (F_TRACKING_MODES.includes(explicit)) return explicit;
    if (exercise?.prescriptionType === 'seconds') return 'seconds';
    if (exercise?.prescriptionType === 'percent1rm') return 'reps-percent';
    if (exercise?.prescriptionType === 'completion') return 'completion';
    return 'reps-kilos';
  }

  function fLoggerTrackingMode(task) {
    const explicit = String(task?.trackingMode || '').trim();
    if (F_TRACKING_MODES.includes(explicit)) return explicit;
    if (task?.prescriptionType === 'seconds') return 'seconds';
    if (task?.prescriptionType === 'percent1rm') return 'reps-percent';
    if (task?.prescriptionType === 'completion') return 'completion';
    return 'reps-kilos';
  }

  function fTargetNumber(value, preferLast = false) {
    const matches = String(value ?? '').match(/\d+(?:\.\d+)?/g) || [];
    if (!matches.length) return '';
    return matches[preferLast ? matches.length - 1 : 0];
  }

  function fBuilderTargetReps(exercise) {
    if (exercise?.blankPrescription && !String(exercise?.reps ?? '').trim()) return '';
    if (String(exercise?.targetReps ?? '').trim()) return String(exercise.targetReps).trim();
    if (exercise?.prescriptionType === 'percent1rm' && /%/.test(String(exercise?.reps || ''))) return '8';
    if (exercise?.prescriptionType === 'seconds' && /s$/i.test(String(exercise?.reps || '').trim())) return '';
    return String(exercise?.reps ?? '').trim() || '8';
  }

  function fBuilderTargetPercent(exercise) {
    if (String(exercise?.percentTarget ?? '').trim()) return String(exercise.percentTarget).trim();
    if (/%/.test(String(exercise?.reps || ''))) return String(exercise.reps).trim();
    return '75%';
  }

  function fBuilderTargetSeconds(exercise) {
    if (String(exercise?.secondsTarget ?? '').trim()) return String(exercise.secondsTarget).replace(/s$/i, '').trim();
    if (exercise?.prescriptionType === 'seconds' || exercise?.trackingMode === 'seconds') return fTargetNumber(exercise?.reps, false) || '30';
    return '30';
  }

  function fBuilderAdvancedKey(item) {
    return String(item?.exercise?.id || item?.block?.id || item?.blockIndex || 'builder-item');
  }

  function fLoggerTargetReps(task, row = {}) {
    const raw = String(task?.reps ?? '').trim();
    if (!String(task?.targetReps ?? '').trim() && fLoggerTrackingMode(task) === 'reps-percent' && /%/.test(raw)) return '8';
    const value = String(task?.targetReps ?? '').trim() || raw || row.target || '';
    return value;
  }

  function fLoggerTargetPercent(task) {
    return String(task?.percentTarget ?? task?.targetPercent ?? '').trim() || (/%/.test(String(task?.reps || '')) ? String(task.reps).trim() : '—');
  }

  function fLoggerTargetSeconds(task) {
    return String(task?.secondsTarget ?? task?.targetSeconds ?? '').replace(/s$/i, '').trim() || fTargetNumber(task?.reps, false) || '30';
  }

  function fLoggerPlanTarget(task) {
    const mode = fLoggerTrackingMode(task);
    const reps = fLoggerTargetReps(task);
    if (mode === 'completion') return 'For completion';
    if (mode === 'seconds') return `${fLoggerTargetSeconds(task)}s hold`;
    if (mode === 'reps-percent') return `${reps || '—'} reps · ${fLoggerTargetPercent(task)}`;
    if (mode === 'reps-seconds') return `${reps || '—'} reps · ${fLoggerTargetSeconds(task)}s`;
    if (mode === 'reps-only') return `${reps || '—'} reps`;
    return `${reps || '—'} reps`;
  }

  function fFmt(value) {
    return typeof fmt === 'function' ? fmt(value) : `${Math.floor(fNum(value) / 60)}:${String(Math.floor(fNum(value) % 60)).padStart(2, '0')}`;
  }

  function fStyle() {
    if (document.getElementById(F_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = F_STYLE_ID;
    style.textContent = F_STYLE;
    document.head.appendChild(style);
  }

  function fMode(on) {
    document.body.classList.toggle('focused-flow', !!on);
    const app = document.getElementById('appScreen');
    if (app) app.classList.toggle('focused-app', !!on);
  }

  function fPersistDraft() {
    if (typeof persistDraft === 'function') persistDraft();
    else if (fDraft() && typeof save === 'function') {
      const state = fState();
      if (state) state.draft = typeof clone === 'function' ? clone(fDraft()) : JSON.parse(JSON.stringify(fDraft()));
      save('focused-draft');
    }
  }

  function fCloseSheet() {
    if (typeof closeSheet === 'function') closeSheet();
  }

  function fBuilderItems() {
    const d = fDraft();
    const out = [];
    (d?.blocks || []).forEach((block, blockIndex) => {
      if (block.type === 'text') out.push({ kind: 'text', block, blockIndex, exerciseIndex: -1 });
      else if (block.type === 'conditioning') out.push({ kind: 'conditioning', block, blockIndex, exerciseIndex: -1 });
      else {
        const exercises = block.exercises || [];
        if (!exercises.length) out.push({ kind: 'strength-empty', block, blockIndex, exerciseIndex: -1 });
        exercises.forEach((exercise, exerciseIndex) => out.push({ kind: 'strength', block, blockIndex, exercise, exerciseIndex }));
      }
    });
    return out;
  }

  function fBuilderItem() {
    const items = fBuilderItems();
    if (!items.length) return null;
    if (focusedBuilderIndex >= items.length) focusedBuilderIndex = items.length - 1;
    if (focusedBuilderIndex < 0) focusedBuilderIndex = 0;
    return items[focusedBuilderIndex];
  }

  function fBuilderType(exercise) {
    const raw = String(exercise?.reps ?? '').trim();
    if (exercise?.prescriptionType && ['reps', 'range', 'repsPerSide', 'amrap', 'percent1rm', 'seconds', 'completion'].includes(exercise.prescriptionType)) return exercise.prescriptionType;
    if (/for completion|completion/i.test(raw)) return 'completion';
    if (/amrap/i.test(raw)) return 'amrap';
    if (/%/.test(raw)) return 'percent1rm';
    if (/s(ec(onds?)?)?$/i.test(raw)) return 'seconds';
    if (/-|–/.test(raw)) return 'range';
    return 'reps';
  }

  function fBuilderRawTarget(exercise) {
    const mode = fBuilderTrackingMode(exercise);
    if (mode === 'completion') return 'For completion';
    if (exercise?.blankPrescription && !String(exercise?.reps ?? '').trim()) return 'Blank prescription';
    if (mode === 'seconds') return `${fBuilderTargetSeconds(exercise)}s`;
    if (mode === 'reps-percent') return `${fBuilderTargetReps(exercise) || '—'} reps · ${fBuilderTargetPercent(exercise)}`;
    if (mode === 'reps-seconds') return `${fBuilderTargetReps(exercise) || '—'} reps · ${fBuilderTargetSeconds(exercise)}s`;
    if (mode === 'reps-only') return `${fBuilderTargetReps(exercise) || '—'} reps`;
    return fBuilderTargetReps(exercise) || '8';
  }

  function fBuilderTargetOptions(type, raw) {
    let values;
    if (type === 'range') values = ['3–5', '5–7', '6–8', '8–10', '10–12', '12–15', '15–20'];
    else if (type === 'amrap') values = ['AMRAP', 'AMRAP · quality'];
    else if (type === 'percent1rm') values = ['60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%'];
    else if (type === 'seconds') values = ['10s', '15s', '20s', '30s', '45s', '60s', '90s', '120s'];
    else if (type === 'completion') values = ['For completion'];
    else values = Array.from({ length: 20 }, (_, index) => String(index + 1));
    const normalized = String(raw || '').replace(/-/g, '–').trim();
    const custom = normalized && !values.includes(normalized);
    const options = values.map(value => `<option value="${fEsc(value)}" ${value === normalized ? 'selected' : ''}>${fEsc(value)}</option>`).join('');
    return `<option value="__custom__" ${custom ? 'selected' : ''}>Custom</option>${options}`;
  }

  function fBuilderTargetMarkup(exercise, itemIndex) {
    const type = fBuilderType(exercise);
    const raw = fBuilderRawTarget(exercise);
    const blank = exercise?.blankPrescription && !String(exercise?.reps ?? '').trim();
    const normalized = raw.replace(/-/g, '–').trim();
    const common = ['range', 'amrap', 'percent1rm', 'seconds', 'completion'].includes(type) ? normalized : normalized.split(',')[0].trim();
    const custom = type !== 'completion' && (normalized.includes(',') || !fBuilderTargetOptions(type, common).includes('value="' + fEsc(common) + '" selected'));
    return `<div class="focus-field">
      <label>Target</label>
      <select onchange="focusBuilderTarget(${itemIndex}, this.value)">${blank ? '<option value="" selected>Blank</option>' : ''}${fBuilderTargetOptions(type, common)}</select>
      <input class="focus-custom-input" ${custom && !blank ? '' : 'style="display:none"'} value="${blank ? '' : fEsc(normalized)}" placeholder="Type a target" oninput="focusBuilderCustomTarget(${itemIndex}, this.value)">
    </div>`;
  }

  function fRestOptions(value) {
    const current = fNum(value);
    const values = [...new Set([...F_REST, current])].sort((a, b) => a - b);
    return values.map(seconds => `<option value="${seconds}" ${seconds === current ? 'selected' : ''}>${seconds ? `${seconds}s` : 'No rest'}</option>`).join('');
  }

  function fBuilderHeader(title, name, actionLabel, action) {
    return `<div class="focus-head">
      <button class="focus-back" aria-label="Back" onclick="focusBuilderExit()">‹</button>
      <div class="focus-head-copy">
        <div class="focus-kicker">${fEsc(title)}</div>
        <input class="focus-name-input" value="${fEsc(name || '')}" placeholder="Name this workout" oninput="focusBuilderName(this.value)">
        <div class="focus-rule"></div>
      </div>
      <button class="focus-action" onclick="${action}">${fEsc(actionLabel)}</button>
    </div>`;
  }

  function fLoggerHeader(session, task, index) {
    const state = fState();
    const elapsed = typeof workElapsed === 'function' ? workElapsed(session) : 0;
    return `<div class="focus-head">
      <button class="focus-back" aria-label="Back" onclick="focusLoggerBack()">‹</button>
      <div class="focus-head-copy">
        <div class="focus-kicker">${fEsc(session.name || 'Workout')} · Logger</div>
        <div class="focus-workout-name">${fEsc(task?.heading || 'Training')}</div>
        <div class="focus-rule"></div>
      </div>
      <button id="focusWorkoutClock" class="focus-clock ${session.timer?.on ? 'on' : ''}" onclick="toggleWorkoutClock()">${fFmt(elapsed)}</button>
    </div>`;
  }

  function fProgress(items, activeIndex, logger) {
    const dots = items.map((item, index) => `<button class="focus-dot ${index === activeIndex ? 'active' : ''} ${logger && index < activeIndex ? 'done' : ''}" aria-label="Step ${index + 1}" onclick="${logger ? `focusLoggerJump(${index})` : `focusBuilderJump(${index})`}"></button>`).join('');
    return `<div class="focus-progress"><span class="focus-progress-count">${activeIndex + 1} / ${items.length}</span><div class="focus-dots">${dots}</div></div>`;
  }

  function fBuilderTitle(item) {
    if (item.kind === 'strength') return item.exercise?.name || 'Exercise';
    if (item.kind === 'strength-empty') return 'Add an exercise';
    if (item.kind === 'conditioning') return item.block?.heading || 'Conditioning';
    return item.block?.heading || 'Instructions';
  }

  function fBuilderSection(item) {
    if (item.kind === 'conditioning') return 'CONDITIONING';
    if (item.kind === 'text') return 'INSTRUCTIONS';
    return String(item.block?.heading || 'STRENGTH').toUpperCase();
  }

  function fBuilderSelectTarget(itemIndex, key, label, value, type, blank = false) {
    const inputValue = String(value ?? '').replace(/-/g, '–').replace(/s$/i, '').trim();
    const normalized = type === 'seconds' && inputValue ? `${inputValue}s` : inputValue;
    const options = fBuilderTargetOptions(type, normalized);
    const isCustom = !!inputValue && !options.includes(`value="${fEsc(normalized)}" selected`);
    return `<div class="focus-field">
      <label>${fEsc(label)}</label>
      <select onchange="focusBuilderTrackingTarget(${itemIndex}, '${key}', this.value, this)">${blank ? '<option value="" selected>Blank</option>' : ''}${options}</select>
      <input class="focus-custom-input" ${isCustom ? '' : 'style="display:none"'} value="${fEsc(inputValue)}" placeholder="Type a target" oninput="focusBuilderTrackingCustomTarget(${itemIndex}, '${key}', this.value)">
    </div>`;
  }

  function fBuilderTrackingTargetMarkup(exercise, itemIndex) {
    const mode = fBuilderTrackingMode(exercise);
    const blank = exercise?.blankPrescription && !String(exercise?.reps ?? '').trim();
    const reps = fBuilderTargetReps(exercise);
    const repsType = /[-–]/.test(reps) ? 'range' : 'reps';
    if (mode === 'completion') return '<div class="focus-field full"><label>Target</label><div class="focus-static-value">For completion</div></div>';
    const fields = [];
    if (['reps-kilos', 'reps-percent', 'reps-seconds', 'reps-only'].includes(mode)) {
      fields.push(fBuilderSelectTarget(itemIndex, 'targetReps', 'Target reps', reps, repsType, blank));
    }
    if (mode === 'reps-percent') fields.push(fBuilderSelectTarget(itemIndex, 'percentTarget', 'Target %1RM', fBuilderTargetPercent(exercise), 'percent1rm'));
    if (mode === 'seconds' || mode === 'reps-seconds') fields.push(fBuilderSelectTarget(itemIndex, 'secondsTarget', 'Target seconds', fBuilderTargetSeconds(exercise), 'seconds'));
    return fields.join('');
  }

  function fBuilderToggleAdvanced(itemIndex) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.exercise) return;
    const key = fBuilderAdvancedKey(item);
    focusedBuilderAdvanced[key] = !focusedBuilderAdvanced[key];
    focusedBuilder();
  }

  function fBuilderStrength(item, itemIndex) {
    if (item.kind === 'strength-empty') {
      return `<div class="focus-card"><div class="focus-empty"><b>This strength block is empty.</b>Add the first exercise to start building it.</div><button class="btn primary focus-add" onclick="focusBuilderAddExercise(${item.blockIndex})">Add exercise</button></div>`;
    }
    const ex = item.exercise;
    const mode = fBuilderTrackingMode(ex);
    const side = ex.repsPerSide || ex.side || 'both';
    const targetText = fBuilderRawTarget(ex);
    const advancedKey = fBuilderAdvancedKey(item);
    const showAdvanced = !!focusedBuilderAdvanced[advancedKey] || side === 'each' || String(ex.tempo || ex.hold || '').trim();
    const setOptions = ex.blankPrescription && !String(ex.sets ?? '').trim()
      ? '<option value="" selected>Blank</option>'
      : Array.from({ length: 10 }, (_, i) => i + 1).map(value => `<option value="${value}" ${fNum(ex.sets) === value ? 'selected' : ''}>${value}</option>`).join('');
    return `<div class="focus-card">
      <div class="focus-card-title">Strength prescription<small>Set the plan here. The Logger records completed work later.</small></div>
      <div class="focus-fields">
        <div class="focus-field full"><label>Sets</label><select onchange="focusBuilderExercise(${itemIndex}, 'sets', this.value)">${setOptions}</select></div>
        <div class="focus-field full"><label>Tracking</label><select onchange="focusBuilderSetTrackingMode(${itemIndex}, this.value)">${F_TRACKING_MODES.map(value => `<option value="${value}" ${value === mode ? 'selected' : ''}>${fTrackingLabel(value)}</option>`).join('')}</select></div>
        ${fBuilderTrackingTargetMarkup(ex, itemIndex)}
        <div class="focus-field full"><label>Rest</label><select onchange="focusBuilderExercise(${itemIndex}, 'restSec', this.value)">${fRestOptions(ex.restSec || 0)}</select></div>
        <div class="focus-field full"><label>Exercise instructions</label><textarea oninput="focusBuilderExercise(${itemIndex}, 'coachNote', this.value)" placeholder="Write the cue the athlete should see at the top of the Logger">${fEsc(ex.coachNote || '')}</textarea></div>
      </div>
      <button class="focus-link" style="margin-top:14px" onclick="focusBuilderToggleAdvanced(${itemIndex})">${showAdvanced ? 'Hide options' : 'More options'}</button>
      ${showAdvanced ? `<div class="focus-fields" style="margin-top:14px"><div class="focus-field"><label>Side</label><select onchange="focusBuilderExercise(${itemIndex}, 'repsPerSide', this.value)"><option value="both" ${side === 'both' ? 'selected' : ''}>Both / total</option><option value="each" ${side === 'each' ? 'selected' : ''}>Each side</option></select></div><div class="focus-field"><label>Tempo / hold <span>optional</span></label><input value="${fEsc(ex.tempo || ex.hold || '')}" placeholder="e.g. 3-1-1 or 30s" oninput="focusBuilderExercise(${itemIndex}, 'tempo', this.value)"></div></div>` : ''}
      <div class="focus-plan" style="margin-top:14px"><span class="focus-plan-chip">${ex.blankPrescription && !String(ex.sets ?? '').trim() && !String(ex.reps ?? '').trim() ? 'Blank sets' : `${fNum(ex.sets) || 1} sets`}</span><span class="focus-plan-chip">${fEsc(fTrackingLabel(mode))}</span><span class="focus-plan-chip">${fEsc(targetText)}</span><span class="focus-plan-chip">Rest ${fFmt(fNum(ex.restSec) || 0)}</span></div>
      <div class="focus-row-actions"><button class="btn" onclick="focusBuilderAddExercise(${item.blockIndex})">Add exercise</button><button class="btn" onclick="focusBuilderMap()">Workout map</button></div>
    </div>`;
  }

  function fConditionMeasureOptions(value, type) {
    const fallback = type === 'intervals' ? 'rounds' : 'minutes';
    const current = ['minutes', 'seconds', 'distance', 'calories', 'rounds', 'completion'].includes(value) ? value : fallback;
    const labels = { minutes: 'Minutes', seconds: 'Seconds', distance: 'Distance', calories: 'Calories', rounds: 'Rounds', completion: 'For completion' };
    const options = Object.entries(labels).map(([key, label]) => `<option value="${key}" ${key === current ? 'selected' : ''}>${label}</option>`).join('');
    return { current, options };
  }

  function fConditionTargetField(block, itemIndex, measure, type) {
    const value = (key, fallback = '') => block[key] === undefined || block[key] === '' ? fallback : block[key];
    if (measure === 'completion') return `<div class="focus-field"><label>Target</label><div class="focus-static-value">For completion</div></div>`;
    if (measure === 'minutes') {
      const minutes = value('targetDurationMin', value('timeCapMin', block.targetDurationSec ? fNum(block.targetDurationSec) / 60 : 20));
      return `<div class="focus-field"><label>Target <span>minutes</span></label><input type="number" min="0" step="1" value="${fEsc(minutes)}" onchange="focusBuilderCondition(${itemIndex}, 'targetDurationMin', this.value)"></div>`;
    }
    if (measure === 'seconds') {
      const seconds = value('targetDurationSec', (fNum(value('targetDurationMin', value('timeCapMin', 0))) || 0) * 60 || 60);
      return `<div class="focus-field"><label>Target <span>seconds</span></label><input type="number" min="0" step="1" value="${fEsc(seconds)}" onchange="focusBuilderCondition(${itemIndex}, 'targetDurationSec', this.value)"></div>`;
    }
    if (measure === 'distance') return `<div class="focus-field"><label>Target <span>metres</span></label><input type="number" min="0" step="1" value="${fEsc(value('targetDistance'))}" onchange="focusBuilderCondition(${itemIndex}, 'targetDistance', this.value)"></div>`;
    if (measure === 'calories') return `<div class="focus-field"><label>Target <span>calories</span></label><input type="number" min="0" step="1" value="${fEsc(value('targetCalories'))}" onchange="focusBuilderCondition(${itemIndex}, 'targetCalories', this.value)"></div>`;
    if (measure === 'rounds' && type !== 'intervals') return `<div class="focus-field"><label>Target <span>rounds</span></label><input type="number" min="1" step="1" value="${fEsc(value('rounds', 1))}" onchange="focusBuilderCondition(${itemIndex}, 'rounds', this.value)"></div>`;
    return '';
  }

  function fBuilderConditioning(item, itemIndex) {
    const b = item.block;
    const type = b.conditioningType === 'intervals' ? 'intervals' : 'easy';
    const modality = F_MODALITIES.includes(b.modality) ? b.modality : (b.modality || 'Run');
    const measure = fConditionMeasureOptions(b.measurementType, type);
    const duration = b.targetDurationMin || b.timeCapMin || 20;
    const metricField = type === 'intervals' && measure.current === 'rounds' ? '' : fConditionTargetField(b, itemIndex, measure.current, type);
    const planMetric = measure.current === 'completion' ? 'For completion' : measure.current === 'minutes' ? `${duration} min` : measure.current === 'seconds' ? `${b.targetDurationSec || Math.round(duration * 60)} sec` : measure.current === 'distance' ? `${b.targetDistance || 0} m` : measure.current === 'calories' ? `${b.targetCalories || 0} cal` : `${b.rounds || 1} rounds`;
    const plan = type === 'intervals' ? `${planMetric} · ${b.workSec || 30}s / ${b.restSec || 0}s` : `${planMetric} easy`;
    return `<div class="focus-card">
      <div class="focus-card-title">Conditioning prescription<small>Conditioning has its own measures and result fields.</small></div>
      <div class="focus-switch"><button class="${type === 'easy' ? 'active' : ''}" onclick="focusBuilderConditionType(${itemIndex}, 'easy')">Easy aerobic</button><button class="${type === 'intervals' ? 'active' : ''}" onclick="focusBuilderConditionType(${itemIndex}, 'intervals')">Intervals</button></div>
      <div class="focus-fields" style="margin-top:14px">
        <div class="focus-field"><label>Modality</label><select onchange="focusBuilderCondition(${itemIndex}, 'modality', this.value)">${[...new Set([...F_MODALITIES, modality])].map(value => `<option value="${fEsc(value)}" ${value === modality ? 'selected' : ''}>${fEsc(value)}</option>`).join('')}</select></div>
        <div class="focus-field"><label>Measure</label><select onchange="focusBuilderCondition(${itemIndex}, 'measurementType', this.value)">${measure.options}</select></div>
        ${metricField}
        ${type === 'intervals' ? `<div class="focus-field"><label>Rounds</label><input type="number" min="1" value="${fEsc(b.rounds || 1)}" onchange="focusBuilderCondition(${itemIndex}, 'rounds', this.value)"></div><div class="focus-field"><label>Work <span>seconds</span></label><input type="number" min="1" value="${fEsc(b.workSec || 30)}" onchange="focusBuilderCondition(${itemIndex}, 'workSec', this.value)"></div><div class="focus-field"><label>Rest <span>seconds</span></label><input type="number" min="0" value="${fEsc(b.restSec || 90)}" onchange="focusBuilderCondition(${itemIndex}, 'restSec', this.value)"></div>` : ''}
        <div class="focus-field full"><label>Instructions</label><textarea oninput="focusBuilderCondition(${itemIndex}, 'notes', this.value)" placeholder="Write the session instruction">${fEsc(b.notes || '')}</textarea></div>
      </div>
      <div class="focus-plan" style="margin-top:14px"><span class="focus-plan-chip">${fEsc(modality)}</span><span class="focus-plan-chip">${fEsc(plan)}</span></div>
      <div class="focus-row-actions"><button class="btn" onclick="focusBuilderMap()">Workout map</button></div>
    </div>`;
  }

  function fBuilderText(item, itemIndex) {
    const block = item.block;
    return `<div class="focus-card"><div class="focus-card-title">Session instructions<small>Use this for warm-up, cool-down, or plain-language guidance.</small></div><div class="focus-field"><textarea oninput="focusBuilderBlock(${itemIndex}, 'notes', this.value)" placeholder="Write the instructions">${fEsc(block.notes || '')}</textarea></div><div class="focus-row-actions"><button class="btn" onclick="focusBuilderMap()">Workout map</button></div></div>`;
  }

  function fBuilderEmpty() {
    return `<div class="focus-card"><div class="focus-empty"><b>No blocks yet.</b>Start with a strength block, conditioning block, or instructions.</div><button class="btn primary focus-add" onclick="focusBuilderAddSheet()">Add first block</button></div>`;
  }

  function fBuilderNav(items) {
    const hasPrevious = focusedBuilderIndex > 0;
    const hasNext = focusedBuilderIndex < items.length - 1;
    return `<div class="focus-nav"><button class="btn" ${hasPrevious ? '' : 'disabled'} onclick="focusBuilderPrevious()">Back</button><button class="btn" onclick="focusBuilderMap()">Map</button><button class="btn primary" onclick="${hasNext ? 'focusBuilderNext()' : 'focusBuilderSave()'}">${hasNext ? 'Next' : 'Save'}</button></div>`;
  }

  function focusedBuilder() {
    fStyle();
    fMode(true);
    if (typeof nav === 'function') nav(false);
    if (typeof clock === 'function') clock(false);
    if (typeof stopRest === 'function') stopRest();
    const d = fDraft();
    if (!d) {
      fMode(false);
      return typeof go === 'function' ? go('programs') : null;
    }
    fPersistDraft();
    const items = fBuilderItems();
    const item = fBuilderItem();
    let body = fBuilderHeader('Builder', d.name || '', 'Map', 'focusBuilderMap()');
    body += items.length ? fProgress(items, focusedBuilderIndex, false) : '';
    if (!items.length) body += `<div class="focus-body"><div class="focus-section-row"><span class="focus-section-label">NEW WORKOUT</span><button class="focus-link" onclick="focusBuilderAddSheet()">+ Add block</button></div>${fBuilderEmpty()}</div>`;
    else {
      const section = fBuilderSection(item);
      body += `<div class="focus-body"><div class="focus-section-row"><span class="focus-section-label ${item.kind === 'conditioning' ? 'cond' : ''}">${fEsc(section)}</span><button class="focus-link" onclick="focusBuilderAddSheet()">+ Add block</button></div><div class="focus-title-row"><span class="focus-marker">${String.fromCharCode(65 + (focusedBuilderIndex % 26))}</span><div><div class="focus-item-kicker">${fEsc(item.block?.heading || 'Block')}</div><h1 class="focus-item-title">${fEsc(fBuilderTitle(item))}</h1>${item.kind === 'strength' ? `<div class="focus-item-sub">${fEsc(fBuilderRawTarget(item.exercise))} · ${fNum(item.exercise.restSec) || 0}s rest</div>` : ''}</div><button class="focus-quiet" onclick="focusBuilderMap()">Edit</button></div>${item.kind === 'strength' || item.kind === 'strength-empty' ? fBuilderStrength(item, focusedBuilderIndex) : item.kind === 'conditioning' ? fBuilderConditioning(item, focusedBuilderIndex) : fBuilderText(item, focusedBuilderIndex)}${fBuilderNav(items)}</div>`;
    }
    const app = document.getElementById('appScreen');
    if (app) {
      app.className = 'focused-app';
      app.innerHTML = `<div class="focus-shell">${body}</div>`;
      if (typeof growTextAreas === 'function') growTextAreas();
    }
    return undefined;
  }

  function fBuilderName(value) {
    const d = fDraft();
    if (!d) return;
    d.name = String(value ?? '');
    fPersistDraft();
  }

  function fBuilderBlock(itemIndex, key, value) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.block) return;
    item.block[key] = value;
    fPersistDraft();
  }

  function fBuilderExercise(itemIndex, key, value) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.exercise) return;
    if (key === 'sets') item.exercise.sets = item.exercise.blankPrescription && String(value ?? '') === '' ? '' : Math.max(1, fNum(value) || 1);
    else if (key === 'restSec') item.exercise.restSec = Math.max(0, fNum(value));
    else if (key === 'repsPerSide') {
      item.exercise.repsPerSide = value === 'each' ? 'each' : 'both';
      if (item.exercise.prescriptionType === 'repsPerSide' && value !== 'each') item.exercise.prescriptionType = 'reps';
      if (item.exercise.prescriptionType === 'reps' && value === 'each') item.exercise.prescriptionType = 'repsPerSide';
    }
    else if (key === 'tempo') item.exercise.tempo = String(value ?? '');
    else item.exercise[key] = value;
    fPersistDraft();
    if (key === 'sets' || key === 'restSec' || key === 'repsPerSide') focusedBuilder();
  }

  function fBuilderSetTrackingMode(itemIndex, mode) {
    const item = fBuilderItems()[itemIndex];
    const ex = item?.exercise;
    if (!ex || !F_TRACKING_MODES.includes(mode)) return;
    const targetReps = fBuilderTargetReps(ex);
    const targetPercent = fBuilderTargetPercent(ex);
    const targetSeconds = fBuilderTargetSeconds(ex);
    ex.trackingMode = mode;
    ex.targetReps = targetReps;
    ex.percentTarget = targetPercent;
    ex.secondsTarget = targetSeconds;
    if (mode === 'completion') {
      ex.prescriptionType = 'completion';
      ex.reps = 'For completion';
    } else if (mode === 'seconds') {
      ex.prescriptionType = 'seconds';
      ex.reps = targetSeconds ? `${targetSeconds}s` : '';
    } else {
      ex.prescriptionType = mode === 'reps-percent' ? 'percent1rm' : 'reps';
      ex.reps = targetReps || (ex.blankPrescription ? '' : '8');
    }
    fPersistDraft();
    focusedBuilder();
  }

  function fBuilderTrackingTarget(itemIndex, key, value, selectElement) {
    const item = fBuilderItems()[itemIndex];
    const ex = item?.exercise;
    if (!ex || value === '__custom__') {
      if (value === '__custom__') {
        const input = selectElement?.parentElement?.querySelector('.focus-custom-input');
        if (input) input.style.display = 'block';
      }
      return;
    }
    if (key === 'targetReps') {
      ex.targetReps = String(value ?? '').replace(/-/g, '–');
      if (fBuilderTrackingMode(ex) !== 'seconds' && fBuilderTrackingMode(ex) !== 'completion') ex.reps = ex.targetReps;
    } else if (key === 'percentTarget') {
      ex.percentTarget = String(value ?? '');
    } else if (key === 'secondsTarget') {
      ex.secondsTarget = String(value ?? '').replace(/s$/i, '');
      if (fBuilderTrackingMode(ex) === 'seconds') ex.reps = ex.secondsTarget ? `${ex.secondsTarget}s` : '';
    }
    fPersistDraft();
    focusedBuilder();
  }

  function fBuilderTrackingCustomTarget(itemIndex, key, value) {
    const item = fBuilderItems()[itemIndex];
    const ex = item?.exercise;
    if (!ex) return;
    const normalized = String(value ?? '').replace(/-/g, '–');
    if (key === 'targetReps') {
      ex.targetReps = normalized;
      if (!['seconds', 'completion'].includes(fBuilderTrackingMode(ex))) ex.reps = normalized;
    } else if (key === 'percentTarget') {
      ex.percentTarget = normalized;
    } else if (key === 'secondsTarget') {
      ex.secondsTarget = normalized.replace(/s$/i, '');
      if (fBuilderTrackingMode(ex) === 'seconds') ex.reps = ex.secondsTarget ? `${ex.secondsTarget}s` : '';
    }
    fPersistDraft();
  }

  function fBuilderTargetType(itemIndex, type) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.exercise) return;
    const defaults = { reps: '8', repsPerSide: '8', range: '8–10', amrap: 'AMRAP', percent1rm: '75%', seconds: '30s', completion: 'For completion' };
    item.exercise.prescriptionType = ['reps', 'range', 'repsPerSide', 'amrap', 'percent1rm', 'seconds', 'completion'].includes(type) ? type : 'reps';
    item.exercise.reps = defaults[item.exercise.prescriptionType];
    item.exercise.repsPerSide = item.exercise.prescriptionType === 'repsPerSide' ? 'each' : (item.exercise.repsPerSide === 'each' ? 'both' : (item.exercise.repsPerSide || 'both'));
    fPersistDraft();
    focusedBuilder();
  }

  function fBuilderTarget(itemIndex, value) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.exercise) return;
    if (value === '__custom__') {
      const select = [...document.querySelectorAll('.focus-field select')].find(el => [...el.options].some(option => option.value === '__custom__'));
      const input = select?.parentElement?.querySelector('.focus-custom-input');
      if (input) input.style.display = 'block';
      return;
    }
    item.exercise.reps = value;
    fPersistDraft();
    focusedBuilder();
  }

  function fBuilderCustomTarget(itemIndex, value) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.exercise) return;
    item.exercise.reps = String(value ?? '');
    fPersistDraft();
  }

  function fBuilderConditionType(itemIndex, type) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.block) return;
    item.block.conditioningType = type === 'intervals' ? 'intervals' : 'easy';
    if (!item.block.measurementType || (item.block.measurementType === 'minutes' && item.block.conditioningType === 'intervals')) item.block.measurementType = item.block.conditioningType === 'intervals' ? 'rounds' : 'minutes';
    if (item.block.measurementType === 'rounds' && item.block.conditioningType === 'easy' && !fNum(item.block.rounds)) item.block.measurementType = 'minutes';
    if (item.block.conditioningType === 'easy') {
      item.block.rounds = 1;
      item.block.workSec = 0;
      item.block.restSec = 0;
    } else {
      item.block.rounds = Math.max(1, fNum(item.block.rounds) || 6);
      item.block.workSec = Math.max(1, fNum(item.block.workSec) || 60);
      item.block.restSec = Math.max(0, fNum(item.block.restSec) || 120);
    }
    fPersistDraft();
    focusedBuilder();
  }

  function fBuilderCondition(itemIndex, key, value) {
    const item = fBuilderItems()[itemIndex];
    if (!item?.block) return;
    if (['targetDurationMin', 'targetDurationSec', 'targetDistance', 'targetCalories', 'rounds', 'workSec', 'restSec'].includes(key)) item.block[key] = Math.max(0, fNum(value));
    else item.block[key] = value;
    if (key === 'targetDurationMin') item.block.timeCapMin = fNum(value);
    if (key === 'measurementType') {
      item.block.measurementType = ['minutes', 'seconds', 'distance', 'calories', 'rounds', 'completion'].includes(value) ? value : (item.block.conditioningType === 'intervals' ? 'rounds' : 'minutes');
      focusedBuilder();
      return;
    }
    fPersistDraft();
  }

  function fBuilderJump(index) {
    focusedBuilderIndex = Math.max(0, Math.min(fBuilderItems().length - 1, Number(index) || 0));
    focusedBuilder();
  }

  function fBuilderPrevious() {
    if (focusedBuilderIndex > 0) {
      focusedBuilderIndex -= 1;
      focusedBuilder();
    }
  }

  function fBuilderNext() {
    if (focusedBuilderIndex < fBuilderItems().length - 1) {
      focusedBuilderIndex += 1;
      focusedBuilder();
    }
  }

  function fBuilderSave() {
    fPersistDraft();
    if (typeof flushDraftSave === 'function') flushDraftSave();
    if (typeof saveTemplate === 'function') saveTemplate();
  }

  function fBuilderExit() {
    fPersistDraft();
    if (typeof flushDraftSave === 'function') flushDraftSave();
    fMode(false);
    if (typeof go === 'function') go('programs');
  }

  function fBuilderAddSheet() {
    if (typeof sheet !== 'function') return;
    sheet(`<h2>Add to workout</h2><p class="lead">Keep the build focused: add one block, then fill it in.</p><div class="stack"><button class="btn primary block" onclick="focusBuilderAddBlock('strength')">Strength</button><button class="btn block" onclick="focusBuilderAddBlock('conditioning')">Conditioning</button><button class="btn block" onclick="focusBuilderAddBlock('text')">Instructions</button></div>`);
  }

  function fBuilderAddBlock(type) {
    const d = fDraft();
    if (!d) return;
    const block = type === 'conditioning'
      ? { id: id(), type: 'conditioning', heading: 'Conditioning', conditioningType: 'easy', modality: 'Run', measurementType: 'minutes', targetDurationMin: 20, targetDurationSec: '', targetHrZone: '', targetPace: '', targetWatts: '', targetDistance: '', targetCalories: '', rounds: 1, workSec: 0, restSec: 0, timeCapMin: 20, notes: '' }
      : type === 'text'
        ? { id: id(), type: 'text', heading: 'Instructions', notes: '' }
        : { id: id(), type: 'strength', heading: 'Strength', exercises: [] };
    d.blocks = d.blocks || [];
    d.blocks.push(block);
    fPersistDraft();
    fCloseSheet();
    focusedBuilderIndex = Math.max(0, fBuilderItems().length - 1);
    focusedBuilder();
  }

  function fBuilderAddExercise(blockIndex) {
    if (typeof sheet !== 'function') return;
    const pickOptions = typeof options === 'function' ? options() : '';
    sheet(`<h2>Add exercise</h2><div class="field"><label>Choose from library</label><select id="focusAddPick" onchange="focusBuilderPickExercise()"><option value="">Choose or type custom</option>${pickOptions}</select></div><div class="field"><label>Name</label><input id="focusAddName" placeholder="Exercise name"></div><div class="field"><label>Category</label><input id="focusAddCategory" placeholder="Strength, accessory, power"></div><button class="btn primary block" style="margin-top:12px" onclick="focusBuilderSaveExercise(${Number(blockIndex)})">Add exercise</button>`);
  }

  function fBuilderPickExercise() {
    const pick = document.getElementById('focusAddPick');
    if (!pick?.value) return;
    const state = fState();
    const found = typeof findLibraryExercise === 'function' ? findLibraryExercise(state, pick.value) : null;
    const name = document.getElementById('focusAddName');
    const categoryInput = document.getElementById('focusAddCategory');
    if (name) name.value = pick.value;
    if (categoryInput) categoryInput.value = found?.category || (typeof category === 'function' ? category(pick.value) : 'Custom');
  }

  function fBuilderSaveExercise(blockIndex) {
    const d = fDraft();
    const block = d?.blocks?.[blockIndex];
    const name = String(document.getElementById('focusAddName')?.value || '').trim();
    const cat = String(document.getElementById('focusAddCategory')?.value || '').trim() || 'Custom';
    if (!block || block.type !== 'strength') return;
    if (!name) return alert('Enter an exercise name.');
    const state = fState();
    let libraryItem = state.exercises?.find(ex => String(ex.name || '').toLowerCase() === name.toLowerCase());
    if (!libraryItem) {
      libraryItem = { id: `custom-${Date.now()}`, name, category: cat, builtIn: false, source: 'THE-user' };
      state.exercises = state.exercises || [];
      state.exercises.push(libraryItem);
    }
    block.exercises = block.exercises || [];
    block.exercises.push({ id: id(), exerciseId: libraryItem.id, name, category: cat, sets: 3, reps: '8', targetReps: '8', trackingMode: 'reps-kilos', prescriptionType: 'reps', percentTarget: '75%', secondsTarget: '30', restSec: 90, repsPerSide: 'both', coachNote: '' });
    fPersistDraft();
    fCloseSheet();
    focusedBuilderIndex = fBuilderItems().findIndex(item => item.blockIndex === blockIndex && item.exerciseIndex === block.exercises.length - 1);
    focusedBuilder();
  }

  function fBuilderMap() {
    const items = fBuilderItems();
    if (typeof sheet !== 'function') return;
    const rows = items.map((item, index) => {
      const name = fBuilderTitle(item);
      const isSuperset = item.kind === 'strength' && item.block?.superset;
      const meta = item.kind === 'conditioning' ? (item.block.conditioningType === 'intervals' ? 'Intervals' : 'Easy aerobic') : item.kind === 'text' ? 'Instructions' : item.kind === 'strength-empty' ? 'Empty strength block' : `${item.block.heading || 'Strength'} · ${item.exercise.blankPrescription && !String(item.exercise.sets ?? '').trim() && !String(item.exercise.reps ?? '').trim() ? 'Blank prescription' : `${item.exercise.sets || 1} sets`}${isSuperset ? ' · Superset' : ''}`;
      const next = items[index + 1];
      const canSuperset = item.kind === 'strength' && next?.kind === 'strength';
      const plus = index < items.length - 1 ? `<button class="focus-map-plus" ${canSuperset ? '' : 'disabled'} aria-label="${canSuperset ? 'Make superset' : 'Superset requires two strength exercises'}" onclick="event.stopPropagation();${canSuperset ? `focusBuilderSuperset(${index})` : 'return false'}">+</button>` : '';
      return `<div class="focus-map-item ${index === focusedBuilderIndex ? 'active' : ''}"><span class="focus-map-number">${String.fromCharCode(65 + (index % 26))}</span><button onclick="focusBuilderJump(${index});focusBuilderCloseMap()"><div class="focus-map-name">${fEsc(name)}</div><div class="focus-map-meta">${fEsc(meta)}</div></button><div class="focus-map-actions"><button aria-label="Move up" onclick="event.stopPropagation();focusBuilderMove(${index}, -1)">↑</button><button aria-label="Move down" onclick="event.stopPropagation();focusBuilderMove(${index}, 1)">↓</button><button class="danger" aria-label="Remove" onclick="event.stopPropagation();focusBuilderRemove(${index})">×</button></div></div>${plus}`;
    }).join('');
    sheet(`<h2>Workout map</h2><p class="lead">Choose a screen or adjust the order.</p><div class="focus-map-list">${rows || '<div class="focus-empty">No blocks yet.</div>'}</div><button class="btn primary focus-add" onclick="focusBuilderCloseMap();focusBuilderAddSheet()">+ Add block</button>`);
  }

  function fBuilderCloseMap() {
    fCloseSheet();
  }

  function fBuilderMove(index, direction) {
    const items = fBuilderItems();
    const item = items[index];
    if (!item) return;
    const target = items[index + direction];
    if (!target) return;
    const d = fDraft();
    if (item.blockIndex === target.blockIndex && item.kind === 'strength' && target.kind === 'strength') {
      const exercises = d.blocks[item.blockIndex].exercises;
      [exercises[item.exerciseIndex], exercises[target.exerciseIndex]] = [exercises[target.exerciseIndex], exercises[item.exerciseIndex]];
    } else if (item.exerciseIndex === -1) {
      const from = item.blockIndex;
      const to = direction < 0 ? from - 1 : from + 1;
      if (to < 0 || to >= d.blocks.length) return;
      const moving = d.blocks[from];
      const destination = d.blocks[to];
      const isWarm = /^warm[- ]?up/i.test(String(moving.heading || ''));
      const isCool = /^cool[- ]?down/i.test(String(moving.heading || ''));
      const destinationIsWarm = /^warm[- ]?up/i.test(String(destination.heading || ''));
      const destinationIsCool = /^cool[- ]?down/i.test(String(destination.heading || ''));
      if ((isWarm && direction > 0) || (isCool && direction < 0) || (destinationIsWarm && direction < 0) || (destinationIsCool && direction > 0)) return;
      [d.blocks[from], d.blocks[to]] = [d.blocks[to], d.blocks[from]];
    } else {
      return;
    }
    fPersistDraft();
    fCloseSheet();
    const movedKey = item.exerciseIndex === -1 ? item.block?.id : item.exercise?.id;
    focusedBuilderIndex = Math.max(0, fBuilderItems().findIndex(entry => (entry.exerciseIndex === -1 ? entry.block?.id : entry.exercise?.id) === movedKey));
    focusedBuilder();
  }

  function fBuilderSuperset(index) {
    const items = fBuilderItems();
    const left = items[index];
    const right = items[index + 1];
    const d = fDraft();
    if (!left || !right || left.kind !== 'strength' || right.kind !== 'strength' || !d) return;
    if (left.blockIndex === right.blockIndex) {
      d.blocks[left.blockIndex].superset = true;
    } else {
      const first = Math.min(left.blockIndex, right.blockIndex);
      const second = Math.max(left.blockIndex, right.blockIndex);
      const firstBlock = d.blocks[first];
      const secondBlock = d.blocks[second];
      if (firstBlock?.type !== 'strength' || secondBlock?.type !== 'strength') return;
      d.blocks.splice(first, 2, { ...firstBlock, id: typeof id === 'function' ? id() : `superset-${Date.now()}`, heading: 'Superset', superset: true, exercises: [...(firstBlock.exercises || []), ...(secondBlock.exercises || [])] });
    }
    fPersistDraft();
    fCloseSheet();
    focusedBuilderIndex = Math.min(index, Math.max(0, fBuilderItems().length - 1));
    focusedBuilder();
  }

  function fBuilderRemove(index) {
    const items = fBuilderItems();
    const item = items[index];
    const d = fDraft();
    if (!item || !d) return;
    if (!confirm(`Remove ${fBuilderTitle(item)}?`)) return;
    if (item.exerciseIndex >= 0) d.blocks[item.blockIndex].exercises.splice(item.exerciseIndex, 1);
    else d.blocks.splice(item.blockIndex, 1);
    fPersistDraft();
    fCloseSheet();
    focusedBuilderIndex = Math.max(0, Math.min(fBuilderItems().length - 1, index - 1));
    focusedBuilder();
  }

  function fLoggerTaskItems(session) {
    return session?.tasks || [];
  }

  function fLoggerPlan(task) {
    if (!task) return '';
    if (task.kind === 'superset') {
      const rounds = Math.max(0, ...(task.exercises || []).map(ex => (ex.rows || []).length));
      return `Superset · ${rounds} round${rounds === 1 ? '' : 's'}`;
    }
    if (task.kind === 'conditioning') {
      const measure = ['minutes', 'seconds', 'distance', 'calories', 'rounds', 'completion'].includes(task.measurementType) ? task.measurementType : (task.conditioningType === 'intervals' ? 'rounds' : 'minutes');
      const metric = measure === 'completion' ? 'For completion' : measure === 'minutes' ? `${task.targetDurationMin || task.timeCapMin || 0} min` : measure === 'seconds' ? `${task.targetDurationSec || 0}s` : measure === 'distance' ? `${task.targetDistance || 0} m` : measure === 'calories' ? `${task.targetCalories || 0} cal` : `${task.rounds || 1} rounds`;
      return task.conditioningType === 'intervals' ? `${metric} · ${task.workSec || 0}s work / ${task.restSec || 0}s rest` : `${metric} easy aerobic`;
    }
    if (task.blankPrescription && !String(task.sets ?? '').trim() && !String(task.reps ?? '').trim()) return 'Blank prescription';
    const rest = fNum(task.restSec) ? ` · Rest ${fFmt(task.restSec)}` : '';
    return `${task.sets || task.rows?.length || 0} sets · ${fLoggerPlanTarget(task)}${rest}`;
  }

  function fLoggerFieldDescriptors(task) {
    const mode = fLoggerTrackingMode(task);
    const repsLabel = task?.prescriptionType === 'repsPerSide' ? 'Reps / side' : 'Reps';
    if (mode === 'completion') return [{ key: 'status', label: 'Status', readOnly: true, value: 'Ready' }];
    if (mode === 'seconds') return [{ key: 'reps', label: 'Seconds', step: '1', inputmode: 'numeric' }];
    if (mode === 'reps-percent') return [{ key: 'reps', label: repsLabel, step: '1', inputmode: 'numeric' }, { key: 'percent', label: '%1RM', readOnly: true, value: fLoggerTargetPercent(task) }];
    if (mode === 'reps-seconds') return [{ key: 'reps', label: repsLabel, step: '1', inputmode: 'numeric' }, { key: 'seconds', label: 'Seconds', step: '1', inputmode: 'numeric' }];
    if (mode === 'reps-only') return [{ key: 'reps', label: repsLabel, step: '1', inputmode: 'numeric' }];
    return [{ key: 'reps', label: repsLabel, step: '1', inputmode: 'numeric' }, { key: 'weight', label: 'Kilos', step: '0.5', inputmode: 'decimal' }];
  }

  function fLoggerPrepareRow(task, row) {
    const mode = fLoggerTrackingMode(task);
    if (mode === 'completion') row.targetKind = 'completion';
    else if (mode === 'seconds') row.targetKind = 'seconds';
    else if (mode !== 'completion' && mode !== 'seconds' && row.targetKind === 'completion') row.targetKind = 'reps';
    const fields = fLoggerFieldDescriptors(task);
    fields.forEach(field => {
      if (field.readOnly || field.key === 'status' || field.key === 'percent') return;
      if (String(row[field.key] ?? '').trim() !== '') return;
      if (field.key === 'reps') {
        row.reps = mode === 'seconds' ? fLoggerTargetSeconds(task) : fTargetNumber(fLoggerTargetReps(task, row), true);
      } else if (field.key === 'seconds') {
        row.seconds = fLoggerTargetSeconds(task);
      }
    });
  }

  function fLoggerFieldValue(task, row, field) {
    if (field.key === 'status') return field.value || 'Ready';
    if (field.key === 'percent') return field.value || fLoggerTargetPercent(task);
    return row[field.key] ?? '';
  }

  function fLoggerFieldMarkup(task, row, field, index, superset = false) {
    const value = fLoggerFieldValue(task, row, field);
    if (field.readOnly) return `<div class="focus-log-static">${fEsc(value || '—')}</div>`;
    const setter = superset ? `setSupersetValue('${field.key}', this.value)` : `updateSet(${index}, '${field.key}', this.value)`;
    return `<input type="number" step="${field.step || '1'}" inputmode="${field.inputmode || 'numeric'}" aria-label="${fEsc(field.label)}" value="${fEsc(value)}" onchange="${setter}">`;
  }

  function fLoggerRows(task) {
    if (!Array.isArray(task.rows)) {
      if (typeof upgradeRows === 'function') upgradeRows(task);
      else task.rows = [];
    }
    const rows = task.rows || [];
    const fields = fLoggerFieldDescriptors(task);
    rows.forEach(row => fLoggerPrepareRow(task, row));
    const columnCount = fields.length;
    const columns = `38px repeat(${columnCount}, minmax(0, 1fr)) 52px`;
    const body = rows.map((row, index) => `<div class="focus-log-row ${row.done ? 'done' : ''}">
      <div class="focus-set-index">${row.done ? '✓' : (row.extra ? '+' : row.n)}</div>
      ${fields.map(field => `<div>${fLoggerFieldMarkup(task, row, field, index)}</div>`).join('')}
      <button class="focus-log-btn focus-log-complete ${row.done ? 'done' : 'primary'}" aria-label="${row.done ? 'Edit' : 'Complete'} set ${index + 1}" onclick="toggleSet(${index})">${row.done ? '✓' : ''}</button>
    </div>`).join('');
    return `<div class="focus-log" style="--focus-log-cols:${columns}"><div class="focus-log-head"><span>Sets</span>${fields.map(field => `<span>${fEsc(field.label)}</span>`).join('')}<span>Completed</span></div>${body}</div>`;
  }

  function fLoggerStrength(task) {
    return `<div class="focus-card"><div class="focus-card-title">Log your sets<small>The Builder locked the fields for this exercise. Enter what you actually completed.</small></div>${fLoggerRows(task)}<button class="btn primary focus-complete" onclick="completeStrength()">${task.complete ? 'Reopen exercise' : 'Complete exercise'}</button></div>`;
  }

  function fRunnerHeader(session, tasks, index) {
    return `<div class="focus-runner-head">
      <button class="focus-runner-back" aria-label="Back" onclick="focusLoggerBack()">‹</button>
      <button class="focus-runner-count" onclick="focusLoggerMap()">Exercise ${index + 1} of ${tasks.length}</button>
      <button class="focus-runner-timer" aria-label="Rest timer" onclick="startCurrentRest()">◷</button>
    </div>`;
  }

  function fRunnerRows(task) {
    if (!Array.isArray(task.rows)) {
      if (typeof upgradeRows === 'function') upgradeRows(task);
      else task.rows = [];
    }
    const rows = task.rows || [];
    const fields = fLoggerFieldDescriptors(task);
    rows.forEach(row => fLoggerPrepareRow(task, row));
    const cols = `44px repeat(${fields.length}, minmax(0, 1fr))`;
    const head = `<div class="focus-set-table-head"><span>Set</span>${fields.map(field => `<span>${fEsc(field.label)}</span>`).join('')}</div>`;
    const body = rows.map((row, index) => `<div class="focus-set-table-row ${row.done ? 'done' : ''}">
      <button class="focus-set-table-num" aria-label="${row.done ? 'Reopen' : 'Complete'} set ${index + 1}" onclick="toggleSet(${index})">${row.done ? '✓' : (row.extra ? '+' : row.n)}</button>
      ${fields.map(field => `<div>${fLoggerFieldMarkup(task, row, field, index)}</div>`).join('')}
    </div>`).join('');
    return `<div class="focus-set-table" style="--focus-set-cols:${cols}">${head}${body}</div>`;
  }

  function fRunnerStrength(task) {
    const mode = fLoggerTrackingMode(task);
    const sets = fNum(task.sets) || (task.rows || []).length || 1;
    const reps = fLoggerTargetReps(task);
    const restLabel = fNum(task.restSec) ? `Rest ${fFmt(fNum(task.restSec))}` : '';
    const subParts = [`${sets} sets`, mode === 'completion' ? 'for completion' : `${reps || '—'} reps`, restLabel].filter(Boolean);
    const note = String(task.coachNote || '').trim();
    const rows = task.rows || [];
    const canRemove = rows.length > 0 && !!rows[rows.length - 1].extra;
    return `<div class="focus-runner-title-block">
        <div class="focus-runner-name">${fEsc(task.name || 'Exercise')}</div>
        <div class="focus-runner-sub">${fEsc(subParts.join(' · '))}</div>
      </div>
      <div class="focus-rx">
        <div class="focus-rx-main">${sets} × ${fEsc(reps || '—')}</div>
        ${note ? `<div class="focus-rx-note">${fEsc(note)}</div>` : ''}
      </div>
      ${fRunnerRows(task)}
      <div class="focus-set-stepper">
        <button ${canRemove ? '' : 'disabled'} aria-label="Remove set" onclick="focusRunnerRemoveSet()">−</button>
        <span class="focus-set-stepper-label">Set</span>
        <button aria-label="Add set" onclick="focusRunnerAddSet()">+</button>
      </div>
      <button class="btn primary focus-complete" onclick="completeStrength()">${task.complete ? 'Reopen exercise' : 'Complete exercise'}</button>`;
  }

  function fRunnerAddSet() {
    if (typeof addExtra === 'function') addExtra();
  }

  function fRunnerRemoveSet() {
    const t = typeof current === 'function' ? current() : null;
    if (!t || !Array.isArray(t.rows) || !t.rows.length) return;
    const lastIndex = t.rows.length - 1;
    if (!t.rows[lastIndex].extra) return;
    if (typeof deleteExtra === 'function') deleteExtra(lastIndex);
  }

  function fLoggerInstruction(task) {
    const note = String(task?.coachNote || '').trim();
    return `<div class="focus-card focus-instruction-card"><div class="focus-card-title">Exercise instructions<small>Set in Builder · locked during the Logger</small></div><div class="focus-plan"><span class="focus-plan-chip">${fEsc(fTrackingLabel(fLoggerTrackingMode(task)))}</span><span class="focus-plan-chip">${fEsc(fLoggerPlanTarget(task))}</span>${fNum(task?.restSec) ? `<span class="focus-plan-chip">Rest ${fFmt(task.restSec)}</span>` : ''}</div><div class="focus-instruction-copy">${fEsc(note || 'Follow the programmed prescription and record the work you complete.')}</div></div>`;
  }

  function fConditioningNote(task) {
    return `<div class="focus-field full"><label>Instructions · locked from Builder</label><div class="focus-instruction-copy">${fEsc(String(task.notes || '').trim() || 'Follow the programmed conditioning instructions.')}</div></div>`;
  }

  function fLoggerEasy(task) {
    const result = task.result || {};
    const fields = typeof resultFields === 'function' ? resultFields(task.modality, task) : ['duration', 'distance', 'calories', 'avgHr', 'notes'];
    const elapsed = typeof blockElapsed === 'function' ? blockElapsed(task) : 0;
    return `<div class="focus-card"><div class="focus-card-title">Easy aerobic result<small>Log the work you actually completed.</small></div><div class="focus-plan"><span class="focus-plan-chip">${fEsc(task.modality || 'Run')}</span><span class="focus-plan-chip">Plan · ${fEsc(fLoggerPlan(task))}</span></div><div class="focus-row-actions"><button class="btn" onclick="toggleBlockClock()">${task.blockTimer?.on ? 'Pause timer' : 'Start timer'}</button></div><div class="focus-card soft"><div class="focus-card-title">Block duration<small id="blockClock">${fFmt(elapsed)}</small></div></div><div class="focus-fields">${typeof resultInputs === 'function' ? resultInputs(result, fields).replace('class=two', 'class="focus-fields"') : ''}</div>${fConditioningNote(task)}<button class="btn primary focus-complete" onclick="completeConditioning()">Complete block</button>${task.optional ? '<button class="btn focus-complete" onclick="skipOptionalTask()">Skip optional block</button>' : ''}</div>`;
  }

  function fLoggerIntervals(task) {
    const result = task.result || {};
    const interval = typeof normaliseInterval === 'function' ? normaliseInterval(task) : { phase: 'ready', remaining: task.workSec || 30, completedRounds: 0 };
    const elapsed = typeof intervalElapsed === 'function' ? intervalElapsed(interval) : 0;
    const remaining = typeof intervalRemaining === 'function' ? intervalRemaining(interval) : fNum(interval.remaining);
    const fields = typeof resultFields === 'function' ? resultFields(task.modality, task) : ['duration', 'roundsCompleted', 'distance', 'calories', 'avgHr', 'notes'];
    const finished = !!interval.finished;
    return `<div class="focus-card focus-interval"><div class="focus-card-title">Intervals<small>${fEsc(task.modality || 'Run')} · ${fEsc(fLoggerPlan(task))}</small></div>${finished ? `<div class="focus-phase">Intervals complete</div><div class="focus-bigtime">${fFmt(elapsed)}</div><div class="focus-helper">${interval.completedRounds || 0} completed round${interval.completedRounds === 1 ? '' : 's'}</div>` : `<div class="focus-phase">${interval.phase === 'ready' ? 'Ready' : fEsc(interval.phase)}</div><div class="focus-bigtime" id="intervalClock">${fFmt(remaining)}</div><div class="focus-helper" id="intervalMeta">${interval.phase === 'ready' ? 'Start when ready' : `Round ${Math.min(interval.round || 1, task.rounds || 1)} · elapsed ${fFmt(elapsed)}`}</div><div class="focus-actions"><button class="btn primary" onclick="toggleIntervals()">${interval.running ? 'Pause' : 'Start'}</button><button class="btn" onclick="skipInterval()">Skip phase</button><button class="btn" onclick="endIntervals()">End</button></div>`}<div class="focus-card soft" style="margin-top:14px;text-align:left"><div class="focus-card-title">Result<small>Save what happened after the interval block.</small></div><div class="focus-fields">${typeof resultInputs === 'function' ? resultInputs(result, fields).replace('class=two', 'class="focus-fields"') : ''}</div>${fConditioningNote(task)}</div><button class="btn primary focus-complete" onclick="completeConditioning()">${finished ? 'Save results and complete block' : 'Complete block'}</button>${task.optional ? '<button class="btn focus-complete" onclick="skipOptionalTask()">Skip optional block</button>' : ''}</div>`;
  }

  function fLoggerText(task) {
    return `<div class="focus-card"><div class="focus-card-title">Instructions<small>Mark this block complete when you are done.</small></div><div class="focus-field"><textarea oninput="current().notes=this.value;save();autoGrow(this)" placeholder="Add a note">${fEsc(task.notes || '')}</textarea></div><button class="btn primary focus-complete" onclick="completeTask()">Complete block</button>${task.optional ? '<button class="btn focus-complete" onclick="skipOptionalTask()">Skip optional block</button>' : ''}</div>`;
  }

  function fLoggerSuperset(task) {
    const item = typeof supersetCurrent === 'function' ? supersetCurrent(task) : null;
    const exercises = task?.exercises || [];
    const list = exercises.map((exercise, index) => {
      const done = (exercise.rows || []).filter(row => row.done).length;
      const total = (exercise.rows || []).length;
      return `<div class="focus-superset-item ${item?.exIndex === index ? 'active' : ''}"><b>A${index + 1}</b><span>${fEsc(exercise.name || 'Exercise')} · ${done}/${total} logged</span></div>`;
    }).join('');
    if (!item) return `<div class="focus-card focus-superset-card"><div class="focus-card-title">Superset complete<small>All programmed rounds are logged.</small></div><div class="focus-superset-list">${list}</div><button class="btn primary focus-complete" onclick="completeTask()">Continue</button></div>`;
    const exercise = exercises[item.exIndex];
    const row = item.row;
    fLoggerPrepareRow(exercise, row);
    const fields = fLoggerFieldDescriptors(exercise);
    const columns = `38px repeat(${fields.length}, minmax(0, 1fr)) 52px`;
    const fieldHeaders = fields.map(field => `<span>${fEsc(field.label)}</span>`).join('');
    const fieldValues = fields.map(field => `<div>${fLoggerFieldMarkup(exercise, row, field, item.rowIndex, true)}</div>`).join('');
    const instruction = String(exercise.coachNote || task.notes || '').trim() || 'Complete each exercise in order before resting.';
    return `<div class="focus-card focus-superset-card"><div class="focus-card-title">Superset round ${item.rowIndex + 1}<small>Complete A${item.exIndex + 1}, then move to the next exercise.</small></div><div class="focus-superset-list">${list}</div><div class="focus-instruction-copy">${fEsc(instruction)}</div><div class="focus-log" style="--focus-log-cols:${columns};margin-top:14px"><div class="focus-log-head"><span>Set</span>${fieldHeaders}<span>Done</span></div><div class="focus-log-row"><div class="focus-set-index">${item.rowIndex + 1}</div>${fieldValues}<button class="focus-log-btn focus-log-complete primary" aria-label="Complete superset set" onclick="logSupersetSet()"></button></div></div><button class="btn primary focus-complete" onclick="logSupersetSet()">Log ${fEsc(exercise.name || 'exercise')} and continue</button></div>`;
  }

  function fLoggerNav(session) {
    const index = Number(session.taskIndex) || 0;
    const last = index >= (session.tasks || []).length - 1;
    return `<div class="focus-nav"><button class="btn" ${index ? '' : 'disabled'} onclick="focusLoggerBack()">Back</button><button class="btn" onclick="startCurrentRest()">Timer</button><button class="btn primary" onclick="nextTask()">${last ? 'Finish' : 'Next'}</button></div><button class="btn ghost focus-abandon" onclick="abandonActiveSession()">Abandon workout</button>`;
  }

  function focusedTrain() {
    fStyle();
    fMode(true);
    if (typeof nav === 'function') nav(false);
    if (typeof clock === 'function') clock(true);
    const session = typeof activeSession === 'function' ? activeSession() : null;
    if (!session) {
      fMode(false);
      return typeof go === 'function' ? go('home') : null;
    }
    if (typeof syncWorkoutClock === 'function') syncWorkoutClock();
    const task = typeof current === 'function' ? current() : session.tasks?.[session.taskIndex];
    if (!task) return typeof finishSession === 'function' ? finishSession() : null;
    if (task.kind === 'strength' && typeof upgradeRows === 'function') upgradeRows(task);
    const tasks = fLoggerTaskItems(session);
    const section = task.kind === 'conditioning' ? 'CONDITIONING' : task.kind === 'text' ? 'INSTRUCTIONS' : String(task.heading || 'STRENGTH').toUpperCase();
    const title = task.kind === 'strength' ? task.name : task.heading;
    const marker = String.fromCharCode(65 + ((session.taskIndex || 0) % 26));
    let content;
    if (task.kind === 'strength') {
      content = fRunnerHeader(session, tasks, session.taskIndex || 0);
      content += `<div class="focus-body">${fRunnerStrength(task)}${fLoggerNav(session)}</div>`;
    } else {
      content = fLoggerHeader(session, task, session.taskIndex || 0);
      content += fProgress(tasks, session.taskIndex || 0, true);
      content += `<div class="focus-body"><div class="focus-section-row"><span class="focus-section-label ${task.kind === 'conditioning' ? 'cond' : ''}">${fEsc(section)}</span><button class="focus-link" onclick="focusLoggerMap()">Overview</button></div><div class="focus-title-row"><span class="focus-marker">${marker}</span><div><div class="focus-item-kicker">${fEsc(session.name || 'Workout')}</div><h1 class="focus-item-title">${fEsc(title || 'Training')}</h1><div class="focus-item-sub">${fEsc(fLoggerPlan(task))}</div></div></div>`;
      if (task.kind === 'conditioning') content += task.conditioningType === 'intervals' ? fLoggerIntervals(task) : fLoggerEasy(task);
      else if (task.kind === 'superset') content += fLoggerSuperset(task);
      else content += fLoggerText(task);
      content += fLoggerNav(session) + '</div>';
    }
    const app = document.getElementById('appScreen');
    if (app) {
      app.className = 'focused-app';
      app.innerHTML = `<div class="focus-shell">${content}</div>`;
      if (typeof growTextAreas === 'function') growTextAreas();
    }
    return undefined;
  }

  function fLoggerJump(index) {
    const session = typeof activeSession === 'function' ? activeSession() : null;
    if (!session) return;
    session.taskIndex = Math.max(0, Math.min((session.tasks || []).length - 1, Number(index) || 0));
    if (typeof save === 'function') save('logger-jump');
    fCloseSheet();
    focusedTrain();
  }

  function fLoggerMap() {
    const session = typeof activeSession === 'function' ? activeSession() : null;
    if (!session || typeof sheet !== 'function') return;
    const rows = (session.tasks || []).map((task, index) => `<button class="focus-map-item ${index === session.taskIndex ? 'active' : ''}" style="width:100%;text-align:left" onclick="focusLoggerJump(${index})"><span class="focus-map-number">${index + 1}</span><span><span class="focus-map-name">${task.complete ? '✓ ' : ''}${fEsc(task.kind === 'strength' ? task.name : task.heading)}</span><span class="focus-map-meta">${fEsc(fLoggerPlan(task))}</span></span><span class="pill">${task.complete ? 'Done' : 'Open'}</span></button>`).join('');
    sheet(`<h2>Workout overview</h2><p class="lead">Jump to any block without losing the session.</p><div class="focus-map-list">${rows}</div>`);
  }

  function fLoggerBack() {
    const session = typeof activeSession === 'function' ? activeSession() : null;
    if (!session) return;
    if ((session.taskIndex || 0) > 0) {
      session.taskIndex -= 1;
      if (typeof save === 'function') save('logger-back');
      focusedTrain();
    } else if (typeof go === 'function') {
      fMode(false);
      go('calendar');
    }
  }

  function fSyncWorkoutClock() {
    const core = fSyncWorkoutClock.core;
    if (core) core();
    const session = typeof ses === 'function' && typeof S !== 'undefined' ? ses(S.active) : null;
    const clockEl = document.getElementById('focusWorkoutClock');
    if (clockEl && session && typeof workElapsed === 'function') {
      clockEl.textContent = fFmt(workElapsed(session));
      clockEl.classList.toggle('on', !!session.timer?.on);
    }
  }

  fStyle();
  fSyncWorkoutClock.core = typeof syncWorkoutClock === 'function' ? syncWorkoutClock : null;
  window.syncWorkoutClock = fSyncWorkoutClock;
  window.focusedBuilder = focusedBuilder;
  window.builder = focusedBuilder;
  window.focusedTrain = focusedTrain;
  window.train = focusedTrain;
  window.focusBuilderName = fBuilderName;
  window.focusBuilderBlock = fBuilderBlock;
  window.focusBuilderExercise = fBuilderExercise;
  window.focusBuilderSetTrackingMode = fBuilderSetTrackingMode;
  window.focusBuilderTrackingTarget = fBuilderTrackingTarget;
  window.focusBuilderTrackingCustomTarget = fBuilderTrackingCustomTarget;
  window.focusBuilderToggleAdvanced = fBuilderToggleAdvanced;
  window.focusBuilderTargetType = fBuilderTargetType;
  window.focusBuilderTarget = fBuilderTarget;
  window.focusBuilderCustomTarget = fBuilderCustomTarget;
  window.focusBuilderConditionType = fBuilderConditionType;
  window.focusBuilderCondition = fBuilderCondition;
  window.focusBuilderJump = fBuilderJump;
  window.focusBuilderPrevious = fBuilderPrevious;
  window.focusBuilderNext = fBuilderNext;
  window.focusBuilderSave = fBuilderSave;
  window.focusBuilderExit = fBuilderExit;
  window.focusBuilderAddSheet = fBuilderAddSheet;
  window.focusBuilderAddBlock = fBuilderAddBlock;
  window.focusBuilderAddExercise = fBuilderAddExercise;
  window.focusBuilderPickExercise = fBuilderPickExercise;
  window.focusBuilderSaveExercise = fBuilderSaveExercise;
  window.focusBuilderMap = fBuilderMap;
  window.focusBuilderCloseMap = fBuilderCloseMap;
  window.focusBuilderMove = fBuilderMove;
  window.focusBuilderSuperset = fBuilderSuperset;
  window.focusBuilderRemove = fBuilderRemove;
  window.focusLoggerJump = fLoggerJump;
  window.focusLoggerMap = fLoggerMap;
  window.focusLoggerBack = fLoggerBack;
  window.focusRunnerAddSet = fRunnerAddSet;
  window.focusRunnerRemoveSet = fRunnerRemoveSet;

  const renderCore = window.render;
  let renderFocusWrapper = null;
  if (renderCore) {
    renderFocusWrapper = function () {
      fMode(false);
      return renderCore.apply(this, arguments);
    };
    window.render = renderFocusWrapper;
  }
  const showSummaryCore = window.showSummary;
  let showSummaryFocusWrapper = null;
  if (showSummaryCore) {
    showSummaryFocusWrapper = function () {
      fMode(false);
      return showSummaryCore.apply(this, arguments);
    };
    window.showSummary = showSummaryFocusWrapper;
  }

  // The original app is a classic script. Its function declarations are
  // global bindings, so update those bindings as well as window properties;
  // route arrows and existing handlers then resolve the focused renderers.
  try {
    builder = focusedBuilder;
    train = focusedTrain;
    syncWorkoutClock = fSyncWorkoutClock;
    if (renderFocusWrapper) render = renderFocusWrapper;
    if (showSummaryFocusWrapper) showSummary = showSummaryFocusWrapper;
  } catch (error) {
    // Direct window calls still work in hosts that isolate classic globals.
  }
})();
