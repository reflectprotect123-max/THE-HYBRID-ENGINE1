import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Storage as StoragePort } from '@hybrid/engine';
import { emptyNutritionDB, sanitizeNutritionDB, type NutritionDB } from '@hybrid/nutrition-core';
import { webStorage } from './db';

/*
 * The athlete's nutrition slice, stored and provided BESIDE the engine.
 *
 * Its own provider and its own storage key, never a field on EngineDB and
 * never a key inside the engine blob. Two consequences the rest of the app
 * depends on:
 *
 *  - `cloudFp` hashes the engine blob, so logging a meal cannot dirty the
 *    training fingerprint and cannot push a training snapshot (and a logged set
 *    cannot push a nutrition snapshot).
 *  - a save that fails, a sanitizer that rejects, or a schema that changes on
 *    one side leaves the other side untouched. Nutrition sync and training sync
 *    are structurally unable to corrupt each other, which is the whole reason
 *    the rebuild scope put nutrition in its own partition.
 *
 * Identical in shape to the mobile app's slice, and deliberately so — same
 * rule as the two DbProviders: one engine, one set of persistence rules.
 */

/** Deliberately NOT `LS_KEY` + a suffix: nothing may make this look derived. */
export const NUTRITION_LS_KEY = 'hybrid-nutrition-v1';

export interface NutritionLoadResult {
  nutrition: NutritionDB;
  /** true when the stored blob was unreadable and this is a fresh fallback. */
  recovered: boolean;
}

/**
 * Read the slice. An unparseable blob yields an EMPTY slice rather than a
 * throw, matching `loadDB`: an athlete opening the app to a crash screen has
 * lost everything either way; one opening it to an empty log can still restore
 * from cloud on the next pull.
 */
export function loadNutrition(store: StoragePort, key = NUTRITION_LS_KEY): NutritionLoadResult {
  try {
    const raw = store.getItem(key);
    if (!raw) return { nutrition: emptyNutritionDB(), recovered: false };
    return { nutrition: sanitizeNutritionDB(JSON.parse(raw)), recovered: false };
  } catch {
    return { nutrition: emptyNutritionDB(), recovered: true };
  }
}

export function saveNutrition(store: StoragePort, nutrition: NutritionDB, key = NUTRITION_LS_KEY): boolean {
  try {
    store.setItem(key, JSON.stringify(nutrition));
    return true;
  } catch {
    // Quota or private mode. Surfaced to the caller — silently dropping a save
    // is how a day's logging disappears without a trace.
    return false;
  }
}

interface NutritionCtx {
  nutrition: NutritionDB;
  /** Mutate a draft copy. Returning false abandons the write. Mirrors `useDb().update`. */
  update: (fn: (draft: NutritionDB) => void | false) => void;
  /**
   * Adopt a whole slice. This is the sync path's fold-back of an ALREADY MERGED
   * result — it overwrites, so nothing may hand it a one-sided blob.
   */
  replace: (next: NutritionDB) => void;
  saveFailed: boolean;
  /** true when the stored slice was unreadable at boot. */
  dataRecovered: boolean;
}

const Ctx = createContext<NutritionCtx | null>(null);

export function NutritionProvider({ children }: { children: ReactNode }) {
  const recoveredAtBoot = useRef(false);
  const [nutrition, setNutrition] = useState<NutritionDB>(() => {
    const { nutrition: loaded, recovered } = loadNutrition(webStorage);
    recoveredAtBoot.current = recovered;
    return loaded;
  });
  const [dataRecovered] = useState(() => recoveredAtBoot.current);
  const [saveFailed, setSaveFailed] = useState(false);

  const ref = useRef(nutrition);
  ref.current = nutrition;

  const commit = useCallback((next: NutritionDB) => {
    ref.current = next;
    setNutrition(next);
    setSaveFailed(!saveNutrition(webStorage, next));
  }, []);

  const update = useCallback<NutritionCtx['update']>(
    (fn) => {
      const draft: NutritionDB = structuredClone(ref.current);
      if (fn(draft) === false) return;
      commit(draft);
    },
    [commit],
  );

  const replace = useCallback<NutritionCtx['replace']>((next) => commit(next), [commit]);

  /* Another tab logging a meal is the same athlete on the same data. Pick up
     its write rather than silently diverging until one tab overwrites the
     other — the same reason DbProvider listens. Scoped to this key: a training
     write must not re-read the nutrition slice, or the isolation above is
     undone by a listener. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== NUTRITION_LS_KEY || !e.newValue) return;
      const { nutrition: fresh } = loadNutrition(webStorage);
      ref.current = fresh;
      setNutrition(fresh);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<NutritionCtx>(
    () => ({ nutrition, update, replace, saveFailed, dataRecovered }),
    [nutrition, update, replace, saveFailed, dataRecovered],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNutrition(): NutritionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useNutrition outside NutritionProvider');
  return c;
}
