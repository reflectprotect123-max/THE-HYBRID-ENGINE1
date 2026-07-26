import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COACH_LS_KEY,
  emptyLib,
  emptyWeek,
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
}

const C = createContext<Ctx | null>(null);

function load(): CoachLib {
  try {
    const raw = localStorage.getItem(COACH_LS_KEY);
    if (!raw) return emptyLib();
    const lib = JSON.parse(raw) as CoachLib;
    // Clamp the selection: a library edited on another device may have fewer
    // programmes or weeks than this one last pointed at.
    if (!lib.programs?.length) return emptyLib();
    lib.sel = lib.sel || { p: 0, w: 0, d: 0 };
    lib.sel.p = Math.max(0, Math.min(lib.programs.length - 1, lib.sel.p | 0));
    const p = lib.programs[lib.sel.p];
    if (!p.weeks?.length) p.weeks = [emptyWeek()];
    lib.sel.w = Math.max(0, Math.min(p.weeks.length - 1, lib.sel.w | 0));
    lib.sel.d = Math.max(0, Math.min(6, lib.sel.d | 0));
    return lib;
  } catch {
    return emptyLib();
  }
}

export function LibProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<CoachLib>(load);
  const ref = useRef(lib);
  ref.current = lib;

  const update = useCallback<Ctx['update']>((fn) => {
    const draft: CoachLib = structuredClone(ref.current);
    if (fn(draft) === false) return;
    ref.current = draft;
    setLib(draft);
    try {
      localStorage.setItem(COACH_LS_KEY, JSON.stringify(draft));
    } catch {
      /* private mode — the session still edits, it just won't survive a reload */
    }
  }, []);

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
      select: (patch) =>
        update((d) => {
          Object.assign(d.sel, patch);
          const p = d.programs[d.sel.p];
          if (!p.weeks[d.sel.w]) p.weeks[d.sel.w] = emptyWeek();
        }),
    };
  }, [lib, update]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useLib(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('useLib outside LibProvider');
  return c;
}
