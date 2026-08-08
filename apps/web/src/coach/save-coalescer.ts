/**
 * A burst of rapid edits (typing a set's weight, then its reps, then the
 * next set) must become ONE network write, not one per keystroke — and two
 * writes must never be in flight at once, because `save_workout_draft`'s
 * optimistic concurrency is a single `base_version` compare-and-swap: two
 * concurrent calls from the SAME tab would race on it even though nothing
 * else touched the draft. Pulled out of `RosterPlanner` as a pure,
 * timer-driven state machine so both properties — "debounced" and
 * "never more than one in flight" — are testable without rendering React
 * or waiting on a real network call.
 *
 * Never drops an edit either: a `schedule` call that arrives while a save is
 * already in flight is not skipped, it marks the coalescer dirty so the
 * in-flight save's completion immediately re-fires with whatever is newest
 * at that point — the same "trailing edge, latest value wins" rule the
 * debounce timer itself follows.
 */
export interface SaveCoalescer<T> {
  schedule(value: T): void;
  /** Test-only escape hatch; production callers rely on the debounce timer. */
  flushNow(): void;
}

export function createSaveCoalescer<T>(save: (value: T) => Promise<void>, debounceMs: number): SaveCoalescer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let dirty = false;
  let latest: T | undefined;
  let hasLatest = false;

  function flush() {
    if (!hasLatest || inFlight) return;
    const value = latest as T;
    inFlight = true;
    save(value)
      .catch(() => {
        /* Caller's `save` is expected to report its own failure (e.g. a
           state setter inside the passed-in function) — this coalescer only
           owns scheduling, not error presentation. */
      })
      .finally(() => {
        inFlight = false;
        if (dirty) {
          dirty = false;
          flush();
        }
      });
  }

  return {
    schedule(value: T) {
      latest = value;
      hasLatest = true;
      if (inFlight) {
        dirty = true;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, debounceMs);
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
  };
}
