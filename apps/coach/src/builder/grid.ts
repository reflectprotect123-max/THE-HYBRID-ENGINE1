import { blockExercises, isCond, CON_FORMATS } from '@hybrid/engine';
import type { CoachProgram, CoachSession } from '../model';

export interface CellSummary {
  status: 'empty' | 'filled';
  line: string;
  sets: number;
  isCond: boolean;
}

/** What a day's cell shows in the grid, without opening it. */
export function cellSummary(sess: CoachSession | null): CellSummary {
  if (!sess) return { status: 'empty', line: '', sets: 0, isCond: false };
  const names: string[] = [];
  const cond: string[] = [];
  let sets = 0;
  for (const b of sess.blocks) {
    if (isCond(b)) {
      cond.push(CON_FORMATS[b.condFmt].name);
      continue;
    }
    for (const e of blockExercises(b)) {
      if (e.name.trim()) names.push(e.name.trim());
      sets += e.sets.length;
    }
  }
  const line = names.length
    ? names.slice(0, 3).join(' · ') + (names.length > 3 ? ' +' + (names.length - 3) : '')
    : cond.length
      ? cond.join(' · ')
      : 'No movements yet';
  return { status: 'filled', line, sets, isCond: cond.length > 0 };
}

/**
 * Sessions already written anywhere in the programme, deduplicated by id, in
 * first-seen order. This IS the "library" an empty cell's "Add from library"
 * offers to reuse — there is no separate template store, so what a coach has
 * already authored elsewhere in this programme is what's available to copy.
 */
export function libraryCandidates(program: CoachProgram): CoachSession[] {
  const seen = new Set<string>();
  const out: CoachSession[] = [];
  for (const week of program.weeks) {
    for (const day of week.days) {
      if (day && !seen.has(day.id)) {
        seen.add(day.id);
        out.push(day);
      }
    }
  }
  return out;
}
