import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COACH_LS_KEY,
  emptyLib,
  emptyWeek,
  migrateLib,
  type CoachLib,
  type CoachSession,
} from './model';

/*
 * The coach library, and the only way to change it.
 *
 * "Saves as you go" is a promise the UI makes in its own kicker text, so every
 * mutation persists immediately rather than waiting for a save button that
 * does not exist.
 */

interface Ctx {
  lib: CoachLib;
  update: (fn: (draft: CoachLib) => void | false) => void;
  day: CoachSession | null;
  setDay: (s: CoachSession | null) => void;
  select: (patch: Partial<CoachLib['sel']>) => void;
  addWeek: () => void;
}

const C = createContext<Ctx | null>(null);

/**
 * Read whatever is on disk. Same localStorage key as the vanilla builder, so a
 * coach who already has programmes opens this app and finds them — including
 * ones written before the blocks model existed, which `migrateLib` reads
 * forward rather than discarding.
 */
function load(): CoachLib {
  try {
    const raw = localStorage.getItem(COACH_LS_KEY);
    if (!raw) return emptyLib();
    return migrateLib(JSON.parse(raw));
  } catch {
    return emptyLib();
  }
}

export function LibProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<CoachLib>(load);
  const ref = useRef(lib);
  ref.current = lib;

  /*
   * Two mutation paths, split on one question: did the coach WRITE something?
   *
   * `update` is for edits — it persists, because "saves as you go" is a promise
   * about the coach's work. `look` is for the selection only: which week and day
   * the coach is viewing is not work, and persisting it made looking at a week
   * indistinguishable from creating one. A pure navigation therefore changes
   * React state and nothing on disk; the selection still reaches storage
   * piggybacked on the next real edit, and `migrateLib` clamps whatever was last
   * written, so a reload lands somewhere valid either way.
   */
  const apply = useCallback((fn: (draft: CoachLib) => void | false, persist: boolean) => {
    const draft: CoachLib = structuredClone(ref.current);
    if (fn(draft) === false) return;
    ref.current = draft;
    setLib(draft);
    if (!persist) return;
    try {
      localStorage.setItem(COACH_LS_KEY, JSON.stringify(draft));
    } catch {
      /* private mode — the session still edits, it just won't survive a reload */
    }
  }, []);

  const update = useCallback<Ctx['update']>((fn) => apply(fn, true), [apply]);

  const value = useMemo<Ctx>(() => {
    const prog = lib.programs[lib.sel.p];
    const week = prog?.weeks[lib.sel.w];
    const day = week?.days[lib.sel.d] ?? null;
    return {
      lib,
      update,
      day,
      setDay: (s) =>
        update((d) => {
          d.programs[d.sel.p].weeks[d.sel.w].days[d.sel.d] = s;
        }),
      /*
       * Navigation, and ONLY navigation. The old version wrote an emptyWeek
       * whenever the selection pointed past the end, which made "look at week
       * 4" and "create week 4" the same gesture. Now it clamps instead: a
       * selection can only land on a week that already exists, and creating
       * one is `addWeek`, an explicit different act.
       */
      select: (patch) =>
        apply((d) => {
          Object.assign(d.sel, patch);
          const p = d.programs[d.sel.p];
          d.sel.w = Math.max(0, Math.min(p.weeks.length - 1, d.sel.w | 0));
          d.sel.d = Math.max(0, Math.min(6, d.sel.d | 0));
        }, false),
      addWeek: () =>
        update((d) => {
          const p = d.programs[d.sel.p];
          p.weeks.push(emptyWeek());
          d.sel.w = p.weeks.length - 1;
        }),
    };
  }, [lib, apply, update]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useLib(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('useLib outside LibProvider');
  return c;
}
