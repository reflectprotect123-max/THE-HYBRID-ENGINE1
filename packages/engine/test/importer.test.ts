/*
 * The importer, asserted against the original.
 *
 * Every vector here came out of the vanilla app.js running in a browser. The
 * parser is a pile of heuristics — the only meaningful definition of "correct"
 * is "does what the shipped one does", so that is exactly what is tested.
 */
import { describe, expect, it } from 'vitest';
import { IMP_ALIAS, emptyLexicon, impLookup, impParse, learnMove, learnWord, unlearn } from '../src/importer';
import impParseV from './golden/impParse.json';
import impLookupV from './golden/impLookup.json';

/** The harvester serialised only these fields; compare like for like. */
const shape = (r: ReturnType<typeof impParse>) => ({
  name: r.name,
  notes: r.notes,
  issues: r.issues.map((i) => ({
    kind: i.kind,
    word: (i as { word?: string }).word,
    raw: (i as { raw?: string }).raw,
    name: (i as { name?: string }).name,
    fuzzy: !!(i as { fuzzy?: boolean }).fuzzy,
    text: (i as { text?: string }).text,
  })),
  blocks: r.blocks.map((b) => ({
    heading: b.heading,
    format: b.format,
    rounds: b.rounds,
    rest: b.rest,
    superset: b.superset,
    exercises: b.exercises.map((e) => ({
      name: e.name,
      mode: e.mode,
      rpe: e.rpe,
      rest: e.rest,
      eachSide: e.eachSide,
      sets: e.sets,
      reps: e.reps,
      secs: e.secs,
      kg: e.kg,
      range: e.range,
      varied: e.varied,
    })),
  })),
});

describe('impParse matches the shipped parser', () => {
  it('all 19 harvested cases', () => {
    for (const v of impParseV) {
      // JSON drops undefined, so compare through JSON on both sides.
      const got = JSON.parse(JSON.stringify(shape(impParse(v.in))));
      expect(got, JSON.stringify(v.in)).toEqual(v.out);
    }
  });
});

describe('impLookup matches the shipped lookup', () => {
  it('all harvested phrases', () => {
    for (const v of impLookupV) expect(impLookup(v.in), v.in).toEqual(v.out);
  });
});

describe('the movement library survived extraction', () => {
  it('has the aliases the parser depends on', () => {
    // Extraction was mechanical, but a lost alias fails silently — it just
    // stops recognising someone's shorthand — so the count and a spot-check
    // are pinned.
    expect(Object.keys(IMP_ALIAS).length).toBeGreaterThan(400);
    expect(IMP_ALIAS['rdl']?.name).toBe('Romanian deadlift');
    expect(IMP_ALIAS['squat']?.name).toBe('Back squat');
    expect(IMP_ALIAS['assault bike']?.name).toBe('Cardio');
    expect(IMP_ALIAS['assault bike']?.mode).toBe('seconds');
  });
});

describe('the learned lexicon', () => {
  it('teaches a movement, and what it teaches beats the built-in library', () => {
    const base = emptyLexicon();
    expect(impLookup('wodz', base)).toBeNull();

    const lex = learnMove(base, 'WODZ', 'Wall ball', 'reps');
    expect(impLookup('wodz', lex)).toEqual({ name: 'Wall ball', mode: 'reps', learned: true });

    // A learned alias overrides the shipped library for the same phrase — the
    // athlete corrected it on purpose.
    const over = learnMove(base, 'squat', 'Front squat', 'reps_kg');
    expect(impLookup('squat', over)?.name).toBe('Front squat');
  });

  it('teaching a word stops it being reported as a typo', () => {
    const noisy = impParse('Squat 5x5\ntest 90');
    expect(noisy.issues.some((i) => i.kind === 'typo')).toBe(true);

    const taught = impParse('Squat 5x5\ntest 90', learnWord(emptyLexicon(), 'test', 'rest'));
    expect(taught.issues.some((i) => i.kind === 'typo')).toBe(false);
    // …and it still applies the rest value it recognised.
    expect(taught.blocks[0].exercises[0].rest).toBe(90);
  });

  it('unlearn removes it again', () => {
    const lex = learnMove(emptyLexicon(), 'wodz', 'Wall ball', 'reps');
    expect(impLookup('wodz', unlearn(lex, 'ex', 'wodz'))).toBeNull();
  });

  it('does not mutate the lexicon it is given', () => {
    const base = emptyLexicon();
    learnMove(base, 'x', 'Wall ball', 'reps');
    learnWord(base, 'y', 'rest');
    expect(Object.keys(base.ex).length).toBe(0);
    expect(Object.keys(base.kw).length).toBe(0);
  });
});

describe('the judgement calls that make it usable', () => {
  it('keeps coaching prose out of the movement list', () => {
    const r = impParse('Squat 5x5\nNotes: keep the bar close and brace before you descend');
    expect(r.blocks[0].exercises.map((e) => e.name)).toEqual(['Back squat']);
    expect(r.notes.join(' ')).toContain('keep the bar close');
  });

  it('attaches a bare ladder to the movement on the next line', () => {
    const r = impParse('18-16-14-12-10\nWall ball');
    const ex = r.blocks[0].exercises[0];
    expect(ex.name).toBe('Wall ball');
    expect(ex.varied).toEqual([18, 16, 14, 12, 10]);
    expect(ex.sets).toBe(5);
  });

  it('a repeated A1/A2 marker makes a superset', () => {
    const r = impParse('A1) Back squat 5x5\nA2) RDL 3x10');
    expect(r.blocks[0].superset).toBe(true);
    expect(r.blocks[0].exercises.length).toBe(2);
  });

  it('flags an unrecognised movement instead of inventing one silently', () => {
    const r = impParse('Zercher goodmorning 3x8');
    const q = r.issues.find((i) => i.kind === 'confirmName');
    expect(q, 'an unknown movement must raise a question').toBeTruthy();
  });

  it('empty input is not an error', () => {
    const r = impParse('');
    expect(r.blocks).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});
