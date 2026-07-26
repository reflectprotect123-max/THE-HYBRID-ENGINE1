import { IMP_ALIAS } from './import-lib';
import type { ModeKey, Settings } from './types';

/*
 * The importer.
 *
 * Turns a pasted, photographed or dictated workout into structured blocks. It
 * is forgiving on purpose: a coach's whiteboard is not a data format, and the
 * cost of a wrong guess is one tap to correct it, whereas the cost of refusing
 * to parse is that the feature goes unused.
 *
 * Every uncertain decision becomes an ISSUE rather than a silent assumption, so
 * the UI can ask instead of the app pretending it knew.
 */

export interface Lexicon {
  /** learned single words, e.g. a habitual typo → 'rest' */
  kw: Record<string, string>;
  /** learned movement aliases → canonical entry */
  ex: Record<string, { name: string; mode: ModeKey }>;
}

export interface ImpExercise {
  name: string;
  mode: ModeKey;
  rpe: number;
  rest: number;
  /* Optional because the heading-with-scheme branch produces a placeholder
     exercise that has no line of its own to read "each side" from — it is
     waiting for the athlete to name it. Defaulting it to false there would
     assert something the text never said. */
  eachSide?: boolean;
  sets: number;
  reps?: number;
  secs?: number;
  kg?: number;
  range?: string;
  /** a ladder: 18-16-14-12-10 keeps every rung */
  varied?: number[];
}

export interface ImpBlock {
  heading: string;
  format: string;
  rounds: number;
  rest: number;
  superset: boolean;
  exercises: ImpExercise[];
}

export type ImpIssue =
  | { id: number; resolved: boolean; kind: 'confirmName'; ref: ImpExercise; raw: string; name: string; fuzzy?: boolean }
  | { id: number; resolved: boolean; kind: 'nameOrSection'; ref: ImpExercise; block: string; blockObj: ImpBlock }
  | { id: number; resolved: boolean; kind: 'typo'; ref: ImpExercise | ImpBlock; word: string; rest: number }
  | { id: number; resolved: boolean; kind: 'unreadable'; text: string };

/*
 * Omit over a union collapses to the keys the members SHARE, which for
 * ImpIssue is just `kind` — so a plain Omit<ImpIssue, 'id'|'resolved'> would
 * reject every issue's own fields. Distribute it across the members instead.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewIssue = DistributiveOmit<ImpIssue, 'id' | 'resolved'>;

export interface ImpResult {
  name: string;
  blocks: ImpBlock[];
  issues: ImpIssue[];
  notes: string[];
}

/** Section headings. A line matching one of these opens a block, not a movement. */
export const IMP_HEADINGS =
  /^(warm[\s-]?up|warmup|cool[\s-]?down|cooldown|finisher|accessor(y|ies)|main|strength|conditioning|power primer|primer|prep|core|circuit|metcon|for time|for reps|rft|chipper|buy[\s-]?in|cash[\s-]?out|part [a-d]|block \d|section)\b/i;

/** Function words. Their presence is what separates a note from a movement. */
export const IMP_PROSE_RX =
  /\b(the|your|you|they|is|are|was|were|be|been|before|after|with|that|this|which|while|need|needs|select|matches|contains|including|broken|because|should|would|could|about|between|than|then|when|where|into a)\b/i;

export const emptyLexicon = (): Lexicon => ({ kw: {}, ex: {} });

export function lexiconOf(settings: Settings | undefined): Lexicon {
  const l = settings?.lexicon as Lexicon | undefined;
  return l && typeof l === 'object' ? { kw: l.kw || {}, ex: l.ex || {} } : emptyLexicon();
}

/** Levenshtein, for tolerating a single typo in a movement name. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

export interface Lookup {
  name: string;
  mode: ModeKey;
  learned?: boolean;
  fuzzy?: boolean;
}

/**
 * Resolve a phrase to a movement.
 *
 * Order matters: something the athlete has taught the app wins over the built-in
 * library, because they corrected it for a reason. Fuzzy matching is capped at
 * an edit distance of 1 — beyond that the app is guessing, and guessing a
 * movement name silently is how the wrong lift ends up in someone's history.
 */
export function impLookup(phrase: string, lex: Lexicon = emptyLexicon()): Lookup | null {
  const p = phrase.toLowerCase().trim().replace(/[.,:]+$/, '');
  if (!p) return null;

  if (lex.ex[p]) return { name: lex.ex[p].name, mode: lex.ex[p].mode, learned: true };
  if (IMP_ALIAS[p]) return { name: IMP_ALIAS[p].name, mode: IMP_ALIAS[p].mode };
  const sing = p.slice(0, -1);
  if (p.endsWith('s') && IMP_ALIAS[sing]) return { name: IMP_ALIAS[sing].name, mode: IMP_ALIAS[sing].mode };

  let best: string | null = null;
  let bd = 99;
  for (const k in IMP_ALIAS) {
    if (Math.abs(k.length - p.length) > 2) continue;
    const dd = editDistance(k, p);
    if (dd < bd) {
      bd = dd;
      best = k;
    }
  }
  for (const k in lex.ex) {
    if (Math.abs(k.length - p.length) > 2) continue;
    const dd = editDistance(k, p);
    if (dd < bd) {
      bd = dd;
      best = k;
    }
  }
  if (best && bd <= 1) {
    const hit = IMP_ALIAS[best] || lex.ex[best];
    return { name: hit.name, mode: hit.mode, fuzzy: true };
  }
  return null;
}

export const impTitle = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function impRpe(lower: string): number {
  const m = lower.match(/@?\s*rpe\s*(\d\d?)/) || lower.match(/@\s*(\d\d?)\b/);
  return m ? +m[1] : 0;
}

/**
 * Is this line prose rather than a movement?
 *
 * Any number at all means it is workout data — coaches write numbers, notes
 * mostly don't. Short lines are movement names. What is left is judged on
 * whether it reads like a sentence.
 */
export function impLooksProse(line: string, lower: string, lex: Lexicon): boolean {
  if (/\d/.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean).length;
  if (words < 3) return false;
  const clean = lower.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (impLookup(clean, lex) || impLookup(clean.replace(/^\d+\s+/, ''), lex)) return false;
  if (IMP_HEADINGS.test(lower)) return false;
  return IMP_PROSE_RX.test(lower);
}

/** One line → one movement, or null if there is no name left after stripping. */
export function impParseExercise(
  line: string,
  lower: string,
  issue: (o: NewIssue) => void,
  lex: Lexicon,
): ImpExercise | null {
  const rpe = impRpe(lower);
  const time = lower.match(/(\d+)\s*(s|sec|secs|min|mins)\b/);
  const scheme = lower.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?/);
  const list = lower.match(/\b(\d+(?:\s*,\s*\d+){2,})\b/) || lower.match(/\b(\d+(?:\s*-\s*\d+){2,})\b/);
  const lead = lower.match(/^(\d+)\s+([a-z].*)/);
  const kg = lower.match(/(\d+(?:\.\d+)?)\s*kg/);
  const eachSide = /\b(each side|per side|per leg|per arm|e\/s|ea)\b/.test(lower);

  const namePart = line
    .replace(/@?\s*rpe\s*\d\d?/gi, '')
    .replace(/@\s*\d\d?\b/g, '')
    .replace(/\b\d+(?:\s*-\s*\d+){2,}\b/g, '')
    .replace(/\d+\s*x\s*\d+(\s*-\s*\d+)?/gi, '')
    .replace(/\b\d+(?:\s*,\s*\d+){2,}\b/g, '')
    .replace(/\d+\s*(s|sec|secs|min|mins)\b/gi, '')
    .replace(/\d+(?:\.\d+)?\s*kg/gi, '')
    .replace(/\b(each side|per side|per leg|per arm|e\/s|ea)\b/gi, '')
    .replace(/^\d+\s+/, '')
    .replace(/\d+\s*rounds?.*$/i, '')
    .replace(/[^A-Za-z ()\-/&’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!namePart) return null;

  const look = impLookup(namePart, lex);
  const name = look ? look.name : impTitle(namePart);
  const mode: ModeKey = look ? look.mode : time ? 'seconds' : 'reps';
  const ex: ImpExercise = { name, mode, rpe, rest: 0, eachSide, sets: 1 };

  if (list) {
    const arr = list[1].split(/\s*[,-]\s*/).map(Number);
    ex.sets = arr.length;
    ex.reps = arr[0];
    ex.varied = arr;
  } else if (scheme) {
    ex.sets = +scheme[1];
    ex.reps = +scheme[2];
    if (scheme[3]) ex.range = scheme[2] + '-' + scheme[3];
  } else if (time) {
    ex.sets = 1;
    ex.secs = +time[1] * (/min/.test(time[2]) ? 60 : 1);
    if (mode === 'reps') ex.mode = 'seconds';
  } else if (lead) {
    ex.sets = 1;
    ex.reps = +lead[1];
  } else {
    ex.sets = 1;
    ex.reps = 0;
  }
  if (kg) ex.kg = +kg[1];

  if (!look) issue({ kind: 'confirmName', ref: ex, raw: namePart, name });
  else if (look.fuzzy) issue({ kind: 'confirmName', ref: ex, raw: namePart, name, fuzzy: true });
  return ex;
}

/** The whole text → a workout draft plus the questions it could not answer. */
export function impParse(text: string, lex: Lexicon = emptyLexicon()): ImpResult {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const wk: ImpResult = { name: 'Imported workout', blocks: [], issues: [], notes: [] };

  let cur: ImpBlock | null = null;
  let lastMarker = '';
  let issueId = 0;

  const newBlock = (h?: string, opts: Partial<ImpBlock> = {}): ImpBlock => {
    cur = { heading: h || 'Main', format: '', rounds: 0, rest: 0, superset: false, exercises: [], ...opts };
    wk.blocks.push(cur);
    return cur;
  };
  const ensure = () => cur || newBlock('Main');
  const issue = (o: NewIssue) => {
    wk.issues.push({ ...o, id: ++issueId, resolved: false } as ImpIssue);
  };

  let noteMode = false;
  let pendingReps: { sets: number; reps: number; varied?: number[] } | null = null;

  lines.forEach((raw, idx) => {
    let line = raw.replace(/^[\-•*]+\s*/, '').trim();
    const lowr = line.toLowerCase();

    // Once a Note/Stimulus/Scaling/Coach header appears, everything after it is
    // prose. Treating it as movements is how "keep the bar close" becomes an
    // exercise called Keep The Bar Close.
    if (/^(effort\s+)?note|^notes\b|^stimulus|^scaling|^coach|^strategy/i.test(lowr)) {
      noteMode = true;
      const after = line.replace(/^[^:]*:\s*/, '');
      if (after && after !== line) wk.notes.push(after);
      return;
    }
    if (noteMode) {
      wk.notes.push(line);
      return;
    }
    if (impLooksProse(line, lowr, lex)) {
      wk.notes.push(line);
      return;
    }

    // A1/A2 markers: the same letter twice means those movements are a pair.
    const mk = line.match(/^([a-d])\s?(\d)[).:\s]\s*/i) || line.match(/^(\d)([a-d])[).:\s]\s*/i);
    if (mk) {
      const letter = (/[a-d]/i.test(mk[1]) ? mk[1] : mk[2]).toLowerCase();
      if (letter === lastMarker && cur) {
        cur.superset = true;
        if (!cur.format) cur.format = 'superset';
      } else if (cur && cur.exercises.length) {
        newBlock('Block ' + letter.toUpperCase());
      }
      lastMarker = letter;
      line = line.replace(mk[0], '').trim();
    }

    let lower = line.toLowerCase();

    if (/^day\s*\d/.test(lower) && idx > 0) {
      wk.notes.push('Looks like more than one day — import each day separately for now.');
      return;
    }
    // A short opening line with no numbers that isn't a heading or a movement is
    // the workout's title.
    if (idx === 0 && !/\d/.test(line) && line.split(' ').length <= 5 && !IMP_HEADINGS.test(line) && !impLookup(line, lex)) {
      wk.name = impTitle(line);
      return;
    }

    const emom = lower.match(/^emom\s*(\d+)/);
    const amrap = lower.match(/^amrap\s*(\d+)/);
    if (emom) {
      newBlock('EMOM', { format: 'EMOM · ' + emom[1] + ' min' });
      return;
    }
    if (amrap) {
      newBlock('AMRAP', { format: 'AMRAP · ' + amrap[1] + ' min' });
      return;
    }

    const thenRounds = lower.match(/^then\s+(\d+)\s*rounds?/);
    if (thenRounds) {
      newBlock('Circuit', { superset: true, rounds: +thenRounds[1], format: thenRounds[1] + ' rounds' });
      return;
    }
    const rounds = lower.match(/(\d+)\s*rounds?(\s+of\s+that)?/);

    let intoNew = false;
    if (/^into\b/.test(lower)) {
      intoNew = true;
      line = line.replace(/^into\s+/i, '');
      lower = line.toLowerCase();
    }

    // "rest 90" — and the habitual mistypings of it, which become a question
    // rather than being silently discarded.
    const rm = lower.match(/\b(rest|test|rst|reset)\s*(\d+)\s*(s|sec|secs|min|mins|m)?\b/);
    let restVal = 0;
    let typo: string | null = null;
    if (rm) {
      restVal = +rm[2] * (/min|m$/.test(rm[3] || '') ? 60 : 1);
      if (rm[1] !== 'rest' && lex.kw[rm[1]] !== 'rest') typo = rm[1];
      line = line.replace(rm[0], '').replace(/between (sets?|rounds?)/i, '').trim();
      lower = line.toLowerCase();
    }
    if (!line && restVal && cur && cur.exercises.length) {
      const le = cur.exercises[cur.exercises.length - 1];
      le.rest = restVal;
      if (typo) issue({ kind: 'typo', ref: le, word: typo, rest: restVal });
      return;
    }
    if (!line && restVal && cur) {
      cur.rest = restVal;
      if (typo) issue({ kind: 'typo', ref: cur, word: typo, rest: restVal });
      return;
    }

    const scheme = lower.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?/);
    const headWithScheme =
      IMP_HEADINGS.test(lower) &&
      !!scheme &&
      !impLookup(
        lower.replace(/\d+\s*x\s*\d+(\s*-\s*\d+)?/, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(),
        lex,
      );
    const isHeading = IMP_HEADINGS.test(lower) && !scheme && !impLookup(lower.replace(/\d.*$/, '').trim(), lex);

    if (isHeading && !intoNew) {
      const b = newBlock(impTitle(line).replace(/Warm ?Up/i, 'Warm-up').replace(/Cool ?Down/i, 'Cool-down'));
      if (rounds) {
        b.rounds = +rounds[1];
        b.format = rounds[1] + ' rounds';
        b.superset = true;
      }
      if (restVal) b.rest = restVal;
      return;
    }
    if (intoNew) newBlock('Circuit', { superset: true });

    // A lone rep scheme or ladder with no movement ("18-16-14-12-10", "5x5")
    // belongs to the movement on the NEXT line — hold it and attach it there.
    const bareLadder = lower.match(/^\d+(?:\s*-\s*\d+){2,}$/) || lower.match(/^\d+\s*x\s*\d+$/);
    if (bareLadder && !impLookup(lower.replace(/[\d\sx-]/g, '').trim(), lex)) {
      const parts = lower.split(/\s*[x-]\s*/).map(Number).filter((n) => Number.isFinite(n));
      pendingReps = /x/.test(lower)
        ? { sets: parts[0], reps: parts[1] }
        : { sets: parts.length, reps: parts[0], varied: parts };
      return;
    }

    if (headWithScheme && scheme) {
      const hz = impTitle(line.replace(/\d+\s*x\s*\d+.*/i, '').trim());
      const b = newBlock(hz);
      const exH: ImpExercise = {
        name: '',
        mode: 'reps_kg',
        sets: +scheme[1],
        reps: +scheme[2],
        range: scheme[3] ? scheme[2] + '-' + scheme[3] : '',
        rpe: impRpe(lower),
        rest: restVal,
      };
      b.exercises.push(exH);
      issue({ kind: 'nameOrSection', ref: exH, block: hz, blockObj: b });
      if (typo) issue({ kind: 'typo', ref: exH, word: typo, rest: restVal });
      return;
    }

    const ex = impParseExercise(line, lower, issue, lex);
    if (!ex) {
      if (line) issue({ kind: 'unreadable', text: raw });
      return;
    }
    const block = ensure();
    if (restVal) ex.rest = restVal;
    if (pendingReps && ex.sets === 1 && !ex.reps && !ex.secs) {
      ex.sets = pendingReps.sets;
      ex.reps = pendingReps.reps;
      if (pendingReps.varied) ex.varied = pendingReps.varied;
    }
    pendingReps = null;
    if (typo) issue({ kind: 'typo', ref: ex, word: typo, rest: restVal });
    block.exercises.push(ex);
    if (rounds && !thenRounds) {
      block.rounds = +rounds[1];
      block.format = rounds[1] + ' rounds';
      block.superset = true;
      if (restVal) block.rest = restVal;
    }
  });

  wk.blocks = wk.blocks.filter((b) => b.exercises.length);
  return wk;
}

/**
 * A parsed draft → a real workout.
 *
 * The importer's exercise carries richer shorthand than a planned set can hold
 * (a ladder, a load, "each side"), and a planned set is contractually just
 * {t, rpe}. So the extras are folded into the fields that DO exist: a ladder
 * becomes one set per rung, and a named load becomes a cue — the same route the
 * coach app uses to prescribe a weight.
 */
export function impToWorkout(r: ImpResult, uid: () => string) {
  const blocks = r.blocks.map((b) => ({
    id: uid(),
    heading: b.heading,
    minutes: '',
    format: b.format,
    superset: b.superset,
    exercises: b.exercises.map((e) => {
      const n = Math.max(1, e.sets || 1);
      const target = (i: number): string => {
        if (e.varied && e.varied[i] != null) return String(e.varied[i]);
        if (e.range) return e.range;
        if (e.secs) return String(e.secs);
        if (e.reps) return String(e.reps);
        return '';
      };
      const cue: string[] = [];
      if (e.kg) cue.push('Prescribed load: ' + e.kg + 'kg');
      if (e.eachSide) cue.push('each side');
      return {
        id: uid(),
        // The heading-with-scheme branch leaves the name for the athlete to
        // fill in. Storing it empty renders a blank row and hides the exercise
        // from every history lookup, all of which key on name.
        name: e.name || 'Movement',
        mode: e.mode,
        tempo: '',
        rest: e.rest || b.rest || 90,
        ...(cue.length ? { cue: cue.join(' · ') } : {}),
        sets: Array.from({ length: n }, (_, i) => ({
          t: target(i),
          rpe: e.rpe ? String(e.rpe) : '',
        })),
      };
    }),
  }));

  return {
    id: uid(),
    name: r.name,
    blocks,
    updatedAt: Date.now(),
    ...(r.notes.length ? { note: r.notes.join('\n') } : {}),
  };
}

/** Teach the app a word or a movement. Returns the new lexicon to persist. */
export function learnWord(lex: Lexicon, word: string, meaning: string): Lexicon {
  return { ...lex, kw: { ...lex.kw, [word]: meaning } };
}

export function learnMove(lex: Lexicon, alias: string, name: string, mode: ModeKey): Lexicon {
  return { ...lex, ex: { ...lex.ex, [alias.toLowerCase()]: { name, mode } } };
}

export function unlearn(lex: Lexicon, type: 'kw' | 'ex', key: string): Lexicon {
  const next: Lexicon = { kw: { ...lex.kw }, ex: { ...lex.ex } };
  delete next[type][key];
  return next;
}

export { IMP_ALIAS, IMP_LIB_RAW } from './import-lib';
