import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Workout } from '@hybrid/engine';
import { useCoachWorkspace } from './CoachWorkspaceContext';
import { Planner } from './authoring/Planner';
import { Button, Card } from '../ui';
import { createSaveCoalescer } from './save-coalescer';

/*
 * The block/set editor for a ROSTER CLIENT's draft — the gap
 * docs/ARC_LAYER3_DESIGN.md flagged as the one thing `RosterAuthoringView`
 * couldn't do: create a named shell and publish it, but never edit its
 * structure. This is not a fork of the editor; `Planner` (coach/authoring/Planner.tsx)
 * already isolates every mutation behind one `edit(fn)` closure, so this file
 * only supplies a different `workout`/`edit`/`onBack` — the block, exercise
 * and set rendering underneath is the exact same code the self-coach uses.
 *
 * `edit` here does NOT write straight to Supabase on every keystroke. It
 * updates local state immediately (so typing feels the same as the local
 * editor) and DEBOUNCES a `saveWorkoutDraft` call, coalescing bursts of
 * edits into one write. A save already in flight when another is due is not
 * skipped — it is queued once and re-fires with the latest state as soon as
 * the in-flight one resolves, so no edit is ever silently dropped, and at
 * most one save is ever in flight (avoiding a base-version race between two
 * concurrent optimistic-concurrency writes from THIS tab).
 */

const SAVE_DEBOUNCE_MS = 700;

export function RosterPlanner() {
  const { workoutId } = useParams();
  const nav = useNavigate();
  const { selectedClient, repository } = useCoachWorkspace();
  const clientId = selectedClient?.id ?? null;

  const [working, setWorking] = useState<Workout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const workingRef = useRef<Workout | null>(null);
  const kindRef = useRef<'strength' | 'conditioning'>('strength');
  const baseVersionRef = useRef<number | null>(null);

  const back = () => {
    coalescer.flushNow();
    nav('/coach/author');
  };

  const coalescer = useMemo(
    () =>
      createSaveCoalescer<Workout>(async (value) => {
        if (!clientId || !workoutId || !repository.saveWorkoutDraft) return;
        try {
          const saved = await repository.saveWorkoutDraft(clientId, workoutId, kindRef.current, value, baseVersionRef.current);
          baseVersionRef.current = saved.baseVersion;
          setSaveError(null);
        } catch {
          setSaveError('The last change could not be saved. Editing again will retry.');
        }
      }, SAVE_DEBOUNCE_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientId, workoutId, repository],
  );

  useEffect(() => {
    // Flush any pending debounced save immediately on unmount, so navigating
    // away within the debounce window does not lose the latest edit.
    return () => coalescer.flushNow();
  }, [coalescer]);

  useEffect(() => {
    if (!clientId || !workoutId || !repository.listWorkoutDrafts) return;
    let active = true;
    repository
      .listWorkoutDrafts(clientId)
      .then((drafts) => {
        if (!active) return;
        const found = drafts.find((d) => d.workoutId === workoutId);
        if (!found) {
          setLoadError('That draft could not be found.');
          return;
        }
        kindRef.current = found.kind;
        baseVersionRef.current = found.baseVersion;
        workingRef.current = found.body;
        setWorking(found.body);
      })
      .catch(() => {
        if (active) setLoadError('That draft could not be loaded.');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, workoutId, repository]);

  const onEdit = (fn: (draft: Workout) => void) => {
    const current = workingRef.current;
    if (!current) return;
    const next = structuredClone(current);
    fn(next);
    next.updatedAt = Date.now();
    workingRef.current = next;
    setWorking(next);
    coalescer.schedule(next);
  };

  if (loadError) {
    return (
      <div className="grid min-h-full place-items-center p-3">
        <Card className="text-center">
          <p className="text-6 font-[750]">{loadError}</p>
          <Button className="mt-2" variant="brass" onClick={back}>
            Back
          </Button>
        </Card>
      </div>
    );
  }

  if (!working) return null;

  return (
    <div>
      {saveError && (
        <p className="mx-auto max-w-[560px] px-2 pt-2 text-2 text-bad">{saveError}</p>
      )}
      <Planner
        workout={working}
        onEdit={onEdit}
        onBack={back}
        headerNote={`Editing for ${selectedClient?.name ?? 'this athlete'} · saves automatically`}
      />
    </div>
  );
}
